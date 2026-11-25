import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroundLayer } from "../src/canvas/GroundLayer";
import type { FileBytesAnswer, TextHead } from "../src/lib/fs";
import {
  EXTRACT_NO_TEXT,
  EXTRACT_REFUSALS,
  EXTRACT_UNREADABLE,
  extractKindFor,
  extractPdf,
  type ExtractIo,
  type PdfText,
} from "../src/map/extract";
import { pdfText } from "../src/map/pdf";
import {
  parseReadingLine,
  parseReadings,
  readingExtract,
  readingTextPath,
  readingsPath,
  refreshReading,
  serializeReadingLine,
  serializeReadings,
  takeReading,
  READING_MAX_LINES,
  type Reading,
  type ReadingIo,
} from "../src/map/readings";

/**
 * Story 16.4 — a PDF on device with pdf.js (ADR-0035).
 *
 * The story's check is human ("pick a PDF with real text: its text appears in
 * the card and the file name beneath it; then a scanned PDF says it found no
 * text"). This file pins the rules underneath it:
 *
 *   - the extractor is chosen by the PICK'S NAME, never by sniffing bytes;
 *   - the seam is INJECTED, so every pipeline test runs with a fake and only
 *     ONE test loads pdf.js — through the real, tiny PDF fixtures;
 *   - a PDF's text is stored exactly as a text file's (same store, same
 *     provisional 64-line / 8 KiB cap), and the line records `extract: pdf`;
 *   - a document with no text layer is ONE sentence and NO reading (an empty
 *     reading is never pretended), and a refused/too-large file writes nothing;
 *   - a legacy line without `extract` reads as TEXT and is never rewritten;
 *   - the card renders the STORED text unchanged (the pages are the crop now).
 *
 * PROVISIONAL (story 16.4): the sentences, the size cap and the field's name.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
const FIXTURES = join(APP_DIR, "tests", "fixtures");
const TEXT_PDF = join(FIXTURES, "attentioneer-text.pdf");
const BLANK_PDF = join(FIXTURES, "attentioneer-blank.pdf");
/** The fixture's bytes, FRESH each time: pdf.js transfers (detaches) them. */
function textPdfBytes(): Uint8Array {
  return new Uint8Array(readFileSync(TEXT_PDF));
}
const TEXT_PDF_LENGTH = textPdfBytes().length;

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-pdf-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

const TAKEN = "2026-11-17T12:00:00.000Z";

/** The extractor seam's bridge double: only the byte read, which it logs. */
function extractIo(
  bytes: Uint8Array | null,
  code: Extract<FileBytesAnswer, { kind: "refused" }>["code"] = "io",
): ExtractIo & { reads: number } {
  const io = {
    reads: 0,
    readFileBytes: async (): Promise<FileBytesAnswer> => {
      io.reads += 1;
      return bytes === null
        ? { kind: "refused", code }
        : { kind: "bytes", bytes };
    },
  };
  return io;
}

/** A fake extractor that answers what a test says (no pdf.js anywhere). */
function fixedText(text: string | null): PdfText {
  return async () => text;
}

/** The readings' bridges on a temp workspace, plus a log of writes. */
function readingIo(
  extract: PdfText,
  log: string[] = [],
  bytesByPath: (path: string) => FileBytesAnswer = (path) => {
    try {
      return { kind: "bytes", bytes: new Uint8Array(readFileSync(path)) };
    } catch {
      return { kind: "refused", code: "cannot-reach" };
    }
  },
): ReadingIo {
  return {
    readTextFile: async (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    readTextHead: async (path, maxLines, maxBytes): Promise<TextHead> => {
      let raw: Buffer;
      try {
        raw = readFileSync(path);
      } catch {
        return {
          head: "",
          truncated: false,
          exists: false,
          size: null,
          mtime: null,
          decode: "clean",
        };
      }
      log.push("head");
      const text = raw.toString("utf8");
      return {
        head: text.split("\n").slice(0, maxLines).join("\n"),
        truncated: false,
        exists: true,
        size: raw.length,
        mtime: null,
        decode: "clean",
      };
    },
    writeTextFile: async (path, content) => {
      log.push(path.endsWith("readings.txt") ? "line" : "text");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    },
    createDirAll: async (path) => {
      mkdirSync(path, { recursive: true });
    },
    fileMeta: async (path) => {
      try {
        const stat = statSync(path);
        return {
          kind: "facts",
          exists: true,
          is_file: stat.isFile(),
          len: stat.isFile() ? stat.size : null,
          modified_ms: Math.floor(stat.mtimeMs),
        };
      } catch {
        return {
          kind: "facts",
          exists: false,
          is_file: false,
          len: null,
          modified_ms: null,
        };
      }
    },
    readFileBytes: async (path) => {
      log.push("bytes");
      return bytesByPath(path);
    },
    pdfText: extract,
  };
}

describe("the extractor is chosen by the pick's name, never by the bytes", () => {
  test("a .pdf suffix asks for the PDF extractor; everything else is text", () => {
    expect(extractKindFor("/home/k/papers/attention.pdf")).toBe("pdf");
    expect(extractKindFor("/home/k/papers/ATTENTION.PDF")).toBe("pdf");
    expect(extractKindFor("notes/attention.Pdf")).toBe("pdf");
    expect(extractKindFor("/home/k/notes.txt")).toBe("text");
    expect(extractKindFor("/home/k/notes")).toBe("text");
    expect(extractKindFor("/home/k/attention.pdf.txt")).toBe("text");
    expect(extractKindFor("/home/k/archive.pdf/notes.md")).toBe("text");
  });
});

describe("the seam: text, none or one sentence — always a value", () => {
  test("text comes out as the extractor returned it", async () => {
    const outcome = await extractPdf(
      "/papers/a.pdf",
      fixedText("first line\nsecond line"),
      extractIo(textPdfBytes()),
    );
    expect(outcome).toEqual({
      kind: "text",
      text: "first line\nsecond line",
    });
  });

  test("no text layer is NONE, never an empty text", async () => {
    for (const empty of [null, "", "   \n\t "]) {
      expect(
        await extractPdf("/scan.pdf", fixedText(empty), extractIo(textPdfBytes())),
      ).toEqual({ kind: "none" });
    }
  });

  test("a refused byte read is the vocabulary's one sentence", async () => {
    for (const code of ["too-large", "not-a-file", "cannot-reach", "escaped", "io"] as const) {
      const outcome = await extractPdf(
        "/papers/a.pdf",
        fixedText("unused"),
        extractIo(null, code),
      );
      expect(outcome).toEqual({
        kind: "refused",
        message: EXTRACT_REFUSALS[code],
      });
      // The sentence never carries the path, a count or an OS word.
      if (outcome.kind === "refused") {
        expect(outcome.message).not.toContain("/papers");
        expect(outcome.message).not.toMatch(/\d/);
      }
    }
  });

  test("an extractor that throws (encrypted, malformed) is one sentence", async () => {
    const outcome = await extractPdf(
      "/papers/locked.pdf",
      async () => {
        throw new Error("PasswordException");
      },
      extractIo(textPdfBytes()),
    );
    expect(outcome).toEqual({
      kind: "refused",
      message: EXTRACT_UNREADABLE,
    });
    expect(EXTRACT_UNREADABLE).not.toMatch(/PasswordException|error/i);
  });

  test("the seam reads the bytes once and writes nothing at all", async () => {
    const io = extractIo(textPdfBytes());
    await extractPdf("/papers/a.pdf", fixedText("kept"), io);
    expect(io.reads).toBe(1);
    // Its whole bridge surface is one read: no writer exists to call.
    expect(Object.keys(io).sort()).toEqual(["readFileBytes", "reads"]);
  });
});

describe("taking a PDF reading stores its text like a text file's", () => {
  test("the text lands in map/readings/<slug>.md and the line says pdf", async () => {
    const workspace = freshWorkspace();
    const log: string[] = [];
    const result = await takeReading(
      workspace,
      "attention",
      TEXT_PDF,
      readingIo(fixedText("the text taken from the document"), log),
      TAKEN,
    );
    expect(result.kind).toBe("taken");
    if (result.kind !== "taken") throw new Error("expected a reading");
    expect(result.text).toBe("the text taken from the document");
    expect(readFileSync(readingTextPath(workspace, "attention"), "utf8")).toBe(
      "the text taken from the document",
    );
    // The line records the extractor and the DOCUMENT's size (the staleness
    // fact), and round-trips exactly.
    expect(result.reading).toEqual({
      on: "attention",
      form: "at",
      from: TEXT_PDF,
      taken: TAKEN,
      bytes: TEXT_PDF_LENGTH,
      extract: "pdf",
    });
    const line = serializeReadingLine(result.reading);
    expect(line).toContain("| extract: pdf");
    expect(parseReadingLine(line)).toEqual(result.reading);
  });

  test("a PDF's text passes the SAME provisional 64-line / 8 KiB cap", async () => {
    const workspace = freshWorkspace();
    const long = Array.from(
      { length: READING_MAX_LINES + 6 },
      (_, index) => "page line " + (index + 1),
    ).join("\n");
    const result = await takeReading(
      workspace,
      "long",
      TEXT_PDF,
      readingIo(fixedText(long)),
      TAKEN,
    );
    if (result.kind !== "taken") throw new Error("expected a reading");
    expect(result.text).not.toContain("page line 65");
    expect(result.text.split("\n").filter((line) => line !== "")).toHaveLength(
      READING_MAX_LINES,
    );
    // The cap is the reading's, not the document's: only the FACE is cut, and
    // the stored text is exactly what was taken.
    expect(readFileSync(readingTextPath(workspace, "long"), "utf8")).toBe(
      result.text,
    );
  });

  test("a scanned PDF is ONE sentence and no reading is created", async () => {
    const workspace = freshWorkspace();
    const log: string[] = [];
    const result = await takeReading(
      workspace,
      "scan",
      BLANK_PDF,
      readingIo(fixedText(null), log),
      TAKEN,
    );
    expect(result).toEqual({ kind: "refused", message: EXTRACT_NO_TEXT });
    expect(EXTRACT_NO_TEXT).toBe("that PDF has no text to read.");
    // Nothing was written: no text file, no line, no empty reading.
    expect(log).toEqual(["bytes"]);
    expect(existsSync(readingTextPath(workspace, "scan"))).toBe(false);
    expect(existsSync(readingsPath(workspace))).toBe(false);
  });

  test("a too-large or absent document writes nothing either", async () => {
    const workspace = freshWorkspace();
    for (const [code, sentence] of [
      ["too-large", EXTRACT_REFUSALS["too-large"]],
      ["cannot-reach", EXTRACT_REFUSALS["cannot-reach"]],
    ] as const) {
      const log: string[] = [];
      const result = await takeReading(
        workspace,
        "huge",
        TEXT_PDF,
        readingIo(fixedText("never reached"), log, () => ({ kind: "refused", code })),
        TAKEN,
      );
      expect(result).toEqual({ kind: "refused", message: sentence });
      expect(log).toEqual(["bytes"]);
      expect(existsSync(readingTextPath(workspace, "huge"))).toBe(false);
    }
  });

  test("the PDF itself is never copied into the workspace", async () => {
    const workspace = freshWorkspace();
    await takeReading(
      workspace,
      "attention",
      TEXT_PDF,
      readingIo(fixedText("the text taken from the document")),
      TAKEN,
    );
    const files = readdirSync(join(workspace, "map"), {
      recursive: true,
    }).map(String);
    expect(files.sort()).toEqual(["readings", "readings" + "/" + "attention.md"]);
    for (const name of files) {
      expect(name.toLowerCase()).not.toContain(".pdf");
    }
    // The original is where the person put it, untouched.
    expect(readFileSync(TEXT_PDF).length).toBe(TEXT_PDF_LENGTH);
  });
});

describe("a legacy line without extract is TEXT and is never rewritten", () => {
  const LEGACY = `on: rain | form: path | from: notes/gauge.txt | taken: ${TAKEN} | bytes: 100`;

  test("the field is absent, the reading is text, and the bytes round-trip", () => {
    const reading = parseReadingLine(LEGACY);
    expect(reading).not.toBeNull();
    expect(reading?.extract).toBeUndefined();
    expect(readingExtract(reading!)).toBe("text");
    // NO migration on load: the line parses and serializes byte-identically.
    const parsed = parseReadings(LEGACY + "\n");
    expect(parsed.readings).toHaveLength(1);
    expect(serializeReadings(parsed.readings, parsed.malformed)).toBe(
      LEGACY + "\n",
    );
    // A hand edit that spells the field is preserved as written.
    const explicit = parseReadingLine(LEGACY + " | extract: text");
    expect(explicit?.extract).toBe("text");
    expect(serializeReadingLine(explicit!)).toBe(LEGACY + " | extract: text");
  });

  test("a refresh of a legacy line re-heads it and keeps the field absent", async () => {
    const workspace = freshWorkspace();
    const source = join(workspace, "gauge.txt");
    writeFileSync(source, "one\ntwo\n", "utf8");
    const legacy: Reading = {
      on: "rain",
      form: "path",
      from: "gauge.txt",
      taken: TAKEN,
    };
    const log: string[] = [];
    const refreshed = await refreshReading(
      workspace,
      legacy,
      readingIo(fixedText("not pdf text"), log),
      "2026-11-17T13:00:00.000Z",
    );
    if (refreshed.kind !== "taken") throw new Error("expected a reading");
    // The head read ran; the PDF extractor did not.
    expect(log).toEqual(["head", "text"]);
    expect(refreshed.reading.extract).toBeUndefined();
    expect(serializeReadingLine(refreshed.reading)).not.toContain("extract");
  });
});

describe("a PDF reading refreshes through the extractor it recorded", () => {
  test("refresh re-extracts, keeps extract: pdf and rewrites the text first", async () => {
    const workspace = freshWorkspace();
    const taken = await takeReading(
      workspace,
      "attention",
      TEXT_PDF,
      readingIo(fixedText("first take")),
      TAKEN,
    );
    if (taken.kind !== "taken") throw new Error("expected a reading");

    const log: string[] = [];
    const refreshed = await refreshReading(
      workspace,
      taken.reading,
      readingIo(fixedText("second take"), log),
      "2026-11-17T13:00:00.000Z",
    );
    if (refreshed.kind !== "taken") throw new Error("expected a reading");
    // The BYTE read ran, and the head read never did.
    expect(log).toEqual(["bytes", "text"]);
    expect(refreshed.reading.extract).toBe("pdf");
    expect(refreshed.reading.form).toBe("at");
    expect(refreshed.reading.from).toBe(TEXT_PDF);
    expect(refreshed.text).toBe("second take");
    expect(readFileSync(readingTextPath(workspace, "attention"), "utf8")).toBe(
      "second take",
    );
  });
});

describe("the real binding, once, through a tiny real PDF", () => {
  test("pdf.js reads the fixture's text layer in reading order", async () => {
    const text = await pdfText(textPdfBytes());
    expect(text).not.toBeNull();
    expect(text).toContain("Attentioneer reads a PDF.");
    expect(text).toContain("Second line of the reading.");
    // Reading order: the first line comes before the second.
    expect(text!.indexOf("Attentioneer reads")).toBeLessThan(
      text!.indexOf("Second line"),
    );
  });

  test("a page set with no text layer answers null, not an empty string", async () => {
    expect(await pdfText(new Uint8Array(readFileSync(BLANK_PDF)))).toBeNull();
  });

  test("the whole pipeline: the fixture's bytes store its text as a pdf reading", async () => {
    const workspace = freshWorkspace();
    const log: string[] = [];
    const result = await takeReading(
      workspace,
      "attention",
      TEXT_PDF,
      // The REAL binding, fed by the real byte read of the fixture.
      readingIo(pdfText, log),
      TAKEN,
    );
    if (result.kind !== "taken") throw new Error("expected a reading");
    expect(result.reading.extract).toBe("pdf");
    expect(result.reading.bytes).toBe(TEXT_PDF_LENGTH);
    expect(result.text).toContain("Attentioneer reads a PDF.");
    expect(readFileSync(readingTextPath(workspace, "attention"), "utf8")).toBe(
      result.text,
    );
    // Store order is unchanged: the text file, then the caller's line.
    expect(log).toEqual(["bytes", "text"]);
  });
});

describe("the card shows the stored text unchanged, and the file name beneath", () => {
  const reading: Reading = {
    on: "attention",
    form: "at",
    from: "/home/k/papers/attention.pdf",
    taken: TAKEN,
    bytes: 2048,
    extract: "pdf",
  };
  const inertVerbs = {
    onMove: async () => ({ ok: true as const }),
    onRefresh: async () => ({ ok: true as const }),
    onRepoint: async () => ({ ok: true as const }),
    onRemove: async () => ({ ok: true as const }),
  };

  test("a pdf reading is a card like any other: name, paged text, file name", () => {
    const stored = Array.from({ length: 9 }, (_, index) => "line " + (index + 1)).join(
      "\n",
    );
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [{ on: "attention", name: "Attention", x: 10, y: 20 }],
        readings: [reading],
        texts: { attention: stored },
        states: { attention: "current" },
        ...inertVerbs,
      }),
    );
    expect(html).toContain("Attention");
    // The reading renders WHOLE: every stored line reaches the card — the
    // lines the crop used to cut away are all here now.
    expect(html).toContain("line 1");
    expect(html).toContain("line 7");
    expect(html).toContain("line 9");
    expect(html).not.toContain("line 6…");
    // The pages, not a crop, hold the text at the person's stated count.
    expect(html).toContain('class="paged-flow"');
    expect(html).toContain("--page-lines:6");
    expect(html).toContain("attention.pdf");
  });
});

describe("the negative space: nothing counts, scores or nudges", () => {
  const FORBIDDEN =
    /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|backlog|total|points)\b/i;

  test("every new sentence is quiet and free of digits", () => {
    for (const text of [EXTRACT_NO_TEXT, EXTRACT_UNREADABLE, ...Object.values(EXTRACT_REFUSALS)]) {
      expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        text,
        found: null,
      });
      expect(text).not.toMatch(/\d/);
    }
  });

  test("pdf.js is imported in ONE module, and its version is pinned exactly", () => {
    const sources = readdirSync(join(APP_DIR, "src"), {
      recursive: true,
    }).map(String).filter((name) => /\.tsx?$/.test(name));
    const importers = sources.filter((name) =>
      readFileSync(join(APP_DIR, "src", name), "utf8").includes("pdfjs-dist"),
    );
    expect(importers).toEqual(["map/pdf.ts"]);
    const pkg = JSON.parse(readFileSync(join(APP_DIR, "package.json"), "utf8"));
    expect(pkg.dependencies["pdfjs-dist"]).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
