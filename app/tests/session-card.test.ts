import { afterAll, describe, expect, test } from "bun:test";
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
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import {
  SESSION_EMPTY_SENTENCE,
  SESSION_MISSING_TOOL_SENTENCE,
  SESSION_RUNNING_SENTENCE,
  addSession,
  appendSessionEntries,
  bindSessionTool,
  loadSessionTranscript,
  loadSessions,
  parseSessionEntryLine,
  parseSessionLine,
  parseSessionTranscript,
  parseSessions,
  serializeSessionTranscript,
  proposeSessionName,
  saveSessions,
  serializeSessionEntryLine,
  serializeSessions,
  serializeSessionLine,
  SESSION_RESULT_EMPTY_SENTENCE,
  SESSION_RESULT_UNFINISHED_SENTENCE,
  sessionEndingLine,
  sessionEntryLine,
  sessionKindLine,
  sessionNewestEntry,
  sessionRefusal,
  sessionResultName,
  sessionRunResult,
  sessionsPath,
  sessionTranscriptPath,
  type SessionCard as SessionCardRecord,
  type SessionEntry,
  type SessionIo,
} from "../src/map/sessions";
import { addAsk, sharedSlugs, type AskCard } from "../src/map/asks";
import { addGroundReference, type GroundReference } from "../src/map/ground";
import {
  SESSION_PROMPT,
  beginSessionRun,
  bindSessionCard,
  sessionEntryOf,
  writeResultCard,
  writeSessionCard,
} from "../src/canvas/useGround";
import { serializeReadingLine } from "../src/map/readings";
import type { AcpPermissionAsk } from "../src/turn/acpEntries";
import { allowOnceOption, refuseOption } from "../src/turn/acpEntries";
import { type SidecarStart } from "../src/turn/sidecar";
import { type TurnTransport } from "../src/turn/turn";
import {
  openSidecar,
  type SidecarPipe,
} from "./fixtures/sidecar-pipe";
import {
  SessionCard,
  SessionEntryLine,
  sessionAtBottom,
} from "../src/canvas/SessionCard";
import { ACP_SPECS, type AcpSpec } from "../src/turn/acpSpecs";
import { acpDeclaration } from "../src/turn/acpSpecs";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { CONTENT_CLASSES } from "../src/canvas/gates";

/**
 * Epic 18 story 3 — THE SESSION CARD, proven at the record, at the run and at
 * the card.
 *
 * WHAT IS BEING PROVEN, in the story's own words:
 *
 *   1. THE RECORD is `map/sessions.txt` plus one append-only transcript per
 *      card; a malformed line is preserved, never repaired, and every write
 *      appends WHOLE entries so a crash can lose the last line but never splice
 *      one in half. A second run appends after the previous `ended`.
 *   2. THE SLUG SPACE is now THREE families — ground, asks, sessions — and a
 *      duplicate is refused in every direction.
 *   3. THE RUN is 18.2's lifecycle, driven against the FAKE server: a completed
 *      run's entries in arrival order, a refused permission recorded with the
 *      reply that crossed the wire, a stopped run that keeps its partial, a
 *      dying server, a budget that runs out, and the shipped row with NO KEY
 *      failing honestly for want of one instead of hanging.
 *   4. THE CARD renders the file (so a reopen is the same card), states a
 *      missing tool row and offers the choice again, declares the next run by
 *      ROW and never by key, and never leaves a running sentence behind.
 *
 * Every "key" below is a made-up sentinel: no real account is touched, and the
 * fake server is a real child on real pipes that ignores the value it is given.
 */

const THAT = fileURLToPath(new URL(".", import.meta.url));
const BUN = process.execPath;
const FAKE = join(THAT, "fixtures", "acp-fake-server.ts");
const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-session-card-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** One fresh, empty workspace folder. */
function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

/**
 * THE TEST'S OWN BRIDGE: the app's lib/fs is the Tauri invoke seam, so a bun
 * test stands node's fs behind the SAME narrow interface the record takes.
 */
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

/** An in-memory bridge that also counts the writes it is handed. */
function memoryIo(seed: Record<string, string> = {}) {
  const files = new Map(Object.entries(seed));
  const writes: string[] = [];
  const io: SessionIo = {
    async readTextFile(path) {
      return files.has(path) ? files.get(path)! : null;
    },
    async writeTextFile(path, content) {
      writes.push(path);
      files.set(path, content);
    },
    async createDirAll() {
      // Nothing to make in memory.
    },
  };
  return { io, files, writes };
}

/** A fake row: the same shape a shipped row has, pointed at the fixture. */
function row(mode: string, extra: Partial<AcpSpec> = {}): AcpSpec {
  return {
    kind: "acp",
    id: "fake-acp",
    name: "Fake ACP",
    verified: false,
    command: BUN,
    args: [FAKE, mode],
    cwdPolicy: "session",
    env: [],
    timeoutMinutes: 1,
    notes: "a test row",
    ...extra,
  };
}

interface RunFixture {
  reportPath: string;
  sessionRoot: string;
  transcriptIo: SessionIo;
  row: AcpSpec;
}

/** One run's scaffolding: a report path, a session root, a real-file bridge. */
function fixture(mode: string, extra: Partial<AcpSpec> = {}): RunFixture {
  const base = workspace();
  const sessionRoot = join(base, "sessions");
  mkdirSync(sessionRoot);
  const reportPath = join(base, "report.json");
  return {
    reportPath,
    sessionRoot,
    transcriptIo: nodeIo(),
    row: row(mode, {
      args: [FAKE, mode, "--report", reportPath],
      ...extra,
    }),
  };
}

/**
 * STORY 18.3b — ONE REAL SIDECAR FOR THIS CARD'S RUN. The run lane left the
 * window (that is the story); these tests therefore drive the actual
 * `sidecar/main.ts` pipe, exactly as the app does, with the fake ACP server as
 * the real child. Killed with the suite.
 */
const PIPES: SidecarPipe[] = [];

afterAll(() => {
  for (const pipe of PIPES) pipe.stop();
});

const STARTED: SidecarStart = {
  kind: "running",
  status: { running: true, entry: "", entryKind: "dev-entry", bun: "" },
};

/** The app's own start (already running), and the app's own pipe. */
async function lane(): Promise<TurnTransport> {
  const pipe = openSidecar();
  PIPES.push(pipe);
  await pipe.hello();
  return pipe.transport;
}

async function reportOf(path: string): Promise<{ pid: number; env: Record<string, string> }> {
  for (let at = 0; at < 200; at += 1) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as {
        pid: number;
        env: Record<string, string>;
      };
    } catch {
      await Bun.sleep(10);
    }
  }
  throw new Error("the fake server wrote no report");
}

/** Did this pid go away? The child is reaped by close, so this settles quickly. */
async function gone(pid: number): Promise<boolean> {
  for (let at = 0; at < 200; at += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await Bun.sleep(10);
  }
  return false;
}

/** Every regular file under a folder, workspace-relative, sorted. */
function filesUnder(root: string, at = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(join(root, at)).sort()) {
    const rel = at === "" ? name : at + "/" + name;
    if (statSync(join(root, rel)).isDirectory()) out.push(...filesUnder(root, rel));
    else out.push(rel);
  }
  return out;
}

const RAIN: GroundReference = { on: "rain-gauge", name: "Rain gauge", x: 10, y: 20 };
const ASK: AskCard = {
  on: "rain-gauge-question",
  name: "Rain gauge question",
  x: 330,
  y: 20,
  anchor: "rain-gauge",
};
const SESSION: SessionCardRecord = {
  on: "rain-gauge-session",
  name: "Rain gauge session",
  x: 650,
  y: 20,
  tool: "dsh-acp",
};

/* ------------------------------------------------------------------ *
 * The record: one line per card, one append-only line per entry.
 * ------------------------------------------------------------------ */

describe("the session card's record", () => {
  test("a line round-trips, and an unreadable one is kept, never guessed", () => {
    const line = serializeSessionLine(SESSION);
    expect(line).toBe(
      "on: rain-gauge-session | name: Rain gauge session | x: 650 | y: 20 | tool: dsh-acp",
    );
    expect(parseSessionLine(line)).toEqual(SESSION);
    // A key is not a field this record has, so a line cannot carry one.
    expect(line).not.toContain("key");

    const text = [
      line,
      "on: | name: broken | x: 1 | y: 2 | tool: x",
      "on: ok | name:   | x: 1 | y: 2 | tool: x",
      "on: ok | name: a card | x: 1.5 | y: 2 | tool: x",
    ].join("\n");
    const parsed = parseSessions(text);
    expect(parsed.sessions).toEqual([SESSION]);
    expect(parsed.malformed).toHaveLength(3);
    // The writer hands every kept line straight back: nothing is repaired.
    expect(serializeSessions(parsed.sessions, parsed.malformed)).toBe(
      text + "\n",
    );
  });

  test("a card that opens its tool row's record is a stated hole, not a parse error", () => {
    const gone = { ...SESSION, tool: "a-row-this-build-does-not-ship" };
    expect(parseSessionLine(serializeSessionLine(gone))).toEqual(gone);
    expect(sessionKindLine(null)).toBe("a run of a tool that is not here");
    expect(sessionKindLine("DeepSeek Harness (ACP)")).toBe(
      "a run of DeepSeek Harness (ACP)",
    );
  });

  test("the transcript keeps whole entries and an earlier line is a prefix", async () => {
    const { io, files } = memoryIo();
    const path = sessionTranscriptPath("/w", "one");
    // A hand edit: one kept line that does not parse, and no trailing newline.
    files.set(path, '{"kind":"text","text":"kept"}\nnot json at all');

    await appendSessionEntries(
      "/w",
      "one",
      [{ kind: "tool", name: "Read", status: "pending" }],
      io,
    );
    const after = files.get(path)!;
    // The earlier bytes are a prefix that never changed ...
    expect(after.startsWith('{"kind":"text","text":"kept"}\nnot json at all\n')).toBe(
      true,
    );
    // ... and the append is ONE whole line, newline-terminated.
    expect(after.endsWith("\n")).toBe(true);
    expect(after.trimEnd().split("\n")).toHaveLength(3);

    const parsed = parseSessionTranscript(after);
    expect(parsed.entries).toEqual([
      { kind: "text", text: "kept" },
      { kind: "tool", name: "Read", status: "pending" },
    ]);
    expect(parsed.malformed).toEqual(["not json at all"]);
  });

  test("an entry out of shape is preserved, never guessed", async () => {
    const bad = [
      '{"kind":"ended","ending":"almost","t":"2026-11-18T00:00:00.000Z"}',
      '{"kind":"permission","name":"a tool","reply":"maybe"}',
      '{"kind":"tool","name":"Read"}',
      '{"kind":"text"',
      '{"kind":"session","id":""}',
      '{"kind":"started","t":"2026-11-18T00:00:00.000Z"}',
    ].join("\n");
    const parsed = parseSessionTranscript(bad);
    expect(parsed.entries).toEqual([
      { kind: "started", t: "2026-11-18T00:00:00.000Z" },
    ]);
    expect(parsed.malformed).toHaveLength(5);
    expect(parseSessionEntryLine(parsed.malformed[0]!)).toBeNull();
    // A preserved line is handed back VERBATIM by the serializer: the known
    // lines first, then the kept ones, byte for byte and never re-encoded.
    const rewritten = serializeSessionTranscript(parsed.entries, parsed.malformed);
    expect(rewritten.startsWith(serializeSessionEntryLine(parsed.entries[0]!) + "\n")).toBe(
      true,
    );
    for (const line of parsed.malformed) {
      expect(rewritten).toContain(line + "\n");
    }
  });

  test("an empty batch writes nothing at all", async () => {
    const { io, writes } = memoryIo();
    await appendSessionEntries("/w", "one", [], io);
    expect(writes).toHaveLength(0);
  });

  test("the ending says what happened, and a partial is never a result", () => {
    expect(sessionEndingLine("completed", null)).toBe(
      "the run finished.",
    );
    expect(sessionEndingLine("stopped", null)).toBe(
      "you stopped it; what arrived stays.",
    );
    expect(sessionEndingLine("timed-out", null)).toBe(
      "it ran out of its budget; what arrived stays.",
    );
    expect(sessionEndingLine("failed", "the key was not kept")).toBe(
      "the run failed: the key was not kept",
    );
    // Only the completed sentence claims a result; the two partials say what
    // they keep and never count it as one.
    for (const [ending, sentence] of [
      ["stopped", null],
      ["timed-out", null],
      ["failed", "broke"],
    ] as const) {
      expect(sessionEndingLine(ending, sentence)).not.toContain("finished");
    }
  });

  test("one entry is one quiet line per kind, never a count", () => {
    expect(sessionEntryLine({ kind: "started", t: "x" })).toBe("the run started");
    expect(sessionEntryLine({ kind: "session", id: "s-1" })).toBe(
      "a session is open",
    );
    expect(sessionEntryLine({ kind: "text", text: "the words" })).toBe("the words");
    expect(
      sessionEntryLine({ kind: "tool", name: "Read the folder", status: "pending" }),
    ).toBe("Read the folder — pending");
    expect(
      sessionEntryLine({ kind: "permission", name: "Read the folder", reply: "refused" }),
    ).toBe("Read the folder — refused");
    expect(
      sessionEntryLine({
        kind: "ended",
        ending: "stopped",
        t: "x",
      }),
    ).toBe("you stopped it; what arrived stays.");
    for (const line of [
      sessionEntryLine({ kind: "text", text: "no numbers here" }),
      sessionEntryLine({ kind: "tool", name: "Read", status: "completed" }),
    ]) {
      expect(line).not.toMatch(/\d+\s*%/);
    }
  });

  test("the newest entry is the file's last line, never a count", () => {
    expect(sessionNewestEntry([])).toBeNull();
    const entries: SessionEntry[] = [
      { kind: "started", t: "1" },
      { kind: "text", text: "newest" },
    ];
    expect(sessionNewestEntry(entries)).toEqual({
      kind: "text",
      text: "newest",
    });
    expect(sessionAtBottom(100, 50, 150)).toBe(true);
    expect(sessionAtBottom(0, 50, 150)).toBe(false);
  });

  test("a blank name refuses before anything is named", () => {
    expect(sessionRefusal("  ")).toBe("name it first.");
    expect(sessionRefusal("a run")).toBeNull();
    expect(proposeSessionName("Fake ACP")).toBe("Fake ACP session");
  });

  test("a card can be bound to another row, one field at a time", () => {
    const sessions = [SESSION];
    expect(bindSessionTool(sessions, "rain-gauge-session", "other-row")).toEqual([
      { ...SESSION, tool: "other-row" },
    ]);
    expect(bindSessionTool(sessions, "no-such-card", "other-row")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The shared slug space, now three families.
 * ------------------------------------------------------------------ */

describe("one slug space, three families", () => {
  test("a session card cannot twin a reference or an ask card", () => {
    // An ask card already holds the slug the person's new name would mint.
    const taken = sharedSlugs(
      [RAIN],
      [{ ...ASK, on: "rain-gauge-session" }],
      [],
    );
    const made = addSession([], taken, "Rain gauge session", 0, 0, "dsh-acp");
    expect(made.session.on).toBe("rain-gauge-session-2");
  });

  test("a new ask card cannot twin a session card", () => {
    const taken = sharedSlugs([RAIN], [ASK], [SESSION]);
    const made = addAsk([ASK], taken, "Rain gauge session", 330, 20, RAIN.on);
    expect(made.ask.on).toBe("rain-gauge-session-2");
  });

  test("a new reference cannot twin a session card", () => {
    const taken = sharedSlugs([RAIN], [ASK], [SESSION]);
    const made = addGroundReference(
      [RAIN],
      "Rain gauge session",
      10,
      20,
      taken,
    );
    expect(made.reference.on).toBe("rain-gauge-session-2");
  });

  test("the creation write mints against all three files, and writes one line", async () => {
    const base = workspace();
    const sessions = [SESSION];
    const written = await writeSessionCard(
      base,
      [RAIN],
      [ASK],
      sessions,
      [],
      "Rain gauge session",
      "dsh-acp",
      900,
      20,
      {
        saveSessions: async (workspacePath, records, malformed, io) =>
          saveSessions(workspacePath, records, malformed, io ?? nodeIo()),
      },
    );
    expect(written.session.on).toBe("rain-gauge-session-2");
    const text = readFileSync(sessionsPath(base), "utf8");
    expect(text.trimEnd().split("\n")).toHaveLength(2);
    expect(text).toContain(serializeSessionLine(written.session));
    // Nothing else appeared: a card that has never run has no transcript.
    expect(filesUnder(base)).toEqual(["map/sessions.txt"]);
  });
});

/* ------------------------------------------------------------------ *
 * The run, through the sidecar (18.3b: the lane left the window).
 * ------------------------------------------------------------------ */

describe("a run's transcript, appended as it arrives", () => {
  test("a completed run's entries are in arrival order, and only the ending is a result", async () => {
    const fx = fixture("tools");
    const base = workspace();
    const started = beginSessionRun(base, fx.row, "one", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
      now: () => "2026-11-18T00:00:00.000Z",
    });
    const done = await started.done;

    expect(done.ending).toBe("completed");
    expect(done.sentence).toBeNull();
    expect(done.notice).toBeNull();
    expect(done.entries.map((entry) => entry.kind)).toEqual([
      "started",
      "session",
      "tool",
      "text",
      "tool",
      "text",
      "ended",
    ]);
    // The tool call is recorded with the name the server gave it and the
    // status it reported, twice: pending, then completed.
    expect(done.entries[2]).toEqual({
      kind: "tool",
      name: "Read the working directory",
      status: "pending",
    });
    expect(done.entries[4]).toEqual({
      kind: "tool",
      name: "a tool call",
      status: "completed",
    });
    // The words are VERBATIM, in the order they arrived.
    expect(done.entries[3]).toEqual({ kind: "text", text: "one " });
    expect(done.entries[5]).toEqual({ kind: "text", text: "two" });
    expect(done.entries[6]).toEqual({
      kind: "ended",
      ending: "completed",
      t: "2026-11-18T00:00:00.000Z",
    });

    // The FILE is the same record, one whole line per entry, in order.
    const text = readFileSync(
      sessionTranscriptPath(base, "one"),
      "utf8",
    );
    expect(text).toBe(serializeSessionTranscript(done.entries));
    expect(text.endsWith("\n")).toBe(true);
    // And the child is dead on this path, like every other.
    expect(await gone((await reportOf(fx.reportPath)).pid)).toBe(true);
  });

  test("a permission waits for the person, and the REFUSAL crosses the wire", async () => {
    const fx = fixture("normal");
    const base = workspace();
    // The run WAITS; this watcher is the person, pressing refuse. The ask's own
    // options include an always offer, and the transcript records only the
    // rejection that crossed.
    let started: ReturnType<typeof beginSessionRun> | null = null;
    started = beginSessionRun(base, fx.row, "one", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
      onPermission: (ask) => {
        started?.handle.answerPermission(ask.id, "refuse");
      },
    });
    const done = await started.done;
    expect(done.entries).toContainEqual({
      kind: "permission",
      name: "Read the working directory",
      reply: "refused",
    });
    expect(done.ending).toBe("completed");
    expect(await gone((await reportOf(fx.reportPath)).pid)).toBe(true);
  });

  test("an ALLOW-ONCE is the only allow the transcript can state", async () => {
    const fx = fixture("normal");
    const base = workspace();
    let started: ReturnType<typeof beginSessionRun> | null = null;
    started = beginSessionRun(base, fx.row, "one", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
      onPermission: (ask) => {
        // The fake offers allow-always beside allow-once. The card's verb is
        // allow-once, so that is what the sidecar turns it into.
        expect(ask.options.map((option) => option.kind)).toContain(
          "allow_always",
        );
        started?.handle.answerPermission(ask.id, "allow-once");
      },
    });
    const done = await started.done;
    expect(done.entries).toContainEqual({
      kind: "permission",
      name: "Read the working directory",
      reply: "allowed-once",
    });
    expect(
      done.entries.some(
        (entry) => entry.kind === "text" && entry.text === "allowed ",
      ),
    ).toBe(true);
    expect(done.ending).toBe("completed");
    const text = readFileSync(sessionTranscriptPath(base, "one"), "utf8");
    expect(text).toContain('"reply":"allowed-once"');
    expect(text).not.toContain("always");
    expect(await gone((await reportOf(fx.reportPath)).pid)).toBe(true);
  });

  test("an unanswered permission times out and the transcript says so", async () => {
    // A short budget: nobody presses either verb, so the request outlives it.
    const fx = fixture("normal", { timeoutMinutes: 0.003 });
    const base = workspace();
    const asks: string[] = [];
    const started = beginSessionRun(base, fx.row, "one", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
      onPermission: (ask) => {
        asks.push(ask.method);
        // Deliberately no answer: the run's own budget is the only way out.
      },
    });
    const done = await started.done;
    expect(asks).toEqual(["session/request_permission"]);
    expect(done.ending).toBe("timed-out");
    // The permission line records unanswered, never a refusal nobody made.
    expect(done.entries).toContainEqual({
      kind: "permission",
      name: "Read the working directory",
      reply: "unanswered",
    });
    const last = done.entries[done.entries.length - 1]!;
    expect(last.kind).toBe("ended");
    expect(last.kind === "ended" ? last.sentence : "").toContain("unanswered");
    // And the file says the same after a reopen.
    const parsed = await loadSessionTranscript(base, "one", nodeIo());
    expect(parsed.entries).toContainEqual({
      kind: "permission",
      name: "Read the working directory",
      reply: "unanswered",
    });
    expect(await gone((await reportOf(fx.reportPath)).pid)).toBe(true);
  });

  test("a stopped run keeps the partial and says it was stopped", async () => {
    const fx = fixture("hang-mid-turn");
    const base = workspace();
    const arrived: SessionEntry[] = [];
    const started = beginSessionRun(base, fx.row, "one", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
      onEntry: (entry) => arrived.push(entry),
    });
    // Wait until the run has actually said something, then stop it.
    for (let at = 0; at < 200 && !arrived.some((e) => e.kind === "text"); at += 1) {
      await Bun.sleep(10);
    }
    started.handle.cancel();
    const done = await started.done;

    expect(done.ending).toBe("stopped");
    // The partial is KEPT, and never presented as a result.
    expect(done.entries.some((entry) => entry.kind === "text")).toBe(true);
    const last = done.entries[done.entries.length - 1]!;
    expect(last).toMatchObject({ kind: "ended", ending: "stopped" });
    expect(sessionEntryLine(last)).toBe("you stopped it; what arrived stays.");
    // The file holds the same partial and the same ending.
    const parsed = await loadSessionTranscript(base, "one", nodeIo());
    expect(parsed.entries).toEqual([...done.entries]);
    expect(await gone((await reportOf(fx.reportPath)).pid)).toBe(true);
  });

  test("a dying server is a failed run with one sentence", async () => {
    const fx = fixture("die-mid-turn");
    const base = workspace();
    const started = beginSessionRun(base, fx.row, "one", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
    });
    const done = await started.done;
    expect(done.ending).toBe("failed");
    expect(done.sentence).toBeTruthy();
    const last = done.entries[done.entries.length - 1]!;
    expect(last.kind).toBe("ended");
    expect(last.kind === "ended" ? last.sentence : null).toBe(done.sentence);
    // What arrived before the break is kept.
    expect(done.entries.some((entry) => entry.kind === "text")).toBe(true);
    expect(sessionEntryLine(last)).toContain("the run failed:");
    expect(await gone((await reportOf(fx.reportPath)).pid)).toBe(true);
  });

  test("a run that runs out of its budget is timed-out, never a result", async () => {
    // The wire's budget is a number of minutes so a test can state a short
    // one; a ROW still refuses anything under a minute (acpSpecs' rule).
    const fx = fixture("silent", { timeoutMinutes: 0.003 });
    const base = workspace();
    const started = beginSessionRun(base, fx.row, "one", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
    });
    const done = await started.done;
    expect(done.ending).toBe("timed-out");
    const last = done.entries[done.entries.length - 1]!;
    expect(last).toMatchObject({ kind: "ended", ending: "timed-out" });
    expect(sessionEntryLine(last)).toBe(
      "it ran out of its budget; what arrived stays.",
    );
    expect(await gone((await reportOf(fx.reportPath)).pid)).toBe(true);
  });

  test("the shipped row has NO key, and its run fails for want of one instead of hanging", async () => {
    // The shipped row is the one the card offers, unedited: no env entry, so
    // the declaration already says it will receive no key.
    const shipped = ACP_SPECS[0]!;
    expect(shipped.env).toEqual([]);
    expect(acpDeclaration(shipped)).toContain("no key");

    // The fake reproduces the spike's 18.1 finding byte for byte, because that
    // is what a real run with no key hits first.
    const fx = fixture("no-key");
    const base = workspace();
    const started = beginSessionRun(base, fx.row, "one", {
      // No readKey needed: a row with no env entry reads nothing.
      readKey: async () => {
        throw new Error("a row with no env entry must read no key");
      },
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
    });
    const done = await started.done;

    expect(done.ending).toBe("failed");
    expect(done.sentence).toContain("no API key");
    // The CARD's line says the same thing, and it survives a reopen because
    // the ending (with its one sentence) is the transcript's.
    const last = done.entries[done.entries.length - 1]!;
    expect(last.kind).toBe("ended");
    const line = sessionEntryLine(last);
    expect(line).toContain("the run failed:");
    expect(line).toContain("no API key");
    const parsed = await loadSessionTranscript(base, "one", nodeIo());
    expect(parsed.entries[parsed.entries.length - 1]).toEqual(last);
    // Nothing hung: the child was killed on this path like every other.
    expect(await gone((await reportOf(fx.reportPath)).pid)).toBe(true);
  });

  test("a second run appends after the previous run's ended line", async () => {
    const fx = fixture("tools");
    const base = workspace();
    const first = await beginSessionRun(base, fx.row, "one", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
    }).done;
    const afterFirst = readFileSync(sessionTranscriptPath(base, "one"), "utf8");

    const second = await beginSessionRun(base, fx.row, "one", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
    }).done;
    const afterSecond = readFileSync(sessionTranscriptPath(base, "one"), "utf8");

    // The first run's bytes are a PREFIX of the file: append-only, like a
    // conversation. The second run starts after the first one's ended line.
    expect(afterSecond.startsWith(afterFirst)).toBe(true);
    const parsed = await loadSessionTranscript(base, "one", nodeIo());
    expect(parsed.entries).toEqual([...first.entries, ...second.entries]);
    const ends = parsed.entries.filter((entry) => entry.kind === "ended");
    expect(ends).toHaveLength(2);
    const starts = parsed.entries.filter((entry) => entry.kind === "started");
    expect(starts).toHaveLength(2);
    const firstEnd = parsed.entries.findIndex((entry) => entry.kind === "ended");
    const secondStart = parsed.entries.findIndex(
      (entry, index) => index > firstEnd && entry.kind === "started",
    );
    expect(secondStart).toBeGreaterThan(firstEnd);
  });

  test("no key reaches the transcript, a sentence or the declaration", async () => {
    const SENTINEL = "sk-session-test-SENTINEL";
    const fx = fixture("tools", {
      env: [{ name: "DEEPSEEK_API_KEY", key: "row-1" }],
    });
    const base = workspace();
    const started = beginSessionRun(base, fx.row, "one", {
      readKey: async (providerId: string) => {
        expect(providerId).toBe("row-1");
        return SENTINEL;
      },
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
      now: () => "2026-11-18T00:00:00.000Z",
    });
    const done = await started.done;

    // The declaration names the ROW, never the value.
    expect(acpDeclaration(fx.row)).toBe(
      "this run will receive the key named row-1",
    );
    expect(acpDeclaration(fx.row)).not.toContain(SENTINEL);

    // The key DID reach the child through the request's PAYLOAD (there is no
    // other path: the sidecar holds no store), beside PATH/HOME and nothing
    // else. The report is the child's own view.
    const report = await reportOf(fx.reportPath);
    expect(report.env.DEEPSEEK_API_KEY).toBe(SENTINEL);
    expect(Object.keys(report.env).sort()).toEqual([
      "DEEPSEEK_API_KEY",
      "HOME",
      "PATH",
    ]);

    // The transcript, the entries and every sentence the card can draw are
    // free of it.
    const text = readFileSync(sessionTranscriptPath(base, "one"), "utf8");
    expect(text).not.toContain(SENTINEL);
    for (const entry of done.entries) {
      expect(serializeSessionEntryLine(entry)).not.toContain(SENTINEL);
      expect(sessionEntryLine(entry)).not.toContain(SENTINEL);
    }
    expect(await gone((await reportOf(fx.reportPath)).pid)).toBe(true);
  });

  test("the card's record path writes nothing outside map/", async () => {
    const base = workspace();
    await writeSessionCard(
      base,
      [],
      [],
      [],
      [],
      "a run",
      "dsh-acp",
      10,
      20,
      {
        saveSessions: async (workspacePath, records, malformed, io) =>
          saveSessions(workspacePath, records, malformed, io ?? nodeIo()),
      },
    );
    const fx = fixture("tools");
    await beginSessionRun(base, fx.row, "a-run", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
    }).done;
    for (const file of filesUnder(base)) {
      expect(file.startsWith("map/")).toBe(true);
    }
    expect(filesUnder(base).sort()).toEqual([
      "map/sessions.txt",
      "map/sessions/a-run.jsonl",
    ]);
  });

  test("how a report becomes an entry is pure, and a thought is not the agent's words", () => {
    const at = "2026-11-18T00:00:00.000Z";
    expect(
      sessionEntryOf(
        {
          kind: "update",
          updateKind: "agent_message_chunk",
          text: "words",
          update: {},
        },
        at,
      ),
    ).toEqual({ kind: "text", text: "words" });
    expect(
      sessionEntryOf(
        {
          kind: "update",
          updateKind: "agent_message_chunk",
          text: "",
          update: {},
        },
        at,
      ),
    ).toBeNull();
    expect(
      sessionEntryOf(
        {
          kind: "update",
          updateKind: "agent_thought_chunk",
          text: "a thought",
          update: {},
        },
        at,
      ),
    ).toBeNull();
    expect(
      sessionEntryOf(
        {
          kind: "started",
          command: "x",
          args: [],
          cwd: "/tmp/x",
          declaration: "no key",
          inherited: ["PATH"],
          envNames: [],
        },
        at,
      ),
    ).toEqual({ kind: "started", t: at });
    expect(sessionEntryOf({ kind: "problem", sentence: "stderr noise" }, at)).toBeNull();
    expect(
      sessionEntryOf(
        { kind: "ended", ending: "failed", stopReason: null, sentence: "broke", partial: true },
        at,
      ),
    ).toEqual({ kind: "ended", ending: "failed", t: at, sentence: "broke" });
    // STORY 18.4 — THE NO-ALWAYS RULE, as values. allow-once matches ONLY the
    // protocol's allow_once kind, refuse matches a reject kind, and an offer
    // that has only an always option can produce no allow at all.
    const offered = [
      { optionId: "allow-once", name: "Allow", kind: "allow_once" },
      { optionId: "allow-always", name: "Always", kind: "allow_always" },
      { optionId: "reject-once", name: "Reject", kind: "reject_once" },
    ];
    expect(allowOnceOption(offered)?.optionId).toBe("allow-once");
    expect(refuseOption(offered)?.optionId).toBe("reject-once");
    expect(
      allowOnceOption([
        { optionId: "allow-always", name: "Always", kind: "allow_always" },
      ]),
    ).toBeNull();
    expect(
      refuseOption([
        { optionId: "allow-always", name: "Always", kind: "allow_always" },
      ]),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * The card: two faces, the endings, and a reopen that is the same card.
 * ------------------------------------------------------------------ */

describe("the session card", () => {
  const rendered = (props: Record<string, unknown>) =>
    renderToStaticMarkup(
      createElement(SessionCard, {
        session: SESSION,
        toolName: "DeepSeek Harness (ACP)",
        declaration: acpDeclaration(ACP_SPECS[0]!),
        tools: [{ id: "dsh-acp", name: "DeepSeek Harness (ACP)" }],
        entries: [],
        running: false,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onRun: async () => ({ ok: true }),
        onStop: async () => {},
        onChooseTool: async () => ({ ok: true }),
        ...props,
      } as never),
    );

  test("the expanded face shows the transcript in order, and the declaration names the row", () => {
    const entries: SessionEntry[] = [
      { kind: "started", t: "1" },
      { kind: "session", id: "s-1" },
      { kind: "text", text: "the first words" },
      { kind: "tool", name: "Read the folder", status: "pending" },
      { kind: "permission", name: "Read the folder", reply: "refused" },
      { kind: "text", text: "the last words" },
      { kind: "ended", ending: "stopped", t: "2" },
    ];
    const html = rendered({ entries });
    expect(html).toContain("Rain gauge session");
    expect(html).toContain("a run of DeepSeek Harness (ACP)");
    // The words and the tool's name plus status, in order.
    expect(html.indexOf("the first words")).toBeLessThan(
      html.indexOf("the last words"),
    );
    expect(html).toContain("Read the folder");
    expect(html).toContain("pending");
    expect(html).toContain("refused");
    // The ending's one line, and the declaration for the next run.
    expect(html).toContain("you stopped it; what arrived stays.");
    expect(html).toContain("this run will receive no key");
    expect(html).not.toContain("key named");
    // Never a percentage and never a step count.
    expect(html).not.toMatch(/\d+\s*%/);
    expect(html).not.toMatch(/\d+\s*(of|\/)\s*\d+/);
  });

  test("the small face shows the newest entry, never a count", () => {
    const html = rendered({
      open: false,
      entries: [
        { kind: "started", t: "1" },
        { kind: "text", text: "the newest thing" },
      ],
    });
    expect(html).toContain("the newest thing");
    expect(html).not.toContain("the run started");
    expect(rendered({ open: false, entries: [] })).toContain(
      SESSION_EMPTY_SENTENCE,
    );
  });

  test("the card re-renders from the file on reopen", async () => {
    const base = workspace();
    await writeSessionCard(
      base,
      [],
      [],
      [],
      [],
      "Rain gauge session",
      "dsh-acp",
      650,
      20,
      {
        saveSessions: async (workspacePath, records, malformed, io) =>
          saveSessions(workspacePath, records, malformed, io ?? nodeIo()),
      },
    );
    const fx = fixture("tools");
    await beginSessionRun(base, fx.row, "rain-gauge-session", {
      readKey: async () => "",
      transport: await lane(),
      start: async () => STARTED,
      transcriptIo: fx.transcriptIo,
      now: () => "2026-11-18T00:00:00.000Z",
    }).done;

    // A REOPEN is nothing but the load: the card and its transcript from the
    // files, with no view state left over from the run.
    const loaded = await loadSessions(base, nodeIo());
    expect(loaded.malformed).toEqual([]);
    expect(loaded.sessions).toHaveLength(1);
    const reopened = loaded.sessions[0]!;
    expect(reopened.on).toBe("rain-gauge-session");
    const transcript = await loadSessionTranscript(
      base,
      reopened.on,
      nodeIo(),
    );
    expect(transcript.malformed).toEqual([]);
    expect(transcript.entries[transcript.entries.length - 1]).toMatchObject({
      kind: "ended",
      ending: "completed",
    });

    const html = renderToStaticMarkup(
      createElement(SessionCard, {
        session: reopened,
        toolName: "Fake ACP",
        declaration: acpDeclaration(fx.row),
        tools: [{ id: fx.row.id, name: fx.row.name }],
        entries: transcript.entries,
        running: false,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("Rain gauge session");
    expect(html).toContain("a run of Fake ACP");
    expect(html).toContain("one ");
    expect(html).toContain("the run finished.");
    // Rendering the same bytes again is the same card: nothing is invented.
    expect(
      renderToStaticMarkup(
        createElement(SessionCard, {
          session: reopened,
          toolName: "Fake ACP",
          declaration: acpDeclaration(fx.row),
          tools: [{ id: fx.row.id, name: fx.row.name }],
          entries: transcript.entries,
          running: false,
          open: true,
          previewLines: 6,
          onOpen: () => {},
          onClose: () => {},
        }),
      ),
    ).toBe(html);
  });

  test("a missing tool row is stated, and the choice is offered again", async () => {
    const base = workspace();
    await saveSessions(
      base,
      [{ ...SESSION, tool: "a-row-that-is-gone" }],
      [],
      nodeIo(),
    );
    const loaded = await loadSessions(base, nodeIo());
    const record = loaded.sessions[0]!;
    expect(record.tool).toBe("a-row-that-is-gone");
    expect(sessionKindLine(null)).toBe("a run of a tool that is not here");
    const html = rendered({
      session: record,
      toolName: null,
      declaration: null,
      entries: [],
    });
    expect(html).toContain(SESSION_MISSING_TOOL_SENTENCE);
    expect(html).toContain("use this tool");
    expect(html).toContain("DeepSeek Harness (ACP)");
    // The run verb is not offered while there is no row to run.
    expect(html).toContain("disabled");
  });

  test("the choice is one field's change, written once", async () => {
    const base = workspace();
    await saveSessions(
      base,
      [{ ...SESSION, tool: "a-row-that-is-gone" }],
      [],
      nodeIo(),
    );
    const next = await bindSessionCard(
      base,
      [{ ...SESSION, tool: "a-row-that-is-gone" }],
      [],
      "rain-gauge-session",
      "dsh-acp",
      {
        saveSessions: async (workspacePath, records, malformed, io) =>
          saveSessions(workspacePath, records, malformed, io ?? nodeIo()),
      },
    );
    expect(next).toEqual([SESSION]);
    const reloaded = await loadSessions(base, nodeIo());
    expect(reloaded.sessions).toEqual([SESSION]);
  });

  test("no running sentence (and no stop verb) outlives its run", () => {
    const entries: SessionEntry[] = [
      { kind: "started", t: "1" },
      { kind: "ended", ending: "stopped", t: "2" },
    ];
    const settled = rendered({ entries, running: false });
    expect(settled).not.toContain(SESSION_RUNNING_SENTENCE);
    expect(settled).not.toContain(">stop<");
    expect(settled).toContain(">run<");

    const live = rendered({ entries, running: true });
    expect(live).toContain(SESSION_RUNNING_SENTENCE);
    expect(live).toContain(">stop<");
    // While it runs there is no second run: the run verb is gone, not merely
    // disabled, so a second child can never be started by a stray press.
    expect(live).not.toContain(">run<");
  });

  test("one entry renders by its kind, and a crop only ever cuts words", () => {
    const words = renderToStaticMarkup(
      createElement(SessionEntryLine, {
        entry: { kind: "text", text: "the first line\nthe second line\nthe third line" },
      }),
    );
    expect(words).toContain("the third line");
    // The crop is the stated LINE count (the house's crop): two lines, and the
    // one quiet mark that says more is behind them.
    const cropped = renderToStaticMarkup(
      createElement(SessionEntryLine, {
        entry: { kind: "text", text: "the first line\nthe second line\nthe third line" },
        crop: 2,
      }),
    );
    expect(cropped).toContain("the second line");
    expect(cropped).not.toContain("the third line");
    expect(cropped).toContain("…");
    // A tool's name is one line already: a crop never cuts it.
    const tool = renderToStaticMarkup(
      createElement(SessionEntryLine, {
        entry: { kind: "tool", name: "Read the whole folder", status: "completed" },
        crop: 1,
      }),
    );
    expect(tool).toContain("Read the whole folder");
    expect(tool).toContain("completed");
  });
});


/* ------------------------------------------------------------------ *
 * The seam's own rules, where they live (the house's source assertions).
 * ------------------------------------------------------------------ */

describe("the session seam's rules", () => {
  const HOOK = readFileSync(
    join(THAT, "..", "src", "canvas", "useGround.ts"),
    "utf8",
  );
  const APP = readFileSync(join(THAT, "..", "src", "App.tsx"), "utf8");
  const LAYER = readFileSync(
    join(THAT, "..", "src", "canvas", "GroundLayer.tsx"),
    "utf8",
  );

  test("one run per card at a time, and the handle is dropped when it settles", () => {
    expect(HOOK).toContain("sessionRunsRef.current[slug] !== undefined");
    expect(HOOK).toContain("SESSION_BUSY_SENTENCE");
    // The running list is what the card reads, so a settled run cannot leave a
    // stop verb or a running sentence behind.
    expect(HOOK).toContain("sessionRunningRef.current.filter(");
    expect(HOOK).toContain("delete runs[slug]");
  });

  test("stop is the run's own cancel, and leaving the workspace cancels too", () => {
    // 18.2's rule survives: stop cancels the session, and the run kills its
    // child on every exit path (proven in the acp-run suite).
    expect(HOOK).toContain("handle.cancel()");
    expect(HOOK).toContain(
      "for (const handle of Object.values(sessionRunsRef.current))",
    );
  });

  test("the transcript is appended as it arrives and read back after the run", () => {
    expect(HOOK).toContain("appendSessionEntries(");
    // The view follows each entry, and the file is re-read once at the end so
    // the card shows the same bytes a reopen would.
    expect(HOOK).toContain("[slug]: [...current, entry]");
    expect(HOOK).toContain("loadSessionTranscript(workspacePath, slug)");
  });

  test("the window no longer refuses to run, because it no longer starts one", () => {
    // STORY 18.3b removed the probe AND its sentence: the reason for both (the
    // window spawning a child) is gone. The run is asked of the sidecar.
    expect(HOOK).not.toContain("sessionRuntimeReady");
    expect(HOOK).not.toContain("this window cannot start a process");
    expect(HOOK).toContain("startSessionRun(");
  });

  test("the app wires the card's creation, its run, its stop and its bind", () => {
    expect(APP).toContain("onAddSession={addGroundSessionAt}");
    expect(APP).toContain("sessions={ground.sessions}");
    expect(APP).toContain("sessionEntries={ground.sessionEntries}");
    expect(APP).toContain("sessionRunning={ground.sessionRunning}");
    expect(APP).toContain("onRunSession={ground.runSession}");
    expect(APP).toContain("onStopSession={ground.stopSession}");
    expect(APP).toContain("onChooseSessionTool={ground.bindSessionTool}");
    // STORY 18.4: the pending ask, its two verbs and the result copy are wired
    // from the same hook, through the same layer.
    expect(APP).toContain("sessionPermission={ground.sessionPermission}");
    expect(APP).toContain(
      "onAnswerSessionPermission={ground.answerSessionPermission}",
    );
    expect(APP).toContain("onMakeSessionResult={ground.makeCardFromRun}");
    expect(HOOK).toContain("handle.answerPermission(ask.id, choice)");
    expect(HOOK).toContain("writeResultCard(");
    expect(LAYER).toContain("<SessionCardView");
    // The layer resolves the row this build ships; a record that names another
    // one is a stated hole, never a repaired record.
    expect(LAYER).toContain("ACP_SPECS.find(");
    expect(LAYER).toContain("acpDeclaration(row)");
  });
});

/* ------------------------------------------------------------------ *
 * STORY 18.4 — allow or refuse, and a result becomes a card.
 * ------------------------------------------------------------------ */

const PERMISSION: AcpPermissionAsk = {
  id: 100,
  method: "session/request_permission",
  toolCall: {
    toolCallId: "call-1",
    title: "Read the working directory",
    kind: "read",
    status: "pending",
  },
  options: [
    { optionId: "allow-once", name: "Allow once", kind: "allow_once" },
    { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
    { optionId: "reject-once", name: "Reject", kind: "reject_once" },
  ],
};

/** A selection bridge that writes its text to the real folder and counts. */
function selectionIo(root: string): {
  io: {
    storeSelectionText: (workspacePath: string, on: string, text: string) => Promise<void>;
    saveReadings: () => Promise<void>;
    saveGround: () => Promise<void>;
  };
  texts: Map<string, string>;
} {
  const texts = new Map<string, string>();
  return {
    texts,
    io: {
      async storeSelectionText(_workspacePath, on, text) {
        mkdirSync(join(root, "map", "readings"), { recursive: true });
        writeFileSync(join(root, "map", "readings", on + ".md"), text);
        texts.set(on, text);
      },
      async saveReadings() {},
      async saveGround() {},
    },
  };
}

describe("the pending permission", () => {
  test("the card says what the tool asks and offers only allow once or refuse", () => {
    const html = renderToStaticMarkup(
      createElement(SessionCard, {
        session: SESSION,
        toolName: "DeepSeek Harness (ACP)",
        declaration: acpDeclaration(ACP_SPECS[0]!),
        tools: [],
        entries: [],
        running: true,
        open: true,
        previewLines: 6,
        permission: PERMISSION,
        onOpen: () => {},
        onClose: () => {},
        onAllowOnce: () => {},
        onRefuse: () => {},
      }),
    );
    expect(html).toContain("Read the working directory");
    expect(html).toContain("allow once");
    expect(html).toContain("refuse");
    // The server offered all three; the card presents TWO verbs and never the
    // remembered yes it was offered.
    expect(html.toLowerCase()).not.toContain("always");
    expect(html).not.toContain("allow-always");
  });

  test("with no allow-once option, allow is disabled and the card says why", () => {
    const html = renderToStaticMarkup(
      createElement(SessionCard, {
        session: SESSION,
        toolName: "DeepSeek Harness (ACP)",
        declaration: null,
        tools: [],
        entries: [],
        running: true,
        open: true,
        previewLines: 6,
        permission: {
          ...PERMISSION,
          options: [
            { optionId: "allow-always", name: "Allow always", kind: "allow_always" },
            { optionId: "reject-once", name: "Reject", kind: "reject_once" },
          ],
        },
        onOpen: () => {},
        onClose: () => {},
        onAllowOnce: () => {},
        onRefuse: () => {},
      }),
    );
    expect(html).toContain("no allow-once option");
    expect(html).toContain("allow once");
    expect(html).toContain("disabled");
    expect(html.toLowerCase()).not.toContain("always option");
  });
});

describe("a finished run's text becomes a card", () => {
  const entries: SessionEntry[] = [
    { kind: "started", t: "2026-11-18T00:00:00.000Z" },
    { kind: "text", text: "the answer " },
    { kind: "text", text: "in two chunks" },
    { kind: "ended", ending: "completed", t: "2026-11-18T00:01:00.000Z" },
  ];

  test("the result is the run's text entries joined in order, and a partial is no result", () => {
    expect(sessionRunResult(entries)).toEqual({
      ending: "completed",
      text: "the answer in two chunks",
    });
    // The NEWEST run is the result, even when an earlier one finished.
    const second: SessionEntry[] = [
      ...entries,
      { kind: "started", t: "2" },
      { kind: "text", text: " the second" },
      { kind: "ended", ending: "completed", t: "3" },
    ];
    expect(sessionRunResult(second).text).toBe(" the second");
    // A stopped run's words are a partial, never a result.
    expect(
      sessionRunResult([
        { kind: "started", t: "1" },
        { kind: "text", text: "half an answer" },
        { kind: "ended", ending: "stopped", t: "2" },
      ]),
    ).toEqual({ ending: "stopped", text: "" });
    expect(sessionRunResult([])).toEqual({ ending: null, text: "" });
  });

  test("the copy is the selection form, byte for byte, and later edits leave it alone", async () => {
    const base = workspace();
    const bridge = selectionIo(base);
    const result = await writeResultCard(
      base,
      [],
      [],
      [],
      [],
      SESSION,
      entries,
      "2026-11-18T00:02:00.000Z",
      bridge.io,
      { taken: new Set([SESSION.on]) },
    );
    expect(result.kind).toBe("written");
    if (result.kind !== "written") throw new Error("no result card");
    const { records, text } = result;

    // The reading IS the answer, verbatim, and its provenance is the SESSION
    // card, not a file — the existing selection form, unchanged.
    expect(text).toBe("the answer in two chunks");
    expect(records.reading).toMatchObject({
      form: "selection",
      from: "card://rain-gauge-session",
      taken: "2026-11-18T00:02:00.000Z",
    });
    expect(records.reading.on).not.toBe(SESSION.on);
    expect(serializeReadingLine(records.reading)).toContain(
      " | form: selection | from: card://rain-gauge-session | ",
    );
    expect(bridge.texts.get(records.reading.on)).toBe("the answer in two chunks");
    expect(
      readFileSync(join(base, "map", "readings", records.reading.on + ".md"), "utf8"),
    ).toBe("the answer in two chunks");

    // The card is the session's name plus a short suffix, placed beside it in
    // the EXISTING beside-the-source placement idiom (the same 320-unit offset).
    const placed = records.references.find(
      (reference) => reference.on === records.reading.on,
    )!;
    expect(placed.name).toBe("Rain gauge session result");
    expect(placed.x).toBe(SESSION.x + 320);
    expect(placed.y).toBe(SESSION.y);

    // Updating the session afterwards does NOT change the copy: it is a copy,
    // not a link. A second result card is a second, separate copy.
    const oldFile = join(base, "map", "readings", records.reading.on + ".md");
    const before = readFileSync(oldFile, "utf8");
    const edited: SessionCardRecord = { ...SESSION, name: "Renamed session" };
    const second = await writeResultCard(
      base,
      records.references,
      records.readings,
      [],
      [],
      edited,
      [...entries, { kind: "text", text: " added later" }],
      "2026-11-18T00:03:00.000Z",
      bridge.io,
      { taken: new Set([...records.references.map((r) => r.on), SESSION.on]) },
    );
    expect(second.kind).toBe("written");
    if (second.kind !== "written") throw new Error("no second card");
    expect(second.records.reading.from).toBe("card://rain-gauge-session");
    expect(readFileSync(oldFile, "utf8")).toBe(before);
    expect(readFileSync(oldFile, "utf8")).toBe(text);
    expect(second.records.reading.on).not.toBe(records.reading.on);
  });

  test("no text, or a last run that did not finish, refuses with one sentence and writes nothing", async () => {
    const base = workspace();
    const bridge = selectionIo(base);
    const empty = await writeResultCard(
      base,
      [],
      [],
      [],
      [],
      SESSION,
      [
        { kind: "started", t: "1" },
        { kind: "ended", ending: "completed", t: "2" },
      ],
      "t",
      bridge.io,
    );
    expect(empty).toEqual({
      kind: "refused",
      message: SESSION_RESULT_EMPTY_SENTENCE,
    });

    const unfinished = await writeResultCard(
      base,
      [],
      [],
      [],
      [],
      SESSION,
      [
        { kind: "started", t: "1" },
        { kind: "text", text: "half" },
        { kind: "ended", ending: "timed-out", t: "2" },
      ],
      "t",
      bridge.io,
    );
    expect(unfinished).toEqual({
      kind: "refused",
      message: SESSION_RESULT_UNFINISHED_SENTENCE,
    });
    // Nothing at all was written: no text, no line, no card.
    expect(bridge.texts.size).toBe(0);
    expect(readdirSync(join(base, "map")).sort()).toEqual([]);
  });

  test("the result verb is offered only once a run has ended", () => {
    const props = {
      session: SESSION,
      toolName: "DeepSeek Harness (ACP)",
      declaration: acpDeclaration(ACP_SPECS[0]!),
      tools: [],
      entries: [] as SessionEntry[],
      running: false,
      open: true,
      previewLines: 6,
      onOpen: () => {},
      onClose: () => {},
      onMakeResult: async () => ({ ok: true as const }),
    };
    expect(renderToStaticMarkup(createElement(SessionCard, props))).not.toContain(
      "make a card from this",
    );
    expect(
      renderToStaticMarkup(
        createElement(SessionCard, { ...props, entries }),
      ),
    ).toContain("make a card from this");
  });
});

/* ------------------------------------------------------------------ *
 * The boundaries this story must not cross.
 * ------------------------------------------------------------------ */

describe("the session card's boundaries", () => {
  test("the ground map still renders no concept content", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("the session card's classes are content to the plane's gate", () => {
    for (const name of [
      "session-card",
      "session-card-name",
      "session-card-body",
      "session-card-transcript",
      "session-entry",
      "session-card-run",
      "session-card-declaration",
      "session-card-actions",
      "session-card-stop",
      "session-card-open",
      "ground-bubble-session",
      "ground-bubble-tool",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
  });

  test("a session card's record is the row, never the prompt's wording or a value", () => {
    // The prompt is a constant of the run seam (18.4 hands map context later),
    // and it asks for words only.
    expect(SESSION_PROMPT.length).toBeGreaterThan(0);
    expect(SESSION_PROMPT).toContain("change nothing");
    expect(serializeSessionLine(SESSION)).not.toContain("DEEPSEEK");
    expect(serializeSessionLine(SESSION)).not.toMatch(/sk-/);
  });
});
