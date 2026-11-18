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
  ASK_CARD_WRITE_REFUSAL,
  ASK_NO_CARD_SENTENCE,
  askTurnCardNote,
  removeGroundRecords,
  restoreGroundCard,
  writeDistilledCard,
  type DistilledIo,
} from "../src/canvas/useGround";
import { AskNoCardLine } from "../src/canvas/AskCard";
import { readingKind, readingProvenance } from "../src/canvas/GroundLayer";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  addAsk,
  appendExchange,
  askTurnPath,
  type AskCard,
} from "../src/map/asks";
import { loadGround, saveGround } from "../src/map/ground";
import {
  loadGroundLinks,
  saveGroundLinks,
  type GroundLinkIo,
} from "../src/map/groundLinks";
import {
  cardProvenanceSourceSlug,
  distilledReading,
  distilledSourceSlug,
  isFileReading,
  loadReadings,
  parseReadingLine,
  parseReadings,
  readingTextPath,
  resolveReadingState,
  restoreReadingText,
  saveReadings,
  selectionSourceSlug,
  serializeReadingLine,
  storeDistilledText,
  storeSelectionText,
  type Reading,
  type ReadingIo,
} from "../src/map/readings";
import { renderMirror, type MirrorView } from "../src/map/mirror";
import type { FileMetaAnswer, TextHead } from "../src/lib/fs";

/**
 * STORY 17.11 — a COMPLETED ask turn's reply becomes a card (ADR-0037's first
 * artifact, the rule-based one).
 *
 * The user's check is human: ask a question, let it finish, and a card appears
 * beside the ask card, named after the question, holding the reply as its
 * reading, wired back, and saying a rule made it. This file pins the rules
 * underneath it:
 *
 *   - the FORM is `distilled` with `from: card://<ask-slug>`, current by
 *     construction, with no source file to stat or re-take;
 *   - ONE card per COMPLETED turn: the policy function answers "no card" for a
 *     stopped, failed, timed-out or empty turn, and the writer refuses an empty
 *     text;
 *   - the reading's BYTES are the reply's exact bytes (copy, never move);
 *   - the house order is text, readings line, ground line, then the wire;
 *   - the wire runs ask card → new card;
 *   - the mirror and the card's "what this is" line both say a RULE made it,
 *     never a model;
 *   - remove/restore round-trips the text and the line.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-distilled-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const TAKEN = "2026-11-18T12:00:00.000Z";
const TAKEN_2 = "2026-11-18T12:05:00.000Z";
/** Odd whitespace and a trailing newline: every byte must survive the copy. */
const REPLY = "  the tide turns at six.\n\n  not seven.\t\n";
const QUESTION = "When does the tide turn?";

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map", "readings"), { recursive: true });
  return path;
}

function anAsk(name = "Tide question"): AskCard {
  return addAsk([], new Set(), name, 120, 80).ask;
}

function readOrNull(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

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
    return {
      kind: "facts",
      exists: false,
      is_file: false,
      len: null,
      modified_ms: null,
    };
  }
}

const UNREAD_HEAD: TextHead = {
  head: "",
  truncated: false,
  exists: false,
  size: null,
  mtime: null,
  decode: "clean",
};

/** The bridges a test needs; the app's real ones go through Tauri. */
const nodeText = {
  readTextFile: async (path: string) => readOrNull(path),
  writeTextFile: async (path: string, text: string) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  },
};

const readingIo: ReadingIo = {
  ...nodeText,
  createDirAll: async (path) => {
    mkdirSync(path, { recursive: true });
  },
  fileMeta: async (path) => fileMeta(path),
  readFileBytes: async () => ({ kind: "refused", code: "cannot-reach" }),
  pdfText: async () => {
    throw new Error("this test reads no PDFs");
  },
  readTextHead: async () => UNREAD_HEAD,
};

const groundIo = nodeText;
const linkIo: GroundLinkIo = nodeText;
const askIo = {
  ...nodeText,
  createDirAll: async (path: string) => {
    mkdirSync(path, { recursive: true });
  },
};

function nodeDistilledIo(order: string[] | null = null): DistilledIo {
  const push = (step: string) => order?.push(step);
  return {
    storeSelectionText,
    storeDistilledText: (workspacePath, on, text) => {
      push("text");
      return storeDistilledText(workspacePath, on, text, readingIo);
    },
    saveReadings: (workspacePath, readings, malformed) => {
      push("readings");
      return saveReadings(workspacePath, readings, malformed, readingIo);
    },
    saveGround: (workspacePath, references, malformed) => {
      push("ground");
      return saveGround(workspacePath, references, malformed, groundIo);
    },
    saveGroundLinks: (workspacePath, links, malformed) => {
      push("wire");
      return saveGroundLinks(workspacePath, links, malformed, linkIo);
    },
  };
}

const IO = nodeDistilledIo();

async function makeCard(
  workspace: string,
  ask: AskCard,
  reply: string = REPLY,
  taken: string = TAKEN,
  existing: {
    references?: import("../src/map/ground").GroundReference[];
    readings?: Reading[];
    links?: import("../src/map/groundLinks").GroundLink[];
  } = {},
) {
  return writeDistilledCard(
    workspace,
    existing.references ?? [],
    existing.readings ?? [],
    existing.links ?? [],
    [],
    [],
    [],
    ask.on,
    ask.name,
    ask.x,
    ask.y,
    reply,
    taken,
    IO,
  );
}

describe("the distilled reading form (ADR-0037's first artifact)", () => {
  test("round-trips as a form in the existing family", () => {
    const reading = distilledReading("tide-card", "tide-question", TAKEN);
    expect(serializeReadingLine(reading)).toBe(
      "on: tide-card | form: distilled | from: card://tide-question | taken: " +
        TAKEN,
    );
    expect(parseReadingLine(serializeReadingLine(reading))).toEqual(reading);
    expect(parseReadings(serializeReadingLine(reading)).malformed).toEqual([]);
  });

  test("is current by construction, with no source file to stat", () => {
    const reading = distilledReading("tide-card", "tide-question", TAKEN);
    expect(resolveReadingState(reading, null, Date.now())).toBe("current");
    expect(isFileReading(reading)).toBe(false);
    expect(distilledSourceSlug(reading)).toBe("tide-question");
    expect(selectionSourceSlug(reading)).toBeNull();
    expect(cardProvenanceSourceSlug(reading)).toBe("tide-question");
  });

  test("a path in from is refused and kept, never guessed into a form", () => {
    const bad =
      "on: tide-card | form: distilled | from: /tmp/reply.md | taken: " + TAKEN;
    expect(parseReadingLine(bad)).toBeNull();
    const parsed = parseReadings(bad + "\n");
    expect(parsed.readings).toEqual([]);
    expect(parsed.malformed).toEqual([bad]);
  });
});

describe("one card per COMPLETED turn", () => {
  test("only an answered turn with text makes a card", () => {
    const answered = {
      ending: "answered" as const,
      result: { kind: "answer" as const, text: REPLY },
      left: true,
      reached: null,
      missed: null,
    };
    expect(askTurnCardNote(answered)).toBeNull();
    for (const ending of ["stopped", "failed", "timed-out"] as const) {
      expect(
        askTurnCardNote({
          ...answered,
          ending,
          result: { kind: "failed", sentence: "x" },
        }),
      ).toBe(ASK_NO_CARD_SENTENCE);
    }
    expect(
      askTurnCardNote({
        ...answered,
        result: { kind: "answer", text: "" },
      }),
    ).toBe(ASK_NO_CARD_SENTENCE);
    expect(ASK_NO_CARD_SENTENCE).toBe("no card was made");
  });

  test("the ask card shows the one line when no card was made", () => {
    const html = renderToStaticMarkup(
      createElement(AskNoCardLine, { line: ASK_NO_CARD_SENTENCE }),
    );
    expect(html).toContain("no card was made");
    expect(html).not.toContain("distilled");
  });

  test("an empty reply writes nothing at all", async () => {
    const workspace = freshWorkspace();
    const ask = anAsk();
    const written = await writeDistilledCard(
      workspace,
      [],
      [],
      [],
      [],
      [],
      [],
      ask.on,
      ask.name,
      120,
      80,
      "",
      TAKEN,
      IO,
    );
    expect(written).toEqual({ kind: "refused", message: ASK_NO_CARD_SENTENCE });
    expect((await loadGround(workspace, groundIo)).references).toEqual([]);
    expect((await loadReadings(workspace, readingIo)).readings).toEqual([]);
    expect((await loadGroundLinks(workspace, linkIo)).links).toEqual([]);
    expect(ASK_CARD_WRITE_REFUSAL).toContain("card could not be written");
  });
});

describe("a completed turn's card: the copy, the order and the wire", () => {
  test("writes text, readings line, ground line, then the wire", async () => {
    const workspace = freshWorkspace();
    const ask = anAsk();
    const order: string[] = [];
    const written = await writeDistilledCard(
      workspace,
      [],
      [],
      [],
      [],
      [],
      [],
      ask.on,
      ask.name,
      ask.x,
      ask.y,
      REPLY,
      TAKEN,
      nodeDistilledIo(order),
    );
    expect(written.kind).toBe("written");
    expect(order).toEqual(["text", "readings", "ground", "wire"]);
    if (written.kind !== "written") return;
    expect((await loadGroundLinks(workspace, linkIo)).links).toEqual([
      { from: ask.on, to: written.records.reading.on },
    ]);
  });

  test("the reading text is the reply VERBATIM (a byte comparison)", async () => {
    const workspace = freshWorkspace();
    const ask = anAsk();
    // The reply already lives in the ask card's conversation.
    await appendExchange(workspace, ask.on, QUESTION, REPLY, askIo);
    const conversationBefore = readFileSync(askTurnPath(workspace, ask.on));

    const written = await makeCard(workspace, ask);
    if (written.kind !== "written") throw new Error("no card was written");
    const slug = written.records.reading.on;

    // BYTE FOR BYTE, with no trim, re-wrap or trailing-newline repair.
    expect(
      readFileSync(readingTextPath(workspace, slug)).equals(Buffer.from(REPLY)),
    ).toBe(true);

    // The ask card's own reply is untouched by the copy.
    expect(
      readFileSync(askTurnPath(workspace, ask.on)).equals(conversationBefore),
    ).toBe(true);

    // The line is the form, with the ask card as its source.
    expect(written.records.reading).toEqual(
      distilledReading(slug, ask.on, TAKEN),
    );
    const onDisk = await loadReadings(workspace, readingIo);
    expect(onDisk.malformed).toEqual([]);
    expect(onDisk.readings).toEqual([distilledReading(slug, ask.on, TAKEN)]);
    expect(
      readFileSync(join(workspace, "map", "readings.txt"), "utf8"),
    ).toContain("form: distilled | from: card://" + ask.on);
  });

  test("a rerun makes another card; both are wired to the ask card", async () => {
    const workspace = freshWorkspace();
    const ask = anAsk();
    const first = await makeCard(workspace, ask);
    if (first.kind !== "written") throw new Error("no first card");
    const second = await makeCard(workspace, ask, "the tide turns again.", TAKEN_2, {
      references: first.records.references,
      readings: first.records.readings,
      links: first.links,
    });
    if (second.kind !== "written") throw new Error("no second card");

    const ground = await loadGround(workspace, groundIo);
    expect(ground.references.length).toBe(2);
    expect(ground.references[0]!.on).not.toBe(ground.references[1]!.on);
    const readings = await loadReadings(workspace, readingIo);
    expect(readings.readings.length).toBe(2);
    const links = await loadGroundLinks(workspace, linkIo);
    expect(links.links).toEqual([
      { from: ask.on, to: first.records.reading.on },
      { from: ask.on, to: second.records.reading.on },
    ]);
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

describe("the card says a RULE made it, never a model", () => {
  test("ONE footer line names the ask card and the rule; the header line is gone", async () => {
    const workspace = freshWorkspace();
    const ask = anAsk();
    const written = await makeCard(workspace, ask);
    if (written.kind !== "written") throw new Error("no card was written");
    const reading = written.records.reading;
    const names = new Map([[ask.on, ask.name]]);
    // STORY 17.15: the "what this is" header (readingKind) has no line for a
    // distilled card — the whole provenance is the footer's one sentence.
    expect(readingKind(reading, names)).toBeNull();
    expect(readingProvenance(reading, names)).toBe(
      "a rule's copy of " + ask.name,
    );
    expect(readingProvenance(reading, new Map())).toBe(
      "a rule's copy of a card that is gone",
    );
    const text = readingProvenance(reading, names);
    expect(text).not.toContain("distilled by");
    expect(text).not.toContain("model");
    // It is said ONCE: the two lines are no longer two statements.
    expect(
      [readingKind(reading, names), readingProvenance(reading, names)].filter(
        (line) => line !== null,
      ),
    ).toHaveLength(1);
  });

  test("the mirror lists the card with its rule provenance", async () => {
    const workspace = freshWorkspace();
    const ask = anAsk();
    const written = await makeCard(workspace, ask);
    if (written.kind !== "written") throw new Error("no card was written");
    const ground = await loadGround(workspace, groundIo);
    const readings = await loadReadings(workspace, readingIo);
    const links = await loadGroundLinks(workspace, linkIo);
    const view: MirrorView = {
      references: ground.references,
      readings: readings.readings,
      texts: { [written.records.reading.on]: REPLY },
      states: { [written.records.reading.on]: "current" },
      notes: {},
      orphanNotes: [],
      orphanMedia: [],
      links: links.links,
      orphanLinks: [],
      asks: [ask],
      sessions: [],
      sessionToolNames: {},
      sessionEndings: {},
      orphanSessionTranscripts: [],
      malformedAsks: [],
      orphanAskTurns: [],
      malformedGround: [],
      malformedReadings: [],
      malformedLinks: [],
    };
    const mirror = renderMirror(view);
    expect(mirror).toContain("rule: a rule's copy of " + ask.name);
    // The link is drawn in the person's names, ask card → the new card.
    expect(mirror).toContain(ask.name + " → " + ask.name);
    expect(mirror).not.toContain("distilled by");
  });
});

describe("remove and restore round-trip the artifact", () => {
  test("the text bytes and the reading line come back exactly", async () => {
    const workspace = freshWorkspace();
    const ask = anAsk();
    const written = await makeCard(workspace, ask);
    if (written.kind !== "written") throw new Error("no card was written");
    const slug = written.records.reading.on;
    const before = readFileSync(readingTextPath(workspace, slug));

    const ground = await loadGround(workspace, groundIo);
    const readings = await loadReadings(workspace, readingIo);
    const removed = await removeGroundRecords(
      workspace,
      slug,
      ground.references,
      readings.readings,
      [],
      [],
      {
        readTextFile: nodeText.readTextFile,
        saveGround: (workspacePath, references, malformed) =>
          saveGround(workspacePath, references, malformed, groundIo),
        saveReadings: (workspacePath, next, malformed) =>
          saveReadings(workspacePath, next, malformed, readingIo),
        removeFile: async (path) => {
          unlinkSync(path);
        },
      },
    );
    expect(removed.removed).not.toBeNull();
    const links = await loadGroundLinks(workspace, linkIo);
    const card = {
      ...removed.removed!,
      links: links.links.map((link, index) => ({ link, index })),
    };
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
        saveReadings: (workspacePath, next, malformed) =>
          saveReadings(workspacePath, next, malformed, readingIo),
        saveGroundLinks: (workspacePath, next, malformed) =>
          saveGroundLinks(workspacePath, next, malformed, linkIo),
        saveMedia: async () => undefined,
        restoreReadingText: (workspacePath, on, text) =>
          restoreReadingText(workspacePath, on, text, readingIo),
        restoreNote: async () => undefined,
        restoreThumb: async () => undefined,
      },
    );
    expect(restored.didNot).toEqual([]);
    expect(
      readFileSync(readingTextPath(workspace, slug)).equals(before),
    ).toBe(true);
    const after = await loadReadings(workspace, readingIo);
    expect(after.readings).toEqual([distilledReading(slug, ask.on, TAKEN)]);
    const linksAfter = await loadGroundLinks(workspace, linkIo);
    expect(linksAfter.links).toEqual([{ from: ask.on, to: slug }]);
  });
});

describe("the hook makes exactly one card, in one place", () => {
  test("askTurn calls the writer once, after the turn's own record", () => {
    const hook = source("canvas/useGround.ts");
    const calls = hook.match(/await writeDistilledCard\(/g) ?? [];
    expect(calls.length).toBe(1);
    expect(hook.indexOf("const recorded = await writeAskTurn")).toBeLessThan(
      hook.indexOf("await writeDistilledCard("),
    );
    expect(hook).toContain("const noCard = askTurnCardNote(sent)");
  });

  test("the layer resolves the ask card's live name, and states the copy", () => {
    const layer = source("canvas/GroundLayer.tsx");
    // The distilled source is an ASK card, so the provenance map must carry
    // ask names too (it is provenance only; the mention picker stays
    // references-only).
    expect(layer).toContain("...asks.map((ask) => [ask.on, ask.name] as const)");
    // STORY 17.15 — the stray "no file" sentence is gone from a distilled
    // card's verbs row; it belongs to a SELECTION card, whose quiet line stays.
    expect(layer).not.toContain("a rule's copy; there is no file");
    expect(layer).toContain(
      "this is a copy; there is no file to refresh or point at.",
    );
  });

  test("no model call is made for the copy", () => {
    const hook = source("canvas/useGround.ts");
    const writer = hook.slice(
      hook.indexOf("export async function writeDistilledCard"),
      hook.indexOf("STORY 18.4 — A FINISHED RUN'S RESULT"),
    );
    expect(writer).not.toContain("sendAskQuestion");
    expect(writer).not.toContain("appendAskCardMove");
    expect(writer).not.toContain("fetch(");
  });
});
