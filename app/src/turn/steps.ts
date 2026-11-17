import type { TurnRoute } from "./turn";

/**
 * THE BUDGET (Epic 15 story 7) — how many times a turn may ask the model
 * before it must stop, as DATA in one pure function.
 *
 * WHY A FUNCTION AND NOT A CONSTANT: "two" is not the rule; the rule is a
 * route's shape. A turn that offered the model nothing to read is ONE
 * exchange. A turn whose packet offered one block it may ask for in full is
 * TWO: the first answer, and the single follow-up that block earns. A CLI turn
 * carries its own instruction and its own reading, so the app adds nothing:
 * ONE. Local and HTTP asks share the rule because, above the route, they are
 * the same turn over a different pipe.
 *
 * WHY NO COUNTER: this is a ceiling, not a meter. When a turn has reached it,
 * the panel says {@link STEP_LIMIT_SENTENCE} in words. Nothing tallies steps,
 * shows a ratio or scores the turn — the loop simply stops asking, and says so.
 *
 * PURE: no clock, no reader, no route dispatch — the route's kind and whether
 * a retrieval was offered are the whole input. Every branch that could loop
 * asks THIS function; there is no second ceiling written anywhere else.
 *
 * PROVISIONAL: the number per shape, and the sentence's wording.
 */

/** One route's ceiling: how many exchanges, and why it is that number. */
export interface StepBudget {
  /** The most model exchanges this turn may make (one answer each). */
  steps: number;
  /** The reason word, when the ceiling is more than the plain one. */
  reason?: string;
}

/**
 * The sentence a turn says when its ceiling bites. It is stated, never
 * counted: a person reads that the limit is the reading, not a progress bar.
 */
export const STEP_LIMIT_SENTENCE = "this turn has reached its reading limit";

/** The plain ceiling: one question, one answer. */
export const ONE_STEP: StepBudget = Object.freeze({ steps: 1 });

/** The ceiling with one retrieval: the first answer and one follow-up. */
export const ONE_READING: StepBudget = Object.freeze({
  steps: 2,
  reason: "one reading",
});

/**
 * THE ONE CEILING for a route. A CLI turn is one exchange; an HTTP or local
 * ask is one exchange, or two when its packet offered one block to read in
 * full. The route's dispatch, not its vendor, is all this reads.
 */
export function turnSteps(
  route: Pick<TurnRoute, "kind">,
  retrieval = false,
): StepBudget {
  if (route.kind === "cli") return ONE_STEP;
  return retrieval ? ONE_READING : ONE_STEP;
}
