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
/* ------------------------------------------------------------------------- *
 * STORY 16.15 — WHAT THE PICK'S NAME SAYS IT IS.
 *
 * A reference may now be a text file, a PDF, an IMAGE or a VIDEO. The file
 * dialog hands over a path and nothing else, and the story's rule is that the
 * app never sniffs bytes to guess a format: the NAME decides which extractor
 * runs. So this table IS the app's vocabulary of file kinds — extension only,
 * lower-cased, no content inspection.
 *
 * An image is rendered in place (no copy), so its extension list is limited to
 * the raster kinds a webview draws: an SVG could reference the network from
 * inside the "local" picture, which would make the card's offline render a
 * lie (the same reason a page's thumbnail refuses SVG).
 *
 * PROVISIONAL (the story's record shapes): the extension lists, and the rule
 * that a file with NO extension is read as text — the bridge still refuses one
 * whose bytes are not text, with its own one sentence. Any OTHER unknown
 * extension refuses here, before a byte is read.
 * ------------------------------------------------------------------------- */

/** What a pick's name says it is (story 16.15). */
export type PickKind = "text" | "pdf" | "image";

/** The one sentence an unknown file type answers (PROVISIONAL wording). */
export const PICK_UNKNOWN = "that file is not text, a PDF or an image.";

/** The raster image types this app will render in place (no SVG: it could fetch). */
const IMAGE_EXTENSIONS: Readonly<Record<string, true>> = {
  png: true,
  jpg: true,
  jpeg: true,
  gif: true,
  webp: true,
  avif: true,
  bmp: true,
};

/**
 * The text kinds a pick may name. A \`.txt\` file that is really binary still
 * fails through the bridge's own read, which is the one place that knows.
 */
const TEXT_EXTENSIONS: Readonly<Record<string, true>> = {
  txt: true,
  text: true,
  md: true,
  markdown: true,
  mdx: true,
  rst: true,
  org: true,
  adoc: true,
  asciidoc: true,
  log: true,
  csv: true,
  tsv: true,
  json: true,
  jsonl: true,
  yaml: true,
  yml: true,
  toml: true,
  ini: true,
  tex: true,
  xml: true,
  html: true,
  htm: true,
};

/** A path's lower-cased extension without the dot, or "" when it has none. */
function extensionOf(path: string): string {
  const name = path.split(/[\\/]/).filter((part) => part !== "").pop() ?? "";
  const dot = name.lastIndexOf(".");
  // A leading dot is a hidden file's name, not an extension (".gitignore").
  if (dot <= 0) return "";
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Which extractor this pick asks for (story 16.15), or null when the name is a
 * type this app does not know. PURE, and the ONLY classification: nothing here
 * opens the file.
 */
export function pickKindFor(path: string): PickKind | null {
  if (extractKindFor(path) === "pdf") return "pdf";
  const extension = extensionOf(path);
  // No extension is no CLAIM: the head read (and its own not-text refusal) is
  // the honest default for a file that never said what it is.
  if (extension === "") return "text";
  if (IMAGE_EXTENSIONS[extension] === true) return "image";
  if (TEXT_EXTENSIONS[extension] === true) return "text";
  return null;
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
