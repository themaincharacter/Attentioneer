import {
  createDirAll,
  fileMeta,
  readTextFile,
  readTextHead,
  writeTextFile,
  type FileMetaAnswer,
  type HeadRefusalCode,
  type TextHead,
} from "../lib/fs";
import { canonicalText } from "../lib/serialize";
import type { PointerForm } from "./pointers";
import { GROUND_READINGS_DIR, GROUND_RECORD_FILE, mapDir } from "./records";

/**
 * The GROUND map's readings (story 16.1, made honest by story 16.2): the text
 * the person's pointed-at file opened with, kept beside the map.
 *
 *   map/readings.txt         on: <slug> | form: path | from: <path> | taken: <ISO-8601> | bytes: <n>
 *   map/readings/<slug>.md   the text as read, bytes verbatim
 *
 * A reading is NOT a Pointer (ADR-0017): a pointer is a reach the person keeps
 * as an authored handle, while a reading is what came back from one file and
 * was kept beside the map. The handle here is still the person's pick — story 1
 * took an absolute path from the OS file dialog, never a sniffed or repaired
 * one — and the text is the head the bridge read, byte for byte.
 *
 * STORY 16.2: the reading is a COPY TAKEN AT A MOMENT, and the file keeps
 * living outside the app. So the line gains `bytes` (the file's size when the
 * head was taken), and the map's state is COMPUTED AT LOAD, never stored:
 * `resolveReadingState` compares the file's metadata with the reading and
 * answers current / changed / missing / unreadable / unread. No state word is
 * ever written into a record — a stored state would be a second truth that
 * drifts from the file. `changed` is a METADATA claim (size differs, or the
 * modified time is newer than `taken`): the map says "has changed since this
 * reading", never "the text differs".
 *
 * THE FORM FOLLOWS WHERE THE FILE LIVES (story 16.2 decision 3), as storage,
 * not as an authored choice: a pick INSIDE the workspace is `form: path` with
 * a workspace-relative value (portable with the folder); a pick OUTSIDE is
 * `form: at` with the absolute value (machine-local, ADR-0017's outward
 * exception). A LEGACY `form: path` line whose value is absolute is read as
 * absolute and left exactly as it is — there is no migration pass. `url` is
 * not a reading form in this story: a link is not reachable without a network.
 *
 * THE CAP IS STILL PROVISIONAL: the first 64 lines or 8 KiB, whichever comes
 * first (a hypothesis, not a rule).
 *
 * REFRESH IS THE ONLY RE-READ (story 16.2 decision 4): one affordance, pressed
 * by the person, re-takes the head under the same cap and stamps a new
 * `taken`/`bytes`. Nothing here watches, polls or re-reads on open; a
 * refused refresh keeps the old reading and answers one sentence.
 *
 * A REFUSAL IS A SENTENCE, AND NOTHING IS CREATED HALF-FORMED: an absent file,
 * a binary file or an unreadable one refuses the whole take (the text file is
 * only written after a successful head read). Malformed lines in
 * `readings.txt` are preserved and reported, never silently dropped
 * (ADR-0009's honesty surfaces).
 *
 * PROVISIONAL (the story's record shapes, before an ADR settles them): the
 * `readings.txt` name, the line shape and its key order, the `path`/`at`
 * form rule for NEW picks, the `bytes` field, the 64/8 KiB cap, the ISO
 * timestamp and the state names.
 */

/**
 * The forms story 2 reads and writes. PROVISIONAL: a pick inside the workspace
 * is `path` (workspace-relative), a pick outside is `at` (absolute,
 * machine-local). A `url` line is not a reading yet — it is surfaced as
 * unreadable input, not guessed into a form.
 */
export const READING_FORMS: readonly PointerForm[] = ["path", "at"];

/** Story 1's cap: the first 64 lines... (PROVISIONAL, not a rule). */
export const READING_MAX_LINES = 64;

/** ...or 8 KiB, whichever comes first (PROVISIONAL, not a rule). */
export const READING_MAX_BYTES = 8 * 1024;

/**
 * How many lines of the stored reading a SMALL card shows (story 16.3).
 * PROVISIONAL (ADR-0003's rendering seam): the crop is a look, not a rule —
 * the stored text keeps every line it took; only the card's face is cut.
 */
export const READING_PREVIEW_LINES = 6;

/** One reading: the file the person picked and when its head was taken. */
export interface Reading {
  /** The ground reference's slug — the key the two files join on. */
  on: string;
  /**
   * The storage form (ADR-0017's vocabulary, story 16.2's location rule): a
   * `path` is workspace-relative, an `at` is absolute.
   */
  form: PointerForm;
  /** The value in that form, stored verbatim (a legacy absolute `path` too). */
  from: string;
  /** When the head was taken, ISO-8601 (the writer's clock). */
  taken: string;
  /**
   * The file's SIZE when the head was taken (story 16.2's staleness fact).
   * Absent on a legacy line: unknown, never invented, and never rewritten on
   * load. A null/undefined `bytes` means the size comparison is skipped.
   */
  bytes?: number | null;
}

/** A read of `map/readings.txt`: what parsed and what is kept but unreadable. */
export interface ParsedReadings {
  readings: Reading[];
  malformed: string[];
}

/** The bridges this family needs; the app passes lib/fs, a test passes a fake. */
export interface ReadingIo {
  readTextFile(path: string): Promise<string | null>;
  readTextHead(
    path: string,
    maxLines: number,
    maxBytes: number,
  ): Promise<TextHead>;
  writeTextFile(path: string, content: string): Promise<void>;
  createDirAll(path: string): Promise<void>;
  /** Story 16.2's metadata stat; a refusal is a value, never a throw. */
  fileMeta(path: string): Promise<FileMetaAnswer>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const READING_IO: ReadingIo = {
  readTextFile,
  readTextHead,
  writeTextFile,
  createDirAll,
  fileMeta,
};

/** The reading lines file: `<workspace>/map/readings.txt`. */
export function readingsPath(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${GROUND_RECORD_FILE.readings}`;
}

/** The reading texts' folder: `<workspace>/map/readings`. */
export function readingsDir(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${GROUND_READINGS_DIR}`;
}

/** One reading's text: `<workspace>/map/readings/<slug>.md`. */
export function readingTextPath(
  workspacePath: string,
  slug: string,
): string {
  return `${readingsDir(workspacePath)}/${slug}.md`;
}

/**
 * The line shape. `from` is greedy so a path may contain the separator; only
 * the ` | form: ... ` head and the ` | taken: ...` tail are structural.
 * `bytes` is OPTIONAL on read (a story-1 line has none): a missing tail is
 * unknown size, never a guess and never a rewrite.
 */
const READING_LINE =
  /^on: (\S+) \| form: (\S+) \| from: (.+) \| taken: (\S+?)(?: \| bytes: (\d+))?$/;

/** Parse one line; anything out of shape is `null` (kept and reported). */
export function parseReadingLine(line: string): Reading | null {
  const match = READING_LINE.exec(line);
  if (!match) return null;
  const [, on, form, from, taken, bytes] = match;
  if (on === "" || from === "" || taken === "") return null;
  // The vocabulary is provisional: a form the app does not know yet is
  // preserved and surfaced, never guessed into `path`.
  if (!READING_FORMS.includes(form as PointerForm)) return null;
  const reading: Reading = { on, form: form as PointerForm, from, taken };
  if (bytes !== undefined) reading.bytes = Number(bytes);
  return reading;
}

/**
 * One reading as its canonical line (no trailing newline). `bytes` is written
 * only when known: a legacy line is left without one until a refresh stamps it.
 */
export function serializeReadingLine(reading: Reading): string {
  const size =
    reading.bytes === null || reading.bytes === undefined
      ? ""
      : ` | bytes: ${reading.bytes}`;
  return `on: ${reading.on} | form: ${reading.form} | from: ${reading.from} | taken: ${reading.taken}${size}`;
}

/** Read the file's bytes: LF/BOM/CRLF tolerated, unreadable lines kept. */
export function parseReadings(text: string): ParsedReadings {
  const readings: Reading[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseReadingLine(line);
    if (parsed === null) malformed.push(line);
    else readings.push(parsed);
  }
  return { readings, malformed };
}

/** The file's canonical bytes: known lines in FILE ORDER, then preserved ones. */
export function serializeReadings(
  readings: readonly Reading[],
  malformed: readonly string[] = [],
): string {
  return canonicalText(
    [...readings.map(serializeReadingLine), ...malformed].join("\n"),
  );
}

export async function loadReadings(
  workspacePath: string,
  io: ReadingIo = READING_IO,
): Promise<ParsedReadings> {
  const text = await io.readTextFile(readingsPath(workspacePath));
  return text === null ? { readings: [], malformed: [] } : parseReadings(text);
}

export async function saveReadings(
  workspacePath: string,
  readings: readonly Reading[],
  malformed: readonly string[] = [],
  io: ReadingIo = READING_IO,
): Promise<void> {
  await io.writeTextFile(
    readingsPath(workspacePath),
    serializeReadings(readings, malformed),
  );
}

/**
 * Is this value an absolute path? POSIX's leading slash, a Windows drive
 * (`C:\` or `C:/`) and a UNC (`\\\\server`) all count. PROVISIONAL: the
 * spellings, and the case-sensitive workspace comparison below (a Windows pick
 * spelled in another case stores `at` rather than guessing).
 */
export function isAbsolutePath(path: string): boolean {
  return (
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("\\\\")
  );
}

/** Normalize separators for the one comparison (never for the stored value). */
function slashed(path: string): string {
  return path.replace(/\\/g, "/");
}

/**
 * Does an absolute path name a place INSIDE the workspace? The comparison is
 * done on normalized separators; a trailing separator on the workspace does
 * not matter. PROVISIONAL: case-sensitive (see `isAbsolutePath`).
 */
export function isInsideWorkspace(
  workspacePath: string,
  path: string,
): boolean {
  const root = slashed(workspacePath).replace(/\/+$/, "");
  const target = slashed(path);
  return target === root || target.startsWith(root + "/");
}

/**
 * The storage form and value for a pick (story 16.2 decision 3): inside the
 * workspace → `path`, workspace-relative with forward slashes (portable with
 * the folder); outside → `at`, the absolute value verbatim (machine-local).
 * A value that is already relative is kept as a `path` — the dialog returns
 * absolute paths, and a hand-authored relative one is already portable.
 */
export function readingFormFor(
  workspacePath: string,
  picked: string,
): { form: PointerForm; from: string } {
  if (!isAbsolutePath(picked)) return { form: "path", from: picked };
  if (isInsideWorkspace(workspacePath, picked)) {
    const root = slashed(workspacePath).replace(/\/+$/, "");
    return { form: "path", from: slashed(picked).slice(root.length + 1) };
  }
  return { form: "at", from: picked };
}

/**
 * The ABSOLUTE path a reading's file lives at, for a stat or a re-read. A
 * `path` is joined to the workspace; a LEGACY absolute `path` value is used
 * as it stands (story 1 wrote absolute paths under `path`, and the no-
 * migration rule means it must be read as written); an `at` is absolute.
 */
export function readingAbsolutePath(
  workspacePath: string,
  reading: Reading,
): string {
  if (reading.form === "at") return reading.from;
  if (isAbsolutePath(reading.from)) return reading.from;
  return `${workspacePath}/${reading.from}`;
}

/** The map's five reading states, computed at load and never stored. */
export type ReadingState =
  | "current"
  | "changed"
  | "missing"
  | "unreadable"
  | "unread";

/**
 * THE STATE RULE (story 16.2 decision 1), pure: compare one reading with the
 * file's metadata and answer what the map says.
 *
 *   unread      — no reading line at all (nothing was ever taken).
 *   unreadable  — the path is not a regular file, or the stat refused.
 *   missing     — the path is not there any more.
 *   changed     — the metadata moved past the reading: the size differs from
 *                 the recorded `bytes`, or the modified time is newer than
 *                 `taken`. A METADATA claim, never a text comparison.
 *   current     — a regular file whose metadata still agrees.
 *
 * A legacy line without `bytes` skips the size half (unknown, never invented);
 * its modified time still counts. `now` guards clock skew: when the record's
 * `taken` lies in the future this machine cannot order the two, so only the
 * size half is trusted.
 */
export function resolveReadingState(
  reading: Reading | null,
  meta: FileMetaAnswer | null,
  now: number,
): ReadingState {
  if (reading === null) return "unread";
  if (meta === null || meta.kind === "refused") return "unreadable";
  if (!meta.exists) return "missing";
  if (!meta.is_file) return "unreadable";
  const recorded = reading.bytes;
  const sizeMoved =
    recorded !== null &&
    recorded !== undefined &&
    meta.len !== null &&
    meta.len !== recorded;
  const takenMs = Date.parse(reading.taken);
  const timeComparable =
    Number.isFinite(takenMs) && takenMs <= now && meta.modified_ms !== null;
  const timeMoved = timeComparable && (meta.modified_ms as number) > takenMs;
  return sizeMoved || timeMoved ? "changed" : "current";
}

/**
 * The quiet words the map shows for a state (story 16.2: one small line of
 * type, no badges). `current` says nothing — the reading itself is the
 * evidence — and every other state names itself plainly. PROVISIONAL: the
 * wording (ADR-0003's rendering seam); "has changed since this reading" is a
 * METADATA statement and must never become "the text differs".
 */
export function readingStateWord(state: ReadingState): string | null {
  switch (state) {
    case "current":
      return null;
    case "changed":
      return "the file has changed since this reading";
    case "missing":
      return "the file is missing";
    case "unreadable":
      return "the file cannot be read";
    case "unread":
      return "no reading taken yet";
  }
}

/** The one quiet sentence per refusal code (the bubble shows it). */
export const READING_REFUSALS: Readonly<Record<HeadRefusalCode | "absent", string>> = {
  absent: "that file is not there.",
  "not-text": "that file is not text.",
  "cannot-reach": "cannot reach that file.",
  escaped: "that file is outside the workspace.",
  io: "cannot read that file.",
};

/** What taking a reading did: the reading and its text, or a refusal sentence. */
export type TakeReadingResult =
  | { kind: "taken"; reading: Reading; text: string }
  | { kind: "refused"; message: string };

/** The bridge's typed refusal code, when the rejection carries one. */
function refusalCodeOf(error: unknown): HeadRefusalCode | null {
  if (error === null || typeof error !== "object") return null;
  const code = (error as { code?: unknown }).code;
  return code === "not-text" ||
    code === "cannot-reach" ||
    code === "escaped" ||
    code === "io"
    ? code
    : null;
}

/** Read one path's head under the provisional cap, or answer its sentence. */
async function readHeadOrRefuse(
  path: string,
  io: ReadingIo,
): Promise<{ ok: true; head: TextHead } | { ok: false; message: string }> {
  let head: TextHead;
  try {
    head = await io.readTextHead(path, READING_MAX_LINES, READING_MAX_BYTES);
  } catch (error) {
    const code = refusalCodeOf(error);
    return { ok: false, message: READING_REFUSALS[code ?? "io"] };
  }
  if (!head.exists) return { ok: false, message: READING_REFUSALS.absent };
  return { ok: true, head };
}

/**
 * Store one reading's head: the text file first (VERBATIM — it is the file's
 * opening lines as read, not a record the writer tidies), and only after a
 * successful read. The caller writes the LINE last, so a crash can leave an
 * orphan text but never a reading line whose text is absent.
 */
async function storeHead(
  workspacePath: string,
  on: string,
  form: PointerForm,
  from: string,
  head: TextHead,
  taken: string,
  io: ReadingIo,
): Promise<TakeReadingResult> {
  await io.createDirAll(readingsDir(workspacePath));
  await io.writeTextFile(readingTextPath(workspacePath, on), head.head);
  return {
    kind: "taken",
    reading: { on, form, from, taken, bytes: head.size },
    text: head.head,
  };
}

/**
 * Take ONE reading: ask the bridge for the head (bounded by the provisional
 * cap), refuse with a sentence if it cannot be read, otherwise write the head's
 * text beside the map under the reference's slug.
 *
 * The form and value follow the pick's LOCATION (story 16.2 decision 3), not an
 * authored choice; a refusal writes nothing at all, so an add can never leave a
 * reference with an empty body. `taken` is injectable so a test's bytes are
 * deterministic.
 */
export async function takeReading(
  workspacePath: string,
  on: string,
  picked: string,
  io: ReadingIo = READING_IO,
  taken: string = new Date().toISOString(),
): Promise<TakeReadingResult> {
  const read = await readHeadOrRefuse(picked, io);
  if (!read.ok) return { kind: "refused", message: read.message };
  const { form, from } = readingFormFor(workspacePath, picked);
  return await storeHead(workspacePath, on, form, from, read.head, taken, io);
}

/**
 * REFRESH one reading (story 16.2 decision 4): re-read the same file under the
 * same cap and stamp a new `taken`/`bytes`. The form and value are KEPT
 * exactly as the line has them — the file did not move, and a legacy absolute
 * `path` is not migrated by a refresh. The text file is rewritten first; the
 * caller rewrites the line. A refusal keeps the old reading and answers one
 * sentence (nothing is written).
 */
export async function refreshReading(
  workspacePath: string,
  reading: Reading,
  io: ReadingIo = READING_IO,
  taken: string = new Date().toISOString(),
): Promise<TakeReadingResult> {
  const path = readingAbsolutePath(workspacePath, reading);
  const read = await readHeadOrRefuse(path, io);
  if (!read.ok) return { kind: "refused", message: read.message };
  return await storeHead(
    workspacePath,
    reading.on,
    reading.form,
    reading.from,
    read.head,
    taken,
    io,
  );
}

/**
 * Add or replace one reading, keyed by its slug (the replace keeps a
 * hand-edited duplicate from becoming two lines in the app's own state).
 */
export function withReading(
  readings: readonly Reading[],
  reading: Reading,
): Reading[] {
  const next = readings.filter((existing) => existing.on !== reading.on);
  return [...next, reading];
}

/**
 * REMOVE one reading's line (story 16.3): the slug's line leaves, in file
 * order, and every other line — and every malformed line, which the caller
 * hands back to the writer untouched — stays byte-identical. PURE: the caller
 * writes the file (the delete's order lives in `useGround`).
 */
export function withReadingRemoved(
  readings: readonly Reading[],
  on: string,
): Reading[] {
  return readings.filter((reading) => reading.on !== on);
}

/** The reading for one slug, when the file has one (the layer's join). */
export function readingFor(
  readings: readonly Reading[],
  on: string,
): Reading | null {
  return readings.find((reading) => reading.on === on) ?? null;
}

/**
 * Read every reading's text for the given slugs, keyed by slug. A missing text
 * file is simply absent from the answer (the reading's STATE is what says so);
 * the reading LINE is never invented from a text file.
 */
export async function loadReadingTexts(
  workspacePath: string,
  slugs: readonly string[],
  io: ReadingIo = READING_IO,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    slugs.map(async (slug) => {
      const text = await io.readTextFile(readingTextPath(workspacePath, slug));
      return [slug, text] as const;
    }),
  );
  const texts: Record<string, string> = {};
  for (const [slug, text] of entries) {
    if (text !== null) texts[slug] = text;
  }
  return texts;
}

/**
 * The handle's display: the file's NAME only, never the full path in the plane
 * (the person can see the whole path in the reference's own surface; the map
 * shows the quiet attribution). Windows and POSIX separators both count; a
 * path ending in a separator falls back to the whole string.
 */
export function readingFileName(from: string): string {
  const parts = from.split(/[\\/]/).filter((part) => part !== "");
  return parts.length > 0 ? parts[parts.length - 1] : from;
}

/**
 * The SMALL card's preview (story 16.3): the stored reading's first
 * `maxLines` lines, with ONE trailing ellipsis when the text holds more.
 * PURE, so the crop is not the DOM's only truth (the CSS clamps beside it as
 * a visual guard for a line that wraps).
 *
 * Only the FACE is cropped: the stored text is untouched, and the expanded
 * card renders every line the map holds. A trailing newline is not a line, so
 * a six-line file asks for no ellipsis; `""` previews as nothing. PROVISIONAL
 * (ADR-0003's rendering seam): the line count is a look, not a rule.
 */
export function previewText(
  text: string,
  maxLines: number = READING_PREVIEW_LINES,
): string {
  if (maxLines <= 0) return "";
  const lines = text.split(/\r?\n/);
  // The final empty piece of a trailing newline is a terminator, not a line.
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  const crop = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? `${crop}…` : crop;
}
