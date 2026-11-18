import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  nativeSelectionPresent,
  paintedHighlightRects,
  type ClientRectLike,
} from "../src/canvas/selectionHighlight";
import { SelectionAsk } from "../src/canvas/SelectionAsk";

/**
 * STORY 16.31 — THE SELECTION STAYS HIGHLIGHTED.
 *
 * The user: "The selection highlight ask is great. It does lose the highlight
 * though whenever the widget pops up, which also means you lose the ability to
 * right click and copy text." There is no DOM harness in this repo and right-
 * click Copy needs a real window, so these tests prove what can be proven here:
 *
 *   - the conversion arithmetic (a captured client rect becomes exactly one
 *     plane rect), and the one "is the browser still selecting?" question, at
 *     the pure seam;
 *   - source facts: no focus and no clear at open; the rects are captured ONCE;
 *     the paint is rendered only by the widget (so every exit unmounts it); a
 *     right press neither dismisses nor re-captures; and the words that ride
 *     the packet are the CAPTURED ones.
 *
 * PROVISIONAL: the painted wash and the widget's look.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const WIDGET = source("canvas/SelectionAsk.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const HIGHLIGHT = source("canvas/selectionHighlight.ts");
const CSS = source("canvas/canvas.css");

const CARD: ClientRectLike = { left: 100, top: 50, right: 400, bottom: 350 };
const ORIGIN = { x: 10, y: 20 };

describe("the captured rects become plane rects, once", () => {
  test("one client rect maps through the card's origin and the camera's zoom", () => {
    const painted = paintedHighlightRects(
      [{ left: 120, top: 60, right: 220, bottom: 80 }],
      CARD,
      ORIGIN,
      2,
    );
    expect(painted).toEqual([{ x: 20, y: 25, width: 50, height: 10 }]);
  });

  test("a multi-line selection keeps every line box, in order", () => {
    const painted = paintedHighlightRects(
      [
        { left: 110, top: 60, right: 210, bottom: 76 },
        { left: 100, top: 76, right: 180, bottom: 92 },
      ],
      CARD,
      ORIGIN,
      1,
    );
    expect(painted).toEqual([
      { x: 20, y: 30, width: 100, height: 16 },
      { x: 10, y: 46, width: 80, height: 16 },
    ]);
  });

  test("an empty or inverted rect paints nothing", () => {
    expect(
      paintedHighlightRects(
        [
          { left: 120, top: 60, right: 120, bottom: 80 },
          { left: 200, top: 60, right: 180, bottom: 80 },
        ],
        CARD,
        ORIGIN,
        1,
      ),
    ).toEqual([]);
    expect(paintedHighlightRects([], CARD, ORIGIN, 1)).toEqual([]);
  });

  test("with no card rect or no zoom there is nothing honest to paint", () => {
    const rect = { left: 120, top: 60, right: 220, bottom: 80 };
    expect(paintedHighlightRects([rect], null, ORIGIN, 1)).toEqual([]);
    expect(paintedHighlightRects([rect], CARD, ORIGIN, 0)).toEqual([]);
    expect(paintedHighlightRects([rect], CARD, ORIGIN, -1)).toEqual([]);
  });

  test("the browser's selection counts only while it shows something", () => {
    expect(nativeSelectionPresent(null)).toBe(false);
    expect(nativeSelectionPresent(undefined)).toBe(false);
    expect(nativeSelectionPresent({ isCollapsed: true, rangeCount: 1 })).toBe(false);
    expect(nativeSelectionPresent({ isCollapsed: false, rangeCount: 0 })).toBe(false);
    expect(nativeSelectionPresent({ isCollapsed: false, rangeCount: 1 })).toBe(true);
  });

  test("the seam is pure: no DOM, no window, no record", () => {
    expect(HIGHLIGHT).not.toContain("document.");
    expect(HIGHLIGHT).not.toContain("getSelection");
    expect(HIGHLIGHT).not.toContain("save");
  });
});

describe("the widget opens without touching the selection", () => {
  test("no focus on mount, no clear of its own", () => {
    // Story 16.19 focused the field on mount, and that is what ate the native
    // selection (and the right-click Copy with it). The field takes focus only
    // when a person clicks it.
    expect(WIDGET).not.toContain(".focus()");
    expect(WIDGET).not.toContain("autoFocus");
    expect(WIDGET).not.toContain("ref={fieldRef}");
    // The widget never clears the browser's selection itself: the ONE caller is
    // the layer's dismiss, the rule 16.19 already had.
    expect(WIDGET.match(/clearTextSelection/g)?.length ?? 0).toBe(1);
    const html = renderToStaticMarkup(
      createElement(SelectionAsk, {
        x: 0,
        y: 0,
        zoom: 1,
        rects: [],
        words: "the chosen words",
        onAskQuestion: async () => ({ ok: true }),
        onDismiss: () => undefined,
      }),
    );
    expect(html).toContain("selection-ask-question");
    expect(html).not.toContain("autofocus");
  });

  test("the card stays open when the press lands in the widget's field", () => {
    // A press into the field is inside the widget but OUTSIDE the card, and the
    // card's own "press away closes" rule used to take the card (and the widget)
    // down before a letter could be typed. The widget is the open reading's own
    // transient, so the card ignores a press inside it.
    const pressAway = LAYER.slice(
      LAYER.indexOf("function onPressAway(e: MouseEvent)"),
      LAYER.indexOf('document.addEventListener("mousedown", onPressAway, true)'),
    );
    expect(pressAway).toContain('e.target.closest(".selection-ask")');
    expect(pressAway.indexOf(".selection-ask")).toBeLessThan(
      pressAway.indexOf("onClose()"),
    );
  });

  test("a right press is not a press away — Copy keeps its menu", () => {
    // Dismissing (and clearing the selection) on a right-click would take Copy
    // away exactly when the person asked for it.
    expect(WIDGET).toContain("if (e.button !== 0) return;");
    const down = WIDGET.slice(
      WIDGET.indexOf("function onDown(e: MouseEvent)"),
      WIDGET.indexOf("document.addEventListener(\"mousedown\", onDown, true)"),
    );
    expect(down.indexOf("e.button !== 0")).toBeLessThan(down.indexOf("onDismiss()"));
  });
});

describe("the paint appears only when the browser's highlight is gone", () => {
  test("the widget asks, at mount and on every change, and paints one way", () => {
    const effect = WIDGET.slice(
      WIDGET.indexOf("const [painted, setPainted]"),
      WIDGET.indexOf("// Esc dismisses without writing"),
    );
    expect(effect).toContain("nativeSelectionPresent(window.getSelection())");
    // The mount check is the first thing: a browser may drop the selection as
    // the widget appears, and nothing may wait for an event to paint.
    expect(effect.indexOf("sync();")).toBeLessThan(
      effect.indexOf('document.addEventListener("selectionchange", sync)'),
    );
    expect(effect).toContain('document.addEventListener("focusin", sync)');
    // One-way: the paint is ours until the widget closes, never flickering
    // back to the native highlight the person no longer has.
    expect(effect).toContain("if (painted) return;");
    expect(effect).not.toContain("setPainted(false)");
  });

  test("the rects are captured ONCE, at the card's mouse-up, and never re-measured", () => {
    expect(LAYER.match(/range\.getClientRects\(\)/g)?.length ?? 0).toBe(1);
    // ONE call site, in the capture: nothing measures later.
    expect(LAYER.match(/paintedHighlightRects\(/g)?.length ?? 0).toBe(1);
    expect(LAYER).toContain("Array.from(range.getClientRects())");
    expect(WIDGET).not.toContain("getClientRects");
    expect(WIDGET).not.toContain("getBoundingClientRect");
    // The capture hands them to the layer with the words, and the layer stores
    // them unchanged.
    expect(LAYER).toContain("report(reference.on, raw, point.x, point.y, rects)");
    expect(LAYER).toContain("rects: readonly PaintedRect[]");
    expect(LAYER).toContain("setSelectionAsk({ source, words, x, y, rects })");
    expect(LAYER).toContain("rects={selectionAsk.rects}");
  });

  test("the paint is the widget's own child, so every exit takes it away", () => {
    // Rendered from the widget and only the widget: ask, dismiss, the card's
    // close and unmount are one unmount of this DOM, never a second clear to
    // forget.
    expect(WIDGET).toContain('className="selection-highlight"');
    expect(WIDGET).toContain("painted &&");
    expect(LAYER).not.toContain("selection-highlight");
    // A successful ask dismisses (the layer's dismiss clears the native
    // selection too)...
    const askBlock = WIDGET.slice(WIDGET.indexOf("async function ask("));
    expect(askBlock.indexOf("if (!result.ok)")).toBeLessThan(
      askBlock.indexOf("onDismiss();"),
    );
    // ...a card close dismisses, and a press away dismisses.
    expect(LAYER).toContain("function dismissSelection()");
    expect(LAYER).toContain("clearTextSelection()");
    expect(LAYER).toContain("openOn === selectionAsk.source");
  });

  test("a scroll drops the paint instead of letting it sit over other words", () => {
    const guard = LAYER.slice(
      LAYER.indexOf("STORY 16.31 — A SCROLL MOVES THE WORDS"),
      LAYER.indexOf("const wordSlugs"),
    );
    expect(guard).toContain('document.addEventListener("scroll", onScroll, true)');
    expect(guard).toContain("rects: []");
    expect(guard).not.toContain("getClientRects");
  });
});

describe("the captured words are the truth, not the live selection", () => {
  test("the widget asks with the words it was handed", () => {
    expect(WIDGET).toContain("selectionWordsRefusal(words)");
    // The ask path carries the stored prop, never a re-read of the DOM.
    // (The file's one getSelection read is clearTextSelection, which removes; it
    // never supplies the packet.)
    const askBlock = WIDGET.slice(WIDGET.indexOf("async function ask("));
    expect(askBlock).toContain("onAskQuestion(question)");
    expect(askBlock).not.toContain("getSelection");
    // The layer hands the CAPTURED words to the writer with the question.
    const layerAsk = LAYER.slice(
      LAYER.indexOf("async function askSelection"),
      LAYER.indexOf("// A CARD CLOSE TAKES THE WIDGET WITH IT"),
    );
    expect(layerAsk).toContain("selectionAsk.words");
    expect(layerAsk).not.toContain("getSelection");
  });

  test("the capture is a primary-button capture, or nothing at all", () => {
    const capture = LAYER.slice(
      LAYER.indexOf("function onMouseUp(e: MouseEvent)"),
      LAYER.indexOf('window.addEventListener("mouseup", onMouseUp)'),
    );
    expect(capture).toContain("if (e.button !== 0) return;");
    expect(capture.indexOf("e.button !== 0")).toBeLessThan(
      capture.indexOf("window.getSelection()"),
    );
  });
});

describe("nothing else moved", () => {
  test("the painted highlight takes no presses and sits under the widget", () => {
    const rule = CSS.slice(
      CSS.indexOf(".selection-highlight {"),
      CSS.indexOf(".selection-ask {"),
    );
    expect(rule).toContain("pointer-events: none;");
    expect(rule).toContain("position: absolute;");
    // Above the expanded card (6), below the widget (8).
    expect(rule).toContain("z-index: 7;");
  });

  test("no record, no Rust, no counters, and the ground map still renders []", () => {
    expect(HIGHLIGHT).not.toContain("prism");
    expect(HIGHLIGHT).not.toContain("counter");
    expect(WIDGET).not.toContain("prism");
    expect(WIDGET).not.toContain("fetch(");
  });
});
