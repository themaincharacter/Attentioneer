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
  modelsLine,
  modelsRequestLine,
  parseRequestLine,
  parseSidecarLine,
  stopLine,
  type SidecarLine,
} from "../src/turn/protocol";
import {
  MODEL_LIST_LIMIT,
  MODEL_LIST_SENTENCES,
  capModelIds,
  offerFetchedModels,
  modelsFetchProblem,
  newTickedModels,
  providerRefusal,
  readModelIds,
  truncationSentence,
  withTickedModels,
} from "../src/turn/modelList";
import {
  askProviderModels,
  connectionSentence,
  fetchModelIds,
} from "../src/turn/modelFetch";
import {
  EMPTY_SETTINGS,
  PROVIDER_SENTENCES,
  baseUrlProblem,
  storedTurnSettings,
  validateProviderRow,
  withProvider,
  type HttpProviderRow,
  type ProviderRow,
} from "../src/turn/providers";
import type { TurnTransport } from "../src/turn/turn";

/**
 * Story 15.11 — fetch the provider's model list.
 *
 * Three proofs, each at its own layer:
 *   - the PURE rules: the OpenAI shape read (or refused), de-duplicated and
 *     sorted; the cap stated; a fetched list laid against a row so existing
 *     models are kept byte for byte and only a TICK becomes a model;
 *   - the WINDOW's seam: a fetch is one request line, one answer, no retry, and
 *     a timeout stops the fetch instead of leaving it running;
 *   - the REAL sidecar process, driven over its actual stdio against a LOCAL
 *     stub `/models`: a 200 with duplicates, a 401, a 500, a 620-id list that
 *     truncates at the stated cap, and an unchanged working folder.
 *
 * No external network, no key beyond the stub, no config file written.
 */

const APP_DIR = join(import.meta.dir, "..");
const MAIN = join(APP_DIR, "sidecar", "main.ts");
const BUN = process.execPath;
const KEY = "sk-story-11-secret-key";
const PROVIDER = { baseUrl: "", apiKey: KEY };

const row = (models: string[] = ["qwen"]): HttpProviderRow => ({
  kind: "http",
  id: "local-endpoint",
  name: "Local endpoint",
  baseUrl: "http://127.0.0.1:8080/v1",
  models: models.map((id) => ({
    id,
    name: id === "qwen" ? "Qwen" : id,
    capabilities: { tools: id === "qwen", vision: false },
  })),
});

/* ------------------------------------------------------------------ *
 * The body: the OpenAI shape, or a refusal.
 * ------------------------------------------------------------------ */

describe("the provider's list is read as the OpenAI shape", () => {
  test("data[].id is taken, trimmed, de-duplicated and sorted", () => {
    expect(
      readModelIds({
        data: [
          { id: "zeta" },
          { id: "alpha" },
          { id: " zeta " },
          { id: "" },
          { id: 7 },
          "not an object",
        ],
      }),
    ).toEqual(["alpha", "zeta"]);
  });

  test("a body that is not that shape is refused, not guessed at", () => {
    for (const body of [
      null,
      "a string",
      [],
      {},
      { data: "nope" },
      { models: [{ id: "alpha" }] },
    ]) {
      expect(readModelIds(body)).toBeNull();
    }
    expect(readModelIds({ data: [] })).toEqual([]);
  });

  test("the cap lists the first N, counts the rest, and says so", () => {
    const capped = capModelIds(["b", "a", "c"], 2);
    expect(capped).toEqual({ ids: ["a", "b"], offered: 3, truncated: true });
    expect(truncationSentence(capped.offered, capped.ids.length)).toBe(
      "the provider offered 3 models; the first 2 are listed",
    );
    expect(capModelIds(["a"], MODEL_LIST_LIMIT).truncated).toBe(false);
  });

  test("a huge list is capped at the shipped limit", () => {
    const ids = Array.from({ length: 620 }, (_, at) => "model-" + at);
    const capped = capModelIds(ids);
    expect(capped.ids.length).toBe(MODEL_LIST_LIMIT);
    expect(capped.offered).toBe(620);
    expect(capped.truncated).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * The offer: nothing removed, nothing renamed, only ticks added.
 * ------------------------------------------------------------------ */

describe("a fetch never touches the row; only ticks add models", () => {
  test("existing models are marked onRow and kept, new ones offered unchecked", () => {
    const offered = offerFetchedModels(row(), ["beta", "qwen", "alpha"]);
    expect(offered).toEqual([
      { id: "alpha", onRow: false },
      { id: "beta", onRow: false },
      { id: "qwen", onRow: true },
    ]);
  });

  test("a second fetch of the same list is the same list (idempotent)", () => {
    const first = offerFetchedModels(row(), ["qwen", "alpha", "alpha"]);
    const second = offerFetchedModels(row(), ["alpha", "qwen"]);
    expect(second).toEqual(first);
  });

  test("only new ticks are added; the existing model is carried byte for byte", () => {
    const before = row();
    const after = withTickedModels(before, ["alpha", "beta", "alpha", " "]);
    expect(after.models.map((model) => model.id)).toEqual([
      "qwen",
      "alpha",
      "beta",
    ]);
    // The existing model is UNCHANGED: same name, same capabilities.
    expect(after.models[0]).toEqual(before.models[0]);
    // A fetched model claims no capabilities; the person's to edit later.
    expect(after.models[1]).toEqual({
      id: "alpha",
      name: "alpha",
      capabilities: { tools: false, vision: false },
    });
    // The source row is untouched (this module is pure).
    expect(before.models.map((model) => model.id)).toEqual(["qwen"]);
  });

  test("a fetch that lists none of the row's models removes none of them", () => {
    const after = withTickedModels(row(), []);
    expect(after.models.map((model) => model.id)).toEqual(["qwen"]);
    expect(newTickedModels(row(), ["qwen"])).toEqual([]);
    expect(newTickedModels(row(), ["qwen", "alpha"])).toEqual(["alpha"]);
  });

  test("confirmed ticks travel through the ordinary config write shape", () => {
    const next = withProvider(
      EMPTY_SETTINGS,
      withTickedModels(row(), ["alpha", "beta"]),
    );
    const stored = storedTurnSettings(next);
    expect(stored.providers).toHaveLength(1);
    expect(
      (stored.providers[0].models as unknown as { id: string }[]).map(
        (model) => model.id,
      ),
    ).toEqual(["qwen", "alpha", "beta"]);
    // No key, ever, in the stored shape.
    expect(JSON.stringify(stored)).not.toContain(KEY);
    expect(JSON.stringify(stored)).not.toContain("apiKey");
  });
});

/* ------------------------------------------------------------------ *
 * Only an endpoint has a list; the https rule gates the fetch too.
 * ------------------------------------------------------------------ */

describe("who is offered the verb", () => {
  const cli: ProviderRow = {
    kind: "cli",
    id: "claude",
    name: "Claude",
    command: "claude",
    versionArgs: ["--version"],
    run: { args: ["-p", "{prompt}"], read: "stdout" },
    notes: "",
    models: [
      { id: "claude", name: "claude", capabilities: { tools: false, vision: false } },
    ],
  };
  const local: ProviderRow = {
    kind: "local",
    id: "llama",
    name: "Llama",
    command: "llama-server",
    model: "/models/q.gguf",
    args: ["-m", "{model}", "--port", "{port}"],
    idleMinutes: 10,
    notes: "",
    models: [
      { id: "q", name: "q", capabilities: { tools: false, vision: false } },
    ],
  };

  test("a command says why it has no list, and a local row says its own why", () => {
    expect(modelsFetchProblem(cli)).toBe(MODEL_LIST_SENTENCES.cliNoList);
    expect(modelsFetchProblem(local)).toBe(MODEL_LIST_SENTENCES.localNoList);
  });

  test("an endpoint's base URL still has to pass the https/loopback rule", () => {
    expect(modelsFetchProblem(row())).toBeNull();
    const insecure: HttpProviderRow = {
      ...row(),
      baseUrl: "http://api.example.com/v1",
    };
    expect(modelsFetchProblem(insecure)).toBe(
      PROVIDER_SENTENCES.insecureBaseUrl,
    );
    expect(baseUrlProblem("https://api.example.com/v1")).toBeNull();
    expect(baseUrlProblem("http://127.0.0.1:8080/v1")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The wire: one request, one line, strict on both ends.
 * ------------------------------------------------------------------ */

describe("the models wire", () => {
  test("a request carries a base URL and a key, and no model", () => {
    expect(
      parseRequestLine(modelsRequestLine(9, { baseUrl: "https://x/v1", apiKey: KEY })),
    ).toEqual({ id: 9, kind: "models", provider: { baseUrl: "https://x/v1", apiKey: KEY } });
  });

  test("a request without a provider is refused", () => {
    expect(
      parseRequestLine(JSON.stringify({ id: 9, kind: "models" })),
    ).toBeNull();
    expect(parseRequestLine(JSON.stringify({ id: 9, kind: "models", provider: { baseUrl: "" } }))).toBeNull();
  });

  test("a list line reads back, with offered only when it truncated", () => {
    expect(parseSidecarLine(modelsLine(4, ["a", "b"]))).toEqual({
      id: 4,
      kind: "models",
      models: [{ id: "a" }, { id: "b" }],
    });
    expect(parseSidecarLine(modelsLine(4, ["a"], 9))).toEqual({
      id: 4,
      kind: "models",
      models: [{ id: "a" }],
      offered: 9,
    });
  });

  test("a broken list line is refused rather than half-read", () => {
    for (const line of [
      JSON.stringify({ id: 4, kind: "models" }),
      JSON.stringify({ id: 4, kind: "models", models: [{ id: "" }] }),
      JSON.stringify({ id: 4, kind: "models", models: [{ id: "a" }, { id: "a" }] }),
      JSON.stringify({ id: 4, kind: "models", models: [{ id: "a" }], offered: 0 }),
      JSON.stringify({ id: 4, kind: "models", models: [{ id: "a" }], offered: 1.5 }),
    ]) {
      expect(parseSidecarLine(line)).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ *
 * The window's seam: one press, one request, no retry.
 * ------------------------------------------------------------------ */

interface Scripted {
  transport: TurnTransport;
  sent: string[];
}

function scripted(answer: (id: number) => SidecarLine | null): Scripted {
  const sent: string[] = [];
  let handler: ((line: SidecarLine) => void) | null = null;
  return {
    sent,
    transport: {
      async send(line) {
        sent.push(line);
        const request = parseRequestLine(line);
        if (request === null) return;
        const reply = answer(request.id);
        if (reply !== null) {
          // Answer on the next turn, after the send settles: the subscriber is
          // already registered, exactly like the real pipe.
          queueMicrotask(() => handler?.(reply));
        }
      },
      subscribe(_id, next) {
        handler = next;
        return () => {
          handler = null;
        };
      },
    },
  };
}

describe("the fetch is one press", () => {
  test("a list line settles the fetch with the ids and the offered count", async () => {
    const { transport, sent } = scripted((id) => ({
      id,
      kind: "models",
      models: [{ id: "alpha" }, { id: "beta" }],
      offered: 2,
    }));
    const result = await fetchModelIds(transport, PROVIDER);
    expect(result).toEqual({
      kind: "models",
      ids: ["alpha", "beta"],
      offered: 2,
    });
    expect(sent).toHaveLength(1);
    expect(parseRequestLine(sent[0])?.kind).toBe("models");
  });

  test("an error line is one sentence, and nothing is retried", async () => {
    const { transport, sent } = scripted((id) => ({
      id,
      kind: "error",
      message: providerRefusal(401),
    }));
    const result = await fetchModelIds(transport, PROVIDER);
    expect(result).toEqual({ kind: "error", sentence: providerRefusal(401) });
    expect(sent).toHaveLength(1);
  });

  test("a timeout settles, then stops the fetch at its source", async () => {
    const { transport, sent } = scripted(() => null);
    const result = await fetchModelIds(transport, PROVIDER, { timeoutMs: 20 });
    expect(result).toEqual({
      kind: "timeout",
      sentence: MODEL_LIST_SENTENCES.timeout,
    });
    expect(sent).toHaveLength(2);
    const requested = parseRequestLine(sent[0]);
    expect(requested?.kind).toBe("models");
    expect(parseRequestLine(sent[1])?.kind).toBe("stop");
    if (requested === null) throw new Error("the fetch sent no request");
    expect(sent[1]).toBe(stopLine(requested.id));
  });

  test("a refused sidecar start blames the sidecar, not the provider", async () => {
    // The start's refusal path is the app's; this pins the sentence it reuses.
    expect(MODEL_LIST_SENTENCES.unreachable).not.toContain("key");
  });
});

/* ------------------------------------------------------------------ *
 * The real sidecar against a local stub /models.
 * ------------------------------------------------------------------ */

type Mode = "ok" | "empty" | "notjson" | "401" | "500" | "huge" | "slow";

let mode: Mode = "ok";
let lastRequest: {
  method: string;
  url: string;
  authorization: string | null;
} | null = null;

const hugeIds = Array.from({ length: 620 }, (_, at) => "model-" + at);

const stub = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    lastRequest = {
      method: request.method,
      url: request.url,
      authorization: request.headers.get("authorization"),
    };
    if (mode === "401") return new Response("no", { status: 401 });
    if (mode === "500") return new Response("boom", { status: 500 });
    if (mode === "notjson") return new Response("not json at all", { status: 200 });
    if (mode === "slow") {
      await Bun.sleep(3_000);
      return Response.json({ data: [{ id: "late" }] });
    }
    if (mode === "empty") return Response.json({ data: [] });
    if (mode === "huge") {
      return Response.json({ data: hugeIds.map((id) => ({ id })) });
    }
    return Response.json({
      data: [
        { id: "gpt-4o-mini" },
        { id: "gpt-4o" },
        { id: "gpt-4o-mini" },
        { id: "gpt-4o" },
      ],
    });
  },
});

PROVIDER.baseUrl = `http://127.0.0.1:${stub.port}/v1`;

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

  async next(budgetMs = 5_000): Promise<string> {
    const deadline = Date.now() + budgetMs;
    while (this.ready.length === 0) {
      if (this.closed) throw new Error("the sidecar closed before answering");
      if (Date.now() >= deadline) throw new Error("timed out waiting for a line");
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        setTimeout(resolve, 10);
      });
    }
    return this.ready.shift() as string;
  }
}

/** The real pipe as a transport: write a line, dispatch answers by id. */
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

function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const stats = statSync(full);
    if (stats.isDirectory()) out[name + "/"] = "";
    else out[name] = `${stats.size}:${readFileSync(full).toString("base64")}`;
  }
  return out;
}

const workspace = mkdtempSync(join(tmpdir(), "attentioneer-fetch-models-"));
mkdirSync(join(workspace, "notes"), { recursive: true });
writeFileSync(join(workspace, "workspace.yml"), "format: attentioneer-workspace/1\n");
writeFileSync(join(workspace, "notes", "garden.md"), "a map the fetch must not touch\n");
const workspaceBefore = snapshot(workspace);
const notesBefore = snapshot(join(workspace, "notes"));

let child: ReturnType<typeof Bun.spawn>;
let lines: Lines;
let transport: TurnTransport;

beforeAll(() => {
  child = Bun.spawn([BUN, MAIN], {
    cwd: workspace,
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
  rmSync(workspace, { recursive: true, force: true });
});

describe("the sidecar's fetch of a real /models", () => {
  test("it says hello before anything is asked", async () => {
    expect(parseSidecarLine(await lines.next())).toEqual({
      kind: "hello",
      version: 1,
    });
  });

  test("a 200 with duplicates is one sorted, de-duplicated list", async () => {
    mode = "ok";
    const result = await fetchModelIds(transport, PROVIDER);
    expect(result).toEqual({
      kind: "models",
      ids: ["gpt-4o", "gpt-4o-mini"],
      offered: 2,
    });
    expect(lastRequest?.method).toBe("GET");
    expect(lastRequest?.url).toBe(`${PROVIDER.baseUrl}/models`);
    expect(lastRequest?.authorization).toBe(`Bearer ${KEY}`);
  });

  test("a 401 is ONE sentence with the status and a reason, never the key", async () => {
    mode = "401";
    const result = await fetchModelIds(transport, PROVIDER);
    expect(result).toEqual({
      kind: "error",
      sentence: "the provider answered 401 (the key was refused)",
    });
    const sentence = result.kind === "error" ? result.sentence : "";
    expect(sentence.split("\n")).toHaveLength(1);
    expect(sentence).not.toContain(KEY);
    expect(sentence).not.toContain("Bearer");
  });

  test("a 500 is ONE sentence with the status and a reason", async () => {
    mode = "500";
    const result = await fetchModelIds(transport, PROVIDER);
    expect(result).toEqual({
      kind: "error",
      sentence: "the provider answered 500 (the provider failed)",
    });
  });

  test("a 200 that is not JSON is one sentence, not a crash", async () => {
    mode = "notjson";
    const result = await fetchModelIds(transport, PROVIDER);
    expect(result).toEqual({
      kind: "error",
      sentence: MODEL_LIST_SENTENCES.notJson,
    });
  });

  test("an empty list is said in words, not shown as a blank list", async () => {
    mode = "empty";
    const result = await fetchModelIds(transport, PROVIDER);
    expect(result).toEqual({
      kind: "error",
      sentence: MODEL_LIST_SENTENCES.noModels,
    });
  });

  test("a huge list stops at the cap and states the count", async () => {
    mode = "huge";
    const result = await fetchModelIds(transport, PROVIDER);
    expect(result.kind).toBe("models");
    if (result.kind !== "models") return;
    expect(result.ids).toHaveLength(MODEL_LIST_LIMIT);
    expect(result.offered).toBe(620);
    expect(truncationSentence(result.offered, result.ids.length)).toBe(
      "the provider offered 620 models; the first 500 are listed",
    );
  });

  test("a stopped fetch leaves the sidecar able to answer the next press", async () => {
    mode = "slow";
    const stopped = await fetchModelIds(transport, PROVIDER, { timeoutMs: 80 });
    expect(stopped).toEqual({
      kind: "timeout",
      sentence: MODEL_LIST_SENTENCES.timeout,
    });
    // The next press is a new fetch, and it works: the stop released the pipe.
    mode = "ok";
    const next = await fetchModelIds(transport, PROVIDER);
    expect(next).toEqual({
      kind: "models",
      ids: ["gpt-4o", "gpt-4o-mini"],
      offered: 2,
    });
  });

  /* STORY 15.12: the TEST verb is the same GET, asked through the same
     plumbing, said as one sentence. Three outcomes here, against the same
     stub: answered, refused, and no answer in time. */

  /** The panel's test verb, at this layer: one ask, one measured sentence. */
  async function testVerb(timeoutMs?: number): Promise<string> {
    const answer = await askProviderModels(
      (provider) =>
        timeoutMs === undefined
          ? fetchModelIds(transport, provider)
          : fetchModelIds(transport, provider, { timeoutMs }),
      PROVIDER,
    );
    return connectionSentence(answer);
  }

  test("the endpoint answered: one sentence, the ms and the count", async () => {
    mode = "ok";
    const sentence = await testVerb();
    expect(sentence).toMatch(
      /^the endpoint answered in \d+ ms and offered 2 models$/,
    );
    expect(sentence).not.toContain(KEY);
    expect(lastRequest?.method).toBe("GET");
    expect(lastRequest?.url).toBe(`${PROVIDER.baseUrl}/models`);
    expect(lastRequest?.authorization).toBe(`Bearer ${KEY}`);
  });

  test("a refused key: the existing scrubbed sentence, once", async () => {
    mode = "401";
    const sentence = await testVerb();
    expect(sentence).toBe("the provider answered 401 (the key was refused)");
    expect(sentence.split("\n")).toHaveLength(1);
    expect(sentence).not.toContain(KEY);
  });

  test("a failing provider: the same one sentence, no timing machinery", async () => {
    mode = "500";
    expect(await testVerb()).toBe(
      "the provider answered 500 (the provider failed)",
    );
  });

  test("no answer: the existing timeout sentence, not a second wording", async () => {
    mode = "slow";
    expect(await testVerb(80)).toBe(MODEL_LIST_SENTENCES.timeout);
  });

  test("nothing was written: the folder is byte-identical", () => {
    expect(snapshot(workspace)).toEqual(workspaceBefore);
    expect(snapshot(join(workspace, "notes"))).toEqual(notesBefore);
  });
});

/* ------------------------------------------------------------------ *
 * The panel's paths, as source facts.
 * ------------------------------------------------------------------ */

describe("the panel writes only on confirm", () => {
  const panel = readFileSync(
    join(APP_DIR, "src", "canvas", "ProvidersPanel.tsx"),
    "utf8",
  );

  test("the fetch path has no write; the confirm path writes through the config", () => {
    const fetchBody = panel.slice(
      panel.indexOf("async function fetchModelsForRow"),
      panel.indexOf("async function addTicked"),
    );
    expect(fetchBody).not.toContain("write(");
    expect(fetchBody).toContain("readSecret(");
    const confirmBody = panel.slice(
      panel.indexOf("async function addTicked"),
      panel.indexOf("async function removeProvider"),
    );
    expect(confirmBody).toContain("write(withProvider(");
    expect(confirmBody).toContain("validateProviderRow(");
  });

  test("the verb is offered for an endpoint row only", () => {
    expect(panel).toContain("fetch models");
    expect(panel).toContain("modelsFetchProblem(provider)");
    expect(panel).toContain('provider.kind === "http"');
  });
});
