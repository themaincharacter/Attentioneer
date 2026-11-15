import { useCallback, useEffect, useRef, useState } from "react";
import { stepRun, type StepModel, type StepRun } from "../map/step";

/**
 * The step's run lifecycle (ADR-0022 decision 4, amended by Epic 8's check):
 * an EPHEMERAL run held in memory, reset when the ACTIVE model changes and
 * never written anywhere.
 *
 * The reset trigger is `key` — `activeModelKey` (map/step.ts): the records
 * folder (so a scenario switch is a new model even when the copies match), the
 * playing set, the links and the quantities. A COMMITTED-only edit (an
 * assumption, a mark, a pointer, a loop, a word's position) is not an input,
 * so the run survives it — the evidence stays while the person revises. Zoom
 * and level switches are not inputs either; the run survives them, and the
 * app re-renders the same read.
 *
 * Stepping is a reading: this hook has no loader, no writer and no path. A
 * crank REPLACES the run's notes (step-scoped), so each crank states its own
 * consequences and the last crank's clamp is never carried as if it were this
 * one's.
 *
 * Provisional: the shape (a hook keyed by the pure model key). If the comparison
 * (story 4) needs to hold the run open across a re-read, the run is already
 * app state and nothing here writes.
 */
export interface StepRunner {
  /** The run after the last crank, or null before the first one / after a reset. */
  run: StepRun | null;
  /** One hand-cranked step. One notch per press: nothing runs by itself. */
  crank: () => void;
}

export function useStepRun(model: StepModel, key: string): StepRunner {
  const [run, setRun] = useState<StepRun | null>(null);
  const keyRef = useRef(key);

  // The model changed: the run is the OLD model's evidence, so it resets. A
  // key that has not changed is the same model — nothing resets.
  useEffect(() => {
    if (keyRef.current === key) return;
    keyRef.current = key;
    setRun(null);
  }, [key]);

  const crank = useCallback(() => {
    // The key guard covers the one frame between a model edit and the effect
    // above: the stale run is never stepped from as if it belonged to the new
    // model.
    setRun((previous) =>
      stepRun(model, keyRef.current === key ? previous : null),
    );
  }, [key, model]);

  // A run whose key no longer matches is the old model's: invisible at once,
  // even before the reset effect runs.
  return { run: keyRef.current === key ? run : null, crank };
}
