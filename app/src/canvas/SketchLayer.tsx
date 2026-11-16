import type { Sketch } from "../map/sketches";
import { strokesToPaths } from "./sketchRules";

interface SketchLayerProps {
  /** Every stroke of the drawing, in FILE ORDER (later strokes on top). */
  strokes: readonly Sketch[];
}

/**
 * The map's ink (added 2026-11-16 per user review): one world-space SVG layer
 * inside `.plane-inner`, so the strokes pan and zoom with the map exactly like
 * the wires and the shelf — a stroke is a mark on the paper, not a screen
 * overlay.
 *
 * It paints OVER the map's content (the words render before it): the drawing is
 * an annotation on the map, exactly as the pen's in-flight stroke previews it —
 * and a name is still readable under a thin line, undoable with one press.
 *
 * The layer TAKES NO PRESS (`pointer-events: none` in canvas.css): drawing is
 * the pen's own capture surface while its mode is armed (CanvasPlane), and in
 * every other mode the ink must be invisible to the pointer's accounting — a
 * press on a stroke falls through to the plane or the word under it, exactly as
 * if the ink were on the paper. It is listed in gates.ts's content lists anyway
 * (the ghost diamond's belt-and-braces rule), so an element inside the plane can
 * never quietly become a plane gesture.
 *
 * Each stroke paints with its own authored ink, through `penInk` — a colour CSS
 * cannot paint falls back to the palette's ink while the record keeps the
 * authored string (map/sketches.ts). Size is the stroke's WORLD-unit
 * thickness, so zooming in reads thicker, as ink does.
 */
export function SketchLayer({ strokes }: SketchLayerProps) {
  const paths = strokesToPaths(strokes);
  if (paths.length === 0) return null;
  return (
    <svg className="sketch-layer" aria-hidden="true">
      {paths.map((path) => (
        <path
          key={path.id}
          className="sketch-stroke"
          d={path.d}
          stroke={path.ink}
          strokeWidth={path.size}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
