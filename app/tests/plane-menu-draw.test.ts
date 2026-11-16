import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MENU_BUBBLE_H,
  MENU_DOT,
  MENU_GAP,
  dotOffset,
  menuCluster,
  menuTransform,
  type MenuMembers,
} from "../src/canvas/planeMenuRules";
import {
  CONTENT_CLASSES,
  creationKinds,
  isGestureArmed,
  offeredCreationKinds,
  shouldCreate,
  shouldPan,
  shouldStartWordPress,
  type CreationKind,
} from "../src/canvas/gates";
import { LEVELS } from "../src/workspace/level";

/**
 * The DRAW choice on the double-click creation menu (added 2026-11-16 per user
 * review), automated.
 *
 * The review asked for the map's pen on the bubble cluster at the double-click
 * point. The decisions this file pins:
 *
 *   - the cluster paints WORD above the anchor dot and DRAW below it: two
 *     bubbles, SYMMETRIC about the dot, so the lift is zero — and the anchor
 *     invariant holds exactly: the dot's offset from the cluster's centre is the
 *     lift, and the lift rides inside the inverse-camera scale, so the dot marks
 *     the plane point at every zoom (not only at 100%);
 *   - "draw" is an ACTION, not a creation kind: gates.ts's grammar keeps its
 *     exact shape and no level offers it as a kind;
 *   - the press is a real button in the cluster (named, Tab-reachable), the
 *     cluster's press discipline still stops every press from reaching the
 *     plane, and Esc / click-away still dismiss;
 *   - the app's handler selects the PEN explicitly, runs the one cancel-pending
 *     path and arms the gate's \`draw\` mode — it never toggles, and while the pen
 *     is armed a double-click can open nothing, so the pen cannot double-arm.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const MENU = source("canvas/PlaneMenu.tsx");
const APP_SOURCE = source("App.tsx");
const RULES = source("canvas/planeMenuRules.ts");
const GATES = source("canvas/gates.ts");

/** The memberships the cluster can paint (the hidden kinds' flags can flip). */
const CASES: ReadonlyArray<[string, MenuMembers]> = [
  ["word + draw (the cluster now)", { word: true, lack: false, assumption: false, draw: true }],
  ["word alone (the first review's floor)", { word: true, lack: false, assumption: false, draw: false }],
  ["word + lack + draw (flags flipped)", { word: true, lack: true, assumption: false, draw: true }],
  [
    "word + lack + assumption + draw (flags flipped)",
    { word: true, lack: true, assumption: true, draw: true },
  ],
];

/** The translateY a transform string carries, in CSS px (minus the lift). */
function liftOf(transform: string): number {
  const at = transform.match(/translateY\((-?[\d.]+)px\)/);
  expect(at).not.toBeNull();
  return parseFloat(at![1]);
}

describe("the bubble cluster: word above the dot, draw below it", () => {
  test("the review's two choices are the cluster", () => {
    const cluster = menuCluster({
      word: true,
      lack: false,
      assumption: false,
      draw: true,
    });
    expect(cluster).toEqual({ above: 1, below: 1, total: 2, lift: 0 });
    expect(dotOffset(1, 1)).toBe(0);
  });

  test("the anchor dot stays EXACTLY on the plane point at every membership", () => {
    for (const [name, members] of CASES) {
      const cluster = menuCluster(members);
      // The column's whole height and the dot's centre, computed from the CSS
      // geometry independently of the rule under test.
      const height = cluster.total * (MENU_BUBBLE_H + MENU_GAP) + MENU_DOT;
      const dotCentre =
        cluster.above * (MENU_BUBBLE_H + MENU_GAP) + MENU_DOT / 2;
      expect({ name, offset: dotCentre - height / 2 }).toEqual({
        name,
        offset: cluster.lift,
      });
      // And the transform lifts by exactly that offset, INSIDE the inverse
      // camera scale, so the dot lands on the point — at 40% as at 250%.
      for (const zoom of [0.4, 1, 2.5]) {
        const transform = menuTransform(cluster.lift, zoom);
        expect({ name, zoom }).toEqual({ name, zoom });
        // The transform carries the lift NEGATED (the cluster moves up by it).
        expect(liftOf(transform)).toBe(cluster.lift === 0 ? 0 : -cluster.lift);
        expect(transform.indexOf("translateY")).toBeGreaterThan(
          transform.indexOf("scale("),
        );
      }
    }
  });

  test("the one-bubble floor is still the honest lift (19.5px)", () => {
    const alone = menuCluster({ word: true, lack: false, assumption: false, draw: false });
    expect(alone.total).toBe(1);
    expect(alone.lift).toBe((MENU_BUBBLE_H + MENU_GAP) / 2);
    expect(alone.lift).toBe(19.5);
  });

  test("the geometry is read from the CSS it mirrors", () => {
    const css = source("canvas/canvas.css");
    expect(css).toContain("gap: 9px;");
    expect(css).toContain(".plane-menu-dot {");
    expect(MENU_GAP).toBe(9);
    expect(MENU_DOT).toBe(6);
    // The bubble's box: 18px line + 2×5px padding + 2×1px border.
    expect(MENU_BUBBLE_H).toBe(18 + 10 + 2);
  });
});

describe("draw is an ACTION, never a creation kind", () => {
  test("the creation grammar keeps its exact shape", () => {
    for (const level of LEVELS) {
      expect(creationKinds(level)).not.toContain("draw" as CreationKind);
      expect(offeredCreationKinds(level)).not.toContain("draw" as CreationKind);
    }
    expect(creationKinds("concept")).toEqual(["word", "lack"]);
    expect(creationKinds("dynamics")).toEqual(["word", "lack", "assumption"]);
    expect(offeredCreationKinds("dynamics")).toEqual(["word"]);
    // The type itself is untouched: the grammar never learned "draw".
    expect(GATES).toContain(
      'export type CreationKind = "word" | "lack" | "assumption";',
    );
    // The rules module owns the bubble's geometry alone: it imports nothing and
    // names no kind, so the grammar cannot grow through it.
    expect(RULES).not.toMatch(/^import /m);
    expect(RULES).not.toContain("type CreationKind");
  });

  test("while the pen is armed creation suspends (no bubble can open, no double-arm)", () => {
    expect(isGestureArmed("draw")).toBe(true);
    expect(shouldCreate("draw")).toBe(false);
    expect(shouldPan("draw")).toBe(false);
    expect(shouldStartWordPress("draw", null)).toBe(false);
    // The plane asks the gate BEFORE it reports a double-click, and the pen's
    // capture surface physically eats the press: the menu cannot re-open under
    // the pen.
    expect(source("canvas/CanvasPlane.tsx")).toContain(
      "if (!shouldCreate(gestureMode)) return;",
    );
  });
});

describe("the bubble's markup and the cluster's press discipline", () => {
  test("a second quiet bubble, named for the keyboard, below the dot", () => {
    expect(MENU).toContain('className="plane-menu-option plane-menu-draw"');
    expect(MENU).toContain('aria-label="draw here"');
    expect(MENU).toContain('type="button"');
    expect(MENU).toContain("onClick={onDraw}");
    // The label a person reads: one word, the cluster's voice.
    expect(MENU).toMatch(/aria-label="draw here"[\s\S]*?>\s*draw\s*<\/button>/);
    // The cluster stays a labelled group of real buttons, the word above the
    // dot and the pen below it — never a div with a handler.
    expect(MENU).toContain('role="group"');
    expect(MENU).toContain('aria-label="create at this point"');
    const word = MENU.indexOf('aria-label="coin a word here"');
    const dot = MENU.indexOf('className="plane-menu-dot"');
    const draw = MENU.indexOf('className="plane-menu-option plane-menu-draw"');
    expect(word).toBeGreaterThan(-1);
    expect(dot).toBeGreaterThan(word);
    expect(draw).toBeGreaterThan(dot);
  });

  test("the press never pans nor counts as a plane press", () => {
    // The raw capture listener: no pan, no plane press count.
    expect(MENU).toContain('el.addEventListener("mousedown", stop)');
    expect(MENU).toContain("e.stopPropagation()");
    // The cluster is content to the gate, so its presses never fall through.
    expect(CONTENT_CLASSES).toContain("plane-menu");
    // Esc and the click-away dismissal are unchanged.
    expect(MENU).toContain('if (e.key !== "Escape") return;');
    expect(MENU).toContain('document.addEventListener("mousedown", onDown, true)');
    expect(MENU).toContain("onClose()");
  });

  test("the app's handler selects the pen, cancels, then arms — never toggles", () => {
    expect(APP_SOURCE).toContain("onDraw={chooseDraw}");
    const at = APP_SOURCE.indexOf("const chooseDraw = useCallback(");
    expect(at).toBeGreaterThan(-1);
    const end = APP_SOURCE.indexOf("}, [cancelPendingGestures]);", at);
    expect(end).toBeGreaterThan(at);
    const body = APP_SOURCE.slice(at, end);
    const pen = body.indexOf('setPenTool("pen")');
    const cancel = body.indexOf("cancelPendingGestures()");
    const arm = body.indexOf("setDrawArmed(true)");
    // The bubble says "draw", so the strip's PEN is the live tool …
    expect(pen).toBeGreaterThan(-1);
    // … the cluster dismisses through the one cancel-pending path …
    expect(cancel).toBeGreaterThan(pen);
    // … and the arm comes last (the cancel path puts the pen down first).
    expect(arm).toBeGreaterThan(cancel);
    // It ARMS: the bubble only exists while the plane is idle, so a toggle
    // could never be needed and a double-arm is impossible.
    expect(body).not.toContain("setDrawArmed(!");
    expect(body).not.toContain("drawArmed ?");
  });
});

describe("the negative space: the bubble announces nothing", () => {
  test("no count, score, streak, heat or progress vocabulary in what a person sees", () => {
    const FORBIDDEN =
      /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|queue|backlog|total|points)\b/i;
    const seen = [...MENU.matchAll(/(?:aria-label|title)="([^"]*)"/g)].map(
      (match) => match[1],
    );
    seen.push("word", "draw");
    expect(seen.length).toBeGreaterThan(2);
    for (const text of seen) {
      expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        text,
        found: null,
      });
    }
    // The handler's own comment-free body says nothing either.
    const at = APP_SOURCE.indexOf("const chooseDraw = useCallback(");
    const body = APP_SOURCE.slice(at, APP_SOURCE.indexOf("}, [cancelPendingGestures]);", at));
    expect(body).not.toMatch(/streak|\bscore\b|\bheat\b|\bprogress\b|\bcount\b/i);
  });
});
