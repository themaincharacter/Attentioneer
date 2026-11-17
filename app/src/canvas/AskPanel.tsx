import { useEffect, useState } from "react";
import type { Pointer } from "../map/pointers";
import type {
  AskResponse,
  AskTransport,
  InFlightAsk,
} from "../contacts/ask";
import { declareAsk } from "../contacts/ask";
import { assembleAskPacket } from "../turn/packet";
import type { AskContext } from "../turn/context";
import type { TurnMessage } from "../turn/protocol";
import { PacketSurface } from "./PacketSurface";
import {
  ASK_ATTACH_LABEL,
  ASK_ATTACH_PLACEHOLDER,
  ASK_CONTEXT_READING,
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
  ASK_SEND,
  ASK_SHOW_LOG,
  ASK_STOP,
  ASK_TITLE,
  declarationWords,
  responseWords,
  transportWord,
} from "./contactRules";

/**
 * What the app holds while an Ask is open (Epic 12 story 3): the in-flight
 * question and, once it comes back, the WRAPPED response — CONTENT, held here
 * and in the app's state, never written by the app. \`note\` is a quiet
 * sentence for a half-worked transport (the question left by copy; the OS
 * would not take the page).
 */
export interface AskSessionView {
  /** The question that left (the packet is what the transport carried). */
  ask: InFlightAsk;
  /** The wrapped response once it came back, else null. */
  response: AskResponse | null;
  /** A quiet sentence for the session (null otherwise). */
  note: string | null;
}

/**
 * THE READBACK (Epic 15 story 3): every message the app sent, verbatim, and
 * the block the one follow-up fetched. It is held by the app (CONTENT,
 * ephemeral) and shown by the panel's one verb — before the send the same
 * bytes come from the pure assembler, so the person always sees exactly what
 * left.
 */
export interface AskSentView {
  /** Every message that left, in order, verbatim. */
  messages: readonly TurnMessage[];
  /** The block the one follow-up fetched, or null when none happened. */
  read: string | null;
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
  /**
   * The stated fallback's one sentence (no provider, or a sidecar that cannot
   * start), or null while the app can carry the packet. When it is set the
   * clipboard path is the visible way out; a fallback is not an Ask failure.
   */
  fallback: string | null;
  /** The app is carrying the packet right now (the stop verb stands beside it). */
  running: boolean;
  /**
   * The previews the app read for the CURRENT inclusion (Epic 15 story 3), or
   * null while it reads them. Nothing can leave before they are here: the
   * declaration must name every block, and the send carries exactly its bytes.
   */
  context: AskContext | null;
  /** Every message that left, once the app sent them (the readback), or null. */
  sent: AskSentView | null;
  /** The inclusion changed: the app reads exactly those previews, nothing else. */
  onIncludedChange: (included: Pointer[]) => void;
  /** Send the question out: the app, or the clipboard/handoff fallback. */
  onSend: (
    question: string,
    included: Pointer[],
    transport: AskTransport,
  ) => void;
  /** Stop the app-sent turn (the sidecar's cancel). */
  onStop: () => void;
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
 * ride along.
 *
 * THE APP-SENT PACKET (Epic 15 story 3). With a provider the app carries a
 * bounded packet assembled around THIS card: its coined name, its state
 * sentence and the card's reading/note crops, each INCLUDED reach's citation
 * with a bounded preview of its target, a fixed instruction offering ONE named
 * retrieval, and the bound said in words. The previews are read by the app
 * when the inclusion changes (never for a reach the person did not include),
 * and the declaration here names EVERY block with its exact byte size and the
 * total — derived from the same block bytes the send carries, so the line
 * cannot drift. The one verb beside it opens those exact bytes, message by
 * message, BEFORE the send; after the send the same verb opens what left,
 * followed by the follow-up's message when the model named one block. Both are
 * the SHARED PacketSurface (story 3b), the same piece the ground card's ask…
 * renders, so the two entry points cannot say different things about the same
 * bytes. The send waits until the previews are here.
 *
 * THE CLIPBOARD ROUTE (the stated fallback, and the only route when no
 * provider is configured) is UNCHANGED: it carries the question plus the
 * included CITATIONS, never a preview, so its declaration and its packet stay
 * exactly what they were. The panel never hides which transport is live.
 *
 * IN FLIGHT: the paste field is where a clipboard response comes back — the
 * ghost intake's sibling. "log it" wraps the pasted text at intake (exact byte
 * size + decode status) and appends the ONE PRISM; the panel then holds the
 * response as content and its "the log" opens the Move's own PRISM window
 * (record != visible: on demand, never a gallery). An app-sent answer arrives
 * in place, with the stop verb while the turn runs. "nothing came back" closes
 * the question with the no-response outcome. An optional attached file rides
 * the response, and the workspace-boundary rule applies to it at intake.
 *
 * THE KEEP is a SEPARATE act: a quiet button writes the response into this
 * word's memory (the existing Finding move). It never extends the PRISM — the
 * record was closed at intake — and the panel says "kept to memory" once.
 *
 * It sits OUTSIDE \`.plane\` (the ghost panel's neighbour): a fixed, quiet panel,
 * not a world card. Esc or the × closes it; a press away does NOT (it holds
 * typed prose). Closing with the question still in flight appends nothing: an
 * unfinished Move has no record.
 *
 * Provisional: the look, the fixed placement, the readback's placement, the
 * packet's headings in the readback, and the one attached file.
 */
export function AskPanel({
  name,
  rows,
  ride,
  session,
  kept,
  busy,
  note,
  fallback,
  running,
  context,
  sent,
  onIncludedChange,
  onSend,
  onStop,
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
  const chosenNow = included();
  const inclusionKey = chosenNow.map((pointer) => rowKey(pointer)).join("\u0001");

  // The inclusion changed: the app reads EXACTLY these reaches' previews and
  // nothing else. With no provider the panel composes the clipboard's older
  // packet instead, which reads nothing.
  useEffect(() => {
    if (session !== null) return;
    onIncludedChange(chosenNow);
    // The key is the inclusion's identity; the rows are this word's own.
  }, [inclusionKey, session]);

  // The app-sent packet, assembled PURELY from the previews and the prose. The
  // fallback's clipboard packet is a different composition (citations only)
  // and is declared by its own unchanged helper.
  const appRoute = fallback === null;
  const packet =
    appRoute && context !== null
      ? assembleAskPacket({
          question,
          card: context.card,
          reaches: context.reaches,
          retrievable: context.retrievable,
        })
      : null;

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
                  title="ride this reach in the packet"
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

          {/* THE DECLARATION, before anything leaves: with a provider it names
              every block of the app-sent packet and its size; on the fallback
              it is the clipboard packet's line, unchanged. Both are derived
              from the same bytes their send carries. */}
          {appRoute ? (
            packet !== null ? (
              <PacketSurface
                declaration={packet.declaration}
                messages={packet.messages}
              />
            ) : (
              <div className="ask-context" role="status">
                {ASK_CONTEXT_READING}
              </div>
            )
          ) : (
            <div className="ask-declaration">
              {declarationWords(declareAsk(question, included()))}
            </div>
          )}

          {/* The stated fallback's one sentence (no provider, or no sidecar).
              A fallback is not a failure of the Ask: the clipboard is simply
              the way out, and the panel says so before the person uses it. */}
          {fallback !== null && (
            <div className="ask-fallback" role="status">
              {fallback}
            </div>
          )}

          <div className="ask-transports">
            {appRoute && (
              <button
                type="button"
                className="ask-send"
                disabled={busy || running || packet === null}
                title={ASK_SEND}
                onClick={(e) => {
                  e.stopPropagation();
                  send("app");
                }}
              >
                send
              </button>
            )}
            {running && (
              <button
                type="button"
                className="ask-stop"
                disabled={busy}
                title={ASK_STOP}
                onClick={(e) => {
                  e.stopPropagation();
                  onStop();
                }}
              >
                {ASK_STOP}
              </button>
            )}
            {fallback !== null && (
              <>
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
              </>
            )}
          </div>
        </>
      )}

      {session !== null && (
        <>
          {sent !== null ? (
            <PacketSurface messages={sent.messages} read={sent.read} />
          ) : (
            <pre className="ask-packet">{session.ask.packet}</pre>
          )}
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
