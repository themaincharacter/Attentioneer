import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ASK_QUESTION_REFUSAL,
  ASK_THREAD_BOUND,
  askLastTurn,
  askRefusal,
  askRoleMark,
  proposeForkName,
  type AskCard as AskCardRecord,
  type AskTurn,
} from "../map/asks";
import { assembleAskCardPacket, type AskPacketCard, type AskPacketReadback } from "../turn/packet";
import { ASK_READ_MISSED } from "./contactRules";
import { previewOverflows, previewText } from "../map/readings";
import { PacketSurface } from "./PacketSurface";
import { STEP_LIMIT_SENTENCE } from "../turn/steps";
import { PROVIDER_SENTENCES } from "../turn/providers";
import type { GroundAddResult } from "./useGround";

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
 * ESC CLOSES THE CARD'S EDITOR (collapses), never the map: the capture listener
 * stops the key before the plane's handlers see it. A half-typed question stays
 * in the input while the card stays mounted and a draft writes NOTHING — only
 * send reaches the writer.
 *
 * The card's wheel never zooms the plane: the scrollbox stops the event where
 * it starts, so the body scrolls and the camera stands still.
 *
 * WHAT IT SENDS (story 17.3) is the packet assembled around the ANCHORED
 * reference AND this card's conversation: the card's blocks as before, then the
 * most recent whole turns under a stated bound, then the instruction and the
 * bound. Before the send the card DECLARES every block with its exact size and
 * opens the exact bytes through the shared PacketSurface — the same verb the
 * Ask Move uses; after it, the same surface opens what left. The bound's
 * numbers live in map/asks.ts; this file only passes them and draws what the
 * packet declares.
 *
 * A DANGLING ANCHOR IS SAID, NOT REPAIRED (story 17.6). When the anchored
 * reference is gone the card's second line states what it was about — by the
 * name the RECORD remembered when the person bound it — and that the card is
 * gone. The thread still reads top to bottom and still sends (the packet
 * records the null inclusion); re-anchoring, or restoring the deleted card,
 * clears the sentence because the anchor resolves again. THE THREAD IS NEVER
 * TOUCHED: no turn is rewritten, truncated or deleted, and no ask is merged or
 * moved to a "close" card.
 *
 * A FORK IS A BRANCH, NOT A DUPLICATE (story 17.5). The `fork` verb sits WITH
 * a turn: it branches the conversation there and writes a new card that
 * REFERENCES the parent's first n turns and inherits its anchor. This component
 * never copies them — the layer hands it the COMPOSED thread (carried prefix
 * read from the parent, then the card's own turns), `carried` says where the
 * branch point sits, and one quiet divider marks it. A parent that is gone
 * replaces the carried part with one stated line and the own turns still read
 * and still send. The re-anchor verb changes ONE field: the next turn is about
 * the reference the person chose.
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
 * PROVISIONAL (ADR-0003's rendering seam): the card's size, the crop, the
 * scrollbox height and slack, the role marks, the stopped/incomplete wording,
 * story 17.5's divider and missing-parent lines and the fork/re-anchor
 * chooser's look, story 17.6's dangling sentence, its wording and its place
 * on the "what this is" line, and story 17.7b's fact lines' placement and the
 * pre-send state's wording (the sentence is reused, not new).
 */

/** The quiet line an ask card with no turns shows (PROVISIONAL wording). */
export const ASK_EMPTY_SENTENCE = "no question asked yet";

/** What a stopped turn's partial says (PROVISIONAL wording, story 7's idiom). */
export const ASK_STOPPED_MARK = " — stopped mid-answer";

/** What a broken-off turn's partial says (PROVISIONAL wording). */
export const ASK_INCOMPLETE_MARK = " — the answer broke off";

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
 * state, no red, no modal, no verb: re-anchoring is the person's act and lives
 * with the card's other verbs. A card recorded before the name was remembered
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
  anchor,
  turns,
  carried = 0,
  forkMissing = false,
  anchorChoices,
  open,
  previewLines,
  hasProvider,
  onOpenSettings,
  onOpen,
  onClose,
  onAskTurn,
  onStopTurn,
  onForkTurn,
  onReanchor,
  onRemove,
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
   * STORY 17.3 — the anchored card's block facts, ALREADY CROPPED (name, state,
   * reading crop, note crop): the same block the card ask sends today. Optional
   * so a render test that does not care about the declaration needs nothing;
   * the layer always passes it, dangling anchor included (the slug then stands
   * in the name and no preview rides).
   */
  anchor?: AskPacketCard;
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
  /** The references a re-anchor may choose (slug and the person's name). */
  anchorChoices?: readonly { slug: string; name: string }[];
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
   * STORY 17.5 — RE-ANCHOR this card: one field's change, written once. The
   * chooser offers the map's references; a target that is gone is refused by
   * the writer's one sentence.
   */
  onReanchor?: (anchor: string) => Promise<GroundAddResult>;
  /**
   * STORY 17.8 — REMOVE this ask card: immediate, with the toast's Restore as
   * the only guard (the reference card's idiom). The layer reads the record
   * line and the conversation's bytes before the unlink and writes them back
   * verbatim on Restore. Optional so a render test needs no write path.
   */
  onRemove?: () => Promise<GroundAddResult>;
}) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<AskPending | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  // STORY 17.5 — the fork's PROPOSED name before anything is written, and the
  // re-anchor chooser's pick. Both are view state: cancel or Esc forgets them,
  // and only the confirm reaches a writer.
  const [forking, setForking] = useState<{ carry: number; name: string } | null>(
    null,
  );
  const [reanchorTo, setReanchorTo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
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
  const running = pending !== null && pending.ending === "running";
  const packet =
    anchor === undefined
      ? null
      : assembleAskCardPacket(anchor, turns, question, ASK_THREAD_BOUND);

  // ESC CLOSES THE CARD'S EDITOR — never the map. Capture phase, so the key is
  // consumed before the plane's or app's own bubble handlers can act on it. A
  // draft writes nothing: this handler only collapses the card.
  //
  // STORY 17.5: while a fork's name or a re-anchor's pick is open, Esc forgets
  // THAT first (one press, one thing) and a second press collapses the card.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (forking !== null) {
        setForking(null);
        return;
      }
      if (reanchorTo !== null) {
        setReanchorTo(null);
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose, forking, reanchorTo]);

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
  }, [open, turns.length, pending?.question, pending?.answer]);

  function trackScroll(): void {
    const el = bodyRef.current;
    if (el === null) return;
    pinnedRef.current = askAtBottom(
      el.scrollTop,
      el.clientHeight,
      el.scrollHeight,
    );
  }

  async function send(): Promise<void> {
    if (running || onAskTurn === undefined) return;
    if (question.trim() === "") {
      setProblem(ASK_QUESTION_REFUSAL);
      return;
    }
    const asked = question;
    setProblem(null);
    // A new turn has its own facts; the last turn's line goes with it.
    setHit(null);
    setStopping(false);
    stoppedRef.current = false;
    // The person's line is shown at once as the pending question; the writer
    // appends the verbatim words only when the turn settles.
    setPending(askSendPending(asked));
    setQuestion("");
    // The bytes about to leave stay openable while they leave. The turn's own
    // readback replaces them when it settles — including a follow-up's message,
    // so the verb never claims less than what left.
    if (packet !== null) setSent({ messages: packet.messages, read: null });
    const result = await onAskTurn(ask.on, asked, (text) => {
      setPending((current) => askPartPending(current, text));
    });
    setStopping(false);
    setPending((current) => askSettlePending(current, result.ok, stoppedRef.current));
    // STORY 17.7b: the turn's hit facts are the card's quiet lines; a clean
    // turn hands over nulls and the component draws nothing.
    setHit(result);
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
    setReanchorTo(null);
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
   * START A RE-ANCHOR (story 17.5): offer the map's references, the current
   * anchor preselected when it is still there. Nothing is written until the
   * confirm, and the pick is view state only.
   */
  function startReanchor(): void {
    if (busy || running || onReanchor === undefined) return;
    const choices = anchorChoices ?? [];
    if (choices.length === 0) return;
    const current = choices.find((choice) => choice.slug === ask.anchor);
    setForking(null);
    setReanchorTo(current?.slug ?? choices[0]!.slug);
    setProblem(null);
  }

  /** CONFIRM the re-anchor: ONE field's change. A gone target answers one sentence. */
  async function makeReanchor(): Promise<void> {
    if (reanchorTo === null || onReanchor === undefined || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await onReanchor(reanchorTo);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setReanchorTo(null);
  }

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

  const recorded = askPendingInRecord(turns, pending);
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
          left: ask.x,
          top: ask.y,
          "--preview-lines": previewLines,
        } as CSSProperties
      }
      data-slug={ask.on}
      onClick={open ? undefined : onOpen}
    >
      <div className="ask-card-name">{ask.name}</div>
      {/* STORY 17.6 — WHEN THE ANCHOR IS GONE the second line STATES it: the
          name the record remembered, and that the card is gone. It clears by
          itself when the anchor resolves again (a re-anchor, or the deleted
          card's own Restore) — a consequence of the field, never a repair. */}
      <div className="ask-card-kind">
        {anchorName === null
          ? askDanglingLine(ask.anchorName ?? null)
          : askKindLine(anchorName)}
      </div>
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
            {/* STORY 17.7b — WHAT THE TURN HIT, beside the turn it belongs to:
                one quiet line each, the existing sentences, no count. */}
            {hit !== null && <AskTurnFactsLine result={hit} />}
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
            <>
              <div className="ask-unconfigured">
                <div className="ask-fallback">{PROVIDER_SENTENCES.nothing}</div>
                {onOpenSettings !== undefined && (
                  <div className="ask-card-actions">
                    <button
                      type="button"
                      className="ask-configure"
                      onClick={onOpenSettings}
                    >
                      open settings
                    </button>
                  </div>
                )}
              </div>
              <div className="ask-card-actions">
                <button
                  type="button"
                  className="ask-card-close"
                  onClick={onClose}
                >
                  close
                </button>
              </div>
            </>
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
              {/* THE DECLARATION AND THE READBACK, the shared PacketSurface: before
                  the send every block with its exact size and the total, then one
                  verb that opens the bytes; after it, what actually left. The
                  anchored card's crops and the thread are already here, so nothing
                  is read to declare this. */}
              {sent === null ? (
                packet !== null && (
                  <PacketSurface
                    declaration={packet.declaration}
                    messages={packet.messages}
                  />
                )
              ) : (
                <PacketSurface messages={sent.messages} read={sent.read} />
              )}
              {/* STORY 17.5 — RE-ANCHOR is a verb on the expanded card: it changes
                  ONE field, so the next turn is about the newly chosen reference.
                  The chooser is the map's own card list; a choice that is already
                  gone is refused by the writer's one sentence, never repaired. */}
              {onReanchor !== undefined && (
                <div className="ask-card-reanchor-row">
                  {reanchorTo === null ? (
                    <button
                      type="button"
                      className="ask-card-reanchor"
                      disabled={
                        busy || running || (anchorChoices?.length ?? 0) === 0
                      }
                      onClick={startReanchor}
                    >
                      re-anchor
                    </button>
                  ) : (
                    <>
                      <select
                        className="ask-card-reanchor-pick"
                        aria-label="anchor this card to"
                        value={reanchorTo}
                        disabled={busy}
                        onChange={(e) => setReanchorTo(e.target.value)}
                      >
                        {(anchorChoices ?? []).map((choice) => (
                          <option key={choice.slug} value={choice.slug}>
                            {choice.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="ask-card-reanchor-make"
                        disabled={busy}
                        onClick={() => void makeReanchor()}
                      >
                        make it about this
                      </button>
                      <button
                        type="button"
                        className="ask-card-reanchor-cancel"
                        disabled={busy}
                        onClick={() => setReanchorTo(null)}
                      >
                        cancel
                      </button>
                    </>
                  )}
                </div>
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
                {/* STORY 17.8 — the card's remove, beside close: immediate,
                    reversible through the one toast. While a turn runs there is
                    nothing to remove yet (the words are still arriving). */}
                {onRemove !== undefined && (
                  <button
                    type="button"
                    className="ask-card-remove"
                    disabled={busy || running}
                    onClick={() => void removeCard()}
                  >
                    remove
                  </button>
                )}
                <button
                  type="button"
                  className="ask-card-close"
                  onClick={onClose}
                >
                  close
                </button>
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
