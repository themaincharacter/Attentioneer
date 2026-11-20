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
  aboveOf,
  belowOf,
  leftOf,
  placedFrom,
  rightOf,
  PLACE_GAP_X,
  PLACE_GAP_Y,
} from "../src/canvas/geometry";
import { undoScriptOf } from "../src/canvas/CommandCard";
import { ACT_SPECS, validateAct } from "../src/commands/acts";
import {
  applyCommandScript,
  createAttentioneerHost,
} from "../src/commands/attentioneerHost";
import { executeScript } from "../src/commands/execute";
import { askTurnPath, asksPath, loadAsks } from "../src/map/asks";
import { groundPath, loadGround } from "../src/map/ground";
import {
  historyPath,
  readHistory,
} from "../src/map/history";
import { nodeCommandIo } from "../scripts/commands";

/**
 * STORY 21.8 — THE VOCABULARY LEARNS TO PLACE AND TO NAME (ADR-0038's
 * 2026-11-20 amendment: the command card is a PRIMARY way to use the app, and
 * an agent can add, wire, remove and ask — what it could not do is TIDY).
 *
 * What this file proves, in the story's own words:
 *
 *   - a move ghosts ONE line rewrite, changes NO record until the accept, logs
 *     ONE card.move, and a same-point move logs nothing;
 *   - a rename ghosts one name, refuses an empty name at the ACT layer, and logs
 *     ONE card.rename;
 *   - "under the rain gauge" resolves to a COMPUTED point: the act payload the
 *     model authored carries no coordinate, and the ghost's point equals the pure
 *     geometry helper's answer;
 *   - a missing or unknown card/direction is refused BY NAME, before any ghost;
 *   - both inverses work: rename → the previous name, move → the previous point,
 *     as the act the command card offers.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-place-name-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** The story's map: the soil card measures from the rain gauge. */
const GROUND =
  "on: rain-gauge | name: rain gauge | x: 0 | y: 0\n" +
  "on: soil | name: soil | x: 120 | y: 0\n";

/** A map where the soil card already stands exactly below the gauge. */
const SAME_POINT_GROUND =
  "on: rain-gauge | name: rain gauge | x: 0 | y: 0\n" +
  "on: soil | name: soil | x: 0 | y: 236\n";

const ASK_LINE =
  "on: gauge-question | name: gauge question | x: 220 | y: 120\n";

function freshWorkspace(ground: string = GROUND): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  writeFileSync(join(path, "map/ground.txt"), ground, "utf8");
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

describe("the act layer: place names cards and directions, and a name is a proposal", () => {
  test("propose_move declares no coordinate at all", () => {
    const move = ACT_SPECS.find((spec) => spec.name === "propose_move");
    expect(move).toBeDefined();
    expect(move!.required.map((field) => field.key)).toEqual(["card"]);
    expect(move!.optional.map((field) => field.key)).toEqual([
      "other",
      "direction",
      "why",
    ]);
    // THE MODEL NEVER SUPPLIES A COORDINATE: there is no number-shaped field in
    // the whole act, so a coordinate is not something it can even say.
    for (const field of [...move!.required, ...move!.optional]) {
      expect(field.type).toBe("text");
    }
    expect(move!.description).toContain("the app computes the point");
  });

  test("the rename act is described as a proposal, never as an instruction", () => {
    const rename = ACT_SPECS.find((spec) => spec.name === "propose_rename");
    expect(rename).toBeDefined();
    expect(rename!.description.toLowerCase()).toContain(
      "propose a name for the person to accept",
    );
    expect(rename!.description.toLowerCase()).not.toContain("rename");
  });

  test("an empty or padded name is refused at the ACT layer, before any ghost", () => {
    for (const name of ["", "   ", " the evidence gap "]) {
      const read = validateAct({
        act: "propose_rename",
        map: "ground",
        payload: { card: "soil", name },
      });
      expect(read.ok).toBe(false);
    }
    expect(
      validateAct({
        act: "propose_rename",
        map: "ground",
        payload: { card: "soil", name: "the evidence gap" },
      }).ok,
    ).toBe(true);
  });

  test("a move cannot smuggle a coordinate into its payload", () => {
    const read = validateAct({
      act: "propose_move",
      map: "ground",
      payload: { card: "soil", other: "rain gauge", direction: "below", x: 0, y: 236 },
    });
    expect(read.ok).toBe(false);
  });
});

describe("the geometry helper is ONE pure place, and it is what the host uses", () => {
  test("every direction is the frame plus one stated offset", () => {
    const card = { x: 0, y: 0 };
    const frame = { x: 500, y: 300 };
    expect(belowOf(card, frame)).toEqual({ x: 500, y: 300 + PLACE_GAP_Y });
    expect(aboveOf(card, frame)).toEqual({ x: 500, y: 300 - PLACE_GAP_Y });
    expect(leftOf(card, frame)).toEqual({ x: 500 - PLACE_GAP_X, y: 300 });
    expect(rightOf(card, frame)).toEqual({ x: 500 + PLACE_GAP_X, y: 300 });
    expect(placedFrom(frame, "below")).toEqual(belowOf(card, frame));
  });

  test("the map's own offset separates two resting cards", () => {
    // A below-placement clears the frame card's own height plus a gap, so the
    // two never overlap whatever their names measure.
    expect(PLACE_GAP_Y).toBeGreaterThan(220);
    expect(PLACE_GAP_X).toBeGreaterThan(300);
  });
});

describe("a move: ONE line rewrite, computed by the host, logged once on accept", () => {
  test("the ghost carries the COMPUTED point, and no record changes until accept", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [
        {
          act: "propose_move",
          map: "ground",
          payload: { card: "soil", other: "rain gauge", direction: "below" },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(1);
    expect(inboxNames(path)).toHaveLength(1);
    expectSameRecords(before, recordsOf(path));

    // THE GHOST: one replace step in the ground file, and the point is the
    // geometry helper's answer — the model authored no coordinate.
    const envelope = inboxEnvelopes(path)[0]!;
    expect(envelope.move).toEqual({ family: "card", verb: "move" });
    expect(envelope.target).toEqual({ kind: "card", slug: "soil" });
    const computed = belowOf({ x: 120, y: 0 }, { x: 0, y: 0 });
    expect(envelope.params).toEqual({ x: computed.x, y: computed.y });
    expect(envelope.steps).toHaveLength(1);
    expect(envelope.steps[0].op).toBe("replace");
    expect(envelope.steps[0].file).toBe("map/ground.txt");
    expect(String(envelope.steps[0].with)).toContain(
      "on: soil | name: soil | x: 0 | y: 236",
    );

    const answers = await host.accept(run.ids);
    expect(answers[0]?.outcome.outcome).toBe("applied");
    const ground = await loadGround(path, IO);
    expect(ground.references.find((entry) => entry.on === "soil")).toEqual({
      on: "soil",
      name: "soil",
      x: 0,
      y: 236,
    });
    // The gauge's line is byte-identical; exactly one line changed.
    expect(text(groundPath(path))).toContain("on: rain-gauge | name: rain gauge | x: 0 | y: 0\n");
    // ONE card.move, naming the point the record now holds.
    const history = await readHistory(path, IO);
    expect(
      history.events.filter((event) => event.type !== "baseline"),
    ).toEqual([
      expect.objectContaining({
        type: "card.move",
        slug: "soil",
        x: 0,
        y: 236,
      }),
    ]);
  });

  test("a same-point move is a NO-OP and logs nothing", async () => {
    const path = freshWorkspace(SAME_POINT_GROUND);
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [
        {
          act: "propose_move",
          map: "ground",
          payload: { card: "soil", other: "rain gauge", direction: "below" },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(1);
    await host.accept(run.ids);
    // The record rewrote the same line; the log has nothing to say.
    expect(existsSync(historyPath(path))).toBe(false);
    expect(recordsOf(path).get("map/ground.txt")).toEqual(
      before.get("map/ground.txt"),
    );
  });

  test("a card, a frame card or a direction the app does not know is refused BY NAME", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const refusals = [
      {
        payload: { card: "the sea", other: "rain gauge", direction: "below" },
        names: '"the sea"',
      },
      {
        payload: { card: "soil", other: "the sea", direction: "below" },
        names: '"the sea"',
      },
      {
        payload: { card: "soil", other: "rain gauge" },
        names: "direction",
      },
      {
        payload: { card: "soil", other: "rain gauge", direction: "sideways" },
        names: '"sideways"',
      },
    ];
    for (const refusal of refusals) {
      const run = await executeScript(
        [{ act: "propose_move", map: "ground", payload: refusal.payload }],
        host,
      );
      expect(run.ok).toBe(false);
      expect(run.sentence).toContain(refusal.names);
      expect(run.ids).toEqual([]);
    }
    expect(inboxNames(path)).toEqual([]);
    expectSameRecords(before, recordsOf(path));
  });
});

describe("a rename is a PROPOSAL: one name, refused empty, logged once on accept", () => {
  test("the ghost rewrites one name and changes nothing until accept", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [
        {
          act: "propose_rename",
          map: "ground",
          payload: { card: "soil", name: "the evidence gap" },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(1);
    expect(inboxNames(path)).toHaveLength(1);
    expectSameRecords(before, recordsOf(path));

    const envelope = inboxEnvelopes(path)[0]!;
    expect(envelope.move).toEqual({ family: "card", verb: "rename" });
    expect(envelope.params).toEqual({ to: "the evidence gap" });
    expect(envelope.steps[0].op).toBe("replace");
    expect(String(envelope.steps[0].with)).toContain(
      "name: the evidence gap",
    );

    const answers = await host.accept(run.ids);
    expect(answers[0]?.outcome.outcome).toBe("applied");
    const ground = await loadGround(path, IO);
    expect(ground.references.find((entry) => entry.on === "soil")?.name).toBe(
      "the evidence gap",
    );
    const history = await readHistory(path, IO);
    expect(
      history.events.filter((event) => event.type !== "baseline"),
    ).toEqual([
      expect.objectContaining({
        type: "card.rename",
        kind: "reference",
        slug: "soil",
        from: "soil",
        to: "the evidence gap",
      }),
    ]);
    // The other card's line never moved.
    expect(text(groundPath(path))).toContain(
      "on: rain-gauge | name: rain gauge | x: 0 | y: 0\n",
    );
  });

  test("an empty name never reaches an adapter: no ghost, no record", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    for (const name of ["", "   "]) {
      const run = await executeScript(
        [
          {
            act: "propose_rename",
            map: "ground",
            payload: { card: "soil", name },
          },
        ],
        host,
      );
      expect(run.ok).toBe(false);
      expect(run.sentence).toContain('"name"');
    }
    expect(inboxNames(path)).toEqual([]);
    expectSameRecords(before, recordsOf(path));
  });

  test("an ask card's name is proposed the same way, one ask.rename line", async () => {
    const path = freshWorkspace();
    writeFileSync(asksPath(path), ASK_LINE, "utf8");
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        {
          act: "propose_rename",
          map: "ground",
          payload: { card: "gauge question", name: "what the gauge says" },
        },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    await host.accept(run.ids);
    const asks = await loadAsks(path, IO);
    expect(asks.asks[0]?.name).toBe("what the gauge says");
    expect(existsSync(askTurnPath(path, "gauge-question"))).toBe(false);
    const history = await readHistory(path, IO);
    expect(
      history.events.filter((event) => event.type !== "baseline"),
    ).toEqual([
      expect.objectContaining({
        type: "card.rename",
        kind: "ask",
        slug: "gauge-question",
      }),
    ]);
  });
});

describe("both inverses: the act the command card offers takes the same act back", () => {
  test("move ↔ move: the inverse names the previous point, with no model coordinate", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const result = await applyCommandScript(
      [
        {
          act: "propose_move",
          map: "ground",
          payload: { card: "soil", other: "rain gauge", direction: "below" },
        },
      ],
      host,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const applied = result.applied[0]!;
    // The applied act remembers where the card stood; that is the inverse.
    const inverse = undoScriptOf("undo that", [applied]);
    expect(inverse).toEqual([
      {
        act: "propose_move",
        map: "ground",
        payload: { card: "soil", x: 120, y: 0 },
        prepared: true,
      },
    ]);
    // The app-built take-back IS an act the executor runs and the person
    // accepts; the card lands back on its previous point.
    const back = await executeScript(inverse!, host);
    expect(back.ok).toBe(true);
    await host.accept(back.ids);
    const ground = await loadGround(path, IO);
    expect(ground.references.find((entry) => entry.on === "soil")).toEqual({
      on: "soil",
      name: "soil",
      x: 120,
      y: 0,
    });
    // Two moves landed, two lines; never a third for the no-op.
    expect(
      (await readHistory(path, IO)).events
        .map((event) => event.type)
        .filter((type) => type !== "baseline"),
    ).toEqual(["card.move", "card.move"]);
  });

  test("rename ↔ rename: the inverse carries the previous name", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const result = await applyCommandScript(
      [
        {
          act: "propose_rename",
          map: "ground",
          payload: { card: "soil", name: "the evidence gap" },
        },
      ],
      host,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const inverse = undoScriptOf("undo that", [result.applied[0]!]);
    expect(inverse).toEqual([
      {
        act: "propose_rename",
        map: "ground",
        payload: { card: "soil", name: "soil" },
      },
    ]);
    const back = await executeScript(inverse!, host);
    expect(back.ok).toBe(true);
    await host.accept(back.ids);
    expect((await loadGround(path, IO)).references.find((entry) => entry.on === "soil")?.name).toBe(
      "soil",
    );
    expect(
      (await readHistory(path, IO)).events
        .map((event) => event.type)
        .filter((type) => type !== "baseline"),
    ).toEqual(["card.rename", "card.rename"]);
  });

  test("the ground map still renders no content family", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
