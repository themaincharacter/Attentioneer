import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ASK_QUESTION_REFUSAL,
  ASK_THREAD_BOUND,
  askDisplayName,
  askLastTurn,
  askNameForWrite,
  askRefusal,
  askRoleMark,
  proposeForkName,
  type AskCard as AskCardRecord,
  type AskTurn,
} from "../map/asks";
import {
  ASK_CONTEXT_BOUND,
  assembleAskCardPacket,
  selectAskContextCards,
  type AskPacketCard,
  type AskPacketReadback,
} from "../turn/packet";
import {
  ASK_DECLARATION_VERB,
  ASK_DECLARATION_VERB_SENT,
  ASK_OVERFLOW_CLOSE,
  ASK_OVERFLOW_FORK,
  ASK_OVERFLOW_REMOVE,
  ASK_OVERFLOW_VERB,
  ASK_READ_MISSED,
  askReadMoreWords,
  askWorkingWords,
  type AskCallsFacts,
  type AskWorkPhase,
} from "./contactRules";
import { isGestureArmed, type GestureMode } from "./gates";
import { startGroundLinkDrag } from "./linkDrag";
import { attachGroundCardDrag } from "./groundDrag";
import {
  frameGroundCard,
  settleGroundCard,
  type GroundDragChannel,
} from "./groundDragRef";
import type { Point } from "./geometry";
import { GESTURE_IDLE, type GestureNarration } from "./gestureWord";
import { previewOverflows, previewText } from "../map/readings";
import { PacketSurface } from "./PacketSurface";
import { STEP_LIMIT_SENTENCE } from "../turn/steps";
import { PROVIDER_SENTENCES } from "../turn/providers";
import { CardNamePill, type PillNameRules } from "./CardNamePill";
import type { GroundAddResult } from "./useGround";

/**
 * STORY 16.22 — THE ASK CARD'S RULES FOR THE SHARED NAME PILL. The pill decides
 * nothing about a blank field: this family REFUSES one (a question's name is
 * the person's words; an invented placeholder would be a card that says nothing
 * about what it asks), so `askNameForWrite` answers null and no write follows.
 * The reference card's rule — a blank field becomes "Untitled reference" — is
 * deliberately NOT this family's, one family over.
 */
const ASK_PILL_RULES: PillNameRules = {
  displayName: askDisplayName,
  nameForWrite: askNameForWrite,
};

/**
 * THE ASK CARD (Epic 17 story 1; story 2 makes it a conversation).
 *
 * It renders from the SAME grammar as a reference card — name, what this is,
 * the crop — so the map stays one surface: the name is the person's, the second
 * line says "a question about <the reference's name>", and the body is the
 * thread. THE THREAD IS THE RECORD, NOT THIS COMPONENT: the turns arrive as a
 * prop, read at load from `map/asks/<slug>.jsonl`, in FILE ORDER (append-only,
 * so file order is conversation order). The small face crops the LAST turn at
 * the person's stated count; the expanded face shows the whole thread newest at
 * the bottom, scrollable, with the question field pinned under it.
 *
 * TURNS ARE ONE CONVERSATION, NOT A CHAT APP. A person's line and an answer
 * line are told apart by the ink ladder and ONE quiet role mark ("you" /
 * "answer") — no bubbles, no avatars, no visible timestamp and never a count.
 * The record keeps the words verbatim; this file only says who spoke.
 *
 * ONE TURN AT A TIME. While a turn runs the input and send are disabled, the
 * person's line and the arriving answer live as a PENDING line in the thread,
 * and stop is the existing stop. A stopped or broken turn keeps the words that
 * arrived, MARKED as incomplete, and writes no answer line: the record's answer
 * line is only ever a finished answer (story 17.4 owns the PRISM side).
 *
 * STORY 16.22 — THE NAME FLOATS ABOVE THIS CARD TOO, in the SHARED pill (one
 * component, one counter-scale, one rename field) that the reference cards
 * already wear: an ask card is a peer on the same map, and its name was cropped
 * by its own thread at exactly the zoom where the map's shape is being read.
 * The card's OWN name rules ride into the pill (`ASK_PILL_RULES`): a blank
 * field is a REFUSAL here — the card keeps the name it had and writes nothing —
 * so no "Untitled ask" placeholder is ever invented. The rename reaches the
 * hook's one ask-name path, which writes the record and ONE `card.rename`
 * history line (never a word of the conversation).
 *
 * ESC CLOSES THE CARD'S EDITOR (collapses), never the map: the capture listener
 * stops the key before the plane's handlers see it. A half-typed question stays
 * in the input while the card stays mounted and a draft writes NOTHING — only
 * send reaches the writer.
 *
 * The card's wheel never zooms the plane: the scrollbox stops the event where
 * it starts, so the body scrolls and the camera stands still.
 *
 * WHAT IT SENDS (story 17.3; corrected by story 17.9) is the packet assembled
 * from the cards WIRED INTO this one — the user's correction: "you can link
 * them together to help give the llm context". Every incoming wire contributes
 * what its card has (a reference its crops and note, an ask its newest answer,
 * a session its newest completed run), bounded as WHOLE cards; the conversation
 * so far rides under its own stated bound, then the instruction and the bound.
 * An ask card with NOTHING wired in still sends. Before the send the card
 * DECLARES every block with its exact size and opens the exact bytes through
 * the shared PacketSurface — the same verb the Ask Move uses; after it, the
 * same surface opens what left.
 *
 * A DANGLING ANCHOR IS SAID, NOT REPAIRED (story 17.6). When the anchored
 * reference is gone the card's second line states what it was about — by the
 * name the RECORD remembered when the person bound it — and that the card is
 * gone. The thread still reads top to bottom and still sends (the packet
 * records the null inclusion); restoring the deleted card clears the sentence
 * because the anchor resolves again (STORY 17.10 removed the re-anchor verb —
 * the field is display-only legacy). THE THREAD IS NEVER
 * TOUCHED: no turn is rewritten, truncated or deleted, and no ask is merged or
 * moved to a "close" card.
 *
 * A FORK IS A BRANCH, NOT A DUPLICATE (story 17.5). The `fork` verb sits WITH
 * a turn: it branches the conversation there and writes a new card that
 * REFERENCES the parent's first n turns. STORY 17.10: a fork inherits no anchor
 * (it is a peer card; context arrives by wire). This component
 * never copies them — the layer hands it the COMPOSED thread (carried prefix
 * read from the parent, then the card's own turns), `carried` says where the
 * branch point sits, and one quiet divider marks it. A parent that is gone
 * replaces the carried part with one stated line and the own turns still read
 * and still send.
 *
 * STORY 17.10 — AN ASK IS A PEER CARD. The ground bubble's ASK door makes the
 * card EMPTY (no anchor, nothing from the press but the point); it says "a
 * question", names itself from its first question's short form, and its title
 * pill is the rename field. The reply is the card's own thread, above the
 * composer — no new record kind, no document, no separate surface.
 *
 * THE PER-ASK PROVIDER SELECTOR IS GONE BY DESIGN (story 17.7, recorded in
 * 17.7b): one selection lives in Settings. The card READS that selection and,
 * when nothing resolves, says so BEFORE the send — one sentence and one verb
 * to the Settings, with no question box and no send. A future story decides
 * whether a per-card selector comes back; this card does not grow a second
 * one, and its only post-send path stays the one existing sentence.
 *
 * STORY 17.7b — THE CARD SAYS WHAT THE TURN HIT. The retired panel used to
 * surface two facts the turn computes and the card did not draw: the step
 * ceiling (`STEP_LIMIT_SENTENCE`) and a READ the packet did not carry
 * (`ASK_READ_MISSED`). They now ride the turn result and render as ONE quiet
 * line each, beside the turn they belong to — no count, no internal key, no
 * red, no icon. They are VIEW facts: the conversation file still holds only
 * words, so a reload forgets them.
 *
 * STORY 17.8 — THE CARD CAN BE REMOVED, like every other card: one press, no
 * confirming step, and the toast's Restore is the guard (story 16.13). The
 * layer owns the bytes (the record line and the conversation, read before the
 * unlink) and this component only presses the verb — it never touches a file.
 *
 * STORY 16.27 — THE CARD QUIETS DOWN. The user, from a screenshot: "The ask
 * card is very noisy. Not sure why it needs to state all the bytes numbers
 * and stuff." The face now carries its name, what it is, the thread, the
 * question field and one short provenance line; the DECLARATION — every block
 * with its size, both calls, the live page line, the exact-bytes reader — is
 * behind ONE quiet disclosure, closed by default and never opened by a send.
 * The full wired-in list rides behind the same verb. No size is rendered on
 * the face, ever. The retrieval offer is a VERB ("read more of <name>") and
 * the readback sentence lives in the declaration with the rest. The footer
 * keeps the primary action (send, or stop while a turn runs) and ONE overflow
 * verb holding fork, remove and close; a turn's fork is revealed on hover.
 * The honest sentences (17.7b's hit lines, 17.11's no-card line) stand only
 * when they happen, now outside the thread rather than in the next message's
 * place. Nothing was removed from what a person CAN open — only from what is
 * shown by default.
 *
 * STORY 16.28 — IT SAYS IT IS WORKING. The user, live: "There is no loading
 * indicator to let the user know that the LLM is thinking or whatever." The
 * thread now carries ONE quiet line during each wait: "the model is working"
 * before the first streamed word, "distilling the answer" while the curator
 * runs after the last, and nothing when idle. The first part removes the task
 * line — the streamed text IS the indicator — and the line never lies about
 * progress: it says that work is happening, never how much (no percentage, no
 * elapsed seconds, no token count, no step number, no digit at all). Stop is
 * the same stop in both waits, because the turn port targets whichever call is
 * live. A stopped or failed turn clears the line and the existing sentences
 * take over; a failed curator leaves its failure sentence, never the distil
 * line. The layer names the curator's own start and end (only it makes that
 * call); the card's press is the task's own start.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the card's size, the crop, the
 * scrollbox height and slack, the role marks, the stopped/incomplete wording,
 * story 17.5's divider and missing-parent lines and the fork chooser's look,
 * STORY 17.10's "a question" line, the "Untitled ask" sentinel, the short-name
 * rule and the rename field, story 17.6's dangling sentence, its wording and its place
 * on the "what this is" line, story 17.7b's fact lines' placement and the
 * pre-send state's wording (the sentence is reused, not new), and — STORY
 * 17.9 — the context line's wording and the dangling-wire sentence, and —
 * STORY 16.27 — the disclosure verb's wording, the overflow verb and its three
 * items, the read-more verb, and where the full provenance list sits, and —
 * STORY 16.28 — the two workings' wordings, the marker and its breathe, and
 * where the working line sits in the thread.
 */

/** The quiet line an ask card with no turns shows (PROVISIONAL wording). */
export const ASK_EMPTY_SENTENCE = "no question asked yet";

/**
 * STORY 17.10 — WHAT A PEER ASK SAYS IT IS. A card made by the bubble's ASK
 * door was born empty: no anchor, no theme, nothing from the press but the
 * point. Its second line says the one true thing — it is a question — instead
 * of the dangling-anchor sentence, which speaks about a card that is gone and
 * has nothing to say about a card that never existed. PROVISIONAL wording.
 */
export const ASK_PEER_LINE = "a question";

/**
 * STORY 17.9 — WHAT THE CARD SAYS IT HAS. The user's correction: the cards
 * WIRED INTO an ask card are its context, so the expanded card lists them by
 * name above the thread (never a count), or says in one quiet line that nothing
 * is wired in — and a card with no context still sends.
 */
export const ASK_CONTEXT_LABEL = "wired in: ";
export const ASK_CONTEXT_EMPTY = "nothing is wired into this question.";
export const ASK_CONTEXT_DANGLING =
  "a card wired into this question is gone; the wire is not repaired.";

/** What a stopped turn's partial says (PROVISIONAL wording, story 7's idiom). */
export const ASK_STOPPED_MARK = " — stopped mid-answer";

/** What a broken-off turn's partial says (PROVISIONAL wording). */
export const ASK_INCOMPLETE_MARK = " — the answer broke off";

/**
 * STORY 17.11 — THE ONE QUIET LINE A TURN GETS WHEN NO CARD WAS MADE. It is a
 * plain statement, not an error: the reply, when there was one, still stands
 * in the thread above it (ADR-0037 decision 8).
 */
export function AskNoCardLine({ line }: { line: string }) {
  return <div className="ask-fork-missing">{line}</div>;
}

/** How close to the bottom still counts as "at the bottom" (px, PROVISIONAL). */
export const ASK_SCROLL_SLACK = 24;

/** What this ask is about, as the card's second line (PURE, PROVISIONAL). */
export function askKindLine(anchorName: string | null): string {
  return "a question about " + (anchorName === null ? "a card that is not here" : anchorName);
}

/**
 * STORY 17.6 — THE ONE QUIET LINE A DANGLING ANCHOR GETS (PURE, PROVISIONAL
 * wording and position): what the card was about, said by the name the record
 * REMEMBERS, and the fact that the card is gone. It sits where the card's
 * "what this is" line sits — above the thread, on the small and the expanded
 * face alike — so the sentence is never hidden behind an open card. No error
 * state, no red, no modal, no verb: STORY 17.10 retired the re-anchor verb, so
 * the anchor is read and shown, never changed. A card recorded before the name was remembered
 * says the generic sentence rather than inventing one.
 */
export function askDanglingLine(remembered: string | null): string {
  const name = remembered === null ? "" : remembered.trim();
  return name === ""
    ? "this was about a card that is not here; it is gone."
    : "this was about " + name + "; that card is gone.";
}

/**
 * THE ONE QUIET DIVIDER (story 17.5): the line between the turns a fork CARRIES
 * and the turns it said itself. One line, never a count — the card says where
 * the branch point is, not how many turns are on either side of it.
 * PROVISIONAL wording.
 */
export const ASK_FORK_DIVIDER = "carried from the card this one was forked from";

/**
 * WHAT A FORK SAYS WHEN ITS PARENT IS GONE (story 17.5, PROVISIONAL wording):
 * one quiet line, stated and never repaired and never an error. The fork's own
 * turns still read under it, and it can still send — the anchor is its own.
 */
export const ASK_FORK_MISSING =
  "the card this one was forked from is gone, so the earlier turns it carried are not here.";

/** How a pending line ended: still arriving, stopped, or broken off. */
export type AskEnding = "running" | "stopped" | "incomplete";

/**
 * THE PENDING TURN (story 17.2): the question the person just sent and the
 * answer arriving under it. VIEW STATE ONLY — it is never written; the record
 * write happens in `useGround.askTurn` when the turn settles.
 */
export interface AskPending {
  /** The person's words, or "" once the record holds them. */
  question: string;
  /** The answer text accumulated so far, or "". */
  answer: string;
  ending: AskEnding;
}

/** A turn has just been sent: its question is pending, no answer yet. */
export function askSendPending(question: string): AskPending {
  return { question, answer: "", ending: "running" };
}

/** The answer is arriving: the accumulated text replaces the pending line. */
export function askPartPending(
  pending: AskPending | null,
  text: string,
): AskPending | null {
  // A part can only extend a RUNNING turn; a settled line is never reopened.
  if (pending === null || pending.ending !== "running") return pending;
  return { ...pending, answer: text };
}

/**
 * The turn settled. An answer is now in the record, so the pending line goes.
 * A failed turn keeps what arrived, MARKED incomplete; with no words there is
 * nothing to mark and the one sentence stands alone. PURE, so the rule is not
 * the JSX's only truth.
 */
export function askSettlePending(
  pending: AskPending | null,
  answered: boolean,
  stopped: boolean,
): AskPending | null {
  if (answered) return null;
  if (pending === null || pending.answer === "") return null;
  return {
    question: "",
    answer: pending.answer,
    ending: stopped ? "stopped" : "incomplete",
  };
}

/** The mark a settled partial carries, or null while it is still arriving. */
export function askEndingMark(ending: AskEnding): string | null {
  if (ending === "stopped") return ASK_STOPPED_MARK;
  if (ending === "incomplete") return ASK_INCOMPLETE_MARK;
  return null;
}

/**
 * STORY 16.28 — WHICH QUIET LINE THE TURN OWES, OR NONE (PURE).
 *
 * Three states, one line each: while the task call runs and nothing has
 * arrived, the model is working; while the curator distils a finished answer,
 * the answer is being distilled; otherwise nothing. THE FIRST PART ENDS THE
 * FIRST LINE — the streamed text IS the indicator, so the line goes the instant
 * there is a word of real text and never competes with it. A settled or idle
 * turn owes no line at all: the stopped, broken or no-card sentences take over
 * from there.
 *
 * The curator line needs an answer to distil, so a curator phase with no text
 * says nothing (that state cannot happen on the real path, and inventing a
 * line for it would claim work over an empty reply).
 */
export function askWorkingLine(
  pending: AskPending | null,
  phase: AskWorkPhase,
): string | null {
  if (phase === "idle" || pending === null || pending.ending !== "running") {
    return null;
  }
  const arrived = pending.answer !== "";
  if (!arrived) {
    return phase === "curator" ? null : askWorkingWords("task");
  }
  return phase === "curator" ? askWorkingWords("curator") : null;
}

/**
 * THE WORKING LINE ITSELF: one quiet line in the thread, in the card's voice —
 * never a toast, never a modal. The marker is the ONE animated thing (a soft
 * breathe); the words never move, and under reduce motion the marker is drawn
 * static (canvas.css drops the animation outright). No number rides here: the
 * line says that work is happening, never how much of it there is.
 */
export function AskWorkingLine({ line }: { line: string }) {
  return (
    <div className="ask-working" role="status">
      <span className="ask-working-marker" aria-hidden="true" />
      <span className="ask-working-text">{line}</span>
    </div>
  );
}

/**
 * STORY 17.7b — WHAT THE TURN HIT, AS THE CARD'S OWN QUIET LINES (PURE).
 *
 * The turn result says whether the step ceiling bit and whether a READ named a
 * block the view did not carry. The card says each as ONE line, using the
 * EXISTING sentence constants so no second wording exists for either fact:
 * `STEP_LIMIT_SENTENCE` is stated, never counted ("reached", never a ratio),
 * and `ASK_READ_MISSED` names nothing internal — the requested name does not
 * ride the sentence. A clean turn renders nothing at all. The class is story
 * 17.5's quiet stated line, reused rather than growing a new colour.
 */
export function AskTurnFactsLine({ result }: { result: GroundAddResult }) {
  const reached = result.reached ?? null;
  const missed = result.missed ?? null;
  const missedSaid = missed !== null && missed.trim() !== "";
  if (reached === null && !missedSaid) return null;
  return (
    <div className="ask-fork-missing">
      {reached !== null && <div>{STEP_LIMIT_SENTENCE}</div>}
      {missedSaid && <div>{ASK_READ_MISSED}</div>}
    </div>
  );
}

/** Whether a scrollbox is close enough to its bottom to keep following (PURE). */
export function askAtBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= ASK_SCROLL_SLACK;
}

/**
 * WHICH PENDING PIECES THE RECORD ALREADY HOLDS (PURE): when the record's write
 * lands, the same question/answer must not be drawn twice for a frame. The tail
 * is the only place a just-written exchange can be, so this reads the last two
 * turns and nothing else.
 */
export function askPendingInRecord(
  turns: readonly AskTurn[],
  pending: AskPending | null,
): { question: boolean; answer: boolean } {
  if (pending === null) return { question: false, answer: false };
  const last = turns.length === 0 ? null : turns[turns.length - 1]!;
  const previous = turns.length < 2 ? null : turns[turns.length - 2]!;
  const question =
    last !== null &&
    ((last.role === "person" && last.text === pending.question) ||
      (last.role === "answer" &&
        previous !== null &&
        previous.role === "person" &&
        previous.text === pending.question));
  const answer =
    last !== null &&
    pending.answer !== "" &&
    last.role === "answer" &&
    last.text === pending.answer;
  return { question, answer };
}

/** One turn on the thread: a quiet role mark, then the words. */
function AskTurnLine({
  turn,
  crop,
  ending,
  onFork,
}: {
  turn: AskTurn;
  /** The small face's stated count; the expanded face omits it. */
  crop?: number;
  /** A pending line's ending, for the stopped/broken mark. */
  ending?: AskEnding;
  /**
   * STORY 17.5 — the fork verb SITS WITH THE TURN (not on the card header): it
   * branches at this point of the conversation. Absent on a pending line, on a
   * carried turn (that turn is the parent's), and where no writer is wired.
   */
  onFork?: () => void;
}) {
  const text = crop === undefined ? turn.text : previewText(turn.text, crop);
  const mark = ending === undefined ? null : askEndingMark(ending);
  return (
    <div className={`ask-turn ${turn.role}${ending === undefined ? "" : " pending"}`}>
      <span className="ask-turn-role">{askRoleMark(turn.role)}</span>
      <span className="ask-turn-text">
        {text}
        {mark !== null && <span className="ask-turn-mark">{mark}</span>}
      </span>
      {onFork !== undefined && (
        <button
          type="button"
          className="ask-turn-fork"
          title="fork this card here"
          onClick={onFork}
        >
          fork
        </button>
      )}
    </div>
  );
}

export function AskCard({
  ask,
  anchorName,
  context = [],
  contextMissing = false,
  turns,
  carried = 0,
  forkMissing = false,
  open,
  previewLines,
  hasProvider,
  calls = null,
  onOpenSettings,
  onOpen,
  onClose,
  onAskTurn,
  onStopTurn,
  onForkTurn,
  onRename,
  onRemove,
  onMove,
  onLink,
  zoom = 1,
  autoAsk,
  onAutoAsked,
  interactionMode = "idle",
  onNarrate,
  drag,
}: {
  ask: AskCardRecord;
  /**
   * The anchored reference's live name, or null when the anchor is gone. STORY
   * 17.6: when this is null the card speaks from the RECORD's `anchorName` (the
   * name remembered at binding time) and falls back to the generic sentence only
   * when even that is absent.
   */
  anchorName: string | null;
  /**
   * STORY 17.9 — THE CARDS WIRED INTO THIS ONE, in wire order, ALREADY
   * CROPPED: every reference's block (name, state, reading crop, note crop), an
   * ask card's last completed answer, a session card's last completed run, or
   * the one line saying it has nothing to lend. The user's correction: the
   * wires ARE the context, never a field. Optional so a render test that does
   * not care about the declaration needs nothing; [] simply means no context.
   */
  context?: readonly AskPacketCard[];
  /**
   * STORY 17.9 — a wire whose source card is gone. The card SAYS it, once, and
   * never repairs the wire or invents a card.
   */
  contextMissing?: boolean;
  /**
   * STORY 17.5 — THE COMPOSED THREAD, in order: a fork's carried prefix (read
   * from the parent, never copied) and then the card's own turns. A card that
   * is not a fork is handed just its own turns, exactly as before.
   */
  turns: readonly AskTurn[];
  /**
   * How many of the leading turns are the fork's CARRIED prefix. The divider
   * sits after the last of them, and the fork verb is offered only on the
   * turns the card said itself (a carried turn belongs to the parent).
   */
  carried?: number;
  /**
   * The parent the fork names is not on the map: one quiet line replaces the
   * carried part, and the card's own turns still read and it can still send.
   */
  forkMissing?: boolean;
  /**
   * STORY 16.22 — the camera's own zoom, handed straight to the name pill so its
   * counter-scale is the card's legibility rule at any zoom. Optional: a render
   * test that only cares about the thread is at 100%, where the scale is 1.
   */
  zoom?: number;
  /**
   * STORY 16.25 — the map's ONE in-flight drag, shared with the wires. A card
   * publishes its live point here while the hand is down instead of writing
   * React state, so only the wires that touch it follow. Optional so a render
   * test needs no channel; the card then moves its own element alone.
   */
  drag?: GroundDragChannel;
  /** View state: a small card opens; an expanded card sends. */
  open: boolean;
  /** How many lines the small face crops at (the stated preference). */
  previewLines: number;
  /**
   * STORY 17.7b — WHETHER A PROVIDER/MODEL RESOLVES, read from Settings (the
   * one selection's home). `false` is the PRE-SEND state: one sentence and the
   * settings verb, and the send is not offered. `null` is not yet known (the
   * config has not answered), so nothing is claimed and the card composes as
   * usual. Absent on a render test that only cares about the thread.
   */
  hasProvider?: boolean | null;
  /**
   * STORY 17.13 — THE TWO CALLS a send will make, read from Settings (the task
   * row/model and the manager row/model, or the same one, or none). The
   * declaration names them before the send; absent on a render test that only
   * cares about the thread, and null when the config has not answered.
   */
  calls?: AskCallsFacts | null;
  /**
   * Open Settings on its Providers section — the ONE verb the pre-send state
   * offers. Optional so a render test needs no modal; the layer always passes
   * the app's real opener.
   */
  onOpenSettings?: () => void;
  onOpen: () => void;
  onClose: () => void;
  /**
   * Ask one question inside this card (the writer). Optional so a render test
   * needs no turn; the layer always passes the real write path.
   */
  onAskTurn?: (
    slug: string,
    question: string,
    onPart?: (text: string) => void,
    /** STORY 16.28 — the layer names the curator's start and end; the card
     *  sets the task phase itself at the press. */
    onPhase?: (phase: AskWorkPhase) => void,
  ) => Promise<GroundAddResult>;
  /** Stop the running turn (the existing turn port's stop). */
  onStopTurn?: () => Promise<void>;
  /**
   * STORY 17.5 — FORK this card at a turn: the writer makes the new record
   * (anchor inherited, `from`/`carry` naming the branch point) and opens it.
   * Optional so a render test needs no write path.
   */
  onForkTurn?: (carry: number, name: string) => Promise<GroundAddResult>;
  /**
   * STORY 17.10 — RENAME this card: the title pill IS the rename field. The
   * name is the person's and the slug is identity (a wire target and the
   * conversation's file name), so a rename never moves a wire. Optional so a
   * render test needs no writer.
   */
  onRename?: (name: string) => Promise<GroundAddResult>;
  /**
   * STORY 17.8 — REMOVE this ask card: immediate, with the toast's Restore as
   * the only guard (the reference card's idiom). The layer reads the record
   * line and the conversation's bytes before the unlink and writes them back
   * verbatim on Restore. Optional so a render test needs no write path.
   */
  onRemove?: () => Promise<GroundAddResult>;
  /**
   * STORY 16.23 — MOVE this card to its dropped point: ONE record line's
   * `x|y`, through the hook's one write queue. The drag itself is the SHARED
   * rule in groundDrag.ts (the same threshold and the same one write on
   * release); this prop only carries the drop to the writer. Optional so a
   * render test needs no write path.
   */
  onMove?: (x: number, y: number) => Promise<GroundAddResult>;
  /**
   * STORY 17.9 — WIRE this ask card to another card (the source side). The
   * handle is the same small edge affordance a reference card has; a release on
   * another card draws one ordered pair. Optional so a render test needs no
   * layer.
   */
  onLink?: (from: string, to: string) => Promise<GroundAddResult>;
  /**
   * STORY 16.19 — THE QUESTION A SELECTION ASKED, handed to this card by the
   * layer that just made it. The user's correction made the selection open a
   * question widget; the widget's press creates this card and hands it the
   * question, and the card's OWN send path asks it — so the reply streams where
   * every reply streams and there is no second send site. The token makes it
   * ONCE: a re-render, a reopen or a rename can never ask it again.
   */
  autoAsk?: { question: string; token: number };
  /** The token was taken: the layer forgets it, so nothing can replay it. */
  onAutoAsked?: () => void;
  /** The gesture gate, so a wiring drag never starts under an armed tool. */
  interactionMode?: GestureMode;
  /** The one sentence a wiring drag speaks; absent in a render test. */
  onNarrate?: (gesture: GestureNarration) => void;
}) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<AskPending | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  /**
   * STORY 16.28 — WHICH WAIT THE CARD IS IN (the task call, the curator call,
   * or none). VIEW STATE only: it never reaches a record. The card sets the
   * task phase at its own press; the layer reports the curator's start and end
   * through `onAskTurn`, because only the layer makes that second call.
   */
  const [phase, setPhase] = useState<AskWorkPhase>("idle");
  // STORY 17.5 — the fork's PROPOSED name before anything is written. View
  // state: cancel or Esc forgets it, and only the confirm reaches a writer.
  const [forking, setForking] = useState<{ carry: number; name: string } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  /**
   * STORY 16.27 — THE DECLARATION'S OWN DISCLOSURE. A native <details> holds
   * it and its summary IS the one quiet verb; the ref exists for the ONE other
   * way in — the retrieval verb a finished follow-up offers ("read more of
   * <name>") — so that press opens the same disclosure instead of showing a
   * second copy of the readback on the face.
   */
  const declarationRef = useRef<HTMLDetailsElement>(null);
  // Whether the body still follows the newest line. A person scrolling up
  // turns it off until they reach the bottom again (the story's rule).
  const pinnedRef = useRef(true);
  // Whether THIS turn was stopped by the person, so the partial says "stopped"
  // rather than "broke off". View state only.
  const stoppedRef = useRef(false);
  /**
   * STORY 17.3 — THE DECLARATION BEFORE THE SEND, and the readback after it.
   * The packet is assembled from the SAME inputs the send composes from (this
   * card's anchor facts, the thread in file order, the typed question), so the
   * declaration and the bytes can never say different things. `sent` is the
   * one readback: the messages that actually left, the follow-up included.
   */
  const [sent, setSent] = useState<AskPacketReadback | null>(null);
  /**
   * STORY 17.7b — WHAT THE LAST SETTLED TURN HIT (the ceiling, a missed READ),
   * or null. VIEW STATE beside `pending`: the record keeps words only, so a
   * reload starts clean and the line describes the turn the person just saw.
   */
  const [hit, setHit] = useState<GroundAddResult | null>(null);
  /**
   * STORY 17.11 — WHETHER THE TURN LEFT NO CARD, and the one line that says
   * so. VIEW STATE beside `hit`: the conversation file holds words, never a
   * card's fate, so a reload starts clean. A rule-made card never needs this
   * line; a stopped, broken, timed-out or empty turn does.
   */
  const [noCard, setNoCard] = useState<string | null>(null);
  const running = pending !== null && pending.ending === "running";
  // STORY 16.23 — THE CARD IS MOVABLE BY THE SAME ONE RULE as a reference.
  // STORY 16.25 — and like the reference card, the live frame is NOT React
  // state: the element carries the hand (`frameGroundCard`) and the point goes
  // to the wires through the shared channel. These two refs are the release's:
  // where the hand let go, and the whole-unit point the record will hold.
  const liveRef = useRef<Point | null>(null);
  const droppedRef = useRef<Point | null>(null);
  // STORY 16.19 — the selection's question is asked ONCE per token. The ref is
  // the guard: the effect below can run on every render that changes the prop,
  // and a card that is closed, reopened or renamed must never ask again.
  const autoAskedRef = useRef<number | null>(null);
  useEffect(() => {
    if (autoAsk === undefined || !open) return;
    if (autoAskedRef.current === autoAsk.token) return;
    autoAskedRef.current = autoAsk.token;
    // The token is spent whatever happens next: a replay would be a second
    // question the person never asked.
    onAutoAsked?.();
    // The words stay in the composer if the card cannot send (nothing
    // configured), so the person's question is not silently swallowed.
    setQuestion(autoAsk.question);
    if (hasProvider === false || onAskTurn === undefined) return;
    void send(autoAsk.question);
    // Mount/open only: the send is the card's own ordinary path from here.
  }, [autoAsk, open, hasProvider, onAskTurn]);
  // STORY 17.9 — the SAME assembler the hook sends: the wired cards, the
  // thread, the question. The context bound is the assembler's; the card only
  // supplies what is wired.
  const packet = assembleAskCardPacket(
    context,
    turns,
    question,
    ASK_THREAD_BOUND,
  );
  // STORY 16.26 — THE PAGES THIS QUESTION WILL OPEN when it is sent. A page
  // card keeps no transcript, so nothing about the page exists to declare yet:
  // the surface says the read will happen (and names the address), and the
  // readback below carries every block's exact size once the packet is real.
  // Nothing is fetched here, on open, on render or on type.
  // Only a card the declaration actually carries is named: the context bound
  // is the packet's own, applied here by the same pure selection, so the line
  // never promises a read for a card whose block was dropped.
  const pageUrls = [
    ...new Set(
      selectAskContextCards(context, ASK_CONTEXT_BOUND)
        .cards.map((card) => card.pageUrl)
        .filter((url): url is string => url !== undefined && url !== ""),
    ),
  ];

  // ESC CLOSES THE CARD'S EDITOR — never the map. Capture phase, so the key is
  // consumed before the plane's or app's own bubble handlers can act on it. A
  // draft writes nothing: this handler only collapses the card.
  //
  // STORY 17.5, extended by STORY 17.10: while a fork's name or the rename
  // field is open, Esc
  // forgets THAT first (one press, one thing) and a second press collapses the
  // card. STORY 17.10 removed the re-anchor chooser: there is nothing left to
  // escape from but the name field and the card itself.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // STORY 16.22 — THE NAME'S FIELD IS THE PILL'S, NOT THE CARD'S. Escape
      // while renaming forgets the draft (the pill's own handler) and must not
      // ALSO collapse the card, so a key that began inside the pill is left
      // alone here. One press, one thing.
      if ((e.target as HTMLElement | null)?.closest?.(".ground-pill")) return;
      e.preventDefault();
      e.stopPropagation();
      if (forking !== null) {
        setForking(null);
        return;
      }
      // STORY 16.27 — the card's own disclosures are natives, so Esc closes
      // the nearest OPEN one before it collapses the whole card: one press,
      // one thing, the same rule the fork's field keeps.
      const opened = cardRef.current?.querySelectorAll("details[open]");
      if (opened !== undefined && opened.length > 0) {
        opened.forEach((el) => {
          (el as HTMLDetailsElement).open = false;
        });
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose, forking]);

  // STORY 17.9 — THE WIRING HANDLE. The same raw-listener idiom the reference
  // card uses (d3-zoom stops mousedown at the plane): a press on the handle
  // starts a draw whose release names the card under the pointer. Any other
  // press is the card's own (open, drag or a verb).
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    function handleMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      if (!(e.target as HTMLElement).closest(".ground-link-handle")) return;
      e.stopPropagation();
      startGroundLinkDrag(e, ask.on, { interactionMode, onLink, onNarrate });
    }
    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  }, [ask.on, interactionMode, onLink, onNarrate]);

  /**
   * STORY 16.25 — PUT THE FRAME BACK ON THE RECORD'S OWN POINT and let the
   * wires go: for a drop that rounded onto the card's own point, a refused
   * write, or the write whose point has arrived. The map may never show a
   * position the file does not hold.
   */
  function settleFrame(): void {
    liveRef.current = null;
    droppedRef.current = null;
    settleGroundCard(cardRef.current, { x: ask.x, y: ask.y });
    drag?.publish(null);
  }

  // STORY 16.23 — THE ASK CARD MOVES BY THE SAME ONE RULE. The press reaches
  // the shared wiring (groundDrag.ts), so the threshold, the live frame and
  // the one write on release are the reference card's — there is no second
  // drag here. The name pill is a child of this card, so a press on it lands in
  // the same listener: the pill is the handle, and a press that never moves on
  // it opens nothing. STORY 16.25 — the frame is the element's and the shared
  // channel's, so a move renders nothing; the drop is still ONE write.
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    return attachGroundCardDrag(el, {
      at: () => ({ x: ask.x, y: ask.y }),
      zoom: () => zoom,
      onPreview: (at) => {
        // Null is the release's own news; the release below decides what stays.
        if (at === null) return;
        liveRef.current = at;
        frameGroundCard(el, at);
        drag?.publish({ slug: ask.on, x: at.x, y: at.y });
      },
      onMoved: () =>
        onNarrate?.({ kind: "moving", name: askDisplayName(ask.name) }),
      onDrop: (point) => {
        if (onMove === undefined) {
          settleFrame();
          return;
        }
        void onMove(point.x, point.y).then((result) => {
          // A refused write is one sentence on the card, never a point that
          // quietly snaps back for no stated reason — and the card goes back
          // to the point the record still holds.
          if (!result.ok) {
            settleFrame();
            setProblem(result.message);
          }
        });
      },
      onRelease: (moved) => {
        onNarrate?.(GESTURE_IDLE);
        if (!moved) return;
        const at = liveRef.current;
        if (at === null) return;
        // The record keeps whole units, so the frame commits to the point the
        // line will hold: the card and its wires land where they stay.
        const landed = { x: Math.round(at.x), y: Math.round(at.y) };
        if (landed.x === ask.x && landed.y === ask.y) {
          // A no-op drop writes nothing, so nothing else would release this.
          settleFrame();
          return;
        }
        droppedRef.current = landed;
        drag?.publish({ slug: ask.on, x: landed.x, y: landed.y });
      },
      isArmed: () => isGestureArmed(interactionMode),
      // The composer's field and every verb are already the helper's own
      // exclusions; an ask card has no selection surface to protect.
      onClick: (onPill) => {
        // A press on the name pill is the handle and opens nothing; a press
        // that never moved on the body is the card's door.
        if (onPill) return;
        onOpen();
      },
    });
  }, [ask.on, ask.x, ask.y, zoom, onMove, onOpen, onNarrate, interactionMode, drag]);

  /**
   * THE FRAME IS RELEASED WHEN THE RECORD CATCHES UP: the new point arrives as
   * a prop only after the queued write landed, so the card and its wires stay
   * on the dropped point instead of snapping back through the old one.
   */
  useEffect(() => {
    const dropped = droppedRef.current;
    if (dropped === null) return;
    if (ask.x !== dropped.x || ask.y !== dropped.y) return;
    settleFrame();
  }, [ask.x, ask.y]);

  // THE CARD'S WHEEL NEVER ZOOMS THE PLANE. The scrollbox (and the card) stop
  // the event where it starts; passive, because this only stops the plane and
  // never the body's own scroll.
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    function onWheel(e: WheelEvent) {
      e.stopPropagation();
    }
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Opening starts AT THE NEWEST LINE again, even if the last close left the
  // body scrolled up.
  useEffect(() => {
    if (open) pinnedRef.current = true;
  }, [open]);

  // AUTO-SCROLL TO THE NEWEST LINE unless the person scrolled up. The pending
  // answer grows on every part, so it is a dependency too.
  useEffect(() => {
    if (!open) return;
    const el = bodyRef.current;
    if (el === null || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [open, turns.length, pending?.question, pending?.answer, phase]);

  function trackScroll(): void {
    const el = bodyRef.current;
    if (el === null) return;
    pinnedRef.current = askAtBottom(
      el.scrollTop,
      el.clientHeight,
      el.scrollHeight,
    );
  }

  async function send(askedOverride?: string): Promise<void> {
    if (running || onAskTurn === undefined) return;
    // STORY 16.19: a selection's ask hands its words in directly (the composer
    // may not have painted them yet); every other send reads the field.
    const asked = askedOverride ?? question;
    if (asked.trim() === "") {
      setProblem(ASK_QUESTION_REFUSAL);
      return;
    }
    setProblem(null);
    // A new turn has its own facts; the last turn's lines go with it.
    setHit(null);
    setNoCard(null);
    setStopping(false);
    stoppedRef.current = false;
    // The person's line is shown at once as the pending question; the writer
    // appends the verbatim words only when the turn settles.
    setPending(askSendPending(asked));
    // The press is the first wait's own fact: the task call starts now.
    setPhase("task");
    setQuestion("");
    // The bytes about to leave stay openable while they leave. The turn's own
    // readback replaces them when it settles — including a follow-up's message,
    // so the verb never claims less than what left.
    if (packet !== null) setSent({ messages: packet.messages, read: null });
    const result = await onAskTurn(ask.on, asked, (text) => {
      // The first part is real text: `askWorkingLine` drops the line by
      // itself, so no phase is forced on the stream.
      setPending((current) => askPartPending(current, text));
    },
      // The layer speaks only for the curator; a phase it never names stays
      // whatever the send set.
      (next) => setPhase(next));
    // The turn is over: no wait is running, so no line is owed.
    setPhase("idle");
    setStopping(false);
    setPending((current) => askSettlePending(current, result.ok, stoppedRef.current));
    // STORY 17.7b: the turn's hit facts are the card's quiet lines; a clean
    // turn hands over nulls and the component draws nothing.
    setHit(result);
    // STORY 17.11 — A TURN THAT MADE NO CARD SAYS SO in one line (ADR-0037
    // decision 8: the reply, when there was one, still stands above).
    setNoCard(result.noCard ?? null);
    if (result.readback !== undefined) setSent(result.readback);
    if (!result.ok) setProblem(result.message);
  }

  /**
   * START A FORK at the turn the person pressed (story 17.5): propose the
   * name, write nothing. `carry` is the WHOLE turns up to and including this
   * one, counted on the card's OWN turns — a carried turn is the parent's and
   * has no fork verb, so a fork of a fork carries only the second card's words
   * (one level, stated in map/asks.ts).
   */
  function startFork(carry: number): void {
    if (busy || running || onForkTurn === undefined) return;
    setForking({ carry, name: proposeForkName(ask.name) });
    setProblem(null);
  }

  function cancelFork(): void {
    setForking(null);
  }

  /** CONFIRM the fork: the ONE write, then the layer opens the new card. */
  async function makeFork(): Promise<void> {
    if (forking === null || onForkTurn === undefined || busy) return;
    const refusal = askRefusal(forking.name);
    if (refusal !== null) {
      setProblem(refusal);
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await onForkTurn(forking.carry, forking.name.trim());
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setForking(null);
  }

  /**
   * STORY 17.10 (the addendum) — THE RE-ANCHOR VERB IS GONE. It survived 17.9
   * as a verb that changed nothing a turn sends, and a verb that does nothing
   * is worse than no verb. The anchor field remains DISPLAY-ONLY legacy on old
   * records; context arrives by wire. Reachability is unchanged: the reference
   * card's own verb makes an empty ask and wires it.
   */

  /**
   * STORY 17.8 — remove is IMMEDIATE (16.13's rule): one press, no confirming
   * step. A refusal that kept the card shows its one sentence here; the
   * refused-unlink sentence is the layer's, because the card is gone with its
   * records. A running turn is never cut by a delete — the verb waits.
   */
  async function removeCard(): Promise<void> {
    if (busy || running || onRemove === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onRemove();
    if (!result.ok && result.recordsRemoved !== true) {
      setBusy(false);
      setProblem(result.message);
    }
  }

  async function stop(): Promise<void> {
    if (!running || stopping || onStopTurn === undefined) return;
    stoppedRef.current = true;
    setStopping(true);
    try {
      await onStopTurn();
    } catch {
      // The turn's own line settles it; a stop that cannot reach the provider
      // leaves the turn to its existing timeout.
    }
    // The stop stays pressed until the turn's own line settles the pending
    // line (the same idiom the Ask Move uses): no second stop is sent.
  }

  /**
   * STORY 16.27 — THE DECLARATION'S OTHER DOOR. The retrieval verb opens the
   * SAME disclosure the summary opens; it never draws a second readback.
   */
  function openDeclaration(): void {
    const el = declarationRef.current;
    if (el !== null) el.open = true;
  }

  /**
   * STORY 16.27 — THE ONE OVERFLOW VERB. The footer keeps the primary action
   * (send, or stop while a turn runs) and this; fork, remove and close live one
   * press in, in a native disclosure, so the face is not a row of verbs and
   * every verb the card had is still here. The overflow's fork branches at the
   * END of the card's own conversation; the per-turn verb still sits with a
   * chosen turn (revealed on hover, never drawn on every line by default).
   */
  function overflowVerbs() {
    return (
      <details className="ask-card-overflow">
        <summary
          className="ask-card-overflow-verb"
          title="fork, remove or close this card"
        >
          {ASK_OVERFLOW_VERB}
        </summary>
        <div className="ask-card-overflow-body">
          {onForkTurn !== undefined && (
            <button
              type="button"
              className="ask-card-overflow-fork"
              disabled={busy || running || ownTurns === 0}
              title={
                ownTurns === 0
                  ? "there is no turn to fork yet"
                  : "fork this card at its end"
              }
              onClick={() => startFork(ownTurns)}
            >
              {ASK_OVERFLOW_FORK}
            </button>
          )}
          {onRemove !== undefined && (
            <button
              type="button"
              className="ask-card-remove"
              disabled={busy || running}
              onClick={() => void removeCard()}
            >
              {ASK_OVERFLOW_REMOVE}
            </button>
          )}
          <button type="button" className="ask-card-close" onClick={onClose}>
            {ASK_OVERFLOW_CLOSE}
          </button>
        </div>
      </details>
    );
  }

  const recorded = askPendingInRecord(turns, pending);
  // STORY 16.28 — the one line the running turn owes, or null when the text has
  // already taken over (or nothing is running).
  const workingLine = askWorkingLine(pending, phase);
  const pendingQuestion =
    pending !== null && pending.question !== "" && !recorded.question
      ? { role: "person" as const, text: pending.question, t: "" }
      : null;
  const pendingAnswer =
    pending !== null && pending.answer !== "" && !recorded.answer
      ? { role: "answer" as const, text: pending.answer, t: "", ending: pending.ending }
      : null;

  // STORY 17.5 — HOW MUCH OF THE COMPOSED THREAD IS THE CARRIED PREFIX. A
  // non-fork is handed 0, so the divider and the fork's own-turn rule cost it
  // nothing. Clamped to the array in hand: a record's count is read, not
  // trusted to be larger than the parent's file.
  const carriedCount = Math.max(0, Math.min(carried, turns.length));
  // STORY 16.27 — HOW MANY TURNS ARE THIS CARD'S OWN. The overflow's fork
  // branches at the END of the card's own conversation (it carries every own
  // turn); the per-turn verb still sits with a chosen turn, now revealed on
  // hover rather than drawn on every line.
  const ownTurns = Math.max(0, turns.length - carriedCount);

  // The small face's ONE turn: the newest thing said — a pending answer, else a
  // pending question, else the record's last line. Never the first line, and
  // never a count.
  const lastRecorded = askLastTurn(turns);
  const smallTurn: AskTurn | null =
    pendingAnswer !== null
      ? { role: "answer", text: pendingAnswer.text, t: "" }
      : pendingQuestion !== null
        ? pendingQuestion
        : lastRecorded;
  const smallEnding =
    pendingAnswer !== null
      ? pendingAnswer.ending
      : pendingQuestion !== null && pending !== null
        ? pending.ending
        : undefined;
  const smallFolded =
    !open && smallTurn !== null && previewOverflows(smallTurn.text, previewLines);

  return (
    <div
      ref={cardRef}
      className={`ask-card${open ? " expanded" : ""}`}
      style={
        {
          // STORY 16.25: the RECORD's point is what React renders; the hand's
          // own frame is written on the element, so a drag re-renders nothing.
          left: ask.x,
          top: ask.y,
          "--preview-lines": previewLines,
        } as CSSProperties
      }
      data-slug={ask.on}
    >
      {/* STORY 16.22 — THE NAME FLOATS ABOVE THE ASK CARD, in the SAME pill the
          reference cards wear (one component, one counter-scale, one rename
          field). The name left the card's body because the body's own thread
          cropped it and the plane's scale shrank it; the pill is legible at any
          zoom and is this card's one place a name changes. The card's OWN name
          rules ride in (ASK_PILL_RULES): a blank field is a REFUSAL here, so no
          placeholder is ever stored. */}
      <CardNamePill
        name={ask.name}
        zoom={zoom}
        busy={busy}
        rules={ASK_PILL_RULES}
        renameLabel="rename this ask card"
        onRename={
          onRename === undefined
            ? undefined
            : async (name: string) => {
                const result = await onRename(name);
                // A refused write is one sentence on the card, never a name that
                // quietly snaps back for no stated reason.
                if (!result.ok) setProblem(result.message);
                return result;
              }
        }
      />
      {/* STORY 17.6 — WHEN THE ANCHOR IS GONE the second line STATES it: the
          name the record remembered, and that the card is gone. It clears by
          itself when the anchor resolves again (the deleted card's own
          Restore) — a consequence of the field, never a repair. STORY 17.10
          keeps this sentence: it is still true of an old record. */}
      <div className="ask-card-kind">
        {/* STORY 17.10 — AN ABSENT ANCHOR IS NOT A DANGLING ONE. A peer ask
            says what it is; a legacy card with an anchor still says what it was
            about, or states the dangling sentence (17.6, kept). */}
        {ask.anchor === undefined
          ? ASK_PEER_LINE
          : anchorName === null
            ? askDanglingLine(ask.anchorName ?? null)
            : askKindLine(anchorName)}
      </div>
      {/* STORY 17.9 — WHAT THIS CARD HAS WIRED INTO IT. STORY 16.27 keeps it as
          ONE short line above the thread (the face) and moves the FULL list into
          the declaration, where the same press that shows the bytes shows every
          wire. The line truncates; nothing is dropped, only shortened. A gone
          wire is still SAID here (it is news when it happens), once, never
          repaired. When nothing is wired the face says nothing at all — the one
          quiet sentence lives in the declaration with the rest of the list. */}
      {open && (context.length > 0 || contextMissing) && (
        <div className="ask-card-context">
          {context.length > 0 && (
            <div className="ask-card-context-line">
              {ASK_CONTEXT_LABEL}
              {context.map((card) => card.name).join(" · ")}
            </div>
          )}
          {contextMissing && (
            <div className="ask-card-context-missing">
              {ASK_CONTEXT_DANGLING}
            </div>
          )}
        </div>
      )}
      {/* STORY 17.9 — THE WIRING HANDLE: an ask card is wired INTO, and may
          also be a wire's source (an ask's answer is context for another ask). */}
      {onLink !== undefined && (
        <button
          type="button"
          className="ground-link-handle"
          title="wire this card to another"
          aria-label="wire this card to another"
        />
      )}
      <div className="ask-card-body" ref={bodyRef} onScroll={trackScroll}>
        {open ? (
          <div className="ask-card-thread">
            {/* STORY 17.5 — THE FORK'S THREAD: the carried prefix first, one
                quiet divider, then the card's own turns. A missing parent
                replaces the carried part with ONE stated line (never repaired,
                never an error) and the own turns read under it. */}
            {forkMissing && (
              <div className="ask-fork-missing">{ASK_FORK_MISSING}</div>
            )}
            {turns.map((turn, index) => {
              // The turn's position among the card's OWN turns: a carried turn
              // belongs to the parent, so it has no fork verb and never counts
              // toward a fork's `carry`.
              const ownIndex = index - carriedCount;
              return (
                <div key={index} className="ask-turn-cell">
                  <AskTurnLine
                    turn={turn}
                    onFork={
                      onForkTurn !== undefined && ownIndex >= 0 && !running
                        ? () => startFork(ownIndex + 1)
                        : undefined
                    }
                  />
                  {carriedCount > 0 && index === carriedCount - 1 && (
                    <div className="ask-fork-divider">{ASK_FORK_DIVIDER}</div>
                  )}
                  {forking !== null && forking.carry === ownIndex + 1 && (
                    <div
                      className="ask-card-fork"
                      role="group"
                      aria-label="name the fork"
                    >
                      <input
                        className="ask-card-fork-name"
                        value={forking.name}
                        autoFocus
                        aria-label="name the fork"
                        disabled={busy}
                        onChange={(e) => {
                          setForking({ carry: forking.carry, name: e.target.value });
                          if (problem !== null) setProblem(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key !== "Enter") return;
                          e.preventDefault();
                          void makeFork();
                        }}
                      />
                      <div className="ask-card-fork-actions">
                        <button
                          type="button"
                          className="ask-card-fork-make"
                          disabled={busy}
                          onClick={() => void makeFork()}
                        >
                          make the card
                        </button>
                        <button
                          type="button"
                          className="ask-card-fork-cancel"
                          disabled={busy}
                          onClick={cancelFork}
                        >
                          cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {pendingQuestion !== null && (
              <AskTurnLine turn={pendingQuestion} />
            )}
            {pendingAnswer !== null && (
              <div aria-live="polite">
                <AskTurnLine
                  turn={pendingAnswer}
                  ending={pendingAnswer.ending}
                />
              </div>
            )}
            {/* STORY 16.28 — THE QUIET WORKING LINE. It sits where the answer
                will be (or under the finished answer while the curator
                distils) and is replaced the instant real text arrives: the
                text IS the indicator. The line itself never animates; the
                marker is the only thing that breathes, and reduce motion
                draws it static (canvas.css). */}
            {workingLine !== null && <AskWorkingLine line={workingLine} />}

          </div>
        ) : smallTurn === null ? (
          <div className="ask-card-empty">{ASK_EMPTY_SENTENCE}</div>
        ) : (
          <div className="ask-card-thread">
            <AskTurnLine
              turn={smallTurn}
              crop={previewLines}
              ending={smallEnding}
            />
          </div>
        )}
        {/* THE FOLD (story 17's type system): a small face with more than its
            stated lines ends in the soft fade and the one quiet "more" verb.
            The button's press opens the card; it is never a number. */}
        {smallFolded && (
          <div className="ground-fold">
            <div className="ground-fade" aria-hidden="true" />
            <button
              type="button"
              className="ground-more"
              title="open the card"
              onClick={onOpen}
            >
              more
            </button>
          </div>
        )}
      </div>
      {/* STORY 16.27 — THE HONEST SENTENCES STAND OUTSIDE THE THREAD. Story
          17.7b's two facts and 17.11's no-card line describe the turn that just
          happened; they now sit between the thread and the composer instead of
          in the place the reader expects the next message. They still appear
          ONLY when they happen — a clean turn renders nothing — and never
          pre-emptively. Two quiet lines, the existing sentences, no counts. */}
      {open && hit !== null && <AskTurnFactsLine result={hit} />}
      {open && noCard !== null && <AskNoCardLine line={noCard} />}
      {problem !== null && (
        <div className="ask-card-problem" role="status">
          {problem}
        </div>
      )}
      {open && (
        <div className="ask-card-ask">
          {/* STORY 17.7b — NOTHING CONFIGURED, SAID BEFORE THE SEND. One
              sentence (the SAME one a failed send shows, PROVIDER_SENTENCES.
              nothing) and one verb to Settings; no question box and no send.
              The selector this replaced is gone by design — one selection
              lives in Settings (story 17.7). */}
          {hasProvider === false ? (
            <div className="ask-unconfigured">
              <div className="ask-fallback">{PROVIDER_SENTENCES.nothing}</div>
              <div className="ask-card-actions">
                {onOpenSettings !== undefined && (
                  <button
                    type="button"
                    className="ask-configure"
                    onClick={onOpenSettings}
                  >
                    open settings
                  </button>
                )}
                {overflowVerbs()}
              </div>
            </div>
          ) : (
            <>
              <textarea
                className="ask-card-question"
                value={question}
                placeholder="your question"
                autoFocus
                disabled={running}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  if (problem !== null) setProblem(null);
                  // A new question is a NEW packet: the old readback no longer
                  // describes what would leave, so the declaration takes over.
                  if (sent !== null) setSent(null);
                }}
                onKeyDown={(e) => {
                  if (e.key !== "Enter" || e.shiftKey) return;
                  e.preventDefault();
                  void send();
                }}
              />
              {/* STORY 16.27 — THE DECLARATION IS ONE QUIET VERB AWAY. It is
                  the SAME shared PacketSurface as before (every block and its
                  exact size, both calls, the live page line, the exact-bytes
                  reader), simply not on the face: a native disclosure, closed
                  by default, opened by the person and never by a send. The full
                  wired-in list sits behind the same verb — the face keeps only
                  its one truncated line. */}
              <details className="ask-card-declaration" ref={declarationRef}>
                <summary className="ask-card-declaration-verb">
                  {sent === null ? ASK_DECLARATION_VERB : ASK_DECLARATION_VERB_SENT}
                </summary>
                <div className="ask-card-declaration-body">
                  {context.length > 0 ? (
                    <div className="ask-card-context-full">
                      {context.map((card, index) => (
                        <div key={index}>{card.name}</div>
                      ))}
                    </div>
                  ) : contextMissing ? null : (
                    <div className="ask-card-context-line quiet">
                      {ASK_CONTEXT_EMPTY}
                    </div>
                  )}
                  {sent === null
                    ? packet !== null && (
                        <PacketSurface
                          declaration={packet.declaration}
                          livePages={pageUrls}
                          calls={calls}
                          messages={packet.messages}
                        />
                      )
                    : (
                        <PacketSurface
                          declaration={sent.declaration ?? null}
                          messages={sent.messages}
                          read={sent.read}
                        />
                      )}
                </div>
              </details>
              {/* STORY 16.27 — THE RETRIEVAL OFFER IS A VERB. When the turn's
                  one follow-up brought a block, its sentence stays in the
                  declaration's readback and the face offers the act: press it
                  and the same disclosure opens on what came back. No `READ:`
                  line and no size on the face. */}
              {sent !== null && sent.read !== null && (
                <button
                  type="button"
                  className="ask-card-read-more"
                  title="read what the follow-up brought"
                  onClick={openDeclaration}
                >
                  {askReadMoreWords(sent.read)}
                </button>
              )}
              <div className="ask-card-actions">
                <button
                  type="button"
                  className="ask-card-send"
                  disabled={running}
                  onClick={() => void send()}
                >
                  send
                </button>
                {running && (
                  <button
                    type="button"
                    className="ask-card-stop"
                    disabled={stopping}
                    onClick={() => void stop()}
                  >
                    stop
                  </button>
                )}
                {/* STORY 16.27 — every other verb (fork, remove, close) is
                    behind the one overflow summary, so the footer reads as the
                    primary action and one quiet word. */}
                {overflowVerbs()}
              </div>
            </>
          )}
        </div>
      )}
      {!open && (
        <div className="ask-card-footer">
          <button
            type="button"
            className="ask-card-open"
            onClick={onOpen}
          >
            open
          </button>
        </div>
      )}
    </div>
  );
}
