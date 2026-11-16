import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  addAssumption,
  assumptionsPath,
  parseAssumptions,
  reviseAssumption,
  serializeAssumptions,
  type Assumption,
} from "../src/map/assumptions";
import { parseLinks } from "../src/map/links";
import { parseModel, serializeModel, type PlayingSet } from "../src/map/model";
import {
  convergeQuantityEdit,
  findQuantity,
  parseQuantities,
  serializeQuantities,
  setQuantity,
  type Quantity,
  type QuantityTarget,
} from "../src/map/quantities";
import {
  mapDir,
  recordsDirOf,
  scenarioDir,
  RECORD_FILE,
} from "../src/map/records";
import {
  activeModelKey,
  stepRun,
  type StepModel,
  type StepRun,
} from "../src/map/step";
import {
  stepAmountText,
  stepDeltaText,
  stepNoteText,
} from "../src/canvas/stepNotes";
import {
  SCENARIO_HEADER,
  branchPlan,
  parseScenario,
  type BranchSource,
} from "../src/scenarios/branch";
import {
  PINS_FILE,
  danglingPins,
  parsePins,
  pinsFromAssumptions,
  pinsPath,
  serializePins,
} from "../src/scenarios/pins";
import {
  compareKey,
  comparisonOf,
  type CompareModel,
  type Comparison,
} from "../src/scenarios/compare";
import {
  BRANCH_PROVENANCE,
  COMMITTED_PROVENANCE,
  compareValueText,
  DANGLE_CLEARING,
  DANGLE_SAYS,
  dangleText,
  NO_LINE,
  provenanceSentence,
  STANDING_DRIFT,
  UNKNOWN_AMOUNT,
  unpinnedClaimText,
} from "../src/canvas/compareNotes";
import {
  resolveActiveScenario,
  scenarioOfText,
  withScenario,
} from "../src/scenarios/active";
import { workspaceYml } from "../src/lib/serialize";

/**
 * Epic 8's plain-language check, automated at the record layer (story 5).
 *
 * The human half — the real crank under the hand, the comparison's quiet look,
 * the real window's quit/reopen — is the queued real-window pass (the fifth on
 * the list). This file walks the LOCKED check's record half through the pure
 * modules and the files' bytes only, no DOM, in the check's own order:
 *
 *   SETUP: a stock on one word (soil 4), two outflows in file order (soil->plant
 *   3, soil->air 3), an outside source that is gone in the branch (mulch->soil
 *   2), one UNKNOWN flow (rain->soil) and one authored assumption ("mulch holds
 *   the rain"). The accepted set is the five words. No link is drawn, so
 *   map/links.jsonl does not exist and a branch must not invent it.
 *   BRANCH: every committed assumption pins itself; the three variant records
 *   are byte-copies (the missing one stays missing); the header is written last.
 *   THE WHAT-IF: mulch->soil 2 -> 0, IN THE BRANCH, in place at its index; the
 *   committed files are untouched.
 *   THE STEP: crank 1 skips and says the unknown flow, names the outside, clamps
 *   soil->air ("soil gave 1 of 3") and drains soil to 0 (say it aloud); crank 2
 *   states its OWN notes ("soil gave 0 of 3"). The corrected fixture lives in
 *   .scratch/epic-8/issues/05-epic-8-check-and-slice.md's COMMENTS, and that is
 *   the binding one: the Answer's 3+3->1 edit and its "gave 2 of 3" note did not
 *   add up, and the source it named (rain->soil: 5) is the corrected fixture's
 *   UNKNOWN flow instead.
 *   COMPARE: every piece reads twice (branch (authored) / committed (now));
 *   mulch->soil reads 0 / 2; no verdict stands between the values; the drift
 *   line stands; the revised claim later takes the committed-only seat.
 *   THE BRIDGE: revise the ASSUMPTION'S TEXT in the committed model — one
 *   deliberate edit, never "apply". The branch's premise dangles and says so in
 *   the present tense ("the committed model no longer says ...").
 *   RE-READ: a reading, no reset; the branch's run survives the bridge (the key
 *   is unchanged, and the next crank continues from soil 0).
 *   RE-BRANCH: delete + branch clears the dangle; the fresh copy restores the
 *   source the what-if zeroed.
 *   QUIT/REOPEN: the branch and its pins are as left, byte-exactly; the run was
 *   never written anywhere (no run bytes, no run path, and the stored stock is
 *   still the authored 4 even though the reading drained it to 0).
 *
 * NEGATIVE SPACE (the Funes brake, ADR-0020 decision 5, scoped to the quantity
 * and step seams): no sums, totals, meters, tables or step counters; no apply
 * verb; no equality/verdict claim; the branch never writes a committed record
 * except through the bridge's ordinary edits.
 *
 * The wording asserted here is the STRUCTURE the rulings pin (the note names
 * stock/flow/shortfall; absence reads "no line"; both provenance labels are
 * spoken; the dangle is present tense). The literal strings are provisional
 * display (ADR-0003) and are the rendering seam's to change.
 */

const WS = "/home/maps/garden";
const MAP = mapDir(WS);
const SLUG = "evening-walk";
const BRANCH = scenarioDir(WS, SLUG);
const YML = WS + "/workspace.yml";
const MAP_MODEL = MAP + "/" + RECORD_FILE.model;
const MAP_LINKS = MAP + "/" + RECORD_FILE.links;
const MAP_QUANTITIES = MAP + "/" + RECORD_FILE.quantities;
const MAP_ASSUMPTIONS = assumptionsPath(WS);
const BRANCH_MODEL = BRANCH + "/" + RECORD_FILE.model;
const BRANCH_LINKS = BRANCH + "/" + RECORD_FILE.links;
const BRANCH_QUANTITIES = BRANCH + "/" + RECORD_FILE.quantities;
const BRANCH_PINS = pinsPath(BRANCH);
const BRANCH_HEADER = BRANCH + "/" + SCENARIO_HEADER;

/** The five words the check's model plays with (sorted: the set's order). */
const WORDS = ["air", "mulch", "plant", "rain", "soil"];
const CLAIM_TEXT = "mulch holds the rain";
const REVISED_TEXT = "mulch soaks the rain";

const STOCK_SOIL: QuantityTarget = { type: "stock", on: "soil" };
const SOIL_PLANT: QuantityTarget = { type: "flow", from: "soil", to: "plant" };
const SOIL_AIR: QuantityTarget = { type: "flow", from: "soil", to: "air" };
const MULCH_SOIL: QuantityTarget = { type: "flow", from: "mulch", to: "soil" };
const RAIN_SOIL: QuantityTarget = { type: "flow", from: "rain", to: "soil" };

/** The workspace's files, as the app leaves them (paths relative to WS are full). */
type Files = Record<string, string>;

/** The world's names are the person's names; a slug with no word reads itself. */
const nameOf = (slug: string) => slug;

function play(words: readonly string[] = WORDS): PlayingSet {
  return { words: [...words], extra: {} };
}

/** The four authored amounts plus the UNKNOWN line, in the check's file order. */
function authoredQuantities(): Quantity[] {
  let quantities: Quantity[] = [];
  quantities = setQuantity(quantities, STOCK_SOIL, 4);
  quantities = setQuantity(quantities, SOIL_PLANT, 3);
  quantities = setQuantity(quantities, SOIL_AIR, 3);
  quantities = setQuantity(quantities, MULCH_SOIL, 2);
  quantities = setQuantity(quantities, RAIN_SOIL, null);
  return quantities;
}

/**
 * The setup: the accepted set, the numbers, the unknown flow and the authored
 * claim. The map holds exactly these files. No link was drawn, so
 * map/links.jsonl is ABSENT (not empty), and the branch must copy absence.
 */
function setupFiles(): Files {
  return {
    [YML]: workspaceYml(),
    [MAP_MODEL]: serializeModel(play()),
    [MAP_QUANTITIES]: serializeQuantities(authoredQuantities()),
    [MAP_ASSUMPTIONS]: serializeAssumptions(
      addAssumption([], CLAIM_TEXT, { type: "word", slug: "mulch" }),
    ),
  };
}

/** One records folder read as the comparison reads it (map/ or a branch). */
function folderModel(files: Files, dir: string): CompareModel {
  return {
    words:
      parseModel(files[dir + "/" + RECORD_FILE.model] ?? null).model?.words ??
      null,
    links: parseLinks(files[dir + "/" + RECORD_FILE.links] ?? "").links,
    quantities: parseQuantities(
      files[dir + "/" + RECORD_FILE.quantities] ?? null,
    ).quantities,
  };
}

/** The committed claims: map/assumptions.jsonl, in file order. */
function committedClaims(files: Files): Assumption[] {
  return parseAssumptions(files[MAP_ASSUMPTIONS] ?? "").assumptions;
}

/** A branch's pins: its own assumption file, in file order. */
function pinnedClaims(files: Files, slug: string = SLUG): Assumption[] {
  return parsePins(files[pinsPath(scenarioDir(WS, slug))] ?? null).pins;
}

/** The comparison's one read, over the files on disk (never the run). */
function readingOf(files: Files, slug: string = SLUG): Comparison {
  return comparisonOf(slug, {
    committed: folderModel(files, MAP),
    branch: folderModel(files, scenarioDir(WS, slug)),
    pins: pinnedClaims(files, slug),
    committedAssumptions: committedClaims(files),
  });
}

/** The committed bytes a branch copies (a missing file stays missing). */
function branchSourceOf(files: Files): BranchSource {
  return {
    model: files[MAP_MODEL] ?? null,
    links: files[MAP_LINKS] ?? null,
    quantities: files[MAP_QUANTITIES] ?? null,
    assumptions: files[MAP_ASSUMPTIONS] ?? null,
  };
}

/** createScenario's plan in its order: the copies, the pins, then the header. */
function branchApp(files: Files, name: string, slug: string = SLUG): Files {
  const plan = branchPlan(name, branchSourceOf(files));
  const dir = scenarioDir(WS, slug);
  const next: Files = { ...files };
  for (const file of plan.files) next[dir + "/" + file.file] = file.content;
  next[dir + "/" + plan.header.file] = plan.header.content;
  return next;
}

/** The switch's one write: workspace.yml's hint (null = the committed model). */
function switchTo(files: Files, slug: string | null): Files {
  return { ...files, [YML]: withScenario(files[YML], slug) };
}

/** The what-if: ONE line in the branch, in place at its index. */
function whatIf(files: Files, slug: string = SLUG): Files {
  const path = scenarioDir(WS, slug) + "/" + RECORD_FILE.quantities;
  const parsed = parseQuantities(files[path] ?? null);
  const found = findQuantity(parsed.quantities, MULCH_SOIL);
  if (found === null) throw new Error("the what-if needs the mulch line");
  const edit = convergeQuantityEdit(parsed.quantities, found.index, 0);
  if (edit.dropped.length !== 0) throw new Error("the what-if dropped a line");
  return {
    ...files,
    [path]: serializeQuantities(edit.quantities, parsed.malformed),
  };
}

/** The bridge's claim door: the app's ordinary revise, at the line's index. */
function bridgeRevise(files: Files, text: string): Files {
  const parsed = parseAssumptions(files[MAP_ASSUMPTIONS] ?? "");
  return {
    ...files,
    [MAP_ASSUMPTIONS]: serializeAssumptions(
      reviseAssumption(parsed.assumptions, 0, text),
      parsed.malformed,
    ),
  };
}

/** Retire: the header FIRST (the presence switch), then the bytes, then the folder. */
function retire(files: Files, slug: string = SLUG): Files {
  const dir = scenarioDir(WS, slug);
  const next: Files = { ...files };
  delete next[dir + "/" + SCENARIO_HEADER];
  for (const file of [
    RECORD_FILE.model,
    RECORD_FILE.links,
    RECORD_FILE.quantities,
    PINS_FILE,
  ]) {
    delete next[dir + "/" + file];
  }
  return next;
}

/** The stages, in the locked check's own order. */
function afterSetup(): Files {
  return setupFiles();
}

function afterBranch(): Files {
  return switchTo(branchApp(afterSetup(), "Evening walk"), SLUG);
}

function afterWhatIf(): Files {
  return whatIf(afterBranch());
}

function afterBridge(): Files {
  return bridgeRevise(afterWhatIf(), REVISED_TEXT);
}

/** Delete + branch again: the active branch is switched away, then re-coined. */
function afterReBranch(): Files {
  const retired = switchTo(retire(afterBridge()), null);
  return switchTo(branchApp(retired, "Evening walk"), SLUG);
}

/** The ACTIVE model's key: the branch's folder, set, links and quantities. */
function activeKey(files: Files, slug: string = SLUG): string {
  const model = folderModel(files, scenarioDir(WS, slug));
  return activeModelKey(
    recordsDirOf(WS, slug),
    model.words === null ? null : play(model.words),
    model.links,
    model.quantities,
  );
}

/** The run as useStepRun holds it: the run and the key it belongs to. */
interface RunDriver {
  key: string;
  run: StepRun | null;
}

function startRun(files: Files, slug: string = SLUG): RunDriver {
  return { key: activeKey(files, slug), run: null };
}

/** useStepRun's rule, pure: a changed key is a new model and resets the run. */
function crank(
  driver: RunDriver,
  files: Files,
  slug: string = SLUG,
): RunDriver {
  const key = activeKey(files, slug);
  const model = folderModel(files, scenarioDir(WS, slug));
  const step: StepModel = {
    words: model.words,
    quantities: model.quantities,
    links: model.links,
  };
  return { key, run: stepRun(step, driver.key === key ? driver.run : null) };
}

/** The committed records' bytes, for the untouched assertions. */
function committedBytes(files: Files): Record<string, string | undefined> {
  return {
    model: files[MAP_MODEL],
    links: files[MAP_LINKS],
    quantities: files[MAP_QUANTITIES],
    assumptions: files[MAP_ASSUMPTIONS],
  };
}

/** A branch folder's bytes, for the untouched assertions. */
function branchBytes(files: Files): Record<string, string | undefined> {
  return {
    header: files[BRANCH_HEADER],
    model: files[BRANCH_MODEL],
    links: files[BRANCH_LINKS],
    quantities: files[BRANCH_QUANTITIES],
    pins: files[BRANCH_PINS],
  };
}

const readSource = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

/** Source with its comments removed — the scans read CODE only. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** One exported function's body, from its declaration to the closing brace. */
function bodyFrom(source: string, declaration: string): string {
  const start = source.indexOf(declaration);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

function functionBody(source: string, name: string): string {
  return bodyFrom(source, "export async function " + name);
}

function syncFunctionBody(source: string, name: string): string {
  return bodyFrom(source, "export function " + name);
}

const APP = readSource("../src/App.tsx");
const STEP = readSource("../src/map/step.ts");
const QUANTITIES = readSource("../src/map/quantities.ts");
const QUANTITY_OVERLAY = readSource("../src/canvas/QuantityOverlay.tsx");
const QUANTITY_GLYPH = readSource("../src/canvas/QuantityGlyph.tsx");
const STEP_NOTES = readSource("../src/canvas/stepNotes.ts");
const CRANK_VIEW = readSource("../src/canvas/StepCrank.tsx");
const RUNNER = readSource("../src/canvas/useStepRun.ts");
const BRANCH_SOURCE = readSource("../src/scenarios/branch.ts");
const PINS_SOURCE = readSource("../src/scenarios/pins.ts");
const COMPARE_SOURCE = readSource("../src/scenarios/compare.ts");
const COMPARE_READ_SOURCE = readSource("../src/scenarios/compareRead.ts");
const BRIDGE_SOURCE = readSource("../src/scenarios/bridge.ts");
const COMPARE_NOTES = readSource("../src/canvas/compareNotes.ts");
const PANEL = readSource("../src/canvas/ComparePanel.tsx");
const PATCHES = readSource("../src/map/patches.ts");

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

/** The step's key block (the run's inputs) — the reading must not be one. */
function stepKeyBlock(source: string): string {
  const start = source.indexOf("const stepKey = useMemo(");
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  );", start);
  return source.slice(start, end + 4);
}

/** Every row's own key, for lookup. */
function rowOf(reading: Comparison, key: string) {
  const row = reading.rows.find((entry) => entry.key === key);
  expect(row).toBeDefined();
  return row as Comparison["rows"][number];
}

/* -------------------------------------------------------------------------
 * 1. The setup: a small model with numbers.
 * ---------------------------------------------------------------------- */

describe("the setup: a small model with numbers", () => {
  test("the accepted set is the five words, in canonical bytes", () => {
    const files = afterSetup();
    expect(files[MAP_MODEL]).toBe(
      [
        "{",
        '  "words": [',
        '    "air",',
        '    "mulch",',
        '    "plant",',
        '    "rain",',
        '    "soil"',
        "  ]",
        "}",
        "",
      ].join("\n"),
    );
    expect(parseModel(files[MAP_MODEL]).model?.words).toEqual(WORDS);
  });

  test("the amounts are in FILE ORDER, and the unknown line writes no amount", () => {
    const files = afterSetup();
    expect(files[MAP_QUANTITIES]).toBe(
      [
        '{"amount":4,"on":"soil"}',
        '{"amount":3,"from":"soil","to":"plant"}',
        '{"amount":3,"from":"soil","to":"air"}',
        '{"amount":2,"from":"mulch","to":"soil"}',
        '{"from":"rain","to":"soil"}',
        "",
      ].join("\n"),
    );
    const quantities = parseQuantities(files[MAP_QUANTITIES]).quantities;
    expect(quantities.map((quantity) => quantity.type)).toEqual([
      "stock",
      "flow",
      "flow",
      "flow",
      "flow",
    ]);
    // ABSENT is the unknown, never 0: the writer says nothing.
    expect(findQuantity(quantities, RAIN_SOIL)?.quantity.amount).toBeNull();
    expect(files[MAP_QUANTITIES]?.split("\n")[4]).not.toContain("amount");
    // The two outflows out of soil are in file order (the step's tiebreak).
    expect(findQuantity(quantities, SOIL_PLANT)?.index).toBe(1);
    expect(findQuantity(quantities, SOIL_AIR)?.index).toBe(2);
  });

  test("the authored claim is one line on the word", () => {
    const files = afterSetup();
    expect(files[MAP_ASSUMPTIONS]).toBe(
      '{"on":"mulch","text":"' + CLAIM_TEXT + '"}\n',
    );
    expect(committedClaims(files)).toEqual([
      { text: CLAIM_TEXT, target: { type: "word", slug: "mulch" }, extra: {} },
    ]);
  });

  test("no link was drawn: map/links.jsonl is ABSENT, not empty", () => {
    const files = afterSetup();
    expect(files[MAP_LINKS]).toBeUndefined();
    expect(Object.keys(files).sort()).toEqual(
      [YML, MAP_ASSUMPTIONS, MAP_MODEL, MAP_QUANTITIES].sort(),
    );
    expect(folderModel(files, MAP).links).toEqual([]);
  });

  test("the fixture's ground, read once: the outside is named at both ends", () => {
    // Before any what-if, the committed model's own reading names the world:
    // mulch (no stock line) is the source, plant and air (no stock lines) are
    // the sinks. The branch's zero is what will silence the source.
    const model = folderModel(afterSetup(), MAP);
    const ground = stepRun(
      { words: model.words, quantities: model.quantities, links: model.links },
      null,
    );
    expect(ground.notes).toEqual([
      { kind: "outside-sink", from: "soil", to: "plant", amount: 3 },
      { kind: "clamp", on: "soil", from: "soil", to: "air", gave: 1, asked: 3 },
      { kind: "outside-sink", from: "soil", to: "air", amount: 1 },
      { kind: "outside-source", from: "mulch", to: "soil", amount: 2 },
      { kind: "unknown-flow", from: "rain", to: "soil" },
    ]);
    // soil: 4 + the world's 2 - 3 - 1 = 2. The source is why it is not 0 yet.
    expect(ground.amounts.get("soil")).toBe(2);
    expect(stepAmountText(ground.amounts.get("soil") ?? null)).toBe("2");
  });
});

/* -------------------------------------------------------------------------
 * 2. The branch: byte-copies, the pin, and the header last.
 * ---------------------------------------------------------------------- */

describe("the branch: byte-copies and the pin", () => {
  test("the plan copies the committed bytes exactly and pins every claim", () => {
    const setup = afterSetup();
    const plan = branchPlan("Evening walk", branchSourceOf(setup));
    // The missing link record is NOT invented: absence copies as absence.
    expect(plan.files.map((file) => file.file)).toEqual([
      RECORD_FILE.model,
      RECORD_FILE.quantities,
      PINS_FILE,
    ]);
    expect(plan.files[0].content).toBe(setup[MAP_MODEL]);
    expect(plan.files[1].content).toBe(setup[MAP_QUANTITIES]);
    expect(plan.files[2].content).toBe(
      serializePins(pinsFromAssumptions(committedClaims(setup))),
    );
    expect(plan.header.file).toBe(SCENARIO_HEADER);
    expect(parseScenario(plan.header.content)).toEqual({
      slug: SLUG,
      name: "Evening walk",
    });
    // The header is not among the copies: it is the commit point, written LAST.
    expect(plan.files.map((file) => file.file)).not.toContain(SCENARIO_HEADER);
  });

  test("the header is written LAST (create) and removed FIRST (retire)", () => {
    const create = functionBody(BRANCH_SOURCE, "createScenario");
    expect(create).toContain("scenarioDir(workspacePath, minted.slug)");
    expect(create).toContain("for (const file of plan.files)");
    expect(create.indexOf("writeMachineFile(")).toBeGreaterThan(
      create.indexOf("for (const file of plan.files)"),
    );
    expect(create).not.toContain("mapDir(");
    const retireBody = functionBody(BRANCH_SOURCE, "retireScenario");
    expect(retireBody.indexOf("removeFile(scenarioHeaderPath(dir))")).toBeLessThan(
      retireBody.indexOf("removeDirAll(dir)"),
    );
    expect(retireBody).not.toContain("mapDir(");
  });

  test("the folder holds the copies and the pins; the committed map is untouched", () => {
    const branched = afterBranch();
    expect(branched[BRANCH_MODEL]).toBe(branched[MAP_MODEL]);
    expect(branched[BRANCH_QUANTITIES]).toBe(branched[MAP_QUANTITIES]);
    expect(branched[BRANCH_PINS]).toBe(branched[MAP_ASSUMPTIONS]);
    expect(branched[BRANCH_LINKS]).toBeUndefined();
    expect(committedBytes(branched)).toEqual(committedBytes(afterSetup()));
    // The branch reads back through the comparison's own folder reader.
    expect(folderModel(branched, BRANCH)).toEqual(folderModel(branched, MAP));
  });

  test("the switch sets the resume hint; a stale hint is not a branch", () => {
    const branched = afterBranch();
    expect(scenarioOfText(branched[YML])).toBe(SLUG);
    expect(withScenario(branched[YML], SLUG)).toBe(branched[YML]);
    expect(resolveActiveScenario(scenarioOfText(branched[YML]), [SLUG])).toBe(
      SLUG,
    );
    // A deleted or renamed folder opens the committed model, quietly.
    expect(resolveActiveScenario("morning-walk", [SLUG])).toBeNull();
    expect(resolveActiveScenario(null, [SLUG])).toBeNull();
  });

  test("the pins are the committed claims' addresses and texts, all of them", () => {
    const branched = afterBranch();
    expect(pinnedClaims(branched)).toEqual(committedClaims(branched));
    expect(pinnedClaims(branched)).toHaveLength(1);
    expect(pinnedClaims(branched)[0].text).toBe(CLAIM_TEXT);
  });
});

/* -------------------------------------------------------------------------
 * 3. The what-if: one line in the branch; the committed records untouched.
 * ---------------------------------------------------------------------- */

describe("the what-if: mulch->soil 2 -> 0 in the branch", () => {
  test("the edit lands IN PLACE at its index; every other line is byte-stable", () => {
    const before = afterBranch();
    const after = afterWhatIf();
    const beforeLines = (before[BRANCH_QUANTITIES] ?? "").trim().split("\n");
    const afterLines = (after[BRANCH_QUANTITIES] ?? "").trim().split("\n");
    expect(afterLines).toHaveLength(beforeLines.length);
    // The source line is the fourth line (index 3) in the check's file order.
    expect(afterLines[3]).toBe('{"amount":0,"from":"mulch","to":"soil"}');
    for (const index of [0, 1, 2, 4]) {
      expect(afterLines[index]).toBe(beforeLines[index]);
    }
    expect(findQuantity(parseQuantities(after[BRANCH_QUANTITIES]).quantities, MULCH_SOIL)?.quantity.amount).toBe(0);
  });

  test("the committed model is untouched: the branch edit never reaches map/", () => {
    expect(committedBytes(afterWhatIf())).toEqual(committedBytes(afterBranch()));
  });

  test("the branch's other files are untouched too", () => {
    const before = branchBytes(afterBranch());
    const after = branchBytes(afterWhatIf());
    expect(after.header).toBe(before.header);
    expect(after.model).toBe(before.model);
    expect(after.pins).toBe(before.pins);
    expect(after.links).toBeUndefined();
    expect(before.links).toBeUndefined();
  });

  test("the what-if is the branch's ONLY difference from the committed model", () => {
    const files = afterWhatIf();
    const committed = parseQuantities(files[MAP_QUANTITIES] ?? null).quantities;
    const branch = parseQuantities(files[BRANCH_QUANTITIES] ?? null).quantities;
    expect(findQuantity(committed, MULCH_SOIL)?.quantity.amount).toBe(2);
    for (const target of [STOCK_SOIL, SOIL_PLANT, SOIL_AIR, RAIN_SOIL]) {
      expect(findQuantity(branch, target)?.quantity).toEqual(
        findQuantity(committed, target)?.quantity,
      );
    }
  });

  test("a branch edit is a NEW model: the run's key changes, so the run resets", () => {
    expect(activeKey(afterWhatIf())).not.toBe(activeKey(afterBranch()));
  });
});

/* -------------------------------------------------------------------------
 * 4. The step: the gates, the clamp, the drain.
 * ---------------------------------------------------------------------- */

describe("the step: the unknown is said, the outside is named, soil drains", () => {
  /** Crank 1 of the branch: the what-if's zero is the source's absence. */
  function firstCrank() {
    const files = afterWhatIf();
    return crank(startRun(files), files).run as StepRun;
  }

  test("crank 1: the unknown flow is skipped and said; the outside is named; the clamp is loud", () => {
    const run = firstCrank();
    expect(run.notes).toEqual([
      { kind: "outside-sink", from: "soil", to: "plant", amount: 3 },
      { kind: "clamp", on: "soil", from: "soil", to: "air", gave: 1, asked: 3 },
      { kind: "outside-sink", from: "soil", to: "air", amount: 1 },
      { kind: "unknown-flow", from: "rain", to: "soil" },
    ]);
    // The unknown never became 0 and moved nothing.
    expect(run.amounts.get("soil")).toBe(0);
    expect(run.lastDelta.get("soil")).toBe(-4);
    // Only a stock line's word has a running amount; the world's have none.
    expect([...run.amounts.keys()]).toEqual(["soil"]);
  });

  test("the clamp names the stock, the flow and the shortfall against the authored amount", () => {
    const run = firstCrank();
    const clamp = run.notes.find((note) => note.kind === "clamp");
    expect(clamp).toBeDefined();
    const sentence = stepNoteText(clamp!, nameOf);
    expect(sentence).toContain("soil");
    expect(sentence).toContain("air");
    expect(sentence).toContain("gave 1 of 3");
    expect(sentence).not.toContain("2 of 3");
    expect(sentence).not.toContain("3 of 3");
  });

  test("the outside is named at the sinks: no stock line means the unbounded world", () => {
    const run = firstCrank();
    const sinks = run.notes.filter((note) => note.kind === "outside-sink");
    expect(sinks).toHaveLength(2);
    const words = sinks
      .map((note) => stepNoteText(note, nameOf))
      .join("\n");
    expect(words).toContain("plant");
    expect(words).toContain("air");
    expect(words).toContain("to the world, unbounded");
    // Nothing is the world to the world here: every flow has an end with a stock.
    expect(run.notes.some((note) => note.kind === "world-to-world")).toBe(false);
  });

  test("the what-if's zeroed source moves nothing and says nothing (nothing observable)", () => {
    const run = firstCrank();
    // mulch->soil is 0: no outside-source note, and no note names mulch at all.
    expect(run.notes.some((note) => note.kind === "outside-source")).toBe(false);
    for (const note of run.notes) {
      const sentence = stepNoteText(note, nameOf);
      expect(sentence).not.toContain("mulch");
    }
    // The UNKNOWN flow is the one that names rain; rain is not an outside source.
    const unknown = run.notes.find((note) => note.kind === "unknown-flow");
    expect(stepNoteText(unknown!, nameOf)).toContain("rain");
    expect(stepNoteText(unknown!, nameOf)).toContain("amount unknown; skipped");
  });

  test("the unknown flow is said on EVERY crank, not once", () => {
    const files = afterWhatIf();
    const first = crank(startRun(files), files);
    const second = crank(first, files);
    for (const run of [first.run, second.run]) {
      expect(run!.notes).toContainEqual({
        kind: "unknown-flow",
        from: "rain",
        to: "soil",
      });
    }
  });

  test("crank 2 states its OWN notes: 'soil gave 0 of 3' — the note is step-scoped", () => {
    const files = afterWhatIf();
    const first = crank(startRun(files), files);
    const second = crank(first, files);
    expect(second.run!.notes).toEqual([
      { kind: "clamp", on: "soil", from: "soil", to: "plant", gave: 0, asked: 3 },
      { kind: "clamp", on: "soil", from: "soil", to: "air", gave: 0, asked: 3 },
      { kind: "unknown-flow", from: "rain", to: "soil" },
    ]);
    const leads = stepNoteText(second.run!.notes[0], nameOf);
    expect(leads).toContain("soil gave 0 of 3");
    // Soil stays at zero across the cranks: the drain is the standing consequence.
    expect(second.run!.amounts.get("soil")).toBe(0);
    // The previous crank's clamp is not carried: each crank says its own.
    expect(
      second.run!.notes.map((note) => stepNoteText(note, nameOf)).join("\n"),
    ).not.toContain("gave 1 of 3");
  });

  test("the say-it drain: soil ends at zero — the consequence is the point", () => {
    const run = firstCrank();
    expect(run.amounts.get("soil")).toBe(0);
    // The reading says it aloud (the display), and the last delta is -4.
    expect(stepAmountText(run.amounts.get("soil") ?? null)).toBe("0");
    expect(stepDeltaText(run.lastDelta.get("soil") ?? null)).toBe("-4");
    // The display is ONE word's amount and delta: no column, no total.
    expect(run.amounts.size).toBe(1);
    expect(run.lastDelta.size).toBe(1);
  });

  test("the run carries exactly the amounts, the last delta and the notes", () => {
    const run = firstCrank();
    expect(Object.keys(run).sort()).toEqual(["amounts", "lastDelta", "notes"]);
  });
});

/* -------------------------------------------------------------------------
 * 5. The comparison: every piece reads twice.
 * ---------------------------------------------------------------------- */

describe("the comparison: every piece reads twice", () => {
  const files = afterWhatIf();
  const reading = readingOf(files);

  test("the union reads the spaces the fixture holds: set members and quantity lines", () => {
    // Five set members plus five quantity lines. No link was drawn, so the
    // link space is empty on both sides — the union still covers what exists.
    expect(reading.rows).toHaveLength(10);
    expect([...new Set(reading.rows.map((row) => row.piece.space))]).toEqual([
      "set",
      "quantities",
    ]);
    for (const row of reading.rows) {
      expect(row.committed).not.toBeNull();
      expect(row.branch).not.toBeNull();
    }
  });

  test("the mulch->soil row: branch (authored) 0 / committed (now) 2", () => {
    const row = rowOf(
      reading,
      compareKey({ space: "quantities", target: MULCH_SOIL }),
    );
    expect(row.branch).toEqual({ kind: "amount", amount: 0 });
    expect(row.committed).toEqual({ kind: "amount", amount: 2 });
    const sentence = provenanceSentence(row, nameOf);
    expect(sentence).toContain(BRANCH_PROVENANCE + ": 0");
    expect(sentence).toContain(COMMITTED_PROVENANCE + ": 2");
    // Both values spoken, the branch's first — no verdict between them.
    expect(sentence.indexOf(BRANCH_PROVENANCE)).toBeLessThan(
      sentence.indexOf(COMMITTED_PROVENANCE),
    );
    expect(sentence).toContain("the flow mulch");
  });

  test("both values are always spoken, and no verdict stands between them", () => {
    for (const row of reading.rows) {
      const sentence = provenanceSentence(row, nameOf);
      expect(sentence.match(/branch \(authored\):/g)).toHaveLength(1);
      expect(sentence.match(/committed \(now\):/g)).toHaveLength(1);
      expect(sentence).toContain(" / ");
      expect(sentence).not.toMatch(/\bsame\b/i);
      expect(sentence).not.toMatch(
        /\b(diff|verdict|better|worse|best|worst|delta)\b/i,
      );
    }
  });

  test("the unknown line reads 'unknown' on both sides, never 0", () => {
    const row = rowOf(
      reading,
      compareKey({ space: "quantities", target: RAIN_SOIL }),
    );
    expect(row.branch).toEqual({ kind: "amount", amount: null });
    expect(row.committed).toEqual({ kind: "amount", amount: null });
    expect(compareValueText(row.branch)).toBe(UNKNOWN_AMOUNT);
    expect(compareValueText(row.committed)).toBe("unknown");
    expect(compareValueText(row.committed)).not.toBe("0");
  });

  test("absence would read 'no line', never a dash and never a zero", () => {
    expect(NO_LINE).toBe("no line");
    expect(compareValueText(null)).toBe(NO_LINE);
    expect(compareValueText(null)).not.toBe("0");
  });

  test("a row is the key, the piece and the two readings — nothing else", () => {
    for (const row of reading.rows) {
      expect(Object.keys(row).sort()).toEqual([
        "branch",
        "committed",
        "key",
        "piece",
      ]);
    }
  });

  test("before the bridge, the branch stands on every committed claim", () => {
    expect(reading.dangles).toEqual([]);
    expect(reading.unpinned).toEqual([]);
  });

  test("the standing drift line stands", () => {
    expect(STANDING_DRIFT).toContain("not a revision log");
    expect(PANEL).toContain("STANDING_DRIFT");
  });
});

/* -------------------------------------------------------------------------
 * 6. The bridge: revise the assumption's TEXT — one deliberate edit.
 * ---------------------------------------------------------------------- */

describe("the bridge: revise the assumption's text, one deliberate edit", () => {
  const before = afterWhatIf();
  const bridged = afterBridge();
  const readingBefore = readingOf(before);
  const readingAfter = readingOf(bridged);

  test("exactly ONE committed line changes, at its index; the target stays", () => {
    const beforeLines = (before[MAP_ASSUMPTIONS] ?? "").trim().split("\n");
    const afterLines = (bridged[MAP_ASSUMPTIONS] ?? "").trim().split("\n");
    expect(afterLines).toHaveLength(beforeLines.length);
    expect(afterLines).toHaveLength(1);
    expect(afterLines[0]).toBe(
      '{"on":"mulch","text":"' + REVISED_TEXT + '"}',
    );
    expect(committedClaims(bridged)[0].target).toEqual(
      committedClaims(before)[0].target,
    );
    expect(committedClaims(bridged)[0].text).toBe(REVISED_TEXT);
  });

  test("the other committed records are untouched", () => {
    const a = committedBytes(before);
    const b = committedBytes(bridged);
    expect(b.model).toBe(a.model);
    expect(b.quantities).toBe(a.quantities);
    expect(b.links).toBe(a.links);
  });

  test("the branch is untouched by the return move", () => {
    expect(branchBytes(bridged)).toEqual(branchBytes(before));
  });

  test("the door is the ordinary revise, never an apply verb", () => {
    expect(BRIDGE_SOURCE).toContain(
      "reviseClaim: (assumption: Assumption, text: string) => void",
    );
    const section = compareSection(APP);
    expect(section).toContain("reviseAssumption(assumption, text)");
    expect(section).toContain("addAssumption(target, text)");
    const APPLY = /\bapply\w*/i;
    for (const [name, source] of [
      ["scenarios/bridge.ts", BRIDGE_SOURCE],
      ["canvas/compareNotes.ts", COMPARE_NOTES],
      ["canvas/ComparePanel.tsx", PANEL],
    ] as const) {
      expect({ name, found: APPLY.test(codeOnly(source)) }).toEqual({
        name,
        found: false,
      });
    }
    expect(APPLY.test(codeOnly(section))).toBe(false);
  });

  test("the premise dangles in the PRESENT tense: what stands now", () => {
    expect(readingAfter.dangles).toHaveLength(1);
    const pin = readingAfter.dangles[0];
    expect(pin.text).toBe(CLAIM_TEXT);
    const sentence = dangleText(pin, nameOf);
    expect(sentence).toContain(DANGLE_SAYS);
    expect(sentence).toContain(CLAIM_TEXT);
    expect(sentence).toContain("mulch");
    // No history: a pin is a memory of a premise, never a version.
    for (const history of [
      "was ",
      "were ",
      "used to",
      "previously",
      "earlier",
      "before",
      "changed",
      "edited",
      "had ",
    ]) {
      expect(sentence.toLowerCase()).not.toContain(history);
    }
  });

  test("the revised claim is committed-only and gets its seat, once", () => {
    expect(readingAfter.unpinned).toHaveLength(1);
    const claim = readingAfter.unpinned[0];
    expect(claim.text).toBe(REVISED_TEXT);
    const seat = unpinnedClaimText(claim, nameOf);
    expect(seat).toContain("the committed model says");
    expect(seat).toContain(REVISED_TEXT);
    // A claim is not one of the three key spaces: it rides no row.
    for (const row of readingAfter.rows) {
      expect(row.piece.space).not.toBe("assumption");
    }
    // The premise block is rendered once, never per row.
    expect(PANEL.match(/<Dangles\b/g)).toHaveLength(1);
    expect(PANEL.match(/dangleText\(/g)).toHaveLength(1);
    expect(PANEL).toContain("compare-unpinned");
  });

  test("the rows stand: the values are the records', not the claims'", () => {
    expect(readingAfter.rows).toEqual(readingBefore.rows);
  });

  test("what clears a dangle is branching again, said once", () => {
    expect(DANGLE_CLEARING).toContain("branching again");
    expect(DANGLE_CLEARING).toContain("delete the branch");
    expect(DANGLE_CLEARING).toContain("branch the model anew");
    expect(PANEL).toContain("DANGLE_CLEARING");
  });
});

/* -------------------------------------------------------------------------
 * 7. The re-read: a reading, no reset; the run survives the bridge.
 * ---------------------------------------------------------------------- */

describe("the re-read: a reading, no reset; the run survives the bridge", () => {
  test("the re-read is another reading of the same files (rows stand, premises move)", () => {
    const first = readingOf(afterWhatIf());
    const reread = readingOf(afterBridge());
    expect(reread.rows).toEqual(first.rows);
    expect(first.dangles).toEqual([]);
    expect(first.unpinned).toEqual([]);
    expect(reread.dangles).toHaveLength(1);
    expect(reread.unpinned).toHaveLength(1);
  });

  test("the active key is unchanged by the bridge: a committed edit never resets", () => {
    expect(activeKey(afterBridge())).toBe(activeKey(afterWhatIf()));
  });

  test("the run survives the bridge: the next crank continues from soil 0", () => {
    const files = afterWhatIf();
    const first = crank(startRun(files), files);
    expect(first.run!.amounts.get("soil")).toBe(0);
    const bridged = afterBridge();
    // The reading between the cranks resets nothing.
    readingOf(bridged);
    // The next crank continues from the SURVIVING run: soil is already empty,
    // so soil->plant is clamped to 0. A reset would replay crank 1 (gave 1).
    const second = crank(first, bridged);
    expect(second.key).toBe(first.key);
    expect(second.run!.notes[0]).toEqual({
      kind: "clamp",
      on: "soil",
      from: "soil",
      to: "plant",
      gave: 0,
      asked: 3,
    });
    expect(stepNoteText(second.run!.notes[0], nameOf)).toContain(
      "soil gave 0 of 3",
    );
  });

  test("the key's inputs take no committed record: a claim's revise cannot reset it", () => {
    const body = STEP.slice(
      STEP.indexOf("export function activeModelKey("),
      STEP.indexOf("\n}", STEP.indexOf("export function activeModelKey(")),
    );
    for (const word of [
      "assumption",
      "claim",
      "mark",
      "loop",
      "pointer",
      "distance",
    ]) {
      expect(body.toLowerCase()).not.toContain(word);
    }
    const block = stepKeyBlock(APP);
    expect(block).toContain(
      "activeModelKey(stepRecordsDir, model, links, quantities)",
    );
    expect(block).toContain("[stepRecordsDir, model, links, quantities]");
    for (const forbidden of ["assumption", "compare", "comparePick"]) {
      expect(block).not.toContain(forbidden);
    }
  });

  test("the hook resets only on a different key, and has no writer", () => {
    expect(RUNNER).toContain("if (keyRef.current === key) return;");
    expect(RUNNER).toContain("keyRef.current = key;");
    expect(RUNNER).toContain("setRun(null);");
    expect(RUNNER).toContain("keyRef.current === key ? run : null");
    for (const forbidden of [
      "../lib/fs",
      "writeTextFile",
      "readTextFile",
      "save(",
      "persist",
    ]) {
      expect(codeOnly(RUNNER)).not.toContain(forbidden);
    }
  });
});

/* -------------------------------------------------------------------------
 * 8. Re-branch: delete + branch clears the dangle.
 * ---------------------------------------------------------------------- */

describe("re-branch: delete + branch clears the dangle", () => {
  test("the active branch is switched away before its folder goes", () => {
    const retired = switchTo(retire(afterBridge()), null);
    expect(scenarioOfText(retired[YML])).toBeNull();
    expect(branchBytes(retired)).toEqual({
      header: undefined,
      model: undefined,
      links: undefined,
      quantities: undefined,
      pins: undefined,
    });
  });

  test("delete + branch re-pins the claims as they stand: no dangle remains", () => {
    const rebranched = afterReBranch();
    expect(scenarioOfText(rebranched[YML])).toBe(SLUG);
    expect(pinnedClaims(rebranched).map((pin) => pin.text)).toEqual([
      REVISED_TEXT,
    ]);
    expect(
      danglingPins(pinnedClaims(rebranched), committedClaims(rebranched)),
    ).toEqual([]);
    const reading = readingOf(rebranched);
    expect(reading.dangles).toEqual([]);
    expect(reading.unpinned).toEqual([]);
  });

  test("the fresh branch copies the committed model: the what-if is gone", () => {
    const rebranched = afterReBranch();
    expect(rebranched[BRANCH_QUANTITIES]).toBe(rebranched[MAP_QUANTITIES]);
    expect(
      findQuantity(
        parseQuantities(rebranched[BRANCH_QUANTITIES]).quantities,
        MULCH_SOIL,
      )?.quantity.amount,
    ).toBe(2);
  });

  test("the old premise is written nowhere", () => {
    for (const text of Object.values(afterReBranch())) {
      expect(text).not.toContain(CLAIM_TEXT);
    }
  });

  test("the fresh copy names the outside source again", () => {
    // The corrected fixture's what-if zeroed the source, so the old branch's
    // crank could not name it; a fresh copy restores it, and the step says so.
    const model = folderModel(afterReBranch(), BRANCH);
    const run = stepRun(
      { words: model.words, quantities: model.quantities, links: model.links },
      null,
    );
    expect(run.notes).toContainEqual({
      kind: "outside-source",
      from: "mulch",
      to: "soil",
      amount: 2,
    });
    // The source is back: soil ends at 2, not 0 — the what-if was the drain.
    expect(run.amounts.get("soil")).toBe(2);
  });

  test("a re-branch is a new model: the run resets", () => {
    const files = afterWhatIf();
    const first = crank(startRun(files), files);
    expect(activeKey(afterReBranch())).not.toBe(first.key);
  });
});

/* -------------------------------------------------------------------------
 * 9. Quit, reopen: byte-exact, and no run bytes anywhere.
 * ---------------------------------------------------------------------- */

describe("quit, reopen: byte-exact, and no run bytes anywhere", () => {
  const finalFiles = afterReBranch();

  test("every file reads back byte-exactly through the app's own readers", () => {
    expect(withScenario(finalFiles[YML], scenarioOfText(finalFiles[YML]))).toBe(
      finalFiles[YML],
    );
    const model = parseModel(finalFiles[MAP_MODEL]);
    expect(serializeModel(model.model, model.malformed)).toBe(
      finalFiles[MAP_MODEL],
    );
    const quantities = parseQuantities(finalFiles[MAP_QUANTITIES]);
    expect(
      serializeQuantities(quantities.quantities, quantities.malformed),
    ).toBe(finalFiles[MAP_QUANTITIES]);
    const assumptions = parseAssumptions(finalFiles[MAP_ASSUMPTIONS]);
    expect(
      serializeAssumptions(assumptions.assumptions, assumptions.malformed),
    ).toBe(finalFiles[MAP_ASSUMPTIONS]);
    // The branch's four files.
    expect(parseScenario(finalFiles[BRANCH_HEADER])?.name).toBe("Evening walk");
    const branchModel = parseModel(finalFiles[BRANCH_MODEL]);
    expect(serializeModel(branchModel.model, branchModel.malformed)).toBe(
      finalFiles[BRANCH_MODEL],
    );
    const branchQuantities = parseQuantities(finalFiles[BRANCH_QUANTITIES]);
    expect(
      serializeQuantities(
        branchQuantities.quantities,
        branchQuantities.malformed,
      ),
    ).toBe(finalFiles[BRANCH_QUANTITIES]);
    const pins = parsePins(finalFiles[BRANCH_PINS]);
    expect(serializePins(pins.pins, pins.malformed)).toBe(
      finalFiles[BRANCH_PINS],
    );
  });

  test("the workspace holds exactly the records the walk wrote", () => {
    expect(Object.keys(finalFiles).sort()).toEqual(
      [
        YML,
        MAP_MODEL,
        MAP_QUANTITIES,
        MAP_ASSUMPTIONS,
        BRANCH_HEADER,
        BRANCH_MODEL,
        BRANCH_QUANTITIES,
        BRANCH_PINS,
      ].sort(),
    );
    // No links file was invented on either side: absence stayed absence.
    expect(finalFiles[MAP_LINKS]).toBeUndefined();
    expect(finalFiles[BRANCH_LINKS]).toBeUndefined();
  });

  test("the branch and its pins are as left", () => {
    expect(finalFiles[BRANCH_QUANTITIES]).toBe(finalFiles[MAP_QUANTITIES]);
    expect(parsePins(finalFiles[BRANCH_PINS]).pins.map((pin) => pin.text)).toEqual(
      [REVISED_TEXT],
    );
    expect(scenarioOfText(finalFiles[YML])).toBe(SLUG);
    expect(resolveActiveScenario(scenarioOfText(finalFiles[YML]), [SLUG])).toBe(
      SLUG,
    );
  });

  test("no run bytes anywhere: no run path, no run field, no run file", () => {
    const files = afterWhatIf();
    const run = crank(startRun(files), files).run!;
    const runKeys = Object.keys(run).sort();
    expect(runKeys).toEqual(["amounts", "lastDelta", "notes"]);
    for (const [path, text] of Object.entries(finalFiles)) {
      expect(path).not.toMatch(/run|step|delta|crank|amounts|lastDelta|notes/i);
      for (const key of runKeys) {
        expect(text).not.toContain('"' + key + '"');
      }
    }
  });

  test("the stored stock is still the authored 4: the drained 0 was never written", () => {
    const quantities = parseQuantities(finalFiles[BRANCH_QUANTITIES]).quantities;
    expect(findQuantity(quantities, STOCK_SOIL)?.quantity.amount).toBe(4);
    // The reading drained it to 0; the record did not.
    const files = afterWhatIf();
    const run = crank(crank(startRun(files), files), files).run!;
    expect(run.amounts.get("soil")).toBe(0);
    expect(stepAmountText(run.amounts.get("soil") ?? null)).toBe("0");
  });

  test("cranking writes nothing: the files are identical across the steps", () => {
    const files = afterWhatIf();
    const snapshot: Files = { ...files };
    let driver = startRun(files);
    driver = crank(driver, files);
    driver = crank(driver, files);
    expect(files).toEqual(snapshot);
    // A fresh open has no run: the run is app state, never resumed from disk.
    expect(startRun(finalFiles).run).toBeNull();
  });
});

/* -------------------------------------------------------------------------
 * 10. The negative space: the Funes brake, scoped to the quantity/step seams.
 * ---------------------------------------------------------------------- */

describe("the negative space: no sums, no counters, no apply verb", () => {
  const AGGREGATE =
    /\b(sum|sums|summing|total|totals|meter|meters|table|tables|aggregate|aggregates|average|averages|score|scores)\b/i;

  test("the quantity and step surfaces hold no summing, totals, meters or tables", () => {
    for (const [name, source] of [
      ["map/quantities.ts", QUANTITIES],
      ["canvas/QuantityOverlay.tsx", QUANTITY_OVERLAY],
      ["canvas/QuantityGlyph.tsx", QUANTITY_GLYPH],
      ["map/step.ts", STEP],
      ["canvas/stepNotes.ts", STEP_NOTES],
      ["canvas/StepCrank.tsx", CRANK_VIEW],
      ["canvas/useStepRun.ts", RUNNER],
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

  test("no aggregate helper is exported from the quantity or step modules", () => {
    for (const source of [QUANTITIES, STEP]) {
      const exports = [
        ...source.matchAll(/export (?:async )?function (\w+)/g),
        ...source.matchAll(/export const (\w+)/g),
      ].map((match) => match[1]);
      expect(exports.length).toBeGreaterThan(0);
      for (const name of exports) {
        expect(name).not.toMatch(
          /sum|total|meter|table|aggregate|average|score|count/i,
        );
      }
    }
  });

  test("no step counter: the run is three fields, and the display is ONE word's", () => {
    const interfaceText = STEP.slice(STEP.indexOf("export interface StepRun"));
    const fields = [
      ...interfaceText
        .slice(0, interfaceText.indexOf("\n}"))
        .matchAll(/^  (\w+):/gm),
    ].map((match) => match[1]);
    expect(fields).toEqual(["amounts", "lastDelta", "notes"]);
    expect(RUNNER).toContain("run: StepRun | null");
    expect(RUNNER).toContain("crank: () => void");
    expect(RUNNER).not.toMatch(/useState<number>/);
    // One notch per press: no timer, no autoplay, no celebration.
    expect(CRANK_VIEW).toContain("onClick={onCrank}");
    expect(CRANK_VIEW).not.toMatch(/setInterval|setTimeout/);
    expect(stepDeltaText(0)).toBeNull();
  });

  test("no equality or verdict claim in the comparison's code", () => {
    for (const [name, source] of [
      ["scenarios/compare.ts", COMPARE_SOURCE],
      ["scenarios/compareRead.ts", COMPARE_READ_SOURCE],
      ["scenarios/bridge.ts", BRIDGE_SOURCE],
      ["canvas/compareNotes.ts", COMPARE_NOTES],
      ["canvas/ComparePanel.tsx", PANEL],
    ] as const) {
      expect({ name, found: /\bsame\b/i.test(source) }).toEqual({
        name,
        found: false,
      });
    }
    const VERDICT =
      /\b(diff|diffs|verdict|verdicts|better|worse|best|worst|delta|deltas|score|scores)\b/i;
    for (const [name, source] of [
      ["scenarios/compare.ts", COMPARE_SOURCE],
      ["scenarios/compareRead.ts", COMPARE_READ_SOURCE],
      ["scenarios/bridge.ts", BRIDGE_SOURCE],
      ["canvas/compareNotes.ts", COMPARE_NOTES],
      ["canvas/ComparePanel.tsx", PANEL],
    ] as const) {
      expect({ name, found: codeOnly(source).match(VERDICT)?.[0] ?? null }).toEqual(
        { name, found: null },
      );
    }
  });

  test("no apply verb in the bridge or its view", () => {
    const APPLY = /\bapply\w*/i;
    for (const [name, source] of [
      ["scenarios/bridge.ts", BRIDGE_SOURCE],
      ["canvas/compareNotes.ts", COMPARE_NOTES],
      ["canvas/ComparePanel.tsx", PANEL],
    ] as const) {
      expect({ name, found: APPLY.test(codeOnly(source)) }).toEqual({
        name,
        found: false,
      });
    }
    expect(APPLY.test(codeOnly(compareSection(APP)))).toBe(false);
  });

  test("the branch never writes a committed record except through the bridge", () => {
    // The branch writer's paths come from the branch's folder only.
    const create = functionBody(BRANCH_SOURCE, "createScenario");
    expect(create).toContain("scenarioDir(workspacePath, minted.slug)");
    expect(create).not.toContain("mapDir(");
    const retireBody = functionBody(BRANCH_SOURCE, "retireScenario");
    expect(retireBody).not.toContain("mapDir(");
    // The batch's fan-out writes inside each branch folder, never map/.
    const apply = functionBody(PATCHES, "applyScenarioStep");
    expect(apply).toContain("scenarioDir(");
    expect(apply).not.toContain("mapDir(");
    // The bridge's ONE committed writer joins map/ itself and cannot reach a
    // branch folder.
    const saved = functionBody(COMPARE_READ_SOURCE, "saveCommittedRecord");
    expect(saved).toContain("mapDir(workspacePath)");
    expect(saved).not.toContain("scenarioDir");
    expect(saved).not.toContain("scenarios/");
    // The pins module and the comparison are pure: no fs, no path, no writer.
    expect(codeOnly(PINS_SOURCE)).not.toContain("../lib/fs");
    expect(codeOnly(COMPARE_SOURCE)).not.toContain("../lib/fs");
    expect(codeOnly(BRIDGE_SOURCE)).not.toContain("../lib/fs");
    // The app's committed write goes through that one door.
    const section = compareSection(APP);
    expect(section).toContain("saveCommittedRecord(");
    expect(section).toContain("deliberateEdit(records, move)");
    expect(section).toContain("if (edit.changed === null) return;");
    expect(section).not.toContain("saveLinks(recordsDir");
    expect(section).not.toContain("saveQuantities(recordsDir");
    expect(section).not.toContain("saveModel(recordsDir");
  });

  test("an untouched branch folder is never written: a branch's bytes are its own", () => {
    const apply = functionBody(PATCHES, "applyScenarioStep");
    expect(apply).toContain("if (next === folder) continue;");
    expect(apply).toContain("writeChangedBytes(");
    const step = syncFunctionBody(PATCHES, "rewriteScenarioFolderForWord");
    expect(step).toContain("compactFolder(");
    // The raw byte door carries the copies: no canonicalization repair.
    const create = functionBody(BRANCH_SOURCE, "createScenario");
    expect(create).toContain("writeTextFile(");
  });
});

/* -------------------------------------------------------------------------
 * 11. The retired phrases stay retired (the corrected fixture's ground).
 * ---------------------------------------------------------------------- */

describe("the retired phrases stay retired", () => {
  test("the fixture's numbers are never baked into the step's sentences", () => {
    // The notes interpolate the run's numbers; no literal shortfall is stored.
    expect(codeOnly(STEP_NOTES)).not.toMatch(/gave \d+ of \d+/);
    expect(codeOnly(STEP)).not.toMatch(/gave \d+ of \d+/);
    // The sentence composes the run's numbers through the record's formatter.
    expect(STEP_NOTES).toContain("formatAmount(note.gave)");
    expect(STEP_NOTES).toContain("formatAmount(note.asked)");
    // The clamp's wording is provisional (ADR-0003): the structure is asserted
    // above (stock, flow, shortfall against the authored amount).
  });

  test("the quantity record's retired kind field stays retired", () => {
    // The shape IS the type (the wordless-pair lesson): a stock line carries
    // on, a flow line from+to, and no line ever carries a kind.
    const shapes = (afterReBranch()[MAP_QUANTITIES] ?? "")
      .trim()
      .split("\n")
      .map((line) => Object.keys(JSON.parse(line)).sort());
    expect(shapes).toEqual([
      ["amount", "on"],
      ["amount", "from", "to"],
      ["amount", "from", "to"],
      ["amount", "from", "to"],
      ["from", "to"],
    ]);
    for (const line of (afterReBranch()[MAP_QUANTITIES] ?? "").trim().split("\n")) {
      expect(line).not.toContain('"kind"');
    }
  });

  test("the comparison's retired equality claim stays retired", () => {
    for (const source of [
      COMPARE_SOURCE,
      COMPARE_READ_SOURCE,
      BRIDGE_SOURCE,
      COMPARE_NOTES,
      PANEL,
    ]) {
      expect(source).not.toMatch(/\bsame\b/i);
    }
    // And the word a history would use is not in the dangle presentation.
    expect(codeOnly(COMPARE_NOTES)).not.toMatch(
      /\b(was|were|previously|earlier)\b/i,
    );
  });

  test("the retired persistence stays retired: stepping has no writer", () => {
    for (const [name, source] of [
      ["map/step.ts", STEP],
      ["canvas/useStepRun.ts", RUNNER],
      ["canvas/StepCrank.tsx", CRANK_VIEW],
    ] as const) {
      const code = codeOnly(source);
      for (const forbidden of [
        "../lib/fs",
        "writeTextFile",
        "writeMachineFile",
        "readTextFile",
        "persist",
      ]) {
        expect({ name, forbidden, found: code.includes(forbidden) }).toEqual({
          name,
          forbidden,
          found: false,
        });
      }
    }
    // The step takes a model and the previous run: no path, no disk.
    expect(STEP).toContain("model: StepModel,");
    expect(STEP).toContain("previous: StepRun | null,");
  });

  test("the rejected fixture's clamp is not reachable: the corrected one is 1 of 3", () => {
    // The Answer's 3->1 edit made the outflows exactly 4, so no clamp occurred
    // and "gave 2 of 3" was unreachable. The corrected fixture clamps at 1 of 3
    // and the next crank says 0 of 3 — asserted in the step section above.
    const files = afterWhatIf();
    const run = crank(startRun(files), files).run!;
    const clamps = run.notes.filter((note) => note.kind === "clamp");
    expect(clamps).toHaveLength(1);
    const clamp = clamps[0];
    if (clamp.kind !== "clamp") throw new Error("not a clamp");
    expect(clamp.gave).toBe(1);
    expect(clamp.asked).toBe(3);
  });
});
