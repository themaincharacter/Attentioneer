import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  CONTENT_CLASSES,
  CONTENT_SELECTOR,
  isContentElement,
  isGestureArmed,
  isWordControl,
  shouldCreate,
  shouldPan,
  shouldStartWordPress,
  WORD_CONTROL_CLASSES,
  type ClassListLike,
} from "../src/canvas/gates";
import {
  chooserFocusSelector,
  chooserLabel,
  focusAfterChooserClose,
  hasMarkedPointer,
  isPointerMarked,
  markedPointerKeys,
  pointerDraft,
  pointerFormTitle,
  pointerValuePlaceholder,
  POINTER_PICKS,
  POINTER_TRANSIENTS,
  transientsClosedByLevelSwitch,
} from "../src/canvas/pointerRules";
import { parseMarks, type Mark } from "../src/map/marks";
import type { Pointer } from "../src/map/pointers";

/**
 * Story-1 canvas rules, asserted without a DOM:
 *
 * - the reach handle and every element of the pointer chooser join BOTH gate
 *   lists (the plane's content list and the word handler's early-return list),
 *   and OPENING the chooser arms the gate in the `pointer` mode: word presses,
 *   pan and creation suspend while it is the only live surface;
 * - the add entry's form pick starts UNPICKED: no pick, no write (Enter with
 *   nothing chosen discards) — World B: the person picks the form;
 * - the ring cue is presence, not a count: byte-identical marked duplicates
 *   are one cue;
 * - a level switch closes every transient, and focus returns to the word on a
 *   dismissal, to the level control on a switch;
 * - rows carry NO open action in this story (story 2 adds it).
 */

const cl = (...names: string[]): ClassListLike => ({
  contains: (token: string) => names.includes(token),
});

/** Every element class the handle and the chooser render. */
const REACH_ELEMENTS = [
  "reach-handle",
  "pointer-chooser",
  "pointer-row",
  "pointer-form",
  "pointer-value",
  "pointer-input",
  "pointer-ring",
  "pointer-remove",
  "pointer-add",
  "pointer-add-hint",
  "pointer-picks",
  "pointer-pick",
  "pointer-add-input",
  "pointer-close",
];

function pointer(on: string, form: "path" | "at" | "url", value: string): Pointer {
  return { on, form, value, extra: {} };
}

function openPointerMark(on: string, form: "path" | "at" | "url", value: string): Mark {
  return { kind: "open", target: { type: "pointer", on, form, value }, extra: {} };
}

describe("the reach handle and the chooser join both gate lists", () => {
  test("each reach element is content (never a plane gesture)", () => {
    for (const name of REACH_ELEMENTS) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(isContentElement(cl(name))).toBe(true);
      expect(CONTENT_SELECTOR).toContain("." + name);
    }
  });

  test("each reach element owns its press, never a word gesture", () => {
    for (const name of REACH_ELEMENTS) {
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
      expect(isWordControl(cl(name))).toBe(true);
      expect(shouldStartWordPress("idle", cl(name))).toBe(false);
    }
  });

  test("opening the chooser arms the gate: press, pan and creation suspend", () => {
    expect(isGestureArmed("pointer")).toBe(true);
    expect(shouldStartWordPress("pointer", cl("word-name"))).toBe(false);
    expect(shouldPan("pointer")).toBe(false);
    expect(shouldCreate("pointer")).toBe(false);
    // Idle restores all three, so closing the chooser returns the plain canvas.
    expect(isGestureArmed("idle")).toBe(false);
    expect(shouldStartWordPress("idle", cl("word-name"))).toBe(true);
    expect(shouldPan("idle")).toBe(true);
    expect(shouldCreate("idle")).toBe(true);
  });

  test("the earlier lists are untouched (no Level 1/2 regression)", () => {
    // Every earlier content element is still content on the plane.
    for (const name of [
      "word",
      "lack-mark",
      "distance-label",
      "distance-coinfield",
      "grow-field",
      "plane-menu",
      "playing-set-word",
      "link",
      "link-head",
      "sign-choice",
      "loop-route",
      "loop-name",
      "walk",
      "assumption-diamond",
      "assumption-overlay",
    ]) {
      expect(CONTENT_SELECTOR).toContain("." + name);
      expect(isContentElement(cl(name))).toBe(true);
    }
    // The interactive ones are still in the word handler's early-return list.
    for (const name of [
      "playing-set-word",
      "link",
      "link-head",
      "sign-choice",
      "loop-route",
      "loop-name",
      "walk",
      "assumption-diamond",
      "assumption-overlay",
    ]) {
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
      expect(shouldStartWordPress("idle", cl(name))).toBe(false);
    }
  });

  test("no class is listed twice in either gate list", () => {
    expect(new Set(CONTENT_CLASSES).size).toBe(CONTENT_CLASSES.length);
    expect(new Set(WORD_CONTROL_CLASSES).size).toBe(WORD_CONTROL_CLASSES.length);
  });
});

describe("the add entry: no pick, no write", () => {
  test("the form pick starts unpicked and offers the three authored forms", () => {
    expect(POINTER_PICKS).toEqual(["path", "at", "url"]);
    expect(pointerDraft(null, "notes/x.md")).toBeNull();
    expect(pointerDraft(null, "")).toBeNull();
  });

  test("a pick with a value commits the value verbatim", () => {
    expect(pointerDraft("path", "notes/x.md")).toEqual({
      form: "path",
      value: "notes/x.md",
    });
    // Nothing is trimmed into shape or classified: the string is the person's.
    expect(pointerDraft("at", "  /home/k/x.md  ")).toEqual({
      form: "at",
      value: "  /home/k/x.md  ",
    });
    // A target that looks like another form is still the picked form.
    expect(pointerDraft("path", "/etc/hosts")!.form).toBe("path");
    expect(pointerDraft("url", "notes/x.md")!.form).toBe("url");
  });

  test("a blank value writes nothing (Enter discards)", () => {
    expect(pointerDraft("url", "")).toBeNull();
    expect(pointerDraft("url", "   ")).toBeNull();
  });

  test("each form has its own quiet hint and placeholder", () => {
    const placeholders = POINTER_PICKS.map(pointerValuePlaceholder);
    expect(new Set(placeholders).size).toBe(3);
    expect(pointerFormTitle("at")).toContain("machine-local");
    expect(pointerFormTitle("url")).toContain("verbatim");
    expect(pointerFormTitle("path")).toContain("workspace");
  });
});

describe("the ring cue is presence, not a count", () => {
  test("markedPointerKeys keeps one key for byte-identical duplicates", () => {
    const line = '{"kind":"open","on":"rain","url":"https://x"}';
    const parsed = parseMarks(line + "\n" + line);
    const keys = markedPointerKeys(parsed.marks);
    expect(keys.size).toBe(1);
    expect(hasMarkedPointer([pointer("rain", "url", "https://x")], keys, "rain")).toBe(
      true,
    );
    expect(hasMarkedPointer([pointer("rain", "url", "https://x")], keys, "soil")).toBe(
      false,
    );
  });

  test("one cue for the word however many of its lines are marked", () => {
    const pointers = [
      pointer("rain", "path", "notes/a.md"),
      pointer("rain", "url", "https://x"),
    ];
    const keys = markedPointerKeys([
      openPointerMark("rain", "path", "notes/a.md"),
      openPointerMark("rain", "url", "https://x"),
    ]);
    expect(keys.size).toBe(2);
    // The handle's cue is a boolean: presence, never a tally.
    expect(hasMarkedPointer(pointers, keys, "rain")).toBe(true);
    expect(hasMarkedPointer([], keys, "rain")).toBe(false);
  });

  test("only OPEN pointer marks count; other kinds and targets never do", () => {
    const keys = markedPointerKeys([
      { kind: "later", target: { type: "pointer", on: "rain", form: "path", value: "x" }, extra: {} },
      { kind: "open", target: { type: "word", slug: "rain" }, extra: {} },
      openPointerMark("rain", "path", "notes/a.md"),
    ]);
    expect(keys.size).toBe(1);
    expect(
      isPointerMarked(pointer("rain", "path", "notes/a.md"), keys),
    ).toBe(true);
    expect(isPointerMarked(pointer("rain", "path", "notes/b.md"), keys)).toBe(
      false,
    );
  });
});

describe("closing: transients and focus", () => {
  test("a level switch closes the chooser and every field inside it", () => {
    expect(transientsClosedByLevelSwitch()).toEqual([
      "chooser",
      "add-field",
      "edit-field",
    ]);
    expect(POINTER_TRANSIENTS).toHaveLength(3);
  });

  test("focus returns to the word on a dismissal, the level button on a switch", () => {
    expect(focusAfterChooserClose("dismiss")).toBe("word");
    expect(focusAfterChooserClose("switch-level")).toBe("level");
    expect(chooserFocusSelector("word", "rain")).toBe(
      '.word[data-slug="rain"] .reach-handle',
    );
    expect(chooserFocusSelector("level")).toBe(
      ".level-control .level-game.active",
    );
    // A word without a slug can never be a focus target; the level stands in.
    expect(chooserFocusSelector("word", null)).toBe(
      ".level-control .level-game.active",
    );
    expect(chooserFocusSelector("word", "")).toBe(
      ".level-control .level-game.active",
    );
    expect(chooserLabel("rain")).toContain("rain");
  });

  test("the chooser's own source carries no open action (story 2's addition)", () => {
    const source = readFileSync(
      new URL("../src/canvas/PointerChooser.tsx", import.meta.url),
      "utf8",
    );
    // Rows have a ring, an edit and a remove — and no open/launch control.
    expect(source).not.toContain("onOpen");
    expect(source).not.toContain("pointer-open");
    expect(source).not.toContain("<a ");
    expect(source).not.toContain("href=");
    // The form pick is initialized UNPICKED (no default authored form).
    expect(source).toContain("useState<PointerForm | null>(null)");
    expect(source).toContain("pointerDraft(");
  });
});

describe("the handle's fixed slot (the word box never grows)", () => {
  const wordSource = readFileSync(
    new URL("../src/canvas/ReferenceWord.tsx", import.meta.url),
    "utf8",
  );
  const css = readFileSync(
    new URL("../src/canvas/canvas.css", import.meta.url),
    "utf8",
  );

  test("the handle renders whenever the game shows it, never on hover state", () => {
    // No hover-dependent render: hover only changes CSS, so the row's box is
    // the same before, during and after the affordance appears.
    expect(wordSource).toContain("{showReach && onOpenPointers && !renaming && (");
    expect(wordSource).not.toContain("showReach && hover");
    expect(wordSource).toContain('className={"reach-handle"');
  });

  test("CSS reveals it on hover, keyboard focus and while focused", () => {
    expect(css).toContain(".word:hover .reach-handle");
    expect(css).toContain(".word:focus-within .reach-handle");
    expect(css).toContain(".reach-handle:focus");
    expect(css).toContain(".reach-handle.marked::after");
    // The reduced-motion rule is global and collapses the quiet transitions.
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});
