import type { Sketch, SketchPoint } from "../map/sketches";
import type { GestureMode } from "./gates";

/**
 * The map's pen — pure rules (added 2026-11-16 per user review).
 *
 * The review asked for "a simple draw layer over the map canvas — pen size,
 * color, undo — like any map tool": freehand strokes on the plane in WORLD
 * space (so pan and zoom carry them like ink on paper), a few sizes, a small
 * quiet palette plus a picker, and undo that pops the last stroke. No scoring,
 * no layers panel, no text tool.
 *
 * This module owns what can be decided without a DOM: the palette, the sizes,
 * how a stroke's points become an SVG path, how far the pointer must travel
 * before a sample is taken, whether a drag is a stroke at all, and the ink a
 * stored colour actually paints with. The stroke's GEOMETRY is the plane's
 * (CanvasPlane's capture surface, in world coordinates); the RECORD is
 * `map/sketches.ts`; only the decisions live here.
 *
 * ARMING DISCIPLINE: the pen is a GATE MODE (`"draw"`, gates.ts), exactly
 * like the veil's draw box. While it is armed `isGestureArmed` is true, so the
 * plane's own gestures all stand still — pan (`shouldPan`), double-click
 * creation (`shouldCreate`) and every word press (`shouldStartWordPress`) are
 * false — and the pen's own capture surface owns the pointer. A stroke can
 * never move a word, open the ring menu or pan the map; the wheel still zooms
 * (the other arms' rule), so a person can reach a distant part of the drawing
 * without ending the mode.
 *
 * Provisional (the review's list): the palette, the four sizes, the sampling
 * step, world-unit thickness and the size of the strokes' own layer.
 */

/** The pen's mode, named once so the app and its tests cannot drift. */
export const DRAW_MODE: GestureMode = "draw";

/**
 * The quiet ink palette: the app's warm paper vocabulary, dark enough to read
 * over the plane's grid without becoming a highlight. The picker can paint any
 * colour beyond these; the palette is the quiet default set.
 */
export const PEN_COLORS: readonly string[] = [
  "#3b3a35",
  "#8d887c",
  "#a9522f",
  "#5f7355",
  "#4d5f86",
];

/** A few sizes, in WORLD units: hairline, pen, marker, brush. */
export const PEN_SIZES: readonly number[] = [1, 2, 4, 8];

/** The pen's opening reading: the palette's ink and the second size. */
export const DEFAULT_PEN_COLOR = PEN_COLORS[0];
export const DEFAULT_PEN_SIZE = PEN_SIZES[1];

/**
 * Screen pixels the pointer must travel before the stroke takes a sample, so a
 * slow hand does not write thousands of near-identical points. Sampled in
 * SCREEN space: the recorded density stays the same at every zoom.
 */
export const SKETCH_STEP_PX = 2;

/** Does this string name an ink CSS can paint? `#rgb` or `#rrggbb` only. */
export function isPenColor(value: unknown): value is string {
  return typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
}

/**
 * The ink a stored colour actually paints with. The record keeps the authored
 * string verbatim (map/sketches.ts); the render uses it only when it is a
 * colour, and falls back to the palette's ink otherwise — a hand-edited line
 * that says "chartreuse-ish" is kept and surfaced, never rewritten, and it
 * still draws.
 */
export function penInk(color: string): string {
  return isPenColor(color) ? color : DEFAULT_PEN_COLOR;
}

/** Is this a size the pen offers (or any positive finite width from a file)? */
export function isPenSize(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Take a sample only when the pointer has moved far enough. `minDistance` is
 * in WORLD units (the caller divides SKETCH_STEP_PX by the camera's zoom), so
 * the rule stays pure and testable. The first point of a stroke always enters.
 */
export function sampleStroke(
  points: readonly SketchPoint[],
  point: SketchPoint,
  minDistance: number,
): readonly SketchPoint[] {
  if (points.length === 0) return [point];
  const last = points[points.length - 1];
  if (Math.hypot(point.x - last.x, point.y - last.y) < minDistance) {
    return points;
  }
  return [...points, point];
}

/**
 * Is this drag a stroke? A stroke needs two points: a press that never moved
 * draws (and writes) nothing, the veil box's "a click encloses nothing" rule.
 */
export function isDrawableStroke(points: readonly SketchPoint[]): boolean {
  return points.length >= 2;
}

/**
 * One stroke's SVG path data: an absolute move to the first point, then a
 * straight line to each sample. World coordinates are used as they stand (the
 * layer lives inside `.plane-inner`, so the camera's transform carries them).
 * Three decimals keep the attribute small without a visible rounding on the
 * plane; the RECORD keeps the full floats.
 */
export function strokePath(points: readonly SketchPoint[]): string {
  if (points.length === 0) return "";
  const at = (point: SketchPoint) => `${round(point.x)} ${round(point.y)}`;
  const [first, ...rest] = points;
  const moves = rest.map((point) => `L ${at(point)}`).join(" ");
  return `M ${at(first)}${rest.length === 0 ? "" : " " + moves}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The pen's point set for the SVG layer: a stroke with a hand-edited oversized
 * size is painted as written (the record says what it says), and a stroke with
 * one point would paint nothing — the record forbids it, so no special case is
 * needed here beyond drawing what the layer holds.
 */
export function strokesToPaths(
  strokes: readonly Sketch[],
): Array<{ id: number; d: string; ink: string; size: number }> {
  return strokes.map((stroke, index) => ({
    id: index,
    d: strokePath(stroke.points),
    ink: penInk(stroke.color),
    size: stroke.size,
  }));
}

/* ----------------------------------------------------------------------- *
 * The eraser (PROVISIONAL, added 2026-11-16 per user review).
 * ----------------------------------------------------------------------- */

/**
 * What a drag on the armed capture surface MEANS. The eraser is not a second
 * arm: the pen's `draw` gate is reused and this state chooses the gesture's
 * meaning, so the arming discipline stays exactly the pen's — pan, double-click
 * creation and every word press stand still, and the capture surface owns the
 * pointer (a press can never move a word, open a ring menu or pan the map).
 *
 * PROVISIONAL: the review asked only for "an eraser option as well that removes
 * the drawing as usual"; the tool pair and the reach below are the smallest
 * reading of that ask.
 */
export type DrawTool = "pen" | "eraser";

/** The pen opens (a drawing layer, with erasing beside it). */
export const DEFAULT_DRAW_TOOL: DrawTool = "pen";

/**
 * The eraser's reach, in WORLD units, as a multiple of the selected pen size:
 * the strip's ONE size selector drives whichever tool is live (the review's
 * "the size selector drives the active tool"). PROVISIONAL — twice the pen's
 * width is a first feel for a whole-stroke eraser (the ink's own width plus a
 * margin), not a settled rule.
 */
export const ERASER_RADIUS_FACTOR = 2;

/** The eraser's reach for the size the person has chosen right now. */
export function eraserRadius(penSize: number): number {
  return (isPenSize(penSize) ? penSize : DEFAULT_PEN_SIZE) * ERASER_RADIUS_FACTOR;
}

/** Distance from `point` to the segment `a`—`b`, in world units. */
export function pointSegmentDistance(
  point: SketchPoint,
  a: SketchPoint,
  b: SketchPoint,
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  if (lengthSq === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const along = ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq;
  const t = Math.max(0, Math.min(1, along));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/** The side of `r` the segment `a`—`b` puts it on (0 = on the line). */
function side(a: SketchPoint, b: SketchPoint, r: SketchPoint): number {
  return (b.y - a.y) * (r.x - b.x) - (b.x - a.x) * (r.y - b.y);
}

/** Do the two segments properly cross (their endpoints straddle each other)? */
function segmentsCross(
  a1: SketchPoint,
  a2: SketchPoint,
  b1: SketchPoint,
  b2: SketchPoint,
): boolean {
  const d1 = side(a1, a2, b1);
  const d2 = side(a1, a2, b2);
  const d3 = side(b1, b2, a1);
  const d4 = side(b1, b2, a2);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
}

/**
 * Distance between the segments `a1`—`a2` and `b1`—`b2`, in world units —
 * zero when they cross. The eraser's reach is SEGMENT-to-segment, not
 * point-to-segment: a drag that crosses a stroke between two of its samples
 * (or between two of the drag's own samples) must still reach it, because a
 * fast hand's samples can be far apart.
 */
export function segmentDistance(
  a1: SketchPoint,
  a2: SketchPoint,
  b1: SketchPoint,
  b2: SketchPoint,
): number {
  if (segmentsCross(a1, a2, b1, b2)) return 0;
  return Math.min(
    pointSegmentDistance(a1, b1, b2),
    pointSegmentDistance(a2, b1, b2),
    pointSegmentDistance(b1, a1, a2),
    pointSegmentDistance(b2, a1, a2),
  );
}

/**
 * The points as segments (one per consecutive pair). A lone point is its own
 * degenerate segment, so a TAP that never moved still has somewhere to reach
 * from — the drawing tool needs two points to be a stroke, the eraser does not.
 */
function segmentsOf(
  points: readonly SketchPoint[],
): Array<readonly [SketchPoint, SketchPoint]> {
  if (points.length === 0) return [];
  if (points.length === 1) return [[points[0], points[0]]];
  const segments: Array<readonly [SketchPoint, SketchPoint]> = [];
  for (let at = 0; at + 1 < points.length; at += 1) {
    segments.push([points[at], points[at + 1]]);
  }
  return segments;
}

/**
 * How far the drag path passes from a stroke, in world units: the shortest
 * distance between any segment of the stroke and any segment of the path.
 * Infinity when either side has no points (nothing to reach, nothing reaching).
 */
export function strokeDistance(
  stroke: readonly SketchPoint[],
  path: readonly SketchPoint[],
): number {
  const ink = segmentsOf(stroke);
  const drag = segmentsOf(path);
  if (ink.length === 0 || drag.length === 0) return Number.POSITIVE_INFINITY;
  let nearest = Number.POSITIVE_INFINITY;
  for (const [a1, a2] of ink) {
    for (const [b1, b2] of drag) {
      const distance = segmentDistance(a1, a2, b1, b2);
      if (distance < nearest) nearest = distance;
      if (nearest === 0) return 0;
    }
  }
  return nearest;
}

/** Does the drag path pass within `radius` of this stroke? (the atom test) */
export function strokeInReach(
  stroke: readonly SketchPoint[],
  path: readonly SketchPoint[],
  radius: number,
): boolean {
  return strokeDistance(stroke, path) <= radius;
}

/** One stroke the eraser took, with the FILE POSITION it came from. */
export interface ErasedStroke {
  /** The stroke's index in the drawing when the gesture took it. */
  at: number;
  stroke: Sketch;
}

/** One gesture's take: the strokes still standing, and the ones that went. */
export interface EraseResult {
  kept: Sketch[];
  removed: ErasedStroke[];
}

/**
 * Apply one erase gesture to the drawing: every stroke the path reaches goes
 * WHOLE (a stroke is the atom — there is no partial-point surgery, so the
 * record's stroke shape is never rewritten point by point), and the survivors
 * keep their order and their exact record (unknown keys included: they are the
 * same objects, so the family's preservation posture holds through the
 * rewrite). Each removal reports the POSITION it held, so one undo can put the
 * gesture's take back where it was.
 *
 * The gesture is one action: two strokes reached by one drag are one undo.
 */
export function eraseStrokes(
  strokes: readonly Sketch[],
  path: readonly SketchPoint[],
  radius: number,
): EraseResult {
  const kept: Sketch[] = [];
  const removed: ErasedStroke[] = [];
  strokes.forEach((stroke, at) => {
    if (strokeInReach(stroke.points, path, radius)) {
      removed.push({ at, stroke });
    } else {
      kept.push(stroke);
    }
  });
  return { kept, removed };
}
