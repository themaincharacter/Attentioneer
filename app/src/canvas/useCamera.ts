import { useMemo, useState } from "react";

/**
 * Camera seam (ADR-0003): the app owns the camera — one `{x, y, zoom}`
 * transform behind this hook. Content components read the camera; the input
 * layer (CanvasPlane) turns gestures into intents. Nothing outside this module
 * talks to d3-zoom.
 *
 * Provisional: the zoom limits are not settled by any ADR yet.
 */

export interface Camera {
  /** Screen-space position of the plane origin, in CSS pixels. */
  x: number;
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

export interface CameraIntents {
  /** Adopt a raw transform — the input layer's normalized output. */
  setTransform: (camera: Camera) => void;
  /** Pan by a screen-space delta in CSS pixels. */
  panBy: (dx: number, dy: number) => void;
  /** Zoom by `factor`, keeping the screen point `(sx, sy)` fixed. */
  zoomAt: (factor: number, sx: number, sy: number) => void;
  /**
   * Move the plane point `(px, py)` to the screen point `(sx, sy)`.
   * Pass `zoom` to land at a specific zoom (e.g. 1 for readable zoom).
   */
  centerOn: (px: number, py: number, sx: number, sy: number, zoom?: number) => void;
}

export interface CameraApi {
  camera: Camera;
  intents: CameraIntents;
}

const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function useCamera(initial: Camera = INITIAL_CAMERA): CameraApi {
  const [camera, setCamera] = useState<Camera>(initial);

  const intents = useMemo<CameraIntents>(
    () => ({
      setTransform: (t) => {
        setCamera({ x: t.x, y: t.y, zoom: clampZoom(t.zoom) });
      },
      panBy: (dx, dy) => {
        setCamera((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
      },
      zoomAt: (factor, sx, sy) => {
        setCamera((c) => {
          const zoom = clampZoom(c.zoom * factor);
          const r = zoom / c.zoom;
          return { zoom, x: sx - (sx - c.x) * r, y: sy - (sy - c.y) * r };
        });
      },
      centerOn: (px, py, sx, sy, zoom) => {
        setCamera((c) => {
          const z = clampZoom(zoom ?? c.zoom);
          return { zoom: z, x: sx - px * z, y: sy - py * z };
        });
      },
    }),
    [],
  );

  return { camera, intents };
}
