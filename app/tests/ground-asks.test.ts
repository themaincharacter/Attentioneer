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
  askPlacement,
  GroundLayer,
} from "../src/canvas/GroundLayer";
import {
  ASK_EMPTY_SENTENCE,
  AskCard,
  askKindLine,
} from "../src/canvas/AskCard";
import {
  askSendResult,
  recordAskTurn,
  writeAskCard,
  type AskTurnIo,
} from "../src/canvas/useGround";
import {
  ASK_MISSING_REFUSAL,
  ASK_NAME_REFUSAL,
  ASK_QUESTION_REFUSAL,
  ASK_SOURCE_REFUSAL,
  appendExchange,
  appendTurn,
  askLastTurnText,
  askQuestionRefusal,
  askRefusal,
  askTurnPath,
  askTurnsDir,
  asksPath,
  addAsk,
  loadAskTurns,
  loadAsks,
  loadTurns,
  parseAskLine,
  parseAsks,
  parseTurnLine,
  parseTurns,
  proposeAskName,
  saveAsks,
  serializeAskLine,
  serializeAsks,
  serializeTurnLine,
  sharedSlugs,
  type AskCard as AskCardRecord,
  type AskIo,
  type AskTurn,
} from "../src/map/asks";
import {
  addGroundReference,
  groundPath,
  saveGround,
  type GroundIo,
  type GroundReference,
} from "../src/map/ground";
import { readingTextPath, readingsPath, saveReadings } from "../src/map/readings";
import { notePath } from "../src/map/notes";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { CONTENT_CLASSES } from "../src/canvas/gates";

/**
 * STORY 17.1 — one ask card holds one exchange.
 *
 * The story's check is human ("press ask about this on a reference card, accept
 * the proposed name, type one question and read the answer in the new card;
 * quit, reopen: the card and its exchange are still there and the reference
 * card is unchanged"). This file pins the rules underneath it:
 *
 *   - the ASK CARD is its own record family (`map/asks.txt`) plus one append-only
 *     conversation file per card — never a reading, never a note;
 *   - ONE slug space with ground.txt: minting checks BOTH files, and a
 *     collision dedupes with the existing suffix rule;
 *   - the anchor is a FIELD and a dangling one is legal (never repaired);
 *   - one exchange survives a reopen, the words verbatim;
 *   - a failed turn writes the person's line ONLY and hands back one sentence;
 *   - an empty question refuses and writes nothing;
 *   - the reference card's whole folder is byte-identical after an ask;
 *   - the small card crops the exchange at the stated count and nothing counts.
 *
 * PROVISIONAL: the record shapes, the proposed-name wording and the placement.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const HOOK = source("canvas/useGround.ts");
const APP = source("App.tsx");
const LAYER = source("canvas/GroundLayer.tsx");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-asks-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const TAKEN = "2026-11-17T12:00:00.000Z";
const SOURCE_SLUG = "rain-gauge";
const SOURCE_NAME = "Rain gauge";
const REFERENCE: GroundReference = {
  on: SOURCE_SLUG,
  name: SOURCE_NAME,
  x: 40,
  y: 60,
};
const QUESTION = "  what does the gauge measure\n\nand  why?  ";
const ANSWER = "the river's slow argument, in millimetres.";

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

/** A reference card with everything the ground map keeps for one. */
async function seedReference(workspace: string): Promise<void> {
  await saveGround(workspace, [REFERENCE], [], groundIo);
  await saveReadings(workspace, [], [], readingIo as never);
  writeFileSync(
    readingTextPath(workspace, SOURCE_SLUG),
    "the gauge reads the river's rise",
    "utf8",
  );
  mkdirSync(join(workspace, "map", "notes"), { recursive: true });
  writeFileSync(notePath(workspace, SOURCE_SLUG), "check it after rain", "utf8");
}

function askRecords(overrides: Partial<AskCardRecord> = {}): AskCardRecord[] {
  return [
    {
      on: "rain-gauge-question",
      name: "Rain gauge question",
      x: 360,
      y: 60,
      anchor: SOURCE_SLUG,
      ...overrides,
    },
  ];
}

const askCardIo = {
  saveAsks: (workspace: string, asks: readonly AskCardRecord[], malformed: readonly string[] = []) =>
    saveAsks(workspace, asks, malformed, askIo),
};

const turnIo: AskTurnIo = {
  appendExchange: (workspace, slug, question, answer, io = askIo) =>
    appendExchange(workspace, slug, question, answer, askIo, () => TAKEN),
};

describe("the ask card is its own record family", () => {
  test("one line round-trips byte-exactly, and a malformed line is kept", () => {
    const ask: AskCardRecord = {
      on: "rain-gauge-question",
      name: "Rain gauge question | the second one",
      x: 360,
      y: 60,
      anchor: SOURCE_SLUG,
    };
    const line = serializeAskLine(ask);
    expect(parseAskLine(line)).toEqual(ask);
    // The writer's canonical bytes: LF and one trailing newline.
    expect(serializeAsks([ask])).toBe(line + "\n");
    const parsed = parseAsks(line + "\nnot an ask line\n");
    expect(parsed.asks).toEqual([ask]);
    expect(parsed.malformed).toEqual(["not an ask line"]);
    // The file is not validated into shape: a bad line is never guessed at.
    expect(parseAskLine("on: x | name: y | x: 1 | y: 2")).toBeNull();
  });

  test("the conversation is JSONL, one line per turn, the words verbatim", () => {
    const person: AskTurn = { role: "person", text: QUESTION, t: TAKEN };
    const answer: AskTurn = { role: "answer", text: ANSWER, t: TAKEN };
    // The house JSONL seam sorts the keys; the words are untouched inside.
    expect(serializeTurnLine(person)).toBe(
      JSON.stringify({ role: "person", t: TAKEN, text: QUESTION }),
    );
    expect(parseTurnLine(serializeTurnLine(person))).toEqual(person);
    const parsed = parseTurns(
      serializeTurnLine(person) + "\n" + serializeTurnLine(answer) + "\n{oops\n",
    );
    expect(parsed.turns).toEqual([person, answer]);
    expect(parsed.malformed).toEqual(["{oops"]);
    // A role the story does not know is refused, never read as a turn.
    expect(parseTurnLine('{"role":"system","text":"x","t":"y"}')).toBeNull();
  });

  test("the card is NOT a reading and has no note of its own", async () => {
    const workspace = freshWorkspace();
    await seedReference(workspace);
    const written = await writeAskCard(
      workspace,
      [REFERENCE],
      [],
      [],
      SOURCE_SLUG,
      "Rain gauge question",
      360,
      60,
        askCardIo,
      );
    expect(written.asks).toHaveLength(1);
    expect(written.ask.anchor).toBe(SOURCE_SLUG);
    // ONE record file, one line; no readings line and no note for the ask.
    expect(readFileSync(asksPath(workspace), "utf8")).toBe(
      serializeAskLine(written.ask) + "\n",
    );
    expect(readFileSync(readingsPath(workspace), "utf8")).toBe("\n");
    expect(() => readFileSync(notePath(workspace, written.ask.on), "utf8")).toThrow();
  });
});

describe("ONE slug space with ground.txt", () => {
  test("minting an ask card checks BOTH files", () => {
    const taken = sharedSlugs([REFERENCE], []);
    const first = addAsk([], taken, SOURCE_NAME, 10, 20, SOURCE_SLUG);
    // The ground reference already holds `rain-gauge`: the ask dedupes.
    expect(first.ask.on).toBe("rain-gauge-2");
    const second = addAsk(
      first.asks,
      sharedSlugs([REFERENCE], first.asks),
      SOURCE_NAME,
      30,
      40,
      SOURCE_SLUG,
    );
    expect(second.ask.on).toBe("rain-gauge-3");
    // The person's words and point are kept exactly; coordinates are ints.
    expect(second.ask.name).toBe(SOURCE_NAME);
    expect(second.ask.x).toBe(30);
  });

  test("a ground reference minted later cannot twin an ask card", () => {
    const asks = askRecords();
    // With the shared set, the collision dedupes ...
    const shared = addGroundReference(
      [],
      "Rain gauge question",
      10,
      20,
      sharedSlugs([], asks),
    );
    expect(shared.reference.on).toBe("rain-gauge-question-2");
    // ... while the default (no asks known) mints exactly as before.
    const alone = addGroundReference([], "Rain gauge question", 10, 20);
    expect(alone.reference.on).toBe("rain-gauge-question");
  });

  test("the hook hands the SHARED set to every ground minting path", () => {
    // STORY 18.3: the one slug space now spans THREE families, and every
    // minting path is handed all of them — a session card's slug can no more
    // be twinned than an ask card's.
    expect(HOOK).toContain(
      "sharedSlugs(referencesRef.current, asksRef.current, sessionsRef.current)",
    );
    // The four creation helpers take it as their own option.
    expect(HOOK.match(/options\.taken,/g)?.length ?? 0).toBe(3);
  });
});

describe("the anchor is a FIELD, never a link", () => {
  test("a dangling anchor is a legal record and is never repaired", async () => {
    const workspace = freshWorkspace();
    const written = await writeAskCard(
      workspace,
      [], // the source does NOT exist on this map
      [],
      [],
      "a-card-that-went",
      "Gone question",
      10,
      20,
      askCardIo,
    );
    const reloaded = await loadAsks(workspace, askIo);
    expect(reloaded.asks).toEqual([written.ask]);
    // No repair, no refusal: the field keeps exactly what it was given.
    expect(reloaded.asks[0]!.anchor).toBe("a-card-that-went");
  });
});

describe("one exchange survives a reopen", () => {
  test("the ask card and its one exchange are read back from map/ alone", async () => {
    const workspace = freshWorkspace();
    await seedReference(workspace);
    const written = await writeAskCard(
      workspace,
      [REFERENCE],
      [],
      [],
      SOURCE_SLUG,
      "Rain gauge question",
      360,
      60,
        askCardIo,
      );
    const recorded = await recordAskTurn(
      workspace,
      written.ask.on,
      QUESTION,
      { kind: "answer", text: ANSWER },
      turnIo,
    );
    expect(recorded.sentence).toBeNull();
    expect(recorded.turns).toHaveLength(2);

    // REOPEN: nothing but the folder is read.
    const asks = await loadAsks(workspace, askIo);
    const turns = await loadAskTurns(workspace, [written.ask.on], askIo);
    expect(asks.asks).toEqual([written.ask]);
    expect(turns[written.ask.on]!.turns).toEqual(recorded.turns);
    // The words are VERBATIM, whitespace and newlines included.
    expect(turns[written.ask.on]!.turns[0]!.text).toBe(QUESTION);
    expect(turns[written.ask.on]!.turns[1]!.text).toBe(ANSWER);
    // The card still says what it is about.
    expect(asks.asks[0]!.anchor).toBe(SOURCE_SLUG);
    expect(readFileSync(askTurnPath(workspace, written.ask.on), "utf8")).toBe(
      serializeTurnLine(recorded.turns[0]!) +
        "\n" +
        serializeTurnLine(recorded.turns[1]!) +
        "\n",
    );
  });

  test("the crop is the LAST turn, role-marked and verbatim", () => {
    const turns = [
      { role: "person" as const, text: QUESTION, t: TAKEN },
      { role: "answer" as const, text: ANSWER, t: TAKEN },
    ];
    // Story 17.2: the small card shows the newest turn, not the first.
    expect(askLastTurnText(turns)).toBe("answer: " + ANSWER);
    expect(askLastTurnText([])).toBe("");
  });
});

describe("a failed turn writes the person's line only", () => {
  test("one person line, no answer line, ONE sentence", async () => {
    const workspace = freshWorkspace();
    await saveAsks(workspace, askRecords(), [], askIo);
    const recorded = await recordAskTurn(
      workspace,
      "rain-gauge-question",
      QUESTION,
      { kind: "failed", sentence: "the provider did not answer in time" },
      turnIo,
    );
    expect(recorded.sentence).toBe("the provider did not answer in time");
    expect(recorded.turns).toHaveLength(1);
    expect(recorded.turns[0]!.role).toBe("person");
    expect(recorded.turns[0]!.text).toBe(QUESTION);
    // The file holds exactly ONE line: no partial is ever written as an answer.
    const file = readFileSync(
      askTurnPath(workspace, "rain-gauge-question"),
      "utf8",
    );
    expect(file.trimEnd().split("\n")).toHaveLength(1);
    expect(file).not.toContain('"role":"answer"');
  });

  test("a turn's result becomes its sentence, and only an answer is an answer", () => {
    expect(askSendResult({ kind: "answer", text: ANSWER })).toEqual({
      kind: "answer",
      text: ANSWER,
    });
    for (const kind of ["error", "cancelled", "timeout"] as const) {
      const sent = askSendResult({ kind, sentence: kind + " sentence" } as never);
      expect(sent).toEqual({ kind: "failed", sentence: kind + " sentence" });
    }
  });

  test("appendTurn adds ONE line, keeping every earlier byte", async () => {
    const workspace = freshWorkspace();
    const first = await appendTurn(
      workspace,
      "rain-gauge-question",
      { role: "person" as const, text: QUESTION, t: TAKEN },
      askIo,
    );
    expect(first).toHaveLength(1);
    const before = readFileSync(
      askTurnPath(workspace, "rain-gauge-question"),
      "utf8",
    );
    const second = await appendTurn(
      workspace,
      "rain-gauge-question",
      { role: "answer" as const, text: ANSWER, t: TAKEN },
      askIo,
    );
    expect(second).toHaveLength(2);
    const after = readFileSync(
      askTurnPath(workspace, "rain-gauge-question"),
      "utf8",
    );
    expect(after.startsWith(before)).toBe(true);
    expect(after).toBe(before + serializeTurnLine(second[1]!) + "\n");
  });

  test("the conversation is APPEND-ONLY: an earlier line is a prefix", async () => {
    const workspace = freshWorkspace();
    await saveAsks(workspace, askRecords(), [], askIo);
    await recordAskTurn(
      workspace,
      "rain-gauge-question",
      "first question",
      { kind: "answer", text: "first answer" },
      turnIo,
    );
    const before = readFileSync(
      askTurnPath(workspace, "rain-gauge-question"),
      "utf8",
    );
    await recordAskTurn(
      workspace,
      "rain-gauge-question",
      "second question",
      { kind: "answer", text: "second answer" },
      turnIo,
    );
    const after = readFileSync(
      askTurnPath(workspace, "rain-gauge-question"),
      "utf8",
    );
    expect(after.startsWith(before)).toBe(true);
    expect(after).not.toBe(before);
  });
});

describe("the reference card is never modified", () => {
  test("the whole map folder is byte-identical after an ask is made and asked", async () => {
    const workspace = freshWorkspace();
    await seedReference(workspace);
    const before = folderBytes(workspace);
    const written = await writeAskCard(
      workspace,
      [REFERENCE],
      [],
      [],
      SOURCE_SLUG,
      "Rain gauge question",
      360,
      60,
        askCardIo,
      );
    await recordAskTurn(
      workspace,
      written.ask.on,
      QUESTION,
      { kind: "answer", text: ANSWER },
      turnIo,
    );
    const after = folderBytes(workspace);
    // Every file that was there is untouched, byte for byte.
    for (const [key, bytes] of Object.entries(before)) {
      expect({ key, bytes: after[key] }).toEqual({ key, bytes });
    }
    // The ask's own two pieces are the ONLY additions.
    expect(Object.keys(after).sort()).toEqual(
      [
        ...Object.keys(before),
        "asks.txt",
        "asks/rain-gauge-question.jsonl",
      ].sort(),
    );
  });
});

describe("an empty question refuses and writes nothing", () => {
  test("the one refusal rule, PURE", () => {
    expect(askQuestionRefusal("")).toBe(ASK_QUESTION_REFUSAL);
    expect(askQuestionRefusal("   \n ")).toBe(ASK_QUESTION_REFUSAL);
    expect(askQuestionRefusal("why?")).toBeNull();
    expect(askRefusal("  ")).toBe(ASK_NAME_REFUSAL);
    expect(askRefusal("Rain gauge question")).toBeNull();
  });

  test("the writer's refusals run BEFORE any file is touched", async () => {
    const workspace = freshWorkspace();
    await saveAsks(workspace, askRecords(), [], askIo);
    // No caller may reach the record path with an empty question: the hook
    // refuses first, and the empty test proves nothing was written.
    expect(askQuestionRefusal("")).not.toBeNull();
    expect(() =>
      readFileSync(askTurnPath(workspace, "rain-gauge-question"), "utf8"),
    ).toThrow();
    // The hook's own order: refuse, then the turn, then the record (story
    // 17.4 moved the record into writeAskTurn, which writes the Move first).
    const turnBlock = HOOK.slice(
      HOOK.indexOf("const askTurn = useCallback"),
    );
    expect(turnBlock.indexOf("askQuestionRefusal(question)")).toBeLessThan(
      turnBlock.indexOf("writeAskTurn("),
    );
    expect(turnBlock.indexOf("askQuestionRefusal(question)")).toBeLessThan(
      turnBlock.indexOf("sendAskQuestion("),
    );
  });

  test("the creation refuses a blank name before the queue", () => {
    expect(askRefusal("")).toBe(ASK_NAME_REFUSAL);
    const createBlock = HOOK.slice(HOOK.indexOf("const createAsk = useCallback"));
    const scoped = createBlock.slice(0, createBlock.indexOf("const askTurn = useCallback"));
    expect(scoped.indexOf("askRefusal(name)")).toBeGreaterThan(-1);
    expect(scoped.indexOf("askRefusal(name)")).toBeLessThan(
      scoped.indexOf("writeAskCard("),
    );
  });
});

describe("the card's face: a conversation, cropped, and nothing counted", () => {
  const turns: AskTurn[] = [
    { role: "person", text: QUESTION, t: TAKEN },
    { role: "answer", text: ANSWER, t: TAKEN },
  ];

  test("the small card names itself, says what it is about, and crops the LAST turn", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: askRecords()[0]!,
        anchorName: SOURCE_NAME,
        turns: [
          turns[0]!,
          { role: "answer", text: ANSWER + "\nand one more line", t: TAKEN },
        ],
        open: false,
        previewLines: 1,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("Rain gauge question");
    expect(html).toContain("a question about Rain gauge");
    // Story 17.2: the newest turn, not the first — the first question is not
    // on the small face at all.
    // The role is its own quiet mark beside the words, never a bubble.
    expect(html).toContain(">answer<");
    expect(html).not.toContain("what does the gauge measure");
    // A one-line threshold folds the rest away behind the card's "more".
    expect(html).toContain("…");
    expect(html).toContain("more");
    // Nothing here is a count of turns or a meter.
    expect(html).not.toMatch(/\b(count|counts|turns|total)\b/i);
  });

  test("the expanded card asks and shows the whole exchange", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: askRecords()[0]!,
        anchorName: SOURCE_NAME,
        turns,
        open: true,
        previewLines: 40,
        onOpen: () => {},
        onClose: () => {},
        onAskTurn: async () => ({ ok: true }),
      }),
    );
    expect(html).toContain("ask-card-question");
    expect(html).toContain("send");
    // React escapes the apostrophe in static markup; the words are there.
    expect(html).toContain("slow argument");
    expect(html).not.toContain(ASK_EMPTY_SENTENCE);
  });

  test("a card with no exchange says so in one quiet line; a gone anchor is said", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: askRecords()[0]!,
        anchorName: null,
        turns: [],
        open: false,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain(ASK_EMPTY_SENTENCE);
    expect(askKindLine(null)).toBe("a question about a card that is not here");
    expect(askKindLine(SOURCE_NAME)).toBe("a question about Rain gauge");
  });

  test("the layer renders the ask cards beside the references", () => {
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [REFERENCE],
        readings: [],
        texts: {},
        states: {},
        asks: askRecords(),
        askTurns: { "rain-gauge-question": turns },
        onMove: async () => ({ ok: true }),
        onRefresh: async () => ({ ok: true }),
        onRepoint: async () => ({ ok: true }),
        onRemove: async () => ({ ok: true }),
      }),
    );
    expect(html).toContain("ground-reference");
    expect(html).toContain("ask-card");
    expect(html).toContain("Rain gauge question");
    // The ground map still renders NO concept content: an ask card is ground.
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

describe("the ask path reuses the existing card-ask turn (story 17.3 adds the thread)", () => {
  test("the hook assembles the card's packet and sends it through the port", () => {
    // 17.1 reused the card's packet; 17.3 extends it with the conversation, so
    // the ask card's assembler is the thread-bearing one — same card block,
    // same port, same ceiling.
    expect(HOOK).toContain("assembleAskCardPacket(");
    expect(HOOK).toContain("cardAskContext(");
    expect(HOOK).toContain("turn.sendPacket(");
    // The app hands the hook the ONE turn port the card panel uses.
    expect(APP).toContain('useGround(workspace?.path ?? "", turnPort)');
    expect(APP).toContain("onCreateAsk={ground.createAsk}");
    expect(APP).toContain("onAskTurn={ground.askTurn}");
    // The ask paths own no mirror write: a turn adds no name, anchor or parent
    // to MAP.md. 17.4/17.8 own the PRISM and the history line.
    const askBlock = HOOK.slice(HOOK.indexOf("const createAsk = useCallback"));
    const turnBlock = askBlock.slice(askBlock.indexOf("const askTurn = useCallback"));
    const sendBlock = turnBlock.slice(0, turnBlock.indexOf("const move = useCallback"));
    // STORY 17.8: a sending turn now DOES log ask.turn (the slug and the
    // PRISM's ending, never a word). What must stay true is that no history
    // line can carry the words: the only event built here is askTurnHistoryEvent.
    expect(sendBlock).toContain("askTurnHistoryEvent(");
    expect(sendBlock).toContain("queueHistory(");
    // The event can only name the slug and the PRISM's ending: no word of the
    // question or the answer can reach it.
    const historyCall = sendBlock.slice(
      sendBlock.indexOf("askTurnHistoryEvent("),
      sendBlock.indexOf("return event === null"),
    );
    expect(historyCall).not.toContain("question");
    expect(historyCall).not.toContain("recorded.turns");
    expect(sendBlock).not.toContain("queueMirror(");
  });

  test("the proposed name is the anchored card's words plus the noun", () => {
    expect(proposeAskName(SOURCE_NAME)).toBe("Rain gauge question");
    expect(proposeAskName("  ")).toBe("a question");
    // The selection card's placement idiom, beside the source.
    expect(askPlacement(100, 200)).toEqual({ x: 420, y: 200 });
    // The source-card refusals exist for a layer that knows no cards yet.
    expect(ASK_SOURCE_REFUSAL).toBe("that card is not on the map.");
    expect(ASK_MISSING_REFUSAL).toBe("there is no ask card here.");
  });

  test("an unreadable ask line is preserved and surfaced, never dropped", () => {
    expect(APP).toContain("malformedAsks={ground.malformedAsks}");
    expect(APP).toContain("unreadable line in map/asks.txt");
  });

  test("the ask card's classes are content to the plane's gate", () => {
    for (const name of [
      "ask-card",
      "ask-card-question",
      "ask-card-send",
      "ground-ask-card",
      "ground-ask-naming",
    ]) {
      expect(CONTENT_CLASSES).toContain(name);
    }
  });

  test("the embedded panel is retired: one ask-shaped verb, no second surface", () => {
    // STORY 17.7: the card keeps `ask about this` and nothing else ask-shaped;
    // the ask card owns the turn, the declaration and the readback.
    expect(LAYER).toContain("ask about this");
    expect(LAYER).not.toContain("ask…");
    expect(LAYER).not.toContain("AskSidecarPanel");
    expect(LAYER).not.toContain("ground-ask-panel");
    expect(LAYER).not.toMatch(/\bonAsk\b/);
    expect(APP).not.toContain("onAsk={turnPort}");
    expect(APP).not.toContain("providersRev");
    // The surviving ask surface still mounts the shared packet declaration.
    expect(source("canvas/AskCard.tsx")).toContain("<PacketSurface");
    expect(APP).toContain("onAskTurn={ground.askTurn}");
  });
});
