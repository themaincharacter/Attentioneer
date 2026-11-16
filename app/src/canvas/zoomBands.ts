/**
 * Which content shows at which zoom band (ADR-0003), and which language game
 * the band hosts at runtime (ADR-0018). Provisional: the band boundaries and
 * each band's landing zoom are tuned at the slice; no ADR settles the numbers.
 *
 * The BAND boundaries are SEPARATE constants from the CONTENT thresholds: a
 * band boundary is where the game changes (`DYNAMICS_FROM`, `GROUND_FROM`); a
 * content threshold is where a label folds (`COLLAPSE_BELOW`,
 * `DISTANCE_LABEL_BELOW`). The old double-booking (both at 55%) is gone, so
 * tuning one can never silently move the other.
 *
 * Every reading goes through ONE comparison, `atOrAbove`, and its inclusive
 * rule: a zoom exactly ON a threshold belongs to the higher band and keeps its
 * label. Two spellings of that boundary (`<` in one rule, `>=` in the next)
 * used to disagree; now there is one. `levelFromZoom` — the derivation that
 * makes the band the game (ADR-0018) — reads these constants through it and
 * lives with the level's own rules in `workspace/level.ts`.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps, ADR-0032):
 * THE BAND IS NO LONGER THE GAME AT RUNTIME. The three maps are separate
 * mini-apps, the level TABS switch them and nothing else, and the wheel only
 * zooms within the current map — so `DYNAMICS_FROM` and `GROUND_FROM` no longer
 * switch anything, and nothing derives a map from a zoom. The constants, the
 * comparison and the derivation all STAY WRITTEN and type-checked (the band
 * tests still assert them, and `linkWiresVisible` still reads the running map);
 * `BAND_ZOOM`'s three numbers now serve as each map's OPENING camera
 * (`useCamera.ts`). Delete the band boundaries and the derivation in the
 * deprecated sweep; the LABEL thresholds above are unaffected (they are content,
 * not bands).
 */

import type { Level } from "../workspace/level";

/** Below this zoom a rendered note collapses to its title (inclusive read). */
export const COLLAPSE_BELOW = 0.55;

/** Below this zoom a distance hides its coined word; the wire always stays. */
export const DISTANCE_LABEL_BELOW = 0.55;

// DEPRECATED (hidden 2026-11-16 per user review): this boundary used to switch
// the map to dynamics at a settled zoom. The maps are separate mini-apps now —
// the tabs switch them — so the number is the derivation's inert input only
// (workspace/level.ts's `levelFromZoom`); delete it with the zoom switch in the
// deprecated sweep.
/** Where the old concept band ended (inert while ZOOM_SWITCHES_MAP_HIDDEN). */
export const DYNAMICS_FROM = 0.85;

// DEPRECATED (hidden 2026-11-16 per user review): this boundary used to switch
// the map to ground at a settled zoom — inert for the same reason as
// DYNAMICS_FROM above; delete it with the zoom switch in the deprecated sweep.
/** Where the old dynamics band ended (inert while ZOOM_SWITCHES_MAP_HIDDEN). */
export const GROUND_FROM = 1.7;

/**
 * The one comparison every band and every label reading shares: is `zoom` at
 * or above `threshold`? INCLUSIVE — exactly on a threshold counts as above it,
 * so a band's floor and a label's floor are both "at or above".
 */
export function atOrAbove(zoom: number, threshold: number): boolean {
  return zoom >= threshold;
}

export type NoteBand = "title" | "full";

/** A working note's band: full at or above the collapse threshold, else title. */
export function noteBand(zoom: number): NoteBand {
  return atOrAbove(zoom, COLLAPSE_BELOW) ? "full" : "title";
}

/** A distance shows its word at or above this band; the wire always stays. */
export function distanceLabelVisible(zoom: number): boolean {
  return atOrAbove(zoom, DISTANCE_LABEL_BELOW);
}

/**
 * Do the signed link wires (and their head signs) render?
 *
 * THE LINKWIRE ZOOM-GATE DECISION (Epic 6 story 3): link wires are BAND-based —
 * they render exactly while the dynamics game is active, and nowhere else. They
 * are NOT tied to `COLLAPSE_BELOW` or `DISTANCE_LABEL_BELOW`: those thresholds
 * stay label-only rules, and a wire's presence is a GAME question, not a label
 * one. The consequence the decision cares about — no bare link pixels lingering
 * below the label-collapse band — holds because the dynamics band's floor sits
 * well above both label thresholds (a zoom that folds labels is concept, where
 * no link renders at all). Provisional: the landing zooms and boundaries are
 * tuned at the slice; the band gate itself is the decision.
 */
export function linkWiresVisible(level: Level): boolean {
  return level === "dynamics";
}

/**
 * The zoom each band LANDS on (provisional): where its content reads best,
 * where a deliberate jump arrives, and where a click-to-center settles. The
 * concept one sits at the legible top of its band — above the label threshold
 * (a jump to concept never hides the distance words) and close to the familiar
 * 100% without leaving the band; dynamics keeps the old readable 100%; ground
 * is close enough to read a reach without hunting.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps): nothing
 * LANDS on these zooms any more (the band jump and the band-aware centering are
 * retired, ADR-0032). The three numbers live on as each map's OPENING camera
 * (`useCamera.ts`'s `initialMapCameras`) — PROVISIONAL there, and the table
 * keeps its name here for the sweep's record; delete the band meaning in the
 * deprecated sweep.
 */
export const BAND_ZOOM: Record<Level, number> = {
  concept: 0.8,
  dynamics: 1,
  ground: 2,
};
