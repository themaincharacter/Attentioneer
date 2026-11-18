import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseRequestLine,
  parseSidecarLine,
  type SidecarLine,
  type TurnMessage,
  type TurnTransport,
} from "../src/turn/protocol";
import {
  ONE_READING,
  ONE_STEP,
  STEP_LIMIT_SENTENCE,
  turnSteps,
} from "../src/turn/steps";
import { askTurn, askTurnPacket, stopTurn } from "../src/turn/turn";
import { assembleAskPacket, type AskPacketInput } from "../src/turn/packet";

/**
 * Story 15.7 — STREAMING, STOP, AND THE STEP BUDGET.
 *
 * Two proofs live here, and they are different in kind:
 *
 *   - The PURE half: the ceiling comes from one function, per route, as data;
 *     the sentence it says when it bites is words, not a count; a second READ
 *     asks the ceiling and does not fetch.
 *   - The REAL half: the actual `app/sidecar/main.ts` process is driven over
 *     its actual stdio with a LOCAL stub SSE server pretending to be the
 *     provider. It pins ordered parts then done, the one-part fallback for a
 *     provider that ignores `stream:true`, a malformed event that is skipped
 *     rather than fatal, a mid-stream error that keeps what arrived, and a stop
 *     mid-stream that answers `cancelled` with the partial text and nothing
 *     after it.
 *
 * No network, no key and no account: the stub is loopback. The child's working
 * directory is a temp folder, snapshotted before and after, so the map-write
 * ban is checked here too.
 */

const APP_DIR = join(import.meta.dir, "..");
const MAIN = join(APP_DIR, "sidecar", "main.ts");
const BUN = process.execPath;
const KEY = "sk-story-7-secret-key";
const PROVIDER = { baseUrl: "", model: "stub-model", apiKey: KEY };

interface RequestBody {
  model?: unknown;
  messages?: TurnMessage[];
  stream?: unknown;
}

type Mode = "stream" | "json" | "malformed" | "mid-error" | "slow";

let mode: Mode = "stream";
let requests = 0;
let lastRequest: { url: string; stream?: unknown; body: RequestBody } | null =
  null;

function delta(text: string): string {
  return "data: " + JSON.stringify({ choices: [{ delta: { content: text } }] }) + "\n\n";
}

/**
 * A real SSE response. The slow mode is what makes cancel observable: the
 * second delta waits long enough for a person (or a test) to press stop after
 * the first one arrived.
 */
function sse(events: readonly string[], delayMs = 0): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const event of events) {
          controller.enqueue(encoder.encode(event));
          if (delayMs > 0) await Bun.sleep(delayMs);
        }
        controller.close();
      } catch {
        // The client stopped reading (a cancelled turn): nothing to close.
      }
    },
  });
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    requests += 1;
    const body = (await request.json()) as RequestBody;
    lastRequest = { url: request.url, stream: body.stream, body };
    if (mode === "json") {
      return Response.json({
        choices: [{ message: { role: "assistant", content: "one whole answer" } }],
      });
    }
    if (mode === "malformed") {
      return sse([
        delta("the "),
        "data: {this is not json\n\n",
        delta("answer"),
        "data: [DONE]\n\n",
      ]);
    }
    if (mode === "mid-error") {
      return sse([
        delta("the "),
        'data: {"error":{"message":"the provider broke mid-answer"}}\n\n',
      ]);
    }
    if (mode === "slow") {
      // "the " now, "answer" after enough time for a stop to land between.
      return sse([delta("the "), delta("answer")], 1_500);
    }
    return sse([
      delta("the "),
      delta("answer"),
      delta(" is "),
      delta("4"),
      "data: [DONE]\n\n",
    ]);
  },
});

PROVIDER.baseUrl = `http://127.0.0.1:${stub.port}/v1`;

/* ------------------------------------------------------------------ *
 * A reader for one child's stdout: buffered lines with a bounded wait.
 * ------------------------------------------------------------------ */

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

/** The real pipe as a TurnTransport: write a line, dispatch lines by id. */
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

/* ------------------------------------------------------------------ *
 * A workspace-shaped folder, snapshotted byte for byte.
 * ------------------------------------------------------------------ */

function snapshot(
  dir: string,
  base = dir,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = full.slice(base.length + 1);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out[rel + "/"] = "";
      snapshot(full, base, out);
    } else {
      out[rel] = `${stats.size}:${readFileSync(full).toString("base64")}`;
    }
  }
  return out;
}

const workspace = mkdtempSync(join(tmpdir(), "attentioneer-turn-stream-"));
mkdirSync(join(workspace, "notes"), { recursive: true });
writeFileSync(join(workspace, "workspace.yml"), "format: attentioneer-workspace/1\n");
writeFileSync(join(workspace, "notes", "garden.md"), "a map the turn must not touch\n");
const workspaceBefore = snapshot(workspace);

let child: ReturnType<typeof Bun.spawn>;
let lines: Lines;

beforeAll(() => {
  child = Bun.spawn([BUN, MAIN], {
    cwd: workspace,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  lines = new Lines(child.stdout as ReadableStream<Uint8Array>);
});

afterAll(() => {
  child.kill();
  stub.stop(true);
  rmSync(workspace, { recursive: true, force: true });
});

describe("the sidecar's first breath", () => {
  test("it says hello before anything is asked", async () => {
    expect(parseSidecarLine(await lines.next())).toEqual({
      kind: "hello",
      version: 1,
    });
  });
});

describe("streaming is real and ordered", () => {
  test("it asks for a stream, and parts arrive in order before done", async () => {
    mode = "stream";
    const transport = transportOf(child, lines);
    const seen: string[] = [];
    const result = await askTurn(transport, PROVIDER, "what is 2+2", {
      timeoutMs: 5_000,
      onPart: (text) => seen.push(text),
    });
    expect(result).toEqual({ kind: "answer", text: "the answer is 4" });
    // Each callback is the accumulation so far, not a delta: the ask card can
    // render it directly.
    expect(seen).toEqual([
      "the ",
      "the answer",
      "the answer is ",
      "the answer is 4",
    ]);
    expect(lastRequest?.stream).toBe(true);
    expect(lastRequest?.url).toBe(`${PROVIDER.baseUrl}/chat/completions`);
  });

  test("a provider that ignores stream:true still answers ONE part", async () => {
    mode = "json";
    const transport = transportOf(child, lines);
    const seen: string[] = [];
    const result = await askTurn(transport, PROVIDER, "what is 2+2", {
      timeoutMs: 5_000,
      onPart: (text) => seen.push(text),
    });
    expect(result).toEqual({ kind: "answer", text: "one whole answer" });
    expect(seen).toEqual(["one whole answer"]);
  });

  test("a malformed SSE event is skipped, never fatal", async () => {
    mode = "malformed";
    const transport = transportOf(child, lines);
    const result = await askTurn(transport, PROVIDER, "what is 2+2", {
      timeoutMs: 5_000,
    });
    expect(result).toEqual({ kind: "answer", text: "the answer" });
  });

  test("a mid-stream error keeps what arrived and says one sentence", async () => {
    mode = "mid-error";
    const transport = transportOf(child, lines);
    const result = await askTurn(transport, PROVIDER, "what is 2+2", {
      timeoutMs: 5_000,
    });
    expect(result).toEqual({
      kind: "error",
      sentence: "the provider broke mid-answer",
      partial: "the ",
    });
  });

  test("stop mid-stream answers cancelled with the partial, and nothing after", async () => {
    mode = "slow";
    const transport = transportOf(child, lines);
    let runningId = 0;
    const seen: string[] = [];
    let firstPart: () => void = () => {};
    const arrived = new Promise<void>((resolve) => {
      firstPart = resolve;
    });
    const pending = askTurn(transport, PROVIDER, "what is 2+2", {
      timeoutMs: 10_000,
      onStart: (id) => {
        runningId = id;
      },
      onPart: (text) => {
        seen.push(text);
        if (seen.length === 1) firstPart();
      },
    });
    await arrived;
    expect(seen).toEqual(["the "]);
    await stopTurn(transport, runningId);
    expect(await pending).toEqual({
      kind: "cancelled",
      sentence: "the turn was stopped",
      partial: "the ",
    });
    // The second delta was still in flight server-side; the turn must not
    // receive it after being stopped.
    await Bun.sleep(200);
    expect(seen).toEqual(["the "]);

    // And the child is still usable: a later, complete stream works.
    mode = "stream";
    const second = await askTurn(transport, PROVIDER, "again", {
      timeoutMs: 5_000,
    });
    expect(second).toEqual({ kind: "answer", text: "the answer is 4" });
  });
});

describe("the ceiling is one pure function, per route", () => {
  test("a plain ask is one exchange; an ask with a reading is two", () => {
    expect(turnSteps({ kind: "http" })).toEqual(ONE_STEP);
    expect(turnSteps({ kind: "http" }, true)).toEqual(ONE_READING);
    expect(ONE_READING).toEqual({ steps: 2, reason: "one reading" });
    // The local tier shares the HTTP rule: same turn, different pipe.
    expect(turnSteps({ kind: "local" }, true)).toEqual(ONE_READING);
    // A CLI carries its own reading; the app adds none.
    expect(turnSteps({ kind: "cli" }, true)).toEqual(ONE_STEP);
    expect(turnSteps({ kind: "cli" })).toEqual(ONE_STEP);
  });

  test("the sentence that bites is words, not a count", () => {
    expect(STEP_LIMIT_SENTENCE).toContain("reading limit");
    expect(STEP_LIMIT_SENTENCE).not.toMatch(/[0-9]/);
  });

  test("turn.ts asks the one function and writes no second ceiling", () => {
    const source = readFileSync(join(APP_DIR, "src", "turn", "turn.ts"), "utf8");
    expect(source).toContain("turnSteps(");
    expect(source).not.toMatch(/steps:\s*[0-9]/);
  });
});

/* ------------------------------------------------------------------ *
 * A scripted transport: no process, only the turns' own text.
 * ------------------------------------------------------------------ */

function scripted(answers: readonly string[]) {
  const sent: string[] = [];
  const waiting = new Map<number, (line: SidecarLine) => void>();
  let index = 0;
  const transport: TurnTransport = {
    async send(line: string): Promise<void> {
      sent.push(line);
      const request = parseRequestLine(line);
      if (request === null || request.kind !== "turn") return;
      const text = answers[index] ?? "";
      index += 1;
      setTimeout(() => {
        waiting.get(request.id)?.({
          id: request.id,
          kind: "part",
          part: "text",
          text,
        });
        waiting.get(request.id)?.({ id: request.id, kind: "done" });
      }, 0);
    },
    subscribe(id, handler) {
      waiting.set(id, handler);
      return () => {
        if (waiting.get(id) === handler) waiting.delete(id);
      };
    },
  };
  return { transport, sent };
}

const PROVIDER_FOR_SCRIPT = { baseUrl: "http://x", model: "m", apiKey: "" };

function oneBlock(): AskPacketInput {
  return {
    question: "what does the card say?",
    card: { name: "rain", state: null, reading: "the card's head", note: null },
    reaches: [],
    retrievable: ["rain"],
  };
}

describe("the budget bites in words and does not fetch", () => {
  test("a second READ says the sentence and fetches nothing more", async () => {
    const { transport, sent } = scripted([
      "READ: rain",
      "READ: rain",
      "a third answer that never happens",
    ]);
    const names: string[] = [];
    const answer = await askTurnPacket(
      transport,
      PROVIDER_FOR_SCRIPT,
      assembleAskPacket(oneBlock()),
      async (name) => {
        names.push(name);
        return "the card in full";
      },
    );
    // ONE reading happened; the second request was refused, not fetched.
    expect(names).toEqual(["rain"]);
    expect(sent).toHaveLength(2);
    expect(answer.read).toBe("rain");
    expect(answer.reached).toBe(STEP_LIMIT_SENTENCE);
    expect(answer.result).toEqual({
      kind: "answer",
      text: "READ: rain",
    });
    expect(answer.messages).toHaveLength(2);
  });

  test("a plain ask has no reading to spend: a READ is missed, not a ceiling", async () => {
    const { transport } = scripted(["READ: rain"]);
    let fetched = 0;
    const answer = await askTurnPacket(
      transport,
      PROVIDER_FOR_SCRIPT,
      assembleAskPacket({
        question: "why",
        card: { name: "rain", state: null, reading: null, note: null },
        reaches: [],
        retrievable: [],
      }),
      async () => {
        fetched += 1;
        return "never used";
      },
    );
    expect(fetched).toBe(0);
    expect(answer.missed).toBe("rain");
    expect(answer.reached).toBeNull();
  });

});

describe("the ask card shows arrival and stop; the ceiling is still a sentence", () => {
  test("the card's ask streams, marks a partial, and the limit still bites in words", () => {
    const card = readFileSync(
      join(APP_DIR, "src", "canvas", "AskCard.tsx"),
      "utf8",
    );
    // The answer arrives: parts update the pending line the result settles.
    expect(card).toContain("askPartPending(current, text)");
    // A stopped (or broken) partial is marked, never shown as complete.
    expect(card).toContain("ASK_STOPPED_MARK");
    expect(card).toContain("ASK_INCOMPLETE_MARK");
    expect(card).toContain("ask-turn-mark");
    // The ceiling's sentence is still the pure one, never a counter; the
    // turn's result still carries it. FINDING 17.7: the ask card does NOT
    // render that sentence (the retired panel did); see the story report.
    expect(STEP_LIMIT_SENTENCE).toContain("reading limit");
    expect(card).not.toContain("reached");
    expect(card).not.toMatch(/steps\s*\//);
  });
});

describe("the map is not touched", () => {
  test("the workspace folder is byte-identical after every stream above", () => {
    expect(snapshot(workspace)).toEqual(workspaceBefore);
  });
});
