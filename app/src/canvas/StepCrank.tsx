import type { StepNote } from "../map/step";
import type { NameOf } from "./notices";
import { stepNoteText } from "./stepNotes";

interface StepCrankProps {
  /** The last crank's notes, step-scoped (empty before the first crank). */
  notes: readonly StepNote[];
  /** The person's name for a slug (names-not-slugs, the notices rule). */
  nameOf: NameOf;
  /** One hand-cranked step. ONE notch per press — nothing runs by itself. */
  onCrank: () => void;
}

/**
 * The crank (ADR-0022, Epic 8 story 3): one quiet control and, beneath it, the
 * last crank's notes.
 *
 * It is HAND-CRANKED and nothing else: one notch per press, no timer, no
 * autoplay, no celebration, no score. The notes are STEP-SCOPED — each crank
 * states its own gated pieces, named world and clamped flows, and the next
 * crank replaces them; a clamp is inked a little darker (loud, still quiet:
 * the consequence worth noticing, ADR-0022 decision 2).
 *
 * It lives OUTSIDE `.plane` beside the level control (the control's other
 * dynamics actions live there too), so the plane's armed gate never reaches it
 * and no press on it can pan, create or start a word gesture. It renders at
 * Level 2 only — a step is the dynamics game's own reading.
 *
 * The per-word running amounts and last deltas are NOT here: they ride each
 * stock word (`ReferenceWord`'s quiet run read), so the display is always
 * per-word and can never become a column, a table or a total.
 *
 * Provisional: the wording, the button's look and this being the door
 * (ADR-0003's rendering seam; ADR-0022's reset amendment is the lifecycle).
 */
export function StepCrank({ notes, nameOf, onCrank }: StepCrankProps) {
  return (
    <div className="step-crank" role="group" aria-label="the step">
      <button
        type="button"
        className="step-crank-button"
        title="one hand-cranked step — nothing runs by itself"
        onClick={onCrank}
      >
        crank
      </button>
      {notes.length > 0 && (
        <div className="step-notes" aria-live="polite">
          {notes.map((note, index) => (
            <span
              key={`${index}-${note.kind}`}
              className={
                note.kind === "clamp"
                  ? "step-note step-note-clamp"
                  : "step-note"
              }
            >
              {stepNoteText(note, nameOf)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
