import { useEffect, useState } from "react";
import type { Point } from "./geometry";
import { chipPoint, gestureSentence, type GestureNarration } from "./gestureWord";

/**
 * STORY 16.16 (shortlist item 4) — THE CURSOR CHIP.
 *
 * One small translucent pill that follows the pointer WHILE a gesture is in
 * flight, says what the hand is doing in the map's own words
 * (`gestureWord.ts`'s table), and is gone the moment the gesture ends. It is
 * SCREEN space and `pointer-events: none`: every number here is a client
 * coordinate, no camera value enters, so panning and zooming never carry it —
 * it is mounted OUTSIDE `.plane` by App for exactly that reason.
 *
 * IT NEVER ADVISES. The sentence is the gesture's name (the one exception is
 * the wiring drag, whose own end IS its sentence). No count of completed work,
 * no progress, no pulse, no "you can also": the chip is a caption for a hand,
 * not a suggestion. It writes nothing and is forgotten with the gesture.
 *
 * IT CLEARS ON RELEASE AND ON WINDOW BLUR: the gesture's own source (the card's
 * drag, the plane's zoom and the pen's stroke) reports idle on release, and
 * this component reports idle on blur so a release outside the window cannot
 * leave a sentence stranded. The position is read from the pointer itself (one
 * passive listener while it is mounted), which also keeps it under the hand
 * during a pan, when no source reports coordinates.
 *
 * PROVISIONAL: the offset, the look and the fade (ADR-0003's rendering seam).
 */
export const GESTURE_CHIP_CLASS = "gesture-chip";

export function GestureChip({
  gesture,
  onClear,
}: {
  /** The gesture in flight; `idle` renders nothing at all. */
  gesture: GestureNarration;
  /** The gesture ended without a release we can see (window blur). */
  onClear: () => void;
}) {
  const [at, setAt] = useState<Point | null>(null);
  const sentence = gestureSentence(gesture);

  useEffect(() => {
    const move = (event: MouseEvent) => {
      setAt({ x: event.clientX, y: event.clientY });
    };
    window.addEventListener("mousemove", move);
    // Release and blur are the two ends the chip can SEE for itself. The
    // gesture's own source reports idle on release; this is the belt-and-braces
    // for a release the source missed, and the blur is the only trace a
    // release outside the window leaves.
    window.addEventListener("mouseup", onClear);
    window.addEventListener("blur", onClear);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", onClear);
      window.removeEventListener("blur", onClear);
    };
  }, [onClear]);

  // No sentence (idle) or no pointer seen yet (a press with no movement): no
  // pill, rather than one at a guessed corner.
  if (sentence === null || at === null) return null;

  const spot = chipPoint(at, {
    width: window.innerWidth,
    height: window.innerHeight,
  });

  return (
    <div
      className={GESTURE_CHIP_CLASS}
      style={{ left: spot.x, top: spot.y }}
      aria-hidden="true"
    >
      {sentence}
    </div>
  );
}
