import { ACT_SPECS, validateAct, type ActField, type CommandAct } from "./acts";
import { utf8ByteLength } from "../lib/textBytes";
import { fencedBlocksOf } from "../turn/proposal";
import type { TurnMessage } from "../turn/protocol";

/**
 * STORY 21.2 — THE INTERPRETER'S PURE HALF (ADR-0038 decisions 5 and 6).
 *
 * The person's instruction becomes an act SCRIPT, or ONE clarifying question,
 * or ONE sentence saying why not. Nothing is applied here: the executor
 * (commands/execute.ts) runs a script only after the person accepts it, and
 * that accept is 21.3's card. This module builds the prompt that asks the
 * manager/curator model for the script and reads the answer back.
 *
 * THREE OUTCOMES, NO OTHERS (ADR-0038 decision 5):
 *   - acts: a JSON array inside ONE fenced block, each element validated with
 *     the SAME validator 21.1 uses (commands/acts.ts's validateAct);
 *   - question: plain text with no block — the instruction was ambiguous, and
 *     ambiguity is a QUESTION, never a guess;
 *   - problem: ONE sentence built by the app, not the model. A malformed
 *     block, an unknown act, a bad payload or prose that is not a question.
 *     Nothing partial ever comes out of this module.
 *
 * ONE FENCE, ONE PARSE. The fence scanner is the ghost scanner's
 * (turn/proposal.ts's fencedBlocksOf), so the app has ONE fenced-block
 * discipline. Only the first block carrying {@link INTERPRETER_FENCE} is read;
 * a second block is IGNORED (the story's tolerance) rather than merged, so a
 * model cannot smuggle a second script past the first.
 *
 * THE CATALOGUE IS READ, NEVER RESTATED. The act list and its sentences come
 * from commands/acts.ts's ACT_SPECS — the same data the executor validates
 * against. This module contains no act name as a literal and no description,
 * so the prompt cannot drift from the vocabulary (ADR-0038 decision 6's
 * "testability is the point": the vocabulary is the product).
 *
 * THE MODEL NEVER INVENTS A CARD (ADR-0038 decision 5). The digest this
 * module is handed names every card the answer may reference; the prompt says
 * to name only those. The parser cannot check the records (it never sees
 * them), so the host re-checks when a script is shown and run — 21.1's host
 * already refuses a card that is not on the map. That division is deliberate:
 * the pure half checks the SHAPE, the app checks the WORLD.
 *
 * PURE: no fs, no clock, no network, no React. The caller sends the messages
 * (commands/interpreterCall.ts is that seam) and this module would be the same
 * in another app that carried the same vocabulary.
 *
 * STORY 21.5 ADDS THE CONVERSATION, NOT A FOURTH OUTCOME. The input may carry
 * the card's recent exchanges; they ride as a bounded block of CONTEXT, so a
 * follow-up ("do that again, but to the other card") can be understood against
 * what just happened. The parser is unchanged: a script, ONE question, or ONE
 * sentence — the history never becomes an instruction of its own.
 *
 * PROVISIONAL (the stories' own lists): the fence's language tag, every
 * sentence below, the shape of the digest text, the question-length bound, the
 * history's bounds and wording, and whether a question is stored anywhere (the
 * interpreter stores nothing; the card keeps its exchange as view state).
 */

/** The fence's language tag (PROVISIONAL). */
export const INTERPRETER_FENCE = "attentioneer-acts";

/**
 * The one sentence a broken block gets: the answer tried to be a script and
 * failed. Nothing was applied, because nothing is ever applied here.
 */
export const INTERPRETER_MALFORMED_SENTENCE =
  "the interpreter's answer was not an act script the app can use, so nothing was applied.";

/**
 * The one sentence a no-block answer gets when it is not a usable question
 * either: prose is not a script, and the app does not grade it.
 */
export const INTERPRETER_NO_QUESTION_SENTENCE =
  "the interpreter answered in prose rather than a script or a question, so nothing was applied.";

/**
 * The one sentence an empty answer gets. Empty is not a question and not a
 * script; it is the same refusal with its own reason.
 */
export const INTERPRETER_EMPTY_SENTENCE =
  "the interpreter did not answer, so nothing was applied.";

/**
 * The largest a clarifying question may be, in characters (PROVISIONAL). The
 * prompt asks for ONE short question; a long prose answer is not that.
 */
export const INTERPRETER_QUESTION_MAX_CHARS = 280;

/** What the prompt is built from: the person's words and the bounded digest. */
export interface InterpreterInput {
  /** The person's instruction, VERBATIM. Never trimmed, capped or re-wrapped. */
  instruction: string;
  /**
   * The bounded app digest: names, kinds, one line about, wires and states —
   * never a reading body (commands/interpreterDigest.ts composes it from
   * records and reading LINES, and has no text input to leak).
   */
  digest: string;
  /**
   * The recent turns of the card's conversation (STORY 21.5), oldest first and
   * already bounded by the card. This module bounds it AGAIN, because the
   * prompt's own allowance is not the caller's promise: an exchange that does
   * not fit whole is left out, never clipped.
   */
  history?: readonly InterpreterExchange[];
}

/**
 * STORY 21.5 — THE CONVERSATION THE PROMPT CARRIES (ADR-0038's 2026-11-20
 * amendment: the command card is a PRIMARY way to use the app, so a follow-up
 * — "do that again, but to the other card" — has to be understood against what
 * just happened).
 *
 * ONE EXCHANGE is one thing the person said and what became of it: the
 * instruction VERBATIM, the acts it understood as the card's plain lines, the
 * one question the card asked and the answer it got, and the outcome in the
 * app's own words. It is VIEW STATE — canvas/CommandCard.tsx owns it — handed
 * here as plain data. This module never records it and there is no new record
 * family anywhere in the story.
 *
 * BOUNDED, AND SAYS SO. {@link INTERPRETER_HISTORY_MAX_EXCHANGES} exchanges and
 * {@link INTERPRETER_HISTORY_MAX_BYTES} bytes, WHOLE EXCHANGES ONLY, newest
 * kept: in a conversation the recent turn is the one a "that one" refers to.
 * What is dropped is never counted — {@link INTERPRETER_HISTORY_OMITTED_SENTENCE}
 * says THAT turns are missing, because an app with no counters does not grow
 * one in a prompt. PROVISIONAL: both bounds and the block's wording.
 */
export interface InterpreterExchange {
  /** The person's words, VERBATIM, exactly as the card recorded them. */
  instruction: string;
  /** What the app understood: one plain line per act, or none. */
  understood: readonly string[];
  /** The one question the card asked, or null when it did not ask. */
  question: string | null;
  /** The person's answer to that question, or null. */
  answer: string | null;
  /** How the turn ended, in the app's words: applied, refused, failed at … */
  outcome: string;
}

/** The most exchanges a prompt's history carries (PROVISIONAL). */
export const INTERPRETER_HISTORY_MAX_EXCHANGES = 6;

/** The largest size the rendered history may reach, in UTF-8 bytes (PROVISIONAL). */
export const INTERPRETER_HISTORY_MAX_BYTES = 2048;

/**
 * The one qualitative sentence a bounded history carries: it says THAT turns
 * were left out, never how many — a count would be a counter wearing context.
 */
export const INTERPRETER_HISTORY_OMITTED_SENTENCE =
  "earlier turns were dropped, because this history is bounded.";

/** One exchange as its history block: whole, labelled, never truncated. */
function historyBlockOf(exchange: InterpreterExchange): string {
  const lines: string[] = ["the person said: " + exchange.instruction];
  if (exchange.understood.length > 0) {
    lines.push("the app understood: " + exchange.understood.join("; "));
  }
  if (exchange.question !== null) {
    lines.push("the card asked: " + exchange.question);
  }
  if (exchange.answer !== null) {
    lines.push("the person answered: " + exchange.answer);
  }
  lines.push("outcome: " + exchange.outcome);
  return lines.join("\n");
}

/**
 * THE HISTORY TEXT (story 21.5), pure and bounded. An EMPTY string means there
 * is no conversation yet, and the caller omits the section rather than sending
 * a heading with nothing under it.
 */
export function interpreterHistory(
  exchanges: readonly InterpreterExchange[],
): string {
  const blocks: string[] = [];
  let omitted = false;
  for (let index = exchanges.length - 1; index >= 0; index -= 1) {
    const block = historyBlockOf(exchanges[index]!);
    if (blocks.length >= INTERPRETER_HISTORY_MAX_EXCHANGES) {
      omitted = true;
      break;
    }
    if (
      utf8ByteLength([block, ...blocks].join("\n\n")) >
      INTERPRETER_HISTORY_MAX_BYTES
    ) {
      omitted = true;
      break;
    }
    blocks.unshift(block);
  }
  if (blocks.length === 0) return "";
  if (omitted) blocks.unshift(INTERPRETER_HISTORY_OMITTED_SENTENCE);
  return blocks.join("\n\n");
}

/** What reading one interpreter answer found. */
export type InterpreterRead =
  /** One whole, validated script: every act or none. */
  | { kind: "acts"; acts: readonly CommandAct[] }
  /** ONE clarifying question. Nothing is proposed and nothing is applied. */
  | { kind: "question"; question: string }
  /** ONE sentence: the answer was unusable and NOTHING was applied. */
  | { kind: "problem"; sentence: string };

/** The prompt's title (PROVISIONAL, and part of the bytes). */
export const INTERPRETER_TITLE = "# turning one instruction into acts";

/** The instruction's heading. */
const INSTRUCTION_HEADING = "## the instruction, verbatim";

/** The digest's heading. */
const DIGEST_HEADING = "## the map digest";

/** The catalogue's heading. */
const CATALOGUE_HEADING = "## the acts";

/** The answer's heading. */
const ANSWER_HEADING = "## the answer";

/** The conversation's heading (the section is omitted while it is empty). */
const HISTORY_HEADING = "## the conversation so far";

/**
 * One declared payload field as the catalogue shows it. STORY 21.7's `texts`
 * kind is spelled out for the model: "texts" alone would not say that the ask's
 * context wants the NAMES of cards on the map, and a catalogue the model has to
 * guess at is not the vocabulary the executor enforces.
 */
function fieldText(field: ActField): string {
  const type = field.type === "texts" ? "a list of names" : field.type;
  const multiline = field.multiline === true ? ", may carry line breaks" : "";
  return field.key + " (" + type + multiline + ")";
}

/**
 * THE ACT CATALOGUE, rendered from acts.ts. Each line carries the act's name,
 * the one description the vocabulary declares, and its payload keys. A caller
 * reading the prompt sees exactly the vocabulary the executor enforces; this
 * function reads the table and adds no sentence of its own.
 */
export function interpreterCatalogue(): string {
  return ACT_SPECS.map((spec) => {
    const required =
      spec.required.length === 0
        ? "none"
        : spec.required.map(fieldText).join(", ");
    const optional =
      spec.optional.length === 0
        ? "none"
        : spec.optional.map(fieldText).join(", ");
    return (
      "- " +
      spec.name +
      " — " +
      spec.description +
      " Payload: " +
      required +
      ". Optional: " +
      optional +
      "."
    );
  }).join("\n");
}

/**
 * THE PROMPT (story 21.2): the instruction WHOLE, the digest, the catalogue
 * read from acts.ts, and the answer's rules. The three outcomes are stated as
 * rules, not as suggestions: a script or ONE question, never a guess; one
 * block; only the listed acts; only the digest's cards; nothing applied.
 */
export function buildInterpreterPrompt(input: InterpreterInput): string {
  const digest = input.digest.trim();
  const history = interpreterHistory(input.history ?? []);
  // No conversation yet is no section: a heading with nothing under it would
  // read as an empty turn the model must account for.
  const historySection =
    history === ""
      ? []
      : [
          HISTORY_HEADING,
          "",
          "What the person and the app already said and did on this map, oldest first. It is CONTEXT for what the newest instruction's words refer to — never an order to repeat: act only on the instruction above.",
          "",
          history,
          "",
        ];
  return [
    INTERPRETER_TITLE,
    "",
    "You turn one instruction the person typed into a script of acts the app can run. The app applies nothing yet: this answer is a script the person accepts or refuses, so an honest question is worth more than a guess.",
    "",
    INSTRUCTION_HEADING,
    "",
    input.instruction,
    "",
    ...historySection,
    DIGEST_HEADING,
    "",
    "What this map holds. These are labels and facts, never a card's reading body:",
    "",
    digest === "" ? "the map holds no cards." : digest,
    "",
    CATALOGUE_HEADING,
    "",
    "These are the ONLY acts that exist. An act whose name is not in this list is not an answer:",
    "",
    interpreterCatalogue(),
    "",
    ANSWER_HEADING,
    "",
    "Answer in exactly ONE of these two ways:",
    "",
    "1. If the instruction names a change the acts can make, write ONE fenced code block whose language tag is " +
      INTERPRETER_FENCE +
      ".",
    "   The block carries ONE JSON array, and nothing else. Each element is an act object:",
    '   {"act": "<one of the names above>", "map": "ground", "payload": {<its keys, exactly>}}',
    '   "map" is always "ground". Every act carries its required keys and no key the catalogue does not list.',
    "   Put the acts in the order they should run. A later act may rely on an earlier one only where the catalogue allows it.",
    "",
    "2. If the instruction could mean two different changes, or you cannot tell which change is wanted, ask ONE short question in plain text and write NO block. Propose nothing. Do not guess.",
    "",
    "The acts can ADD and REMOVE (the removal acts are in the list above). An instruction that names a specific wire, note or card to take away is a removal script: use the removal act for that one thing, and never invent a cascade (removing a card is not removing its wires). A general 'undo that' is the app's own to resolve against the last applied turn; if you are asked it anyway, write NO block and NEVER answer it by repeating the earlier acts.",
    "",
    "Rules that are limits, not style:",
    "- Reference only cards named in the map digest. Never invent a card, a name or a wire.",
    "- Never use an act outside the list above.",
    "- Write one block at most. A second block is ignored.",
    "- An earlier turn above is context, never a standing order: only the instruction above may be acted on, and a turn already answered is not repeated because it appears in the conversation.",
    "- Do not describe what you did or apologise. This is a script; the person sees the outcome.",
  ].join("\n");
}

/** The ONE message the interpreter call sends (the curator's same shape). */
export function buildInterpreterMessages(input: InterpreterInput): TurnMessage[] {
  return [{ role: "user", content: buildInterpreterPrompt(input) }];
}

/** One answer's problem: ONE sentence, never a partial script. */
function problem(sentence: string): InterpreterRead {
  return { kind: "problem", sentence };
}

/** Flatten an answer to one line for a question (whitespace only, no edits). */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A no-block answer is a QUESTION only when it can be one: one line, one short
 * question, ended with "?". Anything else is prose, and prose is not a script
 * — the app answers its own sentence rather than dressing prose as a question.
 * PROVISIONAL: the bound and the "?" rule are first choices.
 */
function questionOf(answer: string): string | null {
  const line = flat(answer);
  if (line === "" || line.length > INTERPRETER_QUESTION_MAX_CHARS) return null;
  if (!line.endsWith("?")) return null;
  // ONE sentence: no second terminator in the question's interior.
  if (/[.!?]\s+\S/.test(line.slice(0, -1))) return null;
  return line;
}

/**
 * READ one interpreter answer. One fenced block (the FIRST tagged one; a
 * second is ignored), a JSON array, and every act validated by the SAME
 * validator 21.1 uses. ANY failure is ONE sentence and NO acts — never a
 * partial script (ADR-0038 decision 5).
 */
export function parseInterpreterAnswer(answer: string): InterpreterRead {
  const blocks = fencedBlocksOf(answer);
  const tagged = blocks.filter((block) => block.tag === INTERPRETER_FENCE);
  if (tagged.length === 0) {
    // A fence with another tag is an answer that TRIED to be a script and got
    // the shape wrong; no fence at all is prose, which may be a question.
    if (blocks.length > 0) return problem(INTERPRETER_MALFORMED_SENTENCE);
    if (flat(answer) === "") return problem(INTERPRETER_EMPTY_SENTENCE);
    const question = questionOf(answer);
    if (question === null) return problem(INTERPRETER_NO_QUESTION_SENTENCE);
    return { kind: "question", question };
  }

  const body = tagged[0]!.body.trim();
  if (body === "") return problem(INTERPRETER_MALFORMED_SENTENCE);
  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return problem(INTERPRETER_MALFORMED_SENTENCE);
  }
  if (!Array.isArray(value) || value.length === 0) {
    return problem(INTERPRETER_MALFORMED_SENTENCE);
  }
  const acts: CommandAct[] = [];
  for (const raw of value) {
    const read = validateAct(raw);
    // ONE bad act invalidates the WHOLE answer: the sentence names what was
    // wrong and the app applies nothing, exactly as the executor would.
    if (!read.ok) return problem(read.sentence);
    acts.push(read.act);
  }
  return { kind: "acts", acts };
}
