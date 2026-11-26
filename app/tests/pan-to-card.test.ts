import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expandedCenter } from "../src/canvas/GroundLayer";

const LAYER = readFileSync(
  join(import.meta.dir, "../src/canvas/GroundLayer.tsx"),
  "utf8",
);
const PLANE = readFileSync(
  join(import.meta.dir, "../src/canvas/CanvasPlane.tsx"),
  "utf8",
);
const APP = readFileSync(join(import.meta.dir, "../src/App.tsx"), "utf8");

describe("the pan to the card (story 25-10)", () => {
  test("the aim is the grown card's middle (the three families share one box)", () => {
    expect(expandedCenter(0, 0)).toEqual({ x: 260, y: 210 });
    expect(expandedCenter(100, 50)).toEqual({ x: 360, y: 260 });
  });

  test("every expansion aims the camera at the card", () => {
    expect(LAYER).toContain("onCenter?.(expandedCenter(reference.x, reference.y));");
    expect(LAYER).toContain("onCenter?.(expandedCenter(ask.x, ask.y));");
    expect(LAYER).toContain("onCenter?.(expandedCenter(session.x, session.y));");
    // The seam is the camera's own centering intent, never a transform here.
    expect(APP).toContain("intents.centerOn(");
    expect(APP).toContain("window.innerWidth / 2");
  });

  test("a programmatic move glides, and reduced motion takes the instant seat", () => {
    // The glide is the inner layer's one class — the wheel's per-frame paints
    // never wear it, so zooming is untouched.
    expect(PLANE).toContain('inner.classList.add("camera-gliding")');
    expect(PLANE).toContain("prefers-reduced-motion: reduce");
    // A real gesture's settle never re-enters the move (the guard stays).
    expect(PLANE).toContain("current.x !== camera.x");
  });
});
