import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ASK_EMPTY_SENTENCE,
  ASK_INCOMPLETE_MARK,
  ASK_STOPPED_MARK,
  AskCard,
  askAtBottom,
  askEndingMark,
  askPartPending,
  askPendingInRecord,
  askSendPending,
  askSettlePending,
  type AskPending,
} from "../src/canvas/AskCard";
import {
  appendTurn,
  askLastTurn,
  askLastTurnText,
  askRoleMark,
  askTurnPath,
  loadTurns,
  type AskCard as AskCardRecord,
  type AskIo,
  type AskTurn,
} from "../src/map/asks";

/**
 * STORY 17.2 — the conversation is the card.
 *
 * The story's check is human ("ask three questions in a row, each answer under
 * its question, quit, reopen: all six lines in order, the last one on the small
 * card; Esc closes the editor and leaves the map"). This file pins the rules
 * underneath it:
 *
 *   - turns render in FILE ORDER (append-only, never sorted), newest at the
 *     bottom;
 *   - the small face crops the LAST turn, not the first line and never a count;
 *   - the pending line streams the answer and a stop keeps it MARKED incomplete;
 *   - one turn at a time (the input and send disable while running);
 *   - Esc collapses the card's editor and a draft writes nothing;
 *   - the card's wheel stops at the card, and the body follows the newest line
 *     unless the person scrolled up.
 *
 * PROVISIONAL: the role marks, the scroll slack, and the stopped wording.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const ASK_CARD = source("canvas/AskCard.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const APP = source("App.tsx");
const HOOK = source("canvas/useGround.ts");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-ask-thread-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const TAKEN = "2026-11-17T12:00:00.000Z";
const ASK: AskCardRecord = {
  on: "rain-gauge-question",
  name: "Rain gauge question",
  x: 360,
  y: 60,
  anchor: "rain-gauge",
};

function turn(role: "person" | "answer", text: string): AskTurn {
  return { role, text, t: TAKEN };
}

const io: AskIo = {
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

function freshWorkspace(): string {
  return mkdtempSync(join(ROOT, "workspace-"));
}

function renderAsk(props: {
  turns: readonly AskTurn[];
  open: boolean;
  previewLines?: number;
  onAskTurn?: (
    slug: string,
    question: string,
    onPart?: (text: string) => void,
  ) => Promise<{ ok: true }>;
}) {
  return renderToStaticMarkup(
    createElement(AskCard, {
      ask: ASK,
      anchorName: "Rain gauge",
      turns: props.turns,
      open: props.open,
      previewLines: props.previewLines ?? 6,
      onOpen: () => {},
      onClose: () => {},
      ...(props.onAskTurn === undefined ? {} : { onAskTurn: props.onAskTurn }),
    }),
  );
}

describe("the thread is in order, newest at the bottom", () => {
  test("three exchanges survive a reopen in the same order", async () => {
    const workspace = freshWorkspace();
    const exchanges: Array<[string, string]> = [
      ["first question", "first answer"],
      ["second question", "second answer"],
      ["third question", "third answer"],
    ];
    for (const [question, answer] of exchanges) {
      await appendTurn(workspace, ASK.on, turn("person", question), io);
      await appendTurn(workspace, ASK.on, turn("answer", answer), io);
    }
    // REOPEN: nothing but the folder is read.
    const reopened = await loadTurns(workspace, ASK.on, io);
    expect(reopened.malformed).toEqual([]);
    expect(reopened.turns.map((entry) => entry.role)).toEqual([
      "person",
      "answer",
      "person",
      "answer",
      "person",
      "answer",
    ]);
    expect(reopened.turns.map((entry) => entry.text)).toEqual(
      exchanges.flat(),
    );
    // The words are the record's; the role mark is only a reading surface.
    expect(askRoleMark("person")).toBe("you");
    expect(askRoleMark("answer")).toBe("answer");
    // The file is append-only: each new line only extends the earlier bytes.
    const bytes = readFileSync(askTurnPath(workspace, ASK.on), "utf8");
    expect(bytes.trimEnd().split("\n")).toHaveLength(6);
    expect(askLastTurn(reopened.turns)?.text).toBe("third answer");
  });

  test("the expanded card renders the whole thread in file order", () => {
    const turns = [
      turn("person", "first question"),
      turn("answer", "first answer"),
      turn("person", "second question"),
      turn("answer", "second answer"),
      turn("person", "third question"),
      turn("answer", "third answer"),
    ];
    const html = renderAsk({ turns, open: true });
    const order = [
      "first question",
      "first answer",
      "second question",
      "second answer",
      "third question",
      "third answer",
    ].map((text) => html.indexOf(text));
    for (const at of order) expect(at).toBeGreaterThan(-1);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Role is a quiet mark and the ink ladder, not a bubble, avatar or ticker.
    expect(html).toContain("ask-turn-role");
    expect(html).toContain(">you<");
    expect(html).toContain(">answer<");
    expect(html).not.toContain(TAKEN);
    expect(html).not.toMatch(/\b(avatar|bubble|timestamp)\b/i);
  });

  test("nothing counts: no turn total, no meter", () => {
    const html = renderAsk({
      turns: [turn("person", "q"), turn("answer", "a")],
      open: true,
    });
    expect(html).not.toMatch(/\b(count|counts|turns|total)\b/i);
    expect(html).not.toMatch(/\b\d+\s*(of|\/)\s*\d+\b/);
  });
});

describe("the small face shows the LAST turn's crop", () => {
  test("the pure crop is the newest turn, not the first", () => {
    const turns = [
      turn("person", "first question"),
      turn("answer", "first answer"),
      turn("person", "last question"),
    ];
    expect(askLastTurnText(turns)).toBe("you: last question");
    expect(askLastTurnText([])).toBe("");
    expect(askLastTurn(turns)).toEqual(turns[2]!);
  });

  test("the rendered small card carries the last turn and drops the first", () => {
    const html = renderAsk({
      turns: [
        turn("person", "first question"),
        turn("answer", "first answer"),
        turn("person", "last question"),
        turn("answer", "last answer"),
      ],
      open: false,
      previewLines: 6,
    });
    expect(html).toContain("last answer");
    expect(html).toContain("answer");
    expect(html).not.toContain("first question");
    expect(html).not.toContain("first answer");
    // Nothing on the small face is a count of turns.
    expect(html).not.toMatch(/\b(count|counts|turns|total)\b/i);
  });

  test("a card with no turns says so in one quiet line", () => {
    expect(renderAsk({ turns: [], open: false })).toContain(ASK_EMPTY_SENTENCE);
  });
});

describe("one turn at a time, streaming, and stop", () => {
  test("the pending answer accumulates on every part", () => {
    const sent = askSendPending("why?");
    expect(sent).toEqual({ question: "why?", answer: "", ending: "running" });
    const first = askPartPending(sent, "the ");
    const second = askPartPending(first, "the river");
    expect(second?.answer).toBe("the river");
    expect(second?.ending).toBe("running");
    // A settled line is never reopened by a late part.
    expect(askPartPending({ ...second!, ending: "stopped" }, "more")?.answer).toBe(
      "the river",
    );
  });

  test("a stopped turn keeps what arrived and MARKS it incomplete", () => {
    const stopped = askSettlePending(
      askPartPending(askSendPending("why?"), "the river"),
      false,
      true,
    );
    expect(stopped).toEqual({
      question: "",
      answer: "the river",
      ending: "stopped",
    });
    expect(askEndingMark(stopped!.ending)).toBe(ASK_STOPPED_MARK);
    // A broken stream (not the person's stop) is its own mark.
    const broken = askSettlePending(
      askPartPending(askSendPending("why?"), "the river"),
      false,
      false,
    );
    expect(askEndingMark(broken!.ending)).toBe(ASK_INCOMPLETE_MARK);
    // No words, nothing to mark; the sentence stands alone.
    expect(askSettlePending(askSendPending("why?"), false, true)).toBeNull();
    // An answered turn is in the record: the pending line goes.
    expect(
      askSettlePending(askPartPending(askSendPending("why?"), "the river"), true, false),
    ).toBeNull();
    expect(askEndingMark("running")).toBeNull();
  });

  test("a pending line is not drawn twice when its record write lands", () => {
    const pending: AskPending = {
      question: "why?",
      answer: "the river",
      ending: "running",
    };
    // The record now ends with the just-written pair.
    const recorded = [
      turn("person", "earlier"),
      turn("answer", "earlier answer"),
      turn("person", "why?"),
      turn("answer", "the river"),
    ];
    expect(askPendingInRecord(recorded, pending)).toEqual({
      question: true,
      answer: true,
    });
    // A stopped partial has its person line in the record but no answer line:
    // the partial is still drawn, marked.
    const stopped: AskPending = {
      question: "",
      answer: "the riv",
      ending: "stopped",
    };
    const afterStop = [turn("person", "why?")];
    expect(askPendingInRecord(afterStop, stopped)).toEqual({
      question: false,
      answer: false,
    });
    expect(askPendingInRecord([], pending)).toEqual({
      question: false,
      answer: false,
    });
  });

  test("the input disables while a turn runs, and the stop is the existing stop", () => {
    // The rendering rule, in the component that owns it.
    expect(ASK_CARD).toContain("const running = pending !== null && pending.ending === \"running\";");
    expect(ASK_CARD.match(/disabled=\{running\}/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    expect(ASK_CARD).toContain("ask-card-stop");
    expect(ASK_CARD).toContain("await onStopTurn()");
    // The streaming path feeds the pending line, never a second answer.
    const sendBlock = ASK_CARD.slice(ASK_CARD.indexOf("async function send()"));
    expect(sendBlock).toContain("onAskTurn(ask.on, asked");
    expect(sendBlock).toContain("askPartPending(current, text)");
    expect(sendBlock.indexOf("askPartPending")).toBeGreaterThan(
      sendBlock.indexOf("onAskTurn(ask.on, asked"),
    );
    // The stop is the hook's turn port, wired once from the app.
    expect(HOOK).toContain("await turn.stop();");
    expect(APP).toContain("onStopAskTurn={ground.askStop}");
    expect(LAYER).toContain("onStopTurn={onStopAskTurn}");
    // No PRISM and no new record: an ask turn still writes only the exchange.
    expect(ASK_CARD).not.toContain("appendTurn");
    expect(ASK_CARD).not.toContain("appendExchange");
    expect(ASK_CARD).not.toContain("prism");
  });
});

describe("Esc closes the card's editor and a draft writes nothing", () => {
  test("the Esc handler collapses the card and touches no writer", () => {
    const esc = ASK_CARD.slice(
      ASK_CARD.indexOf("if (!open) return;"),
      ASK_CARD.indexOf("// THE CARD'S WHEEL NEVER ZOOMS THE PLANE"),
    );
    expect(esc).toContain('e.key !== "Escape"');
    expect(esc).toContain("onClose()");
    // Capture phase, so the plane's own bubble handlers never see the key.
    expect(esc).toContain('document.addEventListener("keydown", onKey, true)');
    expect(esc).toContain("e.stopPropagation()");
    // A half-typed draft is NOT written and NOT cleared by Esc: only send
    // reaches the writer, and only send clears the field.
    expect(esc).not.toContain("onAskTurn");
    expect(esc).not.toContain("setQuestion");
    expect(ASK_CARD.match(/onAskTurn\(/g)?.length ?? 0).toBe(1);
    expect(ASK_CARD).toContain('setQuestion("");');
  });

  test("collapsing is the layer's view state, not the map's", () => {
    expect(LAYER).toContain("onClose={() => setOpenAskOn(null)}");
    // The card's own close is the only thing the Esc path reaches; there is no
    // map-level close in it, and the AskCard never moves the camera.
    expect(ASK_CARD).not.toContain("setCamera");
    expect(ASK_CARD).not.toContain("zoomTo");
  });
});

describe("scrolling: the wheel stays in the card and the body follows", () => {
  test("the body follows the newest line unless the person scrolled up", () => {
    expect(askAtBottom(600, 300, 900)).toBe(true);
    expect(askAtBottom(500, 300, 900)).toBe(false);
    expect(ASK_CARD).toContain("askAtBottom(");
    expect(ASK_CARD).toContain("el.scrollTop = el.scrollHeight;");
    expect(ASK_CARD).toContain("pinnedRef.current");
    // The card's wheel stops at the card, so the plane never zooms.
    expect(ASK_CARD).toContain("function onWheel(e: WheelEvent)");
    expect(ASK_CARD).toContain("e.stopPropagation();");
    expect(ASK_CARD).toContain("{ passive: true }");
  });
});
