import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { danglingPins, pinsFromAssumptions } from "../src/scenarios/pins";
import {
  deliberateEdit,
  type BridgeMove,
  type BridgeRecords,
} from "../src/scenarios/bridge";
import { activeModelKey } from "../src/map/step";
import type { Assumption } from "../src/map/assumptions";
import {
  findQuantity,
  type Quantity,
  type QuantityTarget,
} from "../src/map/quantities";
import { findLink, type Link } from "../src/map/links";
import type { PlayingSet } from "../src/map/model";

/**
 * THE BRIDGE (Epic 8 story 4, ADR-0021 §7 amended; ADR-0022's reset
 * amendment): the return move as the family's ORDINARY deliberate edits —
 * create / replace / remove a line, flip a sign, join or prune a word — one at
 * a time, never an "apply the branch" verb.
 *
 * Two rules are pinned here:
 *
 *   - THE BRIDGE WRITES THE COMMITTED MODEL, and only it: the pure moves take
 *     records (no folder, no branch), and the one writer joins `map/` itself.
 *     So the ACTIVE model — a branch's records while one runs — is untouched,
 *     and its run's key is unchanged: the evidence survives the act of
 *     revising (ADR-0022's reset amendment).
 *   - A DANGLE PERSISTS AFTER THE RETURN MOVE (the pin's text is frozen): it
 *     clears only by RE-BRANCHING, which is story 2's delete + branch.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Source with its comments removed — the scans read CODE only. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function functionBody(text: string, name: string): string {
  const start = text.indexOf("export async function " + name);
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

const APP = read("../src/App.tsx");
const BRIDGE = read("../src/scenarios/bridge.ts");
const COMPARE_READ = read("../src/scenarios/compareRead.ts");
const PANEL = read("../src/canvas/ComparePanel.tsx");
const NOTES = read("../src/canvas/compareNotes.ts");
const STEP = read("../src/map/step.ts");

function link(from: string, to: string, sign: "+" | "-" = "+"): Link {
  return { from, to, sign, extra: {} };
}

function stock(on: string, amount: number | null = null): Quantity {
  return { type: "stock", on, amount, extra: {} };
}

function flow(from: string, to: string, amount: number | null = null): Quantity {
  return { type: "flow", from, to, amount, extra: {} };
}

function claim(text: string, slug: string): Assumption {
  return { text, target: { type: "word", slug }, extra: {} };
}

function play(words: readonly string[]): PlayingSet {
  return { words: [...words], extra: {} };
}

const SOIL_PLANT: QuantityTarget = { type: "flow", from: "soil", to: "plant" };
const MULCH_SOIL: QuantityTarget = { type: "flow", from: "mulch", to: "soil" };

/** The committed model: the epic check's fixture. */
function committed(): BridgeRecords {
  return {
    model: play(["air", "mulch", "plant", "rain", "soil"]),
    links: [link("soil", "plant", "+"), link("plant", "air", "-")],
    quantities: [
      stock("soil", 4),
      flow("soil", "plant", 3),
      flow("soil", "air", 3),
      flow("mulch", "soil", 2),
      flow("rain", "soil"),
    ],
  };
}

/** The branch's records (a copy, edited by the what-if: mulch->soil 2 -> 0). */
function branchRecords() {
  return {
    model: play(["compost", "mulch", "plant", "rain", "soil"]),
    links: [
      link("soil", "plant", "+"),
      link("plant", "air", "-"),
      link("plant", "soil", "+"),
    ],
    quantities: [
      stock("soil", 4),
      flow("soil", "plant", 1),
      flow("soil", "air", 3),
      flow("mulch", "soil", 0),
      flow("rain", "soil"),
      flow("plant", "soil", 1),
    ],
  };
}

describe("the bridge's moves: the ordinary deliberate edits", () => {
  test("create a line: an amount on a target with no line appends it", () => {
    const records = committed();
    const edit = deliberateEdit(records, {
      move: "set-amount",
      target: { type: "stock", on: "plant" },
      amount: 2,
    });
    expect(edit.changed).toBe("quantities");
    const found = findQuantity(edit.records.quantities, {
      type: "stock",
      on: "plant",
    });
    expect(found?.quantity.amount).toBe(2);
    // The committed RECORDS the move was given are not mutated in place.
    expect(records.quantities.length).toBe(5);
  });

  test("replace a line: the what-if's own repair (mulch->soil 2 -> 0)", () => {
    const records = committed();
    const edit = deliberateEdit(records, {
      move: "set-amount",
      target: MULCH_SOIL,
      amount: 0,
    });
    expect(edit.changed).toBe("quantities");
    const found = findQuantity(edit.records.quantities, MULCH_SOIL);
    expect(found?.quantity.amount).toBe(0);
    // IN PLACE at its index — the file's order is the step's tiebreak.
    expect(found?.index).toBe(3);
  });

  test("remove a line: ammo, no tombstone, the rest in file order", () => {
    const records = committed();
    const edit = deliberateEdit(records, {
      move: "remove-line",
      target: SOIL_PLANT,
    });
    expect(edit.changed).toBe("quantities");
    expect(findQuantity(edit.records.quantities, SOIL_PLANT)).toBeNull();
    expect(edit.records.quantities.map((quantity) => quantity.type)).toEqual([
      "stock",
      "flow",
      "flow",
      "flow",
    ]);
  });

  test("flip a sign: rewritten in place at its index", () => {
    const records = committed();
    const edit = deliberateEdit(records, {
      move: "flip-link",
      from: "soil",
      to: "plant",
    });
    expect(edit.changed).toBe("links");
    expect(findLink(edit.records.links, "soil", "plant")?.sign).toBe("-");
    expect(edit.records.links[0].sign).toBe("-");
    expect(edit.records.links.length).toBe(2);
  });

  test("draw a link line: the sign is the caller's explicit pick", () => {
    const records = committed();
    const edit = deliberateEdit(records, {
      move: "draw-link",
      from: "plant",
      to: "soil",
      sign: "-",
    });
    expect(edit.changed).toBe("links");
    expect(findLink(edit.records.links, "plant", "soil")?.sign).toBe("-");
  });

  test("re-drawing a drawn pair with another sign REPLACES it, never appends", () => {
    const records = committed();
    const edit = deliberateEdit(records, {
      move: "draw-link",
      from: "soil",
      to: "plant",
      sign: "-",
    });
    expect(edit.changed).toBe("links");
    expect(edit.records.links.length).toBe(2);
    expect(findLink(edit.records.links, "soil", "plant")?.sign).toBe("-");
  });

  test("remove a link line", () => {
    const records = committed();
    const edit = deliberateEdit(records, {
      move: "remove-link",
      from: "plant",
      to: "air",
    });
    expect(edit.changed).toBe("links");
    expect(findLink(edit.records.links, "plant", "air")).toBeNull();
  });

  test("membership: join a word to the committed set, prune one out", () => {
    const joined = deliberateEdit(committed(), { move: "join-word", word: "compost" });
    expect(joined.changed).toBe("model");
    expect(joined.records.model?.words).toContain("compost");
    const pruned = deliberateEdit(committed(), { move: "prune-word", word: "air" });
    expect(pruned.changed).toBe("model");
    expect(pruned.records.model?.words).not.toContain("air");
    // The set's canonical order (sorted, unique) survives both moves.
    expect(pruned.records.model?.words).toEqual(["mulch", "plant", "rain", "soil"]);
  });

  test("a move that changes nothing changes nothing (no write)", () => {
    const records = committed();
    for (const move of [
      { move: "flip-link", from: "soil", to: "air" },
      { move: "remove-link", from: "air", to: "soil" },
      { move: "remove-line", target: { type: "stock", on: "plant" } },
      { move: "join-word", word: "soil" },
      { move: "prune-word", word: "compost" },
      { move: "set-amount", target: SOIL_PLANT, amount: 3 },
      { move: "draw-link", from: "soil", to: "plant", sign: "+" },
    ] as BridgeMove[]) {
      const edit = deliberateEdit(records, move);
      expect(edit.changed).toBeNull();
      expect(edit.records).toBe(records);
    }
  });

  test("an out-of-shape amount writes nothing (the record never stores one)", () => {
    const records = committed();
    for (const amount of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const edit = deliberateEdit(records, {
        move: "set-amount",
        target: SOIL_PLANT,
        amount,
      });
      expect(edit.changed).toBeNull();
    }
  });

  test("the amount door reaches the unknown too: an absent amount is a stated state", () => {
    const edit = deliberateEdit(committed(), {
      move: "set-amount",
      target: SOIL_PLANT,
      amount: null,
    });
    expect(edit.changed).toBe("quantities");
    expect(
      findQuantity(edit.records.quantities, SOIL_PLANT)?.quantity.amount,
    ).toBeNull();
  });
});

describe("the bridge is the family's edits, never an apply verb", () => {
  test("the move union holds only the ordinary moves", () => {
    const declared = [
      ...BRIDGE.matchAll(/\{ move: "([a-z-]+)"/g),
    ].map((match) => match[1]);
    expect(declared).toEqual([
      "set-amount",
      "remove-line",
      "draw-link",
      "flip-link",
      "remove-link",
      "join-word",
      "prune-word",
    ]);
  });

  test("no door copies a branch: every move writes the committed records", () => {
    expect(BRIDGE).toContain("export interface BridgeRecords {");
    // No path, no folder, no branch in the moves or the move's taking.
    const signature = BRIDGE.slice(
      BRIDGE.indexOf("export function deliberateEdit("),
      BRIDGE.indexOf("): BridgeEdit {"),
    );
    for (const word of ["dir", "path", "branch", "scenario", "slug"]) {
      expect(signature.toLowerCase()).not.toContain(word);
    }
    const code = codeOnly(BRIDGE);
    for (const forbidden of [
      "../lib/fs",
      "readTextFile",
      "writeTextFile",
      "scenarioDir",
      "scenarios/",
      "copy",
      "overwrite",
    ]) {
      expect({ forbidden, found: code.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
  });

  test("no 'apply' verb exists in the bridge or its view", () => {
    for (const [name, source] of [
      ["scenarios/bridge.ts", BRIDGE],
      ["canvas/ComparePanel.tsx", PANEL],
      ["canvas/compareNotes.ts", NOTES],
    ] as const) {
      expect({ name, found: /\bapply\w*/i.test(codeOnly(source)) }).toEqual({
        name,
        found: false,
      });
    }
    const section = compareSection(APP);
    expect(/\bapply\w*/i.test(codeOnly(section))).toBe(false);
  });

  test("the comparison's view asks the bridge for exactly the family's doors", () => {
    const doors = [
      ...BRIDGE.matchAll(/^  ([a-zA-Z]+): \(/gm),
    ].map((match) => match[1]);
    expect(doors).toEqual([
      "setAmount",
      "removeLine",
      "drawLink",
      "flipLink",
      "removeLink",
      "joinWord",
      "pruneWord",
      "reviseClaim",
      "stateClaim",
    ]);
    // And the view presses them: one call per door, no second verb.
    for (const call of [
      "bridge.joinWord(",
      "bridge.pruneWord(",
      "bridge.drawLink(",
      "bridge.flipLink(",
      "bridge.removeLink(",
      "bridge.setAmount(",
      "bridge.removeLine(",
      "bridge.reviseClaim(",
      "bridge.stateClaim(",
    ]) {
      expect(PANEL).toContain(call);
    }
  });

  test("the claim doors are the ordinary assumption edits, by object identity", () => {
    const section = compareSection(APP);
    expect(section).toContain("reviseAssumption(assumption, text)");
    expect(section).toContain("addAssumption(target, text)");
    // A claim is addressed by its line, not by an index the bridge invented.
    expect(BRIDGE).toContain(
      "reviseClaim: (assumption: Assumption, text: string) => void",
    );
  });
});

describe("the committed writer: map/, and only map/", () => {
  test("saving one committed record joins map/ itself", () => {
    const body = functionBody(COMPARE_READ, "saveCommittedRecord");
    expect(body).toContain("mapDir(workspacePath)");
    expect(body).toContain("saveModel(");
    expect(body).toContain("saveLinks(");
    expect(body).toContain("saveQuantities(");
    for (const forbidden of ["scenarioDir", "recordsDir", "scenarios/"]) {
      expect(body).not.toContain(forbidden);
    }
  });

  test("the committed records keep their malformed bytes on a write", () => {
    const body = functionBody(COMPARE_READ, "saveCommittedRecord");
    expect(body).toContain("records.malformedModel");
    expect(body).toContain("records.malformedLinks");
    expect(body).toContain("records.malformedQuantities");
  });

  test("the app's bridge takes one move and saves the record it changed", () => {
    const section = compareSection(APP);
    expect(section).toContain("deliberateEdit(records, move)");
    expect(section).toContain("if (edit.changed === null) return;");
    expect(section).toContain("saveCommittedRecord(path, next, record)");
    // No other writer is reachable from the comparison.
    expect(section).not.toContain("saveLinks(recordsDir");
    expect(section).not.toContain("saveQuantities(recordsDir");
    expect(section).not.toContain("saveModel(recordsDir");
  });

  test("the reading's committed side is the bridge's subject (one loader)", () => {
    expect(COMPARE_READ).toContain("export function committedModelOf(");
    expect(COMPARE_READ).toContain("committed: committedModelOf(committed)");
    expect(APP).toContain("loadCommittedRecords(path)");
  });
});

describe("the run survives the bridge (ADR-0022's reset amendment)", () => {
  test("committed edits leave the ACTIVE model's key untouched", () => {
    const branch = branchRecords();
    const dir = "scenarios/evening-walk";
    const before = activeModelKey(
      dir,
      branch.model,
      branch.links,
      branch.quantities,
    );
    const snapshot = JSON.stringify(branch);

    // The person presses the bridge's doors while the branch runs.
    let committedRecords = committed();
    const moves: BridgeMove[] = [
      { move: "set-amount", target: MULCH_SOIL, amount: 0 },
      { move: "flip-link", from: "soil", to: "plant" },
      { move: "remove-line", target: SOIL_PLANT },
      { move: "join-word", word: "compost" },
      { move: "prune-word", word: "air" },
      { move: "draw-link", from: "rain", to: "soil", sign: "+" },
    ];
    for (const move of moves) {
      committedRecords = deliberateEdit(committedRecords, move).records;
    }
    // The committed model DID move (the test is not vacuous).
    expect(committedRecords.quantities.length).toBe(4);
    expect(findLink(committedRecords.links, "rain", "soil")).not.toBeNull();

    const after = activeModelKey(
      dir,
      branch.model,
      branch.links,
      branch.quantities,
    );
    expect(after).toBe(before);
    // The branch's records were never handed to a move in the first place.
    expect(JSON.stringify(branch)).toBe(snapshot);
  });

  test("the key takes no committed record: a claim's revise cannot reset a run", () => {
    const body = STEP.slice(
      STEP.indexOf("export function activeModelKey("),
      STEP.indexOf("\n}", STEP.indexOf("export function activeModelKey(")),
    );
    for (const word of ["assumption", "mark", "loop", "pointer", "distance", "claim"]) {
      expect(body.toLowerCase()).not.toContain(word);
    }
  });

  test("a committed-only edit changes no branch record byte", () => {
    const branch = branchRecords();
    const modelBefore = JSON.stringify(branch.model);
    const linksBefore = JSON.stringify(branch.links);
    const quantitiesBefore = JSON.stringify(branch.quantities);
    deliberateEdit(committed(), { move: "set-amount", target: MULCH_SOIL, amount: 9 });
    expect(JSON.stringify(branch.model)).toBe(modelBefore);
    expect(JSON.stringify(branch.links)).toBe(linksBefore);
    expect(JSON.stringify(branch.quantities)).toBe(quantitiesBefore);
  });
});

describe("re-branching clears the dangle", () => {
  const PINNED: Assumption[] = [claim("mulch holds the rain", "mulch")];

  test("the return move leaves the premise dangling (the pin's text is frozen)", () => {
    const committedNow = [claim("mulch soaks the rain", "mulch")];
    expect(danglingPins(PINNED, committedNow).length).toBe(1);
    // A further ordinary revise keeps the branch's premise dangling: it is a
    // memory of what was assumed THEN, and it is never rewritten.
    const revisedAgain = [claim("mulch takes the rain", "mulch")];
    expect(danglingPins(PINNED, revisedAgain).length).toBe(1);
  });

  test("delete + branch re-pins the claims as they stand: no dangle remains", () => {
    const committedNow = [claim("mulch soaks the rain", "mulch")];
    const rebranched = pinsFromAssumptions(committedNow);
    expect(danglingPins(rebranched, committedNow)).toEqual([]);
    // The OLD branch's pin is not the new one: its premise is gone.
    expect(rebranched[0].text).toBe("mulch soaks the rain");
    expect(PINNED[0].text).toBe("mulch holds the rain");
  });

  test("the clearing move is story 2's retire + create, and the panel says so", () => {
    const branchSource = read("../src/scenarios/branch.ts");
    expect(branchSource).toContain("export async function retireScenario(");
    expect(branchSource).toContain("export async function createScenario(");
    expect(NOTES).toContain("DANGLE_CLEARING");
    expect(NOTES).toContain("branching again");
  });
});

/* ------------------------------------------------------------------------- *
 * Source helpers.
 * ------------------------------------------------------------------------- */

/** Story 4's own section in App.tsx: the comparison and the bridge. */
function compareSection(source: string): string {
  const start = source.indexOf(
    "Epic 8 story 4: the comparison and the return move",
  );
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("A zoom gesture settled", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}
