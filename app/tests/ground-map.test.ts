import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroundLayer } from "../src/canvas/GroundLayer";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import {
  MAP_CONTENT_FAMILIES,
  planeHint,
  renderedMapContent,
  showsMapContent,
  wordCreationOffered,
} from "../src/canvas/mapContentRules";
import { MAP_CONTENT_OTHER_GAMES_HIDDEN } from "../src/canvas/deprecations";
import type { GroundReference } from "../src/map/ground";
import type { Reading } from "../src/map/readings";

/**
 * Story 16.1 — the ground map's own layer, and the separate-maps rule left
 * exactly where it was.
 *
 * The story's promise has two halves that must both hold: the ground map stops
 * being blank paper FOR ITS OWN CONTENT (a reference: a coined name, a text
 * file's opening lines, the file's name), and it still renders NONE of the
 * concept map's content. `renderedMapContent("ground")` stays empty — the
 * ground layer is a sibling, never a revival of the hidden family — and the
 * ground map's create affordance is its own noun, not the concept word.
 *
 * This file pins the rule, the render, the wiring and the negative space. The
 * record bytes are `ground-roundtrip.test.ts`'s job; the look is the human
 * check's.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const APP = source("App.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const BUBBLE = source("canvas/GroundBubble.tsx");
const RULES = source("canvas/mapContentRules.ts");

const reference: GroundReference = {
  on: "rain-gauge",
  name: "Rain gauge",
  x: 40,
  y: 60,
};
const reading: Reading = {
  on: "rain-gauge",
  form: "path",
  from: "/home/k/Documents/gauge.txt",
  taken: "2026-11-16T12:00:00.000Z",
};

describe("the ground map's own content, and only its own", () => {
  test("the separate-maps rule still blanks every concept family at ground", () => {
    expect(MAP_CONTENT_OTHER_GAMES_HIDDEN).toBe(true);
    expect(showsMapContent("ground")).toBe(false);
    expect(renderedMapContent("ground")).toEqual([]);
    expect(MAP_CONTENT_FAMILIES.length).toBeGreaterThan(0);
    // Concept is untouched by this story.
    expect(renderedMapContent("concept")).toEqual(MAP_CONTENT_FAMILIES);
  });

  test("the ground map renders its own reference: name, reading, file name", () => {
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [reading],
        texts: {
          "rain-gauge": "first line\nsecond line\n",
        },
      }),
    );
    expect(html).toContain("Rain gauge");
    expect(html).toContain("first line");
    expect(html).toContain("gauge.txt");
    // The full path is a record and an authored fact, never a plane label.
    expect(html).not.toContain("/home/k/Documents");
    expect(html).toContain("left:40px");
    expect(html).toContain("top:60px");
  });

  test("a reference without a reading still shows its name and no handle", () => {
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [],
        texts: {},
      }),
    );
    expect(html).toContain("Rain gauge");
    expect(html).not.toContain("gauge.txt");
  });

  test("the layer is the ground map's own component, not concept content", () => {
    // Its only record imports are the ground family's.
    const imports = LAYER.split("export function GroundLayer")[0];
    expect(imports).toContain('"../map/ground"');
    expect(imports).toContain('"../map/readings"');
    for (const concept of [
      "ReferenceWord",
      "DistanceWire",
      "LinkWire",
      "LoopRoute",
      "AssumptionDiamond",
      "QuantityGlyph",
      "VeilSheet",
      "GhostDiamond",
      "LackMark",
    ]) {
      expect(LAYER).not.toContain(concept);
      expect(BUBBLE).not.toContain(concept);
    }
  });

  test("the ground layer's classes are content to the plane's gate", () => {
    for (const name of [
      "ground-layer",
      "ground-reference",
      "ground-name",
      "ground-reading",
      "ground-handle",
      "ground-bubble",
      "ground-bubble-name",
      "ground-bubble-actions",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
  });
});

describe("the ground map's own creation affordance", () => {
  test("double-click at ground opens the reference bubble, not the word menu", () => {
    expect(APP).toContain("useGround(workspace?.path ?? \"\")");
    expect(APP).toContain('level === "ground" && (');
    expect(APP).toContain("<GroundLayer");
    expect(APP).toContain("<GroundBubble");
    expect(APP).toContain('if (level === "ground") {');
    // The ground bubble is its own noun and its own picker, never the word.
    // Its prose may NAME the concept rule it keeps out of the way; the CODE
    // (comments stripped) must not reach for the word grammar at all.
    const bubbleCode = BUBBLE
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(bubbleCode).toContain("pickTextFile");
    expect(bubbleCode).not.toContain("wordCreationOffered");
    expect(bubbleCode).not.toContain("CreationKind");
    expect(BUBBLE).toContain("reference");
    // The word offer stays concept-only; the hint names the ground's noun.
    expect(wordCreationOffered("ground")).toBe(false);
    expect(planeHint("ground")).toBe(
      "drag to pan · scroll to zoom · double-click: reference",
    );
    expect(planeHint("dynamics")).toBe(
      "drag to pan · scroll to zoom · double-click: draw",
    );
  });

  test("the ground layer is a sibling of the existing layers, not gated by mapContent", () => {
    // The mount is level-gated only: no concept rule hides the ground's own
    // content, and no ground record feeds the concept render.
    const at = APP.indexOf("<GroundLayer");
    expect(at).toBeGreaterThan(-1);
    expect(APP.slice(at - 200, at)).toContain('level === "ground"');
    expect(APP).not.toContain("groundContent &&");
  });

  test("an unreadable ground line is surfaced, never silently dropped", () => {
    // The parser reports it; the notices strip renders it under the ground
    // group (the quantities' precedent: no new NoticeFamily).
    expect(APP).toContain("malformedGround={ground.malformedGround}");
    expect(APP).toContain("malformedReadings={ground.malformedReadings}");
    expect(APP).toContain("unreadable line in map/ground.txt");
    expect(APP).toContain("unreadable line in map/readings.txt");
  });
});

describe("the negative space: the ground map announces and ranks nothing", () => {
  const FORBIDDEN =
    /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|backlog|total|points)\b/i;

  test("the new plane strings say nothing and count nothing", () => {
    const seen = [
      planeHint("ground"),
      "reference",
      "name it…",
      "choose a file…",
      "choose another…",
      "no file yet",
      "name it first.",
      "add",
      "cancel",
    ];
    for (const text of seen) {
      expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        text,
        found: null,
      });
    }
  });

  test("the rule module's ground clause adds no number or nudge", () => {
    expect(planeHint("ground")).not.toMatch(/\d/);
    // The rule's own source, comments stripped, stays quiet.
    const code = RULES
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toMatch(FORBIDDEN);
  });
});
