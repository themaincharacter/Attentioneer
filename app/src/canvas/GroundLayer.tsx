import { useEffect, useRef, useState } from "react";
import type { GroundReference } from "../map/ground";
import {
  previewText,
  readingFileName,
  readingStateWord,
  type Reading,
  type ReadingState,
} from "../map/readings";
import { pickTextFile } from "../workspace/dialogs";
import {
  beginGroundDrag,
  dropGroundDrag,
  moveGroundDrag,
  type GroundDragState,
} from "./groundDrag";
import { isGestureArmed, type GestureMode } from "./gates";
import type { Point } from "./geometry";
import type { GroundAddResult } from "./useGround";

/**
 * The ground map's own layer (story 16.1; story 16.2 made the row live; story
 * 16.3 makes it a CARD).
 *
 * The separate-maps rule (ADR-0032, `canvas/mapContentRules.ts`) keeps every
 * CONCEPT-map family off this map; this layer is the ground map's counterpart,
 * a sibling of the words and wires rather than a reuse of them. It draws one
 * ground reference per record, and the person's verdict on stories 1-2 was
 * that the row "dumped the whole text into the map": so every reference is
 * now a CARD.
 *
 * THE CARD (story 16.3), copied in SHAPE from Slashspace's node cards (a
 * quiet surface, a title, a muted cropped body, a meta footer — fixed, never
 * stretching with its content; PROVISIONAL: the dimensions and the six-line
 * crop are ADR-0003's rendering seam, not a design system):
 *   - SMALL (the default): the person's name (17px), the stored reading's
 *     first `READING_PREVIEW_LINES` lines cut by the PURE `previewText`
 *     helper (one trailing ellipsis), and a footer with the file's NAME and,
 *     when it is not `current`, the computed state word.
 *   - EXPANDED: the same card, larger and fixed, whose body SCROLLS the
 *     STORED reading. It never re-reads anything: no bridge call, no fetch,
 *     no new I/O — the text is the `texts` prop the load already read, and a
 *     refused/absent reading simply has nothing to scroll. Wheel presses are
 *     stopped on the body so the plane's zoom cannot steal the scroll.
 *   - OPEN/CLOSED is VIEW state, never a record: reopening the workspace shows
 *     every card small, and no write path here touches a file.
 *   - A press on a card opens it; a press away (or Esc) closes it. The drag
 *     still owns a press that moves (story 16.2), so a drag never opens.
 *
 * STORY 16.2's three quiet things stay exactly as they were: the STATE WORD,
 * the DRAG (one `x | y` write on release through the app's queue), and the two
 * person-pressed re-reads (refresh, point at another file).
 *
 * STORY 16.3's DELETE is a two-step, INLINE confirm on the card: the first
 * press on `remove` asks ("remove this reference and its reading?"), the
 * second removes, and any other press or Esc backs out. The layer hands the
 * one write path (`useGround.remove`) — the card never touches a file. When a
 * refused unlink answers its one sentence the card is already gone, so the
 * sentence is shown where it stood. There is no undo until the history story.
 *
 * Nothing counts, sums, scores or nudges; every string here is either the
 * person's words or a fact the map already holds.
 */

/** The card's inline-delete step: view state, never a record. */
export type GroundDeleteStep = "idle" | "asking";

/**
 * One press on a card's delete (story 16.3): pressing `remove` only ASKS, and
 * any other press backs out. PURE so the two-step is not the DOM's only truth.
 */
export function deleteStepAfter(action: "ask" | "elsewhere"): GroundDeleteStep {
  return action === "ask" ? "asking" : "idle";
}

/** Does a press at this step actually remove? Only the ask's own remove does. */
export function deleteConfirmed(step: GroundDeleteStep): boolean {
  return step === "asking";
}

interface GroundLayerProps {
  /** Every readable ground reference, in FILE ORDER. */
  references: readonly GroundReference[];
  /** The reading lines, keyed by slug (the handle's source). */
  readings: readonly Reading[];
  /** The reading texts, keyed by slug (a missing text is absent). */
  texts: Readonly<Record<string, string>>;
  /** Each reference's computed reading state (never a record field). */
  states: Readonly<Record<string, ReadingState>>;
  /** Move one reference to its dropped point (one line, on release). */
  onMove: (on: string, x: number, y: number) => Promise<GroundAddResult>;
  /** Re-read this reference's file (the person's press only). */
  onRefresh: (on: string) => Promise<GroundAddResult>;
  /** Point this reference at another file (a new pick, one write). */
  onRepoint: (on: string, from: string) => Promise<GroundAddResult>;
  /** Remove this reference, its reading and its kept text (story 16.3). */
  onRemove: (on: string) => Promise<GroundAddResult>;
  /** How a gesture is armed right now — a drag stands still while armed. */
  interactionMode?: GestureMode;
  /**
   * The camera's zoom, for the drag's screen→world conversion. Optional so a
   * render test needs no plane; the app always passes the real camera.
   */
  zoom?: number;
}

export function GroundLayer({
  references,
  readings,
  texts,
  states,
  onMove,
  onRefresh,
  onRepoint,
  onRemove,
  interactionMode = "idle",
  zoom = 1,
}: GroundLayerProps) {
  const readingsBySlug = new Map(readings.map((reading) => [reading.on, reading]));
  // A refused unlink's one sentence: the card is gone with its records, so the
  // sentence is shown where it stood (view state, cleared by a press or a
  // reload — it is never written anywhere).
  const [refusal, setRefusal] = useState<{
    x: number;
    y: number;
    message: string;
  } | null>(null);

  async function remove(reference: GroundReference): Promise<GroundAddResult> {
    const result = await onRemove(reference.on);
    if (!result.ok && result.recordsRemoved === true) {
      // The card left with its records: show the unlink's one sentence where
      // it stood. A refusal that kept the card shows on the card itself.
      setRefusal({ x: reference.x, y: reference.y, message: result.message });
    } else {
      setRefusal(null);
    }
    return result;
  }

  return (
    <div className="ground-layer">
      {references.map((reference) => (
        <GroundCard
          key={reference.on}
          reference={reference}
          reading={readingsBySlug.get(reference.on) ?? null}
          text={texts[reference.on]}
          state={states[reference.on] ?? (readingsBySlug.has(reference.on) ? "current" : "unread")}
          interactionMode={interactionMode}
          zoom={zoom}
          onMove={onMove}
          onRefresh={onRefresh}
          onRepoint={onRepoint}
          onRemove={remove}
        />
      ))}
      {refusal !== null && (
        <div
          className="ground-problem ground-removal-problem"
          style={{ left: refusal.x, top: refusal.y }}
          role="status"
          onClick={() => setRefusal(null)}
        >
          {refusal.message}
        </div>
      )}
    </div>
  );
}

/**
 * ONE reference's card. It owns its press handling because a drag is per-card
 * state; the layer only hands it records and the person's verbs.
 */
function GroundCard({
  reference,
  reading,
  text,
  state,
  interactionMode,
  zoom,
  onMove,
  onRefresh,
  onRepoint,
  onRemove,
}: {
  reference: GroundReference;
  reading: Reading | null;
  text: string | undefined;
  state: ReadingState;
  interactionMode: GestureMode;
  zoom: number;
  onMove: GroundLayerProps["onMove"];
  onRefresh: GroundLayerProps["onRefresh"];
  onRepoint: GroundLayerProps["onRepoint"];
  onRemove: (reference: GroundReference) => Promise<GroundAddResult>;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<GroundDragState | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // STORY 16.3 — the expanded face and the delete's confirm are VIEW state:
  // neither is a record, and a reopened workspace mounts this card closed.
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<GroundDeleteStep>("idle");

  // Raw listener: d3-zoom stops mousedown at the plane (stopImmediatePropagation),
  // so React's synthetic onMouseDown never fires under it. This raw listener is
  // registered before d3 attaches and stops the press here, so a card press can
  // never pan the plane, count as empty paper or start another gesture.
  useEffect(() => {
    const el = cardRef.current;
    if (!el) return;

    function handleMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      e.stopPropagation();
      // The affordances are ordinary buttons: their own click handlers own the
      // press, and a press on one is never the start of a card drag.
      if ((e.target as HTMLElement).closest("button")) return;
      // While a gesture is armed every plane press stands still — the card's
      // drag included (ADR-0016's gate).
      if (isGestureArmed(interactionMode)) return;

      let drag = beginGroundDrag(
        { x: reference.x, y: reference.y },
        { x: e.clientX, y: e.clientY },
        zoom,
      );
      dragRef.current = drag;

      const onMouseMove = (ev: MouseEvent) => {
        drag = moveGroundDrag(drag, { x: ev.clientX, y: ev.clientY });
        dragRef.current = drag;
        if (drag.moved) setDragPos(drag.at);
      };
      const onMouseUp = () => {
        window.removeEventListener("mousemove", onMouseMove);
        window.removeEventListener("mouseup", onMouseUp);
        const dropped = dropGroundDrag(drag);
        dragRef.current = null;
        setDragPos(null);
        // ONE write, on release: the drag's path is never a record.
        const point = dropped[0];
        if (point) {
          void onMove(reference.on, point.x, point.y);
          return;
        }
        // A press that never moved backs the delete's ask out, or OPENS the
        // card: the expanded face shows the stored reading. A drag never opens
        // (the drop above returns first).
        if (step === "asking") {
          setStep(deleteStepAfter("elsewhere"));
          return;
        }
        setOpen(true);
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  });

  // Click away / Esc closes (and cancels the delete's ask). Capture so a plane
  // press that d3 handles still counts as a press away. While the confirm is
  // asking this listener is live even before the card was expanded.
  useEffect(() => {
    if (!open && step === "idle") return;
    function onPressAway(e: MouseEvent) {
      const el = cardRef.current;
      if (el !== null && e.target instanceof Node && el.contains(e.target)) return;
      setStep("idle");
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      if (step === "asking") {
        setStep("idle");
        return;
      }
      setOpen(false);
    }
    document.addEventListener("mousedown", onPressAway, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPressAway, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, step]);

  // The expanded body scrolls the STORED reading; the plane's wheel zoom must
  // not steal the scroll. Passive: this only stops the plane, never the page.
  useEffect(() => {
    const el = bodyRef.current;
    if (el === null || !open) return;
    function onWheel(e: WheelEvent) {
      e.stopPropagation();
    }
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, [open]);

  const word = readingStateWord(state);
  const x = dragPos ? dragPos.x : reference.x;
  const y = dragPos ? dragPos.y : reference.y;
  const shownText = text === undefined || text === "" ? null : text;
  // The small face is CROPPED by the pure helper; the expanded face is the
  // stored text itself, untouched. Neither path reads anything.
  const bodyText =
    shownText === null ? null : open ? shownText : previewText(shownText);

  async function run(action: () => Promise<GroundAddResult>) {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    const result = await action();
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  }

  async function repoint() {
    if (busy) return;
    const picked = await pickTextFile("point at a file");
    if (picked === null) return;
    await run(() => onRepoint(reference.on, picked));
  }

  async function removeCard() {
    if (busy || !deleteConfirmed(step)) return;
    setBusy(true);
    setProblem(null);
    const result = await onRemove(reference);
    // A refusal that kept the card (the write itself failed) shows here; the
    // refused-unlink sentence is the layer's, because the card is gone with
    // its records.
    if (!result.ok && result.recordsRemoved !== true) {
      setBusy(false);
      setStep("idle");
      setProblem(result.message);
    }
  }

  return (
    <div
      ref={cardRef}
      className={`ground-reference${dragPos ? " dragging" : ""}${
        open ? " expanded" : ""
      }${step === "asking" ? " confirming" : ""}`}
      style={{ left: x, top: y }}
      data-slug={reference.on}
    >
      <div className="ground-name">{reference.name}</div>
      <div className="ground-body" ref={bodyRef}>
        {bodyText !== null && (
          <div className="ground-reading">{bodyText}</div>
        )}
      </div>
      <div className="ground-footer">
        {reading !== null && (
          <div className="ground-handle">
            {readingFileName(reading.from)}
          </div>
        )}
        {word !== null && (
          <div className={`ground-state ${state}`}>{word}</div>
        )}
      </div>
      {problem !== null && (
        <div className="ground-problem" role="status">
          {problem}
        </div>
      )}
      {step === "asking" ? (
        <div className="ground-confirm">
          <div className="ground-confirm-question">
            remove this reference and its reading?
          </div>
          <div className="ground-confirm-actions">
            <button
              type="button"
              className="ground-confirm-remove"
              disabled={busy}
              onClick={() => void removeCard()}
            >
              remove
            </button>
            <button
              type="button"
              className="ground-confirm-cancel"
              disabled={busy}
              onClick={() => setStep(deleteStepAfter("elsewhere"))}
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="ground-actions">
          {reading !== null && (
            <button
              type="button"
              className="ground-refresh"
              disabled={busy}
              onClick={() => void run(() => onRefresh(reference.on))}
            >
              refresh
            </button>
          )}
          <button
            type="button"
            className="ground-repoint"
            disabled={busy}
            onClick={() => void repoint()}
          >
            {reading === null ? "point at a file…" : "point at another file…"}
          </button>
          <button
            type="button"
            className="ground-remove"
            disabled={busy}
            onClick={() => setStep(deleteStepAfter("ask"))}
          >
            remove
          </button>
        </div>
      )}
    </div>
  );
}
