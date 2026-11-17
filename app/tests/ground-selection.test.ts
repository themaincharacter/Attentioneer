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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GroundLayer,
  readingProvenance,
  SELECTION_MISSING_SOURCE,
  selectionPlacement,
} from "../src/canvas/GroundLayer";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { metasOf, writeSelectionCard, type SelectionIo } from "../src/canvas/useGround";
import {
  addGroundReference,
  groundPath,
  loadGround,
  saveGround,
  type GroundIo,
  type GroundReference,
} from "../src/map/ground";
import {
  isSelectionProvenance,
  loadReadingTexts,
  loadReadings,
  parseReadingLine,
  parseReadings,
  previewText,
  proposeSelectionName,
  readingFor,
  readingStateWord,
  readingTextPath,
  readingsPath,
  resolveReadingState,
  saveReadings,
  SELECTION_EMPTY_REFUSAL,
  SELECTION_NAME_REFUSAL,
  selectionProvenance,
  selectionReading,
  selectionRefusal,
  selectionSourceSlug,
  serializeReadingLine,
  storeSelectionText,
  type Reading,
  type ReadingIo,
} from "../src/map/readings";
import { pullStoredText, pullReading, type PullIo } from "../src/map/pull";
import { assembleCardPacket } from "../src/turn/packet";
import { cardAskContext, fetchAskBlock } from "../src/turn/context";
import { clipHead } from "../src/lib/headBounds";
import type { FileMetaAnswer, TextHead } from "../src/lib/fs";

/**
 * Story 16.12 — a selection becomes a card.
 *
 * The story's check is human ("select a paragraph of an expanded card's
 * reading, press ask about this, name the new card, confirm: a card appears
 * beside the original holding exactly that paragraph and saying it came from
 * the first card; reopen: both are there and the original is unchanged byte
 * for byte"). This file pins the rules underneath it:
 *
 *   - `form: selection` is a READING KIND with no source file: `from` is
 *     provenance (`card://<source>`), a path is REFUSED, the state is `current`
 *     by construction and no `file_meta` is ever asked for one;
 *   - the bytes are the selection EXACTLY (compared with `toBe`, not a
 *     containment) and the source card's files are byte-identical after;
 *   - the name is proposed (first few words, cropped) and the person confirms;
 *     a blank name refuses and writes nothing; collisions dedupe the house way;
 *   - the new card goes BESIDE its source and its footer names the source CARD
 *     (never a path), with a missing source said quietly;
 *   - the packet carries the excerpt and the ONE retrieval returns the same
 *     bytes; the pull reads the map's own stored excerpt and nothing else.
 *
 * PROVISIONAL: the `card://` provenance spelling, the proposed-name crop, the
 * placement offset and the quiet provenance sentence.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const HOOK = source("canvas/useGround.ts");
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

const groundIo: GroundIo = {
  readTextFile: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
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

const EXCERPT_HEAD: TextHead = {
  head: "",
  truncated: false,
  exists: false,
  size: null,
  mtime: null,
  decode: "clean",
};

const readingIo: ReadingIo = {
  ...groundIo,
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

/** The selection's real write path, with the ORDER logged. */
function selectionIo(log: string[]): SelectionIo {
  return {
    storeSelectionText: async (workspace, on, text) => {
      log.push("text");
      await storeSelectionText(workspace, on, text, readingIo);
    },
    saveReadings: async (workspace, readings, malformed) => {
      log.push("readings");
      await saveReadings(workspace, readings, malformed ?? [], readingIo);
    },
    saveGround: async (workspace, references, malformed) => {
      log.push("ground");
      await saveGround(workspace, references, malformed ?? [], groundIo);
    },
  };
}

/** Seed the source card the way the app's own add wrote it. */
async function seedSource(workspace: string): Promise<{
  reference: GroundReference;
  reading: Reading;
}> {
  const sourceText = "the source card's own reading\nsecond line\n";
  mkdirSync(dirname(readingTextPath(workspace, SOURCE_SLUG)), { recursive: true });
  writeFileSync(readingTextPath(workspace, SOURCE_SLUG), sourceText, "utf8");
  const reference: GroundReference = { on: SOURCE_SLUG, name: SOURCE_NAME, x: 40, y: 60 };
  const reading: Reading = {
    on: SOURCE_SLUG,
    form: "path",
    from: "notes/river.md",
    taken: TAKEN,
    bytes: Buffer.byteLength(sourceText),
    extract: "text",
  };
  await saveGround(workspace, [reference], [], groundIo);
  await saveReadings(workspace, [reading], [], readingIo);
  return { reference, reading };
}

/** Every file under a folder, by relative name, as exact bytes (base64). */
function snapshotFolder(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const name of readdirSync(root, { recursive: true }).map(String).sort()) {
    const full = join(root, name);
    if (statSync(full).isFile()) files[name] = readFileSync(full).toString("base64");
  }
  return files;
}

describe("the form: a reading with no source file", () => {
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
    // No bytes tail, no extractor tail: nothing beside a selection can be
    // compared, so nothing is invented.
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
    // The hook's load path really calls this helper (not its own stat loop).
    expect(HOOK).toContain("metasOf(workspacePath, readings.readings)");
    expect(HOOK).toContain('if (reading.form === "selection") return;');
  });
});

describe("making the card: the bytes exactly, in the house order", () => {
  test("the excerpt is written VERBATIM, then the readings line, then the card", async () => {
    const workspace = freshWorkspace();
    await seedSource(workspace);
    const log: string[] = [];
    const written = await writeSelectionCard(
      workspace,
      [{ on: SOURCE_SLUG, name: SOURCE_NAME, x: 40, y: 60 }],
      [],
      [],
      [],
      SOURCE_SLUG,
      "Nights",
      360,
      60,
      EXCERPT,
      TAKEN,
      selectionIo(log),
    );
    // THE ORDER (the house order): text file, readings line, ground line.
    expect(log).toEqual(["text", "readings", "ground"]);
    expect(written.reading.on).toBe("nights");
    // Not a containment: the stored bytes ARE the selection.
    expect(readFileSync(readingTextPath(workspace, "nights"), "utf8")).toBe(EXCERPT);
    expect(readFileSync(readingTextPath(workspace, "nights"), "utf8")).not.toBe(
      EXCERPT.trim(),
    );
    expect(readFileSync(groundPath(workspace), "utf8")).toContain(
      "on: nights | name: Nights | x: 360 | y: 60",
    );
    expect(readFileSync(readingsPath(workspace), "utf8")).toContain(
      "on: nights | form: selection | from: card://rain-gauge | taken: " + TAKEN,
    );
    expect(written.reading.form).toBe("selection");
    expect(written.reading.from).toBe("card://rain-gauge");
    expect(written.reading.bytes).toBeUndefined();
  });

  test("a reopen rebuilds both cards; the new one still holds the paragraph", async () => {
    const workspace = freshWorkspace();
    const seeded = await seedSource(workspace);
    await writeSelectionCard(
      workspace,
      [seeded.reference],
      [seeded.reading],
      [],
      [],
      SOURCE_SLUG,
      "Nights",
      360,
      60,
      EXCERPT,
      TAKEN,
      selectionIo([]),
    );
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
    expect(selection).not.toBeNull();
    expect(selection?.form).toBe("selection");
    expect(selection?.from).toBe("card://rain-gauge");
    expect(texts.nights).toBe(EXCERPT);
    // The SOURCE card is exactly as it was: its reading and text unchanged.
    const source = readingFor(readings.readings, "rain-gauge");
    expect(source).toEqual(seeded.reading);
    expect(texts["rain-gauge"]).toBe(
      "the source card's own reading\nsecond line\n",
    );
  });

  test("the source card is never modified: a folder snapshot proves it per file", async () => {
    const workspace = freshWorkspace();
    const seeded = await seedSource(workspace);
    const before = snapshotFolder(workspace);
    const sourceTextBytes = readFileSync(
      readingTextPath(workspace, SOURCE_SLUG),
      "utf8",
    );
    await writeSelectionCard(
      workspace,
      [seeded.reference],
      [seeded.reading],
      [],
      [],
      SOURCE_SLUG,
      "Nights",
      360,
      60,
      EXCERPT,
      TAKEN,
      selectionIo([]),
    );
    const after = snapshotFolder(workspace);
    // The excerpt's own text file is the ONLY new file.
    expect(Object.keys(after).sort()).toEqual(
      [...Object.keys(before), "map/readings/nights.md"].sort(),
    );
    // The two record files gained a line AFTER the source's; they are not
    // rewritten under it (the earlier bytes are an exact byte PREFIX).
    const isPrefix = (before64: string, after64: string): boolean => {
      const from = Buffer.from(before64, "base64");
      return from.equals(
        Buffer.from(after64, "base64").subarray(0, from.length),
      );
    };
    expect(isPrefix(before["map/ground.txt"]!, after["map/ground.txt"]!)).toBe(true);
    expect(isPrefix(before["map/readings.txt"]!, after["map/readings.txt"]!)).toBe(true);
    // Only the two record files changed; nothing else in the folder did.
    expect(
      Object.keys(before)
        .filter((name) => after[name] !== before[name])
        .sort(),
    ).toEqual(["map/ground.txt", "map/readings.txt"]);
    // The source's own text file is byte-identical.
    expect(after["map/readings/rain-gauge.md"]).toBe(before["map/readings/rain-gauge.md"]);
    expect(readFileSync(readingTextPath(workspace, SOURCE_SLUG), "utf8")).toBe(
      sourceTextBytes,
    );
  });

  test("a name collision dedupes like every other slug", async () => {
    const workspace = freshWorkspace();
    const seeded = await seedSource(workspace);
    const first = await writeSelectionCard(
      workspace, [seeded.reference], [seeded.reading], [], [],
      SOURCE_SLUG, "Nights", 360, 60, "first", TAKEN, selectionIo([]),
    );
    const second = await writeSelectionCard(
      workspace, first.references, first.readings, [], [],
      SOURCE_SLUG, "Nights", 680, 60, "second", TAKEN, selectionIo([]),
    );
    expect(first.reading.on).toBe("nights");
    expect(second.reading.on).toBe("nights-2");
    expect(second.reading.from).toBe("card://rain-gauge");
    // The first card and its bytes are untouched by the second.
    expect(readFileSync(readingTextPath(workspace, "nights"), "utf8")).toBe("first");
    const ground = await loadGround(workspace, groundIo);
    expect(ground.references.map((reference) => reference.on)).toEqual([
      "rain-gauge",
      "nights",
      "nights-2",
    ]);
    // The slug rule is the map's own: nextSlug against the taken slugs.
    const admitted = addGroundReference(first.references, "Nights", 0, 0);
    expect(admitted.reference.on).toBe("nights-2");
  });

  test("a blank name refuses with one sentence and writes nothing", () => {
    expect(selectionRefusal("   ", EXCERPT)).toBe(SELECTION_NAME_REFUSAL);
    expect(SELECTION_NAME_REFUSAL).toBe("name it first.");
    expect(selectionRefusal("Nights", "")).toBe(SELECTION_EMPTY_REFUSAL);
    expect(selectionRefusal("Nights", EXCERPT)).toBeNull();
    // The hook refuses BEFORE the queue: a blank name cannot reach a writer.
    const block = HOOK.slice(
      HOOK.indexOf("const createSelection = useCallback("),
      HOOK.indexOf("MOVE: one ground-line write on drop"),
    );
    const guard = block.indexOf("selectionRefusal(");
    const queue = block.indexOf("queueRef.current");
    expect(guard).toBeGreaterThan(0);
    expect(queue).toBeGreaterThan(guard);
    expect(block).toContain("Promise.resolve({ ok: false, message: refusal })");
  });

  test("the proposed name is the selection's first few words, cropped", () => {
    expect(proposeSelectionName("  the river falls slowly after the rain  ")).toBe(
      "the river falls slowly after the…",
    );
    expect(proposeSelectionName("two words")).toBe("two words");
    expect(proposeSelectionName("   ")).toBe("");
    // The proposal's whitespace collapse never touches the BYTES (above).
    expect(proposeSelectionName("a\n\nb\t c")).toBe("a b c");
  });
});

describe("the card says where it came from — a NAME, never a path", () => {
  const selection: Reading = selectionReading("nights", SOURCE_SLUG, TAKEN);
  const names = new Map([[SOURCE_SLUG, SOURCE_NAME]]);

  test("a selection's footer names the source card", () => {
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
    expect(html).not.toContain("card://");
    expect(html).not.toContain("notes/river.md");
    expect(readingProvenance(selection, names)).toBe("from Rain gauge");
  });

  test("a missing source is said quietly, not treated as an error", () => {
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

  test("the new card is placed BESIDE its source, never overlapping", () => {
    expect(selectionPlacement(40, 60)).toEqual({ x: 360, y: 60 });
    const at = selectionPlacement(40, 60);
    expect(at.x).toBeGreaterThan(40 + 300);
    expect(at.y).toBe(60);
    expect(LAYER_SOURCE()).toContain("selectionPlacement(reference.x, reference.y)");
  });
});

/** The layer's source, for the placement's one call site. */
function LAYER_SOURCE(): string {
  return source("canvas/GroundLayer.tsx");
}

describe("the packet carries the excerpt; the ONE retrieval returns it", () => {
  const selection: Reading = selectionReading("nights", SOURCE_SLUG, TAKEN);

  test("the packet rides the selection and its retrieval is the same bytes", async () => {
    const workspace = freshWorkspace();
    const seeded = await seedSource(workspace);
    await writeSelectionCard(
      workspace, [seeded.reference], [seeded.reading], [], [],
      SOURCE_SLUG, "Nights", 360, 60, EXCERPT, TAKEN, selectionIo([]),
    );
    const stored = readFileSync(readingTextPath(workspace, "nights"), "utf8");
    expect(stored).toBe(EXCERPT);

    const context = cardAskContext({
      name: "Nights",
      state: "current",
      reading: selection,
      readingText: stored,
      note: null,
    });
    // The packet rides the card's CROP (the six-line preview the packet
    // already uses); the ONE retrieval below returns the exact bytes.
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

  test("a selection's pull reads ONLY the map's stored excerpt (no head, no stat)", async () => {
    const workspace = freshWorkspace();
    await seedSource(workspace);
    await storeSelectionText(workspace, "nights", EXCERPT, readingIo);
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
    const result = await pullReading(workspace, selection, 96 * 1024, io);
    expect(result).toEqual({ kind: "text", text: EXCERPT, truncated: false });
    // No source is located, read or extracted: the map's own bytes are all.
    expect(calls).toEqual(["stored"]);
    // The pure reader keeps the bytes exactly under a wide budget.
    expect(pullStoredText(EXCERPT)).toEqual({
      kind: "text",
      text: EXCERPT,
      truncated: false,
    });
    // The pull module holds no writer and no stat.
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
});

describe("the selection surface: one affordance, and nothing else changes", () => {
  test("the affordance is ONE quiet verb that only proposes a name", () => {
    const layer = LAYER_SOURCE();
    const code = layer.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(layer).toContain("ask about this");
    expect(layer).toContain("ground-select-ask");
    expect(layer).toContain("selectionchange");
    expect(layer).toContain("selectionRefusal(");
    expect(layer).toContain("proposeSelectionName(");
    expect(layer).toContain("make the card");
    // No floating toolbar, no model, no counters, no nudges.
    expect(code).not.toMatch(/floating|toolbar|badge|streak|score/i);
    expect(code).not.toMatch(/invoke\(|fetch\(|readTextHead|fileMeta/);
    // A closed card has no selection surface at all.
    expect(layer).toContain("if (!open) return;");
  });

  test("the new parts are content to the plane's gate", () => {
    for (const name of [
      "ground-select-ask",
      "ground-selection",
      "ground-selection-name",
      "ground-selection-actions",
      "ground-selection-make",
      "ground-selection-cancel",
      "ground-from",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
  });

  test("the ground map still renders no concept content, and no counters", () => {
    expect(renderedMapContent("ground")).toEqual([]);
    const layer = LAYER_SOURCE().replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(layer).not.toMatch(
      /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|backlog|total|points)\b/i,
    );
  });
});
