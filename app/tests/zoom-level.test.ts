import { describe, expect, test } from "bun:test";
import {
  atOrAbove,
  BAND_ZOOM,
  COLLAPSE_BELOW,
  DISTANCE_LABEL_BELOW,
  distanceLabelVisible,
  DYNAMICS_FROM,
  GROUND_FROM,
  noteBand,
} from "../src/canvas/zoomBands";
import {
  INITIAL_CAMERA,
  MAX_ZOOM,
  MIN_ZOOM,
  zoomAbout,
} from "../src/canvas/useCamera";
import {
  centeringZoom,
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_LEVEL,
  levelFromZoom,
  LEVELS,
} from "../src/workspace/level";

/**
 * Zoom is the level (ADR-0018 decision 1), automated at the pure layer:
 * `levelFromZoom` is the derivation, its band boundaries are INCLUSIVE at the
 * lower edge and EXCLUSIVE at the upper edge (the one shared `atOrAbove`
 * reading), the band constants are SEPARATE from the content thresholds, and
 * the label-legibility hard requirement holds — a concept-representative zoom
 * and the dynamics band's mid both keep distance labels visible.
 *
 * The camera intents keep the band: centering lands on its band's landing zoom
 * and the default camera derives from the default level through one constant.
 * The window's feel is the human check.
 */

/** A zoom was refused by the camera's limits? Then it is not a settled zoom. */
const SETTLED_ZOOMS = [MIN_ZOOM, 0.3, 0.55, 0.7, 0.84, DYNAMICS_FROM, 1, 1.2, 1.69, GROUND_FROM, 2, 3.9, MAX_ZOOM];

describe("levelFromZoom: the band is the game", () => {
  test("the lower bound of each band is inclusive, the upper exclusive", () => {
    // concept: [MIN_ZOOM, DYNAMICS_FROM)
    expect(levelFromZoom(MIN_ZOOM)).toBe("concept");
    expect(levelFromZoom(DYNAMICS_FROM - 0.001)).toBe("concept");
    // dynamics: [DYNAMICS_FROM, GROUND_FROM)
    expect(levelFromZoom(DYNAMICS_FROM)).toBe("dynamics");
    expect(levelFromZoom(GROUND_FROM - 0.001)).toBe("dynamics");
    // ground: [GROUND_FROM, MAX_ZOOM]
    expect(levelFromZoom(GROUND_FROM)).toBe("ground");
    expect(levelFromZoom(MAX_ZOOM)).toBe("ground");
  });

  test("the three bands tile the camera's whole range, in order", () => {
    let last = -1;
    for (const zoom of SETTLED_ZOOMS) {
      const rank = LEVELS.indexOf(levelFromZoom(zoom));
      expect(rank).toBeGreaterThanOrEqual(last);
      last = rank;
    }
    expect(levelFromZoom(MIN_ZOOM)).toBe("concept");
    expect(levelFromZoom(MAX_ZOOM)).toBe("ground");
  });

  test("each band's landing zoom derives that band", () => {
    for (const level of LEVELS) {
      expect(levelFromZoom(BAND_ZOOM[level])).toBe(level);
    }
  });

  test("garbage is the default level, never a crash", () => {
    for (const garbage of [NaN, Infinity, -Infinity]) {
      expect(levelFromZoom(garbage)).toBe(DEFAULT_LEVEL);
    }
    // Out-of-range numbers still derive a band (the camera clamps long before).
    expect(levelFromZoom(0)).toBe("concept");
    expect(levelFromZoom(-3)).toBe("concept");
    expect(levelFromZoom(1e9)).toBe("ground");
  });
});

describe("one shared comparison: atOrAbove is inclusive", () => {
  test("exactly on a threshold counts as above it", () => {
    expect(atOrAbove(0.85, 0.85)).toBe(true);
    expect(atOrAbove(0.8499, 0.85)).toBe(false);
    expect(atOrAbove(0.8501, 0.85)).toBe(true);
  });

  test("both content readings are inclusive at their threshold", () => {
    // The old clash: one rule was written strictly, the next inclusively, so a
    // zoom exactly on 55% could be both "collapsed" and "labelled". Both now
    // read through atOrAbove.
    expect(noteBand(COLLAPSE_BELOW)).toBe("full");
    expect(noteBand(COLLAPSE_BELOW - 0.001)).toBe("title");
    expect(distanceLabelVisible(DISTANCE_LABEL_BELOW)).toBe(true);
    expect(distanceLabelVisible(DISTANCE_LABEL_BELOW - 0.001)).toBe(false);
  });

  test("the band boundaries are SEPARATE constants from the content thresholds", () => {
    for (const boundary of [DYNAMICS_FROM, GROUND_FROM]) {
      expect(boundary).not.toBe(COLLAPSE_BELOW);
      expect(boundary).not.toBe(DISTANCE_LABEL_BELOW);
    }
    // The old double-booking had one value doing both jobs.
    const distinct = new Set([
      COLLAPSE_BELOW,
      DISTANCE_LABEL_BELOW,
      DYNAMICS_FROM,
      GROUND_FROM,
    ]);
    expect(distinct.size).toBeGreaterThan(2);
    expect(DYNAMICS_FROM).toBeLessThan(GROUND_FROM);
    expect(DYNAMICS_FROM).toBeGreaterThan(MIN_ZOOM);
    expect(GROUND_FROM).toBeLessThan(MAX_ZOOM);
  });
});

describe("the label-legibility hard requirement", () => {
  test("a concept-representative zoom keeps distance labels visible", () => {
    expect(BAND_ZOOM.concept).toBeGreaterThanOrEqual(DISTANCE_LABEL_BELOW);
    expect(distanceLabelVisible(BAND_ZOOM.concept)).toBe(true);
    // The band's landing zoom is the representative: a jump to concept never
    // hides the distance words.
    expect(levelFromZoom(BAND_ZOOM.concept)).toBe("concept");
  });

  test("the dynamics band's mid keeps distance labels visible", () => {
    const mid = (DYNAMICS_FROM + GROUND_FROM) / 2;
    expect(distanceLabelVisible(mid)).toBe(true);
    // The whole dynamics band is legible, not just its mid.
    for (const zoom of [DYNAMICS_FROM, mid, GROUND_FROM - 0.001]) {
      expect(distanceLabelVisible(zoom)).toBe(true);
    }
  });
});

describe("the band landing zooms are reachable and inside their band", () => {
  test("every landing zoom is a camera zoom inside its own band", () => {
    for (const level of LEVELS) {
      expect(BAND_ZOOM[level]).toBeGreaterThanOrEqual(MIN_ZOOM);
      expect(BAND_ZOOM[level]).toBeLessThanOrEqual(MAX_ZOOM);
      expect(levelFromZoom(BAND_ZOOM[level])).toBe(level);
    }
  });
});

describe("a click-to-center never flips the game", () => {
  test("centering stays in the band it began in, from anywhere", () => {
    for (const zoom of SETTLED_ZOOMS) {
      expect(levelFromZoom(centeringZoom(zoom))).toBe(levelFromZoom(zoom));
    }
  });

  test("centering lands on its band's landing zoom", () => {
    expect(centeringZoom(0.3)).toBe(BAND_ZOOM.concept);
    expect(centeringZoom(0.7)).toBe(BAND_ZOOM.concept);
    expect(centeringZoom(DYNAMICS_FROM)).toBe(BAND_ZOOM.dynamics);
    expect(centeringZoom(1.5)).toBe(BAND_ZOOM.dynamics);
    expect(centeringZoom(GROUND_FROM)).toBe(BAND_ZOOM.ground);
    expect(centeringZoom(MAX_ZOOM)).toBe(BAND_ZOOM.ground);
  });
});

describe("the default camera derives from the default level (one constant)", () => {
  test("DEFAULT_CAMERA_ZOOM, INITIAL_CAMERA and DEFAULT_LEVEL agree", () => {
    expect(DEFAULT_LEVEL).toBe("concept");
    expect(DEFAULT_CAMERA_ZOOM).toBe(BAND_ZOOM[DEFAULT_LEVEL]);
    expect(INITIAL_CAMERA.zoom).toBe(DEFAULT_CAMERA_ZOOM);
    expect(levelFromZoom(INITIAL_CAMERA.zoom)).toBe(DEFAULT_LEVEL);
    // The opening camera opens on a legible concept zoom, not a dynamics one.
    expect(distanceLabelVisible(INITIAL_CAMERA.zoom)).toBe(true);
    expect(INITIAL_CAMERA.x).toBe(0);
    expect(INITIAL_CAMERA.y).toBe(0);
  });
});

describe("zoomAbout: the jump keeps the anchor and the band", () => {
  test("the world point under the anchor stays under it", () => {
    const camera = { x: 37, y: -12, zoom: 0.6 };
    const next = zoomAbout(camera, BAND_ZOOM.dynamics, 400, 300);
    expect(next.zoom).toBe(BAND_ZOOM.dynamics);
    const worldBefore = {
      x: (400 - camera.x) / camera.zoom,
      y: (300 - camera.y) / camera.zoom,
    };
    const worldAfter = {
      x: (400 - next.x) / next.zoom,
      y: (300 - next.y) / next.zoom,
    };
    expect(worldAfter.x).toBeCloseTo(worldBefore.x, 10);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y, 10);
  });

  test("a jump into any band lands in that band from any zoom", () => {
    for (const from of [MIN_ZOOM, 0.7, 1, 2, MAX_ZOOM]) {
      for (const level of LEVELS) {
        const next = zoomAbout({ x: 0, y: 0, zoom: from }, BAND_ZOOM[level], 100, 80);
        expect(levelFromZoom(next.zoom)).toBe(level);
      }
    }
  });

  test("the camera's limits still clamp a jump", () => {
    expect(zoomAbout({ x: 0, y: 0, zoom: 1 }, 99, 0, 0).zoom).toBe(MAX_ZOOM);
    expect(zoomAbout({ x: 0, y: 0, zoom: 1 }, 0.0001, 0, 0).zoom).toBe(MIN_ZOOM);
  });
});
