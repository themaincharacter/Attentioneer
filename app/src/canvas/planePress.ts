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

/** Screen ms within which two presses on a sign are one press-pair (a
 * double-click on the sign glyph counts once, story 2). Provisional. */
export const SIGN_PAIR_MS = 400;

/**
 * Does a press on a sign glyph count as a flip, or is it the second half of a
 * press-pair? A double-click fires two clicks; without this the sign would flip
 * twice and land back where it started — a quiet no-op that reads as a broken
 * gesture. Each link carries its own last-press time, so two quick presses on
 * different signs are two flips.
 */
export function countsAsOneFlip(
  previousAt: number | null,
  now: number,
  windowMs = SIGN_PAIR_MS,
): boolean {
  return previousAt === null || now - previousAt > windowMs;
}
