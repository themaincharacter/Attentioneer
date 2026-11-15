import { createWriteQueue, type WriteQueue } from "../lib/writeQueue";

/**
 * The scenario switch (ADR-0021 decision 5, Epic 8 story 2): the running
 * branch and the ONE write of `workspace.yml`'s `scenario` hint.
 *
 * The pattern is the level handoff's (ADR-0018 decision 2), deliberately:
 *
 *   - the running branch is APP STATE, and the key is the RESUME HINT it
 *     writes when the person switches;
 *   - the switch's write goes through the workspace's in-order write queue, so
 *     two switches in quick succession can never interleave their
 *     read-modify-writes. The queue is the LEVEL handoff's when the app shares
 *     it — both keys live in `workspace.yml`, and `lib/writeQueue.ts` says one
 *     queue belongs to one file;
 *   - RESTORE NEVER WRITES: opening reads the hint, resolves it against the
 *     folders on disk (`active.ts`), and sets the branch. A hand-edited hint is
 *     honored on open and rewritten only on the first deliberate switch.
 *
 * The switch has two deliberate causes and one cause that writes nothing:
 *
 *   - `choose` — the person picked a branch (or the committed model) in the
 *     chooser. The app runs the FULL switch path first (transients close,
 *     gestures cancel, the walk closes, the level pin is released because the
 *     field that held it was closed), then the hint is queued;
 *   - `retire` — the person deleted a branch's folder. Retiring the ACTIVE
 *     branch is a switch to the committed model (the hint must never name a
 *     folder that is about to be gone), so it is a `choose` in everything but
 *     the cause: the same switch path, the same queued hint write;
 *   - `restore` — open. Moves nothing, writes nothing.
 *
 * Switching to the branch already running is a quiet no-op: no switch, no
 * write. Switching to the committed model from the committed model is the same
 * no-op, which is why `null` round-trips safely.
 *
 * Pure apart from its injected callbacks and the queue it owns, so the causes
 * and their write behavior are asserted without a window or a disk.
 */

/** Why the running branch changed. */
export type ScenarioCause = "choose" | "retire" | "restore";

/** What the handoff needs from the app. */
export interface ScenarioHandoffDeps {
  /**
   * Switch the running branch: run the full switch path (close the
   * transients, cancel the armed gestures, close the walk, release the level
   * pin) and point the map at the branch's records — the app's job.
   */
  onSwitch: (next: string | null, cause: ScenarioCause) => void;
  /**
   * The hint's one write: rewrite `workspace.yml`'s `scenario` line (or drop
   * it for the committed model). The handoff queues it, so this must be the
   * read-modify-write body, never a bare write.
   */
  save: (next: string | null) => Promise<void>;
}

/** The running branch and the one write trigger. */
export interface ScenarioHandoff {
  /** The branch running now (null = the committed model). */
  active: () => string | null;
  /** A deliberate pick from the chooser: switch, then queue the hint write. */
  choose: (next: string | null) => void;
  /**
   * A branch's folder was retired. Retiring the ACTIVE one switches to the
   * committed model first (a `retire` cause), so the hint never names a folder
   * being deleted; retiring another branch changes nothing here.
   */
  retire: (slug: string) => void;
  /** Open-restore: the hint sets the branch. It NEVER writes. */
  restore: (next: string | null) => void;
  /** Resolves when every queued write has settled (tests, the app's quiet close). */
  idle: () => Promise<void>;
}

export function createScenarioHandoff(
  initial: string | null,
  deps: ScenarioHandoffDeps,
  queue: WriteQueue = createWriteQueue(),
): ScenarioHandoff {
  let current: string | null = initial;

  function write(next: string | null): void {
    queue.push(() => deps.save(next)).catch(() => undefined);
  }

  function enter(next: string | null, cause: "choose" | "retire"): void {
    if (next === current) return;
    current = next;
    deps.onSwitch(next, cause);
    write(next);
  }

  return {
    active: () => current,
    choose(next) {
      enter(next, "choose");
    },
    retire(slug) {
      // Retiring a branch that is not running is the app's folder work alone.
      if (slug !== current) return;
      enter(null, "retire");
    },
    restore(next) {
      // The hint sets the branch on open. Nothing is written: a hand-edited
      // hint is honored here and rewritten only on the first switch.
      if (next === current) return;
      current = next;
      deps.onSwitch(next, "restore");
    },
    idle: () => queue.idle(),
  };
}
