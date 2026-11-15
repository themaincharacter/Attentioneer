/**
 * The interaction-mode gate (ADR-0016, decision 4). One plane, two games:
 * while a gesture is armed the plane's own gestures stand still — word press
 * behaviors, pan and creation all suspend — and the armed gesture owns the
 * pointer. The selector is the first mode; `sign-choice` (a link's sign, story
 * 2) is the second; `path` (loop authoring) arrives in story 3, named now so
 * the seam is one module instead of conditionals threaded through old handlers.
 *
 * The gate also owns the content-element list: presses on content are never
 * plane gestures. New canvas elements join `CONTENT_CLASSES` as they land, and
 * a selector's elements join `WORD_CONTROL_CLASSES` too — the same early-return
 * list the word handler uses for the memory dot and the connect handle.
 *
 * Pure: no DOM, no React. `ClassListLike` is satisfied by a DOMTokenList, so
 * the handlers can pass the real thing and tests can pass a plain stub.
 */

/** How a gesture is armed right now. Idle is the plain canvas. */
export type GestureMode = "idle" | "selector" | "path" | "sign-choice";

/** The one method the gate needs from a class list (a DOMTokenList works). */
export interface ClassListLike {
  contains(token: string): boolean;
}

/**
 * Elements whose presses are content, never the plane's pan or creation.
 * Provisional: this list grows with each story that lands an element.
 */
export const CONTENT_CLASSES = [
  "word",
  "lack-mark",
  "distance-label",
  "distance-ring",
  "distance-coinfield",
  "grow-field",
  "plane-menu",
  "playing-set",
  "playing-set-word",
  // Story 2's signed links: the wire's own container, its head cluster and the
  // sign choice that replaces the coin field at Level 2 (ADR-0012/0016).
  "link",
  "link-head",
  "link-mark",
  "link-sign",
  "link-unknown",
  "link-remove",
  "sign-choice",
  "sign-choice-option",
] as const;

/** The CSS selector the plane uses to spot a content press (CanvasPlane). */
export const CONTENT_SELECTOR = CONTENT_CLASSES.map((name) => `.${name}`).join(", ");

/**
 * Press targets inside a word that never start a word gesture (drag or
 * click-to-center): the ring and the connect handle start their own gestures,
 * while the memory dot, the remove × and the reject arrow are plain buttons.
 * The selector's elements belong here too, so a press on one can never fall
 * through to a word behind it.
 */
export const WORD_CONTROL_CLASSES = [
  "word-mark",
  "memory-dot",
  "connect-handle",
  "word-remove",
  "word-reject",
  "playing-set",
  "playing-set-word",
  // Story 2: the sign glyph and its head controls own their presses, and the
  // pending sign choice must never fall through to a word behind it.
  "link-head",
  "link-mark",
  "link-sign",
  "link-unknown",
  "link-remove",
  "sign-choice",
  "sign-choice-option",
] as const;

/** Is any gesture armed? */
export function isGestureArmed(mode: GestureMode): boolean {
  return mode !== "idle";
}

export function isContentElement(classList: ClassListLike): boolean {
  return CONTENT_CLASSES.some((name) => classList.contains(name));
}

export function isWordControl(classList: ClassListLike): boolean {
  return WORD_CONTROL_CLASSES.some((name) => classList.contains(name));
}

/**
 * May a word's own press behaviors run? Only when no gesture is armed and the
 * press did not land on one of the word's controls.
 */
export function shouldStartWordPress(
  mode: GestureMode,
  classList?: ClassListLike | null,
): boolean {
  if (isGestureArmed(mode)) return false;
  return classList == null || !isWordControl(classList);
}

/** May the plane pan (d3's left drag) in this mode? */
export function shouldPan(mode: GestureMode): boolean {
  return mode === "idle";
}

/** May a double-click on empty plane open the creation menu in this mode? */
export function shouldCreate(mode: GestureMode): boolean {
  return mode === "idle";
}
