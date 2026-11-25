import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const CSS = readFileSync(
  join(import.meta.dir, "../src/canvas/canvas.css"),
  "utf8",
);
const PAGED = readFileSync(
  join(import.meta.dir, "../src/reading/PagedText.tsx"),
  "utf8",
);

describe("the silent ink (story 25-3)", () => {
  test("the arriving page carries the settle, and reduced motion removes it", () => {
    // The wrapper is keyed by the page: one remount, one appearance, then the
    // box is completely still.
    expect(PAGED).toContain('className="ink-settle" key={page}');
    const block = CSS.slice(CSS.indexOf(".ink-settle"));
    expect(block).toContain("animation: ink-appear");
    const reduced = block.slice(block.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".ink-settle");
    expect(reduced).toContain("animation: none");
  });

  test("the appear is opacity only: no slide, no scale, no glow", () => {
    const keyframes = CSS.slice(
      CSS.indexOf("@keyframes ink-appear"),
      CSS.indexOf("@keyframes ink-appear") + 200,
    );
    expect(keyframes).toContain("opacity: 0.35");
    expect(keyframes).not.toContain("transform");
    expect(keyframes).not.toContain("box-shadow");
  });
});
