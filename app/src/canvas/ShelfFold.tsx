import { foldCaptionTops, foldExtent, type FoldExtent } from "../map/shelf";
import { shelfShown } from "./shelfRules";

/**
 * The shelf as a place (ADR-0010): a quiet fold line across the world and a
 * faint margin beyond it, drawn inside `.plane-inner` so it pans and zooms with
 * the map the way a destination does. No counts, badges, or nudges — the line
 * and its caption are the whole surface.
 *
 * The drawn extent is a rendering measurement, not map data (Epic 6 story 3):
 * the plane is unbounded, so the fold must REACH the shelf it marks — it grows
 * to cover every word on the map (plus a margin) and never shrinks below the
 * minimum reach. A word set aside far below still sits beside its line and
 * (through the repeated end caption) its place-label. The shade still fades out
 * instead of ending in a visible edge. Provisional (ADR-0003): the minimum
 * reach, the margin, the caption's repeat and how the fold reads at the zoom
 * extremes are not settled.
 */

/** World-unit depth of the shaded margin before it has faded out. */
const SHADE_DEPTH = 3200;

/** The extent with no words: the minimum reach, so the default look holds. */
const DEFAULT_EXTENT: FoldExtent = foldExtent([]);

export function ShelfFold({
  shelfX,
  extent = DEFAULT_EXTENT,
  shown = shelfShown(),
}: {
  shelfX: number;
  /** The vertical span the world's shelf occupies (map/shelf.ts's rule). */
  extent?: FoldExtent;
  /**
   * Is the shelf drawn right now? Defaulted to the ONE reading
   * (canvas/shelfRules.ts's `shelfShown`), so the flag is a runtime fact and a
   * test can hand in `true` to demonstrate the flip-back.
   */
  shown?: boolean;
}) {
  // DEPRECATED (hidden 2026-11-16 per user review): the SHELF does not render.
  // The review removed the fold, its shaded margin and its "set aside" captions
  // from the concept map; the component keeps every element below, the extent
  // rule keeps measuring (`map/shelf.ts`) and the app keeps passing the extent,
  // so flipping `SHELF_HIDDEN` back restores the whole look with no edit. A
  // word already set aside is not shown either (canvas/shelfRules.ts's
  // `setAsideShown`) — delete the flag, this early return and the shelf's CSS in
  // the deprecated sweep.
  if (!shown) return null;
  return (
    <div className="shelf" aria-hidden="true">
      <div
        className="shelf-shade"
        style={{
          left: shelfX,
          top: extent.top,
          width: SHADE_DEPTH,
          height: extent.height,
        }}
      />
      <div
        className="shelf-fold"
        style={{ left: shelfX, top: extent.top, height: extent.height }}
      />
      {foldCaptionTops(extent).map((top) => (
        <div
          className="shelf-label"
          key={top}
          style={{ left: shelfX + 16, top }}
        >
          set aside
        </div>
      ))}
    </div>
  );
}
