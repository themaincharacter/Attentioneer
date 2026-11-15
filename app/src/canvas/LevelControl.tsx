import type { Level } from "../workspace/level";

interface LevelControlProps {
  level: Level;
  /** Switch games. The app cancels any pending gesture and persists the key. */
  onChange: (level: Level) => void;
  /** Re-open the playing-set selector ("edit the playing set", ADR-0013). */
  onEditPlayingSet: () => void;
}

/**
 * The quiet level control (ADR-0016): one switch naming the two games —
 * concept and dynamics — over one plane. It is the only way between them; zoom
 * never changes the game. In dynamics it grows one quiet text action, "edit
 * the playing set", which re-runs the selector. No badge, no count, no
 * ceremony; the active game is simply inked a little darker.
 *
 * Provisional: the control's wording and look (ADR-0003/0016).
 */
export function LevelControl({
  level,
  onChange,
  onEditPlayingSet,
}: LevelControlProps) {
  return (
    <div className="level-control" role="group" aria-label="level">
      <button
        type="button"
        className={`level-game${level === "concept" ? " active" : ""}`}
        aria-pressed={level === "concept"}
        title="concept — words and distances"
        onClick={() => onChange("concept")}
      >
        concept
      </button>
      <button
        type="button"
        className={`level-game${level === "dynamics" ? " active" : ""}`}
        aria-pressed={level === "dynamics"}
        title="dynamics — a playing set, signed links and loops"
        onClick={() => onChange("dynamics")}
      >
        dynamics
      </button>
      {level === "dynamics" && (
        <button
          type="button"
          className="level-edit"
          title="edit the playing set"
          onClick={onEditPlayingSet}
        >
          edit the playing set
        </button>
      )}
    </div>
  );
}
