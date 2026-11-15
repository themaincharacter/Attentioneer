import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONTENT_CLASSES, WORD_CONTROL_CLASSES } from "../src/canvas/gates";
import type { Assumption } from "../src/map/assumptions";
import type { Link } from "../src/map/links";
import type { Quantity } from "../src/map/quantities";
import {
  COMPARE_SPACES,
  compareKey,
  compareModels,
  comparisonFrame,
  comparisonOf,
  type CompareModel,
  type CompareRow,
} from "../src/scenarios/compare";
import {
  BRANCH_PROVENANCE,
  COMMITTED_PROVENANCE,
  comparePieceText,
  compareValueText,
  comparisonRefusalText,
  dangleText,
  DANGLE_CLEARING,
  NO_LINE,
  provenanceSentence,
  STANDING_DRIFT,
  UNKNOWN_AMOUNT,
  unpinnedClaimText,
} from "../src/canvas/compareNotes";

/**
 * THE COMPARISON AT THE RECORD LAYER (Epic 8 story 4, ADR-0021 §7 amended).
 *
 * The reading is a FROZEN TWO-VALUE reading over the UNION of keys across the
 * three variant-owned key spaces (set members, link lines, quantity lines):
 * both values always spoken as a provenance sentence, absence said as "no
 * line", an absent amount said as "unknown", never a delta, never a verdict
 * and never the word that would classify the pair. The fixture is the epic
 * check's (the corrected one): soil 4, outflows 3+3 in file order, mulch->soil
 * 2, one unknown flow, one pinned claim — and the branch's what-if edit is
 * mulch->soil 2 -> 0, so that line reads branch (authored) 0 / committed (now)
 * 2.
 *
 * The dangle is said ONCE, in the present tense, and is not a row.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Source with its comments removed — the scans read CODE only. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const APP = read("../src/App.tsx");
const COMPARE = read("../src/scenarios/compare.ts");
const COMPARE_READ = read("../src/scenarios/compareRead.ts");
const BRIDGE = read("../src/scenarios/bridge.ts");
const NOTES = read("../src/canvas/compareNotes.ts");
const PANEL = read("../src/canvas/ComparePanel.tsx");
const CONTROL = read("../src/canvas/LevelControl.tsx");
const CSS = read("../src/canvas/canvas.css");

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

/* ------------------------------------------------------------------------- *
 * The corrected fixture (issue 05's Comments): the epic check's model.
 * ------------------------------------------------------------------------- */

/** The committed model, exactly as the check sets it up. */
const COMMITTED: CompareModel = {
  words: ["air", "mulch", "plant", "rain", "soil"],
  links: [link("soil", "plant", "+"), link("plant", "air", "-")],
  quantities: [
    stock("soil", 4),
    flow("soil", "plant", 3),
    flow("soil", "air", 3),
    flow("mulch", "soil", 2),
    flow("rain", "soil"),
  ],
};

/** The branch: air pruned, compost joined, and the what-if edit 2 -> 0. */
const BRANCH: CompareModel = {
  words: ["compost", "mulch", "plant", "rain", "soil"],
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

const PINNED: Assumption[] = [claim("mulch holds the rain", "mulch")];

/** The committed claims NOW: the claim's text was revised (the return move). */
const COMMITTED_CLAIMS: Assumption[] = [claim("mulch soaks the rain", "mulch")];

function fixture() {
  return comparisonOf("evening-walk", {
    committed: COMMITTED,
    branch: BRANCH,
    pins: PINNED,
    committedAssumptions: COMMITTED_CLAIMS,
  });
}

function rowOf(rows: CompareRow[], key: string): CompareRow {
  const row = rows.find((entry) => entry.key === key);
  expect(row).toBeDefined();
  return row as CompareRow;
}

const NAME = (slug: string) => slug;

describe("the union of keys, seated", () => {
  const rows = compareModels(COMMITTED, BRANCH);

  test("all three spaces are read, in the fixed space order", () => {
    expect(COMPARE_SPACES).toEqual(["set", "links", "quantities"]);
    const spaces = [...new Set(rows.map((row) => row.piece.space))];
    expect(spaces).toEqual(["set", "links", "quantities"]);
  });

  test("the committed file's order comes first, the branch-only lines append", () => {
    const keys = rows.map((row) => row.key);
    // The SET: every committed member in its order, then the branch's own.
    expect(keys.slice(0, 6)).toEqual([
      compareKey({ space: "set", word: "air" }),
      compareKey({ space: "set", word: "mulch" }),
      compareKey({ space: "set", word: "plant" }),
      compareKey({ space: "set", word: "rain" }),
      compareKey({ space: "set", word: "soil" }),
      compareKey({ space: "set", word: "compost" }),
    ]);
    // The LINKS: the committed lines, then plant->soil from the branch.
    expect(keys.slice(6, 9)).toEqual([
      compareKey({ space: "links", from: "soil", to: "plant" }),
      compareKey({ space: "links", from: "plant", to: "air" }),
      compareKey({ space: "links", from: "plant", to: "soil" }),
    ]);
    // The QUANTITIES: the committed lines, then the branch's own flow.
    expect(keys.slice(9, 15)).toEqual([
      compareKey({ space: "quantities", target: { type: "stock", on: "soil" } }),
      compareKey({
        space: "quantities",
        target: { type: "flow", from: "soil", to: "plant" },
      }),
      compareKey({
        space: "quantities",
        target: { type: "flow", from: "soil", to: "air" },
      }),
      compareKey({
        space: "quantities",
        target: { type: "flow", from: "mulch", to: "soil" },
      }),
      compareKey({
        space: "quantities",
        target: { type: "flow", from: "rain", to: "soil" },
      }),
      compareKey({
        space: "quantities",
        target: { type: "flow", from: "plant", to: "soil" },
      }),
    ]);
    expect(rows.length).toBe(15);
  });

  test("a pruned word gets its committed-only row", () => {
    const air = rowOf(rows, compareKey({ space: "set", word: "air" }));
    expect(air.committed).toEqual({ kind: "member" });
    expect(air.branch).toBeNull();
    expect(compareValueText(air.branch)).toBe(NO_LINE);
  });

  test("a joined word gets its branch-only row", () => {
    const compost = rowOf(rows, compareKey({ space: "set", word: "compost" }));
    expect(compost.committed).toBeNull();
    expect(compost.branch).toEqual({ kind: "member" });
    expect(compareValueText(compost.committed)).toBe(NO_LINE);
  });

  test("a link line reads only in the branch or only in the committed model", () => {
    const added = rowOf(
      rows,
      compareKey({ space: "links", from: "plant", to: "soil" }),
    );
    expect(added.committed).toBeNull();
    expect(added.branch).toEqual({ kind: "sign", sign: "+" });
    // The shared line is READ TWICE, both values spoken.
    const shared = rowOf(
      rows,
      compareKey({ space: "links", from: "soil", to: "plant" }),
    );
    expect(shared.committed).toEqual({ kind: "sign", sign: "+" });
    expect(shared.branch).toEqual({ kind: "sign", sign: "+" });
  });

  test("the what-if's line reads branch (authored) 0 / committed (now) 2", () => {
    const line = rowOf(
      rows,
      compareKey({
        space: "quantities",
        target: { type: "flow", from: "mulch", to: "soil" },
      }),
    );
    expect(line.branch).toEqual({ kind: "amount", amount: 0 });
    expect(line.committed).toEqual({ kind: "amount", amount: 2 });
    const sentence = provenanceSentence(line, NAME);
    expect(sentence).toContain(`${BRANCH_PROVENANCE}: 0`);
    expect(sentence).toContain(`${COMMITTED_PROVENANCE}: 2`);
    // Both values spoken, in the ruling's order: the branch first.
    expect(sentence.indexOf(BRANCH_PROVENANCE)).toBeLessThan(
      sentence.indexOf(COMMITTED_PROVENANCE),
    );
  });

  test("a quantity line with no amount reads unknown on BOTH sides, never 0", () => {
    const unknown = rowOf(
      rows,
      compareKey({
        space: "quantities",
        target: { type: "flow", from: "rain", to: "soil" },
      }),
    );
    expect(unknown.committed).toEqual({ kind: "amount", amount: null });
    expect(unknown.branch).toEqual({ kind: "amount", amount: null });
    const text = compareValueText(unknown.committed);
    expect(text).toBe(UNKNOWN_AMOUNT);
    expect(text).not.toBe("0");
    // A STATED zero is a real amount and reads as 0; a missing LINE is neither.
    expect(compareValueText({ kind: "amount", amount: 0 })).toBe("0");
    expect(compareValueText(null)).toBe(NO_LINE);
    expect(compareValueText(null)).not.toBe("0");
    expect(compareValueText(null)).not.toBe("—");
  });

  test("a row is the key, the piece and the two readings — nothing else", () => {
    const row = rows[0];
    expect(Object.keys(row).sort()).toEqual([
      "branch",
      "committed",
      "key",
      "piece",
    ]);
    for (const entry of rows) {
      for (const field of Object.keys(entry)) {
        expect(field).not.toMatch(/delta|verdict|changed|score|diff/i);
      }
    }
  });

  test("a hand-duplicated line is read once, at its first line", () => {
    const duplicated: CompareModel = {
      words: null,
      links: [],
      quantities: [flow("soil", "plant", 3), flow("soil", "plant", 9)],
    };
    const seated = compareModels(duplicated, {
      words: null,
      links: [],
      quantities: [],
    });
    expect(seated.length).toBe(1);
    expect(seated[0].committed).toEqual({ kind: "amount", amount: 3 });
  });

  test("no accepted set on either side reads 'no line' on that side", () => {
    const seated = compareModels(
      { words: null, links: [], quantities: [] },
      { words: ["soil"], links: [], quantities: [] },
    );
    expect(seated.length).toBe(1);
    expect(seated[0].committed).toBeNull();
    expect(seated[0].branch).toEqual({ kind: "member" });
  });
});

describe("the provenance sentence and the absence rules", () => {
  const rows = compareModels(COMMITTED, BRANCH);

  test("every row speaks BOTH labels, exactly once each", () => {
    for (const row of rows) {
      const sentence = provenanceSentence(row, NAME);
      expect(sentence.match(/branch \(authored\):/g)?.length).toBe(1);
      expect(sentence.match(/committed \(now\):/g)?.length).toBe(1);
      expect(sentence).toContain(" / ");
    }
  });

  test("a sentence names the piece and both values", () => {
    const sentence = provenanceSentence(
      rowOf(
        rows,
        compareKey({
          space: "quantities",
          target: { type: "flow", from: "soil", to: "plant" },
        }),
      ),
      NAME,
    );
    expect(sentence).toContain("the flow soil → plant");
    expect(sentence).toContain(`${BRANCH_PROVENANCE}: 1`);
    expect(sentence).toContain(`${COMMITTED_PROVENANCE}: 3`);
  });

  test("the set, stock, link and flow pieces each read as what they are", () => {
    expect(comparePieceText({ space: "set", word: "soil" }, NAME)).toBe("soil");
    expect(
      comparePieceText(
        { space: "quantities", target: { type: "stock", on: "soil" } },
        NAME,
      ),
    ).toContain("stock");
    expect(
      comparePieceText({ space: "links", from: "soil", to: "plant" }, NAME),
    ).toContain("link");
    expect(
      comparePieceText(
        {
          space: "quantities",
          target: { type: "flow", from: "soil", to: "plant" },
        },
        NAME,
      ),
    ).toContain("flow");
  });

  test("a slug the map lost falls back to itself (names, never invented)", () => {
    const names: Record<string, string> = { soil: "Soil" };
    const sentence = provenanceSentence(
      {
        key: "k",
        piece: { space: "set", word: "gone" },
        committed: null,
        branch: { kind: "member" },
      },
      (slug) => names[slug] ?? slug,
    );
    expect(sentence).toContain("gone");
  });

  test("the standing drift line is the ruling's sentence, word for word", () => {
    expect(STANDING_DRIFT).toBe(
      "a difference may be the branch's move or the model's drift — a branch is not a revision log",
    );
  });
});

describe("the freeze and the re-read", () => {
  test("the reading is a pure function: a re-read recomputes the same value", () => {
    const first = fixture();
    const second = fixture();
    expect(second.rows).toEqual(first.rows);
    expect(second.dangles).toEqual(first.dangles);
    // Another source is another value: nothing is cached in the module.
    const changed: CompareModel = {
      ...BRANCH,
      quantities: BRANCH.quantities.map((quantity) =>
        quantity.type === "flow" && quantity.from === "mulch"
          ? { ...quantity, amount: 1 }
          : quantity,
      ),
    };
    const third = comparisonOf("evening-walk", {
      committed: COMMITTED,
      branch: changed,
      pins: PINNED,
      committedAssumptions: COMMITTED_CLAIMS,
    });
    expect(third.rows).not.toEqual(first.rows);
  });

  test("the panel HOLDS the frozen value; it never recomputes a reading", () => {
    const code = codeOnly(PANEL);
    expect(code).not.toContain("compareModels(");
    expect(code).not.toContain("comparisonOf(");
    expect(code).not.toContain("findLink(");
    expect(code).not.toContain("findQuantity(");
    // It renders the value it was handed, and offers the re-read.
    expect(PANEL).toContain("provenanceSentence(row, nameOf)");
    expect(PANEL).toContain("onClick={onReRead}");
  });

  test("opening, picking and re-reading are the app's ONE read path", () => {
    expect(COMPARE_READ).toContain("export async function readComparisonSource(");
    expect(APP).toContain("const readComparison = useCallback(");
    expect(APP).toContain("void readComparison(frame.branch)");
    expect(APP).toContain("void readComparison(comparePick)");
    // The read refreezes the committed records and the branch's own.
    expect(APP).toContain("loadCommittedRecords(path)");
  });

  test("a reading resets nothing: the step's key has no comparison input", () => {
    const block = stepKeyBlock(APP);
    for (const forbidden of ["compare", "comparison", "comparePick", "compareOpen"]) {
      expect(block).not.toContain(forbidden);
    }
    // The compare section never touches the run.
    const section = compareSection(APP);
    for (const forbidden of [
      "useStepRun",
      "setRun",
      "step.crank",
      "stepModel",
      "stepKey",
    ]) {
      expect(section).not.toContain(forbidden);
    }
  });
});

describe("the dangle presentation (present tense, said once)", () => {
  test("a revised claim dangles: the branch's premise no longer stands", () => {
    const reading = fixture();
    expect(reading.dangles.length).toBe(1);
    expect(reading.dangles[0].text).toBe("mulch holds the rain");
  });

  test("the sentence is present tense: what stands now, never a history", () => {
    const sentence = dangleText(PINNED[0], NAME);
    expect(sentence).toContain("no longer says");
    expect(sentence).toContain("mulch holds the rain");
    expect(sentence).toContain("mulch");
    for (const history of [
      "was ",
      "were ",
      "used to",
      "previously",
      "earlier",
      "before",
      "changed",
      "edited",
      "took",
      "had ",
    ]) {
      expect(sentence.toLowerCase()).not.toContain(history);
    }
  });

  test("what clears a dangle is branching again, said once", () => {
    expect(DANGLE_CLEARING).toContain("branching again");
    expect(DANGLE_CLEARING).toContain("delete the branch");
    expect(DANGLE_CLEARING).toContain("branch the model anew");
  });

  test("the premise block is rendered ONCE and never per row", () => {
    expect(PANEL.match(/<Dangles\b/g)?.length).toBe(1);
    expect(PANEL.match(/dangleText\(/g)?.length).toBe(1);
    expect(PANEL.match(/"compare-dangles"/g)?.length).toBe(1);
    // A row carries no premise: RowLine's props are the row, the names and the
    // bridge — never the pins.
    const rowLine = PANEL.slice(
      PANEL.indexOf("function RowLine("),
      PANEL.indexOf("function Doors("),
    );
    expect(rowLine).not.toContain("dangle");
    expect(rowLine).not.toContain("pin");
    expect(rowLine).not.toContain("assumption");
  });

  test("the reading keeps the branch's pins out of its rows", () => {
    for (const row of compareModels(COMMITTED, BRANCH)) {
      expect(Object.keys(row)).not.toContain("pin");
      expect(Object.keys(row)).not.toContain("dangle");
    }
  });

  test("a committed-only claim gets its seat, once, in the same block", () => {
    const reading = fixture();
    expect(reading.unpinned.length).toBe(1);
    expect(reading.unpinned[0].text).toBe("mulch soaks the rain");
    const sentence = unpinnedClaimText(reading.unpinned[0], NAME);
    // Present tense, and said as what stands now.
    expect(sentence).toContain("the committed model says");
    expect(sentence).toContain("mulch soaks the rain");
    expect(sentence).toContain("mulch");
    expect(sentence.toLowerCase()).not.toContain("same");
    for (const history of ["was ", "were ", "used to", "previously", "earlier"]) {
      expect(sentence.toLowerCase()).not.toContain(history);
    }
    // Seated in the premises block, once — never a row of its own.
    expect(PANEL.match(/unpinnedClaimText\(/g)?.length).toBe(1);
    expect(PANEL).toContain("className=\"compare-unpinned\"");
  });

  test("a claim the branch pinned and still stands is not committed-only", () => {
    const reading = comparisonOf("evening-walk", {
      committed: COMMITTED,
      branch: BRANCH,
      pins: PINNED,
      committedAssumptions: PINNED,
    });
    expect(reading.dangles).toEqual([]);
    expect(reading.unpinned).toEqual([]);
  });

  test("the dangle is not a key space: its claims ride no comparison row", () => {
    for (const row of compareModels(COMMITTED, BRANCH)) {
      if (row.piece.space === "set") {
        expect(row.piece.word).not.toContain("mulch holds the rain");
      }
    }
  });
});

describe("the frame: branch with the committed model, and nothing else", () => {
  test("one branch side is the legal frame, in either order", () => {
    expect(
      comparisonFrame({ kind: "branch", slug: "evening" }, { kind: "committed" }),
    ).toEqual({ ok: true, branch: "evening" });
    expect(
      comparisonFrame({ kind: "committed" }, { kind: "branch", slug: "morning" }),
    ).toEqual({ ok: true, branch: "morning" });
  });

  test("two branches are refused with a word (no shared base)", () => {
    const frame = comparisonFrame(
      { kind: "branch", slug: "evening" },
      { kind: "branch", slug: "morning" },
    );
    expect(frame).toEqual({ ok: false, refusal: "two-branches" });
    const word = comparisonRefusalText("two-branches");
    expect(word).toContain("two branches");
    expect(word).toContain("committed model");
    expect(word.toLowerCase()).not.toContain("same");
  });

  test("a frame with no branch has nothing to read and says so", () => {
    expect(
      comparisonFrame({ kind: "committed" }, { kind: "committed" }),
    ).toEqual({ ok: false, refusal: "no-branch" });
    expect(comparisonRefusalText("no-branch")).toContain("pick a branch");
  });

  test("the app refuses before it reads, and the panel speaks the word", () => {
    expect(APP).toContain("comparisonFrame(");
    expect(APP).toContain("setCompareRefusal(frame.refusal)");
    expect(PANEL).toContain("comparisonRefusalText(refusal)");
  });
});

describe("the quiet view: Level 2 only, no gate class", () => {
  test("the panel renders at dynamics only, outside the plane", () => {
    expect(APP).toMatch(/level === "dynamics" && compareOpen && \(\s*<ComparePanel/);
    expect(APP.indexOf("</CanvasPlane>")).toBeLessThan(
      APP.indexOf("<ComparePanel"),
    );
  });

  test("the door lives in the level control's dynamics section", () => {
    expect(CONTROL).toContain('className="level-compare"');
    expect(CONTROL).toContain("onClick={onCompare}");
    // Only once a branch exists: a reading needs one.
    expect(CONTROL).toContain("scenarios.length > 0 &&");
    expect(CONTROL.indexOf('{level === "dynamics" && (')).toBeLessThan(
      CONTROL.indexOf('className="level-compare"'),
    );
  });

  test("the reading adds no gate class: it sits outside .plane", () => {
    expect(CONTENT_CLASSES).not.toContain("compare");
    expect(WORD_CONTROL_CLASSES).not.toContain("compare");
    for (const rule of [
      ".compare {",
      ".compare-row-text {",
      ".compare-dangle-text {",
      ".compare-reread {",
      ".level-compare {",
    ]) {
      expect(CSS).toContain(rule);
    }
  });
});

describe("the Funes brake, scoped to the comparison", () => {
  const AGGREGATE =
    /\b(sum|sums|summing|total|totals|meter|meters|table|tables|aggregate|aggregates|average|averages|score|scores|delta|deltas|diff|diffs|verdict|better|worse|best|worst)\b/i;

  test("no summing, totals, meters, tables, deltas or verdicts in the comparison's code", () => {
    for (const [name, source] of [
      ["scenarios/compare.ts", COMPARE],
      ["canvas/compareNotes.ts", NOTES],
      ["canvas/ComparePanel.tsx", PANEL],
      ["scenarios/bridge.ts", BRIDGE],
    ] as const) {
      const code = codeOnly(source);
      expect({ name, found: code.match(AGGREGATE)?.[0] ?? null }).toEqual({
        name,
        found: null,
      });
      expect({ name, reduce: code.includes(".reduce(") }).toEqual({
        name,
        reduce: false,
      });
    }
  });

  test("the comparison's module exports no aggregate helper", () => {
    const exports = [
      ...COMPARE.matchAll(/export (?:async )?function (\w+)/g),
      ...COMPARE.matchAll(/export const (\w+)/g),
    ].map((match) => match[1]);
    expect(exports).toContain("compareModels");
    expect(exports).toContain("comparisonOf");
    for (const name of exports) {
      expect(name).not.toMatch(/sum|total|meter|table|aggregate|average|score|count|diff/i);
    }
  });

  test("never the word 'same': the comparison's surfaces hold no equality claim", () => {
    for (const [name, source] of [
      ["scenarios/compare.ts", COMPARE],
      ["scenarios/compareRead.ts", COMPARE_READ],
      ["scenarios/bridge.ts", BRIDGE],
      ["canvas/compareNotes.ts", NOTES],
      ["canvas/ComparePanel.tsx", PANEL],
    ] as const) {
      expect({ name, found: /\bsame\b/i.test(source) }).toEqual({
        name,
        found: false,
      });
    }
  });
});

/* ------------------------------------------------------------------------- *
 * Source helpers — the app's own wiring, read from the tree.
 * ------------------------------------------------------------------------- */

/** The step's key block (the run's inputs) — the reading must not be one. */
function stepKeyBlock(source: string): string {
  const start = source.indexOf("const stepKey = useMemo(");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  );", start);
  return source.slice(start, end + 4);
}

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
