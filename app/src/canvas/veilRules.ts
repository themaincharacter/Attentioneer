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
 * which is the sanctioned look-under.
 *
 * EPIC 9 STORY 2 adds the look-under itself: a READ-ONLY transient that lifts
 * ONE veil's cover for a reading of its name and reason (the window's close
 * idioms: Esc, ×, click-away, level switch). It is never a second gate mode —
 * presses inside its card are content like every other card — and the lift is
 * VISIBILITY ONLY: the covered word keeps its own quiet (ghosted/dashed when
 * marked) and the lifted word takes no press, because editing covered content
 * is what RETIRING the veil is for. `lookUnderLive` is the same level reading
 * as the sheet's, so ground shows neither cover nor look-under through the
 * veil. The name/reason counter-scale is the window idiom (`counterScale`).
 *
 * Provisional (ADR-0023): the box-vs-stroke shape, the minimum drawable box,
 * the sheet's look, the look-under's look and the counter-scale values.
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

/* ------------------------------------------------------------------------- *
 * Epic 9 story 2: the look-under and the ground gate (ADR-0023 decisions 2–3).
 * ------------------------------------------------------------------------- */

/**
 * May the look-under open in this game? ONE reading with the sheet's:
 * `veilLive`. The ground gate is the story's second half — at ground there is
 * no sheet, so there is no cover to open and the veil offers no door. There the
 * game switch IS the look-under: the person's own move, and the covered words
 * simply read normally (the region test is render-time and level-gated, never a
 * record).
 */
export function lookUnderLive(level: Level): boolean {
  return veilLive(level);
}

/** The FOUR ways out of the look-under (ADR-0023 decision 3 — the window's close idioms). */
export type LookUnderClose = "escape" | "close" | "outside" | "level-switch";

export const LOOK_UNDER_CLOSES: readonly LookUnderClose[] = [
  "escape",
  "close",
  "outside",
  "level-switch",
];

/**
 * Does this act close the look-under? All four idioms do, and there is no
 * fifth way out: the transient is opened on purpose and ends on the person's
 * dismissal (Esc, the ×, a press away) or on the game switch, which closes
 * every transient through the app's one switch path.
 */
export function closesLookUnder(act: LookUnderClose): boolean {
  return LOOK_UNDER_CLOSES.includes(act);
}

/** Why the look-under closed: a dismissal, or a level switch (the window's two). */
export type LookUnderCloseReason = "dismiss" | "switch-level";

/** The reason a close act carries: the level switch is the one not a dismissal. */
export function lookUnderCloseReason(act: LookUnderClose): LookUnderCloseReason {
  return act === "level-switch" ? "switch-level" : "dismiss";
}

/**
 * Where focus returns when the look-under closes (the window's rule, mirrored):
 * the veil's own sheet on a dismissal — the person was reading that area — and
 * the level control on a switch, because a game change moved focus there in
 * every other transient's close.
 */
export function focusAfterLookUnderClose(
  reason: LookUnderCloseReason,
): "sheet" | "level" {
  return reason === "switch-level" ? "level" : "sheet";
}

/**
 * The selector the focus step uses. The sheet is the veil's focusable slot (a
 * world-space area addressed by its natural key); the level control's active
 * game button is the selector every other close already uses.
 */
export function lookUnderFocusSelector(
  target: "sheet" | "level",
  key: string | null = null,
): string {
  if (target === "sheet" && key !== null && key !== "") {
    return '[data-veil="' + key + '"]';
  }
  return ".level-control .level-game.active";
}

/**
 * The window idiom's counter-scale: a world-anchored card divides by the
 * camera's zoom, so it stays readable at every band and never grows anything on
 * the plane. A non-positive zoom (impossible from the camera; a hand-set camera
 * could say it) reads 1 — never a mirrored or vanished card.
 */
export function counterScale(zoom: number): number {
  return zoom > 0 ? 1 / zoom : 1;
}

/**
 * Where the look-under hangs: the middle of the veil's RIGHT edge — the
 * window's left-centre idiom — so the card sits beside the area it reads
 * instead of over the cover. Provisional: the anchor, and no viewport clamp
 * (the veil was drawn on screen moments before it is read).
 */
export function lookUnderAnchor(box: VeilBox): { x: number; y: number } {
  return { x: box.x + box.w, y: box.y + box.h / 2 };
}

/**
 * What the look-under offers: a READ, its close, and (PROVISIONAL) the veil's
 * rename. It never edits what is covered — the veil is retired to work there —
 * and it never re-states the reason: the reason is the person's prose (World
 * B), shown verbatim. Enumerated so the read-only rule is a named contract, not
 * a habit: a new affordance has to be added here on purpose.
 */
export const LOOK_UNDER_AFFORDANCES = ["read", "close", "rename"] as const;
export type LookUnderAffordance = (typeof LOOK_UNDER_AFFORDANCES)[number];

/** The look-under's quiet aria label: the veil's coined name. */
export function lookUnderLabel(name: string): string {
  return "the look-under on “" + name + "”";
}
