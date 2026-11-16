import { describe, expect, test } from "bun:test";
import {
  parseAssumptions,
  serializeAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "../src/map/assumptions";
import {
  coinDistance,
  parseDistances,
  serializeDistances,
  type Distance,
} from "../src/map/distances";
import { parseLinks, serializeLinks, type Link } from "../src/map/links";
import {
  loopSlug,
  parseLoops,
  serializeLoops,
  type Loop,
} from "../src/map/loops";
import {
  hasMark,
  markTargetKey,
  parseMarks,
  serializeMarks,
  withMark,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import { parseModel, serializeModel, type PlayingSet } from "../src/map/model";
import {
  addPointer,
  convergePointerEdit,
  findOrphanPointers,
  findPointers,
  parsePointers,
  pointerKeyOf,
  removePointerAt,
  serializePointers,
  type Pointer,
} from "../src/map/pointers";
import {
  dropAssumptionsTouching,
  dropLoopAssumptions,
  dropMarksTouching,
  dropMembership,
  dropPointerMarksTouching,
  dropPointersTouching,
  dropTouching,
  dropTouchingLinks,
  rewriteAssumptionTargets,
  rewriteEndpoints,
  rewriteLinkEndpoints,
  rewriteLoopPaths,
  rewriteMarkEndpoints,
  rewriteMembership,
  rewritePointerMarkOwners,
  rewritePointerOwners,
} from "../src/map/patches";
import {
  parseReference,
  serializeReference,
  type Reference,
} from "../src/map/refs";
import { parseYamlFields, workspaceYml } from "../src/lib/serialize";
import {
  hasMarkedPointer,
  isPointerMarked,
  markedPointerKeys,
  pointerDraft,
  pointerMarkKey,
} from "../src/canvas/pointerRules";
import {
  CANNOT_READ,
  PEEK_TOOLTIP,
  resolveTarget,
  schemeNotice,
} from "../src/canvas/outwardRules";
import {
  LEVELS,
  RENDER_MAP,
  levelOf,
  levelOfText,
  withLevel,
  type Level,
} from "../src/workspace/level";
import {
  renderedMapContent,
  showsMapContent,
} from "../src/canvas/mapContentRules";

/**
 * Epic 5's plain-language check, automated at the record layer (story 3).
 *
 * The human half — the feel of the reach handle, the chooser, the window's
 * glimpse, the native quit/reopen and the real outward open — is the queued
 * real-window pass. This file walks the same journey through the pure modules
 * the app uses and through the files' bytes only, no DOM:
 *
 *   enter the ground game (level = ground); keep a pointer through the authored
 *   form pick (never sniffed), edit it in place, remove one, mark one; keep an
 *   observation (coin a word + its memory, with NO membership write); keep a
 *   relation finding the corrected way (coin + memory + a distance placing it);
 *   meet a memory-only reference (no pointer, no window); rename a word and
 *   watch every `on`, mark key and membership follow byte-exactly; remove a
 *   word and watch its pointers and marks die while the bare-spot records stay;
 *   let an `at` reach dangle honestly; quit/reopen byte-exactly over EVERY
 *   record. No counter, verdict or window record is ever written; a garbage
 *   `level` reads as concept.
 *
 * World B is asserted where it lives: the form is the person's pick, target
 * strings are stored verbatim and never interpreted, nothing counts.
 */

const REFS = "map/references/";
const WS = "/home/maps/reach";
const DANGLE = "/nonexistent/attentioneer/machine-only.md";

type Files = Record<string, string>;

interface Malformed {
  model: string | null;
  distances: string[];
  links: string[];
  loops: string[];
  assumptions: string[];
  marks: string[];
  pointers: string[];
}

interface Journey {
  refs: Reference[];
  level: Level;
  model: PlayingSet | null;
  distances: Distance[];
  links: Link[];
  loops: Loop[];
  assumptions: Assumption[];
  marks: Mark[];
  pointers: Pointer[];
  /** Hand-edited bytes the app cannot read — carried verbatim, never dropped. */
  malformed: Malformed;
}

const pointerTarget = (pointer: Pointer): MarkTarget => ({
  type: "pointer",
  on: pointer.on,
  form: pointer.form,
  value: pointer.value,
});

const openPointerMark = (pointer: Pointer): Mark => ({
  kind: "open",
  target: pointerTarget(pointer),
  extra: {},
});

const openSpot = (x: number, y: number): Mark => ({
  kind: "open",
  target: { type: "spot", x, y },
  extra: {},
});

const openWord = (slug: string): Mark => ({
  kind: "open",
  target: { type: "word", slug },
  extra: {},
});

function reference(
  name: string,
  slug: string,
  x: number,
  y: number,
  body = "",
): Reference {
  return { id: slug, slug, name, x, y, body, extra: {} };
}

function play(words: string[]): PlayingSet {
  return { words, extra: {} };
}

function claim(text: string, target: AssumptionTarget): Assumption {
  return { text, target, extra: {} };
}

function namedLoop(name: string, path: string[]): Loop {
  return { name, path, extra: {} };
}

function lines(...entries: string[]): string {
  return entries.join("\n") + "\n";
}

function modelJson(words: string[]): string {
  return (
    '{\n  "words": [\n' +
    words.map((word) => '    "' + word + '"').join(",\n") +
    "\n  ]\n}\n"
  );
}

function file(files: Files, path: string): string {
  const text = files[path];
  if (text === undefined) throw new Error("the journey must write " + path);
  return text;
}

function wordsOf(journey: Journey): Set<string> {
  const slugs = new Set<string>();
  for (const ref of journey.refs) {
    if (ref.slug !== null) slugs.add(ref.slug);
  }
  return slugs;
}

function pointerOn(
  journey: Journey,
  on: string,
  form: Pointer["form"],
): Pointer {
  const pointer = journey.pointers.find(
    (candidate) => candidate.on === on && candidate.form === form,
  );
  if (!pointer) throw new Error("the journey must keep a " + form + " on " + on);
  return pointer;
}

/** Write the journey's memory to the workspace's files (the app's writes). */
function write(journey: Journey): Files {
  const files: Files = {
    "workspace.yml": withLevel(workspaceYml(), journey.level),
    "map/model.json": serializeModel(journey.model, journey.malformed.model),
    "map/distances.jsonl": serializeDistances(
      journey.distances,
      journey.malformed.distances,
    ),
    "map/links.jsonl": serializeLinks(journey.links, journey.malformed.links),
    "map/loops.jsonl": serializeLoops(journey.loops, journey.malformed.loops),
    "map/assumptions.jsonl": serializeAssumptions(
      journey.assumptions,
      journey.malformed.assumptions,
    ),
    "map/marks.jsonl": serializeMarks(journey.marks, journey.malformed.marks),
    "map/pointers.jsonl": serializePointers(
      journey.pointers,
      journey.malformed.pointers,
    ),
  };
  for (const ref of journey.refs) {
    if (ref.slug === null) throw new Error("an uncoined reference cannot be written");
    files[REFS + ref.slug + ".md"] = serializeReference(ref);
  }
  return files;
}

/**
 * Quit and reopen: read every file back and confirm the app's next write is
 * the same bytes. The epic check's "every pointer line and every account reads
 * exactly as left", asserted at the record level.
 */
function reopen(files: Files): Journey {
  const level = levelOfText(files["workspace.yml"]);
  // The key is the resume hint (ADR-0018); re-writing it changes no byte.
  expect(withLevel(files["workspace.yml"], level)).toBe(files["workspace.yml"]);

  const refs: Reference[] = [];
  const paths = Object.keys(files)
    .filter((path) => path.indexOf(REFS) === 0 && path.endsWith(".md"))
    .sort();
  for (const path of paths) {
    const text = files[path];
    const slug = path.slice(REFS.length, -3);
    const parsed = parseReference(slug, slug, text);
    expect(serializeReference(parsed)).toBe(text);
    refs.push(parsed);
  }

  const modelText = files["map/model.json"];
  const parsedModel = parseModel(modelText);
  expect(serializeModel(parsedModel.model, parsedModel.malformed)).toBe(modelText);

  const parsedDistances = parseDistances(files["map/distances.jsonl"]);
  expect(
    serializeDistances(parsedDistances.distances, parsedDistances.malformed),
  ).toBe(files["map/distances.jsonl"]);

  const parsedLinks = parseLinks(files["map/links.jsonl"]);
  expect(serializeLinks(parsedLinks.links, parsedLinks.malformed)).toBe(
    files["map/links.jsonl"],
  );

  const parsedLoops = parseLoops(files["map/loops.jsonl"]);
  expect(serializeLoops(parsedLoops.loops, parsedLoops.malformed)).toBe(
    files["map/loops.jsonl"],
  );

  const parsedAssumptions = parseAssumptions(files["map/assumptions.jsonl"]);
  expect(
    serializeAssumptions(
      parsedAssumptions.assumptions,
      parsedAssumptions.malformed,
    ),
  ).toBe(files["map/assumptions.jsonl"]);

  const parsedMarks = parseMarks(files["map/marks.jsonl"]);
  expect(serializeMarks(parsedMarks.marks, parsedMarks.malformed)).toBe(
    files["map/marks.jsonl"],
  );

  const parsedPointers = parsePointers(files["map/pointers.jsonl"]);
  expect(
    serializePointers(parsedPointers.pointers, parsedPointers.malformed),
  ).toBe(files["map/pointers.jsonl"]);

  return {
    refs,
    level,
    model: parsedModel.model,
    distances: parsedDistances.distances,
    links: parsedLinks.links,
    loops: parsedLoops.loops,
    assumptions: parsedAssumptions.assumptions,
    marks: parsedMarks.marks,
    pointers: parsedPointers.pointers,
    malformed: {
      model: parsedModel.malformed,
      distances: parsedDistances.malformed,
      links: parsedLinks.malformed,
      loops: parsedLoops.malformed,
      assumptions: parsedAssumptions.malformed,
      marks: parsedMarks.malformed,
      pointers: parsedPointers.malformed,
    },
  };
}

/* -------------------------------------------------------------------------
 * The journey's stages: each is a pure step over the records, in the order the
 * epic's check makes them.
 * ---------------------------------------------------------------------- */

/**
 * A workspace that was used in the dynamics game before (it still carries a
 * playing set: ground does not delete records, it only stops drawing them).
 */
function fresh(): Journey {
  return {
    refs: [
      reference(
        "rain",
        "rain",
        220,
        180,
        "the water that arrives without being asked\n",
      ),
      reference("soil", "soil", 360, 320),
      reference("mulch", "mulch", 700, 320, "a slow sponge\n"),
      reference("sprinkler", "sprinkler", 880, 340),
    ],
    level: "concept",
    model: play(["mulch", "rain", "soil"]),
    distances: [],
    links: [{ from: "rain", to: "soil", sign: "+", extra: {} }],
    loops: [namedLoop("rain loop", ["rain", "soil", "rain"])],
    assumptions: [
      claim("the spot is still unknown", { type: "spot", x: 512, y: 640 }),
      claim("mulch is slow", { type: "word", slug: "mulch" }),
    ],
    marks: [],
    pointers: [],
    malformed: {
      model: null,
      distances: [],
      links: [],
      loops: [],
      assumptions: [],
      marks: [],
      pointers: [],
    },
  };
}

/** Enter the ground game — the third name, nothing else taken away. */
function entered(journey: Journey): Journey {
  return { ...journey, level: "ground" };
}

/**
 * Keep a pointer: the person picks the form themselves. `path` and `url` on
 * rain, an `at` that is machine-local (and may dangle), one on mulch for the
 * removal later, and a throwaway on soil to remove.
 */
function pointerKept(journey: Journey): Journey {
  const draft = pointerDraft("path", "notes/rain-gutter.md");
  if (draft === null) throw new Error("a picked path must commit");
  let pointers = addPointer(journey.pointers, "rain", draft.form, draft.value);
  pointers = addPointer(pointers, "rain", "url", "https://example.org/a?b=c");
  pointers = addPointer(pointers, "rain", "at", DANGLE);
  pointers = addPointer(pointers, "mulch", "path", "notes/mulch.md");
  pointers = addPointer(pointers, "soil", "url", "https://example.org/temp");
  return { ...journey, pointers };
}

/** Edit one line in place at its index — exactly one line changes. */
function pointerEdited(journey: Journey): Journey {
  const index = journey.pointers.findIndex(
    (pointer) => pointer.on === "rain" && pointer.form === "url",
  );
  const { pointers } = convergePointerEdit(
    journey.pointers,
    index,
    "url",
    "https://example.org/a?b=d",
  );
  return { ...journey, pointers };
}

/** Remove the throwaway line — ammo, one quiet ×, no tombstone. */
function pointerPruned(journey: Journey): Journey {
  const index = journey.pointers.findIndex(
    (pointer) => pointer.on === "soil" && pointer.form === "url",
  );
  return { ...journey, pointers: removePointerAt(journey.pointers, index) };
}

/** Close the window, coin a word where you stand, write what you saw. */
function observed(journey: Journey): Journey {
  return {
    ...journey,
    refs: [
      ...journey.refs,
      reference(
        "seep",
        "seep",
        460,
        520,
        "the gutter overflows at the north corner\n",
      ),
    ],
  };
}

/**
 * A finding about a relation keeps the same way (the corrected way): the word
 * carries the account and a distance places it — not an assumption, not a
 * pointer.
 */
function finding(journey: Journey): Journey {
  return {
    ...journey,
    refs: [
      ...journey.refs,
      reference(
        "gutter",
        "gutter",
        980,
        560,
        "the water runs past the mulch and pools here\n",
      ),
    ],
    distances: coinDistance(journey.distances, "rain", "gutter", "spills"),
  };
}

/** Mark reaches open (and keep a bare-spot record and a word mark beside them). */
function marked(journey: Journey): Journey {
  let marks = journey.marks;
  marks = withMark(marks, openPointerMark(pointerOn(journey, "rain", "path")));
  marks = withMark(marks, openPointerMark(pointerOn(journey, "mulch", "path")));
  marks = withMark(marks, openWord("mulch"));
  marks = withMark(marks, openSpot(512, 640));
  return { ...journey, marks };
}

/**
 * Rename a word through the whole batch, in the app's documented order: the
 * renamed file (prose byte-verbatim), then distances -> links -> marks -> loops
 * -> assumptions -> pointers -> pointer-marks -> membership; the old file is
 * simply no longer in the refs.
 */
function renamed(journey: Journey): Journey {
  const oldSlug = "mulch";
  const newName = "woodchip";
  const marksAfterWordStep = rewriteMarkEndpoints(
    journey.marks,
    oldSlug,
    newName,
  );
  return {
    ...journey,
    refs: journey.refs.map((ref) =>
      ref.slug === oldSlug
        ? { ...ref, id: newName, slug: newName, name: newName }
        : ref,
    ),
    distances: rewriteEndpoints(journey.distances, oldSlug, newName),
    links: rewriteLinkEndpoints(journey.links, oldSlug, newName),
    loops: rewriteLoopPaths(journey.loops, oldSlug, newName),
    assumptions: rewriteAssumptionTargets(journey.assumptions, oldSlug, newName),
    pointers: rewritePointerOwners(journey.pointers, oldSlug, newName),
    marks: rewritePointerMarkOwners(marksAfterWordStep, oldSlug, newName),
    model: journey.model
      ? rewriteMembership(journey.model, oldSlug, newName)
      : null,
  };
}

/**
 * Remove a word through the whole batch, in order: distances -> links -> marks
 * -> loops -> assumptions -> pointers -> pointer-marks -> membership -> the
 * file. The bare spot is untouched (a spot is its own target).
 */
function removed(journey: Journey): Journey {
  const slug = "woodchip";
  const deadLoopSlugs = journey.loops
    .filter((loop) => loop.path.includes(slug))
    .map((loop) => loopSlug(loop.name));
  const marksAfterWordStep = dropMarksTouching(journey.marks, slug);
  return {
    ...journey,
    refs: journey.refs.filter((ref) => ref.slug !== slug),
    distances: dropTouching(journey.distances, slug),
    links: dropTouchingLinks(journey.links, slug),
    loops: journey.loops.filter((loop) => !loop.path.includes(slug)),
    assumptions: dropLoopAssumptions(
      dropAssumptionsTouching(journey.assumptions, slug),
      deadLoopSlugs,
    ),
    pointers: dropPointersTouching(journey.pointers, slug),
    marks: dropPointerMarksTouching(marksAfterWordStep, slug),
    model: journey.model ? dropMembership(journey.model, slug) : null,
  };
}

type Step = (journey: Journey) => Journey;

const STAGES: Array<[string, Step]> = [
  ["entered", entered],
  ["pointer-kept", pointerKept],
  ["pointer-edited", pointerEdited],
  ["pointer-pruned", pointerPruned],
  ["observed", observed],
  ["finding", finding],
  ["marked", marked],
  ["renamed", renamed],
  ["removed", removed],
];

/** The journey up to and including one stage, rebuilt from the files' rules. */
function at(stage: string): Journey {
  let journey = fresh();
  for (const [name, step] of STAGES) {
    journey = step(journey);
    if (name === stage) return journey;
  }
  throw new Error("unknown journey stage: " + stage);
}

/* -------------------------------------------------------------------------
 * The journey.
 * ---------------------------------------------------------------------- */

describe("the epic's record-level journey (Epic 5)", () => {
  test("enter the ground game: the third name, every earlier record rides along", () => {
    const before = write(fresh());
    const journey = at("entered");
    const files = write(journey);

    expect(levelOfText(file(files, "workspace.yml"))).toBe("ground");
    expect(file(files, "workspace.yml")).toContain('level: "ground"');
    expect(Object.keys(parseYamlFields(file(files, "workspace.yml"))).sort()).toEqual([
      "format",
      "level",
      "shelf_x",
    ]);
    // Nothing is taken away: only workspace.yml changed, every earlier record
    // is byte-identical (the honest, additive partition).
    for (const path of [
      "map/model.json",
      "map/distances.jsonl",
      "map/links.jsonl",
      "map/loops.jsonl",
      "map/assumptions.jsonl",
      "map/marks.jsonl",
      "map/pointers.jsonl",
    ]) {
      expect(file(files, path)).toBe(file(before, path));
    }
    // DEPRECATED (hidden 2026-11-16 per separate-maps review): converted — the
    // table below is the PRE-HIDE record of what each game once drew (machinery
    // the sweep keeps); the render now reads ONE rule, so the concept map's
    // words/distances/marks/shelf show at concept only.
    expect([...RENDER_MAP.all]).toEqual(["words", "distances", "marks", "shelf"]);
    expect(showsMapContent("concept")).toBe(true);
    for (const level of ["dynamics", "ground"] as const) {
      expect(showsMapContent(level)).toBe(false);
      for (const record of RENDER_MAP.all) {
        expect([...renderedMapContent(level)]).not.toContain(record as never);
      }
    }
    expect([...RENDER_MAP.ground]).toEqual(["pointers"]);
    expect([...RENDER_MAP.dynamics]).toEqual([
      "links",
      "loops",
      "assumptions",
      "model",
    ]);
    expect(LEVELS).toEqual(["concept", "dynamics", "ground"]);
  });

  test("keep a pointer: the authored form pick writes one line per reach", () => {
    const journey = at("pointer-kept");
    const files = write(journey);
    const text = file(files, "map/pointers.jsonl");

    // No pick, no write; a pick commits the value verbatim.
    expect(pointerDraft(null, "notes/x.md")).toBeNull();
    expect(pointerDraft("url", "   ")).toBeNull();
    expect(pointerDraft("path", "notes/rain-gutter.md")).toEqual({
      form: "path",
      value: "notes/rain-gutter.md",
    });

    // WORLD B: the form is the authored JSON key, never sniffed from the value.
    expect(pointerDraft("path", "/etc/hosts")).toEqual({
      form: "path",
      value: "/etc/hosts",
    });
    expect(pointerDraft("at", "notes/x.md")).toEqual({
      form: "at",
      value: "notes/x.md",
    });
    expect(pointerDraft("url", "notes/x.md")).toEqual({
      form: "url",
      value: "notes/x.md",
    });
    const looksAbsolute = pointerDraft("path", "/etc/hosts")!;
    expect(
      serializePointers([
        ...addPointer([], "rain", looksAbsolute.form, looksAbsolute.value),
      ]),
    ).toBe('{"on":"rain","path":"/etc/hosts"}\n');
    const looksRelative = pointerDraft("at", "notes/x.md")!;
    expect(
      serializePointers([
        ...addPointer([], "rain", looksRelative.form, looksRelative.value),
      ]),
    ).toBe('{"at":"notes/x.md","on":"rain"}\n');

    expect(text).toBe(
      lines(
        '{"on":"rain","path":"notes/rain-gutter.md"}',
        '{"on":"rain","url":"https://example.org/a?b=c"}',
        '{"at":"/nonexistent/attentioneer/machine-only.md","on":"rain"}',
        '{"on":"mulch","path":"notes/mulch.md"}',
        '{"on":"soil","url":"https://example.org/temp"}',
      ),
    );
    expect(
      parsePointers(text).pointers.map((pointer) => pointer.form),
    ).toEqual(["path", "url", "at", "path", "url"]);
    // Several reaches per word are siblings, in file order, with their indexes.
    expect(findPointers(journey.pointers, "rain").map((found) => found.index)).toEqual([
      0, 1, 2,
    ]);
    // The same value under two forms is two different natural keys.
    expect(pointerKeyOf({ on: "rain", form: "path", value: "/etc/hosts" })).not.toBe(
      pointerKeyOf({ on: "rain", form: "at", value: "/etc/hosts" }),
    );
  });

  test("edit one pointer in place: exactly one line changes at its index", () => {
    const before = write(at("pointer-kept"));
    const after = write(at("pointer-edited"));
    const beforeLines = file(before, "map/pointers.jsonl").trimEnd().split("\n");
    const afterLines = file(after, "map/pointers.jsonl").trimEnd().split("\n");

    expect(afterLines).toHaveLength(beforeLines.length);
    // The url line changes at its own index; every sibling is untouched.
    expect(afterLines[1]).toBe('{"on":"rain","url":"https://example.org/a?b=d"}');
    expect(afterLines[0]).toBe(beforeLines[0]);
    expect(afterLines.slice(2)).toEqual(beforeLines.slice(2));
  });

  test("remove one pointer: ammo, and every sibling's bytes are untouched", () => {
    const before = write(at("pointer-edited"));
    const after = write(at("pointer-pruned"));

    expect(file(after, "map/pointers.jsonl")).toBe(
      lines(
        '{"on":"rain","path":"notes/rain-gutter.md"}',
        '{"on":"rain","url":"https://example.org/a?b=d"}',
        '{"at":"/nonexistent/attentioneer/machine-only.md","on":"rain"}',
        '{"on":"mulch","path":"notes/mulch.md"}',
      ),
    );
    const beforeLines = file(before, "map/pointers.jsonl").trimEnd().split("\n");
    const afterLines = file(after, "map/pointers.jsonl").trimEnd().split("\n");
    // One line went; the survivors keep their bytes and their file order.
    expect(afterLines).toEqual(beforeLines.filter((line) => !line.includes('"soil"')));
    // Settle is deletion: no tombstone, no counter.
    expect(file(after, "map/pointers.jsonl")).not.toContain("temp");
  });

  test("mark one reach open: the mark key is the pointer's own key", () => {
    const journey = at("marked");
    const files = write(journey);
    const rainPath = pointerOn(journey, "rain", "path");
    const target = pointerTarget(rainPath);

    expect(file(files, "map/marks.jsonl")).toBe(
      lines(
        '{"kind":"open","on":"rain","path":"notes/rain-gutter.md"}',
        '{"kind":"open","on":"mulch","path":"notes/mulch.md"}',
        '{"kind":"open","on":"mulch"}',
        '{"kind":"open","x":512,"y":640}',
      ),
    );
    // The pointer key IS the mark target key: on + form + value under its own
    // prefix, so a mark on rain's reach is not a mark on rain.
    expect(pointerMarkKey(rainPath)).toBe(markTargetKey(target));
    expect(pointerMarkKey(rainPath)).toBe("pointer\u0000" + pointerKeyOf(rainPath));
    expect(hasMark(journey.marks, "open", target)).toBe(true);
    expect(
      hasMark(journey.marks, "open", { type: "word", slug: "rain" }),
    ).toBe(false);

    const keys = markedPointerKeys(journey.marks);
    expect(keys.size).toBe(2);
    expect(isPointerMarked(rainPath, keys)).toBe(true);
    // The handle's cue is presence, never a count.
    expect(hasMarkedPointer(journey.pointers, keys, "rain")).toBe(true);
    expect(hasMarkedPointer(journey.pointers, keys, "sprinkler")).toBe(false);
  });

  test("keep an observation: coin a word and its memory — NO membership write", () => {
    const before = write(at("pointer-pruned"));
    const journey = at("observed");
    const files = write(journey);
    const seep = parseReference(
      "seep",
      "seep",
      file(files, REFS + "seep.md"),
    );

    expect(seep.name).toBe("seep");
    expect(seep.body).toBe("the gutter overflows at the north corner\n");
    expect(seep.x).toBe(460);
    expect(seep.y).toBe(520);
    expect(serializeReference(seep)).toBe(file(files, REFS + "seep.md"));

    // The word was coined, NOT joined: the playing set is byte-identical and
    // never names the observation (the join runs only while playing).
    expect(file(files, "map/model.json")).toBe(file(before, "map/model.json"));
    expect(file(files, "map/model.json")).not.toContain("seep");
    expect(parseModel(file(files, "map/model.json")).model!.words).toEqual([
      "mulch",
      "rain",
      "soil",
    ]);
    // An observation keeps no pointer and no window.
    expect(findPointers(journey.pointers, "seep")).toEqual([]);
    expect(file(files, "map/pointers.jsonl")).not.toContain("seep");
  });

  test("keep a relation finding: the word carries the account, a distance places it", () => {
    const before = write(at("observed"));
    const journey = at("finding");
    const files = write(journey);

    expect(file(files, "map/distances.jsonl")).toBe(
      '{"from":"rain","to":"gutter","word":"spills"}\n',
    );
    const gutter = parseReference(
      "gutter",
      "gutter",
      file(files, REFS + "gutter.md"),
    );
    expect(gutter.body).toBe(
      "the water runs past the mulch and pools here\n",
    );
    // The corrected way: no assumption line, and NO membership write.
    expect(file(files, "map/assumptions.jsonl")).toBe(
      file(before, "map/assumptions.jsonl"),
    );
    expect(file(files, "map/model.json")).toBe(file(before, "map/model.json"));
    expect(file(files, "map/model.json")).not.toContain("gutter");
    expect(findPointers(journey.pointers, "gutter")).toEqual([]);
  });

  test("the memory-only reference: its memory is a dot away, no window exists", () => {
    const journey = at("finding");
    const files = write(journey);

    // The reference is on the plane (a file), with its memory, and no pointer:
    // there is nothing to open, so no window exists for it.
    expect(file(files, REFS + "seep.md")).toBeDefined();
    expect(findPointers(journey.pointers, "seep")).toEqual([]);
    const seepMark = journey.marks.filter(
      (mark) =>
        mark.target.type === "pointer" && mark.target.on === "seep",
    );
    expect(seepMark).toEqual([]);
    // No file anywhere is a window record, and no key names one.
    for (const path of Object.keys(files)) {
      expect(path).not.toMatch(/window|peek|glimpse/i);
    }
    for (const path of Object.keys(files)) {
      for (const line of file(files, path).split("\n").filter(Boolean)) {
        if (!line.startsWith("{")) continue;
        expect(line).not.toMatch(/"[^"]*(window|peek|glimpse)[^"]*":/i);
      }
    }
  });

  test("rename a word: every on, mark key and membership follow byte-exactly", () => {
    const before = write(at("marked"));
    const journey = at("renamed");
    const files = write(journey);

    expect(journey.refs.map((ref) => ref.slug).sort()).toEqual([
      "gutter",
      "rain",
      "seep",
      "soil",
      "sprinkler",
      "woodchip",
    ]);

    // The pointer lines: `on` follows, the target strings never do.
    expect(file(files, "map/pointers.jsonl")).toBe(
      lines(
        '{"on":"rain","path":"notes/rain-gutter.md"}',
        '{"on":"rain","url":"https://example.org/a?b=d"}',
        '{"at":"/nonexistent/attentioneer/machine-only.md","on":"rain"}',
        '{"on":"woodchip","path":"notes/mulch.md"}',
      ),
    );
    // The pointer marks follow their lines; the word mark follows the word.
    expect(file(files, "map/marks.jsonl")).toBe(
      lines(
        '{"kind":"open","on":"rain","path":"notes/rain-gutter.md"}',
        '{"kind":"open","x":512,"y":640}',
        '{"kind":"open","on":"woodchip"}',
        '{"kind":"open","on":"woodchip","path":"notes/mulch.md"}',
      ),
    );
    const woodchipPath = pointerOn(journey, "woodchip", "path");
    expect(pointerMarkKey(woodchipPath)).toBe(
      markTargetKey(pointerTarget(woodchipPath)),
    );
    expect(
      hasMark(journey.marks, "open", pointerTarget(woodchipPath)),
    ).toBe(true);
    expect(
      hasMark(journey.marks, "open", {
        type: "pointer",
        on: "mulch",
        form: "path",
        value: "notes/mulch.md",
      }),
    ).toBe(false);

    // Membership follows, sorted; the other records follow their endpoints.
    expect(file(files, "map/model.json")).toBe(
      modelJson(["rain", "soil", "woodchip"]),
    );
    expect(file(files, "map/assumptions.jsonl")).toBe(
      lines(
        '{"text":"the spot is still unknown","x":512,"y":640}',
        '{"on":"woodchip","text":"mulch is slow"}',
      ),
    );
    expect(file(files, "map/distances.jsonl")).toBe(
      '{"from":"rain","to":"gutter","word":"spills"}\n',
    );
    expect(file(files, "map/links.jsonl")).toBe(
      '{"from":"rain","sign":"+","to":"soil"}\n',
    );
    expect(file(files, "map/loops.jsonl")).toBe(
      '{"name":"rain loop","path":["rain","soil","rain"]}\n',
    );

    // The old file is gone, the renamed one carries the prose byte-verbatim,
    // and a target string that spells the old word is NOT rewritten (World B).
    expect(files[REFS + "mulch.md"]).toBeUndefined();
    expect(
      parseReference("woodchip", "woodchip", file(files, REFS + "woodchip.md")).body,
    ).toBe("a slow sponge\n");
    expect(
      parsePointers(file(files, "map/pointers.jsonl")).pointers.find(
        (pointer) => pointer.on === "woodchip",
      )!.value,
    ).toBe("notes/mulch.md");

    // The `at` line is byte-identical through the rename (rain was not renamed).
    const atLine = '{"at":"/nonexistent/attentioneer/machine-only.md","on":"rain"}';
    expect(file(before, "map/pointers.jsonl")).toContain(atLine);
    expect(file(files, "map/pointers.jsonl")).toContain(atLine);
  });

  test("remove a word: its pointers and marks die, the bare-spot records stay", () => {
    const before = write(at("renamed"));
    const journey = at("removed");
    const files = write(journey);

    // The word, its file, its pointer line and its pointer/word marks are gone.
    expect(journey.refs.map((ref) => ref.slug)).not.toContain("woodchip");
    expect(files[REFS + "woodchip.md"]).toBeUndefined();
    expect(file(files, "map/pointers.jsonl")).toBe(
      lines(
        '{"on":"rain","path":"notes/rain-gutter.md"}',
        '{"on":"rain","url":"https://example.org/a?b=d"}',
        '{"at":"/nonexistent/attentioneer/machine-only.md","on":"rain"}',
      ),
    );
    expect(file(files, "map/marks.jsonl")).toBe(
      lines(
        '{"kind":"open","on":"rain","path":"notes/rain-gutter.md"}',
        '{"kind":"open","x":512,"y":640}',
      ),
    );
    // The bare-spot mark and the bare-spot assumption are byte-identical.
    const spotMark = '{"kind":"open","x":512,"y":640}';
    const spotClaim =
      '{"text":"the spot is still unknown","x":512,"y":640}';
    expect(file(before, "map/marks.jsonl")).toContain(spotMark);
    expect(file(files, "map/marks.jsonl")).toContain(spotMark);
    expect(file(before, "map/assumptions.jsonl")).toContain(spotClaim);
    expect(file(files, "map/assumptions.jsonl")).toBe(spotClaim + "\n");

    // Membership and every other record follow the removal.
    expect(file(files, "map/model.json")).toBe(modelJson(["rain", "soil"]));
    expect(file(files, "map/distances.jsonl")).toBe(
      '{"from":"rain","to":"gutter","word":"spills"}\n',
    );
    expect(file(files, "map/links.jsonl")).toBe(
      '{"from":"rain","sign":"+","to":"soil"}\n',
    );
    expect(file(files, "map/loops.jsonl")).toBe(
      '{"name":"rain loop","path":["rain","soil","rain"]}\n',
    );
    // No record names the removed word any more.
    for (const path of Object.keys(files)) {
      expect(file(files, path)).not.toContain("woodchip");
    }
    // No pointer mark names a pointer line that is gone.
    const keys = new Set(
      journey.pointers.map((pointer) => pointerKeyOf(pointer)),
    );
    for (const mark of journey.marks) {
      if (mark.target.type !== "pointer") continue;
      expect(keys.has(pointerKeyOf(mark.target))).toBe(true);
    }
  });

  test("an at reach dangles honestly: byte-identical, never repaired, says cannot read", () => {
    const atLine = '{"at":"/nonexistent/attentioneer/machine-only.md","on":"rain"}';
    for (const stage of [
      "pointer-kept",
      "pointer-edited",
      "pointer-pruned",
      "observed",
      "finding",
      "marked",
      "renamed",
      "removed",
    ]) {
      const journey = at(stage);
      const files = write(journey);
      expect(file(files, "map/pointers.jsonl")).toContain(atLine);
      const pointer = journey.pointers.find(
        (candidate) => candidate.form === "at",
      )!;
      expect(pointer.value).toBe(DANGLE);
      expect(pointer.on).toBe("rain");
      // The record layer never checks the target: the owner is on the map, so
      // the reach is not an orphan even though the file is unreachable here.
      expect(
        findOrphanPointers(journey.pointers, wordsOf(journey)),
      ).toEqual([]);
      // Resolution is verbatim and machine-local; the window says "cannot read".
      expect(resolveTarget("at", pointer.value, WS)).toEqual({
        kind: "file",
        path: DANGLE,
      });
    }
    expect(CANNOT_READ).toBe("cannot read");
  });

  test("quit, reopen: every record round-trips byte-exactly together", () => {
    const journey = at("removed");
    const files = write(journey);
    const reopened = reopen(files); // every file's bytes asserted in reopen

    const rewritten = write(reopened);
    expect(rewritten).toEqual(files);
    for (const path of Object.keys(files)) {
      expect(file(rewritten, path)).toBe(file(files, path));
    }
    // The level resumes, the records come back, and the readings are recomputed
    // from the bytes — never read back from a stored label.
    expect(reopened.level).toBe("ground");
    expect(reopened.model!.words).toEqual(["rain", "soil"]);
    expect(reopened.pointers.map((pointer) => pointer.form)).toEqual([
      "path",
      "url",
      "at",
    ]);
    expect(reopened.malformed).toEqual({
      model: null,
      distances: [],
      links: [],
      loops: [],
      assumptions: [],
      marks: [],
      pointers: [],
    });
    // Every account reads exactly as left (the memories, byte-verbatim).
    const seep = reopened.refs.find((ref) => ref.slug === "seep")!;
    expect(seep.body).toBe("the gutter overflows at the north corner\n");
    const gutter = reopened.refs.find((ref) => ref.slug === "gutter")!;
    expect(gutter.body).toBe(
      "the water runs past the mulch and pools here\n",
    );
    // The at line comes back byte-identical.
    expect(file(rewritten, "map/pointers.jsonl")).toContain(
      '{"at":"/nonexistent/attentioneer/machine-only.md","on":"rain"}',
    );
    // Nothing joined the model on the way out: the observations stayed out.
    expect(file(rewritten, "map/model.json")).not.toContain("seep");
    expect(file(rewritten, "map/model.json")).not.toContain("gutter");
  });

  test("the negative space: no counter, no verdict, no window record, garbage level = concept", () => {
    const journey = at("removed");
    const files = write(journey);
    const recordPaths = [
      "map/model.json",
      "map/distances.jsonl",
      "map/links.jsonl",
      "map/loops.jsonl",
      "map/assumptions.jsonl",
      "map/marks.jsonl",
      "map/pointers.jsonl",
    ];

    // No file anywhere contains the verdict vocabulary or a counter word.
    for (const path of Object.keys(files)) {
      expect(file(files, path)).not.toMatch(
        /reinforc|balanc|verdict|score|streak|count|tally|progress/i,
      );
    }
    // Every key is a fact, never a counter; every number is a plane position.
    const COUNTER =
      /count|score|streak|progress|tally|total|queue|times|number|weight|strength|magnitude|rate|verdict|label|reinforc|balanc|badge/i;
    const visit = (value: unknown, key: string): void => {
      if (Array.isArray(value)) {
        for (const item of value) visit(item, key);
        return;
      }
      if (value !== null && typeof value === "object") {
        for (const child of Object.keys(value as Record<string, unknown>)) {
          expect(child).not.toMatch(COUNTER);
          visit((value as Record<string, unknown>)[child], child);
        }
        return;
      }
      expect(key).not.toMatch(COUNTER);
      if (typeof value === "number") {
        // Only a bare spot's x/y is a plane position, not a tally.
        expect(["x", "y"]).toContain(key);
      } else {
        expect(typeof value).toBe("string");
      }
    };
    visit(JSON.parse(file(files, "map/model.json")), "model");
    for (const path of recordPaths.slice(1)) {
      for (const line of file(files, path).split("\n").filter(Boolean)) {
        visit(JSON.parse(line), path);
      }
    }

    // The window persists nothing: no record, no file, no key.
    for (const path of Object.keys(files)) {
      expect(path).not.toMatch(/window|peek|glimpse/i);
    }
    for (const path of Object.keys(files)) {
      expect(file(files, path)).not.toMatch(/window|peek|glimpse/i);
    }
    // Opening a window is a pure transient: resolve the target, read the
    // snapshot wording, and the files are byte-identical before and after.
    const rainPath = pointerOn(journey, "rain", "path");
    expect(resolveTarget(rainPath.form, rainPath.value, WS)).toEqual({
      kind: "file",
      path: WS + "/notes/rain-gutter.md",
    });
    expect(PEEK_TOOLTIP).toBe("an open-moment glimpse — reopen to refresh");
    expect(schemeNotice("https://example.org/a?b=d")).toBeNull();
    expect(schemeNotice("obsidian://x")).toBe("cannot open this scheme");
    // A url is any scheme, stored and resolved verbatim; the guard, not the
    // record, decides what may open.
    expect(resolveTarget("url", "obsidian://open?vault=x", WS)).toEqual({
      kind: "url",
      url: "obsidian://open?vault=x",
    });
    expect(write(journey)).toEqual(files);

    // Garbage level reads as concept, tolerantly — an old workspace opens.
    expect(levelOfText(null)).toBe("concept");
    expect(levelOfText("")).toBe("concept");
    expect(levelOfText('level: "stock-flow"\n')).toBe("concept");
    expect(levelOfText("level: 3\n")).toBe("concept");
    expect(levelOf({ level: "grounds" })).toBe("concept");
    expect(levelOf({ level: "the ground" })).toBe("concept");
    expect(levelOfText('level: " GROUND "\n')).toBe("ground");
    expect(levelOfText('level: " DYNAMICS "\n')).toBe("dynamics");
  });
});
