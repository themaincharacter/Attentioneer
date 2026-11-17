import type { Point } from "./geometry";

/**
 * A ground reference's drag (story 16.2 decision 6): the card is pressable, and
 * a drag moves it — but the record is written ONCE, on release, not on every
 * frame. This module is the pure rule, beside the layer, the same way
 * `ringDrag` separates the ring's bind math from its DOM listeners; the layer
 * owns the raw mouse listeners (d3-zoom stops React's synthetic events) and
 * this owns "did this become a drag, and where did it land?".
 *
 * The threshold is SCREEN pixels, so a press at any zoom stays a press until
 * the hand actually moves; the world delta is divided by the camera's zoom
 * exactly as the word drag does. A press that never crosses the threshold is
 * not a drag and commits nothing — it must not pan the plane, open the
 * creation bubble or start a pen stroke either (the card's raw listener stops
 * the press, and its classes are on the gate's content list).
 *
 * PROVISIONAL: the threshold (a feel constant, like the word drag's).
 */

/** Screen pixels of movement before a press on a reference becomes a drag. */
export const GROUND_DRAG_THRESHOLD = 4;

/** One in-flight drag: where it started and where the pointer is now. */
export interface GroundDragState {
  /** The reference's world point when the press landed. */
  readonly from: Point;
  /** The press's screen point (the delta's origin). */
  readonly pressX: number;
  readonly pressY: number;
  /** The camera's zoom when the press landed (world = delta / zoom). */
  readonly zoom: number;
  /** The press has crossed the threshold: this is a drag, not a click. */
  readonly moved: boolean;
  /** The live world point (meaningful once `moved`). */
  readonly at: Point;
}

/** Begin a drag from a reference at `from` and the pointer's screen point. */
export function beginGroundDrag(
  from: Point,
  client: Point,
  zoom: number,
): GroundDragState {
  return {
    from,
    pressX: client.x,
    pressY: client.y,
    zoom,
    moved: false,
    at: from,
  };
}

/**
 * Track the pointer. Before the threshold this answers the SAME state (a press
 * is still a press); after it, the live world point. One rule for both the
 * preview and the drop, so they cannot disagree.
 */
export function moveGroundDrag(
  state: GroundDragState,
  client: Point,
  threshold: number = GROUND_DRAG_THRESHOLD,
): GroundDragState {
  const dx = client.x - state.pressX;
  const dy = client.y - state.pressY;
  const moved = state.moved || Math.hypot(dx, dy) > threshold;
  if (!moved) return state;
  return {
    ...state,
    moved: true,
    at: {
      x: state.from.x + dx / state.zoom,
      y: state.from.y + dy / state.zoom,
    },
  };
}

/**
 * The drop's commit: ONE point when the press became a drag, NOTHING when it
 * stayed a click. The layer calls this once, on mouseup, with the final state —
 * so the record's write is one line, whatever the pointer did on the way.
 */
export function dropGroundDrag(state: GroundDragState): readonly Point[] {
  return state.moved ? [state.at] : [];
}
