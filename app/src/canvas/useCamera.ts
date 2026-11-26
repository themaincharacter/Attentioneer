import { useMemo, useState } from "react";
import { DEFAULT_LEVEL, LEVELS, type Level } from "../workspace/level";
import { BAND_ZOOM } from "./zoomBands";

/**
 * Camera seam (ADR-0003): the app owns the camera — one `{x, y, zoom}` transform
 * per map behind this hook. Content components read the camera; the input layer
 * (CanvasPlane) turns gestures into intents. Nothing outside this module talks to
 * d3-zoom.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps, ADR-0032):
 * this hook used to own ONE camera whose every intent was BAND-PRESERVING
 * (ADR-0018 decision 4) — `setZoomBand` landed inside a band, `centerOn` defaulted
 * to its band's landing zoom, and the band was the game. The maps are SEPARATE
 * mini-apps now: `useCamera(level)` keeps a camera PER MAP (position and zoom),
 * so switching maps with the tabs restores that map exactly like a little app,
 * and zoom is ordinary within-map navigation. PROVISIONAL: the per-map cameras
 * are this story's shape (the alternative was one shared camera, which would
 * have yanked the view across a tab switch).
 *
 * `setZoomBand` STAYS WRITTEN and type-checked (the sweep's record of the band
 * intent) and simply has no caller any more: the app switches maps by the tab,
 * never by a camera move. Flipping `ZOOM_SWITCHES_MAP_HIDDEN` back and calling it
 * again restores the band landing without a code change.
 *
 * Provisional: the zoom limits are the ordinary camera clamp now (they were the
 * band-preserving clamp); 0.2 at the floor and 4 at the ceiling are this story's
 * call, not any ADR's.
 */

export interface Camera {
  /** Screen-space position of the plane origin, in CSS pixels. */
  x: number;
  y: number;
  zoom: number;
}

/** The ordinary zoom clamp (PROVISIONAL — no ADR settles the numbers). */
export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 4;

/**
 * Every map's camera: ONE per map, so a tab switch puts the person back exactly
 * where they left that map (its position AND its zoom) instead of re-deriving a
 * view from the new map's landing zoom.
 */
export type MapCameras = Record<Level, Camera>;

/**
 * The cameras a window opens on: each map at the origin, at its opening zoom.
 * PROVISIONAL: `zoomOf` defaults to `zoomBands.ts`'s `BAND_ZOOM` table, which is
 * the band machinery's landing zoom — the three numbers are reused here as each
 * map's OPENING camera while the band rule itself retires (deprecations.ts's
 * ZOOM_SWITCHES_MAP_HIDDEN). Nothing derives a map from them any more.
 */
export function initialMapCameras(
  zoomOf: Record<Level, number> = BAND_ZOOM,
): MapCameras {
  const cameras = {} as MapCameras;
  for (const level of LEVELS) {
    cameras[level] = { x: 0, y: 0, zoom: zoomOf[level] };
  }
  return cameras;
}

/** The cameras every window opens on (one instance, frozen by convention). */
export const INITIAL_CAMERAS: MapCameras = initialMapCameras();

/**
 * The default level's opening camera — ONE shared constant, so the opening
 * camera and the opening map still agree (ADR-0018 decision 4's reading, kept
 * alive by the tests and by the sweep's record).
 */
export const INITIAL_CAMERA: Camera = INITIAL_CAMERAS[DEFAULT_LEVEL];

/** One map's camera, by map. Pure, so a tab switch is testable without a DOM. */
export function cameraOf(cameras: MapCameras, level: Level): Camera {
  return cameras[level];
}

/**
 * The store with ONE map's camera replaced — a switch never touches the maps it
 * is not on, which is the whole per-map promise. Pure.
 */
export function withCameraOf(
  cameras: MapCameras,
  level: Level,
  camera: Camera,
): MapCameras {
  return { ...cameras, [level]: camera };
}

export interface CameraIntents {
  /** Adopt a raw transform — the input layer's normalized output. */
  setTransform: (camera: Camera) => void;
  /** Pan by a screen-space delta in CSS pixels. */
  panBy: (dx: number, dy: number) => void;
  /** Zoom by `factor`, keeping the screen point `(sx, sy)` fixed. */
  zoomAt: (factor: number, sx: number, sy: number) => void;
  /**
   * Move the plane point `(px, py)` to the screen point `(sx, sy)`.
   * Pass `zoom` to land at a specific zoom; without one the map keeps the zoom
   * it is already at (ordinary navigation — PROVISIONAL).
   */
  centerOn: (px: number, py: number, sx: number, sy: number, zoom?: number) => void;
  /**
   * DEPRECATED (hidden 2026-11-16 per user review): the band-preserving jump.
   * Move the camera INTO a band (ADR-0018 decision 4): the zoom becomes the
   * band's landing zoom, keeping the screen point `(sx, sy)` fixed when given.
   * It never wrote the level key. Nothing calls it any more (the zoom no longer
   * switches maps; the tabs do) — the intent stays written for the flip-back and
   * for the sweep's record.
   */
  setZoomBand: (level: Level, sx?: number, sy?: number) => void;
}

export interface CameraApi {
  camera: Camera;
  intents: CameraIntents;
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * The camera after zooming to `zoom` while keeping the screen point `(sx, sy)`
 * fixed — the arithmetic behind the wheel and `zoomAt`. Pure, so ordinary
 * within-map zoom is testable without a DOM.
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

/**
 * The camera seam, PER MAP. `level` is the map on screen: the hook returns that
 * map's camera and hands every intent the same map, so a gesture can never move
 * a map the person is not looking at. A tab switch changes `level`, and the
 * camera to come back is the one this store kept.
 */
/**
 * The camera after ONE GLIDE FRAME toward a target (story 25-6): linear in the
 * position, GEOMETRIC in the scale (a zoom should halve in equal steps, not
 * sprint). PURE — the easing is a number, so the feel is testable and tunable
 * without a DOM. PROVISIONAL: the factor.
 */
export function glideToward(
  shown: Camera,
  target: Camera,
  factor: number,
): Camera {
  return {
    x: shown.x + (target.x - shown.x) * factor,
    y: shown.y + (target.y - shown.y) * factor,
    zoom: Math.exp(
      Math.log(shown.zoom) + (Math.log(target.zoom) - Math.log(shown.zoom)) * factor,
    ),
  };
}

export function useCamera(
  level: Level,
  initial: MapCameras = INITIAL_CAMERAS,
): CameraApi {
  const [cameras, setCameras] = useState<MapCameras>(initial);

  const intents = useMemo<CameraIntents>(() => {
    /** Replace the CURRENT map's camera, leaving every other map's alone. */
    const update = (next: (camera: Camera) => Camera): void => {
      setCameras((all) => withCameraOf(all, level, next(all[level])));
    };
    return {
      setTransform: (t) => {
        update(() => ({ x: t.x, y: t.y, zoom: clampZoom(t.zoom) }));
      },
      panBy: (dx, dy) => {
        update((c) => ({ ...c, x: c.x + dx, y: c.y + dy }));
      },
      zoomAt: (factor, sx, sy) => {
        update((c) => zoomAbout(c, c.zoom * factor, sx, sy));
      },
      centerOn: (px, py, sx, sy, zoom) => {
        update((c) => {
          const z = clampZoom(zoom ?? c.zoom);
          return { zoom: z, x: sx - px * z, y: sy - py * z };
        });
      },
      setZoomBand: (band, sx, sy) => {
        update((c) => {
          const zoom = clampZoom(BAND_ZOOM[band]);
          // With no anchor the position stands still: the zoom changes about
          // the plane origin, never a recentre (the open-restore's fallback).
          if (sx === undefined || sy === undefined) return { zoom, x: c.x, y: c.y };
          return zoomAbout(c, zoom, sx, sy);
        });
      },
    };
  }, [level]);

  return { camera: cameraOf(cameras, level), intents };
}
