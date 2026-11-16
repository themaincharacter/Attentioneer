import type { Point } from "./geometry";

interface GhostDiamondProps {
  /** The world point of the opened ghost's target (the record's centre). */
  at: Point;
}

/**
 * THE GHOST'S DIAMOND (Epic 10 story 3) — the faint hollow diamond the opened
 * proposal would leave at its target.
 *
 * It is the move's OWN vocabulary: the ghost proposes an assumption, and the
 * assumption's mark is the hollow diamond (ADR-0012). Faint, because it is a
 * proposal and not a record; at the target, because that is where the claim
 * would stand. It exists only inside the person's opening — the app mounts it
 * from `previewPoint`, which answers null for every held proposal — so the map
 * is exactly as it was while a ghost is merely held.
 *
 * Read-only by construction: it takes no press (`pointer-events: none`), so it
 * can never pan the plane, create anything or start a word gesture; the class
 * joins the gate's lists anyway, so a later change cannot quietly open that
 * door.
 *
 * Provisional: the size and the faintness (ADR-0003's rendering seam).
 */
export function GhostDiamond({ at }: GhostDiamondProps) {
  return (
    <div
      className="ghost-diamond"
      style={{ left: at.x, top: at.y }}
      aria-hidden="true"
    />
  );
}
