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

  // STORY 25-12 — THE CORNER RESIZE (the person: "resize it by dragging out
  // from the corners"): each corner writes the box in place (the drag idiom,
  // no render), and the page inside re-counts itself (the fill rule). The
  // minimum is one comfortable page (PROVISIONAL).
  const onCornerDown =
    (corner: "nw" | "ne" | "sw" | "se") => (event: React.MouseEvent) => {
      const el = rootRef.current;
      if (!el || event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const startY = event.clientY;
      const at = el.getBoundingClientRect();
      const move = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        let left = at.left;
        let top = at.top;
        let width = at.width;
        let height = at.height;
        if (corner === "se") {
          width = at.width + dx;
          height = at.height + dy;
        }
        if (corner === "sw") {
          left = at.left + dx;
          width = at.width - dx;
          height = at.height + dy;
        }
        if (corner === "ne") {
          top = at.top + dy;
          width = at.width + dx;
          height = at.height - dy;
        }
        if (corner === "nw") {
          left = at.left + dx;
          top = at.top + dy;
          width = at.width - dx;
          height = at.height - dy;
        }
        if (width < 320) {
          if (left !== at.left) left = at.right - 320;
          width = 320;
        }
        if (height < 240) {
          if (top !== at.top) top = at.bottom - 240;
          height = 240;
        }
        el.style.left = left + "px";
        el.style.top = top + "px";
        el.style.width = width + "px";
        el.style.height = height + "px";
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
      {(["nw", "ne", "sw", "se"] as const).map((corner) => (
        <div
          key={corner}
          className={"pin-corner pin-corner-" + corner}
          onMouseDown={onCornerDown(corner)}
        />
      ))}
    </div>
  );

  // (A static render has no document to portal into; the window renders in
  // place there, which is also how the tests read it.)
  return typeof document === "undefined"
    ? frame
    : createPortal(frame, document.body);
}
