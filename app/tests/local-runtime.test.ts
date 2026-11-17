import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { parseSidecarLine, type SidecarLine } from "../src/turn/protocol";
import {
  buildTurnMessages,
  routeOf,
  runRoute,
  type TurnTransport,
} from "../src/turn/turn";
import {
  EMPTY_SETTINGS,
  parseProviderRow,
  readTurnSettings,
  resolveSelection,
  storedTurnSettings,
  validateLocalProviderRow,
  withProvider,
  type LocalProviderRow,
} from "../src/turn/providers";
import {
  localBaseUrl,
  localArgsProblem,
  localSentence,
  modelStem,
  substituteLocalArgs,
  type LocalStatus,
} from "../src/turn/local";
import {
  LOCAL_KEY_PLACEHOLDER,
  LOCAL_MODEL_PLACEHOLDER,
  LOCAL_PORT_PLACEHOLDER,
  LOCAL_SPECS,
} from "../src/turn/localSpecs";

/**
 * Story 15.6 — THE LOCAL RUNTIME TIER.
 *
 * The rules that can be decided as values are pinned as values: the shipped
 * preset carries all three placeholders in separate argv entries, the model
 * path with spaces stays ONE entry, the validator refuses an argv the host
 * could not substitute, and a local row round-trips through the config with
 * no key field. The row resolves to a LOCAL route, never an endpoint typed by
 * hand.
 *
 * Then the tier is proven with a REAL temp stub server process: an
 * OpenAI-compatible server that binds the port it is given and rejects every
 * request whose bearer key is not the one it was launched with. The test picks
 * the port the way the host does (bind ephemeral, close), substitutes the
 * argv with the app's own rule, spawns the script with Bun.spawn, and drives
 * the REAL sidecar (app/sidecar/main.ts) over its REAL stdio for the turn.
 * That is the whole offline path: loopback server, minted-per-launch key,
 * ordinary HTTP turn through the existing sidecar.
 *
 * The process half of the story — port choice, readiness budget, idle-kill,
 * kill on drop, the key never in an error — is Rust's and is proven there
 * (src-tauri/src/local_runtime.rs tests), because only Rust can spawn through
 * the app's real local-runtime path.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const MAIN = join(APP, "sidecar", "main.ts");
const BUN = process.execPath;

const workspace = mkdtempSync(join(tmpdir(), "attentioneer-local-workspace-"));
const modelDir = join(workspace, "my models");
writeFileSync(join(workspace, "workspace.yml"), "format: attentioneer-workspace/1\n");
mkdirSync(modelDir, { recursive: true });
const MODEL_PATH = join(modelDir, "qwen 7b.gguf");

/* ------------------------------------------------------------------ *
 * The real sidecar, over its real pipe.
 * ------------------------------------------------------------------ */

class Lines {
  private buffer = "";
  private ready: string[] = [];
  private waiting: (() => void)[] = [];
  private handlers: ((line: string) => void)[] = [];
  private closed = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    void (async () => {
      const reader = stream.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        this.buffer += decoder.decode(value, { stream: true });
        let at = this.buffer.indexOf("\n");
        while (at >= 0) {
          const raw = this.buffer.slice(0, at);
          this.buffer = this.buffer.slice(at + 1);
          this.ready.push(raw);
          for (const handler of this.handlers) handler(raw);
          while (this.waiting.length > 0) this.waiting.shift()?.();
          at = this.buffer.indexOf("\n");
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
      if (this.closed) throw new Error("the stub closed before answering");
      if (Date.now() >= deadline) throw new Error("timed out waiting for a line");
      await new Promise<void>((resolve) => {
        this.waiting.push(resolve);
        setTimeout(resolve, 10);
      });
    }
    return this.ready.shift() as string;
  }
}

let child: ReturnType<typeof Bun.spawn>;
let lines: Lines;

beforeAll(async () => {
  child = Bun.spawn([BUN, MAIN], {
    cwd: workspace,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "ignore",
    env: { ...process.env },
  });
  lines = new Lines(child.stdout as ReadableStream<Uint8Array>);
  const hello = await lines.next();
  expect(hello).toContain('"hello"');
});

afterAll(() => {
  child.kill();
  rmSync(workspace, { recursive: true, force: true });
});

/** The real pipe as a transport: one line out, lines fanned out by turn id. */
function transportOf(): TurnTransport {
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
 * A REAL temp stub server: an OpenAI-compatible process on the port it gets.
 * ------------------------------------------------------------------ */

const STUB_SOURCE = [
  'const args = process.argv.slice(2);',
  'function value(flag) {',
  '  const at = args.indexOf(flag);',
  '  return at < 0 ? "" : (args[at + 1] ?? "");',
  '}',
  'const port = Number(value("--port"));',
  'const key = value("--api-key");',
  'const model = value("--model");',
  'if (!Number.isInteger(port) || port <= 0 || key === "") {',
  '  console.error("the stub needs --port and --api-key");',
  '  process.exit(2);',
  '}',
  'Bun.serve({',
  '  hostname: "127.0.0.1",',
  '  port,',
  '  fetch: async (request) => {',
  '    const url = new URL(request.url);',
  '    if (url.pathname === "/health") return new Response("ok");',
  '    if (!url.pathname.endsWith("/chat/completions")) {',
  '      return new Response("not found", { status: 404 });',
  '    }',
  '    const auth = request.headers.get("authorization") ?? "";',
  '    if (auth !== "Bearer " + key) {',
  '      return Response.json({ error: { message: "the key was not the one" } }, { status: 401 });',
  '    }',
  '    const body = await request.json();',
  '    return Response.json({',
  '      choices: [{ message: { role: "assistant", content: "the stub answered " + body.model } }],',
  '    });',
  '  },',
  '});',
  'console.log("the stub is ready on " + port);',
].join("\n");

interface Stub {
  port: number;
  key: string;
  child: ReturnType<typeof Bun.spawn>;
  readyLine: string;
}

/** The host's port choice: bind ephemeral, close, hand the number over. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

async function startStub(port: number, key: string): Promise<Stub> {
  const script = join(workspace, "stub-server.ts");
  writeFileSync(script, STUB_SOURCE);
  chmodSync(script, 0o755);
  // The argv the app's pure rule builds: the placeholders go into SEPARATE
  // entries, so the model path with spaces stays one argument.
  const rawArgs = [
    "--port",
    LOCAL_PORT_PLACEHOLDER,
    "--api-key",
    LOCAL_KEY_PLACEHOLDER,
    "--model",
    LOCAL_MODEL_PLACEHOLDER,
    "--ctx-size",
    "32768",
  ];
  const args = substituteLocalArgs(rawArgs, { port, key, model: MODEL_PATH });
  const stubChild = Bun.spawn([BUN, script, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "ignore",
  });
  const stubLines = new Lines(stubChild.stdout as ReadableStream<Uint8Array>);
  const readyLine = await stubLines.next(5_000);
  return { port, key, child: stubChild, readyLine };
}

function localRow(): LocalProviderRow {
  const read = validateLocalProviderRow(
    {
      name: "Stub local",
      command: "stub-server",
      model: MODEL_PATH,
      args: LOCAL_SPECS[0].args,
      readyPattern: "the stub is ready",
      idleMinutes: 1,
    },
    [],
  );
  if (read.kind === "refused") throw new Error(read.sentence);
  expect(read.row.id).toBe("stub-local");
  return read.row;
}

/* ------------------------------------------------------------------ *
 * The pure rules.
 * ------------------------------------------------------------------ */

describe("the shipped llama.cpp preset is data, and its placeholders are entries", () => {
  const preset = LOCAL_SPECS[0];

  test("the preset carries port, key and model exactly once each", () => {
    const carrying = (placeholder: string): number =>
      preset.args.filter((arg) => arg.includes(placeholder)).length;
    expect(carrying(LOCAL_PORT_PLACEHOLDER)).toBe(1);
    expect(carrying(LOCAL_KEY_PLACEHOLDER)).toBe(1);
    expect(carrying(LOCAL_MODEL_PLACEHOLDER)).toBe(1);
    expect(preset.readyPattern).toBe("server is listening");
    expect(preset.idleMinutes).toBeGreaterThan(0);
  });

  test("a model path with spaces stays ONE argv entry", () => {
    const argv = substituteLocalArgs(preset.args, {
      port: 54321,
      key: "sk-local-test",
      model: MODEL_PATH,
    });
    expect(argv.length).toBe(preset.args.length);
    expect(argv[1]).toBe(MODEL_PATH);
    const portAt = preset.args.indexOf(LOCAL_PORT_PLACEHOLDER);
    expect(argv[portAt]).toBe("54321");
    const keyAt = preset.args.indexOf(LOCAL_KEY_PLACEHOLDER);
    expect(argv[keyAt]).toBe("sk-local-test");
    expect(argv.some((entry) => entry.includes("{"))).toBe(false);
  });

  test("the argv is refused when the host could not substitute it", () => {
    expect(localArgsProblem(["-m", "{model}"])).toContain("{port}");
    expect(localArgsProblem(["--port", "{port}", "--port", "{port}"])).toContain(
      "one argument",
    );
    expect(localArgsProblem(["--port", "{port}", "{token}"])).toContain("{token}");
    expect(localArgsProblem([])).toContain("{port}");
    expect(localArgsProblem(["--port", "{port}"])).toBeNull();
  });

  test("the model's display name comes from its file name, spaces kept", () => {
    expect(modelStem(MODEL_PATH)).toBe("qwen 7b");
    expect(modelStem("/models/qwen.gguf")).toBe("qwen");
  });

  test("the base URL is loopback and the sentence says the port and idle rule", () => {
    expect(localBaseUrl(51234)).toBe("http://127.0.0.1:51234/v1");
    const running: LocalStatus = {
      running: true,
      port: 51234,
      key: "sk-local-x",
      idleMinutes: 10,
      tag: "local",
      lastLine: "",
    };
    expect(localSentence(running)).toContain("127.0.0.1:51234");
    expect(localSentence(running)).toContain("10 minutes");
    expect(localSentence(null)).toBe("the local runtime is stopped");
  });
});

/* ------------------------------------------------------------------ *
 * The row: validation, the string contract, the config round-trip.
 * ------------------------------------------------------------------ */

describe("a local row holds a command and an argv, never a key or a port", () => {
  test("the row gets ONE model row named after the model file", () => {
    const read = validateLocalProviderRow(
      {
        name: "Local llama",
        command: "llama-server",
        model: MODEL_PATH,
        args: LOCAL_SPECS[0].args,
        readyPattern: "server is listening",
        idleMinutes: 10,
      },
      [],
    );
    if (read.kind === "refused") throw new Error(read.sentence);
    expect(read.row.kind).toBe("local");
    expect(read.row.models.length).toBe(1);
    expect(read.row.models[0].id).toBe("qwen-7b");
    expect(read.row.models[0].name).toBe("qwen 7b");
    expect("apiKey" in read.row).toBe(false);
    expect("port" in read.row).toBe(false);
  });

  test("a command, a model path and placeholders are required at the write", () => {
    const base = {
      name: "Local",
      command: "llama-server",
      model: MODEL_PATH,
      args: LOCAL_SPECS[0].args,
    };
    expect(
      validateLocalProviderRow({ ...base, command: "" }, []).kind,
    ).toBe("refused");
    expect(
      validateLocalProviderRow({ ...base, model: "" }, []).kind,
    ).toBe("refused");
    expect(
      validateLocalProviderRow({ ...base, args: ["-m", "{model}"] }, []).kind,
    ).toBe("refused");
    expect(
      validateLocalProviderRow({ ...base, idleMinutes: 0 }, []).kind,
    ).toBe("refused");
  });

  test("the row round-trips through the config with no key", () => {
    const read = validateLocalProviderRow(
      {
        name: "Local llama",
        command: "llama-server",
        model: MODEL_PATH,
        args: LOCAL_SPECS[0].args,
        readyPattern: "server is listening",
        idleMinutes: 10,
      },
      [],
    );
    if (read.kind === "refused") throw new Error(read.sentence);
    const settings = withProvider(EMPTY_SETTINGS, read.row);
    const stored = storedTurnSettings(settings);
    const text = JSON.stringify(stored);
    expect(text).not.toContain("sk-local");
    expect(text).not.toContain('"key"');
    expect(text).not.toContain('"apiKey"');
    const back = readTurnSettings(stored);
    const row = back.providers[0];
    expect(row.kind).toBe("local");
    if (row.kind !== "local") throw new Error("the row came back as not local");
    expect(row.model).toBe(MODEL_PATH);
    expect(row.args).toEqual(LOCAL_SPECS[0].args);
    expect(row.readyPattern).toBe("server is listening");
    expect(row.idleMinutes).toBe(10);
  });

  test("a stored local row with an argv the host cannot substitute is dropped", () => {
    const stored = {
      kind: "local",
      id: "local",
      name: "Local",
      command: "llama-server",
      model: MODEL_PATH,
      args: ["-m", "{model}"],
      idleMinutes: 10,
      models: [
        {
          id: "qwen-7b",
          name: "qwen 7b",
          capabilities: { tools: false, vision: false },
        },
      ],
    };
    expect(parseProviderRow(stored)).toBeNull();
  });

  test("the local row resolves to a LOCAL route, not an endpoint", () => {
    const row = localRow();
    const settings = withProvider(EMPTY_SETTINGS, row);
    const resolved = resolveSelection({
      ...settings,
      providerId: row.id,
      modelId: row.models[0].id,
    });
    if (resolved.kind !== "resolved") throw new Error("it resolves");
    const route = routeOf(resolved.provider, resolved.model, "");
    expect(route.kind).toBe("local");
    if (route.kind !== "local") throw new Error("not local");
    expect(route.row.command).toBe("stub-server");
    expect(route.model.id).toBe("qwen-7b");
  });

  test("the host's local module only connects; it never listens or logs", () => {
    const source = readFileSync(
      join(APP, "src-tauri", "src", "local_runtime.rs"),
      "utf8",
    );
    expect(source).toContain("TcpListener::bind");
    expect(source).toContain("connect_timeout");
    // The readiness budget and the idle default are stated, not implied.
    expect(source).toContain("Duration::from_secs(30)");
    expect(source).toContain("DEFAULT_IDLE_MINUTES");
    // The key never reaches a log or a stream.
    expect(source).not.toContain("println!");
    expect(source).not.toContain("eprintln!");
  });
});

/* ------------------------------------------------------------------ *
 * A REAL stub server process and the REAL sidecar: one offline turn.
 * ------------------------------------------------------------------ */

describe("a turn completes offline through a real local stub server", () => {
  test("the minted key is required, and the answer comes back", async () => {
    const port = await freePort();
    const key = "sk-local-" + randomBytes(16).toString("hex");
    const stub = await startStub(port, key);
    try {
      const row = localRow();
      const model = row.models[0];
      const route = routeOf(row, model, "");
      if (route.kind !== "local") throw new Error("the route is not local");
      const answer = await runRoute(
        transportOf(),
        route,
        buildTurnMessages("what is 40 + 2?"),
        {
          timeoutMs: 10_000,
          local: async () => ({
            kind: "running",
            provider: {
              baseUrl: localBaseUrl(stub.port),
              model: model.id,
              apiKey: stub.key,
            },
          }),
        },
      );
      if (answer.kind !== "answer") throw new Error(answer.sentence);
      expect(answer.text).toContain("the stub answered qwen-7b");
      // The stub's own readiness line proves the process, not a mock, answered.
      expect(stub.readyLine).toContain("the stub is ready");
    } finally {
      stub.child.kill();
      await stub.child.exited;
    }
  });

  test("a key the launch did not mint is refused by the loopback server", async () => {
    const port = await freePort();
    const key = "sk-local-" + randomBytes(16).toString("hex");
    const stub = await startStub(port, key);
    try {
      const row = localRow();
      const route = routeOf(row, row.models[0], "");
      if (route.kind !== "local") throw new Error("the route is not local");
      const answer = await runRoute(
        transportOf(),
        route,
        buildTurnMessages("what is 40 + 2?"),
        {
          timeoutMs: 10_000,
          local: async () => ({
            kind: "running",
            provider: {
              baseUrl: localBaseUrl(stub.port),
              model: row.models[0].id,
              apiKey: "the wrong key",
            },
          }),
        },
      );
      expect(answer.kind).toBe("error");
      if (answer.kind !== "error") throw new Error("expected an error");
      expect(answer.sentence).not.toContain(key);
    } finally {
      stub.child.kill();
      await stub.child.exited;
    }
  });
});
