import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACP_SENTENCES,
  ACP_SPECS,
  acpDeclaration,
  acpMissingKeySentence,
  isAbsoluteCommand,
  shippedAcpSpec,
  validateAcpSpec,
  type AcpSpec,
} from "../src/turn/acpSpecs";
import {
  ACP_CHILD_WORDS_MAX,
  ACP_RUN_SENTENCES,
  acpChildExitSentence,
  acpInheritedEnvironment,
  acpIsTransportTeardown,
  acpPromptTimeoutMs,
  acpRunEnvironment,
  startAcpRun,
  type AcpProgressEntry,
  type AcpRunOptions,
} from "../src/turn/acpRun";
import {
  allowOnceOption,
  optionIdForChoice,
  refuseOption,
} from "../src/turn/acpEntries";
import { bunSpawn } from "../src/turn/acp";
import { renderedMapContent } from "../src/canvas/mapContentRules";

/**
 * Story 18.2 — A TOOL ROW AND ONE HEADLESS RUN, PROVEN AGAINST THE FAKE SERVER.
 *
 * Two halves, both required by the story:
 *
 *   1. The ROW is values: an absolute command, argv entries (never a shell
 *      string), a session directory policy, and optional env entries that NAME
 *      a provider row — no key field anywhere. A shipped DSH row says it is
 *      unverified and grants no key, so a real run refuses honestly.
 *
 *   2. The RUN is a lifecycle: one ordered progress sequence, the caller's
 *      permission reply, cancel, close, and no child left behind. Every ending
 *      is exercised — completed, stopped, failed, timed-out — and the child's
 *      own environment report proves the env rule: exactly PATH/HOME plus the
 *      row's declared key, never this app's key store.
 *
 * The fake server is a real child on real pipes; the report it writes is the
 * child's own view (pid, argv, env), written outside the run's session
 * directory. No network, no account, no real key: every "key" below is a
 * made-up sentinel.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const BUN = process.execPath;
const FAKE = join(import.meta.dir, "fixtures", "acp-fake-server.ts");
const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-acp-run-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

interface Report {
  pid: number;
  argv: string[];
  env: Record<string, string>;
}

function spec(overrides: Partial<AcpSpec> = {}): AcpSpec {
  return {
    kind: "acp",
    id: "fake",
    name: "Fake ACP",
    verified: false,
    command: BUN,
    args: [FAKE, "normal"],
    cwdPolicy: "session",
    env: [],
    timeoutMinutes: 1,
    notes: "a test row",
    ...overrides,
  };
}

interface Started {
  env: Record<string, string> | null;
  /** The progress entries that existed WHEN the spawn happened. */
  at: AcpProgressEntry[];
}

interface BeginOptions {
  readKey?: AcpRunOptions["readKey"];
  replyToPermission?: AcpRunOptions["replyToPermission"];
  environment?: Record<string, string | undefined>;
  timeoutMs?: number;
  requestTimeoutMs?: number;
}

/** Start a run against the fake and keep everything a proof needs. */
function begin(
  mode: string,
  options: BeginOptions = {},
  rowOverrides: Partial<AcpSpec> = {},
) {
  const workspace = mkdtempSync(join(ROOT, "run-"));
  const sessionRoot = join(workspace, "sessions");
  mkdirSync(sessionRoot);
  const reportPath = join(workspace, "report.json");
  const progress: AcpProgressEntry[] = [];
  const spawned: Started = { env: null, at: [] };

  const row = spec({
    args: [FAKE, mode, "--report", reportPath],
    ...rowOverrides,
  });
  const handle = startAcpRun(row, "one prompt", {
    readKey: options.readKey ?? (async () => ""),
    replyToPermission:
      options.replyToPermission ?? (() => ({ optionId: "reject-once" })),
    environment: options.environment ?? {
      PATH: "/usr/bin",
      HOME: "/home/person",
    },
    sessionRoot,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs }),
    onProgress: (entry) => progress.push(entry),
    spawn: (command, args, spawnOptions) => {
      spawned.env = { ...(spawnOptions.env ?? {}) };
      spawned.at = [...progress];
      return bunSpawn(command, args, spawnOptions);
    },
  });

  return {
    handle,
    progress,
    reportPath,
    workspace,
    sessionRoot,
    spawned,
    report(): Report {
      return JSON.parse(readFileSync(reportPath, "utf8")) as Report;
    },
  };
}

async function waitFor(check: () => boolean, budgetMs = 3_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > budgetMs) {
      throw new Error("timed out waiting for the fake server");
    }
    await Bun.sleep(5);
  }
}

/** Did this pid go away? The child is reaped by close, so this settles quickly. */
async function gone(pid: number): Promise<boolean> {
  for (let at = 0; at < 100; at += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await Bun.sleep(10);
  }
  return false;
}

function updatesOf(entries: readonly AcpProgressEntry[]): string[] {
  return entries
    .filter((entry) => entry.kind === "update")
    .map((entry) => (entry.kind === "update" ? entry.text : ""));
}

function startedEntry(entries: readonly AcpProgressEntry[]) {
  const first = entries[0];
  if (first === undefined || first.kind !== "started") {
    throw new Error("the first entry is not started");
  }
  return first;
}

/* ------------------------------------------------------------------ *
 * The row.
 * ------------------------------------------------------------------ */

describe("the ACP row is data, and a key is never one of its fields", () => {
  test("an absolute command is a row; a bare name is refused", () => {
    const relative = validateAcpSpec({
      name: "Mine",
      command: "dsh",
      args: ["--profile", "acp"],
    });
    expect(relative).toEqual({
      kind: "refused",
      sentence: ACP_SENTENCES.relativeCommand,
    });

    const accepted = validateAcpSpec({
      name: "Mine",
      command: "/opt/acp/server",
      args: ["--profile", "acp"],
    });
    expect(accepted.kind).toBe("row");
    if (accepted.kind !== "row") throw new Error("unreachable");
    expect(accepted.row).toMatchObject({
      kind: "acp",
      id: "mine",
      command: "/opt/acp/server",
      args: ["--profile", "acp"],
      cwdPolicy: "session",
      env: [],
    });

    expect(isAbsoluteCommand("/opt/acp")).toBe(true);
    expect(isAbsoluteCommand("C:\\\\Program Files\\\\acp.exe")).toBe(true);
    expect(isAbsoluteCommand("\\\\\\\\server\\\\share\\\\acp.exe")).toBe(true);
    expect(isAbsoluteCommand("dsh")).toBe(false);
    expect(isAbsoluteCommand("")).toBe(false);
  });

  test("argv entries stay entries, spaces and all", () => {
    const accepted = validateAcpSpec({
      name: "Mine",
      command: "/opt/acp/server",
      args: ["--profile", "acp", "two words stay one entry"],
    });
    if (accepted.kind !== "row") throw new Error("unreachable");
    expect(accepted.row.args).toEqual([
      "--profile",
      "acp",
      "two words stay one entry",
    ]);
  });

  test("an env entry names a provider row that exists, and nothing else", () => {
    const accepted = validateAcpSpec(
      {
        name: "Mine",
        command: "/opt/acp/server",
        args: ["--profile", "acp"],
        env: [{ name: "DEEPSEEK_API_KEY", key: "deepseek" }],
      },
      [],
      ["deepseek"],
    );
    expect(accepted.kind).toBe("row");
    if (accepted.kind !== "row") throw new Error("unreachable");
    expect(accepted.row.env).toEqual([
      { name: "DEEPSEEK_API_KEY", key: "deepseek" },
    ]);
    // The entry has a name and a row id; the type has no place for a value.
    expect(Object.keys(accepted.row.env[0]).sort()).toEqual(["key", "name"]);
  });

  test("a grant to a missing row, a bad name, a duplicate and a bad policy are refused", () => {
    const base = {
      name: "Mine",
      command: "/opt/acp/server",
      args: ["--profile", "acp"],
    };
    const unknown = validateAcpSpec(
      { ...base, env: [{ name: "DEEPSEEK_API_KEY", key: "gone" }] },
      [],
      ["deepseek"],
    );
    expect(unknown.kind).toBe("refused");
    if (unknown.kind !== "refused") throw new Error("unreachable");
    expect(unknown.sentence).toContain("gone");
    expect(unknown.sentence).toContain("not one of your provider rows");

    expect(
      validateAcpSpec(
        { ...base, env: [{ name: "not a name", key: "deepseek" }] },
        [],
        ["deepseek"],
      ),
    ).toEqual({ kind: "refused", sentence: ACP_SENTENCES.envName });

    expect(
      validateAcpSpec(
        {
          ...base,
          env: [
            { name: "DEEPSEEK_API_KEY", key: "deepseek" },
            { name: "DEEPSEEK_API_KEY", key: "deepseek-2" },
          ],
        },
        [],
        ["deepseek", "deepseek-2"],
      ),
    ).toEqual({ kind: "refused", sentence: ACP_SENTENCES.duplicateName });

    expect(
      validateAcpSpec({ ...base, cwdPolicy: "workspace" }),
    ).toEqual({ kind: "refused", sentence: ACP_SENTENCES.badCwdPolicy });

    expect(
      validateAcpSpec({ ...base, timeoutMinutes: 0.5 }),
    ).toEqual({ kind: "refused", sentence: ACP_SENTENCES.timeout });
  });

  test("the shipped DSH row is UNVERIFIED, argv-only and grants no key", () => {
    const dsh = shippedAcpSpec("dsh-acp");
    expect(dsh).not.toBeNull();
    if (dsh === null) throw new Error("unreachable");
    expect(dsh.args).toEqual([
      "--profile",
      "acp",
      "--patch",
      "/home/kickapookid/bin/dsh-account-route.yml",
    ]);
    expect(dsh.env).toEqual([]);
    expect(dsh.cwdPolicy).toBe("session");
    expect(dsh.notes).toContain("UNVERIFIED");
    expect(dsh.notes).toContain("missing key");
    expect(shippedAcpSpec("something-else")).toBeNull();

    // The shipped row is a valid row; its honesty is the empty env list.
    const read = validateAcpSpec(
      {
        id: dsh.id,
        name: dsh.name,
        command: dsh.command,
        args: dsh.args,
        cwdPolicy: dsh.cwdPolicy,
        env: dsh.env,
        timeoutMinutes: dsh.timeoutMinutes,
      },
      [],
      [],
    );
    expect(read.kind).toBe("row");
    // Story 18.6 ships a SECOND row; both are rows, neither is code.
    expect(ACP_SPECS.map((entry) => entry.kind)).toEqual(["acp", "acp"]);
  });
});

/* ------------------------------------------------------------------ *
 * The declaration and the inherited environment — the env rule as values.
 * ------------------------------------------------------------------ */

describe("the env rule is a sentence and a pair of names", () => {
  test("the declaration names rows, never values", () => {
    expect(acpDeclaration(spec())).toBe(
      "this run will receive no key: no environment entry names a provider row",
    );
    expect(
      acpDeclaration(
        spec({ env: [{ name: "DEEPSEEK_API_KEY", key: "deepseek" }] }),
      ),
    ).toBe("this run will receive the key named deepseek");
    expect(
      acpDeclaration(
        spec({
          env: [
            { name: "DEEPSEEK_API_KEY", key: "deepseek" },
            { name: "OTHER_KEY", key: "other" },
          ],
        }),
      ),
    ).toBe("this run will receive the keys named deepseek and other");
  });

  test("only PATH and HOME are inherited, and a declared key is added by name", () => {
    const parent = {
      PATH: "/usr/bin",
      HOME: "/home/person",
      DEEPSEEK_API_KEY: "sk-parent-sentinel",
      ATTENTIONEER_OTHER: "sk-other-sentinel",
    };
    expect(acpInheritedEnvironment(parent)).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/person",
    });
    expect(acpInheritedEnvironment({ PATH: "/usr/bin" })).toEqual({
      PATH: "/usr/bin",
    });

    const row = spec({
      env: [{ name: "DEEPSEEK_API_KEY", key: "deepseek" }],
    });
    expect(
      acpRunEnvironment(row, new Map([["deepseek", "sk-child-secret"]]), parent),
    ).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/person",
      DEEPSEEK_API_KEY: "sk-child-secret",
    });
  });
});

/* ------------------------------------------------------------------ *
 * STORY 18.4 — the no-always rule, as a value.
 * ------------------------------------------------------------------ */

describe("an always option is never a choice this app can make", () => {
  const once = { optionId: "allow-once", name: "Allow once", kind: "allow_once" };
  const always = {
    optionId: "allow-always",
    name: "Allow always",
    kind: "allow_always",
  };
  const reject = { optionId: "reject-once", name: "Reject", kind: "reject_once" };

  test("allow-once matches only allow_once, and refuse matches a reject", () => {
    const offered = [once, always, reject];
    expect(allowOnceOption(offered)).toEqual(once);
    expect(refuseOption(offered)).toEqual(reject);
    expect(optionIdForChoice("allow-once", offered)).toBe("allow-once");
    expect(optionIdForChoice("refuse", offered)).toBe("reject-once");
  });

  test("a server that offers only always cannot produce an allow", () => {
    const offered = [always, reject];
    expect(allowOnceOption(offered)).toBeNull();
    // No fallback to the remembered yes: the only possible allow is null, which
    // the transport sends as a cancelled outcome.
    expect(optionIdForChoice("allow-once", offered)).toBeNull();
    expect(optionIdForChoice("allow-once", offered)).not.toBe("allow-always");
  });

  test("the fake server really offers one, so the rule is tested against it", async () => {
    const run = begin("normal", {
      replyToPermission: () => ({ optionId: "allow-once" }),
    });
    const result = await run.handle.result;
    const permission = result.entries.find((entry) => entry.kind === "permission");
    if (permission === undefined || permission.kind !== "permission") {
      throw new Error("no permission entry");
    }
    expect(permission.options.map((option) => option.kind)).toContain(
      "allow_always",
    );
    expect(JSON.stringify(permission.reply)).not.toContain("allow-always");
  });
});

/* ------------------------------------------------------------------ *
 * The run — every ending, against the fake server.
 * ------------------------------------------------------------------ */

describe("one headless run, every ending", () => {
  test("a completed run relays its ordered sequence and the caller's allow", async () => {
    const run = begin("normal", {
      replyToPermission: () => ({ optionId: "allow-once" }),
    });
    const result = await run.handle.result;

    expect(result.ending).toBe("completed");
    expect(result.answer).toBe("one allowed two");
    expect(result.partial).toBeNull();
    expect(result.stopReason).toBe("end_turn");
    expect(result.sentence).toBeNull();
    expect(result.sessionId).toBe("fake-session");
    expect(typeof result.childExitCode).toBe("number");

    const order = result.entries.map((entry) =>
      entry.kind === "update" ? entry.text : entry.kind,
    );
    expect(order).toEqual([
      "started",
      "session",
      "one ",
      "permission",
      "allowed ",
      "two",
      "ended",
    ]);
    expect(updatesOf(result.entries)).toEqual(["one ", "allowed ", "two"]);

    const permission = result.entries.find(
      (entry) => entry.kind === "permission",
    );
    if (permission === undefined || permission.kind !== "permission") {
      throw new Error("no permission entry");
    }
    // STORY 18.4: the fake offers an "always" option, and the run carries the
    // server's options WHOLE. What it never does is choose one: the caller's
    // allow-once reply is the only allow that crossed.
    expect(permission.options.map((option) => option.kind)).toEqual([
      "allow_once",
      "allow_always",
      "reject_once",
    ]);
    expect(permission.reply).toEqual({
      outcome: "selected",
      optionId: "allow-once",
    });

    const started = startedEntry(result.entries);
    expect(started.declaration).toBe(
      "this run will receive no key: no environment entry names a provider row",
    );
    expect(started.inherited).toEqual(["PATH", "HOME"]);
    expect(started.cwd).toBe(result.directory!);
    expect(result.directory!.startsWith(run.sessionRoot)).toBe(true);
    // Nothing written by us (or the fake) in the session directory.
    expect(readdirSync(result.directory!)).toEqual([]);
    // The child is dead after the ending.
    expect(await gone(run.report().pid)).toBe(true);
    expect(existsSync(run.reportPath + ".cancel")).toBe(false);
  });

  test("the caller's refusal is what crosses the wire", async () => {
    const run = begin("normal", {
      replyToPermission: () => ({ optionId: "reject-once" }),
    });
    const result = await run.handle.result;

    expect(result.ending).toBe("completed");
    expect(result.answer).toBe("one refused two");
    const permission = result.entries.find(
      (entry) => entry.kind === "permission",
    );
    if (permission === undefined || permission.kind !== "permission") {
      throw new Error("no permission entry");
    }
    expect(permission.reply).toEqual({
      outcome: "selected",
      optionId: "reject-once",
    });
    expect(await gone(run.report().pid)).toBe(true);
  });

  test("cancel mid-stream stops the run and keeps the partial, marked as such", async () => {
    const run = begin("hang-mid-turn");
    await waitFor(() =>
      run.progress.some(
        (entry) => entry.kind === "update" && entry.text === "working ",
      ),
    );
    run.handle.cancel();
    const result = await run.handle.result;

    expect(result.ending).toBe("stopped");
    expect(result.answer).toBeNull();
    expect(result.partial).toBe("working ");
    expect(result.stopReason).toBe("cancelled");
    const ended = result.entries[result.entries.length - 1];
    expect(ended.kind).toBe("ended");
    if (ended.kind !== "ended") throw new Error("unreachable");
    expect(ended.ending).toBe("stopped");
    expect(ended.partial).toBe(true);
    expect(readdirSync(result.directory!)).toEqual([]);
    expect(await gone(run.report().pid)).toBe(true);
    // The server saw session/cancel before the child was killed.
    expect(existsSync(run.reportPath + ".cancel")).toBe(true);
  });

  test("a dying server is failed, with what arrived kept", async () => {
    const run = begin("die-mid-turn");
    const result = await run.handle.result;

    expect(result.ending).toBe("failed");
    expect(result.answer).toBeNull();
    expect(result.partial).toBe("one ");
    expect(result.sentence).toContain("the server exited (code 3)");
    expect(updatesOf(result.entries)).toEqual(["one "]);
    expect(await gone(run.report().pid)).toBe(true);
  });

  test("a silent server is timed out, not failed or pretended", async () => {
    const run = begin("silent", { timeoutMs: 250 });
    const result = await run.handle.result;

    expect(result.ending).toBe("timed-out");
    expect(result.answer).toBeNull();
    expect(result.partial).toBeNull();
    expect(result.sentence).toBe(ACP_RUN_SENTENCES.timedOut);
    expect(await gone(run.report().pid)).toBe(true);
  });

  test("the prompt's wait is the run's remaining budget (the seam's value)", () => {
    // STORY 22.2 — the prompt does not wait a transport constant; it waits
    // what the row's budget has left. This is the value the call is handed.
    expect(acpPromptTimeoutMs(10 * 60_000, 0)).toBe(600_000);
    expect(acpPromptTimeoutMs(10 * 60_000, 12_000)).toBe(588_000);
    // A budget already gone is the smallest honest wait; the budget timer
    // states the ending, not this number.
    expect(acpPromptTimeoutMs(5, 50)).toBe(1);
  });

  test("a turn that answers after the old flat wait finishes normally", async () => {
    // The old flat transport constant stands in as 200 ms; the row's own
    // budget is a minute. The turn streams for about half a second and answers
    // last, so a prompt bounded by the flat default would have failed here.
    const run = begin("slow-turn", { requestTimeoutMs: 200 });
    const result = await run.handle.result;

    expect(result.ending).toBe("completed");
    expect(result.answer).toContain("step 4");
    expect(result.partial).toBeNull();
    expect(result.stopReason).toBe("end_turn");
    expect(await gone(run.report().pid)).toBe(true);
  });

  /* ---------------------------------------------------------------- *
   * STORY 22.3 — WHO ENDED THE CHILD IS THE RUN'S TO SAY.
   * ---------------------------------------------------------------- */

  test("a budget that tears the child down is a timeout, never a teardown sentence", async () => {
    // The fake streams for about half a second and the budget is 150 ms, so the
    // turn is mid-stream when the budget ends it. The transport's exit watcher
    // says "the server exited (code N)" at the same moment; that sentence is
    // true of the pipe, not of the work, so the run's own ending must win.
    const run = begin("slow-turn", { timeoutMs: 150 });
    const result = await run.handle.result;

    expect(result.ending).toBe("timed-out");
    expect(result.sentence).toBe(ACP_RUN_SENTENCES.timedOut);
    expect(result.sentence).not.toContain("the server exited");
    expect(result.sentence).not.toContain("the transport closed");
    expect(await gone(run.report().pid)).toBe(true);
  });

  test("a person's stop is stopped, not a teardown sentence", async () => {
    const run = begin("slow-turn");
    await waitFor(() =>
      run.progress.some(
        (entry) => entry.kind === "update" && entry.text === "step 1 ",
      ),
    );
    run.handle.cancel();
    const result = await run.handle.result;

    expect(result.ending).toBe("stopped");
    expect(result.sentence).toBeNull();
    // The fake settled the turn as end_turn when it saw the cancel; the run's
    // own stop is still the ending that is said, and its sentence is the run's
    // silence rather than a teardown line.
    expect(result.stopReason).toBe("end_turn");
    expect(await gone(run.report().pid)).toBe(true);
  });

  test("a child that really died early keeps its exit sentence and its last words", async () => {
    const run = begin("die-after-handshake");
    const result = await run.handle.result;

    expect(result.ending).toBe("failed");
    expect(result.sentence).toContain("the server exited (code 4)");
    expect(result.sentence).toContain(
      "its last words were: the model route answered nothing for a while",
    );
    // The newest line, never the first one the child wrote.
    expect(result.sentence).not.toContain("woke up wrong");
    expect(await gone(run.report().pid)).toBe(true);
  });

  test("the last words are one clipped line, and only a child exit says them", () => {
    expect(ACP_CHILD_WORDS_MAX).toBe(200);
    // The transport's own vocabulary — and nothing a run or a server says
    // about the work — is what the mapping recognises.
    expect(acpIsTransportTeardown("the transport closed")).toBe(true);
    expect(acpIsTransportTeardown("the server exited (code 0)")).toBe(true);
    expect(acpIsTransportTeardown("the server exited (code -1)")).toBe(true);
    expect(
      acpIsTransportTeardown(
        "the run ran out of its budget, so what arrived is a partial, not a result",
      ),
    ).toBe(false);
    expect(
      acpIsTransportTeardown("the server did not answer session/prompt in time"),
    ).toBe(false);
    // One line: the child's own line breaks become spaces.
    expect(acpChildExitSentence("the server exited (code 7)", "a\nb\nc")).toBe(
      "the server exited (code 7); its last words were: a b c",
    );
    // A child that said nothing on stderr keeps the bare sentence.
    expect(acpChildExitSentence("the server exited (code 7)", "")).toBe(
      "the server exited (code 7)",
    );
    // A long line is cut, with an ellipsis, inside the bound.
    const prefix = "the server exited (code 7); its last words were: ";
    const long = acpChildExitSentence(
      "the server exited (code 7)",
      "y".repeat(600),
    );
    expect(long.endsWith("…")).toBe(true);
    expect(long.length).toBeLessThanOrEqual(prefix.length + ACP_CHILD_WORDS_MAX);
    expect(long).not.toContain("y".repeat(250));
    // The run's own endings never carry the tail.
    expect(ACP_RUN_SENTENCES.timedOut).not.toContain("last words");
  });
});

/* ------------------------------------------------------------------ *
 * The env rule, proven by the child's own report; the key never travels.
 * ------------------------------------------------------------------ */

describe("the child receives exactly the declared env, and no key leaks", () => {
  test("the declaration is emitted before the spawn, and the child env is exact", async () => {
    const parentSecret = "sk-parent-sentinel-8d1";
    const otherSecret = "sk-other-sentinel-3f7";
    const childSecret = "sk-child-secret-5a2";
    let reads = 0;

    const run = begin(
      "normal",
      {
        replyToPermission: () => ({ optionId: "reject-once" }),
        readKey: async (providerId) => {
          reads += 1;
          return providerId === "deepseek" ? childSecret : "";
        },
        environment: {
          PATH: "/usr/bin",
          HOME: "/home/person",
          DEEPSEEK_API_KEY: parentSecret,
          ATTENTIONEER_OTHER: otherSecret,
        },
      },
      { env: [{ name: "DEEPSEEK_API_KEY", key: "deepseek" }] },
    );
    const result = await run.handle.result;
    expect(result.ending).toBe("completed");
    expect(reads).toBe(1);

    // The declaration existed BEFORE the spawn and named the row, not the key.
    expect(run.spawned.at.map((entry) => entry.kind)).toEqual(["started"]);
    const declared = startedEntry(run.spawned.at);
    expect(declared.declaration).toBe(
      "this run will receive the key named deepseek",
    );
    expect(declared.envNames).toEqual(["DEEPSEEK_API_KEY"]);
    expect(declared.inherited).toEqual(["PATH", "HOME"]);

    // The spawn's env is exactly PATH, HOME and the one declared key.
    expect(run.spawned.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/person",
      DEEPSEEK_API_KEY: childSecret,
    });

    // And the child's own report agrees — no inherited key store, nothing else.
    const report = run.report();
    expect(report.env).toEqual({
      PATH: "/usr/bin",
      HOME: "/home/person",
      DEEPSEEK_API_KEY: childSecret,
    });
    expect(report.env.DEEPSEEK_API_KEY).not.toBe(parentSecret);

    // No key in argv, in any progress entry or in any sentence the run emits.
    const emitted = JSON.stringify(result) + JSON.stringify(run.progress);
    for (const secret of [parentSecret, otherSecret, childSecret]) {
      expect(report.argv.join("\u0000")).not.toContain(secret);
      expect(emitted).not.toContain(secret);
    }
    expect(await gone(report.pid)).toBe(true);
  });

  test("with no env entry the child gets PATH/HOME only, even when a key is held", async () => {
    const parentSecret = "sk-parent-sentinel-0b4";
    const run = begin("normal", {
      replyToPermission: () => ({ optionId: "reject-once" }),
      readKey: async () => {
        throw new Error("no env entry names a key, so none may be read");
      },
      environment: {
        PATH: "/usr/bin",
        HOME: "/home/person",
        DEEPSEEK_API_KEY: parentSecret,
      },
    });
    const result = await run.handle.result;
    expect(result.ending).toBe("completed");
    expect(startedEntry(result.entries).declaration).toBe(
      "this run will receive no key: no environment entry names a provider row",
    );
    expect(run.report().env).toEqual({ PATH: "/usr/bin", HOME: "/home/person" });
    expect(JSON.stringify(result)).not.toContain(parentSecret);
    expect(JSON.stringify(run.progress)).not.toContain(parentSecret);
  });

  test("a declared key that is not kept refuses before any spawn", async () => {
    const run = begin(
      "normal",
      { readKey: async () => "" },
      { env: [{ name: "DEEPSEEK_API_KEY", key: "deepseek" }] },
    );
    const result = await run.handle.result;

    expect(result.ending).toBe("failed");
    expect(result.sentence).toBe(acpMissingKeySentence("deepseek"));
    expect(result.answer).toBeNull();
    expect(result.partial).toBeNull();
    expect(result.childExitCode).toBeNull();
    expect(result.directory).toBeNull();
    expect(run.spawned.env).toBeNull();
    // Nothing was spawned, so no report exists.
    expect(() => readFileSync(run.reportPath, "utf8")).toThrow();
    expect(result.entries.map((entry) => entry.kind)).toEqual(["ended"]);
  });
});

/* ------------------------------------------------------------------ *
 * The story's boundaries: no map write, no log, no shell.
 * ------------------------------------------------------------------ */

describe("a run touches the map not at all and logs no line", () => {
  test("renderedMapContent('ground') stays empty", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("the run module has no console and no file write", () => {
    const source = readFileSync(join(APP, "src/turn/acpRun.ts"), "utf8");
    expect(source).not.toContain("console.");
    expect(source).not.toContain("writeFile");
    expect(source).not.toContain("renderedMapContent");
    // The env entries are argv-free and carry no value field: only a row id.
    const specs = readFileSync(join(APP, "src/turn/acpSpecs.ts"), "utf8");
    expect(specs).not.toContain("apiKey");
    expect(specs).not.toContain("secret");
  });
});
