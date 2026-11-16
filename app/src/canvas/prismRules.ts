import type {
  Change,
  ContactKind,
  DecodeStatus,
  HeadBounds,
  Prism,
} from "../map/prisms";

/**
 * THE PRISM WINDOW'S QUIET RULES (Epic 12 story 2) — pure words and display
 * rules, kept apart from the component so bun asserts them without a DOM.
 *
 * The window shows ONE Move (one PRISM): the contact kind on its header, the
 * read-only Change log exactly as recorded, and the person's explanation in a
 * quiet field. It never shows world bytes (the head's content lives in the
 * transient window's own glimpse, never here), never counts, never summarizes.
 * Every fact is rendered VERBATIM: bounds as exact integers, size as exact
 * bytes, mtime as the full declared instant (millisecond precision) — a
 * rounded "1.2 kB" would be a small lie in a log that promises exactness.
 *
 * NO LIST, NO COUNT: these rules never see an array of PRISMs. One change's
 * words, one bounds object, one prism. The caller passes ONE Prism or null.
 *
 * Provisional: the wording, the explanation field's placeholder, and the
 * teletype-ish detail line.
 */

/** No PRISM exists on this reach yet — the log button's quiet sentence. */
export const NO_MOVE_YET = "no move on this reach yet";

/** The explanation save found no line (the record changed under the window). */
export const NOT_SAVED = "not saved";

/** A Move's append failed: the Move is not in the log. */
export const NOT_LOGGED = "the move's log could not be written";

/** The log could not be read back (the reopen affordance's failure). */
export const CANNOT_READ_LOG = "cannot read the log";

/** The window's quiet tooltip: what kind of surface this is. */
export const PRISM_TOOLTIP = "one move, exactly — its log and your words";

/** The explanation field's quiet placeholder. */
export const EXPLANATION_PLACEHOLDER = "why? (yours, optional)";

/** The explanation field's aria label (the person's own words). */
export const EXPLANATION_LABEL = "this move's explanation (yours)";

/** The contact kind as a header word. */
export const CONTACT_WORDS: Readonly<Record<ContactKind, string>> = {
  look: "look",
  make: "make",
  measure: "measure",
  ask: "ask",
};

/** The Change kind as a quiet log word. */
export const CHANGE_WORDS: Readonly<Record<Change["kind"], string>> = {
  "read-head": "head read",
  "mint-pointer": "mint pointer",
  "write-text": "write text",
  "open-os": "hand off to the OS",
  ask: "ask",
};

/** Every outcome of the closed union as the window's word. */
export const OUTCOME_WORDS: Readonly<Record<string, string>> = {
  read: "read",
  "not-text": "not text",
  "cannot-reach": "cannot reach",
  escaped: "escaped the workspace",
  minted: "minted",
  failed: "failed",
  written: "written",
  handed: "handed",
  "handoff-failed": "handoff failed",
  refused: "refused",
  answered: "answered",
  "no-response": "no response",
};

/** The window's aria label: the contact kind and the word's coined NAME. */
export function prismLabel(name: string, prism: Prism | null): string {
  if (prism === null) return "the PRISM log on “" + name + "”";
  return (
    "the PRISM of a " + CONTACT_WORDS[prism.contact] + " on “" + name + "”"
  );
}

/** The header's contact word (the contact kind lives on the PRISM header). */
export function contactWord(contact: ContactKind): string {
  return CONTACT_WORDS[contact];
}

/** The Change kind's quiet log word. */
export function changeWord(change: Change): string {
  return CHANGE_WORDS[change.kind];
}

/** The Change's outcome as the window's word. */
export function changeOutcome(change: Change): string {
  return OUTCOME_WORDS[change.outcome] ?? change.outcome;
}

/** The exact bounds asked for: two integers, never a formatted size. */
export function boundsWords(bounds: HeadBounds): string {
  return "bounds: " + bounds.maxLines + " lines, " + bounds.maxBytes + " bytes";
}

/** The decode status, said plainly; a refusal decoded nothing (empty). */
export function decodeWords(decode: DecodeStatus | null): string {
  if (decode === null) return "";
  return decode === "clean" ? "decoded clean" : "decoded with replacement";
}

/** The mtime as the full declared instant, or the exact milliseconds. */
export function mtimeWords(mtime: number | null | undefined): string {
  if (mtime === null || mtime === undefined) return "modified unknown";
  const date = new Date(mtime);
  if (Number.isNaN(date.getTime())) return "modified " + mtime + " ms";
  return "modified " + date.toISOString();
}

/**
 * Measure's declared facts: the exact byte size and the exact mtime, never a
 * rounded unit, never a derived number. Absent (empty) on a Look or a refusal.
 */
export function factsWords(bounds: HeadBounds): string {
  if (bounds.size === undefined && bounds.mtime === undefined) return "";
  const size =
    bounds.size === null || bounds.size === undefined
      ? "size unknown"
      : "size " + bounds.size + " bytes";
  return size + " · " + mtimeWords(bounds.mtime);
}

/**
 * One Change's detail line: the read-head Change says its exact bounds, its
 * decode status and (on a Measure) its declared facts; the other kinds carry
 * no detail yet (their flows are the egress story's). Words only — no count,
 * no summary.
 */
export function changeDetail(change: Change): string {
  if (change.kind !== "read-head") return "";
  const parts = [boundsWords(change.bounds)];
  const decode = decodeWords(change.decode);
  if (decode !== "") parts.push(decode);
  const facts = factsWords(change.bounds);
  if (facts !== "") parts.push(facts);
  return parts.join(" · ");
}
