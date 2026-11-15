import type { CSSProperties } from "react";

interface QuantityGlyphProps {
  /** True when this target already carries a quantity line. */
  has: boolean;
  /** Open the target's quiet amount card (read, revise or author a line). */
  onPress: () => void;
  /** Extra placement class (e.g. `quantity-flow` for a pair's head). */
  className?: string;
  style?: CSSProperties;
}

/**
 * The quantity's presence (ADR-0020, Epic 8 story 1): a small quiet glyph in a
 * word's hover row (the STOCK line) or in a signed link's head (the FLOW line
 * over that ordered pair). It follows the existing hover-row idiom — always in
 * the row's fixed slot so the word's box never grows and no wire anchor moves —
 * and reads presence only: faint when the target has no line, solid when it
 * carries one (the assumption diamond's precedent, within the band).
 *
 * It is content (gates.ts), so a press on it can never pan the plane, create
 * anything or start a word gesture. The overlay it opens is rendered at App
 * level, so the word's box (and every wire's anchor) never moves.
 *
 * Provisional: the glyph (`≈`, never a number) and its slot are ADR-0003's
 * rendering seam; the format of the amount lives in map/quantities.ts.
 */
export function QuantityGlyph({
  has,
  onPress,
  className,
  style,
}: QuantityGlyphProps) {
  return (
    <button
      type="button"
      className={`quantity-glyph${has ? " has-quantity" : ""}${className ? ` ${className}` : ""}`}
      style={style}
      aria-label={has ? "read or edit the amount" : "author an amount"}
      title={has ? "amount" : "author an amount"}
      onClick={(e) => {
        e.stopPropagation();
        onPress();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      ≈
    </button>
  );
}
