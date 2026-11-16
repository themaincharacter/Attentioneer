import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  followAnchor,
  followCamera,
  followControlView,
  followTargets,
  screenPointOf,
} from "../src/canvas/followRules";
import { CROSS_LEVEL_FACES_HIDDEN } from "../src/canvas/deprecations";
import {
  CONTENT_CLASSES,
  CONTENT_SELECTOR,
  isContentElement,
  isWordControl,
  shouldStartWordPress,
  WORD_CONTROL_CLASSES,
  type ClassListLike,
} from "../src/canvas/gates";
import {
  CUE_BANDS,
  cueShownIn,
  reachCue,
  reachHandleModifiers,
  type PresenceCue,
} from "../src/canvas/presenceRules";
import { INITIAL_CAMERA, zoomAbout } from "../src/canvas/useCamera";
import {
  BAND_ZOOM,
  COLLAPSE_BELOW,
  DISTANCE_LABEL_BELOW,
  DYNAMICS_FROM,
  GROUND_FROM,
  distanceLabelVisible,
  linkWiresVisible,
  noteBand,
} from "../src/canvas/zoomBands";
import { LEVELS, levelFromZoom, type Level } from "../src/workspace/level";
import {
  createLevelHandoff,
  type HandoffCause,
} from "../src/workspace/levelHandoff";

/**
 * Epic 6 story 3, automated at the pure layer: the follow and presence cues.
 *
 *   - the ANCHORED JUMP: the word's screen position is the anchor of the shared
 *     `setZoomBand(level, sx, sy)` intent, so the word stays under the eye
 *     across a jump — from any camera, into any band, and through the handoff
 *     without changing its write rule;
 *   - the FOLLOW CONTROL IS NEUTRAL (ADR-0019): its whole input is the running
 *     game; no presence fact can enter it, and its markup never reads a face;
 *   - the PRESENCE CUES live in their own band, and inside its band the reach
 *     handle reads SOLID when the word carries pointers and FAINT-but-addable
 *     when it does not;
 *   - the LINKWIRE ZOOM GATE: link wires render exactly while the dynamics
 *     game is active, never below the label-collapse band, and the label
 *     thresholds stay label-only rules.
 *
 * The window's feel (the jump landing, the menu opening) is the human check.
 */

const cl = (...names: string[]): ClassListLike => ({
  contains: (token: string) => names.includes(token),
});

const CAMERAS = [
  INITIAL_CAMERA,
  { x: 120, y: -60, zoom: 0.3 },
  { x: -400, y: 700, zoom: DYNAMICS_FROM },
  { x: 55, y: 12, zoom: BAND_ZOOM.ground },
];

const WORDS = [
  { x: 0, y: 0 },
  { x: 1200, y: 640 },
  { x: -320, y: -480 },
];

describe("the anchored jump keeps the word under the eye", () => {
  test("the anchor is exactly where the word's centre sits on screen", () => {
    for (const camera of CAMERAS) {
      for (const word of WORDS) {
        expect(followAnchor(word, camera)).toEqual(screenPointOf(word, camera));
      }
    }
  });

  test("across every jump, from any camera, the word's screen point does not move", () => {
    for (const camera of CAMERAS) {
      for (const word of WORDS) {
        const anchor = followAnchor(word, camera);
        for (const target of LEVELS) {
          const next = followCamera(camera, target, word);
          const after = screenPointOf(word, next);
          expect(after.x).toBeCloseTo(anchor.x, 10);
          expect(after.y).toBeCloseTo(anchor.y, 10);
        }
      }
    }
  });

  test("the jump lands in the target band at its landing zoom", () => {
    for (const camera of CAMERAS) {
      for (const target of LEVELS) {
        const next = followCamera(camera, target, { x: 10, y: 20 });
        expect(next.zoom).toBe(BAND_ZOOM[target]);
        expect(levelFromZoom(next.zoom)).toBe(target);
      }
    }
  });

  test("it IS the shared jump intent, zoomed about the word's anchor", () => {
    for (const camera of CAMERAS) {
      for (const target of LEVELS) {
        const word = { x: 640, y: 360 };
        const anchor = followAnchor(word, camera);
        expect(followCamera(camera, target, word)).toEqual(
          zoomAbout(camera, BAND_ZOOM[target], anchor.x, anchor.y),
        );
      }
    }
  });

  test("a camera against the zoom limits still lands in the target band", () => {
    for (const from of [0.2, 0.7, 1, 2, 4]) {
      for (const target of LEVELS) {
        const camera = { x: 0, y: 0, zoom: from };
        expect(levelFromZoom(followCamera(camera, target, WORDS[1]).zoom)).toBe(
          target,
        );
      }
    }
  });
});

describe("the follow offers the two other games (and nothing else)", () => {
  test("every game's offer is the other two, in the control's order", () => {
    expect(followTargets("concept")).toEqual(["dynamics", "ground"]);
    expect(followTargets("dynamics")).toEqual(["concept", "ground"]);
    expect(followTargets("ground")).toEqual(["concept", "dynamics"]);
  });

  test("the running game is never offered, and the two hold the whole list", () => {
    for (const current of LEVELS) {
      const targets = followTargets(current);
      expect(targets).toHaveLength(2);
      expect(targets).not.toContain(current);
      expect([...targets, current].sort()).toEqual([...LEVELS].sort());
      expect(new Set(targets).size).toBe(2);
    }
  });

  test("the control's render reads the GAME and nothing else (neutrality)", () => {
    // The view's shape is the whole input: one key, the game's offer. A face
    // fact has no way in, so a word with pointers/assumptions/loops renders
    // exactly like a bare one.
    expect(Object.keys(followControlView("dynamics"))).toEqual(["targets"]);
    expect(followControlView("dynamics")).toEqual({
      targets: ["concept", "ground"],
    });
    expect(followControlView("concept").targets).not.toContain("concept");
  });

  test("the markup is state-independent: no face identifier in the control", () => {
    const wordSource = readFileSync(
      new URL("../src/canvas/ReferenceWord.tsx", import.meta.url),
      "utf8",
    );
    const start = wordSource.indexOf('className="word-follow"');
    expect(start).toBeGreaterThan(-1);
    // The control's block runs to the next row control (the connect handle).
    const block = wordSource.slice(
      start,
      wordSource.indexOf('className="connect-handle"', start),
    );
    for (const presence of [
      "hasAssumptions",
      "hasPointers",
      "reachMarked",
      "wordsWithPointers",
      "assumptionTargets",
      "openTargets",
      "pointers",
    ]) {
      expect(block).not.toContain(presence);
    }
    // It offers the game's other two and nothing else.
    expect(block).toContain("followTargets(game)");
    // Keyboard reachable: a real button with a name, whose menu choices are
    // buttons too (Tab, Enter; Esc closes the menu).
    expect(block).toContain("aria-label=\"follow this word across the games\"");
    expect(block).toContain("aria-expanded={followOpen}");
    expect(block).toContain('className="word-follow-game"');
    // The toggle and each game choice are real buttons (the slice also
    // catches the next row control's opening tag, hence at least two).
    expect(block.match(/<button/g)?.length).toBeGreaterThanOrEqual(2);
    expect(wordSource).toContain("function handleFollowKeyDown(");
    // One control in the markup, never duplicated.
    expect(wordSource.match(/className="word-follow"/g)?.length).toBe(1);
    expect(wordSource).not.toContain("showFollow");
  });

  test("the control is WRITTEN but not offered (hidden 2026-11-16 per review)", () => {
    // DEPRECATED (hidden 2026-11-16 per user review): the review asked for the
    // dynamics and ground selection ON THE WORD to be hidden, so the control
    // and its game menu render behind the review's flag — the markup, the refs,
    // the handlers, the offer (`followTargets`) and the anchored jump all stay
    // written for the deprecated sweep. This test asserts the HIDDEN state, so
    // the machinery stays covered while the affordance is absent.
    expect(CROSS_LEVEL_FACES_HIDDEN).toBe(true);
    const wordSource = readFileSync(
      new URL("../src/canvas/ReferenceWord.tsx", import.meta.url),
      "utf8",
    );
    const guard = wordSource.indexOf("{!CROSS_LEVEL_FACES_HIDDEN && (");
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(wordSource.indexOf('className="word-follow"'));
    // The machinery is untouched: the offer still computes.
    expect(followTargets("concept")).toEqual(["dynamics", "ground"]);
  });

  test("App always hands it the game and the anchored jump", () => {
    const app = readFileSync(
      new URL("../src/App.tsx", import.meta.url),
      "utf8",
    );
    expect(app).toContain("game={level}");
    expect(app).toContain("onFollow={(next, screen) => handoff.jump(next, screen)}");
    // The anchor reaches the one shared intent, not a second camera path.
    expect(app).toContain("screen?.x ??");
    expect(app).toContain("intents.setZoomBand(");
  });
});

describe("the anchored jump through the handoff (one write trigger)", () => {
  test("the screen anchor rides the deliberate jump and the key still writes once", async () => {
    const moved: Array<{ level: Level; screen?: { x: number; y: number } }> = [];
    const switched: Array<{ level: Level; cause: HandoffCause }> = [];
    const saved: Level[] = [];
    const handoff = createLevelHandoff("concept", {
      onSwitch: (level, cause) => switched.push({ level, cause }),
      moveCamera: (level, screen) => moved.push({ level, screen }),
      save: async (level) => {
        saved.push(level);
      },
    });
    const anchor = { x: 640, y: 360 };
    handoff.jump("ground", anchor);
    expect(moved).toEqual([{ level: "ground", screen: anchor }]);
    expect(switched).toEqual([{ level: "ground", cause: "jump" }]);
    await handoff.idle();
    expect(saved).toEqual(["ground"]);
  });

  test("a jump with no anchor still uses the viewport centre (the level control)", async () => {
    const moved: Array<{ level: Level; screen?: { x: number; y: number } }> = [];
    const handoff = createLevelHandoff("concept", {
      onSwitch: () => undefined,
      moveCamera: (level, screen) => moved.push({ level, screen }),
      save: async () => undefined,
    });
    handoff.jump("dynamics");
    expect(moved).toEqual([{ level: "dynamics", screen: undefined }]);
    await handoff.idle();
  });
});

describe("presence cues live in their own band (ADR-0019)", () => {
  test("each cue belongs to exactly one game", () => {
    const cues = Object.keys(CUE_BANDS) as PresenceCue[];
    expect(cues.sort()).toEqual(["assumptions", "links", "loops", "reach"]);
    for (const cue of cues) {
      expect(CUE_BANDS[cue]).toHaveLength(1);
    }
    expect(CUE_BANDS.reach).toEqual(["ground"]);
    expect(CUE_BANDS.assumptions).toEqual(["dynamics"]);
    expect(CUE_BANDS.loops).toEqual(["dynamics"]);
    expect(CUE_BANDS.links).toEqual(["dynamics"]);
  });

  test("a cue shows in its band and nowhere else — nothing cross-band", () => {
    for (const cue of Object.keys(CUE_BANDS) as PresenceCue[]) {
      for (const level of LEVELS) {
        expect(cueShownIn(cue, level)).toBe(CUE_BANDS[cue].includes(level));
      }
    }
    // The two faces a person could confuse never share a band.
    expect(cueShownIn("reach", "dynamics")).toBe(false);
    expect(cueShownIn("reach", "concept")).toBe(false);
    expect(cueShownIn("assumptions", "ground")).toBe(false);
    expect(cueShownIn("assumptions", "concept")).toBe(false);
    expect(cueShownIn("links", "ground")).toBe(false);
    expect(cueShownIn("loops", "ground")).toBe(false);
  });

  test("the app reads the table, never an inline level comparison", () => {
    const app = readFileSync(
      new URL("../src/App.tsx", import.meta.url),
      "utf8",
    );
    expect(app).toContain('cueShownIn("reach", level)');
    expect(app).toContain('cueShownIn("assumptions", level)');
    expect(app).toContain("linkWiresVisible(level)");
  });
});

describe("the reach handle: solid when the word has pointers, faint when not", () => {
  test("the within-band read is presence, never a count", () => {
    expect(reachCue(true)).toBe("solid");
    expect(reachCue(false)).toBe("faint");
    // However many pointer lines, one solid handle (a boolean, no tally).
    expect(reachCue(true)).toBe(reachCue(true));
  });

  test("the modifier classes carry the cue and the ring independently", () => {
    expect(reachHandleModifiers(true, false)).toBe(" has-pointers");
    expect(reachHandleModifiers(false, false)).toBe("");
    expect(reachHandleModifiers(true, true)).toBe(" has-pointers marked");
    expect(reachHandleModifiers(false, true)).toBe(" marked");
  });

  test("the word uses the rule and the CSS makes the solid read real", () => {
    const wordSource = readFileSync(
      new URL("../src/canvas/ReferenceWord.tsx", import.meta.url),
      "utf8",
    );
    expect(wordSource).toContain(
      'className={"reach-handle" + reachHandleModifiers(hasPointers, reachMarked)}',
    );
    const css = readFileSync(
      new URL("../src/canvas/canvas.css", import.meta.url),
      "utf8",
    );
    expect(css).toContain(".reach-handle.has-pointers {");
    expect(css).toContain(".reach-handle.marked::after");
    // The solid rule comes AFTER the hover reveal, so hovering a present
    // handle never dims it; the solid state is pointer-enabled by itself.
    expect(css.indexOf(".reach-handle.has-pointers {")).toBeGreaterThan(
      css.indexOf(".reach-handle:hover"),
    );
  });

  test("the handle stays in the ground band only (its render gate is the table)", () => {
    const app = readFileSync(
      new URL("../src/App.tsx", import.meta.url),
      "utf8",
    );
    expect(app).toContain('showReach={cueShownIn("reach", level)}');
    expect(app).not.toContain('showReach={level !== "concept"}');
  });
});

describe("the LinkWire zoom gate (story 3's decision)", () => {
  test("link wires render exactly while the dynamics game is active", () => {
    for (const level of LEVELS) {
      expect(linkWiresVisible(level)).toBe(level === "dynamics");
    }
  });

  test("no bare wire can linger below the label-collapse band", () => {
    // The folded-label zone is concept, so no link (and no head sign) exists
    // there — the wire never lingers as bare pixels.
    for (const zoom of [0.2, 0.3, COLLAPSE_BELOW, DISTANCE_LABEL_BELOW, 0.7, DYNAMICS_FROM - 0.001]) {
      expect(linkWiresVisible(levelFromZoom(zoom))).toBe(false);
    }
    // And where links DO render, both label readings are legible: the band's
    // floor sits above both label thresholds.
    expect(DYNAMICS_FROM).toBeGreaterThan(COLLAPSE_BELOW);
    expect(DYNAMICS_FROM).toBeGreaterThan(DISTANCE_LABEL_BELOW);
    for (const zoom of [DYNAMICS_FROM, 1.2, BAND_ZOOM.dynamics, GROUND_FROM - 0.001]) {
      expect(linkWiresVisible(levelFromZoom(zoom))).toBe(true);
      expect(distanceLabelVisible(zoom)).toBe(true);
      expect(noteBand(zoom)).toBe("full");
    }
  });

  test("the label thresholds stay label-only rules (the gate ignores them)", () => {
    const bands = readFileSync(
      new URL("../src/canvas/zoomBands.ts", import.meta.url),
      "utf8",
    );
    const gate = bands.slice(bands.indexOf("export function linkWiresVisible"));
    const body = gate.slice(0, gate.indexOf("}"));
    expect(body).toContain('level === "dynamics"');
    expect(body).not.toContain("COLLAPSE_BELOW");
    expect(body).not.toContain("DISTANCE_LABEL_BELOW");
    const wire = readFileSync(
      new URL("../src/canvas/LinkWire.tsx", import.meta.url),
      "utf8",
    );
    expect(wire).not.toContain("distanceLabelVisible");
    expect(wire).not.toContain("COLLAPSE_BELOW");
  });
});

describe("no cross-band surface: each game's own records stay in their game", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  test("dynamics' surfaces render only at dynamics", () => {
    expect(app).toContain('{loopRoutes.map(');
    expect(app).toContain("if (level !== \"dynamics\") return [];");
    expect(app).toContain('{level === "dynamics" && assumptionPanel &&');
    expect(app).toContain('{level === "dynamics" &&');
  });

  test("ground's surfaces render only at ground", () => {
    expect(app).toContain('{level === "ground" && pointerPanel &&');
    expect(app).toContain('{level === "ground" && peekAt &&');
  });

  test("the neutral surfaces render in every game", () => {
    // Words, distances, marks, the shelf and the follow have no game gate.
    expect(app).toContain("{refs.map((word) => (");
    expect(app).toContain("<ShelfFold shelfX={shelfX} extent={fold} />");
    expect(app.match(/game=\{level\}/g)?.length).toBe(1);
  });
});

describe("the follow joins both gate lists", () => {
  test("each follow element is content and owns its press", () => {
    for (const name of [
      "word-follow",
      "word-follow-toggle",
      "word-follow-menu",
      "word-follow-game",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(CONTENT_SELECTOR).toContain("." + name);
      expect(isContentElement(cl(name))).toBe(true);
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
      expect(isWordControl(cl(name))).toBe(true);
      // A press on the control (or a menu choice) never starts a word drag or
      // a click-to-center that would move the camera the jump just anchored.
      expect(shouldStartWordPress("idle", cl(name))).toBe(false);
    }
    // The lists stay duplicate-free.
    expect(new Set(CONTENT_CLASSES).size).toBe(CONTENT_CLASSES.length);
    expect(new Set(WORD_CONTROL_CLASSES).size).toBe(WORD_CONTROL_CLASSES.length);
  });
});
