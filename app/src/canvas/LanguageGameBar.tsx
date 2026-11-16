import {
  SELECT_BAR_HINT,
  SELECT_BAR_LABEL,
  SHAPE_MODES,
  SHAPE_MODE_LABELS,
  type ShapeMode,
} from "./languageGameRules";

/**
 * The selection tool's quiet strip (PROVISIONAL, added 2026-11-16 per the
 * lead's brief): the three shapes the armed drag can draw — freeform (the
 * default), circle, rectangle. It is SCREEN space beside the app's other armed
 * hints (the pen's strip, the veil's bar), so it sits OUTSIDE `.plane` and the
 * plane's armed gate never reaches it: while the selection tool is armed the
 * strip is the only live surface besides the plane's own capture surface, and
 * a press on it can never pan the map, create anything or start a word
 * gesture.
 *
 * The mode in force is pressed (`aria-pressed`) and inked like the pen's
 * tool pair. The shape chosen outlives one arm and one game: putting the tool
 * down and picking it up keeps the mode. No counter, no badge, no history —
 * the strip is three words and one hint.
 */
interface LanguageGameBarProps {
  /** The shape a drag draws right now. */
  shape: ShapeMode;
  /** Choose a shape (the strip's whole job). */
  onShape: (shape: ShapeMode) => void;
}

export function LanguageGameBar({ shape, onShape }: LanguageGameBarProps) {
  return (
    <div className="language-game-bar" role="group" aria-label={SELECT_BAR_LABEL}>
      <span className="language-game-bar-title">select</span>
      <div className="language-game-shapes" role="group" aria-label="shape">
        {SHAPE_MODES.map((mode) => {
          const label = SHAPE_MODE_LABELS[mode];
          return (
            <button
              key={mode}
              type="button"
              className={
                "language-game-shape" + (mode === shape ? " active" : "")
              }
              aria-pressed={mode === shape}
              aria-label={label}
              title={`draw a ${label} shape`}
              onClick={() => onShape(mode)}
            >
              {label}
            </button>
          );
        })}
      </div>
      <span className="language-game-bar-hint">{SELECT_BAR_HINT}</span>
    </div>
  );
}
