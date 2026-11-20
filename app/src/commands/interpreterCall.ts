import type { AskEnding } from "../contacts/ask";
import { appendAskCardMove } from "../contacts/prismLog";
import type { Prism } from "../map/prisms";
import type { TurnMessage } from "../turn/protocol";
import type { TurnResult } from "../turn/turn";
import {
  buildInterpreterMessages,
  parseInterpreterAnswer,
  type InterpreterInput,
  type InterpreterRead,
} from "./interpreter";

/**
 * STORY 21.2 — THE INTERPRETER'S CALL SEAM (ADR-0038 decisions 2, 5 and 6;
 * ADR-0037 decision 9).
 *
 * ONE CALL, ONE EGRESS. The instruction goes out as a TURN through the
 * EXISTING route with the manager/curator row — the same send door the curator
 * uses (turn/turn.ts's sendMessages), no second wire, no new provider setting.
 * This module never resolves a row, reads a key or builds a route: the caller
 * (21.3's card, or a test's script) hands in the send function ALREADY ROUTED
 * to the manager row, so a test needs no network and the app keeps one place
 * where providers are resolved.
 *
 * THE EGRESS IS ITS OWN MOVE. ADR-0037 decision 9's rule — every egress is a
 * Move with its own PRISM — applies to the interpreter exactly as it applies
 * to the curator. INTERPRETER_ROLE is "command" (PROVISIONAL): the PRISM's
 * role distinguishes this egress from the task call and the curator's call
 * WITHOUT a new Change kind, and says nothing about which model answered (the
 * settings row owns that). A request that never left makes no Move; one that
 * left is recorded even when it failed or declined, because an egress that is
 * not written down is invisible spend.
 *
 * THE ANSWER IS PARSED, NEVER TRUSTED. The parse is commands/interpreter.ts's
 * one function: acts, ONE question, or ONE sentence. A call that never
 * answered is the same ONE sentence. Nothing is applied — not one act — here
 * or anywhere in this story; the executor runs after the person accepts.
 *
 * PURE apart from the two bridges it is handed (sendMessages, recordMove);
 * appendCommandMove is the app's real recorder, and a test passes its own.
 * PROVISIONAL: the role's word, the anchor the caller supplies (21.3 names the
 * command card's slug) and the failure sentence.
 */

/**
 * The role this egress writes on its PRISM (PROVISIONAL). One of
 * map/prisms.ts's closed role words, beside "task" and "curator"; a ROLE is
 * structure, never a model name.
 */
export const INTERPRETER_ROLE = "command" as const;

/** The role's type, for a caller that names the word once. */
export type InterpreterRole = typeof INTERPRETER_ROLE;

/**
 * The one sentence a call that did not answer gets. A failed, stopped or
 * timed-out turn is not a script, and the app says why nothing was applied
 * rather than showing the transport's prose as one.
 */
export const INTERPRETER_FAILED_SENTENCE =
  "the interpreter did not answer, so nothing was applied.";

/** The ONE egress's facts, as its PRISM records them. No words ride here. */
export interface InterpreterMove {
  /** Always "command": this is the interpreter's own egress. */
  role: InterpreterRole;
  /** The Move's anchor. PROVISIONAL: 21.3 supplies the command card's slug. */
  on: string;
  /** How the call ended — the same vocabulary an ask's egress uses. */
  ending: AskEnding;
  /** The answer's bytes for the Move's size, or null when nothing came back. */
  raw: string | null;
}

/** What one interpreter turn left behind. */
export interface InterpreterTurn {
  /** The parse: acts, a question, or ONE sentence. Never a partial script. */
  read: InterpreterRead;
  /** Whether the request left the app: a PRISM exists when it did. */
  left: boolean;
  /** How the call ended. */
  ending: AskEnding;
  /** The raw answer, so a surface can size or inspect the Move; never shown. */
  answer: string | null;
  /** The ONE PRISM this egress made, or null when nothing left. */
  prism: Prism | null;
}

/** How a turn's result maps to the record's ending (the ask machinery's rule). */
function endingOf(result: TurnResult): AskEnding {
  switch (result.kind) {
    case "answer":
      return "answered";
    case "cancelled":
      return "stopped";
    case "timeout":
      return "timed-out";
    case "error":
      return "failed";
  }
}

/** What an interpreter turn needs from its caller: the two bridges only. */
export interface InterpreterCall {
  /** The instruction, verbatim, and the bounded digest. */
  input: InterpreterInput;
  /** The Move's anchor, supplied by the surface that asked (21.3). */
  on: string;
  /**
   * The manager row's EXISTING send door, already routed. The caller closes
   * over TurnPort.sendMessages(managerRoute, messages), so this module never
   * sees a provider, a key or a route.
   */
  sendMessages: (messages: readonly TurnMessage[]) => Promise<TurnResult>;
  /** The ONE egress's recorder; the real one is appendCommandMove. */
  recordMove: (move: InterpreterMove) => Promise<Prism | null>;
}

/**
 * RUN one interpreter turn: build the prompt, send it ONCE, record the ONE
 * egress, then parse. The parse is the only thing the caller acts on; a
 * failure to answer is ONE sentence, and no act is ever run.
 */
export async function interpretInstruction(
  call: InterpreterCall,
): Promise<InterpreterTurn> {
  const messages = buildInterpreterMessages(call.input);
  let result: TurnResult;
  try {
    result = await call.sendMessages(messages);
  } catch {
    // The port threw instead of settling. The request may have left, so the
    // egress is recorded as failed: invisible spend is exactly what the one
    // PRISM per egress rule forbids.
    result = { kind: "error", sentence: INTERPRETER_FAILED_SENTENCE };
  }
  const answer =
    result.kind === "answer" && result.text !== "" ? result.text : null;
  const ending = endingOf(result);
  const prism = await call.recordMove({
    role: INTERPRETER_ROLE,
    on: call.on,
    ending,
    raw: answer,
  });
  if (answer === null) {
    return {
      read: { kind: "problem", sentence: INTERPRETER_FAILED_SENTENCE },
      left: true,
      ending,
      answer: null,
      prism,
    };
  }
  return {
    read: parseInterpreterAnswer(answer),
    left: true,
    ending,
    answer,
    prism,
  };
}

/**
 * THE APP'S RECORDER: one Ask-shaped Move through the EXISTING prism queue,
 * with the interpreter's role and NO material (nothing rode but the prompt).
 * The caller names the workspace and the Move's anchor; this function adds no
 * policy of its own.
 */
export function appendCommandMove(
  workspacePath: string,
  move: InterpreterMove,
): Promise<Prism | null> {
  return appendAskCardMove(
    workspacePath,
    move.on,
    null,
    move.ending,
    move.raw,
    move.role,
  );
}
