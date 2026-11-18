import { useEffect } from "react";
import { usePlane } from "./CanvasPlane";
import { counterScale } from "./veilRules";

/**
 * STORY 16.20 — THE DROP'S ONE SENTENCE, WHERE THE POINTER WAS.
 *
 * A refused drop is not a toast: it belongs to the point the hand released, the
 * same way the bubble's refusal belongs to the bubble. So this sits in world
 * space at the drop's point and counter-scales against the camera (the
 * naming/bubble idiom), reads as content, and takes no press of its own.
 *
 * It is ONE sentence for the whole drop (the pure rule in `osDrop.ts` collapsed
 * the count), and it is view state only: it is never written, never counted and
 * never a reason to retry by itself. It clears on its own so a refusal does not
 * become furniture; the next drop replaces it.
 *
 * PROVISIONAL: the span and the look.
 */

/** How long a drop's sentence stays before it clears itself. */
export const DROP_NOTICE_MS = 5000;

interface GroundDropNoticeProps {
  x: number;
  y: number;
  /** The drop's ONE sentence. */
  text: string;
  /** A changing key, so a second drop restarts the window (never stacks). */
  taken: number;
  onDismiss: () => void;
}

export function GroundDropNotice({
  x,
  y,
  text,
  taken,
  onDismiss,
}: GroundDropNoticeProps) {
  const { camera } = usePlane();

  useEffect(() => {
    const timer = setTimeout(onDismiss, DROP_NOTICE_MS);
    return () => clearTimeout(timer);
  }, [taken, onDismiss]);

  return (
    <div
      className="ground-drop-notice"
      role="status"
      style={{
        left: x,
        top: y,
        transform: `scale(${counterScale(camera.zoom)})`,
      }}
    >
      {text}
    </div>
  );
}
