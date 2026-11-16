import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { LEVELS } from "../src/workspace/level";
import {
  CONTENT_CLASSES,
  CONTENT_SELECTOR,
  WORD_CONTROL_CLASSES,
} from "../src/canvas/gates";
import {
  LOOK_UNDER_AFFORDANCES,
  LOOK_UNDER_CLOSES,
  closesLookUnder,
  counterScale,
  focusAfterLookUnderClose,
  lookUnderAnchor,
  lookUnderCloseReason,
  lookUnderFocusSelector,
  lookUnderLabel,
  lookUnderLive,
  veilLive,
} from "../src/canvas/veilRules";

/**
 * Epic 9 story 2's look-under and ground gate, automated (ADR-0023 decisions
 * 2–3). The look-under is a READ-ONLY transient opened by the person's press:
 * it shows the veil's name and prose reason while its cover is lifted, and it
 * closes on the window's four idioms. The lift is visibility only — a covered
 * word keeps its own quiet (marked = pale/italic/dashed, the one out-of-set
 * wash) and takes no press — and at ground nothing is covered at all, because
 * the game switch IS the look-under there. The feel of opening and closing it
 * is the human check; these are the pure rules, the render rules and the
 * read-only structure.
 */

const source = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

const appSource = source("../src/App.tsx");
const cardSource = source("../src/canvas/VeilLookUnder.tsx");
const sheetSource = source("../src/canvas/VeilSheet.tsx");
const rulesSource = source("../src/canvas/veilRules.ts");
const mapSource = source("../src/canvas/useMap.ts");
const wordSource = source("../src/canvas/ReferenceWord.tsx");
const css = source("../src/canvas/canvas.css");

/** One CSS rule's body (the selector + " {" to its first "}"). */
function rule(selector: string): string {
  const start = css.indexOf(selector + " {");
  expect(start).toBeGreaterThan(-1);
  const end = css.indexOf("}", start);
  return css.slice(start, end);
}

/** One App callback's source, from `const name = useCallback(` to its closing `);` line. */
function callback(text: string, name: string): string {
  const start = text.indexOf("const " + name + " = useCallback(");
  expect(start).toBeGreaterThan(-1);
  const end = text.indexOf("\n  );", start);
  expect(end).toBeGreaterThan(start);
  return text.slice(start, end);
}

describe("the look-under closes on the window's four idioms (pure)", () => {
  test("Esc, the quiet ×, a press away and a level switch — and no fifth way", () => {
    expect(LOOK_UNDER_CLOSES).toEqual([
      "escape",
      "close",
      "outside",
      "level-switch",
    ]);
    for (const act of LOOK_UNDER_CLOSES) {
      expect(closesLookUnder(act)).toBe(true);
    }
    // A made-up act closes nothing: the membership is the whole contract.
    expect(closesLookUnder("pinch" as never)).toBe(false);
  });

  test("the reason a close carries: a dismissal, or the one level switch", () => {
    expect(lookUnderCloseReason("escape")).toBe("dismiss");
    expect(lookUnderCloseReason("close")).toBe("dismiss");
    expect(lookUnderCloseReason("outside")).toBe("dismiss");
    expect(lookUnderCloseReason("level-switch")).toBe("switch-level");
  });

  test("focus returns to the veil's sheet on a dismissal, the level control on a switch", () => {
    expect(focusAfterLookUnderClose("dismiss")).toBe("sheet");
    expect(focusAfterLookUnderClose("switch-level")).toBe("level");
    // The sheet is addressed by its natural key (the markup contract the App
    // and the sheet share); a missing key never guesses — the level control is
    // the safe return, the same selector every other close uses.
    expect(lookUnderFocusSelector("sheet", "rain-veil")).toBe(
      '[data-veil="rain-veil"]',
    );
    expect(lookUnderFocusSelector("sheet")).toBe(
      ".level-control .level-game.active",
    );
    expect(lookUnderFocusSelector("level")).toBe(
      ".level-control .level-game.active",
    );
  });

  test("the card and the app implement the idioms", () => {
    // Esc: a window keydown listener, exactly as the window's.
    expect(cardSource).toContain('if (e.key !== "Escape") return;');
    expect(cardSource).toContain('window.addEventListener("keydown", onKey)');
    // Click-away in the CAPTURE phase (d3-zoom stops the press at the plane).
    expect(cardSource).toContain(
      'document.addEventListener("mousedown", onDown, true)',
    );
    // The quiet ×.
    expect(cardSource).toContain('className="veil-lookunder-close"');
    // A press inside the card is content, never a plane pan.
    expect(cardSource).toContain('el.addEventListener("mousedown", stop)');
    // The sheet is the focusable slot the focus step addresses.
    expect(sheetSource).toContain("data-veil={veilKey(veil)}");
    expect(sheetSource).toContain("tabIndex={0}");
    // The switch path closes it with every other transient (quietly: a wheel
    // crossing never yanks focus).
    const cancel = callback(appSource, "cancelPendingGestures");
    expect(cancel).toContain("setLookUnderKey(null);");
    expect(cancel).not.toContain("focus()");
    // The dismissal's focus return is the window's rule.
    const close = callback(appSource, "closeLookUnder");
    expect(close).toContain("lookUnderFocusSelector(");
    expect(close).toContain("focusAfterLookUnderClose(reason)");
  });
});

describe("the counter-scale is the window idiom (pure)", () => {
  test("a world-anchored card divides by the camera's zoom", () => {
    expect(counterScale(1)).toBe(1);
    expect(counterScale(2)).toBe(0.5);
    expect(counterScale(0.5)).toBe(2);
    expect(counterScale(4)).toBe(0.25);
    for (const zoom of [0.25, 0.5, 1, 2, 4, 8]) {
      expect(counterScale(zoom)).toBe(1 / zoom);
    }
  });

  test("a non-positive zoom reads 1 — never a mirrored or vanished card", () => {
    expect(counterScale(0)).toBe(1);
    expect(counterScale(-2)).toBe(1);
    expect(counterScale(Number.NaN)).toBe(1);
  });

  test("the card applies it with the window's transform and origin", () => {
    expect(cardSource).toContain("counterScale(camera.zoom)");
    expect(cardSource).toContain('translate(0, -50%)');
    expect(cardSource).toContain('transformOrigin: "left center"');
  });

  test("the anchor sits beside the veil, never inside its box", () => {
    const box = { x: 10, y: 20, w: 100, h: 40 };
    expect(lookUnderAnchor(box)).toEqual({ x: 110, y: 40 });
    expect(lookUnderAnchor(box).x).toBeGreaterThanOrEqual(box.x + box.w);
    // A degenerate hand-edited box still anchors at its own right edge.
    expect(lookUnderAnchor({ x: 0, y: 0, w: 0, h: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe("the look-under is READ-ONLY", () => {
  test("its whole affordance list is a read, a close and the provisional rename", () => {
    expect(LOOK_UNDER_AFFORDANCES).toEqual(["read", "close", "rename"]);
    for (const writer of [
      "edit",
      "write",
      "retire",
      "delete",
      "remove",
      "commit",
    ]) {
      expect(LOOK_UNDER_AFFORDANCES as readonly string[]).not.toContain(writer);
    }
  });

  test("the card carries no editor for the covered words and no retire", () => {
    expect(cardSource).not.toContain("onRetire");
    expect(cardSource).not.toContain("onCoin");
    expect(cardSource).not.toContain("contentEditable");
    expect(cardSource).not.toContain("<textarea");
    // Exactly one input: the VEIL's name field (the provisional rename).
    expect(cardSource.match(/<input/g) ?? []).toHaveLength(1);
    expect(cardSource).toContain('className="veil-lookunder-rename"');
    // It imports the key and the record TYPE only — no record writer at all.
    expect(cardSource).toContain(
      'import { veilKey, type Veil } from "../map/veils";',
    );
    for (const writer of [
      "nameVeil",
      "renameVeil",
      "removeVeil",
      "createVeil",
      "saveVeils",
    ]) {
      expect(cardSource).not.toContain(writer);
    }
  });

  test("the reason is shown verbatim, never trimmed, parsed or re-stated", () => {
    expect(cardSource).toContain("{veil.reason}");
    expect(cardSource).not.toContain("veil.reason.trim");
    expect(cardSource).not.toContain("veil.reason.split");
    expect(cardSource).not.toContain("veil.reason.replace");
    // pre-wrap keeps the prose's own spaces and breaks exactly as written.
    expect(rule(".veil-lookunder-reason")).toContain("white-space: pre-wrap");
  });

  test("the lifted words take no press: the reading can never become an edit", () => {
    const lift = rule(".word.veil-covered.veil-lifted");
    expect(lift).toContain("pointer-events: none");
    expect(lift).toContain("visibility: visible");
    // A press on the card is content (never a plane pan).
    expect(cardSource).toContain('el.addEventListener("mousedown", stop)');
  });

  test("the read-only card is the card's own component — the sheet stays silent", () => {
    // The sheet says nothing about itself at rest; the name and the reason live
    // only in the card the person's press opens (a separate piece).
    expect(sheetSource).not.toContain("veil.name}");
    expect(sheetSource).not.toContain("veil.reason");
    expect(cardSource).toContain("lookUnderLabel(veil.name)");
    expect(cardSource).toContain("{veil.name}");
    expect(lookUnderLabel("rain veil")).toBe("the look-under on “rain veil”");
  });
});

describe("the ground gate: no sheet, no look-under via the veil", () => {
  test("the look-under shares the sheet's ONE level reading", () => {
    for (const level of LEVELS) {
      expect(lookUnderLive(level)).toBe(veilLive(level));
    }
    expect(lookUnderLive("ground")).toBe(false);
    expect(lookUnderLive("concept")).toBe(true);
    expect(lookUnderLive("dynamics")).toBe(true);
  });

  test("the card renders behind lookUnderLive, and the component never decides the level", () => {
    expect(appSource).toContain(
      "{lookUnderLive(level) && lookUnderVeil !== null && (",
    );
    expect(appSource).toContain("lookUnderLive,");
    // ONE rule (veilRules): the card knows nothing about a game.
    expect(cardSource).not.toContain("ground");
    expect(cardSource).not.toContain("veilLive");
    expect(cardSource).not.toContain("lookUnderLive");
  });

  test("the OPEN door asks the same rule (a ground press can never open it)", () => {
    const open = callback(appSource, "openLookUnder");
    expect(open).toContain(
      "if (!veilLive(level) || isGestureArmed(gestureMode)) return;",
    );
    // The sheet is the only opener, and the sheet only renders in Levels 1–2.
    expect(appSource).toContain("{veilLive(level) &&");
    expect(appSource.indexOf("<VeilSheet")).toBeGreaterThan(
      appSource.indexOf("{veilLive(level) &&"),
    );
  });

  test("the covered set is level-gated too: at ground the words read normally", () => {
    // The ONE cover reading is behind the same gate, so the `covered` prop is
    // false at ground even though the veil records are still read.
    expect(appSource).toContain("veilLive(level)");
    expect(appSource).toContain("? coveredWordSlugs(veils, selectorWords)");
    expect(appSource).toContain(": new Set<string>()");
    // The prop itself is unchanged: the gate is the reading, not a branch in
    // the word component.
    expect(appSource).toContain(
      "covered={word.slug !== null && coveredSlugs.has(word.slug)}",
    );
    expect(wordSource).not.toContain("veilLive");
    // The record is untouched: the veil module never takes a level.
    expect(source("../src/map/veils.ts")).not.toContain("veilLive");
  });

  test("it speaks about the VEIL, not a word: a word's rename or removal leaves it open", () => {
    // Veils are spatial and the map's batches never touch them (story 1):
    // the look-under is about the area, so a covered word's rename or removal
    // neither closes it nor changes what it says.
    const wordBlock = appSource.slice(
      appSource.indexOf("onRename={(candidate, newName) => {"),
      appSource.indexOf("onConnectFrom={beginConnectLive}"),
    );
    expect(wordBlock.length).toBeGreaterThan(0);
    expect(wordBlock).not.toContain("lookUnder");
    // The card is the veil's: no word record, no reference import, no counts.
    expect(cardSource).not.toContain("map/refs");
    expect(cardSource).not.toContain("ReferenceWord");
    expect(cardSource).not.toContain("word.name");
  });

  test("a level switch closes the look-under through the one switch path", () => {
    expect(callback(appSource, "cancelPendingGestures")).toContain(
      "setLookUnderKey(null);",
    );
    // The switch runs it, so the card cannot outlive the game it was opened in.
    expect(callback(appSource, "switchLevel")).toContain(
      "cancelPendingGestures()",
    );
  });
});

describe("covered quiets are visible under the lift (render-rule level)", () => {
  test("the lift changes visibility only — never a second quiet", () => {
    const lift = rule(".word.veil-covered.veil-lifted");
    expect(lift).toContain("visibility: visible");
    for (const quiet of [
      "opacity",
      "filter",
      "color",
      "text-decoration",
      "background",
      "font-style",
      "text-shadow",
    ]) {
      expect(lift).not.toContain(quiet);
    }
    // And it lands after the cover's own rule, so it wins where it applies.
    expect(css.indexOf(".word.veil-covered {")).toBeLessThan(
      css.indexOf(".word.veil-covered.veil-lifted {"),
    );
  });

  test("a marked word under the lift stays pale, italic and dashed", () => {
    const marked = rule(".word.open .word-name");
    expect(marked).toContain("text-decoration: underline dashed");
    expect(marked).toContain("font-style: italic");
    // The word carries both classes: marked and lifted are separate readings.
    expect(wordSource).toContain('marked ? " open" : ""');
    expect(wordSource).toContain('covered ? " veil-covered" : ""');
    expect(wordSource).toContain('lifted ? " veil-lifted" : ""');
  });

  test("a marked wire under the lift stays dashed", () => {
    expect(rule(".distance-line.open")).toContain("border-top-style: dashed");
    // The lift never reaches a wire: only the covered word's own rule lifts.
    expect(css).not.toContain(".distance-line.veil-lifted");
    expect(css).not.toContain(".link.veil-lifted");
  });

  test("the covered prop is unchanged under the transient: the lift is its own prop", () => {
    expect(appSource).toContain(
      "covered={word.slug !== null && coveredSlugs.has(word.slug)}",
    );
    expect(appSource).toContain(
      "lifted={word.slug !== null && liftedSlugs.has(word.slug)}",
    );
    // Only the OPENED veil's words lift, never every covered word.
    expect(appSource).toContain("coveredWordSlugs([lookUnderVeil], selectorWords)");
    // The lift is a transient's reading: it is not a record and not a field.
    expect(source("../src/map/veils.ts")).not.toContain("lifted");
    expect(mapSource).not.toContain("liftedSlugs");
  });

  test("the sheet is lifted, not removed: its fill goes transparent", () => {
    expect(sheetSource).toContain('data-lifted={lifted ? "true" : undefined}');
    const lifted = rule('.veil-sheet[data-lifted="true"]');
    expect(lifted).toContain("background: transparent");
    expect(lifted).toContain("border-color");
    // The sheet's class literal is untouched (the cover is still the cover).
    expect(sheetSource).toContain('className="veil-sheet"');
  });

  test("the lift is never ambient: the sheet opens nothing by itself", () => {
    // The sheet says nothing at rest; the title is the press's hint, not the
    // veil's content, and the name/reason live only in the opened card.
    expect(sheetSource).toContain('title="press to look under"');
    expect(sheetSource).not.toContain("veil.name}");
    expect(sheetSource).not.toContain("veil.reason");
    // No effect opens it: the only look-under effect CLOSES a retired veil.
    const cleanup = appSource.slice(
      appSource.indexOf("// A veil retired while its look-under is open"),
    );
    expect(cleanup).toContain("setLookUnderKey(null);");
    expect(cleanup.slice(0, 500)).not.toContain("setLookUnderKey(veilKey");
  });
});

describe("the veil's rename inside the look-under (PROVISIONAL)", () => {
  test("it is the loops' idiom: double-click the name, Enter commits, Esc cancels the field", () => {
    const name = cardSource.slice(cardSource.indexOf('className="veil-lookunder-name"'));
    expect(name).toContain("onDoubleClick");
    expect(name).toContain("beginRename()");
    expect(cardSource).toContain("function beginRename()");
    expect(cardSource).toContain("function commitRename()");
    expect(cardSource).toContain("function cancelRename()");
    expect(cardSource).toContain("const trimmed = draft.trim();");
    expect(cardSource).toContain("if (trimmed && trimmed !== veil.name)");
    // Esc in the field cancels the FIELD and stops the card's own Esc.
    expect(cardSource).toContain("e.stopPropagation();");
    expect(cardSource).toContain("cancelRename();");
  });

  test("the record rewrite is in place and returns the rewritten line", () => {
    const rename = callback(mapSource, "renameVeil");
    expect(rename).toContain(
      "(veil: Veil, newName: string): Veil | null =>",
    );
    expect(rename).toContain("renameVeilRecord(current, veil, newName)");
    expect(rename).toContain("return next[index];");
    // A no-op (blank or unchanged) returns null and moves nothing.
    expect(rename).toContain("next[index] === current[index]");
    // The box and the reason are the record module's to preserve; the hook's
    // body never touches either.
    expect(rename).not.toContain("reason");
    expect(rename).not.toContain("box");
  });

  test("the open card follows the minted name (a collision suffix included)", () => {
    const rename = callback(appSource, "renameLookUnder");
    expect(rename).toContain("const renamed = renameVeil(veil, name);");
    expect(rename).toContain("setLookUnderKey(veilKey(renamed));");
    expect(rename).toContain("if (renamed !== null)");
  });
});

describe("the gate's lists own every look-under element", () => {
  test("the card and its pieces are content, never a plane press", () => {
    const classes = [
      "veil-lookunder",
      "veil-lookunder-name",
      "veil-lookunder-rename",
      "veil-lookunder-reason",
      "veil-lookunder-close",
    ];
    for (const name of classes) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(CONTENT_SELECTOR).toContain("." + name);
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
    }
    for (const name of classes) {
      expect(cardSource).toContain('className="' + name + '"');
    }
    expect(new Set(CONTENT_CLASSES).size).toBe(CONTENT_CLASSES.length);
    expect(new Set(WORD_CONTROL_CLASSES).size).toBe(WORD_CONTROL_CLASSES.length);
  });

  test("no veil look-under element starts a word gesture or a pan", () => {
    expect(rulesSource).toContain("export function lookUnderLive(level: Level): boolean");
    // The gate's armed modes are unchanged: the look-under is a transient, not
    // a new arm (no gesture mode was added for it).
    expect(source("../src/canvas/gates.ts")).not.toContain('"look-under"');
  });
});
