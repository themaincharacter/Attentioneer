import { useEffect, useRef, useState } from "react";
import type { GroundReference } from "../map/ground";
import {
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
 * The ground map's own layer (story 16.1; story 16.2 makes the card live).
 *
 * The separate-maps rule (ADR-0032, `canvas/mapContentRules.ts`) keeps every
 * CONCEPT-map family off this map; this layer is the ground map's counterpart,
 * a sibling of the words and wires rather than a reuse of them. It draws one
 * ground reference per record: the person's coined name, the pointed-at file's
 * opening lines beneath it in a quiet body size, and the file's NAME (never
 * the full path) as the quiet handle. Nothing counts, sums or nudges; nothing
 * is inferred — every string here is either the person's words or bytes read
 * from the file they picked.
 *
 * STORY 16.2 adds three things, all QUIET and all the person's:
 *   - the STATE WORD, computed at load (current says nothing; changed, missing,
 *     unreadable and unread each say one small line of type). No badge, no
 *     count, no colour code beyond the type itself.
 *   - a DRAG: a press on the card moves it and the release writes its ONE
 *     `x | y` line through the app's queue (`groundDrag.ts` owns the rule; the
 *     raw listener is here because d3-zoom stops React's synthetic events). A
 *     press that never moves commits nothing, and it must never pan the plane,
 *     open the creation bubble or start a pen stroke (the gate's content list
 *     plus the raw listener's stop).
 *   - two affordances: REFRESH (the only re-read there is; re-takes this file's
 *     head by the person's press) and POINT AT ANOTHER FILE (a new pick, the
 *     same write path as an add). A refusal shows ONE sentence in place and
 *     keeps the old reading. Nothing watches, polls or re-reads on open.
 *
 * PROVISIONAL: the look (the state words, the two actions, the drag threshold
 * in `groundDrag.ts`) is ADR-0003's rendering seam and story 16.2's decisions.
 */
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
  interactionMode = "idle",
  zoom = 1,
}: GroundLayerProps) {
  const readingsBySlug = new Map(readings.map((reading) => [reading.on, reading]));
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
        />
      ))}
    </div>
  );
}

/**
 * ONE reference's card. It owns its press handling because a drag is per-card
 * state; the layer only hands it records and the two write verbs.
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
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<GroundDragState | null>(null);
  const [dragPos, setDragPos] = useState<Point | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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
      // The two affordances are ordinary buttons: their own click handlers own
      // the press, and a press on one is never the start of a card drag.
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
        if (point) void onMove(reference.on, point.x, point.y);
      };
      window.addEventListener("mousemove", onMouseMove);
      window.addEventListener("mouseup", onMouseUp);
    }

    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  });

  const word = readingStateWord(state);
  const x = dragPos ? dragPos.x : reference.x;
  const y = dragPos ? dragPos.y : reference.y;

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

  return (
    <div
      ref={cardRef}
      className={`ground-reference${dragPos ? " dragging" : ""}`}
      style={{ left: x, top: y }}
      data-slug={reference.on}
    >
      <div className="ground-name">{reference.name}</div>
      {text !== undefined && text !== "" && (
        <div className="ground-reading">{text}</div>
      )}
      {reading !== null && (
        <div className="ground-handle">
          {readingFileName(reading.from)}
        </div>
      )}
      {word !== null && (
        <div className={`ground-state ${state}`}>{word}</div>
      )}
      {problem !== null && (
        <div className="ground-problem" role="status">
          {problem}
        </div>
      )}
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
      </div>
    </div>
  );
}
