import { LEVELS, type Level } from "../workspace/level";
import type { Scenario } from "../scenarios/branch";
import { ScenarioChooser } from "./ScenarioChooser";
import { veilLive } from "./veilRules";

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
  /**
   * Arm the veil's draw-box (Epic 9 story 1, ADR-0023): drag a rectangle on
   * empty plane, then name the cover and say why. Offered in Levels 1–2 only —
   * at ground no sheet renders, so no veil is coined there either.
   */
  onDrawVeil: () => void;
  /** The branch folders the workspace holds (Epic 8 story 2, ADR-0021). */
  scenarios: readonly Scenario[];
  /** The branch running now, or null for the committed model. */
  activeScenario: string | null;
  /** Switch to a branch, or back to the committed model. */
  onChooseScenario: (slug: string | null) => void;
  /** Coin a branch's name and branch the committed model under it. */
  onBranchScenario: (name: string) => void;
  /** Retire (delete) a branch's folder. */
  onRetireScenario: (slug: string) => void;
  /** Open the comparison — a branch read against the committed model (story 4). */
  onCompare: () => void;
  /**
   * Open the ghost's ask surface (Epic 10 story 3): ask for a context packet
   * about one target, or paste a model's reply back as a proposal. It sits
   * outside `.plane` like the control's other actions, so the plane's armed
   * gate never reaches it.
   */
  onAsk: () => void;
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
 * Epic 8 story 2 grows the dynamics section with the SCENARIO CHOOSER
 * (ADR-0021): the quiet list of named branches, the committed model ("the
 * map"), and the one action that makes a branch. It is outside `.plane` like
 * the other actions here, and switching runs the app's full switch path.
 *
 * Epic 8 story 4 grows the section once more with "compare…" (ADR-0021 §7
 * amended): the door to the frozen two-value reading of one explicitly picked
 * branch against the committed model. It is offered only when a branch exists —
 * a reading needs one — and it opens the quiet panel outside `.plane`.
 *
 * Epic 9 story 1 adds the VEIL door (ADR-0023): "veil" arms the draw-box. It is
 * offered in Levels 1–2 only — the two games a veil covers — and never at
 * ground, where no sheet renders and the game switch is the look-under. It is
 * the ONE level-uniform veil action: the lasso inside the playing-set selector
 * is a different arm and a different surface.
 *
 * No badge, no count, no ceremony. Provisional: the wording, order and look
 * (ADR-0003/0016/0018/0021/0023), and the landing zoom each jump arrives at.
 */
export function LevelControl({
  level,
  onJump,
  onEditPlayingSet,
  onCoinLoop,
  onDrawVeil,
  scenarios,
  activeScenario,
  onChooseScenario,
  onBranchScenario,
  onRetireScenario,
  onCompare,
  onAsk,
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
      {/* Epic 9 story 1's veil door (ADR-0023): LEVELS 1–2 ONLY, so it lives
          outside the dynamics block — the draw-box works at concept AND
          dynamics. It sits outside `.plane` beside the control's other
          actions, so the plane's armed gate never reaches it; arming runs the
          app's cancel-pending path, then the gate's `veil` mode owns the
          pointer. Provisional: the wording and this being the door. */}
      {veilLive(level) && (
        <button
          type="button"
          className="level-veil"
          title="draw a box around what to set aside, then name it and say why"
          onClick={onDrawVeil}
        >
          veil
        </button>
      )}
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
          {/* Epic 10 story 3's door: the ghost's ask surface — ask for a packet
              about one target, or hand a model's reply back as a proposal. It
              sits outside `.plane` like the control's other actions, so the
              plane's armed gate never reaches it. Provisional: the wording and
              this being the door. */}
          <button
            type="button"
            className="level-ask"
            title="ask for a context packet, or file a model's proposal"
            onClick={onAsk}
          >
            ask…
          </button>
          {/* Epic 8 story 2's branch chooser (ADR-0021): the list of named
              branches, the committed model, and the quiet × that RETIRES a
              branch by deleting its folder. It sits outside `.plane` like the
              control's other actions, so the plane's armed gate never reaches
              it; a switch runs the app's full switch path. */}
          <ScenarioChooser
            scenarios={scenarios}
            active={activeScenario}
            onChoose={onChooseScenario}
            onBranch={onBranchScenario}
            onRetire={onRetireScenario}
          />
          {/* Epic 8 story 4's door: the comparison reads ONE branch against
              the committed model, so it is offered only once a branch exists.
              It opens the quiet panel just outside `.plane` like the crank;
              the pick inside it is an explicit pick of this session, never the
              resume hint (issue 04's ruling). */}
          {scenarios.length > 0 && (
            <button
              type="button"
              className="level-compare"
              title="read a branch against the committed model"
              onClick={onCompare}
            >
              compare…
            </button>
          )}
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
