import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CONTENT_CLASSES, WORD_CONTROL_CLASSES } from "../src/canvas/gates";
import {
  CHANGE_WORDS,
  CONTACT_WORDS,
  EXPLANATION_LABEL,
  EXPLANATION_PLACEHOLDER,
  NO_MOVE_YET,
  NOT_LOGGED,
  NOT_SAVED,
  OUTCOME_WORDS,
  PRISM_TOOLTIP,
  boundsWords,
  changeDetail,
  changeOutcome,
  changeWord,
  contactWord,
  decodeWords,
  factsWords,
  mtimeWords,
  prismLabel,
} from "../src/canvas/prismRules";
import { pointerKey } from "../src/map/pointers";
import type { Prism, ReadHeadChange } from "../src/map/prisms";

/**
 * Epic 12 story 2 — the PRISM window, automated.
 *
 * The window shows ONE Move: the contact kind on its header, the pointer's
 * identity, the read-only Change log (exact bounds, decode, declared facts)
 * and the person's explanation in the one quiet field. It never shows world
 * bytes, never counts, and never lists the series. These tests assert the
 * display words exactly (no rounding, no summary), the component's structure
 * by source scan, the gate lists, and the CSS idiom.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The body without its import statements (import paths are not data). */
function bodyOnly(text: string): string {
  return codeOnly(text).replace(/import[\s\S]*?from\s+"[^"]+";/g, "");
}

function readHead(over: Partial<ReadHeadChange> = {}): ReadHeadChange {
  return {
    kind: "read-head",
    pointer: pointerKey("rain", "path", "notes/x.md"),
    outcome: "read",
    bounds: { maxLines: 20, maxBytes: 1600 },
    decode: "clean",
    ...over,
  };
}

function prismOf(over: Partial<Prism> = {}): Prism {
  return {
    id: "prism-1",
    on: "rain",
    contact: "look",
    pointer: { form: "path", value: "notes/x.md" },
    changes: [readHead()],
    explanation: "",
    extra: {},
    ...over,
  };
}

/** A CSS rule's body, for the window's reading-surface rules. */
function ruleBody(css: string, selector: string): string {
  const start = css.indexOf(selector + " {");
  if (start === -1) return "";
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return close === -1 ? "" : css.slice(open + 1, close);
}

const component = source("canvas/PrismWindow.tsx");
const componentCode = codeOnly(component);
const rules = source("canvas/prismRules.ts");
const css = source("canvas/canvas.css");
const chooser = source("canvas/PointerChooser.tsx");

describe("the window's words: the contact on the header, the exact facts", () => {
  test("the four contact words and the Change words are quiet and plain", () => {
    expect(CONTACT_WORDS).toEqual({
      look: "look",
      make: "make",
      measure: "measure",
      ask: "ask",
    });
    for (const contact of ["look", "make", "measure", "ask"] as const) {
      expect(contactWord(contact)).toBe(contact);
    }
    expect(CHANGE_WORDS["read-head"]).toBe("head read");
    expect(changeWord(readHead())).toBe("head read");
    expect(PRISM_TOOLTIP).toContain("one move");
  });

  test("the outcomes are said in words, never as a code", () => {
    expect(changeOutcome(readHead())).toBe("read");
    expect(changeOutcome(readHead({ outcome: "not-text", decode: null }))).toBe(
      "not text",
    );
    expect(
      changeOutcome(readHead({ outcome: "cannot-reach", decode: null })),
    ).toBe("cannot reach");
    expect(changeOutcome(readHead({ outcome: "escaped", decode: null }))).toBe(
      "escaped the workspace",
    );
    for (const outcome of ["handed", "handoff-failed", "refused", "minted", "written", "answered", "no-response"]) {
      expect(typeof OUTCOME_WORDS[outcome]).toBe("string");
    }
  });

  test("the aria label names the contact kind and the coined word", () => {
    const label = prismLabel("rain", prismOf());
    expect(label).toContain("the PRISM of a look");
    expect(label).toContain("rain");
    expect(prismLabel("rain", null)).toContain("PRISM log");
    expect(prismLabel("rain", null)).toContain("rain");
    expect(
      prismLabel("rain", prismOf({ contact: "measure" })),
    ).toContain("the PRISM of a measure");
  });

  test("the bounds are exact integers, never a rounded or formatted size", () => {
    expect(boundsWords({ maxLines: 20, maxBytes: 1600 })).toBe(
      "bounds: 20 lines, 1600 bytes",
    );
    expect(boundsWords({ maxLines: 1, maxBytes: 2 })).toBe(
      "bounds: 1 lines, 2 bytes",
    );
    // The exact declared facts: 1234 is 1234 bytes, never "1.2 kB".
    const facts = factsWords({
      maxLines: 20,
      maxBytes: 1600,
      size: 1234,
      mtime: 0,
    });
    expect(facts).toBe(
      "size 1234 bytes · modified 1970-01-01T00:00:00.000Z",
    );
    expect(facts).not.toContain("kB");
    expect(factsWords({ maxLines: 0, maxBytes: 0 })).toBe("");
  });

  test("the mtime is the full declared instant, or the exact milliseconds", () => {
    const when = 1763000000123;
    expect(mtimeWords(when)).toBe(
      "modified " + new Date(when).toISOString(),
    );
    expect(mtimeWords(when)).toContain(".123Z");
    expect(mtimeWords(null)).toBe("modified unknown");
    expect(mtimeWords(undefined)).toBe("modified unknown");
    expect(factsWords({ size: null, mtime: null })).toBe(
      "size unknown · modified unknown",
    );
  });

  test("the decode is said; a refusal decoded nothing (no decode word)", () => {
    expect(decodeWords("clean")).toBe("decoded clean");
    expect(decodeWords("with-replacement")).toBe("decoded with replacement");
    expect(decodeWords(null)).toBe("");
  });

  test("the read-head detail is bounds + decode + declared facts", () => {
    expect(changeDetail(readHead())).toBe(
      "bounds: 20 lines, 1600 bytes · decoded clean",
    );
    expect(
      changeDetail(
        readHead({
          bounds: {
            maxLines: 20,
            maxBytes: 1600,
            size: 7,
            mtime: 0,
          },
        }),
      ),
    ).toBe(
      "bounds: 20 lines, 1600 bytes · decoded clean · size 7 bytes · modified 1970-01-01T00:00:00.000Z",
    );
    // A refusal has no decode word and no facts.
    expect(changeDetail(readHead({ outcome: "not-text", decode: null }))).toBe(
      "bounds: 20 lines, 1600 bytes",
    );
    // The other Change kinds' flows are the egress story's: a quiet line.
    expect(changeDetail({ kind: "mint-pointer", target: "t", outcome: "minted" })).toBe("");
  });
});

describe("the window component: ONE Move, a read-only log, one field", () => {
  test("the prop is ONE Prism or null — never a list or a gallery", () => {
    expect(componentCode).toContain("prism: Prism | null");
    expect(componentCode).not.toMatch(/Prism\[\]/);
    expect(bodyOnly(component)).not.toContain("prisms");
    expect(componentCode).not.toContain("loadPrisms");
    expect(componentCode).not.toContain("latestPrism");
    // The one log list is the Move's own Changes (one Prism's changes).
    expect(componentCode).toContain(
      "const changes = prism?.changes ?? [];",
    );
    expect(componentCode.match(/changes\.map\(/g)?.length).toBe(1);
    expect(componentCode).toContain("prism === null");
  });

  test("the changes ARE the log: no edit, no remove, no content", () => {
    // The read-only log region says so.
    expect(component).toContain('aria-label="the log — read-only"');
    // No world bytes ever ride: the window imports no read bridge at all.
    expect(componentCode).not.toContain("readTextHead");
    expect(componentCode).not.toContain("readTextFile");
    expect(componentCode).not.toContain("writeTextFile");
    expect(componentCode).not.toContain("lib/fs");
    expect(componentCode).not.toContain("@tauri-apps");
    // One editable surface only: the explanation textarea.
    expect(componentCode.match(/<textarea/g)?.length).toBe(1);
    expect(componentCode).not.toContain("<input");
    expect(componentCode).not.toContain("contentEditable");
    expect(componentCode.match(/onChange=/g)?.length).toBe(1);
    // One button: the quiet close. The log offers no remove or edit verb.
    expect(componentCode.match(/<button/g)?.length).toBe(1);
    expect(componentCode).not.toContain("onRemove");
    expect(componentCode).not.toContain("onEdit");
  });

  test("the explanation is the person's own quiet field, saved on blur/close", () => {
    expect(componentCode).toContain("aria-label={EXPLANATION_LABEL}");
    expect(componentCode).toContain("placeholder={EXPLANATION_PLACEHOLDER}");
    expect(EXPLANATION_LABEL).toContain("yours");
    expect(EXPLANATION_PLACEHOLDER).toContain("yours");
    expect(componentCode).toContain("onBlur={() => void saveExplanation()}");
    expect(componentCode).toContain("void saveExplanation();");
    // Failed saves are honest and quiet.
    expect(componentCode).toContain("NOT_SAVED");
    expect(NOT_SAVED).toBe("not saved");
    expect(NO_MOVE_YET).toBe("no move on this reach yet");
    expect(NOT_LOGGED).toContain("could not be written");
  });

  test("the window is the outward window's idiom (focus, Esc, press-away, clamp)", () => {
    expect(componentCode).toContain("clampPeekAnchor");
    expect(componentCode).toContain("1 / camera.zoom");
    expect(componentCode).toContain('e.key !== "Escape"');
    expect(componentCode).toContain('document.addEventListener("mousedown", onDown, true)');
    expect(componentCode).toContain("rootRef.current?.focus()");
    expect(componentCode).toContain("tabIndex={-1}");
    expect(componentCode).toContain('role="group"');
    expect(componentCode).toContain("onClose()");
  });

  test("the rules never see an array of PRISMs", () => {
    const rulesCode = bodyOnly(rules);
    expect(rulesCode).not.toContain("Prism[]");
    expect(rulesCode).not.toContain("prisms");
    // No counting, summing or averaging words in the window's words.
    for (const word of ["count", "total", "average", "sum", "score", "tally"]) {
      expect(rulesCode.toLowerCase()).not.toContain(word);
    }
  });
});

describe("the class lists and the CSS idiom", () => {
  const PRISM_CLASSES = [
    "prism-window",
    "prism-header",
    "prism-contact",
    "prism-name",
    "prism-pointer",
    "prism-changes",
    "prism-change",
    "prism-change-kind",
    "prism-change-outcome",
    "prism-detail",
    "prism-explanation",
    "prism-note",
    "prism-close",
  ];
  const CONTACT_BUTTON_CLASSES = ["pointer-look", "pointer-measure", "pointer-log"];

  test("every new class joins BOTH gate lists (the ADR-0016 rule)", () => {
    for (const name of [...PRISM_CLASSES, ...CONTACT_BUTTON_CLASSES]) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
    }
    expect(new Set(CONTENT_CLASSES).size).toBe(CONTENT_CLASSES.length);
    expect(new Set(WORD_CONTROL_CLASSES).size).toBe(WORD_CONTROL_CLASSES.length);
  });

  test("the component and the chooser carry their classes", () => {
    for (const name of PRISM_CLASSES) {
      expect(component).toContain(name);
      expect(css).toContain("." + name);
    }
    for (const name of CONTACT_BUTTON_CLASSES) {
      expect(chooser).toContain(name);
      expect(css).toContain("." + name);
    }
  });

  test("the CSS keeps the window in place, the armed gesture above, and the field selectable", () => {
    const windowBody = ruleBody(css, ".prism-window");
    expect(windowBody).toContain("position: absolute");
    expect(windowBody).toContain("user-select: none");
    const explanationBody = ruleBody(css, ".prism-explanation");
    expect(explanationBody).toContain("user-select: text");
    expect(css).toContain(".plane.gesture-armed .prism-window");
    // The window is never draggable or resizable.
    expect(windowBody).not.toContain("resize");
  });
});
