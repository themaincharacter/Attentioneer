/**
 * Canvas geometry (ADR-0003's rendering seam): words are boxes on the plane,
 * wires run between their edges. Pure functions so the wire layout is
 * testable without a DOM.
 */

export type Point = { x: number; y: number };
export type Box = { w: number; h: number };

/** Fallback word box before measurement (a single line of text). */
export const DEFAULT_BOX: Box = { w: 96, h: 28 };

/** The box's center, given its top-left position on the plane. */
export function centerOf(pos: Point, box: Box): Point {
  return { x: pos.x + box.w / 2, y: pos.y + box.h / 2 };
}

/**
 * Where the ray from `center` toward `toward` leaves the box — the point a
 * wire should attach to, so it never crosses the word's own text.
 */
export function edgePoint(center: Point, box: Box, toward: Point): Point {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : halfW / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : halfH / Math.abs(dy);
  const s = Math.min(scaleX, scaleY);
  return { x: center.x + dx * s, y: center.y + dy * s };
}

/** Both endpoints of the wire between two words, each touching its box edge. */
export function wireEndpoints(
  from: { pos: Point; box: Box },
  to: { pos: Point; box: Box },
): { from: Point; to: Point } {
  const fromCenter = centerOf(from.pos, from.box);
  const toCenter = centerOf(to.pos, to.box);
  return {
    from: edgePoint(fromCenter, from.box, toCenter),
    to: edgePoint(toCenter, to.box, fromCenter),
  };
}

/** A word as the playing-set lasso sees it: slug, top-left position and box. */
export interface LassoWord {
  slug: string;
  pos: Point;
  box: Box;
}

/** Is the point on the segment a→b (a hair of tolerance for float paths)? */
function pointOnSegment(point: Point, a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const cross = (point.x - a.x) * dy - (point.y - a.y) * dx;
  if (Math.abs(cross) > 1e-9) return false;
  const along = (point.x - a.x) * dx + (point.y - a.y) * dy;
  return along >= 0 && along <= dx * dx + dy * dy;
}

/**
 * Is the point inside the closed polygon? Ray casting (world space); a point
 * exactly on an edge counts as inside, so a lasso drawn along a word's border
 * still takes it. Fewer than three points enclose nothing.
 */
export function pointInPolygon(point: Point, polygon: readonly Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i];
    const b = polygon[j];
    if (pointOnSegment(point, a, b)) return true;
    const crosses =
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

/**
 * The words a lasso encloses (the selector's draw tool, ADR-0013): each word
 * by the centre of its box, the same point the shelf tests. Words only —
 * wires are not words and never enter this test. Pure, so the selection rule
 * is testable without a DOM.
 */
export function wordsInPolygon<T extends LassoWord>(
  polygon: readonly Point[],
  words: readonly T[],
): T[] {
  return words.filter((word) => pointInPolygon(centerOf(word.pos, word.box), polygon));
}