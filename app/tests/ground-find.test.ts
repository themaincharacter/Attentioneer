import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  FIND_MARK_MS,
  FIND_MAX_MATCHES,
  FIND_NOTHING,
  FIND_PLACEHOLDER,
  FindPill,
  findLandingPoint,
  findMatches,
  nextFindIndex,
  positionLine,
  type FindableCard,
} from "../src/canvas/FindPill";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import { GROUND_CARD_BOX } from "../src/canvas/geometry";
import { renderedMapContent } from "../src/canvas/mapContentRules";

/**
 * STORY 16.33 — FIND ON THE MAP.
 *
 * The story's check is human ("press the find verb or Ctrl/Cmd+F, type three
 * letters, the map moves to the first match and the pill says 3 of 12; Enter
 * and Shift+Enter step; Escape closes and leaves the map") and needs a window.
 * This file pins what can be pinned without one:
 *
 *   - the MATCHER is pure: names and notes, case-insensitive, the map's own
 *     order, bounded, and it reads no reading body and no record;
 *   - the POSITION LINE states a position ("3 of 12"), never a quality, and
 *     the stepping cycles in that same order;
 *   - LANDING is the camera's existing centerOn intent at the camera's own
 *     zoom (a PAN, never a fit), aimed at the card's resting centre;
 *   - the MARKER is view state that clears itself, on close and on a real map
 *     move — and Escape leaves the camera alone;
 *   - the pill is screen space (outside .plane) and nothing it does writes a
 *     record; renderedMapContent("ground") stays [].
 */

const APP_DIR = new URL("..", import.meta.url).pathname;
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const PILL = source("canvas/FindPill.tsx");
const APP = source("App.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const CSS = source("canvas/canvas.css");

/** One card as the finder sees it (the app builds these from the records). */
function card(
  on: string,
  name: string,
  note?: string,
  x = 0,
  y = 0,
): FindableCard {
  const out: FindableCard = { on, name, x, y };
  if (note !== undefined) out.note = note;
  return out;
}

const CARDS: readonly FindableCard[] = [
  card("rain-gauge", "Rain gauge", "the bucket overflows at 40 mm", 40, 80),
  card("barometer", "Barometer", "hung by the window", 200, 80),
  card("gauge-depth", "River depth", "read at the gauge every morning", 400, 80),
];

describe("the matcher searches names and notes, and nothing else", () => {
  test("a name matches case-insensitively", () => {
    expect(findMatches(CARDS, "RAIN").map((c) => c.on)).toEqual(["rain-gauge"]);
    expect(findMatches(CARDS, "barom").map((c) => c.on)).toEqual(["barometer"]);
  });

  test("a note matches case-insensitively", () => {
    expect(findMatches(CARDS, "OVERFLOWS").map((c) => c.on)).toEqual([
      "rain-gauge",
    ]);
    // "gauge" is in one note and two names: all three match, in map order.
    expect(findMatches(CARDS, "gauge").map((c) => c.on)).toEqual([
      "rain-gauge",
      "gauge-depth",
    ]);
  });

  test("a reading's BODY is not searched", () => {
    // The record a card carries a reading for is not part of this shape at
    // all: a stray body field is ignored, not indexed.
    const withBody = [
      card("rain-gauge", "Rain gauge"),
      { on: "x", name: "X", body: "the barometer is broken", x: 0, y: 0 },
    ] as unknown as FindableCard[];
    expect(findMatches(withBody, "barometer")).toEqual([]);
    // The module imports only React and the map's one box helper: no reading,
    // no note loader and no record family is reachable from the finder.
    expect(PILL).not.toContain('from "../map/');
    expect(PILL).not.toContain("readings");
    expect(PILL).not.toContain("groundNote");
  });

  test("an empty query matches nothing and moves nothing", () => {
    expect(findMatches(CARDS, "")).toEqual([]);
    expect(findMatches(CARDS, "   ")).toEqual([]);
    expect(findMatches(CARDS, "\n\t")).toEqual([]);
  });

  test("the result keeps the map's own order and is bounded", () => {
    const many = Array.from({ length: FIND_MAX_MATCHES + 7 }, (_, i) =>
      card("card-" + i, "Gauge " + i),
    );
    const matches = findMatches(many, "gauge");
    expect(matches.length).toBe(FIND_MAX_MATCHES);
    expect(matches[0].on).toBe("card-0");
    expect(matches[matches.length - 1].on).toBe(
      "card-" + (FIND_MAX_MATCHES - 1),
    );
    // A real map keeps file order: the third match is the third card drawn.
    expect(findMatches(CARDS, "").length).toBe(0);
    expect(findMatches(CARDS, "a").map((c) => c.on)).toEqual([
      "rain-gauge",
      "barometer",
      "gauge-depth",
    ]);
  });

  test("the placeholder says exactly what is searched", () => {
    expect(FIND_PLACEHOLDER).toContain("names");
    expect(FIND_PLACEHOLDER).toContain("notes");
  });
});

describe("stepping is a position in the map's order, never a quality", () => {
  test("the line reads 3 of 12", () => {
    expect(positionLine(2, 12)).toBe("3 of 12");
    expect(positionLine(0, 1)).toBe("1 of 1");
    // A stale index clamps to the list rather than inventing a position.
    expect(positionLine(99, 12)).toBe("12 of 12");
  });

  test("an empty result has no position to state", () => {
    expect(positionLine(0, 0)).toBe("");
    expect(FIND_NOTHING).toBe("nothing matches");
  });

  test("the line never uses ranking words", () => {
    for (const index of [0, 1, 2, 11]) {
      const line = positionLine(index, 12);
      expect(line).not.toMatch(/score|rank|best|top|closest|relevance|match/i);
    }
    expect(FIND_NOTHING).not.toMatch(/score|rank|best|top|relevance/i);
  });

  test("Enter and Shift+Enter cycle in the same order, wrapping", () => {
    expect(nextFindIndex(0, 3, 1)).toBe(1);
    expect(nextFindIndex(1, 3, 1)).toBe(2);
    expect(nextFindIndex(2, 3, 1)).toBe(0);
    expect(nextFindIndex(0, 3, -1)).toBe(2);
    expect(nextFindIndex(1, 3, -1)).toBe(0);
    // Nothing to step to: the index does not move and nothing is landed on.
    expect(nextFindIndex(0, 0, 1)).toBe(0);
  });

  test("the steps follow the matcher's order, not its relevance", () => {
    const matches = findMatches(CARDS, "rain");
    expect(matches.map((c) => c.on)).toEqual(["rain-gauge"]);
    const all = findMatches(CARDS, "a");
    const walked = [0];
    for (let i = 1; i < all.length; i += 1) {
      walked.push(nextFindIndex(walked[i - 1], all.length, 1));
    }
    expect(walked.map((i) => all[i].on)).toEqual([
      "rain-gauge",
      "barometer",
      "gauge-depth",
    ]);
  });
});

describe("landing is a pan at the current zoom, not a fit", () => {
  test("the target is the centre of the card's resting box", () => {
    expect(findLandingPoint(card("g", "G", undefined, 40, 80))).toEqual({
      x: 40 + GROUND_CARD_BOX.w / 2,
      y: 80 + GROUND_CARD_BOX.h / 2,
    });
  });

  test("App asks the camera's existing centerOn intent at camera.zoom", () => {
    const start = APP.indexOf("const landOnFoundCard");
    const end = APP.indexOf("const closeFind");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const block = APP.slice(start, end);
    expect(block).toContain("intents.centerOn(");
    expect(block).toContain("camera.zoom");
    expect(block).toContain("findLandingPoint(");
    // No second camera: no transform, no zoom arithmetic, no band landing.
    expect(block).not.toContain("setTransform");
    expect(block).not.toContain("zoomAt");
    expect(block).not.toContain("setZoomBand");
    expect(block).not.toContain("MIN_ZOOM");
    expect(block).not.toContain("MAX_ZOOM");
    // The pill itself owns no camera at all: no plane API, no intent, no
    // transform arithmetic of its own.
    expect(PILL).not.toContain("usePlane");
    expect(PILL).not.toContain(".centerOn(");
    expect(PILL).not.toContain("setTransform");
    expect(PILL).not.toContain("camera.");
  });

  test("Escape closes and leaves the camera alone", () => {
    // The field's Escape is taken on the window's CAPTURE, before any card's
    // own (their Escape lives on the document): one press closes the pill and
    // nothing else — no card close, no camera call.
    const start = PILL.indexOf("const onKey = (e: KeyboardEvent)");
    const end = PILL.indexOf("}, [open, onClose]);");
    expect(start).toBeGreaterThan(-1);
    const block = PILL.slice(start, end);
    expect(block).toContain('e.key !== "Escape"');
    expect(block).toContain("onClose()");
    expect(block).toContain("e.stopPropagation()");
    expect(block).not.toContain("onLand");
    expect(block).not.toContain("findLandingPoint");
    expect(PILL).toContain(
      'window.addEventListener("keydown", onKey, true);',
    );
    // The input itself never lands on Escape: Enter is all it owns.
    const inputStart = PILL.indexOf("onKeyDown={(e) => {");
    const inputBlock = PILL.slice(inputStart, inputStart + 300);
    expect(inputBlock).not.toContain('e.key === "Escape"');
    // And closing in App is state only.
    const closeStart = APP.indexOf("const closeFind");
    const closeEnd = APP.indexOf("// The marker is BRIEF");
    const closeBlock = APP.slice(closeStart, closeEnd);
    expect(closeBlock).toContain("setFindOpen(false)");
    expect(closeBlock).toContain("setFindMark(null)");
    expect(closeBlock).not.toContain("centerOn");
  });
});

describe("the marker is view state that clears itself", () => {
  test("it has a stated, finite lifetime", () => {
    expect(FIND_MARK_MS).toBeGreaterThan(0);
    expect(Number.isFinite(FIND_MARK_MS)).toBe(true);
    expect(APP).toContain("}, FIND_MARK_MS);");
  });

  test("close and a real map move both clear it", () => {
    const narrateStart = APP.indexOf("const narrate = useCallback");
    const narrateEnd = APP.indexOf("STORY 16.33 — WHAT THE FINDER SEES");
    const narrateBlock = APP.slice(narrateStart, narrateEnd);
    expect(narrateBlock).toContain('next.kind === "panning"');
    expect(narrateBlock).toContain("setFindMark(null)");
    const closeStart = APP.indexOf("const closeFind");
    const closeEnd = APP.indexOf("// The marker is BRIEF");
    expect(APP.slice(closeStart, closeEnd)).toContain("setFindMark(null)");
  });

  test("the layer draws it at the card's resting place and never takes a press", () => {
    expect(LAYER).toContain("found?: FindMark | null;");
    expect(LAYER).toContain("found = null");
    expect(LAYER).toContain("found !== null");
    expect(LAYER).toContain('className="ground-found-mark"');
    // App hands the layer the marker and the layer only draws it.
    expect(APP).toContain("found={findMark}");
    expect(LAYER).toContain("style={{ left: found.x, top: found.y }}");
    expect(CSS).toContain(".ground-found-mark");
    const rule = CSS.slice(CSS.indexOf(".ground-found-mark"));
    expect(rule).toContain("pointer-events: none");
    // The marker's box is the map's own resting box, so the two cannot drift.
    expect(rule).toContain("width: " + GROUND_CARD_BOX.w + "px");
    expect(rule).toContain("height: " + GROUND_CARD_BOX.h + "px");
  });
});

describe("the pill is screen space and writes nothing", () => {
  test("App mounts it outside the plane's transform", () => {
    expect(APP.indexOf("</CanvasPlane>")).toBeLessThan(
      APP.indexOf("<FindPill"),
    );
    const rule = CSS.slice(CSS.indexOf(".find-pill {"));
    expect(rule).toContain("position: fixed");
  });

  test("no record write path is imported", () => {
    expect(PILL).not.toContain("useGround");
    expect(PILL).not.toContain("writeTextFile");
    expect(PILL).not.toContain("saveGround");
    expect(PILL).not.toContain("from \"../map/");
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("the shortcut declines while a text field holds focus", () => {
    const start = APP.indexOf("THE SHORTCUT (Ctrl/Cmd+F)");
    const end = APP.indexOf("// Leaving the ground map");
    const block = APP.slice(start, end);
    expect(block).toContain("focusStateOf(");
    expect(block).toContain('focused === "text" && !findOpen');
    expect(block).toContain("e.preventDefault()");
  });

  test("the closed pill is one verb and the open one is the field", () => {
    const closed = renderToStaticMarkup(
      createElement(FindPill, {
        cards: CARDS,
        open: false,
        onOpen: () => {},
        onClose: () => {},
        onLand: () => {},
      }),
    );
    expect(closed).toContain("find-verb");
    expect(closed).not.toContain("find-field");
    const open = renderToStaticMarkup(
      createElement(FindPill, {
        cards: CARDS,
        open: true,
        onOpen: () => {},
        onClose: () => {},
        onLand: () => {},
      }),
    );
    expect(open).toContain("find-field");
    expect(open).toContain(FIND_PLACEHOLDER);
    // The position line is empty until there is a query and a match.
    expect(open).not.toContain(FIND_NOTHING);
  });

  test("the finder's surfaces are content, named in the gate's list", () => {
    for (const name of [
      "find-pill",
      "find-verb",
      "find-field",
      "find-position",
      "find-close",
      "ground-found-mark",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
    // A class the layer and pill actually use, never a ghost entry.
    expect(PILL).toContain("find-field");
    expect(LAYER).toContain("ground-found-mark");
  });
});
