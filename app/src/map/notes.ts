import {
  createDirAll,
  listDir,
  readTextFile,
  removeFile,
  writeTextFile,
} from "../lib/fs";
import { NOTE_PREVIEW_DEFAULT } from "../lib/readingPreference";
import { mapDir } from "./records";

/**
 * The GROUND map's NOTES (story 16.6): the person's own words, one plain-text
 * file per card, beside the reading it belongs to.
 *
 *   map/notes/<slug>.md   the note, bytes exactly as the person wrote them
 *
 * WHY A FILE AND NOT A FIELD IN `ground.txt`: a note is multi-line authored
 * text that may contain `|` and newlines. A line-record would need escaping,
 * which would make the note unreadable and un-editable by hand; a file is
 * byte-exact, hand-editable and diffable. The reading module's idiom, one text
 * file, is the same one `map/readings/<slug>.md` already uses — and like the
 * reading, it is keyed by the ground reference's slug.
 *
 * THE SPLIT THIS PROTECTS (the story's reason to exist): a READING is a
 * byte-exact copy of a file the person picked; a NOTE is what the person wrote.
 * They share a slug and nothing else. Nothing in this module reads or writes
 * `readings.txt`, `readings/<slug>.md`, `ground.txt`, the links or any
 * concept record — the note is its own file, and a later mention parser must
 * never be able to corrupt a reading through it.
 *
 * THE FILE IS THE WHOLE TRUTH: no note file = no note. Saving empty text
 * REMOVES the file (the note is gone, never an empty note), and an empty file
 * left by hand reads as no note for the same reason. Writes go through the
 * app's per-file queue (`useGround`), never a whole-folder rewrite.
 *
 * AN ORPHAN IS REPORTED, NEVER ADOPTED (ADR-0009's honesty surfaces): a note
 * file whose slug has no ground reference is kept exactly where it is and
 * named in the ground notices group. The loader never invents a card from it,
 * never deletes it, and `useGround.setNote` refuses to write for a card the
 * map does not carry, so the app cannot manufacture one of its own.
 *
 * PROVISIONAL (the story's record shape, before an ADR settles it): the
 * `map/notes/` folder, the per-slug `<slug>.md` name, the byte cap and the
 * crop length. The note's typography and the edit interaction are provisional
 * with them (ADR-0003's rendering seam).
 */

/** The notes' folder, beside `map/readings.txt`: `<workspace>/map/notes`. */
export function notesDir(workspacePath: string): string {
  return `${mapDir(workspacePath)}/notes`;
}

/** One note's file: `<workspace>/map/notes/<slug>.md`. */
export function notePath(workspacePath: string, slug: string): string {
  return `${notesDir(workspacePath)}/${slug}.md`;
}

/**
 * The note's byte cap (PROVISIONAL, not a rule): 16 KiB of UTF-8. A note is
 * the person's own words, not a document copy — the reading's 64-line/8 KiB cap
 * is the other family's hypothesis, and this one stays separate so neither can
 * silently borrow the other's limit. A longer note refuses as ONE sentence and
 * writes nothing.
 */
export const NOTE_MAX_BYTES = 16 * 1024;

/**
 * How many lines of the note a SMALL card shows when the person has not stated
 * a threshold (story 17 moves the DEFAULT to lib/readingPreference.ts, with the
 * preference's bounds). PROVISIONAL, ADR-0003's rendering seam: the person's
 * words are visible without opening the card, and only the FACE is cropped —
 * the stored file keeps every line.
 */
export const NOTE_PREVIEW_LINES = NOTE_PREVIEW_DEFAULT;

/** The one sentence a refused note answers. */
export const NOTE_TOO_LONG = "that note is too long to keep.";

/** The one sentence a note with no slug answers (the caller is confused). */
export const NOTE_NO_CARD = "there is no card to hold that note.";

/** The bridges this family needs; the app passes lib/fs, a test passes a fake. */
export interface NoteIo {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
  createDirAll(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  removeFile(path: string): Promise<void>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const NOTE_IO: NoteIo = {
  readTextFile,
  writeTextFile,
  createDirAll,
  listDir,
  removeFile,
};

/** What one save did: the stored text, a removal, or one refusal sentence. */
export type NoteSave =
  | { kind: "saved"; text: string }
  | { kind: "removed" }
  | { kind: "refused"; message: string };

/** The note's length in UTF-8 bytes (the cap counts bytes, not characters). */
export function noteByteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

/** One note's text, byte-exactly, or null when there is no note. */
export async function loadNote(
  workspacePath: string,
  slug: string,
  io: NoteIo = NOTE_IO,
): Promise<string | null> {
  const text = await io.readTextFile(notePath(workspacePath, slug));
  // An empty file is NO note, never an empty note: the rule is "no note file =
  // no note", and a hand-left empty file is the same silence.
  return text === null || text === "" ? null : text;
}

/** A read of `map/notes/`: the notes the cards can join on, and the orphans. */
export interface LoadedNotes {
  /** Note text keyed by the slug of a card the map carries. */
  notes: Record<string, string>;
  /** Slugs whose note file exists but whose card is gone — reported, kept. */
  orphans: string[];
}

/**
 * Load every note that belongs to a card, plus the ORPHAN slugs. ONE folder
 * listing, then one read per card that actually has a file — the same "one
 * read per record" budget as the readings. An orphan is never read (nothing
 * may adopt it) and never deleted; the notices group only needs its slug.
 *
 * The listing tolerates a missing folder (the bridge answers []), so a fresh
 * workspace with no notes is not an error. Names that are not `.md` are left
 * alone: a stray file in the folder is not a note.
 */
export async function loadNotes(
  workspacePath: string,
  slugs: readonly string[],
  io: NoteIo = NOTE_IO,
): Promise<LoadedNotes> {
  const names = await io.listDir(notesDir(workspacePath));
  const onMap = new Set(slugs);
  const notes: Record<string, string> = {};
  const orphans: string[] = [];
  await Promise.all(
    names
      .filter((name) => name.endsWith(".md") && name.length > ".md".length)
      .map(async (name) => {
        const slug = name.slice(0, -".md".length);
        if (!onMap.has(slug)) {
          orphans.push(slug);
          return;
        }
        const text = await io.readTextFile(notePath(workspacePath, slug));
        if (text !== null && text !== "") notes[slug] = text;
      }),
  );
  orphans.sort();
  return { notes, orphans };
}

/**
 * SAVE one note, or REMOVE it when the person emptied it. The text is written
 * VERBATIM (`fs.write_text_file` writes the string; no canonical newline, no
 * trimming): the note is byte-exact so a hand edit and the app agree.
 *
 * An over-cap note refuses with ONE sentence and writes NOTHING (not even the
 * folder); an empty/whitespace-only note removes the file (a note of only
 * spaces is silence to every reader). The slug guard keeps the app from
 * manufacturing an orphan: a note is only ever written for a card the caller
 * has already found (the reference check lives in `useGround`).
 */
export async function saveNote(
  workspacePath: string,
  slug: string,
  text: string,
  io: NoteIo = NOTE_IO,
): Promise<NoteSave> {
  if (slug.trim() === "") {
    return { kind: "refused", message: NOTE_NO_CARD };
  }
  if (text.trim() === "") {
    await removeNote(workspacePath, slug, io);
    return { kind: "removed" };
  }
  if (noteByteLength(text) > NOTE_MAX_BYTES) {
    return { kind: "refused", message: NOTE_TOO_LONG };
  }
  await io.createDirAll(notesDir(workspacePath));
  await io.writeTextFile(notePath(workspacePath, slug), text);
  return { kind: "saved", text };
}

/**
 * STORY 16.13 — RESTORE one note's file EXACTLY: the bytes the delete read into
 * memory go back verbatim. This is deliberately NOT `saveNote`: a note of only
 * spaces must come back as itself (saveNote would call it silence and remove
 * it), and a restored note was already accepted when the person wrote it.
 * PROVISIONAL with the note's record shape; the caller only restores a note it
 * just removed.
 */
export async function restoreNote(
  workspacePath: string,
  slug: string,
  text: string,
  io: NoteIo = NOTE_IO,
): Promise<void> {
  await io.createDirAll(notesDir(workspacePath));
  await io.writeTextFile(notePath(workspacePath, slug), text);
}

/**
 * REMOVE one note's file. A missing file is a quiet no-op (the bridge answers
 * Ok for NotFound), so deleting a card that never had a note stays one pass.
 * A refused unlink throws: the caller answers its one sentence, exactly like
 * the delete's reading text.
 */
export async function removeNote(
  workspacePath: string,
  slug: string,
  io: NoteIo = NOTE_IO,
): Promise<void> {
  await io.removeFile(notePath(workspacePath, slug));
}
