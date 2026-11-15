import { foldCaptionTops, foldExtent, type FoldExtent } from "../map/shelf";

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
}: {
  shelfX: number;
  /** The vertical span the world's shelf occupies (map/shelf.ts's rule). */
  extent?: FoldExtent;
}) {
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
