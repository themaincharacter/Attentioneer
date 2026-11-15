import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  createLevelPin,
  didReleaseFocusPin,
  focusAfterFieldEnd,
  focusStateOf,
  isTextField,
  NO_FOCUS,
  shouldPinLevel,
  shouldPromptForSet,
  type FieldEnd,
  type GestureMode,
  type TextFieldLike,
} from "../src/canvas/gates";
import {
  BAND_ZOOM,
  distanceLabelVisible,
  DYNAMICS_FROM,
  GROUND_FROM,
  noteBand,
} from "../src/canvas/zoomBands";
import { MAX_ZOOM, MIN_ZOOM } from "../src/canvas/useCamera";
import {
  DEFAULT_CAMERA_ZOOM,
  DEFAULT_LEVEL,
  levelFromZoom,
  zoomChipPercent,
  type Level,
} from "../src/workspace/level";
import {
  createLevelHandoff,
  type HandoffCause,
} from "../src/workspace/levelHandoff";

/**
 * Epic 6 story 2, automated at the pure/record layer: the gesture-pinning
 * invariant (ADR-0018 decision 3) and the prompt policy (ADR-0013's door).
 *
 *   - the pin: an ARMED gesture pins the level, and so does a FOCUSED TEXT
 *     FIELD — a wheel crossing moves the camera and nothing else, so typed text
 *     survives it (the defect the red team found) and no armed surface closes;
 *     on blur / commit / cancel / the gesture's end the band re-derives and any
 *     real crossing runs the full switch path;
 *   - the prompt: only a DELIBERATE entry asks for a missing playing set; a
 *     wheel crossing never does (the named cost: the set stays required at
 *     authoring);
 *   - the chip: its number goes through the same atOrAbove readings the plane
 *     renders with, so a rounded percent can never contradict the game or the
 *     labels at a boundary.
 *
 * The window's feel (the field keeping its text, the selector holding still
 * under the wheel) remains the human check.
 */

const GESTURE_MODES: GestureMode[] = [
  "idle",
  "selector",
  "path",
  "sign-choice",
  "pointer",
];

const ARMED: GestureMode[] = GESTURE_MODES.filter((mode) => mode !== "idle");

const input = (type: string, tagName = "INPUT"): TextFieldLike => ({
  tagName,
  type,
});

describe("the pin predicate: armed OR focused", () => {
  test("every armed gesture pins the level, even with nothing focused", () => {
    for (const mode of ARMED) {
      expect(shouldPinLevel(mode, NO_FOCUS)).toBe(true);
    }
  });

  test("idle is unpinned until a text field takes focus", () => {
    expect(shouldPinLevel("idle", "none")).toBe(false);
    expect(shouldPinLevel("idle", "text")).toBe(true);
  });

  test("focus never unpins an armed gesture; idle never pins without text", () => {
    for (const mode of GESTURE_MODES) {
      for (const focus of ["none", "text"] as const) {
        expect(shouldPinLevel(mode, focus)).toBe(
          mode !== "idle" || focus === "text",
        );
      }
    }
  });

  test("there is exactly one reading per mode: the rule is a plain OR", () => {
    const table = GESTURE_MODES.map((mode) => [
      shouldPinLevel(mode, "none"),
      shouldPinLevel(mode, "text"),
    ]);
    expect(table).toEqual([
      [false, true], // idle: the plain canvas, unless a field holds focus
      [true, true],
      [true, true],
      [true, true],
      [true, true],
    ]);
  });
});

describe("the focus reading: a text field holds it, a control does not", () => {
  test("the app's authored fields are text fields", () => {
    for (const type of ["text", "email", "number", "password", "search", "url"]) {
      expect(isTextField(input(type))).toBe(true);
    }
    expect(isTextField({ tagName: "TEXTAREA" })).toBe(true);
    expect(isTextField({ tagName: "DIV", isContentEditable: true })).toBe(true);
    // An input without a type is a text input (the DOM's own default).
    expect(isTextField({ tagName: "INPUT" })).toBe(true);
  });

  test("buttons and value-only controls hold no typed text", () => {
    for (const type of [
      "button",
      "checkbox",
      "color",
      "file",
      "hidden",
      "image",
      "radio",
      "range",
      "reset",
      "submit",
    ]) {
      expect(isTextField(input(type))).toBe(false);
    }
    expect(isTextField({ tagName: "BUTTON" })).toBe(false);
    expect(isTextField({ tagName: "SPAN" })).toBe(false);
    expect(isTextField({ tagName: "DIV" })).toBe(false);
  });

  test("nothing focused reads as no focus and pins nothing", () => {
    expect(isTextField(null)).toBe(false);
    expect(isTextField(undefined)).toBe(false);
    expect(focusStateOf(null)).toBe("none");
    expect(focusStateOf(undefined)).toBe("none");
    expect(shouldPinLevel("idle", focusStateOf(null))).toBe(false);
  });

  test("a focused field reads as text, and the level control's button does not", () => {
    expect(focusStateOf(input("text"))).toBe("text");
    expect(focusStateOf({ tagName: "TEXTAREA" })).toBe("text");
    expect(focusStateOf({ tagName: "BUTTON" })).toBe("none");
    // The level control is the indicator/jumper: its buttons never pin.
    expect(shouldPinLevel("idle", focusStateOf({ tagName: "BUTTON" }))).toBe(
      false,
    );
  });
});

describe("focus edge cases: blur, commit and Esc all release the pin", () => {
  const ENDINGS: FieldEnd[] = ["blur", "commit", "cancel"];

  test("each ending is namable and releases focus", () => {
    for (const end of ENDINGS) {
      expect(focusAfterFieldEnd(end)).toBe(NO_FOCUS);
      expect(shouldPinLevel("idle", focusAfterFieldEnd(end))).toBe(false);
    }
  });

  test("a blur leaves nothing focused", () => {
    // The field had focus, the person clicked the plane: activeElement is gone.
    expect(focusStateOf(null)).toBe("none");
    expect(shouldPinLevel("idle", focusStateOf(null))).toBe(false);
  });

  test("a commit and a cancel end the field's life the same way", () => {
    // Enter writes the claim and the card closes; Esc drops the draft and the
    // card closes. Either way the text surface is gone.
    expect(focusAfterFieldEnd("commit")).toBe(focusAfterFieldEnd("cancel"));
    expect(shouldPinLevel("idle", focusAfterFieldEnd("commit"))).toBe(false);
  });

  test("a commit that KEEPS the field open keeps the pin (focus is still text)", () => {
    // The assumption field commits and re-focuses itself (Enter keeps it ready):
    // releasing while a text entry still owns the caret would be a lie.
    const stillFocused = focusStateOf(input("text"));
    expect(stillFocused).toBe("text");
    expect(shouldPinLevel("idle", stillFocused)).toBe(true);
  });

  test("an armed gesture releases the pin only when it ends, not on blur", () => {
    // A field's blur during an armed gesture leaves the gesture's own pin.
    expect(shouldPinLevel("selector", focusAfterFieldEnd("blur"))).toBe(true);
    // The gesture's end with nothing focused is what lifts it.
    expect(shouldPinLevel("idle", NO_FOCUS)).toBe(false);
  });

  test("the focus edge as ONE pure transition: text -> none releases, per mode", () => {
    // Blur, commit and Esc all read the same way: the reading after is none.
    for (const end of ENDINGS) {
      expect(didReleaseFocusPin("text", focusAfterFieldEnd(end), "idle")).toBe(
        true,
      );
    }
    // Nothing focused before, or still focused after: no release.
    expect(didReleaseFocusPin("none", "none", "idle")).toBe(false);
    expect(didReleaseFocusPin("text", "text", "idle")).toBe(false);
    // An armed gesture keeps the level even as the field's focus ends.
    for (const mode of ARMED) {
      expect(didReleaseFocusPin("text", NO_FOCUS, mode)).toBe(false);
    }
    // Idle is the only mode where a field's end lifts the pin by focus.
    for (const mode of GESTURE_MODES) {
      expect(didReleaseFocusPin("text", NO_FOCUS, mode)).toBe(mode === "idle");
    }
  });
});

/**
 * The pin, the handoff and the switch path wired as the app wires them — with
 * no window. The local draft stands for the text in the focused field; the
 * switch path clears it, exactly as closing the transient surface would.
 */
function scenario(initial: Level = DEFAULT_LEVEL) {
  const pin = createLevelPin();
  const switched: Array<{ level: Level; cause: HandoffCause }> = [];
  const moved: Level[] = [];
  const saved: Level[] = [];
  let closes = 0;
  let draft = "";

  const handoff = createLevelHandoff(initial, {
    onSwitch: (level, cause) => {
      switched.push({ level, cause });
      closes += 1;
      draft = ""; // the switch path closes the surface and its text with it
    },
    moveCamera: (level) => moved.push(level),
    save: async (level) => {
      saved.push(level);
    },
  });

  /** The app's settle path: ask the pin first, settle only what it hands back. */
  const settle = (zoom: number, pinned: boolean): number | null => {
    const next = pin.settle(zoom, pinned);
    if (next !== null) handoff.settle(next);
    return next;
  };

  /** The pin's release: re-derive the band from the zoom the camera ended on. */
  const release = (zoom: number) => handoff.settle(pin.release(zoom));

  return {
    pin,
    handoff,
    switched,
    moved,
    saved,
    settle,
    release,
    type: (text: string) => {
      draft += text;
    },
    draft: () => draft,
    closes: () => closes,
  };
}

describe("typed text survives a crossing (the pin at the record layer)", () => {
  test("while the selector is armed, a wheel crossing switches and writes nothing", () => {
    const s = scenario("concept");
    s.type("a claim in progress");
    const handed = s.settle(
      GROUND_FROM + 0.1,
      shouldPinLevel("selector", NO_FOCUS),
    );
    expect(handed).toBeNull();
    expect(s.switched).toEqual([]);
    expect(s.saved).toEqual([]);
    expect(s.closes()).toBe(0);
    expect(s.draft()).toBe("a claim in progress");
    expect(s.pin.held()).toBe(true);
    // The game has not moved: the armed gesture still owns its band.
    expect(s.handoff.level()).toBe("concept");
  });

  test("a focused field pins exactly like an armed gesture", () => {
    const s = scenario("concept");
    s.type("half a thought");
    s.settle(GROUND_FROM + 0.2, shouldPinLevel("idle", "text"));
    expect(s.switched).toEqual([]);
    expect(s.saved).toEqual([]);
    expect(s.draft()).toBe("half a thought");
    expect(s.pin.held()).toBe(true);
    // The same crossing with nothing pinned settles and switches.
    const free = scenario("concept");
    free.settle(GROUND_FROM + 0.2, shouldPinLevel("idle", NO_FOCUS));
    expect(free.switched).toEqual([{ level: "ground", cause: "settle" }]);
  });

  test("the field's end re-derives: the held crossing runs the full switch path", async () => {
    const s = scenario("concept");
    const zoom = GROUND_FROM + 0.2;
    s.type("assumption: the vent is loud");
    s.settle(zoom, shouldPinLevel("idle", "text"));
    // The person blurs (or commits, or cancels): the text is safe by then.
    s.release(zoom);
    expect(s.switched).toEqual([{ level: "ground", cause: "settle" }]);
    expect(s.closes()).toBe(1);
    expect(s.pin.held()).toBe(false);
    await s.handoff.idle();
    expect(s.saved).toEqual(["ground"]);
  });

  test("the gesture's end re-derives the same way (a held crossing, then the switch)", async () => {
    const s = scenario("concept");
    const zoom = BAND_ZOOM.ground;
    s.settle(zoom, shouldPinLevel("path", NO_FOCUS));
    expect(s.switched).toEqual([]);
    // The path gesture ends (Esc, or the loop committed).
    s.release(zoom);
    expect(s.switched).toEqual([{ level: "ground", cause: "settle" }]);
    await s.handoff.idle();
    expect(s.saved).toEqual(["ground"]);
  });

  test("a wheel across and back leaves nothing to apply: the text survives the episode", async () => {
    const s = scenario("concept");
    s.type("still here");
    s.settle(GROUND_FROM + 0.2, true);
    s.settle(BAND_ZOOM.concept, true);
    s.release(BAND_ZOOM.concept);
    expect(s.switched).toEqual([]);
    expect(s.draft()).toBe("still here");
    expect(s.pin.held()).toBe(false);
    await s.handoff.idle();
    expect(s.saved).toEqual([]);
  });

  test("a held crossing writes exactly once, through the one trigger", async () => {
    const s = scenario("dynamics");
    s.settle(BAND_ZOOM.ground, true);
    s.settle(GROUND_FROM + 0.5, true);
    s.settle(GROUND_FROM + 0.9, true);
    expect(s.saved).toEqual([]);
    s.release(GROUND_FROM + 0.9);
    await s.handoff.idle();
    expect(s.saved).toEqual(["ground"]);
    expect(s.switched).toEqual([{ level: "ground", cause: "settle" }]);
  });

  test("the pin holds the wheel, never the person: a deliberate jump still switches", async () => {
    const s = scenario("concept");
    s.type("mid-sentence");
    s.settle(BAND_ZOOM.ground, true);
    s.handoff.jump("dynamics");
    expect(s.moved).toEqual(["dynamics"]);
    expect(s.switched).toEqual([{ level: "dynamics", cause: "jump" }]);
    await s.handoff.idle();
    expect(s.saved).toEqual(["dynamics"]);
  });

  test("the pure pin is a flag, not a queue: release always re-derives", () => {
    const pin = createLevelPin();
    expect(pin.held()).toBe(false);
    expect(pin.settle(DYNAMICS_FROM + 0.1, true)).toBeNull();
    expect(pin.held()).toBe(true);
    // A wheel back inside the running band is held too: nothing queues up.
    expect(pin.settle(BAND_ZOOM.concept, true)).toBeNull();
    expect(pin.release(BAND_ZOOM.concept)).toBe(BAND_ZOOM.concept);
    expect(pin.held()).toBe(false);
    // Unpinned, the settle hands the zoom straight on.
    expect(pin.settle(GROUND_FROM, false)).toBe(GROUND_FROM);
    expect(pin.held()).toBe(false);
  });
});

describe("the prompt policy: only a deliberate entry asks for a playing set", () => {
  const CAUSES: HandoffCause[] = ["settle", "jump", "restore"];
  const GAMES: Level[] = ["concept", "dynamics", "ground"];

  test("a deliberate jump into dynamics with no set asks for one", () => {
    expect(shouldPromptForSet("jump", "dynamics", false)).toBe(true);
    // With an accepted set there is nothing to ask.
    expect(shouldPromptForSet("jump", "dynamics", true)).toBe(false);
  });

  test("a wheel crossing never asks — the named cost", () => {
    expect(shouldPromptForSet("settle", "dynamics", false)).toBe(false);
    expect(shouldPromptForSet("settle", "dynamics", true)).toBe(false);
  });

  test("opening into the game asks once (the resume hint is deliberate)", () => {
    expect(shouldPromptForSet("restore", "dynamics", false)).toBe(true);
    expect(shouldPromptForSet("restore", "dynamics", true)).toBe(false);
  });

  test("only dynamics asks, whatever the cause", () => {
    for (const cause of CAUSES) {
      for (const level of GAMES) {
        if (level === "dynamics") continue;
        expect(shouldPromptForSet(cause, level, false)).toBe(false);
        expect(shouldPromptForSet(cause, level, true)).toBe(false);
      }
    }
  });

  test("the whole policy as one table: cause x level x set", () => {
    const table = CAUSES.map((cause) =>
      GAMES.map((level) =>
        [false, true].map((hasModel) =>
          shouldPromptForSet(cause, level, hasModel),
        ),
      ),
    );
    expect(table).toEqual([
      // settle: the wheel never asks
      [
        [false, false],
        [false, false],
        [false, false],
      ],
      // jump: the control's deliberate jump asks, only in dynamics, only
      // without an accepted set
      [
        [false, false],
        [true, false],
        [false, false],
      ],
      // restore: opening into the game asks under the same conditions
      [
        [false, false],
        [true, false],
        [false, false],
      ],
    ]);
  });
});

describe("the chip's band read at boundaries", () => {
  const ZOOMS = [
    MIN_ZOOM,
    0.3,
    0.4,
    0.549,
    0.55,
    0.7,
    BAND_ZOOM.concept,
    0.8449,
    0.845,
    0.846,
    0.8499,
    DYNAMICS_FROM,
    0.8501,
    1,
    1.2,
    BAND_ZOOM.dynamics,
    1.69,
    1.6949,
    1.699,
    1.6999,
    GROUND_FROM,
    1.7001,
    BAND_ZOOM.ground,
    3.9,
    MAX_ZOOM,
  ];

  test("the chip agrees with every reading the plane renders from", () => {
    for (const zoom of ZOOMS) {
      const chip = zoomChipPercent(zoom) / 100;
      // The level: the chip never names a game the zoom is not in.
      expect(levelFromZoom(chip)).toBe(levelFromZoom(zoom));
      // The labels: a chip at 55% while the words are folded would be a lie.
      expect(noteBand(chip)).toBe(noteBand(zoom));
      expect(distanceLabelVisible(chip)).toBe(distanceLabelVisible(zoom));
    }
  });

  test("0.846 reads 84%, never the rounded 85% the game has not entered", () => {
    expect(levelFromZoom(0.846)).toBe("concept");
    expect(Math.round(0.846 * 100)).toBe(85); // what a bare round would show
    expect(zoomChipPercent(0.846)).toBe(84);
    expect(zoomChipPercent(0.845)).toBe(84);
    expect(zoomChipPercent(0.8499)).toBe(84);
    // Exactly on the boundary the band IS dynamics, so 85% is honest.
    expect(levelFromZoom(DYNAMICS_FROM)).toBe("dynamics");
    expect(zoomChipPercent(DYNAMICS_FROM)).toBe(85);
    expect(zoomChipPercent(0.8501)).toBe(85);
  });

  test("0.549 reads 54%, never 55% while the labels are still folded", () => {
    expect(noteBand(0.549)).toBe("title");
    expect(Math.round(0.549 * 100)).toBe(55); // the rounded contradiction
    expect(zoomChipPercent(0.549)).toBe(54);
    expect(noteBand(0.55)).toBe("full");
    expect(zoomChipPercent(0.55)).toBe(55);
  });

  test("the dynamics band's top edge reads 169%, not ground's 170%", () => {
    expect(levelFromZoom(1.699)).toBe("dynamics");
    expect(Math.round(1.699 * 100)).toBe(170);
    expect(zoomChipPercent(1.699)).toBe(169);
    expect(zoomChipPercent(1.6999)).toBe(169);
    expect(levelFromZoom(GROUND_FROM)).toBe("ground");
    expect(zoomChipPercent(GROUND_FROM)).toBe(170);
    expect(zoomChipPercent(1.7001)).toBe(170);
  });

  test("the landing zooms read plainly (80% / 100% / 200%)", () => {
    expect(zoomChipPercent(BAND_ZOOM.concept)).toBe(80);
    expect(zoomChipPercent(BAND_ZOOM.dynamics)).toBe(100);
    expect(zoomChipPercent(BAND_ZOOM.ground)).toBe(200);
  });

  test("the chip never shows a percent that names the next band", () => {
    for (const zoom of ZOOMS) {
      const chip = zoomChipPercent(zoom);
      if (levelFromZoom(zoom) === "concept") {
        expect(chip).toBeLessThan(DYNAMICS_FROM * 100);
      }
      if (levelFromZoom(zoom) === "dynamics") {
        expect(chip).toBeLessThan(GROUND_FROM * 100);
        expect(chip).toBeGreaterThanOrEqual(DYNAMICS_FROM * 100);
      }
    }
  });

  test("garbage is the opening camera's honest read, never NaN", () => {
    for (const garbage of [NaN, Infinity, -Infinity]) {
      const chip = zoomChipPercent(garbage);
      expect(Number.isFinite(chip)).toBe(true);
      expect(chip).toBe(Math.round(DEFAULT_CAMERA_ZOOM * 100));
      expect(levelFromZoom(chip / 100)).toBe(levelFromZoom(garbage));
    }
  });
});

describe("the physical wiring", () => {
  const source = (path: string) =>
    readFileSync(new URL(path, import.meta.url), "utf8");

  test("the plane asks the chip's pure read, never a bare round", () => {
    const planeSource = source("../src/canvas/CanvasPlane.tsx");
    expect(planeSource).toContain("zoomChipPercent(camera.zoom)");
    expect(planeSource).not.toContain("Math.round(camera.zoom * 100)");
  });

  test("the settle path asks the pin, and the pin's release re-derives", () => {
    const appSource = source("../src/App.tsx");
    expect(appSource).toContain("createLevelPin(");
    expect(appSource).toContain(
      "shouldPinLevel(gestureMode, focusStateRef.current)",
    );
    expect(appSource).toContain(
      "handoff.settle(levelPin.release(cameraZoomRef.current))",
    );
    // The armed gesture's end asks the SAME rule (a focused field keeps it),
    // and the focus edge is the pure transition, not an inline condition.
    expect(appSource).toContain(
      "!shouldPinLevel(gestureMode, focusStateRef.current)",
    );
    expect(appSource).toContain(
      "didReleaseFocusPin(before, next, gestureModeRef.current)",
    );
    // ONE settle path still: the pin is a gate, not a second trigger.
    expect(appSource.match(/levelPin\.settle\(/g)?.length).toBe(1);
    // Nothing held => nothing to re-derive (the band cannot disagree unpinned).
    expect(appSource).toContain("if (!levelPin.held()) return;");
  });

  test("the focus reading is the document's, refreshed after every render", () => {
    const appSource = source("../src/App.tsx");
    expect(appSource).toContain("document.activeElement");
    expect(appSource).toContain("focusStateOf(");
    expect(appSource).toContain('document.addEventListener("focusin"');
    expect(appSource).toContain('document.addEventListener("focusout"');
    // A field removed while focused fires no focusout in Chromium.
    expect(appSource).toContain("readFocus();");
  });

  test("every prompt site goes through the one pure rule", () => {
    const appSource = source("../src/App.tsx");
    expect(appSource).toContain(
      "shouldPromptForSet(cause, next, model !== null)",
    );
    expect(appSource).toContain(
      'shouldPromptForSet("restore", workspace.resumeLevel, model !== null)',
    );
    expect(appSource.match(/shouldPromptForSet\(/g)?.length).toBe(2);
    // The old inline jump-only check is gone, so no site can drift from it.
    expect(appSource).not.toContain(
      'cause === "jump" && next === "dynamics" && model === null',
    );
  });

  test("a held crossing keeps the wheel's cause: focus is never yanked", () => {
    const appSource = source("../src/App.tsx");
    // The release settles through the handoff with no cause of its own, so the
    // switch it triggers is the settle path's (a wheel crossing).
    expect(appSource).toContain("handoff.settle(levelPin.release(");
    expect(appSource).toContain(
      'if (cause === "jump") closePointers("switch-level")',
    );
  });
});
