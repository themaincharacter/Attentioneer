import {
  createDirAll,
  fileMeta,
  listDirEntries,
  readFileBytes,
  readTextFile,
  readTextHead,
  writeTextFile,
  type DirEntry,
  type FileBytesAnswer,
  type FileMetaAnswer,
  type HeadRefusalCode,
  type TextHead,
} from "../lib/fs";
import { clipHead } from "../lib/headBounds";
import { utf8ByteLength } from "../lib/textBytes";
import { READING_PREVIEW_DEFAULT } from "../lib/readingPreference";
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
import type { SessionEnding } from "./sessions";
import { GROUND_READINGS_DIR, GROUND_RECORD_FILE, mapDir } from "./records";

/**
 * The GROUND map's readings (story 16.1, made honest by story 16.2): the text
 * the person's pointed-at file opened with, kept beside the map.
 *
 *   map/readings.txt         on: <slug> | form: path | from: <path> | taken: <ISO-8601> | bytes: <n> | extract: text|pdf|page|image|video|listing
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
 * STORY 16.12 ADDS A READING WITH NO SOURCE FILE (a SELECTION): exact bytes
 * copied from another card become this card's reading. The line stores
 * provenance (`from: card://<source-slug>`), never a path; its state is
 * `current` by construction; nothing is stat'ed, re-read or refreshed behind
 * it; and the bytes are the selection, verbatim — never trimmed, re-wrapped or
 * normalized.
 *
 * STORY 18 KEEPS THE FORM AND REMOVES THE VERB. The user corrected 16.12's
 * intent: selecting text in a reading should open the ASK widget (a later
 * story), not mint a ground card — so the affordance, its proposed name and its
 * refusal sentences are gone. The FORM stays first-class: cards made before
 * this story, the artifact card (ADR-0037) and the run-result card are all
 * selections, and every parser, renderer, packet and pull must keep reading
 * one. THE FORM IS NOT THE FEATURE.
 *
 * REFRESH IS THE ONLY RE-READ (story 16.2 decision 4): one affordance, pressed
 * by the person, re-takes the head under the same cap and stamps a new
 * `taken`/`bytes`. Nothing here watches, polls or re-reads on open; a
 * refused refresh keeps the old reading and answers one sentence.
 *
 * THE PROJECT CARD (PROVISIONAL) adds `folder`: a reference whose pointer is a
 * FOLDER elsewhere on this machine — a code repo the workspace does not own.
 * The line carries the absolute path; an UNTOUCHED card has no extract and no
 * reading text, and its reading slot says plainly what it is and what is not
 * claimed (the bare line still parses forever).
 *
 * STORY 20.1 — THE PROJECT CARD OPENS, BY THE PERSON'S GESTURE ONLY. Expanding
 * a folder card with no kept listing takes ONE bounded reading of the place: a
 * top-level listing with directories marked, then the README's head VERBATIM
 * under a quiet heading. The taken line records `bytes` (the kept text's own
 * size) and `extract: listing`; the text lands in the same store a file's does.
 * NOTHING is interpreted — no summary, no "what this project is" — because the
 * handle is structure, never meaning (ADR-0039). NOTHING is watched, polled or
 * held: no handle stays open, and the state stays stat-only (there is no source
 * file to compare and no metadata claim to make). A REFRESH re-takes the same
 * two pieces and answers `REFRESH_SAME` when the bytes match, writing nothing;
 * the listing NEVER reaches MAP.md (it may be shared, so no project filenames
 * leak) — the mirror names the folder and its state, as it does for a file.
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
 * KiB cap, the ISO timestamp and the state names; STORY 20.1 adds the
 * `listing` extract, the entry cap, the folder reading's shape and the
 * "unchanged" sentence.
 */

/**
 * The forms a reading line may carry. PROVISIONAL: a pick inside the workspace
 * is `path` (workspace-relative), a pick outside is `at` (absolute,
 * machine-local). STORY 16.14 adds `url`: a web page's address, kept exactly
 * as the person gave it; it is never guessed from another form, and a line
 * whose value is not an http(s) URL stays malformed.
 *
 * STORY 16.12 adds `selection`: text copied OUT of another card's reading. It
 * is a reading kind, never a note, and it has NO SOURCE FILE — its `from` is
 * the provenance `card://<source-slug>`, never a path. A `selection` line
 * carrying a path is refused (kept and reported, never guessed into a form),
 * because a selection can never be stale and nothing behind it is ever
 * stat'ed. STORY 18 keeps this form while removing the concept-map verb that
 * created one; the form is a record shape, not the affordance.
 *
 * STORY 17.11 (ADR-0037's first artifact) adds `distilled`: a COMPLETED ask
 * turn's reply, COPIED verbatim into a card of its own. It is the same
 * no-source-file provenance shape as a selection — `from: card://<ask-slug>`
 * — but it says what made the copy: a RULE, standing in until the curator
 * exists (17.12). The reply stays where it was; this line never claims a model
 * read it. PROVISIONAL: the form's name and the `from` shape, until 17.12
 * settles the curator's provenance.
 *
 * PROVISIONAL — `folder` adds THE PROJECT CARD: a reference whose pointer is a
 * folder elsewhere on this machine (a repo the workspace does not own). Its
 * `from` is an ABSOLUTE path, because a folder outside the workspace has no
 * portable form. TWO SHAPES ARE VALID: an untouched card carries NO `bytes`
 * and NO `extract` (the bare line, kept forever), while STORY 20.1's kept
 * listing carries the text's own `bytes` and `extract: listing`. Its state
 * stays stat-only either way: there is no source file to compare.
 */
export type ReadingForm =
  | PointerForm
  | "selection"
  | "url"
  | "distilled"
  | "folder";

export const READING_FORMS: readonly ReadingForm[] = [
  "path",
  "at",
  "selection",
  "url",
  "distilled",
  "folder",
];

/** Story 1's cap: the first 64 lines... (PROVISIONAL, not a rule). */
export const READING_MAX_LINES = 64;

/** ...or 8 KiB, whichever comes first (PROVISIONAL, not a rule). */
export const READING_MAX_BYTES = 8 * 1024;

/**
 * STORY 20.1 — HOW MANY TOP-LEVEL ENTRIES A FOLDER READING KEEPS: 200
 * (PROVISIONAL, not a rule). The listing is read whole and then CUT as whole
 * entries — an entry is never halved and no "more" is invented about the rest
 * (the card's fold and the person's refresh are the only moves). The README's
 * head carries the reading cap above, because it is a text head like any other.
 */
export const LISTING_MAX_ENTRIES = 200;

/**
 * How many lines of the stored reading a SMALL card shows (story 16.3) when
 * the person has not stated a threshold (story 17). The DEFAULT now lives in
 * lib/readingPreference.ts, with the preference's bounds; this name stays the
 * module's own answer so the card has a face even with no config.
 * PROVISIONAL (ADR-0003's rendering seam): the crop is a look, not a rule —
 * the stored text keeps every line it took; only the card's face is cut.
 */
export const READING_PREVIEW_LINES = READING_PREVIEW_DEFAULT;

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
export type ReadingExtract =
  | "text"
  | "pdf"
  | "page"
  | "image"
  | "video"
  // STORY 20.1 (PROVISIONAL): the project card's ONE kept reading — a bounded
  // top-level listing plus the README's head, taken when the person expanded
  // the card. It is text like any other and carries no artifact of its own.
  | "listing";

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
   * STORY 20.1 (PROVISIONAL): a FOLDER reading's `bytes` is the KEPT TEXT's
   * own size — there is no single source file — and the folder branch of the
   * state rule never compares it.
   */
  bytes?: number | null;
  /**
   * WHICH extractor produced this text (story 16.4): a text file's head, or a
   * PDF's text read on device. ABSENT on a legacy line, which means `text` —
   * and a legacy line is never rewritten to add it.
   */
  extract?: ReadingExtract;
  /**
   * STORY 17.12 — WHO DISTILLED THIS CARD (ADR-0037 decisions 4 and 9): the
   * MANAGER model that wrote the brief and distilled the reply, and the TASK
   * model whose reply it read. Both are the settings rows' MODEL NAMES (the
   * id when a row has none) — a provenance fact, never a key, an endpoint or
   * a word of the artifact.
   * ABSENT on a rule card (17.11): a rule copy names no model, and its line
   * keeps exactly the bytes it always had.
   *
   * They ride as two optional tail fields on the existing line — no new record
   * family, no Rust, and an old line without them still parses as a rule card.
   * PROVISIONAL: the field names and their position in the line.
   */
  manager?: string;
  task?: string;
  /**
   * STORY 22.4 — THE ENDING THE ARTIFACT CAME FROM (PROVISIONAL). A curator may
   * now read a run that did NOT finish, and the card it makes says so on its
   * face. The field appears ONLY on a distilled reading and ONLY for a partial
   * run: absence means the run completed, which keeps every existing line and
   * every completed card byte-identical. No new record family and no new
   * transcript kind — one optional tail field, like the author pair above.
   * PROVISIONAL: the field name and its position at the line's tail.
   */
  ending?: SessionEnding;
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
  /^on: (\S+) \| form: (\S+) \| from: (.+) \| taken: (\S+?)(?: \| bytes: (\d+))?(?: \| extract: (text|pdf|page|image|video|listing))?(?: \| manager: ([^|]+?))?(?: \| task: ([^|]+?))?(?: \| ending: (completed|stopped|failed|timed-out))?$/;

/** Parse one line; anything out of shape is `null` (kept and reported). */
export function parseReadingLine(line: string): Reading | null {
  const match = READING_LINE.exec(line);
  if (!match) return null;
  const [, on, form, from, taken, bytes, extract, manager, task, ending] = match;
  if (on === "" || from === "" || taken === "") return null;
  // The vocabulary is provisional: a form the app does not know yet is
  // preserved and surfaced, never guessed into `path`. A SELECTION must name a
  // card, never a path: a line that carries one is REFUSED (kept and reported),
  // so no caller can ever stat, read or re-take behind it (story 16.12).
  if (!READING_FORMS.includes(form as ReadingForm)) return null;
  if (form === "selection" && !isSelectionProvenance(from)) return null;
  // STORY 17.11: a distilled reading names the ASK CARD it copied, never a
  // path, so a line carrying one is refused (kept and reported) exactly as a
  // selection's is. Nothing behind it is ever stat'ed or re-taken.
  if (form === "distilled" && !isSelectionProvenance(from)) return null;
  // STORY 16.14: a url reading must carry a URL, never a path. It is kept
  // verbatim; the fetch's own guard refuses an address it cannot take, and
  // nothing here repairs or normalizes what the person pasted.
  if (form === "url" && !isWebUrl(from)) return null;
  // PROVISIONAL: a folder card points at a place on THIS machine, so its value
  // must be an absolute path. A relative one is refused (kept and reported)
  // rather than half-read as a workspace path — a folder card has nothing in
  // the workspace to point at.
  if (form === "folder" && !isAbsolutePath(from)) return null;
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
  // STORY 20.1 (PROVISIONAL): a LISTING belongs to a folder card and to nothing
  // else. A file line carrying it is refused (kept and reported), because no
  // file take could ever have produced one; the bare folder line stays valid.
  if (extract === "listing" && form !== "folder") return null;
  // STORY 17.12: the two authors ride TOGETHER or not at all. One without the
  // other is an out-of-shape line, kept and reported like any other — never a
  // half-attributed card. Only a distilled reading may carry them.
  if (manager !== undefined || task !== undefined) {
    if (manager === undefined || task === undefined) return null;
    if (form !== "distilled") return null;
    const who = manager.trim();
    const of = task.trim();
    if (who === "" || of === "") return null;
    reading.manager = who;
    reading.task = of;
  }
  // STORY 22.4 (PROVISIONAL): the ending rides only on a CURATOR's card. A
  // rule copy has no run to name, and a completed run's card says nothing
  // (absence IS completed), so an old line parses exactly as it did.
  if (ending !== undefined) {
    if (form !== "distilled") return null;
    if (manager === undefined || task === undefined) return null;
    if (ending !== "stopped" && ending !== "failed" && ending !== "timed-out") {
      return null;
    }
    reading.ending = ending;
  }
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
  // STORY 17.12: the authors append only on a card a curator made; a rule
  // card's line stays byte-identical to the one 17.11 wrote.
  const authors =
    reading.manager === undefined || reading.task === undefined
      ? ""
      : ` | manager: ${reading.manager} | task: ${reading.task}`;
  // STORY 22.4 (PROVISIONAL): a partial's ending is the line's last field, so
  // a completed card's line keeps exactly the bytes it always had.
  const ending =
    reading.ending === undefined ? "" : ` | ending: ${reading.ending}`;
  return `on: ${reading.on} | form: ${reading.form} | from: ${reading.from} | taken: ${reading.taken}${size}${extract}${authors}${ending}`;
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

/**
 * PROVISIONAL — ONE project card's BARE reading: a FOLDER elsewhere, stored as
 * an absolute path with NOTHING read, copied, sized or extracted. PURE, so a
 * test can assert the line without a disk; this is what the card's ADD writes,
 * because nothing is read until the person expands the card (story 20.1). A
 * folder is never a `path` — the workspace cannot own it.
 */
export function folderReading(
  on: string,
  folder: string,
  taken: string,
): Reading {
  return { on, form: "folder", from: folder, taken };
}

/**
 * STORY 20.1 (PROVISIONAL) — THE QUIET HEADING ABOVE THE README'S HEAD. It
 * names what the lines below ARE, in the map's lowercase voice; it is not a
 * summary and it claims nothing about them.
 */
export const FOLDER_README_HEADING = "readme:";

/**
 * STORY 20.1 (PROVISIONAL) — WHICH TOP-LEVEL ENTRY IS "THE README", in this
 * order, by name and case-insensitively: `readme.md`, `readme.txt`, then a
 * bare `readme`. A directory never counts. A folder with none simply keeps
 * its listing — no heading, nothing invented.
 */
const README_NAMES: readonly string[] = ["readme.md", "readme.txt", "readme"];

/** The README's top-level entry, or null when the folder has none. */
export function readmeEntryOf(
  entries: readonly DirEntry[],
): DirEntry | null {
  for (const wanted of README_NAMES) {
    const found = entries.find(
      (entry) => !entry.isDir && entry.name.toLowerCase() === wanted,
    );
    if (found !== undefined) return found;
  }
  return null;
}

/**
 * One entry's line: its verbatim name, with a trailing slash for a folder.
 * Exported for STORY 20.2's explorer, which marks a folder the SAME way the
 * kept listing does — one marking rule, so the two faces can never disagree.
 */
export function folderEntryLine(entry: DirEntry): string {
  return entry.isDir ? entry.name + "/" : entry.name;
}

/**
 * STORY 20.1 (PROVISIONAL) — THE FOLDER READING'S TEXT, PURE: the bounded
 * top-level listing (one line per entry, directories marked with a trailing
 * slash, names verbatim) and then the README's head VERBATIM under a quiet
 * heading. NOTHING IS INTERPRETED: no summary, no count, no "what this project
 * is" — the text is what the folder's top level says and the words the README
 * opens with, byte for byte (ADR-0039: the handle is structure, never meaning).
 *
 * The listing is CUT AS WHOLE ENTRIES at `LISTING_MAX_ENTRIES` (the over-cap
 * entries simply drop; no partial name is ever kept); the README head arrives
 * already bounded by `READING_MAX_LINES`/`READING_MAX_BYTES` because the
 * caller reads it with the head reader, so no word is cut here. Entries are
 * ordered here AGAIN, by name as this language compares them, so the pure
 * answer never depends on a caller's order (the bridge sorts by its own byte
 * order; the two agree for the provisional ASCII-named rule, and this function
 * is the one shape the test pins). A folder with no README keeps its listing
 * alone. No entries and no README is the empty string: an empty reading is
 * refused by the caller, never invented.
 */
export function folderReadingText(
  entries: readonly DirEntry[],
  readmeHead: string | null,
): string {
  const listing = [...entries]
    .sort((left, right) =>
      left.name < right.name ? -1 : left.name > right.name ? 1 : 0,
    )
    .slice(0, LISTING_MAX_ENTRIES)
    .map(folderEntryLine)
    .join("\n");
  if (readmeHead === null || readmeHead === "") return listing;
  const head = FOLDER_README_HEADING + "\n" + readmeHead;
  return listing === "" ? head : listing + "\n\n" + head;
}

/**
 * STORY 20.1 (PROVISIONAL) — DOES THIS FOLDER CARD KEEP A READING? True only
 * when the line says `extract: listing`, which the take writes LAST, after the
 * text file landed (the house order). A bare folder line is an untouched card
 * and stays valid forever: no copy is claimed for it.
 */
export function folderListingKept(reading: Reading | null): boolean {
  return (
    reading !== null &&
    reading.form === "folder" &&
    reading.extract === "listing"
  );
}

/**
 * STORY 20.1 (PROVISIONAL) — THE KEPT COPY'S PROVENANCE LINE, for the card's
 * footer: "the listing kept when it was read" and ONE quiet date (the ISO
 * date of `taken`), so the card says WHEN without a clock or a badge. A line
 * whose `taken` is not an ISO date says the sentence alone — no date is
 * invented. Null for a card that keeps no reading.
 */
export function folderKeptProvenance(reading: Reading): string | null {
  if (!folderListingKept(reading)) return null;
  const date = reading.taken.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? "the listing kept when it was read · " + date
    : "the listing kept when it was read";
}

/**
 * Join one entry's name onto its folder, in the folder's convention (the
 * separator follows the root). Exported for STORY 20.2's explorer so a
 * descended level and an opened file are the SAME path the kept listing's
 * take would have read — one joining rule, not two.
 */
export function joinFolderPath(folder: string, name: string): string {
  const separator = folder.includes("\\") && !folder.includes("/") ? "\\" : "/";
  return folder.replace(/[\\/]+$/, "") + separator + name;
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
 * STORY 17.11 — the source ASK card a distilled reading copied, or null. The
 * same `card://` provenance as a selection, kept in its own accessor so a
 * caller that must distinguish the two never guesses from a shared function.
 */
export function distilledSourceSlug(reading: Reading): string | null {
  if (reading.form !== "distilled") return null;
  return isSelectionProvenance(reading.from)
    ? reading.from.slice(SELECTION_PREFIX.length)
    : null;
}

/**
 * The source card a COPY reading names, whether a selection or a distilled
 * one, or null for a reading that came from a file or a page. The footer, the
 * "what this is" line and the mirror all ask this ONE question; the FORM is
 * what tells a rule's copy from a person's selection.
 */
export function cardProvenanceSourceSlug(reading: Reading): string | null {
  return selectionSourceSlug(reading) ?? distilledSourceSlug(reading);
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

/**
 * STORY 17.11 — ONE distilled reading, built from the ask card's slug: the
 * reply was COPIED out of that card by a RULE (ADR-0037's first artifact).
 * No `bytes` and no `extract`: nothing behind it can change, so there is no
 * size to compare and no extractor to record. PURE — the caller writes the
 * text and the line, in the house order. PROVISIONAL until 17.12's curator
 * takes over this form.
 */
export function distilledReading(
  on: string,
  askSlug: string,
  taken: string,
  /**
   * STORY 17.12 — THE TWO MODELS, when a CURATOR made this card: the manager
   * that distilled and the task whose reply it read. Absent keeps 17.11's rule
   * card exactly as it was ("a rule's copy"), so the two are one form with one
   * optional provenance pair, never two record families.
   */
  authors?: { manager: string; task: string },
  /**
   * STORY 22.4 — THE ENDING, when a curator read a run that did not finish
   * (PROVISIONAL). Absent keeps the completed card exactly as it was.
   */
  ending?: SessionEnding,
): Reading {
  return {
    on,
    form: "distilled",
    from: selectionProvenance(askSlug),
    taken,
    ...(authors === undefined
      ? {}
      : { manager: authors.manager, task: authors.task }),
    ...(ending === undefined ? {} : { ending }),
  };
}

/**
 * STORY 17.12 — the two models a curator card names, or null for a rule card.
 * One accessor, so the card's line, the mirror and any later reader ask the
 * same question and never differ about who made an artifact.
 */
export function distilledAuthors(
  reading: Reading,
): { manager: string; task: string } | null {
  if (reading.form !== "distilled") return null;
  if (reading.manager === undefined || reading.task === undefined) return null;
  return { manager: reading.manager, task: reading.task };
}

// STORY 18 removed the selection→card affordance, and with it this file's two
// refusal sentences and the proposed-name crop: nothing here names a card any
// more, because nothing here creates one. The form, its reading builder and its
// provenance parser stay; a selection card is still read and rendered.

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
 * STORY 17.11 — STORE ONE DISTILLED CARD'S TEXT, the reply BYTES and nothing
 * else: no cap, no trim, no re-wrap and no normalization. The rule COPIED the
 * reply; this line writes that copy. The caller writes the reading line last
 * (the house order).
 */
export async function storeDistilledText(
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
 * PROVISIONAL — does this reading have a SOURCE ON DISK to stat? A file
 * reading does; so does a folder pointer. The two questions stay apart:
 * `isFileReading` decides the card's file VERBS (refresh, re-point, read
 * more), which a folder has nothing to act on, while this decides whether the
 * load asks the bridge for metadata at all.
 */
export function isStatableReading(reading: Reading): boolean {
  return isFileReading(reading) || reading.form === "folder";
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

/**
 * PROVISIONAL — THE PROJECT CARD'S ONE SENTENCE for a card that keeps NO
 * reading: a reference, not a copy, and the workspace does not own the place.
 * No "verified", no claim about what the folder holds. STORY 20.1 DROPS
 * "reads nothing from it": once the person expands the card a listing IS kept,
 * and the sentence that says so is the provenance line's.
 */
export const PROJECT_FOLDER_SENTENCE =
  "a project folder elsewhere on this machine; this workspace does not own it.";

/**
 * STORY 20.1 (PROVISIONAL) — THE SAME CARD ONCE THE FOLDER IS GONE AND A
 * LISTING WAS KEPT: the copy on screen is still the truth about when it was
 * read, so the card says that plainly instead of claiming an empty slot.
 */
export const PROJECT_FOLDER_GONE_KEPT =
  "the project folder is not there now; this is the listing kept when it was read.";

/** PROVISIONAL — a card with NO copy and a folder that is no longer there. */
export const PROJECT_FOLDER_GONE =
  "the project folder is not there on this machine; nothing was copied from it, so nothing is left to show.";

/** PROVISIONAL — the folder exists but this machine cannot stat it. */
export const PROJECT_FOLDER_UNREACHABLE =
  "the project folder cannot be reached; nothing was copied, so nothing is left to show.";

/**
 * STORY 20.1 (PROVISIONAL) — the ONE sentence a take answers when the place is
 * not there: nothing was written, and the card keeps whatever it already had.
 */
export const FOLDER_TAKE_GONE =
  "the project folder is not there; nothing was kept.";

/** STORY 20.1 (PROVISIONAL) — the same sentence when the place cannot be listed. */
export const FOLDER_TAKE_UNREACHABLE =
  "the project folder cannot be reached; nothing was kept.";

/**
 * STORY 20.1 (PROVISIONAL) — a folder with nothing at its top level keeps no
 * reading: an empty reading is never pretended. One honest sentence, nothing
 * written, and the card stays the bare pointing it was.
 */
export const FOLDER_TAKE_EMPTY =
  "the project folder has nothing at its top level; nothing was kept.";

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
  // PROVISIONAL — a FOLDER card is a pointer, not a copy: the stat decides only
  // whether the place is still there. A folder's answer (`exists: true,
  // is_file: false`) is the shape this branch expects, so it is CURRENT and
  // never "unreadable"; no metadata field is compared because nothing was taken.
  if (reading.form === "folder") {
    if (meta === null || meta.kind === "refused") return "unreadable";
    return meta.exists ? "current" : "missing";
  }
  // STORY 16.12: a selection has NO source file, so it can never be stale. Its
  // state is `current` by construction — the map's own excerpt is the source —
  // and the SHORT-CIRCUIT comes before any metadata answer: no caller ever
  // stats a selection (an empty answer is simply ignored here).
  //
  // STORY 17.11: a distilled card is the same shape one form over — the map's
  // own copy of a completed ask's reply. Nothing is stat'ed behind it and no
  // metadata answer is ever asked for.
  if (reading.form === "selection" || reading.form === "distilled") {
    return "current";
  }
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
  const folder = reading !== null && reading.form === "folder";
  switch (state) {
    case "current":
      return null;
    case "changed":
      // A folder pointer can never be "changed": the state branch above only
      // answers current, missing or unreadable. Nothing was taken to go stale.
      if (folder) return null;
      // STORY 16.13 (shortlist item 10): the state now says WHAT THE WORDS ON
      // SCREEN ARE. The reading is the copy taken when the card was added, so
      // a file that moved or changed has not emptied the card.
      if (image) return "the image's file has changed";
      return "the file has changed since this reading; this is the copy kept when it was added";
    case "missing":
      // STORY 20.1: a folder that is gone with a listing kept says what the
      // words on screen ARE; with no copy it keeps the bare word (the reading
      // slot carries the longer no-copy sentence).
      if (folder) {
        return folderListingKept(reading)
          ? PROJECT_FOLDER_GONE_KEPT
          : "the folder is not there";
      }
      if (image) return "the image's file is not there";
      return "the file is gone; this is the copy kept when it was added";
    case "unreadable":
      if (folder) return "the folder cannot be reached";
      if (image) return "the image cannot be read";
      return "the file cannot be read";
    case "unread":
      if (folder) return "no folder chosen yet";
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

/**
 * STORY 20.1 (PROVISIONAL) — the ONE sentence a FOLDER refresh answers when the
 * two readings are the same bytes: nothing was written at all (no text file, no
 * line, no history line, no mirror), so the person is told the copy still
 * stands. A DIFFERENT fact from `REFRESH_UNCHANGED` above, which is a REFUSED
 * read — the two sentences are never swapped for one another.
 */
export const REFRESH_SAME = "nothing has changed since this reading.";

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

/* ------------------------------------------------------------------------- *
 * STORY 20.1 — THE PROJECT CARD'S KEPT READING (PROVISIONAL).
 *
 * Expanding a folder card with no kept listing takes ONE bounded reading of
 * the place; the README's head and the top-level listing are verbatim words,
 * never an interpretation. Refresh is the ONLY re-take, the person's press:
 * identical bytes write nothing and say so.
 * ------------------------------------------------------------------------- */

/**
 * STORY 20.1 (PROVISIONAL) — THE PROJECT CARD'S ONE EXTRA BRIDGE: the folder's
 * own top-level listing. It rides as its own interface (extending a file
 * reading's) so every existing `ReadingIo` fake — and the file take/refresh
 * paths — stay exactly as they are: only a folder take ever asks for a listing.
 */
export interface FolderReadingIo extends ReadingIo {
  listDirEntries(path: string): Promise<DirEntry[]>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const FOLDER_READING_IO: FolderReadingIo = {
  ...READING_IO,
  listDirEntries,
};

/** What one folder take or refresh produced: the reading and its text. */
export type FolderReadingResult =
  | { kind: "taken"; reading: Reading; text: string }
  /** STORY 20.1: the refresh found the same bytes; NOTHING was written. */
  | { kind: "same"; message: string }
  | { kind: "refused"; message: string };

/** One folder read's answer: the kept text and its own size, or the sentence. */
type FolderRead =
  | { ok: true; text: string; bytes: number }
  | { ok: false; message: string };

/**
 * Read ONE folder's kept text under the caps, or answer the one sentence.
 *
 * The stat comes FIRST so a MISSING place is never mistaken for an EMPTY one:
 * the listing bridge answers an empty list for a folder that is not there,
 * exactly as the map's other listings do, and "nothing at its top level" must
 * never be invented for "not there". Then the listing, then the README's head
 * through the SAME head reader and the SAME caps a text file's reading uses.
 * A README whose head refuses (binary, unreadable) is simply no head — the
 * listing is still the truthful reading, and nothing is invented to fill it.
 */
async function readFolderText(
  folder: string,
  io: FolderReadingIo,
): Promise<FolderRead> {
  const meta = await io.fileMeta(folder);
  if (meta.kind === "refused") {
    return { ok: false, message: FOLDER_TAKE_UNREACHABLE };
  }
  if (!meta.exists) return { ok: false, message: FOLDER_TAKE_GONE };
  if (meta.is_file) return { ok: false, message: FOLDER_TAKE_UNREACHABLE };
  let entries: DirEntry[];
  try {
    entries = await io.listDirEntries(folder);
  } catch {
    return { ok: false, message: FOLDER_TAKE_UNREACHABLE };
  }
  const readme = readmeEntryOf(entries);
  let readmeHead: string | null = null;
  if (readme !== null) {
    try {
      const head = await io.readTextHead(
        joinFolderPath(folder, readme.name),
        READING_MAX_LINES,
        READING_MAX_BYTES,
      );
      readmeHead = head.exists ? head.head : null;
    } catch {
      readmeHead = null;
    }
  }
  const text = folderReadingText(entries, readmeHead);
  if (text === "") return { ok: false, message: FOLDER_TAKE_EMPTY };
  return { ok: true, text, bytes: utf8ByteLength(text) };
}

/**
 * STORY 20.1 (PROVISIONAL) — TAKE ONE FOLDER READING, the expand gesture's read:
 * the bounded top-level listing and the README's head, VERBATIM, stored in the
 * same text file a file card's reading uses. The line records the kept text's
 * own `bytes` and `extract: listing`, and it is written LAST — the house
 * order, text first. A refusal writes NOTHING and answers one sentence.
 */
export async function takeFolderReading(
  workspacePath: string,
  on: string,
  folder: string,
  io: FolderReadingIo = FOLDER_READING_IO,
  taken: string = new Date().toISOString(),
): Promise<FolderReadingResult> {
  const read = await readFolderText(folder, io);
  if (!read.ok) return { kind: "refused", message: read.message };
  return await storeReading(
    workspacePath,
    on,
    "folder",
    folder,
    { text: read.text, bytes: read.bytes },
    "listing",
    taken,
    io,
  );
}

/**
 * STORY 20.1 (PROVISIONAL) — REFRESH A FOLDER READING: re-take the same two
 * pieces and compare the kept text with what came back, BY BYTES. Identical
 * bytes mean the copy still stands: `same`, and NOTHING is written (no text
 * file, no line — the caller writes neither). Different bytes rewrite the text
 * first and answer the new line, exactly as a file refresh does. A refusal
 * keeps the old copy and answers one sentence.
 */
export async function refreshFolderReading(
  workspacePath: string,
  reading: Reading,
  io: FolderReadingIo = FOLDER_READING_IO,
  taken: string = new Date().toISOString(),
): Promise<FolderReadingResult> {
  if (reading.form !== "folder") {
    return { kind: "refused", message: READING_REFUSALS["cannot-reach"] };
  }
  const read = await readFolderText(reading.from, io);
  if (!read.ok) return { kind: "refused", message: read.message };
  // The kept text is the map's own copy; a text file that is gone (or that
  // this machine cannot read) is simply "no copy to compare", never a refusal.
  let before: string | null = null;
  try {
    before = await io.readTextFile(readingTextPath(workspacePath, reading.on));
  } catch {
    before = null;
  }
  if (before === read.text) return { kind: "same", message: REFRESH_SAME };
  return await storeReading(
    workspacePath,
    reading.on,
    "folder",
    reading.from,
    { text: read.text, bytes: read.bytes },
    "listing",
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

/**
 * STORY 17 (shortlist items 7–9) — DOES THE CROP HAVE MORE BEHIND IT?
 * True when the stored text is longer than the stated number of lines, i.e.
 * when the small face is actually folding something away. The card uses it to
 * decide whether to draw its fade and its "more" verb at all: a card that fits
 * its threshold has no cut to apologise for. PURE and beside `previewText`, so
 * the mark and the crop can never disagree about where the fold is.
 */
export function previewOverflows(
  text: string,
  maxLines: number = READING_PREVIEW_LINES,
): boolean {
  if (maxLines <= 0) return text !== "";
  const lines = text.split(/\r?\n/);
  // The final empty piece of a trailing newline is a terminator, not a line
  // (the same rule `previewText` reads).
  if (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.length > maxLines;
}
