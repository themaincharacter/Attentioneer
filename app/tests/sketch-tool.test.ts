import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONTENT_CLASSES,
  WORD_CONTROL_CLASSES,
  creationKinds,
  isGestureArmed,
  isContentElement,
  isWordControl,
  offeredCreationKinds,
  shouldCreate,
  shouldPan,
  shouldStartWordPress,
  type ClassListLike,
} from "../src/canvas/gates";
import {
  ASSUMPTION_CREATION_HIDDEN,
  CROSS_LEVEL_FACES_HIDDEN,
  LACK_CREATION_HIDDEN,
  TENTATIVE_MARK_HIDDEN,
} from "../src/canvas/deprecations";
import {
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_SIZE,
  DRAW_MODE,
  isDrawableStroke,
  isPenColor,
  isPenSize,
  PEN_COLORS,
  PEN_SIZES,
  SKETCH_STEP_PX,
  penInk,
  sampleStroke,
  strokePath,
  strokesToPaths,
} from "../src/canvas/sketchRules";
import { followTargets } from "../src/canvas/followRules";
import { parseMarkLine } from "../src/map/marks";
import { LEVELS } from "../src/workspace/level";

/**
 * The map's pen, automated (added 2026-11-16 per user review), plus the
 * review's HIDING discipline.
 *
 * The pen is the veil draw-box's sibling arm: a gate mode (`draw`) that stands
 * every plane gesture still — pan, double-click creation and every word press —
 * while its own capture surface owns the pointer. The record is
 * `map/sketches.jsonl` (tests/sketches.test.ts); this file pins the RULES, the
 * arming discipline, the quiet controls' home, and that the persistence goes
 * through the map's one writer with the family's posture (malformed preserved
 * and surfaced).
 *
 * The review also asked for the concept layer to be simplified: the lack, the
 * assumption kind, the tentative mark's affordances and the word's cross-level
 * faces are HIDDEN (not deleted). Each hiding point keeps its code behind a
 * flag; the machinery (the creation grammar, the mark record, the follow's
 * offer and anchored jump) stays and is asserted alive here.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

/** A DOMTokenList stand-in (the handlers pass the real thing). */
const cl = (...names: string[]): ClassListLike => ({
  contains: (token: string) => names.includes(token),
});

const DEPRECATION = "DEPRECATED (hidden 2026-11-16 per user review)";

/* ----------------------------------------------------------------------- *
 * 1. The pen's arming discipline: one more arm, the plane stands still.
 * ----------------------------------------------------------------------- */

describe("the pen is a gate mode that suspends the plane", () => {
  test("the mode is armed, so pan, creation and word presses all stand still", () => {
    expect(DRAW_MODE).toBe("draw");
    expect(isGestureArmed(DRAW_MODE)).toBe(true);
    expect(shouldPan(DRAW_MODE)).toBe(false);
    expect(shouldCreate(DRAW_MODE)).toBe(false);
    expect(shouldStartWordPress(DRAW_MODE)).toBe(true === false);
    expect(shouldStartWordPress(DRAW_MODE, cl("word-name"))).toBe(false);
  });

  test("a pen press never starts a word drag or a click-to-center", () => {
    for (const control of ["word", "word-name", "connect-handle", "word-mark"]) {
      expect(shouldStartWordPress(DRAW_MODE, cl(control))).toBe(false);
    }
  });

  test("the strokes' layer is content and owns no press (the family rule)", () => {
    for (const list of [CONTENT_CLASSES, WORD_CONTROL_CLASSES]) {
      expect(list).toContain("sketch-layer" as never);
    }
    expect(isContentElement(cl("sketch-layer"))).toBe(true);
    expect(isWordControl(cl("sketch-layer"))).toBe(true);
    expect(shouldStartWordPress("idle", cl("sketch-layer"))).toBe(false);
  });

  test("every armed mode (the pen included) suppresses the same three", () => {
    for (const mode of ["selector", "path", "sign-choice", "pointer", "veil", DRAW_MODE] as const) {
      expect(isGestureArmed(mode)).toBe(true);
      expect(shouldPan(mode)).toBe(false);
      expect(shouldCreate(mode)).toBe(false);
      expect(shouldStartWordPress(mode, cl("word-name"))).toBe(false);
    }
  });

  test("the capture surface is rendered only while armed and owns the press", () => {
    const plane = source("src/canvas/CanvasPlane.tsx");
    expect(plane).toContain("{drawArmed && (");
    expect(plane).toContain('className="draw-surface"');
    // The press is the pen's, never d3-zoom's, the press counter's or a word's.
    expect(plane).toContain("event.stopPropagation();");
    expect(plane).toContain("drawArmedRef.current");
    // The in-flight stroke previews in world space (the release writes what was seen).
    expect(plane).toContain("sketch-draft");
  });
});

/* ----------------------------------------------------------------------- *
 * 2. The pen's pure rules.
 * ----------------------------------------------------------------------- */

describe("the pen's palette, sizes and ink", () => {
  test("the palette is a few quiet colours, all paintable", () => {
    expect(PEN_COLORS.length).toBeGreaterThanOrEqual(3);
    for (const ink of PEN_COLORS) expect(isPenColor(ink)).toBe(true);
    expect(new Set(PEN_COLORS).size).toBe(PEN_COLORS.length);
  });

  test("the sizes are a few positive widths, opening on one of them", () => {
    expect(PEN_SIZES.length).toBeGreaterThanOrEqual(2);
    for (const size of PEN_SIZES) {
      expect(isPenSize(size)).toBe(true);
      expect(size).toBeGreaterThan(0);
    }
    expect(PEN_SIZES).toContain(DEFAULT_PEN_SIZE);
    expect(PEN_COLORS).toContain(DEFAULT_PEN_COLOR);
    expect(SKETCH_STEP_PX).toBeGreaterThan(0);
  });

  test("isPenColor accepts #rgb and #rrggbb, nothing else", () => {
    for (const yes of ["#fff", "#ffffff", "#FAFAFA"]) {
      expect(isPenColor(yes)).toBe(true);
    }
    for (const no of ["fff", "white", "#ffff", "#ffffffff", "", 7]) {
      expect(isPenColor(no)).toBe(false);
    }
  });

  test("a stored colour CSS cannot paint still draws in the palette's ink", () => {
    // The record keeps the authored string verbatim (map/sketches.ts); only
    // the RENDER falls back, so a hand edit never makes a stroke invisible.
    expect(penInk("#a9522f")).toBe("#a9522f");
    expect(penInk("chartreuse-ish")).toBe(DEFAULT_PEN_COLOR);
    expect(penInk("")).toBe(DEFAULT_PEN_COLOR);
  });

  test("isPenSize is a positive finite number", () => {
    expect(isPenSize(2)).toBe(true);
    for (const no of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "2"]) {
      expect(isPenSize(no)).toBe(false);
    }
  });
});

describe("sampling a stroke", () => {
  test("the first point always enters, and a near point does not", () => {
    const first = sampleStroke([], { x: 10, y: 10 }, 2);
    expect(first).toEqual([{ x: 10, y: 10 }]);
    const unchanged = sampleStroke(first, { x: 10.5, y: 10.5 }, 2);
    expect(unchanged).toBe(first);
  });

  test("a far enough point extends the stroke, and the input is not mutated", () => {
    const start = [{ x: 0, y: 0 }];
    const next = sampleStroke(start, { x: 5, y: 0 }, 2);
    expect(next).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(start).toHaveLength(1);
  });

  test("a drag with no movement is not a stroke", () => {
    expect(isDrawableStroke([])).toBe(false);
    expect(isDrawableStroke([{ x: 1, y: 1 }])).toBe(false);
    expect(
      isDrawableStroke([
        { x: 1, y: 1 },
        { x: 2, y: 2 },
      ]),
    ).toBe(true);
  });
});

describe("the stroke's SVG path", () => {
  test("a move, then a line for each sample", () => {
    expect(
      strokePath([
        { x: 10, y: 20 },
        { x: 12, y: 24 },
      ]),
    ).toBe("M 10 20 L 12 24");
  });

  test("a single point is a bare move; nothing is empty", () => {
    expect(strokePath([{ x: 1, y: 2 }])).toBe("M 1 2");
    expect(strokePath([])).toBe("");
  });

  test("coordinates keep three decimals (the record keeps the full floats)", () => {
    expect(strokePath([{ x: 1.23456, y: 2.0004 }])).toBe("M 1.235 2");
  });

  test("the layer's paths carry each stroke's own ink and width", () => {
    const paths = strokesToPaths([
      {
        color: "chartreuse-ish",
        size: 4,
        points: [
          { x: 0, y: 0 },
          { x: 3, y: 0 },
        ],
        extra: {},
      },
      {
        color: "#a9522f",
        size: 8,
        points: [
          { x: 0, y: 5 },
          { x: 3, y: 5 },
        ],
        extra: {},
      },
    ]);
    expect(paths.map((path) => path.id)).toEqual([0, 1]);
    expect(paths[0].ink).toBe(DEFAULT_PEN_COLOR);
    expect(paths[1].ink).toBe("#a9522f");
    expect(paths.map((path) => path.size)).toEqual([4, 8]);
  });
});

/* ----------------------------------------------------------------------- *
 * 3. The quiet controls: a toggle in the level control, a screen-space strip.
 * ----------------------------------------------------------------------- */

describe("the pen's quiet controls", () => {
  test("the level control carries the ONE toggle, every game", () => {
    const control = source("src/canvas/LevelControl.tsx");
    expect(control).toContain('className={"level-draw" + (drawArmed ? " active" : "")}');
    expect(control).toContain("aria-pressed={drawArmed}");
    expect(control).toContain("onClick={onDraw}");
    // Offered in EVERY game: it sits outside the dynamics block (the veil
    // door's level rule is its own).
    const draw = control.indexOf("className={\"level-draw\"");
    const dynamics = control.indexOf('{level === "dynamics" && (');
    expect(draw).toBeGreaterThan(-1);
    expect(draw).toBeLessThan(dynamics);
  });

  test("the strip has sizes, colours, a picker, undo and the quiet ×", () => {
    const bar = source("src/canvas/SketchToolbar.tsx");
    for (const needle of [
      'className="sketch-bar"',
      "PEN_SIZES.map",
      "PEN_COLORS.map",
      'type="color"',
      // Undo now takes back the last CHANGE (a stroke, or one erase gesture)
      // — the label says exactly that, and it is still a button, never a tally.
      'aria-label="undo the last change"',
      'aria-label="clear the drawing (no undo)"',
    ]) {
      expect(bar).toContain(needle);
    }
    // No counter or tally: undo is a disabled button, never a number.
    expect(bar).not.toMatch(/\bdrawn\b|\bstrokes: \d|\btotal\b/i);
  });

  test("the strip is armed-only and sits outside the plane", () => {
    const app = source("src/App.tsx");
    const at = app.indexOf("{drawArmed && (");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 800)).toContain("<SketchToolbar");
    // The ink is an annotation OVER the map's content (the in-flight stroke
    // previews at the same level, so the release writes what was seen).
    expect(app.indexOf("<SketchLayer strokes={sketches} />")).toBeGreaterThan(-1);
    expect(app.indexOf("<SketchLayer strokes={sketches} />")).toBeGreaterThan(
      app.indexOf("{refs.map((word) => ("),
    );
  });
});

/* ----------------------------------------------------------------------- *
 * 4. The persistence posture (provisional): map/sketches.jsonl, one writer.
 * ----------------------------------------------------------------------- */

describe("the drawing's persistence posture", () => {
  const useMap = source("src/canvas/useMap.ts");

  test("the strokes ride map/ (committed model), never a branch folder", () => {
    expect(useMap).toContain("loadSketches(workspacePath)");
    expect(useMap).toContain("saveSketches(workspacePath, next, malformedLines)");
    expect(useMap).not.toContain("loadSketches(recordsDir)");
  });

  test("appending, undo and clear all go through the one in-order writer", () => {
    expect(useMap).toContain(
      "appendSketch(current, { color, size, points })",
    );
    expect(useMap).toContain("undoLastSketch(current)");
    expect(useMap).toContain("clearSketchesRecord(sketchesRef.current)");
    // The malformed lines ride along from the ref (never a stale list).
    expect(useMap).toContain("malformedSketchesRef.current");
  });

  test("the app reports a stroke with the pen's own colour and size", () => {
    const app = source("src/App.tsx");
    expect(app).toContain("addSketch(penColor, penSize, points)");
    expect(app).toContain("onSketch={handleSketch}");
  });

  test("malformed lines are surfaced, never hidden (the strip's family)", () => {
    const app = source("src/App.tsx");
    expect(app).toContain("unreadable line in map/sketches.jsonl");
    expect(app).toContain("malformedSketches={malformedSketches}");
  });
});

/* ----------------------------------------------------------------------- *
 * 5. The review's hiding discipline: hidden, marked deprecated, not deleted.
 * ----------------------------------------------------------------------- */

describe("the hidden affordances (hidden 2026-11-16, not deleted)", () => {
  test("the four flags are on", () => {
    expect(LACK_CREATION_HIDDEN).toBe(true);
    expect(ASSUMPTION_CREATION_HIDDEN).toBe(true);
    expect(TENTATIVE_MARK_HIDDEN).toBe(true);
    expect(CROSS_LEVEL_FACES_HIDDEN).toBe(true);
  });

  // DEPRECATED (hidden 2026-11-16 per separate-maps review): converted from
  // "the ring menu OFFERS only the word, in every game" — the word is the
  // concept map's content, so the offer is concept-only and the bubble at
  // dynamics/ground is the pen's draw alone.
  test("the ring menu OFFERS only the word, at concept", () => {
    expect(offeredCreationKinds("concept")).toEqual(["word"]);
    for (const level of ["dynamics", "ground"] as const) {
      expect(offeredCreationKinds(level)).toEqual([]);
    }
    // The machinery's grammar is untouched: the kinds are still named.
    expect(creationKinds("concept")).toEqual(["word", "lack"]);
    expect(creationKinds("dynamics")).toEqual(["word", "lack", "assumption"]);
  });

  test("every hiding point keeps its code and carries the review's comment", () => {
    const planes = [
      "src/canvas/PlaneMenu.tsx",
      "src/canvas/ReferenceWord.tsx",
      "src/canvas/DistanceWire.tsx",
      "src/canvas/PointerChooser.tsx",
      "src/canvas/gates.ts",
      "src/canvas/canvas.css",
      // The second review's hiding points (the level control's doors) carry the
      // same marker, so the sweep finds them the same way.
      "src/canvas/LevelControl.tsx",
    ];
    for (const file of planes) {
      expect({ file, marked: source(file).includes(DEPRECATION) }).toEqual({
        file,
        marked: true,
      });
    }
  });

  test("the ring menu's lack and assumption choices are present but gated", () => {
    const menu = source("src/canvas/PlaneMenu.tsx");
    expect(menu).toContain(
      "{doors === undefined && kinds.includes(\"lack\") && onLack !== undefined && (",
    );
    expect(menu).toContain(
      "{doors === undefined && kinds.includes(\"assumption\") && onAssumption && (",
    );
    expect(menu).toContain('kinds = ["word"]');
    expect(menu).toContain('aria-label="cast a lack here"');
    expect(menu).toContain('aria-label="state an assumption about this spot"');
  });

  test("the word's tentative ring and its level faces are present but gated", () => {
    const word = source("src/canvas/ReferenceWord.tsx");
    expect(word).toContain("{!TENTATIVE_MARK_HIDDEN && !renaming && (");
    expect(word).toContain('className={`word-mark${marked ? " open" : ""}`}');
    expect(word).toContain("{!CROSS_LEVEL_FACES_HIDDEN && (");
    expect(word).toContain('className="word-follow"');
    // The way OUT of an existing mark stays: the marked word's reject arrow.
    expect(word).toContain('className="word-reject"');
  });

  test("the wire's and the pointer row's mark rings are gated too", () => {
    const wire = source("src/canvas/DistanceWire.tsx");
    expect(wire).toContain("{!TENTATIVE_MARK_HIDDEN && !editing && (");
    expect(wire).toContain("distance-mark");
    const pointer = source("src/canvas/PointerChooser.tsx");
    expect(pointer).toContain("{!TENTATIVE_MARK_HIDDEN && (");
    expect(pointer).toContain('className={"pointer-ring"');
  });

  test("the machinery the hidden features feed is still alive", () => {
    // The mark record still reads a line (other features write marks).
    expect(parseMarkLine('{"kind":"open","on":"rain"}')).not.toBeNull();
    // The follow's offer and anchored jump are untouched.
    expect(followTargets("concept")).toEqual(["dynamics", "ground"]);
    expect(followTargets("ground")).toEqual(["concept", "dynamics"]);
  });
});
