import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LevelControl } from "../src/canvas/LevelControl";
import { ZOOM_SWITCHES_MAP_HIDDEN } from "../src/canvas/deprecations";
import { zoomSwitchesMap } from "../src/canvas/shelfRules";
import { BAND_ZOOM } from "../src/canvas/zoomBands";
import {
  INITIAL_CAMERA,
  INITIAL_CAMERAS,
  MAX_ZOOM,
  MIN_ZOOM,
  cameraOf,
  initialMapCameras,
  withCameraOf,
  zoomAbout,
  type Camera,
} from "../src/canvas/useCamera";
import { parseYamlFields, workspaceYml } from "../src/lib/serialize";
import { createWriteQueue } from "../src/lib/writeQueue";
import {
  DEFAULT_LEVEL,
  LEVELS,
  levelFromZoom,
  levelOfText,
  withLevel,
  type Level,
} from "../src/workspace/level";
import {
  createLevelHandoff,
  type HandoffCause,
} from "../src/workspace/levelHandoff";

/**
 * ZOOM NO LONGER CHANGES THE MAP (hidden 2026-11-16 per user review), automated.
 *
 * The person's verdict: the three maps are SEPARATE mini-apps (ADR-0032). The
 * level TABS switch them and NOTHING else — the wheel only zooms within the map
 * you are on, and each map keeps its OWN camera, so a tab switch puts you back
 * exactly where you left that map. The band machinery (the derivation, the band
 * constants, the level handoff's settle, the camera's band intent, the level pin)
 * stays WRITTEN and type-checked behind `ZOOM_SWITCHES_MAP_HIDDEN` and simply
 * stops driving the switch.
 *
 * This file pins the NEW state:
 *
 *   - the flag is on and is the ONE reading (`zoomSwitchesMap`);
 *   - a settled zoom changes nothing but that map's camera (the derivation still
 *     computes — it is the flip-back's machinery — but the app never asks it);
 *   - the TABS are the switch: `handoff.jump` switches and writes the resume
 *     hint; the open-restore reads it and writes nothing;
 *   - each map's camera is its own and comes back untouched after a switch;
 *   - the retired pieces are still written (setZoomBand, levelFromZoom, the pin,
 *     the settle report) and the app gates every one of them;
 *   - the tabs' wording is the mini-app frame (PROVISIONAL);
 *   - the negative space: nothing in the new strings announces or ranks.
 */

const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
const PLANE = readFileSync(
  new URL("../src/canvas/CanvasPlane.tsx", import.meta.url),
  "utf8",
);
const CAMERA = readFileSync(
  new URL("../src/canvas/useCamera.ts", import.meta.url),
  "utf8",
);
const HANDOFF = readFileSync(
  new URL("../src/workspace/levelHandoff.ts", import.meta.url),
  "utf8",
);

/* ----------------------------------------------------------------------- *
 * 1. The flag and the one reading.
 * ----------------------------------------------------------------------- */

describe("the zoom's switch is retired behind ONE flag", () => {
  test("the flag is on, typed boolean, and the reading answers", () => {
    expect(ZOOM_SWITCHES_MAP_HIDDEN).toBe(true);
    expect(typeof ZOOM_SWITCHES_MAP_HIDDEN).toBe("boolean");
    expect(zoomSwitchesMap()).toBe(false);
    // The flip-back: exactly what setting the flag to false does.
    expect(zoomSwitchesMap(false)).toBe(true);
  });

  test("the derivation is still alive: it is the flip-back's machinery", () => {
    // levelFromZoom still computes every band, inclusively, exactly as before.
    expect(levelFromZoom(BAND_ZOOM.concept)).toBe("concept");
    expect(levelFromZoom(BAND_ZOOM.dynamics)).toBe("dynamics");
    expect(levelFromZoom(BAND_ZOOM.ground)).toBe("ground");
    expect(levelFromZoom(Number.NaN)).toBe(DEFAULT_LEVEL);
    // The handoff still switches when it is asked — the app simply stops asking.
    const switched: Array<{ level: Level; cause: HandoffCause }> = [];
    const saved: Level[] = [];
    const handoff = createLevelHandoff(
      DEFAULT_LEVEL,
      {
        onSwitch: (level, cause) => switched.push({ level, cause }),
        moveCamera: () => undefined,
        save: async (level) => {
          saved.push(level);
        },
      },
      createWriteQueue(),
    );
    handoff.settle(BAND_ZOOM.dynamics);
    expect(switched).toEqual([{ level: "dynamics", cause: "settle" }]);
    expect(handoff.level()).toBe("dynamics");
    void handoff.idle().then(() => {
      expect(saved).toEqual(["dynamics"]);
    });
  });
});

/* ----------------------------------------------------------------------- *
 * 2. The wheel: ordinary zoom, inside the map you are on.
 * ----------------------------------------------------------------------- */

describe("a settled wheel zoom moves the camera and nothing else", () => {
  test("zooming past the old band boundaries changes no map", () => {
    // The VERY zooms that used to switch the game: at exactly each old boundary
    // the derivation names another map, and the camera is still the concept
    // map's own camera — only its zoom moved.
    let cameras = initialMapCameras();
    for (const zoom of [BAND_ZOOM.dynamics, BAND_ZOOM.ground, 1.2, 3]) {
      cameras = withCameraOf(
        cameras,
        "concept",
        zoomAbout(cameraOf(cameras, "concept"), zoom, 640, 360),
      );
    }
    // Only the concept map's camera moved (its zoom ends at the last gesture's
    // 3 — past every old band boundary); the other maps are untouched.
    expect(cameraOf(cameras, "concept").zoom).toBe(3);
    expect(cameraOf(cameras, "dynamics")).toEqual(INITIAL_CAMERAS.dynamics);
    expect(cameraOf(cameras, "ground")).toEqual(INITIAL_CAMERAS.ground);
    // PROVISIONAL: the ordinary clamp is the camera's, not a band's.
    expect(zoomAbout(INITIAL_CAMERA, 99, 0, 0).zoom).toBe(MAX_ZOOM);
    expect(zoomAbout(INITIAL_CAMERA, 0.0001, 0, 0).zoom).toBe(MIN_ZOOM);
  });

  test("the app's wheel path answers nothing while the flag stands", () => {
    // The settle handler is gated FIRST: no pin, no derivation, no write.
    const settle = APP.slice(APP.indexOf("const handleZoomSettle"));
    expect(settle).toContain("if (!zoomSwitchesMap()) return;");
    expect(settle.indexOf("if (!zoomSwitchesMap()) return;")).toBeLessThan(
      settle.indexOf("levelPin.settle("),
    );
    // The pin's release and the band camera move are gated the same way.
    const release = APP.slice(APP.indexOf("const releasePin"));
    expect(release).toContain("if (!zoomSwitchesMap()) return;");
    expect(release.indexOf("if (!zoomSwitchesMap()) return;")).toBeLessThan(
      release.indexOf("handoff.settle("),
    );
    const move = APP.slice(APP.indexOf("const moveCameraToBand"));
    expect(move).toContain("if (!zoomSwitchesMap()) return;");
    expect(move.indexOf("if (!zoomSwitchesMap()) return;")).toBeLessThan(
      move.indexOf("intents.setZoomBand("),
    );
    // The settle REPORT stays written (the input layer still reports).
    expect(PLANE).toContain("onZoomSettleRef.current?.(event.transform.k)");
    expect(APP).toContain("onZoomSettle={handleZoomSettle}");
  });
});

/* ----------------------------------------------------------------------- *
 * 3. The tabs are the switch; the hint remembers the last map.
 * ----------------------------------------------------------------------- */

describe("the TABS switch the maps, and nothing else does", () => {
  test("the control's switch is wired to the handoff's jump (one write path)", () => {
    expect(APP).toContain("onJump={(next) => handoff.jump(next)}");
    // ONE place sets the running map: the switch path the handoff calls.
    expect(APP.match(/setLevel\(/g)?.length).toBe(1);
    expect(APP).toContain("handoff.restore(workspace.resumeLevel)");
    // The resume hint stays exactly as it was (the key, its canonical write).
    const files = withLevel(workspaceYml(), "ground");
    expect(levelOfText(files)).toBe("ground");
    expect(parseYamlFields(files).format).toBe("attentioneer-workspace/1");
    expect(APP.match(/saveWorkspaceLevel\(/g)?.length).toBe(1);
    expect(HANDOFF).toContain("jump: (next: Level, screen?: Point) => void;");
  });

  test("a tab press writes the hint; the open-restore never does", async () => {
    const switched: Array<{ level: Level; cause: HandoffCause }> = [];
    const saved: Level[] = [];
    let key: Level | null = null;
    const handoff = createLevelHandoff(DEFAULT_LEVEL, {
      onSwitch: (level, cause) => switched.push({ level, cause }),
      moveCamera: () => undefined,
      save: async (level) => {
        saved.push(level);
        key = level;
      },
    });
    handoff.restore("concept");
    expect(switched).toEqual([]);
    expect(saved).toEqual([]);

    handoff.jump("dynamics");
    await handoff.idle();
    expect(switched).toEqual([{ level: "dynamics", cause: "jump" }]);
    expect(saved).toEqual(["dynamics"]);
    expect(key).toBe("dynamics");
    // Jumping to the map already running writes nothing (and moves nothing).
    handoff.jump("dynamics");
    await handoff.idle();
    expect(saved).toEqual(["dynamics"]);
  });
});

/* ----------------------------------------------------------------------- *
 * 4. Each map keeps its own camera.
 * ----------------------------------------------------------------------- */

describe("each map keeps its OWN camera, so a switch restores it", () => {
  test("the store opens one camera per map, at the old landing zooms", () => {
    expect(INITIAL_CAMERAS.concept).toEqual(INITIAL_CAMERA);
    for (const level of LEVELS) {
      expect(cameraOf(INITIAL_CAMERAS, level).zoom).toBe(BAND_ZOOM[level]);
      expect(cameraOf(INITIAL_CAMERAS, level).x).toBe(0);
      expect(cameraOf(INITIAL_CAMERAS, level).y).toBe(0);
    }
    // A fresh call is a fresh store (no shared mutable camera).
    expect(initialMapCameras()).toEqual(INITIAL_CAMERAS);
  });

  test("a tab switch comes back to the map exactly as it was left", () => {
    // Work on the concept map: zoom about a point, then pan.
    const concept: Camera = { ...INITIAL_CAMERA };
    const zoomed = zoomAbout(concept, 1.6, 400, 300);
    const worked = { ...zoomed, x: zoomed.x - 120, y: zoomed.y + 44 };
    let store = withCameraOf(INITIAL_CAMERAS, "concept", worked);

    // Switch to dynamics and work there too.
    const dynamicsWorked: Camera = { x: 10, y: -20, zoom: 2.4 };
    store = withCameraOf(store, "dynamics", dynamicsWorked);
    // The concept map's camera did not move while the dynamics map was open.
    expect(cameraOf(store, "concept")).toEqual(worked);
    expect(cameraOf(store, "ground")).toEqual(INITIAL_CAMERAS.ground);

    // Back to concept: exactly the view left behind, like a little app.
    expect(cameraOf(store, "concept")).toEqual(worked);
    expect(cameraOf(store, "concept").zoom).not.toBe(INITIAL_CAMERA.zoom);
    // … and the dynamics map's own view is still its own.
    expect(cameraOf(store, "dynamics")).toEqual(dynamicsWorked);
  });

  test("the hook hands every intent the CURRENT map — the source proves it", () => {
    expect(CAMERA).toContain("export function useCamera(\n  level: Level");
    expect(CAMERA).toContain("withCameraOf(all, level, next(all[level]))");
    expect(APP).toContain("const { camera, intents } = useCamera(level);");
    // The per-map cameras are PROVISIONAL and named so.
    expect(CAMERA).toContain("PROVISIONAL");
  });
});

/* ----------------------------------------------------------------------- *
 * 5. The tabs' wording: the mini-app frame (PROVISIONAL).
 * ----------------------------------------------------------------------- */

describe("the tabs say what they do: switch maps", () => {
  const noop = () => {};

  function render(level: Level): string {
    return renderToStaticMarkup(
      createElement(LevelControl, {
        level,
        onJump: noop,
        onEditPlayingSet: noop,
        onCoinLoop: noop,
        onDrawVeil: noop,
        onDraw: noop,
        drawArmed: false,
        scenarios: [],
        activeScenario: null,
        onChooseScenario: noop,
        onBranchScenario: noop,
        onRetireScenario: noop,
        onCompare: noop,
        onAsk: noop,
        onAskPull: noop,
      }),
    );
  }

  test("each map's hover title names THE MAP, never a band or a jump", () => {
    for (const level of LEVELS) {
      const html = render(level);
      expect(html).toContain(`title="switch maps — the ${level} map"`);
      expect(html).not.toContain("band");
      expect(html).not.toMatch(/jump to/);
      // The group is the three maps now, and the running one is pressed.
      expect(html).toContain(`aria-label="maps — the map now: ${level}"`);
      expect(html).toContain(`data-level="${level}"`);
    }
  });

  test("the negative space: the new wording announces and ranks nothing", () => {
    const FORBIDDEN =
      /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|queue|backlog|total|points)\b/i;
    for (const level of LEVELS) {
      expect(render(level)).not.toMatch(FORBIDDEN);
    }
    // The camera module's own prose and export names stay quiet too.
    const code = CAMERA.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(code).not.toMatch(FORBIDDEN);
  });
});
