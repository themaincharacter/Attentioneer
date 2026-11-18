import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalText, nextSlug, slugName } from "../lib/serialize";
import { GROUND_RECORD_FILE, mapDir } from "./records";

/**
 * The GROUND map's own record family (story 16.1): one `map/ground.txt` line
 * per grounded reference.
 *
 *   on: <slug> | name: <the person's exact words> | x: <int> | y: <int>
 *
 * A ground reference is a Reference with a ground face (GLOSSARY): the person
 * coins the name and places it, and the reading beside it comes from a text
 * file the person pointed at (readings.ts). Nothing here sniffs, guesses or
 * generates anything; the line holds the person's words and their point.
 *
 * IDENTITY is the name-derived slug, minted the concept map's way
 * (`slugName` + `nextSlug`, ADR-0005 rule 4): the same coined name on two
 * lines is two references, and the second gets the `-2` suffix. That slug is
 * also the key the reading family joins on, so the two files stay in step.
 *
 * THE FILE IS THE WHOLE TRUTH: there is no index, cache or side table. A
 * missing file means no ground references; the workspace's `map/` folder
 * alone rebuilds the view. A line that does not parse is PRESERVED verbatim
 * and reported (ADR-0009's honesty surfaces), never silently dropped: the
 * loader keeps it and the writer re-emits it.
 *
 * Writes go through the app's per-record discipline (writeQueue.ts in
 * `useGround`), never a whole-folder rewrite: one family's file, one
 * read-modify-write at a time.
 *
 * PROVISIONAL (the story's record shapes, before an ADR settles them): the
 * `ground.txt` name, the `on | name | x | y` line shape, the strict key
 * order on read and the int coordinates. A hand edit that changes the order is
 * an unreadable line, surfaced rather than guessed at. STORY 16.2 adds the one
 * other person move this family needed: `moveGroundReference` places an
 * existing reference at a new point (one line rewrite, on drop). Renaming is
 * still out of scope, and no reading STATE is ever written here — states are
 * computed at load in `readings.ts`.
 */

/** One ground reference: the person's name at their point, keyed by slug. */
export interface GroundReference {
  /** Record identity: the name-derived slug, also the reading's key. */
  on: string;
  /** The person's exact words — never trimmed or normalized here. */
  name: string;
  /** World-space point of the name, in whole map units (provisional). */
  x: number;
  y: number;
}

/** A read of `map/ground.txt`: what parsed, and what is kept but unreadable. */
export interface ParsedGround {
  /** Every readable line, in FILE ORDER (hand duplicates included). */
  references: GroundReference[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

/** The bridges this family needs; the app passes lib/fs, a test passes a fake. */
export interface GroundIo {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const GROUND_IO: GroundIo = { readTextFile, writeTextFile };

/** The ground reference file: `<workspace>/map/ground.txt`. */
export function groundPath(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${GROUND_RECORD_FILE.ground}`;
}

/**
 * The line shape, in the order the writer emits it. `name` is greedy so the
 * person's words may contain the ` | ` separator (only the exact ` | x: N |
 * y: N` tail is structural). The slug is the app's own shape: no spaces.
 */
const GROUND_LINE =
  /^on: (\S+) \| name: (.+) \| x: (-?\d+) \| y: (-?\d+)$/;

/**
 * Parse one line. Anything out of shape — a missing key, a decimal coordinate,
 * an empty name — becomes `null`: it is kept and reported by `parseGround`,
 * never guessed into a reference.
 */
export function parseGroundLine(line: string): GroundReference | null {
  const match = GROUND_LINE.exec(line);
  if (!match) return null;
  const [, on, name, x, y] = match;
  if (on === "" || name.trim() === "") return null;
  return { on, name, x: Number(x), y: Number(y) };
}

/** One reference as its canonical line (no trailing newline). */
export function serializeGroundLine(reference: GroundReference): string {
  return `on: ${reference.on} | name: ${reference.name} | x: ${reference.x} | y: ${reference.y}`;
}

/**
 * Read the file's bytes. Terminating newlines are ignored, a BOM and CRLF from
 * a hand edit are tolerated, and an unparsable line lands in `malformed`
 * verbatim (ADR-0009) so a write can put it back.
 */
export function parseGround(text: string): ParsedGround {
  const references: GroundReference[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseGroundLine(line);
    if (parsed === null) malformed.push(line);
    else references.push(parsed);
  }
  return { references, malformed };
}

/**
 * The file's exact canonical bytes: known records in FILE ORDER, then the
 * preserved unreadable lines, LF and one trailing newline (the record files'
 * convention, serialize.ts's `canonicalText`). A hand-duplicated key is
 * never collapsed here: the read rule keeps content exactly as the person left
 * it, and the writer is not a validator.
 */
export function serializeGround(
  references: readonly GroundReference[],
  malformed: readonly string[] = [],
): string {
  return canonicalText(
    [...references.map(serializeGroundLine), ...malformed].join("\n"),
  );
}

export async function loadGround(
  workspacePath: string,
  io: GroundIo = GROUND_IO,
): Promise<ParsedGround> {
  const text = await io.readTextFile(groundPath(workspacePath));
  return text === null
    ? { references: [], malformed: [] }
    : parseGround(text);
}

export async function saveGround(
  workspacePath: string,
  references: readonly GroundReference[],
  malformed: readonly string[] = [],
  io: GroundIo = GROUND_IO,
): Promise<void> {
  await io.writeTextFile(
    groundPath(workspacePath),
    serializeGround(references, malformed),
  );
}

/** What adding one reference did: the new list and the line it appended. */
export interface GroundAddition {
  references: GroundReference[];
  reference: GroundReference;
}

/**
 * Append a coined name at a point, minting its slug against the references
 * already on the ground map (the concept map's dedupe rule). STORY 17.1 (the
 * epic's ONE SLUG SPACE): the caller may hand in the SHARED set of ground AND
 * ask-card slugs, because a link, a mention or an anchor must resolve to
 * exactly one card; the default stays the references alone, so a caller that
 * knows no asks mints exactly as it did. PURE: the caller writes the file, so a
 * test can assert the line without a disk. A blank name is the caller's refusal
 * (the bubble asks for one first); this function only names and places.
 * Coordinates are rounded to whole map units because the provisional line shape
 * carries ints.
 */
export function addGroundReference(
  references: readonly GroundReference[],
  name: string,
  x: number,
  y: number,
  taken: ReadonlySet<string> = new Set(
    references.map((reference) => reference.on),
  ),
): GroundAddition {
  const reference: GroundReference = {
    on: nextSlug(slugName(name), taken),
    name,
    x: Math.round(x),
    y: Math.round(y),
  };
  return { references: [...references, reference], reference };
}

/**
 * REMOVE one reference's line (story 16.3): the slug's line leaves and every
 * other line — and every malformed line, which the caller hands back to the
 * writer untouched — stays byte-identical. PURE: the caller writes the file,
 * and the delete's fixed order (ground line, readings line, text file) lives
 * in `useGround`. No tombstone and no undo (the history story owns that).
 */
export function withGroundRemoved(
  references: readonly GroundReference[],
  on: string,
): GroundReference[] {
  return references.filter((reference) => reference.on !== on);
}

/**
 * STORY 16.21 — THE NAME THE MAP SAYS WHEN THE PERSON LEFT NONE. A ground line
 * cannot carry an empty name (the parser would keep it as a malformed line and
 * the card would lose the one word that identifies it), so the empty field
 * becomes THIS sentence at the write and the pill renders it like any other
 * name. The ask card's "Untitled ask" is the same rule, one family over.
 * PROVISIONAL wording.
 */
export const GROUND_UNTITLED_NAME = "Untitled reference";

/** The name a card SHOWS: the record's words, or the one sentence for none. */
export function groundDisplayName(name: string): string {
  return name.trim() === "" ? GROUND_UNTITLED_NAME : name;
}

/**
 * The name a write STORES: trimmed, and the untitled sentence when the field is
 * blank. Never an empty name — an empty `name:` tail would make the line
 * unreadable on the next load, and the person's empty field is a legal name,
 * not a missing one.
 */
export function groundNameForWrite(name: string): string {
  const trimmed = name.trim();
  return trimmed === "" ? GROUND_UNTITLED_NAME : trimmed;
}

/**
 * STORY 16.21 — RENAME one reference: the NAME is the person's and changes;
 * the SLUG is identity (the reading's key, a link's endpoint, an ask's anchor)
 * and never moves. One line is rewritten in place, so a rename can neither
 * reorder the map nor orphan a reading. PURE — the caller writes the file
 * through the app's one write queue, so a test can assert the bytes without a
 * disk. A hand-duplicated slug renames every line that carries it (the read
 * rule keeps duplicates as content).
 */
export function withGroundRenamed(
  references: readonly GroundReference[],
  on: string,
  name: string,
): GroundReference[] {
  const next = groundNameForWrite(name);
  return references.map((reference) =>
    reference.on === on ? { ...reference, name: next } : reference,
  );
}

/**
 * MOVE one reference to a new point (story 16.2 decision 6): the card is
 * dropped, and the app rewrites this ONE line through the write queue. PURE —
 * the caller writes the file, so a drag's commit is one write and a test can
 * assert the bytes without a disk. Coordinates are rounded to whole map units
 * like `addGroundReference`; a hand-duplicated slug moves every line that
 * carries it (the read rule keeps duplicates as content, so the person's drag
 * cannot be silently narrowed to one of them). No state, reading or name changes.
 */
export function moveGroundReference(
  references: readonly GroundReference[],
  on: string,
  x: number,
  y: number,
): GroundReference[] {
  return references.map((reference) =>
    reference.on === on ? { ...reference, x: Math.round(x), y: Math.round(y) } : reference,
  );
}
