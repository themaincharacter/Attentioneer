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
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ASK_UNTITLED_NAME,
  CHOSEN_WORDS_MISSING,
  CHOSEN_WORDS_REFUSAL,
  askQuestionRefusal,
  addAsk,
  asksPath,
  chosenWordsName,
  parseAskLine,
  saveAsks,
  selectionWords,
  selectionWordsRefusal,
  serializeAskLine,
  type AskCard as AskCardRecord,
  type AskIo,
} from "../src/map/asks";
import {
  askContextFactsOf,
  writeSelectionAsk,
  type SelectionAskIo,
} from "../src/canvas/useGround";
import { AskCard } from "../src/canvas/AskCard";
import { askCardOf } from "../src/turn/context";
import {
  ASK_CONTEXT_BOUND,
  assembleAskCardPacket,
  selectAskContextCards,
} from "../src/turn/packet";
import {
  SELECTION_ASK_DISMISS,
  SELECTION_ASK_VERB,
  SelectionAsk,
  clearTextSelection,
} from "../src/canvas/SelectionAsk";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  saveGround,
  type GroundIo,
  type GroundReference,
} from "../src/map/ground";
import {
  addGroundLink,
  saveGroundLinks,
  type GroundLink,
  type GroundLinkIo,
} from "../src/map/groundLinks";
import { readingTextPath, saveReadings } from "../src/map/readings";
import { notePath } from "../src/map/notes";
import { utf8ByteLength } from "../src/lib/textBytes";

/**
 * STORY 16.19 — A SELECTION ASKS A QUESTION.
 *
 * The user's correction, stated twice: "copying the selection highlighting and
 * an ask widget pops up that if you type a question it generates a linked
 * card." Story 16.12 built a copy card instead and 16.18 deleted it. These tests
 * pin the rules underneath the right thing:
 *
 *   - a selection is CONTEXT: the collapse rule, the record's chosen words, and
 *     a whole-folder snapshot proving the source card is never written;
 *   - the context path gains ONE kind ("chosen words from <name>"), riding as a
 *     whole block under the 17.9 bound and declared with its byte size;
 *   - the widget: one field, one ask verb, one dismiss; never for an empty
 *     selection; every exit clears the browser's selection;
 *   - the ask it makes is the ordinary path (no second model call): the card's
 *     own send asks the question once.
 *
 * PROVISIONAL: the wording, the widget's look and the record's chosen fields.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const HOOK = source("canvas/useGround.ts");
const LAYER = source("canvas/GroundLayer.tsx");
const CARD = source("canvas/AskCard.tsx");
const WIDGET = source("canvas/SelectionAsk.tsx");
const APP = source("App.tsx");
const PACKET = source("turn/packet.ts");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-selection-ask-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const SOURCE_SLUG = "rain-gauge";
const SOURCE_NAME = "Rain gauge";
const OTHER_SLUG = "sea";
const REFERENCE: GroundReference = {
  on: SOURCE_SLUG,
  name: SOURCE_NAME,
  x: 40,
  y: 60,
};
const OTHER: GroundReference = { on: OTHER_SLUG, name: "Sea", x: 500, y: 60 };
const WORDS = 'the gauge reads the rise, and "the river" is not one thing';
const QUESTION = "what does this claim depend on?";

const askIo: AskIo = {
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
};

const groundIo: GroundIo = {
  readTextFile: askIo.readTextFile,
  writeTextFile: askIo.writeTextFile,
};

const linkIo: GroundLinkIo = {
  readTextFile: askIo.readTextFile,
  writeTextFile: askIo.writeTextFile,
};

const selectionIo: SelectionAskIo = {
  saveAsks: (workspace, asks, malformed = []) => saveAsks(workspace, asks, malformed, askIo),
  saveGroundLinks: (workspace, links, malformed = []) =>
    saveGroundLinks(workspace, links, malformed, linkIo),
};

const readingIo = {
  ...askIo,
  readTextHead: async () => ({
    exists: true,
    head: "",
    size: 0,
    truncated: false,
    decode: "clean" as const,
  }),
  fileMeta: async () => ({
    kind: "facts" as const,
    exists: true,
    is_file: true,
    len: 0,
    modified_ms: 0,
  }),
  readFileBytes: async () => ({
    kind: "refused" as const,
    code: "io" as const,
    detail: null,
  }),
  pdfText: async () => ({ kind: "none" as const }),
};

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map", "readings"), { recursive: true });
  return path;
}

/** Every file under `map/`, path → bytes, so "unchanged" is a whole-folder claim. */
function folderBytes(workspace: string): Record<string, string> {
  const root = join(workspace, "map");
  const out: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out[relative(root, full)] = readFileSync(full, "utf8");
    }
  };
  walk(root);
  return out;
}

/** A source card with its reading text and its note, and one existing wire. */
async function seedMap(workspace: string): Promise<void> {
  await saveGround(workspace, [REFERENCE, OTHER], [], groundIo);
  await saveReadings(workspace, [], [], readingIo as never);
  writeFileSync(
    readingTextPath(workspace, SOURCE_SLUG),
    "the gauge reads the river's rise\n\nand the note below says why.",
    "utf8",
  );
  mkdirSync(join(workspace, "map", "notes"), { recursive: true });
  writeFileSync(notePath(workspace, SOURCE_SLUG), "check it after rain", "utf8");
  await saveGroundLinks(
    workspace,
    addGroundLink([], SOURCE_SLUG, OTHER_SLUG),
    [],
    linkIo,
  );
}

/** The ask line a selection makes, as the writer stores it. */
async function makeSelectionAsk(
  workspace: string,
): Promise<ReturnType<typeof writeSelectionAsk>> {
  return writeSelectionAsk(
    workspace,
    [REFERENCE, OTHER],
    [],
    [],
    addGroundLink([], SOURCE_SLUG, OTHER_SLUG),
    [],
    SOURCE_SLUG,
    WORDS,
    ASK_UNTITLED_NAME,
    340,
    60,
    [],
    selectionIo,
  );
}

describe("a selection is CONTEXT, not a copy", () => {
  test("the one collapse rule: line breaks and runs become one space; the rest is verbatim", () => {
    expect(selectionWords("  the gauge\n\treads   the rise  ")).toBe(
      "the gauge reads the rise",
    );
    // Punctuation and quotes are the person's: only whitespace moves.
    expect(selectionWords('"the river"\nis not one thing')).toBe(
      '"the river" is not one thing',
    );
    // A selection that is only whitespace is no selection at all.
    expect(selectionWords("")).toBeNull();
    expect(selectionWords(" \n\t ")).toBeNull();
    expect(selectionWordsRefusal("  ")).toBe(CHOSEN_WORDS_REFUSAL);
    expect(selectionWordsRefusal("a word")).toBeNull();
  });

  test("the record stores the words verbatim apart from the collapse, and round-trips", () => {
    const ask = addAsk([], new Set<string>(), ASK_UNTITLED_NAME, 340, 60, {
      from: SOURCE_SLUG,
      words: WORDS,
    }).ask;
    // The card is an EMPTY peer ask (17.10): no anchor, no remembered name.
    expect(ask.anchor).toBeUndefined();
    expect(ask.anchorName).toBeUndefined();
    expect(ask.chosenFrom).toBe(SOURCE_SLUG);
    expect(ask.chosen).toBe(WORDS);
    const line = serializeAskLine(ask);
    // One line, so the pipe and the quotes cannot split the record.
    expect(line.split("\n").length).toBe(1);
    expect(parseAskLine(line)).toEqual(ask);
    // A line with no chosen tail writes exactly the old bytes.
    const plain: AskCardRecord = {
      on: "rain-gauge-question",
      name: "Rain gauge question",
      x: 360,
      y: 60,
      anchor: SOURCE_SLUG,
    };
    expect(serializeAskLine(plain)).toBe(
      "on: rain-gauge-question | name: Rain gauge question | x: 360 | y: 60 | anchor: rain-gauge",
    );
    // Half the pair is out of shape: kept and reported, never guessed into a card.
    expect(
      parseAskLine(
        "on: a | name: A | x: 1 | y: 2 | chosenFrom: rain-gauge",
      ),
    ).toBeNull();
    expect(
      parseAskLine('on: a | name: A | x: 1 | y: 2 | chosen: "words"'),
    ).toBeNull();
  });

  test("the whole map folder proves the SOURCE CARD is never written", async () => {
    const workspace = freshWorkspace();
    await seedMap(workspace);
    const before = folderBytes(workspace);
    const written = await makeSelectionAsk(workspace);
    expect(written).not.toBeNull();
    const after = folderBytes(workspace);

    // Every file that was there is byte-identical, except the one that gained a
    // WIRE (a link record says nothing about the source card's own bytes).
    for (const [key, bytes] of Object.entries(before)) {
      if (key === "ground-links.txt") continue;
      expect({ key, bytes: after[key] }).toEqual({ key, bytes });
    }
    // The wire is appended, never rewritten: the earlier bytes are a prefix.
    const linksBefore = before["ground-links.txt"] ?? "";
    expect(after["ground-links.txt"]!.startsWith(linksBefore)).toBe(true);
    expect(after["ground-links.txt"]).toBe(
      linksBefore +
        "from: " +
        SOURCE_SLUG +
        " | to: " +
        written!.ask.on +
        "\n",
    );
    // The ONLY additions are the ask line and nothing else.
    expect(Object.keys(after).sort()).toEqual(
      [...Object.keys(before), "asks.txt"].sort(),
    );
    // And the source's own records are untouched, said one by one.
    expect(after["ground.txt"]).toBe(before["ground.txt"]!);
    expect(after[join("readings", SOURCE_SLUG + ".md")]).toBe(
      before[join("readings", SOURCE_SLUG + ".md")]!,
    );
    expect(after[join("notes", SOURCE_SLUG + ".md")]).toBe(
      before[join("notes", SOURCE_SLUG + ".md")]!,
    );
    // The record's own words are the collapsed selection, exactly.
    const line = readFileSync(asksPath(workspace), "utf8").trim();
    expect(parseAskLine(line)!.chosen).toBe(WORDS);
  });

  test("an unknown source or an empty selection writes nothing at all", async () => {
    const workspace = freshWorkspace();
    await seedMap(workspace);
    const before = folderBytes(workspace);
    expect(
      await writeSelectionAsk(
        workspace,
        [REFERENCE],
        [],
        [],
        [],
        [],
        "not-on-the-map",
        WORDS,
        ASK_UNTITLED_NAME,
        0,
        0,
        [],
        selectionIo,
      ),
    ).toBeNull();
    expect(
      await writeSelectionAsk(
        workspace,
        [REFERENCE],
        [],
        [],
        [],
        [],
        SOURCE_SLUG,
        "   ",
        ASK_UNTITLED_NAME,
        0,
        0,
        [],
        selectionIo,
      ),
    ).toBeNull();
    expect(folderBytes(workspace)).toEqual(before);
    expect(() => readFileSync(asksPath(workspace), "utf8")).toThrow();
  });
});

describe("the ask card's context gains one more source kind", () => {
  const ask: AskCardRecord = addAsk([], new Set<string>(), ASK_UNTITLED_NAME, 340, 60, {
    from: SOURCE_SLUG,
    words: WORDS,
  }).ask;
  const link: GroundLink = { from: SOURCE_SLUG, to: ask.on };
  const facts = askContextFactsOf({
    ask: ask.on,
    links: [link],
    references: [REFERENCE, OTHER],
    asks: [ask],
    askTurns: {},
    readings: [],
    texts: { [SOURCE_SLUG]: "the gauge reads the river's rise" },
    notes: { [SOURCE_SLUG]: "check it after rain" },
    states: { [SOURCE_SLUG]: "current" },
  });

  test("the chosen words ride FIRST, named after their source, with no slug", () => {
    expect(facts.dangling).toEqual([]);
    expect(facts.facts.length).toBe(2);
    const first = facts.facts[0]!;
    expect(first.name).toBe(chosenWordsName(SOURCE_NAME));
    expect(first.chosen).toBe(WORDS);
    // Not a card: no slug (so no inclusion key), no reading, no note.
    expect(first.on).toBeUndefined();
    expect(first.reading).toBeNull();
    expect(first.readingText).toBeNull();
    expect(first.note).toBeNull();
    // The wired card still rides after it, exactly as 17.9 built it.
    expect(facts.facts[1]!.name).toBe(SOURCE_NAME);
  });

  test("a source the map no longer carries is SAID, never repaired", () => {
    const gone = askContextFactsOf({
      ask: ask.on,
      links: [],
      references: [],
      asks: [ask],
      askTurns: {},
      readings: [],
      texts: {},
      notes: {},
      states: {},
    });
    expect(gone.facts[0]!.name).toBe(CHOSEN_WORDS_MISSING);
    expect(gone.facts[0]!.chosen).toBe(WORDS);
    expect(chosenWordsName(null)).toBe(CHOSEN_WORDS_MISSING);
  });

  test("the packet carries the words verbatim, as its own declared block", () => {
    const cards = facts.facts.map(askCardOf);
    const packet = assembleAskCardPacket(cards, [], QUESTION);
    const block = packet.blocks.find(
      (entry) => entry.name === chosenWordsName(SOURCE_NAME),
    );
    expect(block).toBeDefined();
    expect(block!.kind).toBe("card");
    expect(block!.text).toContain(WORDS);
    // DECLARED WITH ITS EXACT SIZE, from the same bytes the send carries.
    const declared = packet.declaration.blocks.find(
      (entry) => entry.name === chosenWordsName(SOURCE_NAME),
    );
    expect(declared!.size).toBe(utf8ByteLength(block!.text));
    // The instruction says what the block is: context, not the whole card.
    expect(packet.text).toContain(
      "One block is the words the person chose from a card",
    );
  });

  test("the ask card's context line says 'chosen words from <name>'", () => {
    // The card lists the RESOLVED context blocks by name (17.9), so the one new
    // source kind shows up in that line without a second sentence being written.
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask,
        anchorName: null,
        context: facts.facts.map(askCardOf),
        turns: [{ role: "person", text: QUESTION, t: "2026-11-18T12:00:00.000Z" }],
        open: true,
        previewLines: 6,
        hasProvider: true,
        onOpen: () => undefined,
        onClose: () => undefined,
      }),
    );
    expect(html).toContain(chosenWordsName(SOURCE_NAME));
    expect(html).toContain(SOURCE_NAME);
  });

  test("the chosen words are context, not a READ target; the wired card still is", () => {
    const cards = facts.facts.map(askCardOf);
    const packet = assembleAskCardPacket(
      cards,
      [],
      QUESTION,
      undefined,
      [chosenWordsName(SOURCE_NAME), SOURCE_NAME],
    );
    // There is no fuller text behind one line, so the block is never offered.
    expect(packet.retrievable).toEqual([SOURCE_NAME]);
  });

  test("the 17.9 bound drops the block WHOLE, with the one sentence", () => {
    const cards = facts.facts.map(askCardOf);
    const tight = selectAskContextCards(cards, { cards: 4, bytes: 20 });
    expect(tight.cards).toEqual([]);
    expect(tight.omitted).toBe(true);
    // The bound is the EXISTING one: a generous budget keeps both whole cards.
    const roomy = selectAskContextCards(cards, ASK_CONTEXT_BOUND);
    expect(roomy.cards.map((card) => card.name)).toEqual([
      chosenWordsName(SOURCE_NAME),
      SOURCE_NAME,
    ]);
    expect(roomy.omitted).toBe(false);
  });
});

describe("the widget: one field, one ask verb, one dismiss", () => {
  test("it renders a field, the ask verb and the dismiss, and nothing counted", () => {
    const html = renderToStaticMarkup(
      createElement(SelectionAsk, {
        x: 12,
        y: 34,
        zoom: 1,
        words: WORDS,
        onAskQuestion: async () => ({ ok: true }),
        onDismiss: () => undefined,
      }),
    );
    expect(html).toContain("selection-ask");
    expect(html.match(/selection-ask-question/g)?.length ?? 0).toBe(1);
    expect(html).toContain(SELECTION_ASK_VERB);
    expect(html).toContain(SELECTION_ASK_DISMISS);
    // The widget never echoes or counts anything; it is a question field.
    expect(html).not.toContain(WORDS);
  });

  test("it is mounted only for a selection, never for an empty one", () => {
    // The card reports the raw words; the layer's one collapse rule decides.
    expect(LAYER).toContain("selectionWords(raw)");
    expect(LAYER).toContain("if (words === null)");
    expect(LAYER).toMatch(/selectionAsk !== null && \(\s*\n\s*<SelectionAsk/);
    // And the widget's own ask repeats the refusal before any writer is reached.
    expect(WIDGET).toContain("selectionWordsRefusal(words)");
    expect(WIDGET.indexOf("selectionWordsRefusal(words)")).toBeLessThan(
      WIDGET.indexOf("await onAskQuestion("),
    );
  });

  test("every exit dismisses and clears the browser's selection", () => {
    // The helper is the one rule, and it removes every range.
    expect(WIDGET).toContain("removeAllRanges()");
    expect(clearTextSelection).toBeTypeOf("function");
    // Esc, a press outside and a successful ask all reach onDismiss...
    const esc = WIDGET.slice(
      WIDGET.indexOf('if (e.key !== "Escape") return;'),
      WIDGET.indexOf("}, [onDismiss]);"),
    );
    expect(esc).toContain("onDismiss()");
    expect(WIDGET).toContain("document.addEventListener(\"mousedown\", onDown, true)");
    const askBlock = WIDGET.slice(WIDGET.indexOf("async function ask("));
    expect(askBlock.indexOf("if (!result.ok)")).toBeLessThan(
      askBlock.indexOf("onDismiss();"),
    );
    // ...and the LAYER's dismiss is what clears the highlight; its card-close
    // effect dismisses with it, so the widget never survives a close.
    expect(LAYER).toContain("clearTextSelection()");
    const closeEffect = LAYER.slice(
      LAYER.indexOf("// A CARD CLOSE TAKES THE WIDGET WITH IT"),
      LAYER.indexOf("const wordSlugs"),
    );
    expect(closeEffect).toContain("openOn === selectionAsk.source");
    expect(closeEffect).toContain("setSelectionAsk(null)");
    expect(closeEffect).toContain("clearTextSelection()");
    expect(LAYER).toContain("function dismissSelection()");
  });

  test("it does not fight the card's reading scroll, link drag or card drag", () => {
    // The reading already owns its press as a selection surface, so the card
    // never starts a drag there; the widget only listens on mouse-up. STORY
    // 16.23 moved the press rule into the shared drag wiring, where the open
    // card's reading is still the caller's exclusion.
    expect(LAYER).toContain(
      'open && target.closest(".ground-reading") !== null',
    );
    expect(LAYER).toContain('window.addEventListener("mouseup", onMouseUp)');
    // The widget stops its own presses and wheel before the plane hears them.
    expect(WIDGET).toContain('el.addEventListener("mousedown", stop)');
    expect(WIDGET).toContain('el.addEventListener("wheel", stop, { passive: true })');
    // The plane's gate treats the widget as content.
    expect(CONTENT_CLASSES).toContain("selection-ask");
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

describe("the ask the widget makes is the ordinary ask path", () => {
  test("its refusals run before the queue, and it writes the card AND its wire", () => {
    const start = HOOK.indexOf("const askFromSelection = useCallback");
    expect(start).toBeGreaterThan(-1);
    const block = HOOK.slice(start, HOOK.indexOf("\n  const ", start + 1));
    expect(block).toContain("selectionWordsRefusal(words)");
    expect(block).toContain("askQuestionRefusal(question)");
    expect(block).toContain("ASK_SOURCE_REFUSAL");
    const writeAt = block.indexOf("writeSelectionAsk(");
    expect(writeAt).toBeGreaterThan(-1);
    expect(block.indexOf("selectionWordsRefusal(words)")).toBeLessThan(writeAt);
    expect(block.indexOf("askQuestionRefusal(question)")).toBeLessThan(writeAt);
    expect(block.indexOf("source === undefined")).toBeLessThan(writeAt);
    // ONE queued step writes the ask line, then the wire, then opens the card.
    expect(block).toContain("askAddEvent(");
    expect(block).toContain("linkAddEvent(");
    expect(block).toContain("created: written.ask.on");
  });

  test("nothing configured refuses before a card is made, with the card's sentence", () => {
    const start = LAYER.indexOf("async function askSelection");
    expect(start).toBeGreaterThan(-1);
    const block = LAYER.slice(start, LAYER.indexOf("\n  }", start) + 4);
    expect(block).toContain("hasProvider === false");
    expect(block).toContain("PROVIDER_SENTENCES.nothing");
    expect(block.indexOf("hasProvider === false")).toBeLessThan(
      block.indexOf("onAskFromSelection("),
    );
  });

  test("the question reaches the card's own send, ONCE, and nowhere else", () => {
    // The layer opens the new card and hands it the question as a one-shot seed.
    expect(LAYER).toContain("const [askSeed, setAskSeed]");
    expect(LAYER).toContain("autoAsk={");
    expect(LAYER).toContain("onAutoAsked={() => setAskSeed(null)}");
    // The card's ONE send path asks it; a token makes a replay impossible.
    expect(CARD).toContain("autoAskedRef.current === autoAsk.token");
    expect(CARD).toContain("void send(autoAsk.question)");
    expect(CARD.match(/onAskTurn\(/g)?.length ?? 0).toBe(1);
    expect(APP).toContain("onAskFromSelection={ground.askFromSelection}");
    expect(LAYER).toContain("onAskFromSelection");
  });

  test("no second model call, no curator, no PRISM anywhere in this path", () => {
    expect(HOOK).toContain("export async function writeSelectionAsk");
    const start = HOOK.indexOf("const askFromSelection = useCallback");
    const block = HOOK.slice(start, HOOK.indexOf("\n  const ", start + 1));
    expect(block).not.toContain("sendAskQuestion");
    expect(block).not.toContain("sendPacket");
    expect(block).not.toContain("prism");
    // The widget holds no transport: it only hands the words and the question.
    expect(WIDGET).not.toContain("sendPacket");
    expect(WIDGET).not.toContain("fetch(");
    expect(WIDGET).not.toContain("apiKey");
    expect(WIDGET).not.toContain("turn.");
    // The packet's own change is the block and its sentence, nothing wider.
    expect(PACKET).toContain("chosenRides");
  });
});
