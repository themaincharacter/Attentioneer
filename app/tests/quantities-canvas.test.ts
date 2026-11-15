import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CONTENT_CLASSES,
  CONTENT_SELECTOR,
  WORD_CONTROL_CLASSES,
  isContentElement,
  isWordControl,
} from "../src/canvas/gates";

/**
 * Epic 8 story 1's AUTHORING affordance, asserted without a DOM: the quiet
 * quantity control on a word (a stock line) and on a pair (a flow line) types
 * an amount — Enter commits, Esc discards — and a blank field saves the line
 * with NO amount, the visible unknown the person can reach on purpose. The
 * amount is never inferred, and a negative is refused rather than clamped to 0.
 *
 * The affordance is a dynamics record, so it obeys the same seam as the other
 * dynamics writers: `authoringLive` gates the WRITE (`setQuantity`) and the
 * ECHO before arming (`openQuantity`), while the words, distances and marks
 * every game shares stay ungated. Level 1 renders no card and no glyph.
 *
 * The last describe is the FUNES BRAKE scoped to this seam (ADR-0020 decision
 * 5): no summing, totals, meters or tables anywhere near quantities, and no
 * aggregate helper exported. The scan strips comments, so the prohibition can
 * be stated in prose without tripping itself.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** One `const NAME = useCallback(` block, up to its closing `);`. */
function callbackBody(source: string, name: string): string {
  const start = source.indexOf(`const ${name} = useCallback(`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n  );", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end + 4);
}

/** Source with its comments removed — the Funes scan reads CODE only. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const useMapSource = read("../src/canvas/useMap.ts");
const appSource = read("../src/App.tsx");
const wordSource = read("../src/canvas/ReferenceWord.tsx");
const linkSource = read("../src/canvas/LinkWire.tsx");
const overlaySource = read("../src/canvas/QuantityOverlay.tsx");
const glyphSource = read("../src/canvas/QuantityGlyph.tsx");
const quantitiesSource = read("../src/map/quantities.ts");
const cssSource = read("../src/canvas/canvas.css");

describe("the authoring write obeys the dynamics seam (authoringLive)", () => {
  test("setQuantity asks authoringLive before its first persist", () => {
    const body = callbackBody(useMapSource, "setQuantity");
    const guard = body.indexOf("if (!authoringLive(level, modelRef.current))");
    expect(guard).toBeGreaterThan(-1);
    expect(body.slice(guard, body.indexOf("persistQuantities("))).toContain(
      "return;",
    );
    expect(guard).toBeLessThan(body.indexOf("persistQuantities("));
  });

  test("setQuantity never joins membership or touches the playing set", () => {
    const body = callbackBody(useMapSource, "setQuantity");
    expect(body).not.toContain("joinToPlay");
    expect(body).not.toContain("joinWords");
    expect(body).not.toContain("saveModel");
    expect(body).not.toContain("modelRef.current =");
  });

  test("the amount card arms only when authoring is live (the echo)", () => {
    const body = callbackBody(appSource, "openQuantity");
    expect(body).toContain("authoringLive(level, model)");
    expect(body.indexOf("authoringLive(")).toBeLessThan(
      body.indexOf("setQuantityAt("),
    );
  });

  test("the card and the glyph are Level 2 only: Level 1 renders neither", () => {
    expect(appSource).toContain(
      'level === "dynamics" && quantityPanel && (',
    );
    // The word-row view is gated at the app, not by a global cue table: a
    // quantity is the dynamics game's own record (and no Level 1 markup moves).
    const view = callbackBody(appSource, "quantityViewOf");
    expect(view).toContain(
      'if (level !== "dynamics" || word.slug === null) return undefined;',
    );
    expect(appSource).toContain("quantity={quantityViewOf(word)}");
    expect(wordSource).toContain("quantity && !renaming && (");
    expect(wordSource).toContain("<QuantityGlyph");
  });

  test("the pair's flow control rides the link head, one ordered pair at a time", () => {
    expect(linkSource).toContain("<QuantityGlyph");
    expect(linkSource).toContain("has={hasQuantity}");
    expect(appSource).toContain("type: \"flow\"");
    expect(appSource).toContain("quantityTargetKey({");
  });

  test("the writer's queue keeps one file write at a time", () => {
    expect(useMapSource).toContain("const persistQuantities = useCallback(");
    expect(useMapSource).toContain("quantitiesWriteRef.current");
    expect(callbackBody(useMapSource, "persistQuantities")).toContain(
      "saveQuantities(",
    );
    // The loader reads the record with the rest of the map, and the mirror
    // follows it so a burst can never write from a stale list. Epic 8 story 2
    // gives the three variant-owned records a FOLDER (ADR-0021): `map/` for the
    // committed model, the active branch's `scenarios/<slug>/` otherwise, so
    // the loader takes the records dir the hook derives. (Updated in that
    // story, deliberately — the reading is the same.)
    expect(useMapSource).toContain("loadQuantities(recordsDir)");
    expect(useMapSource).toMatch(
      /useEffect\(\(\) => \{\s*quantitiesRef\.current = quantities;/,
    );
  });
});

describe("the amount control: type, Enter commits, Esc discards", () => {
  test("Enter commits through the one field reading; Esc discards", () => {
    expect(overlaySource).toContain("parseAmountInput(draft)");
    expect(overlaySource).toContain('e.key === "Enter"');
    expect(overlaySource).toContain('e.key === "Escape"');
    expect(overlaySource).toContain("onCommit(parsed.amount)");
  });

  test("a blank field is the reachable UNKNOWN line, never a 0", () => {
    expect(overlaySource).toContain('placeholder="leave empty for unknown"');
    // The record layer's blank reading is the unknown state (tested there).
    expect(quantitiesSource).toContain('if (trimmed === "") return { ok: true, amount: null };');
  });

  test("a negative entry is REFUSED quietly, never clamped", () => {
    expect(overlaySource).toContain("if (!parsed.ok)");
    expect(overlaySource).toContain("setRefused(true)");
    // No clamping anywhere: the card never turns a negative into 0.
    expect(overlaySource).not.toContain("Math.max");
    expect(overlaySource).not.toContain("Math.min");
    expect(quantitiesSource).not.toContain("Math.max");
    expect(quantitiesSource).not.toContain("Math.min");
  });

  test("the card shows a line's unknown state and offers its quiet ×", () => {
    expect(overlaySource).toContain('className="quantity-unknown"');
    expect(overlaySource).toContain("unknown");
    expect(overlaySource).toContain('className="quantity-remove"');
    expect(overlaySource).toContain("onRemove()");
  });
});

describe("every new element joins the gate's lists (ADR-0016 decision 4)", () => {
  const quantityClasses = [
    "quantity-glyph",
    "quantity-overlay",
    "quantity-line",
    "quantity-target",
    "quantity-input",
    "quantity-state",
    "quantity-unknown",
    "quantity-amount",
    "quantity-remove",
    "quantity-close",
  ] as const;

  test("each class is content, so no press on it can pan or create", () => {
    for (const name of quantityClasses) {
      expect(CONTENT_CLASSES).toContain(name);
    }
  });

  test("each class is a word control, so no press can start a word gesture", () => {
    for (const name of quantityClasses) {
      expect(WORD_CONTROL_CLASSES).toContain(name);
    }
  });

  test("the DOM-token reading honors the lists at runtime", () => {
    const classListOf = (...classes: string[]) => ({
      contains: (token: string) => classes.includes(token),
    });
    expect(isContentElement(classListOf("quantity-glyph"))).toBe(true);
    expect(isContentElement(classListOf("quantity-overlay"))).toBe(true);
    expect(isWordControl(classListOf("quantity-glyph"))).toBe(true);
    expect(isWordControl(classListOf("quantity-input"))).toBe(true);
    // A plain plane press is still a plane press.
    expect(isContentElement(classListOf("plane"))).toBe(false);
    expect(isWordControl(classListOf("word-name"))).toBe(false);
  });

  test("the content selector names every quantity element", () => {
    for (const name of quantityClasses) {
      expect(CONTENT_SELECTOR).toContain(`.${name}`);
    }
  });

  test("a press on a glyph never falls through to a word press or a pan", () => {
    // The word handler's own early-return list is the WORD_CONTROL_CLASSES
    // reading; the glyph's class is on it, so the press cannot start a drag.
    expect(wordSource).toContain(
      "shouldStartWordPress(interactionMode, target.classList)",
    );
    expect(glyphSource).toContain('className={`quantity-glyph');
    // The plane's armed gate and the card own their presses the same way.
    expect(cssSource).toContain(".plane.gesture-armed .quantity-glyph");
    expect(overlaySource).toContain('el.addEventListener("mousedown", stop)');
    expect(overlaySource).toContain('document.addEventListener("mousedown", onDown, true)');
  });

  test("the glyph reads presence only, never the amount", () => {
    // The component receives a boolean and opens the card; it never reads a
    // number, so no glyph can become a meter.
    expect(glyphSource).toContain("has: boolean");
    // No amount ever reaches the glyph: only the presence boolean.
    expect(glyphSource).not.toContain(".amount");
    expect(glyphSource).not.toContain("formatAmount");
    expect(glyphSource).toContain("has ? ");
  });
});

describe("the Funes brake, scoped to the quantity seam (ADR-0020 decision 5)", () => {
  const AGGREGATE =
    /\b(sum|sums|summing|total|totals|meter|meters|table|tables|aggregate|aggregates|average|mean|score|scores)\b/i;

  test("no summing/totals/meters/tables appear in the seam's code", () => {
    for (const [name, source] of [
      ["map/quantities.ts", quantitiesSource],
      ["canvas/QuantityOverlay.tsx", overlaySource],
      ["canvas/QuantityGlyph.tsx", glyphSource],
      ["canvas/canvas.css", cssSource],
    ] as const) {
      const code = codeOnly(source);
      expect({ name, found: code.match(AGGREGATE)?.[0] ?? null }).toEqual({
        name,
        found: null,
      });
      expect({ name, reduce: code.includes(".reduce(") }).toEqual({
        name,
        reduce: false,
      });
    }
  });

  test("no aggregate helper is exported from the record layer", () => {
    const exports = [...quantitiesSource.matchAll(/export (?:async )?function (\w+)/g)].map(
      (match) => match[1],
    );
    expect(exports.length).toBeGreaterThan(0);
    for (const name of exports) {
      expect(name).not.toMatch(
        /sum|total|meter|table|aggregate|average|mean|score/i,
      );
    }
    // The seam's own helpers are the read/write grammar and nothing else.
    expect(exports).toContain("setQuantity");
    expect(exports).toContain("parseQuantityLine");
    expect(exports).toContain("findOutOfPlayQuantities");
  });

  test("the glyph and the card show no numeral surface: presence or one value", () => {
    // The overlay is ONE field and one line's state — no column of lines, no
    // list of targets, nothing that could grow into a table.
    expect(overlaySource).not.toContain(".map(");
    expect(overlaySource).not.toMatch(/\brows\b/);
    expect(glyphSource).not.toContain("formatAmount");
  });
});
