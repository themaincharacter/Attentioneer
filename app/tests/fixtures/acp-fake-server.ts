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
 *   hang-mid-turn writes one update, then waits for session/cancel before
 *                 settling the prompt as cancelled (a stop probe).
 *   silent        reads everything and answers nothing (a timeout probe).
 *   tools         handshake, then a prompt whose stream carries a tool call
 *                 (pending), agent words, and the same call completed before
 *                 the turn settles — the shape 18.3's transcript renders.
 *   no-key        handshake and session, then `session/prompt` refused with the
 *                 real server's credentials error (-32603, "no API key …") —
 *                 the spike's 18.1 observation, reproduced as a fixture so a
 *                 run with no key can be proven to FAIL rather than hang.
 *
 * --report <path> writes {pid, argv, env} once at startup, before the protocol
 * starts. It is how the run tests prove what environment reached the child and
 * that the child died. When `session/cancel` arrives it also writes
 * `<report>.cancel`, so a test can prove the client asked before the child was
 * killed. The report path is the fixture's own, never the run's session
 * directory.
 *
 * Run it as \`bun tests/fixtures/acp-fake-server.ts [mode] [--framing <kind>]\`.
 */

import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const mode = argv[0] ?? "normal";
const framingIndex = argv.indexOf("--framing");
const framing = framingIndex >= 0 ? argv[framingIndex + 1] : "ndjson";
if (framing !== "ndjson" && framing !== "content-length") {
  throw new Error("unknown framing: " + framing);
}

const reportIndex = argv.indexOf("--report");
const reportPath = reportIndex >= 0 ? argv[reportIndex + 1] : null;
if (reportPath !== null) {
  // The child's own view of what it was given. The run tests read it; nothing
  // in the run writes it.
  writeFileSync(
    reportPath,
    JSON.stringify({ pid: process.pid, argv: process.argv, env: { ...process.env } }),
  );
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

function fail(id: number, code: number, message: string): void {
  say(JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } }));
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

  if (mode === "tools") {
    notify(sessionId, {
      sessionUpdate: "tool_call",
      toolCallId: "call-1",
      title: "Read the working directory",
      kind: "read",
      status: "pending",
    });
    await Bun.sleep(10);
    update("one ");
    await Bun.sleep(10);
    notify(sessionId, {
      sessionUpdate: "tool_call_update",
      toolCallId: "call-1",
      status: "completed",
    });
    update("two");
    settlePrompt("end_turn");
    return;
  }

  if (mode === "hang-mid-turn") {
    update("working ");
    await new Promise<void>((resolve) => {
      if (active === null || active.cancelled) {
        resolve();
        return;
      }
      active.cancelWaiters.push(resolve);
    });
    settlePrompt("cancelled");
    return;
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
  if (reportPath !== null) {
    writeFileSync(reportPath + ".cancel", JSON.stringify({ sessionId }));
  }
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
    if (mode === "no-key") {
      // The spike's finding (18.1), reproduced byte for byte: the spawned tool
      // has no key, so the turn is refused before any model step. ACP carries
      // no auth of its own (`authMethods: []`), which is why this is the first
      // break a real run hits.
      fail(
        message.id as number,
        -32603,
        'Internal error: turn failed: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment',
      );
      return;
    }
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
