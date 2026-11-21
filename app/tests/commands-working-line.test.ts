import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CommandAct } from "../src/commands/acts";
import type { InterpreterRead } from "../src/commands/interpreter";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  COMMAND_APPLYING_SENTENCE,
  COMMAND_PROPOSING_SENTENCE,
  COMMAND_READING_MAP_SENTENCE,
  CommandCard,
  commandSendDisabled,
  commandWorkingLine,
  readInstructionInPhases,
  type CommandBusy,
  type CommandCardProps,
} from "../src/canvas/CommandCard";

/**
 * STORY 21.12 — THE COMMAND CARD SAYS IT IS WORKING.
 *
 * The person, live: "my biggest feedback is it seems slow. It's not unbearable
 * I think a loading indicator will help once we do work on design." Every
 * command is ONE model round trip, so the press is now acknowledged in the
 * press's own tick and the card says what it is doing in ONE line of words —
 * two phases at most, "reading the map" and "proposing the acts" — with no
 * percentage, no elapsed time, no spinner and no count. It says THAT work is
 * happening, never how much, and a slow call keeps the same words.
 *
 * There is no DOM harness, so this file pins the PURE sequence and the RENDER
 * FACTS underneath the human check: the exact wordings and their absence of
 * digits; the phase set synchronously before the first await (the fake send
 * resolves later, and the first observed state carries the line); the line
 * cleared on acts, a question, a refusal and a failure; the send verb dead
 * while in flight with the app refusing by the same predicate; and the source
 * seams (the departure callback is called at the send, the card renders the line
 * from one helper, and nothing is written).
 *
 * PROVISIONAL: the two wordings and where the line sits in the card.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

const APP_TSX = source("src/App.tsx");
const CARD = source("src/canvas/CommandCard.tsx");
const CSS = source("src/canvas/canvas.css");

const CARD_ACT: CommandAct = {
  act: "propose_card",
  map: "ground",
  payload: { name: "rain gauge", x: 40, y: 60 },
};

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

/** One rule block, from its selector through its closing brace. */
function rule(css: string, selector: string): string {
  const start = css.indexOf("\n" + selector + " {");
  if (start < 0) throw new Error("no rule for " + selector);
  const end = css.indexOf("}", start);
  return css.slice(start, end + 1);
}

/** A promise the test resolves when it wants the fake send to move. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let the async continuations run, without waiting on a wall clock. */
function tick(): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, 0));
}

describe("the two phases are said in words, never in numbers", () => {
  test("the exact wordings", () => {
    expect(COMMAND_READING_MAP_SENTENCE).toBe("reading the map");
    expect(COMMAND_PROPOSING_SENTENCE).toBe("proposing the acts");
    expect(commandWorkingLine("reading")).toBe(COMMAND_READING_MAP_SENTENCE);
    expect(commandWorkingLine("proposing")).toBe(COMMAND_PROPOSING_SENTENCE);
    // Idle says nothing; the accept's own wait keeps its story-21.3 line.
    expect(commandWorkingLine(null)).toBeNull();
    expect(commandWorkingLine("applying")).toBe(COMMAND_APPLYING_SENTENCE);
  });

  test("NO DIGITS and no measure of how much or how long", () => {
    for (const line of [
      COMMAND_READING_MAP_SENTENCE,
      COMMAND_PROPOSING_SENTENCE,
      COMMAND_APPLYING_SENTENCE,
    ]) {
      expect(line).not.toMatch(/[0-9]/);
      expect(line).not.toMatch(
        /percent|%|second|minute|elapsed|token|step|of [0-9]/i,
      );
    }
  });
});

describe("the phase is set before the first await, and the send resolves later", () => {
  test("the FIRST state on press carries the line; departure starts phase two", async () => {
    const phases: CommandBusy[] = [];
    // The app's preparation (settings, the manager row, the route) is an await
    // of its own; the model call is the second await and resolves LATER still.
    const prepared = deferred<void>();
    const answered = deferred<InterpreterRead>();

    const running = readInstructionInPhases(
      async (announceSending) => {
        await prepared.promise;
        announceSending();
        return answered.promise;
      },
      (phase) => phases.push(phase),
    );

    // NOT awaited: the press's own tick already carries the first phase, so no
    // frame passes with the card looking idle.
    expect(phases).toEqual(["reading"]);

    prepared.resolve();
    await tick();
    expect(phases).toEqual(["reading", "proposing"]);

    answered.resolve({ kind: "acts", acts: [CARD_ACT] });
    const read = await running;
    expect(read.kind).toBe("acts");
    expect(phases).toEqual(["reading", "proposing", null]);
  });

  test("it clears on acts, on a question, on a refusal and on a failure", async () => {
    const outcomes: InterpreterRead[] = [
      { kind: "acts", acts: [CARD_ACT] },
      { kind: "question", question: "which card?" },
      // The interpreter's refusal and its failure are both ONE sentence.
      { kind: "problem", sentence: "nothing was applied." },
    ];
    for (const outcome of outcomes) {
      const phases: CommandBusy[] = [];
      const read = await readInstructionInPhases(
        async (announceSending) => {
          announceSending();
          return outcome;
        },
        (phase) => phases.push(phase),
      );
      expect(read).toBe(outcome);
      expect(phases).toEqual(["reading", "proposing", null]);
    }

    // A send that THROWS clears the line too before the throw leaves.
    const phases: CommandBusy[] = [];
    let threw = false;
    try {
      await readInstructionInPhases(
        async (announceSending) => {
          announceSending();
          throw new Error("the send failed");
        },
        (phase) => phases.push(phase),
      );
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
    expect(phases).toEqual(["reading", "proposing", null]);
  });
});

describe("one call per press", () => {
  test("the send verb and the app share ONE busy predicate", () => {
    expect(commandSendDisabled("add a card", null)).toBe(false);
    expect(commandSendDisabled("add a card", "reading")).toBe(true);
    expect(commandSendDisabled("add a card", "proposing")).toBe(true);
    expect(commandSendDisabled("add a card", "applying")).toBe(true);
    expect(commandSendDisabled("   ", null)).toBe(true);

    // A second press during flight is refused by that same rule.
    const calls: string[] = [];
    let busy: CommandBusy = null;
    const press = (instruction: string): void => {
      if (commandSendDisabled(instruction, busy)) return;
      calls.push(instruction);
      busy = "reading";
    };
    press("add a card");
    press("add a card");
    expect(calls).toEqual(["add a card"]);
  });

  test("the app's press refuses with the verb's own rule", () => {
    const start = APP_TSX.indexOf("const interpretCommand");
    const end = APP_TSX.indexOf("const answerCommandQuestion");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = APP_TSX.slice(start, end);
    const guard = body.indexOf("commandSendDisabled(instruction, commandBusy)");
    const call = body.indexOf("runCommand(");
    expect(guard).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(guard);
    expect(body.slice(guard, call)).toContain("return");
  });

  test("the verb is disabled while the card works, and live when it is idle", () => {
    const verb = (html: string): string => {
      const at = html.indexOf("command-card-read");
      return html.slice(at, html.indexOf(">", at));
    };
    for (const busy of ["reading", "proposing", "applying"] as const) {
      const html = render({ instruction: "add a card", busy });
      expect(verb(html)).toContain("disabled");
    }
    expect(verb(render({ instruction: "add a card", busy: null }))).not.toContain(
      "disabled",
    );
  });
});

describe("the card draws one quiet line and nothing else", () => {
  test("the phase words render in the status line, with no spinner or meter", () => {
    const reading = render({ instruction: "add a card", busy: "reading" });
    expect(reading).toContain(COMMAND_READING_MAP_SENTENCE);
    expect(reading).not.toContain(COMMAND_PROPOSING_SENTENCE);
    expect(reading).toContain('role="status"');

    const proposing = render({ instruction: "add a card", busy: "proposing" });
    expect(proposing).toContain(COMMAND_PROPOSING_SENTENCE);
    expect(proposing).not.toContain(COMMAND_READING_MAP_SENTENCE);

    const idle = render({ instruction: "add a card" });
    expect(idle).not.toContain(COMMAND_READING_MAP_SENTENCE);
    expect(idle).not.toContain(COMMAND_PROPOSING_SENTENCE);
    expect(idle).not.toContain("command-card-working");

    for (const html of [reading, proposing]) {
      expect(html).not.toContain("spinner");
      expect(html).not.toContain("progress");
      expect(html).not.toContain("aria-valuenow");
      const at = html.indexOf('class="command-card-working"');
      const line = html.slice(at, html.indexOf("</div>", at));
      expect(line).not.toMatch(/[0-9]/);
    }
  });

  test("the style is quiet: no animation, no transition, no keyframes", () => {
    const line = rule(CSS, ".command-card-working");
    expect(line).not.toContain("animation");
    expect(line).not.toContain("transition");
    expect(CSS).not.toContain("@keyframes command-card-working");
  });
});

describe("the source seams only a browser would otherwise show", () => {
  test("the first phase is set before the send's await, and cleared in a finally", () => {
    const start = CARD.indexOf("export async function readInstructionInPhases");
    const end = CARD.indexOf("export interface CommandCardProps");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = CARD.slice(start, end);
    const reading = body.indexOf('onPhase("reading")');
    const awaited = body.indexOf("await send(");
    const cleared = body.indexOf("onPhase(null)");
    expect(reading).toBeGreaterThan(-1);
    expect(awaited).toBeGreaterThan(-1);
    expect(cleared).toBeGreaterThan(-1);
    expect(reading).toBeLessThan(awaited);
    expect(awaited).toBeLessThan(cleared);
    expect(body).toContain("finally {");
  });

  test("the app's runCommand awaits ONLY the phase sequence", () => {
    const start = APP_TSX.indexOf("const runCommand");
    const end = APP_TSX.indexOf("const interpretCommand");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = APP_TSX.slice(start, end);
    expect(body).toContain("await readInstructionInPhases(");
    expect(body).toContain("setCommandBusy");
    // The first (and only) await is the sequence's own call: nothing happens
    // before the card has been told it is working.
    expect(body.slice(0, body.indexOf("await "))).not.toContain("await ");
    expect(body.indexOf("await ")).toBe(body.indexOf("await readInstructionInPhases("));
  });

  test("departure moves the line: the send seam announces before the port sends", () => {
    const start = APP_TSX.indexOf("const requestInterpretation");
    const end = APP_TSX.indexOf("const requestApply");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = APP_TSX.slice(start, end);
    const announce = body.indexOf("announceSending();");
    const send = body.indexOf("turnPort.sendMessages(");
    expect(announce).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(announce);
    expect(body).toContain("announceSending: () => void");
  });

  test("every ending clears it: the apply's finally, a refusal, and closing", () => {
    expect(APP_TSX).toContain(".finally(() => setCommandBusy(null));");
    const refuseStart = APP_TSX.indexOf("const refuseCommand");
    const closeStart = APP_TSX.indexOf("const closeCommandCard");
    const openStart = APP_TSX.indexOf("const openCommandCard");
    expect(refuseStart).toBeGreaterThan(-1);
    expect(closeStart).toBeGreaterThan(refuseStart);
    expect(openStart).toBeGreaterThan(closeStart);
    expect(APP_TSX.slice(refuseStart, closeStart)).toContain(
      "setCommandBusy(null)",
    );
    expect(APP_TSX.slice(closeStart, openStart)).toContain(
      "setCommandBusy(null)",
    );
  });

  test("no record, writer or map content grew a word of this", () => {
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
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
