import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseRequestLine,
  parseSidecarLine,
  requestIdOf,
  runCancelLine,
  runEndLine,
  runPartLine,
  runPermissionLine,
  runPermissionReplyLine,
  runRequestLine,
  type RunRequest,
  type SidecarLine,
} from "../src/turn/protocol";
import { SESSION_RUN_UNREACHABLE, startSessionRun } from "../src/turn/acpSession";
import { acpMissingKeySentence, type AcpSpec } from "../src/turn/acpSpecs";
import type { SidecarStart } from "../src/turn/sidecar";
import type { TurnTransport } from "../src/turn/turn";
import {
  BUN,
  FAKE_SERVER,
  openSidecar,
  type SidecarPipe,
} from "./fixtures/sidecar-pipe";

/**
 * Epic 18 story 3b — THE RUN LANE MOVED TO THE SIDECAR, PROVEN THROUGH IT.
 *
 * 18.3 proved the card under Bun and then could not run it in the shipped app:
 * the run's module needs `node:fs` and a spawner, and a WebView has neither, so
 * pressing RUN was refused. This suite drives the ACTUAL `sidecar/main.ts`
 * process over its ACTUAL stdio pipe (the harness in `fixtures/sidecar-pipe.ts`
 * does that), with the fake ACP server as the real child.
 *
 * WHAT IS PINNED HERE:
 *
 *   1. THE WIRE: the four run kinds round-trip, and every malformed run, entry,
 *      env name or ending is REFUSED rather than half-read.
 *   2. THE KEY RIDES THE PAYLOAD: a sentinel crosses in the request's `env` map,
 *      reaches the child's environment beside PATH/HOME and nothing else, and
 *      appears in no argv, no stderr line and no streamed entry.
 *   3. THE STREAM: entries arrive in order, one per line, and the ending is
 *      stated once by `run-end`. A partial is never a result.
 *   4. KILL ON EVERY EXIT PATH: a cancel, an ending, a dying child, the sidecar's
 *      own shutdown (stdin closed) and a closed stdout each leave no child.
 *   5. THE WINDOW'S SEAM: a missing key and an absent sidecar are each one
 *      sentence and nothing hangs; and NO window module imports the run's
 *      process-bound module any more (the proof that the lane left the window).
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-session-sidecar-"));

/** Every session directory the runs made, so the test can clean up after them. */
const madeDirs: string[] = [];

/** The sidecars this suite opened, killed at the end whatever happens. */
const openPipes: SidecarPipe[] = [];

afterAll(() => {
  for (const pipe of openPipes) pipe.stop();
  for (const dir of madeDirs) rmSync(dir, { recursive: true, force: true });
  rmSync(ROOT, { recursive: true, force: true });
});

function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

/** One open sidecar, already past its hello line. */
async function sidecar(): Promise<SidecarPipe> {
  const pipe = openSidecar();
  openPipes.push(pipe);
  const hello = await pipe.hello();
  expect(hello.kind).toBe("hello");
  return pipe;
}

/** The tool half of a run request, pointed at the fake server. */
function toolOf(mode: string, reportPath: string, timeoutMinutes = 1) {
  return {
    command: BUN,
    args: [FAKE_SERVER, mode, "--report", reportPath],
    timeoutMinutes,
  };
}

function runRequest(
  id: number,
  mode: string,
  reportPath: string,
  options: {
    env?: Record<string, string>;
    timeoutMinutes?: number;
    prompt?: string;
  } = {},
): RunRequest {
  return {
    id,
    kind: "run",
    run: id,
    tool: toolOf(mode, reportPath, options.timeoutMinutes ?? 1),
    env: options.env ?? {},
    prompt: options.prompt ?? "say one sentence and change nothing",
  };
}

/** Write one request line to the sidecar and flush it. */
async function send(pipe: SidecarPipe, line: string): Promise<void> {
  await pipe.transport.send(line);
}

/** Collect every line for one run until its `run-end`, or fail on the budget. */
async function collectRun(
  pipe: SidecarPipe,
  run: number,
  budgetMs = 15_000,
): Promise<{ entries: SidecarLine[]; end: SidecarLine }> {
  const entries: SidecarLine[] = [];
  const end = await new Promise<SidecarLine>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("the run never ended")),
      budgetMs,
    );
    pipe.transport.subscribe(run, (line) => {
      if (line.kind === "run-part" && line.run === run) {
        entries.push(line);
        return;
      }
      if (line.kind === "run-end" && line.run === run) {
        clearTimeout(timer);
        resolve(line);
      }
    });
  });
  return { entries, end };
}

interface Report {
  pid: number;
  argv: string[];
  env: Record<string, string>;
}

async function reportOf(path: string): Promise<Report> {
  for (let at = 0; at < 400; at += 1) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as Report;
    } catch {
      await Bun.sleep(10);
    }
  }
  throw new Error("the fake server wrote no report");
}

/** Did this pid go away? A killed child settles quickly. */
async function gone(pid: number, budgetMs = 8_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await Bun.sleep(20);
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 1. The wire: four kinds, built and read back, strictly.
 * ------------------------------------------------------------------ */

describe("the run wire", () => {
  test("a run request round-trips, key and all, in the env payload", () => {
    const KEY = "sk-wire-sentinel-3b";
    const line = runRequestLine(
      7,
      7,
      { command: "/bin/tool", args: ["--profile", "acp"], timeoutMinutes: 3 },
      { DEEPSEEK_API_KEY: KEY },
      "say something",
    );
    // The key is IN the payload — the one road it may take.
    expect(line).toContain(KEY);
    expect(parseRequestLine(line)).toEqual({
      id: 7,
      kind: "run",
      run: 7,
      tool: { command: "/bin/tool", args: ["--profile", "acp"], timeoutMinutes: 3 },
      env: { DEEPSEEK_API_KEY: KEY },
      prompt: "say something",
    });
    // And it is nowhere near the argv.
    const value = JSON.parse(line) as { tool: { args: string[] } };
    expect(value.tool.args.join("\u0000")).not.toContain(KEY);
  });

  test("the cancel, the part and the ending round-trip", () => {
    expect(parseRequestLine(runCancelLine(8, 7))).toEqual({
      id: 8,
      kind: "run-cancel",
      run: 7,
    });
    const entry = {
      kind: "update" as const,
      updateKind: "agent_message_chunk",
      text: "words",
      update: { sessionUpdate: "agent_message_chunk" },
    };
    expect(parseSidecarLine(runPartLine(7, 7, entry))).toEqual({
      id: 7,
      kind: "run-part",
      run: 7,
      entry,
    });
    expect(parseSidecarLine(runEndLine(7, 7, "stopped", null))).toEqual({
      id: 7,
      kind: "run-end",
      run: 7,
      ending: "stopped",
      sentence: null,
    });
  });

  test("the permission ask and the person's reply round-trip, and a bad verb is refused", () => {
    const ask = {
      id: 100,
      method: "session/request_permission",
      toolCall: { title: "Read the folder", kind: "read" },
      options: [
        { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
        { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
        { optionId: "reject-once", name: "Reject", kind: "reject_once" },
      ],
    };
    // The ask goes DOWN whole: tool call, options and the ask's own id.
    expect(parseSidecarLine(runPermissionLine(7, 7, ask))).toEqual({
      id: 7,
      kind: "run-permission",
      run: 7,
      ask: 100,
      method: ask.method,
      toolCall: ask.toolCall,
      options: ask.options,
    });
    // The reply goes UP as a VERB, never an option id: an "always" choice has
    // no spelling on this wire.
    expect(
      parseRequestLine(runPermissionReplyLine(8, 7, 100, "allow-once")),
    ).toEqual({
      id: 8,
      kind: "run-permission-reply",
      run: 7,
      ask: 100,
      choice: "allow-once",
    });
    expect(
      parseRequestLine(JSON.stringify({
        id: 9,
        kind: "run-permission-reply",
        run: 7,
        ask: 100,
        choice: "allow-always",
      })),
    ).toBeNull();
    expect(
      parseSidecarLine(JSON.stringify({
        id: 7,
        kind: "run-permission",
        run: 7,
        ask: 100,
        method: "session/request_permission",
        toolCall: {},
        options: [{ optionId: "x", name: "X", kind: 4 }],
      })),
    ).toBeNull();
  });

  test("a malformed run, entry, env name or ending is refused, never guessed", () => {
    const good = {
      id: 1,
      kind: "run",
      run: 1,
      tool: { command: "/bin/tool", args: [], timeoutMinutes: 1 },
      env: {},
      prompt: "go",
    };
    expect(parseRequestLine(JSON.stringify(good))).not.toBeNull();
    const bad = [
      { ...good, run: 0 },
      { ...good, env: { "not a name": "x" } },
      { ...good, env: { DEEPSEEK_API_KEY: "" } },
      { ...good, env: { DEEPSEEK_API_KEY: 4 } },
      { ...good, tool: { ...good.tool, command: "" } },
      { ...good, tool: { ...good.tool, args: [1] } },
      { ...good, tool: { ...good.tool, timeoutMinutes: 0 } },
      { ...good, prompt: "" },
    ];
    for (const line of bad) {
      expect(parseRequestLine(JSON.stringify(line))).toBeNull();
    }
    // A malformed line still says which id to answer.
    expect(requestIdOf(JSON.stringify({ ...good, env: { "bad name": "x" } }))).toBe(1);

    const entry = {
      kind: "started",
      command: "/bin/tool",
      args: [],
      cwd: "/tmp/x",
      declaration: "no key",
      inherited: ["PATH"],
      envNames: [],
    };
    expect(parseSidecarLine(runPartLine(1, 1, entry))).not.toBeNull();
    for (const broken of [
      { kind: "started", command: "/bin/tool", args: [], cwd: "/tmp/x" },
      { kind: "session", sessionId: "" },
      { kind: "update", updateKind: 1, text: "x" },
      { kind: "permission", method: "m", options: [], reply: { outcome: "maybe" } },
      { kind: "problem", sentence: 3 },
      { kind: "ended", ending: "almost", stopReason: null, sentence: null, partial: false },
    ]) {
      expect(
        parseSidecarLine(JSON.stringify({ id: 1, kind: "run-part", run: 1, entry: broken })),
      ).toBeNull();
    }
    expect(
      parseSidecarLine(JSON.stringify({ id: 1, kind: "run-end", run: 1, ending: "almost", sentence: null })),
    ).toBeNull();
    expect(
      parseSidecarLine(JSON.stringify({ id: 1, kind: "run-end", run: 1, ending: "failed", sentence: 3 })),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 2. A completed run, through the real sidecar.
 * ------------------------------------------------------------------ */

describe("a run, streamed by the sidecar", () => {
  test("entries arrive in order, the ending is stated once, and no child is left", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const request = runRequest(11, "tools", reportPath);
    const collected = collectRun(pipe, request.run);
    await send(pipe, JSON.stringify(request));
    const { entries, end } = await collected;

    const kinds = entries
      .filter((line) => line.kind === "run-part")
      .map((line) => (line.kind === "run-part" ? line.entry.kind : ""));
    expect(kinds[0]).toBe("started");
    expect(kinds[1]).toBe("session");
    expect(kinds).toContain("update");
    // The ENDING came on run-end, exactly once, and never as a run-part.
    expect(kinds).not.toContain("ended");
    expect(end.kind).toBe("run-end");
    expect(end.kind === "run-end" ? end.ending : null).toBe("completed");

    // The run's own directory was made and left EMPTY (18.2's rule survives
    // the move), and the child saw only PATH/HOME.
    const started = entries[0];
    expect(started.kind).toBe("run-part");
    const entry = started.kind === "run-part" ? started.entry : null;
    expect(entry?.kind).toBe("started");
    if (entry?.kind !== "started") throw new Error("no started entry");
    madeDirs.push(entry.cwd);
    expect(existsSync(entry.cwd)).toBe(true);
    expect(readdirSync(entry.cwd)).toEqual([]);
    expect(entry.command).toBe(BUN);
    const report = await reportOf(reportPath);
    expect(Object.keys(report.env).sort()).toEqual(["HOME", "PATH"]);
    // The transcript-shaped order: tool pending, text, tool completed, text.
    const updates = entries.filter(
      (line): line is Extract<SidecarLine, { kind: "run-part" }> =>
        line.kind === "run-part" && line.entry.kind === "update",
    );
    expect(updates.length).toBeGreaterThanOrEqual(4);
    expect(await gone(report.pid)).toBe(true);
  });

  test("a stop answers with the run's own ending, asks the server, and kills the child", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const request = runRequest(12, "hang-mid-turn", reportPath);
    const collected = collectRun(pipe, request.run);
    await send(pipe, JSON.stringify(request));

    // Wait for the run to actually say something before stopping it.
    const report = await reportOf(reportPath);
    await Bun.sleep(100);
    await send(pipe, runCancelLine(90, request.run));
    const { end } = await collected;

    expect(end.kind === "run-end" ? end.ending : null).toBe("stopped");
    // The client ASKED the server (session/cancel) before the child was killed.
    expect(existsSync(reportPath + ".cancel")).toBe(true);
    expect(await gone(report.pid)).toBe(true);
  });

  test("a dying server is a failed run with one sentence, and the child is gone", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const request = runRequest(13, "die-mid-turn", reportPath);
    const collected = collectRun(pipe, request.run);
    await send(pipe, JSON.stringify(request));
    const { entries, end } = await collected;

    expect(end.kind === "run-end" ? end.ending : null).toBe("failed");
    const sentence = end.kind === "run-end" ? end.sentence : null;
    expect(typeof sentence).toBe("string");
    // What arrived before the break is kept; the ending carries the reason.
    expect(
      entries.some(
        (line) => line.kind === "run-part" && line.entry.kind === "update",
      ),
    ).toBe(true);
    const report = await reportOf(reportPath);
    expect(await gone(report.pid)).toBe(true);
  });

  test("a budget that runs out is timed-out, never a result", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    // A TEST-ONLY short budget: the wire's minutes are a number, a row's are
    // whole minutes (acpSpecs refuses anything under one).
    const request = runRequest(14, "silent", reportPath, { timeoutMinutes: 0.003 });
    const collected = collectRun(pipe, request.run);
    await send(pipe, JSON.stringify(request));
    const { end } = await collected;
    expect(end.kind === "run-end" ? end.ending : null).toBe("timed-out");
    expect(end.kind === "run-end" ? end.sentence : null).toContain("budget");
    const report = await reportOf(reportPath);
    expect(await gone(report.pid)).toBe(true);
  });

  test("a permission waits for the person; an allow-once continues the run", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const request = runRequest(16, "normal", reportPath);
    const permissions: Array<Extract<SidecarLine, { kind: "run-permission" }>> = [];
    const parts: Array<Extract<SidecarLine, { kind: "run-part" }>> = [];
    const ended = new Promise<Extract<SidecarLine, { kind: "run-end" }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("the run never ended")), 10_000);
        pipe.transport.subscribe(request.run, (line) => {
          if (line.kind === "run-permission" && line.run === request.run) {
            permissions.push(line);
            return;
          }
          if (line.kind === "run-part" && line.run === request.run) {
            parts.push(line);
            return;
          }
          if (line.kind === "run-end" && line.run === request.run) {
            clearTimeout(timer);
            resolve(line);
          }
        });
      },
    );
    await send(pipe, JSON.stringify(request));

    // Nothing answers until a person does: the run is waiting on the ask.
    for (let at = 0; at < 400 && permissions.length === 0; at += 1) {
      await Bun.sleep(10);
    }
    expect(permissions).toHaveLength(1);
    const permission = permissions[0]!;
    expect(permission.method).toBe("session/request_permission");
    expect(permission.toolCall).toMatchObject({
      title: "Read the working directory",
    });
    // The fake really offered a remembered yes; the wire carries it whole.
    expect(permission.options.map((option) => option.kind)).toEqual([
      "allow_once",
      "allow_always",
      "reject_once",
    ]);

    // The PERSON's verb, not an option id: the lane maps it.
    await send(
      pipe,
      runPermissionReplyLine(500, request.run, permission.ask, "allow-once"),
    );
    const end = await ended;
    expect(end.kind === "run-end" ? end.ending : null).toBe("completed");

    const permissionEntry = parts
      .map((line) => line.entry)
      .find((entry) => entry.kind === "permission");
    expect(permissionEntry).toMatchObject({
      kind: "permission",
      reply: { outcome: "selected", optionId: "allow-once" },
    });
    // The offer is on the wire, but the SELECTED option never is the always
    // one: the reply names allow-once and only allow-once.
    const reply =
      permissionEntry !== undefined && permissionEntry.kind === "permission"
        ? permissionEntry.reply
        : null;
    expect(JSON.stringify(reply)).not.toContain("allow-always");
    expect(await gone((await reportOf(reportPath)).pid)).toBe(true);
  });

  test("an unanswered permission settles as the run's timeout, stated as unanswered", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    // A TEST-ONLY short budget. Nobody answers the ask.
    const request = runRequest(17, "normal", reportPath, { timeoutMinutes: 0.003 });
    const parts: Array<Extract<SidecarLine, { kind: "run-part" }>> = [];
    const permissions: Array<Extract<SidecarLine, { kind: "run-permission" }>> = [];
    const ended = new Promise<Extract<SidecarLine, { kind: "run-end" }>>(
      (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("the run never ended")), 10_000);
        pipe.transport.subscribe(request.run, (line) => {
          if (line.kind === "run-permission" && line.run === request.run) {
            permissions.push(line);
            return;
          }
          if (line.kind === "run-part" && line.run === request.run) {
            parts.push(line);
            return;
          }
          if (line.kind === "run-end" && line.run === request.run) {
            clearTimeout(timer);
            resolve(line);
          }
        });
      },
    );
    await send(pipe, JSON.stringify(request));
    const end = await ended;
    expect(permissions).toHaveLength(1);
    expect(end.kind === "run-end" ? end.ending : null).toBe("timed-out");
    const sentence = end.kind === "run-end" ? end.sentence : null;
    expect(sentence).toContain("unanswered");
    // The run recorded the ask as unanswered, never as a refusal.
    const permissionEntry = parts
      .map((line) => line.entry)
      .find((entry) => entry.kind === "permission");
    expect(permissionEntry).toMatchObject({
      kind: "permission",
      reply: { outcome: "unanswered" },
    });
    expect(await gone((await reportOf(reportPath)).pid)).toBe(true);
  });

  test("a reply naming no waiting ask is answered with one sentence", async () => {
    const pipe = await sidecar();
    const answer = new Promise<SidecarLine>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no answer")), 5_000);
      pipe.transport.subscribe(501, (line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
    await send(pipe, runPermissionReplyLine(501, 404, 1, "allow-once"));
    const line = await answer;
    expect(line.kind).toBe("error");
    expect(line.kind === "error" ? line.message : "").toContain(
      "no permission request",
    );
  });

  test("a busy run number is refused in one sentence, and the first run still ends", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const request = runRequest(15, "hang-mid-turn", reportPath);
    // The refusal comes back on the SECOND request's id.
    const refusal = new Promise<SidecarLine>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no refusal")), 5_000);
      pipe.transport.subscribe(115, (line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
    const collected = collectRun(pipe, request.run);
    await send(pipe, JSON.stringify(request));
    await reportOf(reportPath);
    await send(pipe, JSON.stringify({ ...request, id: 115, run: request.run }));
    const answer = await refusal;
    expect(answer.kind).toBe("error");
    expect(answer.kind === "error" ? answer.message : "").toContain("already running");

    await send(pipe, runCancelLine(91, request.run));
    const { end } = await collected;
    expect(end.kind === "run-end" ? end.ending : null).toBe("stopped");
    expect(await gone((await reportOf(reportPath)).pid)).toBe(true);
  });

  test("a cancel naming no live run is answered, not ignored", async () => {
    const pipe = await sidecar();
    const answer = new Promise<SidecarLine>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no answer")), 5_000);
      pipe.transport.subscribe(92, (line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
    await send(pipe, runCancelLine(92, 404));
    const line = await answer;
    expect(line.kind).toBe("error");
    expect(line.kind === "error" ? line.message : "").toContain("no run is live");
  });
});

/* ------------------------------------------------------------------ *
 * 3. The key: in the payload, into the child beside PATH/HOME, nowhere else.
 * ------------------------------------------------------------------ */

describe("the key crosses in the payload and nowhere else", () => {
  test("a sentinel reaches the child beside PATH/HOME, and never an argv or a log line", async () => {
    const KEY = "sk-sidecar-lane-SENTINEL-3b";
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const request = runRequest(21, "tools", reportPath, {
      env: { DEEPSEEK_API_KEY: KEY },
    });
    const collected = collectRun(pipe, request.run);
    await send(pipe, JSON.stringify(request));
    const { entries, end } = await collected;
    expect(end.kind === "run-end" ? end.ending : null).toBe("completed");

    const report = await reportOf(reportPath);
    // The child's environment is EXACTLY PATH, HOME and the granted name.
    expect(Object.keys(report.env).sort()).toEqual([
      "DEEPSEEK_API_KEY",
      "HOME",
      "PATH",
    ]);
    expect(report.env.DEEPSEEK_API_KEY).toBe(KEY);
    expect(report.env.PATH).toBe(process.env.PATH ?? "");
    expect(report.env.HOME).toBe(process.env.HOME ?? "");
    // Never an argv.
    expect(report.argv.join("\u0000")).not.toContain(KEY);
    // Never in anything the sidecar said, or anything it streamed.
    expect(pipe.stderr()).not.toContain(KEY);
    expect(JSON.stringify(entries)).not.toContain(KEY);
    expect(JSON.stringify(end)).not.toContain(KEY);
    expect(await gone(report.pid)).toBe(true);
  });

  test("with no grant the child gets PATH/HOME only", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const request = runRequest(22, "tools", reportPath);
    const collected = collectRun(pipe, request.run);
    await send(pipe, JSON.stringify(request));
    await collected;
    const report = await reportOf(reportPath);
    expect(Object.keys(report.env).sort()).toEqual(["HOME", "PATH"]);
    expect(await gone(report.pid)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 4. Kill on the sidecar's own exits: stdin closed, stdout closed.
 * ------------------------------------------------------------------ */

describe("the sidecar's own exit paths kill the child", () => {
  test("closing its stdin closes every live run", async () => {
    const pipe = openSidecar();
    openPipes.push(pipe);
    await pipe.hello();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const request = runRequest(31, "hang-mid-turn", reportPath);
    await send(pipe, JSON.stringify(request));
    const report = await reportOf(reportPath);

    // Close stdin: the sidecar's finally closes every live run.
    pipe.child.stdin.end();
    expect(await gone(report.pid)).toBe(true);
    // And the process itself is done, with the run's ending said on the way out.
    await pipe.child.exited;
  });

  test("a closed stdout closes every live run", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    // The wrapper's reader takes 6 lines (hello, started, session, and the
    // first ticks) and then exits, closing the sidecar's stdout underneath it.
    // The drip mode keeps writing, so the next write is the one that fails.
    const script = JSON.stringify(BUN) + " " + JSON.stringify(
      join(import.meta.dir, "..", "sidecar", "main.ts"),
    ) + " | head -n 6";
    const child = Bun.spawn(["/bin/sh", "-c", script], {
      cwd: join(import.meta.dir, ".."),
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    });
    try {
      const request = runRequest(32, "drip", reportPath, { timeoutMinutes: 1 });
      child.stdin.write(JSON.stringify(request) + "\n");
      await child.stdin.flush();
      const report = await reportOf(reportPath);
      // The pipe is closed by the wrapper; the failing write kills the run.
      expect(await gone(report.pid)).toBe(true);
    } finally {
      child.kill();
    }
  }, 20_000);
});

/* ------------------------------------------------------------------ *
 * 5. The window's seam: one request, one sentence, nothing hangs.
 * ------------------------------------------------------------------ */

/** A transport that records what the window sends and lets a test answer. */
function recording(): {
  transport: TurnTransport;
  sent: string[];
  deliver(id: number, line: SidecarLine): void;
} {
  const sent: string[] = [];
  const waiting = new Map<number, (line: SidecarLine) => void>();
  return {
    sent,
    transport: {
      async send(line) {
        sent.push(line);
      },
      subscribe(id, handler) {
        waiting.set(id, handler);
        return () => {
          if (waiting.get(id) === handler) waiting.delete(id);
        };
      },
    },
    deliver(id, line) {
      waiting.get(id)?.(line);
    },
  };
}

const RUNNING: SidecarStart = {
  kind: "running",
  status: { running: true, entry: "", entryKind: "dev-entry", bun: "" },
};

function row(extra: Partial<AcpSpec> = {}): AcpSpec {
  return {
    kind: "acp",
    id: "fake-acp",
    name: "Fake ACP",
    command: "/bin/tool",
    args: ["--profile", "acp"],
    cwdPolicy: "session",
    env: [],
    timeoutMinutes: 1,
    notes: "",
    ...extra,
  };
}

describe("the window's run seam", () => {
  test("a declared key the store does not keep refuses before anything leaves", async () => {
    const wire = recording();
    const handle = startSessionRun(
      row({ env: [{ name: "DEEPSEEK_API_KEY", key: "row-1" }] }),
      "go",
      {
        readKey: async () => "",
        transport: wire.transport,
        start: async () => RUNNING,
      },
    );
    expect(await handle.ended).toEqual({
      ending: "failed",
      sentence: acpMissingKeySentence("row-1"),
    });
    // Nothing was sent: no child could have been spawned for a key we lack.
    expect(wire.sent).toEqual([]);
  });

  test("a sidecar that will not start is one sentence, and nothing hangs", async () => {
    const wire = recording();
    const handle = startSessionRun(row(), "go", {
      readKey: async () => "",
      transport: wire.transport,
      start: async () => ({ kind: "refused", sentence: "the sidecar is not here." }),
    });
    expect(await handle.ended).toEqual({
      ending: "failed",
      sentence: "the sidecar is not here.",
    });
    expect(wire.sent).toEqual([]);
  });

  test("the request carries the resolved map, entries are forwarded in order, and the ending settles", async () => {
    const KEY = "sk-window-seam-sentinel";
    const wire = recording();
    const arrived: string[] = [];
    const handle = startSessionRun(
      row({ env: [{ name: "DEEPSEEK_API_KEY", key: "row-1" }] }),
      "go",
      {
        readKey: async () => KEY,
        transport: wire.transport,
        start: async () => RUNNING,
        onEntry: (entry) => arrived.push(entry.kind),
      },
    );
    for (let at = 0; at < 200 && wire.sent.length === 0; at += 1) {
      await Bun.sleep(5);
    }
    const request = parseRequestLine(wire.sent[0] as string);
    expect(request?.kind).toBe("run");
    if (request?.kind !== "run") throw new Error("not a run request");
    // The key is in the payload; the tool's argv carries none of it.
    expect(request.env).toEqual({ DEEPSEEK_API_KEY: KEY });
    expect(request.tool.args.join("\u0000")).not.toContain(KEY);

    wire.deliver(request.id, {
      id: request.id,
      kind: "run-part",
      run: request.run,
      entry: {
        kind: "update",
        updateKind: "agent_message_chunk",
        text: "words",
        update: {},
      },
    });
    wire.deliver(request.id, {
      id: request.id,
      kind: "run-end",
      run: request.run,
      ending: "completed",
      sentence: null,
    });
    expect(await handle.ended).toEqual({ ending: "completed", sentence: null });
    expect(arrived).toEqual(["update"]);
  });

  test("a stop is a run-cancel naming the run", async () => {
    const wire = recording();
    const handle = startSessionRun(row(), "go", {
      readKey: async () => "",
      transport: wire.transport,
      start: async () => RUNNING,
    });
    for (let at = 0; at < 200 && wire.sent.length === 0; at += 1) {
      await Bun.sleep(5);
    }
    const request = parseRequestLine(wire.sent[0] as string);
    if (request?.kind !== "run") throw new Error("not a run request");
    handle.cancel();
    for (let at = 0; at < 200 && wire.sent.length < 2; at += 1) {
      await Bun.sleep(5);
    }
    expect(parseRequestLine(wire.sent[1] as string)).toMatchObject({
      kind: "run-cancel",
      run: request.run,
    });
    // The lane's own ending is the answer, on the run's id.
    wire.deliver(request.id, {
      id: request.id,
      kind: "run-end",
      run: request.run,
      ending: "stopped",
      sentence: null,
    });
    expect((await handle.ended).ending).toBe("stopped");
  });

  test("an error line is one failed sentence, not a hang", async () => {
    const wire = recording();
    const handle = startSessionRun(row(), "go", {
      readKey: async () => "",
      transport: wire.transport,
      start: async () => RUNNING,
    });
    // The default start is the app's own; this test never lets it run: the
    // subscription is already in place, so answer it directly.
    for (let at = 0; at < 200 && wire.sent.length === 0; at += 1) {
      await Bun.sleep(5);
    }
    const request = parseRequestLine(wire.sent[0] as string);
    if (request?.kind !== "run") throw new Error("not a run request");
    wire.deliver(request.id, {
      id: request.id,
      kind: "error",
      message: "the run could not be read",
    });
    expect(await handle.ended).toEqual({
      ending: "failed",
      sentence: "the run could not be read",
    });
  });

  test("a send that fails is the window's one sentence", async () => {
    const transport: TurnTransport = {
      async send() {
        throw new Error("no pipe");
      },
      subscribe() {
        return () => {};
      },
    };
    const handle = startSessionRun(row(), "go", {
      readKey: async () => "",
      transport,
      start: async () => RUNNING,
    });
    expect(await handle.ended).toEqual({
      ending: "failed",
      sentence: SESSION_RUN_UNREACHABLE,
    });
  });
});

/* ------------------------------------------------------------------ *
 * 6. Import hygiene: the lane's process-bound modules left the window graph.
 * ------------------------------------------------------------------ */

describe("the run lane is not in the window's import graph", () => {
  test("no window module imports acpRun or acp", async () => {
    const src = join(import.meta.dir, "..", "src");
    const lanes = new Set([join(src, "turn", "acpRun.ts"), join(src, "turn", "acp.ts")]);
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || lanes.has(full)) continue;
        const text = readFileSync(full, "utf8");
        // A VALUE or type import of the run's process-bound modules is what
        // made 18.3's shipped RUN impossible; the window reads the vocabulary
        // from `acpEntries` and the row from `acpSpecs` instead.
        const matches = text.match(
          /(?:from\s+|import\s*\(\s*)["'][^"']*\/(?:acp|acpRun)(?:\.ts)?["']/g,
        );
        if (matches !== null) offenders.push(full + " -> " + matches.join(", "));
      }
    };
    walk(src);
    expect(offenders).toEqual([]);
  });

  test("the window's seam asks the sidecar and never spawns anything itself", () => {
    const seam = readFileSync(join(import.meta.dir, "..", "src", "turn", "acpSession.ts"), "utf8");
    expect(seam).toContain("runRequestLine(");
    expect(seam).toContain("runCancelLine(");
    expect(seam).not.toContain("node:child_process");
    expect(seam).not.toContain("Bun.spawn");
    // The old refusal sentence is gone with the reason for it.
    const hook = readFileSync(join(import.meta.dir, "..", "src", "canvas", "useGround.ts"), "utf8");
    expect(hook).not.toContain("this window cannot start a process");
    expect(hook).not.toContain("sessionRuntimeReady");
  });
});
