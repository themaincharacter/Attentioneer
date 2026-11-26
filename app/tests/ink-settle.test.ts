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

  test("the appear is FELT: a lift and the ink resolving — never a glow", () => {
    // STORY 25-4 (the person: minimal never meant silent — "a simple appear
    // that generates some dopamine is fine"). The words land WET — dark and
    // dense, a hair blurred (story 25-16: the wet-to-dry ink from the brief) —
    // and dry into their resting ink as they lift into place.
    const keyframes = CSS.slice(
      CSS.indexOf("@keyframes ink-appear"),
      CSS.indexOf("@keyframes ink-appear") + 320,
    );
    expect(keyframes).toContain("opacity: 0;");
    expect(keyframes).toContain("translateY(8px)");
    expect(keyframes).toContain("blur(1.6px)");
    // WET: darker and denser than the resting ink.
    expect(keyframes).toContain("brightness(0.82)");
    expect(keyframes).toContain("contrast(1.35)");
    // DRY: exactly the resting ink.
    expect(keyframes).toContain("blur(0) brightness(1) contrast(1)");
    // But it never glows and never loops.
    expect(keyframes).not.toContain("box-shadow");
  });
});
