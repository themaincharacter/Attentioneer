import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  addAssumption,
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
import {
  drawLink,
  parseLinks,
  serializeLinks,
  type Link,
  type LinkSign,
} from "../src/map/links";
import {
  nameLoop,
  parseLoops,
  serializeLoops,
  type Loop,
} from "../src/map/loops";
import {
  parseMarks,
  serializeMarks,
  withMark,
  type Mark,
} from "../src/map/marks";
import {
  addPointer,
  parsePointers,
  serializePointers,
  type Pointer,
} from "../src/map/pointers";
import {
  dedupe,
  joinWord,
  joinWords,
  outOfPlay,
  parseModel,
  prefilledSelection,
  serializeModel,
  type PlayingSet,
} from "../src/map/model";
import {
  parseReference,
  serializeReference,
  type Reference,
} from "../src/map/refs";
import { workspaceYml } from "../src/lib/serialize";
import {
  authoringDoorLive,
  authoringLive,
  isGestureArmed,
  shouldCreate,
  shouldPan,
  shouldPinLevel,
  shouldPromptForSet,
  shouldStartWordPress,
  NO_FOCUS,
} from "../src/canvas/gates";
import { levelOfText, withLevel, type Level } from "../src/workspace/level";

/**
 * Epic 7's plain-language check, automated at the record layer (story 2).
 *
 * The human half — the feel of the selector's draft, the dimming and
 * un-dimming, the marked/shelved collisions, the real-window Esc and the real
 * quit/reopen — is the queued real-window pass. This file walks the LOCKED
 * check's record half through the pure modules and the files' bytes only, no
 * DOM, in the check's own order:
 *
 *   FRESH START: no map/model.json; the resume makes the selector appear; Esc
 *   writes nothing; the three dynamics doors (link, loop, assumption) are dead
 *   because authoringLive(level, model) is false; every record keeps its bytes.
 *   PRUNE + ACCEPT: the selector prunes a proper subset out and accept writes
 *   the one canonical set record — the narrowing is DEMONSTRATED, never
 *   enforced (select-all and prune-all stay legal, an accepted empty set is
 *   still a set). Authoring is now live. Author ONE link. RECONSIDER: the
 *   re-run pre-fills the circle's memory (the accepted set), and close/Esc
 *   writes no model — the silent-close proxy: open, toggle, lasso, select-all
 *   and close write nothing, scoped by the named joinWord/dropMembership
 *   exceptions. RECIRCLE: re-run, change the pruning, accept — the prior set is
 *   overwritten, and on the re-run a pruned word re-included reads as in play in
 *   the DRAFT predicate before close. THE HONESTY LINE: linking a pruned word
 *   rejoins it (joinWord) — the circle is a narrowing, never a wall. RECORDS
 *   BYTE-EXACT: words, distances, links, loops, assumptions, marks and pointers
 *   read exactly as before; the prior sets are not stored among them.
 *   NEGATIVE SPACE: no stored circle state, no history, no nudge, no score.
 *
 * The LOCKED check lives in .scratch/epic-7/issues/05-epic-7-check-and-slice.md
 * (its Answer); ADR-0013 is the membership binding, ADR-0018 the level's.
 * Provisional readings are named where they occur. Story 1 owns the full
 * source scans for the seam and the rendering; this file re-asserts the
 * retired-doc inventory stays retired and that the selector's write trigger
 * stays the accept.
 */

const REFS = "map/references/";
/** The five words the selector's pool holds (sorted — dedupe's order). */
const AVAILABLE = ["drift", "mulch", "rain", "soil", "stone"];
/** The bare lack's spot on the plane (a spot mark is its own target). */
const LACK = { x: 512, y: 640 };
/** The shelf's default fold: drift sits past it, set aside but never gone. */
const SHELF = 1280;

type Files = Record<string, string>;

interface Journey {
  refs: Reference[];
  level: Level;
  /** The accepted set, or null when map/model.json does not exist. */
  model: PlayingSet | null;
  distances: Distance[];
  links: Link[];
  loops: Loop[];
  assumptions: Assumption[];
  marks: Mark[];
  pointers: Pointer[];
}

/** The selector's transient state: a draft and its open flag, never a record. */
interface Selector {
  open: boolean;
  draft: ReadonlySet<string>;
}

/* -------------------------------------------------------------------------
 * The record shorthands.
 * ---------------------------------------------------------------------- */

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

/**
 * The fresh workspace, BEFORE any accepted set: the words are the map's (all
 * six families of record live beside them), map/model.json does not exist, and
 * the level key resumes the person in dynamics — the resume is what makes the
 * selector appear (shouldPromptForSet's deliberate cause).
 *
 * Provisional reading: the shared records (a distance, a word mark, a bare
 * lack's spot mark, a reach) are present because they belong to the map, not
 * to the dynamics model; a link, a loop and an assumption are absent because
 * they are dynamics' own records and no set has been accepted yet.
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
      reference("stone", "stone", 860, 360),
      reference("drift", "drift", SHELF + 120, 360, "a leaf on the step\n"),
    ],
    level: "dynamics",
    model: null,
    distances: coinDistance([], "rain", "soil", "waters"),
    links: [],
    loops: [],
    assumptions: [],
    // A word mark on drift (the shelved word) and a bare lack: the collision
    // the check looks at, kept as records while drift stays out of play.
    marks: withMark(
      withMark([], {
        kind: "open",
        target: { type: "word", slug: "drift" },
        extra: {},
      }),
      { kind: "open", target: { type: "spot", x: LACK.x, y: LACK.y }, extra: {} },
    ),
    pointers: addPointer([], "rain", "path", "notes/rain-gutter.md"),
  };
}

/** Every coined word, sorted (the selector's pool and the draft's order). */
function availableOf(journey: Journey): string[] {
  return dedupe(
    journey.refs
      .map((ref) => ref.slug)
      .filter((slug): slug is string => slug !== null),
  );
}

/** The workspace's bytes as the app writes them (references are files). */
function filesOf(journey: Journey): Files {
  const files: Files = {
    "workspace.yml": withLevel(workspaceYml(), journey.level),
    "map/distances.jsonl": serializeDistances(journey.distances),
    "map/links.jsonl": serializeLinks(journey.links),
    "map/loops.jsonl": serializeLoops(journey.loops),
    "map/assumptions.jsonl": serializeAssumptions(journey.assumptions),
    "map/marks.jsonl": serializeMarks(journey.marks),
    "map/pointers.jsonl": serializePointers(journey.pointers),
  };
  // No accepted set means NO map/model.json — absence, not an empty file.
  if (journey.model !== null) {
    files["map/model.json"] = serializeModel(journey.model);
  }
  for (const ref of journey.refs) {
    if (ref.slug === null) throw new Error("the journey keeps only coined words");
    files[REFS + ref.slug + ".md"] = serializeReference(ref);
  }
  return files;
}

/** The map's own records (everything but the level's key). */
function recordsOf(journey: Journey): Files {
  const files = filesOf(journey);
  delete files["workspace.yml"];
  return files;
}

/** Quit and reopen: read every record back, asserting the next write's bytes. */
function readJourney(files: Files): Journey {
  const level = levelOfText(files["workspace.yml"]);
  // The key is the resume hint (ADR-0018); re-writing it changes no byte.
  expect(withLevel(files["workspace.yml"], level)).toBe(files["workspace.yml"]);

  const refs: Reference[] = [];
  for (const path of Object.keys(files).sort()) {
    if (!path.startsWith(REFS) || !path.endsWith(".md")) continue;
    const text = files[path];
    const slug = path.slice(REFS.length, -3);
    const parsed = parseReference(slug, slug, text);
    expect(serializeReference(parsed)).toBe(text);
    refs.push(parsed);
  }

  const modelText = files["map/model.json"] ?? null;
  const parsedModel = parseModel(modelText);
  expect(serializeModel(parsedModel.model, parsedModel.malformed)).toBe(
    modelText ?? "",
  );

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
  };
}

/* -------------------------------------------------------------------------
 * The selector, reduced to App.tsx's callbacks (a draft and one write).
 * ---------------------------------------------------------------------- */

/** Open: pre-filled with the accepted set, every word on a first entry. */
function openSelector(journey: Journey): Selector {
  return {
    open: true,
    draft: new Set(prefilledSelection(journey.model, availableOf(journey))),
  };
}

/** Click a word: leave it out, or bring it back (the draft only). */
function toggle(selector: Selector, slug: string): Selector {
  const draft = new Set(selector.draft);
  if (draft.has(slug)) draft.delete(slug);
  else draft.add(slug);
  return { open: true, draft };
}

/** The draw tool's release: words only, the enclosed set becomes the draft. */
function lasso(_selector: Selector, slugs: readonly string[]): Selector {
  return { open: true, draft: new Set(slugs) };
}

/** Select-all: every word, shelved words included (the shelf is a place). */
function selectAll(journey: Journey): Selector {
  return { open: true, draft: new Set(availableOf(journey)) };
}

/** Close (or Esc): the draft is dropped; nothing is written. */
function closeSelector(_selector: Selector): Selector {
  return { open: false, draft: new Set() };
}

/**
 * Accept: the ONE selector write. Deduped and sorted canonical bytes by the
 * record layer; the prior set is overwritten, no history (ADR-0013 decision 2).
 */
function acceptSelector(journey: Journey, selector: Selector): Journey {
  return {
    ...journey,
    model: {
      words: dedupe([...selector.draft]),
      extra: journey.model?.extra ?? {},
    },
  };
}

/* -------------------------------------------------------------------------
 * The writers, guarded by the seam exactly as useMap's three callbacks are.
 * ---------------------------------------------------------------------- */

/** Draw a link: the durable line first, the composed join second. */
function authorLink(
  journey: Journey,
  from: string,
  to: string,
  sign: LinkSign = "+",
): Journey {
  if (!authoringLive(journey.level, journey.model)) return journey;
  const links = drawLink(journey.links, from, to, sign);
  const model = joinWords(journey.model, [from, to]);
  return { ...journey, links, model };
}

/** Coin a loop: a dynamics record, membership deliberately untouched. */
function authorLoop(
  journey: Journey,
  name: string,
  path: readonly string[],
): Journey {
  if (!authoringLive(journey.level, journey.model)) return journey;
  return { ...journey, loops: nameLoop(journey.loops, name, path) };
}

/** State a claim: a dynamics record, membership deliberately untouched. */
function authorClaim(
  journey: Journey,
  text: string,
  target: AssumptionTarget,
): Journey {
  if (!authoringLive(journey.level, journey.model)) return journey;
  return {
    ...journey,
    assumptions: addAssumption(journey.assumptions, text, target),
  };
}

/* -------------------------------------------------------------------------
 * The journey's stages, in the check's order.
 * ---------------------------------------------------------------------- */

/** Prune stone and drift out, accept: the proper-subset first circle. */
function afterFirstAccept(): Journey {
  const journey = fresh();
  const selector = toggle(toggle(openSelector(journey), "stone"), "drift");
  return acceptSelector(journey, selector);
}

/** Author one link under the accepted set. */
function afterLink(): Journey {
  return authorLink(afterFirstAccept(), "rain", "soil", "+");
}

/** Re-run, include stone, prune mulch, accept: the prior set overwritten. */
function afterRecircle(): Journey {
  const journey = afterLink();
  const selector = toggle(toggle(openSelector(journey), "stone"), "mulch");
  return acceptSelector(journey, selector);
}

/** The honesty line: link rain to the pruned mulch; the join pulls it back. */
function afterHonesty(): Journey {
  return authorLink(afterRecircle(), "rain", "mulch", "+");
}

/* -------------------------------------------------------------------------
 * Source helpers: one callback's body and the files the app runs.
 * ---------------------------------------------------------------------- */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/**
 * One `const NAME = useCallback(` body: brace-matched for a block body, the
 * declaration's own line for an expression body. The deps array is never
 * needed, so it is trimmed away where the body is a block.
 */
function callbackBody(source: string, name: string): string {
  const start = source.indexOf("const " + name + " = useCallback(");
  expect(start).toBeGreaterThan(-1);
  const arrow = source.indexOf("=>", start);
  expect(arrow).toBeGreaterThan(start);
  let first = arrow + 2;
  while (first < source.length && /\s/.test(source[first])) first += 1;
  if (source[first] !== "{") {
    // An expression body (a one-line arrow): its declaration is the whole of
    // it, deps included.
    return source.slice(start, source.indexOf("\n", start));
  }
  let depth = 0;
  let end = first;
  for (let i = first; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  return source.slice(start, end);
}

const useMapSource = read("../src/canvas/useMap.ts");
const appSource = read("../src/App.tsx");
const selectorSource = read("../src/canvas/PlayingSetSelector.tsx");
const modelSource = read("../src/map/model.ts");
const cssSource = read("../src/canvas/canvas.css");

/* -------------------------------------------------------------------------
 * 1. The fresh start: no accepted set.
 * ---------------------------------------------------------------------- */

describe("the fresh start: no accepted set, no authoring", () => {
  test("a fresh workspace has its words and shared records but no map/model.json", () => {
    const journey = fresh();
    const files = filesOf(journey);
    expect(files["map/model.json"]).toBeUndefined();
    expect(Object.keys(files).sort()).toEqual(
      [
        "map/assumptions.jsonl",
        "map/distances.jsonl",
        "map/links.jsonl",
        "map/loops.jsonl",
        "map/marks.jsonl",
        "map/pointers.jsonl",
        "workspace.yml",
        ...AVAILABLE.map((slug) => REFS + slug + ".md"),
      ].sort(),
    );
    // The missing file is no set and no malformed bytes.
    expect(parseModel(files["map/model.json"] ?? null)).toEqual({
      model: null,
      malformed: null,
    });
    expect(serializeModel(null)).toBe("");
    // The shared records are the map's: authored in every game, not the set's.
    expect(files["map/distances.jsonl"]).toBe(
      '{"from":"rain","to":"soil","word":"waters"}\n',
    );
    expect(files["map/pointers.jsonl"]).toBe(
      '{"on":"rain","path":"notes/rain-gutter.md"}\n',
    );
    expect(files["map/marks.jsonl"]).toBe(serializeMarks(journey.marks));
    expect(journey.marks).toHaveLength(2);
    // drift is set aside past the fold: a place, never an exclusion.
    const drift = journey.refs.find((ref) => ref.slug === "drift")!;
    expect(drift.x).toBeGreaterThan(SHELF);
    expect(files[REFS + "drift.md"]).toBeDefined();
  });

  test("the selector appears on a deliberate entry and asks once; a wheel never asks", () => {
    // The resume that opens a workspace in dynamics with no set is deliberate.
    expect(shouldPromptForSet("restore", "dynamics", false)).toBe(true);
    expect(shouldPromptForSet("jump", "dynamics", false)).toBe(true);
    // The wheel's named cost: it never asks (the set stays required at authoring).
    expect(shouldPromptForSet("settle", "dynamics", false)).toBe(false);
    expect(shouldPromptForSet("restore", "dynamics", true)).toBe(false);
    // The app's one automatic appearance, guarded to once per workspace.
    expect(appSource).toContain(
      'shouldPromptForSet("restore", workspace.resumeLevel, model !== null)',
    );
    expect(appSource).toContain("autoPromptedRef.current === workspace.path");
  });

  test("Esc writes nothing: the selector opens pre-filled and closes silently", () => {
    const journey = fresh();
    const before = filesOf(journey);
    const selector = openSelector(journey);
    expect(selector.open).toBe(true);
    // A first entry pre-fills every current word: the door is one press.
    expect([...selector.draft]).toEqual(AVAILABLE);
    const closed = closeSelector(selector);
    expect(closed.open).toBe(false);
    expect(closed.draft.size).toBe(0);
    // Esc is the close button's own path, and it writes nothing.
    expect(filesOf(journey)).toEqual(before);
    expect(filesOf(journey)["map/model.json"]).toBeUndefined();
    expect(selectorSource).toContain('if (e.key !== "Escape") return;');
    expect(selectorSource).toContain("onClose();");
  });

  test("all three authoring doors are dead until a set is accepted", () => {
    const journey = fresh();
    const before = filesOf(journey);
    expect(authoringLive(journey.level, journey.model)).toBe(false);
    const attempted = authorClaim(
      authorLoop(
        authorLink(journey, "rain", "soil", "+"),
        "rain loop",
        ["rain", "soil", "rain"],
      ),
      "drift is the unknown",
      { type: "word", slug: "drift" },
    );
    // A dead door is a no-op, identity and all: nothing armed can write.
    expect(attempted).toBe(journey);
    expect(filesOf(attempted)).toEqual(before);
    expect(filesOf(attempted)["map/model.json"]).toBeUndefined();
  });

  test("the three writers ask the seam before their first persist", () => {
    const writers: Array<[string, string]> = [
      ["drawLink", "persistLinks("],
      ["createLoop", "persistLoops("],
      ["addAssumption", "persistAssumptions("],
    ];
    for (const [name, persist] of writers) {
      const body = callbackBody(useMapSource, name);
      expect(body).toContain("authoringLive(level, modelRef.current)");
      expect(body.indexOf("authoringLive(")).toBeLessThan(body.indexOf(persist));
      const guard = body.indexOf("if (!authoringLive(");
      expect(guard).toBeGreaterThan(-1);
      expect(body.slice(guard, body.indexOf(persist))).toContain("return;");
    }
  });
});

/* -------------------------------------------------------------------------
 * 2. Prune and accept: the narrowing is the circle, never a demand.
 * ---------------------------------------------------------------------- */

describe("prune and accept: a proper subset, demonstrated never enforced", () => {
  test("the first accept writes the narrow set the selector kept", () => {
    const journey = fresh();
    const available = availableOf(journey);
    const selector = toggle(toggle(openSelector(journey), "stone"), "drift");
    expect([...selector.draft]).toEqual(["mulch", "rain", "soil"]);
    const accepted = acceptSelector(journey, selector);
    expect(accepted.model!.words).toEqual(["mulch", "rain", "soil"]);
    // The narrowing is DEMONSTRATED: a proper subset of the pool, by choice.
    expect(accepted.model!.words.length).toBeLessThan(available.length);
    expect(serializeModel(accepted.model)).toBe(
      '{\n  "words": [\n    "mulch",\n    "rain",\n    "soil"\n  ]\n}\n',
    );
    const files = filesOf(accepted);
    expect(files["map/model.json"]).toBe(serializeModel(accepted.model));
    // Pruned means out of PLAY, never off the map (absence is exclusion).
    expect(files[REFS + "stone.md"]).toBeDefined();
    expect(files[REFS + "drift.md"]).toBeDefined();
    expect(outOfPlay(accepted.model, null, "stone")).toBe(true);
    expect(outOfPlay(accepted.model, null, "drift")).toBe(true);
    expect(outOfPlay(accepted.model, null, "mulch")).toBe(false);
    // Accept is what ARMS the three doors.
    expect(authoringLive("dynamics", accepted.model)).toBe(true);
  });

  test("select-all and prune-all stay legal: no guard enforces a circle", () => {
    const journey = fresh();
    const all = acceptSelector(journey, selectAll(journey));
    expect(all.model!.words).toEqual(AVAILABLE);
    expect(serializeModel(all.model)).toContain('"drift"');
    const none = acceptSelector(journey, lasso(openSelector(journey), []));
    expect(serializeModel(none.model)).toBe('{\n  "words": []\n}\n');
    // An accepted empty set is still a set: the doors are live with nothing in
    // play. "Set exists" is not "a circle exists"; the narrowing is the human's.
    expect(authoringLive("dynamics", none.model)).toBe(true);
    // The accept is a write, not a review: no size or membership test.
    const accept = callbackBody(appSource, "acceptSelector");
    expect(accept).toContain("acceptPlayingSet([...selectorDraft])");
    expect(accept).not.toContain("length");
    const record = callbackBody(useMapSource, "acceptPlayingSet");
    expect(record).not.toContain("hasWord");
    expect(record).not.toContain(".length");
  });
});

/* -------------------------------------------------------------------------
 * 3. Authoring is live: one link.
 * ---------------------------------------------------------------------- */

describe("authoring is live: one link, and the join that adds nothing", () => {
  test("the link is one line; both endpoints are in play, so no second write", () => {
    const journey = afterFirstAccept();
    const linked = authorLink(journey, "rain", "soil", "+");
    expect(linked.links).toEqual([
      { from: "rain", to: "soil", sign: "+", extra: {} },
    ]);
    expect(serializeLinks(linked.links)).toBe(
      '{"from":"rain","sign":"+","to":"soil"}\n',
    );
    // The composed join finds nothing missing and returns the same record: a
    // link between words already in play writes ONE record, not two.
    expect(linked.model).toBe(journey.model);
    const files = filesOf(linked);
    expect(files["map/links.jsonl"]).toBe(
      '{"from":"rain","sign":"+","to":"soil"}\n',
    );
    expect(files["map/model.json"]).toBe(serializeModel(journey.model));
    expect(authoringLive("dynamics", linked.model)).toBe(true);
  });

  test("the durable link line is written before the membership join", () => {
    const body = callbackBody(useMapSource, "drawLink");
    expect(body.indexOf("persistLinks(")).toBeLessThan(
      body.indexOf("joinToPlay("),
    );
  });
});

/* -------------------------------------------------------------------------
 * 4. Reconsider: open the pre-filled selector, close without writing.
 * ---------------------------------------------------------------------- */

describe("reconsider: the pre-fill is the circle's memory; close writes nothing", () => {
  test("a re-run opens on the accepted set, not on every word", () => {
    const journey = afterLink();
    const selector = openSelector(journey);
    expect(selector.open).toBe(true);
    expect([...selector.draft]).toEqual(["mulch", "rain", "soil"]);
    expect([...selector.draft]).toEqual(journey.model!.words);
    // The pruned words are absent from the memory, not deleted from the map.
    expect(selector.draft.has("stone")).toBe(false);
    expect(selector.draft.has("drift")).toBe(false);
    expect(availableOf(journey)).toEqual(AVAILABLE);
  });

  test("the silent-close proxy: open, toggle, lasso, select-all and close write nothing", () => {
    const journey = afterLink();
    const before = recordsOf(journey);
    const modelBefore = serializeModel(journey.model);

    let selector = openSelector(journey);
    expect(recordsOf(journey)).toEqual(before);

    selector = toggle(selector, "stone"); // include a pruned word
    expect([...selector.draft]).toEqual(["mulch", "rain", "soil", "stone"]);
    expect(recordsOf(journey)).toEqual(before);

    selector = toggle(selector, "stone"); // and out again
    expect(selector.draft.has("stone")).toBe(false);
    expect(recordsOf(journey)).toEqual(before);

    selector = lasso(selector, ["rain", "soil"]); // the draw tool narrows
    expect([...selector.draft]).toEqual(["rain", "soil"]);
    expect(recordsOf(journey)).toEqual(before);

    selector = selectAll(journey); // select-all is a draft, never a write
    expect([...selector.draft]).toEqual(AVAILABLE);
    expect(recordsOf(journey)).toEqual(before);

    selector = closeSelector(selector); // close or Esc: nothing written
    expect(selector.open).toBe(false);
    expect(recordsOf(journey)).toEqual(before);
    expect(serializeModel(journey.model)).toBe(modelBefore);
    // The set is exactly as it was, and the doors are still live.
    expect(journey.model!.words).toEqual(["mulch", "rain", "soil"]);
    expect(authoringLive("dynamics", journey.model)).toBe(true);
  });

  test("no selector move reaches a write; the accept is the one trigger", () => {
    const moves = [
      "openSelector",
      "toggleSelectorWord",
      "selectAllSelectorWords",
      "handleLasso",
      "toggleLasso",
      "closeSelector",
    ];
    for (const name of moves) {
      const body = callbackBody(appSource, name);
      expect(body).not.toContain("acceptPlayingSet");
      expect(body).not.toContain("saveModel");
    }
    expect(callbackBody(appSource, "acceptSelector")).toContain(
      "acceptPlayingSet([...selectorDraft])",
    );
    // The selector's own layer never touches the record.
    expect(selectorSource).not.toContain("saveModel");
    expect(selectorSource).not.toContain("acceptPlayingSet");
    // The scoped exceptions are named, on the record side: the composed join
    // (joinWord) and the atomic batch (dropMembership/rewriteMembership).
    expect(callbackBody(useMapSource, "joinToPlay")).toContain("saveModel(");
    expect(callbackBody(useMapSource, "acceptPlayingSet")).toContain("saveModel(");
  });

  test("the close is not a nudge: no confirmation, no re-prompt, no badge", () => {
    expect(appSource).not.toContain("confirm(");
    expect(appSource).not.toContain("alert(");
    expect(appSource).not.toContain("streak");
    expect(appSource).not.toContain("score");
    expect(selectorSource).not.toContain("confirm(");
    expect(selectorSource).not.toContain("alert(");
    const close = callbackBody(appSource, "closeSelector");
    expect(close).not.toContain("openSelector");
    expect(close).not.toContain("accept");
    // The way back is the control's own quiet title.
    expect(selectorSource).toContain('title="leave the set as it was"');
  });

  test("while the selector is open the gate holds the plane; opening closes any door", () => {
    expect(isGestureArmed("selector")).toBe(true);
    expect(shouldStartWordPress("selector", null)).toBe(false);
    expect(shouldPan("selector")).toBe(false);
    expect(shouldCreate("selector")).toBe(false);
    expect(shouldPinLevel("selector", NO_FOCUS)).toBe(true);
    // Opening runs the full cancel path FIRST, so one live surface is all.
    const open = callbackBody(appSource, "openSelector");
    expect(open.indexOf("cancelPendingGestures()")).toBeLessThan(
      open.indexOf("setSelectorOpen(true)"),
    );
    const cancel = callbackBody(appSource, "cancelPendingGestures");
    expect(cancel).toContain("setPathSession(endPathSession())");
    expect(cancel).toContain("setAssumptionAt(null)");
    expect(cancel).toContain("cancelConnect()");
    // The third door dies too: the named follow-up this story deferred is
    // fixed (PROVISIONAL: the door rule's shape). The control's "coin a loop"
    // sits OUTSIDE .plane, so the armed gate never covers it and an accepted set
    // keeps authoringLive true — yet an open selector still kills the door. The
    // reading is `authoringDoorLive`, and beginLoop asks it BEFORE
    // cancelPendingGestures, so clicking the door can no longer close the
    // selector and arm the path.
    const journey = afterLink();
    expect(authoringLive("dynamics", journey.model)).toBe(true);
    expect(authoringDoorLive("dynamics", journey.model, true)).toBe(false);
    expect(authoringDoorLive("dynamics", journey.model, false)).toBe(true);
    const loop = callbackBody(appSource, "beginLoop");
    expect(loop).toContain("authoringDoorLive(level, model, selectorOpen)");
    expect(loop.indexOf("authoringDoorLive(")).toBeLessThan(
      loop.indexOf("cancelPendingGestures()"),
    );
  });
});

/* -------------------------------------------------------------------------
 * 5. Recircle: re-run, change the pruning, accept — the prior set overwritten.
 * ---------------------------------------------------------------------- */

describe("recircle: the re-run's include side reads live, then accept overwrites", () => {
  test("the include side undims in the draft predicate, before any close", () => {
    const journey = afterLink();
    const prior = journey.model!;
    const selector = toggle(toggle(openSelector(journey), "stone"), "mulch");
    const draft = selector.draft;
    expect([...draft]).toEqual(["rain", "soil", "stone"]);
    // stone is pruned in the record and IN PLAY in the draft: the include side
    // is live before close (the defect Epic 7 story 1 settled).
    expect(outOfPlay(prior, null, "stone")).toBe(true);
    expect(outOfPlay(prior, draft, "stone")).toBe(false);
    // The exclude side reads live too: mulch quiets at once.
    expect(outOfPlay(prior, null, "mulch")).toBe(false);
    expect(outOfPlay(prior, draft, "mulch")).toBe(true);
    // The draft is a VIEW: the records still read the prior set.
    expect(recordsOf(journey)["map/model.json"]).toBe(serializeModel(prior));
  });

  test("accept overwrites the prior set; no other record changes and no history", () => {
    const journey = afterLink();
    const priorBytes = serializeModel(journey.model);
    const accepted = afterRecircle();
    expect(accepted.model!.words).toEqual(["rain", "soil", "stone"]);
    const bytes = recordsOf(accepted);
    const before = recordsOf(journey);
    expect(bytes["map/model.json"]).toBe(
      '{\n  "words": [\n    "rain",\n    "soil",\n    "stone"\n  ]\n}\n',
    );
    expect(bytes["map/model.json"]).not.toBe(priorBytes);
    // The prior set is overwritten, not archived: no record carries its bytes.
    for (const text of Object.values(bytes)) {
      expect(text).not.toContain(priorBytes);
    }
    // Every other record family is byte-identical: the set is the only change.
    expect(Object.keys(bytes).sort()).toEqual(Object.keys(before).sort());
    for (const path of Object.keys(before)) {
      if (path === "map/model.json") continue;
      expect(bytes[path]).toBe(before[path]);
    }
    // The set record carries membership only — no history, no circle state.
    expect(Object.keys(JSON.parse(bytes["map/model.json"]))).toEqual(["words"]);
  });
});

/* -------------------------------------------------------------------------
 * 6. The honesty line: linking a pruned word rejoins it.
 * ---------------------------------------------------------------------- */

describe("the honesty line: the circle is a narrowing, never a wall", () => {
  test("mulch is out of play before the link and in play after it", () => {
    const journey = afterRecircle();
    expect(outOfPlay(journey.model, null, "mulch")).toBe(true);
    expect(authoringLive("dynamics", journey.model)).toBe(true);
    const linked = authorLink(journey, "rain", "mulch", "+");
    expect(outOfPlay(linked.model, null, "mulch")).toBe(false);
    expect(linked.model!.words).toEqual(["mulch", "rain", "soil", "stone"]);
    // The join is joinWord's move (ADR-0013 decision 4): membership is not
    // accept-only, and a pruned word linked to is pulled back in.
    expect(joinWord(journey.model, "mulch")).toEqual(linked.model);
    expect(serializeLinks(linked.links)).toBe(
      '{"from":"rain","sign":"+","to":"soil"}\n{"from":"rain","sign":"+","to":"mulch"}\n',
    );
  });

  test("nothing was destroyed: the pruned words stay on the map", () => {
    const linked = afterHonesty();
    const files = filesOf(linked);
    for (const slug of AVAILABLE) {
      expect(files[REFS + slug + ".md"]).toBeDefined();
    }
    // drift — shelved, marked and pruned throughout — is still out of play and
    // still on the map: visible in context, never a wall.
    expect(outOfPlay(linked.model, null, "drift")).toBe(true);
    expect(linked.model!.words).not.toContain("drift");
    expect(linked.marks).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------
 * 7. Records byte-exact: nothing lost, the prior sets not among them.
 * ---------------------------------------------------------------------- */

describe("records byte-exact: earlier work reads as it was left", () => {
  test("words, distances, marks, pointers, loops and assumptions are untouched", () => {
    const start = recordsOf(fresh());
    const end = recordsOf(afterHonesty());
    for (const path of Object.keys(start)) {
      if (path === "map/links.jsonl") continue; // the two authored links
      expect(end[path]).toBe(start[path]);
    }
    for (const slug of AVAILABLE) {
      expect(end[REFS + slug + ".md"]).toBe(start[REFS + slug + ".md"]);
    }
    expect(end["map/distances.jsonl"]).toBe(start["map/distances.jsonl"]);
    expect(end["map/marks.jsonl"]).toBe(start["map/marks.jsonl"]);
    expect(end["map/pointers.jsonl"]).toBe(start["map/pointers.jsonl"]);
    expect(end["map/loops.jsonl"]).toBe(start["map/loops.jsonl"]);
    expect(end["map/assumptions.jsonl"]).toBe(start["map/assumptions.jsonl"]);
    // The link file holds exactly the two authored lines, in order.
    expect(end["map/links.jsonl"]).toBe(
      '{"from":"rain","sign":"+","to":"soil"}\n{"from":"rain","sign":"+","to":"mulch"}\n',
    );
    expect(end["map/model.json"]).toBe(
      '{\n  "words": [\n    "mulch",\n    "rain",\n    "soil",\n    "stone"\n  ]\n}\n',
    );
  });

  test("quit and reopen: every record round-trips byte-exactly", () => {
    const final = afterHonesty();
    const files = filesOf(final);
    const reopened = readJourney(files);
    expect(filesOf(reopened)).toEqual(files);
    expect(reopened.model!.words).toEqual(["mulch", "rain", "soil", "stone"]);
    expect(levelOfText(files["workspace.yml"])).toBe("dynamics");
    expect(authoringLive("dynamics", reopened.model)).toBe(true);
  });

  test("the prior sets are not among the records; there is no history file", () => {
    const first = serializeModel(play(["mulch", "rain", "soil"]));
    const recircle = serializeModel(play(["rain", "soil", "stone"]));
    const files = filesOf(afterHonesty());
    for (const text of Object.values(files)) {
      expect(text).not.toContain(first);
      expect(text).not.toContain(recircle);
    }
    expect(
      Object.keys(files).filter((path) =>
        /history|circle|draft|selection|prior/.test(path),
      ),
    ).toEqual([]);
    // The accepted set is the record: one key, membership.
    expect(Object.keys(JSON.parse(files["map/model.json"]))).toEqual(["words"]);
    // No extra state rides in the model's unknown keys.
    expect(parseModel(files["map/model.json"]).model!.extra).toEqual({});
  });

  test("the negative space: no score, no counter, no stored circle state", () => {
    // The only appearance of the selector is the record layer's one write; the
    // app's UI counts nothing about it.
    expect(appSource).not.toContain("streak");
    expect(appSource).not.toContain("score");
    expect(selectorSource).not.toContain("streak");
    expect(selectorSource).not.toContain("score");
    // The one automatic appearance is the resume prompt, guarded to once.
    expect(appSource).toContain("autoPromptedRef.current === workspace.path");
    // The close path is quiet: no confirm, no alert, no write.
    const close = callbackBody(appSource, "closeSelector");
    expect(close).not.toContain("acceptPlayingSet");
    expect(close).not.toContain("openSelector");
  });
});

/* -------------------------------------------------------------------------
 * 8. The retired inventory stays retired (Epic 7 story 1's scans).
 * ---------------------------------------------------------------------- */

describe("the retired doc lines stay retired", () => {
  const adr = (name: string) => read("../../adr/" + name);

  test("the selector's doc keeps its reshape and never promises a second wash", () => {
    expect(selectorSource).not.toContain("relationships stay Epic 7's");
    expect(selectorSource).toContain("the relationship form dissolved");
    expect(selectorSource).not.toContain("sits behind a pale wash");
  });

  test("model.ts keeps the deliberate-entry wording and the draft's view note", () => {
    expect(modelSource).not.toContain("opens before play");
    expect(modelSource).toContain("only a DELIBERATE entry asks for it");
    expect(modelSource).toContain("A draft is a VIEW, never a record");
  });

  test("the canvas still says ONE wash, two signals", () => {
    expect(cssSource).not.toContain("sits behind a pale wash");
    expect(cssSource).toContain("ONE wash, two signals");
  });

  test("ADR-0013 carries its retirements", () => {
    const source = adr("adr-0013-the-playing-set-is-literal.md");
    expect(source).not.toContain("(Epic 7's tool, not its rhythm)");
    expect(source).toContain("the circle's word form IS this selection");
    expect(source).not.toContain("and reshapes *(Retired");
    expect(source).toContain("at its own\n   epic. *(Retired 2026-11-15");
    expect((source.match(/Retired 2026-11-15/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  test("ADR-0016 keeps its two stale spots retired", () => {
    const source = adr("adr-0016-level-2-is-a-mode.md");
    expect(source).not.toContain("relationship selection stays Epic 7's");
    expect(source).toContain(
      "the playing-set selector is **words only** *(Retired 2026-11-15",
    );
    expect(source).toContain("the slice, provisional. *(Retired 2026-11-15");
    expect((source.match(/Retired 2026-11-15/g) ?? []).length).toBe(2);
    expect(source).toContain("the circle's word form is the selector");
  });

  test("ADR-0018's amendment points at dissolved ground, not a live ticket", () => {
    const source = adr("adr-0018-zoom-is-the-level.md");
    expect(source).not.toContain("only the relationship form remains unconsumed");
    expect(source).not.toContain("that is the relationship-selection ticket's ground");
    expect(source).toContain("the relationship form dissolved at Epic 7 as well");
    expect(source).toContain("no part of the circle gesture remains unconsumed");
    expect(source).toContain("01-the-reshape-what-the-magic-circle-is-now.md");
  });

  test("ADR-0006's context keeps its retirement note", () => {
    const source = adr("adr-0006-distance-record-shape.md");
    expect(source).toContain(
      "Retired 2026-11-15 — Relationship selection dissolved the door",
    );
    expect(source).toContain("relations enter the model by authoring links");
  });
});
