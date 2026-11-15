import { markTargetKey, type Mark } from "../map/marks";
import { POINTER_FORMS, type Pointer, type PointerForm } from "../map/pointers";

/**
 * The ground game's quiet reach (Epic 5 story 1, ADR-0017/0016): the pure rules
 * behind the word's ONE reach handle and the pointer chooser it opens. Kept
 * apart from the components so the gate, the unpicked form, the ring cue, the
 * focus return and the level switch's closing are asserted without a DOM.
 *
 * World B, in one place: the form is the person's pick. The add entry starts
 * UNPICKED and nothing is written without a pick; the value field appears only
 * after a pick; Enter with nothing chosen discards. Target strings are never
 * inspected, classified or repaired.
 *
 * Provisional: the form labels and the value field's placeholders (ADR-0003's
 * rendering seam); the focus selectors are the canvas's own markup contract.
 */

/** A form pick while the add entry is open — `null` is unpicked. */
export type PointerPick = PointerForm | null;

/** What the add entry commits: one authored form plus its verbatim value. */
export interface PointerDraft {
  form: PointerForm;
  value: string;
}

/**
 * The add entry's commit rule: NO PICK, NO WRITE. An unpicked form or a blank
 * value yields `null` (Enter discards; nothing reaches the file), and a picked
 * form with a value yields the draft exactly as typed — the value is never
 * trimmed into shape, classified or corrected (World B). A value that is only
 * whitespace is blank: there is nothing to reach.
 */
export function pointerDraft(
  pick: PointerPick,
  value: string,
): PointerDraft | null {
  if (pick === null) return null;
  if (value === "" || value.trim() === "") return null;
  return { form: pick, value };
}

/** The forms the add entry offers, in the order they are offered (unpicked). */
export const POINTER_PICKS: readonly PointerForm[] = POINTER_FORMS;

/** The add entry's value field placeholder per form (provisional wording). */
export function pointerValuePlaceholder(form: PointerForm): string {
  switch (form) {
    case "path":
      return "a path inside this workspace…";
    case "at":
      return "an absolute path on this machine…";
    case "url":
      return "a url…";
  }
}

/** The form pick's quiet hover title (provisional wording). */
export function pointerFormTitle(form: PointerForm): string {
  switch (form) {
    case "path":
      return "a file inside this workspace";
    case "at":
      return "a file on this machine — machine-local, may dangle elsewhere";
    case "url":
      return "a page — any scheme, stored verbatim";
  }
}

/**
 * The open pointer marks' target keys. Byte-identical hand duplicates share
 * the key, so both render marked (a Set, never a count): the cue is presence,
 * not a tally (ADR-0009).
 */
export function markedPointerKeys(marks: readonly Mark[]): Set<string> {
  const keys = new Set<string>();
  for (const mark of marks) {
    if (mark.kind !== "open" || mark.target.type !== "pointer") continue;
    keys.add(markTargetKey(mark.target));
  }
  return keys;
}

/**
 * Does any of this word's pointer lines carry an open mark? The reach handle's
 * small ring cue reads this: one cue for the word, however many of its lines
 * are marked — a presence, never a count (no scores, streaks or badges).
 */
export function hasMarkedPointer(
  pointers: readonly Pointer[],
  markedKeys: ReadonlySet<string>,
  on: string,
): boolean {
  return pointers.some(
    (pointer) =>
      pointer.on === on &&
      markedKeys.has(
        markTargetKey({
          type: "pointer",
          on: pointer.on,
          form: pointer.form,
          value: pointer.value,
        }),
      ),
  );
}

/** Every pointer-line mark target key (for an exact per-line read). */
export function pointerMarkKey(pointer: Pointer): string {
  return markTargetKey({
    type: "pointer",
    on: pointer.on,
    form: pointer.form,
    value: pointer.value,
  });
}

/** Is this exact pointer line marked (a row's ring reads this)? */
export function isPointerMarked(
  pointer: Pointer,
  markedKeys: ReadonlySet<string>,
): boolean {
  return markedKeys.has(pointerMarkKey(pointer));
}

/**
 * What a level switch closes (ADR-0016's amendment): the chooser itself and
 * every field inside it, plus the level switch's own cancellation of armed
 * gestures. The app applies this by dropping the chooser's state (the add
 * field and any edit field live inside it, so unmounting closes them); the
 * list is the rule a test can assert.
 */
export const POINTER_TRANSIENTS = ["chooser", "add-field", "edit-field"] as const;

export type PointerTransient = (typeof POINTER_TRANSIENTS)[number];

/** The transients a switch to another game closes — all of them. */
export function transientsClosedByLevelSwitch(): readonly PointerTransient[] {
  return POINTER_TRANSIENTS;
}

/** Why the chooser closed: a dismissal, or a level switch. */
export type ChooserCloseReason = "dismiss" | "switch-level";

/**
 * Where focus returns when the chooser closes (ADR-0016's amendment): back to
 * the word that opened it (its reach handle is the word's focusable slot), or
 * to the level control when the close WAS a switch — the word may no longer
 * carry a handle in the new game. Pure, so the app's DOM focus step is thin.
 */
export function focusAfterChooserClose(
  reason: ChooserCloseReason,
): "word" | "level" {
  return reason === "switch-level" ? "level" : "word";
}

/**
 * The selector the focus step uses. The word's reach handle is the word's
 * focusable slot (the word box itself is not focusable); the level control's
 * active game is the third button by then. Provisional: the markup contract.
 */
export function chooserFocusSelector(
  target: "word" | "level",
  slug: string | null = null,
): string {
  if (target === "word" && slug !== null && slug !== "") {
    return ".word[data-slug=\"" + slug + "\"] .reach-handle";
  }
  return ".level-control .level-game.active";
}

/** The chooser's aria label for the word it speaks about (quiet wording). */
export function chooserLabel(slug: string): string {
  return "pointers on “" + slug + "”";
}
