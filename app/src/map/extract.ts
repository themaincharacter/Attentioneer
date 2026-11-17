import {
  readFileBytes,
  type BytesRefusalCode,
  type FileBytesAnswer,
} from "../lib/fs";

/**
 * THE EXTRACTOR SEAM (story 16.4, ADR-0035): one PDF in, the text it carries
 * out — or an honest "no text", or one sentence.
 *
 * A PDF's reading is produced HERE and nowhere else. The module takes the
 * pdf.js binding as an INJECTED `PdfText` so a bun test can drive the whole
 * pipeline with a fake and never load the library; the real binding lives in
 * `pdf.ts` (the app's one import of pdf.js) and is bound by `readings.ts`.
 *
 * THE KINDS (ADR-0035 decision 3):
 *   text   — text was found; the caller stores it exactly as a text file's
 *            reading (the same 64-line / 8 KiB cap, PROVISIONAL).
 *   none   — the document HAS no text layer (a scan). A first-class answer,
 *            never an empty reading: the caller refuses with one sentence and
 *            writes nothing.
 *   refused — the read or the parse failed (too large, absent, not a file,
 *            encrypted, malformed). One quiet sentence, nothing written.
 *
 * THE EXTRACTOR IS CHOSEN BY THE PERSON'S PICK, NOT BY THE BYTES (ADR-0035
 * decision 4): the pick's NAME decides (a `.pdf` suffix). Nothing here sniffs
 * a file's first bytes to guess its format — a misnamed file fails honestly
 * through the parser, which is the one place that knows.
 *
 * PROVISIONAL: the sentences and the size cap.
 */

/**
 * The one document extractor this app binds: bytes in, the document's text
 * out — `null` when the document has no text layer. It THROWS when the bytes
 * are not a document it can read (encrypted, malformed); the seam turns that
 * into a refusal. Tests pass a fake; `pdf.ts` is the real one.
 */
export type PdfText = (bytes: Uint8Array) => Promise<string | null>;

/** What one extraction said. Never an exception: the card shows a sentence. */
export type ExtractOutcome =
  | { kind: "text"; text: string }
  | { kind: "none" }
  | { kind: "refused"; message: string };

/** The bridge the extractor needs; the app passes lib/fs, a test a fake. */
export interface ExtractIo {
  readFileBytes(path: string): Promise<FileBytesAnswer>;
}

/** The real bridge, bound once so the module stays importable in bun tests. */
export const EXTRACT_IO: ExtractIo = { readFileBytes };

/**
 * The one quiet sentence per byte-refusal code (PROVISIONAL wording). The
 * person pointed at a file; the sentence says what happened to the pointing.
 */
export const EXTRACT_REFUSALS: Readonly<Record<BytesRefusalCode, string>> = {
  "too-large": "that file is too large to read.",
  "not-a-file": "that file is not a document.",
  "cannot-reach": "cannot reach that file.",
  escaped: "that file is outside the workspace.",
  io: "cannot read that file.",
};

/**
 * The document has pages but no text layer — a scan (PROVISIONAL wording).
 * The story's rule: say so, and never create an empty reading in its place.
 */
export const EXTRACT_NO_TEXT = "that PDF has no text to read.";

/** The bytes were a document the parser could not open (PROVISIONAL wording). */
export const EXTRACT_UNREADABLE = "that PDF cannot be read.";

/**
 * Which extractor a pick asks for (ADR-0035 decision 4). The person's pick is
 * the choice; the NAME is only how the app knows which one they made. A PDF
 * that is really something else fails in the parser, honestly, rather than
 * being guessed at here.
 */
export function extractKindFor(path: string): "text" | "pdf" {
  return /\.pdf$/i.test(path) ? "pdf" : "text";
}

/**
 * Extract one PDF's text: read the bytes, hand them to the injected extractor,
 * and answer text / none / refused. This NEVER throws and NEVER writes — the
 * caller stores the text beside the map (or writes nothing at all).
 */
export async function extractPdf(
  path: string,
  pdfText: PdfText,
  io: ExtractIo = EXTRACT_IO,
): Promise<ExtractOutcome> {
  const answer = await io.readFileBytes(path);
  if (answer.kind === "refused") {
    return { kind: "refused", message: EXTRACT_REFUSALS[answer.code] };
  }
  let text: string | null;
  try {
    text = await pdfText(answer.bytes);
  } catch {
    // Encrypted, malformed, unsupported: one sentence, never a silent empty.
    return { kind: "refused", message: EXTRACT_UNREADABLE };
  }
  if (text === null || text.trim() === "") return { kind: "none" };
  return { kind: "text", text };
}
