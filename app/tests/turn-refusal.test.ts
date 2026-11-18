import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  parseRequestLine,
  parseSidecarLine,
  type SidecarLine,
  type TurnMessage,
  type TurnTransport,
} from "../src/turn/protocol";
import {
  REFUSAL_MAX_BODY_BYTES,
  REFUSAL_MAX_CHARS,
  capRefusalSentence,
  classifyRefusalBody,
  refusalMessage,
  refusalSentence,
} from "../src/turn/refusal";
import { askTurn } from "../src/turn/turn";

/**
 * STORY 15.16 — A REFUSAL IS THE PROVIDER'S SENTENCE.
 *
 * The real sidecar is driven over its real pipe against a loopback stub. The
 * stub answers the shapes this story exists for: the OpenCode-shaped 400 that
 * started it, an HTML 500, a plain-text 429, a body echoing the KEY, a huge
 * body, a 401 and a 200. The sentences are asserted EXACTLY, because the
 * sentence is the point of the story.
 *
 * No network, no real key, no account. The child's working directory is a temp
 * folder, so this file writes nothing into the repository.
 */

const APP_DIR = join(import.meta.dir, "..");
const MAIN = join(APP_DIR, "sidecar", "main.ts");
const BUN = process.execPath;
const KEY = "sk-story-16-secret-key";
const PROVIDER = { baseUrl: "", model: "stub-model", apiKey: KEY };

type Mode =
  | "opencode-400"
  | "html-500"
  | "text-429"
  | "key-400"
  | "huge-500"
  | "unauthorized-401"
  | "ok-200"
  | "hung-400";

let mode: Mode = "opencode-400";

const OPENCODE_BODY = JSON.stringify({
  type: "error",
  error: {
    type: "MissingSessionID",
    message:
      "Request is missing x-opencode-session: this gateway needs a session id to route the request",
  },
});

const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    await request.json();
    if (mode === "opencode-400") {
      return new Response(OPENCODE_BODY, {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    if (mode === "html-500") {
      return new Response(
        "<!doctype html><html><body><h1>Internal Server Error</h1></body></html>",
        { status: 500, headers: { "content-type": "text/html" } },
      );
    }
    if (mode === "text-429") {
      return new Response(
        "too many requests; wait a moment\nRetry-After: 10",
        { status: 429, headers: { "content-type": "text/plain" } },
      );
    }
    if (mode === "key-400") {
      return new Response(
        JSON.stringify({
          error: { message: "the key " + KEY + " was rejected" },
        }),
        { status: 400, headers: { "content-type": "application/json" } },
      );
    }
    if (mode === "huge-500") {
      return new Response("the provider said " + "x".repeat(300_000), {
        status: 500,
        headers: { "content-type": "text/plain" },
      });
    }
    if (mode === "unauthorized-401") {
      return new Response(
        JSON.stringify({ error: { message: "invalid api key" } }),
        { status: 401, headers: { "content-type": "application/json" } },
      );
    }
    if (mode === "hung-400") {
      // Headers now, body never: the turn's own timeout must end the wait.
      return new Response(new ReadableStream<Uint8Array>({}), {
        status: 400,
        headers: { "content-type": "application/json" },
      });
    }
    return Response.json({
      choices: [{ message: { role: "assistant", content: "one whole answer" } }],
    });
  },
});

PROVIDER.baseUrl = `http://127.0.0.1:${stub.port}/v1`;

/* A reader for one child's stdout: buffered lines with a bounded wait. */
class Lines {
  private buffer = "";
  private ready: string[] = [];
  private waiting: (() => void)[] = [];
  private closed = false;
  private handlers: ((line: string) => void)[] = [];

  constructor(stream: ReadableStream<Uint8Array>) {
    const decoder = new TextDecoder();
    void (async () => {
      for await (const chunk of stream) {
        this.buffer += decoder.decode(chunk, { stream: true });
        let newline = this.buffer.indexOf("\n");
        while (newline >= 0) {
          const line = this.buffer.slice(0, newline);
          this.buffer = this.buffer.slice(newline + 1);
          this.ready.push(line);
          for (const handler of this.handlers) handler(line);
          this.waiting.shift()?.();
          newline = this.buffer.indexOf("\n");
        }
      }
      this.closed = true;
      while (this.waiting.length > 0) this.waiting.shift()?.();
    })();
  }

  onLine(handler: (line: string) => void): void {
    this.handlers.push(handler);
  }

  async next(budgetMs = 4_000): Promise<string> {
    const deadline = Date.now() + budgetMs;
    while (this.ready.length === 0) {
      if (this.closed) throw new Error("the sidecar closed before answering");
      if (Date.now() >= deadline) {
        throw new Error("timed out waiting for a sidecar line");
      }
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        setTimeout(resolve, 10);
      });
    }
    return this.ready.shift() as string;
  }
}

/** The real pipe as a TurnTransport. */
function transportOf(
  child: ReturnType<typeof Bun.spawn>,
  lines: Lines,
): TurnTransport {
  const waiting = new Map<number, (line: SidecarLine) => void>();
  lines.onLine((raw) => {
    const line = parseSidecarLine(raw);
    if (line === null || line.kind === "hello") return;
    waiting.get(line.id)?.(line);
  });
  return {
    async send(line) {
      child.stdin.write(line + "\n");
      await child.stdin.flush();
    },
    subscribe(id, handler) {
      waiting.set(id, handler);
      return () => {
        if (waiting.get(id) === handler) waiting.delete(id);
      };
    },
  };
}

let child: ReturnType<typeof Bun.spawn>;
let lines: Lines;
let transport: TurnTransport;

beforeAll(() => {
  child = Bun.spawn([BUN, MAIN], {
    cwd: join(import.meta.dir, "..", ".."),
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  lines = new Lines(child.stdout as ReadableStream<Uint8Array>);
  transport = transportOf(child, lines);
});

afterAll(() => {
  child.kill();
  stub.stop(true);
});

async function refusal(modeWanted: Mode): Promise<string> {
  mode = modeWanted;
  const result = await askTurn(transport, PROVIDER, "say something", {
    timeoutMs: 5_000,
  });
  if (result.kind !== "error") {
    throw new Error("expected an error, got " + JSON.stringify(result));
  }
  return result.sentence;
}

describe("a non-2xx answer keeps the provider's own sentence", () => {
  test("the OpenCode-shaped 400 names the missing session, beside the status", async () => {
    expect(await refusal("opencode-400")).toBe(
      "the provider answered 400: Request is missing x-opencode-session: this gateway needs a session id to route the request",
    );
  });

  test("an HTML 500 says the status and that the body was not text", async () => {
    const sentence = await refusal("html-500");
    expect(sentence).toBe("the provider answered 500: the body was not text");
    expect(sentence).not.toContain("<");
  });

  test("a plain-text 429 keeps the FIRST line, never the whole body", async () => {
    expect(await refusal("text-429")).toBe(
      "the provider answered 429: too many requests; wait a moment",
    );
  });

  test("a body that echoes the key is scrubbed before the sentence exists", async () => {
    const sentence = await refusal("key-400");
    expect(sentence).toBe(
      "the provider answered 400: the key [the key] was rejected",
    );
    expect(sentence).not.toContain(KEY);
  });

  test("a huge body is cut to one bounded sentence with an ellipsis", async () => {
    const sentence = await refusal("huge-500");
    expect(sentence.length).toBeLessThanOrEqual(REFUSAL_MAX_CHARS);
    expect(sentence.endsWith("\u2026")).toBe(true);
    expect(sentence.startsWith("the provider answered 500: the provider said x")).toBe(true);
  });

  test("a 401 still says the key was refused, not the provider's login page", async () => {
    expect(await refusal("unauthorized-401")).toBe(
      "the provider answered 401: the key was refused",
    );
  });

  test("a 200 is untouched: one answer, no sentence machinery", async () => {
    mode = "ok-200";
    const result = await askTurn(transport, PROVIDER, "say something", {
      timeoutMs: 5_000,
    });
    expect(result).toEqual({ kind: "answer", text: "one whole answer" });
  });

  test("a hung refusal body does not hold the turn past its timeout", async () => {
    mode = "hung-400";
    const started = Date.now();
    const result = await askTurn(transport, PROVIDER, "say something", {
      timeoutMs: 400,
    });
    expect(result.kind).toBe("timeout");
    expect(Date.now() - started).toBeLessThan(3_000);
  });
});

describe("the extraction rules are one pure module", () => {
  test("error.message wins over message wins over a flattened error string", () => {
    expect(
      refusalMessage(
        JSON.stringify({
          error: { message: "the detailed one" },
          message: "the general one",
        }),
      ),
    ).toBe("the detailed one");
    expect(
      refusalMessage(
        JSON.stringify({ message: "the top one", error: "the flat one" }),
      ),
    ).toBe("the top one");
    expect(refusalMessage(JSON.stringify({ error: "the flat one" }))).toBe(
      "the flat one",
    );
  });

  test("a JSON body with no message is not quoted at the person", () => {
    expect(refusalMessage('{"type":"error","code":17}')).toBeNull();
    expect(refusalMessage('{"error":{"type":"MissingSessionID"}}')).toBeNull();
  });

  test("prose keeps its first non-empty line, collapsed onto one line", () => {
    expect(refusalMessage("\n  too   many\nrequests  ")).toBe("too many");
  });

  test("HTML and control bytes are not text; an empty body is empty", () => {
    const encoder = new TextEncoder();
    expect(
      classifyRefusalBody(encoder.encode("<html><body>no</body></html>"), "text/html"),
    ).toEqual({ kind: "not-text" });
    expect(
      classifyRefusalBody(new Uint8Array([0x00, 0x01, 0xff]), null),
    ).toEqual({ kind: "not-text" });
    expect(classifyRefusalBody(encoder.encode("   "), null)).toEqual({
      kind: "empty",
    });
    expect(classifyRefusalBody(encoder.encode("plain words"), null)).toEqual({
      kind: "text",
      text: "plain words",
    });
  });

  test("the cap is stated, keeps the status, and ends in one ellipsis", () => {
    const capped = capRefusalSentence("x".repeat(500));
    expect(capped.length).toBe(REFUSAL_MAX_CHARS);
    expect(capped.endsWith("\u2026")).toBe(true);
    const sentence = refusalSentence(
      400,
      "Bad Request",
      { kind: "text", text: "hi" },
      "x".repeat(500),
    );
    expect(sentence.startsWith("the provider answered 400: ")).toBe(true);
    expect(sentence.length).toBe(REFUSAL_MAX_CHARS);
  });

  test("the body cap is a stated number of bytes", () => {
    expect(REFUSAL_MAX_BODY_BYTES).toBe(64 * 1024);
  });
});
