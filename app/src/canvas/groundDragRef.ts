import type { Point } from "./geometry";

/**
 * STORY 16.25 — THE DRAG'S LIVE POSITION IS NOT REACT STATE.
 *
 * A press that becomes a move used to write a piece of component state on every
 * pointer event. One pointer event, one React render of the whole card — its
 * pill, its note, its reading and every chip in it — for a card that was only
 * being carried across the paper. Measured on a 60-event drag: 60 renders of
 * the dragged card per drag, and ZERO updates to the wires, because the wires
 * read the RECORDS. That second number is the other half of the person's
 * report: the card trailed the hand while the wire stood still until the drop.
 *
 * So the live drag leaves React. Two things carry it while the hand is down:
 *
 *   1. THE ELEMENT. The drawn card is moved by writing its own `left`/`top`
 *      (the same two properties React writes for it, so nothing is translated
 *      twice and a re-render of the map cannot undo the frame). React's style
 *      diffing compares the value it last RENDERED with the next one, so an
 *      unchanged record point never overwrites these writes.
 *   2. THE CHANNEL. One in-flight point, shared by the dragged card and the
 *      wires: the card publishes it every frame, and a wire repaints only when
 *      the drag's slug is one of its own two ends. The wires READ it in a
 *      subscriber, they do not re-render.
 *
 * ONE COMMIT. On release the record's own write runs (unchanged: one line, one
 * `card.move`, the same no-op rule), and the point the record will hold is
 * published instead of the raw drop — whole map units, exactly what
 * `moveGroundReference` rounds to — so the card and its wires land where they
 * stay instead of flicking through the unrounded point.
 *
 * PROVISIONAL: the channel shape (a subscribable shared point) and the element
 * framing (left/top rather than a transform), not the rule.
 */

/** One in-flight drag: which card is under the hand, and where it is now. */
export interface GroundDragAt {
  readonly slug: string;
  readonly x: number;
  readonly y: number;
}

/**
 * The shared point. `publish(null)` means "the hand is up": every wire goes
 * back to its records, and the card's frame is released by its own owner.
 */
export interface GroundDragChannel {
  /** The live point, or null when nothing is being dragged. */
  at(): GroundDragAt | null;
  /** Publish one frame (or null on release); subscribers run synchronously. */
  publish(at: GroundDragAt | null): void;
  /** Read every frame; the answer removes this listener. */
  subscribe(listener: (at: GroundDragAt | null) => void): () => void;
}

/**
 * One channel per mounted map. The app makes it ONCE and hands it to the wires
 * and the layer, so the two halves of the story share one point; a render test
 * may make its own and drive it by hand.
 */
export function createGroundDragChannel(): GroundDragChannel {
  let current: GroundDragAt | null = null;
  const listeners = new Set<(at: GroundDragAt | null) => void>();
  return {
    at: () => current,
    publish(at) {
      current = at;
      // Copy: a listener that unsubscribes while being told is not a surprise.
      for (const listener of [...listeners]) listener(at);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * THE CARD'S FRAME, written where the record cannot undo it: the element's own
 * coordinates and the `.dragging` cursor class. React never rendered the class
 * either, so nothing here is a second truth about the card's record — the
 * record still holds the point it held until the drop.
 */
export function frameGroundCard(el: HTMLElement | null, at: Point): void {
  if (el === null) return;
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  el.classList.add("dragging");
}

/**
 * Put the frame back on the record's own point and take the cursor off. The
 * caller answers the record's point, so this is also how a refused write and a
 * drop that rounded onto the card's own point are put back: the map never shows
 * a point the file does not hold.
 */
export function settleGroundCard(el: HTMLElement | null, at: Point): void {
  if (el === null) return;
  el.style.left = `${at.x}px`;
  el.style.top = `${at.y}px`;
  el.classList.remove("dragging");
}

/** Any card a wire may run to, as the wire sees it (its slug and point). */
export interface GroundDragEnd {
  readonly on: string;
  readonly x: number;
  readonly y: number;
}

/**
 * A WIRE'S TWO ENDS UNDER THE LIVE DRAG, PURE. The dragged card's end takes the
 * frame's point; the other end is the record's, untouched. A wire the drag does
 * not name comes back exactly as it went in, which is how a wire decides in one
 * comparison whether it has anything to do this frame.
 */
export function wireEndsUnderDrag<T extends GroundDragEnd>(
  from: T,
  to: T,
  at: GroundDragAt | null,
): { from: T; to: T } {
  if (at === null) return { from, to };
  if (from.on === at.slug) return { from: { ...from, x: at.x, y: at.y }, to };
  if (to.on === at.slug) return { from, to: { ...to, x: at.x, y: at.y } };
  return { from, to };
}
