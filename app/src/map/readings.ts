import {
  createDirAll,
  readTextFile,
  readTextHead,
  writeTextFile,
  type HeadRefusalCode,
  type TextHead,
} from "../lib/fs";
import { canonicalText } from "../lib/serialize";
import type { PointerForm } from "./pointers";
import { GROUND_READINGS_DIR, GROUND_RECORD_FILE, mapDir } from "./records";

/**
 * The GROUND map's readings (story 16.1): the text the person's pointed-at
 * file opened with, kept beside the map.
 *
 *   map/readings.txt         on: <slug> | form: path | from: <absolute path> | taken: <ISO-8601>
 *   map/readings/<slug>.md   the text as read, bytes verbatim
 *
 * A reading is NOT a Pointer (ADR-0017): a pointer is a reach the person keeps
 * as an authored handle, while a reading is what came back from one file and
 * was kept beside the map. The handle here is still the person's pick — story
 * 1 takes an absolute path from the OS file dialog, never a sniffed or
 * repaired one — and the text is the head the bridge read, byte for byte.
 *
 * THE CAP IS PROVISIONAL: the first 64 lines or 8 KiB, whichever comes first.
 * Story 2 makes the cap and staleness honest; this story only reads once, at
 * add time, and writes the head verbatim. Nothing here refreshes, watches or
 * re-reads a file: the map folder is the whole truth, and a later story's
 * question is how to say the file has moved on.
 *
 * A REFUSAL IS A SENTENCE, AND NOTHING IS CREATED HALF-FORMED: an absent file,
 * a binary file or an unreadable one refuses the whole add (the born-in-
 * `readings` file is only written after a successful head read), and the
 * bubble shows the bridge's honest code as one quiet sentence. Malformed
 * lines in `readings.txt` are preserved and reported, never silently
 * dropped (ADR-0009's honesty surfaces).
 *
 * PROVISIONAL (the story's record shapes, before an ADR settles them): the
 * `readings.txt` name, the line shape, the strict key order, the `path`
 * form (the only form story 1 writes; the record shape names it so a later
 * story can add forms without moving the file), the 64/8 KiB cap and the
 * ISO timestamp. Renaming is story 2's business, not this one.
 */

/** The only form story 1 writes and reads: a file path. PROVISIONAL. */
export const READING_FORM: PointerForm = "path";

/** Story 1's cap: the first 64 lines... (PROVISIONAL, not a rule). */
export const READING_MAX_LINES = 64;

/** ...or 8 KiB, whichever comes first (PROVISIONAL, not a rule). */
export const READING_MAX_BYTES = 8 * 1024;

/** One reading: the file the person picked and when its head was taken. */
export interface Reading {
  /** The ground reference's slug — the key the two files join on. */
  on: string;
  /** The authored form the person picked (only `path` in story 1). */
  form: PointerForm;
  /** The path exactly as the file dialog returned it (absolute). */
  from: string;
  /** When the head was taken, ISO-8601 (the writer's clock). */
  taken: string;
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
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const READING_IO: ReadingIo = {
  readTextFile,
  readTextHead,
  writeTextFile,
  createDirAll,
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
 * the ` | form: ... ` head and ` | taken: ...` tail are structural.
 */
const READING_LINE =
  /^on: (\S+) \| form: (\S+) \| from: (.+) \| taken: (\S+)$/;

/** Parse one line; anything out of shape is `null` (kept and reported). */
export function parseReadingLine(line: string): Reading | null {
  const match = READING_LINE.exec(line);
  if (!match) return null;
  const [, on, form, from, taken] = match;
  if (on === "" || from === "" || taken === "") return null;
  // The vocabulary is provisional: a form the app does not know yet is
  // preserved and surfaced, never guessed into `path`.
  if (form !== READING_FORM) return null;
  return { on, form, from, taken };
}

/** One reading as its canonical line (no trailing newline). */
export function serializeReadingLine(reading: Reading): string {
  return `on: ${reading.on} | form: ${reading.form} | from: ${reading.from} | taken: ${reading.taken}`;
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
 * Take ONE reading: ask the bridge for the head (bounded by story 1's
 * provisional cap), refuse with a sentence if it cannot be read, otherwise
 * write the head's text beside the map under the reference's slug.
 *
 * The text file is written VERBATIM (no canonicalText): it is the file's
 * opening lines as read, not a record the writer tidies. A refusal writes
 * nothing at all, so an add can never leave a reference with an empty body.
 * `taken` is injectable so a test's bytes are deterministic.
 */
export async function takeReading(
  workspacePath: string,
  on: string,
  from: string,
  io: ReadingIo = READING_IO,
  taken: string = new Date().toISOString(),
): Promise<TakeReadingResult> {
  let head: TextHead;
  try {
    head = await io.readTextHead(from, READING_MAX_LINES, READING_MAX_BYTES);
  } catch (error) {
    const code = refusalCodeOf(error);
    return {
      kind: "refused",
      message: READING_REFUSALS[code ?? "io"],
    };
  }
  if (!head.exists) {
    return { kind: "refused", message: READING_REFUSALS.absent };
  }
  await io.createDirAll(readingsDir(workspacePath));
  await io.writeTextFile(readingTextPath(workspacePath, on), head.head);
  return {
    kind: "taken",
    reading: { on, form: READING_FORM, from, taken },
    text: head.head,
  };
}

/**
 * Add or replace one reading, keyed by its slug (story 1 creates only new
 * references, so this is normally an append; the replace keeps a hand-edited
 * duplicate from becoming two lines in the app's own state).
 */
export function withReading(
  readings: readonly Reading[],
  reading: Reading,
): Reading[] {
  const next = readings.filter((existing) => existing.on !== reading.on);
  return [...next, reading];
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
 * file is simply absent from the answer (story 2 makes the absence honest);
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
