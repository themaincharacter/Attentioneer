import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AcpFailure,
  AcpFrameReader,
  encodeAcpFrame,
  parseAcpMessage,
  startAcp,
  type AcpFraming,
  type AcpNotificationMessage,
  type AcpServerRequest,
  type AcpTransport,
} from "../src/turn/acp";

/**
 * Story 18.1 — THE ACP TRANSPORT, PROVEN AGAINST A FAKE SERVER.
 *
 * The fake (\`tests/fixtures/acp-fake-server.ts\`) is a real child process on a
 * real pipe, but its framing reader is written independently of the transport's,
 * so agreement is evidence rather than a shared bug. These proofs are the
 * story's safety net before the real \`dsh --profile acp\` run in
 * \`notes/acp-spike.md\`:
 *
 *   - the handshake names protocol 1 and a session comes back;
 *   - updates arrive in order and a refusal is the option id actually sent;
 *   - a cancel settles a prompt as \`cancelled\`;
 *   - a malformed line is reported AND the conversation continues;
 *   - a server that dies mid-turn rejects the prompt and keeps what arrived;
 *   - \`close\` kills the child and later requests refuse with one sentence;
 *   - the other framing (Content-Length) speaks too.
 *
 * No network, no account, no key. Every child runs in a temp directory that is
 * removed after the test.
 */

const BUN = process.execPath;
const FAKE = join(import.meta.dir, "fixtures", "acp-fake-server.ts");

interface Events {
  notifications: AcpNotificationMessage[];
  requests: AcpServerRequest[];
  problems: string[];
  stderr: string[];
  wire: { direction: "in" | "out"; payload: string }[];
}

const live: AcpTransport[] = [];
const dirs: string[] = [];

function workspace(): string {
  const dir = mkdtempSync(join(tmpdir(), "acp-test-"));
  dirs.push(dir);
  return dir;
}

async function fake(
  mode = "normal",
  framing: AcpFraming = "ndjson",
): Promise<{ transport: AcpTransport; dir: string; events: Events }> {
  const dir = workspace();
  const events: Events = {
    notifications: [],
    requests: [],
    problems: [],
    stderr: [],
    wire: [],
  };
  const started = startAcp({
    command: BUN,
    args: [FAKE, mode, "--framing", framing],
    cwd: dir,
    framing,
    requestTimeoutMs: 5_000,
    onNotification: (notification) => events.notifications.push(notification),
    onRequest: (request) => events.requests.push(request),
    onProblem: (sentence) => events.problems.push(sentence),
    onStderr: (line) => events.stderr.push(line),
    onWire: (direction, payload) => events.wire.push({ direction, payload }),
  });
  if (started.kind === "refused") throw new Error(started.sentence);
  live.push(started.transport);
  return { transport: started.transport, dir, events };
}

async function waitFor(check: () => boolean, budgetMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > budgetMs) throw new Error("timed out waiting for the fake server");
    await Bun.sleep(5);
  }
}

/** The text chunks the fake wrote, in the order the transport relayed them. */
function texts(events: Events): string[] {
  return events.notifications.map((notification) => {
    const update = (notification.params as { update?: { content?: { text?: unknown } } } | undefined)?.update;
    const text = update?.content?.text;
    return typeof text === "string" ? text : "";
  });
}

afterEach(async () => {
  for (const transport of live.splice(0)) await transport.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("the frame reader", () => {
  test("joins a frame split at every boundary, in both framings", () => {
    const payload = JSON.stringify({ jsonrpc: "2.0", id: 1, result: { text: "one line" } });
    for (const framing of ["ndjson", "content-length"] as const) {
      const reader = new AcpFrameReader(framing);
      const bytes = new TextEncoder().encode(encodeAcpFrame(framing, payload));
      const frames: string[] = [];
      // Three-byte slices guarantee splits inside the header and the JSON.
      for (let at = 0; at < bytes.byteLength; at += 3) {
        frames.push(...reader.push(bytes.subarray(at, at + 3)).frames);
      }
      expect(frames).toEqual([payload]);
      expect(reader.push(new Uint8Array(0)).problems).toEqual([]);
    }
  });

  test("frames a malformed line without swallowing the next one", () => {
    const reader = new AcpFrameReader("ndjson");
    const batch = reader.push(new TextEncoder().encode("not json\n{\"jsonrpc\":\"2.0\"}\n"));
    expect(batch.frames).toEqual(["not json", '{"jsonrpc":"2.0"}']);
    expect(batch.problems).toEqual([]);
    // The READER frames; the TRANSPORT is what calls a bad frame a problem.
    expect(parseAcpMessage(batch.frames[0])).toBeNull();
    expect(parseAcpMessage(batch.frames[1])).toBeNull();
  });

  test("reports a header with no length", () => {
    const reader = new AcpFrameReader("content-length");
    const batch = reader.push(new TextEncoder().encode("X-Nope: 1\r\n\r\n{}"));
    expect(batch.frames).toEqual([]);
    expect(batch.problems).toEqual(["the server's frame header carried no length"]);
  });
});

describe("the handshake", () => {
  test("names protocol 1, an implementation and no auth requirement", async () => {
    const { transport, dir } = await fake();
    const initialized = await transport.initialize("attentioneer-test", "0.0.1");
    expect(initialized.protocolVersion).toBe(1);
    expect(initialized.agentInfo?.name).toBe("fake-acp");
    expect(initialized.authMethods).toEqual([]);

    const session = await transport.newSession(dir);
    expect(session.sessionId).toBe("fake-session");
  });

  test("speaks the Content-Length framing too", async () => {
    const { transport, dir } = await fake("normal", "content-length");
    const initialized = await transport.initialize();
    expect(initialized.protocolVersion).toBe(1);
    const session = await transport.newSession(dir);
    expect(session.sessionId).toBe("fake-session");
  });
});

describe("the prompt turn", () => {
  test("relays ordered updates and sends the refusal option id", async () => {
    const { transport, dir, events } = await fake();
    await transport.initialize();
    await transport.newSession(dir);

    const turn = transport.prompt("fake-session", "say one");
    await waitFor(() => events.requests.length === 1);
    const request = events.requests[0];
    expect(request.method).toBe("session/request_permission");

    const params = request.params as {
      toolCall?: { title?: unknown; kind?: unknown };
      options?: { optionId: string; kind: string }[];
    };
    expect(params.toolCall?.title).toBe("Read the working directory");
    expect(params.options?.map((option) => option.kind)).toEqual(["allow_once", "reject_once"]);

    await transport.respondToPermission(request.id, "reject-once");
    const result = await turn;
    expect(result.stopReason).toBe("end_turn");
    expect(texts(events)).toEqual(["one ", "refused ", "two"]);

    // The wire record is what the note's raw JSON is built from.
    expect(events.wire.some((frame) => frame.direction === "out" && frame.payload.includes('"initialize"'))).toBe(true);
    expect(events.wire.some((frame) => frame.direction === "in" && frame.payload.includes('"agent_message_chunk"'))).toBe(true);
  });

  test("cancel settles the second prompt as cancelled", async () => {
    const { transport, dir, events } = await fake();
    await transport.initialize();
    await transport.newSession(dir);

    const first = transport.prompt("fake-session", "first");
    await waitFor(() => events.requests.length === 1);
    await transport.respondToPermission(events.requests[0].id, "reject-once");
    expect((await first).stopReason).toBe("end_turn");

    const second = transport.prompt("fake-session", "second");
    await waitFor(() => texts(events).includes("working "));
    transport.cancel("fake-session");
    expect((await second).stopReason).toBe("cancelled");
  });
});

describe("a broken server", () => {
  test("a malformed line is reported and the conversation continues", async () => {
    const { transport, dir, events } = await fake("malformed");
    const initialized = await transport.initialize();
    expect(initialized.protocolVersion).toBe(1);
    expect(events.problems).toContain("the server wrote a line that is not JSON-RPC");
    const session = await transport.newSession(dir);
    expect(session.sessionId).toBe("fake-session");
  });

  test("dying mid-turn rejects the prompt and keeps what had arrived", async () => {
    const { transport, dir, events } = await fake("die-mid-turn");
    await transport.initialize();
    await transport.newSession(dir);

    let failure: unknown = null;
    try {
      await transport.prompt("fake-session", "die");
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AcpFailure);
    expect((failure as Error).message).toBe("the server exited (code 3)");
    await waitFor(() => texts(events).includes("one "));
    expect((await transport.newSession(dir).catch((error) => error))).toBeInstanceOf(AcpFailure);
  });
});

describe("closing", () => {
  test("kills the child and refuses later requests with one sentence", async () => {
    const { transport, dir } = await fake();
    await transport.initialize();
    await transport.newSession(dir);
    await transport.close();
    expect(transport.closedForBusiness).toBe(true);

    let failure: unknown = null;
    try {
      await transport.newSession(dir);
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(AcpFailure);
    expect((failure as Error).message).toBe("the transport is closed");
  });
});
