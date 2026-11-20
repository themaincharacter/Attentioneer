import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ACT_NAMES, type CommandAct } from "../src/commands/acts";
import {
  applyCommandScript,
  createAttentioneerHost,
} from "../src/commands/attentioneerHost";
import {
  INTERPRETER_FENCE,
  INTERPRETER_HISTORY_MAX_EXCHANGES,
  INTERPRETER_HISTORY_OMITTED_SENTENCE,
  buildInterpreterMessages,
  buildInterpreterPrompt,
  interpreterHistory,
  type InterpreterExchange,
} from "../src/commands/interpreter";
import { interpreterDigest } from "../src/commands/interpreterDigest";
import { interpretInstruction } from "../src/commands/interpreterCall";
import { loadAsks } from "../src/map/asks";
import { loadGround } from "../src/map/ground";
import { loadGroundLinks } from "../src/map/groundLinks";
import { loadSessions } from "../src/map/sessions";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { nodeCommandIo } from "../scripts/commands";
import {
  COMMAND_ACCEPT_VERB,
  COMMAND_ANSWERED_LABEL,
  COMMAND_APPLIED_SENTENCE,
  COMMAND_ASKED_LABEL,
  COMMAND_FAILED_AT_PREFIX,
  COMMAND_HISTORY_MAX_EXCHANGES,
  COMMAND_HISTORY_OMITTED_SENTENCE,
  COMMAND_REFUSED_SENTENCE,
  COMMAND_UNDO_SENTENCE,
  CommandCard,
  EMPTY_COMMAND_THREAD,
  appendExchange,
  appliedExchange,
  clarifiedInstruction,
  commandTurnOf,
  exchangeOutcomeLine,
  failedExchange,
  historyTurns,
  nothingExchange,
  refusedExchange,
  undoSentenceOf,
  undoExchangeOf,
  undoRequestOf,
  type CommandExchange,
  type CommandQuestion,
  type CommandThread,
} from "../src/canvas/CommandCard";
import type { TurnMessage } from "../src/turn/protocol";
import type { TurnResult } from "../src/turn/turn";

/**
 * STORY 21.5 — THE CARD HOLDS A CONVERSATION (ADR-0038 + its 2026-11-20
 * amendment: a PRIMARY way to use the app, so a follow-up must resolve against
 * what just happened).
 *
 * There is no DOM and no network here. The MODEL is a function: it receives the
 * EXACT prompt the app would send and answers with bytes. That is what makes
 * the resolution provable — the follow-up's model reads the card's NAME out of
 * the digest the app rebuilt, and its note lands in the real records.
 *
 * The story's proof list, in order: a follow-up resolves a card created by the
 * previous turn; the cap drops WHOLE exchanges with one sentence (never a
 * count); a clarifying answer CONTINUES the exchange; an undo-shaped
 * instruction yields one honest sentence (the vocabulary has no inverse act,
 * and this story adds none); an unrelated instruction is not turned into a
 * repeat; and no new record family, act, counter or map content appears.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

const APP_TSX = source("src/App.tsx");
const CARD = source("src/canvas/CommandCard.tsx");

/** A fence, built without a literal triple backtick in this file. */
const FENCE = String.fromCharCode(96).repeat(3);

function block(acts: unknown): string {
  return (
    "Here is the script.\n\n" +
    FENCE +
    INTERPRETER_FENCE +
    "\n" +
    JSON.stringify(acts) +
    "\n" +
    FENCE +
    "\n"
  );
}

const CARD_ACT: CommandAct = {
  act: "propose_card",
  map: "ground",
  payload: { name: "rain gauge", x: 40, y: 60 },
};

/* ------------------------------------------------------------------ *
 * THE SCRIPTED MODEL: it reads the prompt, it answers bytes.
 * ------------------------------------------------------------------ */

interface Scripted {
  sends(): number;
  prompts(): readonly string[];
  sendMessages(messages: readonly TurnMessage[]): Promise<TurnResult>;
}

function scriptedModel(answer: (prompt: string) => string): Scripted {
  const prompts: string[] = [];
  return {
    sends: () => prompts.length,
    prompts: () => prompts,
    async sendMessages(messages) {
      const prompt = messages.map((message) => message.content).join("\n");
      prompts.push(prompt);
      return { kind: "answer", text: answer(prompt) };
    },
  };
}

/** The card names the prompt's digest lists, in the order the digest lists them. */
function digestNames(prompt: string): string[] {
  const at = prompt.indexOf("## the map digest");
  if (at < 0) return [];
  const names: string[] = [];
  for (const line of prompt.slice(at).split("\n")) {
    const match = /^- "([^"]+)"/.exec(line);
    if (match !== null) names.push(match[1]!);
  }
  return names;
}

/** The prompt's instruction section, exactly as the model would read it. */
function instructionSection(prompt: string): string {
  const heading = "## the instruction, verbatim\n\n";
  const at = prompt.indexOf(heading);
  if (at < 0) return "";
  return prompt.slice(at + heading.length).split("\n\n")[0] ?? "";
}

/* ------------------------------------------------------------------ *
 * A REAL WORKSPACE, and a digest REBUILT from its records each turn.
 * ------------------------------------------------------------------ */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-conversation-"));

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

/** The here-and-now digest, composed from the records as they stand NOW. */
async function digestOf(path: string): Promise<string> {
  const io = nodeCommandIo();
  const [ground, links, asks, sessions] = await Promise.all([
    loadGround(path, io),
    loadGroundLinks(path, io),
    loadAsks(path, io),
    loadSessions(path, io),
  ]);
  return interpreterDigest({
    references: ground.references,
    asks: asks.asks,
    sessions: sessions.sessions,
    readings: [],
    links: links.links,
    states: {},
  });
}

/**
 * ONE TURN, the way App.tsx runs it: the digest rebuilt, the recent exchanges
 * passed as context, one instruction, one egress, nothing applied.
 */
async function turn(
  model: Scripted,
  instruction: string,
  path: string,
  thread: CommandThread,
  promptInstruction: string | null = null,
) {
  return interpretInstruction({
    input: {
      instruction: promptInstruction ?? instruction,
      digest: await digestOf(path),
      history: historyTurns(thread),
    },
    on: "ground",
    sendMessages: (messages) => model.sendMessages(messages),
    recordMove: async () => null,
  });
}

function renderCard(props: {
  exchanges?: readonly CommandExchange[];
  dropped?: boolean;
  view?:
    | {
        kind: "acts";
        instruction: string;
        acts: readonly CommandAct[];
        question: CommandQuestion | null;
      }
    | { kind: "question"; instruction: string; question: string }
    | null;
  answer?: string;
}): string {
  return renderToStaticMarkup(
    createElement(CommandCard, {
      level: "ground",
      open: true,
      instruction: "",
      answer: props.answer ?? "",
      exchanges: props.exchanges ?? [],
      dropped: props.dropped ?? false,
      view: props.view ?? null,
      busy: null,
      onOpen: () => {},
      onClose: () => {},
      onInstruction: () => {},
      onAnswer: () => {},
      onInterpret: () => {},
      onAnswerQuestion: () => {},
      onAccept: () => {},
      onRefuse: () => {},
    }),
  );
}

/* ------------------------------------------------------------------ *
 * THE CHECK: A FOLLOW-UP RESOLVES A CARD THE PREVIOUS TURN CREATED
 * ------------------------------------------------------------------ */

describe("a follow-up resolves what the previous turn did (the story's check)", () => {
  test("the note lands on the card the previous turn added, by NAME", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({
      workspacePath: path,
      io: nodeCommandIo(),
    });
    const firstInstruction = "add a card for the rain gauge";
    const secondInstruction = "also add a note to it saying it is the gauge";

    const model = scriptedModel((prompt) => {
      if (instructionSection(prompt) === firstInstruction) {
        return block([CARD_ACT]);
      }
      if (instructionSection(prompt) === secondInstruction) {
        // THE RESOLUTION: the model names the card from the DIGEST, not from a
        // reminder in the person's words. The card did not exist one turn ago.
        const names = digestNames(prompt);
        expect(names).toContain("rain gauge");
        return block([
          {
            act: "propose_note",
            map: "ground",
            payload: { card: "rain gauge", note: "it is the gauge" },
          },
        ]);
      }
      return block([{ act: "map_overview", map: "ground", payload: {} }]);
    });

    // TURN 1 — no conversation yet: the prompt has no history section at all.
    const before = await digestOf(path);
    expect(before).not.toContain("rain gauge");
    const one = await turn(model, firstInstruction, path, EMPTY_COMMAND_THREAD);
    expect(one.read.kind).toBe("acts");
    if (one.read.kind !== "acts") return;
    expect(model.prompts()[0]).not.toContain("## the conversation so far");
    const applied = await applyCommandScript(one.read.acts, host);
    expect(applied.ok).toBe(true);

    // The turn becomes ONE exchange: instruction verbatim, the act understood,
    // the outcome applied.
    const thread = appendExchange(
      EMPTY_COMMAND_THREAD,
      appliedExchange(firstInstruction, one.read.acts, null),
    );
    expect(thread.exchanges).toHaveLength(1);
    expect(thread.exchanges[0]!.instruction).toBe(firstInstruction);
    expect(thread.exchanges[0]!.understood).toEqual(['add a card "rain gauge"']);
    expect(exchangeOutcomeLine(thread.exchanges[0]!)).toBe(
      COMMAND_APPLIED_SENTENCE,
    );

    // TURN 2 — the digest is REBUILT, so the new card is visible by name; the
    // recent exchange rides as context; the instruction is the NEW one only.
    const after = await digestOf(path);
    expect(after).toContain('"rain gauge"');
    const two = await turn(model, secondInstruction, path, thread);
    expect(two.read.kind).toBe("acts");
    if (two.read.kind !== "acts") return;
    const prompt = model.prompts()[1]!;
    expect(model.sends()).toBe(2);
    expect(instructionSection(prompt)).toBe(secondInstruction);
    expect(prompt).toContain("## the conversation so far");
    expect(prompt).toContain("the person said: " + firstInstruction);
    expect(prompt).toContain("outcome: " + COMMAND_APPLIED_SENTENCE);
    expect(prompt).toContain('"rain gauge"');
    // The earlier instruction is CONTEXT — it appears once, in the history.
    expect(prompt.split(firstInstruction)).toHaveLength(2);

    const note = await applyCommandScript(two.read.acts, host);
    expect(note.ok).toBe(true);
    expect(readFileSync(join(path, "map/notes/rain-gauge.md"), "utf8")).toBe(
      "it is the gauge\n",
    );
  });

  test("an unrelated instruction is not turned into a repeat", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({
      workspacePath: path,
      io: nodeCommandIo(),
    });
    const firstInstruction = "add a card for the rain gauge";
    const unrelated = "how many cards are on the map?";

    const model = scriptedModel((prompt) =>
      instructionSection(prompt) === firstInstruction
        ? block([CARD_ACT])
        : block([{ act: "map_overview", map: "ground", payload: {} }]),
    );

    const one = await turn(model, firstInstruction, path, EMPTY_COMMAND_THREAD);
    if (one.read.kind !== "acts") throw new Error("the first turn is a script");
    expect((await applyCommandScript(one.read.acts, host)).ok).toBe(true);
    const thread = appendExchange(
      EMPTY_COMMAND_THREAD,
      appliedExchange(firstInstruction, one.read.acts, null),
    );
    const groundBefore = readFileSync(join(path, "map/ground.txt"), "utf8");

    // ONE instruction, ONE call, ONE script: the app never re-runs the earlier
    // turn because it sits in the conversation.
    const two = await turn(model, unrelated, path, thread);
    expect(model.sends()).toBe(2);
    if (two.read.kind !== "acts") {
      throw new Error("the unrelated turn is a script");
    }
    expect(two.read.acts.map((act) => act.act)).toEqual(["map_overview"]);
    expect(instructionSection(model.prompts()[1]!)).toBe(unrelated);
    // It still SAW the earlier turn (context, not an order) …
    expect(model.prompts()[1]!).toContain("the person said: " + firstInstruction);
    // … and nothing moved: an unrelated question adds nothing and repeats none.
    const run = await applyCommandScript(two.read.acts, host);
    expect(run.ok).toBe(true);
    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toBe(groundBefore);
  });
});

/* ------------------------------------------------------------------ *
 * BOUNDED, AND SAID SO: WHOLE EXCHANGES, ONE SENTENCE, NEVER A COUNT
 * ------------------------------------------------------------------ */

function exchangeOf(instruction: string): CommandExchange {
  return nothingExchange(instruction, null, COMMAND_REFUSED_SENTENCE);
}

describe("the conversation is bounded: whole exchanges, dropped with one sentence", () => {
  test("the last exchanges are kept whole; older ones are dropped, never clipped", () => {
    let thread = EMPTY_COMMAND_THREAD;
    const said: string[] = [];
    for (let index = 0; index < COMMAND_HISTORY_MAX_EXCHANGES + 4; index += 1) {
      const instruction = "instruction " + String(index);
      said.push(instruction);
      thread = appendExchange(thread, exchangeOf(instruction));
    }
    expect(thread.exchanges).toHaveLength(COMMAND_HISTORY_MAX_EXCHANGES);
    expect(thread.dropped).toBe(true);
    // NEWEST kept, each VERBATIM: an exchange is whole or it is gone.
    expect(thread.exchanges[thread.exchanges.length - 1]!.instruction).toBe(
      said[said.length - 1]!,
    );
    for (const kept of thread.exchanges) {
      expect(said).toContain(kept.instruction);
      expect(kept.instruction).not.toContain("…");
    }
    // The bound is SAID, never counted.
    expect(COMMAND_HISTORY_OMITTED_SENTENCE).not.toMatch(/[0-9]/);
    const html = renderCard({
      exchanges: thread.exchanges,
      dropped: thread.dropped,
    });
    expect(html).toContain(COMMAND_HISTORY_OMITTED_SENTENCE);
    expect(html).not.toContain(String(said.length));
  });

  test("a byte cap drops whole older turns and keeps the newest whole", () => {
    const huge = "x".repeat(1300);
    let thread = appendExchange(EMPTY_COMMAND_THREAD, exchangeOf(huge));
    thread = appendExchange(thread, exchangeOf("a short follow-up"));
    expect(thread.dropped).toBe(true);
    expect(thread.exchanges[thread.exchanges.length - 1]!.instruction).toBe(
      "a short follow-up",
    );
    for (const kept of thread.exchanges) {
      if (kept.instruction === huge) {
        expect(kept.instruction.length).toBe(huge.length);
      }
    }
  });

  test("the prompt's history is bounded too, and says THAT turns were dropped", () => {
    const exchanges: InterpreterExchange[] = Array.from({ length: 12 }, (_, at) => ({
      instruction: "instruction " + String(at),
      understood: ["read the wires"],
      question: null,
      answer: null,
      outcome: COMMAND_APPLIED_SENTENCE,
    }));
    const history = interpreterHistory(exchanges);
    expect((history.match(/the person said: /g) ?? []).length).toBe(
      INTERPRETER_HISTORY_MAX_EXCHANGES,
    );
    expect(history).toContain(INTERPRETER_HISTORY_OMITTED_SENTENCE);
    expect(INTERPRETER_HISTORY_OMITTED_SENTENCE).not.toMatch(/[0-9]/);
    expect(history).toContain("instruction 11");
    expect(history).not.toContain("instruction 0");
    // Whole exchanges: every kept one has its own outcome line.
    expect((history.match(/outcome: /g) ?? []).length).toBe(
      INTERPRETER_HISTORY_MAX_EXCHANGES,
    );
    // The prompt carries the same block under its own heading.
    const prompt = buildInterpreterPrompt({
      instruction: "and again",
      digest: "",
      history: exchanges,
    });
    expect(prompt).toContain("## the conversation so far");
    expect(prompt).toContain(INTERPRETER_HISTORY_OMITTED_SENTENCE);
    expect(
      buildInterpreterMessages({ instruction: "x", digest: "" })[0]!.content,
    ).not.toContain("## the conversation so far");
  });
});

/* ------------------------------------------------------------------ *
 * A CLARIFYING ANSWER CONTINUES THE THREAD
 * ------------------------------------------------------------------ */

describe("a clarifying question continues the thread", () => {
  test("the answer completes THAT exchange: one exchange, not two", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({
      workspacePath: path,
      io: nodeCommandIo(),
    });
    const instruction = "add a note to the rain card";
    const question = "Which words should the note carry?";

    const model = scriptedModel((prompt) => {
      if (prompt.includes("the answer is: it is the gauge")) {
        return block([
          {
            act: "propose_note",
            map: "ground",
            payload: { card: "rain", note: "it is the gauge" },
          },
        ]);
      }
      return question;
    });

    // The first answer is a QUESTION: the turn stays live, nothing is committed.
    const first = await turn(model, instruction, path, EMPTY_COMMAND_THREAD);
    expect(first.read.kind).toBe("question");
    const pending = commandTurnOf(instruction, first.read, null);
    expect(pending.kind).toBe("pending");
    if (pending.kind !== "pending") return;
    if (pending.view.kind !== "question") {
      throw new Error("a question stays live");
    }
    expect(pending.view.question).toBe(question);

    // The answer CONTINUES the exchange: the original words plus the question.
    const asked: CommandQuestion = {
      question: pending.view.question,
      answer: "it is the gauge",
    };
    const second = await turn(
      model,
      instruction,
      path,
      EMPTY_COMMAND_THREAD,
      clarifiedInstruction(instruction, asked.question, asked.answer),
    );
    expect(second.read.kind).toBe("acts");
    const next = commandTurnOf(instruction, second.read, asked);
    expect(next.kind).toBe("pending");
    if (next.kind !== "pending") return;
    if (next.view.kind !== "acts") throw new Error("the answer is a script");
    expect(next.view.question).toEqual(asked);

    // ONE exchange, and it is the original instruction with its answer riding.
    const thread = appendExchange(
      EMPTY_COMMAND_THREAD,
      appliedExchange(instruction, next.view.acts, asked),
    );
    expect(thread.exchanges).toHaveLength(1);
    const only = thread.exchanges[0]!;
    expect(only.instruction).toBe(instruction);
    expect(only.understood).toEqual(["add a note to rain"]);
    expect(only.question).toEqual(asked);
    // The prompt's shape of the same exchange names the question and its answer.
    const history = historyTurns(thread)[0]!;
    expect(history.question).toBe(question);
    expect(history.answer).toBe("it is the gauge");
    const html = renderCard({ exchanges: thread.exchanges });
    expect(html).toContain(COMMAND_ASKED_LABEL + question);
    expect(html).toContain(COMMAND_ANSWERED_LABEL + "it is the gauge");

    expect((await applyCommandScript(next.view.acts, host)).ok).toBe(true);
    expect(readFileSync(join(path, "map/notes/rain.md"), "utf8")).toBe(
      "it is the gauge\n",
    );
  });

  test("the app continues the exchange rather than starting a new turn", () => {
    const start = APP_TSX.indexOf("const answerCommandQuestion");
    const end = APP_TSX.indexOf("const acceptCommand");
    expect(start).toBeGreaterThan(-1);
    const body = APP_TSX.slice(start, end);
    expect(body).toContain("clarifiedInstruction");
    expect(body).toContain("commandView.instruction");
    expect(body).toContain("{ question: commandView.question, answer }");
    // The original instruction travels with the continuation, not a new one.
    expect(body).not.toContain("setCommandInstruction");
  });
});

/* ------------------------------------------------------------------ *
 * UNDO: ACTS OR ONE HONEST SENTENCE — NEVER A NO-OP, NEVER A GUESS
 * ------------------------------------------------------------------ */

describe("an undo-shaped instruction gets one honest sentence", () => {
  test("the vocabulary has no inverse act, and this story adds none", () => {
    // The honest basis of the sentence: ACT_SPECS is adds and reads only.
    expect(ACT_NAMES).toEqual([
      "map_overview",
      "read_card",
      "read_wires",
      "propose_card",
      "propose_wire",
      "propose_note",
      "propose_ask",
    ]);
    for (const name of ACT_NAMES) {
      expect(name).not.toMatch(/remove|delete|drop|undo|take|back/i);
    }
  });

  test("undo shapes are recognised; other instructions are left to the model", () => {
    for (const said of [
      "undo that",
      "can you undo the note?",
      "take that back",
      "reverse the last change",
      "put it back",
      "revert",
      "remove the wire",
    ]) {
      expect(undoRequestOf(said)).toBe(true);
    }
    for (const said of [
      "add a note to the rain card",
      "wire rain to soil",
      "what does this map say?",
      "the reversal of the river",
    ]) {
      expect(undoRequestOf(said)).toBe(false);
    }
  });

  test("the exchange is ONE sentence, offers no script, and writes nothing", () => {
    const undo = undoExchangeOf("undo the note", null);
    expect(undo).not.toBeNull();
    if (undo === null) return;
    expect(undo.instruction).toBe("undo the note");
    expect(undo.understood).toEqual([]);
    expect(undo.outcome).toEqual({
      kind: "nothing",
      sentence: COMMAND_UNDO_SENTENCE,
    });
    expect(undoSentenceOf("undo the note")).toBe(COMMAND_UNDO_SENTENCE);
    expect(undoSentenceOf("add a card")).toBeNull();
    expect(COMMAND_UNDO_SENTENCE).not.toMatch(/[0-9]/);
    expect(COMMAND_UNDO_SENTENCE.slice(0, -1)).not.toContain(".");

    // The card shows the sentence and offers nothing to accept.
    const html = renderCard({ exchanges: [undo] });
    expect(html).toContain(COMMAND_UNDO_SENTENCE);
    expect(html).not.toContain(COMMAND_ACCEPT_VERB);
    expect(html).not.toContain("command-card-acts");
  });

  test("the guard runs BEFORE the interpreter: an undo is never sent or guessed", () => {
    const start = APP_TSX.indexOf("const runCommand");
    const end = APP_TSX.indexOf("const interpretCommand");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = APP_TSX.slice(start, end);
    const guard = body.indexOf("undoExchangeOf");
    const call = body.indexOf("requestInterpretation");
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(call);
    expect(body.slice(guard, call)).toContain("return");
    // …and the prompt still tells the model not to repeat a turn it is asked
    // to take back, so a shape the guard misses cannot become a repeat.
    const prompt = buildInterpreterPrompt({
      instruction: "take the note back",
      digest: "",
    });
    expect(prompt).toContain("The acts only ADD");
    expect(prompt).toContain("Never answer it by repeating the earlier acts");
    expect(prompt).toContain("never a standing order");
  });
});

/* ------------------------------------------------------------------ *
 * THE CARD DRAWS THE CONVERSATION; NOTHING ELSE APPEARS
 * ------------------------------------------------------------------ */

describe("the card draws each exchange, and nothing new is recorded", () => {
  test("instruction verbatim, acts understood, outcome — and the failed act named", () => {
    const applied = appliedExchange(
      "wire rain to soil",
      [{ act: "propose_wire", map: "ground", payload: { from: "rain", to: "soil" } }],
      null,
    );
    const failed = failedExchange(
      "wire rain to the sea",
      [
        {
          act: "propose_wire",
          map: "ground",
          payload: { from: "rain", to: "the sea" },
        },
      ],
      null,
      'the act "propose_wire" failed: "the sea" is not one of them.',
      "propose_wire",
    );
    const refused = refusedExchange(
      "add a card",
      [{ act: "propose_card", map: "ground", payload: { name: "x", x: 1, y: 2 } }],
      null,
    );
    const html = renderCard({ exchanges: [applied, failed, refused] });
    expect(html).toContain("wire rain to soil");
    expect(html).toContain("wire rain → soil");
    expect(html).toContain(COMMAND_APPLIED_SENTENCE);
    // Rendered text is HTML-escaped: the quotes arrive as &quot;.
    expect(html).toContain(COMMAND_FAILED_AT_PREFIX + "&quot;propose_wire&quot;");
    expect(html).toContain(
      "the act &quot;propose_wire&quot; failed: &quot;the sea&quot; is not one of them.",
    );
    expect(html).toContain(COMMAND_REFUSED_SENTENCE);
    expect(exchangeOutcomeLine(failed)).toBe(
      COMMAND_FAILED_AT_PREFIX + '"propose_wire"',
    );
  });

  test("the conversation is view state: no record family, no writer, no counter", () => {
    // The card's model is React state in App.tsx; it reads and writes no file.
    for (const banned of [
      "writeFile",
      "readFile",
      "appendFile",
      "fetch(",
      "localStorage",
      "sessionStorage",
    ]) {
      expect(CARD).not.toContain(banned);
    }
    // The app keeps the thread in useState, not in a record loader.
    expect(APP_TSX).toContain("useState<CommandThread>(EMPTY_COMMAND_THREAD)");
    expect(APP_TSX).toContain("appendExchange(thread, exchange)");
    // The map still draws none of this: the card is not map content.
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("a problem completes an exchange with the app's own sentence", () => {
    const problem = nothingExchange(
      "do the thing",
      null,
      "the interpreter answered in prose rather than a script or a question, so nothing was applied.",
    );
    const html = renderCard({ exchanges: [problem] });
    expect(html).toContain("the interpreter answered in prose");
    expect(html).not.toContain(COMMAND_ACCEPT_VERB);
  });

  test("the thread is bounded by the card's own constants, said in code", () => {
    expect(COMMAND_HISTORY_MAX_EXCHANGES).toBe(6);
    expect(COMMAND_HISTORY_OMITTED_SENTENCE).toContain("dropped");
    expect(COMMAND_HISTORY_OMITTED_SENTENCE).not.toMatch(/[0-9]/);
    expect(CARD).toContain("ADR-0038's 2026-11-20");
    expect(CARD).toContain("IT IS BOUNDED, AND SAYS SO");
  });
});
