import { useEffect, useState } from "react";
import { PagedText } from "../reading/PagedText";
import { GroundReadingText } from "./GroundLayer";
import { groundDisplayName } from "../map/ground";

/** What the pane holds while a card is docked (view state, never a record). */
export interface DockedCard {
  slug: string;
  name: string;
  text: string | null;
}

/**
 * STORY 25-8 (ADR-0046 ruling 2) — THE READING PANE: a fixed dock at the
 * window's right where a card's full text lands when its body is clicked —
 * the expand-on-click is REPLACED by dock-on-click. The reading is PAGED like
 * the token (the person's ruling: four lines a page, the cue flipping in
 * place) rather than a tall scroll, at reading size and in the hand voice's
 * quote ink. The card keeps its token face and lights the "reading" marker
 * while its text is here. The foot carries the person's own note so nothing
 * the click used to reach is lost. PROVISIONAL: the pane's size and place.
 */
export function ReadingPane({
  docked,
  note,
  onSetNote,
  onClose,
}: {
  docked: DockedCard;
  note: string;
  onSetNote: (on: string, text: string) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(note);
  useEffect(() => setDraft(note), [docked.slug, note]);

  // The write path is the seam's own (the queued one-line write); an edit is
  // written when the field is left and it changed, and never otherwise.
  const write = () => {
    if (draft !== note) void onSetNote(docked.slug, draft);
  };

  return (
    <aside className="reading-pane" aria-label="the reading pane">
      <div className="reading-pane-head">
        <span className="ground-name reading-pane-name">
          {groundDisplayName(docked.name)}
        </span>
        <button
          type="button"
          className="reading-pane-close verb-key"
          aria-label="close the reading pane"
          onClick={onClose}
        >
          &times;
        </button>
      </div>
      <div className="reading-pane-body">
        {docked.text !== null ? (
          <PagedText anchor="card">
            <div className="ground-reading reading-pane-reading">
              <GroundReadingText text={docked.text} open />
            </div>
          </PagedText>
        ) : (
          <div className="ground-reading-empty">no reading on this card</div>
        )}
      </div>
      <div className="reading-pane-foot">
        <textarea
          className="reading-pane-note"
          aria-label="the card's note"
          placeholder="a note"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={write}
        />
      </div>
    </aside>
  );
}
