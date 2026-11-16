import { LEVELS, type Level } from "../workspace/level";
import type { Scenario } from "../scenarios/branch";
import { PullDoor } from "./PullDoor";
import { ScenarioChooser } from "./ScenarioChooser";
import { veilLive } from "./veilRules";
import {
  ASK_DOOR_HIDDEN,
  COIN_LOOP_DOOR_HIDDEN,
  COMPARE_DOOR_HIDDEN,
  EDIT_SET_DOOR_HIDDEN,
  PULL_DOOR_HIDDEN,
  SCENARIO_CHOOSER_HIDDEN,
  VEIL_DOOR_HIDDEN,
  offered,
} from "./deprecations";

interface LevelControlProps {
  /**
   * The map on screen right now. It is the tabs' pressed state and nothing
   * derived: the level comes from the tab press (or the workspace's open-restore),
   * never from a zoom (ADR-0032).
   */
  level: Level;
  /**
   * Switch to another map — the TAB's whole job. The app sets the running map
   * (that map's own camera comes back with it) and writes the resume hint
   * through its queued write; no camera move is involved any more.
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
  /**
   * Toggle the map's PEN (added 2026-11-16 per user review): arm the draw
   * layer, or put the pen down when it is already armed. It is offered in
   * EVERY game — the drawing is the map's, not a game's record — and it sits
   * outside `.plane` like the control's other actions, so the plane's armed
   * gate never reaches it; arming runs the app's cancel-pending path, then the
   * gate's `draw` mode owns the pointer.
   */
  onDraw: () => void;
  /** True while the pen is armed (the toggle reads pressed). */
  drawArmed: boolean;
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
  /**
   * THE PULL ASK (Epic 13 story 2, ADR-0030): open the transient reading of the
   * records that exist, each at its own site. It is the pull's ONLY trigger and
   * it is offered in every game — the read set spans the levels — and it sits
   * outside `.plane` like the control's other actions, so the plane's armed
   * gate never reaches it.
   */
  onAskPull: () => void;
}

/**
 * The quiet level control: THE MAP TABS. It names the map on screen — concept,
 * dynamics or ground, the glossary's words — and pressing a name switches to it;
 * the workspace's resume hint is written through the app's queued write.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps, ADR-0032):
 * this row was an INDICATOR and a JUMPER of the ZOOM BAND (ADR-0016 amended by
 * ADR-0018) — it named the game the band derived and pressing a name moved the
 * camera into that band's landing zoom, with the wheel as the other way between
 * maps. The maps are SEPARATE mini-apps now: the tabs switch them and NOTHING
 * else does, the wheel only zooms within the current map, and each map brings
 * its own camera back. The band wording below (hover titles, the group's label)
 * is retired with the band rule — delete it in the deprecated sweep. PROVISIONAL:
 * the new wording ("the concept map", "the dynamics map", "the ground map") and
 * the fact that the tab is the only way between maps are this story's call.
 *
 * The names are the glossary's words. DEPRECATED (hidden 2026-11-16 per user
 * review — separate maps): the old honest partition (words, distances, marks
 * and the shelf in every game; dynamics adding the playing set, links, loops
 * and assumptions; ground adding the pointers) is no longer what renders — the
 * maps are becoming SEPARATE maps, and for now the dynamics and ground maps are
 * BLANK PAPER (the ONE reading is canvas/mapContentRules.ts; the record
 * machinery behind each game's additions is untouched). In dynamics the control
 * used to grow its two quiet text actions ("edit the playing set", "coin a
 * loop"); in ground its additions live on each word's handle — both are hidden
 * with the rest of the menu's doors, and with the map content they acted on.
 *
 * Keyboard: the three tabs are plain buttons in a labelled group, so Tab reaches
 * them and Enter or Space switches; the map running is pressed (`aria-pressed`)
 * and inked a little darker. DEPRECATED (hidden 2026-11-16 per user review —
 * separate mini-apps): the old note said "a wheel-caused switch never moves
 * focus here" — there is no wheel-caused switch any more (ADR-0032): the tabs
 * are the only way between maps, and a tab press is the person's own act.
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
 * Epic 13 story 2 adds THE PULL ASK's door (ADR-0030): one quiet button, and
 * the pull's ONLY trigger. It is offered in EVERY game — the read set spans the
 * levels — and it opens the transient reading outside `.plane`; the press is
 * the ask, and nothing here reads or writes.
 *
 * The map's PEN joins as a level-uniform toggle (added 2026-11-16 per user
 * review): `draw` arms the quiet drawing layer in every game — the strokes are
 * the map's own records, not a game's — and the same button puts the pen down.
 *
 * DEPRECATED (hidden 2026-11-16 per user review): the SAME review played with
 * the control and read it as clutter. What survives is the tab switching (the
 * three game jumpers) and the drawing tool; every other door — the pull ask,
 * the veil, "edit the playing set", "coin a loop", "ask…", the scenario chooser
 * and "compare…" — stays written here, keeps its prop and its handler, and is
 * simply not offered, each behind its own flag in deprecations.ts. The
 * dynamics block therefore renders nothing while the flags are on. Nothing was
 * deleted: the record machinery behind every door (veils, branches, loops, the
 * pull's read, the ghost ask) is still read and written by other features —
 * delete these doors in the deprecated sweep.
 *
 * Provisional: WHICH doors survive (the three map tabs and the pen, and nothing
 * else) is the review's call, and the empty dynamics block is its consequence;
 * the sweep that deletes them is a later session's story.
 *
 * No badge, no count, no ceremony. Provisional: the wording, order and look
 * (ADR-0003/0016/0018/0021/0023/0030), and the landing zoom each jump arrives
 * at.
 */
export function LevelControl({
  level,
  onJump,
  onEditPlayingSet,
  onCoinLoop,
  onDrawVeil,
  onDraw,
  drawArmed,
  scenarios,
  activeScenario,
  onChooseScenario,
  onBranchScenario,
  onRetireScenario,
  onCompare,
  onAsk,
  onAskPull,
}: LevelControlProps) {
  return (
    <div
      className="level-control"
      role="group"
      aria-label={`maps — the map now: ${level}`}
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
      {/* Epic 13 story 2's door: THE PULL ASK — one quiet button, the ONLY
          trigger, offered in every game (the read set spans the levels). It
          sits outside `.plane` beside the control's other actions, so the
          plane's armed gate never reaches it. Provisional: the wording and
          this being the door.

          DEPRECATED (hidden 2026-11-16 per user review): the review read this
          row as clutter — everything but the three game jumpers and the pen —
          so the door is no longer offered. The component, the pull's reading
          and its panel keep working (nothing else triggers the read) — delete
          in the deprecated sweep. */}
      {offered(PULL_DOOR_HIDDEN) && <PullDoor onOpen={onAskPull} />}
      {/* Epic 9 story 1's veil door (ADR-0023): LEVELS 1–2 ONLY, so it lives
          outside the dynamics block — the draw-box works at concept AND
          dynamics. It sits outside `.plane` beside the control's other
          actions, so the plane's armed gate never reaches it; arming runs the
          app's cancel-pending path, then the gate's `veil` mode owns the
          pointer. Provisional: the wording and this being the door.

          DEPRECATED (hidden 2026-11-16 per user review): the review read this
          row as clutter and kept only the game jumpers and the pen, so the
          veil's door is no longer offered. The arm, the box, the coin field and
          the level rule (veilRules.ts) all stay — the level wrapper is kept
          outside the hiding gate so the rule stays written and tested — delete
          in the deprecated sweep. */}
      {veilLive(level) && (
        <>
          {offered(VEIL_DOOR_HIDDEN) && (
            <button
              type="button"
              className="level-veil"
              title="draw a box around what to set aside, then name it and say why"
              onClick={onDrawVeil}
            >
              veil
            </button>
          )}
        </>
      )}
      {/* The map's pen (added 2026-11-16 per user review): one quiet toggle,
          offered in EVERY game because the drawing is the map's own record —
          the concept layer's simplest tool, like a pen on a paper map. Its
          pressed state reads the arm; pressing it again puts the pen down. */}
      <button
        type="button"
        className={"level-draw" + (drawArmed ? " active" : "")}
        aria-pressed={drawArmed}
        title="draw on the map — drag a stroke; esc ends"
        onClick={onDraw}
      >
        draw
      </button>
      {/* The dynamics section, cleared by the review (see below): every door
          here keeps its markup, its prop and its handler and is offered through
          its own hiding flag. With the flags on the section renders nothing —
          that is the review's call, not an accident — and flipping one flag
          back restores just that door. */}
      {level === "dynamics" && (
        <>
          {/* DEPRECATED (hidden 2026-11-16 per user review): "edit the playing
              set" was the selector's door (ADR-0013). The review kept the game
              jumpers and the pen alone, so the door is not offered; the
              selector and its strip stay — delete in the deprecated sweep. */}
          {offered(EDIT_SET_DOOR_HIDDEN) && (
            <button
              type="button"
              className="level-edit"
              title="edit the playing set"
              onClick={onEditPlayingSet}
            >
              edit the playing set
            </button>
          )}
          {/* Story 3's door: there is no ring-menu kind for a loop (creation
              suspends while the path gesture is armed); the mode control's own
              quiet action arms it, like "edit the playing set" re-runs the
              selector. Provisional: the wording and this being the door.

              DEPRECATED (hidden 2026-11-16 per user review): the review kept
              the game jumpers and the pen alone, so "coin a loop" is no longer
              offered; the path session, the loop records and the walk stay —
              delete in the deprecated sweep. */}
          {offered(COIN_LOOP_DOOR_HIDDEN) && (
            <button
              type="button"
              className="level-loop"
              title="click a loop's words in order, then name it"
              onClick={onCoinLoop}
            >
              coin a loop
            </button>
          )}
          {/* Epic 10 story 3's door: the ghost's ask surface — ask for a packet
              about one target, or hand a model's reply back as a proposal. It
              sits outside `.plane` like the control's other actions, so the
              plane's armed gate never reaches it. Provisional: the wording and
              this being the door.

              DEPRECATED (hidden 2026-11-16 per user review): the review kept
              the game jumpers and the pen alone, so the ask door is no longer
              offered; the ask panel, the packets and the held proposals stay —
              delete in the deprecated sweep. */}
          {offered(ASK_DOOR_HIDDEN) && (
            <button
              type="button"
              className="level-ask"
              title="ask for a context packet, or file a model's proposal"
              onClick={onAsk}
            >
              ask…
            </button>
          )}
          {/* Epic 8 story 2's branch chooser (ADR-0021): the list of named
              branches, the committed model, and the quiet × that RETIRES a
              branch by deleting its folder. It sits outside `.plane` like the
              control's other actions, so the plane's armed gate never reaches
              it; a switch runs the app's full switch path.

              DEPRECATED (hidden 2026-11-16 per user review): the review kept
              the game jumpers and the pen alone, so the chooser is no longer
              offered. The chooser, the branch records and the app's switch path
              stay — and the named cost is recorded in deprecations.ts: it was
              the only way back to the committed model from a branch — delete in
              the deprecated sweep. */}
          {offered(SCENARIO_CHOOSER_HIDDEN) && (
            <ScenarioChooser
              scenarios={scenarios}
              active={activeScenario}
              onChoose={onChooseScenario}
              onBranch={onBranchScenario}
              onRetire={onRetireScenario}
            />
          )}
          {/* Epic 8 story 4's door: the comparison reads ONE branch against
              the committed model, so it is offered only once a branch exists.
              It opens the quiet panel just outside `.plane` like the crank;
              the pick inside it is an explicit pick of this session, never the
              resume hint (issue 04's ruling).

              DEPRECATED (hidden 2026-11-16 per user review): the review kept
              the game jumpers and the pen alone, so "compare…" is no longer
              offered; the panel, its bridges and its refusal rules stay —
              delete in the deprecated sweep. */}
          {scenarios.length > 0 && offered(COMPARE_DOOR_HIDDEN) && (
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
 * Each map's quiet hover title, worded as a SWITCH BETWEEN MAPS. Provisional:
 * the wording (the control's look and wording are ADR-0003's rendering seam).
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps, ADR-0032):
 * the titles used to say "jump to …" and name the zoom bands ("the wide band",
 * "the middle band", "the close band") — a zoom-derivation the review retired:
 * the wheel no longer changes the map, so there is no band to jump to, only a
 * MAP to switch to. The band wording is gone; delete this note (and any
 * revival of the band phrasing) in the deprecated sweep.
 */
const LEVEL_TITLES: Record<Level, string> = {
  concept: "switch maps — the concept map",
  dynamics: "switch maps — the dynamics map",
  ground: "switch maps — the ground map",
};
