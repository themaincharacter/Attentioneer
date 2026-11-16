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
