import { describe, expect, test } from "bun:test";
import {
  DEFAULT_GAME_COLOR,
  DEFAULT_SHAPE_MODE,
  GAME_PROBLEM_TEXT,
  GAMES_EMPTY_LINE,
  GAMES_PANEL_TITLE,
  GAME_POPUP_TITLE,
  PASTEL_LIGHTNESS_MAX,
  PASTEL_LIGHTNESS_MIN,
  PASTEL_SATURATION,
  SELECT_MODE,
  SHAPE_MODES,
  circleFromDrag,
  freeformShape,
  gameInk,
  gameMembership,
  hslToHex,
  isGameColor,
  languageGamesLive,
  pickPastel,
  pointInCircle,
  pointInRect,
  rectFromDrag,
  shapeAnchor,
  shapeBounds,
  shapeCenter,
  shapeContains,
  shapeFromDrag,
  submitProblem,
  wordsInShape,
} from "../src/canvas/languageGameRules";
import {
  isGestureArmed,
  shouldCreate,
  shouldPan,
  shouldStartWordPress,
  type ClassListLike,
} from "../src/canvas/gates";
import { LEVELS } from "../src/workspace/level";

/**
 * THE SELECTION TOOL's pure rules, automated (PROVISIONAL, added 2026-11-16
 * per the lead's brief).
 *
 * The tool is the pen's sibling arm: a gate mode (`select`) that stands every
 * plane gesture still while its own capture surface owns the pointer, a drag
 * that draws one of three shapes, and a completed selection that becomes a
 * LANGUAGE GAME (the record is tests/language-games-record.test.ts). This file
 * pins what can be decided without a DOM:
 *
 *   - the arm: the mode suspends pan, creation and every word press, and the
 *     feature is concept-only (the separate-maps rule);
 *   - the three drags and the freeform auto-close (the closing segment is a
 *     real edge for every hit test);
 *   - the point tests for all three shapes (inside/outside/edge);
 *   - what a shape holds: the words by their anchor (the measured box's
 *     centre) and the wires whose BOTH ends are held;
 *   - the pastel: deterministic through an injected rng, and inside the quiet
 *     HSL band;
 *   - the submit rule: empty, duplicate (case-sensitive) and a region with no
 *     word of the map.
 */

const cl = (...names: string[]): ClassListLike => ({
  contains: (token: string) => names.includes(token),
});

/* ----------------------------------------------------------------------- *
 * 1. The arm.
 * ----------------------------------------------------------------------- */

describe("the selection tool is an armed gate mode (the pen's discipline)", () => {
  test("the mode is select, and it suspends the plane's gestures", () => {
    expect(SELECT_MODE as string).toBe("select");
    expect(isGestureArmed(SELECT_MODE)).toBe(true);
    expect(shouldPan(SELECT_MODE)).toBe(false);
    expect(shouldCreate(SELECT_MODE)).toBe(false);
    expect(shouldStartWordPress(SELECT_MODE)).toBe(false);
    for (const control of ["word", "word-name", "memory-dot", "connect-handle"]) {
      expect(shouldStartWordPress(SELECT_MODE, cl(control))).toBe(false);
    }
  });

  test("the feature is CONCEPT ONLY (the separate-maps rule)", () => {
    expect(languageGamesLive("concept")).toBe(true);
    for (const level of ["dynamics", "ground"] as const) {
      expect(languageGamesLive(level)).toBe(false);
    }
    // Every map is answered, so nothing can fall through unclassified.
    for (const level of LEVELS) {
      expect(typeof languageGamesLive(level)).toBe("boolean");
    }
  });

  test("freeform opens the strip (the default)", () => {
    expect(DEFAULT_SHAPE_MODE).toBe("freeform");
    expect([...SHAPE_MODES]).toEqual(["freeform", "circle", "rect"]);
  });
});

/* ----------------------------------------------------------------------- *
 * 2. The three drags, and the freeform's auto-close.
 * ----------------------------------------------------------------------- */

describe("a drag draws a shape", () => {
  test("freeform: the sampled path is the polygon's ring", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ];
    const shape = freeformShape(path);
    expect(shape).not.toBeNull();
    expect(shape?.kind).toBe("polygon");
    if (shape?.kind !== "polygon") throw new Error("not a polygon");
    // The ring is the hand's path — the close is IMPLICIT, so the first point
    // is never repeated in the record.
    expect(shape.points).toEqual(path);
    expect(shape.points[shape.points.length - 1]).not.toEqual(shape.points[0]);
  });

  test("freeform: fewer than three samples enclose nothing", () => {
    expect(freeformShape([])).toBeNull();
    expect(freeformShape([{ x: 0, y: 0 }])).toBeNull();
    expect(
      freeformShape([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toBeNull();
  });

  test("auto-close: the release's straight segment back to the first point IS an edge", () => {
    const shape = freeformShape([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 0, y: 10 },
    ]);
    if (shape === null) throw new Error("expected a polygon");
    // The interior, including a point only the CLOSING edge (the hypotenuse
    // x + y = 10) separates from the outside.
    expect(shapeContains(shape, { x: 2, y: 2 })).toBe(true);
    expect(shapeContains(shape, { x: 4, y: 4 })).toBe(true);
    // On the closing edge: inside (the border rule).
    expect(shapeContains(shape, { x: 5, y: 5 })).toBe(true);
    // Beyond it: outside.
    expect(shapeContains(shape, { x: 6, y: 6 })).toBe(false);
    // The first→second and second→third edges are real too.
    expect(shapeContains(shape, { x: 5, y: 0 })).toBe(true);
    expect(shapeContains(shape, { x: 0, y: 5 })).toBe(true);
  });

  test("circle: the drag is the diameter", () => {
    const shape = circleFromDrag({ x: 10, y: 10 }, { x: 30, y: 10 });
    expect(shape).toEqual({ kind: "circle", cx: 20, cy: 10, r: 10 });
    // A press that never moved makes no circle.
    expect(circleFromDrag({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
  });

  test("rectangle: corner to corner, in any direction", () => {
    const shape = rectFromDrag({ x: 30, y: 40 }, { x: 10, y: 20 });
    expect(shape).toEqual({ kind: "rect", x: 10, y: 20, w: 20, h: 20 });
    const other = rectFromDrag({ x: 10, y: 20 }, { x: 30, y: 40 });
    expect(other).toEqual(shape);
    // A drag that encloses no area draws nothing.
    expect(rectFromDrag({ x: 5, y: 5 }, { x: 5, y: 30 })).toBeNull();
    expect(rectFromDrag({ x: 5, y: 5 }, { x: 30, y: 5 })).toBeNull();
  });

  test("shapeFromDrag dispatches on the shape's mode", () => {
    const path = [
      { x: 0, y: 0 },
      { x: 10, y: 40 },
      { x: 30, y: 40 },
    ];
    const start = path[0];
    const end = path[path.length - 1];
    expect(shapeFromDrag("freeform", start, end, path)?.kind).toBe("polygon");
    expect(shapeFromDrag("circle", start, end, path)?.kind).toBe("circle");
    expect(shapeFromDrag("rect", start, end, path)?.kind).toBe("rect");
    // The mode decides: the same drag draws three different regions.
    expect(shapeFromDrag("circle", start, end, path)).not.toEqual(
      shapeFromDrag("rect", start, end, path),
    );
  });
});

/* ----------------------------------------------------------------------- *
 * 3. The point tests: inside, outside, edge.
 * ----------------------------------------------------------------------- */

describe("each shape's hit test (the border counts as inside)", () => {
  test("polygon", () => {
    const square = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ];
    const shape = freeformShape(square);
    if (shape === null) throw new Error("expected a polygon");
    expect(shapeContains(shape, { x: 5, y: 5 })).toBe(true);
    expect(shapeContains(shape, { x: 11, y: 5 })).toBe(false);
    expect(shapeContains(shape, { x: 10, y: 5 })).toBe(true); // edge
    expect(shapeContains(shape, { x: 0, y: 0 })).toBe(true); // vertex
    expect(shapeContains(shape, { x: 0, y: 11 })).toBe(false);
  });

  test("circle", () => {
    expect(pointInCircle({ x: 0, y: 0 }, 0, 0, 10)).toBe(true);
    expect(pointInCircle({ x: 10, y: 0 }, 0, 0, 10)).toBe(true); // on the rim
    expect(pointInCircle({ x: 10.001, y: 0 }, 0, 0, 10)).toBe(false);
    // A degenerate radius holds nothing — not even its own centre.
    expect(pointInCircle({ x: 0, y: 0 }, 0, 0, 0)).toBe(false);
    expect(pointInCircle({ x: 0, y: 0 }, 0, 0, -4)).toBe(false);
    const shape = circleFromDrag({ x: 0, y: 0 }, { x: 20, y: 0 });
    if (shape === null) throw new Error("expected a circle");
    expect(shapeContains(shape, { x: 10, y: 0 })).toBe(true);
    expect(shapeContains(shape, { x: 10, y: 10 })).toBe(true); // the rim
    expect(shapeContains(shape, { x: 10, y: 11 })).toBe(false);
  });

  test("rectangle", () => {
    const rect = { x: 5, y: 5, w: 20, h: 10 };
    expect(pointInRect({ x: 10, y: 10 }, rect)).toBe(true);
    expect(pointInRect({ x: 5, y: 5 }, rect)).toBe(true); // corner
    expect(pointInRect({ x: 25, y: 15 }, rect)).toBe(true); // far corner
    expect(pointInRect({ x: 4.9, y: 10 }, rect)).toBe(false);
    expect(pointInRect({ x: 10, y: 15.1 }, rect)).toBe(false);
    // A non-positive extent covers nothing (the veil's honest reading).
    expect(pointInRect({ x: 5, y: 5 }, { x: 5, y: 5, w: 0, h: 10 })).toBe(false);
    expect(pointInRect({ x: 5, y: 5 }, { x: 5, y: 5, w: 10, h: -1 })).toBe(false);
  });
});

/* ----------------------------------------------------------------------- *
 * 4. What a shape holds: the words, and the wires with both ends in.
 * ----------------------------------------------------------------------- */

describe("membership is derived from the shape, at read time", () => {
  const words = [
    // The anchor is the measured box's centre (10, 10); pos alone is outside.
    { slug: "a", pos: { x: 0, y: 0 }, box: { w: 20, h: 20 } },
    // Far away: never held.
    { slug: "b", pos: { x: 100, y: 100 }, box: { w: 20, h: 20 } },
    // The centre (50, 50) is in.
    { slug: "c", pos: { x: 0, y: 0 }, box: { w: 100, h: 100 } },
  ];
  const wires = [
    { from: "a", to: "c", word: "inside" },
    { from: "a", to: "b", word: "one end out" },
    { from: "b", to: "b", word: "outside" },
    { from: "a", to: "gone", word: "a word off the map" },
  ];
  const region = rectFromDrag({ x: 5, y: 5 }, { x: 65, y: 65 });

  test("the words inside, by the centre of their measured box", () => {
    if (region === null) throw new Error("expected a rectangle");
    expect(wordsInShape(region, words).map((word) => word.slug)).toEqual([
      "a",
      "c",
    ]);
  });

  test("a wire needs BOTH endpoint words held", () => {
    if (region === null) throw new Error("expected a rectangle");
    const held = gameMembership(region, words, wires);
    expect(held.words).toEqual(["a", "c"]);
    // Only the wire whose two ends are held; one-ended, outside and
    // off-the-map wires all fail the rule.
    expect(held.wires.map((wire) => wire.word)).toEqual(["inside"]);
  });

  test("a region that holds no word holds no wire", () => {
    const empty = rectFromDrag({ x: 500, y: 500 }, { x: 600, y: 600 });
    if (empty === null) throw new Error("expected a rectangle");
    const held = gameMembership(empty, words, wires);
    expect(held.words).toEqual([]);
    expect(held.wires).toEqual([]);
  });

  test("a shape's own kind decides the test (a circle holds what it rounds)", () => {
    const circle = circleFromDrag({ x: 0, y: 0 }, { x: 40, y: 0 });
    if (circle === null) throw new Error("expected a circle");
    // The circle centred (20, 0) with r 20 holds a (centre 10, 10) but not c
    // (centre 50, 50), which only the square region's far corner reached.
    expect(wordsInShape(circle, words).map((word) => word.slug)).toEqual(["a"]);
  });
});

/* ----------------------------------------------------------------------- *
 * 5. The pastel: deterministic, and inside the quiet band.
 * ----------------------------------------------------------------------- */

describe("the pastel is a quiet colour from an injected rng", () => {
  /** An LCG, so a test's rng is deterministic without touching Math.random. */
  function lcg(seed: number): () => number {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  function hexToHsl(hex: string): { h: number; s: number; l: number } {
    const value = hex.replace("#", "");
    const r = parseInt(value.slice(0, 2), 16) / 255;
    const g = parseInt(value.slice(2, 4), 16) / 255;
    const b = parseInt(value.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    let s = 0;
    let h = 0;
    if (d !== 0) {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    return { h, s, l };
  }

  test("the same rng draws the same colour (byte-for-byte)", () => {
    const a = pickPastel(lcg(7));
    const b = pickPastel(lcg(7));
    expect(a).toBe(b);
    // The rng is INJECTED: it is the only source of the colour.
    let calls = 0;
    pickPastel(() => {
      calls += 1;
      return 0.5;
    });
    expect(calls).toBe(2);
    // A fixed draw is a fixed colour (hue 180, lightness 0.83).
    expect(pickPastel(() => 0.5)).toBe("#bee9e9");
  });

  test("different draws give different colours", () => {
    const colours = new Set<string>();
    for (let seed = 1; seed <= 20; seed += 1) {
      colours.add(pickPastel(lcg(seed)));
    }
    expect(colours.size).toBeGreaterThan(1);
  });

  test("every colour is paintable and in the pastel band", () => {
    expect(PASTEL_LIGHTNESS_MIN).toBeLessThan(PASTEL_LIGHTNESS_MAX);
    expect(PASTEL_LIGHTNESS_MIN).toBeGreaterThan(0.7);
    expect(PASTEL_LIGHTNESS_MAX).toBeLessThanOrEqual(0.9);
    for (let seed = 1; seed <= 40; seed += 1) {
      const color = pickPastel(lcg(seed));
      expect(isGameColor(color)).toBe(true);
      const { s, l } = hexToHsl(color);
      // A pastel is light and soft: never a highlighter, never a dark ink.
      expect({ color, l: l >= 0.77 && l <= 0.89 }).toEqual({ color, l: true });
      expect({ color, s: Math.abs(s - PASTEL_SATURATION) < 0.05 }).toEqual({
        color,
        s: true,
      });
      expect(l).toBeGreaterThan(0.75);
      expect(l).toBeLessThan(0.9);
    }
  });

  test("HSL to hex is the plain conversion (and clamps)", () => {
    expect(hslToHex(0, 0, 0)).toBe("#000000");
    expect(hslToHex(0, 0, 1)).toBe("#ffffff");
    expect(hslToHex(0, 1, 0.5)).toBe("#ff0000");
    expect(hslToHex(120, 1, 0.5)).toBe("#00ff00");
    expect(hslToHex(240, 1, 0.5)).toBe("#0000ff");
    // A wild rng (NaN / out of range) can never make a bad byte.
    expect(isGameColor(hslToHex(Number.NaN, 0.5, 0.8))).toBe(true);
  });

  test("the render's ink falls back to the quiet default (the record is never rewritten)", () => {
    expect(isGameColor("#abc")).toBe(true);
    expect(isGameColor("#aabbcc")).toBe(true);
    expect(isGameColor("rain")).toBe(false);
    expect(isGameColor("#12345")).toBe(false);
    expect(isGameColor(7)).toBe(false);
    expect(gameInk("#aabbcc")).toBe("#aabbcc");
    expect(gameInk("chartreuse-ish")).toBe(DEFAULT_GAME_COLOR);
    expect(isGameColor(DEFAULT_GAME_COLOR)).toBe(true);
  });
});

/* ----------------------------------------------------------------------- *
 * 6. The submit rule.
 * ----------------------------------------------------------------------- */

describe("what may be saved as a language game", () => {
  test("the name must be non-empty", () => {
    expect(submitProblem("", [], true)).toBe("empty");
    expect(submitProblem("   ", [], true)).toBe("empty");
    expect(submitProblem("\t\n", [], true)).toBe("empty");
    expect(submitProblem("rain", [], true)).toBeNull();
  });

  test("the name must be unique, case-sensitively (PROVISIONAL)", () => {
    expect(submitProblem("rain", ["rain"], true)).toBe("duplicate");
    expect(submitProblem(" rain ", ["rain"], true)).toBe("duplicate");
    // Case-sensitive: the person's spelling is the coin, so these are free.
    expect(submitProblem("Rain", ["rain"], true)).toBeNull();
    expect(submitProblem("rain", ["Rain"], true)).toBeNull();
    expect(submitProblem("rain", ["soil", "mulch"], true)).toBeNull();
  });

  test("the selection must hold at least one word of the map", () => {
    expect(submitProblem("rain", [], false)).toBe("no-words");
    // A name problem is named first: the field is what the person can fix
    // without drawing again.
    expect(submitProblem("", [], false)).toBe("empty");
    expect(submitProblem("rain", ["rain"], false)).toBe("duplicate");
  });

  test("every refusal is ONE quiet sentence, never a tally", () => {
    for (const text of Object.values(GAME_PROBLEM_TEXT)) {
      expect(text.length).toBeGreaterThan(10);
      expect(text.endsWith(".")).toBe(true);
      expect(text).not.toMatch(/\d/);
      expect(text).not.toMatch(/count|score|streak|heat|progress|tally|meter/i);
    }
  });
});

/* ----------------------------------------------------------------------- *
 * 7. The geometry: bounds, centre and the popup's anchor.
 * ----------------------------------------------------------------------- */

describe("a shape's bounds, centre and anchor", () => {
  test("the rectangle is its own box", () => {
    const shape = rectFromDrag({ x: 10, y: 20 }, { x: 40, y: 60 });
    if (shape === null) throw new Error("expected a rectangle");
    expect(shapeBounds(shape)).toEqual({ x: 10, y: 20, w: 30, h: 40 });
    expect(shapeCenter(shape)).toEqual({ x: 25, y: 40 });
    expect(shapeAnchor(shape)).toEqual({ x: 10, y: 20 });
  });

  test("the circle's box is its square, and its centre the centre", () => {
    const shape = circleFromDrag({ x: 0, y: 0 }, { x: 40, y: 0 });
    if (shape === null) throw new Error("expected a circle");
    expect(shapeBounds(shape)).toEqual({ x: 0, y: -20, w: 40, h: 40 });
    expect(shapeCenter(shape)).toEqual({ x: 20, y: 0 });
    expect(shapeAnchor(shape)).toEqual({ x: 0, y: -20 });
  });

  test("the polygon's box is its points' extent; the centre the box's middle", () => {
    const shape = freeformShape([
      { x: 0, y: 0 },
      { x: 90, y: 12 },
      { x: 40, y: 70 },
    ]);
    if (shape === null) throw new Error("expected a polygon");
    expect(shapeBounds(shape)).toEqual({ x: 0, y: 0, w: 90, h: 70 });
    expect(shapeCenter(shape)).toEqual({ x: 45, y: 35 });
    expect(shapeAnchor(shape)).toEqual({ x: 0, y: 0 });
  });

  test("the person-facing headings are the brief's words", () => {
    expect(GAME_POPUP_TITLE).toBe("language game");
    expect(GAMES_PANEL_TITLE).toBe("all language games");
    expect(GAMES_EMPTY_LINE.length).toBeGreaterThan(0);
    for (const text of [GAME_POPUP_TITLE, GAMES_PANEL_TITLE, GAMES_EMPTY_LINE]) {
      expect(text).not.toMatch(/count|score|streak|heat|progress|tally|meter/i);
    }
  });
});
