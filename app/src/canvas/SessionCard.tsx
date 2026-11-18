import { useEffect, useRef, useState, type CSSProperties } from "react";
import { previewOverflows, previewText } from "../map/readings";
import {
  SESSION_EMPTY_SENTENCE,
  SESSION_MISSING_TOOL_SENTENCE,
  SESSION_RUNNING_SENTENCE,
  sessionEntryLine,
  sessionKindLine,
  sessionNewestEntry,
  type SessionCard as SessionCardRecord,
  type SessionEntry,
} from "../map/sessions";
import type { GroundAddResult } from "./useGround";
import {
  allowOnceOption,
  refuseOption,
  type AcpPermissionAsk,
} from "../turn/acpEntries";

/**
 * THE SESSION CARD (Epic 18 story 3).
 *
 * It renders from the SAME grammar as a reference card and an ask card — name,
 * what this is, the crop — so the ground map stays one surface. The name is the
 * person's, the second line says "a run of <the tool row>", and the body is the
 * run's TRANSCRIPT: one progress entry per line, in ARRIVAL order, newest at
 * the bottom. THE TRANSCRIPT IS THE RECORD, NOT THIS COMPONENT: the entries
 * arrive as a prop, read at load from `map/sessions/<slug>.jsonl`.
 *
 * TWO FACES. Small: the newest entry's crop (or the ending, when the last run
 * ended — the ending IS an entry). Expanded: the whole transcript in order, the
 * DECLARATION for the next run (18.2's one sentence, which names a provider row
 * and never a key), the tool picker when the card's row is gone, and the run
 * and stop verbs.
 *
 * ENTRIES RENDER BY KIND: words as words, a tool call as its name plus the
 * status the server reported, a permission as what was asked plus the reply,
 * and the run's own beats (started, session) and ending as one quiet line each.
 * NEVER a percentage, never a step count, never a spinner: while a run is live
 * the card says so in one sentence and offers its stop; the moment the run
 * settles that sentence and that verb are gone, because they are read from the
 * live-run list and not from a timer of ours.
 *
 * ONE RUN PER CARD. The card's run verb is disabled while the list says this
 * card is running, and stop is the run's own cancel (18.2) — what arrived stays
 * and the ending says what happened. A PARTIAL NEVER COUNTS AS A RESULT: the
 * ending line is the only claim the card makes about how the run went, and it
 * says "stopped", "failed" or "timed-out" instead of dressing a partial up.
 *
 * A CARD WHOSE ROW IS GONE says so in one sentence and offers the rows this
 * build ships again (one field's change, written by the layer). A card whose
 * row is there declares the next run before it starts — the key sentence
 * included, with no key in it: the ROW is named, never the value.
 *
 * STORY 18.5 MAKES IT REMOVABLE: the expanded card offers remove, the same
 * immediate delete + Restore toast every other card uses. A live run is never
 * cut by it — the verb waits until the transcript has stopped being written.
 *
 * ESC CLOSES THE CARD'S FACE (collapses), never the map. The wheel never zooms
 * the plane: the scrollbox stops the event where it starts.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the card's size, the crop, the
 * scrollbox's slack, the sentence placements and the picker's look.
 */

/** How close to the bottom still counts as "at the bottom" (px, PROVISIONAL). */
export const SESSION_SCROLL_SLACK = 24;

/** Whether a scrollbox is close enough to its bottom to keep following (PURE). */
export function sessionAtBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= SESSION_SCROLL_SLACK;
}

/**
 * ONE ENTRY, drawn by its kind. The words are VERBATIM; the card only decides
 * how they sit. A `crop` is the small face's stated count (the expanded face
 * omits it), and it only ever cuts TEXT — a tool's name or an ending is one
 * line already and is never cut.
 */
export function SessionEntryLine({
  entry,
  crop,
}: {
  entry: SessionEntry;
  crop?: number;
}) {
  if (entry.kind === "text") {
    const text = crop === undefined ? entry.text : previewText(entry.text, crop);
    return (
      <div className="session-entry text">
        <span className="session-entry-text">{text}</span>
      </div>
    );
  }
  if (entry.kind === "tool") {
    return (
      <div className="session-entry tool">
        <span className="session-entry-name">{entry.name}</span>
        {entry.status.trim() !== "" && (
          <span className="session-entry-status">{entry.status}</span>
        )}
      </div>
    );
  }
  if (entry.kind === "permission") {
    return (
      <div className="session-entry permission">
        <span className="session-entry-name">{entry.name}</span>
        <span className="session-entry-status">{entry.reply}</span>
      </div>
    );
  }
  // started, session and ended are one quiet line each; the ending is the only
  // thing the card ever claims about how the run went.
  return (
    <div
      className={
        "session-entry quiet " +
        entry.kind +
        (entry.kind === "ended" ? " ending-" + entry.ending : "")
      }
    >
      {sessionEntryLine(entry)}
    </div>
  );
}

/**
 * WHAT THE SERVER IS ASKING, in one line (PURE, PROVISIONAL): the tool call's
 * own title and kind, never the request's raw params. A call with no title
 * still says a permission is being asked, so the card is never blank.
 */
export function permissionAskLine(toolCall: unknown): string {
  const call =
    typeof toolCall === "object" && toolCall !== null && !Array.isArray(toolCall)
      ? (toolCall as Record<string, unknown>)
      : {};
  const title =
    typeof call.title === "string" && call.title.trim() !== ""
      ? call.title.trim()
      : "a tool call";
  const kind =
    typeof call.kind === "string" && call.kind.trim() !== ""
      ? call.kind.trim()
      : "";
  return kind === "" ? title : title + " (" + kind + ")";
}

/** One tool row a picker may offer: its id and the name the person reads. */
export interface SessionToolChoice {
  id: string;
  name: string;
}

export function SessionCard({
  session,
  toolName,
  declaration,
  tools = [],
  entries,
  running,
  open,
  previewLines,
  onOpen,
  onClose,
  onRun,
  onStop,
  onChooseTool,
  permission = null,
  onAllowOnce,
  onRefuse,
  onMakeResult,
  onRemove,
}: {
  session: SessionCardRecord;
  /** The bound row's display name, or null when this build does not ship it. */
  toolName: string | null;
  /**
   * The declaration for the NEXT run (18.2's sentence computed from the row:
   * which key it will receive, by provider row, or that it receives none), or
   * null when there is no row to declare.
   */
  declaration: string | null;
  /** The rows a picker may offer (the build's shipped rows). */
  tools?: readonly SessionToolChoice[];
  /** The transcript, in file order (append-only: file order is arrival order). */
  entries: readonly SessionEntry[];
  /** View state: this card has a LIVE run right now. */
  running: boolean;
  open: boolean;
  /** How many lines the small face crops at (the stated preference). */
  previewLines: number;
  onOpen: () => void;
  onClose: () => void;
  /** Start the run (the layer's writer). Optional in a render test. */
  onRun?: () => Promise<GroundAddResult>;
  /** Stop the live run (the run's own cancel). */
  onStop?: () => Promise<void>;
  /** Bind the card to another row (one field's change). */
  onChooseTool?: (tool: string) => Promise<GroundAddResult>;
  /**
   * STORY 18.4 — THE SERVER'S PENDING ASK, as view state. While this is here
   * the run is WAITING; the card offers allow-once and refuse and nothing else.
   */
  permission?: AcpPermissionAsk | null;
  /** The person's two verbs. Allow-once is offered only when it exists. */
  onAllowOnce?: () => void;
  onRefuse?: () => void;
  /** Make the last completed run's text into a card (a copy, never a link). */
  onMakeResult?: () => Promise<GroundAddResult>;
  /**
   * STORY 18.5 — remove this card, immediately and reversibly (the one toast).
   * A run in flight refuses: the transcript is still being written.
   */
  onRemove?: () => Promise<GroundAddResult>;
}) {
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // Whether the body still follows the newest entry; a person scrolling up
  // turns it off until they reach the bottom again.
  const pinnedRef = useRef(true);

  // ESC CLOSES THE CARD'S FACE — never the map. Capture phase, so the key is
  // consumed before the plane's handlers see it. A picker that is open is
  // forgotten first (one press, one thing).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      if (picked !== null) {
        setPicked(null);
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [open, onClose, picked]);

  // The card's wheel never zooms the plane.
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    function onWheel(e: WheelEvent) {
      e.stopPropagation();
    }
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // Opening starts AT THE NEWEST ENTRY again.
  useEffect(() => {
    if (open) pinnedRef.current = true;
  }, [open]);

  // AUTO-SCROLL TO THE NEWEST ENTRY unless the person scrolled up.
  useEffect(() => {
    if (!open) return;
    const el = bodyRef.current;
    if (el === null || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [open, entries.length]);

  function trackScroll(): void {
    const el = bodyRef.current;
    if (el === null) return;
    pinnedRef.current = sessionAtBottom(
      el.scrollTop,
      el.clientHeight,
      el.scrollHeight,
    );
  }

  async function startRun(): Promise<void> {
    if (busy || running || onRun === undefined) return;
    setBusy(true);
    setProblem(null);
    // The run's own promise settles when the run does; awaiting it only holds
    // THIS handler, never the card. The entries arrive through the prop.
    const result = await onRun();
    setBusy(false);
    // The ENDING is the transcript's line; only a record that could not keep
    // up answers a sentence here.
    if (!result.ok) setProblem(result.message);
  }

  async function stopRun(): Promise<void> {
    if (onStop === undefined) return;
    setProblem(null);
    try {
      await onStop();
    } catch {
      // The run's own line settles it; a stop that cannot reach the server
      // leaves the run to its budget.
    }
  }

  /**
   * STORY 18.5 — the card's remove, beside close: immediate, reversible through
   * the one toast. A refused unlink has already taken the card, so its one
   * sentence is the layer's, not this card's.
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

  async function makeResult(): Promise<void> {
    if (busy || onMakeResult === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onMakeResult();
    setBusy(false);
    // A run with no text (or one that did not finish) writes NOTHING and says
    // one sentence; a made card leaves this card at once.
    if (!result.ok) setProblem(result.message);
  }

  async function usePickedTool(): Promise<void> {
    if (picked === null || onChooseTool === undefined || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await onChooseTool(picked);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setPicked(null);
  }

  const newest = sessionNewestEntry(entries);
  const smallFolded =
    !open &&
    newest !== null &&
    newest.kind === "text" &&
    previewOverflows(newest.text, previewLines);

  return (
    <div
      ref={cardRef}
      className={`session-card${open ? " expanded" : ""}`}
      style={
        {
          left: session.x,
          top: session.y,
          "--preview-lines": previewLines,
        } as CSSProperties
      }
      data-slug={session.on}
      onClick={open ? undefined : onOpen}
    >
      <div className="session-card-name">{session.name}</div>
      <div className="session-card-kind">{sessionKindLine(toolName)}</div>
      <div className="session-card-body" ref={bodyRef} onScroll={trackScroll}>
        {open ? (
          entries.length === 0 ? (
            <div className="session-card-empty">{SESSION_EMPTY_SENTENCE}</div>
          ) : (
            <div
              className="session-card-transcript"
              aria-live={running ? "polite" : undefined}
            >
              {entries.map((entry, index) => (
                <SessionEntryLine key={index} entry={entry} />
              ))}
            </div>
          )
        ) : newest === null ? (
          <div className="session-card-empty">{SESSION_EMPTY_SENTENCE}</div>
        ) : (
          <div className="session-card-transcript">
            <SessionEntryLine entry={newest} crop={previewLines} />
          </div>
        )}
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
        <div className="session-card-problem" role="status">
          {problem}
        </div>
      )}
      {open && (
        <div className="session-card-run">
          {/* A CARD WHOSE ROW IS GONE says so and offers the rows this build
              ships again. One field's change, and the card is usable again. */}
          {toolName === null && (
            <div className="session-card-missing" role="status">
              <div className="session-card-missing-sentence">
                {SESSION_MISSING_TOOL_SENTENCE}
              </div>
              {tools.length > 0 && onChooseTool !== undefined && (
                <div className="session-card-picker">
                  <select
                    className="session-card-pick"
                    aria-label="run this card with"
                    value={picked ?? tools[0]!.id}
                    disabled={busy || running}
                    onChange={(e) => setPicked(e.target.value)}
                  >
                    {tools.map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="session-card-bind"
                    disabled={busy || running}
                    onClick={() => void usePickedTool()}
                  >
                    use this tool
                  </button>
                </div>
              )}
            </div>
          )}
          {/* STORY 18.4 — THE PENDING PERMISSION, and the person's TWO verbs.
              The server's options are NEVER presented as choices: only
              allow-once and refuse exist here, so an "always" offer on the wire
              cannot become a press. When no allow-once option was offered, the
              allow verb is disabled and the card says why — it never falls back
              to an always option. */}
          {permission !== null && (
            <div className="session-permission" role="status">
              <div className="session-permission-ask">
                the run is asking: {permissionAskLine(permission.toolCall)}
              </div>
              {allowOnceOption(permission.options) === null && (
                <div className="session-permission-note">
                  the server offered no allow-once option, so only refuse is
                  available.
                </div>
              )}
              <div className="session-permission-actions">
                <button
                  type="button"
                  className="session-permission-allow"
                  disabled={
                    onAllowOnce === undefined ||
                    allowOnceOption(permission.options) === null
                  }
                  onClick={onAllowOnce}
                >
                  allow once
                </button>
                <button
                  type="button"
                  className="session-permission-refuse"
                  disabled={
                    onRefuse === undefined ||
                    refuseOption(permission.options) === null
                  }
                  onClick={onRefuse}
                >
                  refuse
                </button>
              </div>
            </div>
          )}
          {/* THE DECLARATION FOR THE NEXT RUN: 18.2's one sentence, computed
              from the row alone. It names a provider ROW, never a key. */}
          {declaration !== null && (
            <div className="session-card-declaration">{declaration}</div>
          )}
          <div className="session-card-actions">
            {running ? (
              <>
                {/* The one sentence, and the one verb. No spinner: this line is
                    read from the live-run list, so it cannot outlive the run. */}
                <span className="session-running">{SESSION_RUNNING_SENTENCE}</span>
                <button
                  type="button"
                  className="session-card-stop"
                  disabled={onStop === undefined}
                  onClick={() => void stopRun()}
                >
                  stop
                </button>
              </>
            ) : (
              <button
                type="button"
                className="session-card-run-verb"
                disabled={busy || toolName === null || onRun === undefined}
                onClick={() => void startRun()}
              >
                run
              </button>
            )}
            {/* STORY 18.4 — A FINISHED RUN'S RESULT BECOMES A COPY. Offered
                once a run has ended; a run with no text refuses with the ONE
                sentence in the problem line and writes nothing. */}
            {entries.some((entry) => entry.kind === "ended") && (
              <button
                type="button"
                className="session-card-make"
                disabled={busy || onMakeResult === undefined}
                onClick={() => void makeResult()}
              >
                make a card from this
              </button>
            )}
            {/* STORY 18.5 — the card's remove, beside close: immediate,
                reversible through the one toast. A live run is never cut by a
                delete — the verb waits. */}
            {onRemove !== undefined && (
              <button
                type="button"
                className="session-card-remove"
                disabled={busy || running}
                onClick={() => void removeCard()}
              >
                remove
              </button>
            )}
            <button type="button" className="session-card-close" onClick={onClose}>
              close
            </button>
          </div>
        </div>
      )}
      {!open && (
        <div className="session-card-footer">
          <button type="button" className="session-card-open" onClick={onOpen}>
            open
          </button>
        </div>
      )}
    </div>
  );
}
