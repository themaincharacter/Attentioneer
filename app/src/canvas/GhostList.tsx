import type { GhostRow } from "../ghost/list";

interface GhostListProps {
  /** The held proposals' rows, in arrival order (text only). */
  rows: readonly GhostRow[];
  /** Open one proposal — the person's opening, never automatic. */
  onOpen: (id: string) => void;
}

/**
 * THE QUIET GHOST LIST (Epic 10 story 3) — the held proposals as TEXT.
 *
 * One quiet row per held Patch, in arrival order: what the move does (about
 * what), and the proposal's why verbatim. Nothing else — no glyph, no ring, no
 * tally, no date, no mark of what has been seen, and nothing lifted to the
 * front. The row is a plain text button; pressing it is the person's opening
 * (the preview's only door).
 *
 * The list sits OUTSIDE `.plane`, beside the app's other quiet surfaces, so a
 * held proposal draws nothing on the map: the plane's own gestures can never
 * meet it, and the gate's lists need no entry for these rows.
 *
 * Provisional: the look and the panel's placement.
 */
export function GhostList({ rows, onOpen }: GhostListProps) {
  return (
    <div className="ghost-list" role="group" aria-label="proposals the app holds">
      {rows.map((row) => (
        <button
          key={row.id}
          type="button"
          className="ghost-row"
          title="open this proposal"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(row.id);
          }}
        >
          <span className="ghost-row-move">{row.summary}</span>
          <span className="ghost-row-why">{row.rationale}</span>
        </button>
      ))}
    </div>
  );
}
