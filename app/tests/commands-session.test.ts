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
import { join, relative } from "node:path";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  acceptLine,
  createAttentioneerHost,
} from "../src/commands/attentioneerHost";
import { ACT_SPECS, validateAct } from "../src/commands/acts";
import { executeScript } from "../src/commands/execute";
import { interpreterDigest } from "../src/commands/interpreterDigest";
import {
  loadSessions,
  restoreSessionCard,
  saveSessions,
  sessionTranscriptPath,
  sessionsPath,
  type RemovedSession,
} from "../src/map/sessions";
import { nodeCommandIo } from "../scripts/commands";

/**
 * STORY 21.11 — SESSION CARDS JOIN THE VOCABULARY (ADR-0038 Amendment 2: the
 * card proposes, the person accepts, and undo is the second net AFTER the
 * accept). The session card already shared the card grammar, the name pill, a
 * task field, a tool picker, a model the tool must have named, a permission
 * lane, a stop, a curator's result card, a continue-session composer and
 * sign-in hosting; what it lacked was a place in the act table.
 *
 * What this file proves, in the story's own words:
 *
 *   - NO ACT STARTS A RUN OR SENDS A PROMPT, asserted over the WHOLE act table:
 *     a run is an egress and stays the person's press;
 *   - creating files ONE ghost bound to a shipped tool row and changes NOTHING
 *     until the accept — no card, no task, no transcript;
 *   - an unknown tool row is refused BY NAME, before any ghost;
 *   - binding changes ONLY the row field, through the same writer the card's own
 *     verb uses: the transcript, the task, the project, the boundary and the
 *     model stay exactly as they were;
 *   - removal is the app's own delete shape — the record line, then the
 *     transcript — TWO ghosts, and the app's own Restore round-trips it;
 *   - anything the digest does not know is refused by name, and the digest lists
 *     a session card by NAME and BOUND ROW only;
 *   - the ground map still renders no content family.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-session-vocabulary-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** The one shipped row the acts name by its record id. */
const ROW = "dsh-acp";
/** The other shipped row, the one a rebind moves the card to. */
const OTHER_ROW = "opencode-acp";
/** The picker's own label for the first row: what the person reads. */
const ROW_LABEL = "DeepSeek Harness (ACP) (unverified)";

/** The session card the tests bind and remove, with every optional field set. */
const SESSION_LINE =
  "on: tidy-the-notes | name: tidy the notes | x: 40 | y: 80 | tool: dsh-acp" +
  " | project: notes | boundary: read | model: [\"m1\"]\n";

/** The transcript bytes the removal must give back, byte for byte. */
const TRANSCRIPT =
  '{"kind":"started","t":"2026-11-20T00:00:00.000Z"}\n' +
  '{"kind":"sent","text":"tidy the notes","t":"2026-11-20T00:00:01.000Z"}\n' +
  '{"kind":"ended","ending":"completed","t":"2026-11-20T00:00:02.000Z"}\n';

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  writeFileSync(join(path, "map/ground.txt"), "", "utf8");
  return path;
}

/** A workspace that already holds one session card, run once. */
function ranWorkspace(): string {
  const path = freshWorkspace();
  mkdirSync(join(path, "map/sessions"), { recursive: true });
  writeFileSync(sessionsPath(path), SESSION_LINE, "utf8");
  writeFileSync(sessionTranscriptPath(path, "tidy-the-notes"), TRANSCRIPT, "utf8");
  return path;
}

/** Every file under the workspace except the intake's own folder, byte for byte. */
function recordsOf(path: string): Map<string, Buffer> {
  const found = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(path, full);
      if (rel === ".attentioneer" || rel.startsWith(".attentioneer/")) continue;
      if (entry.isDirectory()) walk(full);
      else found.set(rel, readFileSync(full));
    }
  };
  walk(path);
  return found;
}

function expectSameRecords(
  before: Map<string, Buffer>,
  after: Map<string, Buffer>,
): void {
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [rel, bytes] of before) {
    expect(after.get(rel)?.equals(bytes)).toBe(true);
  }
}

function inboxNames(path: string): string[] {
  try {
    return readdirSync(join(path, ".attentioneer/inbox")).sort();
  } catch {
    return [];
  }
}

function inboxEnvelopes(path: string): Record<string, any>[] {
  return inboxNames(path).map((name) =>
    JSON.parse(readFileSync(join(path, ".attentioneer/inbox", name), "utf8")),
  );
}

function text(path: string): string {
  return readFileSync(path, "utf8");
}

const IO = nodeCommandIo();

/* ------------------------------------------------------------------ *
 * THE HARD CONSTRAINT: NO ACT STARTS A RUN OR SENDS A PROMPT
 * ------------------------------------------------------------------ */

describe("no act starts a run or sends a prompt — asserted over the WHOLE table", () => {
  test("no act NAME can name a run, a send or a prompt", () => {
    for (const spec of ACT_SPECS) {
      expect(spec.name).not.toMatch(
        /\b(run|runs|running|send|sends|prompt|prompts|start|starts|launch|exec|egress)/i,
      );
    }
  });

  test("no act's ONE SENTENCE promises a run or a send", () => {
    // The description is prompt material as surely as the name is: a later story
    // could edit one into an egress and the table would then say the app does
    // something it does not do. The words are asserted, not trusted.
    for (const spec of ACT_SPECS) {
      expect(spec.description).not.toMatch(
        /\b(run|runs|running|send|sends|sending|prompts?|starts?|launch(es)?|executes?)\b/i,
      );
    }
  });

  test("no act's payload can carry the words a run would send", () => {
    // A task, a prompt and a message are the shape of an egress. No act in the
    // table declares one, so no model's reply can hand the app words to send.
    for (const spec of ACT_SPECS) {
      for (const field of [...spec.required, ...spec.optional]) {
        expect(field.key).not.toMatch(
          /^(task|prompt|message|turn|run|send|instruction)$/i,
        );
      }
    }
  });

  test("no act writes, and the session acts name a card and a row, nothing else", () => {
    for (const spec of ACT_SPECS) expect(spec.writes).toBe(false);
    const session = ACT_SPECS.find((spec) => spec.name === "propose_session");
    const bind = ACT_SPECS.find((spec) => spec.name === "propose_bind_session");
    const remove = ACT_SPECS.find((spec) => spec.name === "propose_remove_session");
    expect(session?.required.map((field) => field.key)).toEqual(["name", "tool"]);
    // NO COORDINATE: the host places the card (the move act's own rule).
    expect(session?.optional.map((field) => field.key)).toEqual(["why"]);
    expect(bind?.required.map((field) => field.key)).toEqual(["card", "tool"]);
    expect(remove?.required.map((field) => field.key)).toEqual(["card"]);
    // The code states the absence where the table lives, not only here.
    const source = readFileSync(
      join(import.meta.dir, "..", "src/commands/acts.ts"),
      "utf8",
    );
    expect(source).toContain("NO ACT STARTS A RUN");
    expect(source).toContain("THE NEVER-LIST IS ABSENT BY CONSTRUCTION");
  });

  test("the host never reaches the run lane, and the ground map renders no content", () => {
    const host = readFileSync(
      join(import.meta.dir, "..", "src/commands/attentioneerHost.ts"),
      "utf8",
    );
    for (const forbidden of [
      "startSessionRun",
      "../turn/acpSession",
      "../turn/acpRun",
      "runSession",
      "followUpSession",
      "appendSessionEntries",
    ]) {
      expect(host).not.toContain(forbidden);
    }
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * THE ACTS' SCHEMA
 * ------------------------------------------------------------------ */

describe("the act schema: a name, a row, one card", () => {
  test("creating wants a name and a tool row, and no coordinate", () => {
    const read = validateAct({
      act: "propose_session",
      map: "ground",
      payload: { name: "tidy the notes", tool: ROW },
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.act.payload).toEqual({ name: "tidy the notes", tool: ROW });
    // A model may not hand the app a point: the schema has none.
    const withPoint = validateAct({
      act: "propose_session",
      map: "ground",
      payload: { name: "tidy the notes", tool: ROW, x: 1, y: 2 },
    });
    expect(withPoint.ok).toBe(false);
  });

  test("binding and removal name one card; a blank row is refused", () => {
    const bind = validateAct({
      act: "propose_bind_session",
      map: "ground",
      payload: { card: "tidy the notes", tool: OTHER_ROW },
    });
    expect(bind.ok).toBe(true);
    const remove = validateAct({
      act: "propose_remove_session",
      map: "ground",
      payload: { card: "tidy the notes" },
    });
    expect(remove.ok).toBe(true);
    for (const payload of [
      { card: "tidy the notes", tool: "" },
      { card: "", tool: OTHER_ROW },
    ]) {
      expect(
        validateAct({ act: "propose_bind_session", map: "ground", payload }).ok,
      ).toBe(false);
    }
  });
});

/* ------------------------------------------------------------------ *
 * CREATING: ONE GHOST, BOUND TO A SHIPPED ROW, NOTHING ELSE
 * ------------------------------------------------------------------ */

describe("creating a session card is a ghost, and nothing starts", () => {
  test("one ghost on sessions.txt, no record changed, and no run", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [
        {
          act: "propose_session",
          map: "ground",
          payload: { name: "tidy the notes", tool: ROW_LABEL },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(1);
    expect(inboxNames(path)).toHaveLength(1);
    // NOTHING is written until the person accepts: no sessions.txt at all.
    expectSameRecords(before, recordsOf(path));
    expect(existsSync(sessionsPath(path))).toBe(false);

    const envelope = inboxEnvelopes(path)[0]!;
    expect(envelope.move).toEqual({ family: "session", verb: "add" });
    // The picker's OWN label resolved to the row id the record stores.
    expect(envelope.params.tool).toBe(ROW);
    expect(envelope.params.label).toBe("tidy the notes");
    expect(envelope.steps).toHaveLength(1);
    expect(envelope.steps[0].op).toBe("append");
    expect(envelope.steps[0].file).toBe("map/sessions.txt");
    // The one line the accept writes names the card and its row, and carries no
    // task: the act has no task to carry.
    expect(String(envelope.steps[0].line)).toContain("name: tidy the notes");
    expect(String(envelope.steps[0].line)).toContain("tool: " + ROW);
  });

  test("after the accept: the card exists, bound, with no transcript and no run", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        {
          act: "propose_session",
          map: "ground",
          payload: { name: "tidy the notes", tool: ROW },
        },
      ],
      host,
    );
    const answers = await host.accept(run.ids);
    expect(answers[0]?.outcome.outcome).toBe("applied");
    expect(acceptLine(run.ids[0]!, answers[0]!.outcome)).toContain("1 line(s) written");

    const sessions = await loadSessions(path, IO);
    expect(sessions.sessions).toHaveLength(1);
    const card = sessions.sessions[0]!;
    expect(card.name).toBe("tidy the notes");
    expect(card.tool).toBe(ROW);
    // A CARD THAT NEVER RAN HAS NO TRANSCRIPT, and none is invented.
    expect(existsSync(sessionTranscriptPath(path, card.on))).toBe(false);
    // The transcripts folder is not even created: a card that never ran has
    // nothing to say, and the act invents nothing.
    expect(existsSync(join(path, "map/sessions"))).toBe(false);

    // The digest knows the card by NAME and BOUND ROW, and nothing else.
    const digest = interpreterDigest({
      references: [],
      asks: [],
      sessions: sessions.sessions,
      readings: [],
      links: [],
      states: {},
    });
    expect(digest).toContain('"tidy the notes"');
    expect(digest).toContain("a run with " + ROW);
  });
});

/* ------------------------------------------------------------------ *
 * ANY UNKNOWN NAME IS REFUSED BY NAME, BEFORE ANY GHOST
 * ------------------------------------------------------------------ */

describe("an unknown row or card is refused by name, before any ghost", () => {
  test("a tool row this build does not ship is refused by name", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [
        {
          act: "propose_session",
          map: "ground",
          payload: { name: "tidy the notes", tool: "the sea" },
        },
      ],
      host,
    );
    expect(run.ok).toBe(false);
    expect(run.sentence).toContain('"the sea"');
    expect(run.sentence).toContain(ROW);
    expect(run.ids).toEqual([]);
    expect(inboxNames(path)).toEqual([]);
    expectSameRecords(before, recordsOf(path));
  });

  test("binding a card that is not a session card is refused by name", async () => {
    const path = ranWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        {
          act: "propose_bind_session",
          map: "ground",
          payload: { card: "the sea", tool: OTHER_ROW },
        },
      ],
      host,
    );
    expect(run.ok).toBe(false);
    expect(run.sentence).toContain('"the sea"');
    expect(inboxNames(path)).toEqual([]);
  });

  test("removing a card that is not there is refused by name", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [{ act: "propose_remove_session", map: "ground", payload: { card: "the sea" } }],
      host,
    );
    expect(run.ok).toBe(false);
    expect(run.sentence).toContain('"the sea"');
    expect(inboxNames(path)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * BINDING: ONE FIELD, THROUGH THE CARD'S OWN WRITER
 * ------------------------------------------------------------------ */

describe("binding changes only the row field", () => {
  test("one replace step, and every other byte of the line is kept", async () => {
    const path = ranWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [
        {
          act: "propose_bind_session",
          map: "ground",
          payload: { card: "tidy the notes", tool: OTHER_ROW },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(1);
    expectSameRecords(before, recordsOf(path));

    const envelope = inboxEnvelopes(path)[0]!;
    expect(envelope.move).toEqual({ family: "session", verb: "bind" });
    expect(envelope.target).toEqual({ kind: "session", slug: "tidy-the-notes" });
    expect(envelope.steps).toHaveLength(1);
    expect(envelope.steps[0].op).toBe("replace");
    expect(envelope.steps[0].file).toBe("map/sessions.txt");
    // The rewritten line differs in the row and NOTHING else.
    const was = String(envelope.steps[0].line);
    const now = String(envelope.steps[0].with);
    expect(was).toContain("tool: " + ROW);
    expect(now).toContain("tool: " + OTHER_ROW);
    expect(now).toContain("name: tidy the notes");
    expect(now).toContain("project: notes");
    expect(now).toContain("boundary: read");
    expect(now).toContain('model: ["m1"]');
    expect(now.startsWith("on: tidy-the-notes | name: tidy the notes | x: 40 | y: 80")).toBe(true);
  });

  test("after the accept the row moved and the transcript is byte-identical", async () => {
    const path = ranWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        {
          act: "propose_bind_session",
          map: "ground",
          payload: { card: "tidy the notes", tool: OTHER_ROW },
        },
      ],
      host,
    );
    await host.accept(run.ids);
    const sessions = await loadSessions(path, IO);
    const card = sessions.sessions[0]!;
    expect(card.tool).toBe(OTHER_ROW);
    // The point, the name, the project, the boundary and the model are untouched.
    expect(card.x).toBe(40);
    expect(card.y).toBe(80);
    expect(card.name).toBe("tidy the notes");
    expect(card.project).toBe("notes");
    expect(card.boundary).toBe("read");
    expect(card.model).toBe('["m1"]');
    // The transcript — what the card has said — is not this move's business.
    expect(text(sessionTranscriptPath(path, "tidy-the-notes"))).toBe(TRANSCRIPT);
  });

  test("binding to the row the card already runs is refused, one sentence", async () => {
    const path = ranWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        {
          act: "propose_bind_session",
          map: "ground",
          payload: { card: "tidy the notes", tool: ROW },
        },
      ],
      host,
    );
    expect(run.ok).toBe(false);
    expect(run.sentence).toContain("already runs");
    expect(inboxNames(path)).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * REMOVAL: THE APP'S OWN DELETE SHAPE, TWO GHOSTS, AND RESTORE
 * ------------------------------------------------------------------ */

describe("removing a session card is the app's own delete shape", () => {
  test("two ghosts — the line then the transcript — and nothing changed until accept", async () => {
    const path = ranWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [
        {
          act: "propose_remove_session",
          map: "ground",
          payload: { card: "tidy the notes" },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    // THE SHAPE'S TWO STEPS, EACH ITS OWN GHOST (one file, one change each).
    expect(run.ids).toHaveLength(2);
    expect(inboxNames(path)).toHaveLength(2);
    expectSameRecords(before, recordsOf(path));

    const envelopes = inboxEnvelopes(path);
    const lineGhost = envelopes.find((entry) => entry.move.verb === "remove");
    const transcriptGhost = envelopes.find(
      (entry) => entry.move.verb === "remove-transcript",
    );
    expect(lineGhost!.move).toEqual({ family: "session", verb: "remove" });
    expect(lineGhost!.steps[0].file).toBe("map/sessions.txt");
    expect(transcriptGhost!.steps[0]).toEqual({
      op: "remove",
      file: "map/sessions/tidy-the-notes.jsonl",
    });
    // THE ACCEPT ORDER IS THE APP'S OWN: the record line FIRST, then the
    // transcript that goes with it.
    expect(envelopes.find((entry) => entry.id === run.ids[0])?.move.verb).toBe(
      "remove",
    );
    expect(envelopes.find((entry) => entry.id === run.ids[1])?.move.verb).toBe(
      "remove-transcript",
    );
    // ONE line for the whole shape (one line per act).
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain("proposed removing the session card");
    expect(run.lines[0]).toContain("with its transcript");
  });

  test("a card that never ran has one step: no transcript is invented", async () => {
    const path = freshWorkspace();
    writeFileSync(sessionsPath(path), SESSION_LINE, "utf8");
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        {
          act: "propose_remove_session",
          map: "ground",
          payload: { card: "tidy the notes" },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(1);
    expect(run.lines[0]).not.toContain("with its transcript");
  });

  test("accept removes both, and the app's own Restore round-trips the bytes", async () => {
    const path = ranWorkspace();
    const before = recordsOf(path);
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        {
          act: "propose_remove_session",
          map: "ground",
          payload: { card: "tidy the notes" },
        },
      ],
      host,
    );
    const answers = await host.accept(run.ids);
    expect(answers.map((answer) => answer.outcome.outcome)).toEqual([
      "applied",
      "applied",
    ]);
    expect((await loadSessions(path, IO)).sessions).toEqual([]);
    expect(existsSync(sessionTranscriptPath(path, "tidy-the-notes"))).toBe(false);

    // THE APP'S OWN RESTORE, over the same real filesystem: the bytes a delete
    // read before its unlink are the bytes it writes back — nothing re-invented.
    const removed: RemovedSession = {
      session: {
        on: "tidy-the-notes",
        name: "tidy the notes",
        x: 40,
        y: 80,
        tool: ROW,
        project: "notes",
        boundary: "read",
        model: '["m1"]',
      },
      sessionIndex: 0,
      transcript: TRANSCRIPT,
    };
    const restore = await restoreSessionCard(path, removed, [], [], () => null, {
      saveSessions: (workspacePath, sessions, malformed) =>
        saveSessions(workspacePath, sessions, malformed, IO),
      restoreTranscript: async (workspacePath, slug, bytes) => {
        mkdirSync(join(workspacePath, "map/sessions"), { recursive: true });
        writeFileSync(
          sessionTranscriptPath(workspacePath, slug),
          bytes,
          "utf8",
        );
      },
    });
    expect(restore.refusal).toBeNull();
    expect(restore.restoredSession).toBe(true);
    expectSameRecords(before, recordsOf(path));
    expect(text(sessionTranscriptPath(path, "tidy-the-notes"))).toBe(TRANSCRIPT);
  });
});

/* ------------------------------------------------------------------ *
 * UNDO IS THE SECOND NET (Amendment 2): the rebind's inverse offers the row back
 * ------------------------------------------------------------------ */

describe("undo is the second net after the accept", () => {
  test("a rebind's applied act carries the row it ran, and its inverse is the same act", async () => {
    const path = ranWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        {
          act: "propose_bind_session",
          map: "ground",
          payload: { card: "tidy the notes", tool: OTHER_ROW },
        },
      ],
      host,
    );
    const applied = host.enrichedActsOf(
      [
        {
          act: "propose_bind_session",
          map: "ground",
          payload: { card: "tidy the notes", tool: OTHER_ROW },
        },
      ],
      run.actIds,
    );
    // The previous row is app-minted view state, attached AFTER the accept.
    expect(applied[0]?.payload.previousTool).toBe(ROW);
    const { inverseActOf } = await import("../src/commands/acts");
    const inverse = inverseActOf(applied[0]!);
    expect(inverse).toEqual({
      act: "propose_bind_session",
      map: "ground",
      payload: { card: "tidy the notes", tool: ROW },
    });
  });
});
