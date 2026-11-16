import {
  DEFAULT_PEN_COLOR,
  isPenColor,
  PEN_COLORS,
  PEN_SIZES,
  type DrawTool,
} from "./sketchRules";

interface SketchToolbarProps {
  /** The pen's ink right now (a palette colour or the picker's). */
  color: string;
  /** The pen's thickness right now, in world units (the eraser's reach follows it). */
  size: number;
  /** Which meaning a drag on the armed plane carries right now. */
  tool: DrawTool;
  /** Is there a change to take back? (Undo is quiet, not a counter.) */
  canUndo: boolean;
  onColor: (color: string) => void;
  onSize: (size: number) => void;
  onTool: (tool: DrawTool) => void;
  onUndo: () => void;
  onClear: () => void;
}

/**
 * The pen's quiet controls (added 2026-11-16 per user review): the tool pair
 * (pen ⇄ eraser), pen size, a few inks plus a picker, undo, and the quiet ×
 * that clears the drawing.
 *
 * It is a SCREEN-SPACE strip beside the app's other armed hints (the veil's
 * bar, the path's bar), so it sits OUTSIDE `.plane` and the plane's armed gate
 * never reaches it: while the pen is armed the strip is the only live surface
 * besides the plane's own capture surface, and a press on it can never pan the
 * map, create anything or start a word gesture. The capture surface's level in
 * canvas.css must stay BELOW the strip's, or it would swallow exactly those
 * presses (it did, once — see `.draw-surface`; the strip's buttons were dead).
 *
 * The eraser is the same armed gesture with a different meaning (the tool state
 * chooses what a drag does), so the strip gains ONE quiet pair rather than a
 * second mode: two small buttons in the sizes/inks idiom, the live one marked
 * `active`. PROVISIONAL: the pair's look, the glyphs, and the colour row's
 * handling — the palette is the PEN's (ink means nothing to an eraser), so
 * while the eraser is live the colour row is disabled: dimmed and inert, never
 * removed, so the strip does not jump when the tool changes.
 *
 * No counter, no badge, no history: the quiet × clears, and undo takes back the
 * last change (a stroke, or one erase gesture). The sizes and the palette are
 * provisional (the review asked only for "pen size, color, undo").
 */
export function SketchToolbar({
  color,
  size,
  tool,
  canUndo,
  onColor,
  onSize,
  onTool,
  onUndo,
  onClear,
}: SketchToolbarProps) {
  // The palette belongs to the pen; the eraser reads no ink at all.
  const inkLive = tool === "pen";
  return (
    <div className="sketch-bar" role="group" aria-label="draw — the pen">
      <span className="sketch-bar-title">draw</span>
      {/* One quiet pair, the active tool marked like the sizes and the inks.
          A disabled button is never faked: the pair is a real toggle, and the
          press it takes is the strip's own (the plane's capture surface sits
          under this bar — canvas.css carries the level rule). */}
      <div className="sketch-tools" role="group" aria-label="tool">
        <button
          type="button"
          className={"sketch-tool" + (tool === "pen" ? " active" : "")}
          aria-pressed={tool === "pen"}
          aria-label="pen"
          title="pen"
          onClick={() => onTool("pen")}
        >
          <span className="sketch-tool-glyph" aria-hidden="true">
            ✎
          </span>
        </button>
        <button
          type="button"
          className={"sketch-tool" + (tool === "eraser" ? " active" : "")}
          aria-pressed={tool === "eraser"}
          aria-label="eraser"
          title="eraser — takes whole strokes"
          onClick={() => onTool("eraser")}
        >
          <span className="sketch-tool-glyph" aria-hidden="true">
            ⌫
          </span>
        </button>
      </div>
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
            title={inkLive ? `ink ${ink}` : "the eraser has no ink"}
            style={{ background: ink }}
            disabled={!inkLive}
            onClick={() => onColor(ink)}
          />
        ))}
        {/* Any colour beyond the palette: the picker is a quiet last swatch. */}
        <input
          type="color"
          className="sketch-picker"
          aria-label="pick an ink"
          title={inkLive ? "pick an ink" : "the eraser has no ink"}
          value={isPenColor(color) ? color : DEFAULT_PEN_COLOR}
          disabled={!inkLive}
          onChange={(e) => onColor(e.target.value)}
        />
      </div>
      <button
        type="button"
        className="sketch-undo"
        aria-label="undo the last change"
        title="undo the last change"
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
