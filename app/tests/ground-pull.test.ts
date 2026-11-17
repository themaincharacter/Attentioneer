import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroundLayer, GroundPulled, pullToDismiss } from "../src/canvas/GroundLayer";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import type { FileBytesAnswer, TextHead } from "../src/lib/fs";
import { clipHead } from "../src/lib/headBounds";
import { utf8ByteLength } from "../src/lib/textBytes";
import {
  EXTRACT_NO_TEXT,
  EXTRACT_REFUSALS,
  EXTRACT_UNREADABLE,
  type PdfText,
} from "../src/map/extract";
import {
  PULL_BUDGET_BYTES,
  PULL_IO,
  PULL_MAX_LINES,
  pullReading,
  pullTruncationLine,
  type PullIo,
} from "../src/map/pull";
import {
  READING_MAX_BYTES,
  READING_REFUSALS,
  readingTextPath,
  readingsPath,
  type Reading,
} from "../src/map/readings";

/**
 * Story 16.8 — the pull: read one reference in full, under a budget.
 *
 * The story's check is human ("expand a long card, press read more: the rest
 * of the file appears; reopen the workspace: the card is back to its reading
 * and no file gained anything; rename the source away and press read more: it
 * says the file is missing instead of pretending"). This file pins the rules
 * underneath it:
 *
 *   - the pull READS ONLY: its bridge surface has no writer, and a folder
 *     snapshot before/after a pull is byte-identical;
 *   - one budget (96 KiB, PROVISIONAL), the text that comes back fits it, and
 *     the one truncation line is said only when the budget bites;
 *   - a refusal is the EXISTING sentence (the reading vocabulary's, the
 *     extractor's), never a new one;
 *   - a PDF pulls through the SAME injected extract seam a pick uses;
 *   - the pull is view state (`useGround.pull`, the layer's block), never a
 *     re-stamp: the reading, the stored text, the note and the state word are
 *     untouched, and closing the card forgets the look (pure `pullToDismiss`).
 *
 * PROVISIONAL (the story): the budget, the truncation wording, the verb's
 * placement, the block's typography and the fact that a pull dies with the
 * card's close.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const LAYER = source("canvas/GroundLayer.tsx");
const HOOK = source("canvas/useGround.ts");
const PULL = source("map/pull.ts");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-pull-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const TAKEN = "2026-11-17T12:00:00.000Z";

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map", "readings"), { recursive: true });
  mkdirSync(join(path, "map", "notes"), { recursive: true });
  return path;
}

const ABSENT_HEAD: TextHead = {
  head: "",
  truncated: false,
  exists: false,
  size: null,
  mtime: null,
  decode: "clean",
};

/** The bridge as head.rs behaves, on a REAL temp file: the pull's IO double. */
function pullIo(
  options: {
    pdf?: PdfText;
    bytes?: (path: string) => FileBytesAnswer;
    log?: string[];
  } = {},
): PullIo {
  const log = options.log ?? [];
  return {
    readTextHead: async (path, maxLines, maxBytes): Promise<TextHead> => {
      let raw: Buffer;
      try {
        raw = readFileSync(path);
      } catch {
        return ABSENT_HEAD;
      }
      log.push("head");
      // The bridge refuses binary files; a fake must too, or a test could
      // silently prove a pull of bytes.
      if (raw.includes(0)) {
        const error = Object.assign(new Error("not text"), { code: "not-text" });
        throw error;
      }
      const text = raw.toString("utf8");
      const clipped = clipHead(text, maxLines, maxBytes);
      return {
        head: clipped.head,
        truncated: clipped.truncated || raw.length > maxBytes,
        exists: true,
        size: raw.length,
        mtime: null,
        decode: "clean",
      };
    },
    readFileBytes: async (path) => {
      log.push("bytes");
      if (options.bytes) return options.bytes(path);
      // A PDF's test source is a fake document, not a file on disk.
      return options.pdf === undefined
        ? { kind: "bytes", bytes: new Uint8Array(readFileSync(path)) }
        : { kind: "bytes", bytes: new Uint8Array([1, 2, 3]) };
    },
    pdfText: async (bytes) => {
      log.push("pdf");
      return options.pdf ? options.pdf(bytes) : null;
    },
  };
}

function fixedText(text: string | null): PdfText {
  return async () => text;
}

/** A text reading of a workspace-relative file, as a pick would store it. */
function textReading(from: string, on = "long"): Reading {
  return { on, form: "path", from, taken: TAKEN, bytes: 1 };
}

/** A PDF reading, as the extractor's pick would store it. */
function pdfReading(from = "/papers/attention.pdf", on = "attention"): Reading {
  return { on, form: "at", from, taken: TAKEN, bytes: 2, extract: "pdf" };
}

/** Every file under a folder, by relative name, as exact bytes. */
function snapshotFolder(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(root, { recursive: true }).map(String).sort()) {
    const full = join(root, name);
    if (statSync(full).isFile()) {
      files[name] = readFileSync(full).toString("base64");
    }
  }
  return files;
}

function longText(bytes: number, marker = "LINE"): string {
  const line = marker + " the map keeps what was taken, not what is looked at\n";
  return line.repeat(Math.ceil(bytes / line.length)).slice(0, bytes);
}

describe("the pull reads more, under ONE stated budget", () => {
  test("the budget is 96 KiB (PROVISIONAL), and its line names it", () => {
    expect(PULL_BUDGET_BYTES).toBe(96 * 1024);
    expect(pullTruncationLine()).toBe(
      "the file is larger than one reading; showing the first 96 KiB",
    );
    // The wording speaks the budget once: no percentage, no running total and
    // no second measure.
    expect(pullTruncationLine()).not.toMatch(/%|percent/i);
  });

  test("a file under the budget comes back whole and untruncated", async () => {
    const workspace = freshWorkspace();
    const body = longText(20 * 1024, "SHORT");
    writeFileSync(join(workspace, "source.txt"), body, "utf8");
    const result = await pullReading(
      workspace,
      textReading("source.txt"),
      PULL_BUDGET_BYTES,
      pullIo(),
    );
    expect(result.kind).toBe("text");
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.truncated).toBe(false);
    expect(result.text).toBe(body);
  });

  test("the pull reaches past the reading's 8 KiB head (larger limits)", async () => {
    const workspace = freshWorkspace();
    const body = longText(40 * 1024, "MORE");
    writeFileSync(join(workspace, "source.txt"), body, "utf8");
    let askedLines = -1;
    let askedBytes = -1;
    const io = pullIo();
    const recording: PullIo = {
      ...io,
      readTextHead: async (path, maxLines, maxBytes) => {
        askedLines = maxLines;
        askedBytes = maxBytes;
        return io.readTextHead(path, maxLines, maxBytes);
      },
    };
    const result = await pullReading(
      workspace,
      textReading("source.txt"),
      PULL_BUDGET_BYTES,
      recording,
    );
    if (result.kind !== "text") throw new Error("expected text");
    // The SAME read_text_head seam, with the pull's limits: the byte budget is
    // the one number, and the line bound sits above anything 96 KiB can hold.
    expect(askedLines).toBe(PULL_MAX_LINES);
    expect(askedBytes).toBe(PULL_BUDGET_BYTES);
    expect(utf8ByteLength(result.text)).toBeGreaterThan(READING_MAX_BYTES);
    expect(result.text).toBe(body);
  });

  test("a file over the budget comes back cut, says so, and FITS", async () => {
    const workspace = freshWorkspace();
    const body = longText(150 * 1024, "TAIL");
    writeFileSync(join(workspace, "source.txt"), body + "THE VERY END", "utf8");
    const result = await pullReading(
      workspace,
      textReading("source.txt"),
      PULL_BUDGET_BYTES,
      pullIo(),
    );
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.truncated).toBe(true);
    expect(utf8ByteLength(result.text)).toBeLessThanOrEqual(PULL_BUDGET_BYTES);
    expect(result.text.startsWith("TAIL the map")).toBe(true);
    expect(result.text).not.toContain("THE VERY END");
  });

  test("a custom budget is the number the line speaks", async () => {
    const workspace = freshWorkspace();
    writeFileSync(join(workspace, "source.txt"), longText(12 * 1024), "utf8");
    const result = await pullReading(
      workspace,
      textReading("source.txt"),
      4 * 1024,
      pullIo(),
    );
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.truncated).toBe(true);
    expect(utf8ByteLength(result.text)).toBeLessThanOrEqual(4 * 1024);
    expect(pullTruncationLine(4 * 1024)).toContain("4 KiB");
  });
});

describe("refusals are the sentences the card already uses", () => {
  test("a missing file is the reading vocabulary's own sentence", async () => {
    const workspace = freshWorkspace();
    const result = await pullReading(
      workspace,
      textReading("gone.txt"),
      PULL_BUDGET_BYTES,
      pullIo(),
    );
    expect(result).toEqual({
      kind: "refused",
      message: READING_REFUSALS.absent,
    });
    expect(READING_REFUSALS.absent).toBe("that file is not there.");
  });

  test("a binary/unreachable/io refusal maps to the SAME vocabulary", async () => {
    const workspace = freshWorkspace();
    for (const code of ["not-text", "cannot-reach", "escaped", "io"] as const) {
      const io: PullIo = {
        ...pullIo(),
        readTextHead: async () => {
          throw Object.assign(new Error("no"), { code });
        },
      };
      const result = await pullReading(
        workspace,
        textReading("whatever.txt"),
        PULL_BUDGET_BYTES,
        io,
      );
      expect(result).toEqual({
        kind: "refused",
        message: READING_REFUSALS[code],
      });
      // The sentence never carries a path, a count or the OS's words.
      if (result.kind === "refused") {
        expect(result.message).not.toContain("whatever");
        expect(result.message).not.toMatch(/\d/);
      }
    }
  });

  test("a PDF's refusals are the extractor's existing sentences", async () => {
    const workspace = freshWorkspace();
    const cases: Array<{
      io: PullIo;
      message: string;
    }> = [
      {
        io: pullIo({ bytes: () => ({ kind: "refused", code: "too-large" }) }),
        message: EXTRACT_REFUSALS["too-large"],
      },
      {
        io: pullIo({ bytes: () => ({ kind: "refused", code: "cannot-reach" }) }),
        message: EXTRACT_REFUSALS["cannot-reach"],
      },
      {
        io: pullIo({
          bytes: () => ({ kind: "bytes", bytes: new Uint8Array([1]) }),
          pdf: async () => {
            throw new Error("PasswordException");
          },
        }),
        message: EXTRACT_UNREADABLE,
      },
      { io: pullIo({ pdf: fixedText(null) }), message: EXTRACT_NO_TEXT },
    ];
    for (const { io, message } of cases) {
      const result = await pullReading(
        workspace,
        pdfReading(),
        PULL_BUDGET_BYTES,
        io,
      );
      expect(result).toEqual({ kind: "refused", message });
    }
    // "Too large" is one of the sentences the card already has, not a new one.
    expect(EXTRACT_REFUSALS["too-large"]).toBe("that file is too large to read.");
  });
});

describe("a PDF pulls through the SAME extract seam a pick uses", () => {
  test("the injected extractor runs once and the text is budgeted", async () => {
    const workspace = freshWorkspace();
    const log: string[] = [];
    const result = await pullReading(
      workspace,
      pdfReading(),
      PULL_BUDGET_BYTES,
      pullIo({ pdf: fixedText(longText(150 * 1024, "PDF")), log }),
    );
    expect(log).toEqual(["bytes", "pdf"]);
    if (result.kind !== "text") throw new Error("expected text");
    expect(result.truncated).toBe(true);
    expect(utf8ByteLength(result.text)).toBeLessThanOrEqual(PULL_BUDGET_BYTES);
  });

  test("a short PDF comes back whole and untruncated", async () => {
    const workspace = freshWorkspace();
    const log: string[] = [];
    const result = await pullReading(
      workspace,
      pdfReading(),
      PULL_BUDGET_BYTES,
      pullIo({ pdf: fixedText("first page\nsecond page"), log }),
    );
    expect(log).toEqual(["bytes", "pdf"]);
    expect(result).toEqual({
      kind: "text",
      text: "first page\nsecond page",
      truncated: false,
    });
  });

  test("a text reading is not sent to the PDF extractor (and vice versa)", async () => {
    const workspace = freshWorkspace();
    writeFileSync(join(workspace, "notes.txt"), "plain text", "utf8");
    const textLog: string[] = [];
    await pullReading(
      workspace,
      textReading("notes.txt"),
      PULL_BUDGET_BYTES,
      pullIo({ log: textLog }),
    );
    expect(textLog).toEqual(["head"]);
    const pdfLog: string[] = [];
    await pullReading(
      workspace,
      pdfReading(),
      PULL_BUDGET_BYTES,
      pullIo({ pdf: fixedText("pdf text"), log: pdfLog }),
    );
    expect(pdfLog).toEqual(["bytes", "pdf"]);
  });
});

describe("a pull WRITES NOTHING — the ephemeral guarantee", () => {
  test("the reader's bridge surface has no writer to call", () => {
    expect(Object.keys(PULL_IO).sort()).toEqual([
      "pdfText",
      "readFileBytes",
      "readStoredText",
      "readTextHead",
    ]);
    // The module's CODE (comments stripped) names no writer at all.
    const code = PULL.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    for (const writer of [
      "writeTextFile",
      "createDirAll",
      "removeFile",
      "writeQueue",
    ]) {
      expect(code).not.toContain(writer);
    }
  });

  test("a folder snapshot is byte-identical before and after a pull (text)", async () => {
    const workspace = freshWorkspace();
    // The workspace the pull must leave alone: its records, its reading text,
    // its note, a stray file, and the long source itself.
    writeFileSync(
      join(workspace, "map", "ground.txt"),
      "on: long | name: Long | x: 10 | y: 20\n",
      "utf8",
    );
    writeFileSync(
      join(workspace, "map", "readings.txt"),
      "on: long | form: path | from: source.txt | taken: " + TAKEN + " | bytes: 1\n",
      "utf8",
    );
    writeFileSync(
      readingTextPath(workspace, "long"),
      "the stored head, exactly as taken",
      "utf8",
    );
    writeFileSync(
      join(workspace, "map", "notes", "long.md"),
      "the person's own words",
      "utf8",
    );
    writeFileSync(join(workspace, "map", "mirror.md"), "a stray file\n", "utf8");
    writeFileSync(join(workspace, "source.txt"), longText(150 * 1024), "utf8");

    const before = snapshotFolder(workspace);
    const result = await pullReading(
      workspace,
      textReading("source.txt"),
      PULL_BUDGET_BYTES,
      pullIo(),
    );
    expect(result.kind).toBe("text");
    expect(snapshotFolder(workspace)).toEqual(before);

    // The stored reading and its line are byte-for-byte what they were.
    expect(readFileSync(readingsPath(workspace), "utf8")).toBe(
      "on: long | form: path | from: source.txt | taken: " +
        TAKEN +
        " | bytes: 1\n",
    );
    expect(readFileSync(readingTextPath(workspace, "long"), "utf8")).toBe(
      "the stored head, exactly as taken",
    );
  });

  test("a folder snapshot is byte-identical after a PDF pull too", async () => {
    const workspace = freshWorkspace();
    writeFileSync(
      readingTextPath(workspace, "attention"),
      "the stored pdf head",
      "utf8",
    );
    writeFileSync(
      join(workspace, "map", "notes", "attention.md"),
      "note",
      "utf8",
    );
    const before = snapshotFolder(workspace);
    const result = await pullReading(
      workspace,
      pdfReading(),
      PULL_BUDGET_BYTES,
      pullIo({ pdf: fixedText("the whole document, read again") }),
    );
    expect(result.kind).toBe("text");
    expect(snapshotFolder(workspace)).toEqual(before);
  });

  test("the reading object the map holds is not changed by a pull", async () => {
    const workspace = freshWorkspace();
    writeFileSync(join(workspace, "source.txt"), "one\ntwo\n", "utf8");
    const reading = textReading("source.txt");
    const copy = { ...reading };
    await pullReading(workspace, reading, PULL_BUDGET_BYTES, pullIo());
    expect(reading).toEqual(copy);
  });
});

describe("the pull is VIEW STATE: the hook holds it, no writer sees it", () => {
  test("the hook's pull uses the reader and never a writer, state word or stamp", () => {
    const start = HOOK.indexOf("const pull = useCallback(");
    const end = HOOK.indexOf("const dismissPull = useCallback(");
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const block = HOOK.slice(start, end);
    expect(block).toContain("pullReading(");
    expect(block).toContain("pulledRef.current");
    for (const forbidden of [
      "saveGround(",
      "saveReadings(",
      "saveNote(",
      "writeTextFile(",
      "removeFile(",
      "queueRef",
      "statesRef.current =",
      "textsRef.current =",
      "readingsRef.current =",
      "taken",
    ]) {
      expect({ forbidden, found: block.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
  });

  test("the load never reads a pull (no read on open, no watcher, no poll)", () => {
    const reload = HOOK.slice(
      HOOK.indexOf("const reload = useCallback("),
      HOOK.indexOf("const snapshot = "),
    );
    expect(reload).not.toContain("pullReading");
    expect(HOOK).not.toMatch(/setInterval|setTimeout|EventSource|watch\(/);
  });

  test("the layer holds no bridge: the button is the ONLY pull call site", () => {
    expect(LAYER.match(/onPull\(/g) ?? []).toHaveLength(1);
    expect(LAYER).toContain("read more");
    expect(LAYER).toContain("ground-read-more");
    expect(LAYER).not.toMatch(/readTextHead|readFileBytes|pullReading/);
    expect(LAYER).not.toMatch(/setInterval|EventSource/);
    // The block is drawn only on the OPEN card.
    expect(LAYER).toContain("open && pulled !== undefined");
    // The verb too: a closed card has no read-more button.
    // Story 16.12: a selection has no source to read more of, so its card
    // draws no pull verb — the file readings keep theirs.
    expect(LAYER).toMatch(
      /open && reading !== null && reading\.form !== "selection" && onPull !== undefined/,
    );
  });

  test("closing the card forgets the look (the pure rule), and the layer obeys", () => {
    expect(pullToDismiss(null, "a")).toBeNull();
    expect(pullToDismiss("a", "a")).toBeNull();
    expect(pullToDismiss("a", null)).toBe("a");
    expect(pullToDismiss("a", "b")).toBe("a");
    expect(LAYER).toContain("pullToDismiss(previous, openOn)");
    expect(LAYER).toContain("onDismissPull?.(stale)");
  });
});

describe("the pulled block is a continuation, and the budget is its only number", () => {
  test("a truncated block shows the text, the ONE line and the dismiss", () => {
    const html = renderToStaticMarkup(
      createElement(GroundPulled, {
        pulled: { text: "the rest of the file", truncated: true },
        onDismiss: () => {},
      }),
    );
    expect(html).toContain("the rest of the file");
    expect(html).toContain(
      "the file is larger than one reading; showing the first 96 KiB",
    );
    expect(html).toContain("dismiss");
    expect(html).toContain("ground-pulled-text");
    expect(html).toContain("ground-pulled-note");
  });

  test("an untruncated block says nothing about a budget", () => {
    const html = renderToStaticMarkup(
      createElement(GroundPulled, {
        pulled: { text: "the whole file", truncated: false },
        onDismiss: () => {},
      }),
    );
    expect(html).toContain("the whole file");
    expect(html).not.toContain("larger than one reading");
  });

  test("a closed card never shows a pulled block or its verb", () => {
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [{ on: "long", name: "Long", x: 10, y: 20 }],
        readings: [textReading("source.txt")],
        texts: { long: "the stored head" },
        pulled: { long: { text: "the pulled tail", truncated: true } },
        states: { long: "current" },
        onMove: async () => ({ ok: true as const }),
        onRefresh: async () => ({ ok: true as const }),
        onRepoint: async () => ({ ok: true as const }),
        onRemove: async () => ({ ok: true as const }),
        onPull: async () => ({ ok: true as const }),
        onDismissPull: () => {},
      }),
    );
    expect(html).toContain("the stored head");
    expect(html).not.toContain("the pulled tail");
    expect(html).not.toContain("read more");
  });

  test("the pull's parts are content to the plane's gate", () => {
    for (const name of [
      "ground-read-more",
      "ground-pulled",
      "ground-pulled-text",
      "ground-pulled-note",
      "ground-pulled-dismiss",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
  });
});

describe("the negative space: nothing counts, scores or nudges", () => {
  const FORBIDDEN =
    /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|backlog|total|points)\b/i;

  test("the pull's sentences are quiet; the budget is the only number", () => {
    for (const text of [pullTruncationLine(), ...Object.values(READING_REFUSALS)]) {
      expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        text,
        found: null,
      });
    }
    // The one number is the budget, and no percentage or progress word sits
    // beside it.
    expect(pullTruncationLine()).toMatch(/96 KiB/);
    expect(pullTruncationLine()).not.toMatch(/%|percent|bar/i);
  });
});
