import type { GameShape } from "../map/languageGames";

/**
 * One language game's fill, in WORLD space (PROVISIONAL, added 2026-11-16 per
 * the lead's brief). The shape pans and zooms with the map exactly like the
 * veils' covers and the pen's ink, because it lives inside `.plane-inner` —
 * the region is on the paper, not an overlay on the screen.
 *
 * STACKING: the fill sits above the paper and the dot grid and BELOW the words
 * and the pen's ink (canvas.css gives the layer z-index 1; words, wires and ink
 * sit above it), so a name always reads over a tint. Overlapping games are
 * allowed by design: the app renders them in FILE ORDER and each one is its
 * own quiet wash, so overlapping regions simply deepen where they meet. The
 * game brought forward from the list paints more opaquely than the rest (the
 * opacities live in languageGameRules.ts).
 *
 * The layer TAKES NO PRESS (`pointer-events: none`): a press on a fill falls
 * through to the plane or the word under it, exactly as if the tint were part
 * of the paper. It is listed in gates.ts's content lists anyway (the ghost
 * diamond's belt-and-braces rule), so an element inside the plane can never
 * quietly become a plane gesture.
 *
 * The DRAFT (`draft`) is the in-flight or unsaved selection: the same shape,
 * painted at the draft's opacity with a faint dashed edge, so the person sees
 * what the release drew before the popup asks for a name.
 */
interface LanguageGameFillProps {
  /** The drawn region, in world coordinates. */
  shape: GameShape;
  /** The ink to paint, already through `gameInk` (languageGameRules.ts). */
  ink: string;
  /** The fill's opacity, from the rules module's quiet numbers. */
  opacity: number;
  /** Is this the unsaved draft? (a dashed edge, a fainter wash) */
  draft?: boolean;
}

export function LanguageGameFill({
  shape,
  ink,
  opacity,
  draft = false,
}: LanguageGameFillProps) {
  const shared = {
    fill: ink,
    fillOpacity: draft ? 0.08 : opacity,
    ...(draft
      ? {
          stroke: ink,
          strokeWidth: 1.2,
          strokeDasharray: "5 5",
          vectorEffect: "non-scaling-stroke" as const,
        }
      : {}),
  };
  return (
    <svg
      className={"language-game-fill" + (draft ? " language-game-draft" : "")}
      aria-hidden="true"
    >
      {shape.kind === "polygon" && (
        <polygon
          points={shape.points
            .map((point) => `${point.x},${point.y}`)
            .join(" ")}
          {...shared}
        />
      )}
      {shape.kind === "circle" && (
        <circle cx={shape.cx} cy={shape.cy} r={shape.r} {...shared} />
      )}
      {shape.kind === "rect" && (
        <rect
          x={shape.x}
          y={shape.y}
          width={shape.w}
          height={shape.h}
          {...shared}
        />
      )}
    </svg>
  );
}
