/**
 * STORY 25-1 (ADR-0046) — THE FRAME PRIMITIVE: an epistemic state becomes a
 * frame. First of the reading/ family: PLAIN inputs, never a map's own record
 * types, so the concept and dynamics maps can wear the same frames one day.
 * The frame never carries meaning alone (ADR-0046 decision 3): every state
 * keeps its honest sentence beside it.
 */
export type EpistemicState = "settled" | "proposal" | "ignorant";

export type CardFrame = "frame-bevel" | "frame-dashed" | "frame-muted";

/** The state's frame: solid truth, a proposal, or ignorance content. */
export function frameFor(state: EpistemicState): CardFrame {
  if (state === "proposal") return "frame-dashed";
  if (state === "ignorant") return "frame-muted";
  return "frame-bevel";
}

/**
 * What the card's CONTENT claims (the frames' one question): is this a
 * PROPOSAL (not yet the person's), does it lack its own words (ignorance
 * content), or is it settled ground?
 */
export function epistemicState(input: {
  proposal?: boolean;
  absentWords?: boolean;
}): EpistemicState {
  if (input.proposal === true) return "proposal";
  if (input.absentWords === true) return "ignorant";
  return "settled";
}
