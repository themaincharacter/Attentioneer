import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  GROUND_DRAG_THRESHOLD,
  attachGroundCardDrag,
  pressingThisStartsADrag,
} from "../src/canvas/groundDrag";
import { renderedMapContent } from "../src/canvas/mapContentRules";

/**
 * STORY 16.32 — IN AN EXPANDED CARD, SELECTION WINS; EVERYWHERE ELSE, DRAG DOES.
 *
 * The user's ruling: "prioritize drag unless a card is expanded then prioritize
 * selection inside that expanded card." Two gestures had wanted the same press
 * since 16.25 moved the drag onto the card and 16.31 stopped clearing the
 * browser's selection, so this file pins the ONE predicate that decides, the
 * place the shared wiring asks it, and the three families' identical answer.
 *
 * It cannot mount React (this repo's tests have no DOM), so the rule is proved
 * twice: at the pure seam (the predicate's table, and the REAL helper driven
 * through a fake element and a fake window) and at the source seam (the cards
 * hand in their own open state, the helper bails before taking the pointer, and
 * the selection capture is untouched).
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const LAYER = source("canvas/GroundLayer.tsx");
const ASK_CARD = source("canvas/AskCard.tsx");
const SESSION_CARD = source("canvas/SessionCard.tsx");
const DRAG = source("canvas/groundDrag.ts");
const PILL = source("canvas/CardNamePill.tsx");
const CSS = source("canvas/canvas.css");

/** The three card families are peers: one press rule, never a variant. */
const FAMILIES = [
  ["reference", LAYER],
  ["ask", ASK_CARD],
  ["session", SESSION_CARD],
] as const;

/**
 * The drag helper's live listeners sit on `window`. A handler only needs
 * add/remove and a way to fire, so this is a listener table, not a DOM.
 */
const windowListeners = new Map<string, Set<(event: unknown) => void>>();
const realWindow = (globalThis as { window?: unknown }).window;

beforeAll(() => {
  (globalThis as { window?: unknown }).window = {
    addEventListener: (kind: string, fn: (event: unknown) => void) => {
      if (!windowListeners.has(kind)) windowListeners.set(kind, new Set());
      windowListeners.get(kind)?.add(fn);
    },
    removeEventListener: (kind: string, fn: (event: unknown) => void) => {
      windowListeners.get(kind)?.delete(fn);
    },
  };
});

beforeEach(() => {
  windowListeners.clear();
});

afterAll(() => {
  (globalThis as { window?: unknown }).window = realWindow;
  windowListeners.clear();
});

function listenerCount(kind: string): number {
  return windowListeners.get(kind)?.size ?? 0;
}

function fireWindow(kind: string, event: unknown): void {
  for (const fn of [...(windowListeners.get(kind) ?? [])]) fn(event);
}

/** What a press landed on: the selectors its target answers to. */
type Hits = (selector: string) => object | null;

const BODY: Hits = () => null;
const PILL_HIT: Hits = (selector) =>
  selector === ".ground-pill" ? {} : null;
const READING_HIT: Hits = (selector) =>
  selector === ".ground-reading" ? {} : null;

/** One card element as far as the drag wiring can tell. */
class FakeCard {
  private readonly handlers = new Map<
    string,
    Set<(event: unknown) => void>
  >();

  addEventListener(kind: string, fn: (event: unknown) => void): void {
    if (!this.handlers.has(kind)) this.handlers.set(kind, new Set());
    this.handlers.get(kind)?.add(fn);
  }

  removeEventListener(kind: string, fn: (event: unknown) => void): void {
    this.handlers.get(kind)?.delete(fn);
  }

  press(hits: Hits): void {
    const event = {
      button: 0,
      clientX: 0,
      clientY: 0,
      target: { closest: hits },
      stopPropagation: () => {},
    };
    for (const fn of [...(this.handlers.get("mousedown") ?? [])]) fn(event);
  }
}

/**
 * Drive one press through the REAL helper with the given card facts, then move
 * the pointer far enough to cross any threshold and let go. Returns what the
 * hand produced: preview frames, drops and the card's door.
 */
function pressAndDrag(expanded: boolean, hits: Hits) {
  const el = new FakeCard();
  let frames = 0;
  let drops = 0;
  let clicks = 0;
  const cleanup = attachGroundCardDrag(el as unknown as HTMLElement, {
    at: () => ({ x: 10, y: 20 }),
    zoom: () => 1,
    expanded: () => expanded,
    onPreview: (at) => {
      if (at !== null) frames += 1;
    },
    onDrop: () => {
      drops += 1;
    },
    onClick: () => {
      clicks += 1;
    },
  });
  el.press(hits);
  const captured = listenerCount("mousemove") + listenerCount("mouseup");
  fireWindow("mousemove", { clientX: 120, clientY: 80 });
  fireWindow("mouseup", {});
  cleanup();
  return { frames, drops, clicks, captured };
}

describe("the one predicate: who gets the press (the user's ruling)", () => {
  test("collapsed: the body and the pill both drag", () => {
    expect(pressingThisStartsADrag({ expanded: false, onPill: false })).toBe(true);
    expect(pressingThisStartsADrag({ expanded: false, onPill: true })).toBe(true);
  });

  test("expanded: the body selects, the pill still drags", () => {
    expect(pressingThisStartsADrag({ expanded: true, onPill: false })).toBe(false);
    expect(pressingThisStartsADrag({ expanded: true, onPill: true })).toBe(true);
  });

  test("it is pure and family-blind: no card kind is a fact it reads", () => {
    const start = DRAG.indexOf("export function pressingThisStartsADrag(");
    const body = DRAG.slice(start, DRAG.indexOf("\n}", start) + 2);
    expect(body).toContain("facts.expanded");
    expect(body).toContain("facts.onPill");
    expect(body).not.toMatch(/ask|session|reference/i);
  });
});

describe("the three families answer the press the same way", () => {
  for (const [family, card] of FAMILIES) {
    test(`${family}: expanded body = false, expanded pill = true, collapsed = true`, () => {
      // The table is the same for every family because it is the same function;
      // each family's only job is to hand in its own open state.
      expect(pressingThisStartsADrag({ expanded: false, onPill: false })).toBe(true);
      expect(pressingThisStartsADrag({ expanded: false, onPill: true })).toBe(true);
      expect(pressingThisStartsADrag({ expanded: true, onPill: true })).toBe(true);
      expect(pressingThisStartsADrag({ expanded: true, onPill: false })).toBe(false);
      // ONE attach call, given the card's own view state, in every family.
      expect(card.split("attachGroundCardDrag(").length - 1).toBe(1);
      expect(card).toContain("expanded: () => open");
      // The pill is the handle in every state, and it is the same pill.
      expect(card).toContain("CardNamePill");
      expect(PILL).toContain('className="ground-pill"');
    });
  }
});

describe("a press the rule does not own never reaches the pointer", () => {
  test("collapsed body drags: the helper takes the press and drops once", () => {
    const measured = pressAndDrag(false, BODY);
    expect(measured.captured).toBe(2);
    expect(measured.frames).toBe(1);
    expect(measured.drops).toBe(1);
    expect(measured.clicks).toBe(0);
  });

  test("collapsed pill drags by the same press", () => {
    const measured = pressAndDrag(false, PILL_HIT);
    expect(measured.drops).toBe(1);
  });

  test("expanded BODY starts no drag at all: no listener, no frame, no drop", () => {
    const measured = pressAndDrag(true, BODY);
    // Nothing was captured: selection and scrolling are left to the browser.
    expect(measured.captured).toBe(0);
    expect(measured.frames).toBe(0);
    expect(measured.drops).toBe(0);
    // It is not the card's door either: the card is already open, and a press
    // there is a selection beginning.
    expect(measured.clicks).toBe(0);
  });

  test("expanded READING starts no drag: the reading is not a drag surface", () => {
    const measured = pressAndDrag(true, READING_HIT);
    expect(measured.captured).toBe(0);
    expect(measured.frames).toBe(0);
    expect(measured.drops).toBe(0);
  });

  test("expanded PILL still drags: the handle survives the open face", () => {
    const measured = pressAndDrag(true, PILL_HIT);
    expect(measured.captured).toBe(2);
    expect(measured.drops).toBe(1);
  });
});

describe("the helper asks the predicate BEFORE it takes the pointer", () => {
  const start = DRAG.indexOf("function handleMouseDown");
  const handler = DRAG.slice(
    start,
    DRAG.indexOf('el.addEventListener("mousedown", handleMouseDown)', start),
  );
  const askAt = handler.indexOf("pressingThisStartsADrag(");
  const beginAt = handler.indexOf("let drag = beginGroundDrag(");
  const listenAt = handler.indexOf('window.addEventListener("mousemove"');

  test("predicate -> begin -> listeners, in that order", () => {
    expect(askAt).toBeGreaterThan(-1);
    expect(askAt).toBeLessThan(beginAt);
    expect(beginAt).toBeLessThan(listenAt);
  });

  test("the bail returns before any capture, and touches nothing else", () => {
    const bail = handler.slice(askAt, beginAt);
    expect(bail).toContain("return;");
    // No default is prevented here: the browser's selection is not ours to stop.
    expect(handler).not.toMatch(/\.preventDefault\(/);
    // Wheel scrolling is never the drag's: the reading keeps its own scroll.
    expect(DRAG).not.toContain("wheel");
    expect(LAYER).toContain(
      'el.addEventListener("wheel", onWheel, { passive: true })',
    );
  });

  test("the old per-caller reading exclusion is gone (one rule, one place)", () => {
    expect(DRAG).not.toContain("ignores");
    for (const [, card] of FAMILIES) expect(card).not.toContain("ignores:");
  });

  test("the link handle is still its own gesture, handled first", () => {
    const linkAt = handler.indexOf(".ground-link-handle");
    expect(linkAt).toBeGreaterThan(-1);
    expect(linkAt).toBeLessThan(askAt);
    expect(LAYER).toContain("startGroundLinkDrag(");
  });
});

describe("nothing else about the drag changed", () => {
  test("the one shared threshold is still the one shared constant", () => {
    expect(GROUND_DRAG_THRESHOLD).toBe(4);
    expect(DRAG.split("GROUND_DRAG_THRESHOLD =").length - 1).toBe(1);
    // The helper still passes the DEFAULT threshold, never a restated number.
    expect(DRAG).toContain(
      "moveGroundDrag(drag, { x: ev.clientX, y: ev.clientY })",
    );
    for (const [, card] of FAMILIES) {
      expect(card).not.toContain("GROUND_DRAG_THRESHOLD");
    }
  });

  test("the ground map still renders no concept family and no counters", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

/**
 * STORY 22.7 — THE SURFACE SIDE OF THE SAME PRESS RULE. 16.32 says who OWNS the
 * press; this says the collapsed face may therefore never BEGIN a selection.
 * The rule and its assertion live here, beside the predicate, so the two halves
 * of "the drag owns a collapsed press" stay read together.
 */
describe("a collapsed face never begins a selection", () => {
  test("the collapsed body carries no-select, prefixed for the WebKit window", () => {
    expect(CSS).toMatch(
      /\.ground-body-collapsed \{[^}]*user-select: none;[^}]*\}/s,
    );
    expect(CSS).toMatch(
      /\.ground-body-collapsed \{[^}]*-webkit-user-select: none;[^}]*\}/s,
    );
    // The SAME open state the predicate reads chooses the class: only a
    // collapsed card wears it.
    expect(LAYER).toContain('open ? "" : " ground-body-collapsed"');
  });

  test("the expanded reading still selects — 16.31 and 16.32 untouched", () => {
    expect(CSS).toMatch(
      /\.ground-reference\.expanded \.ground-body \.ground-reading \{[^}]*user-select: text;/s,
    );
    // The no-select rule names the collapsed body alone; the expanded face
    // carries no no-select rule of its own.
    expect(CSS).not.toMatch(
      /\.ground-reference\.expanded[^{}]*\{[^}]*user-select: none;/s,
    );
  });
});
