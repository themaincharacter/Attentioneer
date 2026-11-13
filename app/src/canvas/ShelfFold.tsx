/**
 * The shelf as a place (ADR-0010): a quiet fold line across the world and a
 * faint margin beyond it, drawn inside `.plane-inner` so it pans and zooms with
 * the map the way a destination does. No counts, badges, or nudges — the line
 * and its caption are the whole surface.
 *
 * The drawn extent is a rendering constant, not map data: the plane is
 * unbounded, so the fold is drawn far enough to cover any realistic pan and the
 * shade fades out instead of ending in a visible edge. Provisional (ADR-0003):
 * how the fold and shelf words read at the zoom extremes is not settled.
 */

/** World-unit half-extent of the drawn fold and shade (the plane is unbounded). */
const FOLD_REACH = 10000;

/** World-unit depth of the shaded margin before it has faded out. */
const SHADE_DEPTH = 3200;

export function ShelfFold({ shelfX }: { shelfX: number }) {
  return (
    <div className="shelf" aria-hidden="true">
      <div
        className="shelf-shade"
        style={{
          left: shelfX,
          top: -FOLD_REACH,
          width: SHADE_DEPTH,
          height: FOLD_REACH * 2,
        }}
      />
      <div
        className="shelf-fold"
        style={{ left: shelfX, top: -FOLD_REACH, height: FOLD_REACH * 2 }}
      />
      <div className="shelf-label" style={{ left: shelfX + 16 }}>
        set aside
      </div>
    </div>
  );
}
