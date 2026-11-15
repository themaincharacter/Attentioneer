import { formatAmount } from "../map/quantities";
import type { StepNote } from "../map/step";
import type { NameOf } from "./notices";

/**
 * The step's person-facing sentences (Epic 8 story 3, ADR-0022).
 *
 * NAMES, NOT SLUGS (the notices rule): every sentence resolves a slug through
 * the app's one `nameOf` mapping, and a slug whose word is gone falls back to
 * itself — the record is the only name left. The wording is PROVISIONAL
 * (ADR-0003's rendering seam): the tests assert the structural rule (a clamp
 * names the stock, the flow and the shortfall against the authored amount; an
 * unknown flow is skipped and said; the outside is named), never these exact
 * strings.
 *
 * The step's numbers are spelled exactly as the record spells them
 * (`formatAmount`: "0", "12", "1.5") — no rounding, no padding. A `null`
 * amount has no number at all: it reads "unknown" (the absence is content).
 */

/** One note as a quiet sentence. */
export function stepNoteText(note: StepNote, nameOf: NameOf): string {
  switch (note.kind) {
    case "no-set":
      return "no playing set — nothing is in play";
    case "out-of-play-stock":
      return `${nameOf(note.on)} — out of play; its stock does not move`;
    case "out-of-play-flow":
      return `${nameOf(note.from)}→${nameOf(note.to)} — out of play; the flow does not move`;
    case "duplicate-stock":
      return `${nameOf(note.on)} — two lines; its amount is not guessed and its outflows do not move`;
    case "duplicate-flow":
      return `${nameOf(note.from)}→${nameOf(note.to)} — two lines; the step will not double-move`;
    case "unknown-flow":
      return `${nameOf(note.from)}→${nameOf(note.to)} — amount unknown; skipped`;
    case "unknown-stock-outflow":
      return `${nameOf(note.on)}→${nameOf(note.to)} — ${nameOf(note.on)}'s amount is unknown; skipped`;
    case "self-flow":
      return `${nameOf(note.on)}→${nameOf(note.on)} — moves nothing`;
    case "outside-source":
      return `${nameOf(note.from)} — from the world, unbounded; gave ${formatAmount(note.amount)} to ${nameOf(note.to)}`;
    case "outside-sink":
      return `${nameOf(note.to)} — to the world, unbounded; took ${formatAmount(note.amount)} from ${nameOf(note.from)}`;
    case "world-to-world":
      return `${nameOf(note.from)}→${nameOf(note.to)} — the world to the world; nothing observable moves`;
    case "unknown-arrival":
      return `${nameOf(note.on)} — its amount is unknown; ${formatAmount(note.amount)} arrives and the amount stays unknown`;
    case "clamp":
      return `${nameOf(note.from)}→${nameOf(note.to)}: ${nameOf(note.on)} gave ${formatAmount(note.gave)} of ${formatAmount(note.asked)}`;
  }
}

/**
 * A running amount as the word reads it: the number exactly as authored
 * (never rounded) or "unknown" for a stock whose line carries no amount.
 */
export function stepAmountText(amount: number | null): string {
  return amount === null ? "unknown" : formatAmount(amount);
}

/**
 * The last crank's delta as the word reads it: a signed number (`+2`,
 * `-1`), or null when nothing moved for this word. A delta of 0 is "nothing
 * moved" — the display says nothing rather than leaning on a zero.
 */
export function stepDeltaText(delta: number | null): string | null {
  if (delta === null || delta === 0) return null;
  return `${delta > 0 ? "+" : ""}${formatAmount(delta)}`;
}
