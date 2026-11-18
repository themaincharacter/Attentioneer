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
 * STORY 17.12 ADDS THE SECOND CALL (ADR-0037 decision 9): an ask is now a
 * TASK call and a CURATOR call, so its declared ceiling is the sum of the two,
 * never the task's alone. The task's own loop still asks `turnSteps` (its
 * ceiling is what it is); the ask-level number is `askSteps`, and it is what
 * says the second model is spent on purpose. Same rules: no counter, no ratio,
 * no score — a ceiling said in words.
 *
 * PROVISIONAL: the number per shape, the curator's one exchange, and the
 * sentence's wording.
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

/** The curator's ceiling: ONE distilling exchange, on every route. */
export const CURATOR_STEP: StepBudget = Object.freeze({
  steps: 1,
  reason: "the curator",
});

/**
 * THE CURATOR'S CEILING (story 17.12, ADR-0037 decision 9). The curator sends
 * the reply, the brief and the schema and reads one card back: one exchange,
 * whether the manager row is an endpoint, a CLI or a local runtime. It never
 * retrieves and never chains, so there is no shape in which it is more than
 * one — and this function is where that fact lives, so no caller invents it.
 */
export function curatorSteps(_route: Pick<TurnRoute, "kind">): StepBudget {
  return CURATOR_STEP;
}

/**
 * THE WHOLE ASK'S CEILING: the task's exchanges plus the curator's one, when
 * the ask will curate. A task alone is \`turnSteps\` unchanged, so every earlier
 * caller keeps its number; with the curator the sum is stated in ONE place.
 * WHY THE TASK'S LOOP STILL USES \`turnSteps\`: the follow-up loop must not be
 * allowed to spend the curator's exchange on a second READ. The ceiling is
 * split by role here, and the total is what the ask declares.
 */
export function askSteps(
  route: Pick<TurnRoute, "kind">,
  retrieval = false,
  curator = false,
): StepBudget {
  const task = turnSteps(route, retrieval);
  if (!curator) return task;
  const all = curatorSteps(route);
  return {
    steps: task.steps + all.steps,
    reason: "the task and the curator",
  };
}
