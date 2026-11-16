import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_PEN_SIZE,
  ERASER_RADIUS_FACTOR,
  eraseStrokes,
  eraserRadius,
  pointSegmentDistance,
  segmentDistance,
  strokeDistance,
  strokeInReach,
  type DrawTool,
} from "../src/canvas/sketchRules";
import {
  parseSketches,
  serializeSketches,
  serializeSketchLine,
  undoLastSketch,
  type Sketch,
  type SketchPoint,
} from "../src/map/sketches";
import {
  recordDraw,
  recordErase,
  undoStep,
  type SketchAction,
} from "../src/canvas/sketchHistory";

/**
 * The eraser and the drawing's undo memory, automated (added 2026-11-16 per
 * user review).
 *
 * The review asked for "an eraser option as well that removes the drawing as
 * usual". PROVISIONAL in every part: the tool pair's look, the reach
 * (`ERASER_RADIUS_FACTOR` — the selected pen size times two, in world units),
 * the whole-stroke atom, one gesture = one undo, and the session-only action
 * stack that makes undo take back the last CHANGE (a stroke, or an erase) with
 * an empty stack falling back to the drawing's own order rule.
 *
 * The record stays `map/sketches.ts`'s: an erase is its ordinary rewrite, so
 * the family's posture is asserted here too — survivors keep file order and
 * their exact line, unknown keys survive, malformed lines stay verbatim, and
 * the restored take puts every stroke back at its ORIGINAL position.
 *
 * The pen's strip lives in screen space (outside `.plane`), and the capture
 * surface that owns the plane's presses must never outrank it: the first
 * section is the CSS guard for exactly that (the buttons were dead when the
 * surface sat above the strip).
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

/** A file's non-comment text (the family's scan idiom). */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/** The body of one CSS rule (its declaration block), or null. */
function ruleBlock(css: string, selector: string): string | null {
  const at = css.indexOf("\n" + selector + " {");
  if (at === -1) return null;
  const open = css.indexOf("{", at);
  const close = css.indexOf("}", open);
  return open === -1 || close === -1 ? null : css.slice(open + 1, close);
}

function zIndexOf(block: string | null): number | null {
  if (block === null) return null;
  const match = /z-index:\s*(-?\d+)\s*;/.exec(block);
  return match === null ? null : Number(match[1]);
}

function stroke(
  points: SketchPoint[],
  color = "#3b3a35",
  size = 2,
  extra: Record<string, unknown> = {},
): Sketch {
  return { color, size, points, extra };
}

/* ----------------------------------------------------------------------- *
 * 0. The click fix: the strip outranks the pen's capture surface.
 * ----------------------------------------------------------------------- */

describe("the strip sits above the pen's capture surface", () => {
  const css = source("src/canvas/canvas.css");
  const surface = ruleBlock(css, ".draw-surface");
  const bar = ruleBlock(css, ".sketch-bar");

  test("both rules exist (the surface and the strip)", () => {
    expect(surface).not.toBeNull();
    expect(bar).not.toBeNull();
    expect(surface).toContain("position: absolute");
    expect(bar).toContain("position: fixed");
  });

  test("the strip's level is above the surface's, and the surface stops under chrome", () => {
    const surfaceZ = zIndexOf(surface);
    const barZ = zIndexOf(bar);
    expect(surfaceZ).not.toBeNull();
    expect(barZ).not.toBeNull();
    // The bug: neither .plane nor an ancestor made a stacking context, so the
    // surface (10) and the strip (8) competed in the ROOT context and the
    // surface won — every press on the strip's buttons landed on the surface,
    // which preventDefaulted it, so size, inks, picker, undo and × were dead.
    expect(barZ!).toBeGreaterThan(surfaceZ!);
    // The surface is the plane's top capture layer, never a window's: the
    // fixed chrome starts at 7 (the level control), so the surface stays
    // below every screen-space bar.
    expect(surfaceZ!).toBeLessThan(7);
  });

  test("the strip is outside the plane and owns real buttons (the fix's shape)", () => {
    const app = source("src/App.tsx");
    const at = app.indexOf("{drawArmed && (");
    expect(at).toBeGreaterThan(-1);
    expect(app.slice(at, at + 900)).toContain("<SketchToolbar");
    // The strip's controls are buttons, so a press on them is the strip's own.
    const barSource = source("src/canvas/SketchToolbar.tsx");
    expect(barSource).toContain('<div className="sketch-bar"');
    expect(barSource).toContain("type=\"button\"");
  });
});

/* ----------------------------------------------------------------------- *
 * 1. The reach: a whole stroke, within the selected size doubled.
 * ----------------------------------------------------------------------- */

const INK: SketchPoint[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
];

describe("the eraser's reach", () => {
  test("the reach is the selected pen size doubled (PROVISIONAL)", () => {
    expect(ERASER_RADIUS_FACTOR).toBe(2);
    expect(eraserRadius(1)).toBe(2);
    expect(eraserRadius(2)).toBe(4);
    expect(eraserRadius(8)).toBe(16);
    // A hand-edited size is never trusted into the reach.
    expect(eraserRadius(0)).toBe(DEFAULT_PEN_SIZE * ERASER_RADIUS_FACTOR);
    expect(eraserRadius(Number.NaN)).toBe(
      DEFAULT_PEN_SIZE * ERASER_RADIUS_FACTOR,
    );
    expect(eraserRadius(-3)).toBe(DEFAULT_PEN_SIZE * ERASER_RADIUS_FACTOR);
  });

  test("a stroke within the reach is hit; just outside it is not", () => {
    const tap = (y: number): SketchPoint[] => [{ x: 5, y }];
    expect(strokeInReach(INK, tap(3.9), 4)).toBe(true);
    expect(strokeInReach(INK, tap(4.1), 4)).toBe(false);
    expect(strokeDistance(INK, tap(3.9))).toBeCloseTo(3.9, 10);
    expect(pointSegmentDistance({ x: 5, y: 4 }, INK[0], INK[1])).toBeCloseTo(
      4,
      10,
    );
    // Past the end the reach is the endpoint's circle, not an infinite line.
    expect(strokeInReach(INK, [{ x: 13.9, y: 0 }], 4)).toBe(true);
    expect(strokeInReach(INK, [{ x: 14.2, y: 0 }], 4)).toBe(false);
  });

  test("the reach is segment-to-segment: a fast drag between samples still hits", () => {
    // The hand's two samples straddle the ink; neither sample touches it.
    const across = [
      { x: 5, y: -20 },
      { x: 5, y: 20 },
    ];
    expect(segmentDistance(INK[0], INK[1], across[0], across[1])).toBe(0);
    expect(strokeDistance(INK, across)).toBe(0);
    expect(strokeInReach(INK, across, 0.5)).toBe(true);
    // Two samples that never cross reach only as close as the nearer one.
    expect(strokeDistance(INK, [{ x: 5, y: -20 }, { x: 5, y: -10 }])).toBe(10);
  });

  test("a tap with no movement still reaches what it landed on", () => {
    // The drawing tool needs two points to be a stroke; the eraser's atom is
    // the STROKE, so its own path may be one point.
    expect(strokeInReach(INK, [{ x: 5, y: 1 }], 4)).toBe(true);
    expect(strokeInReach(INK, [{ x: 5, y: 20 }], 4)).toBe(false);
    // Nothing reaches nothing.
    expect(strokeDistance(INK, [])).toBe(Number.POSITIVE_INFINITY);
    expect(strokeInReach(INK, [], 100)).toBe(false);
    expect(strokeInReach([], [{ x: 0, y: 0 }], 100)).toBe(false);
  });
});

/* ----------------------------------------------------------------------- *
 * 2. A stroke is the atom: whole removal, order and preservation.
 * ----------------------------------------------------------------------- */

const A = stroke([{ x: 0, y: 0 }, { x: 10, y: 0 }]);
const B = stroke([{ x: 0, y: 50 }, { x: 10, y: 50 }], "#a9522f", 4, {
  note: "kept by hand",
});
const C = stroke([{ x: 20, y: 0 }, { x: 30, y: 0 }], "#4d5f86", 8);
/** A drag down through A only (B is far, C is past its end). */
const THROUGH_A: SketchPoint[] = [
  { x: 5, y: -2 },
  { x: 5, y: 2 },
];

describe("one gesture takes whole strokes", () => {
  test("the reached stroke goes whole; nothing is trimmed point by point", () => {
    const { kept, removed } = eraseStrokes([A, B, C], THROUGH_A, 2);
    expect(removed).toEqual([{ at: 0, stroke: A }]);
    // The whole record goes — the survivors are untouched objects, and the
    // taken stroke is never rewritten (its points are exactly as drawn).
    expect(removed[0].stroke).toBe(A);
    expect(removed[0].stroke.points).toEqual(A.points);
    expect(kept).toEqual([B, C]);
    expect(kept[0]).toBe(B);
    expect(kept[1]).toBe(C);
  });

  test("a gesture that reaches nothing takes nothing (so nothing is written)", () => {
    const { kept, removed } = eraseStrokes([A, B, C], [{ x: 5, y: 200 }], 2);
    expect(removed).toEqual([]);
    expect(kept).toEqual([A, B, C]);
    // The hook's guard: a miss must not rewrite the file.
    expect(source("src/canvas/useMap.ts")).toContain("if (removed.length === 0) return;");
  });

  test("survivors keep their file order and their exact line; malformed lines stay", () => {
    const before = [A, B, C];
    const malformed = [
      '{"color":"#fff","points":[[0,0]],"size":2}',
      "not json at all",
    ];
    const { kept } = eraseStrokes(before, THROUGH_A, 2);
    const text = serializeSketches(kept, malformed);
    expect(text.split("\n")).toEqual([
      serializeSketchLine(B),
      serializeSketchLine(C),
      ...malformed,
      "",
    ]);
    // Unknown keys ride along (the family's posture) and the order is the
    // record's own — never sorted, never re-shaped by the erase.
    const back = parseSketches(text);
    expect(back.sketches).toEqual([B, C]);
    expect(back.sketches[0].extra).toEqual({ note: "kept by hand" });
    expect(back.malformed).toEqual(malformed);
  });
});

/* ----------------------------------------------------------------------- *
 * 3. One gesture = one undo, restored at the ORIGINAL positions.
 * ----------------------------------------------------------------------- */

const D = stroke([{ x: 20, y: 50 }, { x: 30, y: 50 }], "#5f7355", 1);
const DRAWING = [A, B, C, D];
/** One drag along y = -1 reaches A (at 0) and C (at 2), not B or D. */
const ACROSS_THE_INK: SketchPoint[] = [
  { x: 0, y: -1 },
  { x: 30, y: -1 },
];

describe("undo takes back the last change", () => {
  const { kept, removed } = eraseStrokes(DRAWING, ACROSS_THE_INK, 4);

  test("one gesture is ONE action, however many strokes it took", () => {
    expect(removed.map((take) => take.at)).toEqual([0, 2]);
    expect(kept).toEqual([B, D]);
    const actions = recordErase([], removed);
    expect(actions).toHaveLength(1);
    expect(actions[0]).toEqual({ kind: "erase", removed });
  });

  test("undo puts every stroke back at its original position, byte-exactly", () => {
    const malformed = ["not json at all"];
    const actions = recordErase([], removed);
    const step = undoStep(actions, kept);
    expect(step).not.toBeNull();
    expect(step!.sketches).toEqual(DRAWING);
    expect(step!.actions).toEqual([]);
    // The file's bytes come back exactly as they stood before the gesture.
    expect(serializeSketches(step!.sketches, malformed)).toBe(
      serializeSketches(DRAWING, malformed),
    );
  });

  test("a drawn stroke is taken back as it always was", () => {
    const actions = recordDraw([], DRAWING.length - 1);
    const step = undoStep(actions, DRAWING);
    expect(step!.sketches).toEqual([A, B, C]);
    expect(step!.actions).toEqual([]);
    // An action whose position the drawing has moved past is never trusted:
    // the record's own order rule stands.
    const stale = recordDraw([], 9);
    expect(undoStep(stale, DRAWING)!.sketches).toEqual([A, B, C]);
  });

  test("an empty stack falls back to popping the last stroke's line", () => {
    expect(undoStep([], DRAWING)).toBeNull();
    expect(undoLastSketch(DRAWING)).toEqual([A, B, C]);
    // An empty take is never a do-nothing action.
    expect(recordErase([], [])).toEqual([] as SketchAction[]);
  });

  test("an erase that took the drawing's last stroke is still undoable", () => {
    const take = eraseStrokes([A], THROUGH_A, 2);
    expect(take.kept).toEqual([]);
    const step = undoStep(recordErase([], take.removed), take.kept);
    expect(step!.sketches).toEqual([A]);
    // Undo consults the session's memory BEFORE the record's length: an empty
    // record with a remembered take is a change, not "nothing to do".
    const map = source("src/canvas/useMap.ts");
    const body = map.slice(map.indexOf("const undoSketch = useCallback("));
    const memory = body.indexOf("undoStep(sketchActionsRef.current, current)");
    const empty = body.indexOf("if (current.length === 0) return;");
    expect(memory).toBeGreaterThan(-1);
    expect(empty).toBeGreaterThan(-1);
    expect(memory).toBeLessThan(empty);
  });

  test("the stack is LIFO: erase, draw, then two undos restore both", () => {
    let actions: SketchAction[] = [];
    // Draw D onto A, B, C.
    actions = recordDraw(actions, 3);
    const drawn = [A, B, C, D];
    // Then erase A and C with one gesture.
    const take = eraseStrokes(drawn, ACROSS_THE_INK, 4);
    actions = recordErase(actions, take.removed);
    expect(take.kept).toEqual([B, D]);
    // First undo: the erase — the drawing is whole again.
    const first = undoStep(actions, take.kept)!;
    expect(first.sketches).toEqual([A, B, C, D]);
    // Second undo: the drawn stroke.
    const second = undoStep(first.actions, first.sketches)!;
    expect(second.sketches).toEqual([A, B, C]);
    expect(second.actions).toEqual([]);
  });
});

/* ----------------------------------------------------------------------- *
 * 4. The wiring: the gesture keeps the pen's discipline, the stack persists
 *    nothing, and the tool says nothing about what it took.
 * ----------------------------------------------------------------------- */

describe("the eraser rides the pen's one armed discipline", () => {
  test("the tool state, never a second gate mode, chooses the gesture", () => {
    const tool: DrawTool = "eraser";
    expect(tool).toBe("eraser");
    const plane = source("src/canvas/CanvasPlane.tsx");
    // The meaning is fixed at the press; the surface still owns the pointer.
    expect(plane).toContain("const tool = drawToolRef.current;");
    expect(plane).toContain('if (tool === "eraser") {');
    expect(plane).toContain("onEraseRef.current?.(points);");
    // The eraser paints no draft (quiet); the pen still previews its stroke.
    expect(plane).toContain('if (tool === "pen") setStrokeDraft([...points]);');
    expect(plane).toContain("event.stopPropagation();");
    expect(plane).toContain("drawArmedRef.current");
    // It reuses `drawArmed`; there is no eraser gate mode.
    const gates = source("src/canvas/gates.ts");
    expect(gates).not.toContain('"erase"');
  });

  test("the strip carries the pair and the palette belongs to the pen", () => {
    const bar = source("src/canvas/SketchToolbar.tsx");
    expect(bar).toContain('aria-label="pen"');
    expect(bar).toContain('aria-label="eraser"');
    expect(bar).toContain("aria-pressed={tool === ");
    expect(bar).toContain("disabled={!inkLive}");
    expect(bar).toContain("const inkLive = tool === \"pen\";");
    // The size row stays live for BOTH tools (it buys the eraser's reach).
    expect(bar).toContain("PEN_SIZES.map");
    const app = source("src/App.tsx");
    expect(app).toContain("drawTool={penTool}");
    expect(app).toContain("onErase={handleErase}");
    expect(app).toContain("tool={penTool}");
    expect(app).toContain("onTool={setPenTool}");
    expect(app).toContain("eraseSketch(penSize, path)");
  });

  test("the record's one writer carries the erase; the memory persists nothing", () => {
    const map = source("src/canvas/useMap.ts");
    expect(map).toContain("eraseStrokes(current, path, eraserRadius(size))");
    expect(map).toContain("recordErase(sketchActionsRef.current, removed)");
    expect(map).toContain("undoStep(sketchActionsRef.current, current)");
    expect(map).toContain("recordDraw(");
    // The same in-order writer, with the malformed lines riding along.
    expect(map).toContain("saveSketches(workspacePath, next, malformedLines)");
    expect(map).toContain("malformedSketchesRef.current");
    // The action stack is session memory: no fs, no storage, no serialize.
    const history = codeOf(source("src/canvas/sketchHistory.ts"));
    expect(history).not.toMatch(
      /node:fs|@tauri|writeText|saveSketches|localStorage|indexedDB|JSON\.stringify/,
    );
    expect(history).not.toMatch(/sketchesPath|serializeSketch/);
  });

  test("one erase gesture and one drawn stroke can both be taken back", () => {
    // Undo's enablement must not read the record's length alone: an erase that
    // took the last stroke away can still be undone.
    const map = source("src/canvas/useMap.ts");
    expect(map).toContain("canUndoSketch: sketches.length > 0 || sketchUndoable");
    const app = source("src/App.tsx");
    expect(app).toContain("canUndo={canUndoSketch}");
  });
});

describe("the erase gesture has no voice", () => {
  test("no tally, notice, badge or live region on the strip", () => {
    // The ban is on what is SAID and RENDERED, not on a comment saying there
    // is no tally (the family's scan idiom: comments are stripped first).
    const bar = codeOf(source("src/canvas/SketchToolbar.tsx"));
    expect(bar).not.toMatch(/\berased\b|\btally\b|\bbadge\b|\bscore\b/i);
    expect(bar).not.toMatch(/aria-live/);
    expect(bar).not.toMatch(/role="status"/);
    expect(bar).not.toMatch(/\b\d+\b.*\bstrokes?\b/i);
    // Nothing renders what the gesture took: the plane reports, the record
    // writes, and the strip's only change is the disabled undo button.
    for (const file of ["src/canvas/CanvasPlane.tsx", "src/canvas/useMap.ts"]) {
      const code = codeOf(source(file));
      expect({ file, voice: /\berased\b|\btally\b|\bbadge\b/i.test(code) }).toEqual(
        { file, voice: false },
      );
    }
  });
});
