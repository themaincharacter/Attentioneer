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
 */

import type { Level } from "../workspace/level";

/** Below this zoom a rendered note collapses to its title (inclusive read). */
export const COLLAPSE_BELOW = 0.55;

/** Below this zoom a distance hides its coined word; the wire always stays. */
export const DISTANCE_LABEL_BELOW = 0.55;

/**
 * The concept band ends here: at or past this zoom the game is dynamics
 * (provisional — tuned at the slice, not settled by any ADR).
 */
export const DYNAMICS_FROM = 0.85;

/**
 * The dynamics band ends here: at or past this zoom the game is ground
 * (provisional — tuned at the slice, not settled by any ADR).
 */
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
 */
export const BAND_ZOOM: Record<Level, number> = {
  concept: 0.8,
  dynamics: 1,
  ground: 2,
};
