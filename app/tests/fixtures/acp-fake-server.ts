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
 *                 ordered updates, a second prompt that answers a cancel. STORY
 *                 18.4 makes the prompt offer an "always" option beside the
 *                 once pair, so the client's no-always rule is proven against
 *                 a server that really offers one; the reply still WAITS for
 *                 the client's answer.
 *   edit-ask      the same run, except its one permission prompt describes an
 *                 "edit" tool call rather than a "read". STORY 19.2 uses it to
 *                 prove that a read-only declaration does NOT cover a change:
 *                 an out-of-scope ask must still reach the person.
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
 *   drip          handshake and session, then one update every 100 ms until
 *                 cancelled — the shape a run has when the sidecar's stdout
 *                 closes underneath it (18.3b's closed-pipe kill probe).
 *   sign-in       STORY 22.1b: NOT an ACP server at all — a tool's own sign-in.
 *                 Prints one URL line, waits for ONE line of its own stdin (the
 *                 code the page showed), confirms it with a SHA-256 digest (so
 *                 the bytes that arrived are proven WITHOUT printing them back)
 *                 and exits zero. It is what the setup lane is proven against.
 *   resume        STORY 21.1: a session family with a STORE that outlives the
 *                 process (a small JSON file beside the report). session/new
 *                 makes a numbered id and records the exact cwd; session/resume
 *                 finds it by that pair or refuses in one sentence; a prompt
 *                 answers with the earlier prompts named back, so a follow-up
 *                 that reached another session cannot pretend to remember.
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

import { readFileSync, writeFileSync } from "node:fs";

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

/**
 * STORY 21.1 — THE RESUME FAMILY'S IN-MEMORY STORE, ON DISK. A resumed session
 * must be found by a FRESH process, so the fixture keeps its model of memory in
 * one small JSON file beside the report: a session id, the exact cwd it was
 * recorded in, and the prompts it has been asked. That is the whole model —
 * enough to prove the id survives a spawn, the folder is enforced, and the
 * follow-up reads the earlier turns back.
 */
interface StoredSession {
  cwd: string;
  prompts: string[];
}

interface StoredSessions {
  next: number;
  sessions: Record<string, StoredSession>;
}

const storeIndex = argv.indexOf("--store");
const storePath =
  storeIndex >= 0
    ? argv[storeIndex + 1]
    : reportPath === null
      ? null
      : reportPath + ".store";

function loadSessions(): StoredSessions {
  if (storePath === null) return { next: 1, sessions: {} };
  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf8")) as StoredSessions;
    if (typeof parsed.next === "number" && typeof parsed.sessions === "object") {
      return parsed;
    }
  } catch {
    // No store yet: this is the first spawn of the family.
  }
  return { next: 1, sessions: {} };
}

const stored = loadSessions();

function saveSessions(): void {
  if (storePath === null) return;
  try {
    writeFileSync(storePath, JSON.stringify(stored));
  } catch {
    // A store that cannot be written makes the NEXT spawn look memoryless;
    // the test that needs memory says so rather than pretending.
  }
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

/**
 * STORY 22.1b — THE SIGN-IN MODE. A tool's own sign-in is NOT an ACP server:
 * it prints a page for the person to open, waits for ONE line on its stdin
 * (the code the page showed), echoes it and exits zero. The file's JSON framing
 * is deliberately bypassed here — a sign-in child speaks the tool's own words,
 * not the app's protocol — which is exactly why a setup child needs its own
 * wire kinds rather than a run with a flag.
 *
 * It is the fixture the setup lane is proven against: a URL line, then a wait,
 * then an echo that proves the pasted code reached the child.
 */
if (mode === "sign-in") {
  await runSignIn();
}

async function runSignIn(): Promise<never> {
  say("open this page to sign in: https://example.test/sign-in");
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    const newline = buffer.indexOf("\n");
    if (newline < 0) continue;
    const code = buffer.slice(0, newline).replace(/\r$/, "");
    // THE CODE ITSELF IS NEVER PRINTED BACK: the digest proves the exact bytes
    // arrived while leaving no copy of them on any pipe, view or file.
    const digest = new Bun.CryptoHasher("sha256").update(code).digest("hex");
    say("the code reached the child: sha256 " + digest);
    await outbox;
    process.exit(0);
  }
  // stdin closed before a code ever arrived: the person did not finish.
  await outbox;
  process.exit(0);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  // STORY 19.2 — the ask's KIND is what a declared boundary is matched against,
  // so the fixture can describe a change as well as a read. Nothing else about
  // the run changes.
  const edits = mode === "edit-ask";
  say(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      method: "session/request_permission",
      params: {
        sessionId,
        toolCall: {
          toolCallId: "call-1",
          title: edits ? "Edit a file" : "Read the working directory",
          kind: edits ? "edit" : "read",
          status: "pending",
        },
        // STORY 18.4: a server may offer a REMEMBERED yes. The fake offers
        // one precisely so the client's rule ("never present or send it") can
        // be tested against the real shape rather than a promise.
        options: [
          { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
          { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
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

/**
 * STORY 21.1 — ONE PROMPT INTO A RECORDED SESSION. The fixture's memory is the
 * prompt list it keeps in the store; the answer NAMES those turns back, so a
 * follow-up that reached a different session could not answer as if it had
 * remembered them.
 */
async function runResumePrompt(id: number, text: string): Promise<void> {
  promptCount += 1;
  active = { id, cancelled: false, settled: false, cancelWaiters: [] };
  const record = stored.sessions[sessionId];
  if (record === undefined) {
    fail(id, -32602, "session " + sessionId + " is not recorded");
    active = null;
    return;
  }
  record.prompts.push(text);
  saveSessions();
  update(
    "this session remembers " +
      record.prompts.length +
      " prompt(s): " +
      record.prompts.join(" | "),
  );
  update("answer: " + text);
  settlePrompt("end_turn");
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

  if (mode === "drip") {
    // One update on a clock, so a client that loses its own reader still has
    // something to fail to write.
    update("tick ");
    for (let at = 0; at < 300; at += 1) {
      await Bun.sleep(100);
      if (active === null || active.cancelled) break;
      update("tick ");
    }
    settlePrompt("cancelled");
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
    if (mode === "resume") {
      // A fresh session in the family's store: a numbered id and the folder it
      // was recorded in. The next spawn finds it by exactly that pair.
      const params = isRecord(message.params) ? message.params : {};
      const cwd = typeof params.cwd === "string" ? params.cwd : "";
      const created = "fake-session-" + stored.next;
      stored.next += 1;
      stored.sessions[created] = { cwd, prompts: [] };
      saveSessions();
      sessionId = created;
      respond(message.id as number, { sessionId: created, configOptions: [] });
      return;
    }
    sessionId = "fake-session";
    respond(message.id as number, { sessionId, configOptions: [] });
    return;
  }
  if (message.method === "session/resume") {
    // The family's refusal is the tool's own shape: one sentence, no session.
    const params = isRecord(message.params) ? message.params : {};
    const wanted = typeof params.sessionId === "string" ? params.sessionId : "";
    const cwd = typeof params.cwd === "string" ? params.cwd : "";
    const record = stored.sessions[wanted];
    if (record === undefined) {
      fail(
        message.id as number,
        -32602,
        "session " + wanted + " is not recorded",
      );
      return;
    }
    if (record.cwd !== cwd) {
      fail(
        message.id as number,
        -32602,
        "session " + wanted + " was recorded in " + record.cwd + ", not " + cwd,
      );
      return;
    }
    sessionId = wanted;
    respond(message.id as number, { sessionId: wanted });
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
    if (mode === "resume") {
      const params = isRecord(message.params) ? message.params : {};
      const prompt = Array.isArray(params.prompt) ? params.prompt : [];
      const first = prompt[0];
      const text =
        isRecord(first) && typeof first.text === "string" ? first.text : "";
      void runResumePrompt(message.id as number, text);
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
