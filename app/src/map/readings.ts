import {
  createDirAll,
  fileMeta,
  readFileBytes,
  readTextFile,
  readTextHead,
  writeTextFile,
  type FileBytesAnswer,
  type FileMetaAnswer,
  type HeadRefusalCode,
  type TextHead,
} from "../lib/fs";
import { clipHead } from "../lib/headBounds";
import { canonicalText } from "../lib/serialize";
import {
  EXTRACT_NO_TEXT,
  PICK_UNKNOWN,
  extractPdf,
  pickKindFor,
  type PdfText,
} from "./extract";
import { pdfText } from "./pdf";
import type { PointerForm } from "./pointers";
import { GROUND_READINGS_DIR, GROUND_RECORD_FILE, mapDir } from "./records";

/**
 * The GROUND map's readings (story 16.1, made honest by story 16.2): the text
 * the person's pointed-at file opened with, kept beside the map.
 *
 *   map/readings.txt         on: <slug> | form: path | from: <path> | taken: <ISO-8601> | bytes: <n> | extract: text|pdf
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
 * absolute and left exactly as it is — there is no migration pass. STORY 16.14
 * adds `url`: a page the SIDECAR fetched once, whose text is the reading and
 * which has no path to stat (see the page section below).
 *
 * STORY 16.4 ADDS THE SECOND EXTRACTOR (ADR-0035): a pick whose NAME ends in
 * `.pdf` is read on device by pdf.js (`extract.ts` + `pdf.ts`), and its text
 * lands HERE, in the same store and under the same provisional cap as a text
 * file's. The line records WHICH extractor produced it (`extract: text|pdf`);
 * a line without the field is a text reading — it is read as `text` and is
 * NEVER rewritten on load (no migration pass). A PDF with no text layer is one
 * honest sentence and no reading at all: an empty reading is never pretended.
 * The PDF itself is never copied into the workspace; only its text is kept.
 *
 * THE CAP IS STILL PROVISIONAL: the first 64 lines or 8 KiB, whichever comes
 * first (a hypothesis, not a rule).
 *
 * STORY 16.14 ADDS THE PAGE (the spec is story 16.14): a person pastes a web
 * address and the SIDECAR fetches it once; the extracted TEXT lands in this
 * same store and under the same provisional cap, the page's bytes are never
 * copied, and a local thumbnail is kept beside the map by `media.ts`. A url
 * reading is NEVER "missing": there is no path to stat, so it is current once
 * taken (the state short-circuit below). The record keeps the URL exactly as
 * the person gave it; the card shows the host only.
 *
 * STORY 16.15 ADDS THE IMAGE AND THE VIDEO — references whose artifact is NOT
 * a reading. An image is a FILE reading (`extract: image`) drawn in place
 * through Tauri's asset protocol, so the file can go missing exactly as a text
 * file's can while no copy ever exists. A video is a `url` reading
 * (`extract: video`) whose title and local thumbnail belong to the media line
 * and which is current once that line exists. Neither carries text and neither
 * claims one: the card says what it needs instead.
 *
 * STORY 16.12 ADDS A READING WITH NO SOURCE FILE (a SELECTION): the person
 * selects text inside another card's expanded reading, names the new card, and
 * those exact bytes become the card's reading. The line stores provenance
 * (`from: card://<source-slug>`), never a path; its state is `current` by
 * construction; nothing is stat'ed, re-read or refreshed behind it; and the
 * bytes are the selection, verbatim — never trimmed, re-wrapped or normalized.
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
 * form rule for NEW picks, the `bytes` field, the `extract` field, the 64/8
 * KiB cap, the ISO timestamp and the state names.
 */

/**
 * The forms a reading line may carry. PROVISIONAL: a pick inside the workspace
 * is `path` (workspace-relative), a pick outside is `at` (absolute,
 * machine-local). STORY 16.14 adds `url`: a web page's address, kept exactly
 * as the person gave it; it is never guessed from another form, and a line
 * whose value is not an http(s) URL stays malformed.
 *
 * STORY 16.12 adds `selection`: the text the person selected OUT of another
 * card's expanded reading. It is a reading kind, never a note, and it has NO
 * SOURCE FILE — its `from` is the provenance `card://<source-slug>`, never a
 * path. A `selection` line carrying a path is refused (kept and reported, never
 * guessed into a form), because a selection can never be stale and nothing
 * behind it is ever stat'ed.
 */
export type ReadingForm = PointerForm | "selection" | "url";

export const READING_FORMS: readonly ReadingForm[] = [
  "path",
  "at",
  "selection",
  "url",
];

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

/**
 * Which extractor produced a reading (story 16.4, ADR-0035 decision 4).
 * PROVISIONAL: the names; absence on a legacy line means `text`.
 *
 * STORY 16.15 adds two kinds that carry an ARTIFACT but no reading text:
 *   image — the person pointed at a local image file. The card draws the file
 *           IN PLACE through the asset protocol; nothing is copied, nothing is
 *           read, and the reading itself waits for a model that can see.
 *   video — the person pasted a video address. The title and a LOCAL thumbnail
 *           live in `map/media.jsonl`; the transcript waits for a model that
 *           can read video. Neither kind ever pretends to have a reading.
 */
export type ReadingExtract = "text" | "pdf" | "page" | "image" | "video";

/** One reading: the source the person pointed at and when it was taken. */
export interface Reading {
  /** The ground reference's slug — the key the two files join on. */
  on: string;
  /**
   * The storage form (ADR-0017's vocabulary, story 16.2's location rule): a
   * `path` is workspace-relative, an `at` is absolute, and a `selection`
   * has no source file at all (story 16.12) — its `from` is provenance.
   */
  form: ReadingForm;
  /**
   * The value in that form, stored verbatim (a legacy absolute `path` too).
   * For a `selection` this is `card://<source-slug>` and NEVER a path.
   */
  from: string;
  /** When the head was taken, ISO-8601 (the writer's clock). */
  taken: string;
  /**
   * The file's SIZE when the head was taken (story 16.2's staleness fact).
   * Absent on a legacy line: unknown, never invented, and never rewritten on
   * load. A null/undefined `bytes` means the size comparison is skipped.
   */
  bytes?: number | null;
  /**
   * WHICH extractor produced this text (story 16.4): a text file's head, or a
   * PDF's text read on device. ABSENT on a legacy line, which means `text` —
   * and a legacy line is never rewritten to add it.
   */
  extract?: ReadingExtract;
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
  /**
   * Story 16.4's whole-file byte read, for the one PDF extractor (ADR-0035);
   * a refusal is a value, never a throw.
   */
  readFileBytes(path: string): Promise<FileBytesAnswer>;
  /**
   * Story 16.4's INJECTED extractor. The real one is pdf.js (`pdf.ts`); a test
   * passes a fake, so no test ever loads the library.
   */
  pdfText: PdfText;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const READING_IO: ReadingIo = {
  readTextFile,
  readTextHead,
  writeTextFile,
  createDirAll,
  fileMeta,
  readFileBytes,
  pdfText,
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
 * `bytes` and `extract` are OPTIONAL on read (a story-1 line has neither):
 * a missing tail is unknown size and a TEXT reading, never a guess and never a
 * rewrite. The writer emits them in this order, the reader needs that order.
 */
const READING_LINE =
  /^on: (\S+) \| form: (\S+) \| from: (.+) \| taken: (\S+?)(?: \| bytes: (\d+))?(?: \| extract: (text|pdf|page|image|video))?$/;

/** Parse one line; anything out of shape is `null` (kept and reported). */
export function parseReadingLine(line: string): Reading | null {
  const match = READING_LINE.exec(line);
  if (!match) return null;
  const [, on, form, from, taken, bytes, extract] = match;
  if (on === "" || from === "" || taken === "") return null;
  // The vocabulary is provisional: a form the app does not know yet is
  // preserved and surfaced, never guessed into `path`. A SELECTION must name a
  // card, never a path: a line that carries one is REFUSED (kept and reported),
  // so no caller can ever stat, read or re-take behind it (story 16.12).
  if (!READING_FORMS.includes(form as ReadingForm)) return null;
  if (form === "selection" && !isSelectionProvenance(from)) return null;
  // STORY 16.14: a url reading must carry a URL, never a path. It is kept
  // verbatim; the fetch's own guard refuses an address it cannot take, and
  // nothing here repairs or normalizes what the person pasted.
  if (form === "url" && !isWebUrl(from)) return null;
  const reading: Reading = {
    on,
    form: form as ReadingForm,
    from,
    taken,
  };
  if (bytes !== undefined) reading.bytes = Number(bytes);
  // Absent means TEXT (a story-1 line), and it stays absent: a load never
  // writes the field in. A hand edit that says `text` is preserved as written.
  if (extract !== undefined) reading.extract = extract as ReadingExtract;
  return reading;
}

/**
 * One reading as its canonical line (no trailing newline). `bytes` and
 * `extract` are written only when known: a legacy line is left without one
 * until the person's own take or refresh stamps it.
 */
export function serializeReadingLine(reading: Reading): string {
  const size =
    reading.bytes === null || reading.bytes === undefined
      ? ""
      : ` | bytes: ${reading.bytes}`;
  const extract =
    reading.extract === undefined ? "" : ` | extract: ${reading.extract}`;
  return `on: ${reading.on} | form: ${reading.form} | from: ${reading.from} | taken: ${reading.taken}${size}${extract}`;
}

/**
 * The extractor a reading was produced by (story 16.4): a line without the
 * field is a TEXT reading — that absence is the legacy rule, not a guess.
 */
export function readingExtract(reading: Reading): ReadingExtract {
  return reading.extract ?? "text";
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

/* ------------------------------------------------------------------------- *
 * STORY 16.12 — A SELECTION IS A READING WITH NO SOURCE FILE.
 *
 * `from` is provenance, not a location: `card://<source-slug>`. Nothing behind
 * a selection is ever stat'ed, read or re-taken, so a selection line that
 * carries a path is refused at the parser (kept and reported like any other
 * malformed line) rather than half-read as a file.
 * ------------------------------------------------------------------------- */

/** The provenance prefix a selection's `from` carries (PROVISIONAL). */
export const SELECTION_PREFIX = "card://";

/** The one provenance string a selection stores. */
export function selectionProvenance(sourceSlug: string): string {
  return SELECTION_PREFIX + sourceSlug;
}

/**
 * Is this `from` a selection's provenance? A slug is one path-free token, so
 * a PATH (POSIX, Windows drive, UNC, a relative one) can never pass — and that
 * is exactly the refusal the parser needs.
 */
export function isSelectionProvenance(from: string): boolean {
  if (!from.startsWith(SELECTION_PREFIX)) return false;
  const slug = from.slice(SELECTION_PREFIX.length);
  return slug !== "" && !/[\\/\s]/.test(slug);
}

/** The source card's slug a selection names, or null (a file reading). */
export function selectionSourceSlug(reading: Reading): string | null {
  if (reading.form !== "selection") return null;
  return isSelectionProvenance(reading.from)
    ? reading.from.slice(SELECTION_PREFIX.length)
    : null;
}

/**
 * ONE selection reading, built from the source card's slug (story 16.12). No
 * `bytes` and no `extract`: nothing behind it can change, so there is no size
 * to compare and no extractor to record. PURE — the caller writes the text and
 * the line, in the house order.
 */
export function selectionReading(
  on: string,
  sourceSlug: string,
  taken: string,
): Reading {
  return {
    on,
    form: "selection",
    from: selectionProvenance(sourceSlug),
    taken,
  };
}

/** The one sentence a blank selection name answers (PROVISIONAL wording). */
export const SELECTION_NAME_REFUSAL = "name it first.";

/** The one sentence an empty selection answers (PROVISIONAL wording). */
export const SELECTION_EMPTY_REFUSAL = "select some text first.";

/**
 * The creation's ONE refusal rule, PURE: a blank name (the person's word is the
 * name, and nothing is created before they confirm it) and an empty selection
 * write nothing. The caller runs this BEFORE the queue, so a refusal never
 * reaches a file.
 */
export function selectionRefusal(name: string, text: string): string | null {
  if (name.trim() === "") return SELECTION_NAME_REFUSAL;
  if (text === "") return SELECTION_EMPTY_REFUSAL;
  return null;
}

/** How many of the selection's first words propose its name (PROVISIONAL). */
export const SELECTION_NAME_WORDS = 6;

/**
 * The name the affordance PROPOSES for a selection: its first few words,
 * whitespace collapsed (the NAME only — the bytes written are never touched),
 * cropped with one ellipsis when more words follow. The person edits or
 * replaces it; only their confirm writes anything. PURE.
 */
export function proposeSelectionName(
  text: string,
  maxWords: number = SELECTION_NAME_WORDS,
): string {
  if (maxWords <= 0) return "";
  const words = text.split(/\s+/).filter((word) => word !== "");
  if (words.length === 0) return "";
  const crop = words.slice(0, maxWords).join(" ");
  return words.length > maxWords ? crop + "…" : crop;
}

/**
 * Store one selection's bytes VERBATIM (story 16.12): the text file first, no
 * cap, no trim, no re-wrap and no normalization — the record file IS the
 * excerpt and nothing else. The caller writes the line last (the house order).
 */
export async function storeSelectionText(
  workspacePath: string,
  on: string,
  text: string,
  io: ReadingIo = READING_IO,
): Promise<void> {
  await io.createDirAll(readingsDir(workspacePath));
  await io.writeTextFile(readingTextPath(workspacePath, on), text);
}

/**
 * STORY 16.13 — RESTORE one reading's text EXACTLY: the bytes the delete read
 * into memory before it unlinked the file go back verbatim, with no cap, no
 * trim and no extractor run. This is the one path that writes a reading text
 * without a read; the caller is putting back what was there, not taking it.
 */
export async function restoreReadingText(
  workspacePath: string,
  on: string,
  text: string,
  io: ReadingIo = READING_IO,
): Promise<void> {
  await io.createDirAll(readingsDir(workspacePath));
  await io.writeTextFile(readingTextPath(workspacePath, on), text);
}

/**
 * The ABSOLUTE path a reading's file lives at, for a stat or a re-read. A
 * `path` is joined to the workspace; a LEGACY absolute `path` value is used
 * as it stands (story 1 wrote absolute paths under `path`, and the no-
 * migration rule means it must be read as written); an `at` is absolute.
 * NEVER for a `selection`: it has no source file, and its callers skip it.
 */
export function readingAbsolutePath(
  workspacePath: string,
  reading: Reading,
): string {
  if (reading.form === "at") return reading.from;
  if (isAbsolutePath(reading.from)) return reading.from;
  return `${workspacePath}/${reading.from}`;
}

/* ------------------------------------------------------------------------- *
 * STORY 16.14 — A WEB PAGE IS A REFERENCE (the page form).
 *
 * The record stores the URL EXACTLY as the person gave it. The card face shows
 * only the HOST: the full address stays a record, where a person can see it in
 * the reference's own surface, but the map itself does not turn the plane into
 * a list of links. Nothing here fetches, parses or repairs an address — the
 * sidecar's one guard decides whether a page can be taken.
 * ------------------------------------------------------------------------- */

/**
 * Is this a URL a page reading may name? `http(s)` only, parsed rather than
 * pattern-matched. The stricter remote-or-loopback rule lives in the sidecar
 * (the process that actually reaches out); this is the RECORD's shape check,
 * so a hand-edited line naming a path is refused rather than half-read.
 */
export function isWebUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The HOST of a page reading's URL — the card's quiet provenance. A hostname
 * only (no scheme, path, query or fragment); an unparsable value falls back to
 * the string as written, because a record that got onto disk is shown rather
 * than silently emptied.
 */
export function pageHost(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

/**
 * Does this reading have a FILE behind it (a stat-able source)? A selection
 * and a page do not: their text is the map's own copy and neither can go stale.
 * PURE, so the card's verbs and the pull's guard read one rule.
 */
export function isFileReading(reading: Reading): boolean {
  return reading.form === "path" || reading.form === "at";
}

/**
 * ONE page reading, built from the sidecar's extract (story 16.14). The URL is
 * stored VERBATIM — never normalized, trimmed or repaired — and the line
 * records `extract: page` so the app knows which extractor produced the text.
 * PURE: the caller writes the text, the line and the media record, in the
 * house order.
 */
export function pageReading(
  on: string,
  url: string,
  taken: string,
): Reading {
  return { on, form: "url", from: url, taken, extract: "page" };
}

/**
 * The page's extracted text, cut by the reading's provisional cap (64 lines /
 * 8 KiB). PURE and shared with a PDF's own cap rule: the sidecar's text cap is
 * a transport bound, while this is the reading's bound.
 */
export function cappedReadingText(text: string): string {
  return clipHead(text, READING_MAX_LINES, READING_MAX_BYTES).head;
}

/**
 * Store one reading's text VERBATIM (already extracted and capped), the text
 * first and its line last — the house order. The page's text is the map's own
 * copy: nothing behind it is ever stat'ed or re-read.
 */
export async function storeReadingText(
  workspacePath: string,
  on: string,
  text: string,
  io: ReadingIo = READING_IO,
): Promise<void> {
  await io.createDirAll(readingsDir(workspacePath));
  await io.writeTextFile(readingTextPath(workspacePath, on), text);
}

/* ------------------------------------------------------------------------- *
 * STORY 16.15 — AN IMAGE OR A VIDEO IS A REFERENCE, AND STILL NOT A READING.
 *
 * Both kinds carry an ARTIFACT and no text:
 *   - an image is a FILE reading (`form: path`/`at`, `extract: image`): the
 *     person's own file, drawn in place through the asset protocol. Nothing is
 *     copied, so nothing can go stale as a copy can — but the file can be
 *     MOVED or DELETED, and the ordinary metadata state says so.
 *   - a video is a `url` reading (`extract: video`): its title and its LOCAL
 *     thumbnail are the media line's, exactly as a page's are.
 *
 * Neither ever gets a reading text, and neither is an error: the card says
 * what it needs (a model that can see / read video) in the reading's slot.
 * ------------------------------------------------------------------------- */

/** The one line an image card says instead of a reading (PROVISIONAL). */
export const IMAGE_NEEDS_SENTENCE = "this needs a model that can read images.";

/** The one line a video card says instead of a transcript (PROVISIONAL). */
export const VIDEO_NEEDS_SENTENCE =
  "the transcript needs a model that can read video.";

/**
 * The "needs a model" line for a reading kind, or null for a kind that carries
 * text. PURE, so the card's sentence is not the JSX's only truth.
 */
export function readingNeedsLine(reading: Reading | null): string | null {
  if (reading === null) return null;
  switch (readingExtract(reading)) {
    case "image":
      return IMAGE_NEEDS_SENTENCE;
    case "video":
      return VIDEO_NEEDS_SENTENCE;
    default:
      return null;
  }
}

/** The one sentence an image refresh answers (PROVISIONAL wording). */
export const IMAGE_REFRESH_REFUSAL =
  "an image is shown from its own file; there is nothing to re-read.";

/** The one sentence an image pull answers (PROVISIONAL wording). */
export const IMAGE_PULL_REFUSAL = "an image has no text to read more of.";

/**
 * ONE video reading, built from the sidecar's oEmbed read (story 16.15). The
 * address is stored VERBATIM, the reading records `extract: video`, and there
 * is no text: the title and the local thumbnail are the media line's. PURE:
 * the caller writes the media line, the reading line and the ground line.
 */
export function videoReading(on: string, url: string, taken: string): Reading {
  return { on, form: "url", from: url, taken, extract: "video" };
}

/**
 * Take ONE image reading (story 16.15): stat the pick, keep its form/value and
 * its size, and write NO text at all. The image itself is never copied — the
 * card renders the file where it is — so this function only records the
 * pointing, and a pick that is absent or not a file is refused with one
 * sentence before anything is written. PURE apart from the metadata bridge.
 */
export async function takeImageReading(
  workspacePath: string,
  on: string,
  picked: string,
  io: ReadingIo = READING_IO,
  taken: string = new Date().toISOString(),
): Promise<TakeReadingResult> {
  const meta = await io.fileMeta(picked);
  if (meta.kind === "refused") {
    return { kind: "refused", message: READING_REFUSALS["cannot-reach"] };
  }
  if (!meta.exists) return { kind: "refused", message: READING_REFUSALS.absent };
  if (!meta.is_file) return { kind: "refused", message: READING_REFUSALS.io };
  const { form, from } = readingFormFor(workspacePath, picked);
  return {
    kind: "taken",
    reading: {
      on,
      form,
      from,
      taken,
      bytes: meta.len,
      extract: "image",
    },
    // NO TEXT: an image's reading is its file, and the card draws it in place.
    text: "",
  };
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
  mediaPresent: boolean | null = null,
): ReadingState {
  if (reading === null) return "unread";
  // STORY 16.12: a selection has NO source file, so it can never be stale. Its
  // state is `current` by construction — the map's own excerpt is the source —
  // and the SHORT-CIRCUIT comes before any metadata answer: no caller ever
  // stats a selection (an empty answer is simply ignored here).
  if (reading.form === "selection") return "current";
  // STORY 16.14: a PAGE has NO PATH — its text was copied beside the map by
  // the sidecar, so there is nothing on this machine to stat and no way for it
  // to go stale. It is current once taken, before any metadata answer (which
  // is empty for it and simply ignored here).
  //
  // STORY 16.15: a VIDEO is the same kind of record, with ONE difference — the
  // artifact the card actually shows is its media line (the title and the
  // local thumbnail), not a reading text. So "taken" means that line exists:
  // a video reading line without one has nothing to show and is `unread`,
  // never a claim. `mediaPresent === null` is "not told" (a caller that only
  // knows about the reading), and keeps the page's rule.
  if (reading.form === "url") {
    if (readingExtract(reading) !== "video") return "current";
    if (mediaPresent === null) return "current";
    return mediaPresent ? "current" : "unread";
  }
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
export function readingStateWord(
  state: ReadingState,
  reading: Reading | null = null,
): string | null {
  // STORY 16.15: an IMAGE keeps no copy, so its state words must never say
  // "this is the copy kept" — the card draws the person's own file, and a file
  // that is gone simply leaves nothing to draw.
  const image = reading !== null && readingExtract(reading) === "image";
  const video = reading !== null && readingExtract(reading) === "video";
  switch (state) {
    case "current":
      return null;
    case "changed":
      // STORY 16.13 (shortlist item 10): the state now says WHAT THE WORDS ON
      // SCREEN ARE. The reading is the copy taken when the card was added, so
      // a file that moved or changed has not emptied the card.
      if (image) return "the image's file has changed";
      return "the file has changed since this reading; this is the copy kept when it was added";
    case "missing":
      if (image) return "the image's file is not there";
      return "the file is gone; this is the copy kept when it was added";
    case "unreadable":
      if (image) return "the image cannot be read";
      return "the file cannot be read";
    case "unread":
      if (video) return "no title or thumbnail was kept for this video";
      return "no reading taken yet";
  }
}

/**
 * STORY 16.13 (shortlist item 11) — a REFUSED REFRESH says what still stands:
 * the old reading is untouched, so the person is told the words on screen are
 * still theirs rather than left with a bare error. PROVISIONAL wording.
 */
export const REFRESH_UNCHANGED =
  "the file could not be read; the reading you have is unchanged.";

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

/**
 * The one sentence for a rejected head read. The pull (story 16.8) reuses it
 * so a refusal is always the SAME vocabulary a take or a refresh answers with;
 * nothing new is invented there.
 */
export function readingRefusalMessage(error: unknown): string {
  return READING_REFUSALS[refusalCodeOf(error) ?? "io"];
}

/** What one successful read produced: the text to store and the file's size. */
interface TakenText {
  text: string;
  /** The source file's size when it was taken, or null when unknown. */
  bytes: number | null;
}

/** One take's read: the text, or the one sentence the person sees. */
type TakeRead =
  | { ok: true; taken: TakenText }
  | { ok: false; message: string };

/** Read one path's head under the provisional cap, or answer its sentence. */
async function readHeadOrRefuse(
  path: string,
  io: ReadingIo,
): Promise<TakeRead> {
  let head: TextHead;
  try {
    head = await io.readTextHead(path, READING_MAX_LINES, READING_MAX_BYTES);
  } catch (error) {
    return { ok: false, message: readingRefusalMessage(error) };
  }
  if (!head.exists) return { ok: false, message: READING_REFUSALS.absent };
  return { ok: true, taken: { text: head.head, bytes: head.size } };
}

/**
 * Read a PDF's text ON DEVICE (story 16.4, ADR-0035), or answer its sentence.
 *
 * The extractor's own outcomes map to the map's vocabulary here: a `none` (a
 * page set with no text layer) is the refusal sentence "that PDF has no text to
 * read.", and it writes NOTHING — the reference is never created half-formed.
 * The size is the DOCUMENT's size, taken with the metadata stat the map already
 * owns, so a PDF reading can go stale the same honest way a text reading does.
 */
async function readPdfOrRefuse(
  path: string,
  io: ReadingIo,
): Promise<TakeRead> {
  const outcome = await extractPdf(path, io.pdfText, {
    readFileBytes: io.readFileBytes,
  });
  if (outcome.kind === "refused") {
    return { ok: false, message: outcome.message };
  }
  if (outcome.kind === "none") {
    return { ok: false, message: EXTRACT_NO_TEXT };
  }
  const meta = await io.fileMeta(path);
  const bytes = meta.kind === "facts" && meta.is_file ? meta.len : null;
  return { ok: true, taken: { text: outcome.text, bytes } };
}

/**
 * Store one reading's text: the text file first (VERBATIM for a text file — it
 * is the opening lines as read, not a record the writer tidies), and only
 * after a successful read. The caller writes the LINE last, so a crash can
 * leave an orphan text but never a reading line whose text is absent.
 *
 * A PDF's text passes the SAME provisional cap (64 lines / 8 KiB) before it is
 * stored: the extractor returns the whole document's text, and the cap is the
 * reading's, not the format's (ADR-0035 decision 5).
 */
async function storeReading(
  workspacePath: string,
  on: string,
  form: ReadingForm,
  from: string,
  taken: TakenText,
  extract: ReadingExtract | undefined,
  when: string,
  io: ReadingIo,
): Promise<TakeReadingResult> {
  // STORY 16.14: a PAGE's extracted text passes the SAME provisional cap as a
  // PDF's; the sidecar already refuses an empty page, so this can never write
  // a blank reading.
  const text =
    extract === "pdf" || extract === "page"
      ? clipHead(taken.text, READING_MAX_LINES, READING_MAX_BYTES).head
      : taken.text;
  await io.createDirAll(readingsDir(workspacePath));
  await io.writeTextFile(readingTextPath(workspacePath, on), text);
  const reading: Reading = { on, form, from, taken: when, bytes: taken.bytes };
  // Absent stays absent: a legacy line (or a refresh of one) keeps no field.
  if (extract !== undefined) reading.extract = extract;
  return { kind: "taken", reading, text };
}

/**
 * Take ONE reading, BY THE PICK'S KIND (story 16.4): a pick whose name says
 * `.pdf` goes through the PDF extractor, everything else through the head read
 * as before. The pick's NAME decides — the bytes are never sniffed (ADR-0035
 * decision 4).
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
  // STORY 16.15: the pick's NAME first, and an unknown type refuses here —
  // before a byte is read. An image takes the stat-only path (no text, no
  // copy); a PDF and a text file keep the extractors they already had.
  const kind = pickKindFor(picked);
  if (kind === null) return { kind: "refused", message: PICK_UNKNOWN };
  if (kind === "image") {
    return await takeImageReading(workspacePath, on, picked, io, taken);
  }
  const extract: "text" | "pdf" = kind;
  const read =
    extract === "pdf"
      ? await readPdfOrRefuse(picked, io)
      : await readHeadOrRefuse(picked, io);
  if (!read.ok) return { kind: "refused", message: read.message };
  const { form, from } = readingFormFor(workspacePath, picked);
  return await storeReading(
    workspacePath,
    on,
    form,
    from,
    read.taken,
    extract,
    taken,
    io,
  );
}

/**
 * REFRESH one reading (story 16.2 decision 4): re-read the same file under the
 * same cap and stamp a new `taken`/`bytes`. The form and value are KEPT
 * exactly as the line has them — the file did not move, and a legacy absolute
 * `path` is not migrated by a refresh. So is the EXTRACTOR (story 16.4): a PDF
 * reading is re-extracted, a text reading re-headed, and a line without the
 * field stays without it.
 *
 * The text file is rewritten first; the caller rewrites the line. A refusal
 * keeps the old reading and answers one sentence (nothing is written).
 */
export async function refreshReading(
  workspacePath: string,
  reading: Reading,
  io: ReadingIo = READING_IO,
  taken: string = new Date().toISOString(),
): Promise<TakeReadingResult> {
  // STORY 16.15: an image has no reading to re-take. The card draws the file
  // where it is, so a press only has to say that plainly — one sentence and
  // nothing written.
  if (readingExtract(reading) === "image") {
    return { kind: "refused", message: IMAGE_REFRESH_REFUSAL };
  }
  const path = readingAbsolutePath(workspacePath, reading);
  const read =
    readingExtract(reading) === "pdf"
      ? await readPdfOrRefuse(path, io)
      : await readHeadOrRefuse(path, io);
  if (!read.ok) return { kind: "refused", message: read.message };
  return await storeReading(
    workspacePath,
    reading.on,
    reading.form,
    reading.from,
    read.taken,
    // The line's own field, verbatim: a refresh is a re-read, not a migration.
    reading.extract,
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
