import {
  readFileBytes,
  readTextFile,
  readTextHead,
  type FileBytesAnswer,
  type TextHead,
} from "../lib/fs";
import { clipHead } from "../lib/headBounds";
import {
  EXTRACT_NO_TEXT,
  extractPdf,
  type PdfText,
} from "./extract";
import { pdfText } from "./pdf";
import {
  READING_REFUSALS,
  readingAbsolutePath,
  readingExtract,
  readingRefusalMessage,
  readingTextPath,
  type Reading,
} from "./readings";

/**
 * THE PULL (story 16.8): one card's source, read again for a look, under ONE
 * stated budget — and forgotten when the person closes the card.
 *
 * WHY A PULL AT ALL: a reading is a head (64 lines or 8 KiB, PROVISIONAL), and
 * a person looking at a long document sometimes wants the rest of it without
 * that look becoming a new record. This module is that look and nothing else:
 *
 *   - IT WRITES NOTHING. There is no writer in its bridge surface — no
 *     `writeTextFile`, no `removeFile`, no queue — so "a pull never lands on
 *     disk" is a property of the code, not of discipline. The text lives in
 *     the view (`useGround.pull`) until the card closes or the person dismisses it.
 *   - IT RE-STAMPS NOTHING. It does not touch `readings.txt`, the stored text,
 *     the note or the computed state word: refresh is still the only re-read
 *     that re-stamps a reading. A stale reading stays stale after a pull.
 *   - IT IS THE PERSON'S PRESS ONLY. Nothing here reads on open, watches or
 *     polls; `useGround.pull` is called by the card's one verb.
 *   - BOTH SOURCE KINDS go through their EXISTING reader: a text source re-heads
 *     through `read_text_head` with larger limits (no Rust change), and a PDF
 *     re-extracts through the same `extract.ts` seam a pick uses, with the
 *     same injected fake in tests.
 *   - REFUSALS ARE THE EXISTING SENTENCES: the reading vocabulary's (`that
 *     file is not there.`, ...) and the extractor's (`that file is too large to
 *     read.`). This module invents no new refusal word.
 *
 * THE ONE NUMBER the person ever sees is the budget, named only when it bites:
 * "the file is larger than one reading; showing the first 96 KiB". The text
 * that comes back always fits it (cut on a UTF-8 boundary by the same
 * display-side belt-and-braces as the head window).
 *
 * STORY 16.12: a SELECTION has no source file, so its pull answers with the
 * map's own stored excerpt — every byte there is, nothing more — through the
 * same budget and the same sentence vocabulary. Nothing is stat'ed, resolved
 * or re-read from a source, because there is no source to reach.
 *
 * PROVISIONAL: the 96 KiB budget (a working number, not a rule), the
 * truncation wording, and the fact that a pull does not survive closing the
 * card.
 */

/**
 * The pull's stated budget: 96 KiB of UTF-8 text per pull (PROVISIONAL, not a
 * rule — the epic's open question 2 calls byte budgets a hypothesis to test).
 * It is larger than the reading's 8 KiB head on purpose: this is the "the
 * rest of it" look, not a bigger reading.
 */
export const PULL_BUDGET_BYTES = 96 * 1024;

/**
 * The line cap a pull asks the bridge for. It is set ABOVE any count 96 KiB
 * can hold (a file of newlines alone has at most 98,304 lines), so the byte
 * budget is the only bound that can ever bite — the same provisional number
 * the story names. PROVISIONAL with the budget.
 */
export const PULL_MAX_LINES = 1_000_000;

/** How a budget is said out loud: exact KiB when it divides, bytes otherwise. */
function budgetWords(bytes: number): string {
  return bytes > 0 && bytes % 1024 === 0
    ? `${bytes / 1024} KiB`
    : `${bytes} bytes`;
}

/**
 * The ONE truncation line (PROVISIONAL wording): said when — and only when —
 * the source is larger than the budget. No percentage, no running total, no
 * second line; the number is the budget's own.
 */
export function pullTruncationLine(
  budget: number = PULL_BUDGET_BYTES,
): string {
  return `the file is larger than one reading; showing the first ${budgetWords(budget)}`;
}

/** What a pull put in view: the text and whether the budget cut it. */
export interface PulledText {
  text: string;
  truncated: boolean;
}

/**
 * THE SELECTION'S PULL (story 16.12): a selection has no source file, so the
 * map's own stored excerpt is ALL there is. This returns it — under the same
 * budget, never re-read, never re-stamped — so the ONE retrieval a packet may
 * make of a selection card answers with exactly the bytes the card holds.
 * PURE, like the budget's line: same text in, same answer out.
 */
export function pullStoredText(
  text: string,
  budget: number = PULL_BUDGET_BYTES,
): PullResult {
  const clipped = clipHead(text, PULL_MAX_LINES, budget);
  return { kind: "text", text: clipped.head, truncated: clipped.truncated };
}

/**
 * What one pull answered. A refusal is the existing sentence, a VALUE — the
 * pull never throws and never writes; the card shows the words where it stood.
 */
export type PullResult =
  | ({ kind: "text" } & PulledText)
  | { kind: "refused"; message: string };

/** The bridges a pull needs; the app passes lib/fs, a test passes a fake. */
export interface PullIo {
  readTextHead(
    path: string,
    maxLines: number,
    maxBytes: number,
  ): Promise<TextHead>;
  readFileBytes(path: string): Promise<FileBytesAnswer>;
  /** The INJECTED PDF extractor: the same seam a pick uses (story 16.4). */
  pdfText: PdfText;
  /**
   * STORY 16.12: the map's OWN record read, used only by a SELECTION's pull —
   * its stored excerpt is all there is (there is no source file to open). A
   * reader, never a writer; a fake may omit it and the real one is used.
   */
  readStoredText?(path: string): Promise<string | null>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const PULL_IO: PullIo = {
  readTextHead,
  readFileBytes,
  pdfText,
  readStoredText: readTextFile,
};

/**
 * A TEXT source's pull: the existing head read with the pull's larger limits.
 * The bridge bounds the text by `budget` bytes; the display-side clip is the
 * same belt-and-braces as the window's (an older build's bridge, a hand-edited
 * fake) so "the text fits the budget" is guaranteed here too. `truncated` is
 * the bridge's fact OR the clip's: the file said more than one reading.
 */
async function pullText(
  path: string,
  budget: number,
  io: PullIo,
): Promise<PullResult> {
  let head: TextHead;
  try {
    head = await io.readTextHead(path, PULL_MAX_LINES, budget);
  } catch (error) {
    return { kind: "refused", message: readingRefusalMessage(error) };
  }
  // A missing path is the reading vocabulary's own sentence, not a new one.
  if (!head.exists) {
    return { kind: "refused", message: READING_REFUSALS.absent };
  }
  const clipped = clipHead(head.head, PULL_MAX_LINES, budget);
  return {
    kind: "text",
    text: clipped.head,
    truncated: head.truncated || clipped.truncated,
  };
}

/**
 * A PDF source's pull: the SAME extract seam a pick uses, then the pull's
 * budget applied to the text it returns (the extractor itself has no budget —
 * the reading's cap is applied by its caller, and the pull's is applied here).
 * Nothing is written and the document is never copied.
 */
async function pullPdf(
  path: string,
  budget: number,
  io: PullIo,
): Promise<PullResult> {
  const outcome = await extractPdf(path, io.pdfText, {
    readFileBytes: io.readFileBytes,
  });
  if (outcome.kind === "refused") {
    return { kind: "refused", message: outcome.message };
  }
  if (outcome.kind === "none") {
    return { kind: "refused", message: EXTRACT_NO_TEXT };
  }
  const clipped = clipHead(outcome.text, PULL_MAX_LINES, budget);
  return {
    kind: "text",
    text: clipped.head,
    truncated: clipped.truncated,
  };
}

/**
 * Pull ONE reading's source under `budget` bytes, by the extractor the reading
 * recorded (a line without the field is TEXT, the existing legacy rule). The
 * reading itself is only ever READ here: its form and value locate the file,
 * its `extract` picks the seam.
 *
 * Never throws, never writes. PROVISIONAL: the budget's default and the
 * truncation wording above.
 */
export async function pullReading(
  workspacePath: string,
  reading: Reading,
  budget: number = PULL_BUDGET_BYTES,
  io: PullIo = PULL_IO,
): Promise<PullResult> {
  // STORY 16.12: a selection pulls the map's own excerpt, verbatim — there is
  // no source file to locate, so no path is resolved and nothing is stat'ed.
  // STORY 17.11: a distilled card is the same shape one form over (a completed
  // ask turn's reply, copied), so the pull reads the map's own bytes.
  if (reading.form === "selection" || reading.form === "distilled") {
    const readStored = io.readStoredText ?? readTextFile;
    const stored = await readStored(readingTextPath(workspacePath, reading.on));
    if (stored === null) {
      return { kind: "refused", message: READING_REFUSALS.absent };
    }
    return pullStoredText(stored, budget);
  }
  const path = readingAbsolutePath(workspacePath, reading);
  return readingExtract(reading) === "pdf"
    ? await pullPdf(path, budget, io)
    : await pullText(path, budget, io);
}
