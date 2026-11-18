import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  loadSessionTranscript,
  sessionEntryLine,
  sessionTranscriptPath,
  type SessionEntry,
  type SessionIo,
} from "../src/map/sessions";
import { beginSessionRun } from "../src/canvas/useGround";
import { SESSION_RUN_CONNECTION_ENDED } from "../src/turn/acpSession";
import type { AcpSpec } from "../src/turn/acpSpecs";
import type { SidecarStart } from "../src/turn/sidecar";
import type { TurnTransport } from "../src/turn/turn";
import type { SidecarLine } from "../src/turn/protocol";
import {
  BUN,
  FAKE_SERVER,
  openSidecar,
  type SidecarPipe,
} from "./fixtures/sidecar-pipe";

/**
 * Epic 18 story 3c — A DEAD SIDECAR IS SAID, NOT WAITED ON.
 *
 * 18.3b proved kill-on-every-path from the SIDECAR's side, and the window got
 * no death signal at all: a run whose sidecar vanished sat on its last entry
 * until the budget ran out and then reported a timeout — a hang dressed as a
 * timeout. This suite drives the ACTUAL `sidecar/main.ts` over its ACTUAL stdio
 * pipe and kills it mid-run, then holds the seam to four things:
 *
 *   1. THE SETTLE IS IMMEDIATE. No clock is advanced and the row's budget is
 *      half an hour: if the card settled on the budget, the wait would be
 *      visible here in minutes, not milliseconds.
 *   2. THE ENDING IS THE ORDINARY ONE. One `failed` ending, one sentence
 *      naming what happened, one `ended` transcript line — the same path a
 *      normal ending takes, so no record shape changed.
 *   3. ONE ENDING, EVER. A close that arrives on the heels of the run's own
 *      ending adds nothing.
 *   4. THE SEAM COMES BACK. The next run starts a fresh sidecar and writes
 *      normally after the dead run's ending.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-dead-sidecar-"));

/** Every sidecar this suite opened, killed at the end whatever happens. */
const PIPES: SidecarPipe[] = [];

/** Every ACP child a killed sidecar could not reap, killed here instead. */
const ORPHANED: number[] = [];

afterAll(() => {
  for (const pid of ORPHANED) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // Already gone: the state we wanted.
    }
  }
  for (const pipe of PIPES) pipe.stop();
  rmSync(ROOT, { recursive: true, force: true });
});

function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

/** The app's lib/fs is the Tauri seam; a bun test stands node's fs behind it. */
function nodeIo(): SessionIo {
  return {
    async readTextFile(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    async writeTextFile(path, contents) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, contents);
    },
    async createDirAll(path) {
      mkdirSync(path, { recursive: true });
    },
  };
}

const STARTED: SidecarStart = {
  kind: "running",
  status: { running: true, entry: "", entryKind: "dev-entry", bun: "" },
};

/** A real row pointed at the fake server, with a budget a test never waits out. */
function row(mode: string, reportPath: string): AcpSpec {
  return {
    kind: "acp",
    id: "fake-acp",
    name: "Fake ACP",
    verified: false,
    command: BUN,
    args: [FAKE_SERVER, mode, "--report", reportPath],
    cwdPolicy: "session",
    env: [],
    // HALF AN HOUR: a settle that took the budget would take minutes. The
    // story's promise is a settle inside a second, so this is the honest bar.
    timeoutMinutes: 30,
    notes: "a test row",
  };
}

async function reportOf(path: string): Promise<{ pid: number }> {
  for (let at = 0; at < 400; at += 1) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as { pid: number };
    } catch {
      await Bun.sleep(10);
    }
  }
  throw new Error("the fake server wrote no report");
}

/** Every `ended` line in a transcript file (the one per run, or not one). */
async function endedLines(base: string, slug: string): Promise<SessionEntry[]> {
  const parsed = await loadSessionTranscript(base, slug, nodeIo());
  return parsed.entries.filter((entry) => entry.kind === "ended");
}

/* ------------------------------------------------------------------ *
 * 1. The sidecar is killed mid-run: the card settles now, once, honestly.
 * ------------------------------------------------------------------ */

describe("a sidecar killed mid-run", () => {
  test("settles at once with one sentence, one ending, and the transcript says so", async () => {
    const pipe = openSidecar();
    PIPES.push(pipe);
    await pipe.hello();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const arrived: SessionEntry[] = [];
    let sawWords = false;

    const started = beginSessionRun(base, row("hang-mid-turn", reportPath), "one", {
      readKey: async () => "",
      transport: pipe.transport,
      start: async () => STARTED,
      transcriptIo: nodeIo(),
      onEntry: (entry) => {
        arrived.push(entry);
        if (entry.kind === "text") sawWords = true;
      },
    });

    // The run is genuinely working before it is orphaned.
    for (let at = 0; at < 400 && !sawWords; at += 1) await Bun.sleep(10);
    expect(sawWords).toBe(true);
    const report = await reportOf(reportPath);
    ORPHANED.push(report.pid);

    // KILL THE SIDECAR. Nothing is sent, no clock is advanced, no budget is
    // touched: the only notice left is the channel closing.
    const before = Date.now();
    pipe.stop();
    const done = await Promise.race([
      started.done,
      Bun.sleep(8_000).then(() => {
        throw new Error("the card waited instead of settling");
      }),
    ]);
    const elapsed = Date.now() - before;

    // 1. FAST: far inside the story's one second, and nowhere near 30 minutes.
    expect(elapsed).toBeLessThan(2_000);

    // 2. THE ORDINARY ENDING: failed, with the one sentence that names it.
    expect(done.ending).toBe("failed");
    expect(done.sentence).toBe(SESSION_RUN_CONNECTION_ENDED);
    expect(SESSION_RUN_CONNECTION_ENDED).toBe("the connection to the run ended");
    expect(done.notice).toBeNull();

    // 3. ONE `ended` LINE, last, and it is the same sentence the card reads.
    const ended = done.entries.filter((entry) => entry.kind === "ended");
    expect(ended).toHaveLength(1);
    expect(done.entries[done.entries.length - 1]).toBe(ended[0]);
    const line = sessionEntryLine(ended[0]!);
    expect(line).toBe("the run failed: the connection to the run ended");
    // What happened, not how a runtime said it: no stack, no exit code, no pid.
    expect(line).not.toContain("Error");
    expect(line).not.toMatch(/\bat .*:\d+/);

    // The FILE is the same story a reopen tells: one ending, and it is the end.
    const reopened = await loadSessionTranscript(base, "one", nodeIo());
    expect(reopened.entries).toEqual([...done.entries]);
    expect(reopened.malformed).toEqual([]);
    expect(await endedLines(base, "one")).toHaveLength(1);

    // Nothing in the run was invented: what arrived before the death is kept.
    expect(arrived.some((entry) => entry.kind === "text")).toBe(true);
    expect(reopened.entries.some((entry) => entry.kind === "text")).toBe(true);
  }, 20_000);

  /* ---------------------------------------------------------------- *
   * 2. The seam comes back: the next run starts a fresh sidecar.
   * ---------------------------------------------------------------- */

  test("a run after the death restarts the seam and appends normally", async () => {
    const pumps: SidecarPipe[] = [];
    let current: SidecarPipe | null = null;
    // The WINDOW's transport does not own the child: the host does, and it
    // spawns a fresh one on the next start. This is that seam, with the test
    // standing in for the host's spawn.
    const transport: TurnTransport = {
      async send(line) {
        await (current as SidecarPipe).transport.send(line);
      },
      subscribe(id, handler) {
        return (current as SidecarPipe).transport.subscribe(id, handler);
      },
      onClosed(handler) {
        return (current as SidecarPipe).transport.onClosed?.(handler) ?? (() => {});
      },
    };
    const lane = {
      transport,
      async start(): Promise<SidecarStart> {
        const pipe = openSidecar();
        PIPES.push(pipe);
        pumps.push(pipe);
        await pipe.hello();
        current = pipe;
        return STARTED;
      },
    };

    const base = workspace();
    const deadReport = join(base, "dead.json");
    let sawWords = false;
    const first = beginSessionRun(base, row("hang-mid-turn", deadReport), "one", {
      readKey: async () => "",
      transport: lane.transport,
      start: () => lane.start(),
      transcriptIo: nodeIo(),
      onEntry: (entry) => {
        if (entry.kind === "text") sawWords = true;
      },
    });
    for (let at = 0; at < 400 && !sawWords; at += 1) await Bun.sleep(10);
    expect(sawWords).toBe(true);
    ORPHANED.push((await reportOf(deadReport)).pid);

    // The first sidecar dies under the run; the card says so at once.
    (current as SidecarPipe).stop();
    const firstDone = await first.done;
    expect(firstDone.ending).toBe("failed");
    expect(firstDone.sentence).toBe(SESSION_RUN_CONNECTION_ENDED);
    const afterDeath = readFileSync(sessionTranscriptPath(base, "one"), "utf8");

    // A SECOND RUN is the next request, and the lane starts a fresh child for
    // it — no restart button, no health state, no stale pipe.
    const secondDone = await beginSessionRun(
      base,
      row("tools", join(base, "alive.json")),
      "one",
      {
        readKey: async () => "",
        transport: lane.transport,
        start: () => lane.start(),
        transcriptIo: nodeIo(),
      },
    ).done;

    expect(secondDone.ending).toBe("completed");
    expect(secondDone.sentence).toBeNull();
    // The dead run's bytes are a PREFIX: the second run appends after its end.
    const afterSecond = readFileSync(sessionTranscriptPath(base, "one"), "utf8");
    expect(afterSecond.startsWith(afterDeath)).toBe(true);

    const all = await loadSessionTranscript(base, "one", nodeIo());
    const ended = all.entries.filter((entry) => entry.kind === "ended");
    // Exactly one ended per run: the dead run's and the living run's.
    expect(ended).toHaveLength(2);
    expect(ended[0]).toMatchObject({ kind: "ended", ending: "failed" });
    expect(ended[1]).toMatchObject({ kind: "ended", ending: "completed" });
    const deadEnd = all.entries.findIndex((entry) => entry.kind === "ended");
    const secondStart = all.entries.findIndex(
      (entry, index) => index > deadEnd && entry.kind === "started",
    );
    expect(secondStart).toBeGreaterThan(deadEnd);
    for (const pipe of pumps) pipe.stop();
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * 3. A close racing a real ending: one ending, never a second line.
 * ------------------------------------------------------------------ */

describe("a close racing the run's own ending", () => {
  test("the ending stands and the close adds nothing", async () => {
    const base = workspace();
    const waiting = new Map<number, (line: SidecarLine) => void>();
    let closing: (() => void)[] = [];
    const transport: TurnTransport = {
      async send() {},
      subscribe(id, handler) {
        waiting.set(id, handler);
        return () => {
          if (waiting.get(id) === handler) waiting.delete(id);
        };
      },
      onClosed(handler) {
        closing.push(handler);
        return () => {
          closing = closing.filter((entry) => entry !== handler);
        };
      },
    };

    const started = beginSessionRun(base, row("tools", join(base, "unused.json")), "one", {
      readKey: async () => "",
      transport,
      start: async () => STARTED,
      transcriptIo: nodeIo(),
    });

    // Wait until the run has asked: a subscriber and a close listener exist.
    for (let at = 0; at < 400 && (waiting.size === 0 || closing.length === 0); at += 1) {
      await Bun.sleep(5);
    }
    expect(waiting.size).toBe(1);
    expect(closing).toHaveLength(1);
    const [id] = [...waiting.keys()];
    const deliver = waiting.get(id as number) as (line: SidecarLine) => void;
    const closer = closing[0] as () => void;

    // THE RACE, in one turn: the lane's own ending lands, and the channel's
    // close follows it in the same tick, before the ending has been written.
    deliver({
      id: id as number,
      kind: "run-end",
      run: id as number,
      ending: "completed",
      sentence: null,
    });
    closer();

    const done = await started.done;
    expect(done.ending).toBe("completed");
    const ended = done.entries.filter((entry) => entry.kind === "ended");
    expect(ended).toHaveLength(1);
    expect(ended[0]).toMatchObject({ kind: "ended", ending: "completed" });
    // The file agrees: one ending, and the close wrote nothing.
    expect(await endedLines(base, "one")).toHaveLength(1);
    const parsed = await loadSessionTranscript(base, "one", nodeIo());
    expect(parsed.entries).toEqual([...done.entries]);
  });

  test("a close after the run already settled is not heard at all", async () => {
    const base = workspace();
    const waiting = new Map<number, (line: SidecarLine) => void>();
    let closing: (() => void)[] = [];
    const transport: TurnTransport = {
      async send() {},
      subscribe(id, handler) {
        waiting.set(id, handler);
        return () => {
          if (waiting.get(id) === handler) waiting.delete(id);
        };
      },
      onClosed(handler) {
        closing.push(handler);
        return () => {
          closing = closing.filter((entry) => entry !== handler);
        };
      },
    };
    const started = beginSessionRun(base, row("tools", join(base, "unused.json")), "one", {
      readKey: async () => "",
      transport,
      start: async () => STARTED,
      transcriptIo: nodeIo(),
    });
    for (let at = 0; at < 400 && closing.length === 0; at += 1) await Bun.sleep(5);
    expect(closing).toHaveLength(1);
    const id = [...waiting.keys()][0]!;
    const closer = closing[0]!;
    (waiting.get(id) as (line: SidecarLine) => void)({
      id,
      kind: "run-end",
      run: id,
      ending: "completed",
      sentence: null,
    });
    const done = await started.done;
    expect(done.ending).toBe("completed");
    // The seam stopped listening when it settled ...
    expect(closing).toHaveLength(0);
    // ... and even a transport that calls the handler anyway changes nothing:
    // the settle guard is what makes the ending exactly one.
    closer();
    await Bun.sleep(20);
    expect(await endedLines(base, "one")).toHaveLength(1);
    const parsed = await loadSessionTranscript(base, "one", nodeIo());
    expect(parsed.entries).toEqual([...done.entries]);
  });
});
