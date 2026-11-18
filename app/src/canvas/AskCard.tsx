import { useEffect, useRef, useState, type CSSProperties } from "react";
import {
  ASK_QUESTION_REFUSAL,
  askLastTurn,
  askRoleMark,
  type AskCard as AskCardRecord,
  type AskTurn,
} from "../map/asks";
import { previewOverflows, previewText } from "../map/readings";
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
 * WHAT IT SENDS is the existing card-ask packet anchored on the REFERENCE, not
 * on the ask card: the same packet, the same provider rows, the same streaming.
 * Story 17.3 owns the thread's bound in the packet; nothing here changes it.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the card's size, the crop, the
 * scrollbox height and slack, the role marks and the stopped/incomplete wording.
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
}: {
  turn: AskTurn;
  /** The small face's stated count; the expanded face omits it. */
  crop?: number;
  /** A pending line's ending, for the stopped/broken mark. */
  ending?: AskEnding;
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
    </div>
  );
}

export function AskCard({
  ask,
  anchorName,
  turns,
  open,
  previewLines,
  onOpen,
  onClose,
  onAskTurn,
  onStopTurn,
}: {
  ask: AskCardRecord;
  /** The anchored reference's coined name, or null when the anchor is gone. */
  anchorName: string | null;
  /** The card's conversation, in FILE ORDER (an absent file is empty). */
  turns: readonly AskTurn[];
  /** View state: a small card opens; an expanded card sends. */
  open: boolean;
  /** How many lines the small face crops at (the stated preference). */
  previewLines: number;
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
}) {
  const [question, setQuestion] = useState("");
  const [pending, setPending] = useState<AskPending | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [stopping, setStopping] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Whether the body still follows the newest line. A person scrolling up
  // turns it off until they reach the bottom again (the story's rule).
  const pinnedRef = useRef(true);
  // Whether THIS turn was stopped by the person, so the partial says "stopped"
  // rather than "broke off". View state only.
  const stoppedRef = useRef(false);
  const running = pending !== null && pending.ending === "running";

  // ESC CLOSES THE CARD'S EDITOR — never the map. Capture phase, so the key is
  // consumed before the plane's or app's own bubble handlers can act on it. A
  // draft writes nothing: this handler only collapses the card.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose]);

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
    setStopping(false);
    stoppedRef.current = false;
    // The person's line is shown at once as the pending question; the writer
    // appends the verbatim words only when the turn settles.
    setPending(askSendPending(asked));
    setQuestion("");
    const result = await onAskTurn(ask.on, asked, (text) => {
      setPending((current) => askPartPending(current, text));
    });
    setStopping(false);
    setPending((current) => askSettlePending(current, result.ok, stoppedRef.current));
    if (!result.ok) setProblem(result.message);
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
    // line (the same idiom the embedded panel uses): no second stop is sent.
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
      <div className="ask-card-kind">{askKindLine(anchorName)}</div>
      <div className="ask-card-body" ref={bodyRef} onScroll={trackScroll}>
        {open ? (
          <div className="ask-card-thread">
            {turns.map((turn, index) => (
              <AskTurnLine key={index} turn={turn} />
            ))}
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
          <textarea
            className="ask-card-question"
            value={question}
            placeholder="your question"
            autoFocus
            disabled={running}
            onChange={(e) => {
              setQuestion(e.target.value);
              if (problem !== null) setProblem(null);
            }}
            onKeyDown={(e) => {
              if (e.key !== "Enter" || e.shiftKey) return;
              e.preventDefault();
              void send();
            }}
          />
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
            <button
              type="button"
              className="ask-card-close"
              onClick={onClose}
            >
              close
            </button>
          </div>
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
