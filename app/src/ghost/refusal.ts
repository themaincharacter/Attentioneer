import { issue, type GhostIssue } from "./issues";
import type { RunRecord } from "./runState";

/**
 * THE REFUSAL (Epic 14 story 2, ADR-0031) — the loud sentence the harness
 * speaks when a run reaches its bound at one refusal key, and the words it must
 * never say.
 *
 * THE TRIGGER is the run state's `limitReached` (story 1): N = 3 attempts at
 * one run key (move, target, issue code). The harness refuses service — the
 * failed attempt's own sentence is REPLACED by this one. The grammar already
 * said its piece on the attempts before; the packet's bounded run block carries
 * those sentences, and repeating them a third time is not a louder refusal, it
 * is the same one. Nothing is retried and nothing is written.
 *
 * THE MARK STANDS IT DOWN: a target that carried an open mark at RUN START does
 * not fire the refusal for the rest of the run. The mark is READ as "the person
 * has spoken here" (ADR-0009's own meaning is untouched and the mark is never
 * rendered, never started or stopped by the harness); the read is fixed at the
 * start, so a mark withdrawn mid-run still stands the refusal down and a mark
 * cast mid-run is not seen.
 *
 * THE SENTENCE IS SCOPED (ADR-0031's final amendments): an AGENT flow may say
 * the assistant stops, because an assistant is present in that flow and the
 * refusal speaks the assistant's limit. A PASTE (or scripted) flow never names
 * an absent actor: it asserts the refusal and that nothing was written, and
 * nothing more. Neither flow ever speaks about the person, names a verdict,
 * counts the attempts, or says a number — the refusal cites only what is on
 * screen, and its code is the app's (never rendered as a code).
 *
 * PROVISIONAL: the flow's two names, the sentence wording (the ADR carries it
 * as provisional too) and the placement of the sentence in place of the
 * grammar's one.
 */

/** How a reply reached the app (PROVISIONAL): an agent, or a person's paste. */
export type GhostFlow = "agent" | "paste";

/**
 * The refusal's shared words (PROVISIONAL): the refusal and the no-write. "This
 * move" is the failed move; "again" is what the person already saw; "nothing
 * was written" is the harness's own fact (a refused intake never writes). No
 * number, no counter, no trail, no verdict and no person appear in it.
 */
export const REFUSAL_CORE =
  "this move came back refused again. Nothing was written.";

/**
 * The agent flow's sentence (PROVISIONAL): the present assistant is named, and
 * only it — "the assistant stops here" is the assistant's limit, never a
 * statement about the person.
 */
export const REFUSAL_AGENT = "the assistant stops here: " + REFUSAL_CORE;

/**
 * The paste/scripted flow's sentence (PROVISIONAL): the same refusal and
 * no-write, with no absent actor named. A scripted run has no assistant in the
 * room, so the app must not invent one.
 */
export const REFUSAL_PASTE = REFUSAL_CORE;

/** The sentence this flow says. Unknown flows read as the paste one (safe). */
export function refusalSentence(flow: GhostFlow): string {
  return flow === "agent" ? REFUSAL_AGENT : REFUSAL_PASTE;
}

/**
 * THE REFUSAL, when it fires: any of the attempt's run keys reached N and the
 * attempt's target did not carry an open mark at run start (every strike in one
 * intake shares that target, so one reading covers them all). Otherwise null
 * and the intake's own sentences stand exactly as before. The result is ONE
 * issue in the app's vocabulary (`"stop"`); the sentence is the person's.
 */
export function refusalFor(
  record: RunRecord,
  flow: GhostFlow,
  markedAtStart: boolean,
): GhostIssue | null {
  if (!record.limitReached || markedAtStart) return null;
  return issue("stop", refusalSentence(flow));
}
