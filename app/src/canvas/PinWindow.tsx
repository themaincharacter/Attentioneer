import { useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { groundDisplayName } from "../map/ground";

/**
 * STORY 25-11 (ADR-0047) — THE PIN WINDOW: a card kept open on the glass.
 * It looks the same as the expanded card (the face arrives as children — the
 * card's OWN face, rendered twice), floats over the SCREEN in a fixed seat,
 * moves by its header (the body is text to select, the cards' own rule), and
 * disappears on the close or the card's unpin. The pair — this window and the
 * card on the bench — share one gold edge in the kept ink. PROVISIONAL: the
 * seat and the size (the corner resize comes with story 25-12).
 */
export function PinWindow({
  name,
  onClose,
  children,
}: {
  name: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);

  // The window follows the HAND (the drag idiom: one listener per press, the
  // element written in place, no render).
  const onHeadDown = (event: React.MouseEvent) => {
    const el = rootRef.current;
    if (!el || event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const at = el.getBoundingClientRect();
    const move = (ev: MouseEvent) => {
      el.style.left = at.left + (ev.clientX - startX) + "px";
      el.style.top = at.top + (ev.clientY - startY) + "px";
    };
    const up = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const frame = (
    <div
      ref={rootRef}
      className="pin-window"
      role="dialog"
      aria-label={groundDisplayName(name)}
      style={{ left: 220, top: 120 }}
    >
      <div className="pin-window-head" onMouseDown={onHeadDown}>
        <span className="ground-name pin-window-name">
          {groundDisplayName(name)}
        </span>
        <button
          type="button"
          className="pin-window-close verb-key"
          aria-label="close the pinned window"
          onClick={onClose}
        >
          &times;
        </button>
      </div>
      <div className="pin-window-body">{children}</div>
    </div>
  );

  // (A static render has no document to portal into; the window renders in
  // place there, which is also how the tests read it.)
  return typeof document === "undefined"
    ? frame
    : createPortal(frame, document.body);
}
