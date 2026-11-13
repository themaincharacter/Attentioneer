import type { MouseEvent as ReactMouseEvent } from "react";
import { useRingMouseDown } from "./ringDrag";

interface LackMarkProps {
  /** World point of the bare spot (the ring is centred on it). */
  x: number;
  y: number;
  /** Withdraw the mark: settle is deletion, no tombstone (ADR-0009). */
  onWithdraw: () => void;
  /** Name it in place: grow the lack into a question-word (map ticket 03). */
  onGrow: () => void;
  /** Begin a bind drag from this ring (raw mousedown; see ringDrag.ts). */
  onDragStart: (e: MouseEvent) => void;
}

/**
 * A bare open mark at a spot of plane — the pre-verbal felt lack (ADR-0009:
 * a mark lands on a word, a wire, or a bare spot; ticket 03). Rendering is one
 * quiet hollow ring, the same glyph as an attached mark: no field, no name, no
 * count, no glow. Ignorance is content, so it stays until the person moves it.
 *
 * Gestures (kept quiet, discoverable on hover):
 * - drag (>4px) onto a word or wire binds it; dropping on the plane leaves it
 *   bare at the drop point (binding and unbinding are the same physical move);
 * - double-click the ring names it in place: a reference is coined at the spot
 *   and the mark retargets to it in one composed move;
 * - hover × withdraws (settles) it; a plain click is a quiet no-op.
 */
export function LackMark({ x, y, onWithdraw, onGrow, onDragStart }: LackMarkProps) {
  const handleDown = (e: MouseEvent) => {
    // The × is its own button: never start a bind drag from it.
    if ((e.target as HTMLElement).closest(".lack-withdraw")) {
      e.stopPropagation();
      return;
    }
    onDragStart(e);
  };
  const ringRef = useRingMouseDown<HTMLDivElement>(handleDown);

  function handleDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    e.stopPropagation();
    onGrow();
  }

  return (
    <div
      ref={ringRef}
      className="lack-mark"
      style={{ left: x, top: y }}
      role="button"
      aria-label="an open mark — drag to bind it, double-click to name it"
      title="a lack — double-click to name it"
      onDoubleClick={handleDoubleClick}
    >
      <button
        type="button"
        className="lack-withdraw"
        aria-label="withdraw the lack (settle it)"
        title="withdraw"
        onClick={(e) => {
          e.stopPropagation();
          onWithdraw();
        }}
      >
        ×
      </button>
    </div>
  );
}
