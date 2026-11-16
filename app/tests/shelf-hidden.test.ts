import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_BOX } from "../src/canvas/geometry";
import { planeHint } from "../src/canvas/mapContentRules";
import { ShelfFold } from "../src/canvas/ShelfFold";
import { SHELF_HIDDEN } from "../src/canvas/deprecations";
import {
  heldLeftOfTheFold,
  recordSetAside,
  setAsideShown,
  shelfShown,
} from "../src/canvas/shelfRules";
import { parseYamlFields, workspaceYml } from "../src/lib/serialize";
import { parseReference } from "../src/map/refs";
import {
  DEFAULT_SHELF_X,
  SHELF_MARGIN,
  foldCaptionTops,
  foldExtent,
  isShelved,
  rejectSpot,
  shelfXOf,
} from "../src/map/shelf";

/**
 * THE SHELF'S REMOVAL (hidden 2026-11-16 per user review), automated.
 *
 * The person asked for the shelf — the fold at the plane's edge and the place a
 * word dragged past it was "set aside" — to go from the concept map. The house
 * rule is HIDE + DEPRECATE (canvas/deprecations.ts's SHELF_HIDDEN), so this file
 * pins the NEW state and, in the same tests, the flip-back:
 *
 *   - the fold, its shaded margin and its captions render NOTHING while the flag
 *     stands, and the whole markup comes back on a flip-back;
 *   - a word ALREADY SET ASIDE keeps its record and is NOT SHOWN anywhere — a
 *     workspace that holds one loads clean, its file byte-exact, nothing thrown;
 *   - the fold GESTURE does nothing: a settled drag is held at the old fold line,
 *     so no word can become set aside, and the word's reject control is not
 *     offered;
 *   - the plane hint loses its fold clause on every map;
 *   - the RECORD machinery is still alive and still tested (map/shelf.ts);
 *   - the negative space: no counter, score, streak, heat or progress vocabulary
 *     reached the new strings.
 *
 * Nothing here weakens an honesty/guardrail suite: the shelf's own record rules
 * (tests/shelf.test.ts, tests/shelf-fold.test.ts) are untouched and still pass.
 */

/* ----------------------------------------------------------------------- *
 * 1. The flag, and the fold's render.
 * ----------------------------------------------------------------------- */

describe("the shelf is hidden, and the flag is the only reading", () => {
  test("the flag is on, typed boolean, and the ONE reading answers", () => {
    expect(SHELF_HIDDEN).toBe(true);
    // A literal would make the flag unusable as a runtime fact.
    expect(typeof SHELF_HIDDEN).toBe("boolean");
    expect(shelfShown()).toBe(false);
    // The flip-back: exactly what setting SHELF_HIDDEN to false does.
    expect(shelfShown(false)).toBe(true);
  });

  test("ShelfFold renders NOTHING: no fold, no margin, no caption", () => {
    const html = renderToStaticMarkup(
      createElement(ShelfFold, { shelfX: DEFAULT_SHELF_X }),
    );
    expect(html).toBe("");
    // The flip-back restores the whole markup, unmoved.
    const back = renderToStaticMarkup(
      createElement(ShelfFold, { shelfX: DEFAULT_SHELF_X, shown: true }),
    );
    expect(back).toContain('class="shelf"');
    expect(back).toContain('class="shelf-shade"');
    expect(back).toContain('class="shelf-fold"');
    expect(back).toContain('class="shelf-label"');
    expect(back).toContain("set aside");
    expect(back).toContain("left:1280px");
  });

  test("the margin's geometry survives: the shade, the labels, the extent", () => {
    // The margin is a RENDER measurement, not map data (map/shelf.ts) — hidden,
    // not deleted: a word far below still grows the drawn extent.
    const extent = foldExtent([{ y: 50000, h: DEFAULT_BOX.h }]);
    expect(extent.bottom).toBeGreaterThan(50000);
    expect(foldCaptionTops(extent).length).toBeGreaterThan(1);
    const back = renderToStaticMarkup(
      createElement(ShelfFold, { shelfX: DEFAULT_SHELF_X, extent, shown: true }),
    );
    // The shade's fixed depth and the label column are the old geometry.
    expect(back).toContain("width:3200px");
    expect(back).toContain("left:1296px");
  });
});

/* ----------------------------------------------------------------------- *
 * 2. A word already set aside: record kept, shown nowhere, nothing crashes.
 * ----------------------------------------------------------------------- */

/**
 * The workspace's bytes, as the app reads them: `workspace.yml`'s text (its
 * `shelf_x` and `format` fields) and ONE reference file whose `x` is past the
 * fold — nothing but its position says "set aside" (ADR-0010). The load is
 * text→record (map/refs.ts's `parseReference`, the same one the fs bridge hands
 * its bytes to), so this is the load with no DOM and no app-data writes.
 */
function shelfWorkspace(): { yml: string; word: string } {
  return {
    yml: workspaceYml(),
    word: [
      "---",
      "name: mulch",
      "x: 2000",
      "y: 320",
      "---",
      "a slow sponge",
      "",
    ].join("\n"),
  };
}

describe("a shelf-holding workspace loads clean while the shelf is hidden", () => {
  test("the word's record reads exactly as written; nothing throws", () => {
    const { yml, word } = shelfWorkspace();
    const shelfX = shelfXOf(parseYamlFields(yml));
    expect(shelfX).toBe(DEFAULT_SHELF_X);

    // The load: each file's bytes become a record, read tolerantly.
    const ref = parseReference("mulch", "mulch", word);
    // The record is WHOLE: its position, its memory, no extra keys.
    expect(ref.name).toBe("mulch");
    expect(ref.x).toBe(2000);
    expect(ref.y).toBe(320);
    expect(ref.body).toBe("a slow sponge\n");
    expect(ref.extra).toEqual({});
    // The derivation still reads it as set aside (the machinery is alive) …
    const setAside = isShelved(ref.x, DEFAULT_BOX.w, shelfX);
    expect(setAside).toBe(true);
    // … and the render does not show it anywhere while the shelf is hidden
    // (the HIDING reads the record's left edge — `recordSetAside`).
    expect(recordSetAside(ref.x, shelfX)).toBe(true);
    expect(setAsideShown(recordSetAside(ref.x, shelfX))).toBe(false);
    // The fold's geometry reads that word without a NaN reaching a renderer.
    const extent = foldExtent([{ y: ref.y, h: DEFAULT_BOX.h }]);
    expect(Number.isFinite(extent.top)).toBe(true);
    expect(Number.isFinite(extent.bottom)).toBe(true);
    // And the shelf's render is empty: the word is not on a shelf that exists.
    expect(
      renderToStaticMarkup(createElement(ShelfFold, { shelfX })),
    ).toBe("");
  });

  test("the flip-back shows it again, on the shelf it never left", () => {
    const { yml, word } = shelfWorkspace();
    const shelfX = shelfXOf(parseYamlFields(yml));
    const ref = parseReference("mulch", "mulch", word);
    const setAside = recordSetAside(ref.x, shelfX);
    expect(setAside).toBe(true);
    // The flag off is the pre-review app: every word is drawn, set aside or not.
    expect(setAsideShown(setAside, false)).toBe(true);
    // And the fold renders again, captions and all.
    const back = renderToStaticMarkup(
      createElement(ShelfFold, { shelfX, shown: shelfShown(false) }),
    );
    expect(back).toContain('class="shelf-fold"');
    expect(back).toContain('class="shelf-label"');
  });
});

/* ----------------------------------------------------------------------- *
 * 3. The fold gesture does nothing.
 * ----------------------------------------------------------------------- */

describe("the drag-past-the-fold gesture sets nothing aside", () => {
  test("a settled drag is held at the old fold line, never past it", () => {
    const fold = DEFAULT_SHELF_X;
    for (const dropped of [fold, fold + 1, fold + 500, 9000]) {
      const held = heldLeftOfTheFold(dropped, fold);
      expect(held).toBeLessThan(dropped);
      // The held record is NOT set aside: the word stays on the plane. (A very
      // WIDE word's centre can still pass the fold from that left edge — which is
      // exactly why the hiding reads the left edge, not the centre, below.)
      expect(recordSetAside(held, fold)).toBe(false);
      expect(isShelved(held, 0, fold)).toBe(false);
    }
    // A word already left of the fold is not moved at all.
    expect(heldLeftOfTheFold(300, fold)).toBe(300);
    expect(heldLeftOfTheFold(fold - 1, fold)).toBe(fold - 1);
  });

  test("the hiding tests the LEFT EDGE: a re-measure never hides a word", () => {
    const fold = DEFAULT_SHELF_X;
    // A word coined a little left of the fold, rendering very wide: its CENTRE is
    // past the fold (so the old quieting rule would call it set aside) but its
    // record's left edge is not — and it stays shown, at every measured width.
    const x = fold - 10;
    expect(recordSetAside(x, fold)).toBe(false);
    for (const width of [96, 400, 2000]) {
      expect(isShelved(x, width, fold)).toBe(true); // the centre reading
      expect(setAsideShown(recordSetAside(x, fold))).toBe(true); // the hiding
    }
  });

  test("the flip-back restores free placement (the old fold rule)", () => {
    const dropped = DEFAULT_SHELF_X + 400;
    expect(heldLeftOfTheFold(dropped, DEFAULT_SHELF_X, false)).toBe(dropped);
    // … and then the record reads as set aside again, as it always did.
    expect(
      recordSetAside(heldLeftOfTheFold(dropped, DEFAULT_SHELF_X, false), DEFAULT_SHELF_X),
    ).toBe(true);
  });

  test("the reject control is not offered: its write stays written but hidden", async () => {
    const { readFileSync } = await import("node:fs");
    const word = readFileSync(
      new URL("../src/canvas/ReferenceWord.tsx", import.meta.url),
      "utf8",
    );
    // The hiding point: the reject button's gate reads the flag.
    expect(word).toContain("{!SHELF_HIDDEN && marked && !renaming && !revealing && (");
    // The markup, its label and its handler are all still written.
    expect(word).toContain('className="word-reject"');
    expect(word).toContain('aria-label="reject — settle and set aside"');
    expect(word).toContain("onClick={onReject}");
    // And the composed write behind it is untouched (settle + set aside).
    const map = readFileSync(new URL("../src/canvas/useMap.ts", import.meta.url), "utf8");
    expect(map).toContain("reject,");
  });
});

/* ----------------------------------------------------------------------- *
 * 4. The hint loses the fold clause — on every map.
 * ----------------------------------------------------------------------- */

describe("the plane hint does not name the shelf", () => {
  test("no map's sentence says fold, set aside or shelf", () => {
    for (const level of ["concept", "dynamics", "ground"] as const) {
      const hint = planeHint(level);
      expect(hint).not.toContain("fold");
      expect(hint).not.toContain("set aside");
      expect(hint).not.toContain("shelf");
    }
    // Concept: the creation clause still names the word (the bubble offers it).
    expect(planeHint("concept")).toBe(
      "drag to pan · scroll to zoom · double-click: word",
    );
  });

  test("the flip-back restores the fold clause word for word", () => {
    expect(planeHint("concept", false)).toBe(
      "drag to pan · scroll to zoom · double-click: word · drag past the fold to set aside",
    );
    // Off concept the map is blank paper, so even the flip-back keeps it out.
    expect(planeHint("dynamics", false)).not.toContain("fold");
  });
});

/* ----------------------------------------------------------------------- *
 * 5. Nothing was deleted: the record machinery is alive.
 * ----------------------------------------------------------------------- */

describe("the shelf's record machinery is alive (nothing was deleted)", () => {
  test("the fold's record, the reject spot and the two files still work", () => {
    const fold = DEFAULT_SHELF_X;
    expect(shelfXOf({ shelf_x: 900 })).toBe(900);
    expect(shelfXOf({})).toBe(DEFAULT_SHELF_X);
    // The composed reject move still computes its column.
    expect(rejectSpot({ x: 300, y: 240, width: DEFAULT_BOX.w }, fold)).toEqual({
      x: fold + SHELF_MARGIN,
      y: 240,
    });
    // An already set-aside word keeps its place (the settle alone is left).
    expect(
      rejectSpot({ x: fold + SHELF_MARGIN, y: 240, width: DEFAULT_BOX.w }, fold),
    ).toBeNull();
  });
});

/* ----------------------------------------------------------------------- *
 * 6. The negative space.
 * ----------------------------------------------------------------------- */

describe("the negative space: the new words announce and rank nothing", () => {
  const FORBIDDEN =
    /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|queue|backlog|total|points)\b/i;

  test("the shelf's new strings and the hint stay quiet", async () => {
    const { readFileSync } = await import("node:fs");
    const rules = readFileSync(
      new URL("../src/canvas/shelfRules.ts", import.meta.url),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(rules).not.toMatch(FORBIDDEN);
    for (const level of ["concept", "dynamics", "ground"] as const) {
      expect(planeHint(level)).not.toMatch(FORBIDDEN);
      expect(planeHint(level)).not.toMatch(/\d/);
    }
    // The hidden shelf's own render carries a caption and nothing else.
    const back = renderToStaticMarkup(
      createElement(ShelfFold, { shelfX: DEFAULT_SHELF_X, shown: true }),
    );
    expect(back.match(FORBIDDEN)?.[0] ?? null).toBe(null);
  });
});
