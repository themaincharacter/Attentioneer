import type { PdfText } from "./extract";

/**
 * THE ONE IMPORT OF PDF.JS (story 16.4, ADR-0035). Everything else in the app
 * sees only the `PdfText` seam in `extract.ts`.
 *
 * WHY A LIBRARY AT ALL: a PDF is the first real document this app reads, and
 * pdf.js is the format's reference implementation. It runs inside the webview,
 * in the library's own worker — the app gets no second process, no native
 * build and no service.
 *
 * NOTHING IS FETCHED AT RUNTIME (ADR-0035 decision 1). Vite emits the
 * library's worker beside the app's own bundle (`?url` below), so the worker
 * is a local asset of the running app; the standard-font data is not requested
 * (text extraction does not need it) and no network call is made anywhere.
 *
 * TEXT ONLY: this module produces the document's text and destroys the
 * document. No rendering, no page images, no thumbnails, no OCR — a page with
 * no text layer answers `null` (`none`), and OCR is a later story.
 *
 * THE VERSION IS PINNED EXACTLY (no caret, no tilde): an upgrade is a
 * deliberate change with a re-run of the fixture test, never a float.
 *
 * The library is loaded lazily so a bun test that never reads a PDF never
 * loads it, and the Node test path uses pdf.js's own in-process worker (there
 * is no DOM asset to point at).
 */

/** The library's worker asset, as Vite emits it (a local file, never a URL). */
async function workerSrc(): Promise<string | null> {
  // A test process has no DOM and no app bundle: let pdf.js pick its own
  // in-process worker rather than pointing at an asset that is not there.
  if (typeof document === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  const asset = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  return asset.default;
}

/**
 * Read one PDF's text. `null` means the document has no text layer; a throw
 * means the bytes are not a document this library can open (encrypted,
 * malformed). The caller (`extract.ts`) turns both into its own answers.
 *
 * Page texts are joined in READING ORDER with the line breaks the library
 * reports (`hasEOL`), because the whole point of the reading is that the
 * person can scroll the text that was taken.
 */
export const pdfText: PdfText = async (bytes) => {
  const pdfjs = await import("pdfjs-dist");
  const src = await workerSrc();
  if (src !== null) pdfjs.GlobalWorkerOptions.workerSrc = src;

  const task = pdfjs.getDocument({
    data: bytes,
    // Nothing leaves the webview: no worker fetch and no system fonts.
    useWorkerFetch: false,
    useSystemFonts: false,
  });
  const doc = await task.promise;
  try {
    const lines: string[] = [];
    for (let pageNumber = 1; pageNumber <= doc.numPages; pageNumber += 1) {
      const page = await doc.getPage(pageNumber);
      const content = await page.getTextContent();
      let line = "";
      for (const item of content.items) {
        // Marked-content markers carry no text; only the text items do.
        if (!("str" in item)) continue;
        line += item.str;
        if (item.hasEOL) {
          lines.push(line);
          line = "";
        }
      }
      if (line !== "") lines.push(line);
    }
    const text = lines.join("\n");
    return text.trim() === "" ? null : text;
  } finally {
    // The document's claim on the bytes ends here; nothing is kept.
    await task.destroy();
  }
};
