import type { GhostEnvelope, GhostTarget } from "./envelope";
import { findMove, type MoveDefinition } from "./registry";

/**
 * THE QUIET GHOST LIST (Epic 10 story 3) — what a held Patch reads as, and the
 * in-flight state of the rows.
 *
 * A ghost is TEXT here and nothing else: one row per held Patch, in ARRIVAL
 * order (the order the intake filed them, and the order a reshape keeps it in),
 * carrying the move's own summary and the proposal's why verbatim. The row is
 * the whole presence — no glyph, no ring, no dot, and nothing whatever on the
 * plane while a ghost is merely held (the preview is the person's opening;
 * `preview.ts` owns that rule). The rows carry no tally, no date, no mark of
 * what has been seen, and nothing is ever lifted to the front: which proposal
 * deserves the eye is the person's, and a row's place is its arrival.
 *
 * The words are the registry's (expansion is data): the summary is derived from
 * the move's family and verb, so a second registered move renders without a
 * change here, and the sentence states what the move DOES, never the grammar's
 * vocabulary. A target is spoken as the person's own NAME (a coined word or a
 * loop's name), never as a slug — the slug stays in the file.
 *
 * Provisional: the row's wording and the list's placement/look.
 */

/**
 * One row's text: the summary (what the move does, and about what) and the
 * proposal's why, verbatim. Rendering adds nothing.
 */
export interface GhostRow {
  /** The app-minted in-session id (the row's key; never rendered as a tally). */
  id: string;
  /** What the move does, about what: e.g. `add an assumption about "rain"`. */
  summary: string;
  /** The proposal's prose why, exactly as the envelope carries it. */
  rationale: string;
}

/** The article a family name takes (a quiet grammar, not a lookup table). */
function articleOf(word: string): string {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

/**
 * What a registered move does, in the move's own words: the verb, the family
 * and its article. Data-derived, so a new row of the registry needs no edit
 * here. Never a grammar word: the summary is the plain reading of the move.
 */
export function moveSummary(entry: MoveDefinition): string {
  return `${entry.move.verb} ${articleOf(entry.move.family)} ${entry.move.family}`;
}

/** A target as the person's name for it (names, not slugs). */
export function targetLabel(
  target: GhostTarget,
  nameOf: (slug: string) => string,
): string {
  if (target.kind === "word" || target.kind === "loop") {
    return `"${nameOf(target.slug)}"`;
  }
  return target.kind;
}

/**
 * One ghost's summary: what the move does, about what. A move the table does
 * not carry still reads (its own family and verb) rather than vanishing.
 */
export function ghostSummary(
  envelope: GhostEnvelope,
  nameOf: (slug: string) => string,
): string {
  const entry = findMove(envelope.move);
  const does =
    entry === null
      ? `${envelope.move.verb} ${envelope.move.family}`
      : moveSummary(entry);
  return `${does} about ${targetLabel(envelope.target, nameOf)}`;
}

/**
 * The rows, in ARRIVAL order: the intake appends, a reshape replaces in place,
 * and nothing is ever re-ordered. A ghost whose move is unknown still rows (the
 * grammar refuses one at intake, but a hand-filed envelope must not vanish
 * silently): its summary falls back to the move's own keys.
 */
export function ghostRows(
  ghosts: readonly GhostEnvelope[],
  nameOf: (slug: string) => string,
): GhostRow[] {
  return ghosts.map((envelope) => ({
    id: envelope.id,
    summary: ghostSummary(envelope, nameOf),
    rationale: envelope.rationale,
  }));
}

/**
 * File one ghost at the END of the rows: the intake's append. A ghost already
 * held under the same id is replaced where it stands (re-intaking the same id
 * is the same row, never a second one).
 */
export function appendGhost(
  ghosts: readonly GhostEnvelope[],
  envelope: GhostEnvelope,
): readonly GhostEnvelope[] {
  const at = ghosts.findIndex((held) => held.id === envelope.id);
  if (at === -1) return [...ghosts, envelope];
  const grown = [...ghosts];
  grown[at] = envelope;
  return grown;
}

/** Replace one ghost where it stands (a reshape keeps the row's place). */
export function replaceGhost(
  ghosts: readonly GhostEnvelope[],
  envelope: GhostEnvelope,
): readonly GhostEnvelope[] {
  return ghosts.map((held) => (held.id === envelope.id ? envelope : held));
}

/** Drop one ghost (an accept, a reject, or one the session no longer holds). */
export function dropGhost(
  ghosts: readonly GhostEnvelope[],
  id: string,
): readonly GhostEnvelope[] {
  return ghosts.filter((held) => held.id !== id);
}

/**
 * THE ONE-OPEN RULE (app state): at most ONE ghost is opened at a time.
 * Opening a second ghost opens IT — the first closes quietly, exactly as the
 * window's second glimpse closes the first — and opening nothing closes.
 * Re-opening the ghost already open is not a toggle: the person's opening is
 * the same opening.
 */
export function withOpen(current: string | null, id: string | null): string | null {
  if (id === null) return null;
  return id === current ? current : id;
}
