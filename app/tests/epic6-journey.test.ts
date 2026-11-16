import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
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
} from "../src/map/links";
import { serializeLoops, type Loop } from "../src/map/loops";
import {
  markTargetKey,
  parseMarks,
  serializeMarks,
  withMark,
  type Mark,
} from "../src/map/marks";
import { parseModel, serializeModel, type PlayingSet } from "../src/map/model";
import {
  addPointer,
  parsePointers,
  serializePointers,
  type Pointer,
} from "../src/map/pointers";
import {
  parseReference,
  serializeReference,
  type Reference,
} from "../src/map/refs";
import { parseYamlFields, workspaceYml } from "../src/lib/serialize";
import { centerOf, DEFAULT_BOX, type Point } from "../src/canvas/geometry";
import {
  createLevelPin,
  focusStateOf,
  NO_FOCUS,
  shouldPinLevel,
  type LevelPin,
} from "../src/canvas/gates";
import {
  followControlView,
  followTargets,
  screenPointOf,
} from "../src/canvas/followRules";
import {
  CUE_BANDS,
  cueShownIn,
  reachCue,
  type PresenceCue,
} from "../src/canvas/presenceRules";
import {
  NOTICE_FAMILY_GAME,
  noticeGame,
  noticeGroups,
  noticeVisibleIn,
} from "../src/canvas/notices";
import { PEEK_TOOLTIP, resolveTarget } from "../src/canvas/outwardRules";
import { showsMapContent } from "../src/canvas/mapContentRules";
import {
  BAND_ZOOM,
  distanceLabelVisible,
  DYNAMICS_FROM,
  GROUND_FROM,
  linkWiresVisible,
  noteBand,
} from "../src/canvas/zoomBands";
import {
  INITIAL_CAMERA,
  cameraOf,
  initialMapCameras,
  withCameraOf,
  zoomAbout,
  type Camera,
  type MapCameras,
} from "../src/canvas/useCamera";
import {
  DEFAULT_LEVEL,
  levelFromZoom,
  levelOfText,
  LEVELS,
  RENDER_MAP,
  withLevel,
  type Level,
} from "../src/workspace/level";
import {
  createLevelHandoff,
  type HandoffCause,
  type LevelHandoff,
} from "../src/workspace/levelHandoff";

/**
 * Epic 6's plain-language check, automated at the record layer (story 4).
 *
 * The human half — the feel of zoom-as-level, the anchored jump landing, the
 * pin holding under the wheel, the real quit/reopen — is the queued
 * real-window pass. This file walks the LOCKED check's record half through the
 * pure modules and the files' bytes only, no DOM:
 *
 *   SET UP one word: two distances to partners, a signed link on one of those
 *   pairs, a reach whose target this machine can read, and a cast bare lack.
 *   Walk the word through the three games at the check's own zooms — concept
 *   (its distances), dynamics (its links and signs, the pair as two families),
 *   ground (its reach) — and assert that NOTHING anywhere shows the three uses
 *   as one definition. Leave a face behind (another word, another band) and
 *   come back: every map record is byte-exact (the camera's place need not be;
 *   the level is the hint, and it may have moved on). Quit, reopen: the key
 *   resumes the game, opening writes NOTHING, and every record reads exactly as
 *   left. The pinning invariant is asserted with typed text: the level holds
 *   while a gesture is armed or a field has focus, and the release runs the
 *   switch path. The anchored follow's pure math keeps the word under the eye.
 *   No counter, no score, no verdict, no window record, no assistant.
 *
 * The LOCKED check lives in .scratch/epic-6/issues/05-epic-6-check-and-slice.md
 * (its Answer); ADR-0018 is the binding, ADR-0019 the no-aggregation rule.
 * Provisional readings of the check are named where they occur.
 */

const WS = "/home/maps/attention";
const REFS = "map/references/";
/** The reach's authored target: a workspace path, readable on THIS machine. */
const REACH = "notes/rain-gutter.md";
/** The bare lack's spot on the plane. */
const LACK: Point = { x: 512, y: 640 };
type Files = Record<string, string>;

interface Journey {
  refs: Reference[];
  /** The playing set the signed link was authored under (ADR-0013's door). */
  model: PlayingSet;
  distances: Distance[];
  links: Link[];
  marks: Mark[];
  pointers: Pointer[];
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

function openSpot(x: number, y: number): Mark {
  return { kind: "open", target: { type: "spot", x, y }, extra: {} };
}

function claim(text: string, target: AssumptionTarget): Assumption {
  return { text, target, extra: {} };
}

function loop(name: string, path: string[]): Loop {
  return { name, path, extra: {} };
}

function lines(...entries: string[]): string {
  return entries.join("\n") + "\n";
}

/**
 * THE SETUP LEG, in the check's words: one word (rain) carrying two distances
 * to partners (soil, mulch), a signed link sitting on ONE of those pairs
 * (rain to soil), a reach whose target this machine can read (a workspace
 * path), and a cast bare lack (an open mark on a spot of plane).
 *
 * Provisional reading: the playing set is included because a signed link is
 * dynamics' record and the dynamics game requires an accepted set at authoring
 * (ADR-0013) — the check's setup implicitly holds one. The set is dynamics'
 * own record, not a face on any word.
 */
function setup(): Journey {
  let distances = coinDistance([], "rain", "soil", "waters");
  distances = coinDistance(distances, "rain", "mulch", "feeds");
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
    ],
    model: play(["mulch", "rain", "soil"]),
    distances,
    links: drawLink([], "rain", "soil", "+"),
    marks: withMark([], openSpot(LACK.x, LACK.y)),
    pointers: addPointer([], "rain", "path", REACH),
  };
}

/** A word's centre on the plane, the app's own anchor math. */
function centreOfWord(journey: Journey, slug: string): Point {
  const ref = journey.refs.find((candidate) => candidate.slug === slug);
  if (!ref) throw new Error("the journey must keep the word “" + slug + "”");
  return centerOf({ x: ref.x, y: ref.y }, DEFAULT_BOX);
}

const RAIN = centreOfWord(setup(), "rain");

/* -------------------------------------------------------------------------
 * The workspace's bytes: the app's writes, no fs bridge.
 * ---------------------------------------------------------------------- */

/**
 * Write the journey the way the app does. The map's files are the records'
 * canonical bytes; workspace.yml is the scaffold with the level line the
 * handoff's ONE trigger would have written — absent until the first crossing,
 * exactly as a fresh workspace is (absent = concept, ADR-0016).
 */
function write(journey: Journey, level: Level | null): Files {
  const files: Files = {
    "workspace.yml":
      level === null ? workspaceYml() : withLevel(workspaceYml(), level),
    "map/model.json": serializeModel(journey.model),
    "map/distances.jsonl": serializeDistances(journey.distances),
    "map/links.jsonl": serializeLinks(journey.links),
    "map/marks.jsonl": serializeMarks(journey.marks),
    "map/pointers.jsonl": serializePointers(journey.pointers),
  };
  for (const ref of journey.refs) {
    if (ref.slug === null) throw new Error("a coined word must have a slug");
    files[REFS + ref.slug + ".md"] = serializeReference(ref);
  }
  return files;
}

/** The files the map owns — everything but the level's key. */
function mapOnly(files: Files): Files {
  const out: Files = {};
  for (const path of Object.keys(files)) {
    if (path === "workspace.yml") continue;
    out[path] = files[path];
  }
  return out;
}

/** The level line's value, or null when the key is absent (a fresh file). */
function readKey(files: Files): Level | null {
  const text = files["workspace.yml"];
  return /^\s*level\s*:/m.test(text) ? levelOfText(text) : null;
}

/** Quit and reopen: read every record back and assert the next write's bytes. */
function readJourney(files: Files): Journey {
  if (readKey(files) !== null) {
    // The key is the resume hint (ADR-0018): re-writing it changes no byte.
    expect(
      withLevel(files["workspace.yml"], levelOfText(files["workspace.yml"])),
    ).toBe(files["workspace.yml"]);
  }

  const refs: Reference[] = [];
  for (const path of Object.keys(files).sort()) {
    if (!path.startsWith(REFS) || !path.endsWith(".md")) continue;
    const text = files[path];
    const slug = path.slice(REFS.length, -3);
    const parsed = parseReference(slug, slug, text);
    expect(serializeReference(parsed)).toBe(text);
    refs.push(parsed);
  }

  const modelText = files["map/model.json"];
  const parsedModel = parseModel(modelText);
  expect(parsedModel.model).not.toBeNull();
  expect(serializeModel(parsedModel.model, parsedModel.malformed)).toBe(
    modelText,
  );

  const distances = parseDistances(files["map/distances.jsonl"]);
  expect(serializeDistances(distances.distances, distances.malformed)).toBe(
    files["map/distances.jsonl"],
  );

  const links = parseLinks(files["map/links.jsonl"]);
  expect(serializeLinks(links.links, links.malformed)).toBe(
    files["map/links.jsonl"],
  );

  const marks = parseMarks(files["map/marks.jsonl"]);
  expect(serializeMarks(marks.marks, marks.malformed)).toBe(
    files["map/marks.jsonl"],
  );

  const pointers = parsePointers(files["map/pointers.jsonl"]);
  expect(serializePointers(pointers.pointers, pointers.malformed)).toBe(
    files["map/pointers.jsonl"],
  );

  return {
    refs,
    model: parsedModel.model!,
    distances: distances.distances,
    links: links.links,
    marks: marks.marks,
    pointers: pointers.pointers,
  };
}

/* -------------------------------------------------------------------------
 * The rig: the app's handoff, pin and camera, over the journey's bytes.
 * ---------------------------------------------------------------------- */

interface Switch {
  level: Level;
  cause: HandoffCause;
}

/**
 * CONVERTED (hidden 2026-11-16 per user review — separate mini-apps, ADR-0032):
 * the rig is the app's level machinery in the NEW shape. The level TABS switch
 * the maps (the handoff's `jump`, which writes the resume hint); the wheel only
 * zooms within the current map and hands nothing to the handoff; each map keeps
 * its OWN camera, so a switch comes back exactly where that map was left. The
 * band machinery (the pin, the derivation, the settle cause) is still the
 * handoff's — reachable, and proven alive — and the app simply stops calling it.
 */

interface Rig {
  journey: Journey;
  handoff: LevelHandoff;
  pin: LevelPin;
  switched: Switch[];
  saved: Level[];
  /** The local draft standing for the text in the focused field. */
  draft: () => string;
  type: (text: string) => void;
  /** How many times the switch path ran (a restore runs none). */
  closes: () => number;
  /** The running map — set by a tab press or the open-restore, never a zoom. */
  level: () => Level;
  /** The key's value on disk (null until the first tab press writes it). */
  key: () => Level | null;
  /** The RUNNING MAP's own camera (a switch brings the map back as it was). */
  camera: () => Camera;
  files: () => Files;
  /**
   * A wheel that settled AT the anchor word: ordinary zoom, and NOTHING handed
   * to the handoff (the return is always null — the wheel switches no map).
   */
  settle: (zoom: number, pinned?: boolean) => number | null;
  /** The pin lifted: retired (nothing was held), the machinery is alive. */
  release: () => void;
  /** A TAB press: switch maps. No camera move — the map has its own. */
  jump: (level: Level) => void;
  /** A word's follow control: the same switch trigger (it moves no camera). */
  follow: (word: Point, level: Level) => void;
}

/**
 * The app, reduced to its map machinery (App.tsx's real wiring, in the shape the
 * fourth review left it): the handoff starts at the default map and the
 * open-restore sets the MAP from the key (never writes, never moves a camera);
 * a TAB press is the handoff's jump — the one write trigger — and the wheel only
 * zooms the running map's own camera. The level pin and the handoff's settle are
 * still built here (machinery alive) and no wheel path calls them: the app gates
 * them behind `zoomSwitchesMap` (canvas/shelfRules.ts).
 */
function createRig(files: Files, restore: boolean): Rig {
  const journey = readJourney(files);
  let keyState = readKey(files);
  const switched: Switch[] = [];
  const saved: Level[] = [];
  let closes = 0;
  let draft = "";
  // ONE camera per map (PROVISIONAL): a tab switch restores that map exactly.
  let cameras: MapCameras = initialMapCameras();
  const wordCentre = centreOfWord(journey, "rain");
  const running = (): Level => handoff.level();
  const cameraState = (): Camera => cameraOf(cameras, running());
  const zoomRunningMap = (zoom: number, anchor: Point): void => {
    cameras = withCameraOf(
      cameras,
      running(),
      zoomAbout(cameraState(), zoom, anchor.x, anchor.y),
    );
  };

  const handoff = createLevelHandoff(DEFAULT_LEVEL, {
    onSwitch: (next, cause) => {
      switched.push({ level: next, cause });
      // The full switch path closes every transient and its text; an
      // open-restore has no transient to close (App.tsx's switchLevel returns
      // early for cause restore).
      if (cause === "restore") return;
      closes += 1;
      draft = "";
    },
    // RETIRED (hidden 2026-11-16 per user review): the camera is no longer
    // moved "into a band". Each map keeps its own camera, so the app passes a
    // no-op here — the band intent (`setZoomBand`) stays written in useCamera.ts.
    moveCamera: () => undefined,
    save: async (next) => {
      saved.push(next);
      // saveWorkspaceLevel reads workspace.yml and rewrites its level line
      // (withLevel); the journey writes that file nowhere else, so the key's
      // value is the whole effect.
      keyState = next;
    },
  });
  const pin = createLevelPin();

  const rig: Rig = {
    journey,
    handoff,
    pin,
    switched,
    saved,
    draft: () => draft,
    type: (text) => {
      draft += text;
    },
    closes: () => closes,
    level: () => handoff.level(),
    key: () => keyState,
    camera: () => cameraState(),
    files: () => write(journey, keyState),
    settle: (zoom) => {
      // The person wheels AT the word: the RUNNING MAP's camera zooms about the
      // word's own screen point, so it stays under the eye. The handoff is never
      // told — a zoom switches no map — so nothing is returned.
      //
      // DEPRECATED (hidden 2026-11-16 per user review): this used to ask the
      // level pin and hand a crossing to `handoff.settle`. The pin still works
      // (`rig.pin`) and the machinery is asserted alive below; the app just
      // never asks it.
      zoomRunningMap(zoom, screenPointOf(wordCentre, cameraState()));
      return null;
    },
    release: () => {
      // RETIRED: the pin held a wheel crossing; with no crossing there is
      // nothing to release. The pure pin is still exercised (tests/level-pinning).
      void pin.held();
    },
    jump: (next) => handoff.jump(next),
    follow: (word, next) => handoff.jump(next),
  };

  // The app's open: the key sets the MAP (its own camera comes with it) and
  // writes NOTHING.
  if (restore) handoff.restore(keyState ?? DEFAULT_LEVEL);
  return rig;
}

/** A fresh workspace: the setup, its key absent (a first open reads concept). */
function freshRig(): Rig {
  return createRig(write(setup(), null), true);
}

/** Quit and reopen over the rig's current bytes. */
function reopen(rig: Rig): Rig {
  return createRig(rig.files(), true);
}

/* -------------------------------------------------------------------------
 * 1. The setup leg.
 * ---------------------------------------------------------------------- */

describe("the setup leg: one word, two distances, a signed link, a reach and a bare lack", () => {
  test("the word carries two distances, one to each partner", () => {
    const files = write(setup(), null);
    expect(files["map/distances.jsonl"]).toBe(
      lines(
        '{"from":"rain","to":"soil","word":"waters"}',
        '{"from":"rain","to":"mulch","word":"feeds"}',
      ),
    );
    const distances = parseDistances(files["map/distances.jsonl"]).distances;
    const onRain = distances.filter((distance) => distance.from === "rain");
    expect(onRain.map((d) => d.from + " to " + d.to + " · " + d.word)).toEqual([
      "rain to soil · waters",
      "rain to mulch · feeds",
    ]);
    // Two DIFFERENT partners: two distances, not one pair twice.
    expect(new Set(onRain.map((d) => d.to)).size).toBe(2);
    expect(onRain.map((d) => d.to).sort()).toEqual(["mulch", "soil"]);
  });

  test("the signed link sits on one of those pairs — two families, never merged", () => {
    const files = write(setup(), null);
    const distances = parseDistances(files["map/distances.jsonl"]).distances;
    const links = parseLinks(files["map/links.jsonl"]).links;

    expect(files["map/links.jsonl"]).toBe(
      '{"from":"rain","sign":"+","to":"soil"}\n',
    );
    expect(links).toHaveLength(1);
    const link = links[0];
    expect(link).toEqual({ from: "rain", to: "soil", sign: "+", extra: {} });

    // The link's ordered pair IS one of the distances' pairs (the pair spine,
    // ADR-0014): the same two words, in the same direction.
    const distance = distances.find(
      (candidate) =>
        candidate.from === link.from && candidate.to === link.to,
    );
    expect(distance).toBeDefined();
    expect(distance!.word).toBe("waters");

    // The two families over ONE pair are never merged into one record: the
    // distance carries the word and no sign; the link carries the sign and no
    // word. A merged line would fit neither family's shape (asserted below).
    expect(files["map/distances.jsonl"]).toContain('"word":"waters"');
    expect(files["map/links.jsonl"]).toContain('"sign":"+"');
    expect(files["map/distances.jsonl"]).not.toContain('"sign"');
    expect(files["map/links.jsonl"]).not.toContain('"word"');
  });

  test("the reach is one line whose authored form is a target this machine can read", () => {
    const files = write(setup(), null);
    expect(files["map/pointers.jsonl"]).toBe(
      '{"on":"rain","path":"notes/rain-gutter.md"}\n',
    );
    const pointer = parsePointers(files["map/pointers.jsonl"]).pointers[0];
    expect(pointer).toEqual({
      on: "rain",
      form: "path",
      value: REACH,
      extra: {},
    });
    // The form is the person's authored pick, resolved against the workspace
    // root exactly as written (World B): THIS machine can read it.
    expect(pointer.form).toBe("path");
    expect(resolveTarget(pointer.form, pointer.value, WS)).toEqual({
      kind: "file",
      path: WS + "/" + REACH,
    });
    // The window is an open-moment glimpse, not a record.
    expect(PEEK_TOOLTIP).toBe("an open-moment glimpse — reopen to refresh");
  });

  test("the bare lack is a cast mark on a spot of plane — and it names no word", () => {
    const files = write(setup(), null);
    expect(files["map/marks.jsonl"]).toBe('{"kind":"open","x":512,"y":640}\n');
    const marks = parseMarks(files["map/marks.jsonl"]).marks;
    expect(marks).toHaveLength(1);
    expect(marks[0].target).toEqual({ type: "spot", x: 512, y: 640 });
    expect(markTargetKey(marks[0].target)).toBe("spot\u0000512\u0000640");
    // A lack is pre-verbal: no word, no owner, no text.
    expect(files["map/marks.jsonl"]).not.toContain('"on"');
    expect(files["map/marks.jsonl"]).not.toContain('"text"');
  });

  test("the word's own file is its name, its place and its memory — nothing else", () => {
    const files = write(setup(), null);
    const rainFile = files[REFS + "rain.md"];
    expect(rainFile).toBe(
      [
        "---",
        'name: "rain"',
        "x: 220",
        "y: 180",
        "---",
        "the water that arrives without being asked",
        "",
      ].join("\n"),
    );
    const parsed = parseReference("rain", "rain", rainFile);
    expect(parsed.body).toBe("the water that arrives without being asked\n");
    expect(parsed.extra).toEqual({});
    // The memory is the word's own thought (ADR-0019): the reach, the distance
    // word and the sign live in their own records, never in this prose.
    expect(rainFile).not.toContain(REACH);
    expect(rainFile).not.toContain("waters");
    expect(rainFile).not.toContain("feeds");
    // A partner's file is the same shape: name, place, memory.
    expect(parseReference("soil", "soil", files[REFS + "soil.md"]).body).toBe("");
    expect(parseReference("mulch", "mulch", files[REFS + "mulch.md"]).body).toBe(
      "a slow sponge\n",
    );
  });

  test("a fresh workspace carries no key until the first crossing (absent = concept)", () => {
    const files = write(setup(), null);
    expect(files["workspace.yml"]).toBe(workspaceYml());
    expect(files["workspace.yml"]).not.toContain("level:");
    expect(levelOfText(files["workspace.yml"])).toBe(DEFAULT_LEVEL);
    // The setup wrote no other file: no loop, no assumption, no window record.
    const map = mapOnly(files);
    expect(Object.keys(map).sort()).toEqual([
      "map/distances.jsonl",
      "map/links.jsonl",
      "map/marks.jsonl",
      "map/model.json",
      "map/pointers.jsonl",
      "map/references/mulch.md",
      "map/references/rain.md",
      "map/references/soil.md",
    ]);
    for (const path of Object.keys(files)) {
      expect(path).not.toMatch(/window|peek|glimpse/i);
    }
  });
});

/* -------------------------------------------------------------------------
 * 2. The derivation across the three bands, at the check's legs.
 * ---------------------------------------------------------------------- */

describe("levelFromZoom across all three bands, at the check's label-legible legs", () => {
  /** The three things the person says, at the three zooms the check names. */
  const LEGS: Array<{ game: Level; zoom: number }> = [
    { game: "concept", zoom: BAND_ZOOM.concept },
    { game: "dynamics", zoom: BAND_ZOOM.dynamics },
    { game: "ground", zoom: BAND_ZOOM.ground },
  ];

  test("each leg's zoom derives the game it says, and the distance words are legible", () => {
    for (const leg of LEGS) {
      expect(levelFromZoom(leg.zoom)).toBe(leg.game);
      // The check's own condition: the pair reads at these zooms.
      expect(distanceLabelVisible(leg.zoom)).toBe(true);
      expect(noteBand(leg.zoom)).toBe("full");
    }
    // The three legs are strictly ordered, like the games they name; the
    // landing zooms are provisional, so only the order is pinned here.
    const zooms = LEGS.map((leg) => leg.zoom);
    expect(new Set(zooms).size).toBe(3);
    expect(zooms).toEqual([...zooms].sort((a, b) => a - b));
    expect(LEGS.map((leg) => levelFromZoom(leg.zoom))).toEqual([...LEVELS]);
  });

  test("the bands tile the camera's range: inclusive floor, exclusive top", () => {
    expect(levelFromZoom(DYNAMICS_FROM - 0.001)).toBe("concept");
    expect(levelFromZoom(DYNAMICS_FROM)).toBe("dynamics");
    expect(levelFromZoom(GROUND_FROM - 0.001)).toBe("dynamics");
    expect(levelFromZoom(GROUND_FROM)).toBe("ground");
    // Garbage is the default game, never a crash and never a third reading.
    for (const garbage of [NaN, Infinity, -Infinity]) {
      expect(levelFromZoom(garbage)).toBe(DEFAULT_LEVEL);
    }
  });

  test("a crossing writes only the game the band entered (the key's value)", () => {
    for (const leg of LEGS) {
      const files = write(setup(), leg.game);
      expect(levelOfText(files["workspace.yml"])).toBe(leg.game);
      expect(files["workspace.yml"]).toBe(withLevel(workspaceYml(), leg.game));
    }
    // The three keys differ only on their level line, never on a map byte.
    const a = write(setup(), "concept");
    const b = write(setup(), "ground");
    expect(mapOnly(a)).toEqual(mapOnly(b));
  });

  test("each leg shows its own family and not another's (what the person can say)", () => {
    // Concept: the distances read (labels visible); dynamics' links and
    // ground's reach are not shown.
    expect(linkWiresVisible("concept")).toBe(false);
    expect(cueShownIn("assumptions", "concept")).toBe(false);
    expect(cueShownIn("reach", "concept")).toBe(false);
    // Dynamics: the links and the diamond; the reach is not shown.
    expect(linkWiresVisible("dynamics")).toBe(true);
    expect(cueShownIn("assumptions", "dynamics")).toBe(true);
    expect(cueShownIn("reach", "dynamics")).toBe(false);
    // Ground: the reach; the links and the diamond are not shown.
    expect(linkWiresVisible("ground")).toBe(false);
    expect(cueShownIn("assumptions", "ground")).toBe(false);
    expect(cueShownIn("reach", "ground")).toBe(true);
    // DEPRECATED (hidden 2026-11-16 per separate-maps review): converted from
    // "the concept family reads in EVERY game" — the pair no longer renders off
    // concept. The LABEL rule still reads at every band's landing zoom (that is
    // the machinery the sweep keeps), while the render is concept-only.
    for (const level of LEVELS) {
      expect(RENDER_MAP.all).toContain("distances" as never);
      expect(distanceLabelVisible(BAND_ZOOM[level])).toBe(true);
      expect({ level, renders: showsMapContent(level) }).toEqual({
        level,
        renders: level === "concept",
      });
    }
  });
});

/* -------------------------------------------------------------------------
 * 3. The TABS switch the maps; the wheel never does; restore never writes.
 * ---------------------------------------------------------------------- */

/**
 * CONVERTED (hidden 2026-11-16 per user review — separate mini-apps, ADR-0032).
 * This section used to prove the strict handoff by WHEEL: a settled crossing was
 * derived into a band, the game switched and the key was rewritten. The review's
 * verdict is that the maps are separate mini-apps and the TABS switch them, so
 * the same walks now assert the NEW state — a wheel changes nothing but the
 * running map's camera, a tab press is the one write trigger, each map comes
 * back with its own camera, and the retired machinery is still alive for the
 * flip-back (the pure pin, the derivation, the handoff's settle).
 */
describe("the TABS switch the maps; the wheel never does; restore never writes", () => {
  test("a wheel through every old band boundary switches nothing", async () => {
    const rig = freshRig();
    const before = rig.files();
    expect(rig.level()).toBe("concept");
    expect(rig.key()).toBeNull();
    expect(rig.saved).toEqual([]);

    // The two old band landings and one zoom past both: the zooms that used to
    // change the game change nothing now.
    expect(levelFromZoom(BAND_ZOOM.dynamics)).toBe("dynamics");
    expect(levelFromZoom(BAND_ZOOM.ground)).toBe("ground");
    for (const zoom of [BAND_ZOOM.dynamics, BAND_ZOOM.ground, 3]) {
      expect(rig.settle(zoom)).toBeNull();
    }
    expect(rig.switched).toEqual([]);
    expect(rig.saved).toEqual([]);
    expect(rig.key()).toBeNull();
    expect(rig.level()).toBe("concept");
    // The camera did move — ordinary within-map zoom, nothing else.
    expect(rig.camera().zoom).toBe(3);
    expect(mapOnly(rig.files())).toEqual(mapOnly(before));
  });

  test("a tab press switches the map and writes the hint byte-exactly", async () => {
    const rig = freshRig();
    const before = rig.files();
    rig.jump("dynamics");
    expect(rig.switched).toEqual([{ level: "dynamics", cause: "jump" }]);
    expect(rig.level()).toBe("dynamics");
    await rig.handoff.idle();

    expect(rig.saved).toEqual(["dynamics"]);
    const files = rig.files();
    expect(files["workspace.yml"]).toBe(withLevel(workspaceYml(), "dynamics"));
    expect(files["workspace.yml"]).toContain('level: "dynamics"');
    expect(levelOfText(files["workspace.yml"])).toBe("dynamics");
    // Every comment, the format key and the fold stay exactly as they were.
    expect(files["workspace.yml"].startsWith(workspaceYml())).toBe(true);
    // Nothing in the map moved: a switch is a map fact only.
    expect(mapOnly(files)).toEqual(mapOnly(before));
  });

  test("each map keeps its OWN camera: switching back restores it exactly", async () => {
    const rig = freshRig();
    // Work on the concept map: zoom in at the word.
    rig.settle(1.4);
    const concept = rig.camera();
    expect(concept.zoom).toBeCloseTo(1.4, 10);
    expect(concept).not.toEqual(INITIAL_CAMERA);

    rig.jump("dynamics");
    await rig.handoff.idle();
    // The dynamics map opens on ITS camera, not the concept one.
    expect(rig.camera()).toEqual(cameraOf(initialMapCameras(), "dynamics"));
    expect(rig.camera().zoom).toBe(BAND_ZOOM.dynamics);

    // Come back to concept: exactly the view left behind, like a little app.
    rig.jump("concept");
    await rig.handoff.idle();
    expect(rig.camera()).toEqual(concept);
    expect(rig.files()["workspace.yml"]).toBe(
      withLevel(workspaceYml(), "concept"),
    );
  });

  test("the follow control is the same switch trigger and moves no camera", async () => {
    const rig = freshRig();
    rig.settle(BAND_ZOOM.ground);
    const concept = rig.camera();
    rig.follow(RAIN, "ground");
    expect(rig.switched).toEqual([{ level: "ground", cause: "jump" }]);
    await rig.handoff.idle();
    expect(rig.saved).toEqual(["ground"]);
    expect(rig.files()["workspace.yml"]).toBe(
      withLevel(workspaceYml(), "ground"),
    );
    // The ground map's own camera; the concept map's view is untouched.
    expect(rig.camera().zoom).toBe(BAND_ZOOM.ground);
    rig.jump("concept");
    await rig.handoff.idle();
    expect(rig.camera()).toEqual(concept);
  });

  test("quit, reopen: the key resumes the MAP, opening writes NOTHING, every record reads as left", async () => {
    const rig = freshRig();
    rig.jump("dynamics");
    await rig.handoff.idle();
    rig.follow(RAIN, "ground");
    await rig.handoff.idle();
    const files = rig.files();
    expect(files["workspace.yml"]).toBe(withLevel(workspaceYml(), "ground"));

    // Quit and reopen over the very bytes (readJourney asserts each record's
    // next write is byte-identical).
    const reopened = reopen(rig);
    expect(reopened.level()).toBe("ground");
    expect(reopened.switched).toEqual([{ level: "ground", cause: "restore" }]);
    // The restore NEVER writes: opening is a read.
    expect(reopened.saved).toEqual([]);
    expect(reopened.key()).toBe("ground");
    expect(reopened.closes()).toBe(0);
    // The resumed map opens on ITS OWN camera (there is no band to land in).
    expect(reopened.camera()).toEqual(cameraOf(initialMapCameras(), "ground"));
    expect(reopened.files()).toEqual(files);
    expect(reopened.files()["workspace.yml"]).toBe(
      withLevel(workspaceYml(), "ground"),
    );
  });

  test("a hand-edited key is honored on open and rewritten on the first tab press", async () => {
    const rig = freshRig();
    rig.jump("dynamics");
    await rig.handoff.idle();
    const files = rig.files();
    const handEdited: Files = {
      ...files,
      // The person edited the hint by hand: it says ground.
      "workspace.yml": withLevel(files["workspace.yml"], "ground"),
    };

    const reopened = createRig(handEdited, true);
    expect(reopened.key()).toBe("ground");
    expect(reopened.level()).toBe("ground");
    // Honored on open; nothing written.
    expect(reopened.saved).toEqual([]);
    expect(reopened.files()["workspace.yml"]).toBe(handEdited["workspace.yml"]);
    expect(mapOnly(reopened.files())).toEqual(mapOnly(files));

    // A wheel changes nothing at all — not even on a resumed map.
    reopened.settle(BAND_ZOOM.concept);
    await reopened.handoff.idle();
    expect(reopened.saved).toEqual([]);
    expect(reopened.level()).toBe("ground");
    expect(reopened.files()["workspace.yml"]).toBe(handEdited["workspace.yml"]);

    // The first TAB press rewrites the key, and only the key.
    reopened.jump("concept");
    await reopened.handoff.idle();
    expect(reopened.saved).toEqual(["concept"]);
    expect(reopened.files()["workspace.yml"]).toBe(
      withLevel(handEdited["workspace.yml"], "concept"),
    );
    expect(mapOnly(reopened.files())).toEqual(mapOnly(files));
  });

  test("the pin and the derivation are alive: held machinery, no caller", async () => {
    const rig = freshRig();
    // The PURE pin still holds a settled crossing and hands it back on release
    // — the machinery the sweep keeps, exercised directly.
    expect(rig.pin.settle(DYNAMICS_FROM + 0.1, true)).toBeNull();
    expect(rig.pin.held()).toBe(true);
    expect(rig.pin.release(DYNAMICS_FROM + 0.1)).toBe(DYNAMICS_FROM + 0.1);
    expect(rig.pin.held()).toBe(false);

    // The app's wheel path never asks it: the map, the key and the text stay.
    rig.type("half a thought");
    rig.settle(DYNAMICS_FROM + 0.1, true);
    rig.release();
    expect(rig.switched).toEqual([]);
    expect(rig.saved).toEqual([]);
    expect(rig.level()).toBe("concept");
    expect(rig.key()).toBeNull();
    expect(rig.draft()).toBe("half a thought");
  });
});

/* -------------------------------------------------------------------------
 * 4. Nothing is held from the person: the tabs switch on the press.
 * ---------------------------------------------------------------------- */

/**
 * CONVERTED (hidden 2026-11-16 per user review — separate mini-apps, ADR-0032):
 * this section used to prove that an ARMED GESTURE or a FOCUSED FIELD held a
 * wheel crossing so typed text survived it. With the wheel never switching, the
 * text survives by construction (nothing is ever applied), and these tests walk
 * the same gestures to assert that: the wheel is ordinary navigation under a
 * gesture, under focus and under both, and the TAB press is the person's own
 * move (it closes the transient, as the switch path always did).
 */
describe("no zoom is held from the person: the tabs switch on the press", () => {
  test("an armed gesture changes nothing and keeps the typed text", async () => {
    const rig = freshRig();
    rig.type("an assumption in progress");
    const zoom = DYNAMICS_FROM + 0.1;
    expect(shouldPinLevel("selector", NO_FOCUS)).toBe(true);

    rig.settle(zoom, shouldPinLevel("selector", NO_FOCUS));
    expect(rig.level()).toBe("concept");
    expect(rig.switched).toEqual([]);
    expect(rig.saved).toEqual([]);
    expect(rig.closes()).toBe(0);
    expect(rig.draft()).toBe("an assumption in progress");
    // The camera moved; the map did not — and nothing was written.
    expect(rig.camera().zoom).toBeCloseTo(zoom, 10);
    expect(rig.key()).toBeNull();

    // The gesture's end changes nothing either: there is no crossing to apply.
    rig.release();
    expect(rig.switched).toEqual([]);
    expect(rig.saved).toEqual([]);
    expect(rig.draft()).toBe("an assumption in progress");
  });

  test("a focused text field behaves exactly like an armed gesture", async () => {
    const rig = freshRig();
    rig.type("half a thought");
    const focus = focusStateOf({ tagName: "TEXTAREA" });
    expect(focus).toBe("text");
    expect(shouldPinLevel("idle", focus)).toBe(true);

    rig.settle(GROUND_FROM + 0.2, shouldPinLevel("idle", focus));
    expect(rig.level()).toBe("concept");
    expect(rig.saved).toEqual([]);
    expect(rig.draft()).toBe("half a thought");

    rig.release();
    expect(rig.switched).toEqual([]);
    expect(rig.saved).toEqual([]);
    // The same wheel with nothing focused is identical: the pin is moot now.
    const free = freshRig();
    free.type("half a thought");
    free.settle(GROUND_FROM + 0.2, shouldPinLevel("idle", NO_FOCUS));
    expect(free.switched).toEqual([]);
    expect(free.draft()).toBe("half a thought");
  });

  test("a wheel across and back leaves nothing to apply and nothing written", async () => {
    const rig = freshRig();
    rig.type("still here");
    rig.settle(GROUND_FROM + 0.2, true);
    rig.settle(BAND_ZOOM.concept, true);
    rig.release();
    expect(rig.switched).toEqual([]);
    expect(rig.draft()).toBe("still here");
    expect(rig.pin.held()).toBe(false);
    await rig.handoff.idle();
    expect(rig.saved).toEqual([]);
    expect(rig.key()).toBeNull();
    expect(rig.level()).toBe("concept");
  });

  test("a tab press switches under anything: the person, not the wheel", async () => {
    const rig = freshRig();
    rig.type("mid-sentence");
    rig.settle(BAND_ZOOM.ground, true);
    rig.jump("dynamics");
    expect(rig.switched).toEqual([{ level: "dynamics", cause: "jump" }]);
    expect(rig.level()).toBe("dynamics");
    await rig.handoff.idle();
    expect(rig.saved).toEqual(["dynamics"]);
    // The switch path closes the transient and its text — the tab press is the
    // person's own act (the old pin's promise, kept through the switch path).
    expect(rig.closes()).toBe(1);
    expect(rig.draft()).toBe("");
  });
});

/* -------------------------------------------------------------------------
 * 5. Presence cues: in-band rules, nothing cross-band.
 * ---------------------------------------------------------------------- */

describe("presence cues as pure rules: in-band, and nothing cross-band", () => {
  test("the reach handle is ground's, and it reads solid when the word carries one", () => {
    expect(CUE_BANDS.reach).toEqual(["ground"]);
    for (const level of LEVELS) {
      expect(cueShownIn("reach", level)).toBe(level === "ground");
    }
    const hasPointers = setup().pointers.some((pointer) => pointer.on === "rain");
    expect(hasPointers).toBe(true);
    expect(reachCue(hasPointers)).toBe("solid");
    // Presence, never a count: the rule takes a boolean, not the lines.
    expect(reachCue(false)).toBe("faint");
  });

  test("dynamics' cues are dynamics' and only dynamics'", () => {
    for (const cue of ["assumptions", "links", "loops"] as PresenceCue[]) {
      expect(cueShownIn(cue, "dynamics")).toBe(true);
      expect(cueShownIn(cue, "concept")).toBe(false);
      expect(cueShownIn(cue, "ground")).toBe(false);
    }
  });

  test("every cue belongs to exactly one band, and to a band its zoom derives", () => {
    const cues = Object.keys(CUE_BANDS) as PresenceCue[];
    expect(cues.sort()).toEqual(["assumptions", "links", "loops", "reach"]);
    for (const cue of cues) {
      expect(CUE_BANDS[cue]).toHaveLength(1);
      const shown = LEVELS.filter((level) => cueShownIn(cue, level));
      expect(shown).toEqual([CUE_BANDS[cue][0]]);
      // The cue's band is a real band: its landing zoom derives it.
      expect(levelFromZoom(BAND_ZOOM[shown[0]])).toBe(shown[0]);
    }
  });

  test("the notices strip names only the running game's families — never two bands", () => {
    for (const level of LEVELS) {
      const groups = noticeGroups(level);
      expect(groups[0].game).toBe("all");
      const own = groups.filter((group) => group.game !== "all");
      expect(own.map((group) => group.game)).toEqual(
        level === "concept" ? [] : [level],
      );
      for (const group of groups) {
        for (const family of group.families) {
          expect(noticeGame(family)).toBe(group.game);
          expect(noticeVisibleIn(family, level)).toBe(true);
        }
      }
    }
  });

  test("the follow offers the two other games from every game: reachable, never announced", () => {
    for (const level of LEVELS) {
      expect(followTargets(level)).toEqual(
        LEVELS.filter((game) => game !== level),
      );
      // The control's whole input is the running game: no face can reach it.
      expect(Object.keys(followControlView(level))).toEqual(["targets"]);
    }
    // The bare lack, by contrast, is common content: found by looking in every
    // game (a mark renders everywhere), so looking is how the person finds it.
    for (const level of LEVELS) {
      expect(noticeVisibleIn("marks", level)).toBe(true);
    }
  });
});

/* -------------------------------------------------------------------------
 * 6. The negative space: nothing lost; the level is the hint.
 * ---------------------------------------------------------------------- */

describe("the negative space: nothing lost on a crossing; the level is the hint", () => {
  test("leave a face behind — another word, another band — and come back: the records are as left", async () => {
    const rig = freshRig();
    const original = rig.files();

    rig.settle(BAND_ZOOM.dynamics);
    await rig.handoff.idle();
    rig.follow(RAIN, "ground");
    await rig.handoff.idle();
    // Leave: another word (mulch), another band (concept), then come back.
    rig.follow(centreOfWord(rig.journey, "mulch"), "concept");
    expect(rig.level()).toBe("concept");
    await rig.handoff.idle();
    expect(mapOnly(rig.files())).toEqual(mapOnly(original));

    rig.follow(RAIN, "ground");
    await rig.handoff.idle();
    expect(rig.level()).toBe("ground");
    // The camera's place moved on; the map did not. Only the key changed.
    expect(mapOnly(rig.files())).toEqual(mapOnly(original));
    expect(rig.files()["workspace.yml"]).toBe(
      withLevel(workspaceYml(), "ground"),
    );
    // The word's memory is byte-exact; the bare lack is still found by looking.
    expect(rig.files()[REFS + "rain.md"]).toBe(original[REFS + "rain.md"]);
    expect(rig.files()["map/marks.jsonl"]).toBe(
      '{"kind":"open","x":512,"y":640}\n',
    );
  });

  test("the level is the hint: the key may move on while every map record stays byte-exact", async () => {
    const rig = freshRig();
    const originalMap = mapOnly(rig.files());
    const seen: Array<Level | null> = [rig.key()];

    const walk: Array<[Point, Level]> = [
      [RAIN, "dynamics"],
      [RAIN, "ground"],
      [centreOfWord(rig.journey, "mulch"), "concept"],
      [RAIN, "ground"],
    ];
    for (const [word, game] of walk) {
      rig.follow(word, game);
      await rig.handoff.idle();
      seen.push(rig.key());
      expect(rig.files()["workspace.yml"]).toBe(
        withLevel(workspaceYml(), rig.key()!),
      );
      expect(mapOnly(rig.files())).toEqual(originalMap);
    }
    // The key moved on with the person; the map never did.
    expect(seen).toEqual([null, "dynamics", "ground", "concept", "ground"]);
    for (const key of seen) {
      if (key === null) continue;
      expect(levelOfText(withLevel(workspaceYml(), key))).toBe(key);
    }
  });

  test("there is no counter, no score, no verdict, no window record and no definition", () => {
    const files = write(setup(), "ground");
    for (const path of Object.keys(files)) {
      const text = files[path];
      expect(text).not.toMatch(
        /reinforc|balanc|verdict|score|streak|count|tally|progress/i,
      );
      expect(text).not.toMatch(/\bdefinitions?\b|profiles?|aggregat/i);
      expect(path).not.toMatch(/window|peek|glimpse|verdict|score/i);
    }
    // The window's glimpse persists nothing: the reach's record is one line,
    // and reopening is a read of the file as it is now.
    expect(files["map/pointers.jsonl"]).toBe(
      '{"on":"rain","path":"notes/rain-gutter.md"}\n',
    );
    // The level write touches workspace.yml only: the level module's save opens
    // exactly that file, and the handoff imports no record module.
    const levelSource = readFileSync(
      new URL("../src/workspace/level.ts", import.meta.url),
      "utf8",
    );
    expect(levelSource).toContain("workspace.yml");
    expect(levelSource).not.toContain("AGENTS.md");
    const start = levelSource.indexOf(
      "export async function saveWorkspaceLevel",
    );
    expect(start).toBeGreaterThan(-1);
    const saveBody = levelSource.slice(
      start,
      levelSource.indexOf("\n}", start),
    );
    expect(saveBody).toContain("workspace.yml");
    expect(saveBody).not.toMatch(
      /map\/|references|marks|links|pointers|loops|assumptions/,
    );
  });
});

/* -------------------------------------------------------------------------
 * 7. The say-it structural test (ADR-0019).
 * ---------------------------------------------------------------------- */

type Family =
  | "model"
  | "distances"
  | "links"
  | "loops"
  | "assumptions"
  | "marks"
  | "pointers";

interface FamilyShape {
  required: readonly string[];
  allowed: readonly string[];
}

/**
 * Each family's own record shape, stated once. A record fits a family only
 * when every required key is present and no other key appears — so a line
 * carrying two families' fields fits NONE. (A mark's allowed keys include
 * "word" because a wire's mark addresses the distance's natural key; the mark
 * is doubt ABOUT that record, never a merged definition of the word.)
 */
const FAMILY_SHAPES: Record<Family, FamilyShape> = {
  model: { required: ["words"], allowed: ["words"] },
  distances: {
    required: ["from", "to", "word"],
    allowed: ["from", "to", "word"],
  },
  links: { required: ["from", "to", "sign"], allowed: ["from", "to", "sign"] },
  loops: { required: ["name", "path"], allowed: ["name", "path"] },
  assumptions: {
    required: ["text"],
    allowed: ["text", "on", "from", "to", "loop", "x", "y"],
  },
  marks: {
    required: ["kind"],
    allowed: ["kind", "on", "from", "to", "word", "x", "y", "path", "at", "url"],
  },
  pointers: { required: ["on"], allowed: ["on", "path", "at", "url"] },
};

const FAMILIES = Object.keys(FAMILY_SHAPES) as Family[];

function fitsFamily(family: Family, keys: readonly string[]): boolean {
  const shape = FAMILY_SHAPES[family];
  return (
    shape.required.every((key) => keys.includes(key)) &&
    keys.every((key) => shape.allowed.includes(key))
  );
}

/** The families a record's keys fit: exactly one for a family's own record. */
function familiesOf(keys: readonly string[]): Family[] {
  return FAMILIES.filter((family) => fitsFamily(family, keys));
}

function lineKeys(line: string): string[] {
  return Object.keys(JSON.parse(line) as Record<string, unknown>);
}

/** Every JSONL line of a file, as key lists. */
function recordKeyLists(files: Files, path: string): string[][] {
  return files[path]
    .split("\n")
    .filter((line) => line.length > 0)
    .map(lineKeys);
}

describe("the say-it structural test: a word's faces are never aggregated (ADR-0019)", () => {
  test("every record fits exactly one family's shape; a mixed record fits none", () => {
    const files = write(setup(), null);

    // The journey's own records: one family each, every line.
    const expected: Array<[string, Family]> = [
      ["map/distances.jsonl", "distances"],
      ["map/links.jsonl", "links"],
      ["map/marks.jsonl", "marks"],
      ["map/pointers.jsonl", "pointers"],
    ];
    expect(familiesOf(lineKeys(files["map/model.json"]))).toEqual(["model"]);
    for (const [path, family] of expected) {
      for (const keys of recordKeyLists(files, path)) {
        expect(familiesOf(keys)).toEqual([family]);
      }
    }

    // The families this journey does not use fit their own shape too.
    const extra: Array<[Family, string]> = [
      [
        "loops",
        serializeLoops([loop("rain loop", ["rain", "soil", "rain"])]).trimEnd(),
      ],
      ...serializeAssumptions([
        claim("rain is heavy", { type: "word", slug: "rain" }),
        claim("the pair is doubtful", {
          type: "link",
          from: "rain",
          to: "soil",
        }),
        claim("the loop turns", { type: "loop", slug: "rain-loop" }),
        claim("something is missing", { type: "spot", x: 40, y: 60 }),
      ])
        .trimEnd()
        .split("\n")
        .map((line) => ["assumptions", line] as [Family, string]),
      ...serializeMarks([
        { kind: "open", target: { type: "word", slug: "rain" }, extra: {} },
        {
          kind: "open",
          target: { type: "link", from: "rain", to: "soil" },
          extra: {},
        },
        {
          kind: "open",
          target: { type: "wire", from: "rain", to: "soil", word: "waters" },
          extra: {},
        },
        {
          kind: "open",
          target: { type: "pointer", on: "rain", form: "path", value: REACH },
          extra: {},
        },
      ])
        .trimEnd()
        .split("\n")
        .map((line) => ["marks", line] as [Family, string]),
      ...serializePointers([
        { on: "rain", form: "path", value: REACH, extra: {} },
        { on: "rain", form: "at", value: "/home/k/rain.md", extra: {} },
        {
          on: "rain",
          form: "url",
          value: "https://example.org/rain",
          extra: {},
        },
      ])
        .trimEnd()
        .split("\n")
        .map((line) => ["pointers", line] as [Family, string]),
    ];
    for (const [family, line] of extra) {
      expect(familiesOf(lineKeys(line))).toEqual([family]);
    }

    // The shape a "definition" would need — two families in one record — fits
    // no family at all. The structural rule cannot be satisfied by merging.
    expect(familiesOf(["from", "to", "word", "sign"])).toEqual([]);
    expect(familiesOf(["kind", "on", "word", "sign"])).toEqual([]);
    expect(familiesOf(["on", "path", "text"])).toEqual([]);
  });

  test("no record carries an aggregation key (no faces, profile or definition)", () => {
    const files = write(setup(), "dynamics");
    const AGGREGATE =
      /^(faces?|uses|profile|profiles|definition|definitions|meaning|meanings|summary|aggregate|aggregates|identity|identities|all)$/i;
    for (const keys of [lineKeys(files["map/model.json"])]) {
      for (const key of keys) expect(key).not.toMatch(AGGREGATE);
    }
    for (const path of [
      "map/distances.jsonl",
      "map/links.jsonl",
      "map/marks.jsonl",
      "map/pointers.jsonl",
    ]) {
      for (const keys of recordKeyLists(files, path)) {
        for (const key of keys) expect(key).not.toMatch(AGGREGATE);
      }
    }
    // The word's own file names only name/x/y; its memory is prose, not a dump.
    const rainFile = files[REFS + "rain.md"];
    const frontmatter = rainFile.slice(4, rainFile.indexOf("\n---\n"));
    expect(Object.keys(parseYamlFields(frontmatter)).sort()).toEqual([
      "name",
      "x",
      "y",
    ]);
  });

  test("the pure tables assign each family exactly one game (no cross-band aggregator)", () => {
    // The notices strip was the one unbanded aggregator; now each family has
    // one game, and the strip renders the running game's group plus the shared
    // one (never two games at once).
    expect(NOTICE_FAMILY_GAME).toEqual({
      marks: "all",
      links: "dynamics",
      model: "dynamics",
      loops: "dynamics",
      assumptions: "dynamics",
      pointers: "ground",
      // Epic 9 story 1: the veil's unreadable lines are shared-group hygiene —
      // a veil covers Levels 1–2, so no single game owns its notices (ADR-0023).
      veils: "all",
      // The map's ink renders in every game (added 2026-11-16 per user review),
      // so its unreadable lines are shared-group hygiene too.
      sketches: "all",
    });
    for (const family of Object.keys(NOTICE_FAMILY_GAME) as Array<
      keyof typeof NOTICE_FAMILY_GAME
    >) {
      expect(
        LEVELS.filter((level) => noticeGame(family) === level).length,
      ).toBeLessThanOrEqual(1);
    }
    // DEPRECATED (hidden 2026-11-16 per separate-maps review): the render map
    // below is the PRE-HIDE table (each own record belonged to one game, the
    // shared content to all). What renders is ONE rule: concept only.
    expect([...RENDER_MAP.all]).toEqual([
      "words",
      "distances",
      "marks",
      "shelf",
    ]);
    expect([...RENDER_MAP.dynamics]).toEqual([
      "links",
      "loops",
      "assumptions",
      "model",
    ]);
    expect([...RENDER_MAP.ground]).toEqual(["pointers"]);
    const own = [...RENDER_MAP.dynamics, ...RENDER_MAP.ground];
    expect(new Set(own).size).toBe(own.length);
    for (const record of own) {
      expect(RENDER_MAP.all).not.toContain(record as never);
    }
  });

  test("the word row receives at most one family's records at a time", () => {
    // The row's face inputs are exactly the two cue families' (a presence
    // boolean each, plus the reach's marked ring) — links, loops, the playing
    // set and distances have no word-row presence at all.
    const wordSource = readFileSync(
      new URL("../src/canvas/ReferenceWord.tsx", import.meta.url),
      "utf8",
    );
    const propsStart = wordSource.indexOf("interface ReferenceWordProps {");
    const propsEnd = wordSource.indexOf("\n}", propsStart);
    expect(propsStart).toBeGreaterThan(-1);
    const propsBlock = wordSource.slice(propsStart, propsEnd);
    const propNames = [...propsBlock.matchAll(/^\s{2}(\w+)\??:/gm)].map(
      (match) => match[1],
    );
    expect(
      propNames
        .filter((name) => /^(has|show)[A-Z]/.test(name) || name === "reachMarked")
        .sort(),
    ).toEqual([
      "hasAssumptions",
      "hasPointers",
      "reachMarked",
      "showAssumptions",
      "showReach",
    ]);
    for (const other of [
      "hasLinks",
      "hasLoops",
      "hasModel",
      "hasDistances",
      "links",
      "loops",
      "model",
      "distances",
      "faces",
      "profile",
    ]) {
      expect(propNames).not.toContain(other);
    }

    // Both show props go through the ONE pure table, and at most one family is
    // visible in any game: dynamics' diamond or ground's handle, never both.
    const appSource = readFileSync(
      new URL("../src/App.tsx", import.meta.url),
      "utf8",
    );
    expect(appSource).toContain(
      'showAssumptions={cueShownIn("assumptions", level)}',
    );
    expect(appSource).toContain('showReach={cueShownIn("reach", level)}');
    for (const level of LEVELS) {
      const shown = (["assumptions", "reach"] as PresenceCue[]).filter((cue) =>
        cueShownIn(cue, level),
      );
      expect(shown.length).toBeLessThanOrEqual(1);
    }
    // Concept shows neither face's records on the row (it shows the distances).
    expect(cueShownIn("assumptions", "concept")).toBe(false);
    expect(cueShownIn("reach", "concept")).toBe(false);
  });

  test("the level and follow rules import no record module: they cannot collect faces", () => {
    for (const path of [
      "../src/workspace/level.ts",
      "../src/workspace/levelHandoff.ts",
      "../src/canvas/zoomBands.ts",
      "../src/canvas/followRules.ts",
      "../src/canvas/presenceRules.ts",
    ]) {
      const source = readFileSync(new URL(path, import.meta.url), "utf8");
      expect(source).not.toMatch(/from "\.\.\/map\//);
    }
  });

  test("the follow control's whole view is the game and nothing else", () => {
    for (const level of LEVELS) {
      const view = followControlView(level);
      expect(Object.keys(view)).toEqual(["targets"]);
      expect(view.targets).toEqual(followTargets(level));
      expect(view.targets).not.toContain(level);
      expect(new Set(view.targets).size).toBe(2);
    }
  });
});
