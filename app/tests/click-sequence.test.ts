import { describe, expect, test } from "bun:test";
import {
  castIsConsumed,
  closesPair,
  isPlainClick,
  isSecondOfPair,
} from "../src/canvas/clickSequence";

/**
 * Story-2 guarantee, automated: the plane's two gestures never collide — a
 * plain click casts (deferred), a close second press cancels that cast so
 * double-click coining leaves no stray mark, and a pan is not a click. The
 * slower double-click still reported by the browser is consumed by the coin.
 */

const press = (t: number, x: number, y: number) => ({ t, x, y });
const click = (t: number, x: number, y: number) => ({ t, x, y });

describe("a plain click casts, a pan does not", () => {
  test("a click on its press is a plain click", () => {
    expect(isPlainClick(press(0, 10, 10), click(80, 10, 10))).toBe(true);
    expect(isPlainClick(press(0, 10, 10), click(80, 12, 13))).toBe(true);
  });

  test("pointer drift beyond the slop is a pan, never a cast", () => {
    expect(isPlainClick(press(0, 10, 10), click(80, 10, 60))).toBe(false);
    expect(isPlainClick(press(0, 10, 10), click(80, 24, 10))).toBe(false);
  });

  test("a stale press is not a click", () => {
    expect(isPlainClick(press(0, 10, 10), click(900, 10, 10))).toBe(false);
  });
});

describe("the double-click window", () => {
  test("a close second press forms a pair, and cancels the first cast", () => {
    expect(closesPair(press(0, 100, 100), press(180, 103, 101))).toBe(true);
  });

  test("presses apart in time or place are two clicks, not a pair", () => {
    expect(closesPair(press(0, 100, 100), press(900, 100, 100))).toBe(false);
    // Two deliberate clicks on different spots both cast.
    expect(closesPair(press(0, 100, 100), press(120, 400, 300))).toBe(false);
  });

  test("isSecondOfPair reads only the latest close pair", () => {
    expect(isSecondOfPair([press(0, 10, 10)])).toBe(false);
    expect(isSecondOfPair([press(0, 10, 10), press(150, 11, 10)])).toBe(true);
    expect(isSecondOfPair([press(0, 10, 10), press(150, 300, 10)])).toBe(false);
    expect(
      isSecondOfPair([press(0, 10, 10), press(100, 10, 10), press(1000, 10, 10)]),
    ).toBe(false);
  });
});

describe("a slower double-click consumes the cast it already made", () => {
  test("the coin consumes only the spot cast by its own first press", () => {
    const first = press(0, 10, 10);
    expect(castIsConsumed(first, { press: first })).toBe(true);
    expect(castIsConsumed(first, { press: press(400, 500, 500) })).toBe(false);
    expect(castIsConsumed(first, null)).toBe(false);
  });
});
