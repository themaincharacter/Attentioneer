import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import type { MarkTarget } from "../map/marks";
import type { Point } from "./geometry";

/**
 * Ring drag (Epic 3 story 2): dragging any open-mark ring binds it. The same
 * physical move covers both directions (map ticket 03) — onto a word or wire
 * to bind, off onto the plane to leave it bare again — so the drag only reports
 * the drop point; the canvas resolves the target and moves the one mark in one
 * write (ADR-0009).
 *
 * The mousedown must be a raw listener on the ring: d3-zoom's plane handler
 * stops immediate propagation on mousedown, so React's synthetic mouse events
 * never fire under it (the journal's d3-zoom discipline). A drag's trailing
 * click is suppressed so it cannot also toggle/settle the ring.
 */

/** Screen pixels of movement before a press on a ring becomes a bind drag. */
export const RING_DRAG_THRESHOLD = 4;

/** How long after a drag a ring click is ignored (it is the drag's own click). */
const CLICK_SUPPRESS_MS = 350;

export interface RingDrag {
  /** Start a drag from `source` on the ring's raw mousedown event. */
  begin: (source: MarkTarget, e: MouseEvent) => void;
  /** Client-space ghost position while a ring is in flight, else null. */
  ghost: Point | null;
  /** True just after a drag ended — a ring click then is the drag's own click. */
  isClickSuppressed: () => boolean;
}

/**
 * The canvas owns the one in-flight ring drag: it follows the pointer with a
 * ghost and reports the drop point in world coordinates. `toWorld` returns
 * null if the plane is not measurable (nothing is dropped).
 */
export function useRingDrag(
  onDrop: (source: MarkTarget, point: Point) => void,
  toWorld: (clientX: number, clientY: number) => Point | null,
): RingDrag {
  const [ghost, setGhost] = useState<Point | null>(null);
  const suppressUntilRef = useRef(0);

  const isClickSuppressed = useCallback(
    () => Date.now() < suppressUntilRef.current,
    [],
  );

  const begin = useCallback(
    (source: MarkTarget, e: MouseEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startY = e.clientY;
      let moved = false;
      let frame: number | null = null;
      let latest = { x: startX, y: startY };

      const flush = () => {
        frame = null;
        setGhost(latest);
      };

      const onMove = (ev: MouseEvent) => {
        latest = { x: ev.clientX, y: ev.clientY };
        if (!moved) {
          if (Math.hypot(latest.x - startX, latest.y - startY) <= RING_DRAG_THRESHOLD) {
            return;
          }
          moved = true;
          setGhost(latest);
          return;
        }
        if (frame === null) frame = requestAnimationFrame(flush);
      };

      const onUp = (ev: MouseEvent) => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        if (frame !== null) cancelAnimationFrame(frame);
        setGhost(null);
        if (!moved) return;
        suppressUntilRef.current = Date.now() + CLICK_SUPPRESS_MS;
        const point = toWorld(ev.clientX, ev.clientY);
        if (point) onDrop(source, point);
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onDrop, toWorld],
  );

  return { begin, ghost, isClickSuppressed };
}

/**
 * A raw mousedown listener for a ring element (see the d3-zoom note above).
 * `enabled` lets a hover-only ring stay a plain button until it carries a mark.
 */
export function useRingMouseDown<T extends HTMLElement>(
  onDown: (e: MouseEvent) => void,
  enabled = true,
): RefObject<T | null> {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || !enabled) return;
    el.addEventListener("mousedown", onDown);
    return () => el.removeEventListener("mousedown", onDown);
  }, [onDown, enabled]);

  return ref;
}
