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
import { restoreAskCard, type RemovedAsk } from "../src/canvas/useGround";
import { createAttentioneerHost } from "../src/commands/attentioneerHost";
import { ACT_NAMES, validateAct } from "../src/commands/acts";
import { executeScript } from "../src/commands/execute";
import {
  asksPath,
  askTurnPath,
  loadAsks,
  loadTurns,
  restoreConversation,
  saveAsks,
} from "../src/map/asks";
import { groundLinksPath, loadGroundLinks } from "../src/map/groundLinks";
import { nodeCommandIo } from "../scripts/commands";

/**
 * STORY 21.7 — ASKS JOIN THE VOCABULARY (ADR-0038's 2026-11-20 amendment: the
 * command card is a PRIMARY way to use the app, and the most natural sentence
 * it should understand is "ask rain gauge what it says about the plastic").
 *
 * What this file proves, in the story's own words:
 *
 *   - an ask proposal files the DOCUMENTED SET of ghosts (the card, and one link
 *     ghost per context card — the SAME link shape propose_wire files) and
 *     changes NO record until the person accepts;
 *   - after the accept the ask card exists, is wired, and the question is in its
 *     composer as a DRAFT — the conversation file does not exist at all, so the
 *     record never holds a question the person did not send;
 *   - removing an ask uses the app's own delete shape (the record line, then the
 *     conversation) and the app's own Restore puts the bytes back identically;
 *   - a card that is not there is refused BY NAME, before any ghost;
 *   - no act sends a turn, and the ground map still renders no content family.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-ask-vocabulary-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** The ground map the story's sentence is about. */
const GROUND =
  "on: rain-gauge | name: rain gauge | x: 0 | y: 0\non: plastic-sheet | name: plastic sheet | x: 160 | y: 0\n";

/** The words the story's sentence ends with. Nothing else in the map says them. */
const QUESTION = "what does it say about the plastic sheet";

/** The ask card the removal tests take away, and its conversation. */
const ASK_LINE =
  "on: gauge-question | name: gauge question | x: 220 | y: 120\n";
const CONVERSATION =
  '{"role":"person","t":"2026-11-20T00:00:00.000Z","text":"what does it say?"}\n' +
  '{"role":"answer","t":"2026-11-20T00:00:01.000Z","text":"the sheet is wet"}\n';

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  writeFileSync(join(path, "map/ground.txt"), GROUND, "utf8");
  return path;
}

/** A workspace that already holds one ask card, asked in once. */
function askedWorkspace(): string {
  const path = freshWorkspace();
  mkdirSync(join(path, "map/asks"), { recursive: true });
  writeFileSync(asksPath(path), ASK_LINE, "utf8");
  writeFileSync(askTurnPath(path, "gauge-question"), CONVERSATION, "utf8");
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

describe("the act's schema: a question and the cards to wire in", () => {
  test("propose_ask may carry a question and a list of context cards", () => {
    const read = validateAct({
      act: "propose_ask",
      map: "ground",
      payload: {
        name: "gauge question",
        x: 10,
        y: 20,
        question: "what does it say?",
        context: ["rain gauge"],
      },
    });
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.act.payload.question).toBe("what does it say?");
    expect(read.act.payload.context).toEqual(["rain gauge"]);
  });

  test("a list that is empty, not a list, or holds a blank name is refused", () => {
    for (const context of [[], "rain gauge", ["rain gauge", "  ' round "]]) {
      const read = validateAct({
        act: "propose_ask",
        map: "ground",
        payload: { name: "gauge question", x: 10, y: 20, context },
      });
      expect(read.ok).toBe(false);
    }
  });

  test("no act sends a turn, and the ground map renders no content family", () => {
    expect(ACT_NAMES).not.toContain("send");
    expect(ACT_NAMES).toContain("propose_ask");
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

describe("an ask proposal is a ghost: the documented set, and no record", () => {
  test("the card and its wire are proposed; every record is byte-identical", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [
        {
          act: "propose_ask",
          map: "ground",
          payload: {
            name: "gauge question",
            x: 220,
            y: 120,
            question: QUESTION,
            context: ["rain gauge"],
          },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    // ONE ACT, the documented set: the ask card's ghost, then ONE link ghost.
    expect(run.ids).toHaveLength(2);
    expect(inboxNames(path)).toHaveLength(2);
    expectSameRecords(before, recordsOf(path));

    const envelopes = inboxEnvelopes(path);
    const askGhost = envelopes.find((entry) => entry.move.family === "ask");
    const wireGhost = envelopes.find((entry) => entry.move.family === "wire");
    expect(askGhost!.move).toEqual({ family: "ask", verb: "add" });
    // The question rides the PROPOSAL as a draft — and the derived line, the one
    // thing the accept writes, carries none of it.
    expect(askGhost!.params.draft).toBe(QUESTION);
    expect(askGhost!.steps).toHaveLength(1);
    expect(askGhost!.steps[0].op).toBe("append");
    expect(askGhost!.steps[0].file).toBe("map/asks.txt");
    expect(String(askGhost!.steps[0].line)).not.toContain("plastic");

    // The SAME link ghost propose_wire files: one link shape, not two.
    expect(wireGhost!.move).toEqual({ family: "wire", verb: "add" });
    expect(wireGhost!.target).toEqual({
      kind: "link",
      from: "rain-gauge",
      to: "gauge-question",
    });
    expect(wireGhost!.steps[0].file).toBe("map/ground-links.txt");
  });

  test("a context card that is not on the map is refused BY NAME, before any ghost", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [
        {
          act: "propose_ask",
          map: "ground",
          payload: {
            name: "gauge question",
            x: 220,
            y: 120,
            question: QUESTION,
            context: ["the sea"],
          },
        },
      ],
      host,
    );
    expect(run.ok).toBe(false);
    expect(run.sentence).toContain('"the sea"');
    expect(run.ids).toEqual([]);
    expect(inboxNames(path)).toEqual([]);
    expectSameRecords(before, recordsOf(path));
  });
});

describe("after the accept: the card exists, is wired, and the question waits UNSENT", () => {
  test("the draft reaches the composer and the conversation file is never written", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        {
          act: "propose_ask",
          map: "ground",
          payload: {
            name: "gauge question",
            x: 220,
            y: 120,
            question: QUESTION,
            context: ["rain gauge"],
          },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    const answers = await host.accept(run.ids);
    expect(answers.map((answer) => answer.outcome.outcome)).toEqual([
      "applied",
      "applied",
    ]);

    // THE CARD EXISTS, and it is wired to the card the question is about.
    const asks = await loadAsks(path, IO);
    expect(asks.asks.map((ask) => ask.name)).toEqual(["gauge question"]);
    const wire = await loadGroundLinks(path, IO);
    expect(wire.links).toEqual([
      { from: "rain-gauge", to: "gauge-question" },
    ]);

    // THE QUESTION IS A DRAFT: it is handed back as a view hint for the card's
    // composer, and the conversation file does not exist at all.
    expect(host.askDraftsFor(run.ids)).toEqual([
      { slug: "gauge-question", question: QUESTION },
    ]);
    expect(existsSync(askTurnPath(path, "gauge-question"))).toBe(false);
    expect(await loadTurns(path, "gauge-question", IO)).toEqual({
      turns: [],
      malformed: [],
    });
    // No record anywhere holds the question: the words a person did not send are
    // in the field, never in a file.
    for (const [rel, bytes] of recordsOf(path)) {
      expect({ rel, holdsQuestion: bytes.toString("utf8").includes(QUESTION) })
        .toEqual({ rel, holdsQuestion: false });
    }
  });
});

describe("removing an ask is the app's own delete shape, and Restore round-trips", () => {
  test("two ghosts, no record changed, then the line and its conversation go", async () => {
    const path = askedWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [{ act: "propose_remove_card", map: "ground", payload: { card: "gauge question" } }],
      host,
    );
    expect(run.ok).toBe(true);
    // THE SHAPE'S TWO STEPS, EACH ITS OWN GHOST (one file, one change each).
    expect(run.ids).toHaveLength(2);
    expect(inboxNames(path)).toHaveLength(2);
    expectSameRecords(before, recordsOf(path));
    // The inbox is named by the app's ids, not by filing order: find each ghost
    // by the move it carries (the ACCEPT order is run.ids, asserted below).
    const envelopes = inboxEnvelopes(path);
    const lineGhost = envelopes.find(
      (entry) => entry.move.verb === "remove",
    );
    const turnsGhost = envelopes.find(
      (entry) => entry.move.verb === "remove-turns",
    );
    expect(lineGhost).toBeDefined();
    expect(lineGhost!.move).toEqual({ family: "ask", verb: "remove" });
    expect(lineGhost!.steps[0].file).toBe("map/asks.txt");
    expect(turnsGhost).toBeDefined();
    expect(turnsGhost!.steps[0]).toEqual({
      op: "remove",
      file: "map/asks/gauge-question.jsonl",
    });
    // The accept order is the app's shape's own: the record line FIRST, then
    // the conversation that goes with it.
    expect(
      envelopes.find((entry) => entry.id === run.ids[0])?.move.verb,
    ).toBe("remove");
    expect(
      envelopes.find((entry) => entry.id === run.ids[1])?.move.verb,
    ).toBe("remove-turns");
    // The act says the whole shape in ONE line (one line per act).
    expect(run.lines).toHaveLength(1);
    expect(run.lines[0]).toContain("proposed removing the ask card");
    expect(run.lines[0]).toContain("with its conversation");

    const answers = await host.accept(run.ids);
    expect(answers.map((answer) => answer.outcome.outcome)).toEqual([
      "applied",
      "applied",
    ]);
    expect((await loadAsks(path, IO)).asks).toEqual([]);
    expect(existsSync(askTurnPath(path, "gauge-question"))).toBe(false);

    // THE APP'S OWN RESTORE puts the card and the conversation back, and the
    // workspace is byte-identical to what it was before the removal.
    const removed: RemovedAsk = {
      ask: { on: "gauge-question", name: "gauge question", x: 220, y: 120 },
      askIndex: 0,
      conversation: CONVERSATION,
    };
    const restore = await restoreAskCard(
      path,
      removed,
      [],
      [],
      // The app's own Restore, over the same real filesystem the app's bridges
      // use (the module defaults are the Tauri bridge, which a test cannot use).
      {
        saveAsks: (workspacePath, asks, malformed) =>
          saveAsks(workspacePath, asks, malformed, IO),
        restoreConversation: (workspacePath, slug, bytes) =>
          restoreConversation(workspacePath, slug, bytes, IO),
      },
    );
    expect(restore.refusal).toBeNull();
    expect(restore.restoredAsk).toBe(true);
    expectSameRecords(before, recordsOf(path));
    expect(text(askTurnPath(path, "gauge-question"))).toBe(CONVERSATION);
  });

  test("an ask never asked in has no conversation ghost to file", async () => {
    const path = freshWorkspace();
    writeFileSync(asksPath(path), ASK_LINE, "utf8");
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [{ act: "propose_remove_card", map: "ground", payload: { card: "gauge question" } }],
      host,
    );
    expect(run.ok).toBe(true);
    // One step of the shape: there is no transcript to take, and the act does
    // not invent an empty file to delete.
    expect(run.ids).toHaveLength(1);
    expect(inboxNames(path)).toHaveLength(1);
    expect(run.lines[0]).not.toContain("with its conversation");
  });

  test("a card that is not on the map is refused by name, before any ghost", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [{ act: "propose_remove_card", map: "ground", payload: { card: "the sea" } }],
      host,
    );
    expect(run.ok).toBe(false);
    expect(run.sentence).toContain('"the sea"');
    expect(inboxNames(path)).toEqual([]);
    expectSameRecords(before, recordsOf(path));
  });
});
