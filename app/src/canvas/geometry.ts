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