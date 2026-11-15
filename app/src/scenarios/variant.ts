import { dedupe } from "../map/model";

/**
 * The variant's playing set: membership-SCOPED (ADR-0021 decision 4, Epic 8
 * story 2).
 *
 * A branch's `model.json` is a copy of the committed playing set, and the
 * committed MAP is what draws it. The two can drift — a word is removed while
 * a branch still names it, or a hand edit adds a slug that never existed — and
 * the drift is never repaired: a slug the map does not carry is a NAMELESS
 * GHOST. A ghost is surfaced quietly (the notices strip) and NEVER drawn as a
 * word, because a word is a reference on the map and nothing else. It is not a
 * member either: the variant's set, as the plane reads it, is the members only.
 *
 * The two rules that keep it that way are pure and live here:
 *
 *   - READ — `scopedMembership` splits a variant's words into the members the
 *     map carries and the ghosts it does not, both in canonical (sorted,
 *     unique) order. The plane draws members; the notices name ghosts.
 *   - WRITE — a variant may JOIN or PRUNE existing words only. A join always
 *     names a word that exists (a coined word, a link's drawn endpoints — the
 *     app never hands this rule a slug from a file), and the accept's reading
 *     is `variantAcceptWords`: a stale slug that slipped into a draft (a word
 *     removed while the selector was open) is PRUNED rather than written back
 *     as a new ghost.
 *
 * Nothing here writes, and nothing here joins a word into the COMMITTED set:
 * the committed model is the person's map, and a variant never edits it.
 * Provisional (ADR-0021): the wording of "ghost" and the notice line are
 * ADR-0003/0021's; the rule is the ADR's.
 */

/** A variant's set, split by what the committed map carries. */
export interface ScopedMembership {
  /** The words the map carries: sorted, unique — what the plane draws. */
  members: string[];
  /** The slugs it does not: sorted, unique — nameless ghosts, surfaced only. */
  ghosts: string[];
}

/**
 * Split a variant's words against the map's slugs. Both sides are deduped and
 * sorted (the canonical member order), so the reading is stable however the
 * branch file is spelled.
 */
export function scopedMembership(
  words: readonly string[],
  available: ReadonlySet<string>,
): ScopedMembership {
  return {
    members: dedupe(words.filter((word) => available.has(word))),
    ghosts: dedupe(words.filter((word) => !available.has(word))),
  };
}

/**
 * The words a variant's accept may write: the draft pruned to the map's words
 * (the committed set's accept keeps its own reading — this rule is the
 * variant's). A draft is a view; a word that left the map while the selector
 * was open simply does not land in the branch's record.
 */
export function variantAcceptWords(
  slugs: readonly string[],
  available: ReadonlySet<string>,
): string[] {
  return scopedMembership(slugs, available).members;
}
