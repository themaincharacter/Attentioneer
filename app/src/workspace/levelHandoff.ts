import type { Point } from "../canvas/geometry";
import { createWriteQueue, type WriteQueue } from "../lib/writeQueue";
import { levelFromZoom, type Level } from "./level";

/**
 * The strict handoff between the zoom band and the level key (ADR-0018
 * decision 2). ONE source of behavior and ONE source of record, synchronized
 * in one direction each:
 *
 *   - the BAND is the game at runtime. A settled zoom crossing derives the
 *     band (`levelFromZoom`) and writes `workspace.yml`'s `level` key;
 *   - the KEY is the resume hint. On open it sets the camera into its band —
 *     and opening NEVER writes, so a hand-edited key is honored on open and
 *     rewritten only on the first settled crossing.
 *
 * There is ONE write trigger (`save`), reached by exactly two causes: a zoom
 * gesture that settled (d3's `end`) and a deliberate jump. Both write through
 * the workspace's in-order queue (`lib/writeQueue.ts`), so two crossings in
 * quick succession can never interleave their read-modify-writes. The
 * open-restore cause moves the camera and writes nothing.
 *
 * The band and the key cannot disagree while running: every switch the band
 * makes is written, and every write is the level the band is in. An armed
 * gesture's pinning is the interaction-mode gate's job (story 2) — this module
 * only rules on a SETTLED reading.
 *
 * A JUMP may carry an ANCHOR (Epic 6 story 3): the level control jumps about
 * the viewport's centre, while a word's follow jumps about the word's own
 * screen point, keeping that word under the eye. The anchor is passed straight
 * to the camera intent (`setZoomBand(level, sx, sy)`) and changes nothing about
 * the handoff's write rule — a deliberate jump is still the one deliberate
 * cause.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps, ADR-0032):
 * THE WHEEL NO LONGER SWITCHES THE MAP. `settle` (the zoom-derived cause) has no
 * caller any more: the three maps are separate mini-apps and the level TABS are
 * the only way between them, so `jump` is now the tab press (it writes the
 * resume hint, and the app no longer moves a camera "into a band") and `restore`
 * is unchanged (the open reads the hint, writes nothing). The settle path, the
 * derivation it reads and the level pin's holding stay WRITTEN and type-checked
 * for the flip-back (`canvas/shelfRules.ts`'s `zoomSwitchesMap`) and for the
 * sweep's record — delete the settle cause in the deprecated sweep.
 *
 * Pure apart from its injected callbacks and the queue it owns, so the three
 * causes and their write behavior are asserted without a window.
 */

/** Why the running game changed. */
export type HandoffCause = "settle" | "jump" | "restore";

/** What the handoff needs from the app. */
export interface LevelHandoffDeps {
  /**
   * Switch the running game: mirror the derived level, run the full switch
   * path (close transients, settle focus) — the app's job.
   */
  onSwitch: (next: Level, cause: HandoffCause) => void;
  /**
   * Move the camera INTO a band — the shared jump intent. No recentre and no
   * position yank: it never writes the key and never persists position. An
   * optional `screen` anchor keeps that screen point fixed across the jump
   * (the word's follow, story 3); without one the viewport's centre is used.
   */
  moveCamera: (next: Level, screen?: Point) => void;
  /**
   * The key's one write: rewrite `workspace.yml`'s level line. The handoff
   * queues it, so this must be the read-modify-write body, never a bare write.
   */
  save: (next: Level) => Promise<void>;
}

/** The handoff's three causes and its one write trigger. */
export interface LevelHandoff {
  /** The game running now (the band's, as of the last settle / jump / restore). */
  level: () => Level;
  /**
   * DEPRECATED (hidden 2026-11-16 per user review): a zoom gesture SETTLED —
   * derive the band from the zoom and, when it changed, switch the game and
   * queue the key write. The wheel no longer changes the map, so nothing calls
   * this; the machinery stays for the flip-back — delete it in the deprecated
   * sweep.
   */
  settle: (zoom: number) => void;
  /**
   * A deliberate switch to a map: DEPRECATED (hidden 2026-11-16 per user review —
   * separate mini-apps, ADR-0032) this used to move the camera into the band's
   * landing zoom — about `screen` when given, keeping that point under the eye —
   * and, when the game changed, switch and queue the write. Now it is the TAB
   * PRESS: the map changes, the resume hint is written, and no camera moves (each
   * map keeps its own). `screen` is still accepted (the word's follow passes one)
   * and ignored by the app's no-op camera dependency — delete it in the sweep.
   */
  jump: (next: Level, screen?: Point) => void;
  /**
   * Open-restore: the key sets the camera into its band. It NEVER writes —
   * opening is a read (ADR-0018 decision 2).
   */
  restore: (next: Level) => void;
  /** Resolves when every queued write has settled (tests, the app's quiet close). */
  idle: () => Promise<void>;
}

/**
 * The level handoff. `queue` is optional so tests (and any caller with one
 * file) can stay queue-free; the APP passes the workspace's ONE
 * `workspace.yml` queue, shared with the scenario handoff
 * (`scenarios/handoff.ts`) — both keys live in that one file, and
 * `lib/writeQueue.ts`'s rule is one queue per file, so their
 * read-modify-writes can never interleave.
 */
export function createLevelHandoff(
  initial: Level,
  deps: LevelHandoffDeps,
  queue: WriteQueue = createWriteQueue(),
): LevelHandoff {
  let current: Level = initial;

  /**
   * THE one level write trigger. Queued, so a burst of crossings lands in the
   * order the person made them; a failed write is reported nowhere here (the
   * fs bridge's business) and never stalls the next one.
   */
  function write(next: Level): void {
    queue.push(() => deps.save(next)).catch(() => undefined);
  }

  /** A settle or a jump: switch + write only when the game actually changed. */
  function enter(next: Level, cause: "settle" | "jump"): void {
    if (next === current) return;
    current = next;
    deps.onSwitch(next, cause);
    write(next);
  }

  return {
    level: () => current,
    settle(zoom) {
      enter(levelFromZoom(zoom), "settle");
    },
    jump(next, screen) {
      // The camera moves into the band first: the jump IS the direct-movement
      // vehicle, and the band it lands in is the game it switches to. The
      // anchor (when a word's follow gives one) keeps that word under the eye.
      deps.moveCamera(next, screen);
      enter(next, "jump");
    },
    restore(next) {
      // The key sets the band on open. The camera moves; nothing is written:
      // a hand-edited key is honored here and rewritten only on the first
      // settled crossing.
      deps.moveCamera(next);
      if (next === current) return;
      current = next;
      deps.onSwitch(next, "restore");
    },
    idle: () => queue.idle(),
  };
}
