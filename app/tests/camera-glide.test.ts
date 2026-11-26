import { describe, expect, test } from "bun:test";
import { glideToward, INITIAL_CAMERA } from "../src/canvas/useCamera";

describe("the zoom glide (story 25-6)", () => {
  test("one frame eases the position and moves GEOMETRICALLY in the scale", () => {
    const shown = { x: 0, y: 0, zoom: 1 };
    const target = { x: 100, y: 50, zoom: 0.25 };
    const half = glideToward(shown, target, 0.5);
    expect(half.x).toBeCloseTo(50, 5);
    expect(half.y).toBeCloseTo(25, 5);
    // Halfway to a 4x scale change is a 2x scale change — equal ratios, not
    // equal pixels (a zoom should halve in equal steps).
    expect(half.zoom).toBeCloseTo(0.5, 5);
  });

  test("a arrived frame is the target, and the floor is never zero", () => {
    const target = { x: 12, y: -8, zoom: 2 };
    expect(glideToward(target, target, 0.32)).toEqual(target);
    const tiny = glideToward(INITIAL_CAMERA, { x: 0, y: 0, zoom: 0.0001 }, 1);
    expect(tiny.zoom).toBeGreaterThan(0);
  });
});
