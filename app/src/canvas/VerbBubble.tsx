import type { ReactNode } from "react";

/**
 * STORY 24-8 (ADR-0044) — ONE BUBBLE IN A CARD'S VERB STRIP. The picture is
 * the glyph; the WORD is never gone — it rides the bubble as its aria-label
 * and as a stamped-tag tooltip on hover AND on keyboard focus (the tag is the
 * name pill's own material). The button keeps the family's own class so the
 * press gates and the class-registry pins hold.
 */
export function VerbBubble({
  label,
  icon,
  className,
  disabled,
  onClick,
}: {
  /** The verb, in the app's own words — the tooltip's and the label's text. */
  label: string;
  icon: ReactNode;
  /** The family's own button class (content to the press gate). */
  className: string;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={"verb-bubble " + className}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon}
      <span className="verb-tip">{label}</span>
    </button>
  );
}

/**
 * THE STRIP'S COUNTER-SCALE, PURE — the name pill's own rule, one formula:
 * clamp(1 / zoom, 1, 4). The floor keeps a zoomed-in strip at the card's own
 * scale; the ceiling makes 25% zoom full size (finger-sized bubbles) and stops
 * growing there. Set as --verb-scale where the card renders (the pill's
 * --pill-scale idiom). PROVISIONAL (ADR-0044): the bounds.
 */
export function verbCounterScale(zoom: number): number {
  return Math.min(Math.max(1 / Math.max(zoom, 0.0001), 1), 4);
}
