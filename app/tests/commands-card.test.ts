import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommandAct } from "../src/commands/acts";
import {
  applyCommandScript,
  createAttentioneerHost,
} from "../src/commands/attentioneerHost";
import { executeScript, type CommandHost } from "../src/commands/execute";
import { INTERPRETER_FENCE } from "../src/commands/interpreter";
import {
  interpretInstruction,
  type InterpreterMove,
} from "../src/commands/interpreterCall";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import {
  COMMAND_ACCEPT_VERB,
  COMMAND_APPLIED_SENTENCE,
  COMMAND_INVITATION,
  COMMAND_NON_GROUND_SENTENCE,
  COMMAND_ONE_PRESS,
  COMMAND_READING_SENTENCE,
  COMMAND_REFUSE_VERB,
  COMMAND_REFUSED_SENTENCE,
  COMMAND_SECOND_QUESTION_SENTENCE,
  CommandCard,
  actLine,
  actLines,
  appliedExchange,
  clarifiedInstruction,
  commandAnchor,
  commandMapLive,
  commandTurnOf,
  failureReport,
  refusedExchange,
  type CommandCardProps,
  type CommandQuestion,
} from "../src/canvas/CommandCard";
import { nodeCommandIo } from "../scripts/commands";

/**
 * STORY 21.3 — THE COMMAND CARD (ADR-0038 decisions 1, 4 and 5).
 *
 * There is no DOM harness, so this file proves what can be proved without one:
 * the card's controlled RENDER FACTS with react-dom/server (closed by default,
 * no badge or pulse in the markup, the plain-word numbered act list, the one
 * clarifying question with a field and no acts, the non-ground sentence), the
 * PURE seam (act lines, the failure report, the anchor, the one-press constant)
 * and the REAL apply seam over a temp workspace (execute the sealed script and
 * accept its ghosts in ONE call; a mid-script failure accepts none and names
 * the act). What is left for a human is the feel: the bar's seat, the card's
 * size, focus leaving the card on Tab, and the map showing the changes.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

const APP_TSX = source("src/App.tsx");
const CARD = source("src/canvas/CommandCard.tsx");
const CSS = source("src/canvas/canvas.css");

function render(props: Partial<CommandCardProps> = {}): string {
  return renderToStaticMarkup(
    createElement(CommandCard, {
      level: "ground",
      open: true,
      instruction: "",
      answer: "",
      exchanges: [],
      dropped: false,
      view: null,
      busy: null,
      onOpen: () => {},
      onClose: () => {},
      onInstruction: () => {},
      onAnswer: () => {},
      onInterpret: () => {},
      onAnswerQuestion: () => {},
      onAccept: () => {},
      onRefuse: () => {},
      ...props,
    }),
  );
}

const WIRE: CommandAct = {
  act: "propose_wire",
  map: "ground",
  payload: { from: "rain gauge", to: "soil" },
};

const NOTE: CommandAct = {
  act: "propose_note",
  map: "ground",
  payload: { card: "rain gauge", note: "it is the gauge" },
};

/** The note the one-press check can actually file: its card is already there. */
const NOTE_ON_RAIN: CommandAct = {
  act: "propose_note",
  map: "ground",
  payload: { card: "rain", note: "it is the gauge" },
};

function listCount(html: string): number {
  return (html.match(/<li>/g) ?? []).length;
}

/* ------------------------------------------------------------------ *
 * CLOSED BY DEFAULT, NO NUDGE
 * ------------------------------------------------------------------ */

describe("the card is closed by default and never calls attention", () => {
  test("the closed render is ONE invitation bar and nothing else", () => {
    const html = render({ open: false });
    expect(html).toContain("command-card-bar");
    expect(html).toContain(COMMAND_INVITATION);
    expect(html).not.toContain("command-card-acts");
    expect(html).not.toContain("command-card-instruction");
    expect(html).not.toContain(COMMAND_ACCEPT_VERB);
    expect(html).not.toContain(COMMAND_REFUSE_VERB);
  });

  test("the app's flag starts false, and only the person's press opens it", () => {
    const start = APP_TSX.indexOf("const [commandOpen");
    expect(start).toBeGreaterThan(-1);
    expect(APP_TSX.slice(start, start + 80)).toContain("useState(false)");
    // One door: openCommandCard, the closed bar's handler. No effect, timer or
    // map read opens the card.
    expect((APP_TSX.match(/setCommandOpen\(true\)/g) ?? []).length).toBe(1);
    expect(CARD).not.toContain("setOpen");
  });

  test("no badge, pulse, unread marker or timer lives in the card", () => {
    // Comments name these rules in the house voice; the MECHANISMS are what
    // this pins: no timer, and no such marker in either rendered face.
    expect(CARD).not.toContain("setInterval");
    expect(CARD).not.toContain("setTimeout");
    const html = render({ open: false }) + render();
    for (const banned of ["badge", "pulse", "unread"]) {
      expect(html).not.toContain(banned);
    }
    // The card's CSS block carries no entry animation either: it does not move
    // to catch the eye.
    const block = CSS.slice(CSS.indexOf(".command-card {"));
    expect(block).not.toContain("animation:");
    expect(block).not.toContain("@keyframes");
  });
});

/* ------------------------------------------------------------------ *
 * PRESENT ON EVERY MAP, AND THE HONEST NON-GROUND SENTENCE
 * ------------------------------------------------------------------ */

describe("present on every map; elsewhere it says what it cannot do", () => {
  test("the app mounts the card at APP level, outside every map branch", () => {
    const at = APP_TSX.indexOf("<CommandCard");
    expect(at).toBeGreaterThan(-1);
    const before = APP_TSX.slice(Math.max(0, at - 160), at);
    expect(before).not.toContain("level ===");
    expect(before).not.toContain("level !==");
    expect(APP_TSX).toContain("on every map");
  });

  test("a non-ground map gets the sentence, no field and no acts", () => {
    expect(commandMapLive("ground")).toBe(true);
    expect(commandMapLive("concept")).toBe(false);
    expect(commandMapLive("dynamics")).toBe(false);
    const html = render({ level: "concept" });
    expect(html).toContain(COMMAND_NON_GROUND_SENTENCE);
    expect(html).not.toContain("command-card-instruction");
    expect(html).not.toContain("command-card-acts");
    expect(html).not.toContain(COMMAND_ACCEPT_VERB);
  });

  test("the anchor is the map itself when no card is open", () => {
    expect(commandAnchor("ground")).toBe("ground");
    expect(commandAnchor("concept")).toBe("concept");
    expect(commandAnchor("dynamics")).toBe("dynamics");
  });
});

/* ------------------------------------------------------------------ *
 * THE ACT LIST, IN PLAIN WORDS
 * ------------------------------------------------------------------ */

describe("the understood acts are a short numbered list in plain words", () => {
  test("one line per act, the check's own two examples first", () => {
    expect(actLines([WIRE, NOTE])).toEqual([
      "wire rain gauge → soil",
      "add a note to rain gauge",
    ]);
    expect(actLines([
      { act: "propose_card", map: "ground", payload: { name: "rain gauge", x: 1, y: 2 } },
      { act: "propose_ask", map: "ground", payload: { name: "why rain", x: 1, y: 2 } },
      { act: "read_card", map: "ground", payload: { card: "rain gauge" } },
      { act: "map_overview", map: "ground", payload: {} },
      { act: "read_wires", map: "ground", payload: {} },
    ])).toEqual([
      'add a card "rain gauge"',
      'add an ask card "why rain"',
      "read rain gauge",
      "read the map",
      "read the wires",
    ]);
    expect(actLine(WIRE)).toContain("→");
  });

  test("the render is an ordered list, one item per act, with accept and refuse", () => {
    const html = render({
      view: {
        kind: "acts",
        instruction: "wire and note",
        acts: [WIRE, NOTE],
        question: null,
      },
    });
    expect(html).toContain('<ol class="command-card-acts">');
    expect(listCount(html)).toBe(2);
    expect(html).toContain("wire rain gauge → soil");
    expect(html).toContain("add a note to rain gauge");
    expect(html).toContain(COMMAND_ACCEPT_VERB);
    expect(html).toContain(COMMAND_REFUSE_VERB);
    expect(html).toContain(COMMAND_ONE_PRESS);
  });

  test("the accept's title states the one-press rule in code", () => {
    expect(COMMAND_ONE_PRESS).toContain("this preview is the ghost preview");
    expect(CARD).toContain("title={COMMAND_ONE_PRESS}");
    expect(CARD).toContain("ONE PRESS");
    expect(CARD).toContain("ADR-0038");
  });
});

/* ------------------------------------------------------------------ *
 * ONE PRESS, AND A REFUSAL WRITES NOTHING
 * ------------------------------------------------------------------ */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-card-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const GROUND =
  "on: rain | name: rain | x: 0 | y: 0\non: soil | name: soil | x: 120 | y: 0\n";

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  writeFileSync(join(path, "map/ground.txt"), GROUND, "utf8");
  return path;
}

function inboxNames(path: string): string[] {
  try {
    return readdirSync(join(path, ".attentioneer/inbox")).sort();
  } catch {
    return [];
  }
}

const CARD_ACT: CommandAct = {
  act: "propose_card",
  map: "ground",
  payload: { name: "rain gauge", x: 40, y: 60 },
};

describe("one press applies the script; a refusal applies nothing", () => {
  test("execute and accept happen in the SAME apply call", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({
      workspacePath: path,
      io: nodeCommandIo(),
    });
    const result = await applyCommandScript([CARD_ACT, NOTE_ON_RAIN], host);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The script's two acts were executed AND their ghosts accepted: the
    // records hold both, and the inbox is empty because the accept deleted them.
    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toContain(
      "on: rain-gauge | name: rain gauge | x: 40 | y: 60",
    );
    expect(readFileSync(join(path, "map/notes/rain.md"), "utf8")).toBe(
      "it is the gauge\n",
    );
    expect(inboxNames(path)).toEqual([]);
    expect(result.run.lines).toHaveLength(2);
  });

  test("the card's reused halves compose: interpreter -> one accept -> records", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({
      workspacePath: path,
      io: nodeCommandIo(),
    });
    const answer =
      "Here is the script.\n\n" +
      "```" +
      INTERPRETER_FENCE +
      "\n" +
      JSON.stringify([CARD_ACT, NOTE_ON_RAIN]) +
      "\n```\n";
    const moves: InterpreterMove[] = [];
    const turn = await interpretInstruction({
      input: { instruction: "add a card and a note", digest: "" },
      on: commandAnchor("ground"),
      sendMessages: async () => ({ kind: "answer", text: answer }),
      recordMove: async (move) => {
        moves.push(move);
        return null;
      },
    });
    expect(turn.read.kind).toBe("acts");
    if (turn.read.kind !== "acts") return;
    // The interpreter applied NOTHING; its ONE Move is the only write so far.
    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toBe(GROUND);
    expect(moves).toHaveLength(1);
    expect(moves[0]!.role).toBe("command");
    expect(moves[0]!.on).toBe("ground");

    // The card's ONE accept is this call: execute the script and accept its
    // ghosts through the app's own accept.
    const apply = await applyCommandScript(turn.read.acts, host);
    expect(apply.ok).toBe(true);
    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toContain(
      "on: rain-gauge | name: rain gauge | x: 40 | y: 60",
    );
    expect(readFileSync(join(path, "map/notes/rain.md"), "utf8")).toBe(
      "it is the gauge\n",
    );
    expect(inboxNames(path)).toEqual([]);
  });

  test("there is one apply call in the accept door, and no second question", () => {
    const start = APP_TSX.indexOf("const acceptCommand");
    const end = APP_TSX.indexOf("const refuseCommand");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const accept = APP_TSX.slice(start, end);
    expect((accept.match(/requestApply\(acts\)/g) ?? []).length).toBe(1);
    expect(accept).not.toContain("confirm");
    expect(accept).not.toContain("window.");
  });

  test("a refusal calls no writer, no executor and no reload", () => {
    const start = APP_TSX.indexOf("const refuseCommand");
    const end = APP_TSX.indexOf("const closeCommandCard");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const refuse = APP_TSX.slice(start, end);
    // STORY 21.5: the refusal becomes an EXCHANGE in the card's conversation —
    // it still writes nothing beyond the interpreter's already-written Move.
    expect(refuse).toContain("refusedExchange");
    for (const banned of [
      "requestApply",
      "applyCommandScript",
      "executeScript",
      "createAttentioneerHost",
      "ground.reload",
    ]) {
      expect(refuse).not.toContain(banned);
    }
    // The one quiet line the refusal leaves, and no retry suggestion.
    const html = render({
      exchanges: [
        refusedExchange("wire and note", [WIRE, NOTE], null),
      ],
    });
    expect(html).toContain(COMMAND_REFUSED_SENTENCE);
    expect(html).not.toContain(COMMAND_ACCEPT_VERB);
  });
});

/* ------------------------------------------------------------------ *
 * THE CLARIFYING QUESTION
 * ------------------------------------------------------------------ */

describe("ambiguity is ONE question with a field, and proposes nothing", () => {
  const read = {
    kind: "question" as const,
    question: "Do you mean the wire first, or the note on rain?",
  };

  test("the view is a question, not acts", () => {
    const turn = commandTurnOf("do the thing", read, null);
    expect(turn.kind).toBe("pending");
    if (turn.kind !== "pending") return;
    const view = turn.view;
    expect(view.kind).toBe("question");
    if (view.kind !== "question") return;
    expect(view.question).toBe(read.question);
    expect("acts" in view).toBe(false);
  });

  test("the render is the question plus a field; no acts and no accept", () => {
    const turn = commandTurnOf("do the thing", read, null);
    if (turn.kind !== "pending") throw new Error("a question stays live");
    const html = render({
      view: turn.view,
      answer: "",
    });
    expect(html).toContain('class="command-card-question"');
    expect(html).toContain(read.question);
    expect(html).toContain('class="command-card-answer"');
    expect(html).toContain("answer the question");
    expect(html).not.toContain("command-card-acts");
    expect(html).not.toContain(COMMAND_ACCEPT_VERB);
  });

  test("one answer carries the instruction, the question and the answer", () => {
    const next = clarifiedInstruction(
      "do the thing",
      read.question,
      "the wire first",
    );
    expect(next).toContain("do the thing");
    expect(next).toContain(read.question);
    expect(next).toContain("the wire first");
  });

  test("a second question is shown plainly and asks nothing again", () => {
    // STORY 21.5: a second question COMPLETES the exchange (one question per
    // exchange), so the card shows the app's sentence and offers no field.
    const answered: CommandQuestion = {
      question: read.question,
      answer: "the wire first",
    };
    const turn = commandTurnOf(
      "do the thing",
      { kind: "question", question: "Which card?" },
      answered,
    );
    expect(turn.kind).toBe("done");
    if (turn.kind !== "done") return;
    const html = render({ exchanges: [turn.exchange] });
    expect(html).toContain(COMMAND_SECOND_QUESTION_SENTENCE);
    expect(html).not.toContain("command-card-answer-row");
    expect(html).not.toContain(COMMAND_ACCEPT_VERB);
  });
});

/* ------------------------------------------------------------------ *
 * A MID-SCRIPT FAILURE NAMES THE ACT AND WHAT DID NOT APPLY
 * ------------------------------------------------------------------ */

describe("a failure names the act and every act's disposition", () => {
  test("the executor stops at the failing act; the report names it exactly", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({
      workspacePath: path,
      io: nodeCommandIo(),
    });
    const acts: CommandAct[] = [
      CARD_ACT,
      {
        act: "propose_wire",
        map: "ground",
        payload: { from: "rain", to: "the sea" },
      },
      NOTE,
    ];
    const result = await applyCommandScript(acts, host);
    expect(result.ok).toBe(false);
    if (result.ok || result.run === null) return;
    expect(result.phase).toBe("execution");
    expect(result.run.applied).toBe(1);
    const sentence = failureReport(acts, result.run);
    expect(sentence).toContain('the act "propose_wire" failed');
    expect(sentence).toContain('"the sea" is not one of them.');
    expect(sentence).toContain('"propose_card"');
    expect(sentence).toContain("held as a ghost, not applied");
    expect(sentence).toContain('"propose_note" did not run.');
    expect(sentence).toContain("Nothing was applied");
    // NOTHING APPLIED, EXACTLY: the map folder is the seed, and the first
    // proposal is still only a filed ghost (no accept was attempted).
    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toBe(GROUND);
    expect(() => readFileSync(join(path, "map/notes/rain.md"))).toThrow();
    expect(inboxNames(path)).toHaveLength(1);
  });

  test("the host refusal stops the run: no later act runs", async () => {
    const calls: string[] = [];
    const host: CommandHost = {
      async readOverview() {
        return { ok: true, line: "map" };
      },
      async readCard() {
        return { ok: true, line: "card" };
      },
      async readWires() {
        return { ok: true, line: "wires" };
      },
      async proposeCard() {
        calls.push("propose_card");
        return { ok: true, line: "card filed", id: "ghost-1" };
      },
      async proposeWire() {
        calls.push("propose_wire");
        return { ok: false, sentence: "the app refused that act." };
      },
      async proposeNote() {
        calls.push("propose_note");
        return { ok: true, line: "note filed", id: "ghost-2" };
      },
      async proposeAsk() {
        calls.push("propose_ask");
        return { ok: true, line: "ask filed", id: "ghost-3" };
      },
    };
    const acts: CommandAct[] = [
      CARD_ACT,
      WIRE,
      NOTE,
      {
        act: "propose_ask",
        map: "ground",
        payload: { name: "why", x: 1, y: 2 },
      },
    ];
    const run = await executeScript(acts, host);
    expect(run.ok).toBe(false);
    expect(run.applied).toBe(1);
    expect(calls).toEqual(["propose_card", "propose_wire"]);
    const sentence = failureReport(acts, run);
    expect(sentence).toContain('the act "propose_wire" failed: the app refused that act.');
    expect(sentence).toContain('"propose_note", "propose_ask" did not run.');
  });
});

/* ------------------------------------------------------------------ *
 * NOT THE MAP, AND THE GATES
 * ------------------------------------------------------------------ */

describe("the card steers no map content and is belt-and-braces content", () => {
  test("renderedMapContent('ground') stays empty", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("every command-card class is on the plane's content list", () => {
    const classes = CONTENT_CLASSES as readonly string[];
    for (const name of [
      "command-card",
      "command-card-bar",
      "command-card-acts",
      "command-card-accept",
      "command-card-refuse",
      "command-card-answer",
      "command-card-instruction",
      "command-card-body",
      "command-card-elsewhere",
    ]) {
      expect(classes).toContain(name);
    }
  });

  test("the body is the only scroll region on the card", () => {
    const body = CSS.slice(
      CSS.indexOf(".command-card-body {"),
      CSS.indexOf(".command-card-last {"),
    );
    expect(body).toContain("overflow-y: auto");
    expect(body).toContain("overscroll-behavior: contain");
    const card = CSS.slice(
      CSS.indexOf(".command-card.open {"),
      CSS.indexOf(".command-card-head {"),
    );
    expect(card).not.toContain("overflow");
  });

  test("Esc closes and nothing traps focus or Tab", () => {
    expect(CARD).toContain('event.key !== "Escape"');
    expect(CARD).toContain("onClose()");
    expect(CARD).not.toContain('"Tab"');
    // The two prevented defaults are Enter's two fields, never Tab.
    expect((CARD.match(/preventDefault\(\)/g) ?? []).length).toBe(2);
  });

  test("the waiting line is a sentence, not a spinner, meter or count", () => {
    const html = render({ busy: "reading" });
    expect(html).toContain(COMMAND_READING_SENTENCE);
    expect(html).not.toContain("spinner");
    expect(html).not.toContain("progress");
  });

  test("the applied face keeps the same plain list and one quiet sentence", () => {
    const html = render({
      exchanges: [appliedExchange("wire and note", [WIRE, NOTE], null)],
    });
    expect(listCount(html)).toBe(2);
    expect(html).toContain(COMMAND_APPLIED_SENTENCE);
    expect(html).not.toContain(COMMAND_ACCEPT_VERB);
  });
});
