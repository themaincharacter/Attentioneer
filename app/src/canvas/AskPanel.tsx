import { useEffect, useState } from "react";
import type { Pointer } from "../map/pointers";
import type {
  AskResponse,
  AskTransport,
  InFlightAsk,
} from "../contacts/ask";
import {
  ASK_ATTACH_LABEL,
  ASK_ATTACH_PLACEHOLDER,
  ASK_COPY,
  ASK_HANDOFF,
  ASK_INCLUDED_LABEL,
  ASK_KEEP,
  ASK_KEPT,
  ASK_LOG_IT,
  ASK_NO_REACH,
  ASK_NO_RESPONSE,
  ASK_NOTHING_INCLUDED,
  ASK_PASTE_LABEL,
  ASK_PASTE_PLACEHOLDER,
  ASK_QUESTION_LABEL,
  ASK_QUESTION_PLACEHOLDER,
  ASK_RIDES,
  ASK_SHOW_LOG,
  ASK_TITLE,
  responseWords,
  transportWord,
} from "./contactRules";

/**
 * What the app holds while an Ask is open (Epic 12 story 3): the in-flight
 * question and, once it comes back, the WRAPPED response — CONTENT, held here
 * and in the app's state, never written by the app. `note` is a quiet
 * sentence for a half-worked transport (the question left by copy; the OS
 * would not take the page).
 */
export interface AskSessionView {
  /** The question that left (the packet is what was copied). */
  ask: InFlightAsk;
  /** The wrapped response once it came back, else null. */
  response: AskResponse | null;
  /** A quiet sentence for the session (null otherwise). */
  note: string | null;
}

interface AskPanelProps {
  /** The word's coined NAME (aria and header; the slug stays in the record). */
  name: string;
  /** Every pointer line on this word, in FILE ORDER (the inclusion choices). */
  rows: readonly Pointer[];
  /** The reach the question rides, or null for none. */
  ride: Pointer | null;
  /** The live Ask (null while composing). */
  session: AskSessionView | null;
  /** The response was kept to the word's memory (a Finding). */
  kept: boolean;
  /** A Move is writing; the buttons wait. */
  busy: boolean;
  /** A quiet sentence for a refusal (null otherwise). */
  note: string | null;
  /** Send the question out by copy or by the OS handoff. */
  onSend: (
    question: string,
    included: Pointer[],
    transport: AskTransport,
  ) => void;
  /** Log the pasted response (size + decode at intake). */
  onIntake: (raw: string, attachmentPath: string) => void;
  /** Close the Ask unanswered: nothing came back. */
  onAbandon: () => void;
  /** Keep the response — the existing Finding move (this word's memory). */
  onKeep: () => void;
  /** Show the ONE PRISM the completed Ask appended. */
  onLog: () => void;
  /** Esc or the ×: the Move stays in flight (nothing is written by closing). */
  onClose: () => void;
}

/** A row's local key: all the panel's rows hang off one word. */
function rowKey(pointer: Pointer): string {
  return pointer.form + "\u0000" + pointer.value;
}

/**
 * THE ASK PANEL (Epic 12 story 3, PROVISIONAL and deliberately plain) — the
 * question out, the response back, the keep kept separate.
 *
 * COMPOSING: the person's question prose, the reach it rides (the row the panel
 * opened from, or none), and the INCLUSION SET — which of the word's reaches
 * ride along. The packet the app copies carries the prose and the included
 * CITATIONS only: the app never reads a target to compose a question, so the
 * inclusion is a set of handles, never their content. Two ways out: copy (the
 * clipboard) and — when the ride is a url — the OS handoff. The words say
 * "copied" and "handed", never "opened".
 *
 * IN FLIGHT: the packet stays visible (what left), and the paste field is
 * where the response comes back — the ghost intake's sibling. "log it" wraps
 * the pasted text at intake (exact byte size + decode status) and appends the
 * ONE PRISM; the panel then holds the response as content and its "the log"
 * opens the Move's own PRISM window (record != visible: on demand, never a
 * gallery). "nothing came back" closes the question with the no-response
 * outcome. An optional attached file rides the response, and the
 * workspace-boundary rule applies to it at intake.
 *
 * THE KEEP is a SEPARATE act: a quiet button writes the response into this
 * word's memory (the existing Finding move). It never extends the PRISM — the
 * record was closed at intake — and the panel says "kept to memory" once.
 *
 * It sits OUTSIDE `.plane` (the ghost panel's neighbour): a fixed, quiet panel,
 * not a world card. Esc or the × closes it; a press away does NOT (it holds
 * typed prose). Closing with the question still in flight appends nothing: an
 * unfinished Move has no record.
 *
 * Provisional: the look, the fixed placement, the packet's framing in the
 * panel, and the one attached file.
 */
export function AskPanel({
  name,
  rows,
  ride,
  session,
  kept,
  busy,
  note,
  onSend,
  onIntake,
  onAbandon,
  onKeep,
  onLog,
  onClose,
}: AskPanelProps) {
  const [question, setQuestion] = useState("");
  const [chosen, setChosen] = useState<Set<string>>(() => {
    if (ride === null) return new Set<string>();
    const key = rowKey(ride);
    return rows.some((pointer) => rowKey(pointer) === key)
      ? new Set([key])
      : new Set<string>();
  });
  const [raw, setRaw] = useState("");
  const [attach, setAttach] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function toggle(pointer: Pointer) {
    const key = rowKey(pointer);
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function included(): Pointer[] {
    return rows.filter((pointer) => chosen.has(rowKey(pointer)));
  }

  function send(next: AskTransport) {
    if (busy) return;
    onSend(question, included(), next);
  }

  const handoffable = ride !== null && ride.form === "url";

  return (
    <div
      className="ask-panel"
      role="group"
      aria-label={"ask on “" + name + "”"}
    >
      <div className="ask-head">
        <span className="ask-title">{ASK_TITLE}</span>
        <button
          type="button"
          className="ask-close"
          aria-label="close the ask"
          title="close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>

      <div className="ask-word">{name}</div>

      {session === null && (
        <>
          <textarea
            className="ask-question"
            value={question}
            rows={4}
            aria-label={ASK_QUESTION_LABEL}
            placeholder={ASK_QUESTION_PLACEHOLDER}
            onChange={(e) => setQuestion(e.target.value)}
          />

          <div className="ask-rides">
            <span className="ask-rides-label">{ASK_RIDES}</span>
            <span className="ask-rides-value">
              {ride === null ? ASK_NO_REACH : ride.form + " " + ride.value}
            </span>
          </div>

          <div
            className="ask-included"
            role="group"
            aria-label={ASK_INCLUDED_LABEL}
          >
            {rows.length === 0 ? (
              <span className="ask-note">{ASK_NOTHING_INCLUDED}</span>
            ) : (
              rows.map((pointer, index) => (
                <label
                  className="ask-include"
                  key={index + rowKey(pointer)}
                  title="ride this reach's citation in the packet"
                >
                  <input
                    type="checkbox"
                    checked={chosen.has(rowKey(pointer))}
                    onChange={() => toggle(pointer)}
                  />
                  {pointer.form} {pointer.value}
                </label>
              ))
            )}
          </div>

          <div className="ask-transports">
            <button
              type="button"
              className="ask-copy"
              disabled={busy}
              title={ASK_COPY}
              onClick={(e) => {
                e.stopPropagation();
                send("copy");
              }}
            >
              copy
            </button>
            <button
              type="button"
              className="ask-handoff"
              disabled={busy || !handoffable}
              title={ASK_HANDOFF}
              onClick={(e) => {
                e.stopPropagation();
                send("handoff");
              }}
            >
              hand off
            </button>
          </div>
        </>
      )}

      {session !== null && (
        <>
          <pre className="ask-packet">{session.ask.packet}</pre>
          <div className="ask-sent">{transportWord(session.ask.transport)}</div>

          {session.response === null && (
            <>
              <textarea
                className="ask-response"
                value={raw}
                rows={5}
                aria-label={ASK_PASTE_LABEL}
                placeholder={ASK_PASTE_PLACEHOLDER}
                onChange={(e) => setRaw(e.target.value)}
              />
              <input
                className="ask-attach"
                value={attach}
                aria-label={ASK_ATTACH_LABEL}
                placeholder={ASK_ATTACH_PLACEHOLDER}
                onChange={(e) => setAttach(e.target.value)}
              />
              <div className="ask-actions">
                <button
                  type="button"
                  className="ask-log"
                  disabled={busy || raw === ""}
                  title={ASK_LOG_IT}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (raw === "") return;
                    onIntake(raw, attach);
                  }}
                >
                  log it
                </button>
                <button
                  type="button"
                  className="ask-none"
                  disabled={busy}
                  title={ASK_NO_RESPONSE}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAbandon();
                  }}
                >
                  nothing came back
                </button>
              </div>
            </>
          )}

          {session.response !== null && (
            <>
              <pre className="ask-response-text">{session.response.text}</pre>
              <div className="ask-response-stats">
                {responseWords(session.response)}
              </div>
              <div className="ask-actions">
                <button
                  type="button"
                  className="ask-keep"
                  disabled={busy || kept}
                  title={ASK_KEEP}
                  onClick={(e) => {
                    e.stopPropagation();
                    onKeep();
                  }}
                >
                  {kept ? ASK_KEPT : "keep it"}
                </button>
                <button
                  type="button"
                  className="ask-show-log"
                  title={ASK_SHOW_LOG}
                  onClick={(e) => {
                    e.stopPropagation();
                    onLog();
                  }}
                >
                  the log
                </button>
              </div>
            </>
          )}
        </>
      )}

      {note !== null ? (
        <div className="ask-note">{note}</div>
      ) : session !== null && session.note !== null ? (
        <div className="ask-note">{session.note}</div>
      ) : null}
    </div>
  );
}
