import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { PinWindow } from "../src/canvas/PinWindow";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const LAYER = readFileSync(
  join(import.meta.dir, "../src/canvas/GroundLayer.tsx"),
  "utf8",
);
const CSS = readFileSync(
  join(import.meta.dir, "../src/canvas/canvas.css"),
  "utf8",
);

describe("the pin window (story 25-11)", () => {
  test("the window carries the name, the close and the card's own face", () => {
    const html = renderToStaticMarkup(
      createElement(
        PinWindow,
        { name: "Rain gauge", onClose: () => {} },
        createElement("div", { className: "ground-body" }, "the face"),
      ),
    );
    expect(html).toContain('class="pin-window"');
    expect(html).toContain('class="ground-name pin-window-name"');
    expect(html).toContain("Rain gauge");
    expect(html).toContain('class="pin-window-close verb-key"');
    expect(html).toContain('class="ground-body"');
    expect(html).toContain("the face");
    // An absent name reads the quiet absence here too.
    const blank = renderToStaticMarkup(
      createElement(PinWindow, { name: "", onClose: () => {} }, null),
    );
    expect(blank).toContain("no name yet");
  });

  test("the verb toggles pin/unpin and the pair shares the kept ink", () => {
    // The card's key says "pin" until the window is up, then "unpin".
    expect(LAYER).toContain('label={pinned ? "unpin" : "pin"}');
    expect(LAYER).toContain("createPortal(");
    expect(LAYER).toContain("<PinWindow name={reference.name}");
    // THE PAIR: the card on the bench and the window on the glass share one
    // gold edge — the kept ink.
    expect(CSS).toContain("--ink-kept");
    expect(CSS).toContain(".ground-reference.pinned");
    expect(CSS).toContain(".pin-window {");
  });

  test("the pins are view state and never a record", () => {
    expect(LAYER).toContain("useState<string[]>([])");
    // The toggle writes component state only — no seam, no line, no write.
    expect(LAYER).toContain("togglePin");
  });

  test("the corners resize the box and the page grows with it", () => {
    const html = renderToStaticMarkup(
      createElement(
        PinWindow,
        { name: "Rain gauge", onClose: () => {} },
        createElement("div", { className: "ground-body" }, "the face"),
      ),
    );
    // All four corners, each its own diagonal.
    for (const corner of ["nw", "ne", "sw", "se"]) {
      expect(html).toContain('class="pin-corner pin-corner-' + corner + '"');
    }
    // THE PERSON'S RULING: the page fills the window's box — "the big point
    // of a resize would be to get more lines in view" — and re-counts when
    // the box changes.
    const PW = readFileSync(
      join(import.meta.dir, "../src/canvas/PinWindow.tsx"),
      "utf8",
    );
    expect(PW).toContain("onCornerDown");
    const PAGED = readFileSync(
      join(import.meta.dir, "../src/reading/PagedText.tsx"),
      "utf8",
    );
    expect(PAGED).toContain("fill?: boolean");
    expect(PAGED).toContain("ResizeObserver");
    // Only the window's copy fills; the token keeps the four-line rule.
    expect(LAYER).toContain("renderBody(open, false)");
    expect(LAYER).toContain("renderBody(true, true)");
    expect(LAYER).toContain("fill={inWindow}");
  });

  test("every card family carries the pin (story 25-13)", () => {
    // The ask and session footers pin beside their open verb, and each
    // family's window shows its OWN face (the renderBody seam).
    for (const [file, body, name] of [
      ["AskCard.tsx", "ask-card-body", "ask.name"],
      ["SessionCard.tsx", "session-card-body", "session.name"],
    ] as const) {
      const src = readFileSync(
        join(import.meta.dir, "../src/canvas/" + file),
        "utf8",
      );
      expect(src).toContain("const renderBody = (open: boolean");
      expect(src).toContain("renderBody(open, false)");
      expect(src).toContain("renderBody(true, true)");
      expect(src).toContain('<div className="' + body + '">{renderBody(true, true)}</div>');
      expect(src).toContain("<PinWindow name={" + name + "}");
      expect(src).toContain('{pinned ? "unpin" : "pin"}');
    }
  });

  test("the window moves by its header and the body stays text", () => {
    const PW = readFileSync(
      join(import.meta.dir, "../src/canvas/PinWindow.tsx"),
      "utf8",
    );
    expect(PW).toContain("onMouseDown={onHeadDown}");
    expect(PW).toContain('className="pin-window-head"');
  });
});
