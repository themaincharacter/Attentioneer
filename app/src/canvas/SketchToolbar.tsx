import {
  DEFAULT_PEN_COLOR,
  isPenColor,
  PEN_COLORS,
  PEN_SIZES,
} from "./sketchRules";

interface SketchToolbarProps {
  /** The pen's ink right now (a palette colour or the picker's). */
  color: string;
  /** The pen's thickness right now, in world units. */
  size: number;
  /** Is there a stroke to take back? (Undo is quiet, not a counter.) */
  canUndo: boolean;
  onColor: (color: string) => void;
  onSize: (size: number) => void;
  onUndo: () => void;
  onClear: () => void;
}

/**
 * The pen's quiet controls (added 2026-11-16 per user review): pen size, a few
 * inks plus a picker, undo, and the quiet × that clears the drawing.
 *
 * It is a SCREEN-SPACE strip beside the app's other armed hints (the veil's
 * bar, the path's bar), so it sits OUTSIDE `.plane` and the plane's armed gate
 * never reaches it: while the pen is armed the strip is the only live surface
 * besides the plane's own capture surface, and a press on it can never pan the
 * map, create anything or start a word gesture.
 *
 * No counter, no badge, no history: undo takes the LAST stroke (the one just
 * made) and there is no redo; clear drops them all. The sizes and the palette
 * are provisional (the review asked only for "pen size, color, undo").
 */
export function SketchToolbar({
  color,
  size,
  canUndo,
  onColor,
  onSize,
  onUndo,
  onClear,
}: SketchToolbarProps) {
  return (
    <div className="sketch-bar" role="group" aria-label="draw — the pen">
      <span className="sketch-bar-title">draw</span>
      <span className="sketch-bar-hint">drag on the plane · esc ends</span>
      <div className="sketch-sizes" role="group" aria-label="pen size">
        {PEN_SIZES.map((width) => (
          <button
            key={`size-${width}`}
            type="button"
            className={"sketch-size" + (width === size ? " active" : "")}
            aria-pressed={width === size}
            aria-label={`pen size ${width}`}
            title={`pen size ${width}`}
            onClick={() => onSize(width)}
          >
            <span
              className="sketch-size-dot"
              style={{ width: width + 3, height: width + 3 }}
            />
          </button>
        ))}
      </div>
      <div className="sketch-colors" role="group" aria-label="pen colour">
        {PEN_COLORS.map((ink) => (
          <button
            key={`ink-${ink}`}
            type="button"
            className={"sketch-color" + (ink === color ? " active" : "")}
            aria-pressed={ink === color}
            aria-label={`ink ${ink}`}
            title={`ink ${ink}`}
            style={{ background: ink }}
            onClick={() => onColor(ink)}
          />
        ))}
        {/* Any colour beyond the palette: the picker is a quiet last swatch. */}
        <input
          type="color"
          className="sketch-picker"
          aria-label="pick an ink"
          title="pick an ink"
          value={isPenColor(color) ? color : DEFAULT_PEN_COLOR}
          onChange={(e) => onColor(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="sketch-undo"
        aria-label="undo the last stroke"
        title="undo the last stroke"
        disabled={!canUndo}
        onClick={onUndo}
      >
        ↶
      </button>
      {/* The clear-all is a quiet ×: no confirmation, no history (the review's
          "a clear-all is fine as a quiet x"). */}
      <button
        type="button"
        className="sketch-clear"
        aria-label="clear the drawing (no undo)"
        title="clear the drawing (no undo)"
        onClick={onClear}
      >
        ×
      </button>
    </div>
  );
}
