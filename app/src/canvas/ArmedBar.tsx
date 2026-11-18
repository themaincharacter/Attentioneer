import type { Level } from "../workspace/level";
import { armedSentence, type ArmedKind } from "./gestureWord";

/**
 * STORY 16.16 (shortlist item 5) — THE ARMED BAR.
 *
 * A bottom-centre bar whose sentence IS the armed tool: "drawing with the pen",
 * "lifting ink with the eraser", "adding a reference", "linking two cards". It exists
 * ONLY while something is armed — the pen or the eraser, a link drag in
 * flight, or the ground bubble asking for a reference — and when the tool is
 * put down it simply goes. Nothing is dismissed, nothing is counted, nothing
 * pulses; it is a state, not a message.
 *
 * The noun is emphasised and the sentence is ONE line (no icons, no buttons).
 * The words are `gestureWord.ts`'s (`armedSentence`), and the reference's noun
 * comes from `mapContentRules.ts`'s `creationNoun` — the same noun the plane's
 * idle hint uses, so the two channels cannot drift apart. The idle hint yields
 * this bar's place while it shows (App suppresses it): the bar is the ACTIVE
 * channel and the hint is the idle one.
 *
 * SCREEN space: it is fixed to the viewport, outside `.plane`, so panning and
 * zooming never move it, and `pointer-events: none` means it can never sit
 * between the hand and the map. PROVISIONAL: the placement and the look.
 */
export const ARMED_BAR_CLASS = "armed-bar";

export function ArmedBar({ kind, level }: { kind: ArmedKind; level: Level }) {
  const sentence = armedSentence(kind, level);
  return (
    <div className={ARMED_BAR_CLASS} data-armed={kind} role="status">
      {sentence.before}
      <span className="armed-bar-noun">{sentence.noun}</span>
      {sentence.after}
    </div>
  );
}
