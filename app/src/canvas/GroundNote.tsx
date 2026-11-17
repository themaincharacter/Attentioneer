import { Fragment } from "react";
import {
  cropSegments,
  mentionDangling,
  mentionKey,
  parseMentions,
  type Mention,
} from "../map/mentions";
import { previewText } from "../map/readings";

/**
 * Story 16.7 — THE NOTE'S MENTIONS, drawn over the person's own words.
 *
 * This component is the note's FACE with chips in it: it takes the stored note
 * text, splits it with the PURE `parseMentions`, crops it with the PURE
 * `cropSegments` (the small card) and draws one quiet chip per mention. It
 * reads nothing and writes nothing: a card mention's target is a slug the layer
 * already loaded, and a concept word's name/memory arrive as the panel's props
 * after the layer's one read (`map/conceptWords.ts`).
 *
 * THE THREE STATES (the story's rules):
 *   - a CARD chip opens that ground card (navigation; the card expands where it
 *     is — no camera move in this story);
 *   - a WORD chip is styled apart (concept/meta) and opens the read-only panel
 *     below, showing the concept's name and a cropped memory;
 *   - a DANGLING chip is muted, says "missing" on hover or focus, and does
 *     nothing when clicked. It is never removed from the note and never called
 *     malformed — dangling is the person's text being honest about a target that
 *     went away.
 *
 * Nothing here counts, scores or nudges, and a hand-edited label is shown as the
 * person wrote it: the chip resolves by the slug and renames nothing.
 *
 * PROVISIONAL: the chip look, the "missing" wording and the panel's crop
 * (ADR-0003's rendering seam).
 */

/** The label a chip shows: the person's words, falling back to the target's name. */
export function mentionLabel(
  mention: Mention,
  cardNames: ReadonlyMap<string, string>,
): string {
  const label = mention.label.trim();
  if (label !== "") return label;
  // A label emptied by hand still names something: the target's CURRENT name
  // for a card; a concept word shows its slug until the panel is opened (its
  // name lives in the concept map, which this component never reads).
  return mention.kind === "card"
    ? cardNames.get(mention.slug) ?? mention.slug
    : mention.slug;
}

/**
 * One mention's chip. The whole press is this button's: the card's raw
 * mouse-down handler returns early for any `button`, so a chip can never open
 * its own card or start a drag — and a dangling chip's click is a deliberate
 * no-op, not an error.
 */
export function MentionChip({
  mention,
  cardNames,
  cardSlugs,
  wordSlugs,
  goneWords,
  onOpenCard,
  onOpenWord,
}: {
  mention: Mention;
  cardNames: ReadonlyMap<string, string>;
  cardSlugs: ReadonlySet<string>;
  wordSlugs: ReadonlySet<string> | null;
  goneWords: readonly string[];
  onOpenCard: (slug: string) => void;
  onOpenWord: (slug: string, label: string) => void;
}) {
  const dangling =
    goneWords.includes(mention.slug) ||
    mentionDangling(mention.kind, mention.slug, cardSlugs, wordSlugs);
  const label = mentionLabel(mention, cardNames);
  return (
    <button
      type="button"
      className={`ground-mention ${mention.kind}${dangling ? " dangling" : ""}`}
      title={dangling ? "missing" : undefined}
      aria-disabled={dangling}
      onClick={() => {
        if (dangling) return;
        if (mention.kind === "card") onOpenCard(mention.slug);
        else onOpenWord(mention.slug, label);
      }}
    >
      {label}
      {dangling && (
        // Shown on hover/focus only (canvas.css); it is the state word, not a
        // badge and not a count.
        <span className="ground-mention-missing">missing</span>
      )}
    </button>
  );
}

/**
 * The note's face: the stored text with chips, cropped on the small card and
 * whole on the expanded one. `maxLines === null` means "the whole note".
 */
export function GroundNote({
  text,
  maxLines,
  cardNames,
  wordSlugs,
  goneWords = [],
  onOpenCard,
  onOpenWord,
}: {
  text: string;
  maxLines: number | null;
  cardNames: ReadonlyMap<string, string>;
  wordSlugs: ReadonlySet<string> | null;
  goneWords?: readonly string[];
  onOpenCard: (slug: string) => void;
  onOpenWord: (slug: string, label: string) => void;
}) {
  const segments = cropSegments(parseMentions(text), maxLines);
  const cardSlugs = new Set(cardNames.keys());
  return (
    <div className="ground-note">
      {segments.map((segment, index) =>
        segment.kind === "text" ? (
          <Fragment key={index}>{segment.text}</Fragment>
        ) : (
          <MentionChip
            key={`${mentionKey(segment.mention.kind, segment.mention.slug)}-${index}`}
            mention={segment.mention}
            cardNames={cardNames}
            cardSlugs={cardSlugs}
            wordSlugs={wordSlugs}
            goneWords={goneWords}
            onOpenCard={onOpenCard}
            onOpenWord={onOpenWord}
          />
        ),
      )}
    </div>
  );
}

/**
 * How much of a concept's memory the panel shows (PROVISIONAL, ADR-0003's
 * rendering seam): cropped like the reading's small card, with ONE trailing
 * ellipsis when the prose runs past it. A view, never a copy: nothing is
 * written, nothing is merged into the note.
 */
export const CONCEPT_PANEL_LINES = 12;

/**
 * The concept's read-only panel — the meta vocabulary this card is playing
 * with, shown without touching either map. Name, then a cropped memory. It is a
 * VIEW: closing it (the ×, Esc, or a press away) writes nothing.
 */
export function GroundConceptPanel({
  name,
  memory,
  onClose,
}: {
  name: string;
  memory: string;
  onClose: () => void;
}) {
  const cropped = previewText(memory, CONCEPT_PANEL_LINES);
  return (
    <div className="ground-concept-panel" role="note" aria-label={`concept: ${name}`}>
      <div className="ground-concept-name">{name}</div>
      {cropped.trim() !== "" && (
        <div className="ground-concept-memory">{cropped}</div>
      )}
      <button
        type="button"
        className="ground-concept-close"
        aria-label="close the concept"
        onClick={onClose}
      >
        close
      </button>
    </div>
  );
}
