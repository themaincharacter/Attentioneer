import type { Level } from "../workspace/level";
import type { VeilBox } from "../map/veils";

/**
 * The draw-box gesture's pure rules and the veil's render gate (Epic 9 story 1,
 * ADR-0023). The gesture itself is the plane's: the person arms it from the
 * level control, drags a rectangle on empty plane and the captured BOX bounds
 * are reported. This module owns only what can be decided without a DOM — the
 * box a drag encloses, when a drag is a box at all, and which game shows the
 * sheet.
 *
 * THE ARM IS SEPARATE FROM THE SELECTOR'S LASSO (the story's provisional
 * decision). The lasso is armed inside the playing-set selector — a
 * dynamics-only surface that NARROWS the set with a polygon of sampled points
 * — and the veil must work at concept AND dynamics, where no selector exists.
 * Sharing the arm would either drag the selector into concept or make the veil
 * dynamics-only. So the veil is its own gate mode (`"veil"`, gates.ts) and its
 * own `boxArmed` prop on the plane; only the DRAG MACHINERY is shared (one
 * pointer capture, two releases: the lasso's polygon, the box's bounds). While
 * the veil is armed the plane's own gestures stand still through the gate's
 * existing rules — pan (`shouldPan`), double-click creation (`shouldCreate`)
 * and every word press (`shouldStartWordPress`) are false — so a box drag can
 * never move a word or open the ring menu.
 *
 * LEVELS 1–2 ONLY (ADR-0023 decision 2): the sheet renders at concept and
 * dynamics, never at ground. `veilLive` is the ONE reading; the render and the
 * arm's door both ask it, so ground can neither show a sheet nor coin one. The
 * ground gate is the game switch: the person moves the game to lift the cover,
 * which is the sanctioned look-under (Epic 9 story 2 builds the transient).
 *
 * Provisional (ADR-0023): the box-vs-stroke shape, the minimum drawable box,
 * and the sheet's look.
 */

/** The games a veil's sheet renders in, and that may coin one. */
export const VEIL_LEVELS: readonly Level[] = ["concept", "dynamics"];

/**
 * Does the veil live in this game? ONE reading for the render (a sheet at
 * concept and dynamics, never at ground) and for the arm's door (no veil is
 * coined at ground either — a cover that could never show is not authored).
 */
export function veilLive(level: Level): boolean {
  return VEIL_LEVELS.includes(level);
}

/** A drag's two corners, in world space, in any order. */
export function capturedBox(
  start: { x: number; y: number },
  end: { x: number; y: number },
): VeilBox {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  return {
    x,
    y,
    w: Math.abs(end.x - start.x),
    h: Math.abs(end.y - start.y),
  };
}

/**
 * Is this drag a box at all? A press that never moved (or a sliver) encloses no
 * area and reports nothing: a click must stay a click. The threshold is in
 * world units and deliberately tiny — the gesture's job is to catch what the
 * person drew, not to insist on a size.
 */
export function boxIsDrawable(box: VeilBox): boolean {
  return box.w > 0 && box.h > 0;
}
