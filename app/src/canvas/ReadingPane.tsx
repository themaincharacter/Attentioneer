import { useEffect, useRef, useState, type ReactNode } from "react";
import { PagedText } from "../reading/PagedText";
import { GroundReadingText } from "./GroundLayer";
import { groundDisplayName } from "../map/ground";

/** What the pane holds while a card is docked (view state, never a record). */
export interface DockedCard {
  kind: "reference" | "ask" | "session";
  slug: string;
  name: string;
  text: string | null;
}

/**
 * STORY 25-8 (ADR-0046 ruling 2) — THE READING PANE: a fixed dock at the
 * window's right where a card's full text lands when its body is clicked —
 * the expand-on-click is REPLACED by dock-on-click. The reading is PAGED like
 * the token (the person's ruling: four lines a page, the cue flipping in
 * place) rather than a tall scroll, at reading size and in the hand voice's
 * quote ink. The card keeps its token face and lights the "reading" marker
 * while its text is here. The foot carries the person's own note so nothing
 * the click used to reach is lost. PROVISIONAL: the pane's size and place.
 */
export function ReadingPane({
  docked,
  note,
  onSetNote,
  onClose,
  children,
}: {
  docked: DockedCard;
  note: string;
  onSetNote: (on: string, text: string) => Promise<unknown>;
  onClose: () => void;
  /** Another kind's own face (the ask's thread and composer, story 25-9). */
  children?: ReactNode;
}) {
  const [draft, setDraft] = useState(note);
  useEffect(() => setDraft(note), [docked.slug, note]);

  // The write path is the seam's own (the queued one-line write); an edit is
  // written when the field is left and it changed, and never otherwise.
  const write = () => {
    if (draft !== note) void onSetNote(docked.slug, draft);
  };

  return (
    <aside className="reading-pane" aria-label="the reading pane">
      <div className="reading-pane-head">
        <span className="ground-name reading-pane-name">
          {groundDisplayName(docked.name)}
        </span>
        <button
          type="button"
          className="reading-pane-close verb-key"
          aria-label="close the reading pane"
          onClick={onClose}
        >
          &times;
        </button>
      </div>
      {children !== undefined ? (
        children
      ) : (
        <>
      <div className="reading-pane-body">
        {docked.text !== null ? (
          <PagedText anchor="card">
            <div className="ground-reading reading-pane-reading">
              <GroundReadingText text={docked.text} open />
            </div>
          </PagedText>
        ) : (
          <div className="ground-reading-empty">no reading on this card</div>
        )}
      </div>
      <div className="reading-pane-foot">
        <textarea
          className="reading-pane-note"
          aria-label="the card's note"
          placeholder="a note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={write}
        />
      </div>
        </>
      )}
    </aside>
  );
}


/**
 * STORY 25-9 — THE ASK'S OWN FACE IN THE PANE: the thread pages like the
 * token and the composer sits at the foot — the surface the person asks from
 * lives in the reading pane now. The seams are the ask card's own (one queued
 * turn write, the one stop, the one settings door); the words are the thread's
 * verbatim. PROVISIONAL: the composer's shape (the card's inline face keeps
 * its fork and effort verbs until story 25-10 lifts them here).
 */
export function AskDockBody({
  ask,
  turns,
  draft,
  hasProvider,
  onOpenSettings,
  onAskTurn,
  onStopAskTurn,
}: {
  ask: { on: string };
  turns: readonly { role: string; text: string }[];
  draft?: { question: string; token: number };
  hasProvider: boolean | null;
  onOpenSettings: () => void;
  onAskTurn: (
    slug: string,
    question: string,
    onPart?: (text: string) => void,
  ) => Promise<{ ok: boolean; message?: string }>;
  onStopAskTurn: () => Promise<void>;
}) {
  const [question, setQuestion] = useState("");
  const [partial, setPartial] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // A draft arriving from elsewhere refills the field ONCE per token (the
  // card's own rule: a re-render never refills a field being edited).
  const seenRef = useRef<number | null>(null);
  useEffect(() => {
    if (draft === undefined) return;
    if (seenRef.current === draft.token) return;
    seenRef.current = draft.token;
    setQuestion(draft.question);
  }, [draft]);

  const send = () => {
    const words = question;
    if (words.trim() === "" || busy) return;
    setBusy(true);
    setProblem(null);
    setPartial("");
    setQuestion("");
    void onAskTurn(ask.on, words, (text) => setPartial(text))
      .then((result) => {
        if (!result.ok) setProblem(result.message ?? "the turn did not go");
      })
      .finally(() => {
        setBusy(false);
        setPartial(null);
      });
  };

  return (
    <>
      <div className="reading-pane-body">
        <PagedText>
          <div className="reading-pane-thread">
            {turns.map((turn, at) => (
              <div
                key={at}
                className={
                  "ask-turn " + (turn.role === "person" ? "person" : "answer")
                }
              >
                <div className="ask-turn-text">
                  <GroundReadingText text={turn.text} open />
                </div>
              </div>
            ))}
            {partial !== null && partial !== "" && (
              <div className="ask-turn answer">
                <div className="ask-turn-text">
                  <GroundReadingText text={partial} open />
                </div>
              </div>
            )}
          </div>
        </PagedText>
      </div>
      <div className="reading-pane-foot">
        {problem !== null && (
          <div className="ground-problem" role="status">
            {problem}
          </div>
        )}
        {hasProvider ? (
          <textarea
            className="reading-pane-note"
            aria-label="the ask's question"
            placeholder="ask"
            value={question}
            disabled={busy}
            onChange={(event) => setQuestion(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.shiftKey) return;
              event.preventDefault();
              send();
            }}
          />
        ) : (
          <div className="ground-quiet">
            nothing configured — a model answers this.
            <button
              type="button"
              className="reading-pane-link"
              onClick={onOpenSettings}
            >
              settings
            </button>
          </div>
        )}
        {/* The composer never pretends a send is available without a model:
            the sentence above IS the foot until one is configured. */}
        {hasProvider === true &&
          (busy ? (
            <button
              type="button"
              className="reading-pane-send"
              onClick={() => void onStopAskTurn()}
            >
              stop
            </button>
          ) : (
            <button
              type="button"
              className="reading-pane-send"
              disabled={question.trim() === ""}
              onClick={send}
            >
              send
            </button>
          ))}
      </div>
    </>
  );
}
