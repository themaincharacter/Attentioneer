import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  FOLD_LABEL_END_OFFSET,
  FOLD_LABEL_TOP,
  FOLD_PAD,
  FOLD_REACH,
  foldCaptionTops,
  foldExtent,
  type FoldBox,
} from "../src/map/shelf";

/**
 * Epic 6 story 3's fold extent, automated at the pure layer: the shelf is a
 * place in WORLD space (ADR-0010), so the drawn fold must reach the shelf it
 * marks. The extent never shrinks below the old minimum reach (the default look
 * holds), grows to cover every word's box plus a margin, and repeats its
 * "set aside" caption at the far end when it has grown — so a word set aside far
 * below still reads as set aside. Provisional geometry (ADR-0003's seam).
 */

const box = (y: number, h = 28): FoldBox => ({ y, h });

describe("the minimum reach keeps the familiar look", () => {
  test("no words: the old fixed extent, and the one familiar caption", () => {
    const extent = foldExtent([]);
    expect(extent).toEqual({
      top: -FOLD_REACH,
      bottom: FOLD_REACH,
      height: FOLD_REACH * 2,
    });
    expect(foldCaptionTops(extent)).toEqual([FOLD_LABEL_TOP]);
  });

  test("words inside the minimum reach do not move the line", () => {
    const extent = foldExtent([box(0), box(240), box(1200)]);
    expect(extent.top).toBe(-FOLD_REACH);
    expect(extent.bottom).toBe(FOLD_REACH);
    expect(foldCaptionTops(extent)).toEqual([FOLD_LABEL_TOP]);
  });

  test("the extent's height is always bottom minus top", () => {
    for (const boxes of [[], [box(0)], [box(50000)], [box(-50000)], [box(-50000), box(50000)]]) {
      const extent = foldExtent(boxes);
      expect(extent.height).toBe(extent.bottom - extent.top);
      expect(extent.top).toBeLessThanOrEqual(extent.bottom);
    }
  });
});

describe("a word set aside far below is still covered", () => {
  test("the fold reaches the word's box plus the margin", () => {
    const word = box(50000);
    const extent = foldExtent([word]);
    expect(extent.top).toBe(-FOLD_REACH);
    expect(extent.bottom).toBe(word.y + word.h + FOLD_PAD);
    expect(extent.top).toBeLessThanOrEqual(word.y);
    expect(extent.bottom).toBeGreaterThanOrEqual(word.y + word.h);
  });

  test("the far end repeats the caption, close to the word it names", () => {
    const word = box(50000);
    const extent = foldExtent([word]);
    const tops = foldCaptionTops(extent);
    expect(tops).toContain(FOLD_LABEL_TOP);
    const far = Math.max(...tops);
    // Past the word and inside the covered extent, within one margin + the
    // caption's own offset of the word's bottom.
    expect(far).toBeGreaterThanOrEqual(word.y);
    expect(far).toBeLessThan(extent.bottom);
    expect(far - (word.y + word.h)).toBeLessThanOrEqual(
      FOLD_PAD + FOLD_LABEL_END_OFFSET,
    );
  });

  test("a word far ABOVE extends the top, with a caption up there", () => {
    const word = box(-50000);
    const extent = foldExtent([word]);
    expect(extent.bottom).toBe(FOLD_REACH);
    expect(extent.top).toBe(word.y - FOLD_PAD);
    const tops = foldCaptionTops(extent);
    expect(tops).toContain(FOLD_LABEL_TOP);
    expect(Math.min(...tops)).toBe(extent.top + FOLD_LABEL_TOP);
  });

  test("a word between the minimum reach and a far one still grows the line", () => {
    const near = foldExtent([box(12000)]);
    expect(near.bottom).toBe(12000 + 28 + FOLD_PAD);
    const far = foldExtent([box(12000), box(90000)]);
    expect(far.bottom).toBe(90000 + 28 + FOLD_PAD);
    // The caption follows the deepest word, not the first one.
    expect(Math.max(...foldCaptionTops(far))).toBeGreaterThan(
      Math.max(...foldCaptionTops(near)),
    );
  });
});

describe("garbage never reaches the renderer", () => {
  test("a non-finite y is ignored; a garbage height reads as a line", () => {
    const extent = foldExtent([
      { y: Number.NaN, h: 28 },
      { y: 50000, h: Number.NaN },
    ]);
    expect(Number.isFinite(extent.top)).toBe(true);
    expect(Number.isFinite(extent.bottom)).toBe(true);
    expect(extent.bottom).toBe(50000 + FOLD_PAD);
  });

  test("a negative height never shrinks the extent below the floor", () => {
    const extent = foldExtent([box(12000, -100)]);
    expect(extent.bottom).toBe(12000 + FOLD_PAD);
  });
});

describe("the wiring: the component draws the extent it is given", () => {
  const shelf = readFileSync(
    new URL("../src/canvas/ShelfFold.tsx", import.meta.url),
    "utf8",
  );
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  test("the fold and the shade span the extent, captions repeat from the rule", () => {
    expect(shelf).toContain("extent.top");
    expect(shelf).toContain("extent.height");
    expect(shelf).toContain("foldCaptionTops(extent)");
    expect(shelf).toContain('className="shelf-fold"');
    expect(shelf).toContain('className="shelf-label"');
    // The old fixed-reach render is gone: the extent decides.
    expect(shelf).not.toContain("FOLD_REACH * 2");
  });

  test("the app computes the extent from the words on the map", () => {
    expect(app).toContain("foldExtent(");
    expect(app).toContain("extent={fold}");
    // Live positions, so a drag past the fold updates the extent.
    expect(app).toContain("posOf(word).y");
  });
});
