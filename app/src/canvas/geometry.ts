/**
 * Canvas geometry (ADR-0003's rendering seam): words are boxes on the plane,
 * wires run between their edges. Pure functions so the wire layout is
 * testable without a DOM.
 */

export type Point = { x: number; y: number };
export type Box = { w: number; h: number };

/** Fallback word box before measurement (a single line of text). */
export const DEFAULT_BOX: Box = { w: 96, h: 28 };

/**
 * STORY 18.4 — WHERE A NEW CARD GOES BESIDE THE ONE IT CAME FROM: the same
 * scale, offset by a little more than a card's own width so the two never
 * overlap. The selection card (16.12) has always used this offset; the run's
 * result card reuses it so "beside" means one thing on this plane. PROVISIONAL:
 * the side and the offset (ADR-0003's rendering seam).
 */
export const BESIDE_OFFSET_X = 320;

export function besidePlacement(x: number, y: number): Point {
  return { x: x + BESIDE_OFFSET_X, y };
}

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

/**
 * Loop routes (Epic 4 story 3, ADR-0012/0015/0016). A stored loop renders as a
 * quiet CLOSED route through its words in path order, hugging each word's edge
 * so it never crosses text: a word's rim point is the bisector of its incoming
 * and outgoing chords, pushed just off the box, and a walk that passes straight
 * through sends the route around the word's side. One-word loops get a small
 * orbit off the word; two-word cycles get a thin closed ring around both words
 * (a chord is all they have, and the ring still reads as a cycle). Every loop
 * is staggered a little further out (its rank in the file) so overlapping
 * cycles stay distinct.
 *
 * Pure, so the route's "never through text" promise is asserted without a DOM.
 * Provisional: the offsets, the orbit and the ring (ADR-0003's seam).
 */

/** World units a loop's route is pushed out per rank, so overlaps stay apart. */
export const LOOP_ROUTE_STAGGER = 6;

/** World units the route stands off a word's edge (never on the text). */
export const LOOP_ROUTE_STANDOFF = 2;

/** A self-loop's orbit: its radius and the gap from the word's right edge. */
export const SELF_LOOP_RADIUS = 9;
export const SELF_LOOP_GAP = 3;

/** A word as the route sees it: its centre and measured box. */
export interface RouteVisit {
  center: Point;
  box: Box;
}

/** The unit vector center -> toward, or null for a degenerate direction. */
function unitVector(from: Point, to: Point): Point | null {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return { x: dx / length, y: dy / length };
}

/**
 * Where the route leaves (or meets) one word: the bisector of the incoming and
 * outgoing chord directions, pushed off the box edge by the standoff plus this
 * loop's offset. Opposing chords (the walk passes straight through) send it
 * around the side instead, so the route never crosses the text.
 */
export function routeRim(
  visit: RouteVisit,
  prev: Point,
  next: Point,
  offset = 0,
): Point {
  const incoming = unitVector(visit.center, prev);
  const outgoing = unitVector(visit.center, next);
  let direction: Point | null = null;
  if (incoming && outgoing) {
    const sum = { x: incoming.x + outgoing.x, y: incoming.y + outgoing.y };
    const length = Math.hypot(sum.x, sum.y);
    direction =
      length < 1e-6
        ? { x: -incoming.y, y: incoming.x }
        : { x: sum.x / length, y: sum.y / length };
  } else {
    direction = incoming ?? outgoing;
  }
  if (!direction) return { x: visit.center.x, y: visit.center.y };
  const edge = edgePoint(visit.center, visit.box, {
    x: visit.center.x + direction.x,
    y: visit.center.y + direction.y,
  });
  const push = offset + LOOP_ROUTE_STANDOFF;
  return {
    x: edge.x + direction.x * push,
    y: edge.y + direction.y * push,
  };
}

/** A one-word loop's orbit: a small quiet circle off the word's right edge. */
export function selfLoopPoints(visit: RouteVisit, offset = 0): Point[] {
  const radius = SELF_LOOP_RADIUS + offset;
  const center = {
    x: visit.center.x + visit.box.w / 2 + SELF_LOOP_GAP + radius,
    y: visit.center.y,
  };
  const points: Point[] = [];
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2;
    points.push({
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    });
  }
  return points;
}

/**
 * A two-word cycle's ring: a quiet capsule around both words — straight sides
 * hugging the pair, rounded ends wrapping them — so the route encloses the
 * cycle without ever crossing either word's text. The frame is the chord's own
 * (midpoint and angle); the capsule's radius clears the boxes' widest corner,
 * and each loop's rank pushes it a little further out.
 */
export function pairLoopPoints(
  a: RouteVisit,
  b: RouteVisit,
  offset = 0,
): Point[] {
  const angle = Math.atan2(
    b.center.y - a.center.y,
    b.center.x - a.center.x,
  );
  const mid = {
    x: (a.center.x + b.center.x) / 2,
    y: (a.center.y + b.center.y) / 2,
  };
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Every corner of both boxes, in the chord frame.
  let halfLength = 0;
  let halfWidth = 0;
  for (const visit of [a, b]) {
    for (const corner of boxCorners(visit.center, visit.box)) {
      const dx = corner.x - mid.x;
      const dy = corner.y - mid.y;
      const along = dx * cos + dy * sin;
      const across = -dx * sin + dy * cos;
      halfLength = Math.max(halfLength, Math.abs(along));
      halfWidth = Math.max(halfWidth, Math.abs(across));
    }
  }
  const radius = halfWidth + LOOP_ROUTE_STANDOFF + offset;
  const steps = 8;
  const points: Point[] = [];
  const add = (along: number, across: number) => {
    points.push({
      x: mid.x + along * cos - across * sin,
      y: mid.y + along * sin + across * cos,
    });
  };
  // The right cap, then the left cap; the straight sides are the segments
  // between the caps (so the whole ring hugs the pair).
  for (let i = 0; i <= steps; i += 1) {
    const t = -Math.PI / 2 + (i / steps) * Math.PI;
    add(halfLength + radius * Math.cos(t), radius * Math.sin(t));
  }
  for (let i = 0; i <= steps; i += 1) {
    const t = Math.PI / 2 + (i / steps) * Math.PI;
    add(-halfLength + radius * Math.cos(t), radius * Math.sin(t));
  }
  return points;
}

/** The four corners of a word's box (the route layout's containment tests). */
function boxCorners(center: Point, box: Box): Point[] {
  const halfW = box.w / 2;
  const halfH = box.h / 2;
  return [
    { x: center.x - halfW, y: center.y - halfH },
    { x: center.x + halfW, y: center.y - halfH },
    { x: center.x + halfW, y: center.y + halfH },
    { x: center.x - halfW, y: center.y + halfH },
  ];
}

/**
 * The closed route through a loop's words, one visit per path word (the closing
 * repeat omitted by the caller). Three or more words get the rim polyline; a
 * self-loop gets its orbit; a 2-cycle gets its ring. An empty walk has no route.
 */
export function loopRoutePoints(
  visits: readonly RouteVisit[],
  offset = 0,
): Point[] {
  if (visits.length === 0) return [];
  if (visits.length === 1) return selfLoopPoints(visits[0], offset);
  if (visits.length === 2) return pairLoopPoints(visits[0], visits[1], offset);
  return visits.map((visit, i) => {
    const prev = visits[(i - 1 + visits.length) % visits.length];
    const next = visits[(i + 1) % visits.length];
    return routeRim(visit, prev.center, next.center, offset);
  });
}

/** The route's middle, where the coined name sits (the average of its points). */
export function routeCenter(points: readonly Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point.x;
    y += point.y;
  }
  return { x: x / points.length, y: y / points.length };
}
