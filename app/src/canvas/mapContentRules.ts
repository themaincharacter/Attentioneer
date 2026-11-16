import type { Level } from "../workspace/level";
import {
  MAP_CONTENT_OTHER_GAMES_HIDDEN,
  SHELF_HIDDEN,
  WORD_CREATION_OFF_CONCEPT_HIDDEN,
} from "./deprecations";

/**
 * THE SEPARATE-MAPS RULE (added 2026-11-16 per user review) — the ONE reading
 * of "which game renders the concept map's content".
 *
 * The app has three games (concept, dynamics, ground) and, until this review,
 * rendered THE SAME MAP in all three: words, distance wires, marks, the shelf,
 * veils, plus each game's additions (dynamics' link wires, loop routes,
 * assumption diamonds and quantities; ground's reach/pointer handles). The
 * person's verdict is that the maps will NOT be the same maps — dynamics will
 * grow modeling surfaces and ground file references, LATER. For now the
 * dynamics and ground maps are BLANK PAPER: no map content at all.
 *
 * THE RULE, in one place so no render path can drift:
 *
 *   map content renders at CONCEPT only, while the flag stands.
 *
 * Every hiding point in the app asks `showsMapContent(level)` (or, for the
 * double-click bubble's word choice, `wordCreationOffered(level)` — the same
 * shape, one step narrower). The rules take the flag as a DEFAULTED
 * parameter, so the flag is read as a runtime fact at every call (never
 * inlined) and a test can hand in `false` to demonstrate the flip-back: set
 * the flags to `false` in `deprecations.ts` and the content returns with no
 * component edit.
 *
 * WHAT IS *NOT* MAP CONTENT (and so keeps rendering in every game):
 *
 *   - the quiet chrome: the dot-grid paper, pan, zoom, the zoom chip, the three
 *     level tabs and the pen's strip while armed;
 *   - THE PEN'S INK (`SketchLayer`). PROVISIONAL: the draw tool is the one
 *     level-uniform tool the previous review kept in the top menu, and per-map
 *     ink arrives with the later "context" work. Flip it with the rest of the
 *     content only if that later story asks for it;
 *   - the HONESTY SURFACES (the notices strip at `App.tsx`'s `MarkNotices` and
 *     every scan). Those are deliberately NOT gated here: an unreadable or
 *     orphaned record line is surfaced whatever the plane shows (ADR-0009),
 *     and silencing one to make a blank map look tidier would be a lie. The
 *     tension — the strip can name a record whose content is hidden in this
 *     game — is REPORTED, not resolved by hiding the notice.
 *
 * Nothing is deleted by the rule: it only decides what an OFFERED render path
 * paints. Every record, component and panel stays written exactly where it was.
 *
 * Provisional: that the blank maps stay blank (and the pen's ink stays) is the
 * review's call for THIS story; the maps' own future content is the later work.
 */

/**
 * Every family of the concept map's record content. Named once so the
 * blank-map invariant can be asserted over the whole class rather than a
 * remembered list of components, and so the deprecated sweep knows what the
 * copy-over consisted of.
 */
export const MAP_CONTENT_FAMILIES = [
  /** The coined words (ReferenceWord and its whole row). */
  "words",
  /** The distance wires and their label rings. */
  "distances",
  /** The marks: bare lacks, marked words, marked wires, marked links. */
  "marks",
  /**
   * The shelf's fold and margin. DEPRECATED (hidden 2026-11-16 per user review):
   * the shelf has its OWN hiding reading (`canvas/shelfRules.ts`, `SHELF_HIDDEN`)
   * on top of this one — the family stays named here so the blank-map invariant
   * still covers the copy-over, and the sweep can find it.
   */
  "shelf",
  /** The veil sheets (Levels 1–2) and their look-under. */
  "veils",
  /** The dynamics game's signed link wires. */
  "links",
  /** The dynamics game's loop routes and their walk. */
  "loops",
  /** The dynamics game's assumption diamonds and overlay. */
  "assumptions",
  /** The dynamics game's quantity glyphs and amount card. */
  "quantities",
  /** The ground game's reach/pointer handles, chooser, window and prism. */
  "pointers",
  /** The playing set (model.json) and every surface that reads it. */
  "model",
  /** The branch/scenario readings (the chooser, the comparison, the hint). */
  "scenarios",
  /** The ghost proposals' diamond, list and preview. */
  "ghosts",
] as const;

export type MapContentFamily = (typeof MAP_CONTENT_FAMILIES)[number];

/**
 * Does this game render the concept map's content right now? THE rule: concept
 * only, while the hiding flag stands. `hidden` is a parameter (defaulted to
 * the flag) so the reading is a runtime fact and the flip-back is executable.
 */
export function showsMapContent(
  level: Level,
  hidden: boolean = MAP_CONTENT_OTHER_GAMES_HIDDEN,
): boolean {
  return !hidden || level === "concept";
}

/**
 * The content families this game renders, in the one order above: all of them
 * at concept, NONE at dynamics and ground while the flag stands. The app reads
 * `showsMapContent` at each hiding point; this is the same rule read as the
 * blank-map invariant (the render carries no map content off concept).
 */
export function renderedMapContent(
  level: Level,
  hidden: boolean = MAP_CONTENT_OTHER_GAMES_HIDDEN,
): readonly MapContentFamily[] {
  return showsMapContent(level, hidden) ? MAP_CONTENT_FAMILIES : [];
}

/**
 * May the double-click bubble offer `word` in this game? Coining a word is
 * concept-map content: a word coined on a map that cannot render it would be a
 * lie, so the bubble at dynamics and ground offers only `draw`. Same shape as
 * `showsMapContent` and the same flip-back (its own flag, one concept
 * narrower).
 */
export function wordCreationOffered(
  level: Level,
  hidden: boolean = WORD_CREATION_OFF_CONCEPT_HIDDEN,
): boolean {
  return !hidden || level === "concept";
}

/**
 * The plane's quiet hint, in the game's own words.
 *
 * DEPRECATED (hidden 2026-11-16 per user review): the SHELF is gone, so the
 * hint LOSES its fold clause entirely — "drag past the fold to set aside" named
 * a place that is no longer there, on every map (the fourth review asked for the
 * shelf to go; the third review had already dropped the clause off concept).
 * The OLD sentence stays written as the flip-back (`shelfHidden = false`), so
 * setting `SHELF_HIDDEN` back to false restores it word for word — delete the
 * clause and this note in the deprecated sweep.
 *
 * Off concept the map is still blank paper, so the creation clause names the pen
 * (the bubble offers draw) exactly as the separate-maps review settled.
 * Provisional: the wording (ADR-0003's rendering seam).
 */
export function planeHint(
  level: Level,
  shelfHidden: boolean = SHELF_HIDDEN,
): string {
  const creation = wordCreationOffered(level)
    ? "double-click: word"
    : "double-click: draw";
  const base = "drag to pan · scroll to zoom · " + creation;
  if (!showsMapContent(level)) return base;
  return shelfHidden ? base : base + " · drag past the fold to set aside";
}
