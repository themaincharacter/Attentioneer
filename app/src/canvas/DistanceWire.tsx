import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import type { Distance } from "../map/distances";
import { usePlane } from "./CanvasPlane";
import { distanceLabelVisible } from "./zoomBands";

interface DistanceWireProps {
  distance: Distance;
  /** World point on the origin word's edge. */
  fromPoint: { x: number; y: number };
  /** World point on the destination word's edge. */
  toPoint: { x: number; y: number };
  onChange: (distance: Distance, word: string) => void;
  onRemove: (distance: Distance) => void;
}

/**
 * A distance renders as a plain wire (ADR-0006 — no arrowhead; the pair's
 * order lives in the record, not the pixels) plus its coined word at the
 * midpoint. The word hides below the configurable band (zoomBands) while the
 * wire stays. The word is revised in place: re-coin = a new word (a new key);
 * remove = one click, no ceremony.
 *
 * The line is a 1px element stretched with `scaleX`, so following a dragged
 * word costs a compositor transform rather than a layout pass.
 */
export function DistanceWire({
  distance,
  fromPoint,
  toPoint,
  onChange,
  onRemove,
}: DistanceWireProps) {
  const { camera } = usePlane();
  const inputRef = useRef<HTMLInputElement>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(distance.word);
  const editDone = useRef(false);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const labelVisible = distanceLabelVisible(camera.zoom);

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
        className="distance-line"
        style={{
          transform: `translate3d(${fromPoint.x}px, ${fromPoint.y}px, 0) rotate(${angle}deg) scaleX(${length})`,
        }}
      />
      {labelVisible && (
        <div
          className="distance-label"
          style={{ left: mx, top: my, transform: "translate(-50%, -50%)" }}
          onDoubleClick={beginEdit}
        >
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
    </div>
  );
}