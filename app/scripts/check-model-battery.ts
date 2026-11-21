/**
 * STORY 23.1 — THE FIXED BATTERY (the measurement's own data).
 *
 * PROVISIONAL by the story's own list: the phrasings, the replies, and the
 * counts below are first choices, not settled facts. What is NOT provisional
 * is the shape: a FIXED list, so two runs measure the same thing, and no
 * branching inside a row — each row is one instruction or one reply, run once.
 *
 * WHY THESE PHRASINGS (the two questions the person is out for the day on):
 *   - the interpreter's RIGHT ACTS from ordinary phrasing, including the
 *     phrasings a person actually types (vague, ambiguous) and the ones the
 *     vocabulary deliberately cannot do (impossible);
 *   - the CURATOR's decline discipline, after the caps were removed, against
 *     replies a real answer really has: a caveat, no caveat, trivial, a
 *     repeat, mostly hedging, very long.
 *
 * PURE: this module is data and counts. It imports nothing, reads nothing and
 * calls nothing, so a test can pin it without a provider.
 */

/** Which of the interpreter's phrasing families a row belongs to. */
export type InterpreterCaseKind =
  | "clear"
  | "vague"
  | "ambiguous"
  | "impossible";

/** One instruction, run ONCE through the app's own prompt and parser. */
export interface InterpreterCase {
  /** The family, for the report's grouping only — never a grade. */
  kind: InterpreterCaseKind;
  /** The person's words, verbatim. */
  instruction: string;
}

/** What a curator reply is here to exercise (the report's grouping only). */
export type CuratorCaseKind =
  | "with a caveat"
  | "with no caveat"
  | "trivial"
  | "repeats a card"
  | "mostly hedging"
  | "very long"
  | "restates the question"
  | "a plan nobody is working on"
  | "a caveat and no claim"
  | "a contradiction stated plainly";

/** One reply, run ONCE through the curator's own prompt and parser. */
export interface CuratorCase {
  /** The trait, for the report's grouping only — never a grade. */
  kind: CuratorCaseKind;
  /** The task model's reply, verbatim (fixture text, not a live answer). */
  reply: string;
}

/**
 * THE CARDS THE FIXTURE MAP HOLDS (the digest's material). They live in a
 * TEMPORARY workspace built and deleted by the runner, so the person's own map
 * is never read, written or measured. The names are the ones the phrasings
 * below mention.
 */
export const BATTERY_CARDS = {
  curatorCaps: { on: "curator-caps", name: "the curator's caps", x: 0, y: 0 },
  commandCard: { on: "command-card", name: "the command card", x: 320, y: 0 },
  providerPanel: { on: "provider-panel", name: "the provider panel", x: 0, y: 200 },
  sendPath: { on: "send-path", name: "the send path", x: 320, y: 200 },
  ask: { on: "ask-slow", name: "how slow is the command card", x: 640, y: 0 },
} as const;

/** The one question the curator battery's brief asks (the person's words). */
export const CURATOR_QUESTION = "how slow is the command card?";

/**
 * THE INTERPRETER BATTERY — 20 phrasings, each once. Clear ones name an act
 * the catalogue carries; vague and ambiguous ones are the ordinary sentences
 * a person types and are where a guess would be worst; impossible ones name
 * something the vocabulary deliberately cannot do (a cascade, an egress, a
 * rename, an undo), so ONE plain sentence or ONE question is the honest
 * answer.
 */
export const INTERPRETER_BATTERY: readonly InterpreterCase[] = [
  // CLEAR: the instruction names the thing and the change.
  { kind: "clear", instruction: "read the card \"the command card\" and tell me what it says." },
  { kind: "clear", instruction: "add a card called \"the battery\" and wire it to \"the command card\"." },
  { kind: "clear", instruction: "remove the wire between the command card and the send path." },
  { kind: "clear", instruction: "put a note on \"the provider panel\" saying a key needs a test after it is set." },
  { kind: "clear", instruction: "move the send path below the command card." },
  { kind: "clear", instruction: "give me an overview of this map." },

  // VAGUE: a verb and a mood, but no card and no act.
  { kind: "vague", instruction: "tidy this up." },
  { kind: "vague", instruction: "make it clearer." },
  { kind: "vague", instruction: "the command card feels slow, do something about that." },
  { kind: "vague", instruction: "add something about the caps." },
  { kind: "vague", instruction: "clean up the wires." },

  // AMBIGUOUS: the words could mean two different acts, or name no card.
  { kind: "ambiguous", instruction: "wire the command card to it." },
  { kind: "ambiguous", instruction: "remove the card over there." },
  { kind: "ambiguous", instruction: "connect the two cards." },
  { kind: "ambiguous", instruction: "move that one next to the other one." },
  { kind: "ambiguous", instruction: "put the new card near the old one." },

  // IMPOSSIBLE: no act in the catalogue can do this, and the prompt says so.
  { kind: "impossible", instruction: "delete every card on the map and start over." },
  { kind: "impossible", instruction: "send the question to the model for me." },
  { kind: "impossible", instruction: "rename my provider to something shorter." },
  { kind: "impossible", instruction: "undo everything I did today." },
];

/**
 * THE CURATOR BATTERY — 10 replies, each once. Every reply is a plausible
 * answer to {@link CURATOR_QUESTION}; the cue list in the app (never this file)
 * decides what counts as a caveat, so these texts are written the way a model
 * writes, not to satisfy the detector.
 */
export const CURATOR_BATTERY: readonly CuratorCase[] = [
  {
    kind: "with a caveat",
    reply:
      "Each command is one model round trip, and in my own testing a plain instruction took a few seconds from press to act list. The interpretation itself is most of that wait; the acts are instant once they are chosen. This is only one run on one provider, so it may not hold for a different model or a slower connection.",
  },
  {
    kind: "with no caveat",
    reply:
      "The command card sends one request per press. The app builds a bounded digest of the map, sends it with the instruction and the act catalogue, and parses one fenced block back. The acts it proposes are ghosts: nothing is written until the person accepts them.",
  },
  {
    kind: "trivial",
    reply: "It works.",
  },
  {
    kind: "repeats a card",
    reply:
      "The curator no longer enforces per-field length caps. The caps were removed and a card that runs long is still kept, because the card's face crops its body.",
  },
  {
    kind: "mostly hedging",
    reply:
      "It is hard to say. It might be slow, though it may not be, and it depends on the provider; perhaps the model is the reason, assuming the connection is fine. I am not sure the timings would be reliable in some cases, and it could be unclear whether the wait is the network or the model. Possibly it is fine.",
  },
  {
    kind: "very long",
    reply:
      "The command card's interpretation is the slow part of the card, because every press is one model round trip. The app first builds a digest of the map: card names, kinds, one line about each and the wires, bounded so a large map cannot flood the prompt. It then sends that digest with the instruction verbatim and the whole act catalogue, and the model answers with either one fenced block of acts, one short clarifying question, or one sentence. The parsing is local and instant, so the wall-clock cost is essentially the provider's latency plus the time it takes to generate the block. In practice the generation matters: a short block is fast, a long one is not, and a model that thinks before answering adds its reasoning time on top. Because the digest is bounded and the catalogue is fixed, the prompt size is roughly constant regardless of how big the map is, which means a huge map does not make the call much slower. The acts themselves are instant: they are proposals, filed as ghosts, and nothing is written until the person accepts the script. If the instruction is ambiguous the model is asked to ask one question rather than guess, which is another round trip but a shorter one. This measurement is a single pass on one provider and one model, so it may not reflect a different provider, a different model, or a loaded network.",
  },
  {
    kind: "restates the question",
    reply:
      "You are asking how slow the command card's interpretation is in wall-clock terms, and whether the interpreter picks the right acts from ordinary phrasing. That is what your question is about.",
  },
  {
    kind: "a plan nobody is working on",
    reply:
      "The best next step is to build a second command card for each map and let people compare two models side by side, with a dashboard of their response times over a week.",
  },
  {
    kind: "a caveat and no claim",
    reply:
      "It might be slow, but I am not sure, and it depends on what you mean by slow. I cannot say more than that.",
  },
  {
    kind: "a contradiction stated plainly",
    reply:
      "The command card is one round trip, so it is fast. It is also the slowest thing in the app. These two statements contradict each other unless you separate the acts from the interpretation, which I have not done here.",
  },
];

/** How many calls the whole battery is. Pinned by the test beside it. */
export const BATTERY_CALLS =
  INTERPRETER_BATTERY.length + CURATOR_BATTERY.length;

/** The two batteries the flag can select. */
export type BatteryName = "interpreter" | "curator";
