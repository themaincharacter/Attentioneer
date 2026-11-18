import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GroundConceptPanel,
  GroundNote,
  CONCEPT_PANEL_LINES,
} from "../src/canvas/GroundNote";
import { GroundLayer } from "../src/canvas/GroundLayer";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  applyMention,
  mentionChoices,
  mentionTrigger,
  MentionPicker,
  nextActive,
  pickerCommand,
} from "../src/canvas/MentionPicker";
import {
  CONCEPT_WORD_IO,
  listConceptWords,
  loadConceptWord,
  type ConceptWord,
  type ConceptWordIo,
} from "../src/map/conceptWords";
import {
  cropSegments,
  isMentionSlug,
  mentionDangling,
  mentionKey,
  parseMention,
  parseMentions,
  serializeMention,
  type NoteSegment,
} from "../src/map/mentions";
import { loadNote, NOTE_PREVIEW_LINES, notePath, saveNote, type NoteIo } from "../src/map/notes";
import { previewText } from "../src/map/readings";
import { referencePath, referencesDir } from "../src/map/refs";
import type { GroundReference } from "../src/map/ground";

/**
 * Story 16.7 — MENTIONS IN THE NOTE.
 *
 * The story's check is human (type `@`, pick another card: a chip appears and
 * opens it; type `@` again, pick a concept word: a differently styled chip shows
 * the concept's name and memory read-only; quit and reopen: both survive and
 * work; delete the card a `card://` chip names: the chip goes quiet). This file
 * pins the rules underneath it:
 *
 *   - the syntax is PLAIN TEXT: parse/serialize round-trip, labels with
 *     brackets, slugs with dashes, and a malformed mention stays text;
 *   - a hand-edited label is the person's words, and the slug stays the identity;
 *   - the crop keeps chips whole and says one ellipsis (never a second truth);
 *   - a chip whose target is gone dangles: muted, "missing", a deliberate no-op;
 *   - the picker's trigger boundary, filter, ordering and keys are pure rules;
 *   - the ONE cross-map read reads `map/references/<slug>.md` read-only and
 *     writes NOTHING (the whole workspace is snapshotted);
 *   - a note with mentions survives byte-exactly through the EXISTING save path;
 *   - the card's earlier behaviours are still wired (drag, link, confirm,
 *     refresh, re-point, note edit) and no counter nudges anything.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the chip look, the panel's crop, the
 * picker's ordering and keys, and the "missing" wording.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const LAYER = source("canvas/GroundLayer.tsx");
const NOTE_FACE = source("canvas/GroundNote.tsx");
const PICKER = source("canvas/MentionPicker.tsx");
const MENTIONS = source("map/mentions.ts");
const CONCEPTS = source("map/conceptWords.ts");
const APP = source("App.tsx");
const CSS = source("canvas/canvas.css");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-mentions-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

/** The record bridges, bound to node's fs so a test needs no Tauri. */
const fsIo: NoteIo = {
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
  createDirAll: async (path) => {
    mkdirSync(path, { recursive: true });
  },
  listDir: async (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  removeFile: async (path) => {
    try {
      rmSync(path);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  },
};

const conceptIo: ConceptWordIo = {
  readTextFile: fsIo.readTextFile,
  listDir: fsIo.listDir,
};

/** Every file in the workspace, relative to its root, with exact bytes. */
function snapshotFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const rel of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    try {
      files[rel.replaceAll("\\", "/")] = readFileSync(join(root, rel), "utf8");
    } catch {
      // A directory: not a file, not a snapshot entry.
    }
  }
  return files;
}

/** A concept reference, written by hand the way the concept map keeps one. */
function writeConcept(
  workspace: string,
  slug: string,
  name: string,
  memory: string,
): void {
  mkdirSync(referencesDir(workspace), { recursive: true });
  writeFileSync(
    referencePath(workspace, slug),
    `---\nname: ${name}\nx: 10\ny: 20\n---\n${memory}\n`,
    "utf8",
  );
}

const reference: GroundReference = {
  on: "rain-gauge",
  name: "Rain gauge",
  x: 40,
  y: 60,
};
const sea: GroundReference = {
  on: "sea",
  name: "Sea",
  x: 140,
  y: 160,
};

const CARD_MENTION = serializeMention("card", "sea", "Sea");
const WORD_MENTION = serializeMention("word", "attention", "Attention");

describe("the syntax: plain text in, plain text out", () => {
  test("serialize writes the full Slashspace-style form", () => {
    expect(serializeMention("card", "rain-gauge", "Rain gauge")).toBe(
      "[@Rain gauge](card://rain-gauge)",
    );
    expect(serializeMention("word", "attention", "Attention")).toBe(
      "[@Attention](word://attention)",
    );
    // The key is the identity; the label is only display text.
    expect(mentionKey("card", "sea")).toBe("card://sea");
    expect(mentionKey("word", "sea")).toBe("word://sea");
  });

  test("round-trips labels with brackets, and slugs with dashes", () => {
    const text = serializeMention("card", "rain-gauge-2", "a]b [c] d");
    const mention = parseMention(text);
    expect(mention).toEqual({
      kind: "card",
      slug: "rain-gauge-2",
      label: "a]b [c] d",
    });
    expect(serializeMention(mention!.kind, mention!.slug, mention!.label)).toBe(
      text,
    );
    // A backslash may also be written by hand and survives the same way.
    expect(parseMention("[@a\\\\b](word://attention)")?.label).toBe("a\\b");
  });

  test("a note splits into text and mentions, losslessly", () => {
    const text = `before ${CARD_MENTION} and ${WORD_MENTION} after\nsecond line`;
    const segments = parseMentions(text);
    expect(segments.filter((s) => s.kind === "mention")).toHaveLength(2);
    const rebuilt = segments
      .map((segment) =>
        segment.kind === "text"
          ? segment.text
          : serializeMention(
              segment.mention.kind,
              segment.mention.slug,
              segment.mention.label,
            ),
      )
      .join("");
    expect(rebuilt).toBe(text);
  });

  test("the mention is never confused with bare @word or an unknown scheme", () => {
    for (const text of [
      "see @attention soon",
      "[@Attention](rail://attention)",
      "[@Attention](word://)",
      "[@Attention](word://a/b)",
      "just [@Attention](word://attention",
      "[@Attention](word://attention)",
    ]) {
      const mentions = parseMentions(text).filter((s) => s.kind === "mention");
      if (text === "[@Attention](word://attention)") {
        expect(mentions).toHaveLength(1);
      } else {
        expect(mentions).toHaveLength(0);
      }
    }
    // A malformed mention is TEXT, displayed as written — never a crash.
    const broken = "a [@Broken](card://) b";
    expect(parseMentions(broken)).toEqual([{ kind: "text", text: broken }]);
  });

  test("the slug alphabet admits the minted slugs and no path separator", () => {
    for (const slug of ["sea", "rain-gauge", "rain-gauge-2", "café", "x_1.2~a"]) {
      expect(isMentionSlug(slug)).toBe(true);
    }
    for (const slug of ["", "-lead", "../escape", "a/b", "a b", "a)b"]) {
      expect(isMentionSlug(slug)).toBe(false);
    }
  });
});

describe("the dangling rule: gone is quiet, not an error", () => {
  const cards = new Set(["sea", "rain-gauge"]);
  const words = new Set(["attention"]);

  test("a card or word whose target is gone dangles", () => {
    expect(mentionDangling("card", "sea", cards, words)).toBe(false);
    expect(mentionDangling("card", "gone", cards, words)).toBe(true);
    expect(mentionDangling("word", "attention", cards, words)).toBe(false);
    expect(mentionDangling("word", "gone", cards, words)).toBe(true);
    // Not read yet is IGNORANCE, never "dangling".
    expect(mentionDangling("word", "attention", cards, null)).toBe(false);
  });

  test("the dangling chip is muted, says missing, and is a no-op", () => {
    const html = renderToStaticMarkup(
      createElement(GroundNote, {
        text: `a ${serializeMention("card", "gone", "Gone")} b`,
        maxLines: null,
        cardNames: new Map([["rain-gauge", "Rain gauge"]]),
        wordSlugs: new Set<string>(),
        onOpenCard: () => {},
        onOpenWord: () => {},
      }),
    );
    expect(html).toContain("ground-mention card dangling");
    expect(html).toContain('title="missing"');
    expect(html).toContain("missing");
    // It is still the person's text: the label is shown, not erased.
    expect(html).toContain("Gone");
    expect(html).not.toContain("error");
  });

  test("a concept reference deleted since the load makes the word chip dangle", async () => {
    const workspace = freshWorkspace();
    writeConcept(workspace, "attention", "Attention", "The scarce resource.");
    expect((await loadConceptWord(workspace, "attention", conceptIo))?.name).toBe(
      "Attention",
    );
    // A missing FILE is the same honest absence the chip must survive.
    expect(await loadConceptWord(workspace, "gone", conceptIo)).toBeNull();
    // And a slug a mention could not name never reaches the disk at all.
    let reads = 0;
    const counting: ConceptWordIo = {
      readTextFile: async (path) => {
        reads += 1;
        return fsIo.readTextFile(path);
      },
      listDir: fsIo.listDir,
    };
    expect(await loadConceptWord(workspace, "../secret", counting)).toBeNull();
    expect(reads).toBe(0);
  });

  test("live chips render their two distinct kinds", () => {
    const html = renderToStaticMarkup(
      createElement(GroundNote, {
        text: `a ${CARD_MENTION} b ${WORD_MENTION} c`,
        maxLines: null,
        cardNames: new Map([["sea", "Sea"]]),
        wordSlugs: new Set(["attention"]),
        onOpenCard: () => {},
        onOpenWord: () => {},
      }),
    );
    expect(html).toContain("ground-mention card");
    expect(html).toContain("ground-mention word");
    expect(html).not.toContain("dangling");
    expect(html).not.toContain("missing");
  });
});

describe("the crop: the small face keeps a chip whole", () => {
  test("a plain note crops exactly like the reading preview", () => {
    for (const text of [
      "one\ntwo\nthree",
      "one\ntwo\n",
      "one\ntwo",
      "one",
      "one\n\ntwo",
    ]) {
      const segments = cropSegments(parseMentions(text), NOTE_PREVIEW_LINES);
      const shown = segments
        .map((segment) => (segment.kind === "text" ? segment.text : ""))
        .join("");
      expect(shown).toBe(previewText(text, NOTE_PREVIEW_LINES));
    }
  });

  test("a chip on the first line is kept; one past the crop is not shown", () => {
    const first = cropSegments(
      parseMentions(`hello ${CARD_MENTION}\ntwo\nthree`),
      NOTE_PREVIEW_LINES,
    );
    expect(first.filter((s) => s.kind === "mention")).toHaveLength(1);
    expect(first.some((s) => s.kind === "text" && s.text.endsWith("…"))).toBe(
      true,
    );
    const beyond = cropSegments(
      parseMentions(`one\ntwo\nthree ${CARD_MENTION}`),
      NOTE_PREVIEW_LINES,
    );
    expect(beyond.filter((s) => s.kind === "mention")).toHaveLength(0);
    // null is "the whole note": the expanded face crops nothing.
    const whole = parseMentions(`one\ntwo\nthree ${CARD_MENTION}`);
    expect(cropSegments(whole, null)).toEqual(whole as NoteSegment[]);
  });
});

describe("the picker: @ at a boundary, cards first, concepts marked", () => {
  test("the trigger is a boundary rule, not every @", () => {
    expect(mentionTrigger("@", 1)).toEqual({ query: "", start: 0 });
    expect(mentionTrigger("hello @ra", 9)).toEqual({ query: "ra", start: 6 });
    expect(mentionTrigger("line one\n@", 10)).toEqual({ query: "", start: 9 });
    expect(mentionTrigger("mail me@host", 12)).toBeNull();
    // Inside a mention's own label the list stays closed (no re-picking loop).
    expect(mentionTrigger("[@Ra", 4)).toBeNull();
    expect(mentionTrigger("@foo bar", 8)).toBeNull();
  });

  const cards = [
    { slug: "sea", name: "Sea" },
    { slug: "rain-gauge", name: "Rain gauge" },
  ];
  const words: ConceptWord[] = [
    { slug: "attention", name: "Attention", memory: "the scarce resource" },
    { slug: "river", name: "River", memory: "a flow" },
  ];

  test("cards come first, the concept words after, marked", () => {
    const all = mentionChoices(cards, words, "", null);
    expect(all.map((choice) => `${choice.kind}:${choice.slug}`)).toEqual([
      "card:sea",
      "card:rain-gauge",
      "word:attention",
      "word:river",
    ]);
    // The card being edited is not offered: a self-mention opens nothing new.
    expect(mentionChoices(cards, words, "", "sea").map((c) => c.slug)).not.toContain(
      "sea",
    );
  });

  test("typing filters by name or slug, case-insensitively", () => {
    expect(mentionChoices(cards, words, "ra").map((c) => c.slug)).toEqual([
      "rain-gauge",
    ]);
    expect(mentionChoices(cards, words, "ATT").map((c) => c.slug)).toEqual([
      "attention",
    ]);
    expect(mentionChoices(cards, words, "zzz")).toEqual([]);
  });

  test("insertion replaces the typed @query and writes the full form", () => {
    const text = "see @ra here";
    const trigger = mentionTrigger(text, 7);
    expect(trigger).not.toBeNull();
    const applied = applyMention(text, trigger!.start, 7, {
      kind: "word",
      slug: "attention",
      label: "Attention",
    });
    expect(applied.text).toBe("see [@Attention](word://attention) here");
    expect(applied.text.slice(applied.caret)).toBe("here");
    // A space already there is not doubled.
    const spaced = applyMention("a @b", 2, 4, {
      kind: "card",
      slug: "sea",
      label: "Sea",
    });
    expect(spaced.text).toBe("a [@Sea](card://sea)");
  });

  test("the keys: arrows walk, Enter/Tab insert, Esc closes only the list", () => {
    expect(pickerCommand("ArrowDown")).toBe("next");
    expect(pickerCommand("ArrowUp")).toBe("prev");
    expect(pickerCommand("Enter")).toBe("insert");
    expect(pickerCommand("Tab")).toBe("insert");
    expect(pickerCommand("Escape")).toBe("close");
    expect(pickerCommand("a")).toBeNull();
    expect(nextActive("next", 2, 3)).toBe(0);
    expect(nextActive("prev", 0, 3)).toBe(2);
    expect(nextActive("next", 0, 0)).toBe(0);
  });

  test("the list renders cards, marks concepts, and says when it is empty", () => {
    const html = renderToStaticMarkup(
      createElement(MentionPicker, {
        choices: mentionChoices(cards, words, "", null),
        active: 0,
        onPick: () => {},
      }),
    );
    expect(html).toContain('role="listbox"');
    expect(html).toContain("Rain gauge");
    expect(html).toContain("concept");
    expect(html).toContain('aria-selected="true"');
    const empty = renderToStaticMarkup(
      createElement(MentionPicker, { choices: [], active: 0, onPick: () => {} }),
    );
    expect(empty).toContain("ground-mention-empty");
  });
});

describe("the one cross-map read: name and memory, read-only", () => {
  test("reads a concept reference's name and memory", async () => {
    const workspace = freshWorkspace();
    writeConcept(workspace, "attention", "Attention", "The scarce resource.\nSecond line.");
    const word = await loadConceptWord(workspace, "attention", conceptIo);
    expect(word).toEqual({
      slug: "attention",
      name: "Attention",
      memory: "The scarce resource.\nSecond line.\n",
    });
    // A hand-written reference with no name is shown by its slug, never blank.
    mkdirSync(referencesDir(workspace), { recursive: true });
    writeFileSync(referencePath(workspace, "nameless"), "---\nx: 1\n---\nprose");
    expect((await loadConceptWord(workspace, "nameless", conceptIo))?.name).toBe(
      "nameless",
    );
  });

  test("lists every .md reference, sorted by name, ignoring the rest", async () => {
    const workspace = freshWorkspace();
    writeConcept(workspace, "river", "River", "a flow");
    writeConcept(workspace, "attention", "Attention", "the scarce resource");
    writeFileSync(join(referencesDir(workspace), "notes.txt"), "not a reference");
    const words = await listConceptWords(workspace, conceptIo);
    expect(words.map((word) => word.slug)).toEqual(["attention", "river"]);
    // A fresh workspace has no folder: an empty list, never an error.
    expect(await listConceptWords(freshWorkspace(), conceptIo)).toEqual([]);
  });

  test("the read changes NOTHING in the workspace", async () => {
    const workspace = freshWorkspace();
    writeConcept(workspace, "attention", "Attention", "the scarce resource");
    writeConcept(workspace, "river", "River", "a flow");
    await saveNote(workspace, "rain-gauge", `see ${WORD_MENTION}`, fsIo);
    const before = snapshotFiles(workspace);
    await listConceptWords(workspace, conceptIo);
    await loadConceptWord(workspace, "attention", conceptIo);
    await loadConceptWord(workspace, "gone", conceptIo);
    renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [],
        texts: {},
        notes: { "rain-gauge": `see ${WORD_MENTION} and ${CARD_MENTION}` },
        states: { "rain-gauge": "unread" },
        workspacePath: workspace,
        onMove: async () => ({ ok: true as const }),
        onRefresh: async () => ({ ok: true as const }),
        onRepoint: async () => ({ ok: true as const }),
        onRemove: async () => ({ ok: true as const }),
      }),
    );
    expect(snapshotFiles(workspace)).toEqual(before);
  });
});

describe("the note: mentions are text, and the existing save path is the only write", () => {
  test("a note with mentions survives byte-exactly", async () => {
    const workspace = freshWorkspace();
    const text = `first ${CARD_MENTION}\nsecond ${WORD_MENTION} | pipe\n`;
    await saveNote(workspace, "rain-gauge", text, fsIo);
    expect(readFileSync(notePath(workspace, "rain-gauge"), "utf8")).toBe(text);
    expect(await loadNote(workspace, "rain-gauge", fsIo)).toBe(text);
    // A hand edit keeps its words; the slash digit is not touched either.
    writeFileSync(notePath(workspace, "rain-gauge"), `hand [@mine](card://sea)\r\n`);
    expect(await loadNote(workspace, "rain-gauge", fsIo)).toBe(
      "hand [@mine](card://sea)\r\n",
    );
  });

  test("mentions are the ONLY content: no record, no copy, no backlink", () => {
    // The mention modules reach for reads and nothing else.
    for (const [name, code] of [
      ["mentions", MENTIONS],
      ["conceptWords", CONCEPTS],
      ["GroundNote", NOTE_FACE],
      ["MentionPicker", PICKER],
    ] as const) {
      const stripped = code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of [
        "writeTextFile",
        "saveNote",
        "saveGround",
        "saveReadings",
        "createDirAll",
        "removeFile",
        "writeQueue",
      ]) {
        expect({ name, forbidden, found: stripped.includes(forbidden) }).toEqual({
          name,
          forbidden,
          found: false,
        });
      }
    }
    // The cross-map helper imports the reference file's READ grammar only.
    expect(CONCEPTS).toContain("parseReference");
    expect(CONCEPTS).toContain("readTextFile");
    expect(CONCEPTS).toContain("listDir");
    // And the parser never reaches a reader at all.
    expect(MENTIONS).not.toContain("../lib/fs");
  });

  test("the concept panel shows name and a cropped memory, and writes nothing", () => {
    const memory = Array.from({ length: CONCEPT_PANEL_LINES + 4 }, (_, i) =>
      `memory line ${i + 1}`,
    ).join("\n");
    const html = renderToStaticMarkup(
      createElement(GroundConceptPanel, {
        name: "Attention",
        memory,
        onClose: () => {},
      }),
    );
    expect(html).toContain("ground-concept-panel");
    expect(html).toContain("Attention");
    expect(html).toContain(`memory line ${CONCEPT_PANEL_LINES}…`);
    expect(html).not.toContain(`memory line ${CONCEPT_PANEL_LINES + 1}`);
    expect(html).toContain("ground-concept-close");
    // Cropped like a reading, by the same pure helper.
    expect(previewText(memory, CONCEPT_PANEL_LINES)).toContain("…");
  });
});

describe("the card: a chip opens a card, and nothing else changed", () => {
  const inertVerbs = {
    onMove: async () => ({ ok: true as const }),
    onRefresh: async () => ({ ok: true as const }),
    onRepoint: async () => ({ ok: true as const }),
    onRemove: async () => ({ ok: true as const }),
  };

  test("the note renders chips inside the card, above the reading", () => {
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference, sea],
        readings: [
          {
            on: "rain-gauge",
            form: "path",
            from: "gauge.txt",
            taken: "2026-11-17T12:00:00.000Z",
          },
        ],
        texts: { "rain-gauge": "the reading" },
        notes: { "rain-gauge": `links to ${CARD_MENTION}` },
        states: { "rain-gauge": "current", sea: "unread" },
        ...inertVerbs,
      }),
    );
    expect(html).toContain("ground-note");
    expect(html).toContain("ground-mention card");
    expect(html).toContain("Sea");
    expect(html.indexOf("ground-note")).toBeLessThan(
      html.indexOf("ground-reading"),
    );
  });

  test("opening is the layer's VIEW state: a chip can open another card", () => {
    // The opened slug is plain view state; every card's face reads it.
    expect(LAYER).toContain("const [openOn, setOpenOn] = useState<string | null>(null)");
    expect(LAYER).toContain("open={openOn === reference.on}");
    // STORY 17.1 widens the same seam: opening a card also closes an ask
    // card's editor, so the plane never offers two faces at once.
    expect(LAYER).toContain("onOpenCard={(slug) => {");
    expect(LAYER).toContain("setOpenOn(slug)");
    // A card's own press opens it through the same seam (no second truth).
    expect(LAYER).toContain("onOpen();");
    // The open path never reaches a writer: it is state and nothing else.
    const openBlock = LAYER.slice(
      LAYER.indexOf("const [openOn"),
      LAYER.indexOf("const [concepts"),
    );
    for (const forbidden of ["save", "write", "queue", "remove"]) {
      expect(openBlock).not.toContain(forbidden);
    }
    // A mention's click is the chip's own: a card-mention press opens that
    // card; a dangling one is a deliberate no-op.
    expect(NOTE_FACE).toContain("if (dangling) return;");
    expect(NOTE_FACE).toContain("onOpenCard(mention.slug)");
    expect(NOTE_FACE).toContain("onOpenWord(mention.slug, label)");
  });

  test("the earlier behaviours are untouched", () => {
    for (const kept of [
      "beginGroundDrag",
      "ground-link-handle",
      // STORY 16.13: the two-step confirm is gone; the remove verb is
      // immediate and the toast is the guard. The card's other verbs stay.
      "ground-remove",
      "void removeCard()",
      "ground-refresh",
      "ground-repoint",
      "ground-note-edit",
      "ground-note-done",
      "ground-note-editor",
      "onMove(reference.on, point.x, point.y)",
    ]) {
      expect({ kept, found: LAYER.includes(kept) }).toEqual({ kept, found: true });
    }
    // The picker is a DRAFT edit: a mention only reaches the note through the
    // existing setNote save (done / a press away).
    expect(LAYER).toContain("onSetNote(reference.on, text)");
    expect(LAYER).toContain("draftRef.current = applied.text");
  });

  test("App hands the workspace to the layer for the one cross-map read", () => {
    expect(APP).toContain("workspacePath={workspace.path}");
    expect(LAYER).toContain("listConceptWords(workspacePath)");
    expect(LAYER).toContain("loadConceptWord(workspacePath, slug)");
  });

  test("the new classes are content to the plane's gate", () => {
    for (const name of [
      "ground-mention",
      "ground-mention-picker",
      "ground-mention-option",
      "ground-mention-empty",
      "ground-concept-panel",
      "ground-concept-close",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
  });

  test("the ground map still renders no concept content, and nothing counts", () => {
    expect(renderedMapContent("ground")).toEqual([]);
    const code = (LAYER + NOTE_FACE + PICKER + CSS).replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    for (const forbidden of [
      "wordCount",
      "word count",
      "mentionCount",
      "backlink",
      "autosav",
      "streak",
      "score",
    ]) {
      expect({ forbidden, found: code.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
  });

  test("the chips, the picker and the panel are styled", () => {
    for (const selector of [
      ".ground-mention {",
      ".ground-mention.word {",
      ".ground-mention.dangling {",
      ".ground-mention-picker {",
      ".ground-mention-option {",
      ".ground-concept-panel {",
      ".ground-concept-memory {",
    ]) {
      expect(CSS).toContain(selector);
    }
    // "missing" appears on hover or focus only: it is a state word, not a badge.
    expect(CSS).toMatch(
      /\.ground-mention\.dangling:hover \.ground-mention-missing[\s\S]*display: inline/,
    );
    // The word chip is styled apart from the card chip (a different meaning).
    expect(CSS).toMatch(/\.ground-mention\.word \{[^}]*font-style: italic/s);
    expect(CSS).not.toMatch(/\.ground-mention\.card \{[^}]*font-style: italic/s);
  });

  test("the concept helper's real bridges are the read ones", () => {
    expect(CONCEPT_WORD_IO.readTextFile).toBeTypeOf("function");
    expect(CONCEPT_WORD_IO.listDir).toBeTypeOf("function");
    expect(existsSync(referencePath(freshWorkspace(), "x"))).toBe(false);
  });
});
