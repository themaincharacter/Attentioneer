import { LEVELS, type Level } from "../workspace/level";

interface LevelControlProps {
  level: Level;
  /** Switch games. The app cancels any pending gesture and persists the key. */
  onChange: (level: Level) => void;
  /** Re-open the playing-set selector ("edit the playing set", ADR-0013). */
  onEditPlayingSet: () => void;
  /** Arm the path gesture and click a loop's words in order (story 3). */
  onCoinLoop: () => void;
}

/**
 * The quiet level control (ADR-0016, amended): one switch naming the three
 * games — concept, dynamics and ground — over one plane. It is the only way
 * between them; zoom never changes the game.
 *
 * The names are the glossary's words and the honest partition holds: words,
 * distances, marks and the shelf render in every game; dynamics adds the
 * playing set, links, loops and assumptions; ground adds the pointers (the
 * outward reach) and leaves everything else exactly as it was. In dynamics the
 * control grows its two quiet text actions ("edit the playing set", "coin a
 * loop"); in ground it grows none — the reach lives on each word's handle.
 *
 * No badge, no count, no ceremony; the active game is simply inked a little
 * darker. Provisional: the control's wording, order and look (ADR-0003/0016).
 */
export function LevelControl({
  level,
  onChange,
  onEditPlayingSet,
  onCoinLoop,
}: LevelControlProps) {
  return (
    <div className="level-control" role="group" aria-label="level">
      {LEVELS.map((game) => (
        <button
          key={game}
          type="button"
          className={"level-game" + (level === game ? " active" : "")}
          aria-pressed={level === game}
          title={LEVEL_TITLES[game]}
          onClick={() => onChange(game)}
        >
          {game}
        </button>
      ))}
      {level === "dynamics" && (
        <>
          <button
            type="button"
            className="level-edit"
            title="edit the playing set"
            onClick={onEditPlayingSet}
          >
            edit the playing set
          </button>
          {/* Story 3's door: there is no ring-menu kind for a loop (creation
              suspends while the path gesture is armed); the mode control's own
              quiet action arms it, like "edit the playing set" re-runs the
              selector. Provisional: the wording and this being the door. */}
          <button
            type="button"
            className="level-loop"
            title="click a loop's words in order, then name it"
            onClick={onCoinLoop}
          >
            coin a loop
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Each game's quiet hover title. Provisional: the wording (the control's look
 * and wording are ADR-0003's rendering seam).
 */
const LEVEL_TITLES: Record<Level, string> = {
  concept: "concept — words and distances",
  dynamics: "dynamics — a playing set, signed links and loops",
  ground: "ground — the same map, with outward pointers",
};
