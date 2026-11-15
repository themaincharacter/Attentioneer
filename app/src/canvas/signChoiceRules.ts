import type { LinkSign } from "../map/links";

/**
 * The sign choice (Epic 4 story 2, ADR-0016 decision 3; ADR-0012 decision 2).
 *
 * At Level 2 the connect-handle gesture ends in a quiet + / - choice instead of
 * the coin field. The sign is authored structure — World B — so there is NO
 * default selection: Enter with nothing chosen discards, Esc discards, and only
 * an explicit pick (a press on a sign) writes a link. The component renders the
 * two buttons; this pure rule is what the tests pin.
 *
 * Provisional: the look, the in-place placement and the button wording are
 * ADR-0003/0016's rendering seam.
 */

/**
 * What the pending sign choice writes: the picked sign, or null to discard.
 * Enter with nothing chosen discards — the software never guesses a sign.
 */
export function signChoiceOutcome(
  chosen: LinkSign | null,
  key: "Enter" | "Escape",
): LinkSign | null {
  if (key === "Escape") return null;
  return chosen;
}
