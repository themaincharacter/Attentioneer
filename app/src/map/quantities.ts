import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";

/**
 * Quantities (ADR-0020, Epic 8 story 1): one `map/quantities.jsonl` line per
 * number the person authors about the dynamics model. Two SHAPES, and the shape
 * IS the type — there is no `kind` field (the wordless-pair lesson):
 *
 *   - a STOCK line:  {"on": "<word slug>", "amount": 12}
 *     the word's accumulation;
 *   - a FLOW line:   {"from": "<word slug>", "to": "<word slug>", "amount": 3}
 *     a transfer between two words (a word may hold a stock line and sit at a
 *     flow's end; a word can never BE a flow).
 *
 * Natural key: `on` for a stock line, `from` + `to` for a flow line (the
 * ORDERED pair — A→B and B→A are different flows, exactly as links are).
 *
 * `amount` is OPTIONAL and that is the honest record: ABSENT means UNKNOWN,
 * never zero. A line without an amount is a visible unknown the person typed
 * and saved while the number is not yet theirs to state; the writer NEVER puts
 * 0 in its place. An amount that IS written is a non-negative JSON number
 * (decimals and 0 legal — 0 is a stated emptiness, not an absence). A negative,
 * a non-finite value or an explicit `null` is out of shape and is preserved
 * verbatim as malformed rather than guessed at or repaired.
 *
 * Two write rules make revision quiet and in place (the assumptions rule):
 *   - editing an amount rewrites the line AT ITS INDEX (its file position is
 *     stable);
 *   - EDIT-CONVERGENCE: an edit (or a set) lands on the one natural key, so a
 *     pre-existing hand-edited duplicate of that key is dropped in the same
 *     quiet edit and the edited line — keeping its own unknown keys and index —
 *     is the survivor. Untouched duplicate keys elsewhere are never collapsed;
 *     the read preserves them and surfaces them.
 *
 * Unknown keys are preserved on every rewrite; malformed lines are preserved
 * verbatim and surfaced; a missing file means no quantities. The bytes are
 * canonical (sorted keys, compact, LF, trailing newline) because that is
 * `serialize.ts`'s job (ADR-0004).
 *
 * QUANTITIES NEVER JOIN AND NEVER SCOPE (ADR-0020 decision 3): a line is a
 * property of the word or the pair it names, never a membership move. Nothing
 * here reads or writes the playing set, so a hand-edited line can never
 * resurrect a pruned word. Lines naming a word that is gone, or a word that is
 * out of the playing set, are preserved and surfaced (the no-validation
 * posture) — the read never drops them and never joins their word.
 *
 * The Funes brake (ADR-0020 decision 5) is structural: this module exposes no
 * summing, totals, meters, derived rates or table helpers. The numbers are read
 * by story 3's step and by nothing else.
 *
 * Provisional (ADR-0003/ADR-0020): the `quantities.jsonl` name, the two shapes
 * and the amount grammar are the ADR's; the amount's display formatting and
 * the authoring control's look are the rendering seam's. Story 1 authors the
 * stock control on a word and the flow control on a signed link's head (the
 * pair is visible there); a flow line whose pair carries no signed link is
 * legal and is read by story 3's step, but it has no authored control until a
 * pair surface grows — the line is preserved and never repaired.
 */

/** One directed quantity target: a word's stock, or a flow over one pair. */
export type QuantityTarget =
  | { type: "stock"; on: string }
  | { type: "flow"; from: string; to: string };

/** A stock line: the word's accumulation, amount absent = unknown. */
export interface StockQuantity {
  type: "stock";
  /** The word slug the stock sits on. */
  on: string;
  /** The authored amount; `null` means the line has none (unknown ≠ 0). */
  amount: number | null;
  /** Unknown JSON keys preserved across rewrites (ADR-0006's posture). */
  extra: Record<string, unknown>;
}

/** A flow line: a transfer between two words, amount absent = unknown. */
export interface FlowQuantity {
  type: "flow";
  from: string;
  to: string;
  /** The authored amount; `null` means the line has none (unknown ≠ 0). */
  amount: number | null;
  /** Unknown JSON keys preserved across rewrites (ADR-0006's posture). */
  extra: Record<string, unknown>;
}

export type Quantity = StockQuantity | FlowQuantity;

export interface ParsedQuantities {
  /** Every readable line, in FILE ORDER, hand-duplicated keys included. */
  quantities: Quantity[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
  /**
   * Lines whose natural key already appeared earlier in the file. Preserved
   * and surfaced at read; never deduped by the app (a hand edit is content).
   */
  duplicates: Quantity[];
}

/** The result of a quiet, in-place edit of one line (edit-convergence). */
export interface QuantityEdit {
  quantities: Quantity[];
  /** The pre-existing colliding lines the edit dropped (the non-survivors). */
  dropped: Quantity[];
}

/** A line found for one target, with the line's index in the file. */
export interface FoundQuantity {
  quantity: Quantity;
  index: number;
}

export function quantitiesPath(workspacePath: string): string {
  return `${workspacePath}/map/quantities.jsonl`;
}

/**
 * Is this an amount the record may hold? A non-negative, finite JSON number —
 * decimals and 0 legal (0 is stated emptiness; absent is ignorance).
 */
export function isValidAmount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/** The target's part of the natural key (distinct prefixes: no cross-shape tie). */
export function quantityTargetKey(target: QuantityTarget): string {
  switch (target.type) {
    case "stock":
      return `stock\u0000${target.on}`;
    case "flow":
      return `flow\u0000${target.from}\u0000${target.to}`;
  }
}

/** The quantity's natural key: `on` (stock) or `from`+`to` (flow). */
export function quantityKey(quantity: Quantity): string {
  return quantityTargetKey(quantity);
}

/** The target a record names (its amount and extra keys aside). */
export function quantityTargetOf(quantity: Quantity): QuantityTarget {
  return quantity.type === "stock"
    ? { type: "stock", on: quantity.on }
    : { type: "flow", from: quantity.from, to: quantity.to };
}

/** Every word slug a line names: the stock's word, or the flow's two ends. */
export function quantityWords(quantity: Quantity): string[] {
  return quantity.type === "stock" ? [quantity.on] : [quantity.from, quantity.to];
}

/**
 * Parse one JSONL line into a Quantity; malformed or out-of-shape lines become
 * `null`. The shape is decided by its keys and never guessed at: `on` alone is
 * a stock, `from`+`to` together is a flow, a line that mixes the two or
 * half-states a flow is malformed. An absent `amount` is the unknown state; a
 * present `amount` must be a non-negative finite number (`null`, negatives and
 * strings are malformed).
 */
export function parseQuantityLine(line: string): Quantity | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const { on, from, to, amount, ...extra } = obj;
  if ("amount" in obj && !isValidAmount(amount)) return null;
  const authored = "amount" in obj ? (amount as number) : null;

  if (on !== undefined) {
    if (typeof on !== "string" || on === "") return null;
    // A stock line never states a leg: mixing the two shapes is malformed.
    if (from !== undefined || to !== undefined) return null;
    return { type: "stock", on, amount: authored, extra: { ...extra } };
  }

  if (from !== undefined || to !== undefined) {
    if (
      typeof from !== "string" ||
      from === "" ||
      typeof to !== "string" ||
      to === ""
    ) {
      return null;
    }
    return { type: "flow", from, to, amount: authored, extra: { ...extra } };
  }

  // Neither shape: no target at all.
  return null;
}

/**
 * Serialize one Quantity to its canonical JSONL line (compact, sorted keys).
 * The amount key is omitted when absent — the file says "unknown" by saying
 * nothing, never by writing 0.
 */
export function serializeQuantityLine(quantity: Quantity): string {
  const record: Record<string, unknown> = { ...quantity.extra };
  delete record.amount;
  if (quantity.type === "stock") {
    delete record.from;
    delete record.to;
    record.on = quantity.on;
  } else {
    delete record.on;
    record.from = quantity.from;
    record.to = quantity.to;
  }
  if (quantity.amount !== null) record.amount = quantity.amount;
  return canonicalJsonlLine(record);
}

/**
 * Read `map/quantities.jsonl`. A missing file (`null`) means no quantities;
 * terminating newlines are ignored; malformed or out-of-shape lines are
 * preserved as unknowns (ADR-0005's posture) so the app never silently drops
 * what it cannot read. Hand-duplicated keys are kept as they came (never
 * deduped here) and reported as `duplicates`. Tolerates a BOM and CRLF from a
 * hand edit.
 */
export function parseQuantities(text: string | null): ParsedQuantities {
  if (text === null) return { quantities: [], malformed: [], duplicates: [] };
  const quantities: Quantity[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseQuantityLine(line);
    if (parsed) {
      quantities.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return {
    quantities,
    malformed,
    duplicates: findDuplicateQuantities(quantities),
  };
}

export async function loadQuantities(
  workspacePath: string,
): Promise<ParsedQuantities> {
  return parseQuantities(await readTextFile(quantitiesPath(workspacePath)));
}

/**
 * The quantities file's exact bytes. Every record serializes canonically
 * (sorted keys), in FILE ORDER and preserving multiplicity — a hand-duplicated
 * key is never collapsed by a write (the read rule) — and malformed lines are
 * re-emitted verbatim. An empty document is the canonical empty JSONL (one
 * newline).
 */
export function serializeQuantities(
  quantities: readonly Quantity[],
  malformed: readonly string[] = [],
): string {
  return canonicalJsonlLines([
    ...quantities.map(serializeQuantityLine),
    ...malformed,
  ]);
}

export async function saveQuantities(
  workspacePath: string,
  quantities: readonly Quantity[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(
    quantitiesPath(workspacePath),
    serializeQuantities(quantities, malformed),
  );
}

/** The duplicate-key lines (every occurrence after the first), in file order. */
export function findDuplicateQuantities(
  quantities: readonly Quantity[],
): Quantity[] {
  const seen = new Set<string>();
  const duplicates: Quantity[] = [];
  for (const quantity of quantities) {
    const key = quantityKey(quantity);
    if (seen.has(key)) {
      duplicates.push(quantity);
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

/** The one line on this target, with its index in the file (first if duplicated). */
export function findQuantity(
  quantities: readonly Quantity[],
  target: QuantityTarget,
): FoundQuantity | null {
  const key = quantityTargetKey(target);
  const index = quantities.findIndex(
    (quantity) => quantityKey(quantity) === key,
  );
  return index === -1 ? null : { quantity: quantities[index], index };
}

/**
 * Set one target's amount — the authoring write (a new line appended, an
 * existing one rewritten IN PLACE at its index, unknown keys kept). The edit
 * converges on the natural key: any OTHER line sharing the key is dropped in
 * the same quiet edit, so the file holds one line per target afterwards. An
 * out-of-shape amount (a negative, a non-finite) is refused outright — the
 * control rejects it earlier; the record never stores one.
 */
export function setQuantity(
  quantities: readonly Quantity[],
  target: QuantityTarget,
  amount: number | null,
): Quantity[] {
  if (amount !== null && !isValidAmount(amount)) return [...quantities];
  const found = findQuantity(quantities, target);
  if (found === null) {
    const record: Quantity =
      target.type === "stock"
        ? { type: "stock", on: target.on, amount, extra: {} }
        : { type: "flow", from: target.from, to: target.to, amount, extra: {} };
    return [...quantities, record];
  }
  return convergeQuantityEdit(quantities, found.index, amount).quantities;
}

/**
 * Edit one line's amount IN PLACE at its index (never append), applying the
 * edit-convergence rule: any OTHER line that now shares the edited line's
 * natural key is dropped in the same edit, so the file holds one line for the
 * key and the edited line — keeping its own unknown keys and index — is the
 * survivor. An unknown index or an out-of-shape amount is a quiet no-op.
 */
export function convergeQuantityEdit(
  quantities: readonly Quantity[],
  index: number,
  amount: number | null,
): QuantityEdit {
  if (index < 0 || index >= quantities.length) {
    return { quantities: [...quantities], dropped: [] };
  }
  if (amount !== null && !isValidAmount(amount)) {
    return { quantities: [...quantities], dropped: [] };
  }
  const edited = { ...quantities[index], amount } as Quantity;
  const key = quantityKey(edited);
  const dropped: Quantity[] = [];
  const next: Quantity[] = [];
  quantities.forEach((quantity, i) => {
    if (i === index) {
      next.push(edited);
      return;
    }
    if (quantityKey(quantity) === key) {
      dropped.push(quantity);
      return;
    }
    next.push(quantity);
  });
  return { quantities: next, dropped };
}

/** Remove one line by its index — ammo, one quiet ×, no tombstone. */
export function removeQuantityAt(
  quantities: readonly Quantity[],
  index: number,
): Quantity[] {
  return quantities.filter((_, i) => i !== index);
}

/**
 * Remove the line(s) on one target — the quiet ×. The target IS the identity,
 * so a hand-edited duplicate of the key goes too (one move, one target), and a
 * target with no line is a quiet no-op.
 */
export function removeQuantity(
  quantities: readonly Quantity[],
  target: QuantityTarget,
): Quantity[] {
  const key = quantityTargetKey(target);
  return quantities.filter((quantity) => quantityKey(quantity) !== key);
}

/**
 * Quantities naming a word that is not on the map (hand edit, partial write):
 * preserved in the file and surfaced quietly, never dropped on an unrelated
 * write and never a reason to rejoin the word (ADR-0020 decision 3). A flow is
 * an orphan when EITHER end is gone.
 */
export function findOrphanQuantities(
  quantities: readonly Quantity[],
  wordSlugs: ReadonlySet<string>,
): Quantity[] {
  return quantities.filter((quantity) =>
    quantityWords(quantity).some((slug) => !wordSlugs.has(slug)),
  );
}

/**
 * Quantities naming an on-map word that is OUT of the playing set (ADR-0020
 * decision 3): preserved and surfaced, never a membership move and never a
 * reason to scope the record. With no accepted set (`null`) nothing is out of
 * play, matching `outOfPlay`'s reading; a word that is not on the map at all
 * is the orphan read's, not this one.
 */
export function findOutOfPlayQuantities(
  quantities: readonly Quantity[],
  playingWords: ReadonlySet<string> | null,
  wordSlugs: ReadonlySet<string>,
): Quantity[] {
  if (playingWords === null) return [];
  return quantities.filter((quantity) =>
    quantityWords(quantity).some(
      (slug) => wordSlugs.has(slug) && !playingWords.has(slug),
    ),
  );
}

/**
 * The authoring field's reading (provisional). A blank field is the UNKNOWN
 * state — save the line with no amount (a visible unknown), never a 0. A
 * non-negative JSON number commits as typed; anything else (a negative, a
 * fraction spelled oddly, text) is REFUSED: the control keeps the field open
 * and writes nothing. Rejecting is preferred over clamping a negative to 0,
 * which would silently author a number the person did not state.
 */
export type AmountInput =
  | { ok: true; amount: number | null }
  | { ok: false };

const JSON_NONNEGATIVE_NUMBER = /^(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

export function parseAmountInput(text: string): AmountInput {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, amount: null };
  if (!JSON_NONNEGATIVE_NUMBER.test(trimmed)) return { ok: false };
  const amount = Number(trimmed);
  return isValidAmount(amount) ? { ok: true, amount } : { ok: false };
}

/**
 * The amount as the person reads it in the field (provisional formatting): the
 * number exactly as a JSON number spells it — `0`, `12`, `1.5` — never a
 * rounded or padded form. A `null` amount has no display; the card says
 * "unknown" instead (the absence is the content).
 */
export function formatAmount(amount: number): string {
  return String(amount);
}
