import type { ConceptWord } from "../map/conceptWords";
import {
  mentionKey,
  serializeMention,
  type MentionKind,
} from "../map/mentions";

/**
 * Story 16.7 — THE `@` PICKER in a card's note editor.
 *
 * The person types `@` at a word boundary and a small list opens: the ground
 * map's cards first (navigation, the kind expected to be used most), then the
 * concept map's words, each MARKED as a concept (context, not navigation). Typing
 * filters the list; Enter or a click inserts the FULL mention form and nothing
 * else; Esc closes the list and leaves the text exactly as it was.
 *
 * WHY THE LIST IS BUILT HERE AND NOT IN THE LAYER: `mentionChoices`,
 * `mentionTrigger`, `applyMention` and `pickerCommand` are PURE and exported, so
 * the trigger's boundary rule, the ordering and the keyboard are testable
 * without a DOM — the layer keeps only the state and the callbacks. The picker
 * writes NOTHING itself: it hands the layer the text to put in the editor, and
 * the editor's save path is the story-16.6 one, untouched.
 *
 * PROVISIONAL: the trigger's boundary set, the ordering, the keys (↑/↓/Enter/
 * Tab/Esc), the trailing space an insertion adds, and the look (ADR-0003's
 * rendering seam). Bare `@word` is never a mention; the picker always inserts
 * the full `[@Label](card://slug)` form.
 */

/** One row of the list: a target, its kind and the label shown for it. */
export interface MentionChoice {
  kind: MentionKind;
  slug: string;
  label: string;
}

/**
 * Where the open picker starts in the note: the `@` it replaces and the query
 * typed after it. Boundaries are whitespace and ordinary prose punctuation.
 * `[`, `(`, `{` and `<` are deliberately NOT boundaries: a `[` is how a
 * mention's own label starts, so editing inside an existing mention never
 * reopens the list.
 */
const TRIGGER = /(^|[\s)\]}"'.,;:!?\-—])@([^\s@]*)$/;

/**
 * Is a picker open at this caret, and for which query? `caret` is the textarea's
 * selection start, so only the text BEFORE the caret can open one. PURE.
 */
export function mentionTrigger(
  text: string,
  caret: number,
): { query: string; start: number } | null {
  if (caret < 0 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const match = TRIGGER.exec(before);
  if (match === null) return null;
  return {
    query: match[2],
    start: before.length - match[2].length - 1,
  };
}

/**
 * The list for a query: ground cards first, then concept words (the user's
 * ruling: both, with the card expected most). A case-insensitive substring of
 * the NAME matches; the slug matches too, so a hand-known slug is reachable.
 * The card being edited is never offered (mentioning itself would open the card
 * you are already in). PURE.
 */
export function mentionChoices(
  cards: readonly { slug: string; name: string }[],
  words: readonly ConceptWord[],
  query: string,
  excludeSlug: string | null = null,
): MentionChoice[] {
  const needle = query.trim().toLowerCase();
  const matches = (label: string, slug: string): boolean =>
    needle === "" ||
    label.toLowerCase().includes(needle) ||
    slug.toLowerCase().includes(needle);
  const cardChoices: MentionChoice[] = cards
    .filter((card) => card.slug !== excludeSlug)
    .filter((card) => matches(card.name, card.slug))
    .map((card) => ({ kind: "card", slug: card.slug, label: card.name }));
  const wordChoices: MentionChoice[] = words
    .filter((word) => matches(word.name, word.slug))
    .map((word) => ({ kind: "word", slug: word.slug, label: word.name }));
  return [...cardChoices, ...wordChoices];
}

/**
 * Insert a choice in place of the trigger. The mention is written in its full
 * plain-text form, with ONE trailing space so the next word starts cleanly (a
 * space already after the caret is not doubled). Returns the next text and the
 * caret after the insertion, so the editor can put the cursor back. PURE.
 */
export function applyMention(
  text: string,
  start: number,
  caret: number,
  choice: MentionChoice,
): { text: string; caret: number } {
  const token = serializeMention(choice.kind, choice.slug, choice.label);
  const tail = text.slice(caret);
  // ONE separator after the mention, added only when there is text after it
  // and no space already there. The caret lands AFTER the separator, so the
  // next word starts cleanly; at the very end of the note nothing is added.
  const separator = tail === "" || tail.startsWith(" ") ? "" : " ";
  const pad = tail === "" ? 0 : 1;
  return {
    text: `${text.slice(0, start)}${token}${separator}${tail}`,
    caret: start + token.length + pad,
  };
}

/** What one key means while the list is open (null: the editor keeps it). */
export type PickerCommand = "prev" | "next" | "insert" | "close" | null;

/**
 * The picker's keys. Escape closes the list only — it must NOT fall through to
 * the note editor's Esc (which abandons the edit); Enter and Tab insert; the
 * arrows walk the list. Any other key is the person typing, which filters. PURE.
 */
export function pickerCommand(key: string): PickerCommand {
  switch (key) {
    case "ArrowDown":
      return "next";
    case "ArrowUp":
      return "prev";
    case "Enter":
    case "Tab":
      return "insert";
    case "Escape":
      return "close";
    default:
      return null;
  }
}

/** The next active row for a command, wrapping around the list. PURE. */
export function nextActive(
  command: "prev" | "next",
  active: number,
  length: number,
): number {
  if (length <= 0) return 0;
  const step = command === "next" ? 1 : -1;
  return (active + step + length) % length;
}

/**
 * The list itself: one row per target, the concept rows MARKED. It takes no
 * focus of its own (a click is a mouse-down on the row, which keeps the caret
 * in the textarea), and it is a content element to the plane's gate, so a press
 * on it can never pan the plane or start a card drag.
 */
export function MentionPicker({
  choices,
  active,
  onPick,
}: {
  choices: readonly MentionChoice[];
  active: number;
  onPick: (choice: MentionChoice) => void;
}) {
  return (
    <div className="ground-mention-picker" role="listbox" aria-label="mention">
      {choices.length === 0 ? (
        <div className="ground-mention-empty">
          nothing to mention here yet
        </div>
      ) : (
        choices.map((choice, index) => (
          <button
            type="button"
            key={mentionKey(choice.kind, choice.slug)}
            role="option"
            aria-selected={index === active}
            className={`ground-mention-option ${choice.kind}${
              index === active ? " active" : ""
            }`}
            // CLICK, not mouse-down: the card's raw mouse-down listener stops
            // the native event before React's delegated listener sees it, so a
            // synthetic `onMouseDown` inside a card never fires. A click is a
            // separate event and reaches the row; the editor's blur writes
            // nothing (only a press away, Esc or "done" does), and the insert
            // puts the focus and the caret back.
            onClick={() => onPick(choice)}
          >
            <span className="ground-mention-option-label">{choice.label}</span>
            {choice.kind === "word" && (
              <span className="ground-mention-option-kind">concept</span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
