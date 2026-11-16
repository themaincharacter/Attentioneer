import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  coveredWordSlugs,
  topVeilOf,
  veilsCoveringWord,
  type PlacedWord,
  type Veil,
} from "../src/map/veils";
import {
  capturedBox,
  boxIsDrawable,
  VEIL_LEVELS,
  veilLive,
} from "../src/canvas/veilRules";
import {
  CONTENT_CLASSES,
  CONTENT_SELECTOR,
  isGestureArmed,
  shouldCreate,
  shouldPan,
  shouldStartWordPress,
  WORD_CONTROL_CLASSES,
} from "../src/canvas/gates";
import { LEVELS } from "../src/workspace/level";

/**
 * Epic 9 story 1's cover, automated (ADR-0023): the veil is a render-time
 * REGION TEST — a word is covered iff the CENTRE of its box is inside a veil's
 * box (the selector's own rule) — plus the level-uniform draw-box gesture's
 * pure rules and the LEVELS 1–2 render gate. Covered is not settled: the cover
 * never becomes a field, never changes a mark and never adds a second wash; the
 * sheet owns its presses. The feel of drawing the box is the human check.
 */

const NL = "\n";

function veil(name: string, x: number, y: number, w: number, h: number): Veil {
  return { name, x, y, w, h, reason: "not yet", extra: {} };
}

function word(
  slug: string,
  x: number,
  y: number,
  w = 20,
  h = 20,
): PlacedWord {
  return { slug, pos: { x, y }, box: { w, h } };
}

describe("a word is covered by its CENTRE (the selector's rule)", () => {
  test("the centre inside is covered; a box overlap with the centre out is not", () => {
    // The veil is the square 0..100; the word box is 20x20.
    const veils = [veil("cover", 0, 0, 100, 100)];
    // centre (10,10): inside.
    expect([...coveredWordSlugs(veils, [word("rain", 0, 0)])]).toEqual(["rain"]);
    // centre (110,10): outside, though the word's box reaches into the veil.
    expect([...coveredWordSlugs(veils, [word("edge", 100, 0)])]).toEqual([]);
    // centre (90,90): inside, though the box sticks out past the border.
    expect([...coveredWordSlugs(veils, [word("lip", 80, 80)])]).toEqual(["lip"]);
  });

  test("a centre exactly on the border counts as inside (closed region)", () => {
    const veils = [veil("cover", 0, 0, 100, 100)];
    // The word's centre is pos + half its 20x20 box.
    expect([...coveredWordSlugs(veils, [word("left", -10, 40)])]).toEqual([
      "left",
    ]); // centre (0, 50)
    expect([...coveredWordSlugs(veils, [word("top", 40, -10)])]).toEqual([
      "top",
    ]); // centre (50, 0)
    expect([...coveredWordSlugs(veils, [word("right", 90, 90)])]).toEqual([
      "right",
    ]); // centre (100, 100)
    // A hair past the edge is out.
    expect([...coveredWordSlugs(veils, [word("out", 90.5, 90)])]).toEqual([]);
  });

  test("no veils, nothing covered — never everything", () => {
    expect([...coveredWordSlugs([], [word("rain", 0, 0)])]).toEqual([]);
  });

  test("a degenerate hand-edited box covers nothing (preserved, not repaired)", () => {
    expect([...coveredWordSlugs([veil("flat", 0, 0, 100, 0)], [word("rain", 0, 0)])]).toEqual([]);
    expect([...coveredWordSlugs([veil("inverted", 100, 100, -100, -100)], [word("rain", 0, 0)])]).toEqual([]);
  });

  test("every covered word appears once, in the words' order", () => {
    const veils = [veil("one", 0, 0, 100, 100), veil("two", 0, 0, 100, 100)];
    const covered = coveredWordSlugs(veils, [
      word("rain", 0, 0),
      word("far", 900, 900),
      word("soil", 20, 20),
    ]);
    expect([...covered]).toEqual(["rain", "soil"]);
    expect(covered.size).toBe(2);
  });
});

describe("sheets stack in FILE ORDER (later on top)", () => {
  test("a word inside two veils is covered once, and the later line is on top", () => {
    const veils = [veil("under", 0, 0, 100, 100), veil("over", 50, 50, 100, 100)];
    const target = word("rain", 60, 60); // centre (70,70): inside both
    expect(veilsCoveringWord(veils, target).map((v) => v.name)).toEqual([
      "under",
      "over",
    ]);
    expect(topVeilOf(veils, target)?.name).toBe("over");
    expect([...coveredWordSlugs(veils, [target])]).toEqual(["rain"]);
  });

  test("a word outside every veil has no top sheet", () => {
    const veils = [veil("under", 0, 0, 10, 10), veil("over", 500, 500, 10, 10)];
    expect(veilsCoveringWord(veils, word("rain", 100, 100))).toEqual([]);
    expect(topVeilOf(veils, word("rain", 100, 100))).toBeNull();
  });

  test("nesting is provisional: the innermost need not be the top", () => {
    // A big sheet drawn AFTER a small one covers it: file order, not size.
    const veils = [veil("small", 0, 0, 10, 10), veil("big", -50, -50, 200, 200)];
    expect(topVeilOf(veils, word("rain", -5, -5))?.name).toBe("big");
  });
});

describe("the draw-box gesture's pure rules", () => {
  test("the capture takes the rectangle's bounds, whichever corner came first", () => {
    const downRight = capturedBox({ x: 10, y: 20 }, { x: 130, y: 60 });
    const upLeft = capturedBox({ x: 130, y: 60 }, { x: 10, y: 20 });
    expect(downRight).toEqual({ x: 10, y: 20, w: 120, h: 40 });
    expect(upLeft).toEqual(downRight);
    // A drag to the left and up still produces positive extents.
    const mixed = capturedBox({ x: 50, y: 50 }, { x: 10, y: 80 });
    expect(mixed).toEqual({ x: 10, y: 50, w: 40, h: 30 });
  });

  test("a click encloses nothing; any real rectangle does", () => {
    expect(boxIsDrawable(capturedBox({ x: 5, y: 5 }, { x: 5, y: 5 }))).toBe(
      false,
    );
    // A one-axis drag encloses no area: a zero-height box covers no centre.
    expect(boxIsDrawable(capturedBox({ x: 0, y: 5 }, { x: 50, y: 5 }))).toBe(
      false,
    );
    expect(boxIsDrawable(capturedBox({ x: 0, y: 0 }, { x: 50, y: 1 }))).toBe(
      true,
    );
  });

  test("the box the plane captures is the record's box (no stroke, no path)", () => {
    const captured = capturedBox({ x: 1, y: 2 }, { x: 11, y: 9 });
    expect(Object.keys(captured).sort()).toEqual(["h", "w", "x", "y"]);
    expect(captured).toEqual({ x: 1, y: 2, w: 10, h: 7 });
  });
});

describe("the arming: LEVEL-UNIFORM and settled against the plane", () => {
  test("it works at concept AND dynamics, and never at ground", () => {
    expect(VEIL_LEVELS).toEqual(["concept", "dynamics"]);
    expect(veilLive("concept")).toBe(true);
    expect(veilLive("dynamics")).toBe(true);
    expect(veilLive("ground")).toBe(false);
    for (const level of LEVELS) {
      expect(veilLive(level)).toBe(VEIL_LEVELS.includes(level));
    }
  });

  test("the armed veil mode stands the plane's own gestures still", () => {
    // ONE mode at both levels: nothing in the gate branches on the level.
    expect(isGestureArmed("veil")).toBe(true);
    // pan
    expect(shouldPan("veil")).toBe(false);
    // double-click creation (the ring menu never opens mid-box)
    expect(shouldCreate("veil")).toBe(false);
    // every word press — drag, click-to-center, the ring, the connect handle
    expect(shouldStartWordPress("veil", null)).toBe(false);
    const control = { contains: (token: string) => token === "word-name" };
    expect(shouldStartWordPress("veil", control)).toBe(false);
    // the idle canvas is untouched
    expect(isGestureArmed("idle")).toBe(false);
    expect(shouldPan("idle")).toBe(true);
    expect(shouldCreate("idle")).toBe(true);
    expect(shouldStartWordPress("idle", control)).toBe(true);
  });

  test("the gate's lists own every veil element (content, never a plane press)", () => {
    const veilClasses = [
      "veil-sheet",
      "veil-retire",
      "veil-draft",
      "veil-bar",
      "veil-coinfield",
      "veil-coinfield-input",
      "veil-reason-input",
    ];
    for (const name of veilClasses) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(CONTENT_SELECTOR).toContain("." + name);
      // The word handler's early-return list too, so no veil element can ever
      // start a word drag or a click-to-center.
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
    }
    // A class list may not duplicate a token (contains() would still work, but
    // the list is a set by contract).
    expect(new Set(CONTENT_CLASSES).size).toBe(CONTENT_CLASSES.length);
    expect(new Set(WORD_CONTROL_CLASSES).size).toBe(WORD_CONTROL_CLASSES.length);
  });

  test("the app arms ONE veil mode for both levels (no level branch in the gate)", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain("veilArmed || veilBox !== null");
    expect(app).toContain('? "veil"');
    expect(app).toContain("boxArmed={veilArmed}");
    expect(app).toContain("onDrawBox={captureVeilBox}");
    // The door asks the level rule; the arm runs the cancel-pending path so one
    // armed gesture owns the pointer at a time.
    expect(app).toContain("if (!veilLive(level)) return;");
    expect(app).toContain("cancelPendingGestures();" + NL + "    setVeilArmed(true);");
    // A level switch cancels the arm: the switch path closes every gesture.
    expect(app).toContain("setVeilArmed(false);" + NL + "    setVeilBox(null);");
    // The armed gesture says what it is and how it ends (the path bar's idiom).
    expect(app).toContain("{veilArmed && <VeilBar />}");
  });

  test("the plane shares ONE draw capture between the lasso and the box", () => {
    const plane = readFileSync(
      new URL("../src/canvas/CanvasPlane.tsx", import.meta.url),
      "utf8",
    );
    expect(plane).toContain("boxArmed?: boolean");
    expect(plane).toContain("onDrawBox?: (box: VeilBox) => void");
    // The press decides which arm is live; the lasso is never the veil's arm.
    expect(plane).toContain("const lasso = lassoArmedRef.current;");
    expect(plane).toContain("if (!lasso && !boxArmedRef.current) return;");
    expect(plane).toContain("if (boxIsDrawable(box)) onDrawBoxRef.current?.(box);");
    // The d3 pan filter refuses the press while any gesture is armed.
    expect(plane).toContain("isGestureArmed(modeRef.current)");
  });
});

describe("the ground gate: no sheet at ground (a render rule)", () => {
  test("the app renders sheets behind veilLive, so ground draws none", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const sheets = app.indexOf("{veilLive(level) &&");
    const sheetRender = app.indexOf("<VeilSheet");
    expect(sheets).toBeGreaterThan(-1);
    expect(sheetRender).toBeGreaterThan(sheets);
    // The cover's own component never decides the level: ONE rule, in veilRules.
    const component = readFileSync(
      new URL("../src/canvas/VeilSheet.tsx", import.meta.url),
      "utf8",
    );
    expect(component).not.toContain('"ground"');
    expect(component).not.toContain("veilLive");
  });

  test("the door is absent at ground too (no veil is coined where none shows)", () => {
    const control = readFileSync(
      new URL("../src/canvas/LevelControl.tsx", import.meta.url),
      "utf8",
    );
    expect(control).toContain("{veilLive(level) && (");
    expect(control).toContain("onDrawVeil");
    // The write is where the rule is enforced as well (useMap's createVeil).
    const map = readFileSync(
      new URL("../src/canvas/useMap.ts", import.meta.url),
      "utf8",
    );
    expect(map).toContain("if (!veilLive(level)) return;");
  });

  test("the veil RECORD is not gated on the level: a ground open still reads it", () => {
    // The rule is render-only: the record module and its region test never take
    // a level (so nothing is deleted or hidden at ground).
    const veils = readFileSync(
      new URL("../src/map/veils.ts", import.meta.url),
      "utf8",
    );
    expect(veils).not.toContain("workspace/level");
    expect(veils).not.toContain("veilLive");
    const rules = readFileSync(
      new URL("../src/canvas/veilRules.ts", import.meta.url),
      "utf8",
    );
    expect(rules).toContain("export function veilLive(level: Level): boolean");
  });
});

describe("covered is not settled: the cover adds no field and no second quiet", () => {
  const css = readFileSync(
    new URL("../src/canvas/canvas.css", import.meta.url),
    "utf8",
  );
  function rule(selector: string): string {
    const start = css.indexOf(selector + " {");
    expect(start).toBeGreaterThan(-1);
    const end = css.indexOf("}", start);
    return css.slice(start, end);
  }

  test("the covered word's class carries VISIBILITY only", () => {
    const covered = rule(".word.veil-covered");
    expect(covered).toContain("visibility: hidden");
    for (const quiet of [
      "opacity",
      "filter",
      "color",
      "text-decoration",
      "background",
      "font-style",
      "text-shadow",
    ]) {
      expect(covered).not.toContain(quiet);
    }
  });

  test("the out-of-set wash stays the ONE wash (never a second quiet)", () => {
    const wash = rule(".word.out-of-set");
    expect(wash).toContain("opacity: 0.42");
    // Exactly one base wash rule on a word.
    const washes = css.match(/^\.word\.out-of-set \{/gm) ?? [];
    expect(washes).toHaveLength(1);
    // The cover adds none (asserted above), and the shelf's quiet is unchanged.
    expect(rule(".word.shelved")).toContain("opacity");
  });

  test("a covered+marked word keeps its ghosted, dashed reading exactly", () => {
    // The mark's rendering is its own selectors; the cover never touches them.
    expect(rule(".word.open .word-name")).toContain(
      "text-decoration: underline dashed",
    );
    const source = readFileSync(
      new URL("../src/canvas/ReferenceWord.tsx", import.meta.url),
      "utf8",
    );
    // Two separate classes, computed from two separate readings.
    expect(source).toContain('marked ? " open" : ""');
    expect(source).toContain('covered ? " veil-covered" : ""');
  });

  test("the app feeds the cover its own prop; marked and out-of-set are untouched", () => {
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app).toContain("outOfSet={isOutOfSet(word)}");
    expect(app).toContain("covered={word.slug !== null && coveredSlugs.has(word.slug)}");
    expect(app).toContain("outOfPlay(model, selectorOpen ? selectorDraft : null, word.slug)");
    // The covered set is computed from the veils and the words only.
    expect(app).toContain("coveredWordSlugs(veils, selectorWords)");
    // And it never reaches a record writer.
    const map = readFileSync(
      new URL("../src/canvas/useMap.ts", import.meta.url),
      "utf8",
    );
    expect(map).not.toContain("coveredWordSlugs");
    expect(map).not.toContain("topVeilOf");
    expect(map).not.toContain("veilsCoveringWord");
  });

  test("no record carries a veil: the veil module imports no record", () => {
    const veils = readFileSync(
      new URL("../src/map/veils.ts", import.meta.url),
      "utf8",
    );
    const imports = veils.slice(0, veils.indexOf("/**"));
    expect(imports).toContain("../lib/fs");
    expect(imports).toContain("../lib/serialize");
    for (const record of ["marks", "model", "refs", "loops", "links"]) {
      expect(imports).not.toContain(record);
    }
  });

  test("the sheet owns its presses and the crossing wires read through it", () => {
    const sheet = readFileSync(
      new URL("../src/canvas/VeilSheet.tsx", import.meta.url),
      "utf8",
    );
    // A raw mousedown stop: d3-zoom stops the event at the plane, so a React
    // handler alone would still let the pan begin.
    expect(sheet).toContain('el.addEventListener("mousedown", stop)');
    expect(sheet).toContain('className="veil-sheet"');
    // The sheet is the area's fill, level with the wires and under the words.
    expect(rule(".veil-sheet")).toContain("z-index: 1");
    expect(rule(".word")).toContain("z-index: 2");
    // The app renders the sheets BEFORE the wires in the same layer, so a wire
    // crossing a veil still draws over its fill (provisional, ADR-0023).
    const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    expect(app.indexOf("<VeilSheet")).toBeLessThan(app.indexOf("{/* wires */}"));
  });

  test("the sheet says nothing about itself at rest (presence only)", () => {
    const sheet = readFileSync(
      new URL("../src/canvas/VeilSheet.tsx", import.meta.url),
      "utf8",
    );
    // No name, no reason, no count rendered by the cover: the reading is the
    // look-under (story 2) or the game switch.
    expect(sheet).not.toContain("veil.name}");
    expect(sheet).not.toContain("veil.reason");
    expect(sheet).toContain('aria-label="a veil — this area is set aside"');
  });
});
