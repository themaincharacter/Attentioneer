/**
 * The interaction-mode gate (ADR-0016, decision 4). One plane, two games:
 * while a gesture is armed the plane's own gestures stand still — word press
 * behaviors, pan and creation all suspend — and the armed gesture owns the
 * pointer. The selector is the first mode; `sign-choice` (a link's sign, story
 * 2) is the second; `path` (loop authoring, story 3) is the third — it arms
 * while the words of a cycle are clicked in order and named. The veil's
 * draw-box is the fifth mode (Epic 9 story 1, ADR-0023): armed from the level
 * control, it captures a RECTANGLE of plane and stands every plane gesture
 * still exactly as the others do — a box drag can never move a word, open the
 * ring menu or pan. It is its own arm, never the selector's lasso: the lasso
 * lives inside a dynamics-only surface and takes a polygon, while the veil must
 * work at concept AND dynamics.
 *
 * Epic 9 story 2's look-under is a TRANSIENT, not a new armed gesture: its card
 * is content (the name, the reason, the close ×, and the provisional rename
 * field) and owns its presses, exactly as the window's card does. Opening it
 * does not arm the gate; the lifted words take no press at all (the lift is
 * READ-ONLY — visibility in CSS with `pointer-events: none`), so no gesture
 * can edit covered content through the look-under. It closes on Esc, its ×, a
 * press away or the game switch, and the switch path closes it with every other
 * transient.
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
 * Epic 12 story 2 adds the pointer row's read contacts (look, measure) and its
 * log button, and the PRISM window they open: the ONE Move's window (its
 * header, pointer identity, read-only Change rows, the person's explanation
 * field and its close x). Every one of them is content and joins both lists,
 * exactly like the glimpse: a press on the log or on the Move's window can
 * never pan the plane, create anything or start a word gesture. The window is
 * the outward window's sibling — a transient of the ground game, closed by the
 * same level-switch path.
 *
 * Epic 6 story 3 adds the per-word follow (ADR-0019): ONE quiet control on
 * every word's row that jumps the band keeping the word under the eye. It is
 * a word-row affordance like the memory dot or the reach handle, so it and its
 * tiny two-game menu own their presses and join both lists — a press on the
 * follow must never start a word drag or a click-to-center. The control reads
 * no face, so it is in every row and the lists never vary with presence.
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
 * Epic 8 story 1 adds quantities (ADR-0020): a word's quiet stock glyph and a
 * pair's quiet flow glyph, plus the amount card they open. They join both class
 * lists like every element before them — a press on the glyph can never start a
 * word drag or a click-to-center, and a press on the card can never pan the
 * plane, create anything or start a word gesture. The card is the authoring
 * surface, so the writer (and the arming echo in App) read `authoringLive`:
 * at dynamics with no accepted set no amount is authored.
 *
 * Epic 8 story 2's branch chooser (ADR-0021) adds no class here, and that is
 * deliberate: it lives in the level control, which sits OUTSIDE `.plane` beside
 * the control's other actions ("edit the playing set", "coin a loop"), so the
 * plane's armed gate never reaches it and no press on it can pan, create or
 * start a word gesture. Its switch runs the app's full switch path, which is
 * what closes any armed surface.
 *
 * Epic 8 story 3's crank (ADR-0022) also adds no class, for the same reason:
 * the crank and its step-scoped notes sit OUTSIDE `.plane` beside the level
 * control, and the per-word run read is non-interactive text inside the word
 * (pointer-events: none) — there is no press to gate.
 *
 * Epic 8 story 4's comparison (ADR-0021 §7 amended) adds no class either: the
 * panel and every bridge door inside it sit OUTSIDE `.plane` beside the level
 * control, so the armed gate never reaches them and no press on a door can pan,
 * create or start a word gesture. Its doors write the COMMITTED model (never
 * the armed game's records) through `authoringLive`'s ordinary rule.
 *
 * Pure: no DOM, no React. `ClassListLike` is satisfied by a DOMTokenList, and
 * `TextFieldLike` by an HTMLElement, so the handlers can pass the real thing
 * and tests can pass a plain stub.
 */

import type { PlayingSet } from "../map/model";
import type { Level } from "../workspace/level";
import type { HandoffCause } from "../workspace/levelHandoff";

/** How a gesture is armed right now. Idle is the plain canvas. */
export type GestureMode =
  | "idle"
  | "selector"
  | "path"
  | "sign-choice"
  | "pointer"
  | "veil";

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
  // Epic 12 story 2: the pointer row's read contacts (look, measure) and its
  // log button, plus the PRISM window they open: the ONE Move's header, its
  // read-only Change rows, the person's explanation field and its close x.
  // Every one of them is content, never a plane gesture; the window never
  // grows a word's box.
  "pointer-look",
  "pointer-measure",
  "pointer-log",
  // Epic 12 story 3: the row's ask and hand-off, and the add entry's make / ask
  // doors — plain buttons inside the chooser, so their presses are content too.
  "pointer-ask",
  "pointer-handoff",
  "pointer-make",
  "pointer-ask-word",
  "prism-window",
  "prism-header",
  "prism-contact",
  "prism-name",
  "prism-pointer",
  "prism-changes",
  "prism-change",
  "prism-change-kind",
  "prism-change-outcome",
  "prism-detail",
  "prism-explanation",
  "prism-note",
  "prism-close",
  // Epic 6 story 3: the per-word follow control and the tiny menu of the two
  // other games it opens. A press on any of them is content, never a plane
  // gesture.
  "word-follow",
  "word-follow-toggle",
  "word-follow-menu",
  "word-follow-game",
  // Epic 8 story 1's quantities (ADR-0020): the quiet amount glyph in a word's
  // row (the stock line) and in a link's head (the flow line over that ordered
  // pair), the amount card and every element inside it. A press on any of them
  // is content, never a plane gesture; the glyph is a word-row affordance, so
  // it must never start a word drag or a click-to-center.
  "quantity-glyph",
  "quantity-overlay",
  "quantity-line",
  "quantity-target",
  "quantity-input",
  "quantity-state",
  "quantity-unknown",
  "quantity-amount",
  "quantity-remove",
  "quantity-close",
  // Epic 9 story 1's veil (ADR-0023): the cover sheet and its quiet retire ×,
  // the in-flight rectangle draft, and the name/reason coin field. The sheet
  // OWNS presses over the area it covers, so a press on it can never pan the
  // plane, create anything or start a word gesture; the covered words under it
  // are set aside (the region test, map/veils.ts) and the cover adds no quiet
  // of its own.
  "veil-sheet",
  "veil-retire",
  "veil-draft",
  "veil-bar",
  "veil-coinfield",
  "veil-coinfield-input",
  "veil-reason-input",
  // Epic 9 story 2's look-under: the READ-ONLY transient's card, its coined
  // name (double-click renames the veil, the loops' idiom), the rename field,
  // the reason line and the close ×. A press on any of them is content, never
  // a plane gesture; the card never carries an editor for the covered words.
  "veil-lookunder",
  "veil-lookunder-name",
  "veil-lookunder-rename",
  "veil-lookunder-reason",
  "veil-lookunder-close",
  // Epic 10 story 3's ghost: the ONLY ghost element inside the plane is the
  // opened preview's faint diamond at the target. It is read-only by
  // construction (pointer-events: none), and it exists only inside the
  // person's opening; it is listed anyway so the door cannot quietly open if
  // that rendering ever changes. The list, the preview card and the ask panel
  // sit OUTSIDE .plane (beside the comparison and the crank), so the plane's
  // armed gate never reaches them — and a held ghost draws nothing on the map.
  "ghost-diamond",
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
  // Epic 12 story 2: the row's read contacts and log, and the PRISM window's
  // header rows, read-only Change lines, explanation field and close x own
  // their presses (plain buttons and text, never a word gesture).
  "pointer-look",
  "pointer-measure",
  "pointer-log",
  // Epic 12 story 3: the row's ask and hand-off, and the add entry's make / ask
  // doors — the person's other verbs, plain buttons that own their presses.
  "pointer-ask",
  "pointer-handoff",
  "pointer-make",
  "pointer-ask-word",
  "prism-window",
  "prism-header",
  "prism-contact",
  "prism-name",
  "prism-pointer",
  "prism-changes",
  "prism-change",
  "prism-change-kind",
  "prism-change-outcome",
  "prism-detail",
  "prism-explanation",
  "prism-note",
  "prism-close",
  // Epic 6 story 3: the follow control is a word-row affordance (beside the
  // memory dot, the diamond, the reach handle and the connect handle), so it
  // must never start a word drag or a click-to-center; its menu's game choices
  // own their presses the same way.
  "word-follow",
  "word-follow-toggle",
  "word-follow-menu",
  "word-follow-game",
  // Epic 8 story 1's quantities (ADR-0020): the amount glyph is a word-row (and
  // link-head) affordance, so it must never start a word drag or a
  // click-to-center; the card's field and controls own their presses.
  "quantity-glyph",
  "quantity-overlay",
  "quantity-line",
  "quantity-target",
  "quantity-input",
  "quantity-state",
  "quantity-unknown",
  "quantity-amount",
  "quantity-remove",
  "quantity-close",
  // Epic 9 story 1's veil: the sheet, its retire ×, the draft rectangle and the
  // coin field are content, so the word handler's early-return list covers them
  // too — no veil element can ever start a word drag or a click-to-center.
  "veil-sheet",
  "veil-retire",
  "veil-draft",
  "veil-bar",
  "veil-coinfield",
  "veil-coinfield-input",
  "veil-reason-input",
  // Epic 9 story 2's look-under is content too, so no element of it can ever
  // start a word drag or a click-to-center (the same early-return list).
  "veil-lookunder",
  "veil-lookunder-name",
  "veil-lookunder-rename",
  "veil-lookunder-reason",
  "veil-lookunder-close",
  // Epic 10 story 3's ghost diamond (see the content list above): read-only,
  // but on both lists so it can never fall through to a word's press behavior.
  "ghost-diamond",
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
 * without it; Epic 7 story 1 makes that structural in `authoringLive` below),
 * and the level control's "edit the playing set" is the door.
 */
export function shouldPromptForSet(
  cause: HandoffCause,
  level: Level,
  hasModel: boolean,
): boolean {
  if (cause === "settle") return false;
  return level === "dynamics" && !hasModel;
}

/* ------------------------------------------------------------------------- *
 * Epic 7 story 1: the authoring seam — the required-set rule made structural.
 * ------------------------------------------------------------------------- */

/**
 * May the dynamics game's own records be authored right now? The playing set is
 * REQUIRED before they can be (ADR-0013 decision 1), and until Epic 7 that
 * requirement lived in a PROMPT and in prose: a person who wheeled into
 * dynamics with no accepted set landed in a legible but inert game, and any
 * gesture that reached a writer still wrote. This is the rule itself — at
 * dynamics with no accepted set nothing authors; every other game is untouched,
 * so Level 1 (and ground, and the words, distances and marks every game shares)
 * writes exactly what it wrote before.
 *
 * The three writers are `useMap`'s `drawLink`, `createLoop` and
 * `addAssumption`; each asks this rule before it touches its record, so a dead
 * door cannot write whatever armed it (a stray keyboard path, a restored
 * gesture, a later story's surface). The three affordances that would spend a
 * gesture on that dead end — the connect handle, the assumption diamond/overlay
 * and the control's "coin a loop" — ask the same rule before they ARM, so
 * nobody types a claim into a void. That echo is a courtesy; the write is where
 * the rule is enforced.
 *
 * What it never guards: ACCEPT (the narrowing is the human's — select-all stays
 * legal and the selector's accept always writes), membership itself (ADR-0013
 * decision 4: a drawn link to a prune rejoins it, and `joinWords` is a record
 * join, never an authoring move), and the words, distances and marks shared by
 * every game. Level 1 is untouched by construction: `level !== "dynamics"`
 * returns live before the model is looked at.
 *
 * Provisional: the seam's SHAPE. This story settles it at write-time (the
 * writers no-op), with the arming-time echo above as the quiet courtesy — a
 * write-only guard would let a whole gesture evaporate, an arming-only guard
 * would leave the rule bypassable. The membership model it reads
 * (`PlayingSet | null`, absence = nothing accepted) is ADR-0013's.
 */
export function authoringLive(level: Level, model: PlayingSet | null): boolean {
  return level !== "dynamics" || model !== null;
}

/**
 * May an authoring DOOR arm right now? `authoringLive` is the write-time rule;
 * this is the arming-time reading for a door the armed gate cannot cover.
 *
 * While the playing-set selector is open the plane's own armed gate stands the
 * connect handle and the assumption diamond still (`.plane.gesture-armed`), so
 * those two doors die by construction. The level control's "coin a loop" sits
 * OUTSIDE `.plane`, so that gate never reaches it: without this rule the loop
 * door alone stays live while the selector is open (the follow-up Epic 7 story 1
 * deferred). An open selector owns the interaction, so no door arms.
 *
 * Provisional: the shape. This folds the set requirement and the selector's
 * ownership into one reading; if the selector's state ever moves into the seam,
 * so does this. Only the control's loop door asks it today — the plane's own
 * gate covers the other two — and the write-time rule (the writers'
 * `authoringLive`) is unchanged.
 */
export function authoringDoorLive(
  level: Level,
  model: PlayingSet | null,
  selectorOpen: boolean,
): boolean {
  return authoringLive(level, model) && !selectorOpen;
}
