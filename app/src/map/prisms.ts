import { readTextFile, writeTextFile, type DecodeStatus } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";
import { POINTER_FORMS, pointerKey, type PointerForm } from "./pointers";

/**
 * THE PRISM (Epic 12 story 1, ADR-0028 as amended; ADR-0029) — one
 * `map/prisms.jsonl` line per CONTACT MOVE: the person's contact with the
 * world (Look / Make / Measure / Ask and — Epic 18 story 5 — Run), kept as a
 * structured explanation and a
 * closed Change log. This module owns the record only: the contact layer that
 * performs the Move lives beside it, and `head.rs` answers the read only.
 *
 * MARK-SHAPED, and the marks' posture. A line's target fields sit at the top
 * level, exactly as a pointer-key mark's do: the anchor reference (`on`) plus
 * the pointer line the Move rode — EXACTLY ONE of the three authored forms
 * (`path` / `at` / `url`) with its verbatim value. The key is the anchor +
 * the contact kind + the POINTER'S NATURAL KEY (on + form + value, ADR-0017
 * rule 3): a contact rides ONE pointer of several, and the citation is a
 * reference to the pointer record — never a byte dump, never a second copy of
 * the target's content. Because the natural key carries the authored value,
 * the PRISM inherits the pointer's own sensitivity; that is the design, not a
 * leak (ADR-0028's natural-key amendment).
 *
 * THE KEY NEVER DEDUPES. Unlike the marks and pointers, this record family is
 * APPEND-ONLY PER MOVE: every completed contact appends one line with an
 * app-minted id (the ghost envelope's precedent), even when the key repeats.
 * Repeating a contact appends again; nothing is ever merged, rewritten or
 * reordered (a merged log is a usage tally — ADR-0029 rule 2). The key says
 * WHAT a line is about; the id says WHICH Move it is. A pointer-less Ask is
 * the one Move with no pointer: its key names the anchor and the contact. (The
 * record parser stays permissive — a hand line naming another contact without
 * a pointer is preserved as it reads, and the CONTACT TABLE's target rules are
 * what refuse that Move.)
 *
 * THE CLOSED CHANGE-UNION, every kind carrying an OUTCOME (ADR-0028's
 * Bounded-movements amendment):
 *   - `read-head`    {pointer, outcome (read / not-text / cannot-reach /
 *                      escaped), bounds (the exact line/byte values asked;
 *                      on a MEASURE also the head's declared size/mtime —
 *                      story 2's PROVISIONAL placement, never computed),
 *                      decode (clean / with-replacement, or null when nothing
 *                      was decoded)}
 *   - `mint-pointer` {target (the minted pointer's natural key), outcome
 *                      (minted / failed)} — Make's first Change: the artifact
 *                      needs a pointer and verbatim paths are never written
 *                      into the map, so the Move mints it.
 *   - `write-text`   {pointer, outcome (written / failed), size (the authored
 *                      text's byte size — a DECLARED fact, not a computed one)}
 *   - `open-os`      {pointer, outcome (handed / handoff-failed / refused)} —
 *                      EGRESS; the log says HANDED, never "opened" (the app
 *                      only knows the handoff).
 *   - `ask`          {pointer (or null for none), outcome (answered /
 *                      no-response), included (the pointer natural keys that
 *                      rode, or null for none), responseSize, decode, and —
 *                      ONLY on an ask card's turn (Epic 17 story 4,
 *                      PROVISIONAL) — anchor (the anchored reference's slug)}
 *   - `run`          {tool (the tool ROW's id — never the command, never a
 *                      path), outcome (answered / no-response), resultSize
 *                      (the result's byte size when the run completed, else
 *                      null)} — EGRESS: a session card's run (Epic 18 story 5,
 *                      PROVISIONAL). A run is the largest egress the app makes
 *                      (a directory, a prompt and possibly a key handed to an
 *                      external program), so ADR-0029's rule applies here too:
 *                      structure only. NO words, NO argv, NO directory and NO
 *                      entry counts — the transcript holds the words, and this
 *                      Change has no slot for one. `answered` ONLY for a run
 *                      that ended `completed`; a stop, a failure, a timeout and
 *                      a dead connection are all `no-response`.
 * The union is CLOSED: a Change carrying an unknown key or an outcome outside
 * its kind's list makes the LINE malformed — preserved verbatim and surfaced,
 * never guessed at. `anchor` is the ONE optional key in the whole union (see
 * CHANGE_OPTIONAL_KEYS); every other key is required, exactly.
 *
 * NO CONTENT FIELD, STRUCTURALLY. The key set has no slot for the head's
 * bytes, the question's prose, the response's text or any other content: the
 * kept response's only home is the Memory backstop (a Finding -> memory prose,
 * ADR-0017 decision 4), and the inclusion set is logged as pointer keys, never
 * bytes. `PRISM_KEYS`, `CHANGE_KEYS` and `CHANGE_OPTIONAL_KEYS` below are the
 * whole declared key set; a source scan can read them, and the parser refuses
 * a Change with any key outside its kind's set (required plus optional).
 *
 * THE PERSON'S EXPLANATION is prose, stored VERBATIM and never interpreted,
 * trimmed, searched or compared. It is the field's only author; the app writes
 * the empty string when the person wrote none, so the field is always present
 * and "empty when absent" holds on a hand line too. It is authored at the
 * Move's window (story 2) and saved by `rewritePrismExplanation`, the one
 * ID-addressed targeted edit: the CHANGES stay read-only, and every byte but
 * that one line's explanation is preserved. A Move still appends exactly one
 * line (`appendPrismLine`); the explanation edit never appends.
 *
 * RECORD != VISIBLE (ADR-0029 rule 6): one PRISM is readable at one window;
 * `latestPrismIn` answers ONE reach's latest PRISM for the reopen affordance
 * and nothing lists, counts or sums the series.
 *
 * THE FAMILY POSTURE holds: unknown keys on a known line are preserved across
 * a rewrite; malformed lines are preserved verbatim AND surfaced by the read's
 * own `malformed` list; CRLF and a BOM are tolerated; a missing file means no
 * PRISMs. Canonical serialization is serialize.ts's job (ADR-0004); this
 * module only turns the file's bytes into records and back.
 *
 * Provisional: the `prisms.jsonl` name, the app-minted id prefix, the field
 * spellings (`bounds`/`responseSize`), the `mint-pointer` outcome vocabulary,
 * and — Epic 18 story 5 — the `run` Change (`tool`/`outcome`/`resultSize`), the
 * `run` contact kind and the `run` row in the contact table. The contact layer's own flows (stories 2-3) own what a Move
 * actually does; this story owns the record and the boundary.
 */

/**
 * The contact kinds (the person's verbs on a reach). `run` is Epic 18 story 5's
 * addition (PROVISIONAL): a session card's run is a Move of its own kind, not
 * an Ask and not a Look — it hands a whole directory to an external program.
 * The session card is what the Move is made in, so the PRISM names its slug in
 * `on`, exactly as an ask card's turn does.
 */
export const CONTACT_KINDS = [
  "look",
  "make",
  "measure",
  "ask",
  "run",
] as const;

/** A contact kind: what a PRISM's Move did. */
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** Is a value one of the four contact kinds? */
export function isContactKind(value: unknown): value is ContactKind {
  return (
    typeof value === "string" &&
    (CONTACT_KINDS as readonly string[]).includes(value)
  );
}

/** The closed Change-union's six kinds, in table order. */
export const CHANGE_KINDS = [
  "read-head",
  "mint-pointer",
  "write-text",
  "open-os",
  "ask",
  "run",
] as const;

/** A Change kind. */
export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** Is a value one of the six Change kinds? */
export function isChangeKind(value: unknown): value is ChangeKind {
  return (
    typeof value === "string" &&
    (CHANGE_KINDS as readonly string[]).includes(value)
  );
}

/** read-head's outcomes (typed; escaped is the boundary layer's refusal). */
export const READ_HEAD_OUTCOMES = [
  "read",
  "not-text",
  "cannot-reach",
  "escaped",
] as const;
export type ReadHeadOutcome = (typeof READ_HEAD_OUTCOMES)[number];

/** The head's decode status, said rather than hidden (ADR-0029 rule 5). */
export const DECODE_STATUSES = ["clean", "with-replacement"] as const;
export type { DecodeStatus };

/** mint-pointer's outcomes. */
export const MINT_POINTER_OUTCOMES = ["minted", "failed"] as const;
export type MintPointerOutcome = (typeof MINT_POINTER_OUTCOMES)[number];

/** write-text's outcomes. */
export const WRITE_TEXT_OUTCOMES = ["written", "failed"] as const;
export type WriteTextOutcome = (typeof WRITE_TEXT_OUTCOMES)[number];

/** open-os's outcomes (the handoff, never a claim to have opened anything). */
export const OPEN_OS_OUTCOMES = [
  "handed",
  "handoff-failed",
  "refused",
] as const;
export type OpenOsOutcome = (typeof OPEN_OS_OUTCOMES)[number];

/** ask's outcomes. */
export const ASK_OUTCOMES = ["answered", "no-response"] as const;
export type AskOutcome = (typeof ASK_OUTCOMES)[number];

/**
 * run's outcomes (Epic 18 story 5, PROVISIONAL): the SAME two words an Ask's
 * ending uses, because they mean the same thing — a completed run answered; a
 * stop, a break, a timeout or a dead connection did not. Kept as its own
 * exported list so a caller cannot helpfully invent a third word here.
 */
export const RUN_OUTCOMES = ["answered", "no-response"] as const;
export type RunOutcome = (typeof RUN_OUTCOMES)[number];

/** Is a value one of the two words a run's outcome may carry? */
export function isRunOutcome(value: unknown): value is RunOutcome {
  return (
    typeof value === "string" &&
    (RUN_OUTCOMES as readonly string[]).includes(value)
  );
}

/**
 * Every Change kind's outcomes, as DATA — the parser's closed-list check and
 * the contact table's shape read this one table.
 */
export const CHANGE_OUTCOMES: Readonly<Record<ChangeKind, readonly string[]>> =
  {
    "read-head": READ_HEAD_OUTCOMES,
    "mint-pointer": MINT_POINTER_OUTCOMES,
    "write-text": WRITE_TEXT_OUTCOMES,
    "open-os": OPEN_OS_OUTCOMES,
    ask: ASK_OUTCOMES,
    run: RUN_OUTCOMES,
  };

/**
 * The bounds a head read asked for, as exact declared values — plus, on a
 * MEASURE, the head's DECLARED facts (Epic 12 story 2, PROVISIONAL placement).
 *
 * A Look logs the caps only: the truncation bound is part of the log (a silent
 * truncation would be a silent transformation). A Measure is the SAME
 * read-head Change (the contact kind lives on the PRISM header): it asks the
 * same bounds and the head's declared facts — the file's size and last
 * modification as the filesystem declared them — ride the bounds object. They
 * are pasted from the head read, never computed, counted, summed or rounded
 * (ADR-0028's Real-number line; ADR-0029 rule 5), and they are absent on a
 * Look and on every refusal.
 */
export interface HeadBounds {
  /** The line cap asked for (HEAD_MAX_LINES in the app). */
  maxLines: number;
  /** The byte cap asked for (HEAD_MAX_BYTES in the app). */
  maxBytes: number;
  /** Measure only: the head's declared byte size, verbatim (null when none). */
  size?: number | null;
  /** Measure only: the head's declared mtime in ms since the epoch, or null. */
  mtime?: number | null;
}

/** Look / Measure's Change: one bounded head read, bounds and decode said. */
export interface ReadHeadChange {
  kind: "read-head";
  /** The pointer's natural key (on + form + value) — POINTER IDENTITY. */
  pointer: string;
  outcome: ReadHeadOutcome;
  /** The exact bounds the app asked for, whatever the outcome. */
  bounds: HeadBounds;
  /** What the decoder did; null when no text was decoded (a refusal). */
  decode: DecodeStatus | null;
}

/** Make's first Change: the artifact's pointer is minted in the same Move. */
export interface MintPointerChange {
  kind: "mint-pointer";
  /** The minted pointer's natural key — the artifact's new reach. */
  target: string;
  outcome: MintPointerOutcome;
}

/** Make's second Change: the authored text goes through the raw writer. */
export interface WriteTextChange {
  kind: "write-text";
  /** The pointer's natural key the text was written to. */
  pointer: string;
  outcome: WriteTextOutcome;
  /** The authored text's byte size (a declared fact, never derived). */
  size: number;
}

/** Look's URL Change (and any egress): the OS was handed an address. */
export interface OpenOsChange {
  kind: "open-os";
  /** The pointer's natural key whose value left the machine. */
  pointer: string;
  outcome: OpenOsOutcome;
}

/** Ask's Change: one question out, one response in as content (never here). */
export interface AskChange {
  kind: "ask";
  /** The pointer the question rides (its natural key), or null for none. */
  pointer: string | null;
  /**
   * THE ANCHOR, NAMED STRUCTURALLY — READ-ONLY LEGACY (Epic 17 story 4, retired
   * by story 17.9's correction). An ask card's turn USED to ride no pointer and
   * named the reference it was about here; the user's correction made the
   * WIRES the context, so a new Move never writes this field and the inclusion
   * set (`included`) is the record's fact. Old lines still PARSE and DISPLAY
   * it exactly as written, and an untouched old line keeps its bytes. The
   * retirement is PROVISIONALLY REVERSIBLE: if the person wants an anchor field
   * back, the parser and the serializer are still here and only the writers
   * would change. The union stays CLOSED TO CONTENT: a slug is structure, and
   * no words, previews or content sizes ride with it.
   */
  anchor?: string;
  outcome: AskOutcome;
  /** The inclusion set: pointer natural keys that rode, or null for none. */
  included: string[] | null;
  /** The response's byte size when one came back, else null. */
  responseSize: number | null;
  /** The response's decode status when one came back, else null. */
  decode: DecodeStatus | null;
}

/**
 * Run's Change (Epic 18 story 5) — PROVISIONAL, the story's one record-shape
 * addition, and the LAST kind the union gains for this epic.
 *
 * A RUN IS AN EGRESS AND GETS A RECORD. The session card hands a directory, a
 * prompt and possibly a key to an external program; ADR-0029's rule is that an
 * egress is recorded structurally, and until this Change a run was the one move
 * with no Move. The fields are deliberately three:
 *
 *   - `tool`       the TOOL ROW's id — NEVER the command, NEVER an argv, NEVER
 *                  a directory. It is the same id `map/sessions.txt` binds and
 *                  the same row the card's declaration names.
 *   - `outcome`    `answered` only for a run that ended `completed`; stopped,
 *                  failed, timed-out and a dead connection are `no-response`
 *                  (the 15.7b rule, one layer down: a partial is not a result).
 *   - `resultSize` the result's exact byte size when the run completed, else
 *                  null — never a size of a partial, never a count of entries.
 *
 * NO WORDS. The run's words live in `map/sessions/<slug>.jsonl`; this Change
 * has no key for one, and a run that streamed a million tokens leaves exactly
 * these three facts. The union stays CLOSED TO CONTENT.
 */
export interface RunChange {
  kind: "run";
  /** The tool ROW's id — never the command, never a path. */
  tool: string;
  /** `answered` only for a completed run; everything else is `no-response`. */
  outcome: RunOutcome;
  /** The result's byte size when the run completed, else null. */
  resultSize: number | null;
}

/** One entry in a Move's Change log (the closed union). */
export type Change =
  | ReadHeadChange
  | MintPointerChange
  | WriteTextChange
  | OpenOsChange
  | AskChange
  | RunChange;

/** The pointer a PRISM rode, as its authored form and verbatim value. */
export interface PrismPointer {
  form: PointerForm;
  value: string;
}

/** One PRISM line: one contact Move, appended and never merged. */
export interface Prism {
  /** The app-minted id (the ghost envelope's precedent; PROVISIONAL prefix). */
  id: string;
  /** The anchor: the reference slug the Move is anchored on. */
  on: string;
  /** The contact kind (the Move's verb). */
  contact: ContactKind;
  /** The pointer line the Move rode; null for a pointer-less Ask. */
  pointer: PrismPointer | null;
  /** The Move's Change log, in the order the Move made it (never empty). */
  changes: Change[];
  /** The person's explanation, verbatim; empty when they wrote none. */
  explanation: string;
  /** Unknown JSON keys preserved across reads and writes (the family posture). */
  extra: Record<string, unknown>;
}

/** The parsed file: every readable line in FILE ORDER, plus the raw unknowns. */
export interface ParsedPrisms {
  prisms: Prism[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

/**
 * The PRISM's own declared keys (the pointer's form key joins them on a line).
 * There is no content slot here, by design.
 */
export const PRISM_KEYS: readonly string[] = [
  "changes",
  "contact",
  "explanation",
  "id",
  "on",
];

/** The bounds object's required keys (the exact caps asked for). */
export const BOUNDS_KEYS: readonly string[] = ["maxBytes", "maxLines"];

/**
 * The bounds object's DECLARED-FACT keys (Measure only, PROVISIONAL): the
 * head's size and mtime, pasted verbatim from the head read. A bounds object
 * carries either both facts or neither — a lone size is malformed, never
 * guessed at.
 */
export const BOUNDS_FACT_KEYS: readonly string[] = ["mtime", "size"];

/** The declared key set of each Change kind (the union is closed). */
export const CHANGE_KEYS: Readonly<Record<ChangeKind, readonly string[]>> = {
  "read-head": ["bounds", "decode", "kind", "outcome", "pointer"],
  "mint-pointer": ["kind", "outcome", "target"],
  "write-text": ["kind", "outcome", "pointer", "size"],
  "open-os": ["kind", "outcome", "pointer"],
  ask: [
    "decode",
    "included",
    "kind",
    "outcome",
    "pointer",
    "responseSize",
  ],
  run: ["kind", "outcome", "resultSize", "tool"],
};

/**
 * The OPTIONAL keys of each Change kind (the union stays closed: required plus
 * these, and nothing else). Today ONE field is optional in the whole union:
 * the `ask` Change's `anchor` — READ-ONLY LEGACY since story 17.9 retired the
 * anchor as the context mechanism (old lines parse and display; new Moves never
 * write it). The retirement is PROVISIONALLY REVERSIBLE, which is why the field
 * stays declared rather than rejected. A concept map Ask never carried it.
 */
export const CHANGE_OPTIONAL_KEYS: Readonly<
  Record<ChangeKind, readonly string[]>
> = {
  "read-head": [],
  "mint-pointer": [],
  "write-text": [],
  "open-os": [],
  ask: ["anchor"],
  run: [],
};

/** The key's pointer-less suffix (an Ask may ride no pointer at all). */
const NO_POINTER = "none";

/** The PRISM file's path. */
export function prismsPath(workspacePath: string): string {
  return workspacePath + "/map/prisms.jsonl";
}

/** Mint an app-side id: the prefix plus a random UUID (PROVISIONAL). */
export function mintPrismId(): string {
  return `prism-${crypto.randomUUID()}`;
}

/**
 * The record's natural key: anchor + contact + the POINTER'S NATURAL KEY
 * (on + form + value). A pointer-less Ask names the anchor and the contact.
 * The key identifies WHAT the line is about; it never dedupes (append-only).
 * It is computed, never stored as a field (the line's fields are the citation).
 */
export function prismKeyOf(
  on: string,
  contact: ContactKind,
  pointer: PrismPointer | null,
): string {
  return pointer === null
    ? `${contact}\u0000${on}\u0000${NO_POINTER}`
    : `${contact}\u0000${pointerKey(on, pointer.form, pointer.value)}`;
}

/** The record's natural key. */
export function prismKey(prism: Prism): string {
  return prismKeyOf(prism.on, prism.contact, prism.pointer);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value !== "";
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** An integer of either sign (an mtime may precede the epoch). */
function isInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

/** Parse the bounds object: two exact caps, plus Measure's facts as a pair. */
function parseHeadBounds(value: unknown): HeadBounds | null {
  if (!isPlainObject(value)) return null;
  if (!BOUNDS_KEYS.every((key) => key in value)) return null;
  const keys = Object.keys(value);
  const facts = keys.filter((key) => BOUNDS_FACT_KEYS.includes(key));
  if (keys.length !== BOUNDS_KEYS.length + facts.length) return null;
  if (facts.length !== 0 && facts.length !== BOUNDS_FACT_KEYS.length) {
    return null;
  }
  if (!isCount(value.maxLines) || !isCount(value.maxBytes)) return null;
  if (facts.length === 0) {
    return { maxLines: value.maxLines, maxBytes: value.maxBytes };
  }
  const size = value.size;
  if (size !== null && !isCount(size)) return null;
  const mtime = value.mtime;
  if (mtime !== null && !isInteger(mtime)) return null;
  return {
    maxLines: value.maxLines,
    maxBytes: value.maxBytes,
    size: size as number | null,
    mtime: mtime as number | null,
  };
}

/** Serialize a bounds object, keeping Measure's declared facts when present. */
function headBoundsFields(bounds: HeadBounds): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    maxLines: bounds.maxLines,
    maxBytes: bounds.maxBytes,
  };
  if (bounds.size !== undefined || bounds.mtime !== undefined) {
    fields.size = bounds.size ?? null;
    fields.mtime = bounds.mtime ?? null;
  }
  return fields;
}

function hasExactKeys(
  object: Record<string, unknown>,
  keys: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const present = Object.keys(object);
  if (present.length < keys.length) return false;
  if (!keys.every((key) => key in object)) return false;
  return present.every((key) => keys.includes(key) || optional.includes(key));
}

function isIn<const T extends string>(
  values: readonly T[],
  value: unknown,
): value is T {
  return (
    typeof value === "string" && (values as readonly string[]).includes(value)
  );
}

/** Parse one Change; an out-of-shape or unknown-key Change is malformed. */
export function parsePrismChange(value: unknown): Change | null {
  if (!isPlainObject(value)) return null;
  const kind = value.kind;
  if (!isChangeKind(kind)) return null;
  if (!hasExactKeys(value, CHANGE_KEYS[kind], CHANGE_OPTIONAL_KEYS[kind])) {
    return null;
  }
  switch (kind) {
    case "read-head": {
      if (!isNonEmptyString(value.pointer)) return null;
      if (!isIn(READ_HEAD_OUTCOMES, value.outcome)) return null;
      const bounds = parseHeadBounds(value.bounds);
      if (bounds === null) return null;
      const decode = value.decode;
      if (decode !== null && !isIn(DECODE_STATUSES, decode)) return null;
      // The log's honesty: a READ decoded text (clean or replaced); every
      // refusal decoded nothing — so a decode on a refusal would be a lie.
      if (value.outcome === "read" ? decode === null : decode !== null) {
        return null;
      }
      return {
        kind,
        pointer: value.pointer,
        outcome: value.outcome,
        bounds,
        decode: decode as DecodeStatus | null,
      };
    }
    case "mint-pointer": {
      if (!isNonEmptyString(value.target)) return null;
      if (!isIn(MINT_POINTER_OUTCOMES, value.outcome)) return null;
      return { kind, target: value.target, outcome: value.outcome };
    }
    case "write-text": {
      if (!isNonEmptyString(value.pointer)) return null;
      if (!isIn(WRITE_TEXT_OUTCOMES, value.outcome)) return null;
      if (!isCount(value.size)) return null;
      return {
        kind,
        pointer: value.pointer,
        outcome: value.outcome,
        size: value.size,
      };
    }
    case "open-os": {
      if (!isNonEmptyString(value.pointer)) return null;
      if (!isIn(OPEN_OS_OUTCOMES, value.outcome)) return null;
      return { kind, pointer: value.pointer, outcome: value.outcome };
    }
    case "run": {
      // A RUN'S THREE FACTS, and nothing else: the row's id, the ending and
      // the result's size. `answered` carries a size; every other ending
      // carries null — the same shape rule the Ask's response facts follow.
      if (!isNonEmptyString(value.tool)) return null;
      if (!isIn(RUN_OUTCOMES, value.outcome)) return null;
      const resultSize = value.resultSize;
      if (resultSize !== null && !isCount(resultSize)) return null;
      if (
        value.outcome === "answered"
          ? resultSize === null
          : resultSize !== null
      ) {
        return null;
      }
      return {
        kind,
        tool: value.tool,
        outcome: value.outcome,
        resultSize,
      };
    }
    case "ask": {
      const pointer = value.pointer;
      if (pointer !== null && !isNonEmptyString(pointer)) return null;
      // The optional anchor is a SLUG when present — structure, never content.
      const anchor = value.anchor;
      if (anchor !== undefined && !isNonEmptyString(anchor)) return null;
      if (!isIn(ASK_OUTCOMES, value.outcome)) return null;
      let included: string[] | null = null;
      if (value.included !== null) {
        if (!Array.isArray(value.included)) return null;
        const keys: string[] = [];
        for (const entry of value.included) {
          if (!isNonEmptyString(entry)) return null;
          keys.push(entry);
        }
        included = keys;
      }
      const responseSize = value.responseSize;
      if (responseSize !== null && !isCount(responseSize)) return null;
      const decode = value.decode;
      if (decode !== null && !isIn(DECODE_STATUSES, decode)) return null;
      // An answered Ask carries its response's declared size and decode; an
      // unanswered one carries neither (never a zero that looks like content).
      const answered = value.outcome === "answered";
      if (
        answered
          ? responseSize === null || decode === null
          : responseSize !== null || decode !== null
      ) {
        return null;
      }
      return {
        kind,
        pointer,
        ...(anchor === undefined ? {} : { anchor }),
        outcome: value.outcome,
        included,
        responseSize,
        decode,
      };
    }
  }
}

/**
 * Parse one JSONL line into a PRISM; malformed or out-of-shape lines become
 * `null`. A line must carry a non-empty `id`, a non-empty anchor `on`, one
 * of the four contact kinds, at most one pointer form (with a non-empty
 * value), a non-empty Change log of valid Changes and an `explanation` string
 * when the key is present. A line with TWO form keys is malformed — the form
 * is the authored key, never guessed at.
 */
export function parsePrismLine(line: string): Prism | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isPlainObject(value)) return null;

  if (!isNonEmptyString(value.id)) return null;
  if (!isNonEmptyString(value.on)) return null;
  if (!isContactKind(value.contact)) return null;

  const forms = POINTER_FORMS.filter((form) => form in value);
  if (forms.length > 1) return null;
  let pointer: PrismPointer | null = null;
  if (forms.length === 1) {
    const form = forms[0];
    const target = value[form];
    if (!isNonEmptyString(target)) return null;
    pointer = { form, value: target };
  }

  const changes = value.changes;
  if (!Array.isArray(changes) || changes.length === 0) return null;
  const parsedChanges: Change[] = [];
  for (const entry of changes) {
    const change = parsePrismChange(entry);
    if (change === null) return null;
    parsedChanges.push(change);
  }

  let explanation = "";
  if ("explanation" in value) {
    if (typeof value.explanation !== "string") return null;
    explanation = value.explanation;
  }

  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    if (PRISM_KEYS.includes(key)) continue;
    if (POINTER_FORMS.some((form) => form === key)) continue;
    extra[key] = value[key];
  }

  return {
    id: value.id,
    on: value.on,
    contact: value.contact,
    pointer,
    changes: parsedChanges,
    explanation,
    extra,
  };
}

/** Serialize one Change to its plain JSON fields (canonicalization is the line's). */
function changeFields(change: Change): Record<string, unknown> {
  switch (change.kind) {
    case "read-head":
      return {
        kind: change.kind,
        pointer: change.pointer,
        outcome: change.outcome,
        bounds: headBoundsFields(change.bounds),
        decode: change.decode,
      };
    case "mint-pointer":
      return {
        kind: change.kind,
        target: change.target,
        outcome: change.outcome,
      };
    case "write-text":
      return {
        kind: change.kind,
        pointer: change.pointer,
        outcome: change.outcome,
        size: change.size,
      };
    case "open-os":
      return {
        kind: change.kind,
        pointer: change.pointer,
        outcome: change.outcome,
      };
    case "ask":
      return {
        kind: change.kind,
        pointer: change.pointer,
        // PROVISIONAL (story 17.4): the ask card's anchor rides only when the
        // Move was made in a card; a concept map Ask's line is unchanged.
        ...(change.anchor === undefined ? {} : { anchor: change.anchor }),
        outcome: change.outcome,
        included: change.included === null ? null : [...change.included],
        responseSize: change.responseSize,
        decode: change.decode,
      };
    case "run":
      return {
        kind: change.kind,
        tool: change.tool,
        outcome: change.outcome,
        resultSize: change.resultSize,
      };
  }
}

/** Serialize one PRISM to its canonical JSONL line (compact, sorted keys). */
export function serializePrismLine(prism: Prism): string {
  const fields: Record<string, unknown> = {
    ...prism.extra,
    changes: prism.changes.map(changeFields),
    contact: prism.contact,
    explanation: prism.explanation,
    id: prism.id,
    on: prism.on,
  };
  if (prism.pointer !== null) {
    fields[prism.pointer.form] = prism.pointer.value;
  }
  return canonicalJsonlLine(fields);
}

/**
 * Read `map/prisms.jsonl`. Terminating newlines are ignored; malformed or
 * out-of-shape lines are preserved as unknowns (ADR-0005's posture) so the app
 * never silently drops what it cannot read. Tolerates a BOM and CRLF. Lines
 * are kept in file order and multiplicity: repeated keys are the family's
 * truth (append-only), never deduped.
 */
export function parsePrisms(text: string): ParsedPrisms {
  const prisms: Prism[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parsePrismLine(line);
    if (parsed) {
      prisms.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return { prisms, malformed };
}

export async function loadPrisms(workspacePath: string): Promise<ParsedPrisms> {
  const text = await readTextFile(prismsPath(workspacePath));
  return text === null ? { prisms: [], malformed: [] } : parsePrisms(text);
}

/** Do two citations name the same pointer (form + verbatim value)? */
function samePointer(
  left: PrismPointer | null,
  right: PrismPointer | null,
): boolean {
  if (left === null || right === null) return left === right;
  return left.form === right.form && left.value === right.value;
}

/**
 * One reach's LATEST PRISM, in FILE order (Epic 12 story 2, PROVISIONAL). The
 * log is append-only, so the last readable line that matches the citation is
 * the latest Move on that reach. The scan is BY CITATION, never a listing: it
 * returns ONE Prism (or null), so a caller cannot turn the series into a
 * gallery, a count or a summary. Passing `contact` narrows to one contact;
 * omitted, the latest Move on the reach wins whatever its verb.
 */
export function latestPrismIn(
  text: string,
  on: string,
  pointer: PrismPointer | null,
  contact?: ContactKind,
): Prism | null {
  let latest: Prism | null = null;
  for (const prism of parsePrisms(text).prisms) {
    if (prism.on !== on) continue;
    if (contact !== undefined && prism.contact !== contact) continue;
    if (!samePointer(prism.pointer, pointer)) continue;
    latest = prism;
  }
  return latest;
}

/** The on-disk reach's latest PRISM, read fresh (no cache, no gallery). */
export async function loadLatestPrism(
  workspacePath: string,
  on: string,
  pointer: PrismPointer | null,
  contact?: ContactKind,
): Promise<Prism | null> {
  const text = await readTextFile(prismsPath(workspacePath));
  return text === null ? null : latestPrismIn(text, on, pointer, contact);
}

/**
 * Rewrite ONE line's person-authored explanation, addressed by app-minted id
 * (Epic 12 story 2, PROVISIONAL).
 *
 * The PRISM's CHANGES are read-only forever; the explanation is the person's
 * own words on their own Move, authored at the Move's window. This is the one
 * targeted edit the family allows: it changes the `explanation` field of the
 * line whose id matches and NO other byte — every earlier and later line keeps
 * its bytes exactly, file order and multiplicity are untouched, malformed
 * lines are re-emitted verbatim, and a line's own terminator style (LF/CRLF) is
 * kept. It is never a merge, never a dedupe and never an append (an appended
 * line would be a second Move — a lie). Returns null when no readable line
 * carries the id; the caller reports "not saved" and leaves the file alone.
 *
 * The edited line is re-serialized canonically (the family's posture): a hand
 * line's unknown keys survive, but its key order becomes canonical.
 */
export function rewritePrismExplanation(
  text: string,
  id: string,
  explanation: string,
): string | null {
  const pieces = text.match(/[^\n]*\n|[^\n]+$/g);
  if (pieces === null) return null;
  for (let index = 0; index < pieces.length; index += 1) {
    const piece = pieces[index];
    const ending = piece.endsWith("\r\n")
      ? "\r\n"
      : piece.endsWith("\n")
        ? "\n"
        : "";
    const line = ending === "" ? piece : piece.slice(0, -ending.length);
    const bom = line.startsWith("\uFEFF") ? "\uFEFF" : "";
    const prism = parsePrismLine(bom === "" ? line : line.slice(1));
    if (prism === null || prism.id !== id) continue;
    // Nothing changed: keep the line's exact bytes (an edit-free blur writes
    // nothing, so a hand line's formatting can never be rewritten for free).
    if (prism.explanation === explanation) return text;
    const next = pieces.slice();
    next[index] = bom + serializePrismLine({ ...prism, explanation }) + ending;
    return next.join("");
  }
  return null;
}

/**
 * The prisms file's exact bytes. Every record serializes canonically (sorted
 * keys), in FILE ORDER and preserving multiplicity — never merged, never
 * reordered, never deduped — and malformed lines are re-emitted verbatim. An
 * empty document is the canonical empty JSONL (one newline).
 */
export function serializePrisms(
  prisms: readonly Prism[],
  malformed: readonly string[] = [],
): string {
  return canonicalJsonlLines([
    ...prisms.map(serializePrismLine),
    ...malformed,
  ]);
}

/**
 * The whole-file writer, for the family's posture (a hand file's malformed
 * lines) and for tests. A MOVE never rewrites the log: it goes through
 * `appendPrismLine`, so no earlier line's bytes can change.
 */
export async function savePrisms(
  workspacePath: string,
  prisms: readonly Prism[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(
    prismsPath(workspacePath),
    serializePrisms(prisms, malformed),
  );
}

/**
 * The append-only door: the file's existing bytes are kept EXACTLY (a hand
 * edit, a CRLF, a BOM and every earlier line survive), and one canonical line
 * is added. Nothing is rewritten, so the log can never become a merged tally.
 */
export function appendPrismLine(before: string | null, prism: Prism): string {
  const line = serializePrismLine(prism);
  const base = before ?? "";
  if (base === "") return line + "\n";
  if (base.endsWith("\n")) return base + line + "\n";
  return base + "\n" + line + "\n";
}
