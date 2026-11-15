import { describe, expect, test } from "bun:test";
import {
  pointInPolygon,
  wordsInPolygon,
  type LassoWord,
  type Point,
} from "../src/canvas/geometry";

/**
 * The selector's draw tool, automated (ADR-0013, story 1): a lasso takes the
 * words whose centres it encloses. Words only — the function is handed the
 * word list alone, so a wire can never become a member through the lasso.
 * The feel of drawing it is the human check.
 */

/** A 100×100 square, clockwise, in world space. */
const square: Point[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

const word = (slug: string, x: number, y: number): LassoWord => ({
  slug,
  pos: { x, y },
  box: { w: 20, h: 20 },
});

describe("point in polygon", () => {
  test("inside is inside, outside is outside", () => {
    expect(pointInPolygon({ x: 50, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: -1, y: 50 }, square)).toBe(false);
    expect(pointInPolygon({ x: 50, y: 101 }, square)).toBe(false);
    expect(pointInPolygon({ x: 200, y: 200 }, square)).toBe(false);
  });

  test("a point on an edge or vertex counts (a lasso along the border takes it)", () => {
    expect(pointInPolygon({ x: 0, y: 50 }, square)).toBe(true);
    expect(pointInPolygon({ x: 100, y: 100 }, square)).toBe(true);
  });

  test("a path with fewer than three points encloses nothing", () => {
    expect(pointInPolygon({ x: 0, y: 0 }, [])).toBe(false);
    expect(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }])).toBe(false);
    expect(
      pointInPolygon({ x: 0, y: 0 }, [
        { x: -10, y: -10 },
        { x: 10, y: 10 },
      ]),
    ).toBe(false);
  });

  test("a concave lasso is read correctly (a word in the notch is out)", () => {
    // A C-ish polygon open toward the right.
    const c: Point[] = [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 20 },
      { x: 20, y: 20 },
      { x: 20, y: 80 },
      { x: 100, y: 80 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ];
    expect(pointInPolygon({ x: 10, y: 50 }, c)).toBe(true);
    expect(pointInPolygon({ x: 60, y: 50 }, c)).toBe(false);
  });
});

describe("the lasso takes words by their centres", () => {
  test("only enclosed words come back, with their slugs", () => {
    const inside = wordsInPolygon(square, [
      word("rain", 10, 10),
      word("soil", 200, 200),
      word("mulch", 20, 20), // centre (30, 30)
    ]);
    expect(inside.map((w) => w.slug)).toEqual(["rain", "mulch"]);
  });

  test("a word whose centre is outside is out even if its box overlaps", () => {
    // Centre at (95, 50) is inside; centre at (105, 50) is outside.
    expect(wordsInPolygon(square, [word("edge", 85, 40)])).toHaveLength(1);
    expect(wordsInPolygon(square, [word("edge", 95, 40)])).toHaveLength(0);
  });

  test("an empty lasso selects nothing (never everything)", () => {
    expect(wordsInPolygon([], [word("rain", 10, 10)])).toEqual([]);
  });

  test("a lasso is handed the word list only — words are the whole vocabulary", () => {
    // The signature takes LassoWord, so wires (which have no pos/box/slug as a
    // word does) are outside it by construction. This pins the shape the
    // selector passes: every current word, never a distance line.
    const words: LassoWord[] = [word("rain", 10, 10)];
    expect(wordsInPolygon(square, words).map((w) => w.slug)).toEqual(["rain"]);
  });
});
