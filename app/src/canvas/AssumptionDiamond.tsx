import type { CSSProperties } from "react";

interface AssumptionDiamondProps {
  /** True when this target carries at least one assumption. */
  has: boolean;
  /** Open the target's quiet overlay (its claims, and the field for another). */
  onPress: () => void;
  /** Extra placement class (e.g. `assumption-spot` for a bare spot). */
  className?: string;
  style?: CSSProperties;
}

/**
 * The assumption's presence (ADR-0012 decision 4, ADR-0016): a small HOLLOW
 * DIAMOND, distinct from the memory dot (filled when present) and the mark ring
 * (a circle). One diamond per target however many claims sit on it — a rival is
 * another line in the same overlay, never a second glyph. It appears in the
 * target's hover row (a word's row beside the memory dot, a link's head beside
 * its sign, a loop's name pill, or a bare spot of plane) and quiets to a faint
 * presence when the target actually carries assumptions, so the map says "there
 * is something stated here" without a count or a badge.
 *
 * The glyph is rendering's business (ADR-0003/0016): the shape and its quiet
 * hover live in canvas.css. Level 2 renders it only.
 */
export function AssumptionDiamond({
  has,
  onPress,
  className,
  style,
}: AssumptionDiamondProps) {
  return (
    <button
      type="button"
      className={`assumption-diamond${has ? " has-assumptions" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      aria-label={has ? "read or add an assumption" : "state an assumption"}
      title={has ? "assumptions" : "state an assumption"}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    />
  );
}
