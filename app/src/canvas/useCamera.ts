import { useMemo, useState } from "react";
import { DEFAULT_CAMERA_ZOOM, type Level } from "../workspace/level";
import { BAND_ZOOM } from "./zoomBands";

/**
 * Camera seam (ADR-0003): the app owns the camera — one `{x, y, zoom}`
 * transform behind this hook. Content components read the camera; the input
 * layer (CanvasPlane) turns gestures into intents. Nothing outside this module
 * talks to d3-zoom.
 *
 * Every camera intent is BAND-PRESERVING (ADR-0018 decision 4): `setZoomBand`
 * is the shared jump/restore intent that lands inside a band, `centerOn`
 * defaults (at the plane) to its band's landing zoom, and a camera move never
 * writes the level key — only the workspace's handoff does.
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
   * Pass `zoom` to land at a specific zoom; the plane passes its band's
   * landing zoom by default, so centering never flips the game.
   */
  centerOn: (px: number, py: number, sx: number, sy: number, zoom?: number) => void;
  /**
   * Move the camera INTO a band (ADR-0018 decision 4): set the zoom to the
   * band's landing zoom, keeping the screen point `(sx, sy)` fixed when given.
   * It never recentres a world point, never persists position and NEVER writes
   * the level key — the deliberate jump and the open-restore share it.
   */
  setZoomBand: (level: Level, sx?: number, sy?: number) => void;
}

export interface CameraApi {
  camera: Camera;
  intents: CameraIntents;
}

/**
 * The camera every window opens on: the DEFAULT LEVEL's landing zoom, through
 * ONE shared constant (ADR-0018 decision 4), so the opening camera and the
 * opening game agree — the old hard-coded 100% sat in the dynamics band while
 * the default level was concept.
 */
export const INITIAL_CAMERA: Camera = { x: 0, y: 0, zoom: DEFAULT_CAMERA_ZOOM };

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The camera after zooming to `zoom` while keeping the screen point `(sx, sy)`
 * fixed — the arithmetic behind the wheel, `zoomAt` and the band jump. Pure,
 * so a band-preserving camera move is testable without a DOM.
 */
export function zoomAbout(
  camera: Camera,
  zoom: number,
  sx: number,
  sy: number,
): Camera {
  const next = clampZoom(zoom);
  const ratio = next / camera.zoom;
  return {
    zoom: next,
    x: sx - (sx - camera.x) * ratio,
    y: sy - (sy - camera.y) * ratio,
  };
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
        setCamera((c) => zoomAbout(c, c.zoom * factor, sx, sy));
      },
      centerOn: (px, py, sx, sy, zoom) => {
        setCamera((c) => {
          const z = clampZoom(zoom ?? c.zoom);
          return { zoom: z, x: sx - px * z, y: sy - py * z };
        });
      },
      setZoomBand: (level, sx, sy) => {
        setCamera((c) => {
          const zoom = clampZoom(BAND_ZOOM[level]);
          // With no anchor the position stands still: the zoom changes about
          // the plane origin, never a recentre (the open-restore's fallback).
          if (sx === undefined || sy === undefined) return { zoom, x: c.x, y: c.y };
          return zoomAbout(c, zoom, sx, sy);
        });
      },
    }),
    [],
  );

  return { camera, intents };
}
