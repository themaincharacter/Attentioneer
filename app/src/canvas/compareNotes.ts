import { formatAmount } from "../map/quantities";
import type { Assumption, AssumptionTarget } from "../map/assumptions";
import type {
  ComparePiece,
  CompareRefusal,
  CompareRow,
  CompareValue,
} from "../scenarios/compare";
import type { NameOf } from "./notices";

/**
 * The comparison's person-facing sentences (Epic 8 story 4).
 *
 * A row is ONE PROVENANCE SENTENCE, never two columns: the piece, then the
 * branch's authored reading and the committed model's reading now, each with
 * its label (`branch (authored): … / committed (now): …`). Both values are
 * always spoken, so the sentence never classifies them: no judgement, no change
 * set, no equality claim — equality is the tool's classification and the
 * ruling forbids it. Absence is spoken plainly as "no line" (never a dash and
 * never a zero), and a quantity line without an amount reads "unknown" (never
 * 0 — absent ≠ 0).
 *
 * The STANDING DRIFT LINE is the causal honesty of the whole surface: a
 * difference may be the branch's move or the model's drift, and a branch is
 * not a revision log (ADR-0021 decision 6).
 *
 * A DANGLE is present tense and stays present tense: "the committed model no
 * longer says …" names what stands now, never what happened. A pin is the
 * branch's memory of a premise, and the sentence never turns it into a
 * history.
 *
 * NAMES, NOT SLUGS: every piece goes through the app's one `nameOf`, and a
 * slug whose word is gone falls back to itself — the record is the only name
 * left.
 *
 * Provisional (ADR-0003): every literal here is display wording. The tests
 * assert the structural rules (both provenance labels, "no line" for absence,
 * "unknown" for an absent amount, present tense in the dangle), not these
 * exact strings.
 */

/** The standing causal line the comparison always carries (issue 04's ruling). */
export const STANDING_DRIFT =
  "a difference may be the branch's move or the model's drift — a branch is not a revision log";

/** How an absent piece reads: no line at all — never a dash, never a zero. */
export const NO_LINE = "no line";

/** How a quantity line with no amount reads: the visible unknown, never 0. */
export const UNKNOWN_AMOUNT = "unknown";

/** The branch side's provenance label. */
export const BRANCH_PROVENANCE = "branch (authored)";

/** The committed side's provenance label. */
export const COMMITTED_PROVENANCE = "committed (now)";

/** The dangle sentence's opening — present tense, always. */
export const DANGLE_SAYS = "the committed model no longer says";

/** What clears a dangling premise: branching again (delete + branch). */
export const DANGLE_CLEARING =
  "a premise clears only by branching again — delete the branch and branch the model anew";

/**
 * One side's value as the person reads it. The outer null is NO LINE (the
 * piece is not in that model); a present quantity line whose amount is absent
 * is the unknown, and a stated 0 reads as 0.
 */
export function compareValueText(value: CompareValue | null): string {
  if (value === null) return NO_LINE;
  switch (value.kind) {
    case "member":
      return "in the set";
    case "sign":
      return `sign ${value.sign}`;
    case "amount":
      return value.amount === null ? UNKNOWN_AMOUNT : formatAmount(value.amount);
  }
}

/** What a row is about, in the person's names. */
export function comparePieceText(piece: ComparePiece, nameOf: NameOf): string {
  switch (piece.space) {
    case "set":
      return nameOf(piece.word);
    case "links":
      return `the link ${nameOf(piece.from)} → ${nameOf(piece.to)}`;
    case "quantities":
      return piece.target.type === "stock"
        ? `${nameOf(piece.target.on)}'s stock`
        : `the flow ${nameOf(piece.target.from)} → ${nameOf(piece.target.to)}`;
  }
}

/**
 * One row as a provenance sentence: the piece, then BOTH readings with their
 * labels. Both are always present — the sentence shows the two values and
 * says nothing about how they relate.
 */
export function provenanceSentence(row: CompareRow, nameOf: NameOf): string {
  return (
    `${comparePieceText(row.piece, nameOf)} — ` +
    `${BRANCH_PROVENANCE}: ${compareValueText(row.branch)} / ` +
    `${COMMITTED_PROVENANCE}: ${compareValueText(row.committed)}`
  );
}

/** A refusal, said quietly in one sentence (the frame's word). */
export function comparisonRefusalText(refusal: CompareRefusal): string {
  switch (refusal) {
    case "two-branches":
      return "two branches share no base — a branch is read against the committed model";
    case "no-branch":
      return "pick a branch — a branch is read against the committed model";
  }
}

/** Where a pin sits, as the dangle sentence says it. */
function dangleTargetText(target: AssumptionTarget, nameOf: NameOf): string {
  switch (target.type) {
    case "word":
      return `on ${nameOf(target.slug)}`;
    case "link":
      return `on the link ${nameOf(target.from)} → ${nameOf(target.to)}`;
    case "loop":
      return `on the loop “${nameOf(target.slug)}”`;
    case "spot":
      return "on a bare spot";
  }
}

/**
 * One dangling premise as a present-tense sentence: the committed model no
 * longer says the claim the branch took as premise. It says what stands now,
 * not what happened — no "was", no "used to", no account of an edit.
 */
export function dangleText(pin: Assumption, nameOf: NameOf): string {
  return `${DANGLE_SAYS} “${pin.text}” ${dangleTargetText(pin.target, nameOf)}`;
}

/** A committed claim the branch's pins do not cover, present tense. */
export function unpinnedClaimText(claim: Assumption, nameOf: NameOf): string {
  return (
    `the committed model says “${claim.text}” ` +
    `${dangleTargetText(claim.target, nameOf)} — ` +
    "the branch does not stand on it"
  );
}
