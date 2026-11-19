import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SESSION_RESUME_OTHER_FOLDER,
  SESSION_RESUME_REFUSALS,
  parseSessionEntryLine,
  parseSessionTranscript,
  serializeSessionEntryLine,
  serializeSessionTranscript,
  sessionResumeOf,
  sessionTranscriptPath,
  type SessionCard as SessionCardRecord,
  type SessionEntry,
  type SessionIo,
} from "../src/map/sessions";
import {
  sessionEntryOf,
  sessionFollowUpRefusal,
  startGatedSessionRun,
} from "../src/canvas/useGround";
import {
  SessionCard as SessionCardView,
  SESSION_FOLLOW_UP_LABEL,
} from "../src/canvas/SessionCard";
import { assembleSessionPacket } from "../src/turn/packet";
import {
  parseRequestLine,
  runRequestLine,
  type RunRequest,
  type SidecarLine,
} from "../src/turn/protocol";
import type { AcpSpec } from "../src/turn/acpSpecs";
import { ACP_SPECS, validateAcpSpec } from "../src/turn/acpSpecs";
import type { SidecarStart } from "../src/turn/sidecar";
import type { TurnTransport } from "../src/turn/turn";
import type { Reading } from "../src/map/readings";
import { RUN_RESUME_OTHER_FOLDER } from "../sidecar/runs";
import {
  BUN,
  FAKE_SERVER,
  openSidecar,
  type SidecarPipe,
} from "./fixtures/sidecar-pipe";

/**
 * STORY 21.1 — THE SESSION REMEMBERS ITS DELEGATE.
 *
 * WHAT IS PINNED, in the story's own words:
 *
 *   1. THE RECORD: a session entry may carry the EXACT folder it was recorded
 *      in; an older id-only line still parses and writes the same bytes; the
 *      pure reader returns the LAST session pair, or null.
 *   2. THE WIRE: a run request may carry {sessionId, cwd}; an unbound line has
 *      the bytes it always had; a resume without its folder is refused, and a
 *      resume naming another folder than the run's is refused before spawn.
 *   3. THE FAKE SERVER: a fresh spawn resumes the same session id, in the same
 *      folder, and the answer names the earlier prompts back; a mismatched
 *      folder is one sentence; the resumed run is still killed at the end.
 *   4. ONE STRING: the follow-up's wire prompt, the pre-send readback and the
 *      recorded send are the same bytes, and the follow-up packet carries the
 *      task and the bound and NO card blocks.
 *   5. THREE REFUSALS: each is one sentence, and each sends nothing and writes
 *      nothing.
 *   6. THE CARD: the second composer appears only when a session with its
 *      folder is recorded; the verb is gated on the row's capability and on
 *      busy; a row that cannot continue shows the honest line instead.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-session-resume-"));
const PIPES: SidecarPipe[] = [];

afterAll(() => {
  for (const pipe of PIPES) pipe.stop();
  rmSync(ROOT, { recursive: true, force: true });
});

function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

function folder(prefix = "folder-"): string {
  return mkdtempSync(join(ROOT, prefix));
}

function nodeIo(): SessionIo {
  return {
    async readTextFile(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    async writeTextFile(path, content) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    async createDirAll(path) {
      mkdirSync(path, { recursive: true });
    },
  };
}

const NOW = "2026-11-19T00:00:00.000Z";

const SESSION: SessionCardRecord = {
  on: "the-session",
  name: "A session",
  x: 0,
  y: 0,
  tool: "a-row",
};

const RECORDED: SessionEntry = {
  kind: "session",
  id: "session-1",
  cwd: "/home/ada/code/rain",
};

/** A row whose server continues sessions over the protocol. */
function resumableRow(reportPath: string): AcpSpec {
  return {
    kind: "acp",
    id: "a-row",
    name: "A row",
    verified: false,
    resume: "protocol",
    command: BUN,
    args: [FAKE_SERVER, "resume", "--report", reportPath],
    cwdPolicy: "session",
    env: [],
    timeoutMinutes: 1,
    notes: "a test row",
  };
}

const STARTED: SidecarStart = {
  kind: "running",
  status: { running: true, entry: "", entryKind: "dev-entry", bun: "" },
};

/* ------------------------------------------------------------------ *
 * 1. The record: the session and the exact folder it was recorded in.
 * ------------------------------------------------------------------ */

describe("the session entry remembers its folder", () => {
  test("a session entry round-trips the id and the folder", () => {
    const line = serializeSessionEntryLine(RECORDED);
    // The house JSONL seam sorts keys; nothing else touches the pair.
    expect(line).toBe(
      JSON.stringify({ cwd: "/home/ada/code/rain", id: "session-1", kind: "session" }),
    );
    expect(parseSessionEntryLine(line)).toEqual(RECORDED);
    expect(parseSessionTranscript(line + "\n").entries).toEqual([RECORDED]);
    expect(
      serializeSessionTranscript(parseSessionTranscript(line + "\n").entries),
    ).toBe(line + "\n");
  });

  test("an OLD id-only line still parses, and writes the same bytes", () => {
    const old = '{"id":"session-1","kind":"session"}';
    expect(parseSessionEntryLine(old)).toEqual({
      kind: "session",
      id: "session-1",
    });
    // Back-compat pin: an entry without a folder serializes exactly as before.
    expect(serializeSessionEntryLine({ kind: "session", id: "session-1" })).toBe(
      old,
    );
    // The folder must be a non-empty string when it is there at all.
    expect(
      parseSessionEntryLine('{"cwd":"","id":"s","kind":"session"}'),
    ).toBeNull();
    expect(
      parseSessionEntryLine('{"cwd":4,"id":"s","kind":"session"}'),
    ).toBeNull();
  });

  test("sessionResumeOf returns the LAST session pair, or null", () => {
    expect(
      sessionResumeOf([
        { kind: "session", id: "first", cwd: "/one" },
        { kind: "ended", ending: "completed", t: NOW },
        { kind: "session", id: "second", cwd: "/two" },
        { kind: "text", text: "words" },
      ]),
    ).toEqual({ sessionId: "second", cwd: "/two" });
    expect(sessionResumeOf([])).toBeNull();
    expect(sessionResumeOf([{ kind: "text", text: "no session" }])).toBeNull();
    // An id-only entry is a stated hole: there is no folder to continue in.
    expect(sessionResumeOf([{ kind: "session", id: "s-1" }])).toBeNull();
  });

  test("the run's session report is mapped with its folder, not dropped", () => {
    expect(
      sessionEntryOf(
        { kind: "session", sessionId: "s-1", cwd: "/home/ada/code/rain" },
        NOW,
      ),
    ).toEqual({ kind: "session", id: "s-1", cwd: "/home/ada/code/rain" });
    // An older report that carried no folder still maps to an id-only entry.
    expect(sessionEntryOf({ kind: "session", sessionId: "s-1" }, NOW)).toEqual({
      kind: "session",
      id: "s-1",
    });
  });

  test("the row's continuation capability is optional and narrow", () => {
    const base = {
      name: "Mine",
      command: "/opt/acp/server",
      args: ["acp"],
    };
    // Absent is valid and means "cannot continue a session".
    const absent = validateAcpSpec(base);
    expect(absent.kind).toBe("row");
    if (absent.kind !== "row") throw new Error("unreachable");
    expect(absent.row).not.toHaveProperty("resume");
    // The one understood value is stored as the row's fact.
    const capable = validateAcpSpec({ ...base, resume: "protocol" });
    expect(capable.kind).toBe("row");
    if (capable.kind !== "row") throw new Error("unreachable");
    expect(capable.row.resume).toBe("protocol");
    // Anything else is refused, never stored as a hope.
    expect(validateAcpSpec({ ...base, resume: "sometimes" })).toEqual({
      kind: "refused",
      sentence:
        "an ACP row either continues a session over the protocol or it does not; the only value is protocol",
    });
  });
});

/* ------------------------------------------------------------------ *
 * 2. The wire: resume rides only when it is given, and is read strictly.
 * ------------------------------------------------------------------ */

describe("the run wire's continuation pair", () => {
  const tool = { command: "/bin/tool", args: [], timeoutMinutes: 1 };

  test("a run request with a resume round-trips", () => {
    const line = runRequestLine(7, 7, tool, {}, "follow up", {
      cwd: "/home/ada/code/rain",
      resume: { sessionId: "session-1", cwd: "/home/ada/code/rain" },
    });
    expect(parseRequestLine(line)).toEqual({
      id: 7,
      kind: "run",
      run: 7,
      tool,
      env: {},
      prompt: "follow up",
      cwd: "/home/ada/code/rain",
      resume: { sessionId: "session-1", cwd: "/home/ada/code/rain" },
    });
  });

  test("an unbound line is exactly the line it always was", () => {
    const line = runRequestLine(7, 7, tool, {}, "go");
    const value = JSON.parse(line) as Record<string, unknown>;
    expect("resume" in value).toBe(false);
    expect(line).toBe(
      '{"id":7,"kind":"run","run":7,"tool":{"command":"/bin/tool","args":[],"timeoutMinutes":1},"env":{},"prompt":"go"}',
    );
    expect(parseRequestLine(line)).toEqual({
      id: 7,
      kind: "run",
      run: 7,
      tool,
      env: {},
      prompt: "go",
    });
  });

  test("a resume without its folder is refused, never repaired", () => {
    const good = {
      id: 9,
      kind: "run",
      run: 9,
      tool,
      env: {},
      prompt: "go",
      cwd: "/home/ada/code/rain",
      resume: { sessionId: "session-1", cwd: "/home/ada/code/rain" },
    };
    expect(parseRequestLine(JSON.stringify(good))).not.toBeNull();
    const bad = [
      // A resume with no folder of its own.
      { ...good, resume: { sessionId: "session-1" } },
      // A relative folder is not a folder this wire accepts.
      { ...good, resume: { sessionId: "session-1", cwd: "rain" } },
      // An empty id names no session.
      { ...good, resume: { sessionId: "", cwd: "/home/ada/code/rain" } },
      { ...good, resume: "session-1" },
      { ...good, resume: null },
    ];
    for (const line of bad) {
      expect(parseRequestLine(JSON.stringify(line))).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3. The fake server: a fresh spawn, the same session, the same memory.
 * ------------------------------------------------------------------ */

async function sidecar(): Promise<SidecarPipe> {
  const pipe = openSidecar();
  PIPES.push(pipe);
  const hello = await pipe.hello();
  expect(hello.kind).toBe("hello");
  return pipe;
}

function requestOf(
  id: number,
  reportPath: string,
  prompt: string,
  cwd: string,
  resume?: { sessionId: string; cwd: string },
): RunRequest {
  return {
    id,
    kind: "run",
    run: id,
    tool: {
      command: BUN,
      args: [FAKE_SERVER, "resume", "--report", reportPath],
      timeoutMinutes: 1,
    },
    env: {},
    prompt,
    cwd,
    ...(resume === undefined ? {} : { resume }),
  };
}

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

async function send(pipe: SidecarPipe, line: string): Promise<void> {
  await pipe.transport.send(line);
}

interface Report {
  pid: number;
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

function sessionReportOf(entries: SidecarLine[]) {
  for (const line of entries) {
    if (line.kind !== "run-part") continue;
    if (line.entry.kind === "session") return line.entry;
  }
  return null;
}

function textOf(entries: SidecarLine[]): string {
  let text = "";
  for (const line of entries) {
    if (line.kind !== "run-part") continue;
    if (line.entry.kind === "update" && line.entry.updateKind === "agent_message_chunk") {
      text += line.entry.text;
    }
  }
  return text;
}

describe("a fresh spawn continues the same session", () => {
  test("the same id comes back, the memory names the earlier turns, and the child is killed", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const recordedFolder = folder();

    const first = requestOf(31, reportPath, "run one: say what this folder is", recordedFolder);
    const firstRun = collectRun(pipe, first.run);
    await send(pipe, JSON.stringify(first));
    const firstDone = await firstRun;
    expect(firstDone.end.kind === "run-end" ? firstDone.end.ending : null).toBe(
      "completed",
    );
    const firstSession = sessionReportOf(firstDone.entries);
    if (firstSession === null || firstSession.kind !== "session") {
      throw new Error("the first run recorded no session");
    }
    expect(firstSession.cwd).toBe(recordedFolder);
    expect(textOf(firstDone.entries)).toContain("remembers 1 prompt(s)");
    const firstPid = (await reportOf(reportPath)).pid;
    expect(await gone(firstPid)).toBe(true);

    // A FRESH SPAWN, the same id and the same folder: the fixture's store
    // survived the process, exactly as the tool's does.
    const second = requestOf(
      32,
      reportPath,
      "run two: what did run one ask?",
      recordedFolder,
      { sessionId: firstSession.sessionId, cwd: recordedFolder },
    );
    const secondRun = collectRun(pipe, second.run);
    await send(pipe, JSON.stringify(second));
    const secondDone = await secondRun;
    expect(secondDone.end.kind === "run-end" ? secondDone.end.ending : null).toBe(
      "completed",
    );
    const secondSession = sessionReportOf(secondDone.entries);
    if (secondSession === null || secondSession.kind !== "session") {
      throw new Error("the follow-up recorded no session");
    }
    // THE SAME SESSION, named back by the server, in the same folder.
    expect(secondSession.sessionId).toBe(firstSession.sessionId);
    expect(secondSession.cwd).toBe(recordedFolder);
    const answer = textOf(secondDone.entries);
    expect(answer).toContain("remembers 2 prompt(s)");
    expect(answer).toContain("run one: say what this folder is");
    expect(answer).toContain("run two: what did run one ask?");
    // THE RESUMED RUN IS STILL ONE SPAWN, KILLED AT THE END.
    const secondPid = (await reportOf(reportPath)).pid;
    expect(secondPid).not.toBe(firstPid);
    expect(await gone(secondPid)).toBe(true);
  }, 30_000);

  test("a mismatched folder is one sentence, and the run fails", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const recordedFolder = folder("recorded-");
    const otherFolder = folder("other-");

    const first = requestOf(41, reportPath, "run one", recordedFolder);
    const firstRun = collectRun(pipe, first.run);
    await send(pipe, JSON.stringify(first));
    const firstDone = await firstRun;
    const firstSession = sessionReportOf(firstDone.entries);
    if (firstSession === null || firstSession.kind !== "session") {
      throw new Error("the first run recorded no session");
    }
    await gone((await reportOf(reportPath)).pid);

    // The run's cwd matches the resume's cwd (so the lane lets it through) but
    // the session was recorded elsewhere: the SERVER refuses in one sentence.
    const second = requestOf(
      42,
      reportPath,
      "run two",
      otherFolder,
      { sessionId: firstSession.sessionId, cwd: otherFolder },
    );
    const secondRun = collectRun(pipe, second.run);
    await send(pipe, JSON.stringify(second));
    const secondDone = await secondRun;
    expect(secondDone.end.kind === "run-end" ? secondDone.end.ending : null).toBe(
      "failed",
    );
    const sentence =
      secondDone.end.kind === "run-end" ? secondDone.end.sentence : null;
    expect(typeof sentence).toBe("string");
    expect(sentence ?? "").toContain("was recorded in");
    // Nothing was answered from a memory that does not exist.
    expect(textOf(secondDone.entries)).toBe("");
  }, 30_000);

  test("the lane refuses a resume naming another folder than the run's, before spawn", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "never-spawned.json");
    const request = requestOf(51, reportPath, "run", folder(), {
      sessionId: "session-1",
      cwd: folder("elsewhere-"),
    });
    const lines: SidecarLine[] = [];
    const refused = new Promise<SidecarLine>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the lane never answered")),
        10_000,
      );
      pipe.transport.subscribe(request.run, (line) => {
        lines.push(line);
        if (line.kind === "error" || line.kind === "run-end") {
          clearTimeout(timer);
          resolve(line);
        }
      });
    });
    await send(pipe, JSON.stringify(request));
    const answer = await refused;
    // THE LANE REFUSES BEFORE ANY SPAWN: one sentence on the error line.
    expect(answer.kind).toBe("error");
    expect(answer.kind === "error" ? answer.message : null).toBe(
      RUN_RESUME_OTHER_FOLDER,
    );
    expect(lines.filter((line) => line.kind === "run-part")).toEqual([]);
    // NO CHILD WAS MADE: the fake server never wrote its report.
    expect(existsSync(reportPath)).toBe(false);
  }, 20_000);
});

/* ------------------------------------------------------------------ *
 * 4. One string: the wire, the readback and the record.
 * ------------------------------------------------------------------ */

interface FakeWire {
  sent: string[];
  transport: TurnTransport;
  answer(ending?: "completed" | "failed"): void;
}

function fakeWire(): FakeWire {
  const sent: string[] = [];
  const handlers = new Map<number, (line: SidecarLine) => void>();
  const transport: TurnTransport = {
    async send(line) {
      sent.push(line);
    },
    subscribe(id, handler) {
      handlers.set(id, handler);
      return () => {
        handlers.delete(id);
      };
    },
  };
  return {
    sent,
    transport,
    answer(ending = "completed") {
      const request = sent
        .map((line) => parseRequestLine(line))
        .find((line) => line !== null && line.kind === "run");
      if (request === null || request === undefined || request.kind !== "run") {
        throw new Error("no run request was sent");
      }
      handlers.get(request.id)?.({
        id: request.id,
        kind: "run-end",
        run: request.run,
        ending,
        sentence: null,
      });
    },
  };
}

async function until(
  predicate: () => boolean,
  budgetMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("the condition never held");
    await Bun.sleep(5);
  }
}

describe("the follow-up's bytes are one string", () => {
  test("the wire prompt, the pre-send readback and the recorded send are equal", async () => {
    const base = workspace();
    const wire = fakeWire();
    const task = "what did you change, exactly?";
    // The pre-send readback the card shows: the task and the bound, and NO
    // card blocks (the session already holds the wired context).
    const preSend = assembleSessionPacket(task, []);
    const started = startGatedSessionRun(
      base,
      {
        session: SESSION,
        task,
        context: [],
        row: resumableRow(join(base, "unused.json")),
        readings: [],
        resume: { sessionId: "session-1", cwd: "/home/ada/code/rain" },
      },
      {
        transport: wire.transport,
        start: async () => STARTED,
        transcriptIo: nodeIo(),
        now: () => NOW,
      },
    );
    if (started.kind !== "started") {
      throw new Error("the follow-up was refused: " + started.message);
    }
    await until(() => wire.sent.length > 0);
    const request = wire.sent
      .map((line) => parseRequestLine(line))
      .find((line) => line !== null && line.kind === "run");
    if (request === null || request === undefined || request.kind !== "run") {
      throw new Error("the follow-up's run request never left");
    }
    expect(request.prompt).toBe(preSend.text);
    expect(request.cwd).toBe("/home/ada/code/rain");
    expect(request.resume).toEqual({
      sessionId: "session-1",
      cwd: "/home/ada/code/rain",
    });
    // NO CARD BLOCKS: the packet is the question and the bound.
    expect(preSend.blocks.map((block) => block.kind)).toEqual([
      "question",
      "bound",
    ]);
    expect(preSend.retrievable).toEqual([]);

    wire.answer();
    const done = await started.start.done;
    expect(done.ending).toBe("completed");
    const recorded = done.entries.find((entry) => entry.kind === "sent");
    if (recorded === undefined || recorded.kind !== "sent") {
      throw new Error("the follow-up was not recorded");
    }
    expect(recorded.text).toBe(preSend.text);
    expect(recorded.text).toBe(request.prompt);
  }, 20_000);
});

/* ------------------------------------------------------------------ *
 * 5. The three refusals: one sentence, nothing sent, nothing written.
 * ------------------------------------------------------------------ */

interface PressRead {
  message: string;
  sent: string[];
  wrote: boolean;
}

/**
 * ONE PRESS, THE WAY THE HOOK MAKES IT: ask the pure gate first, and only a
 * ready answer reaches the run seam. A refused press therefore cannot have
 * sent or written anything, and this harness proves it.
 */
async function press(
  base: string,
  entries: readonly SessionEntry[],
  row: AcpSpec | null,
  folderThere: (path: string) => Promise<boolean>,
): Promise<PressRead> {
  const wire = fakeWire();
  const read = await sessionFollowUpRefusal(
    { session: SESSION, row, entries },
    folderThere,
  );
  if (read.kind === "refused") {
    return {
      message: read.message,
      sent: wire.sent,
      wrote: existsSync(sessionTranscriptPath(base, SESSION.on)),
    };
  }
  const started = startGatedSessionRun(
    base,
    {
      session: SESSION,
      task: "a follow-up",
      context: [],
      row,
      readings: [],
      resume: read.resume,
    },
    {
      transport: wire.transport,
      start: async () => STARTED,
      transcriptIo: nodeIo(),
      now: () => NOW,
    },
  );
  if (started.kind === "refused") {
    return {
      message: started.message,
      sent: wire.sent,
      wrote: existsSync(sessionTranscriptPath(base, SESSION.on)),
    };
  }
  throw new Error("the press was expected to be refused");
}

describe("an impossible continuation says one sentence and sends nothing", () => {
  const there = async () => true;
  const gone = async () => false;

  test("no recorded session", async () => {
    const base = workspace();
    const line = await press(base, [], resumableRow(join(base, "r.json")), there);
    expect(line.message).toBe(SESSION_RESUME_REFUSALS.noSession);
    expect(SESSION_RESUME_REFUSALS.noSession).toBe(
      "this session cannot be continued: no session was recorded for it.",
    );
    expect(line.sent).toEqual([]);
    expect(line.wrote).toBe(false);
  });

  test("an id-only session entry is no recorded session", async () => {
    const base = workspace();
    const line = await press(
      base,
      [{ kind: "session", id: "s-1" }],
      resumableRow(join(base, "r.json")),
      there,
    );
    expect(line.message).toBe(SESSION_RESUME_REFUSALS.noSession);
    expect(line.sent).toEqual([]);
    expect(line.wrote).toBe(false);
  });

  test("the row cannot continue a session", async () => {
    const base = workspace();
    const row = { ...resumableRow(join(base, "r.json")), resume: undefined };
    const line = await press(base, [RECORDED], row, there);
    expect(line.message).toBe(SESSION_RESUME_REFUSALS.rowCannot);
    expect(SESSION_RESUME_REFUSALS.rowCannot).toBe(
      "this tool cannot continue a session.",
    );
    expect(line.sent).toEqual([]);
    expect(line.wrote).toBe(false);
    // The shipped second row is that row: data, and no capability.
    expect(ACP_SPECS[1]?.resume).toBeUndefined();
    // The first one proved its server resumes; the fact is DATA on the row.
    expect(ACP_SPECS[0]?.resume).toBe("protocol");
  });

  test("the recorded folder is gone", async () => {
    const base = workspace();
    const line = await press(
      base,
      [RECORDED],
      resumableRow(join(base, "r.json")),
      gone,
    );
    expect(line.message).toBe(SESSION_RESUME_REFUSALS.folderGone);
    expect(SESSION_RESUME_REFUSALS.folderGone).toBe(
      "this session cannot be continued: the folder it was recorded in is not there.",
    );
    expect(line.sent).toEqual([]);
    expect(line.wrote).toBe(false);
  });

  test("a binding to another folder refuses before spawn, and writes nothing", async () => {
    const base = workspace();
    const reading: Reading = {
      on: "elsewhere",
      form: "folder",
      from: "/home/ada/code/elsewhere",
      taken: NOW,
    };
    const bound: SessionCardRecord = { ...SESSION, project: "elsewhere", boundary: "read" };
    const wire = fakeWire();
    const started = startGatedSessionRun(
      base,
      {
        session: bound,
        task: "a follow-up",
        context: [],
        row: resumableRow(join(base, "r.json")),
        readings: [reading],
        resume: { sessionId: "session-1", cwd: "/home/ada/code/rain" },
      },
      {
        transport: wire.transport,
        start: async () => STARTED,
        transcriptIo: nodeIo(),
        now: () => NOW,
      },
    );
    expect(started).toEqual({
      kind: "refused",
      message: SESSION_RESUME_OTHER_FOLDER,
    });
    expect(SESSION_RESUME_OTHER_FOLDER).toBe(
      "this session cannot be continued: this card is now bound to a different folder.",
    );
    expect(wire.sent).toEqual([]);
    expect(existsSync(sessionTranscriptPath(base, SESSION.on))).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 6. The card: the second composer, gated honestly.
 * ------------------------------------------------------------------ */

const ROW_FOLDER = "/home/ada/code/rain";

function cardMarkup(options: {
  entries: readonly SessionEntry[];
  canResume?: boolean;
  running?: boolean;
  withVerb?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(SessionCardView, {
      session: SESSION,
      toolName: "A row",
      declaration: null,
      entries: options.entries,
      canResume: options.canResume ?? false,
      running: options.running ?? false,
      open: true,
      previewLines: 6,
      onOpen: () => {},
      onClose: () => {},
      ...(options.withVerb === true
        ? { onFollowUp: async () => ({ ok: true as const }) }
        : {}),
    }),
  );
}

describe("the card's continue composer", () => {
  test("appears only when a session with its folder is recorded", () => {
    const none = cardMarkup({ entries: [] });
    expect(none).not.toContain(SESSION_FOLLOW_UP_LABEL);
    // An id-only entry (an older record) cannot continue: no composer.
    const old = cardMarkup({ entries: [{ kind: "session", id: "s-1" }] });
    expect(old).not.toContain(SESSION_FOLLOW_UP_LABEL);
    const recorded = cardMarkup({ entries: [RECORDED] });
    expect(recorded).toContain(SESSION_FOLLOW_UP_LABEL);
  });

  test("a capable row offers the verb; a blank follow-up holds it", () => {
    const markup = cardMarkup({
      entries: [RECORDED],
      canResume: true,
      withVerb: true,
      running: false,
    });
    expect(markup).toContain('class="session-card-follow-up-verb"');
    expect(markup).toContain(">continue<");
    // The field is empty, so the verb is held until the person writes words —
    // the same rule as the task's, never a send of nothing.
    expect(/class="session-card-follow-up-verb"[^>]*disabled/.test(markup)).toBe(
      true,
    );
  });

  test("the verb's own gate names busy, the row's absence of a writer, and a blank field", () => {
    const card = readFileSync(
      join(import.meta.dir, "..", "src", "canvas", "SessionCard.tsx"),
      "utf8",
    );
    expect(card).toContain("busy ||");
    expect(card).toContain("running ||");
    expect(card).toContain("onFollowUp === undefined");
    expect(card).toContain('followUp.trim() === ""');
  });

  test("busy holds the verb", () => {
    const markup = cardMarkup({
      entries: [RECORDED],
      canResume: true,
      withVerb: true,
      running: true,
    });
    expect(/class="session-card-follow-up-verb"[^>]*disabled/.test(markup)).toBe(
      true,
    );
  });

  test("a row that cannot continue shows the honest line and offers no verb", () => {
    const markup = cardMarkup({ entries: [RECORDED], canResume: false });
    expect(markup).toContain(SESSION_RESUME_REFUSALS.rowCannot);
    expect(markup).not.toContain('class="session-card-follow-up-verb"');
  });
});
