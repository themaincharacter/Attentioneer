import { describe, expect, test } from "bun:test";
import {
  centerOf,
  DEFAULT_BOX,
  edgePoint,
  wireEndpoints,
} from "../src/canvas/geometry";

describe("word boxes", () => {
  test("center is the top-left plus half the box", () => {
    expect(centerOf({ x: 100, y: 50 }, { w: 100, h: 30 })).toEqual({ x: 150, y: 65 });
  });

  test("the default box is a single line of text", () => {
    expect(DEFAULT_BOX.w).toBeGreaterThan(0);
    expect(DEFAULT_BOX.h).toBeGreaterThan(0);
  });
});

describe("wire edges never cross the word", () => {
  const box = { w: 100, h: 30 }; // halfW 50, halfH 15

  test("leaves horizontally toward a right-hand neighbor", () => {
    // center (0,0) toward (500,0): the right edge is halfW away
    expect(edgePoint({ x: 0, y: 0 }, box, { x: 500, y: 0 })).toEqual({ x: 50, y: 0 });
  });

  test("leaves vertically toward a word below", () => {
    expect(edgePoint({ x: 0, y: 0 }, box, { x: 0, y: 500 })).toEqual({ x: 0, y: 15 });
  });

  test("on a diagonal it exits the nearest edge", () => {
    // min(50/500, 15/500) = 0.03 → (15, 15): out through the top/bottom edge
    expect(edgePoint({ x: 0, y: 0 }, box, { x: 500, y: 500 })).toEqual({ x: 15, y: 15 });
  });

  test("coincident centers stay put (self-distance)", () => {
    expect(edgePoint({ x: 7, y: 9 }, box, { x: 7, y: 9 })).toEqual({ x: 7, y: 9 });
  });
});

describe("wireEndpoints", () => {
  test("two boxes side by side meet edge to edge", () => {
    // A occupies x 0–100, B occupies x 300–400 (both 30 tall at y 0–30).
    const { from, to } = wireEndpoints(
      { pos: { x: 0, y: 0 }, box: { w: 100, h: 30 } },
      { pos: { x: 300, y: 0 }, box: { w: 100, h: 30 } },
    );
    expect(from).toEqual({ x: 100, y: 15 }); // A's right edge, mid-height
    expect(to).toEqual({ x: 300, y: 15 }); // B's left edge, mid-height
  });

  test("endpoints are symmetric under swap", () => {
    const a = { pos: { x: 10, y: 20 }, box: { w: 80, h: 24 } };
    const b = { pos: { x: 240, y: 180 }, box: { w: 120, h: 26 } };
    const forward = wireEndpoints(a, b);
    const backward = wireEndpoints(b, a);
    expect(forward.from).toEqual(backward.to);
    expect(forward.to).toEqual(backward.from);
  });
});