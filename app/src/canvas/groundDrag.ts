import type { Point } from "./geometry";

/**
 * A ground card's drag (story 16.2 decision 6): the card is pressable, and a
 * drag moves it — but the record is written ONCE, on release, not on every
 * frame. This module is the pure rule, beside the layer, the same way
 * `ringDrag` separates the ring's bind math from its DOM listeners; the layer
 * owns the raw mouse listeners (d3-zoom stops React's synthetic events) and
 * this owns "did this become a drag, and where did it land?".
 *
 * STORY 16.23 — ONE RULE FOR ALL THREE KINDS. A reference, an ask and a session
 * card are peers on the same map, so they share this one threshold and this one
 * raw-listener wiring: `attachGroundCardDrag` below is the ONLY place the
 * press, the threshold and the one write on release are joined, and each card
 * component reaches it through that one call. A card's name pill is a child of
 * the card, so a press on the name lands here exactly as a press on the body
 * does — one handle, never a second pointer capture.
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

/**
 * STORY 16.23 — THE CARD'S ONE RAW PRESS->DRAG WIRING, shared by all three
 * card kinds. d3-zoom stops mousedown at the plane, so a card registers its own
 * raw listener; that listener is the same for a reference, an ask and a
 * session because the RULE is the same. The caller owns what the card is (its
 * stored point, its door) and this owns the press, the threshold, the live
 * preview and the single write on release.
 *
 * The door rule stays the caller's: a press that crosses the threshold is a
 * drag and calls `onDrop` ONCE; a press that never moved calls `onClick` (with
 * whether it landed on the name pill), so every card's owner decides what its
 * door is. `ignores` is the
 * caller's list of surfaces a press must never drag (a button, a field, an open
 * card's selection), and `isArmed` is the gesture gate: while a tool is armed
 * every press stands still.
 *
 * The returned function is the effect's cleanup: the listener leaves with the
 * card. PROVISIONAL: the wiring style (raw listeners, like the rest of the
 * card's press handling), not the rule.
 */
export interface GroundCardDragOptions {
  /** The card's stored world point, read at press (fresh through a ref). */
  readonly at: () => Point;
  /** The camera's zoom at press (world = delta / zoom). */
  readonly zoom: () => number;
  /** The live preview point while dragging; null when the drag ends. */
  readonly onPreview: (at: Point | null) => void;
  /** The drop: ONE point, once, when the press became a drag. */
  readonly onDrop: (at: Point) => void;
  /** The press crossed the threshold (the gesture chip's one sentence). */
  readonly onMoved?: () => void;
  /** The press ended: `moved` says whether a drop followed. */
  readonly onRelease?: (moved: boolean) => void;
  /** The press was a click, not a drag: the caller's door, if it has one. */
  readonly onClick?: (onPill: boolean) => void;
  /** An armed gesture stands every press still (ADR-0016's gate). */
  readonly isArmed?: () => boolean;
  /** A surface this card's press never drags (its buttons, fields, selection). */
  readonly ignores?: (target: HTMLElement) => boolean;
}

/**
 * Wire one card element to the one drag rule. Returns the cleanup that removes
 * the listener; the caller runs it in an effect, as every raw listener here
 * does. The link handle is never a card press: its own gesture owns that press,
 * so this leaves it alone.
 */
export function attachGroundCardDrag(
  el: HTMLElement,
  options: GroundCardDragOptions,
): () => void {
  function handleMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    const target = e.target as HTMLElement;
    // The wiring handle is its OWN gesture (linkDrag.ts); a press there must
    // not also start a move.
    if (target.closest(".ground-link-handle") !== null) return;
    // The card's press stands still for the plane: this raw listener runs
    // before d3's and stops the press here, so a drag never pans.
    e.stopPropagation();
    if (target.closest("button, textarea, input") !== null) return;
    if (options.ignores?.(target) === true) return;
    if (options.isArmed?.() === true) return;

    // A press on the name pill is the HANDLE, not the door: it rides this same
    // rule, and a click that never moved on it opens nothing.
    const onPill = target.closest(".ground-pill") !== null;

    let drag = beginGroundDrag(
      options.at(),
      { x: e.clientX, y: e.clientY },
      options.zoom(),
    );

    const onMouseMove = (ev: MouseEvent): void => {
      const wasMoving = drag.moved;
      drag = moveGroundDrag(drag, { x: ev.clientX, y: ev.clientY });
      if (drag.moved && !wasMoving) options.onMoved?.();
      if (drag.moved) options.onPreview(drag.at);
    };
    const onMouseUp = (): void => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      const dropped = dropGroundDrag(drag);
      const moved = dropped.length > 0;
      options.onPreview(null);
      options.onRelease?.(moved);
      const point = dropped[0];
      if (point !== undefined) {
        // ONE write, on release: the drag's path is never a record.
        options.onDrop(point);
        return;
      }
      // A press that never moved is the card's door (the caller decides what
      // that means; a pill press opens nothing).
      if (!onPill) options.onClick?.(onPill);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  el.addEventListener("mousedown", handleMouseDown);
  return () => el.removeEventListener("mousedown", handleMouseDown);
}
