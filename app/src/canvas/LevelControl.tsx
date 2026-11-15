import { LEVELS, type Level } from "../workspace/level";

interface LevelControlProps {
  /**
   * The game the zoom band is in right now, from the DERIVED level (the band's,
   * not the workspace key's). It is the indicator's only source.
   */
  level: Level;
  /**
   * Jump the camera into a game's band (the shared jump intent). The app moves
   * the camera into the band's landing zoom and, when the game changes, writes
   * the resume hint through its queued write.
   */
  onJump: (level: Level) => void;
  /** Re-open the playing-set selector ("edit the playing set", ADR-0013). */
  onEditPlayingSet: () => void;
  /** Arm the path gesture and click a loop's words in order (story 3). */
  onCoinLoop: () => void;
}

/**
 * The quiet level control (ADR-0016, amended by ADR-0018): an INDICATOR and a
 * JUMPER. It names the game the zoom band is in — concept, dynamics or ground,
 * the glossary's words, read from the derived level and never from the
 * workspace key — and pressing a name JUMPS the camera into that band's landing
 * zoom (the direct-movement vehicle). The wheel is the other way between games,
 * so this control is no longer the only switch: the band is the game, and the
 * key it writes is only the resume hint.
 *
 * The names are the glossary's words and the honest partition holds: words,
 * distances, marks and the shelf render in every game; dynamics adds the
 * playing set, links, loops and assumptions; ground adds the pointers (the
 * outward reach) and leaves everything else exactly as it was. In dynamics the
 * control grows its two quiet text actions ("edit the playing set", "coin a
 * loop"); in ground it grows none — the reach lives on each word's handle.
 *
 * Keyboard: the three jumpers are plain buttons in a labelled group, so Tab
 * reaches them and Enter or Space jumps; the game running is pressed
 * (`aria-pressed`) and inked a little darker. A wheel-caused switch never moves
 * focus here — the control is not yanked into the person's way (ADR-0018
 * decision 5); only a deliberate jump returns focus to it.
 *
 * No badge, no count, no ceremony. Provisional: the wording, order and look
 * (ADR-0003/0016/0018), and the landing zoom each jump arrives at.
 */
export function LevelControl({
  level,
  onJump,
  onEditPlayingSet,
  onCoinLoop,
}: LevelControlProps) {
  return (
    <div
      className="level-control"
      role="group"
      aria-label={`zoom level — the game now: ${level}`}
      data-level={level}
    >
      {LEVELS.map((game) => (
        <button
          key={game}
          type="button"
          className={"level-game" + (level === game ? " active" : "")}
          aria-pressed={level === game}
          title={LEVEL_TITLES[game]}
          onClick={() => onJump(game)}
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
 * Each game's quiet hover title, worded as a jump. Provisional: the wording
 * (the control's look and wording are ADR-0003's rendering seam).
 */
const LEVEL_TITLES: Record<Level, string> = {
  concept: "jump to concept — the wide band: words and distances",
  dynamics: "jump to dynamics — the middle band: a playing set, signed links and loops",
  ground: "jump to ground — the close band: the same map, with outward pointers",
};
