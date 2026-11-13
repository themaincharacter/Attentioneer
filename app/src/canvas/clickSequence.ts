/**
 * Click disambiguation for the plane's two gestures (Epic 3 story 2): a plain
 * click casts a bare lack (map ticket 03), while a double-click still coins a
 * word (ADR-0007). A naive single-click cast would leave a stray mark before
 * every coin, so the cast is *deferred*: a close second press cancels it. The
 * trade-off is a small delay before a ring appears — chosen so coining never
 * leaves a stray mark. A slower double-click (still reported by the browser)
 * is caught by the coin path, which consumes the freshly cast spot instead.
 *
 * Pure so the rule is testable without a DOM: the plane records its presses
 * and asks these predicates. Provisional constants, set by feel at the slice.
 */

/** Delay before a plain click leaves a lack (the double-click window). */
export const CAST_DELAY_MS = 250;

/** How far apart presses can be and still read as one double-click. */
export const DOUBLE_CLICK_MS = 800;

/** Screen pixels of pointer drift allowed inside one click (more = a pan). */
export const CLICK_SLOP = 4;

/** Screen pixels between two presses that could be one double-click. */
export const PAIR_SLOP = 8;

/** One press of the plane, recorded on mousedown (word presses never reach it). */
export interface PlanePress {
  t: number;
  x: number;
  y: number;
}

/** One click of the plane (the same coordinates, sampled on click). */
export interface PlaneClick {
  t: number;
  x: number;
  y: number;
}

/** Do these two presses read as one double-click in the making? */
export function closesPair(a: PlanePress, b: PlanePress): boolean {
  return b.t - a.t <= DOUBLE_CLICK_MS && Math.hypot(b.x - a.x, b.y - a.y) <= PAIR_SLOP;
}

/** Is `click` a plain click (not a pan) following the press `down`? */
export function isPlainClick(down: PlanePress, click: PlaneClick): boolean {
  return (
    click.t - down.t <= DOUBLE_CLICK_MS &&
    Math.hypot(click.x - down.x, click.y - down.y) <= CLICK_SLOP
  );
}

/** Is the latest press the second of a close pair? (Its first cast is canceled.) */
export function isSecondOfPair(presses: readonly PlanePress[]): boolean {
  if (presses.length < 2) return false;
  return closesPair(presses[presses.length - 2], presses[presses.length - 1]);
}

/**
 * Did the coin that just happened (its double-click started at `firstPress`)
 * come from the press whose deferred cast already fired? Then the coin
 * consumes that spot line instead of leaving a stray bare mark.
 */
export function castIsConsumed(
  firstPress: PlanePress,
  lastCast: { press: PlanePress } | null,
): boolean {
  return lastCast !== null && lastCast.press.t === firstPress.t;
}
