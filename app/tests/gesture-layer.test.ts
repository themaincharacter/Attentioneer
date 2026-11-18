import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ArmedBar } from "../src/canvas/ArmedBar";
import { GestureChip } from "../src/canvas/GestureChip";
import {
  armedKind,
  armedSentence,
  CHIP_MARGIN,
  chipPoint,
  GESTURE_IDLE,
  gestureSentence,
  planeGestureWord,
  type GestureNarration,
} from "../src/canvas/gestureWord";
import { creationNoun, planeHint, renderedMapContent } from "../src/canvas/mapContentRules";

/**
 * STORY 16.16 — THE GESTURE LAYER (shortlist items 4, 5 and 6).
 *
 * The story's check is a human one: press and drag a card and a small pill near
 * the pointer says what you are doing (it is gone on release); arm the pen and a
 * bar at the bottom says you are drawing (put it down and the bar goes); start a
 * link from a card's handle and the chip says what the drag will make; turn on
 * Reduce Motion and nothing animates while the app still works. This file pins
 * the rules UNDER it:
 *
 *   - the WORD TABLE: every gesture has one sentence, in the map's nouns, with
 *     no advice words and no digits (item 4); idle has none;
 *   - the ARMED BAR exists only for an armed tool and reuses the SAME creation
 *     noun the idle hint uses (item 5) — one tool, one vocabulary;
 *   - the CHIP is screen space and pointer-inert, clears on release and on
 *     window blur, and renders no pill before it has a pointer;
 *   - the MOTION CONTRACT is tokens, two overshoot-free easings, used by the
 *     ground styles, plus a reduce-motion block that REMOVES transforms rather
 *     than shortening them (item 6).
 *
 * PROVISIONAL: the chip's offset and look, the token values, and the bar's
 * wording (ADR-0003's rendering seam).
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const CSS = source("canvas/canvas.css");
const CHIP = source("canvas/GestureChip.tsx");
const BAR = source("canvas/ArmedBar.tsx");
const WORDS = source("canvas/gestureWord.ts");
const APP = source("App.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const PLANE = source("canvas/CanvasPlane.tsx");

/** Every gesture the chip can narrate, in the table's own order. */
const GESTURES: readonly GestureNarration[] = [
  GESTURE_IDLE,
  { kind: "moving", name: "garden notes" },
  { kind: "panning" },
  { kind: "zooming" },
  { kind: "drawing" },
  { kind: "erasing" },
  { kind: "wiring" },
];

/** Words that would make a caption into a suggestion (never allowed). */
const ADVICE = [
  "you can",
  "also",
  "try",
  "next",
  "tip",
  "hint",
  "maybe",
  "should",
  "remember",
];

function cssRule(selector: string): string {
  const at = CSS.indexOf("\n" + selector + " {");
  expect(at).toBeGreaterThan(-1);
  const end = CSS.indexOf("}", at);
  // Comments out: the assertion is about declarations, and the house-voice
  // notes here discuss transforms without declaring any.
  return CSS.slice(at, end).replace(/\/\*[\s\S]*?\*\//g, "");
}

function reduceBlock(): string {
  const at = CSS.indexOf("@media (prefers-reduced-motion: reduce)");
  expect(at).toBeGreaterThan(-1);
  // The story's block is the LAST one, written for the gesture layer.
  const last = CSS.lastIndexOf("@media (prefers-reduced-motion: reduce)");
  const end = CSS.indexOf("\n}\n", last);
  return CSS.slice(last, end + 3);
}

describe("the chip's word table (shortlist item 4)", () => {
  test("every gesture has ONE sentence, in the map's nouns", () => {
    expect(gestureSentence(GESTURE_IDLE)).toBeNull();
    expect(gestureSentence({ kind: "moving", name: "garden notes" })).toBe(
      "moving garden notes",
    );
    expect(gestureSentence({ kind: "panning" })).toBe("panning");
    expect(gestureSentence({ kind: "zooming" })).toBe("zooming");
    expect(gestureSentence({ kind: "drawing" })).toBe("drawing");
    expect(gestureSentence({ kind: "erasing" })).toBe("lifting the pen");
    expect(gestureSentence({ kind: "wiring" })).toBe(
      "release on a card to link",
    );
  });

  test("a moving card is named by the person's own noun, never a slug", () => {
    expect(gestureSentence({ kind: "moving", name: "Field notes" })).toBe(
      "moving Field notes",
    );
    // Nothing else is appended: no position, no target, no count.
    expect(gestureSentence({ kind: "moving", name: "Field notes" })).toBe(
      "moving Field notes",
    );
  });

  test("no sentence advises, counts or reports progress", () => {
    for (const gesture of GESTURES) {
      const sentence = gestureSentence(gesture);
      if (sentence === null) continue;
      const lower = sentence.toLowerCase();
      for (const word of ADVICE) {
        expect(lower.includes(word)).toBe(false);
      }
      // No digits, no totals, no percent, no ellipsis-as-progress.
      expect(/[0-9]/.test(sentence)).toBe(false);
      expect(sentence.includes("%")).toBe(false);
      expect(sentence.includes("/")).toBe(false);
      expect(sentence.includes("…")).toBe(false);
    }
  });

  test("the pan/zoom distinction is d3's own source event, never the transform", () => {
    expect(planeGestureWord("wheel")).toEqual({ kind: "zooming" });
    expect(planeGestureWord("touchmove", 2)).toEqual({ kind: "zooming" });
    expect(planeGestureWord("touchmove", 1)).toEqual({ kind: "panning" });
    expect(planeGestureWord("mousedown")).toEqual({ kind: "panning" });
    expect(planeGestureWord("mousemove")).toEqual({ kind: "panning" });
    // A programmatic camera move (no source event) narrates nothing.
    expect(planeGestureWord(undefined)).toBeNull();
    expect(planeGestureWord("dblclick")).toBeNull();
  });

  test("the pill sits beside the pointer and stays in the viewport", () => {
    const middle = chipPoint({ x: 400, y: 300 }, { width: 1200, height: 800 });
    expect(middle.x).toBeGreaterThan(400);
    expect(middle.y).toBeGreaterThan(300);
    const corner = chipPoint({ x: 1190, y: 790 }, { width: 1200, height: 800 });
    expect(corner.x).toBeLessThanOrEqual(1200 - CHIP_MARGIN);
    expect(corner.y).toBeLessThanOrEqual(800 - CHIP_MARGIN);
    expect(corner.x).toBeGreaterThanOrEqual(CHIP_MARGIN);
    expect(corner.y).toBeGreaterThanOrEqual(CHIP_MARGIN);
  });
});

describe("the armed bar (shortlist item 5)", () => {
  test("it exists for an armed TOOL, not for an idle map", () => {
    expect(armedKind(false, "pen", GESTURE_IDLE, false)).toBeNull();
    expect(armedKind(true, "pen", GESTURE_IDLE, false)).toBe("pen");
    expect(armedKind(true, "eraser", GESTURE_IDLE, false)).toBe("eraser");
    expect(armedKind(false, "pen", { kind: "wiring" }, false)).toBe("linking");
    expect(armedKind(false, "pen", GESTURE_IDLE, true)).toBe("reference");
    // The pen family wins: while the drawing mode is armed nothing else is
    // pressable, so the bar names the pen.
    expect(armedKind(true, "pen", { kind: "wiring" }, true)).toBe("pen");
  });

  test("the sentence IS the armed tool, with its noun as the emphasised part", () => {
    // The pen's bar says what the tool DOES ("arm the pen: a bar says you are
    // drawing"), with the pen itself as the emphasised noun.
    expect(armedSentence("pen", "ground")).toEqual({
      before: "drawing with the ",
      noun: "pen",
      after: "",
    });
    expect(armedSentence("eraser", "ground")).toEqual({
      before: "lifting ink with the ",
      noun: "eraser",
      after: "",
    });
    expect(armedSentence("linking", "ground")).toEqual({
      before: "linking ",
      noun: "two cards",
      after: "",
    });
    expect(armedSentence("reference", "ground")).toEqual({
      before: "adding a ",
      noun: "reference",
      after: "",
    });
  });

  test("the reference's noun is the idle hint's OWN noun (one vocabulary)", () => {
    for (const level of ["concept", "dynamics", "ground"] as const) {
      expect(armedSentence("reference", level).noun).toBe(creationNoun(level));
      expect(planeHint(level, true)).toContain(
        "double-click: " + creationNoun(level),
      );
    }
    // The hint's sentence is byte-identical to the one it has always been.
    expect(planeHint("concept", true)).toBe(
      "drag to pan · scroll to zoom · double-click: word",
    );
    expect(planeHint("ground", true)).toBe(
      "drag to pan · scroll to zoom · double-click: reference",
    );
    expect(planeHint("dynamics", true)).toBe(
      "drag to pan · scroll to zoom · double-click: draw",
    );
  });

  test("the rendered bar is one line with an emphasised noun, no buttons", () => {
    const markup = renderToStaticMarkup(
      createElement(ArmedBar, { kind: "reference", level: "ground" }),
    );
    expect(markup).toContain("armed-bar");
    expect(markup).toContain("armed-bar-noun");
    expect(markup).toContain("adding a");
    expect(markup).toContain("reference");
    expect(markup).not.toContain("<button");
    expect(markup).not.toContain("icon");
    expect(/[0-9]/.test(markup.replace(/data-armed="[a-z]+"/, ""))).toBe(false);
  });
});

describe("the chip clears, and renders nothing it cannot place", () => {
  test("no pill before the pointer has been seen (a press with no movement)", () => {
    const markup = renderToStaticMarkup(
      createElement(GestureChip, {
        gesture: { kind: "panning" },
        onClear: () => {},
      }),
    );
    expect(markup).toBe("");
  });

  test("it clears on window blur, and on the source's release report", () => {
    expect(CHIP).toContain('window.addEventListener("blur"');
    expect(CHIP).toContain('window.addEventListener("mouseup", onClear)');
    expect(CHIP).toContain("onClear");
    // The card's drag and the link drag clear on release...
    expect(LAYER).toContain("onNarrate?.(GESTURE_IDLE)");
    expect(LAYER).toContain('onNarrate?.({ kind: "moving", name: reference.name })');
    expect(LAYER).toContain('onNarrate?.({ kind: "wiring" })');
    // ...and so do the plane's pan/zoom and the pen's stroke.
    expect(PLANE).toContain("onNarrateRef.current?.(GESTURE_IDLE)");
    expect(PLANE).toContain("planeGestureWord");
  });

  test("it takes no pointer events and never transforms (screen space)", () => {
    const chip = cssRule(".gesture-chip");
    expect(chip).toContain("position: fixed");
    expect(chip).toContain("pointer-events: none");
    expect(chip).not.toContain("transform:");
    const bar = cssRule(".armed-bar");
    expect(bar).toContain("position: fixed");
    expect(bar).toContain("pointer-events: none");
    expect(bar).not.toContain("transform:");
    // Both are mounted OUTSIDE the plane, so no camera value can move them.
    expect(APP.indexOf("</CanvasPlane>")).toBeGreaterThan(-1);
    expect(APP.indexOf("<GestureChip")).toBeGreaterThan(
      APP.indexOf("</CanvasPlane>"),
    );
    expect(APP.indexOf("<ArmedBar")).toBeGreaterThan(
      APP.indexOf("</CanvasPlane>"),
    );
  });

  test("it advises nothing, counts nothing, persists nothing", () => {
    expect(WORDS).not.toContain("localStorage");
    expect(WORDS).not.toContain("click handler");
    expect(CHIP).not.toContain("onClick");
    expect(BAR).not.toContain("onClick");
    expect(CHIP).not.toContain("from \"../map/");
    expect(BAR).not.toContain("from \"../map/");
    // The map's content is untouched: the ground map still renders no concept
    // content (the separate-maps rule), so a caption cannot become a counter.
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

describe("the motion contract (shortlist item 6)", () => {
  test("the tokens exist once, with two overshoot-free easings", () => {
    const root = CSS.slice(CSS.indexOf(":root {"), CSS.indexOf("}", CSS.indexOf(":root {")));
    expect(root).toContain("--motion-fast: 120ms;");
    expect(root).toContain("--motion-base: 180ms;");
    expect(root).toContain("--motion-slow: 260ms;");
    expect(root).toContain("--ease-out: cubic-bezier(");
    expect(root).toContain("--ease-soft: cubic-bezier(");
    // Two easings, and neither can overshoot: every curve stays within 0..1 on
    // both control points' y (no spring, no bounce).
    const curves = [
      ...root.matchAll(/cubic-bezier\(([^)]+)\)/g),
    ].map((match) => match[1].split(",").map((part) => Number(part.trim())));
    expect(curves.length).toBe(2);
    for (const curve of curves) {
      expect(curve[1]).toBeGreaterThanOrEqual(0);
      expect(curve[1]).toBeLessThanOrEqual(1);
      expect(curve[3]).toBeGreaterThanOrEqual(0);
      expect(curve[3]).toBeLessThanOrEqual(1);
    }
  });

  test("the ground styles use the tokens, and no ad-hoc duration survives there", () => {
    const start = CSS.indexOf("Story 16.1 — the GROUND map's own layer");
    // STORY 17.7: the embedded panel's block is gone; the ground styles now
    // end where its retirement note begins.
    const end = CSS.indexOf("STORY 17.7 — the embedded ask panel");
    const ground = CSS.slice(start, end);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(ground.match(/var\(--motion-(fast|base|slow)\)/g)?.length ?? 0).toBeGreaterThan(5);
    expect(ground.match(/\d+ms/g) ?? []).toEqual([]);
  });

  test("the reduce-motion block REMOVES the motion, not just shortens it", () => {
    const block = reduceBlock();
    expect(block).toContain(".gesture-chip");
    expect(block).toContain(".armed-bar");
    expect(block).toContain("animation: none !important;");
    expect(block).toContain("transform: none !important;");
    expect(block).toContain("transition: opacity var(--motion-fast) linear !important;");
    // The chip and the bar still WORK: no display:none, no visibility hidden.
    expect(block).not.toContain("display: none");
    expect(block).not.toContain("visibility: hidden");
    expect(block).not.toContain("opacity: 0");
  });
});
