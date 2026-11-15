import { useEffect } from "react";
import type { LoopRead, WalkStep } from "../map/loopRead";
import {
  walkStepNote,
  walkStepPair,
  walkWordGapText,
  type NameOf,
} from "./notices";

interface LoopWalkProps {
  /** The derived read — recomputed on every record change, never stored. */
  read: LoopRead;
  /**
   * The person's name for a slug (story 3): the walk READS the records by slug
   * but speaks the words' coined names. A gone word falls back to its slug —
   * the record is the only name left.
   */
  nameOf: NameOf;
  onClose: () => void;
}

/**
 * The walk (story 3, ADR-0015 in full): steps in path order, each showing its
 * pair and either its resolved sign or the gap that withheld it — a missing
 * link (with the reverse hint when the other direction exists), a marked link
 * (its sign shown as unknown, never the stored one), a dangling word, an
 * out-of-play word, an unclosed path, no steps. The verdict word —
 * reinforcing or balancing, the glossary's parity rule — appears ONLY when
 * every step resolved and every path word is on the map and in play; on any
 * gap the read names what is missing and no verdict word appears anywhere
 * (ADR-0015 decision 3).
 *
 * The panel is quiet text, fixed in screen space so it stays readable at any
 * zoom: no numerals, no ratios, no strength meter, no score (ADR-0012 decision
 * 7, the glossary's "never a score"). It is a display, not a form of its own;
 * Esc or the × closes it, and the records are untouched either way.
 *
 * The read keeps slugs (world B: identity is the record); every sentence here
 * goes through `nameOf`, so the person reads coins, not slugs (story 3's
 * names-not-slugs rule).
 *
 * Provisional: the layout and the copy (ADR-0003's seam).
 */
export function LoopWalk({ read, nameOf, onClose }: LoopWalkProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="walk"
      role="group"
      aria-label={`the walk through “${read.name}”`}
    >
      <div className="walk-head">
        <span className="walk-title">{read.name}</span>
        <button
          type="button"
          className="walk-close"
          aria-label="close the walk"
          title="close"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      {read.pathGaps.map((gap) => (
        <div className="walk-gap" key={gap.kind}>
          {gap.kind === "unclosed" ? "the path is not closed" : "the path has no steps"}
        </div>
      ))}
      {read.wordGaps.map((gap) => (
        <div className="walk-gap" key={`${gap.kind}-${gap.slug}`}>
          {walkWordGapText(gap, nameOf)}
        </div>
      ))}
      {read.steps.map((step, index) => (
        <StepRow
          key={`${step.from}\u0000${step.to}\u0000${index}`}
          step={step}
          nameOf={nameOf}
        />
      ))}
      {read.verdict !== null && (
        <div className="walk-verdict">{read.verdict}</div>
      )}
    </div>
  );
}

/** One step: the pair first, then its sign or the gap that withheld it. */
function StepRow({ step, nameOf }: { step: WalkStep; nameOf: NameOf }) {
  const pair = walkStepPair(step, nameOf);
  const note = walkStepNote(step, nameOf);
  if (step.kind === "sign") {
    return (
      <div className="walk-step">
        <span className="walk-pair">{pair}</span>
        <span className="walk-sign">{step.sign}</span>
      </div>
    );
  }
  return (
    <div className="walk-step gap">
      <span className="walk-pair">{pair}</span>
      {step.gap.kind === "marked-link" ? (
        <span className="walk-sign unknown" title="sign unsettled">
          ?
        </span>
      ) : null}
      <span className="walk-note">{note}</span>
    </div>
  );
}
