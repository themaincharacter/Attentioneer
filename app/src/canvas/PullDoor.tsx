import { PULL_DOOR_LABEL, PULL_DOOR_TITLE } from "./pullRules";

interface PullDoorProps {
  /** The ask itself: open the transient reading. */
  onOpen: () => void;
}

/**
 * THE PULL ASK'S DOOR (Epic 13 story 2; ADR-0030 decisions 4 and 6) — one
 * quiet button, and the ONLY trigger of the pull.
 *
 * It is a plain button with a still label: no badge, no dot, no count, no cue
 * beside it, and nothing behind it that fires on its own. The press IS the ask
 * (the app's one handler reads the records and opens the transient); nothing
 * here reads, remembers or writes.
 *
 * It lives in the level control's pill (the app's quiet instrument cluster),
 * and it is offered in EVERY game: the read set spans the levels (marks and
 * assumptions in the middle band, quantities and pointers close in, veils and
 * pins over the map), so the ask is never a level's own action. The control
 * sits outside the plane, so a press here can never pan the plane or start a
 * plane gesture.
 *
 * Provisional (ADR-0003/0030): the wording ("where am I thin…" — the question
 * the glossary gives the pull; the code name is "the pull ask") and the look.
 */
export function PullDoor({ onOpen }: PullDoorProps) {
  return (
    <button
      type="button"
      className="pull-door"
      title={PULL_DOOR_TITLE}
      onClick={onOpen}
    >
      {PULL_DOOR_LABEL}
    </button>
  );
}
