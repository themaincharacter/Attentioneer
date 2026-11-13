/**
 * The plane's double-click guard (Epic 3 feedback): a double-click opens the
 * word/lack menu only when both of its presses landed on empty plane. The
 * plane records its presses on a raw mousedown listener; word, wire, ring and
 * menu presses stop propagation (or are filtered by target) before that
 * counter, so a hurried double-click on a word — which centers it — can never
 * create anything. A single click is inert: there is no cast to defer and no
 * ambiguity left to disambiguate.
 *
 * Pure so the rule is testable without a DOM; the plane asks this predicate.
 * Provisional constants, set by feel at the slice.
 */

/** How far apart two presses can be and still read as one double-click. */
export const DOUBLE_CLICK_MS = 800;

/** Screen pixels between two presses that could be one double-click. */
export const PAIR_SLOP = 8;

/** One press of the empty plane, recorded on raw mousedown. */
export interface PlanePress {
  t: number;
  x: number;
  y: number;
}

/** Do these two presses read as one double-click in the making? */
export function closesPair(a: PlanePress, b: PlanePress): boolean {
  return b.t - a.t <= DOUBLE_CLICK_MS && Math.hypot(b.x - a.x, b.y - a.y) <= PAIR_SLOP;
}
