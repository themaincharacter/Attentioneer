/**
 * The interaction-mode gate (ADR-0016, decision 4). One plane, two games:
 * while a gesture is armed the plane's own gestures stand still — word press
 * behaviors, pan and creation all suspend — and the armed gesture owns the
 * pointer. The selector is the first mode; `sign-choice` (a link's sign, story
 * 2) is the second; `path` (loop authoring, story 3) is the third — it arms
 * while the words of a cycle are clicked in order and named.
 *
 * The gate also owns the content-element list: presses on content are never
 * plane gestures. New canvas elements join `CONTENT_CLASSES` as they land, and
 * a selector's elements join `WORD_CONTROL_CLASSES` too — the same early-return
 * list the word handler uses for the memory dot and the connect handle.
 *
 * Story 4's assumption presence joins both lists: the hollow diamond in a
 * target's hover row (a word's row, a link's head, a loop's name pill, or a
 * bare spot) and its quiet overlay are content and own their presses, so a
 * press on either can never pan the plane, create anything or start a word
 * gesture. The overlay's lines, text buttons, inputs and × are on the same
 * lists. Level 1 renders none of them (assumptions are Level 2 content), so
 * its behavior is untouched.
 *
 * Pure: no DOM, no React. `ClassListLike` is satisfied by a DOMTokenList, so
 * the handlers can pass the real thing and tests can pass a plain stub.
 */

import type { Level } from "../workspace/level";

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
  // Story 3's loops: the route and its coined name, the rename/coin field, the
  // path-collection layer and the walk's quiet read. A press on any of them is
  // content, never a plane gesture.
  "loop-route",
  "loop-route-hit",
  "loop-name",
  "loop-name-text",
  "loop-remove",
  "loop-coinfield",
  "loop-coinfield-input",
  "path-collect",
  "path-word",
  "path-bar",
  "walk",
  "walk-step",
  "walk-gap",
  "walk-verdict",
  "walk-close",
  // Story 4's assumptions: the hollow diamond at a target (a word's hover row,
  // a link's head, a loop's name pill, a bare spot), its quiet overlay, and
  // every element inside the overlay. The overlay never grows a word's box, so
  // wires never move; a press on any of it is content, never a plane gesture.
  "assumption-diamond",
  "assumption-spot",
  "assumption-overlay",
  "assumption-line",
  "assumption-text",
  "assumption-input",
  "assumption-remove",
  "assumption-close",
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
  // Story 3: the loop route/name own their presses (open the walk, rename,
  // remove) and the path layer's buttons are the only live surface while the
  // path gesture is armed; none of them may ever start a word press.
  "loop-route",
  "loop-route-hit",
  "loop-name",
  "loop-name-text",
  "loop-remove",
  "loop-coinfield",
  "loop-coinfield-input",
  "path-collect",
  "path-word",
  "walk",
  // Story 4: the diamond and the overlay own their presses. The diamond is a
  // word-row affordance (beside the memory dot and the connect handle), so it
  // must never start a word drag or a click-to-center; the overlay's lines,
  // inputs and × are the quiet surface while it is open.
  "assumption-diamond",
  "assumption-spot",
  "assumption-overlay",
  "assumption-line",
  "assumption-text",
  "assumption-input",
  "assumption-remove",
  "assumption-close",
] as const;

/**
 * The double-click creation menu's kinds (ADR-0011, ADR-0016). At Level 1 the
 * ring menu offers word and lack exactly as it always has; at Level 2 it grows
 * a THIRD kind, `assumption`, which states a claim about a bare spot of plane
 * (ADR-0011's open decision, decided in story 4). The list is the menu's whole
 * contract, so the look and the ordering stay rendering's business.
 */
export type CreationKind = "word" | "lack" | "assumption";

export function creationKinds(level: Level): readonly CreationKind[] {
  return level === "dynamics"
    ? ["word", "lack", "assumption"]
    : ["word", "lack"];
}

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
