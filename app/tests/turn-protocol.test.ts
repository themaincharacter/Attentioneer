import { describe, expect, test } from "bun:test";
import {
  cancelledLine,
  doneLine,
  errorLine,
  helloLine,
  parseRequestLine,
  parseSidecarLine,
  partLine,
  requestIdOf,
  requestLine,
  scrubSecret,
  stopLine,
  WIRE_VERSION,
  type SidecarLine,
} from "../src/turn/protocol";
import { providerFrom } from "../src/turn/providers";
import {
  askTurn,
  buildTurnMessages,
  errorSentence,
  SYSTEM_MESSAGE,
  TURN_SENTENCES,
  turnSentence,
  type TurnResult,
  type TurnTransport,
} from "../src/turn/turn";

/**
 * Story 15.1 — the turn's frontend half: the wire's strict readers and
 * builders, the one turn's rules, and the sentences it shows when the answer
 * is not an answer.
 *
 * The story's check is human ("ask 'what is 2+2', read the answer, quit: no
 * answer kept, the card unchanged, no sidecar left"). This file pins what can
 * be pinned without a provider: a malformed line is refused rather than
 * guessed, the request carries TWO messages and nothing from the map, a
 * timeout stops the turn at the source, and an error sentence never carries a
 * key. The process itself is driven for real in `turn-first.test.ts`.
 */

const PROVIDER = {
  baseUrl: "http://127.0.0.1:9/v1",
  model: "test-model",
  apiKey: "sk-test-secret-value",
};

describe("the wire's readers", () => {
  test("read the four line kinds story 1 uses", () => {
    expect(parseSidecarLine(helloLine())).toEqual({
      kind: "hello",
      version: WIRE_VERSION,
    });
    expect(parseSidecarLine(partLine(3, "four"))).toEqual({
      id: 3,
      kind: "part",
      part: "text",
      text: "four",
    });
    expect(parseSidecarLine(doneLine(3))).toEqual({ id: 3, kind: "done" });
    expect(parseSidecarLine(cancelledLine(3))).toEqual({
      id: 3,
      kind: "cancelled",
    });
    expect(parseSidecarLine(errorLine(3, "the provider answered 401"))).toEqual({
      id: 3,
      kind: "error",
      message: "the provider answered 401",
    });
  });

  test("refuse anything that is not exactly this wire", () => {
    // Bad JSON, no id, an id that is not a positive integer, an unknown kind,
    // a part that is not text: all `null`, never a guess and never a throw.
    for (const line of [
      "",
      "not json",
      "[]",
      JSON.stringify({ kind: "hello" }),
      JSON.stringify({ kind: "part", part: "text", text: "x" }),
      JSON.stringify({ id: 0, kind: "done" }),
      JSON.stringify({ id: 1.5, kind: "done" }),
      JSON.stringify({ id: 1, kind: "part", part: "usage", text: "x" }),
      JSON.stringify({ id: 1, kind: "part", part: "text", text: 7 }),
      JSON.stringify({ id: 1, kind: "mystery" }),
      JSON.stringify({ id: 1, kind: "error" }),
    ]) {
      expect(parseSidecarLine(line)).toBeNull();
    }
  });

  test("read a turn request, and refuse a malformed one", () => {
    const line = requestLine(7, PROVIDER, buildTurnMessages("what is 2+2"));
    expect(parseRequestLine(line)).toEqual({
      id: 7,
      kind: "turn",
      provider: PROVIDER,
      messages: buildTurnMessages("what is 2+2"),
    });
    expect(parseRequestLine(stopLine(7))).toEqual({ id: 7, kind: "stop" });

    for (const raw of [
      JSON.stringify({ id: 7, kind: "turn" }),
      JSON.stringify({ id: 7, kind: "turn", provider: { baseUrl: "", model: "m", apiKey: "k" }, messages: [] }),
      JSON.stringify({ id: 7, kind: "turn", provider: PROVIDER, messages: [{ role: "assistant", content: "x" }] }),
      JSON.stringify({ id: 7, kind: "turn", provider: { baseUrl: "b", model: "m" }, messages: [{ role: "user", content: "x" }] }),
      JSON.stringify({ id: 7, kind: "turn", provider: PROVIDER, messages: [{ role: "user", content: 7 }] }),
    ]) {
      expect(parseRequestLine(raw)).toBeNull();
    }
  });

  test("find an id to answer even in a malformed request", () => {
    expect(requestIdOf(JSON.stringify({ id: 4, kind: "turn" }))).toBe(4);
    expect(requestIdOf(JSON.stringify({ id: "4" }))).toBeNull();
    expect(requestIdOf("not json")).toBeNull();
  });
});

describe("the wire's builders", () => {
  test("write exactly one line each, newlines escaped", () => {
    const lines = [
      helloLine(),
      requestLine(1, PROVIDER, [{ role: "user", content: "two\nlines" }]),
      stopLine(1),
      partLine(1, "a\nb"),
      doneLine(1),
      errorLine(1, "one line"),
      cancelledLine(1),
    ];
    for (const line of lines) {
      expect(line.includes("\n")).toBe(false);
      expect(line.includes("\r")).toBe(false);
      expect(() => JSON.parse(line)).not.toThrow();
    }
    // A multi-line answer survives the framing as ONE line.
    expect(JSON.parse(partLine(1, "a\nb")).text).toBe("a\nb");
  });
});

describe("sentences and secrets", () => {
  test("the key never survives scrubbing", () => {
    const said = scrubSecret(`provider said ${PROVIDER.apiKey} is wrong`, PROVIDER.apiKey);
    expect(said).not.toContain(PROVIDER.apiKey);
    expect(said).toContain("[the key]");
    expect(scrubSecret("key", "")).toBe("key");
    expect(scrubSecret("a\n\nb  c", "x")).toBe("a b c");
  });

  test("an error line becomes one sentence, never an empty one", () => {
    expect(errorSentence("the provider answered 401 Unauthorized")).toBe(
      "the provider answered 401 Unauthorized",
    );
    expect(errorSentence("  two\nlines  ")).toBe("two lines");
    expect(errorSentence("")).toBe("the turn failed without a reason");
  });

  test("a result maps to the one thing the panel shows", () => {
    expect(turnSentence({ kind: "answer", text: "4" })).toBe("4");
    expect(turnSentence({ kind: "cancelled", sentence: TURN_SENTENCES.cancelled })).toBe(
      TURN_SENTENCES.cancelled,
    );
    expect(turnSentence({ kind: "timeout", sentence: TURN_SENTENCES.timeout })).toBe(
      TURN_SENTENCES.timeout,
    );
    expect(turnSentence({ kind: "error", sentence: "one line" })).toBe("one line");
  });

  test("the wire's provider is exactly baseUrl, model and key, trimmed", () => {
    const provider = providerFrom(
      { id: "local", name: "Local llama", baseUrl: "  http://host/v1 ", models: [] },
      { id: " m ", name: "M", capabilities: { tools: false, vision: false } },
      "k",
    );
    expect(provider).toEqual({
      baseUrl: "http://host/v1",
      model: "m",
      apiKey: "k",
    });
    // ONLY the three fields 15.1's sidecar has always read: the row's name and
    // id never ride on the wire.
    expect(Object.keys(provider).sort()).toEqual(["apiKey", "baseUrl", "model"]);
  });
});

describe("the two messages", () => {
  test("a fixed instruction plus the person's words, and nothing else", () => {
    const messages = buildTurnMessages("  what is 2+2  ");
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ role: "system", content: SYSTEM_MESSAGE });
    expect(messages[1]).toEqual({ role: "user", content: "what is 2+2" });
    // The instruction says out loud that no map content came along.
    expect(SYSTEM_MESSAGE).toContain("No map content");
  });
});

/* ------------------------------------------------------------------ *
 * The one turn over a scripted transport (the process is tested for real
 * in turn-first.test.ts).
 * ------------------------------------------------------------------ */

interface Scripted {
  sent: string[];
  /** On a `turn` line, which lines the "sidecar" writes back, after 0 ms. */
  script: (request: { id: number }) => SidecarLine[];
  /** The transport the turn is handed. */
  transport: TurnTransport;
}

function scripted(script: (request: { id: number }) => SidecarLine[]): Scripted {
  const sent: string[] = [];
  const handlers = new Map<number, (line: SidecarLine) => void>();
  const transport: TurnTransport = {
    async send(line) {
      sent.push(line);
      const parsed = parseRequestLine(line);
      if (parsed === null) return;
      if (parsed.kind === "stop") {
        handlers.get(parsed.id)?.({
          id: parsed.id,
          kind: "cancelled",
        });
        return;
      }
      setTimeout(() => {
        for (const answer of script(parsed)) handlers.get(parsed.id)?.(answer);
      }, 0);
    },
    subscribe(id, handler) {
      handlers.set(id, handler);
      return () => handlers.delete(id);
    },
  };
  return { sent, script, transport };
}

describe("one turn", () => {
  test("awaits the single text part and answers it", async () => {
    const run = scripted((request) => [
      { id: request.id, kind: "part", part: "text", text: "4" },
      { id: request.id, kind: "done" },
    ]);
    const result = await askTurn(run.transport, PROVIDER, "what is 2+2");
    expect(result).toEqual({ kind: "answer", text: "4" });

    // Exactly one request line left, and it carries two messages and the key.
    const parsed = parseRequestLine(run.sent[0]!);
    expect(parsed?.kind).toBe("turn");
    if (parsed?.kind !== "turn") throw new Error("expected a turn");
    expect(parsed.messages).toHaveLength(2);
    expect(parsed.provider.apiKey).toBe(PROVIDER.apiKey);
    expect(parsed.messages[1]?.content).toBe("what is 2+2");
  });

  test("an error line is one sentence, and the key is not in it", async () => {
    const run = scripted((request) => [
      {
        id: request.id,
        kind: "error",
        message: scrubSecret(`the provider rejected ${PROVIDER.apiKey}`, PROVIDER.apiKey),
      },
    ]);
    const result = await askTurn(run.transport, PROVIDER, "what is 2+2");
    expect(result.kind).toBe("error");
    expect(turnSentence(result)).not.toContain(PROVIDER.apiKey);
  });

  test("done with no text is one sentence, not an empty answer", async () => {
    const run = scripted((request) => [{ id: request.id, kind: "done" }]);
    const result = await askTurn(run.transport, PROVIDER, "what is 2+2");
    expect(result).toEqual({
      kind: "error",
      sentence: TURN_SENTENCES.unanswered,
    });
  });

  test("a timeout stops the turn at the source", async () => {
    const run = scripted(() => []);
    const result = await askTurn(run.transport, PROVIDER, "what is 2+2", {
      timeoutMs: 15,
    });
    expect(result).toEqual({
      kind: "timeout",
      sentence: TURN_SENTENCES.timeout,
    });
    // The stop line followed the request, for the same id.
    const request = parseRequestLine(run.sent[0]!);
    const stop = parseRequestLine(run.sent[1]!);
    expect(request?.kind).toBe("turn");
    expect(stop).toEqual({ id: request?.id, kind: "stop" });
  });

  test("a stop settles the turn as cancelled", async () => {
    let handlers: ((line: SidecarLine) => void) | null = null;
    const sent: string[] = [];
    const transport: TurnTransport = {
      async send(line) {
        sent.push(line);
      },
      subscribe(_id, handler) {
        handlers = handler;
        return () => {
          handlers = null;
        };
      },
    };
    const pending = askTurn(transport, PROVIDER, "slow question", {
      timeoutMs: 5_000,
    });
    // Let the request leave, then answer the cancel like the sidecar does.
    await Bun.sleep(1);
    handlers?.({ id: 1, kind: "cancelled" });
    const result: TurnResult = await pending;
    expect(result).toEqual({
      kind: "cancelled",
      sentence: TURN_SENTENCES.cancelled,
    });
    expect(parseRequestLine(sent[0]!)?.kind).toBe("turn");
  });

  test("a transport that cannot send is one sentence, not a hang", async () => {
    const transport: TurnTransport = {
      async send() {
        throw new Error("the turn sidecar is not running");
      },
      subscribe() {
        return () => {};
      },
    };
    const result = await askTurn(transport, PROVIDER, "what is 2+2");
    expect(result).toEqual({
      kind: "error",
      sentence: TURN_SENTENCES.unreachable,
    });
  });
});
