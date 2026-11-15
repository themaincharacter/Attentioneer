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

/**
 * Signed-link geometry (Epic 4 story 2, ADR-0012/0014/0016). A pair may carry
 * two directed links (A→B and B→A); they must read as two wires, never as one
 * doubled line. The frame is CANONICAL and UNORDERED: the two endpoint points
 * are sorted by slug once, the chord's normal is derived from that sorted
 * order, and each direction is shifted onto its own side of the chord. So the
 * side is a property of the pair, not of the draw order, and the gap is
 * constant on screen at every zoom (provisional, like every glyph in ADR-0003's
 * seam).
 */

/** Screen px between the two directions of one pair (provisional). */
export const LINK_PAIR_GAP_PX = 9;

/** World units the head cluster (sign glyph, ring, ×) sits back from the target
 * edge, clear of the word's text (provisional). */
export const LINK_HEAD_BACK = 16;

/** The world-unit gap for a zoom — constant pixels on screen. */
export function pairGap(zoom: number): number {
  return LINK_PAIR_GAP_PX / Math.max(zoom, 0.0001);
}

/**
 * Which side of the canonical chord a directed link runs on: +1 when its
 * origin sorts first, -1 otherwise, 0 for a self-link (which sits on the
 * chord). A pair's sides are opposite by construction, so both wires stay
 * apart at every zoom.
 */
export function pairSide(from: string, to: string): number {
  if (from === to) return 0;
  return from < to ? 1 : -1;
}

/** The unit normal of the chord `lo` → `hi` (null for a degenerate chord). */
export function chordNormal(lo: Point, hi: Point): Point | null {
  const dx = hi.x - lo.x;
  const dy = hi.y - lo.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  // Normalize -0 away: a normal is a direction, and -0 would leak into both
  // the rendered transform and a toEqual comparison.
  return { x: dy === 0 ? 0 : -dy / length, y: dx === 0 ? 0 : dx / length };
}

/** One endpoint of a link as the wire sees it: its slug and edge point. */
export interface DirectedEndpoint {
  slug: string;
  point: Point;
}

/**
 * A directed link's rendered wire (ADR-0014's one pair-spine): both endpoints
 * shifted together onto the direction's side of the canonical unordered chord,
 * returned in DRAW order (origin first, target second). A→B and B→A therefore
 * run parallel on opposite sides; the identical pair never doubles up. A
 * self-link or a degenerate chord renders the plain points.
 */
export function directedWireEndpoints(
  from: DirectedEndpoint,
  to: DirectedEndpoint,
  zoom = 1,
): { from: Point; to: Point } {
  const canonical = from.slug <= to.slug;
  const lo = canonical ? from.point : to.point;
  const hi = canonical ? to.point : from.point;
  const side = pairSide(from.slug, to.slug);
  const normal = side === 0 ? null : chordNormal(lo, hi);
  if (!normal) return { from: from.point, to: to.point };
  const gap = pairGap(zoom) * side;
  const shift = { x: normal.x * gap, y: normal.y * gap };
  const shiftedLo = { x: lo.x + shift.x, y: lo.y + shift.y };
  const shiftedHi = { x: hi.x + shift.x, y: hi.y + shift.y };
  return canonical
    ? { from: shiftedLo, to: shiftedHi }
    : { from: shiftedHi, to: shiftedLo };
}

/** A point `back` world units from `head` toward `tail` (the head cluster). */
export function pointToward(head: Point, tail: Point, back: number): Point {
  const dx = tail.x - head.x;
  const dy = tail.y - head.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return head;
  return { x: head.x + (dx / length) * back, y: head.y + (dy / length) * back };
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