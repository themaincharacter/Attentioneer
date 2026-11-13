import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Distance } from "../map/distances";
import { usePlane } from "./CanvasPlane";
import { useRingMouseDown } from "./ringDrag";
import { distanceLabelVisible } from "./zoomBands";

interface DistanceWireProps {
  distance: Distance;
  /** World point on the origin word's edge. */
  fromPoint: { x: number; y: number };
  /** World point on the destination word's edge. */
  toPoint: { x: number; y: number };
  onChange: (distance: Distance, word: string) => void;
  onRemove: (distance: Distance) => void;
  /** True while this wire carries an open mark (ADR-0009/0010). */
  marked: boolean;
  /** Cast or settle this wire's open mark (story 1's provisional affordance). */
  onToggleMark: () => void;
  /**
   * Start a bind drag from this wire's open ring (story 2; raw mousedown,
   * because d3-zoom stops React's synthetic mouse events).
   */
  onMarkRingDrag?: (distance: Distance, e: MouseEvent) => void;
  /** Vertical spacing when several distances share a pair, so labels don't stack. */
  labelOffset?: number;
}

/**
 * A distance renders as a plain wire (ADR-0006 — no arrowhead; the pair's
 * order lives in the record, not the pixels) plus its coined word at the
 * midpoint. The word hides below the configurable band (zoomBands) while the
 * wire stays. The word is revised in place: re-coin = a new word (a new key);
 * remove = one click, no ceremony. A wire carrying an open mark renders dashed
 * and ringed (ADR-0009/0010), and the ring is the cast/settle affordance.
 *
 * The line is a 1px element stretched with `scaleX`, so following a dragged
 * word costs a compositor transform rather than a layout pass. A marked wire
 * cannot use that trick — `scaleX` would stretch its dashes — so only marked
 * wires set a width (few, and still one element).
 */
export function DistanceWire({
  distance,
  fromPoint,
  toPoint,
  onChange,
  onRemove,
  marked,
  onToggleMark,
  onMarkRingDrag,
  labelOffset = 0,
}: DistanceWireProps) {
  const { camera } = usePlane();
  const inputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(distance.word);
  const editDone = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  // Raw ring mousedown: d3-zoom stops synthetic mouse events, and the press
  // must not pan or re-coin. A marked ring can be dragged onto another target.
  const labelVisible = distanceLabelVisible(camera.zoom);
  const handleRingDown = (e: MouseEvent) => {
    e.stopPropagation();
    if (marked) onMarkRingDrag?.(distance, e);
  };
  const labelMarkRef = useRingMouseDown<HTMLButtonElement>(
    handleRingDown,
    marked && labelVisible,
  );
  const bandRingRef = useRingMouseDown<HTMLButtonElement>(
    handleRingDown,
    marked && !labelVisible,
  );

  const mx = (fromPoint.x + toPoint.x) / 2;
  const my = (fromPoint.y + toPoint.y) / 2;
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  const length = Math.hypot(dx, dy);
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;

  function beginEdit() {
    setDraft(distance.word);
    editDone.current = false;
    setEditing(true);
  }

  function commit() {
    if (editDone.current) return;
    editDone.current = true;
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed && trimmed !== distance.word) {
      onChange(distance, trimmed);
    }
  }

  function cancel() {
    if (editDone.current) return;
    editDone.current = true;
    setEditing(false);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  }

  return (
    <div className="distance">
      <div
        className={`distance-line${marked ? " open" : ""}`}
        style={
          marked
            ? {
                width: length,
                transform: `translate3d(${fromPoint.x}px, ${fromPoint.y}px, 0) rotate(${angle}deg)`,
              }
            : {
                transform: `translate3d(${fromPoint.x}px, ${fromPoint.y}px, 0) rotate(${angle}deg) scaleX(${length})`,
              }
        }
      />
      {labelVisible && (
        <div
          className={`distance-label${marked ? " open" : ""}`}
          style={{ left: mx, top: my + labelOffset, transform: "translate(-50%, -50%)" }}
          onDoubleClick={beginEdit}
        >
          {!editing && (
            <button
              ref={labelMarkRef}
              type="button"
              className={`distance-mark${marked ? " open" : ""}`}
              aria-label={marked ? "settle (withdraw the open mark)" : "mark tentative"}
              title={marked ? "settle" : "mark tentative"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleMark();
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          )}
          {editing ? (
            <input
              ref={inputRef}
              className="distance-coin"
              value={draft}
              placeholder="name the distance…"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={commit}
              onDoubleClick={(e) => e.stopPropagation()}
            />
          ) : (
            <span className="distance-word">{distance.word}</span>
          )}
          <button
            type="button"
            className="distance-remove"
            aria-label="remove distance"
            title="remove"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(distance);
            }}
          >
            ×
          </button>
        </div>
      )}
      {/* Below the label band the word hides, but an open mark stays content:
          keep its ring on the wire's midpoint (ADR-0009). */}
      {!labelVisible && marked && (
        <button
          ref={bandRingRef}
          type="button"
          className="distance-ring"
          style={{ left: mx, top: my + labelOffset }}
          aria-label="settle (withdraw the open mark)"
          title="settle"
          onClick={(e) => {
            e.stopPropagation();
            onToggleMark();
          }}
        />
      )}
    </div>
  );
}