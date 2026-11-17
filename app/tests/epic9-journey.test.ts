import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import { DEFAULT_BOX } from "../src/canvas/geometry";
import { NOTICE_FAMILY_GAME } from "../src/canvas/notices";
import { showsMapContent } from "../src/canvas/mapContentRules";
import {
  VEIL_LEVELS,
  boxIsDrawable,
  capturedBox,
  lookUnderLive,
  veilLive,
} from "../src/canvas/veilRules";
import {
  addAssumption,
  assumptionsPath,
  parseAssumptions,
  serializeAssumptions,
  type Assumption,
} from "../src/map/assumptions";
import {
  parseDistances,
  serializeDistances,
  type Distance,
} from "../src/map/distances";
import {
  hasMark,
  parseMarks,
  serializeMarkLine,
  serializeMarks,
  withMark,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import {
  outOfPlay,
  parseModel,
  serializeModel,
  type PlayingSet,
} from "../src/map/model";
import {
  addPointer,
  parsePointers,
  pointersPath,
  serializePointers,
  type Pointer,
} from "../src/map/pointers";
import {
  parseQuantities,
  quantitiesPath,
  serializeQuantities,
  setQuantity,
  type Quantity,
} from "../src/map/quantities";
import {
  RECORD_FILE,
  mapDir,
  recordsDirOf,
  scenarioDir,
  scenariosDir,
} from "../src/map/records";
import {
  parseReference,
  referencePath,
  serializeReference,
  type Reference,
} from "../src/map/refs";
import {
  centreOfWord,
  coveredWordSlugs,
  findVeil,
  nameVeil,
  parseVeilLine,
  parseVeils,
  removeVeil,
  renameVeil,
  serializeVeilLine,
  serializeVeils,
  topVeilOf,
  veilBox,
  veilCoversPoint,
  veilKey,
  veilSlug,
  veilsCoveringWord,
  veilsPath,
  type PlacedWord,
  type Veil,
} from "../src/map/veils";
import {
  agentsMd,
  scaffoldWrites,
  workspaceScaffold,
  workspaceYml,
} from "../src/lib/serialize";
import {
  LEVELS,
  levelOfText,
  withLevel,
  type Level,
} from "../src/workspace/level";

/**
 * Epic 9's plain-language check, automated at the record layer (story 3).
 *
 * The locked check (Epic 9 check and slice, its Answer) runs in the real
 * window as the SEVENTH queued human pass. This file walks its RECORD half
 * through the pure modules and the files' bytes only, no DOM, in the check's
 * own order:
 *
 *   SETUP: a small map. A NAMED word with its memory (rain), a TENTATIVE word
 *   (soil, an open mark), a distance as a wire (rain -> soil, "waters") with
 *   its own mark, a playing set that excludes the tentative word, a
 *   QUESTION-WORD left unanswered ("why does rain miss the soil?") and a BARE
 *   LACK (one anonymous spot mark). No veil yet.
 *   THE UNKNOWNS WALK AWAY: the question-word and the bare lack are invisible
 *   unknowns - bytes untouched by the whole journey, nothing counted anywhere.
 *   THE VEIL: the person drags a BOX around rain and soil, coins its name and
 *   types its reason - ONE canonical line (name, box, reason; no covered list,
 *   no count). The cover is the render-time CENTRE test. Reopen later: the
 *   record is exactly as left, byte for byte. Retire: the line goes, and every
 *   other file is byte-identical to the map before the veil existed.
 *   COVERED IS NOT SETTLED: no record carries a veil field; the covered word's
 *   mark and the marked wire survive byte-exactly; covered + out-of-set keeps
 *   the ONE wash (pure CSS-rule scans).
 *   THE SURFACING NEGATIVE: nothing renders a veil's name or reason unasked -
 *   the sheet is presence only and the opened look-under is the ONLY reading.
 *   The presence accessor reserved for the pull is NOW BUILT (Epic 13 story
 *   1): the pull module's projection is the ONE sanctioned coupling, and it
 *   lives under pull/ - outside every render path. No other exported accessor,
 *   cue band or prompt path exists.
 *   THE GROUND GATE: no sheet and no look-under at ground; the game switch is
 *   the look-under. A render rule (veilRules), never a record edit.
 *   THE PROMOTION CLAUSE: the keep is the already-built moves - a word and its
 *   memory, or a pointer at ground; the quantity or assumption line authored by
 *   hand at dynamics. No promotion record, no machinery.
 *   THE CLOSING NOTE: nothing is delegated - the absence of any carrier.
 *   QUIT/REOPEN: every record as left; the veil retires only when deleted.
 *
 * NEGATIVE SPACE: no counts anywhere (no count accessor, no count field, no
 * summary file), and veils never enter scenario folders.
 *
 * NAMED FOLLOW-UPS (recorded, not fixed here - no source fix was forced; see
 * the story's report):
 *   1. The cover's feel, the sheet's press and the look-under's close idioms
 *      are the queued real-window pass (the seventh); this file is the record
 *      half only.
 *   2. topVeilOf is the stacking CONTRACT, not an app reader: the app renders
 *      sheets in file order and never calls it (or veilsCoveringWord). Left as
 *      the story 1 helper it is; not a defect.
 *   3. The pull itself (Epic 13 story 1) is now built as the read-set reader
 *      and its veil projection; measured against this epic, the reservation
 *      became the pull module under pull/ (asserted: the only coupling). The
 *      context packet's veil sentence (Epic 10) is built too; its scan lives
 *      in that epic's own tests.
 *
 * Provisional (ADR-0023's own list): box-vs-stroke, sheets-in-file-order and
 * overlap, wire crossing, the sheet's look, the look-under's look, the
 * counter-scale values, and the reason's prose.
 */

const NL = "\n";

const WS = "/home/maps/garden";
const MAP = mapDir(WS);
const REFS = MAP + "/references/";
const YML = WS + "/workspace.yml";
const VEILS_PATH = veilsPath(WS);
const DISTANCES_PATH = MAP + "/distances.jsonl";
const MARKS_PATH = MAP + "/marks.jsonl";
const MODEL_PATH = MAP + "/model.json";
const POINTERS_PATH = pointersPath(WS);
const QUANTITIES_PATH = quantitiesPath(MAP);
const ASSUMPTIONS_PATH = assumptionsPath(WS);

/** The person's places, in world space (the word's top-left corner). */
const RAIN_AT = { x: 220, y: 180 };
const SOIL_AT = { x: 360, y: 180 };
const QUESTION_AT = { x: 560, y: 470 };
const LACK_AT = { x: 700, y: 520 };
const KEEP_AT = { x: 520, y: 300 };

/** The draw-box gesture's two corners, captured in the order they were dragged. */
const DRAG = { from: { x: 180, y: 140 }, to: { x: 460, y: 230 } };
const BOX = capturedBox(DRAG.from, DRAG.to);

const VEIL_NAME = "the wet corner";
const VEIL_KEY = "the-wet-corner";
const VEIL_REASON = "not now — the two words move together and I cannot say how";

/** The veil's exact line: name, box, reason - and nothing else. */
const VEIL_LINE =
  '{"h":90,"name":"the wet corner","reason":"not now — the two words move together and I cannot say how","w":280,"x":180,"y":140}';

const QUESTION = "why does rain miss the soil?";
const QUESTION_SLUG = "why-does-rain-miss-the-soil";
const RAIN_BODY = "the water that arrives without being asked" + NL;
const TAP_BODY = "the notes say the tap runs at 6am" + NL;

/** The marks file's exact bytes: two marks that are content, two unknowns. */
const MARKS_BYTES =
  [
    '{"kind":"open","on":"soil"}',
    '{"from":"rain","kind":"open","to":"soil","word":"waters"}',
    '{"kind":"open","on":"why-does-rain-miss-the-soil"}',
    '{"kind":"open","x":700,"y":520}',
    "",
  ].join(NL);

/** The reference file's canonical bytes (name/x/y frontmatter, verbatim prose). */
function referenceBytes(
  name: string,
  x: number,
  y: number,
  body: string = "",
): string {
  return (
    "---" + NL +
    "name: " + JSON.stringify(name) + NL +
    "x: " + x + NL +
    "y: " + y + NL +
    "---" + NL +
    body
  );
}

const word = (slug: string): MarkTarget => ({ type: "word", slug });
const wire = (from: string, to: string, wordText: string): MarkTarget => ({
  type: "wire",
  from,
  to,
  word: wordText,
});
const spot = (x: number, y: number): MarkTarget => ({ type: "spot", x, y });
const open = (target: MarkTarget): Mark => ({ kind: "open", target, extra: {} });

function reference(
  name: string,
  slug: string,
  at: { x: number; y: number },
  body: string = "",
): Reference {
  return { id: slug, slug, name, x: at.x, y: at.y, body, extra: {} };
}

/** Every record the check touches, plus the map they are about - one journey. */
interface Journey {
  refs: Reference[];
  distances: Distance[];
  marks: Mark[];
  model: PlayingSet | null;
  veils: Veil[];
  pointers: Pointer[];
  quantities: Quantity[];
  assumptions: Assumption[];
  malformedVeils: string[];
}

type Files = Record<string, string>;

/**
 * The map the check starts from. The unknowns are the two marks nobody will
 * touch: the QUESTION-WORD grown at the spot (a named, open question) and the
 * BARE LACK left as a spot. The tentative word carries an open mark; the
 * playing set excludes it, so it is covered AND out of play.
 */
function theMap(): Journey {
  let marks: Mark[] = [];
  marks = withMark(marks, open(word("soil")));
  marks = withMark(marks, open(wire("rain", "soil", "waters")));
  marks = withMark(marks, open(word(QUESTION_SLUG)));
  marks = withMark(marks, open(spot(LACK_AT.x, LACK_AT.y)));
  return {
    refs: [
      reference("rain", "rain", RAIN_AT, RAIN_BODY),
      reference("soil", "soil", SOIL_AT),
      reference(QUESTION, QUESTION_SLUG, QUESTION_AT),
    ],
    distances: [{ from: "rain", to: "soil", word: "waters", extra: {} }],
    marks,
    model: { words: ["rain", QUESTION_SLUG], extra: {} },
    veils: [],
    pointers: [],
    quantities: [],
    assumptions: [],
    malformedVeils: [],
  };
}

/** The veil is coined: the captured box, the person's name, the prose reason. */
function withVeil(journey: Journey): Journey {
  return {
    ...journey,
    veils: nameVeil(journey.veils, VEIL_NAME, BOX, VEIL_REASON),
  };
}

/** Retire: the line goes, and only that line. */
function withRetired(journey: Journey): Journey {
  return { ...journey, veils: removeVeil(journey.veils, VEIL_NAME) };
}

/**
 * The keep, after the window closes (the promotion clause): at ground a word
 * and its memory plus a pointer; at dynamics the quantity and assumption lines
 * the person authors by hand. All ordinary record writes - nothing new.
 */
function withKeep(journey: Journey): Journey {
  let quantities = setQuantity(journey.quantities, { type: "stock", on: "rain" }, 4);
  quantities = setQuantity(quantities, { type: "flow", from: "rain", to: "soil" }, null);
  return {
    ...journey,
    refs: [
      ...journey.refs,
      reference("tap water", "tap-water", KEEP_AT, TAP_BODY),
    ],
    pointers: addPointer(journey.pointers, "tap-water", "path", "notes/garden.md"),
    quantities,
    assumptions: addAssumption(
      journey.assumptions,
      "the tap runs before the rain",
      { type: "word", slug: "rain" },
    ),
  };
}

/** Write the journey's records to the workspace's files (the app's writes). */
function write(journey: Journey): Files {
  const files: Files = {
    [YML]: workspaceYml(),
    [DISTANCES_PATH]: serializeDistances(journey.distances),
    [MARKS_PATH]: serializeMarks(journey.marks),
    [VEILS_PATH]: serializeVeils(journey.veils, journey.malformedVeils),
  };
  if (journey.model !== null) files[MODEL_PATH] = serializeModel(journey.model);
  if (journey.pointers.length > 0) {
    files[POINTERS_PATH] = serializePointers(journey.pointers);
  }
  if (journey.quantities.length > 0) {
    files[QUANTITIES_PATH] = serializeQuantities(journey.quantities);
  }
  if (journey.assumptions.length > 0) {
    files[ASSUMPTIONS_PATH] = serializeAssumptions(journey.assumptions);
  }
  for (const ref of journey.refs) {
    if (ref.slug === null) throw new Error("an uncoined word cannot be written");
    files[referencePath(WS, ref.slug)] = serializeReference(ref);
  }
  return files;
}

/** Quit and reopen: read every file back and assert the next write is its bytes. */
function reopen(files: Files): Journey {
  const refs: Reference[] = [];
  for (const path of Object.keys(files)
    .filter((candidate) => candidate.startsWith(REFS) && candidate.endsWith(".md"))
    .sort()) {
    const text = files[path];
    const slug = path.slice(REFS.length, -3);
    const parsed = parseReference(slug, slug, text);
    expect(serializeReference(parsed)).toBe(text);
    refs.push(parsed);
  }

  const distances = parseDistances(files[DISTANCES_PATH]);
  expect(distances.malformed).toEqual([]);
  expect(serializeDistances(distances.distances)).toBe(files[DISTANCES_PATH]);

  const marks = parseMarks(files[MARKS_PATH]);
  expect(marks.malformed).toEqual([]);
  expect(serializeMarks(marks.marks)).toBe(files[MARKS_PATH]);

  const veils = parseVeils(files[VEILS_PATH]);
  expect(veils.malformed).toEqual([]);
  expect(serializeVeils(veils.veils, veils.malformed)).toBe(files[VEILS_PATH]);

  const modelText = files[MODEL_PATH];
  const model = modelText === undefined ? null : parseModel(modelText).model;
  if (modelText !== undefined) {
    expect(model).not.toBeNull();
    expect(serializeModel(model)).toBe(modelText);
  }

  const pointerText = files[POINTERS_PATH];
  const parsedPointers =
    pointerText === undefined
      ? { pointers: [], malformed: [], duplicates: [] }
      : parsePointers(pointerText);
  expect(parsedPointers.malformed).toEqual([]);
  expect(parsedPointers.duplicates).toEqual([]);
  if (pointerText !== undefined) {
    expect(serializePointers(parsedPointers.pointers)).toBe(pointerText);
  }

  const quantityText = files[QUANTITIES_PATH];
  const parsedQuantities =
    quantityText === undefined
      ? { quantities: [], malformed: [], duplicates: [] }
      : parseQuantities(quantityText);
  expect(parsedQuantities.malformed).toEqual([]);
  expect(parsedQuantities.duplicates).toEqual([]);
  if (quantityText !== undefined) {
    expect(serializeQuantities(parsedQuantities.quantities)).toBe(quantityText);
  }

  const assumptionText = files[ASSUMPTIONS_PATH];
  const parsedAssumptions =
    assumptionText === undefined
      ? { assumptions: [], malformed: [], duplicates: [] }
      : parseAssumptions(assumptionText);
  expect(parsedAssumptions.malformed).toEqual([]);
  expect(parsedAssumptions.duplicates).toEqual([]);
  if (assumptionText !== undefined) {
    expect(serializeAssumptions(parsedAssumptions.assumptions)).toBe(assumptionText);
  }

  return {
    refs,
    distances: distances.distances,
    marks: marks.marks,
    model,
    veils: veils.veils,
    pointers: parsedPointers.pointers,
    quantities: parsedQuantities.quantities,
    assumptions: parsedAssumptions.assumptions,
    malformedVeils: [],
  };
}

/** The coined words as the cover's region test needs them (the default box). */
function placed(journey: Journey): PlacedWord[] {
  return journey.refs
    .filter((ref): ref is Reference & { slug: string } => ref.slug !== null)
    .map((ref) => ({
      slug: ref.slug,
      pos: { x: ref.x, y: ref.y },
      box: { ...DEFAULT_BOX },
    }));
}

/**
 * The app's ONE cover reading (App.tsx): behind the veil's level rule AND the
 * separate-maps content rule, else nothing.
 *
 * DEPRECATED (hidden 2026-11-16 per separate-maps review): the map-content
 * rule blanks every record-derived surface off concept, so the cover is read at
 * concept only while the flag stands — veilLive's Levels 1–2 rule is kept
 * written underneath it (and still decides the flip-back).
 */
function coveredIn(
  level: Level,
  veils: readonly Veil[],
  words: readonly PlacedWord[],
): string[] {
  if (!veilLive(level) || !showsMapContent(level)) return [];
  return [...coveredWordSlugs(veils, words)].sort();
}

/** Which paths differ between two file maps (added, removed or rewritten). */
function changedPaths(before: Files, after: Files): string[] {
  const paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths].filter((path) => before[path] !== after[path]).sort();
}

/* ------------------------------------------------------------------------- *
 * The app's own source, read once: the source scans are the epic's claims.
 * ------------------------------------------------------------------------- */

const SRC_DIR = fileURLToPath(new URL("../src", import.meta.url));

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

const SOURCES = walk(SRC_DIR)
  .filter(
    (path) =>
      path.endsWith(".ts") || path.endsWith(".tsx") || path.endsWith(".css"),
  )
  .map((path) => ({
    path: relative(SRC_DIR, path).split(sep).join("/"),
    source: readFileSync(path, "utf8"),
  }));

function sourceOf(path: string): string {
  const found = SOURCES.find((entry) => entry.path === path);
  if (found === undefined) throw new Error("no source at " + path);
  return found.source;
}

const APP = sourceOf("App.tsx");
const USE_MAP = sourceOf("canvas/useMap.ts");
const VEILS_SRC = sourceOf("map/veils.ts");
const VEIL_RULES = sourceOf("canvas/veilRules.ts");
const SHEET = sourceOf("canvas/VeilSheet.tsx");
const CARD = sourceOf("canvas/VeilLookUnder.tsx");
const CSS = sourceOf("canvas/canvas.css");
const RECORDS = sourceOf("map/records.ts");
const PATCHES = sourceOf("map/patches.ts");
const NOTICES = sourceOf("canvas/notices.ts");
const PRESENCE = sourceOf("canvas/presenceRules.ts");
const SERIALIZE = sourceOf("lib/serialize.ts");
const WORD = sourceOf("canvas/ReferenceWord.tsx");
const OUTWARD = sourceOf("canvas/outward.ts");
const OUTWARD_RULES = sourceOf("canvas/outwardRules.ts");
const LEVEL_CONTROL = sourceOf("canvas/LevelControl.tsx");

/** One CSS rule's body (the selector plus " {" to its first "}"). */
function rule(selector: string): string {
  const start = CSS.indexOf(selector + " {");
  expect(start).toBeGreaterThan(-1);
  return CSS.slice(start, CSS.indexOf("}", start));
}

/** One module's exported names (functions, consts, types) - the absence scan. */
function exportedNames(source: string): string[] {
  return [
    ...source.matchAll(/^export (?:async )?(?:function|const|let|class|interface|type) (\w+)/gm),
  ].map((match) => match[1]);
}

/** One app callback's source, from its declaration to its closing line. */
function callback(text: string, name: string): string {
  const start = text.indexOf("const " + name + " = useCallback(");
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf(NL + "  );", start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

/* ========================================================================= *
 * 1. The setup: the map the check starts from.
 * ========================================================================= */

describe("the setup: the map the check starts from", () => {
  test("it writes and reopens byte-exactly, with both unknowns visible", () => {
    const files = write(theMap());
    const reopened = reopen(files);

    expect(reopened.refs.map((ref) => ref.slug).sort()).toEqual([
      "rain",
      "soil",
      QUESTION_SLUG,
    ]);
    // The question-word is an ordinary named word at its spot, unresolved.
    expect(files[referencePath(WS, QUESTION_SLUG)]).toBe(
      referenceBytes(QUESTION, QUESTION_AT.x, QUESTION_AT.y),
    );
    // The memory is prose, byte-verbatim; the frontmatter is name/x/y only.
    expect(files[referencePath(WS, "rain")]).toBe(
      referenceBytes("rain", RAIN_AT.x, RAIN_AT.y, RAIN_BODY),
    );
    expect(reopened.refs.find((ref) => ref.slug === "rain")!.body).toBe(RAIN_BODY);
    for (const ref of reopened.refs) expect(ref.extra).toEqual({});

    // The two marks that are content and the two unknowns, exactly.
    expect(files[MARKS_PATH]).toBe(MARKS_BYTES);
    expect(hasMark(reopened.marks, "open", word("soil"))).toBe(true);
    expect(hasMark(reopened.marks, "open", wire("rain", "soil", "waters"))).toBe(true);

    // The playing set excludes the tentative word (covered AND out of play).
    expect(reopened.model).toEqual({ words: ["rain", QUESTION_SLUG], extra: {} });
    expect(outOfPlay(reopened.model, null, "soil")).toBe(true);

    // No veil yet: the scaffold's empty canonical JSONL.
    expect(reopened.veils).toEqual([]);
    expect(files[VEILS_PATH]).toBe(NL);
    expect(files[DISTANCES_PATH]).toBe(
      '{"from":"rain","to":"soil","word":"waters"}' + NL,
    );
  });
});

/* ========================================================================= *
 * 2. (a) The unknowns walk away: a question-word and a bare lack.
 * ========================================================================= */

describe("the unknown stays unknown (the question-word)", () => {
  test("coined and walked away from: unanswered, uncounted, unchanged bytes", () => {
    const before = write(theMap());
    const after = write(withKeep(withVeil(theMap())));

    // The question-word's file: the question and its spot, no answer memory.
    expect(after[referencePath(WS, QUESTION_SLUG)]).toBe(
      before[referencePath(WS, QUESTION_SLUG)],
    );
    expect(after[referencePath(WS, QUESTION_SLUG)]).toBe(
      referenceBytes(QUESTION, QUESTION_AT.x, QUESTION_AT.y),
    );
    // Its open mark is untouched by the veil, the keep and the reopen.
    expect(after[MARKS_PATH]).toBe(before[MARKS_PATH]);
    const reopened = reopen(after);
    const question = reopened.refs.find((ref) => ref.slug === QUESTION_SLUG)!;
    expect(question.body).toBe("");
    expect(question.extra).toEqual({});
    expect(hasMark(reopened.marks, "open", word(QUESTION_SLUG))).toBe(true);
    // The question's mark is one anonymous line: no kind of ignorance, no
    // lifecycle, no answer, no count.
    const line = after[MARKS_PATH].split(NL).find((entry) => entry.includes(QUESTION_SLUG))!;
    expect(line).toBe('{"kind":"open","on":"why-does-rain-miss-the-soil"}');
  });
});

describe("the unknown stays unknown (the bare lack)", () => {
  test("left bare: never named, never grown, one anonymous spot line", () => {
    const before = write(theMap());
    const after = write(withKeep(withVeil(theMap())));

    expect(after[MARKS_PATH]).toBe(before[MARKS_PATH]);
    const reopened = reopen(after);
    expect(hasMark(reopened.marks, "open", spot(LACK_AT.x, LACK_AT.y))).toBe(true);
    // The lack is still a spot, not a word: no reference file was coined there.
    expect(
      reopened.refs.some((ref) => ref.x === LACK_AT.x && ref.y === LACK_AT.y),
    ).toBe(false);
    // The line is anonymous: no name, no slug, no reason, no count.
    expect(after[MARKS_PATH]).toContain('{"kind":"open","x":700,"y":520}');
    expect(after[MARKS_PATH]).not.toContain('"name"');
  });
});

describe("nothing counts either unknown", () => {
  test("no count accessor, no count field, no summary file", () => {
    const files = write(withKeep(withVeil(theMap())));

    // No file is a count, queue, backlog, score or progress record.
    for (const path of Object.keys(files)) {
      const counted =
        /count|tally|score|queue|backlog|meter|total|streak|badge|progress/i.test(
          path,
        );
      expect({ path, counted }).toEqual({ path, counted: false });
    }
    // No record line carries a count-ish key (the marks hold the unknowns).
    for (const [path, text] of Object.entries(files)) {
      if (!path.endsWith(".jsonl")) continue;
      for (const line of text.split(NL)) {
        if (line === "") continue;
        for (const key of Object.keys(JSON.parse(line))) {
          const counted = /count|tally|score|total|meter|streak|badge/i.test(key);
          expect({ path, key, counted }).toEqual({ path, key, counted: false });
        }
      }
    }
    // The marks' kind never grows a lifecycle or a taxonomy.
    const marks = parseMarks(files[MARKS_PATH]).marks;
    expect(marks.length).toBeGreaterThan(0);
    for (const mark of marks) expect(mark.kind).toBe("open");
    // And the app renders no count of them either.
    expect(APP).not.toContain("marks.length");
    expect(APP).not.toContain("veils.length");
    // No accessor in the record modules counts anything.
    for (const [name, source] of [
      ["map/veils.ts", VEILS_SRC],
      ["map/marks.ts", sourceOf("map/marks.ts")],
    ] as const) {
      for (const exported of exportedNames(source)) {
        const counted = /count|tally|total|score|summary/i.test(exported);
        expect({ name, exported, counted }).toEqual({
          name,
          exported,
          counted: false,
        });
      }
    }
  });
});

/* ========================================================================= *
 * 3. (b) The veil: create, cover, reopen, retire.
 * ========================================================================= */

describe("the veil: the box, the name and the reason", () => {
  test("the captured BOX (not the stroke) is the record's rectangle", () => {
    // The gesture's two corners, whichever came first: one box.
    expect(BOX).toEqual({ x: 180, y: 140, w: 280, h: 90 });
    expect(capturedBox(DRAG.to, DRAG.from)).toEqual(BOX);
    expect(boxIsDrawable(BOX)).toBe(true);
    // A press that never moved encloses nothing: a click stays a click.
    expect(boxIsDrawable(capturedBox(DRAG.from, DRAG.from))).toBe(false);
    // The record's box is the captured one, numbers only (no path, no stroke).
    const veiled = withVeil(theMap());
    expect(veilBox(veiled.veils[0])).toEqual(BOX);
    expect(Object.keys(veiled.veils[0]).sort()).toEqual([
      "extra",
      "h",
      "name",
      "reason",
      "w",
      "x",
      "y",
    ]);
  });

  test("coining writes ONE canonical line: the name, the box, the reason", () => {
    const veiled = withVeil(theMap());
    expect(serializeVeils(veiled.veils)).toBe(VEIL_LINE + NL);
    const parsed = parseVeilLine(VEIL_LINE)!;
    expect(Object.keys(JSON.parse(VEIL_LINE)).sort()).toEqual([
      "h",
      "name",
      "reason",
      "w",
      "x",
      "y",
    ]);
    expect(parsed.name).toBe(VEIL_NAME);
    expect(parsed.reason).toBe(VEIL_REASON);
    expect(parsed.extra).toEqual({});
    expect(veilBox(parsed)).toEqual(BOX);
    // The reason is PROSE, stored verbatim: never trimmed, parsed or classified.
    expect(veiled.veils[0].reason).toBe(VEIL_REASON);
    // The line names NO word it covers and carries NO covered list or count.
    expect(VEIL_LINE).not.toMatch(/rain|soil|waters/);
    for (const value of Object.values(JSON.parse(VEIL_LINE))) {
      expect(Array.isArray(value)).toBe(false);
    }
    // The natural key is the name's slug (the person's handle, dedupe only).
    expect(veilKey(veiled.veils[0])).toBe(VEIL_KEY);
    expect(veilSlug(VEIL_NAME)).toBe(VEIL_KEY);
    expect(findVeil(veiled.veils, VEIL_NAME)?.name).toBe(VEIL_NAME);
    expect(findVeil(veiled.veils, VEIL_KEY)?.name).toBe(VEIL_NAME);
  });

  test("name AND reason are coined together: either blank writes nothing", () => {
    // The pre-verbal case stays the bare mark (ADR-0023 decision 1).
    const veiled = withVeil(theMap());
    expect(nameVeil(veiled.veils, "", BOX, VEIL_REASON)).toEqual(veiled.veils);
    expect(nameVeil(veiled.veils, "   ", BOX, VEIL_REASON)).toEqual(veiled.veils);
    expect(nameVeil(veiled.veils, "a second veil", BOX, "")).toEqual(veiled.veils);
    expect(nameVeil(veiled.veils, "a second veil", BOX, "  ")).toEqual(veiled.veils);
    // A real coin is appended LAST: file order is the stacking order.
    const second = nameVeil(veiled.veils, "a second veil", BOX, "because");
    expect(second.map((veil) => veil.name)).toEqual([VEIL_NAME, "a second veil"]);
  });
});

describe("the veil covers two words by their CENTRE", () => {
  test("the named word and the tentative word are covered; nothing else is", () => {
    const veiled = withVeil(theMap());
    const words = placed(veiled);
    const covered = coveredWordSlugs(veiled.veils, words);
    expect([...covered].sort()).toEqual(["rain", "soil"]);
    // The named word and the tentative word both, by the centre rule.
    expect(centreOfWord(words[0])).toEqual({ x: 268, y: 194 });
    expect(centreOfWord(words[1])).toEqual({ x: 408, y: 194 });
    expect(veilCoversPoint(veiled.veils[0], centreOfWord(words[0]))).toBe(true);
    expect(veilCoversPoint(veiled.veils[0], centreOfWord(words[1]))).toBe(true);
    // The question-word is outside the box: still visible, still unanswered.
    expect(covered.has(QUESTION_SLUG)).toBe(false);
    expect(topVeilOf(veiled.veils, words[0])?.name).toBe(VEIL_NAME);
    expect(veilsCoveringWord(veiled.veils, words[2])).toEqual([]);
    // Wires are never words: the distance has no slug and no entry in the test.
    expect(words.map((entry) => entry.slug)).toEqual([
      "rain",
      "soil",
      QUESTION_SLUG,
    ]);
  });
});

describe("reopen: the record is exactly as left", () => {
  test("quit and reopen: the veil's line, box and reason are unchanged bytes", () => {
    const files = write(withVeil(theMap()));
    const reopened = reopen(files);
    expect(reopened.veils).toEqual(withVeil(theMap()).veils);
    expect(serializeVeils(reopened.veils)).toBe(VEIL_LINE + NL);
    expect(files[VEILS_PATH]).toBe(VEIL_LINE + NL);
    // The cover is re-derived, not stored: the same two words are covered.
    expect(coveredIn("concept", reopened.veils, placed(reopened)).sort()).toEqual([
      "rain",
      "soil",
    ]);
    // The reason reads exactly as typed after the round trip.
    expect(reopened.veils[0].reason).toBe(VEIL_REASON);
  });

  test("a rename is an in-place rewrite: the box and the reason ride along (PROVISIONAL)", () => {
    const veiled = withVeil(theMap());
    const renamed = renameVeil(veiled.veils, veiled.veils[0], "the wet corner, later");
    expect(renamed).toHaveLength(1);
    expect(renamed[0].name).toBe("the wet corner, later");
    expect(veilBox(renamed[0])).toEqual(BOX);
    expect(renamed[0].reason).toBe(VEIL_REASON);
    expect(renameVeil(veiled.veils, veiled.veils[0], "  ")).toEqual(veiled.veils);
    // It reopens byte-exactly under its new name, one line still.
    const text = serializeVeils(renamed);
    expect(text.trim().split(NL)).toHaveLength(1);
    expect(serializeVeils(parseVeils(text).veils)).toBe(text);
  });
});

describe("retire: delete the line, and the words read as before", () => {
  test("only the veil's line goes; every other byte is the map before the veil", () => {
    const before = write(theMap());
    const retired = write(withRetired(withVeil(theMap())));
    // The veil's file is the canonical empty JSONL again, and every other
    // file - every word, the marks, the wire, the set - is byte-identical.
    expect(retired).toEqual(before);
    expect(retired[VEILS_PATH]).toBe(NL);
    // No tombstone, no history, no second line.
    expect(retired[VEILS_PATH].trim()).toBe("");
  });

  test("the words read as before: nothing is covered once the line is gone", () => {
    const retired = withRetired(withVeil(theMap()));
    expect(retired.veils).toEqual([]);
    expect(coveredIn("concept", retired.veils, placed(retired))).toEqual([]);
    // Retiring by name or by slug is the same delete; a missing veil is a
    // quiet no-op (nothing to lose).
    expect(removeVeil([], VEIL_NAME)).toEqual([]);
    expect(removeVeil([], VEIL_KEY)).toEqual([]);
  });
});

/* ========================================================================= *
 * 4. (c) Covered is not settled - at the record level.
 * ========================================================================= */

describe("covered is not settled", () => {
  test("the cover writes NOTHING: only map/veils.jsonl differs", () => {
    const before = write(theMap());
    const after = write(withVeil(theMap()));
    expect(changedPaths(before, after)).toEqual([VEILS_PATH]);
    // Word for word, mark for mark, wire for wire: the same bytes.
    for (const path of Object.keys(before)) {
      if (path === VEILS_PATH) continue;
      expect({ path, same: after[path] === before[path] }).toEqual({ path, same: true });
    }
  });

  test("NO record carries a veil field (the cover is a render-time reading)", () => {
    const files = write(withKeep(withVeil(theMap())));
    for (const [path, text] of Object.entries(files)) {
      if (path === VEILS_PATH) continue;
      // No record's bytes mention a veil at all - not a field, not a flag.
      expect({ path, veil: /veil/i.test(text) }).toEqual({ path, veil: false });
    }
    // The reference frontmatter is exactly name/x/y: no veil, no flag.
    for (const ref of reopen(files).refs) {
      expect(ref.extra).toEqual({});
      const lines = serializeReference(ref).split(NL);
      expect(lines[0]).toBe("---");
      expect(lines[1]).toMatch(/^name: /);
      expect(lines[2]).toMatch(/^x: \d+$/);
      expect(lines[3]).toMatch(/^y: \d+$/);
      expect(lines[4]).toBe("---");
      expect(serializeReference(ref)).not.toMatch(/veil|covered|settled/i);
    }
    // The record modules never grow a veil field, and the veil module imports
    // no record family: covered can never be written into one.
    for (const module of [
      "map/refs.ts",
      "map/distances.ts",
      "map/marks.ts",
      "map/links.ts",
      "map/loops.ts",
      "map/assumptions.ts",
      "map/pointers.ts",
      "map/quantities.ts",
      "map/model.ts",
      "map/shelf.ts",
    ]) {
      expect({ module, veil: sourceOf(module).toLowerCase().includes("veil") }).toEqual({
        module,
        veil: false,
      });
    }
    const imports = VEILS_SRC.slice(0, VEILS_SRC.indexOf("/**"));
    expect(imports).toContain("../lib/fs");
    expect(imports).toContain("../lib/serialize");
    for (const record of ["marks", "model", "refs", "loops", "links"]) {
      expect({ record, imported: imports.includes(record) }).toEqual({
        record,
        imported: false,
      });
    }
  });

  test("the covered word's mark and the marked wire survive byte-exactly", () => {
    const before = write(theMap());
    const after = write(withVeil(theMap()));
    expect(after[MARKS_PATH]).toBe(before[MARKS_PATH]);
    expect(after[DISTANCES_PATH]).toBe(before[DISTANCES_PATH]);
    const reopened = reopen(after);
    // The tentative word is still tentative: its open mark stands.
    expect(hasMark(reopened.marks, "open", word("soil"))).toBe(true);
    // The wire is still marked (the distance's own line unchanged).
    expect(hasMark(reopened.marks, "open", wire("rain", "soil", "waters"))).toBe(true);
    // The wire is never a word and never enters the region test.
    expect(reopened.distances).toEqual([
      { from: "rain", to: "soil", word: "waters", extra: {} },
    ]);
  });

  test("the cover is DERIVED: moving a covered word changes the cover, never the veil", () => {
    const veiled = withVeil(theMap());
    const files = write(veiled);
    const moved: Journey = {
      ...veiled,
      refs: veiled.refs.map((ref) =>
        ref.slug === "soil" ? { ...ref, x: 900, y: 900 } : ref,
      ),
    };
    const after = write(moved);
    // The veil's line is untouched by the move; only the word's file changed.
    expect(after[VEILS_PATH]).toBe(files[VEILS_PATH]);
    expect(changedPaths(files, after)).toEqual([referencePath(WS, "soil")]);
    // And the cover reads from the new position: only rain remains covered.
    expect(coveredIn("concept", moved.veils, placed(moved))).toEqual(["rain"]);
  });

  test("covered + out-of-set keeps the ONE wash (pure CSS-rule scans)", () => {
    const veiled = withVeil(theMap());
    // The tentative word is out of play as well as covered: two readings.
    expect(outOfPlay(veiled.model, null, "soil")).toBe(true);
    expect(coveredIn("concept", veiled.veils, placed(veiled))).toContain("soil");

    // The cover's own class carries VISIBILITY only.
    const cover = rule(".word.veil-covered");
    expect(cover).toContain("visibility: hidden");
    for (const quiet of [
      "opacity",
      "filter",
      "color",
      "text-decoration",
      "background",
      "font-style",
      "text-shadow",
    ]) {
      expect({ quiet, found: cover.includes(quiet) }).toEqual({ quiet, found: false });
    }
    // The out-of-set wash is exactly ONE base rule, and it is the pre-existing
    // wash (0.42), not a veil's.
    expect(CSS.match(/^\.word\.out-of-set \{/gm) ?? []).toHaveLength(1);
    expect(rule(".word.out-of-set")).toContain("opacity: 0.42");
    // No combined cover x wash SELECTOR exists: the cover adds no second quiet
    // (comments mention both words; a selector would join them on one line).
    const combined = [
      ...CSS.matchAll(
        /^[^{}\n]*(?:veil-covered[^{}\n]*out-of-set|out-of-set[^{}\n]*veil-covered)[^{}\n]*\{/gm,
      ),
    ].map((match) => match[0]);
    expect(combined).toEqual([]);
    // The mark's own quiet is its own rule, and the cover never touches it.
    expect(rule(".word.open .word-name")).toContain("text-decoration: underline dashed");
    expect(rule(".word.open .word-name")).toContain("font-style: italic");
    // The word's classes are computed from separate readings.
    expect(WORD).toContain('outOfSet ? " out-of-set" : ""');
    expect(WORD).toContain('covered ? " veil-covered" : ""');
    // The app computes the wash from the playing set alone.
    expect(APP).toContain("outOfPlay(model, selectorOpen ? selectorDraft : null, word.slug)");
    expect(APP).toContain("outOfSet={isOutOfSet(word)}");
    // A marked wire stays dashed: the wire's rule is its own.
    expect(rule(".distance-line.open")).toContain("border-top-style: dashed");
    // The lift (the opened veil's reading) changes visibility and pressability
    // only - never a second quiet - and only on the covered word.
    const lift = rule(".word.veil-covered.veil-lifted");
    expect(lift).toContain("visibility: visible");
    expect(lift).toContain("pointer-events: none");
    for (const quiet of ["opacity", "filter", "color", "background", "font-style"]) {
      expect({ quiet, found: lift.includes(quiet) }).toEqual({ quiet, found: false });
    }
    expect(CSS.indexOf(".word.veil-covered {")).toBeLessThan(
      CSS.indexOf(".word.veil-covered.veil-lifted {"),
    );
    expect(CSS).not.toContain(".distance-line.veil-lifted");
    expect(CSS).not.toContain(".link.veil-lifted");
  });
});

/* ========================================================================= *
 * 5. (d) The surfacing negative: nothing reads a veil unasked.
 * ========================================================================= */

describe("nothing surfaces a veil unasked", () => {
  test("the sheet is PRESENCE only: no name, no reason, no count", () => {
    expect(SHEET).toContain('aria-label="a veil — this area is set aside"');
    expect(SHEET).not.toContain("veil.name}");
    expect(SHEET).not.toContain("veil.reason");
    // The sheet's only text child is the retire glyph; the fill is the signal.
    expect(SHEET).toContain('className="veil-sheet"');
    expect(rule(".veil-sheet")).toContain("z-index: 1");
    expect(rule(".word")).toContain("z-index: 2");
    // Its press hint says what the press DOES, never the veil's content.
    expect(SHEET).toContain('title="press to look under"');
    // The cover and the card are CONTENT: a press on either is never a plane
    // press, so opening a veil can never pan the plane or create a word.
    for (const name of ["veil-sheet", "veil-lookunder"] as const) {
      expect(CONTENT_CLASSES).toContain(name);
    }
    // The one place a sheet may say something is the opened card.
    expect(SHEET).toContain("onOpen");
    expect(CARD).toContain("{veil.name}");
    expect(CARD).toContain("{veil.reason}");
  });

  test("the opened look-under is the ONLY reading (one call site, one render)", () => {
    const renderers = SOURCES.filter((entry) => entry.path.endsWith(".tsx"));
    const named = renderers.filter((entry) => entry.source.includes("veil.name"));
    const reasoned = renderers.filter((entry) => entry.source.includes("veil.reason"));
    expect(named.map((entry) => entry.path)).toEqual(["canvas/VeilLookUnder.tsx"]);
    expect(reasoned.map((entry) => entry.path)).toEqual(["canvas/VeilLookUnder.tsx"]);
    // The card is the person's opening: the sheet's press is the only door.
    expect(APP.match(/openLookUnder\(/g) ?? []).toHaveLength(1);
    expect(APP).toContain("onOpen={() => openLookUnder(veil)}");
    const open = callback(APP, "openLookUnder");
    expect(open).toContain("if (!veilLive(level) || isGestureArmed(gestureMode)) return;");
    expect(open).toContain("setLookUnderKey(veilKey(veil));");
    // One key, and only the open (or a rename) SETS it; every other path
    // clears it. Nothing else can make the card appear.
    const keySetters = APP.match(/setLookUnderKey\([^;]*;/g) ?? [];
    expect(keySetters.length).toBeGreaterThan(0);
    for (const setter of keySetters) {
      const allowed =
        setter === "setLookUnderKey(null);" ||
        setter.startsWith("setLookUnderKey(veilKey(");
      expect({ setter, allowed }).toEqual({ setter, allowed: true });
    }
    const sets = keySetters.filter(
      (setter) => setter !== "setLookUnderKey(null);",
    );
    expect(sets).toEqual([
      "setLookUnderKey(veilKey(veil));",
      "setLookUnderKey(veilKey(renamed));",
    ]);
    // Three clears: the switch path, the close, and the retired-veil cleanup.
    const clears = keySetters.filter(
      (setter) => setter === "setLookUnderKey(null);",
    );
    expect(clears).toHaveLength(3);
    // The card renders behind the same level reading as the sheet.
    expect(APP).toContain("{lookUnderLive(level) && lookUnderVeil !== null && (");
    // Nothing opens it from an effect: the one effect about it CLOSES a
    // retired veil's card (the sheet's press is the only opening).
    const cleanup = APP.slice(
      APP.indexOf("// A veil retired while its look-under is open"),
    );
    expect(cleanup).toContain("setLookUnderKey(null);");
    expect(cleanup.slice(0, 500)).not.toContain("setLookUnderKey(veilKey");
    // The card is read-only: the reason shown verbatim, no record writer.
    for (const writer of ["nameVeil", "renameVeil", "removeVeil", "saveVeils"]) {
      expect({ writer, found: CARD.includes(writer) }).toEqual({ writer, found: false });
    }
    expect(CARD).toContain("{veil.reason}");
    expect(rule(".veil-lookunder-reason")).toContain("white-space: pre-wrap");
  });

  test("the pull is the ONLY veil accessor, and it lives in pull/ (Epic 13 story 1)", () => {
    // (i) Epic 9 reserved the veil's presence/name/location reading for the
    // future pull and asserted its absence. Epic 13 story 1 BUILT it: the pull
    // module's projection is now the one sanctioned coupling of a veil to a
    // presence reading, and it lives under pull/. Every OTHER export still may
    // not couple a veil to a pull vocabulary (a presence, a surface, a summary,
    // a description, a hint, a prompt or an answer).
    const pullish =
      /presence|surface|summar|describ|pull|ambient|hint|report|answer|suggest|prompt|count|score|tally|badge|title/i;
    const allExports = SOURCES.flatMap((entry) => exportedNames(entry.source));
    expect(allExports.length).toBeGreaterThan(100);
    const veilCouplings = SOURCES.flatMap((entry) =>
      exportedNames(entry.source)
        .filter((name) => /veil/i.test(name) && pullish.test(name))
        .map((name) => ({ path: entry.path, name })),
    );
    // The reservation exists now — and it is the pull's own projection shape.
    expect(veilCouplings.map((entry) => entry.name)).toContain("PullVeilSite");
    for (const coupling of veilCouplings) {
      expect({ ...coupling, inPull: coupling.path.startsWith("pull/") }).toEqual({
        ...coupling,
        inPull: true,
      });
    }
    for (const entry of SOURCES.filter((item) => !item.path.startsWith("pull/"))) {
      for (const name of exportedNames(entry.source)) {
        const coupled = /veil/i.test(name) && pullish.test(name);
        expect({ path: entry.path, name, coupled }).toEqual({
          path: entry.path,
          name,
          coupled: false,
        });
      }
    }
    for (const forbidden of [
      "veilPresence",
      "presenceOfVeil",
      "veilsAt",
      "describeVeil",
      "veilSummary",
      "pullVeil",
      "surfaceVeil",
      "askAboutVeil",
      "veilWhen",
      "whenVeil",
    ]) {
      expect({ forbidden, found: allExports.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
    // (ii) The in-band presence table never grew a veil cue: presence is a
    // word's (the reach, the diamond), never the cover's.
    expect(PRESENCE.toLowerCase()).not.toContain("veil");
    // (iii) No notices/prompt path names a veil: the ONLY person-facing veil
    // text outside the opened card is the malformed-line hygiene line, which
    // names the FILE (the family posture), never a veil's name or reason.
    expect(NOTICES).not.toContain("veil.name");
    expect(NOTICES).not.toContain("veil.reason");
    expect(NOTICE_FAMILY_GAME.veils).toBe("all");
    expect(APP).toContain("unreadable line in map/veils.jsonl");
    expect(APP).not.toContain("veil.reason");
    // (iv) The cover's region helpers are the render's reading, not a pull:
    // the app reads a veil by the person's own key (findVeil) and computes the
    // covered set for the render - nothing asks "should this veil surface?".
    expect(APP).toContain("findVeil(veils, lookUnderKey)");
    expect(APP).toContain("coveredWordSlugs(veils, selectorWords)");
    expect(APP).not.toContain("topVeilOf");
    expect(APP).not.toContain("veilsCoveringWord");
    // (v) The reason is never read, trimmed, parsed, searched or restated.
    const reasonRead =
      /veil\.reason\.(trim|split|replace|match|search|toLowerCase|includes)/;
    for (const entry of SOURCES) {
      expect({ path: entry.path, reasonRead: reasonRead.test(entry.source) }).toEqual({
        path: entry.path,
        reasonRead: false,
      });
    }
  });
});

/* ========================================================================= *
 * 6. (e) The ground gate: no sheet and no look-under at ground.
 * ========================================================================= */

describe("the ground gate: the game switch is the look-under", () => {
  test("ONE level reading: the sheet and the look-under live in Levels 1-2 only", () => {
    expect(VEIL_LEVELS).toEqual(["concept", "dynamics"]);
    for (const level of LEVELS) {
      const live = level === "concept" || level === "dynamics";
      expect({
        level,
        live: veilLive(level),
        same: lookUnderLive(level) === veilLive(level),
      }).toEqual({ level, live, same: true });
    }
    expect(veilLive("ground")).toBe(false);
    expect(VEIL_RULES).toContain("export function veilLive(level: Level): boolean");
    // The components never decide the level: ONE rule, in veilRules.
    expect(SHEET).not.toContain('"ground"');
    expect(SHEET).not.toContain("veilLive");
    expect(CARD).not.toContain("ground");
    expect(CARD).not.toContain("veilLive");
    expect(CARD).not.toContain("lookUnderLive");
  });

  test("the render is gated: no sheet, no look-under, no covered set at ground", () => {
    expect(APP).toContain("{veilLive(level) &&");
    expect(APP.indexOf("<VeilSheet")).toBeGreaterThan(APP.indexOf("{veilLive(level) &&"));
    expect(APP).toContain("? coveredWordSlugs(veils, selectorWords)");
    expect(APP).toContain(": new Set<string>()");
    // DEPRECATED (hidden 2026-11-16 per separate-maps review): converted from
    // "concept and dynamics both read the cover" — the content rule blanks the
    // dynamics map too, so only concept reads it while the flag stands.
    expect(coveredIn("concept", withVeil(theMap()).veils, placed(theMap()))).toEqual([
      "rain",
      "soil",
    ]);
    for (const level of ["dynamics", "ground"] as const) {
      expect(coveredIn(level, withVeil(theMap()).veils, placed(theMap()))).toEqual([]);
    }
    // The door is absent at ground too: no veil is coined where none shows.
    expect(LEVEL_CONTROL).toContain("{veilLive(level) && (");
    expect(LEVEL_CONTROL).toContain("onDrawVeil");
    expect(USE_MAP).toContain("if (!veilLive(level)) return;");
  });

  test("the ground gate is a RENDER rule: the veil's record survives a ground visit", () => {
    const files = write(withVeil(theMap()));
    // The game switch writes the resume hint and touches no record.
    const ground = { ...files, [YML]: withLevel(files[YML], "ground") };
    expect(levelOfText(ground[YML])).toBe("ground");
    expect(changedPaths(files, ground)).toEqual([YML]);
    // The record layer still reads the veil at ground (nothing is deleted).
    const parsed = parseVeils(ground[VEILS_PATH]);
    expect(parsed.veils).toHaveLength(1);
    expect(veilBox(parsed.veils[0])).toEqual(BOX);
    // The record module never takes a level: the gate cannot reach the file.
    expect(VEILS_SRC).not.toContain("workspace/level");
    expect(VEILS_SRC).not.toContain("veilLive");
    // And back at dynamics the RECORD reads unchanged — the blank map hides the
    // sheet, never the veil (DEPRECATED, hidden 2026-11-16 per separate-maps
    // review: converted from "the sheet's reading returns at dynamics", which
    // the content rule now blanks; the record itself is asserted whole).
    const back = { ...ground, [YML]: withLevel(ground[YML], "dynamics") };
    expect(levelOfText(back[YML])).toBe("dynamics");
    expect(coveredIn("dynamics", parsed.veils, placed(theMap()))).toEqual([]);
    expect(coveredIn("concept", parsed.veils, placed(theMap()))).toEqual([
      "rain",
      "soil",
    ]);
    // A level switch closes the look-under through the one switch path.
    expect(callback(APP, "cancelPendingGestures")).toContain("setLookUnderKey(null);");
    expect(callback(APP, "switchLevel")).toContain("cancelPendingGestures()");
  });
});

/* ========================================================================= *
 * 7. (f) The promotion clause: the keep is ordinary record writes.
 * ========================================================================= */

describe("the promotion clause: the keep is already built", () => {
  test("at ground, a word and its memory: an ordinary reference write", () => {
    const kept = withKeep(theMap());
    const files = write(kept);
    const tap = kept.refs.find((ref) => ref.slug === "tap-water")!;
    expect(tap.name).toBe("tap water");
    expect(tap.x).toBe(KEEP_AT.x);
    expect(tap.y).toBe(KEEP_AT.y);
    // The detail kept is the memory, byte-verbatim, at the spot.
    expect(files[referencePath(WS, "tap-water")]).toBe(
      referenceBytes("tap water", KEEP_AT.x, KEEP_AT.y, TAP_BODY),
    );
    // It is the refs module's own writer: no new record, no new file shape.
    expect(sourceOf("map/refs.ts")).toContain("export async function saveReference");
    const writeRef = sourceOf("map/refs.ts");
    expect(writeRef).toContain("writeTextFile(referencePath(workspacePath, slug)");
    expect(writeRef).not.toMatch(/veil|promot/i);
  });

  test("at ground, a pointer: an ordinary reach line on the coined word", () => {
    const files = write(withKeep(theMap()));
    expect(files[POINTERS_PATH]).toBe('{"on":"tap-water","path":"notes/garden.md"}' + NL);
    // The form is the person's authored pick, and the line's key is its own.
    expect(sourceOf("map/pointers.ts")).toContain("export function addPointer");
    expect(files[POINTERS_PATH]).not.toMatch(/veil|promot/i);
  });

  test("at dynamics, a quantity or assumption line: authored by hand", () => {
    const files = write(withKeep(theMap()));
    // A number glimpsed in the file becomes a line the person writes; the
    // number they could NOT read stays an UNKNOWN line (no amount), never 0.
    expect(files[QUANTITIES_PATH]).toBe(
      ['{"amount":4,"on":"rain"}', '{"from":"rain","to":"soil"}', ""].join(NL),
    );
    // A claim is a line too: the person's text on the target.
    expect(files[ASSUMPTIONS_PATH]).toBe(
      '{"on":"rain","text":"the tap runs before the rain"}' + NL,
    );
    // Both are the existing primitives, never a promotion record.
    expect(sourceOf("map/quantities.ts")).toContain("export function setQuantity");
    expect(sourceOf("map/assumptions.ts")).toContain("export function addAssumption");
  });

  test("no promotion machinery: the window is write-free and no record is new", () => {
    const files = write(withKeep(withVeil(theMap())));
    // The peek (the window) writes nothing: it reports a read and closes.
    for (const [path, source] of [
      ["canvas/outward.ts", OUTWARD],
      ["canvas/outwardRules.ts", OUTWARD_RULES],
    ] as const) {
      const fs = source.includes("../lib/fs");
      const write = source.includes("writeTextFile");
      expect({ path, fs, write }).toEqual({ path, fs: false, write: false });
    }
    // No promotion module, writer or export exists anywhere in the app.
    for (const entry of SOURCES) {
      expect({ path: entry.path, promotion: /promot/i.test(entry.path) }).toEqual({
        path: entry.path,
        promotion: false,
      });
      for (const name of exportedNames(entry.source)) {
        expect({ path: entry.path, name, promotion: /promot/i.test(name) }).toEqual({
          path: entry.path,
          name,
          promotion: false,
        });
      }
    }
    // The keep adds files of the existing families, never a new record family.
    const inventory = Object.keys(files).sort();
    expect(inventory).toEqual(
      [
        YML,
        VEILS_PATH,
        MARKS_PATH,
        DISTANCES_PATH,
        MODEL_PATH,
        POINTERS_PATH,
        QUANTITIES_PATH,
        ASSUMPTIONS_PATH,
        referencePath(WS, "rain"),
        referencePath(WS, "soil"),
        referencePath(WS, "tap-water"),
        referencePath(WS, QUESTION_SLUG),
      ].sort(),
    );
    // No scaffold file is a promotion record either.
    for (const file of workspaceScaffold(WS, "garden")) {
      expect({ path: file.path, promotion: /promot/i.test(file.path) }).toEqual({
        path: file.path,
        promotion: false,
      });
    }
  });
});

/* ========================================================================= *
 * 8. (g) The closing note: nothing is delegated.
 * ========================================================================= */

describe("the closing note: nothing is delegated", () => {
  test("no delegated carrier exists: no file, no export, no record field", () => {
    // A path or an export that STARTS a carrier family ("delegat...",
    // "stance...", "steward..."): nothing in the app is one. ("stance" alone
    // would match DistanceWire's tail, so it is anchored.)
    const carrierPath = (path: string): boolean =>
      /(^|\/)(delegat|steward)/i.test(path) || /(^|\/)stance/i.test(path);
    const carrierName = (name: string): boolean =>
      /^(delegat|steward)/i.test(name) || /^stance/i.test(name);
    for (const entry of SOURCES) {
      expect({ path: entry.path, carrier: carrierPath(entry.path) }).toEqual({
        path: entry.path,
        carrier: false,
      });
      for (const name of exportedNames(entry.source)) {
        expect({ path: entry.path, name, carrier: carrierName(name) }).toEqual({
          path: entry.path,
          name,
          carrier: false,
        });
      }
    }
    for (const file of workspaceScaffold(WS, "garden")) {
      expect({ path: file.path, carrier: carrierPath(file.path) }).toEqual({
        path: file.path,
        carrier: false,
      });
    }
    // No record carries a delegated field (the journey's bytes are the proof).
    const files = write(withKeep(withVeil(theMap())));
    for (const [path, text] of Object.entries(files)) {
      expect({ path, delegated: /delegat|\bstance|steward/i.test(text) }).toEqual({
        path,
        delegated: false,
      });
    }
    // The taxonomy never became a kind: the mark's one flavor is "open".
    expect(sourceOf("map/marks.ts")).not.toMatch(/"unknown"|"bracketed"|"delegated"/);
    expect(sourceOf("map/marks.ts")).toContain("anonymous");
    // No assistant surface exists except the ONE named turn seam (the agent
    // era arrived with Epic 15: `turn/proposal.ts` reads an answer's block and
    // hands it to the existing ghost intake; no other path may claim it).
    for (const entry of SOURCES) {
      expect({
        path: entry.path,
        assistant: /assistant|proposal/i.test(entry.path),
      }).toEqual({
        path: entry.path,
        assistant: entry.path === "turn/proposal.ts",
      });
    }
    // The orientation still states the value (a doc line, not a carrier).
    expect(agentsMd("garden")).toContain(
      "Ignorance is content: unknown, bracketed, and delegated material stays visible.",
    );
  });
});

/* ========================================================================= *
 * 9. Quit, reopen, retire: the check end to end.
 * ========================================================================= */

describe("the whole check, in the check's order", () => {
  test("unknowns, veil, ground, keep, quit/reopen, retire - every byte as left", () => {
    // The map before the check, and its bytes as the reference point.
    const start = theMap();
    const startFiles = write(start);
    const questionBytes = startFiles[referencePath(WS, QUESTION_SLUG)];
    const marksBytes = startFiles[MARKS_PATH];

    // (a) The unknowns stay unknown: a reopen changes no byte.
    expect(write(reopen(startFiles))).toEqual(startFiles);

    // (b) The veil: one line, the box/name/reason; a read writes nothing.
    const veiled = withVeil(start);
    const veiledFiles = write(veiled);
    const afterRead = reopen(veiledFiles);
    expect(write(afterRead)).toEqual(veiledFiles);
    expect(afterRead.veils).toEqual(veiled.veils);
    expect(veiledFiles[VEILS_PATH]).toBe(VEIL_LINE + NL);

    // (c) Covered is not settled: the covered word's mark and the wire's mark.
    expect(veiledFiles[MARKS_PATH]).toBe(marksBytes);
    expect(hasMark(afterRead.marks, "open", word("soil"))).toBe(true);
    expect(hasMark(afterRead.marks, "open", wire("rain", "soil", "waters"))).toBe(true);

    // (e) Ground: the game switch, a render rule. The record is untouched.
    const ground = { ...veiledFiles, [YML]: withLevel(veiledFiles[YML], "ground") };
    expect(changedPaths(veiledFiles, ground)).toEqual([YML]);
    expect(coveredIn("ground", afterRead.veils, placed(afterRead))).toEqual([]);
    expect(parseVeils(ground[VEILS_PATH]).veils).toHaveLength(1);
    // At ground the keep happens, at the spot: a word, its memory, a pointer.
    const kept = withKeep(veiled);
    const keptFiles = write(kept);
    expect(keptFiles[referencePath(WS, "tap-water")]).toBe(
      referenceBytes("tap water", KEEP_AT.x, KEEP_AT.y, TAP_BODY),
    );
    expect(keptFiles[POINTERS_PATH]).toBe(
      '{"on":"tap-water","path":"notes/garden.md"}' + NL,
    );
    // (f) At dynamics: the number is authored, or left unknown.
    expect(keptFiles[QUANTITIES_PATH]).toBe(
      ['{"amount":4,"on":"rain"}', '{"from":"rain","to":"soil"}', ""].join(NL),
    );

    // Quit, reopen: every record as left, byte for byte.
    const end = reopen(keptFiles);
    expect(write(end)).toEqual(keptFiles);
    expect(end.refs.map((ref) => ref.slug).sort()).toEqual([
      "rain",
      "soil",
      "tap-water",
      QUESTION_SLUG,
    ]);
    expect(end.pointers).toEqual([
      { on: "tap-water", form: "path", value: "notes/garden.md", extra: {} },
    ]);
    expect(end.assumptions).toEqual([
      {
        text: "the tap runs before the rain",
        target: { type: "word", slug: "rain" },
        extra: {},
      },
    ]);
    // The unknown legs are STILL exactly as left, after everything.
    expect(keptFiles[referencePath(WS, QUESTION_SLUG)]).toBe(questionBytes);
    expect(keptFiles[MARKS_PATH]).toBe(marksBytes);

    // The veil retires only when the person deletes it.
    const retired = write(withRetired(end));
    expect(retired[VEILS_PATH]).toBe(NL);
    expect(changedPaths(keptFiles, retired)).toEqual([VEILS_PATH]);
    // And retiring it leaves the words reading as before: the veil-only map,
    // coined and retired, is byte-for-byte the map before the veil.
    expect(write(withRetired(reopen(write(withVeil(start)))))).toEqual(startFiles);
  });
});

/* ========================================================================= *
 * 10. The negative space: no counts, and veils never enter scenario folders.
 * ========================================================================= */

describe("the negative space", () => {
  test("veils never enter scenario folders (a committed-model record)", () => {
    const branch = scenarioDir(WS, "evening-walk");
    expect(branch.startsWith(scenariosDir(WS))).toBe(true);
    // The veil's path never moves with the branch: map/ always.
    expect(veilsPath(WS)).toBe(MAP + "/veils.jsonl");
    expect(VEILS_PATH.startsWith(MAP)).toBe(true);
    expect(recordsDirOf(WS, "evening-walk")).toBe(branch);
    expect(VEILS_PATH.startsWith(branch)).toBe(false);
    // A branch carries exactly the three model records, never a veil.
    expect(Object.keys(RECORD_FILE).sort()).toEqual(["links", "model", "quantities"]);
    expect(RECORDS).toContain("map/veils.jsonl");
    expect(RECORDS).toContain("never copied into a branch");
    expect(RECORDS).not.toContain("veils: ");
    // The veil module never asks the branch arithmetic, and the map's batches
    // have no veil writer at all: nothing references a veil.
    expect(VEILS_SRC).not.toContain("recordsDirOf");
    expect(VEILS_SRC).not.toContain("scenarioDir(");
    expect(VEILS_SRC).not.toContain("scenariosDir");
    expect(PATCHES.toLowerCase()).not.toContain("veil");
    // The scaffold says the rule out loud.
    expect(agentsMd("garden")).toContain(
      "A veil is a committed-model record: a branch never copies it",
    );
    // The journey's files never put a veil in a scenario folder.
    for (const path of Object.keys(write(withKeep(withVeil(theMap()))))) {
      expect({ path, branch: path.startsWith(scenariosDir(WS)) }).toEqual({
        path,
        branch: false,
      });
    }
  });
});

/* ========================================================================= *
 * 11. The scaffold's veil lines and the retired phrases.
 * ========================================================================= */

describe("the scaffold: the veil record and its orientation (write-once)", () => {
  const md = agentsMd("garden");

  test("the veil record is named with its shape and its level rule", () => {
    expect(md).toContain("one line per named veil");
    expect(md).toContain("map/veils.jsonl");
    expect(md).toContain("## The veil (Levels 1–2)");
    expect(md).toContain("at ground the sheet is absent (the game");
    expect(md).toContain("no veil is coined there either");
    expect(md).toContain("CENTRE of its word box is inside a veil's box");
    expect(md).toContain("no record carries a veil field");
    expect(md).toContain("not settled");
    expect(md).toContain("Retiring a veil deletes the line");
    // The MACHINE FILES list names it with the other canonical records.
    const machineFiles = md.slice(md.indexOf("## Machine files"));
    expect(machineFiles).toContain("map/veils.jsonl");
    expect(machineFiles).toContain("map/pointers.jsonl");
  });

  test("the surfacing rule is SCOPED, never a blanket: on its own", () => {
    // The blanket no-surfacing draft was retired (it contradicted the glossary
    // and amputated the future pull). The rule is "never on its own".
    expect(md).toContain(
      "The veil never surfaces on its own; it is read only when the person opens it",
    );
    // The claim is about the VEIL's surfacing, so the scan is the veil's own
    // sources: the record, the rules, the two card components and the scaffold.
    for (const path of [
      "map/veils.ts",
      "canvas/veilRules.ts",
      "canvas/VeilSheet.tsx",
      "canvas/VeilLookUnder.tsx",
      "lib/serialize.ts",
    ]) {
      const source = sourceOf(path);
      const surfaces = source.match(/never surfaces/g) ?? [];
      const onItsOwn = source.match(/never surfaces on its own/g) ?? [];
      expect({ path, surfaces: surfaces.length, onItsOwn: onItsOwn.length }).toEqual({
        path,
        surfaces: onItsOwn.length,
        onItsOwn: onItsOwn.length,
      });
      expect({ path, blanket: /no surfacing|never surface(?!s)/.test(source) }).toEqual({
        path,
        blanket: false,
      });
    }
  });

  test("the veil is its OWN record, not a mark's: the retired seam stays retired", () => {
    // ADR-0009's seam resolved as a named record; marks stay anonymous.
    expect(VEILS_SRC).toContain("NAMED COVER");
    expect(sourceOf("map/marks.ts")).not.toMatch(/veil/i);
    expect(serializeMarkLine(open(word("rain")))).toBe('{"kind":"open","on":"rain"}');
    // The taxonomy never became a kind enum (the dissolve).
    for (const entry of SOURCES) {
      const kindEnum = /kind: "(unknown|bracketed|delegated)"/.test(entry.source);
      expect({ path: entry.path, kindEnum }).toEqual({
        path: entry.path,
        kindEnum: false,
      });
    }
    // Bracketed is neither the shelf nor the out-of-set wash (two independent
    // things): the shelf keeps its own reading and the cover adds no wash.
    expect(sourceOf("map/shelf.ts").toLowerCase()).not.toContain("veil");
    expect(md).not.toMatch(/bracketed[^\n]*shelf/i);
    expect(rule(".word.veil-covered")).not.toContain("opacity");
  });

  test("the scaffold offers the veil record as an empty canonical JSONL, once", () => {
    const offered = workspaceScaffold(WS, "garden");
    const veilFile = offered.find((file) => file.path === VEILS_PATH)!;
    expect(veilFile).toBeDefined();
    expect(veilFile.content).toBe(NL);
    // Write-once: an existing veil file is never offered again, so a hand
    // edit (and an older workspace's own text) survives the scaffold.
    const existing = new Set([VEILS_PATH, YML]);
    const writes = scaffoldWrites(offered, existing);
    expect(writes.map((file) => file.path)).toEqual([WS + "/AGENTS.md"]);
    // A NEW workspace gets it (the record exists from day one).
    expect(scaffoldWrites(offered, new Set()).map((file) => file.path)).toEqual([
      YML,
      WS + "/AGENTS.md",
      VEILS_PATH,
    ]);
    // And the veil record is in the app's machine-file inventory.
    expect(SERIALIZE).toContain("canonicalJsonlLines([])");
    expect(md).toContain("map/veils.jsonl");
  });
});
