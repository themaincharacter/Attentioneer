import { useEffect, useRef } from "react";
import { actSpecOf, inverseActOf, type CommandAct } from "../commands/acts";
import type { CommandRun } from "../commands/execute";
import type { InterpreterExchange, InterpreterRead } from "../commands/interpreter";
import { utf8ByteLength } from "../lib/textBytes";
import type { Level } from "../workspace/level";

/**
 * STORY 21.3 — THE COMMAND CARD (ADR-0038 decisions 1, 4 and 5).
 *
 * A closed-by-default floating card at the bottom of the app, on EVERY map. It
 * holds one instruction field, the interpreter's answer, and — when the answer
 * was a script — the acts as a SHORT numbered list in plain words, with accept
 * and refuse. Nothing else on the screen changes.
 *
 * ONE PRESS (ADR-0038 decision 4). The script preview IS the ghost preview: the
 * person's accept on this list is the acceptance of every ghost the acts file,
 * so the card never asks a second time. That is the whole reason the preview
 * exists. The accept handler calls the app's one apply seam ONCE and nothing in
 * this file opens a confirmation.
 *
 * NO NUDGE (ADR-0038 decision 1, AGENTS.md's guardrail). Closed by default. No
 * badge, no pulse, no unread marker, no auto-open effect, no volunteered
 * suggestion and no timer: the flag starts false and only the person's press
 * sets it true. Nothing here watches the map for something to say.
 *
 * A REFUSAL MOVES NOTHING. The interpreter has already written its ONE Move
 * (commands/interpreterCall.ts); refusing the script discards the view and
 * writes nothing else, so the refusal's only record is that egress.
 *
 * ON ANOTHER MAP, ONE HONEST SENTENCE (ADR-0038 decision 1's "every map" and
 * the story's scope): the card is present everywhere, but the vocabulary only
 * names the ground map for now, so elsewhere it says so and offers NO acts, no
 * accept and no refuse. It does not pretend the map can be changed yet. (STORY
 * 21.9 refines this: only the CHANGE half is out of reach there — the paragraph
 * below says what replaced the dead box.)
 *
 * STORY 21.9 — THE SENTENCE IS ABOUT CHANGES, BECAUSE THE READS NOW WORK
 * (ADR-0038's 2026-11-20 amendment: the card is a PRIMARY way to use the app
 * and it stands on every map, so a box that could neither act nor answer was
 * dead on two of the three). The card asks the map it is standing on now: its
 * digest is that map's own content, its reads may look at any map, and the ONE
 * sentence it carries is about the half that does NOT work yet — a change still
 * names the ground map alone. A change instruction typed on another map is
 * refused by the interpreter with one sentence and offers nothing to accept
 * (commands/interpreter.ts's readForMap); the card shows that sentence like any
 * other answer, and never an accept button for it.
 *
 * FOCUS AND SCROLL. The card is a non-modal section, never a focus trap: Tab
 * moves out of it, and Esc closes it. Its BODY is the only scroll region (the
 * map does not scroll under it), and a wheel over the card stays on the card.
 *
 * PROVISIONAL (ADR-0038's consequences): the card's look and placement, its
 * invitation wording, the act list's plain-word phrasing, the non-ground map
 * sentence, and the failure sentence's shape.
 */

/* ------------------------------------------------------------------ *
 * STORY 21.5 — THE CARD HOLDS A CONVERSATION (ADR-0038's 2026-11-20
 * amendment: this is a PRIMARY way to use the app, not a debug panel).
 *
 * A primary surface holds a conversation. Each EXCHANGE is one thing the
 * person said and what became of it — the instruction VERBATIM, the acts it
 * understood in plain words (or the one question the card asked), and the
 * outcome: applied, refused, or failed at <act>. That is VIEW STATE beside the
 * interpreter's Move; there is NO new record family, no counter and no log.
 *
 * IT IS BOUNDED, AND SAYS SO. The last few exchanges and a byte cap, WHOLE
 * EXCHANGES ONLY — an exchange is never clipped. When an older turn is
 * dropped the card says THAT in one qualitative sentence, never how many: an
 * app without counters does not grow one in its conversation.
 *
 * A FOLLOW-UP CARRIES THE TURNS. The card hands the recent exchanges to the
 * interpreter so "do that again, but to the other card" resolves against what
 * just happened — while the here-and-now digest is rebuilt for every call, so
 * a card created by an earlier turn is visible BY NAME.
 *
 * NOTHING AUTO-REPEATS. An earlier turn is context for reading the newest
 * instruction, never a standing order; the card sends one instruction per
 * turn, and the prompt says so (commands/interpreter.ts).
 *
 * UNDO IS ACTS (STORY 21.6). The vocabulary now removes as well as adds
 * (ADR-0038's 2026-11-20 amendment: coverage grows act by act, and a primary
 * surface must be able to take back what it just did). So an undo-shaped
 * instruction asks the LAST APPLIED exchange what it did and offers that act's
 * inverse as a ghost — "undo that" after a wire offers the unwire; after a note,
 * the note's removal; after a card, the card's removal. The person's press is
 * still the accept, and the inverse is never applied on its own.
 *
 * THE SENTENCE REMAINS THE FALLBACK (story 21.5 rule 5), not the rule: when
 * nothing was applied, when the last applied act has no computable inverse (a
 * removed note's words and a removed card's point live only in the record), or
 * when the vocabulary has no pair, the card says so in ONE honest sentence —
 * never a silent no-op, never a guess, never a repeat of the turn it was asked
 * to take back.
 * PROVISIONAL: the sentence, the undo shapes recognised, both bounds, and which
 * pair directions are offered from the applied act alone.
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * STORY 21.10 — UNDO THE WHOLE SCRIPT, NOT JUST ITS LAST ACT
 * (ADR-0038 Amendment 2, the person: "start with propose and then can always
 * undo if you accept the proposal and change your mind".)
 *
 * 21.6 took back ONE act, the last one that had an inverse, so a three-act
 * script left two changes behind. Amendment 2 says undo is the second net
 * AFTER acceptance and it is about the SCRIPT: "undo that" now offers the
 * inverse of EVERY act of the last applied script, in REVERSE order — a wire
 * made after a card is taken back before the card — as ONE script the person
 * accepts once, like any other.
 *
 * HONEST PARTIAL, ALWAYS. Where an act has no expressible inverse the offer
 * names it and leaves it as it is; it never dresses a partial take-back as a
 * complete one. A bounded kept script says its earliest acts are out of reach
 * for the same reason.
 *
 * A SECOND UNDO IS ONE GENERATION. The undo reads the last APPLIED EXCHANGE
 * only, never the script it took back, so a second "undo that" cannot
 * double-invert the original into a redo. Where that last exchange was itself
 * an undo that cannot be put back WHOLE, the card says so and offers nothing:
 * a partial restore could re-wire a card that stayed removed. The rule lives
 * in undoOfferOf and its sentence beside the code.
 *
 * AN UNDO COMPLETES ITS OWN EXCHANGE. The accepted undo's exchange notes the
 * instruction it took back and any act it could not, so the history says what
 * moved. View state only: no new act, no record family, no counter.
 * ------------------------------------------------------------------ */

/** The closed bar's one line of invitation (PROVISIONAL). */
export const COMMAND_INVITATION = "tell the app what to change";

/** The open card's quiet title (PROVISIONAL). */
export const COMMAND_TITLE = "command";

/**
 * The one sentence another map gets (STORY 21.9, PROVISIONAL). It is about the
 * HALF THAT DOES NOT WORK YET: reading every map does, so the card says what a
 * change can name rather than claiming the card is inert where it stands.
 */
export const COMMAND_NON_GROUND_SENTENCE =
  "you can read this map; changes are ground-only for now.";

/** The one quiet line a refusal leaves (PROVISIONAL). */
export const COMMAND_REFUSED_SENTENCE = "nothing was applied.";

/**
 * The one quiet line a completed script leaves (PROVISIONAL). It says the acts
 * RAN, not that the map changed: a script may be all reads, and a read changes
 * nothing.
 */
export const COMMAND_APPLIED_SENTENCE = "those acts ran.";

/** The quiet line while the interpreter reads the instruction (PROVISIONAL). */
export const COMMAND_READING_SENTENCE = "reading the instruction…";

/** The quiet line while the script's ghosts are applied (PROVISIONAL). */
export const COMMAND_APPLYING_SENTENCE = "applying the acts…";

/** The one sentence a second clarifying question leaves (PROVISIONAL). */
export const COMMAND_SECOND_QUESTION_SENTENCE =
  "it asked again, so nothing was applied.";

/** The one sentence a script that never ran leaves (PROVISIONAL). */
export const COMMAND_FAILED_SENTENCE = "nothing was applied.";

/** The one sentence a refused ghost leaves (PROVISIONAL). */
export const COMMAND_GHOST_REFUSAL_PREFIX = "the app refused one of the script's ghosts: ";

/** The outcome line's lead when an act failed: the story's own words. */
export const COMMAND_FAILED_AT_PREFIX = "failed at ";

/**
 * The one honest sentence an undo-shaped instruction gets when the card cannot
 * offer a real inverse (STORY 21.5 rule 5, the fallback since STORY 21.6,
 * PROVISIONAL). It says there is nothing here the app knows how to take back —
 * no applied change, an applied act with no pair, or a pair whose inverse needs
 * words only the record holds — instead of guessing or staying silent.
 */
export const COMMAND_UNDO_SENTENCE =
  "there is no change here the app can take back, so nothing was applied.";

/**
 * STORY 21.10 — THE WHOLE-SCRIPT UNDO, IN ONE OFFER (ADR-0038 Amendment 2: undo
 * is the second net, AFTER acceptance, and it takes back the LAST APPLIED SCRIPT
 * as a whole — every act of it, in reverse order — not just its final act).
 *
 * THE ORDER IS THE APPOSITE ONE. Acts are undone from the last to the first,
 * because a wire created after a card must be removed before the card: the
 * reverse of how the script was applied is the only order the records accept.
 *
 * THE OFFER IS ONE SCRIPT AND ONE PRESS. The inverses are a script like any
 * other, so the person accepts once and the executor applies it whole; the card
 * never asks per act.
 *
 * IT NEVER CLAIMS COMPLETENESS IT DOES NOT HAVE. An act the vocabulary cannot
 * invert from what it carries (a removed note's words, a removed card's point,
 * an ask that has no paired removal) is NAMED as not taken back, and the rest
 * still applies. The one sentence below is the card's promise that a partial
 * undo is said out loud. PROVISIONAL: the wording and the act-list bound.
 */
export const COMMAND_UNDO_COMPLETE_SENTENCE =
  "this undo takes back every act of that script, in reverse order.";

/** The lead into the acts a partial undo will leave exactly as they are. */
export const COMMAND_UNDO_PARTIAL_PREFIX =
  "this undo takes back the rest; it will leave these acts as they are: ";

/** The one sentence a bounded applied script adds to its undo (no count, ever). */
export const COMMAND_UNDO_BOUNDED_SENTENCE =
  "the earliest acts of that script are no longer held, so they will not be undone.";

/**
 * THE SECOND UNDO (STORY 21.10, ADR-0038 Amendment 2 rule 3). An undo is itself
 * an applied script, so the pairing keeps working one generation at a time. But
 * a PARTIAL restore of an undo can put a wire back to a card that stayed
 * removed, or re-name a card the undo itself removed: a broken composite dressed
 * as a complete take-back. When the last change was an undo that cannot be put
 * back WHOLE, the card says so and offers nothing, rather than double-inverting
 * into that nonsense.
 */
export const COMMAND_UNDO_SECOND_SENTENCE =
  "the last change was itself an undo, and it cannot be put back whole, so nothing was applied.";

/** The labels the card puts on what an undo takes back, and leaves (PROVISIONAL). */
export const COMMAND_UNDO_TAKES_BACK_LABEL = "takes back: ";
export const COMMAND_UNDO_TOOK_BACK_LABEL = "took back: ";
export const COMMAND_UNDO_NOT_TAKEN_BACK_LABEL = "not taken back: ";

/**
 * The largest number of applied acts one exchange keeps (STORY 21.10,
 * PROVISIONAL). The TAIL is kept, because the undo walks the applied script
 * backwards; when a script is longer than this, the card says in one sentence
 * that its earliest acts are out of reach rather than pretending they are not
 * there. The bound is view state's, like the conversation's own.
 */
export const COMMAND_EXCHANGE_MAX_ACTS = 12;

/** The largest number of exchanges the card keeps in view (PROVISIONAL). */
export const COMMAND_HISTORY_MAX_EXCHANGES = 6;

/** The largest the kept conversation may reach, in UTF-8 bytes (PROVISIONAL). */
export const COMMAND_HISTORY_MAX_BYTES = 1200;

/**
 * The one qualitative sentence a bounded conversation carries: it says THAT
 * earlier turns were dropped, never how many. The card has no counters, and a
 * count dressed as context would be one.
 */
export const COMMAND_HISTORY_OMITTED_SENTENCE =
  "earlier turns were dropped, because this conversation is bounded.";

/**
 * THE UNDO SHAPES the card recognises (PROVISIONAL). This is not the app
 * reading the instruction for meaning — the model does that — it is the app
 * resolving a take-back against the LAST APPLIED ACT so the inverse is offered
 * as a real ghost (STORY 21.6) and never guessed into an add or a repeat. When
 * no pair can be computed the card answers 21.5's sentence instead; a shape
 * that slips past these is still told, in the prompt, never to repeat a turn it
 * is asked to take back (commands/interpreter.ts).
 */
const UNDO_SHAPES: readonly RegExp[] = [
  /\bundo\b/i,
  /\btake (that|it) back\b/i,
  /\bput (that|it) back\b/i,
  /\b(reverse|roll) (that|it|the last)\b/i,
  /\brollback\b/i,
  /\brevert\b/i,
  /\bun-?(add|do)\b/i,
  /\bremove (that|it|the (note|wire|card))\b/i,
];

/**
 * WHAT THE PERSON'S ACCEPT MEANS (ADR-0038 decision 4). The script preview is
 * the ghost preview: accepting it applies its acts, and there is no second
 * question. This sentence is the accept verb's title, so the rule is in code
 * and in the place a hand can read it.
 */
export const COMMAND_ONE_PRESS =
  "accepting this script applies its acts; this preview is the ghost preview";

/** The accept, refuse, read and answer verbs (PROVISIONAL wording). */
export const COMMAND_ACCEPT_VERB = "accept and apply";
export const COMMAND_REFUSE_VERB = "refuse";
export const COMMAND_READ_VERB = "read the instruction";
export const COMMAND_ANSWER_VERB = "answer";

/** The quiet "you said" label above each instruction (PROVISIONAL). */
export const COMMAND_LAST_LABEL = "you said: ";

/** The labels the card puts on the one question it asked (PROVISIONAL). */
export const COMMAND_ASKED_LABEL = "it asked: ";
export const COMMAND_ANSWERED_LABEL = "you answered: ";

/** What the card is waiting on, or null when it is not waiting (view state). */
export type CommandBusy = "reading" | "applying" | null;

/** The one question the card asked and the person's answer to it. */
export interface CommandQuestion {
  question: string;
  answer: string;
}

/** How one exchange ended: the story's three outcomes, plus the app's sentence. */
export type ExchangeOutcome =
  | { kind: "applied" }
  | { kind: "refused" }
  | { kind: "failed"; act: string | null; sentence: string }
  | { kind: "nothing"; sentence: string };

/** One turn of the card's conversation: view state, never a record. */
export interface CommandExchange {
  /** The person's words, VERBATIM, exactly as they typed them. */
  instruction: string;
  /** The acts it understood, as the card's plain lines; empty when it did not. */
  understood: readonly string[];
  /** The question the card asked and the answer it got, when it had to ask. */
  question: CommandQuestion | null;
  /** What became of it: applied, refused, failed at <act>, or a sentence. */
  outcome: ExchangeOutcome;
  /**
   * STORY 21.6 — THE ACTS THE APPLIED EXCHANGE RAN, kept so a later "undo that"
   * can offer the inverse of what actually landed instead of guessing at it.
   * VIEW STATE like the rest of the exchange: no record family, no log. Absent
   * on a refused or failed exchange (nothing landed) and on exchanges made
   * before this story (the card then falls back to 21.5's sentence).
   *
   * STORY 21.10 — THE WHOLE SCRIPT, BOUNDED. This is every act the script ran,
   * in act order, not just the last one, so an undo can invert all of them in
   * reverse order. It is bounded like the conversation: the TAIL is kept (the
   * undo walks backwards), and {@link actsBounded} says when the earliest acts
   * were dropped so the offer never claims to take back a part it does not hold.
   */
  acts?: readonly CommandAct[];
  /** STORY 21.10 — the applied script was longer than the exchange keeps. */
  actsBounded?: boolean;
  /**
   * STORY 21.10 — set on an UNDO's own exchange: what it took back and what it
   * could not, so the completed turn notes the undo it performed (Amendment 2:
   * "accepting a script and changing your mind is a normal move"). View state
   * again: the records it moved are the only record of the undo.
   */
  undo?: CommandUndo;
}

/** What one undo took back, as the exchange keeps it (STORY 21.10, view state). */
export interface CommandUndo {
  /** The instruction whose applied script this undo took back, VERBATIM. */
  instruction: string;
  /** The applied acts it could NOT take back, as the card's plain lines. */
  omitted: readonly string[];
  /** The applied script was longer than the exchange keeps (its earliest acts). */
  bounded: boolean;
}

/** One whole-script undo as the card can offer it (STORY 21.10). */
export interface CommandUndoOffer {
  /** The inverse acts, in the REVERSE order of the applied script's acts. */
  acts: readonly CommandAct[];
  /** The applied acts with no expressible inverse, in the scan's reverse order. */
  omitted: readonly CommandAct[];
  /** The applied script's earliest acts were bounded out of view. */
  bounded: boolean;
}

/** The card's conversation: the kept exchanges and whether older ones were dropped. */
export interface CommandThread {
  exchanges: readonly CommandExchange[];
  dropped: boolean;
}

/** An empty conversation: nothing said yet. */
export const EMPTY_COMMAND_THREAD: CommandThread = {
  exchanges: [],
  dropped: false,
};

/** What the interpreter answered, as the card shows it — the ONE live turn. */
export type CommandView =
  | {
      kind: "acts";
      instruction: string;
      acts: readonly CommandAct[];
      /** The question this script answers, when the turn needed one. */
      question: CommandQuestion | null;
      /**
       * STORY 21.10 — set when the script is a whole-script UNDO, so the card
       * can say what it takes back and what it cannot, and the exchange the
       * accept completes can note the undo it performed.
       */
      undo?: CommandUndo | null;
    }
  | { kind: "question"; instruction: string; question: string };

/** One interpreter answer: still live (a script to accept, a question to answer) or done. */
export type CommandTurn =
  | { kind: "pending"; view: CommandView }
  | { kind: "done"; exchange: CommandExchange };

/** One exchange's size for the bound: its words, measured exactly once. */
function exchangeBytes(exchange: CommandExchange): number {
  const parts = [
    exchange.instruction,
    exchange.understood.join("\n"),
    exchange.question === null
      ? ""
      : exchange.question.question + "\n" + exchange.question.answer,
    exchangeOutcomeLine(exchange),
    exchange.outcome.kind === "failed" ? exchange.outcome.sentence : "",
  ];
  return utf8ByteLength(parts.join("\n"));
}

/**
 * ADD ONE EXCHANGE, and keep the conversation bounded (STORY 21.5 rule 1).
 * WHOLE EXCHANGES ONLY, newest kept: the turn the person just had is never
 * dropped from view — the bound trims what came BEFORE it — and the dropped
 * flag makes the card say so in one qualitative sentence. There is no count
 * anywhere in the result.
 */
export function appendExchange(
  thread: CommandThread,
  exchange: CommandExchange,
): CommandThread {
  const all = [...thread.exchanges, exchange];
  const kept: CommandExchange[] = [];
  let bytes = 0;
  let dropped = thread.dropped;
  for (let index = all.length - 1; index >= 0; index -= 1) {
    const candidate = all[index]!;
    const size = exchangeBytes(candidate);
    const first = kept.length === 0;
    if (
      !first &&
      (kept.length + 1 > COMMAND_HISTORY_MAX_EXCHANGES ||
        bytes + size > COMMAND_HISTORY_MAX_BYTES)
    ) {
      dropped = true;
      break;
    }
    bytes += size;
    kept.unshift(candidate);
  }
  return { exchanges: kept, dropped };
}

/** The conversation's outcome line for one exchange (the story's own words). */
export function exchangeOutcomeLine(exchange: CommandExchange): string {
  switch (exchange.outcome.kind) {
    case "applied":
      return COMMAND_APPLIED_SENTENCE;
    case "refused":
      return COMMAND_REFUSED_SENTENCE;
    case "failed":
      return (
        COMMAND_FAILED_AT_PREFIX +
        (exchange.outcome.act === null
          ? "the first act"
          : JSON.stringify(exchange.outcome.act))
      );
    case "nothing":
      return exchange.outcome.sentence;
  }
}

/**
 * THE CONVERSATION AS THE PROMPT RECEIVES IT (STORY 21.5 rule 3). The recent
 * exchanges become plain data: the instruction verbatim, what was understood,
 * the question and its answer, and the outcome — no React, no record, and no
 * partial exchange.
 */
export function historyTurns(thread: CommandThread): InterpreterExchange[] {
  return thread.exchanges.map((exchange) => ({
    instruction: exchange.instruction,
    understood: exchange.understood,
    question: exchange.question?.question ?? null,
    answer: exchange.question?.answer ?? null,
    outcome: exchangeOutcomeLine(exchange),
  }));
}

/** Is this instruction asking the app to take something back? */
export function undoRequestOf(instruction: string): boolean {
  return UNDO_SHAPES.some((shape) => shape.test(instruction));
}

/**
 * THE LAST APPLIED EXCHANGE (STORY 21.6, widened by STORY 21.10): the newest
 * exchange whose outcome was applied, or null when nothing has landed in the
 * conversation the card still holds. ONE PASS BACKWARDS, no stack and no
 * history beyond the bounded conversation: the immediate inverse is the scope,
 * and an undo never reaches past the last applied script to the one before it.
 */
export function lastAppliedExchangeOf(
  exchanges: readonly CommandExchange[],
): CommandExchange | null {
  for (let index = exchanges.length - 1; index >= 0; index -= 1) {
    const exchange = exchanges[index]!;
    if (exchange.outcome.kind === "applied") return exchange;
  }
  return null;
}

/**
 * THE LAST APPLIED EXCHANGE'S ACTS (STORY 21.6), every one of them (STORY
 * 21.10): the whole applied script in act order, so the undo can invert all of
 * it. An exchange from before 21.6 carries no acts, and null is the honest
 * answer then — the card never invents a script from the exchange's plain
 * lines.
 */
export function lastAppliedActsOf(
  exchanges: readonly CommandExchange[],
): readonly CommandAct[] | null {
  return lastAppliedExchangeOf(exchanges)?.acts ?? null;
}

/**
 * THE INVERSE OF EVERY ACT, IN REVERSE ORDER (STORY 21.10, ADR-0038 Amendment
 * 2). Walks the applied script from its LAST act to its first, because that is
 * the order the records accept: a wire created after a card must be taken back
 * before the card. Each act is inverted by the vocabulary's own pairing
 * (commands/acts.ts's `inverseActOf`), never by a second table here.
 *
 * HONEST PARTIAL. A CHANGE the pairing cannot invert from the applied act alone
 * goes into `omitted` so the card can name it. A READ goes into neither list:
 * it changed nothing, so there is nothing to take back and naming it would
 * suggest something happened.
 */
function inverseScriptOf(
  applied: readonly CommandAct[],
  bounded: boolean,
): { acts: CommandAct[]; omitted: CommandAct[]; bounded: boolean } {
  const acts: CommandAct[] = [];
  const omitted: CommandAct[] = [];
  for (let index = applied.length - 1; index >= 0; index -= 1) {
    const act = applied[index]!;
    const inverse = inverseActOf(act);
    if (inverse !== null) {
      acts.push(inverse);
      continue;
    }
    if (actSpecOf(act.act)?.family === "propose") omitted.push(act);
  }
  return { acts, omitted, bounded };
}

/**
 * THE UNDO SCRIPT (STORY 21.6, WHOLE-SCRIPT SINCE STORY 21.10): the inverse of
 * EVERY applied act, in reverse order, as ONE script the person accepts once.
 * Null when the instruction is not undo-shaped, when nothing was applied, or
 * when no act of the applied script can be inverted at all (then the sentence
 * below answers instead). The omitted acts are not lost to the card: see
 * {@link undoOfferOf}, which carries them for the offer's honest sentence.
 */
export function undoScriptOf(
  instruction: string,
  lastAppliedActs: readonly CommandAct[] | null,
  bounded = false,
): CommandAct[] | null {
  if (!undoRequestOf(instruction) || lastAppliedActs === null) return null;
  const script = inverseScriptOf(lastAppliedActs, bounded);
  return script.acts.length === 0 ? null : script.acts;
}

/**
 * THE WHOLE-SCRIPT UNDO THE CARD OFFERS (STORY 21.10, ADR-0038 Amendment 2).
 * The last applied exchange answers with every inverse it can express, in
 * reverse order, plus the acts it cannot — so the offer can say what will not
 * be undone instead of claiming completeness.
 *
 * ONE GENERATION, AND WHOLE OR NOTHING FOR AN UNDO. The undo reads ONLY the
 * last applied exchange, so it never reaches back to the script it took back
 * (that would double-invert). When that last exchange was ITSELF an undo, a
 * PARTIAL restore is refused here: putting back the invertible part of an undo
 * can re-wire a card that stayed removed or re-name a card the undo removed,
 * which is the nonsense the rule forbids. Then the card answers with
 * {@link COMMAND_UNDO_SECOND_SENTENCE} and offers nothing.
 */
export function undoOfferOf(
  instruction: string,
  last: CommandExchange | null,
): CommandUndoOffer | null {
  if (!undoRequestOf(instruction) || last === null) return null;
  const applied = last.acts ?? null;
  if (applied === null) return null;
  const script = inverseScriptOf(applied, last.actsBounded === true);
  if (script.acts.length === 0) return null;
  if (last.undo !== undefined && (script.omitted.length > 0 || script.bounded)) {
    return null;
  }
  return script;
}

/**
 * THE SECOND UNDO'S ONE SENTENCE (STORY 21.10). The card asks this only after
 * {@link undoOfferOf} declined: when the last change was itself an undo that
 * could not be put back whole, saying WHAT happened is better than a partial
 * script that would break the map. Null when the last change was not an undo,
 * so the ordinary 21.5 fallback sentence still answers.
 */
export function undoSecondSentence(
  instruction: string,
  last: CommandExchange | null,
): string | null {
  if (!undoRequestOf(instruction)) return null;
  if (last === null || last.undo === undefined) return null;
  return COMMAND_UNDO_SECOND_SENTENCE;
}

/**
 * THE OFFER'S ONE HONEST SENTENCE (STORY 21.10): complete when every act can be
 * taken back, otherwise the acts that will be left as they are, named in the
 * card's own plain words. A bounded script adds that its earliest acts are out
 * of reach. Never a count, and never a claim of completeness it does not hold.
 */
export function undoLine(undo: CommandUndo | null | undefined): string | null {
  if (undo === null || undo === undefined) return null;
  const parts: string[] = [];
  if (undo.omitted.length > 0) {
    parts.push(COMMAND_UNDO_PARTIAL_PREFIX + undo.omitted.join(", ") + ".");
  }
  if (undo.bounded) parts.push(COMMAND_UNDO_BOUNDED_SENTENCE);
  return parts.length === 0
    ? COMMAND_UNDO_COMPLETE_SENTENCE
    : parts.join(" ");
}

/**
 * THE UNDO SENTENCE — THE FALLBACK SINCE STORY 21.6. An undo-shaped
 * instruction gets the honest sentence only when no real inverse is offered;
 * a non-undo instruction gets null (the model reads it). The bidirectional
 * "no real inverse" is decided by {@link undoScriptOf}, so the card and this
 * sentence cannot disagree about whether a script is on offer.
 */
export function undoSentenceOf(
  instruction: string,
  lastAppliedActs: readonly CommandAct[] | null = null,
): string | null {
  if (!undoRequestOf(instruction)) return null;
  return undoScriptOf(instruction, lastAppliedActs) === null
    ? COMMAND_UNDO_SENTENCE
    : null;
}

/** The exchange an undo-shaped instruction completes: nothing applied, said. */
export function undoExchangeOf(
  instruction: string,
  question: CommandQuestion | null,
  lastAppliedActs: readonly CommandAct[] | null = null,
): CommandExchange | null {
  const sentence = undoSentenceOf(instruction, lastAppliedActs);
  if (sentence === null) return null;
  return {
    instruction,
    understood: [],
    question,
    outcome: { kind: "nothing", sentence },
  };
}

/** An exchange that applied nothing, with the app's one sentence why. */
export function nothingExchange(
  instruction: string,
  question: CommandQuestion | null,
  sentence: string,
): CommandExchange {
  return {
    instruction,
    understood: [],
    question,
    outcome: { kind: "nothing", sentence },
  };
}

/**
 * An exchange the person's accept completed. STORY 21.10 keeps the WHOLE
 * applied script (bounded, the tail kept) so a later "undo that" can invert
 * every act of it; `undo` is only set when this acceptance was itself an undo,
 * and it is what lets the exchange note what it took back.
 */
export function appliedExchange(
  instruction: string,
  acts: readonly CommandAct[],
  question: CommandQuestion | null,
  undo: CommandUndo | null = null,
): CommandExchange {
  const bounded = acts.length > COMMAND_EXCHANGE_MAX_ACTS;
  const kept = bounded
    ? acts.slice(acts.length - COMMAND_EXCHANGE_MAX_ACTS)
    : [...acts];
  return {
    instruction,
    understood: actLines(acts),
    question,
    outcome: { kind: "applied" },
    // STORY 21.6: what landed, so "undo that" can offer its inverse.
    acts: kept,
    ...(bounded ? { actsBounded: true } : {}),
    ...(undo === null
      ? {}
      : {
          // The note's own bound is the ORIGINAL script's, which the offer
          // already carries; the undo's applied tail is what a next undo reads.
          undo: {
            instruction: undo.instruction,
            omitted: undo.omitted,
            bounded: undo.bounded || bounded,
          },
        }),
  };
}

/** An exchange the person refused: the script is dropped, nothing moves. */
export function refusedExchange(
  instruction: string,
  acts: readonly CommandAct[],
  question: CommandQuestion | null,
): CommandExchange {
  return {
    instruction,
    understood: actLines(acts),
    question,
    outcome: { kind: "refused" },
  };
}

/** An exchange whose script stopped at one act, named exactly. */
export function failedExchange(
  instruction: string,
  acts: readonly CommandAct[],
  question: CommandQuestion | null,
  sentence: string,
  act: string | null,
): CommandExchange {
  return {
    instruction,
    understood: actLines(acts),
    question,
    outcome: { kind: "failed", act, sentence },
  };
}

/**
 * TURN ONE INTERPRETER ANSWER INTO THE CARD (STORY 21.5). An answer that is a
 * script or a first question stays LIVE — the person still has to accept it or
 * answer it. Anything else (a problem, or a second question after the one
 * answer) is a COMPLETED exchange with one sentence, because there is nothing
 * left for the person to do with it.
 */
export function commandTurnOf(
  instruction: string,
  read: InterpreterRead,
  question: CommandQuestion | null,
): CommandTurn {
  if (read.kind === "acts") {
    return {
      kind: "pending",
      view: { kind: "acts", instruction, acts: read.acts, question },
    };
  }
  if (read.kind === "question") {
    // One question per exchange: asking again after an answer would start a
    // second round the story does not offer, so the turn completes and says so.
    if (question !== null) {
      return {
        kind: "done",
        exchange: nothingExchange(
          instruction,
          question,
          COMMAND_SECOND_QUESTION_SENTENCE,
        ),
      };
    }
    return {
      kind: "pending",
      view: { kind: "question", instruction, question: read.question },
    };
  }
  return {
    kind: "done",
    exchange: nothingExchange(instruction, question, read.sentence),
  };
}

export interface CommandCardProps {
  /** The map on screen. The card is present on every map (ADR-0038 §1). */
  level: Level;
  /** Closed by default; the app's state starts false and only a press opens it. */
  open: boolean;
  /** The person's instruction, verbatim, while it is being typed. */
  instruction: string;
  /** The clarifying answer, while the one question is being answered. */
  answer: string;
  /** The kept conversation, oldest first (view state, never a record). */
  exchanges: readonly CommandExchange[];
  /** Whether older turns were dropped by the bound (said, never counted). */
  dropped: boolean;
  /** The one live turn — a script to accept or a question to answer — or null. */
  view: CommandView | null;
  /** The wait, or null when the card is not waiting on anything. */
  busy: CommandBusy;
  onOpen(): void;
  onClose(): void;
  onInstruction(value: string): void;
  onAnswer(value: string): void;
  onInterpret(): void;
  onAnswerQuestion(): void;
  onAccept(): void;
  onRefuse(): void;
}

/**
 * MAY A CHANGE NAME THIS MAP? (STORY 21.9, PROVISIONAL: the ground map alone —
 * ADR-0038's amendment grows coverage act by act, and the other maps' acts need
 * their own design.) A READ is live everywhere; this is the one half the card
 * still has to announce.
 */
export function commandChangesLive(level: Level): boolean {
  return level === "ground";
}

/**
 * THE MOVE'S ANCHOR (ADR-0038 decision 2's PRISM, one per egress). The
 * interpreter's Move is anchored on the MAP the person is looking at — the
 * person's act happens there. A command card is not a card record, so when no
 * card is open the map itself is the anchor and its word is the level.
 */
export function commandAnchor(level: Level): string {
  return level;
}

/** One act as a plain line the list can carry (PROVISIONAL phrasing). */
export function actLine(act: CommandAct): string {
  const payload = act.payload;
  const text = (key: string): string => String(payload[key] ?? "");
  switch (act.act) {
    case "map_overview":
      return "read the map";
    case "read_card":
      return "read " + text("card");
    case "read_wires":
      return "read the wires";
    // STORY 21.9 — the two reads that opened the other maps, in plain words.
    case "read_words":
      return "read the words";
    case "read_map":
      return "read the " + act.map + " map";
    case "propose_card":
      return "add a card " + JSON.stringify(text("name"));
    case "propose_wire":
      return "wire " + text("from") + " → " + text("to");
    case "propose_note":
      return "add a note to " + text("card");
    case "propose_ask": {
      // STORY 21.7 — the plain line says the whole of what the act will do: the
      // card, the question waiting unsent in its composer, and the cards wired
      // into it. An unsent question is a DRAFT, so no line here promises a turn.
      const question = payload.question;
      const context = Array.isArray(payload.context)
        ? payload.context.map((entry) => String(entry))
        : [];
      const parts = ["add an ask card " + JSON.stringify(text("name"))];
      if (typeof question === "string" && question.trim() !== "") {
        parts.push("put the question in it, unsent");
      }
      if (context.length > 0) {
        parts.push("wire " + context.join(", ") + " into it");
      }
      return parts.join("; ");
    }
    case "propose_unwire":
      return "unwire " + text("from") + " → " + text("to");
    case "propose_remove_note":
      return "remove the note on " + text("card");
    case "propose_remove_card":
      return "remove the card " + JSON.stringify(text("card"));
    case "propose_move": {
      // STORY 21.8 — the app's inverse is the ONE place a move names a point.
      if (typeof payload.x === "number" && typeof payload.y === "number") {
        return "move " + text("card") + " back to (" + payload.x + ", " + payload.y + ")";
      }
      const direction = text("direction");
      const other = text("other");
      return (
        "move " +
        text("card") +
        " " +
        direction +
        (other === "" ? " from where it is" : " " + other)
      );
    }
    case "propose_rename":
      // Never says "rename": the words are a proposal the person accepts.
      return (
        "propose the name " +
        JSON.stringify(text("name")) +
        " for " +
        text("card")
      );
    // STORY 21.11 — the session card in plain words. None of these lines
    // promises a run: a run is an egress and stays the person's press.
    case "propose_session":
      return (
        "add a session card " +
        JSON.stringify(text("name")) +
        " on " +
        text("tool")
      );
    case "propose_bind_session":
      return "bind the session card " + text("card") + " to " + text("tool");
    case "propose_remove_session":
      return "remove the session card " + JSON.stringify(text("card"));
    default:
      // Unreachable through the validated vocabulary; the act's own name is
      // the honest fallback rather than an invented sentence.
      return act.act;
  }
}

/** The acts as the card's short numbered list: one plain line per act. */
export function actLines(acts: readonly CommandAct[]): string[] {
  return acts.map(actLine);
}

/**
 * ONE FAILURE, NAMED EXACTLY. The executor stops at the FIRST failing act and
 * applies nothing after it (commands/execute.ts); a proposal is not a write, so
 * the acts before it are held as ghosts and not applied either. This sentence
 * names the failing act, the app's own reason, and every act's disposition —
 * the report the story's hard constraint asks for.
 */
export function failureReport(
  acts: readonly CommandAct[],
  run: CommandRun,
): string {
  const failed = acts[run.applied] ?? null;
  const reason = run.sentence ?? COMMAND_FAILED_SENTENCE;
  if (failed === null) {
    return reason;
  }
  const before = acts.slice(0, run.applied);
  const after = acts.slice(run.applied + 1);
  const names = (list: readonly CommandAct[]): string =>
    list.map((act) => JSON.stringify(act.act)).join(", ");
  const parts: string[] = [
    "the act " + JSON.stringify(failed.act) + " failed: " + reason,
  ];
  if (before.length === 0) {
    parts.push("Nothing was applied before it.");
  } else if (before.length === 1) {
    parts.push(
      "Nothing was applied: the act before it (" +
        names(before) +
        ") is held as a ghost, not applied.",
    );
  } else {
    parts.push(
      "Nothing was applied: the acts before it (" +
        names(before) +
        ") are held as ghosts, not applied.",
    );
  }
  if (after.length === 0) {
    parts.push("Nothing followed it.");
  } else {
    parts.push(names(after) + " did not run.");
  }
  return parts.join(" ");
}

/**
 * THE ONE CLARIFYING QUESTION IS ANSWERED ONCE. The next interpretation carries
 * the person's instruction, the question the card asked, and the answer, so the
 * model sees the exchange instead of guessing. PROVISIONAL wording.
 */
export function clarifiedInstruction(
  original: string,
  question: string,
  answer: string,
): string {
  return (
    original +
    "\n\nthe card asked: " +
    question +
    "\nthe answer is: " +
    answer
  );
}

/** The composer's disabled state: nothing to read, or already waiting. */
function readDisabled(instruction: string, busy: CommandBusy): boolean {
  return busy !== null || instruction.trim() === "";
}

/** The answer's disabled state: nothing to answer, or already waiting. */
function answerDisabled(answer: string, busy: CommandBusy): boolean {
  return busy !== null || answer.trim() === "";
}

/**
 * ONE EXCHANGE AS THE CARD DRAWS IT: the instruction verbatim, the acts it
 * understood (or the question and the answer), and the outcome. "applied" is
 * the shortest line here on purpose — a change that worked says so and stops.
 */
function Exchange({ exchange }: { exchange: CommandExchange }) {
  return (
    <li className="command-card-exchange">
      <div className="command-card-exchange-instruction">
        {COMMAND_LAST_LABEL}
        {exchange.instruction}
      </div>

      {exchange.question !== null && (
        <div className="command-card-exchange-question">
          <div>{COMMAND_ASKED_LABEL}{exchange.question.question}</div>
          {exchange.question.answer !== "" && (
            <div>{COMMAND_ANSWERED_LABEL}{exchange.question.answer}</div>
          )}
        </div>
      )}

      {exchange.understood.length > 0 && (
        <ol className="command-card-acts">
          {exchange.understood.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ol>
      )}

      {/* STORY 21.10 — AN UNDO NOTES WHAT IT TOOK BACK. The complete take-back
          needs no more than that line; a partial one names the acts it left as
          they are, and a bounded script says its earliest acts are out of
          reach. Never a completeness claim the offer did not have. */}
      {exchange.undo !== undefined && (
        <div className="command-card-quiet">
          <div>
            {COMMAND_UNDO_TOOK_BACK_LABEL}
            {exchange.undo.instruction}
          </div>
          {exchange.undo.omitted.length > 0 && (
            <div>
              {COMMAND_UNDO_NOT_TAKEN_BACK_LABEL}
              {exchange.undo.omitted.join(", ")}.
            </div>
          )}
          {exchange.undo.bounded && <div>{COMMAND_UNDO_BOUNDED_SENTENCE}</div>}
        </div>
      )}

      <div className="command-card-outcome">
        {exchangeOutcomeLine(exchange)}
      </div>
      {exchange.outcome.kind === "failed" && (
        <div className="command-card-quiet">{exchange.outcome.sentence}</div>
      )}
    </li>
  );
}

/**
 * THE CARD. Present on every map; CLOSED by default (the closed bar is the
 * whole surface until the person presses it). The open body is the only scroll
 * region; the card never traps focus and never covers the level control.
 */
export function CommandCard({
  level,
  open,
  instruction,
  answer,
  exchanges,
  dropped,
  view,
  busy,
  onOpen,
  onClose,
  onInstruction,
  onAnswer,
  onInterpret,
  onAnswerQuestion,
  onAccept,
  onRefuse,
}: CommandCardProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  // ESC CLOSES, and only the person's press opens. The listener is on the
  // window so Esc works wherever focus sits inside the card; it never takes Tab,
  // never calls focus() in a loop, and therefore traps no focus.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

  // The instruction field is where the person's press lands: focus it on open,
  // once. A later re-render never steals focus back. STORY 21.9: the field is
  // on every map now (a read is live everywhere), so there is no map to skip.
  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
  }, [open, level]);

  if (!open) {
    return (
      <div className="command-card closed">
        <button
          type="button"
          className="command-card-bar"
          title={COMMAND_INVITATION}
          onClick={onOpen}
        >
          {COMMAND_INVITATION}
        </button>
      </div>
    );
  }

  const waiting = busy !== null;

  return (
    <section
      className="command-card open"
      aria-label="command card"
      onWheel={(event) => event.stopPropagation()}
    >
      <div className="command-card-head">
        <span className="command-card-title">{COMMAND_TITLE}</span>
        <button
          type="button"
          className="command-card-close"
          aria-label="close the command card"
          onClick={onClose}
        >
          ×
        </button>
      </div>

      {/* STORY 21.9 — WHICH HALF THE CARD IS DOING. Off the ground map the
          reads are live and only the changes are not, so the card says that in
          ONE sentence above a body that still works. It is not a warning and
          not a block: the person can still ask this map what it holds. */}
      {!commandChangesLive(level) && (
        <div className="command-card-elsewhere">
          {COMMAND_NON_GROUND_SENTENCE}
        </div>
      )}

      <div className="command-card-body">
        {exchanges.length > 0 && (
          <ol className="command-card-thread">
            {exchanges.map((exchange, index) => (
              <Exchange key={index} exchange={exchange} />
            ))}
          </ol>
        )}

        {/* The bound SAID, never counted: one qualitative sentence. */}
        {dropped && (
          <div className="command-card-quiet">
            {COMMAND_HISTORY_OMITTED_SENTENCE}
          </div>
        )}

        {view !== null && (
          <div className="command-card-last">
            {COMMAND_LAST_LABEL}
            {view.instruction}
          </div>
        )}

        {view?.kind === "acts" && (
          <div className="command-card-script">
            {view.question !== null && (
              <div className="command-card-exchange-question">
                <div>{COMMAND_ASKED_LABEL}{view.question.question}</div>
                <div>{COMMAND_ANSWERED_LABEL}{view.question.answer}</div>
              </div>
            )}
            {/* STORY 21.10 — A WHOLE-SCRIPT UNDO SAYS WHAT IT TAKES BACK,
                and which acts it cannot: the offer's honest sentence sits
                above the list, so a partial undo is visible BEFORE the press. */}
            {view.undo != null && (
              <div className="command-card-quiet">
                <div>
                  {COMMAND_UNDO_TAKES_BACK_LABEL}
                  {view.undo.instruction}
                </div>
                <div>{undoLine(view.undo)}</div>
              </div>
            )}
            <ol className="command-card-acts">
              {actLines(view.acts).map((line, index) => (
                <li key={index}>{line}</li>
              ))}
            </ol>
            <div className="command-card-verbs">
              <button
                type="button"
                className="command-card-accept"
                title={COMMAND_ONE_PRESS}
                disabled={waiting}
                onClick={onAccept}
              >
                {COMMAND_ACCEPT_VERB}
              </button>
              <button
                type="button"
                className="command-card-refuse"
                disabled={waiting}
                onClick={onRefuse}
              >
                {COMMAND_REFUSE_VERB}
              </button>
            </div>
          </div>
        )}

        {view?.kind === "question" && (
          <div className="command-card-clarify">
            <div className="command-card-question" role="status">
              {view.question}
            </div>
            <div className="command-card-answer-row">
              <input
                className="command-card-answer"
                value={answer}
                placeholder="answer the question"
                aria-label="answer the clarifying question"
                disabled={waiting}
                onChange={(event) => onAnswer(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  onAnswerQuestion();
                }}
              />
              <button
                type="button"
                className="command-card-answer-send"
                disabled={answerDisabled(answer, busy)}
                onClick={onAnswerQuestion}
              >
                {COMMAND_ANSWER_VERB}
              </button>
            </div>
          </div>
        )}

        {busy !== null && (
          <div className="command-card-working" role="status">
            {busy === "reading"
              ? COMMAND_READING_SENTENCE
              : COMMAND_APPLYING_SENTENCE}
          </div>
        )}
      </div>

      <div className="command-card-compose">
        <input
          ref={inputRef}
          className="command-card-instruction"
          value={instruction}
          placeholder="say what to change"
          aria-label="the instruction"
          disabled={waiting}
          onChange={(event) => onInstruction(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            onInterpret();
          }}
        />
        <button
          type="button"
          className="command-card-read"
          disabled={readDisabled(instruction, busy)}
          onClick={onInterpret}
        >
          {COMMAND_READ_VERB}
        </button>
      </div>
    </section>
  );
}
