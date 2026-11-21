import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ACT_SPECS } from "../src/commands/acts";
import {
  INTERPRETER_FENCE,
  INTERPRETER_NO_QUESTION_SENTENCE,
  INTERPRETER_QUESTION_MAX_CHARS,
  INTERPRETER_QUESTION_MAX_SENTENCES,
  INTERPRETER_QUESTION_MAX_TAIL_CHARS,
  buildInterpreterMessages,
  buildInterpreterPrompt,
  interpreterCatalogue,
  isInterpreterQuestion,
  parseInterpreterAnswer,
} from "../src/commands/interpreter";
import {
  INTERPRETER_DIGEST_MAX_CARDS,
  INTERPRETER_DIGEST_OMITTED_SENTENCE,
  interpreterDigest,
} from "../src/commands/interpreterDigest";
import {
  INTERPRETER_FAILED_SENTENCE,
  INTERPRETER_ROLE,
  appendCommandMove,
  interpretInstruction,
  type InterpreterMove,
} from "../src/commands/interpreterCall";
import { ASK_ROLES, parsePrismChange, serializePrismLine, type Prism } from "../src/map/prisms";
import type { AskCard } from "../src/map/asks";
import type { GroundReference } from "../src/map/ground";
import type { GroundLink } from "../src/map/groundLinks";
import type { Reading } from "../src/map/readings";
import type { SessionCard } from "../src/map/sessions";
import type { TurnResult } from "../src/turn/turn";

/**
 * STORY 21.2 — the interpreter, asserted without a network.
 *
 * The scripted model below is a function: it returns exactly the bytes the
 * story's check names, and the test reads the THREE outcomes out of the parser
 * and the call seam. The story's one check is the first describe block.
 */

const APP_DIR = join(import.meta.dir, "..");

function source(rel: string): string {
  return readFileSync(join(APP_DIR, rel), "utf8");
}

const INSTRUCTION =
  "wire rain to soil and add a note to rain saying it is the gauge";

const FENCE_OPEN = "`".repeat(3);

function digestOf(): string {
  const references: GroundReference[] = [
    { on: "rain", name: "rain", x: 0, y: 0 },
    { on: "soil", name: "soil", x: 120, y: 60 },
  ];
  const asks: AskCard[] = [{ on: "why-rain", name: "why rain", x: 200, y: 0 }];
  const sessions: SessionCard[] = [
    { on: "run-one", name: "run one", x: 200, y: 120, tool: "tool-one" },
  ];
  const readings: Reading[] = [
    {
      on: "rain",
      form: "url",
      from: "https://example.test/weather/the-gauge",
      taken: "2026-11-20T00:00:00Z",
      extract: "page",
    },
  ];
  const links: GroundLink[] = [{ from: "rain", to: "soil" }];
  return interpreterDigest({
    references,
    asks,
    sessions,
    readings,
    links,
    states: { rain: "current", soil: "unread" },
  });
}

/** A scripted model: the answer is EXACTLY these bytes. */
function scripted(answer: string | (() => Promise<TurnResult>)) {
  const moves: InterpreterMove[] = [];
  let sends = 0;
  const sendMessages = async (): Promise<TurnResult> => {
    sends += 1;
    return typeof answer === "string"
      ? { kind: "answer", text: answer }
      : await answer();
  };
  const recordMove = async (move: InterpreterMove): Promise<Prism | null> => {
    moves.push(move);
    return null;
  };
  return {
    moves,
    sends: () => sends,
    async run() {
      const turn = await interpretInstruction({
        input: { instruction: INSTRUCTION, digest: digestOf() },
        on: "ground",
        sendMessages,
        recordMove,
      });
      return { turn, moves };
    },
  };
}

function block(acts: unknown): string {
  return (
    "Here is the script." +
    "\n\n" +
    FENCE_OPEN +
    INTERPRETER_FENCE +
    "\n" +
    JSON.stringify(acts) +
    "\n" +
    FENCE_OPEN +
    "\n"
  );
}

const TWO_ACTS = [
  {
    act: "propose_wire",
    map: "ground",
    payload: { from: "rain", to: "soil" },
  },
  {
    act: "propose_note",
    map: "ground",
    payload: { card: "rain", note: "it is the gauge" },
  },
];

describe("the story's one check, with a scripted model", () => {
  test("two changes make exactly two acts, in the documented order", async () => {
    const model = scripted(block(TWO_ACTS));
    const { turn } = await model.run();
    expect(turn.read.kind).toBe("acts");
    if (turn.read.kind !== "acts") return;
    expect(turn.read.acts).toHaveLength(2);
    expect(turn.read.acts.map((act) => act.act)).toEqual([
      "propose_wire",
      "propose_note",
    ]);
    expect(turn.read.acts[0]!.payload).toEqual({ from: "rain", to: "soil" });
    expect(turn.read.acts[1]!.payload).toEqual({
      card: "rain",
      note: "it is the gauge",
    });
    // Nothing is applied: the interpreter has no executor and no write.
    expect(turn.answer).toContain("propose_wire");
  });

  test("an ambiguous instruction is a QUESTION back and no acts", async () => {
    const model = scripted("Do you mean the wire first, or the note on rain?");
    const { turn } = await model.run();
    expect(turn.read).toEqual({
      kind: "question",
      question: "Do you mean the wire first, or the note on rain?",
    });
    expect(turn.read.kind).not.toBe("acts");
  });

  test("an act outside the vocabulary is refused BY NAME, and nothing is partial", async () => {
    const answer = block([
      { act: "read_wires", map: "ground", payload: {} },
      { act: "delete_card", map: "ground", payload: { card: "rain" } },
    ]);
    const { turn } = await scripted(answer).run();
    expect(turn.read.kind).toBe("problem");
    if (turn.read.kind !== "problem") return;
    expect(turn.read.sentence).toContain("delete_card");
    expect(turn.read.sentence).toContain("there is no act named");
  });

  test("a bad payload is ONE sentence and the whole script is refused", async () => {
    const answer = block([
      { act: "propose_wire", map: "ground", payload: { from: "rain" } },
    ]);
    const { turn } = await scripted(answer).run();
    expect(turn.read.kind).toBe("problem");
    if (turn.read.kind !== "problem") return;
    expect(turn.read.sentence).toContain("propose_wire");
    expect(turn.read.sentence.endsWith(".")).toBe(true);
  });

  test("an answer in prose with no block is ONE sentence from the app", async () => {
    const { turn } = await scripted(
      "I have wired rain to soil and added the note.",
    ).run();
    expect(turn.read.kind).toBe("problem");
    if (turn.read.kind !== "problem") return;
    expect(turn.read.sentence).toBe(INTERPRETER_NO_QUESTION_SENTENCE);
    expect(turn.read.sentence.slice(0, -1)).not.toContain(".");
  });
});

describe("one fence, one parse (ADR-0038 decision 5)", () => {
  test("a second block is ignored: only the first script is read", async () => {
    const answer =
      block([{ act: "read_wires", map: "ground", payload: {} }]) +
      "\n" +
      block([
        { act: "propose_card", map: "ground", payload: { name: "x", x: 1, y: 2 } },
      ]);
    const { turn } = await scripted(answer).run();
    expect(turn.read.kind).toBe("acts");
    if (turn.read.kind !== "acts") return;
    expect(turn.read.acts).toHaveLength(1);
    expect(turn.read.acts[0]!.act).toBe("read_wires");
  });

  test("one bad act anywhere invalidates the whole answer", async () => {
    const answer = block([
      { act: "read_wires", map: "ground", payload: {} },
      { act: "propose_note", map: "ground", payload: { card: "rain" } },
    ]);
    const { turn } = await scripted(answer).run();
    expect(turn.read.kind).toBe("problem");
  });

  test("a block with the wrong tag is not a script", () => {
    const answer =
      FENCE_OPEN + "attentioneer-ghost\n" + JSON.stringify(TWO_ACTS) + "\n" + FENCE_OPEN + "\n";
    expect(parseInterpreterAnswer(answer).kind).toBe("problem");
  });

  test("a block that is not JSON, an empty block and an empty array are refused", () => {
    expect(
      parseInterpreterAnswer(
        FENCE_OPEN + INTERPRETER_FENCE + "\nnot json\n" + FENCE_OPEN,
      ).kind,
    ).toBe("problem");
    expect(
      parseInterpreterAnswer(
        FENCE_OPEN + INTERPRETER_FENCE + "\n\n" + FENCE_OPEN,
      ).kind,
    ).toBe("problem");
    expect(parseInterpreterAnswer(block([])).kind).toBe("problem");
  });

  test("an empty answer is ONE sentence", () => {
    const read = parseInterpreterAnswer("   \n");
    expect(read.kind).toBe("problem");
    if (read.kind !== "problem") return;
    expect(read.sentence.endsWith(".")).toBe(true);
  });
});

describe("the digest carries no reading bodies (ADR-0038 decision 6)", () => {
  test("names, kinds, one line about, states and wires all ride", () => {
    const digest = digestOf();
    expect(digest).toContain('"rain"');
    expect(digest).toContain("reference");
    expect(digest).toContain("a page at example.test");
    expect(digest).toContain("current");
    expect(digest).toContain("unread");
    expect(digest).toContain('wires: "soil"');
    expect(digest).toContain('"why rain"');
    expect(digest).toContain("ask");
    expect(digest).toContain("a run with tool-one");
    expect(digest).toContain("session");
  });

  test("a reading's BODY cannot ride: the digest keeps the host, never the path", () => {
    const digest = digestOf();
    expect(digest).not.toContain("the-gauge");
    expect(digest).not.toContain("/weather/");
  });

  test("the composer has no door for a text body, by its imports", () => {
    const text = source("src/commands/interpreterDigest.ts");
    for (const forbidden of [
      "readingTextPath",
      "loadNotes",
      "previewText",
      "readTextFile",
      "readTextHead",
      "readFileBytes",
      "note:",
      "notes:",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  test("the digest is bounded and says it is short", () => {
    const references: GroundReference[] = Array.from({ length: 40 }, (_, at) => ({
      on: "card-" + String(at),
      name: "card " + String(at),
      x: at,
      y: at,
    }));
    const digest = interpreterDigest({
      references,
      asks: [],
      sessions: [],
      readings: [],
      links: [],
      states: {},
    });
    const lines = digest.split("\n");
    expect(lines.length).toBe(INTERPRETER_DIGEST_MAX_CARDS + 1);
    expect(lines[lines.length - 1]).toBe(INTERPRETER_DIGEST_OMITTED_SENTENCE);
    expect(new TextEncoder().encode(digest).length).toBeLessThanOrEqual(2048);
  });
});

describe("the prompt reads the catalogue and carries the instruction verbatim", () => {
  test("every act's description and name comes from acts.ts", () => {
    const prompt = buildInterpreterPrompt({
      instruction: INSTRUCTION,
      digest: digestOf(),
    });
    for (const spec of ACT_SPECS) {
      expect(prompt).toContain(spec.description);
      expect(prompt).toContain(spec.name);
      expect(interpreterCatalogue()).toContain(spec.description);
    }
    // The catalogue is READ, never restated: none of those sentences is a
    // literal in the prompt builder.
    const text = source("src/commands/interpreter.ts");
    for (const spec of ACT_SPECS) {
      expect(text).not.toContain(spec.description);
    }
    expect(text).toContain('from "./acts"');
  });

  test("the instruction rides verbatim, and the answer rules name the three outcomes", () => {
    const prompt = buildInterpreterPrompt({
      instruction: INSTRUCTION,
      digest: digestOf(),
    });
    expect(prompt).toContain(INSTRUCTION);
    expect(prompt).toContain(INTERPRETER_FENCE);
    expect(prompt).toContain("ONE short question in plain text and write NO block");
    expect(prompt).toContain("A second block is ignored");
    expect(prompt).toContain("Reference only cards named in the map digest");
    expect(
      buildInterpreterMessages({ instruction: INSTRUCTION, digest: "" }),
    ).toEqual([
      {
        role: "user",
        content: buildInterpreterPrompt({ instruction: INSTRUCTION, digest: "" }),
      },
    ]);
  });
});

describe("a good question is not refused for its punctuation (STORY 23.3)", () => {
  // The 2026-11-21T17-04-11Z battery's own answers, VERBATIM. The first ended
  // in ")" behind its question mark; the second carried a second sentence.
  const BATTERY_ENDED_IN_PARENTHESIS =
    'Would you like me to add an ask card to investigate the slowness, or make a specific change (e.g. rewiring "the command card")?';
  const BATTERY_SECOND_SENTENCE =
    'What would you like added about the caps — a note on "the curator\'s caps," a new card, or something else? And what should it say?';

  test("the battery's two real questions come back as questions, whole", () => {
    expect(parseInterpreterAnswer(BATTERY_ENDED_IN_PARENTHESIS)).toEqual({
      kind: "question",
      question: BATTERY_ENDED_IN_PARENTHESIS,
    });
    expect(parseInterpreterAnswer(BATTERY_SECOND_SENTENCE)).toEqual({
      kind: "question",
      question: BATTERY_SECOND_SENTENCE,
    });
  });

  test("the numbers are named: two sentences, 300 characters", () => {
    expect(INTERPRETER_QUESTION_MAX_SENTENCES).toBe(2);
    expect(INTERPRETER_QUESTION_MAX_CHARS).toBe(300);
  });

  test("ordinary closing punctuation after the question mark still passes", () => {
    for (const tail of [')', ']', '"', "'", "”", "’", ".", ":"]) {
      const answer = "Do you mean the wire or the note?" + tail;
      expect(parseInterpreterAnswer(answer).kind).toBe("question");
    }
  });

  test("a second sentence passes; a third sentence refuses", () => {
    expect(parseInterpreterAnswer("Do you mean the wire? Or the note?").kind).toBe(
      "question",
    );
    const third = parseInterpreterAnswer(
      "Do you mean the wire? Or the note? Or both of them?",
    );
    expect(third).toEqual({
      kind: "problem",
      sentence: INTERPRETER_NO_QUESTION_SENTENCE,
    });
  });

  test("300 characters pass; 301 refuse", () => {
    const justUnder = "Is it " + "x".repeat(293) + "?";
    const justOver = "Is it " + "x".repeat(294) + "?";
    expect(Array.from(justUnder).length).toBe(INTERPRETER_QUESTION_MAX_CHARS);
    expect(Array.from(justOver).length).toBe(
      INTERPRETER_QUESTION_MAX_CHARS + 1,
    );
    expect(parseInterpreterAnswer(justUnder).kind).toBe("question");
    expect(parseInterpreterAnswer(justOver)).toEqual({
      kind: "problem",
      sentence: INTERPRETER_NO_QUESTION_SENTENCE,
    });
  });

  test("prose is still prose: no question mark anywhere refuses", () => {
    expect(parseInterpreterAnswer("I wired rain to soil and added the note.")).toEqual(
      {
        kind: "problem",
        sentence: INTERPRETER_NO_QUESTION_SENTENCE,
      },
    );
  });

  test("the act block still wins, whatever prose surrounds it", () => {
    const script = block([
      { act: "read_wires", map: "ground", payload: {} },
    ]);
    // A question BEFORE the block, and a question AFTER it, are both prose
    // around a script: the tagged block is the answer.
    for (const answer of [
      "Should I wire rain to soil?\n\n" + script,
      script + "\nWhich card did you mean?",
    ]) {
      const read = parseInterpreterAnswer(answer);
      expect(read.kind).toBe("acts");
      if (read.kind !== "acts") continue;
      expect(read.acts.map((act) => act.act)).toEqual(["read_wires"]);
    }
  });
});

describe("a question may carry a reason after it (STORY 23.3b)", () => {
  // The spec's own example and the 2026-11-21T17-04-11Z row 12: a question
  // followed by a bracketed or quoted reason. 23.3's terminal-"?" test refused
  // both, and its builder was right to flag it; row 13 of the
  // 2026-11-21T17-26-28Z re-run is the same shape. Row 14 is the other row the
  // story names, and its tail is long enough that it still refuses.
  const SPEC_EXAMPLE =
    'Should I rename the card "the send path"? (that is the one I mean)';
  const RERUN_ROW_12 =
    'To which card should "the command card" be wired — "the curator\'s caps", "the provider panel", or "the send path"? (It is already wired to "the send path".)';
  const RERUN_ROW_13 =
    'Which card do you mean? "Over there" doesn\'t point to one I can identify.';
  const RERUN_ROW_14 =
    'Which two cards? The map has five ("the curator\'s caps", "the command card", "the provider panel", "the send path", "how slow is the command card"), and "the command card" and "the send path" are already wired to each other.';

  function tailOf(answer: string): string {
    return answer.slice(answer.lastIndexOf("?") + 1).trim();
  }

  test("the spec's own example comes back as a question, whole", () => {
    expect(parseInterpreterAnswer(SPEC_EXAMPLE)).toEqual({
      kind: "question",
      question: SPEC_EXAMPLE,
    });
  });

  test("a bracket reason and a quote reason after the mark pass", () => {
    for (const answer of [RERUN_ROW_12, RERUN_ROW_13]) {
      expect(Array.from(tailOf(answer)).length).toBeLessThanOrEqual(
        INTERPRETER_QUESTION_MAX_TAIL_CHARS,
      );
      expect(parseInterpreterAnswer(answer)).toEqual({
        kind: "question",
        question: answer,
      });
    }
  });

  test("a question mark at the end still passes", () => {
    expect(parseInterpreterAnswer("Do you mean the wire?").kind).toBe("question");
  });

  test("the tail bound is named: 80 characters after the last question mark", () => {
    expect(INTERPRETER_QUESTION_MAX_TAIL_CHARS).toBe(80);
  });

  test("an 80-character tail passes; 81 characters refuse", () => {
    const head = "Should I wire the send path to the command card? ";
    const atLimit = head + "y".repeat(INTERPRETER_QUESTION_MAX_TAIL_CHARS);
    const overLimit =
      head + "y".repeat(INTERPRETER_QUESTION_MAX_TAIL_CHARS + 1);
    expect(Array.from(tailOf(atLimit)).length).toBe(
      INTERPRETER_QUESTION_MAX_TAIL_CHARS,
    );
    expect(Array.from(tailOf(overLimit)).length).toBe(
      INTERPRETER_QUESTION_MAX_TAIL_CHARS + 1,
    );
    expect(parseInterpreterAnswer(atLimit).kind).toBe("question");
    expect(parseInterpreterAnswer(overLimit)).toEqual({
      kind: "problem",
      sentence: INTERPRETER_NO_QUESTION_SENTENCE,
    });
  });

  test("a 200-character tail still refuses: prose is not a question", () => {
    const longTailAnswer = "Which card do you mean? " + "x".repeat(199) + ".";
    expect(Array.from(tailOf(longTailAnswer)).length).toBe(200);
    expect(Array.from(longTailAnswer).length).toBeLessThanOrEqual(
      INTERPRETER_QUESTION_MAX_CHARS,
    );
    expect(parseInterpreterAnswer(longTailAnswer)).toEqual({
      kind: "problem",
      sentence: INTERPRETER_NO_QUESTION_SENTENCE,
    });
  });

  test("the 17-04-11Z row 14 shape still refuses: its tail is a paragraph", () => {
    // The other re-run row the story names. Its own tail runs past the bound,
    // so the rule is about the tail's length, not the sentence count.
    expect(Array.from(RERUN_ROW_14).length).toBeLessThanOrEqual(
      INTERPRETER_QUESTION_MAX_CHARS,
    );
    expect(Array.from(tailOf(RERUN_ROW_14)).length).toBeGreaterThan(
      INTERPRETER_QUESTION_MAX_TAIL_CHARS,
    );
    expect(parseInterpreterAnswer(RERUN_ROW_14)).toEqual({
      kind: "problem",
      sentence: INTERPRETER_NO_QUESTION_SENTENCE,
    });
  });

  test("the two 17-04-11Z answers 23.3 fixed still pass (no regression)", () => {
    const batteryAnswered = [
      'Would you like me to add an ask card to investigate the slowness, or make a specific change (e.g. rewiring "the command card")?',
      'What would you like added about the caps — a note on "the curator\'s caps," a new card, or something else? And what should it say?',
    ];
    for (const answer of batteryAnswered) {
      expect(parseInterpreterAnswer(answer)).toEqual({
        kind: "question",
        question: answer,
      });
    }
  });

  test("a short clause after the mark reads as a reason now", () => {
    // 23.3's stray-prose example: 26 characters after the mark, so it is the
    // same shape as the re-run's row 13 — a question carrying a reason. The
    // rule accepts it deliberately; a long tail is what keeps prose out.
    const stray = 'Is it "the send path"? the wire is already there.';
    expect(parseInterpreterAnswer(stray)).toEqual({
      kind: "question",
      question: stray,
    });
  });
});

describe("one call, one egress, role command (ADR-0037 decision 9)", () => {
  test("one send, one Move, and the Move says command", async () => {
    const model = scripted(block(TWO_ACTS));
    const { turn, moves } = await model.run();
    expect(model.sends()).toBe(1);
    expect(moves).toHaveLength(1);
    expect(moves[0]).toEqual({
      role: INTERPRETER_ROLE,
      on: "ground",
      ending: "answered",
      raw: block(TWO_ACTS),
    });
    expect(INTERPRETER_ROLE).toBe("command");
    expect(turn.prism).toBeNull();
  });

  test("a failed call is ONE sentence and still records its egress", async () => {
    const model = scripted(async () => ({
      kind: "error",
      sentence: "the provider refused",
    }));
    const { turn, moves } = await model.run();
    expect(turn.read).toEqual({
      kind: "problem",
      sentence: INTERPRETER_FAILED_SENTENCE,
    });
    expect(moves).toHaveLength(1);
    expect(moves[0]!.ending).toBe("failed");
    expect(moves[0]!.raw).toBeNull();
  });

  test("a stopped call says stopped; a thrown port is failed spend, not silence", async () => {
    const stopped = await scripted(async () => ({
      kind: "cancelled",
      sentence: "stopped",
    })).run();
    expect(stopped.moves[0]!.ending).toBe("stopped");

    let moves = 0;
    const turn = await interpretInstruction({
      input: { instruction: INSTRUCTION, digest: digestOf() },
      on: "ground",
      sendMessages: async () => {
        throw new Error("pipe closed");
      },
      recordMove: async () => {
        moves += 1;
        return null;
      },
    });
    expect(moves).toBe(1);
    expect(turn.ending).toBe("failed");
    expect(turn.read.kind).toBe("problem");
  });

  test("the record accepts the command role and writes it, with no new Change kind", () => {
    expect(ASK_ROLES).toContain("command");
    const base = {
      kind: "ask",
      pointer: null,
      outcome: "answered",
      included: null,
      responseSize: 3,
      decode: "clean",
    };
    const change = parsePrismChange({ ...base, role: "command" });
    expect(change).not.toBeNull();
    if (change !== null && change.kind === "ask") {
      expect(change.role).toBe("command");
    }
    const prism: Prism = {
      id: "prism-1",
      on: "ground",
      contact: "ask",
      pointer: null,
      changes: [{ ...base, role: "command" }],
      explanation: "",
      extra: {},
    };
    expect(serializePrismLine(prism)).toContain('"role":"command"');
    // The recorder is the app's one bridge: a Move with the command role and
    // no material. Its call needs a workspace, so its SHAPE is what is pinned.
    expect(typeof appendCommandMove).toBe("function");
    expect(source("src/commands/interpreterCall.ts")).toContain(
      "appendAskCardMove",
    );
  });
});
