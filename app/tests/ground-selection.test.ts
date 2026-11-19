import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GroundLayer,
  readingProvenance,
  SELECTION_MISSING_SOURCE,
} from "../src/canvas/GroundLayer";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  metasOf,
  removeGroundRecords,
  restoreGroundCard,
} from "../src/canvas/useGround";
import {
  loadGround,
  saveGround,
  type GroundReference,
} from "../src/map/ground";
import {
  isSelectionProvenance,
  loadReadingTexts,
  loadReadings,
  parseReadingLine,
  parseReadings,
  previewText,
  readingFor,
  readingStateWord,
  readingTextPath,
  resolveReadingState,
  saveReadings,
  selectionProvenance,
  selectionReading,
  selectionSourceSlug,
  serializeReadingLine,
  type Reading,
  type ReadingIo,
} from "../src/map/readings";
import { pullStoredText, pullReading, type PullIo } from "../src/map/pull";
import { assembleCardPacket } from "../src/turn/packet";
import { cardAskContext, fetchAskBlock } from "../src/turn/context";
import { clipHead } from "../src/lib/headBounds";
import type { FileMetaAnswer, TextHead } from "../src/lib/fs";

/**
 * STORY 18 — the selection→card VERB is deleted; the selection FORM is not.
 *
 * Story 16.12 let a person select text in an expanded reading and make a new
 * ground card from it. The user corrected the intent: what they meant was a
 * selection highlight opening the ASK widget (a later story), not a card. This
 * file now pins BOTH halves of that correction:
 *
 *   - THE FORM STAYS LEGAL: `form: selection` round-trips, a path in `from` is
 *     refused (kept and reported), the state is `current` by construction and
 *     no `file_meta` is asked for a selection card.
 *   - A CARD MADE THE OLD WAY STILL WORKS END TO END: seeded records load, the
 *     card renders its provenance and "what this is", the packet rides it, the
 *     ONE retrieval returns the exact bytes, the pull reads only the map's own
 *     excerpt, and remove → restore puts back the same bytes and lines.
 *   - THE VERB IS GONE, SWEPT: no handler, no name field, no affordance, no
 *     class, no string, no test-only gate anywhere in `src`.
 *
 * PROVISIONAL: the `card://` provenance spelling and the quiet provenance
 * sentence (story 16.12's record shape, unchanged).
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const HOOK = source("canvas/useGround.ts");
const LAYER = source("canvas/GroundLayer.tsx");
const APP = source("App.tsx");
const GATES = source("canvas/gates.ts");
const CSS = source("canvas/canvas.css");
const PULL = source("map/pull.ts");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-selection-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const TAKEN = "2026-11-17T12:00:00.000Z";
const SOURCE_SLUG = "rain-gauge";
const SOURCE_NAME = "Rain gauge";
/** A paragraph with odd whitespace: every byte must survive, none trimmed. */
const EXCERPT = "  the river falls slowly\n\n  two  spaces\tand a tab\n";

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map", "readings"), { recursive: true });
  return path;
}

const EXCERPT_HEAD: TextHead = {
  head: "",
  truncated: false,
  exists: false,
  size: null,
  mtime: null,
  decode: "clean",
};

function fileMeta(path: string): FileMetaAnswer {
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
    return { kind: "facts", exists: false, is_file: false, len: null, modified_ms: null };
  }
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

/** The file bridges a test needs; the app's real ones go through Tauri. */
const groundIo = {
  readTextFile: async (path: string) => readOrNull(path),
  writeTextFile: async (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  },
};

const readingIo: ReadingIo = {
  readTextFile: async (path) => readOrNull(path),
  writeTextFile: async (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  },
  createDirAll: async (path) => {
    mkdirSync(path, { recursive: true });
  },
  fileMeta: async (path) => fileMeta(path),
  readFileBytes: async () => ({ kind: "refused", code: "cannot-reach" }),
  pdfText: async () => {
    throw new Error("this test reads no PDFs");
  },
  readTextHead: async (path, maxLines, maxBytes) => {
    let bytes: Buffer;
    try {
      bytes = readFileSync(path);
    } catch {
      return EXCERPT_HEAD;
    }
    const bounded = clipHead(bytes.toString("utf8"), maxLines, maxBytes);
    return {
      head: bounded.head,
      truncated: bounded.truncated,
      exists: true,
      size: bytes.length,
      mtime: null,
      decode: "clean",
    };
  },
};

/**
 * Seed a card EXACTLY as one made before story 18 sits on disk: the source's
 * own files, then the selection's reading line and verbatim text. No writer
 * from the removed verb is called — this is the record shape only.
 */
async function seedKeptSelection(workspace: string): Promise<{
  references: GroundReference[];
  readings: Reading[];
}> {
  const sourceText = "the source card's own reading\nsecond line\n";
  mkdirSync(dirname(readingTextPath(workspace, SOURCE_SLUG)), { recursive: true });
  writeFileSync(readingTextPath(workspace, SOURCE_SLUG), sourceText, "utf8");
  writeFileSync(readingTextPath(workspace, "nights"), EXCERPT, "utf8");
  const references: GroundReference[] = [
    { on: SOURCE_SLUG, name: SOURCE_NAME, x: 40, y: 60 },
    { on: "nights", name: "Nights", x: 360, y: 60 },
  ];
  const readings: Reading[] = [
    { on: SOURCE_SLUG, form: "path", from: "notes/river.md", taken: TAKEN, extract: "text" },
    selectionReading("nights", SOURCE_SLUG, TAKEN),
  ];
  await saveGround(workspace, references, [], groundIo);
  await saveReadings(workspace, readings, [], readingIo);
  return { references, readings };
}

describe("the form stays legal: a reading with no source file", () => {
  test("a selection line round-trips, and carries no bytes or extractor", () => {
    const reading = selectionReading("nights", SOURCE_SLUG, TAKEN);
    expect(reading).toEqual({
      on: "nights",
      form: "selection",
      from: "card://rain-gauge",
      taken: TAKEN,
    });
    const line = serializeReadingLine(reading);
    expect(line).toBe(
      "on: nights | form: selection | from: card://rain-gauge | taken: " + TAKEN,
    );
    expect(parseReadingLine(line)).toEqual(reading);
    expect(line).not.toContain("bytes:");
    expect(line).not.toContain("extract:");
  });

  test("provenance is a card, never a path", () => {
    expect(selectionProvenance("rain-gauge")).toBe("card://rain-gauge");
    expect(isSelectionProvenance("card://rain-gauge")).toBe(true);
    for (const path of [
      "/home/k/notes.md",
      "notes/river.md",
      "C:\\Users\\k\\notes.md",
      "\\\\server\\share\\a.txt",
      "card://",
      "card://a/b",
      "card://a b",
    ]) {
      expect({ path, ok: isSelectionProvenance(path) }).toEqual({ path, ok: false });
    }
    expect(selectionSourceSlug(selectionReading("x", "rain-gauge", TAKEN))).toBe(
      "rain-gauge",
    );
    expect(selectionSourceSlug(selectionReading("x", "rain-gauge", TAKEN))).not.toContain("/");
  });

  test("a selection line that carries a PATH is refused (kept and reported)", () => {
    const withPath =
      "on: nights | form: selection | from: notes/river.md | taken: " + TAKEN;
    const withAt =
      "on: nights | form: selection | from: /home/k/notes.md | taken: " + TAKEN;
    const withCard =
      "on: nights | form: selection | from: card://rain-gauge | taken: " + TAKEN;
    expect(parseReadingLine(withPath)).toBeNull();
    expect(parseReadingLine(withAt)).toBeNull();
    expect(parseReadingLine(withCard)).not.toBeNull();
    const parsed = parseReadings(withPath + "\n" + withCard + "\n");
    expect(parsed.readings).toHaveLength(1);
    expect(parsed.malformed).toEqual([withPath]);
  });

  test("its state is current by construction — no metadata answer can move it", () => {
    const reading = selectionReading("nights", SOURCE_SLUG, TAKEN);
    const changed: FileMetaAnswer = {
      kind: "facts",
      exists: true,
      is_file: true,
      len: 9999,
      modified_ms: Date.now() + 1_000_000,
    };
    expect(resolveReadingState(reading, null, Date.now())).toBe("current");
    expect(resolveReadingState(reading, changed, Date.now())).toBe("current");
    expect(
      resolveReadingState(reading, { kind: "refused", code: "io" }, Date.now()),
    ).toBe("current");
    expect(resolveReadingState(reading, { kind: "facts", exists: false, is_file: false, len: null, modified_ms: null }, Date.now())).toBe("current");
    expect(readingStateWord("current")).toBeNull();
  });

  test("NO file_meta is asked for a selection card (the hook stats files only)", async () => {
    const asked: string[] = [];
    const readings = [
      selectionReading("nights", SOURCE_SLUG, TAKEN),
      { on: "file", form: "path" as const, from: "notes/a.md", taken: TAKEN },
    ];
    const metas = await metasOf("/w/garden", readings, async (path) => {
      asked.push(path);
      return { kind: "facts", exists: true, is_file: true, len: 1, modified_ms: 0 };
    });
    expect(asked).toEqual(["/w/garden/notes/a.md"]);
    expect(metas.has("nights")).toBe(false);
    expect(HOOK).toContain("metasOf(workspacePath, readings.readings)");
    // PROVISIONAL — the stat rule is now `isStatableReading`: a folder card
    // IS stat'ed (its state says whether the place is still there), while a
    // selection is still skipped and never asks for a metadata answer.
    expect(HOOK).toContain("if (!isStatableReading(reading)) return;");
  });
});

describe("a card made the old way still works end to end", () => {
  test("it loads: the paragraph verbatim, the source unchanged", async () => {
    const workspace = freshWorkspace();
    await seedKeptSelection(workspace);
    const ground = await loadGround(workspace, groundIo);
    const readings = await loadReadings(workspace, readingIo);
    const texts = await loadReadingTexts(
      workspace,
      ground.references.map((reference) => reference.on),
      readingIo,
    );
    expect(ground.malformed).toEqual([]);
    expect(readings.malformed).toEqual([]);
    expect(ground.references.map((reference) => reference.on)).toEqual([
      "rain-gauge",
      "nights",
    ]);
    const selection = readingFor(readings.readings, "nights");
    expect(selection?.form).toBe("selection");
    expect(selection?.from).toBe("card://rain-gauge");
    expect(texts.nights).toBe(EXCERPT);
    expect(texts["rain-gauge"]).toBe("the source card's own reading\nsecond line\n");
  });

  test("it renders its provenance and its kind — and offers no making verb", () => {
    const selection: Reading = selectionReading("nights", SOURCE_SLUG, TAKEN);
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [
          { on: SOURCE_SLUG, name: SOURCE_NAME, x: 40, y: 60 },
          { on: "nights", name: "Nights", x: 360, y: 60 },
        ],
        readings: [
          { on: SOURCE_SLUG, form: "path", from: "notes/river.md", taken: TAKEN },
          selection,
        ],
        texts: { "rain-gauge": "the source", nights: EXCERPT },
        states: { "rain-gauge": "current", nights: "current" },
        onMove: async () => ({ ok: true as const }),
        onRefresh: async () => ({ ok: true as const }),
        onRepoint: async () => ({ ok: true as const }),
        onRemove: async () => ({ ok: true as const }),
      }),
    );
    expect(html).toContain("from Rain gauge");
    expect(html).toContain("a copy of text selected from Rain gauge");
    expect(html).not.toContain("card://");
    expect(html).not.toContain("notes/river.md");
    expect(html).not.toContain("make the card");
    expect(readingProvenance(selection, new Map([[SOURCE_SLUG, SOURCE_NAME]]))).toBe(
      "from Rain gauge",
    );
  });

  test("a missing source is said quietly, not treated as an error", () => {
    const selection: Reading = selectionReading("nights", SOURCE_SLUG, TAKEN);
    expect(readingProvenance(selection, new Map())).toBe(SELECTION_MISSING_SOURCE);
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [{ on: "nights", name: "Nights", x: 360, y: 60 }],
        readings: [selection],
        texts: { nights: EXCERPT },
        states: { nights: "current" },
        onMove: async () => ({ ok: true as const }),
        onRefresh: async () => ({ ok: true as const }),
        onRepoint: async () => ({ ok: true as const }),
        onRemove: async () => ({ ok: true as const }),
      }),
    );
    expect(html).toContain(SELECTION_MISSING_SOURCE);
    expect(html).not.toContain("card://");
  });

  test("the packet carries the excerpt; the ONE retrieval returns the same bytes", async () => {
    const workspace = freshWorkspace();
    await seedKeptSelection(workspace);
    const selection = selectionReading("nights", SOURCE_SLUG, TAKEN);
    const stored = readFileSync(readingTextPath(workspace, "nights"), "utf8");
    expect(stored).toBe(EXCERPT);

    const context = cardAskContext({
      name: "Nights",
      state: "current",
      reading: selection,
      readingText: stored,
      note: null,
    });
    expect(context.card.reading).toBe(previewText(EXCERPT));
    expect(context.retrievable).toEqual(["Nights"]);
    const packet = assembleCardPacket({
      question: "what does this say?",
      card: context.card,
      retrievable: context.retrievable,
    });
    expect(packet.text).toContain(EXCERPT);
    expect(packet.retrievable).toEqual(["Nights"]);

    const pulled = await fetchAskBlock(
      workspace,
      "Nights",
      context,
      {
        readTextHead: readingIo.readTextHead,
        canonicalize: async () => null,
        pull: pullReading,
        pullIo: {
          readTextHead: readingIo.readTextHead,
          readFileBytes: readingIo.readFileBytes,
          pdfText: readingIo.pdfText,
          readStoredText: async (path) => {
            try {
              return readFileSync(path, "utf8");
            } catch {
              return null;
            }
          },
        },
      },
    );
    expect(pulled).toBe(EXCERPT);
  });

  test("its pull reads ONLY the map's stored excerpt (no head, no stat)", async () => {
    const workspace = freshWorkspace();
    await seedKeptSelection(workspace);
    const calls: string[] = [];
    const io: PullIo = {
      readTextHead: async () => {
        calls.push("head");
        return EXCERPT_HEAD;
      },
      readFileBytes: async () => {
        calls.push("bytes");
        return { kind: "refused", code: "cannot-reach" };
      },
      pdfText: async () => {
        calls.push("pdf");
        return null;
      },
      readStoredText: async (path) => {
        calls.push("stored");
        return readFileSync(path, "utf8");
      },
    };
    const selection = selectionReading("nights", SOURCE_SLUG, TAKEN);
    const result = await pullReading(workspace, selection, 96 * 1024, io);
    expect(result).toEqual({ kind: "text", text: EXCERPT, truncated: false });
    expect(calls).toEqual(["stored"]);
    expect(pullStoredText(EXCERPT)).toEqual({
      kind: "text",
      text: EXCERPT,
      truncated: false,
    });
    const code = PULL.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    for (const forbidden of ["writeTextFile", "fileMeta", "removeFile", "createDirAll"]) {
      expect({ forbidden, found: code.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
  });

  test("remove then restore: the SAME bytes, the same two lines", async () => {
    const workspace = freshWorkspace();
    await seedKeptSelection(workspace);
    const ground = await loadGround(workspace, groundIo);
    const readings = await loadReadings(workspace, readingIo);
    const removed = await removeGroundRecords(
      workspace,
      "nights",
      ground.references,
      readings.readings,
      [],
      [],
      {
        saveGround: (workspacePath, references, malformed) =>
          saveGround(workspacePath, references, malformed, groundIo),
        saveReadings: (workspacePath, readings, malformed) =>
          saveReadings(workspacePath, readings, malformed, readingIo),
        removeFile: async (path) => {
          unlinkSync(path);
        },
        readTextFile: async (path) => readOrNull(path),
      },
    );
    expect(removed.refusal).toBeNull();
    expect(removed.removed).not.toBeNull();
    expect(() => statSync(readingTextPath(workspace, "nights"))).toThrow();
    expect(readFileSync(join(workspace, "map", "ground.txt"), "utf8")).not.toContain(
      "on: nights",
    );
    const afterRemoval = await loadReadings(workspace, readingIo);
    expect(readingFor(afterRemoval.readings, "nights")).toBeNull();

    const card = removed.removed!;
    const restored = await restoreGroundCard(
      workspace,
      card,
      removed.references,
      removed.readings,
      [],
      [],
      [],
      [],
      [],
      [],
      {
        saveGround: (workspacePath, references, malformed) =>
          saveGround(workspacePath, references, malformed, groundIo),
        saveReadings: (workspacePath, readings, malformed) =>
          saveReadings(workspacePath, readings, malformed, readingIo),
        saveGroundLinks: async () => undefined,
        saveMedia: async () => undefined,
        restoreReadingText: async (workspacePath, on, text) => {
          writeFileSync(readingTextPath(workspacePath, on), text, "utf8");
        },
        restoreNote: async () => undefined,
        restoreThumb: async () => undefined,
      },
    );
    expect(restored.didNot).toEqual([]);
    expect(readFileSync(readingTextPath(workspace, "nights"), "utf8")).toBe(EXCERPT);
    const groundAfter = await loadGround(workspace, groundIo);
    const readingsAfter = await loadReadings(workspace, readingIo);
    expect(groundAfter.malformed).toEqual([]);
    expect(readingsAfter.malformed).toEqual([]);
    const back = readingFor(readingsAfter.readings, "nights");
    expect(back).toEqual(selectionReading("nights", SOURCE_SLUG, TAKEN));
    expect(groundAfter.references.map((reference) => reference.on)).toEqual([
      "rain-gauge",
      "nights",
    ]);
  });

  test("a source still on the map names it; nothing references a removed feature", () => {
    // The layer's own kept lines: the form is read, not the verb.
    expect(LAYER).toContain('reading.form === "selection"');
    expect(LAYER).toContain("selectionSourceSlug(");
    expect(LAYER).toContain("ground-from");
    expect(LAYER).toContain("this is a copy; there is no file to refresh or point at.");
    // The verb's whole surface is gone from source. Comments may name it (the
    // house voice records what was removed and why), so the sweep reads CODE.
    const code = (text: string): string =>
      text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    for (const [name, text] of [
      ["GroundLayer", LAYER],
      ["App", APP],
      ["useGround", HOOK],
      ["gates", GATES],
      ["canvas.css", CSS],
    ] as const) {
      for (const gone of [
        "ground-select-ask",
        "onCreateSelection",
        "createSelection",
        "selectionRefusal",
        "proposeSelectionName",
        "SELECTION_NAME_REFUSAL",
        "SELECTION_EMPTY_REFUSAL",
        "selectionPlacement",
      ]) {
        expect({ name, gone, found: code(text).includes(gone) }).toEqual({
          name,
          gone,
          found: false,
        });
      }
    }
    expect(LAYER).not.toContain("selectionchange");
    expect(LAYER).toContain("ground-selection ground-ask-naming");
    // The kept form is still declared where every parser reads it.
    expect(source("map/readings.ts")).toContain('"selection",');
  });
});

describe("content classes: the form's own stay, the verb's alone went", () => {
  test("a kept selection card's classes are content to the plane's gate", () => {
    for (const name of [
      "ground-selection",
      "ground-selection-name",
      "ground-selection-actions",
      "ground-selection-make",
      "ground-selection-cancel",
      "ground-from",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
    // The removed verb's class is not a gate, a style, or a string anywhere.
    expect(CONTENT_CLASSES).not.toContain("ground-select-ask" as never);
    // Comments may name the removed rule; the sheet's CODE must not style it.
    const cssCode = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
    expect(cssCode).not.toContain(".ground-select-ask");
    expect(CSS).toContain(".ground-handle.ground-from");
    expect(CSS).toContain(".ground-selection {");
  });

  test("the ground map still renders no concept content, and no counters", () => {
    expect(renderedMapContent("ground")).toEqual([]);
    const layer = LAYER.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(layer).not.toMatch(
      /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|backlog|total|points)\b/i,
    );
  });
});
