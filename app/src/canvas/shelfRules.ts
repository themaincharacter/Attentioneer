import {
  SHELF_HIDDEN,
  ZOOM_SWITCHES_MAP_HIDDEN,
} from "./deprecations";

/**
 * THE SHELF'S HIDING READINGS (added 2026-11-16 per user review) — the ONE place
 * the app asks "is the shelf shown right now?".
 *
 * The review removed the shelf from the concept map (see deprecations.ts's
 * SHELF_HIDDEN): the fold and its shaded margin, the word's reject control, the
 * drag-past-the-fold gesture and the plane hint's fold clause are all hidden, and
 * NOTHING is deleted. `map/shelf.ts` keeps the fold's RECORD — `shelf_x` still
 * parses and defaults, `isShelved`, `rejectSpot`, `foldExtent` and
 * `foldCaptionTops` all still compute — and every reading here takes the flag as
 * a DEFAULTED parameter, so the flag is a runtime fact at every call and a test
 * can hand in `false` to demonstrate the flip-back.
 *
 * The three questions the render asks, in one place so no render path can drift:
 *
 *   - `shelfShown()` — does the fold, its margin and its caption render at all?
 *   - `setAsideShown()` — may this word be drawn? A word already set aside (its
 *     record's centre is past the fold) lives on a place that is not there any
 *     more, so it is NOT SHOWN anywhere while the flag stands; its file is
 *     untouched and flipping the flag back shows it on the shelf it never left.
 *   - `heldLeftOfTheFold()` — where a settled drag may put the word. While the
 *     shelf is hidden a word cannot land past the fold: it would become an
 *     invisible set-aside word and the person would have lost it. PROVISIONAL:
 *     this stop at the old fold line is the review's named cost (deprecations.ts
 *     says so), and it disappears with them when the flag flips back.
 *
 * Not to be confused with the level rules in `mapContentRules.ts`: that module
 * decides which MAP renders content (ADR-0032); this one decides whether the
 * shelf is part of the concept map at all.
 */

/** Is the shelf (fold, margin, captions) drawn right now? */
export function shelfShown(hidden: boolean = SHELF_HIDDEN): boolean {
  return !hidden;
}

/**
 * May a word be drawn? A word that is set aside is not shown while the shelf is
 * hidden: there is no shelf to sit on and no fold to read against, and settling
 * such a word back onto the plane would silently change the map the person made.
 * With the flag off (the pre-review app) every word is drawn, set aside or not.
 */
export function setAsideShown(
  setAside: boolean,
  hidden: boolean = SHELF_HIDDEN,
): boolean {
  return !hidden || !setAside;
}

/**
 * Is this word's RECORD set aside — i.e. was it put on the shelf?
 *
 * `map/shelf.ts`'s `isShelved` tests the word's CENTRE (the natural "past the
 * line" reading while a drag crosses it). For HIDING, this reading uses the
 * record's LEFT EDGE instead: `map/shelf.ts` says a reference file read alone
 * with `x` at or past `shelf_x` is ALWAYS set aside, while a word whose centre is
 * past the fold only by its rendered width is a borderline case. The left edge
 * has two properties the hiding needs: it is stable (a re-measure can never flip
 * a visible word into the hidden set) and it is the least destructive (only a
 * word genuinely parked beyond the fold disappears).
 */
export function recordSetAside(x: number, shelfX: number): boolean {
  return x >= shelfX;
}

/**
 * Where a settled drag (or a coin) puts a word's left edge: at or past the fold it
 * is held just short of it while the shelf is hidden, so no word can become set
 * aside without the shelf existing to hold it (see the module note; PROVISIONAL).
 * One world unit of margin, well under a screen pixel at every allowed zoom.
 */
export function heldLeftOfTheFold(
  x: number,
  shelfX: number,
  hidden: boolean = SHELF_HIDDEN,
): number {
  if (!hidden) return x;
  return Math.min(x, shelfX - 1);
}

/**
 * Is the map switched by the settled zoom right now? The fourth review's second
 * retirement (deprecations.ts's ZOOM_SWITCHES_MAP_HIDDEN, ADR-0032): the maps are
 * SEPARATE mini-apps, the tabs switch them, and the wheel only zooms within the
 * map you are on. Every zoom-derived switch (the level handoff's `settle`, the
 * level pin, the camera's band intent) asks this one reading before it runs.
 */
export function zoomSwitchesMap(
  hidden: boolean = ZOOM_SWITCHES_MAP_HIDDEN,
): boolean {
  return !hidden;
}
