import { useState, type CSSProperties } from "react";
import {
  ASK_QUESTION_REFUSAL,
  askExchangeText,
  type AskCard as AskCardRecord,
  type AskTurn,
} from "../map/asks";
import { previewText } from "../map/readings";
import type { GroundAddResult } from "./useGround";

/**
 * THE ASK CARD (Epic 17 story 1) — a reference card's `ask about this` makes a
 * card BESIDE it, and one question is asked and answered INSIDE it.
 *
 * It renders from the SAME grammar as a reference card — name, what this is,
 * the crop — so the map stays one surface: the name is the person's, the second
 * line says "a question about <the reference's name>", and the body is the
 * conversation. Story 1 shows ONE exchange; story 17.2 owns the real thread
 * (newest at the bottom, an editor of its own, Esc closing the editor).
 *
 * THE CONVERSATION IS THE RECORD, NOT THIS COMPONENT. The turns arrive as a
 * prop, read at load from `map/asks/<slug>.jsonl`; the small face CROPS that
 * conversation at the person's stated count (the same pure `previewText`
 * helper the reference card uses), and the expanded face shows it whole. The
 * send hands the question to `useGround.askTurn`, which is the ONLY writer:
 * the person's line always, the answer line only when the turn answered. A
 * failed or stopped turn leaves the person's line and says ONE sentence here —
 * no partial is ever dressed as an answer (story 17.4 owns PRISM and that
 * rule's record).
 *
 * WHAT IT SENDS is the existing card-ask packet anchored on the REFERENCE, not
 * on the ask card: the same packet, the same provider rows, the same streaming.
 * Story 17.3 owns the thread's bound in the packet; nothing here changes it.
 *
 * NOTHING HERE COUNTS: no turn total, no token meter, no timestamp ticker — the
 * card shows its exchange and nothing about how many there are.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the card's dimensions, the crop, the
 * "no question asked yet" line and the send/close verbs.
 */

/** The quiet line an ask card with no turns shows (PROVISIONAL wording). */
export const ASK_EMPTY_SENTENCE = "no question asked yet";

/** What this ask is about, as the card's second line (PURE, PROVISIONAL). */
export function askKindLine(anchorName: string | null): string {
  return "a question about " + (anchorName === null ? "a card that is not here" : anchorName);
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
}: {
  ask: AskCardRecord;
  /** The anchored reference's coined name, or null when the anchor is gone. */
  anchorName: string | null;
  /** The card's conversation, in order (an absent file is an empty list). */
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
}) {
  const [question, setQuestion] = useState("");
  const [running, setRunning] = useState(false);
  const [stream, setStream] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const exchange = askExchangeText(turns);
  const body = exchange === "" ? null : open ? exchange : previewText(exchange, previewLines);

  async function send(): Promise<void> {
    if (running || onAskTurn === undefined) return;
    if (question.trim() === "") {
      setProblem(ASK_QUESTION_REFUSAL);
      return;
    }
    setProblem(null);
    setStream(null);
    setRunning(true);
    const result = await onAskTurn(ask.on, question, (text) => setStream(text));
    setRunning(false);
    setStream(null);
    // The words are in the record on every path that reached the writer — a
    // failed turn's person line included — so the field clears and the card
    // shows them in the exchange. A local refusal (an empty question) never
    // got here.
    setQuestion("");
    if (!result.ok) setProblem(result.message);
  }

  return (
    <div
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
      <div className="ask-card-body">
        {body !== null ? (
          <div className="ask-card-exchange">{body}</div>
        ) : (
          <div className="ask-card-empty">{ASK_EMPTY_SENTENCE}</div>
        )}
        {running && stream !== null && (
          <div className="ask-card-stream" aria-live="polite">
            {stream}
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
        {problem !== null && (
          <div className="ask-card-problem" role="status">
            {problem}
          </div>
        )}
      </div>
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
