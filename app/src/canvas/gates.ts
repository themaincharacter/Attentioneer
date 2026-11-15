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
 * Epic 5 story 1's ground game grows the gate again: a word's reach handle
 * suspends nothing by itself (it is a plain control), but OPENING the quiet
 * pointer chooser arms the gate in the `pointer` mode — the armed gesture owns
 * the pointer, so word presses, pan and creation stand still while the chooser
 * is the only live surface. The handle, the chooser and every element inside it
 * join both class lists, exactly as every Epic 4 element did.
 *
 * Epic 5 story 2's window (code name peek) is a transient of the ground game,
 * not a new armed gesture: opening a pointer's window closes the chooser, and a
 * level switch closes the window through the same `cancelPendingGestures`
 * path that closes every transient. Its card, its identity handle and its two
 * quiet actions join both lists like every element before them, so a press on
 * the glimpse can never pan the plane, create anything or start a word gesture;
 * a press outside it is the click-away that closes it.
 *
 * Epic 6 story 2 turns the gate into the level's PIN (ADR-0018 decision 3):
 * while an armed gesture holds the pointer, the game it began in is pinned, and
 * a FOCUSED TEXT FIELD pins it the same way — a wheel crossing moves the camera
 * and nothing else, so no armed surface closes and no typed text is lost. The
 * rule is `shouldPinLevel` (armed OR focused); `createLevelPin` holds a
 * settled crossing until the pin lifts, when the band re-derives and any switch
 * runs the full switch path. The same story formalizes the selector's prompt
 * policy — `shouldPromptForSet`: only a DELIBERATE entry asks for a missing
 * playing set; a wheel crossing never does (the cost is named there).
 *
 * Pure: no DOM, no React. `ClassListLike` is satisfied by a DOMTokenList, and
 * `TextFieldLike` by an HTMLElement, so the handlers can pass the real thing
 * and tests can pass a plain stub.
 */

import type { Level } from "../workspace/level";
import type { HandoffCause } from "../workspace/levelHandoff";

/** How a gesture is armed right now. Idle is the plain canvas. */
export type GestureMode =
  | "idle"
  | "selector"
  | "path"
  | "sign-choice"
  | "pointer";

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
  // Epic 5 story 1's ground game: the word's one quiet reach handle and the
  // pointer chooser it opens (rows, their ring/edit/remove controls, the add
  // entry and its form pick / value field). A press on any of them is content,
  // never a plane gesture; the chooser never grows a word's box.
  "reach-handle",
  "pointer-chooser",
  "pointer-row",
  "pointer-form",
  "pointer-value",
  "pointer-input",
  "pointer-ring",
  "pointer-remove",
  "pointer-add",
  "pointer-add-hint",
  "pointer-picks",
  "pointer-pick",
  "pointer-add-input",
  "pointer-close",
  // Epic 5 story 2: the row's quiet open action, and the window it opens (the
  // card, its selectable identity handle, its plain stats/head/note lines and
  // its open/reveal/close controls). Every one of them is content.
  "pointer-open",
  "outward-window",
  "outward-handle",
  "outward-stats",
  "outward-head",
  "outward-note",
  "outward-open",
  "outward-reveal",
  "outward-close",
] as const;

/** The CSS selector the plane uses to spot a content press (CanvasPlane). */
export const CONTENT_SELECTOR = CONTENT_CLASSES.map((name) => `.${name}`).join(", ");

/**
 * Press targets inside a word that never start a word gesture (drag or
 * click-to-center): the ring and the connect handle start their own gestures,
 * while the memory dot, the remove × and the reject arrow are plain buttons.
 * Every Epic 4 element joins this list as well as `CONTENT_CLASSES` — ADR-0016
 * decision 4's "every new element joins both lists as it lands" — so a press on
 * any of them can never fall through to a word behind or beneath it. (Level 1's
 * elements are left exactly as they were: the gate's two lists predate the
 * stories, and Level 1 must behave as before.)
 */
export const WORD_CONTROL_CLASSES = [
  "word-mark",
  "memory-dot",
  "connect-handle",
  "word-remove",
  "word-reject",
  "playing-set",
  "playing-set-word",
  // Story 2: the wire, the sign glyph and its head controls own their presses,
  // and the pending sign choice must never fall through to a word behind it.
  "link",
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
  "path-bar",
  "walk",
  "walk-step",
  "walk-gap",
  "walk-verdict",
  "walk-close",
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
  // Epic 5 story 1: the reach handle is a word-row affordance (beside the
  // memory dot and the connect handle), so it must never start a word drag or a
  // click-to-center; the chooser's rows, controls and fields own their presses.
  "reach-handle",
  "pointer-chooser",
  "pointer-row",
  "pointer-form",
  "pointer-value",
  "pointer-input",
  "pointer-ring",
  "pointer-remove",
  "pointer-add",
  "pointer-add-hint",
  "pointer-picks",
  "pointer-pick",
  "pointer-add-input",
  "pointer-close",
  // Epic 5 story 2: the row's open action and the window's card lines/controls
  // own their presses (plain buttons and text, never a word gesture).
  "pointer-open",
  "outward-window",
  "outward-handle",
  "outward-stats",
  "outward-head",
  "outward-note",
  "outward-open",
  "outward-reveal",
  "outward-close",
] as const;

/**
 * The double-click creation menu's kinds (ADR-0011, ADR-0016's amendment). The
 * ring menu offers word and lack in EVERY game; the dynamics game grows a THIRD
 * kind, `assumption`, which states a claim about a bare spot of plane
 * (ADR-0011's open decision, decided in story 4). The ground game authors its
 * records through the word's reach handle, not through the creation menu, so it
 * offers exactly word and lack — the honest partition: a game only ADDS its own
 * records. The list is the menu's whole contract, so the look and the ordering
 * stay rendering's business.
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

/* ------------------------------------------------------------------------- *
 * Story 2: the level pin (ADR-0018 decision 3) and the prompt policy.
 * ------------------------------------------------------------------------- */

/**
 * The one shape the focus rule needs from a DOM element (an HTMLElement
 * satisfies it), so the rule is pure and testable without a DOM.
 */
export interface TextFieldLike {
  tagName: string;
  type?: string;
  isContentEditable?: boolean;
}

/**
 * Where focus sits, as far as the level's pin is concerned. "text" means a
 * TEXT ENTRY holds focus — a surface where a band switch could discard a
 * half-typed word, claim or reach. Everything else (a button, the plane, the
 * level control, a card's static text) pins nothing: a wheel crossing may
 * switch the game under it.
 */
export type FocusState = "none" | "text";

/** Nothing is focused: the pin is the gesture's alone. */
export const NO_FOCUS: FocusState = "none";

/**
 * Input types that hold no typed text: pressing one changes a value, and a
 * level switch cannot discard anything a person was writing. (The app's fields
 * are all text; this list keeps the rule honest for a future control.)
 */
const NON_TEXT_INPUT_TYPES: ReadonlySet<string> = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit",
]);

/**
 * Is this element a TEXT field — a surface whose focus can hold uncommitted
 * typing? A textarea and a contenteditable count; an input counts unless its
 * type is one of the non-text ones; anything else (a span, a button, a card)
 * does not.
 */
export function isTextField(el: TextFieldLike | null | undefined): boolean {
  if (el == null) return false;
  if (el.isContentEditable === true) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA") return true;
  if (tag !== "INPUT") return false;
  return !NON_TEXT_INPUT_TYPES.has((el.type ?? "text").toLowerCase());
}

/** The focus reading from the focused element (null = nothing has focus). */
export function focusStateOf(el: TextFieldLike | null | undefined): FocusState {
  return isTextField(el) ? "text" : "none";
}

/**
 * How a focused surface ended. All three release the pin: a blur takes focus
 * away, and a commit or a cancel ends the field's life (its card closes, its
 * text is either written or deliberately dropped). A commit that KEEPS the
 * field open keeps the pin too — focus is still in a text entry.
 */
export type FieldEnd = "blur" | "commit" | "cancel";

/**
 * The focus reading once a field's life ends: the surface is gone, so nothing
 * pins the level by focus any more and the band may re-derive (at the zoom the
 * camera is on now).
 */
export function focusAfterFieldEnd(_end: FieldEnd): FocusState {
  return NO_FOCUS;
}

/**
 * Does the level hold fast right now? TWO reasons, one rule (ADR-0018
 * decision 3, grown by story 2):
 *
 *   - an ARMED gesture (the selector, a sign choice, the path, the chooser)
 *     owns the pointer: its surfaces must not be swapped mid-gesture;
 *   - a FOCUSED TEXT FIELD holds uncommitted typing: a crossing must not close
 *     the field or discard what is in it (the defect the red team found).
 *
 * While pinned a wheel crossing moves the camera only; the band re-derives on
 * the pin's release (blur, commit, cancel, the gesture's end), and only then
 * does a real crossing run the full switch path.
 */
export function shouldPinLevel(mode: GestureMode, focus: FocusState): boolean {
  return isGestureArmed(mode) || focus === "text";
}

/**
 * Did the pin just lift on a FOCUS change? The reading before was a text entry
 * and the one after is not — while no armed gesture still holds the level. This
 * is the blur / commit / Esc edge in one place, so the app asks the same rule
 * the settle path asks (and an armed gesture's pin survives the field's end).
 */
export function didReleaseFocusPin(
  before: FocusState,
  after: FocusState,
  mode: GestureMode,
): boolean {
  return before === "text" && !shouldPinLevel(mode, after);
}

/**
 * The level pin's memory (story 2). A settled crossing that arrives while the
 * pin holds is HELD: the camera has already moved, the game has not, and
 * nothing has closed. The hold is a FLAG, not a queue — the camera is the
 * memory, so a wheel across and back leaves nothing to apply when the pin
 * lifts.
 *
 * The app's settle path asks `settle`; its pin release asks `release`. A held
 * crossing never reaches the handoff, so it can never write: the ONE write
 * trigger (levelHandoff.ts) stays the only one.
 */
export interface LevelPin {
  /**
   * A zoom gesture settled at `zoom`. Returns the zoom the handoff may settle,
   * or null when the pin holds the crossing back (the person is mid-gesture or
   * mid-word).
   */
  settle: (zoom: number, pinned: boolean) => number | null;
  /**
   * The pin lifted (blur, commit, cancel, or the armed gesture's end): the band
   * re-derives from the zoom the camera ended on. Safe to call even with
   * nothing held — it settles the band the camera is already in, which the
   * handoff treats as no change; the app skips the call in that case, because
   * an unpinned band and camera cannot disagree.
   */
  release: (zoom: number) => number;
  /** Did a settled crossing wait under the pin? (Nothing was applied.) */
  held: () => boolean;
}

/** One level pin, pure: the held-crossing flag and nothing else. */
export function createLevelPin(): LevelPin {
  let held = false;
  return {
    settle(zoom, pinned) {
      if (pinned) {
        held = true;
        return null;
      }
      held = false;
      return zoom;
    },
    release(zoom) {
      held = false;
      return zoom;
    },
    held: () => held,
  };
}

/**
 * Does entering `level` ask for a playing set? (The selector's door,
 * ADR-0013: the set is required before the dynamics game's own records can be
 * authored.)
 *
 * ONLY a DELIBERATE entry asks: the level control's jump, story 3's anchored
 * follow, or opening a workspace that resumes in the game (the resume hint is
 * what the person left behind — deliberate). A WHEEL crossing never asks, not
 * even into dynamics with no accepted set: the wheel is how the person looks
 * around, and a prompt opening under a scroll would steal the gesture.
 *
 * THE NAMED COST: a person who wheels into dynamics with no set lands in a game
 * whose own records stay inert but legible until they take a deliberate step —
 * the set stays REQUIRED AT AUTHORING (nothing is authored while playing
 * without it), and the level control's "edit the playing set" is the door.
 */
export function shouldPromptForSet(
  cause: HandoffCause,
  level: Level,
  hasModel: boolean,
): boolean {
  if (cause === "settle") return false;
  return level === "dynamics" && !hasModel;
}
