import { describe, expect, test } from "bun:test";
import { verbCounterScale } from "../src/canvas/VerbBubble";

describe("the verb strip counter-scales like the name pill", () => {
  test("clamp(1 / zoom, 1, 4): finger-sized at 25%, never above the card's own scale", () => {
    expect(verbCounterScale(1)).toBe(1);
    expect(verbCounterScale(0.5)).toBe(2);
    expect(verbCounterScale(0.25)).toBe(4);
    // The ceiling: deeper zoom-out stays at full size instead of growing.
    expect(verbCounterScale(0.1)).toBe(4);
    // The floor: a zoomed-in strip never outgrows the card.
    expect(verbCounterScale(4)).toBe(1);
    // A broken zoom never divides by zero.
    expect(verbCounterScale(0)).toBe(4);
  });
});
