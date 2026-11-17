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
  parseSidecarLine,
  stopLine,
  type SidecarLine,
  type TurnMessage,
} from "../src/turn/protocol";
import { askTurn, stopTurn, type TurnTransport } from "../src/turn/turn";

/**
 * Story 15.1 — ONE TURN, THROUGH THE REAL SIDECAR.
 *
 * The story's check is human ("configure a provider, ask 'what is 2+2', read
 * the answer beside the card, quit: no answer kept and no sidecar left"). This
 * file drives the actual `app/sidecar/main.ts` process over its actual stdio
 * pipe, with a LOCAL stub HTTP server pretending to be the provider — so the
 * test needs no network, no key and no account.
 *
 * It pins the done-means list: one text part then `done`; a stop that yields
 * `cancelled`; an HTTP 401 that yields ONE error line with no key in it; a
 * malformed line that does not kill the sidecar; a second turn after the
 * first; and a workspace folder that is byte-identical before and after a
 * turn. The child is spawned with the temp folder as its working directory,
 * so any file the sidecar might read or write would land where the snapshot
 * looks.
 */

const APP_DIR = join(import.meta.dir, "..");
const MAIN = join(APP_DIR, "sidecar", "main.ts");
const BUN = process.execPath;

const KEY = "sk-story-1-secret-key";

interface RequestBody {
  model?: unknown;
  messages?: TurnMessage[];
  stream?: unknown;
}

/** What the stub provider answers, switched per test. */
let mode: "text" | "unauthorized" | "slow" = "text";
let requests = 0;
let lastRequest: {
  url: string;
  authorization: string | null;
  contentType: string | null;
  body: RequestBody;
} | null = null;

function completion(content: string): Response {
  return Response.json({
    choices: [{ message: { role: "assistant", content } }],
  });
}

const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    requests += 1;
    const body = (await request.json()) as RequestBody;
    lastRequest = {
      url: request.url,
      authorization: request.headers.get("authorization"),
      contentType: request.headers.get("content-type"),
      body,
    };
    if (mode === "unauthorized") {
      return new Response("{}", {
        status: 401,
        statusText: "Unauthorized",
        headers: { "content-type": "application/json" },
      });
    }
    if (mode === "slow") {
      await Bun.sleep(2_000);
      return completion("too late");
    }
    return completion("4");
  },
});

const BASE_URL = `http://127.0.0.1:${stub.port}/v1`;

const PROVIDER = { baseUrl: BASE_URL, model: "stub-model", apiKey: KEY };

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

  /** Every line as it arrives (a transport's subscription). */
  onLine(handler: (line: string) => void): void {
    this.handlers.push(handler);
  }

  /** The next line, or a failure when the budget runs out. */
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

/** The real pipe as a `TurnTransport`: write a line, dispatch lines by id. */
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

const workspace = mkdtempSync(join(tmpdir(), "attentioneer-turn-workspace-"));
mkdirSync(join(workspace, "notes"), { recursive: true });
writeFileSync(join(workspace, "workspace.yml"), "format: attentioneer-workspace/1\n");
writeFileSync(
  join(workspace, "notes", "garden.md"),
  "the garden is where the turn is anchored\n",
);
const workspaceBefore = snapshot(workspace);

/* ------------------------------------------------------------------ *
 * The child: one sidecar, spawned on first use and killed at the end.
 * ------------------------------------------------------------------ */

let child: ReturnType<typeof Bun.spawn>;
let lines: Lines;
let stderr = "";

beforeAll(() => {
  child = Bun.spawn([BUN, MAIN], {
    // The temp folder is the child's working directory: if the sidecar ever
    // read or wrote a workspace file, the snapshot at the end would see it.
    cwd: workspace,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env },
  });
  lines = new Lines(child.stdout as ReadableStream<Uint8Array>);
  void (async () => {
    for await (const chunk of child.stderr as ReadableStream<Uint8Array>) {
      stderr += new TextDecoder().decode(chunk);
    }
  })();
});

afterAll(() => {
  child.kill();
  stub.stop(true);
  rmSync(workspace, { recursive: true, force: true });
});

describe("the sidecar's first breath", () => {
  test("it says hello on the wire before anything is asked", async () => {
    const hello = await lines.next();
    expect(parseSidecarLine(hello)).toEqual({ kind: "hello", version: 1 });
  });
});

describe("one turn, one answer", () => {
  test("the app's turn gets one text part, then done", async () => {
    mode = "text";
    const before = requests;
    const transport = transportOf(child, lines);
    const result = await askTurn(transport, PROVIDER, "what is 2+2", {
      timeoutMs: 5_000,
    });
    expect(result).toEqual({ kind: "answer", text: "4" });

    // The provider saw ONE non-streaming POST to the base URL's completion
    // path, with the bearer key, and exactly the two messages (no map).
    expect(requests).toBe(before + 1);
    expect(lastRequest?.url).toBe(`${BASE_URL}/chat/completions`);
    expect(lastRequest?.authorization).toBe(`Bearer ${KEY}`);
    expect(lastRequest?.contentType).toContain("application/json");
    expect(lastRequest?.body.stream).toBe(false);
    expect(lastRequest?.body.model).toBe("stub-model");
    expect(lastRequest?.body.messages).toHaveLength(2);
    expect(lastRequest?.body.messages?.[1]).toEqual({
      role: "user",
      content: "what is 2+2",
    });
  });

  test("an HTTP 401 is one error sentence, and it carries no key", async () => {
    mode = "unauthorized";
    const transport = transportOf(child, lines);
    const result = await askTurn(transport, PROVIDER, "what is 2+2", {
      timeoutMs: 5_000,
    });
    expect(result.kind).toBe("error");
    const sentence = result.kind === "answer" ? result.text : result.sentence;
    expect(sentence).toContain("401");
    expect(sentence).not.toContain(KEY);
    // The sidecar's stderr is dropped by the host, but a child that printed
    // the key would still have leaked it: require silence.
    expect(stderr).not.toContain(KEY);
  });
});

describe("a line that does not parse", () => {
  test("is answered for its id, is ignored without one, and kills nothing", async () => {
    mode = "text";
    // A request-shaped line missing its provider: one error, for that id. The
    // answer is caught by id (the reader's queue still holds earlier lines).
    const heard = new Promise<SidecarLine>((resolve) => {
      lines.onLine((raw) => {
        const line = parseSidecarLine(raw);
        if (line !== null && line.id === 9001) resolve(line);
      });
    });
    child.stdin.write(JSON.stringify({ id: 9001, kind: "turn" }) + "\n");
    await child.stdin.flush();
    expect(await heard).toEqual({
      id: 9001,
      kind: "error",
      message: "the request could not be read",
    });

    // A line with no id is ignored — no answer to give.
    child.stdin.write("garbage\n");
    await child.stdin.flush();

    // And the sidecar is still reading: a real turn follows.
    const transport = transportOf(child, lines);
    expect(
      await askTurn(transport, PROVIDER, "still there?", { timeoutMs: 5_000 }),
    ).toEqual({ kind: "answer", text: "4" });
  });
});

describe("a stop and a second turn", () => {
  test("stop mid-answer yields cancelled, and a later turn still works", async () => {
    mode = "slow";
    const transport = transportOf(child, lines);
    const started = requests;
    let runningId = 0;
    const pending = askTurn(transport, PROVIDER, "what is 2+2", {
      timeoutMs: 10_000,
      onStart: (id) => {
        runningId = id;
      },
    });
    // Let the request actually reach the provider before stopping it.
    const deadline = Date.now() + 3_000;
    while (requests === started && Date.now() < deadline) {
      await Bun.sleep(5);
    }
    expect(requests).toBe(started + 1);

    await stopTurn(transport, runningId);
    expect(await pending).toEqual({
      kind: "cancelled",
      sentence: "the turn was stopped",
    });

    // A second turn, after the stop, on the SAME child: no restart, no hang.
    mode = "text";
    const second = await askTurn(transport, PROVIDER, "what is 2+2", {
      timeoutMs: 5_000,
    });
    expect(second).toEqual({ kind: "answer", text: "4" });
  });
});

describe("the map is not touched", () => {
  test("the workspace folder is byte-identical after every turn above", () => {
    // A turn is NOT a move: no record, no history line, no mirror rewrite. The
    // sidecar had this folder as its working directory for all of it.
    expect(snapshot(workspace)).toEqual(workspaceBefore);
  });
});
