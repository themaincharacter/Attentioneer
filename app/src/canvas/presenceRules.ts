import type { Level } from "../workspace/level";

/**
 * The in-band presence cues (ADR-0019 decision 2; Epic 6 story 3): a face's
 * presence lives in its OWN band, never announced across bands. The rule is a
 * table so no component can drift from it:
 *
 *   - the reach (a word's pointers) is ground's cue;
 *   - the assumption diamond (on a word, a link, a loop or a bare spot) is
 *     dynamics' cue, and so are the signed links and the loop routes.
 *
 * Within its band, a cue may say WHETHER something is there — the reach handle
 * reads SOLID when the word has pointers and FAINT-but-addable when it has
 * none (the diamond's `has-assumptions` precedent: presence, never a count).
 * That is allowed only inside the band; the follow control, which crosses
 * bands, is neutral (ADR-0019).
 *
 * Provisional: the cue glyphs and the solid/faint weights (ADR-0003's
 * rendering seam).
 */

/** A face's presence glyph. */
export type PresenceCue = "reach" | "assumptions" | "loops" | "links";

/**
 * Which game each cue belongs to, and ONLY that game. Everything else on the
 * plane (words, distances, marks, the shelf) renders in every game and has no
 * entry here — it announces nothing.
 */
export const CUE_BANDS: Record<PresenceCue, readonly Level[]> = {
  reach: ["ground"],
  assumptions: ["dynamics"],
  loops: ["dynamics"],
  links: ["dynamics"],
};

/** Does this game show this cue? (No cue has more than one band.) */
export function cueShownIn(cue: PresenceCue, level: Level): boolean {
  return CUE_BANDS[cue].includes(level);
}

/**
 * The reach handle's within-band read: SOLID when the word carries at least
 * one authored pointer line, FAINT-but-addable when it carries none. Presence,
 * never a count — however many lines, one solid handle.
 */
export type ReachCue = "solid" | "faint";

export function reachCue(hasPointers: boolean): ReachCue {
  return hasPointers ? "solid" : "faint";
}

/**
 * The reach handle's modifier classes (the base class is the caller's): the
 * solid/faint cue plus the marked ring, which is the open-mark presence and
 * rides on either state. The base class stays literal in the markup so the
 * fixed-slot rule reads at a glance.
 */
export function reachHandleModifiers(
  hasPointers: boolean,
  marked: boolean,
): string {
  return (reachCue(hasPointers) === "solid" ? " has-pointers" : "") +
    (marked ? " marked" : "");
}
