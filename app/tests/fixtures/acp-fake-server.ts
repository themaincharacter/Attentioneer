/**
 * A FAKE ACP SERVER (Epic 18 story 1) — the fixture that stands in front of the
 * transport's pipes in \`app/tests/acp-transport.test.ts\`.
 *
 * It speaks the same wire as the real thing, written independently of
 * \`src/turn/acp.ts\` on purpose: a fixture that imported the transport's own
 * framing helpers could agree with a bug. Newline-delimited JSON is the
 * default; \`--framing content-length\` proves the other reader.
 *
 * Modes, selected by the first argument:
 *   normal        handshake, session, a prompt with one permission prompt,
 *                 ordered updates, a second prompt that answers a cancel.
 *   malformed     writes one non-JSON line before the initialize answer.
 *   die-mid-turn  writes one update for the first prompt, then exits 3.
 *   silent        reads everything and answers nothing (a timeout probe).
 *
 * Run it as \`bun tests/fixtures/acp-fake-server.ts [mode] [--framing <kind>]\`.
 */

const argv = process.argv.slice(2);
const mode = argv[0] ?? "normal";
const framingIndex = argv.indexOf("--framing");
const framing = framingIndex >= 0 ? argv[framingIndex + 1] : "ndjson";
if (framing !== "ndjson" && framing !== "content-length") {
  throw new Error("unknown framing: " + framing);
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** One serialized writer: a notification must not overtake the frame before it. */
let outbox: Promise<unknown> = Promise.resolve();

function encode(payload: string): string {
  if (framing === "ndjson") return payload + "\n";
  return "Content-Length: " + encoder.encode(payload).byteLength + "\r\n\r\n" + payload;
}

function say(payload: string): void {
  outbox = outbox
    .then(() => Bun.write(Bun.stdout, encode(payload)))
    .catch(() => {
      // The client is gone; there is nobody left to tell.
    });
}

function respond(id: number, result: unknown): void {
  say(JSON.stringify({ jsonrpc: "2.0", id, result }));
}

function notify(sessionId: string, update: Record<string, unknown>): void {
  say(JSON.stringify({ jsonrpc: "2.0", method: "session/update", params: { sessionId, update } }));
}

let nextServerId = 100;
let sessionId = "fake-session";
let promptCount = 0;
let permissionWaiter: ((optionId: string | null) => void) | null = null;

interface ActivePrompt {
  id: number;
  cancelled: boolean;
  settled: boolean;
  cancelWaiters: (() => void)[];
}

let active: ActivePrompt | null = null;

function update(text: string): void {
  notify(sessionId, {
    sessionUpdate: "agent_message_chunk",
    content: { type: "text", text },
  });
}

function requestPermission(): void {
  const id = nextServerId;
  nextServerId += 1;
  say(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: {
          toolCallId: "call-1",
          title: "Read the working directory",
          kind: "read",
          status: "pending",
        },
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "reject-once", name: "Reject", kind: "reject_once" },
        ],
      },
    }),
  );
}

function settlePrompt(stopReason: string): void {
  if (active === null || active.settled) return;
  active.settled = true;
  respond(active.id, { stopReason });
  active = null;
}

async function runPrompt(id: number): Promise<void> {
  promptCount += 1;
  active = { id, cancelled: false, settled: false, cancelWaiters: [] };

  if (mode === "die-mid-turn") {
    update("one ");
    await Bun.sleep(20);
    process.exit(3);
  }

  if (promptCount === 1) {
    update("one ");
    const optionId = await new Promise<string | null>((resolve) => {
      permissionWaiter = resolve;
      requestPermission();
    });
    permissionWaiter = null;
    if (active === null || active.settled) return;
    if (active.cancelled) {
      settlePrompt("cancelled");
      return;
    }
    update(optionId === "allow-once" ? "allowed " : "refused ");
    update("two");
    settlePrompt("end_turn");
    return;
  }

  update("working ");
  await new Promise<void>((resolve) => {
    if (active === null || active.cancelled) {
      resolve();
      return;
    }
    active.cancelWaiters.push(resolve);
  });
  settlePrompt("cancelled");
}

function cancel(): void {
  if (active === null) return;
  active.cancelled = true;
  permissionWaiter?.(null);
  permissionWaiter = null;
  for (const waiter of active.cancelWaiters.splice(0)) waiter();
}

function handle(message: Record<string, unknown>): void {
  if (mode === "silent") return;

  // A response to the fake server's permission request: an answer, not a call.
  if (message.method === undefined && typeof message.id === "number") {
    const result = message.result as { outcome?: string; optionId?: string } | undefined;
    const optionId = result?.outcome === "selected" ? result.optionId ?? null : null;
    permissionWaiter?.(optionId);
    permissionWaiter = null;
    return;
  }

  if (message.method === "initialize") {
    if (mode === "malformed") {
      // Deliberately not JSON-RPC: the client must report it and keep reading.
      say("this line is not json");
    }
    respond(message.id as number, {
      protocolVersion: 1,
      agentInfo: { name: "fake-acp", version: "0.0.0" },
      agentCapabilities: { promptCapabilities: { image: false, audio: false, embeddedContext: false } },
      authMethods: [],
    });
    return;
  }
  if (message.method === "session/new") {
    sessionId = "fake-session";
    respond(message.id as number, { sessionId, configOptions: [] });
    return;
  }
  if (message.method === "session/prompt") {
    void runPrompt(message.id as number);
    return;
  }
  if (message.method === "session/cancel") {
    cancel();
  }
}

/** Read newline frames (or length frames) from stdin, independently of the client. */
let pending = new Uint8Array(0);

function concat(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right;
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}

function framesIn(chunk: Uint8Array): string[] {
  pending = concat(pending, chunk);
  const frames: string[] = [];
  for (;;) {
    if (framing === "ndjson") {
      const end = pending.indexOf(0x0a);
      if (end < 0) break;
      const line = decoder.decode(pending.subarray(0, end)).replace(/\r$/, "").trim();
      pending = pending.slice(end + 1);
      if (line !== "") frames.push(line);
      continue;
    }
    const headerEnd = findHeaderEnd();
    if (headerEnd < 0) break;
    const header = decoder.decode(pending.subarray(0, headerEnd));
    const separator = pending[headerEnd] === 0x0d ? 4 : 2;
    const match = /(^|\r?\n)\s*content-length\s*:\s*(\d+)/i.exec(header);
    if (match === null) {
      pending = pending.slice(headerEnd + separator);
      continue;
    }
    const length = Number(match[2]);
    const start = headerEnd + separator;
    if (pending.byteLength < start + length) break;
    frames.push(decoder.decode(pending.subarray(start, start + length)));
    pending = pending.slice(start + length);
  }
  return frames;
}

function findHeaderEnd(): number {
  for (let at = 0; at + 1 < pending.byteLength; at += 1) {
    if (pending[at] === 0x0a && pending[at + 1] === 0x0a) return at;
    if (
      at + 3 < pending.byteLength &&
      pending[at] === 0x0d &&
      pending[at + 1] === 0x0a &&
      pending[at + 2] === 0x0d &&
      pending[at + 3] === 0x0a
    ) {
      return at;
    }
  }
  return -1;
}

try {
  for await (const chunk of Bun.stdin.stream()) {
    for (const raw of framesIn(chunk)) {
      let message: unknown;
      try {
        message = JSON.parse(raw);
      } catch {
        continue;
      }
      if (typeof message === "object" && message !== null && !Array.isArray(message)) {
        handle(message as Record<string, unknown>);
      }
    }
  }
  await outbox;
} finally {
  // stdin closed: the client is done with this conversation.
}
