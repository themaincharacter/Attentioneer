import { afterAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CLI_SPECS,
  PROMPT_PLACEHOLDER,
  shippedSpec,
  type CliSpec,
} from "../src/turn/cliSpecs";
import {
  authVerdict,
  buildCliArgs,
  cliAnswer,
  commandLooksLikePath,
  executableNames,
  firstLine,
  probeCli,
  promptTemplateProblem,
  resolutionSentence,
  resolveCliCommand,
  versionLine,
  type CliFacts,
  type CliProcess,
  type CliRefusal,
  type CliResolveFacts,
} from "../src/turn/cli";
import {
  EMPTY_SETTINGS,
  PROVIDER_SENTENCES,
  cliSpecOf,
  parseProviderRow,
  readTurnSettings,
  resolveSelection,
  storedTurnSettings,
  validateCliProviderRow,
  withProvider,
  withSelection,
  type CliProviderRow,
  type ProviderRow,
} from "../src/turn/providers";
import {
  cliPromptOf,
  routeOf,
  runRoute,
  runRoutePacket,
  type TurnTransport,
} from "../src/turn/turn";

/**
 * Story 15.5 — THE EXTERNAL CLI TIER, PROVEN BY ADDING ONE THE APP NEVER KNEW.
 *
 * The rules that can be decided as values are pinned as values: the
 * resolution ORDER and the sentence that says which step found the command,
 * the one-argument prompt, the version line, and the sign-in verdict (with
 * "this probe does not apply" as a state of its own). Then the SAME rules run
 * against a REAL temp script through the turn — the prompt arrives as one
 * argv entry with spaces and quotes intact, a non-zero exit is one sentence
 * and the first stderr line, and the answer is the script's own output.
 *
 * The last describe is the hard constraint: the shipped list is DATA, and no
 * source file the dispatch runs through mentions a vendor at all.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

/** Comments only, strings kept (for assertions ABOUT a string literal). */
function withoutComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

/** Strip comments and string/template literals: only CODE is left. */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");
}

/* ------------------------------------------------------------------ *
 * Resolution: typed path, then PATH, then a small well-known list.
 * ------------------------------------------------------------------ */

function facts(options: {
  files: readonly string[];
  pathDirs?: readonly string[];
  home?: string;
  platform?: CliResolveFacts["platform"];
}): CliResolveFacts {
  const files = new Set(options.files);
  return {
    platform: options.platform ?? "linux",
    pathDirs: options.pathDirs ?? [],
    home: options.home ?? "/home/person",
    exists: (path: string) => files.has(path),
  };
}

const spec = (overrides: Partial<CliSpec> = {}): CliSpec => ({
  id: "mine",
  name: "Mine",
  command: "thinking",
  versionArgs: ["--version"],
  run: { args: [PROMPT_PLACEHOLDER], read: "stdout" },
  notes: "a test spec",
  ...overrides,
});

describe("a command resolves in one stated order, and the app says which step", () => {
  test("the typed path wins over PATH and the usual places", () => {
    const resolved = resolveCliCommand(
      "/srv/tools/thinking",
      spec(),
      facts({
        files: ["/srv/tools/thinking", "/on/path/thinking", "/home/person/.local/bin/thinking"],
        pathDirs: ["/on/path"],
      }),
    );
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") throw new Error("unreachable");
    expect(resolved.where).toEqual({
      path: "/srv/tools/thinking",
      how: "typed-path",
    });
    expect(resolutionSentence(resolved.where)).toContain("the path you typed");
  });

  test("a bare name is looked for on PATH first, then in the usual places", () => {
    const onPath = resolveCliCommand(
      "thinking",
      spec(),
      facts({
        files: ["/on/path/thinking", "/home/person/.local/bin/thinking"],
        pathDirs: ["/on/path"],
      }),
    );
    if (onPath.kind !== "resolved") throw new Error("unreachable");
    expect(onPath.where).toEqual({ path: "/on/path/thinking", how: "path" });
    expect(resolutionSentence(onPath.where)).toContain("on PATH");

    const usual = resolveCliCommand(
      "thinking",
      spec(),
      facts({ files: ["/home/person/.local/bin/thinking"] }),
    );
    if (usual.kind !== "resolved") throw new Error("unreachable");
    expect(usual.where.how).toBe("well-known");
    expect(resolutionSentence(usual.where)).toContain("well-known location");
  });

  test("the spec's own places are tried before the defaults", () => {
    const resolved = resolveCliCommand(
      "thinking",
      spec({ wellKnown: ["~/.thinking/bin"] }),
      facts({
        files: ["/home/person/.thinking/bin/thinking", "/home/person/.local/bin/thinking"],
      }),
    );
    if (resolved.kind !== "resolved") throw new Error("unreachable");
    expect(resolved.where.path).toBe("/home/person/.thinking/bin/thinking");
  });

  test("nothing anywhere is a refusal in one sentence, never a guess", () => {
    const refused = resolveCliCommand("thinking", spec(), facts({ files: [] }));
    expect(refused.kind).toBe("refused");
    if (refused.kind !== "refused") throw new Error("unreachable");
    expect(refused.sentence).toContain("thinking");
    expect(refused.sentence).toContain("was not found");
  });

  test("a typed path that names nothing is not guessed around", () => {
    // A same-named program on PATH must not be run just because the typed
    // path was mistyped: the person named a path.
    const refused = resolveCliCommand(
      "/srv/tools/absent",
      spec(),
      facts({ files: ["/on/path/absent"], pathDirs: ["/on/path"] }),
    );
    expect(refused.kind).toBe("refused");
  });

  test("Windows tries the shim extensions the person does not type", () => {
    expect(executableNames("thinking", "windows")).toEqual([
      "thinking",
      "thinking.exe",
      "thinking.cmd",
      "thinking.bat",
    ]);
    expect(executableNames("thinking.cmd", "windows")).toEqual(["thinking.cmd"]);
    expect(executableNames("thinking", "linux")).toEqual(["thinking"]);
    expect(commandLooksLikePath("thinking", "linux")).toBe(false);
    expect(commandLooksLikePath("./tools/thinking", "linux")).toBe(true);
    expect(commandLooksLikePath("C:\\tools\\thinking.exe", "windows")).toBe(true);
    const resolved = resolveCliCommand(
      "thinking",
      spec(),
      facts({
        files: ["C:\\tools\\thinking.cmd"],
        pathDirs: ["C:\\tools"],
        platform: "windows",
      }),
    );
    if (resolved.kind !== "resolved") throw new Error("unreachable");
    expect(resolved.where.path).toBe("C:\\tools\\thinking.cmd");
  });
});

/* ------------------------------------------------------------------ *
 * The prompt is ONE argv entry.
 * ------------------------------------------------------------------ */

describe("the prompt becomes exactly one argv entry", () => {
  const prompt = 'two words, "quotes", a \n newline and a $dollar';

  test("it replaces {prompt} and never splits on anything", () => {
    const args = buildCliArgs(["-p", PROMPT_PLACEHOLDER, "--quiet"], prompt);
    expect(args).toEqual(["-p", prompt, "--quiet"]);
    expect(args[1]).toBe(prompt);
    // Nothing of the prompt leaked into a second entry.
    expect(args.filter((arg) => arg === prompt)).toHaveLength(1);
  });

  test("a run template needs the placeholder exactly once", () => {
    expect(promptTemplateProblem([])).toContain("{prompt}");
    expect(promptTemplateProblem(["-p", "hello"])).toContain("{prompt}");
    expect(promptTemplateProblem([PROMPT_PLACEHOLDER, PROMPT_PLACEHOLDER])).toContain(
      "only one",
    );
    expect(promptTemplateProblem(["-p", PROMPT_PLACEHOLDER])).toBeNull();
  });

  test("a CLI is handed the person's words, not the app's instruction", () => {
    expect(
      cliPromptOf([
        { role: "system", content: "the app's fixed instruction" },
        { role: "user", content: "the packet" },
      ]),
    ).toBe("the packet");
  });
});

/* ------------------------------------------------------------------ *
 * Version and sign-in: facts, never a verdict on the provider.
 * ------------------------------------------------------------------ */

function ran(overrides: Partial<CliFacts> = {}): CliFacts {
  return {
    path: "/usr/local/bin/thinking",
    how: "path",
    code: 0,
    stdout: "",
    stderr: "",
    timedOut: false,
    ...overrides,
  };
}

describe("the version probe shows what came back", () => {
  test("the first non-empty line, whatever the shape", () => {
    expect(versionLine(ran({ stdout: "thinking 1.2.3\nmore text\n" }))).toBe(
      "thinking 1.2.3",
    );
    expect(versionLine(ran({ stdout: "\n\n  v9  \n" }))).toBe("v9");
    // Odd output is still an answer: stderr stands in, and empty is empty.
    expect(versionLine(ran({ stderr: "from stderr" }))).toBe("from stderr");
    expect(versionLine(ran())).toBe("");
    expect(firstLine("a\r\nb")).toBe("a");
  });
});

describe("the sign-in probe applies only when the spec says how", () => {
  const auth = {
    args: ["auth", "status", "--json"],
    okPattern: '"loggedIn"\\s*:\\s*true',
  };

  test("no auth block means the probe does not apply, never signed out", () => {
    const verdict = authVerdict(spec(), null);
    expect(verdict.kind).toBe("not-applicable");
    expect(verdict.sentence).toContain("does not apply");
    expect(verdict.sentence).not.toContain("not signed in");
  });

  test("a matching probe is signed in; a non-matching one is not", () => {
    const signedIn = authVerdict(
      spec({ auth }),
      ran({ stdout: '{"loggedIn": true}' }),
    );
    expect(signedIn.kind).toBe("signed-in");
    expect(signedIn.sentence).toContain("is signed in");
    const signedOut = authVerdict(
      spec({ auth }),
      ran({ stdout: '{"loggedIn": false}' }),
    );
    expect(signedOut.kind).toBe("signed-out");
    expect(signedOut.sentence).toContain("is not signed in");
  });

  test("a probe that could not answer is undecided, not signed out", () => {
    for (const facts of [
      ran({ timedOut: true }),
      { kind: "refused", sentence: "nope" } as CliRefusal,
    ]) {
      const verdict = authVerdict(spec({ auth }), facts);
      expect(verdict.kind).toBe("undecided");
      expect(verdict.sentence).not.toContain("not signed in");
    }
  });
});

/* ------------------------------------------------------------------ *
 * The answer, or one sentence.
 * ------------------------------------------------------------------ */

describe("a run's facts become one answer or one sentence", () => {
  test("stdout is the answer", () => {
    expect(cliAnswer(spec(), ran({ stdout: "the answer\n" }))).toEqual({
      kind: "answer",
      text: "the answer",
    });
  });

  test("a non-zero exit is one sentence and the FIRST stderr line", () => {
    const outcome = cliAnswer(
      spec(),
      ran({ code: 3, stderr: "first line\nsecond line\ntrace\n" }),
    );
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") throw new Error("unreachable");
    expect(outcome.sentence).toContain("exited with 3");
    expect(outcome.sentence).toContain("first line");
    expect(outcome.sentence).not.toContain("second line");
    expect(outcome.sentence).not.toContain("\n");
  });

  test("a timeout is its own state: the child was killed, not answered", () => {
    expect(cliAnswer(spec(), ran({ timedOut: true, code: null }))).toEqual({
      kind: "timeout",
      sentence: "Mine did not answer in time and was stopped",
    });
  });

  test("a stop is its own outcome, never a timeout", () => {
    expect(
      cliAnswer(spec(), ran({ cancelled: true, timedOut: false, code: null })),
    ).toEqual({
      kind: "cancelled",
      sentence: "the turn was stopped",
    });
  });

  test("an empty answer is said plainly", () => {
    const outcome = cliAnswer(spec(), ran({ stdout: "  \n\n" }));
    expect(outcome.kind).toBe("error");
    if (outcome.kind !== "error") throw new Error("unreachable");
    expect(outcome.sentence).toContain("without saying anything");
  });
});

/* ------------------------------------------------------------------ *
 * ONE dispatch: the same route value runs a turn.
 * ------------------------------------------------------------------ */

const unusedTransport: TurnTransport = {
  send: async () => {
    throw new Error("a CLI turn must not touch the sidecar");
  },
  subscribe: () => () => {},
};

describe("one dispatch on the route's kind", () => {
  test("a CLI turn is handed a stop token, and a stopped run says so", async () => {
    let token = "";
    const result = await runRoute(
      unusedTransport,
      { kind: "cli", spec: spec() },
      [{ role: "user", content: "q" }],
      {
        cli: async (_spec, _args, _timeoutMs, runId) => {
          token = runId;
          return ran({ cancelled: true, timedOut: false, code: null });
        },
      },
    );
    // The token exists before the child and names it for a later stop.
    expect(token).not.toBe("");
    expect(result).toEqual({
      kind: "cancelled",
      sentence: "the turn was stopped",
    });
  });

  test("a CLI route runs the spec's argv and returns its stdout", async () => {
    const seen: string[][] = [];
    const result = await runRoute(
      unusedTransport,
      { kind: "cli", spec: spec() },
      [{ role: "user", content: "a question with spaces" }],
      {
        cli: async (_spec, args) => {
          seen.push([...args]);
          return ran({ stdout: "the answer\n" });
        },
      },
    );
    expect(result).toEqual({ kind: "answer", text: "the answer" });
    expect(seen).toEqual([["a question with spaces"]]);
  });

  test("a CLI route with no runner says so instead of pretending", async () => {
    const result = await runRoute(unusedTransport, { kind: "cli", spec: spec() }, [
      { role: "user", content: "q" },
    ]);
    expect(result).toEqual({
      kind: "error",
      sentence: "the CLI could not be started, so the turn did not leave",
    });
  });

  test("a CLI packet turn sends the packet's message and no follow-up", async () => {
    const answer = await runRoutePacket(
      unusedTransport,
      { kind: "cli", spec: spec() },
      {
        text: "the packet",
        messages: [
          { role: "system", content: "the app's instruction" },
          { role: "user", content: "the packet" },
        ],
        blocks: [],
        retrievable: ["rain"],
        declaration: { blocks: [], total: 0 },
      },
      async () => {
        throw new Error("a CLI turn performs no READ follow-up");
      },
      {
        cli: async (_spec, args) => {
          expect(args).toEqual(["the packet"]);
          return ran({ stdout: "READ: rain\nthe answer\n" });
        },
      },
    );
    expect(answer.read).toBeNull();
    expect(answer.missed).toBeNull();
    expect(answer.result).toEqual({
      kind: "answer",
      text: "READ: rain\nthe answer",
    });
    expect(answer.messages).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * Real temp scripts: a probe and a turn through a real process.
 * ------------------------------------------------------------------ */

const workspace = mkdtempSync(join(tmpdir(), "attentioneer-cli-tier-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

function script(name: string, body: string): string {
  const path = join(workspace, name);
  writeFileSync(path, body);
  chmodSync(path, 0o755);
  return path;
}

/** The same shape the Rust bridge answers: really spawn, no faking. */
function spawnProcess(): CliProcess {
  return async (runSpec: CliSpec, args: readonly string[]) => {
    const child = Bun.spawnSync({
      cmd: [runSpec.command, ...args],
      stdout: "pipe",
      stderr: "pipe",
    });
    return {
      path: runSpec.command,
      how: "typed-path",
      code: child.exitCode,
      stdout: child.stdout.toString(),
      stderr: child.stderr.toString(),
      timedOut: false,
    };
  };
}

const ECHO = `#!/bin/sh
if [ "\$1" = "--version" ]; then
  echo "my-echo 1.2.3"
  exit 0
fi
if [ "\$1" = "auth" ]; then
  echo '{"loggedIn": true}'
  exit 0
fi
printf 'you said: %s\\n' "\$1"
`;

describe("a real script is probed and turned to, end to end", () => {
  test("the REAL version probe and sign-in probe, by the same code", async () => {
    const path = script("echo", ECHO);
    const mine = spec({
      name: "My echo",
      command: path,
      auth: {
        args: ["auth"],
        okPattern: '"loggedIn"\\s*:\\s*true',
      },
    });
    const probed = await probeCli(mine, spawnProcess());
    expect(probed.kind).toBe("probed");
    if (probed.kind !== "probed") throw new Error("unreachable");
    expect(probed.where.how).toBe("typed-path");
    expect(resolutionSentence(probed.where)).toContain("the path you typed");
    expect(probed.version.line).toBe("my-echo 1.2.3");
    expect(probed.version.sentence).toContain("my-echo 1.2.3");
    expect(probed.auth.kind).toBe("signed-in");

    // The shipped shape, same code: no auth block -> does not apply.
    const plain = await probeCli(
      spec({ command: path, auth: undefined }),
      spawnProcess(),
    );
    if (plain.kind !== "probed") throw new Error("unreachable");
    expect(plain.auth.kind).toBe("not-applicable");
    expect(plain.auth.sentence).toContain("does not apply");
  });

  test("the REAL turn: a prompt with spaces and quotes is one argv entry", async () => {
    const path = script("echo", ECHO);
    const prompt = 'what do you see, "friend"?\ntwo lines';
    const result = await runRoute(
      unusedTransport,
      { kind: "cli", spec: spec({ name: "My echo", command: path }) },
      [{ role: "user", content: prompt }],
      { cli: spawnProcess() },
    );
    expect(result).toEqual({
      kind: "answer",
      text: 'you said: ' + prompt,
    });
  });

  test("the REAL failure: one sentence and the first stderr line", async () => {
    const path = script(
      "failing",
      `#!/bin/sh
echo "the first line" >&2
echo "the second line" >&2
exit 3
`,
    );
    const result = await runRoute(
      unusedTransport,
      { kind: "cli", spec: spec({ name: "Failing", command: path }) },
      [{ role: "user", content: "q" }],
      { cli: spawnProcess() },
    );
    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("unreachable");
    expect(result.sentence).toContain("exited with 3");
    expect(result.sentence).toContain("the first line");
    expect(result.sentence).not.toContain("the second line");
    expect(result.sentence).not.toContain("\n");
  });
});

/* ------------------------------------------------------------------ *
 * Rows: the CLI kind is a row a spec makes.
 * ------------------------------------------------------------------ */

function cliRow(overrides: Partial<CliProviderRow> = {}): CliProviderRow {
  const read = validateCliProviderRow({
    name: "My echo",
    command: "/srv/tools/my-echo",
    versionArgs: ["--version"],
    runArgs: ["{prompt}"],
  });
  if (read.kind !== "row") throw new Error("unreachable");
  return { ...read.row, ...overrides };
}

describe("a CLI row is a spec the app can act on", () => {
  test("validated at the write, with one model named after its command", () => {
    const row = cliRow();
    expect(row.kind).toBe("cli");
    expect(row.id).toBe("my-echo");
    expect(row.models).toHaveLength(1);
    expect(row.models[0].id).toBe("my-echo");
    // A turn still carries providerId:modelId, for a CLI too.
    const chosen = withSelection(
      withProvider(EMPTY_SETTINGS, row),
      row.id,
      row.models[0].id,
    );
    expect(resolveSelection(chosen).kind).toBe("resolved");
  });

  test("refused when it could not carry a question", () => {
    expect(
      validateCliProviderRow({
        name: "",
        command: "x",
        versionArgs: ["--version"],
        runArgs: ["{prompt}"],
      }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.noName });
    expect(
      validateCliProviderRow({
        name: "Mine",
        command: " ",
        versionArgs: ["--version"],
        runArgs: ["{prompt}"],
      }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.cliNoCommand });
    expect(
      validateCliProviderRow({
        name: "Mine",
        command: "x",
        versionArgs: [],
        runArgs: ["{prompt}"],
      }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.cliNoVersion });
    expect(
      validateCliProviderRow({
        name: "Mine",
        command: "x",
        versionArgs: ["--version"],
        runArgs: ["-p", "hello"],
      }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.cliNoPrompt });
    expect(
      validateCliProviderRow({
        name: "Mine",
        command: "x",
        versionArgs: ["--version"],
        runArgs: ["{prompt}", "{prompt}"],
      }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.cliManyPrompts });
    expect(
      validateCliProviderRow({
        name: "Mine",
        command: "x",
        versionArgs: ["--version"],
        runArgs: ["{prompt}"],
        authArgs: ["auth"],
        okPattern: "",
      }),
    ).toEqual({ kind: "refused", sentence: PROVIDER_SENTENCES.cliNoPattern });
  });

  test("the row round-trips through the config, auth included", () => {
    const row = cliRow({
      auth: { args: ["auth", "status"], okPattern: "logged in" },
      wellKnown: ["~/.mine/bin"],
      notes: "a note",
    });
    const travel = JSON.parse(
      JSON.stringify(storedTurnSettings(withProvider(EMPTY_SETTINGS, row))),
    );
    const read = readTurnSettings(travel);
    const back = read.providers[0];
    expect(back.kind).toBe("cli");
    if (back.kind !== "cli") throw new Error("unreachable");
    expect(back).toEqual(row);
    // The stored row says which kind it is; an endpoint row never gained a
    // field, so an older config still reads as the endpoint it was.
    expect((travel.providers[0] as Record<string, unknown>).kind).toBe("cli");
    expect(parseProviderRow({ id: "old", name: "Old", baseUrl: "http://x", models: [] })).toEqual({
      kind: "http",
      id: "old",
      name: "Old",
      baseUrl: "http://x",
      models: [],
    });
  });

  test("a broken CLI row is dropped, never guessed at", () => {
    for (const value of [
      { kind: "cli", id: "a", name: "A", command: "", run: { args: ["{prompt}"] } },
      { kind: "cli", id: "a", name: "A", command: "x", run: { args: ["no placeholder"] } },
      { kind: "cli", id: "a", name: "A", command: "x" },
    ]) {
      expect(parseProviderRow(value)).toBeNull();
    }
  });

  test("the route is read from the row in ONE place", () => {
    const row = withProvider(EMPTY_SETTINGS, cliRow()).providers[0] as CliProviderRow;
    const route = routeOf(row, row.models[0], "sk-not-used");
    expect(route.kind).toBe("cli");
    if (route.kind !== "cli") throw new Error("unreachable");
    expect(route.spec.command).toBe("/srv/tools/my-echo");
    expect(cliSpecOf(row)).toEqual(route.spec);

    const http: ProviderRow = {
      kind: "http",
      id: "local",
      name: "Local",
      baseUrl: "http://x",
      models: [{ id: "m", name: "M", capabilities: { tools: false, vision: false } }],
    };
    const httpRoute = routeOf(http, http.models[0], "sk-kept");
    expect(httpRoute).toEqual({
      kind: "http",
      provider: { baseUrl: "http://x", model: "m", apiKey: "sk-kept" },
    });
  });
});

/* ------------------------------------------------------------------ *
 * The hard constraint: the shipped list is DATA.
 * ------------------------------------------------------------------ */

describe("the shipped list is data, and no vendor branch exists", () => {
  const VENDOR = /claude|codex|anthropic|openai/i;

  test("the two shipped specs are entries, with their argv shapes", () => {
    expect(CLI_SPECS.map((entry) => entry.id)).toEqual(["claude-code", "codex"]);
    const claude = shippedSpec("claude-code");
    const codex = shippedSpec("codex");
    expect(claude?.versionArgs).toEqual(["--version"]);
    expect(claude?.auth?.args).toEqual(["auth", "status", "--json"]);
    expect(claude?.run.args).toEqual(["-p", "{prompt}"]);
    expect(codex?.run.args).toEqual(["exec", "{prompt}"]);
    expect(codex?.auth?.args).toEqual(["login", "status"]);
    expect(shippedSpec("something-else")).toBeNull();
  });

  test("the spec data file names vendors only inside ITS strings", () => {
    const code = codeOf(source("turn/cliSpecs.ts"));
    expect(code).not.toMatch(VENDOR);
    // ...and the data itself did ship them.
    expect(source("turn/cliSpecs.ts")).toMatch(VENDOR);
  });

  test("no code path the dispatch runs through names a vendor", () => {
    for (const path of [
      "turn/cli.ts",
      "turn/providers.ts",
      "turn/turn.ts",
      "turn/sidecar.ts",
      "turn/cliBridge.ts",
      "turn/provider.ts",
      "turn/egress.ts",
    ]) {
      expect({ path, vendor: VENDOR.test(codeOf(source(path))) }).toEqual({
        path,
        vendor: false,
      });
    }
    const rust = readFileSync(join(APP, "src-tauri/src/cli.rs"), "utf8");
    expect(VENDOR.test(codeOf(rust))).toBe(false);
  });

  test("the dispatch reads the row's KIND, not its name", () => {
    // Strings stay here: the kind's NAME is the assertion.
    const turn = withoutComments(source("turn/turn.ts"));
    expect(turn).toContain('provider.kind === "cli"');
    expect(turn).toContain('route.kind === "http"');
    expect(turn).toContain('route.kind === "http"');
    expect(turn).toContain("runCliTurn(");
    // And the process layer is the host's, addressed by the same command name.
    const bridge = withoutComments(source("turn/cliBridge.ts"));
    expect(bridge).toContain('invoke<HostCliFacts>("cli_run"');
    expect(bridge).toContain('invoke<HostCliWhere>("cli_where"');
  });
});
