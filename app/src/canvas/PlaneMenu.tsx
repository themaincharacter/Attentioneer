import { useEffect, useRef } from "react";
import { usePlane } from "./CanvasPlane";

interface PlaneMenuProps {
  /** Plane point the menu is anchored to; its center dot sits exactly there. */
  x: number;
  y: number;
  /** Coin a word at the point — the in-place coin field takes over. */
  onWord: () => void;
  /** Cast a bare open mark (a lack) at the point — the quiet ring. */
  onLack: () => void;
  /** Dismiss without creating anything (Esc or a press outside the ring). */
  onClose: () => void;
}

/**
 * The double-click creation menu (Epic 3 feedback): a small ring at the plane
 * point with two quiet choices — coin a word, or cast a bare lack. Story 2's
 * single-click cast is gone; creation begins only here, so a stray click can
 * no longer leave a mark behind.
 *
 * The ring is a dark quiet panel on the paper plane; the center dot marks the
 * exact anchor. It lives inside `.plane-inner`, so it follows the map the way
 * the coin fields do and renders above words and wires; it counter-scales
 * against the camera so a choice stays readable at every zoom. Esc or a press
 * anywhere outside dismisses it; both choices are real buttons, reachable by
 * Tab and activated by Enter or Space. The raw mousedown listener keeps the
 * press from reaching d3-zoom (no pan) and the plane's press counter (the
 * d3-zoom discipline in ringDrag.ts).
 */
export function PlaneMenu({ x, y, onWord, onLack, onClose }: PlaneMenuProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLButtonElement>(null);

  // Focus the first choice on open: keyboard users can act immediately. The
  // focus ring is drawn only for keyboard focus (:focus-visible).
  useEffect(() => {
    wordRef.current?.focus();
  }, []);

  // Click-away in the capture phase: d3-zoom stops propagation on the plane's
  // mousedown, so a bubble-phase document listener would never hear a plane
  // press. A press inside the ring is not an away-press.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  // Esc dismisses; nothing is written.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Raw listener: the press must not pan the plane or count as a plane press.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  return (
    <div
      ref={rootRef}
      className="plane-menu"
      style={{
        left: x,
        top: y,
        // The plane-inner is scaled by the camera; undo that so the ring stays
        // a readable screen-size menu while its center dot stays on the anchor.
        transform: `translate(-50%, -50%) scale(${1 / camera.zoom})`,
      }}
      role="group"
      aria-label="create at this point"
    >
      <button
        ref={wordRef}
        type="button"
        className="plane-menu-option"
        aria-label="coin a word here"
        title="coin a word here"
        onClick={onWord}
      >
        word
      </button>
      <span className="plane-menu-dot" aria-hidden="true" />
      <button
        type="button"
        className="plane-menu-option"
        aria-label="cast a lack here"
        title="cast a lack here"
        onClick={onLack}
      >
        lack
      </button>
    </div>
  );
}
