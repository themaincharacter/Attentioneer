import { describe, expect, test } from "bun:test";
import { closesPair, DOUBLE_CLICK_MS, PAIR_SLOP } from "../src/canvas/planePress";

/**
 * The creation-menu guard, automated: the menu opens only for a close pair of
 * presses on empty plane. Content presses never reach the plane's counter, so
 * a hurried double-click on a word (which centers it) cannot create anything.
 * The menu's own look, placement and dismissals remain the human check.
 */

const press = (t: number, x: number, y: number) => ({ t, x, y });

describe("a plane double-click is a close pair of presses", () => {
  test("two presses close in time and place form a pair", () => {
    expect(closesPair(press(0, 100, 100), press(180, 103, 101))).toBe(true);
  });

  test("presses apart in time or place are two clicks, not a pair", () => {
    expect(closesPair(press(0, 100, 100), press(DOUBLE_CLICK_MS + 1, 100, 100))).toBe(false);
    // Two deliberate clicks on different spots never open the menu.
    expect(closesPair(press(0, 100, 100), press(120, 400, 300))).toBe(false);
  });

  test("the slop is screen pixels, not world units", () => {
    expect(closesPair(press(0, 100, 100), press(120, 100 + PAIR_SLOP, 100))).toBe(true);
    expect(closesPair(press(0, 100, 100), press(120, 100 + PAIR_SLOP + 1, 100))).toBe(false);
  });
});
