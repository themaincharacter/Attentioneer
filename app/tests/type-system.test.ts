import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroundLayer } from "../src/canvas/GroundLayer";
import { mountPagedText } from "./paged-harness";
import { GroundConceptPanel } from "../src/canvas/GroundNote";
import { MentionPicker } from "../src/canvas/MentionPicker";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { SETTINGS_SECTIONS } from "../src/canvas/SettingsPanel";
import {
  boundedPreviewLines,
  DEFAULT_READING_PREFERENCE,
  NOTE_PREVIEW_DEFAULT,
  PREVIEW_LINES_CEILING,
  PREVIEW_LINES_FLOOR,
  READING_PREVIEW_DEFAULT,
  readReadingPreference,
  storedReadingPreference,
} from "../src/lib/readingPreference";
import { READING_CONFIG_KEY } from "../src/lib/appConfig";
import { NOTE_PREVIEW_LINES } from "../src/map/notes";
import {
  previewOverflows,
  previewText,
  READING_PREVIEW_LINES,
} from "../src/map/readings";
import type { GroundReference } from "../src/map/ground";
import type { Reading } from "../src/map/readings";

/**
 * STORY 17 — THE TYPE SYSTEM (shortlist items 7-9).
 *
 * The story's check is human ("every line is the same colour at a different
 * strength, no heading bolder than the body; a popover reads as its own small
 * surface; change the preview lines from 6 to 3 and the cards re-crop, ending
 * in a fade and a small 'more'"). This file pins the rules underneath it:
 *
 *   - the ink ladder: ONE foreground colour, stated once in :root, every named
 *     strength derived from it, and no ground rule introducing a second
 *     foreground colour;
 *   - the two scales: regular-weight headings, a 1.625 prose leading, and a
 *     SMALLER compact scale that the popovers actually carry;
 *   - the STATED fold threshold: bounded pure values, written through the
 *     config's one merge, consumed by the crop and the DOM clamp, with the
 *     small card's fade and its "more" verb (and no number on the map).
 *
 * PROVISIONAL (story 17): the token names and strengths, the two scales' sizes,
 * the bounds, and the setting's own Reading section.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const CSS = source("canvas/canvas.css");
const LAYER = source("canvas/GroundLayer.tsx");
const APP = source("App.tsx");
const APP_CONFIG = source("lib/appConfig.ts");
const SETTINGS = source("canvas/SettingsPanel.tsx");

/** Every rule with a simple body (a nested @media's inner rules included). */
function rules(css: string): { selector: string; body: string }[] {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const found: { selector: string; body: string }[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(clean)) !== null) {
    found.push({ selector: match[1].trim(), body: match[2] });
  }
  return found;
}

/** One property's values inside a rule body. */
function values(body: string, property: string): string[] {
  const found: string[] = [];
  const pattern = new RegExp("(?:^|;)\\s*" + property + "\\s*:\\s*([^;]+)", "g");
  let match: RegExpExecArray | null = null;
  while ((match = pattern.exec(body)) !== null) found.push(match[1].trim());
  return found;
}

const RULES = rules(CSS);
const ROOT = RULES.find((rule) => rule.selector === ":root");
if (ROOT === undefined) throw new Error("canvas.css lost its :root block");

const INK_NAMES = [
  "--ink-strong",
  "--ink",
  "--ink-soft",
  "--ink-marker",
  "--ink-rule",
  "--ink-quote",
  "--ink-chip",
];

describe("the ink ladder: one colour at named strengths", () => {
  test("one foreground is stated, and the seven roles derive from it", () => {
    const base = values(ROOT.body, "--ink-rgb");
    expect(base).toHaveLength(1);
    expect(base[0]).toBe("30 33 38");
    for (const name of INK_NAMES) {
      const token = values(ROOT.body, name);
      expect({ name, found: token.length }).toEqual({ name, found: 1 });
      expect({ name, derives: token[0] }).toEqual({
        name,
        derives: expect.stringMatching(/^rgb\(var\(--ink-rgb\) \//),
      });
    }
    // The strengths are DISTINCT: a ladder, not aliases of one value.
    const strengths = INK_NAMES.map((name) => values(ROOT.body, name)[0]);
    expect(new Set(strengths).size).toBe(INK_NAMES.length);
    // The strongest is the whole colour.
    expect(values(ROOT.body, "--ink-strong")[0]).toBe(
      "rgb(var(--ink-rgb) / 1)",
    );
  });

  test("the only other colour is the existing warm state accent", () => {
    const accent = values(ROOT.body, "--state-accent");
    expect(accent).toEqual(["#a0522d"]);
    // No second foreground token sneaks into the ladder's own block.
    const hexColours = ROOT.body.match(/#[0-9a-f]{3,8}/gi) ?? [];
    expect(hexColours).toEqual(["#a0522d"]);
  });

  test("no ground rule introduces a second foreground colour", () => {
    const ground = RULES.filter((rule) => rule.selector.includes(".ground-"));
    expect(ground.length).toBeGreaterThan(20);
    const declarations = ground.flatMap((rule) =>
      values(rule.body, "color").map((value) => ({
        selector: rule.selector,
        value,
      })),
    );
    expect(declarations.length).toBeGreaterThan(40);
    for (const declaration of declarations) {
      // STORY 25-15 (the person's cleanup): the two SANCTIONED tints — the
      // remove keys' red and the wire handle's blue. Exactly these two values
      // may leave the ink ladder; no third tint joins them.
      const sanctionedTints = ["#a0453b", "#4a6a94"];
      const allowed =
        /^var\(--ink(?:-[a-z]+)?\)$/.test(declaration.value) ||
        declaration.value === "var(--state-accent)" ||
        sanctionedTints.includes(declaration.value);
      expect({
        selector: declaration.selector,
        value: declaration.value,
        allowed,
      }).toEqual({
        selector: declaration.selector,
        value: declaration.value,
        allowed: true,
      });
    }
  });

  test("the ground card's heading is regular weight; nothing there is bold", () => {
    const name = RULES.find(
      (rule) => rule.selector === ".ground-name",
    );
    expect(name).toBeDefined();
    expect(values((name as { body: string }).body, "font-weight")).toEqual([
      "400",
    ]);
    const groundWeights = RULES.filter((rule) =>
      rule.selector.includes(".ground-"),
    ).flatMap((rule) => values(rule.body, "font-weight"));
    for (const weight of groundWeights) {
      expect({ weight, bold: weight === "500" || weight === "600" || weight === "700" }).toEqual({
        weight,
        bold: false,
      });
    }
  });
});

describe("the two scales: prose for a card, compact for a popover", () => {
  test("the reading leads at 1.625 and the compact scale is smaller", () => {
    expect(values(ROOT.body, "--prose-leading")).toEqual(["1.625"]);
    const prose = parseFloat(values(ROOT.body, "--prose-size")[0]);
    const compact = parseFloat(values(ROOT.body, "--compact-size")[0]);
    expect(compact).toBeLessThan(prose);
    expect(values(ROOT.body, "--compact-leading").length).toBe(1);
  });

  test("a card's reading and note consume the prose scale", () => {
    const reading = RULES.find(
      (rule) => rule.selector === ".ground-reading",
    );
    expect(reading).toBeDefined();
    expect(values((reading as { body: string }).body, "font-size")).toEqual([
      "var(--prose-size)",
    ]);
    expect(values((reading as { body: string }).body, "line-height")).toEqual([
      "var(--prose-leading)",
    ]);
    const note = RULES.find((rule) => rule.selector === ".ground-note");
    expect(note).toBeDefined();
    expect(
      values((note as { body: string }).body, "line-height"),
    ).toEqual(["var(--prose-leading)"]);
  });

  test("the popover scale is a class, and the popovers carry it", () => {
    const popover = RULES.find(
      (rule) => rule.selector === ".ground-popover",
    );
    expect(popover).toBeDefined();
    expect(values((popover as { body: string }).body, "font-size")).toEqual([
      "var(--compact-size)",
    ]);
    // The concept panel, the mention picker and the creation bubble are the
    // story's popovers; each carries the class in its own markup.
    expect(source("canvas/GroundNote.tsx")).toContain(
      "ground-concept-panel ground-popover",
    );
    expect(source("canvas/MentionPicker.tsx")).toContain(
      "ground-mention-picker ground-popover",
    );
    expect(source("canvas/GroundBubble.tsx")).toContain(
      "ground-bubble ground-popover",
    );
    const panel = renderToStaticMarkup(
      createElement(GroundConceptPanel, {
        name: "rain",
        memory: "the water that falls",
        onClose: () => {},
      }),
    );
    expect(panel).toContain("ground-popover");
    const picker = renderToStaticMarkup(
      createElement(MentionPicker, {
        choices: [],
        active: 0,
        onPick: () => {},
      }),
    );
    expect(picker).toContain("ground-popover");
  });

  test("the concept map's own surfaces are untouched by this story", () => {
    // The ground-only scope is stated in the token comment, and the concept
    // map's word heading keeps its own weight exactly as it was.
    expect(CSS).toContain("CONCEPT MAP's own surfaces");
    const word = RULES.find((rule) => rule.selector === ".word-name");
    expect(word).toBeDefined();
    expect(values((word as { body: string }).body, "font-weight")).toEqual([
      "500",
    ]);
  });
});

describe("the stated fold threshold: bounded, written, consumed", () => {
  test("the defaults and bounds are the story's stated ones", () => {
    expect(READING_PREVIEW_DEFAULT).toBe(6);
    expect(NOTE_PREVIEW_DEFAULT).toBe(2);
    expect(READING_PREVIEW_LINES).toBe(READING_PREVIEW_DEFAULT);
    expect(NOTE_PREVIEW_LINES).toBe(NOTE_PREVIEW_DEFAULT);
    expect(DEFAULT_READING_PREFERENCE).toEqual({
      previewLines: 6,
      noteLines: 2,
    });
    expect(PREVIEW_LINES_FLOOR).toBe(2);
    expect(PREVIEW_LINES_CEILING).toBe(20);
  });

  test("a value is bounded by construction, never by the caller's trust", () => {
    expect(boundedPreviewLines(0, 6)).toBe(2);
    expect(boundedPreviewLines(1, 6)).toBe(2);
    expect(boundedPreviewLines(20, 6)).toBe(20);
    expect(boundedPreviewLines(21, 6)).toBe(20);
    expect(boundedPreviewLines(1000, 6)).toBe(20);
    expect(boundedPreviewLines(6.6, 6)).toBe(7);
    expect(boundedPreviewLines("7", 6)).toBe(7);
    expect(boundedPreviewLines("not a number", 6)).toBe(6);
    expect(boundedPreviewLines("", 3)).toBe(3);
    expect(boundedPreviewLines(undefined, 2)).toBe(2);
    expect(boundedPreviewLines(Number.NaN, 6)).toBe(6);
    expect(boundedPreviewLines(Number.POSITIVE_INFINITY, 6)).toBe(6);
  });

  test("the two crops are separate statements, each with its own default", () => {
    expect(readReadingPreference(undefined)).toEqual({
      previewLines: 6,
      noteLines: 2,
    });
    expect(readReadingPreference([])).toEqual({ previewLines: 6, noteLines: 2 });
    expect(readReadingPreference(null)).toEqual({ previewLines: 6, noteLines: 2 });
    expect(readReadingPreference({ previewLines: 3 })).toEqual({
      previewLines: 3,
      noteLines: 2,
    });
    expect(readReadingPreference({ noteLines: 5 })).toEqual({
      previewLines: 6,
      noteLines: 5,
    });
    expect(
      readReadingPreference({ previewLines: 1, noteLines: 99 }),
    ).toEqual({ previewLines: 2, noteLines: 20 });
  });

  test("the stored shape is two bounded numbers and nothing else", () => {
    const stored = storedReadingPreference({ previewLines: 1, noteLines: 99 });
    expect(Object.keys(stored)).toEqual(["previewLines", "noteLines"]);
    expect(stored).toEqual({ previewLines: 2, noteLines: 20 });
  });

  test("it is written through the config's ONE merge, under its own key", () => {
    expect(READING_CONFIG_KEY).toBe("reading");
    expect(APP_CONFIG).toContain("loadAppConfig()");
    expect(APP_CONFIG).toContain("saveAppConfig({ [READING_CONFIG_KEY]: stored })");
    expect(APP_CONFIG).toContain("export async function loadReadingPreference");
    expect(APP_CONFIG).toContain("export async function saveReadingPreference");
  });

  test("Settings states it in its own Reading section and writes nothing else", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.id)).toContain("reading");
    expect(SETTINGS).toContain("loadReadingPreference");
    expect(SETTINGS).toContain("saveReadingPreference");
    expect(SETTINGS).toContain("reading lines");
    expect(SETTINGS).toContain("note lines");
    expect(SETTINGS).toContain("onReadingChanged");
    // The app re-reads the value so every card re-crops behind the modal.
    expect(APP).toContain("previewLines={readingPreference.previewLines}");
    expect(APP).toContain("noteLines={readingPreference.noteLines}");
    expect(APP).toContain("refreshReadingPreference");
  });
});

describe("the crop helper respects the stated value", () => {
  const LONG = Array.from({ length: 10 }, (_, i) => "line " + (i + 1)).join("\n");

  test("the crop cuts at the value, with one ellipsis", () => {
    expect(previewText(LONG, 3)).toBe("line 1\nline 2\nline 3…");
    expect(previewText(LONG, 6)).toBe(
      "line 1\nline 2\nline 3\nline 4\nline 5\nline 6…",
    );
    expect(previewText("a\nb", 2)).toBe("a\nb");
  });

  test("the overflow helper agrees with the crop", () => {
    expect(previewOverflows(LONG, 3)).toBe(true);
    expect(previewOverflows(LONG, 10)).toBe(false);
    expect(previewOverflows("a\nb\n", 2)).toBe(false);
    expect(previewOverflows("", 2)).toBe(false);
    expect(previewOverflows("a", 0)).toBe(true);
  });
});

describe("the small card: the reading pages, and the fold is the note's alone", () => {
  const reference: GroundReference = {
    on: "rain-gauge",
    name: "Rain gauge",
    x: 40,
    y: 60,
  };
  const reading: Reading = {
    on: "rain-gauge",
    form: "path",
    from: "notes/gauge.txt",
    taken: "2026-11-17T12:00:00.000Z",
    bytes: 260,
  };
  const LONG = Array.from({ length: 10 }, (_, i) => "line " + (i + 1)).join("\n");
  const inert = {
    onMove: async () => ({ ok: true as const }),
    onRefresh: async () => ({ ok: true as const }),
    onRepoint: async () => ({ ok: true as const }),
    onRemove: async () => ({ ok: true as const }),
  };

  function render(previewLines: number): string {
    return renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [reading],
        texts: { "rain-gauge": LONG },
        states: { "rain-gauge": "current" },
        previewLines,
        noteLines: 2,
        ...inert,
      }),
    );
  }

  test("the passed threshold is the PAGE, and its number rides the card", () => {
    // STORY 25-2: the pages are the crop — the reading renders WHOLE and the
    // PagedText cuts it at the person's stated count (which still rides the
    // card as --preview-lines, and still drives the note's clamp).
    const html = render(3);
    expect(html).toContain("line 10");
    expect(html).toContain("--preview-lines:3");
    expect(html).toContain("--note-lines:2");
    // The stated count IS the size the flow breaks a page at.
    // STORY 25-4: the page holds FOUR lines — the person's ruling (the old
    // crop count was 6, which clipped the chip off the collapsed card).
    expect(html).toContain("--page-lines:4");
  });

  test("the reading's cut is the flip: a page cue, never a fold", () => {
    // STORY 25-2: the READING pages now — its cut ends in the keys-sized cue
    // (a POSITION like "1 / 4", never a number on the map), and the fade +
    // "more" belong to the NOTE's marginalia alone.
    const html = render(3);
    // The reading renders WHOLE on the card: the pages, not a crop, hold it.
    expect(html).toContain("line 10");
    expect(html).not.toContain("line 3…");
    expect(html).not.toContain("ground-fold");
    // THE CUE is the paged text's own and draws only past one page — mount
    // the component with this reading and this stated count (three lines to
    // a page), the harness standing in for the browser's one measurement.
    const paged = mountPagedText(
      createElement("div", { className: "ground-reading" }, LONG),
      3,
    );
    // Ten lines at three to a page: four pages, and the cue IS the flip.
    expect(paged.cue).not.toBeNull();
    expect(paged.cue).toContain('class="paged-cue verb-key"');
    expect(paged.cue).toContain("1 / 4 ▼");
    expect(paged.cue).toContain('aria-label="page 1 of 4, next page"');
    // The press turns ONE page (view state): the text itself never moves.
    paged.flip();
    expect(paged.cue).toContain("2 / 4 ▼");
    expect(paged.html).toContain("--page-at:1");
    expect(paged.html).toContain("line 10");
    // and the pages wrap, one press at a time.
    paged.flip();
    paged.flip();
    expect(paged.cue).toContain("4 / 4 ▼");
    paged.flip();
    expect(paged.cue).toContain("1 / 4 ▼");
    // The fold's machinery still exists for the note.
    expect(LAYER).toContain('className="ground-more"');
    expect(LAYER).toContain("onClick={onOpen}");
    expect(LAYER).not.toMatch(/ground-more[\s\S]{0,200}previewLines}/);
    // The DOM clamp reads the SAME stated count (a wrapping line's guard).
    expect(CSS).toContain("-webkit-line-clamp: var(--preview-lines, 6)");
    // The note's crop height reads its own stated count.
    expect(CSS).toContain(
      "max-height: calc(var(--note-lines, 2) * var(--prose-leading) * 1em)",
    );
  });

  test("a reading that fits its page draws no cue and no fold", () => {
    const html = render(20);
    // The reading is whole whatever the page size.
    expect(html).toContain("line 10");
    expect(html).not.toContain("ground-fold");
    expect(html).not.toContain(">more<");
    // Ten lines at twenty to a page: ONE page — no cue, no flip to press.
    const paged = mountPagedText(
      createElement("div", { className: "ground-reading" }, LONG),
      20,
    );
    expect(paged.cue).toBeNull();
    expect(paged.html).not.toContain("paged-cue");
  });

  test("the ground map still renders none of the concept map's content", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
