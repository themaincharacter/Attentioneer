import { describe, expect, test } from "bun:test";
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
  type GestureMode,
} from "../src/canvas/gates";

/**
 * The interaction-mode gate, automated (ADR-0016 decision 4): while a gesture
 * is armed the plane's own gestures stand still — word press behaviors, pan and
 * creation — and idle restores every one of them. The gate is pure, so the
 * selector's suppression is asserted here instead of only in the window. The
 * look and the feel of the armed canvas remain the human check.
 */

/** A DOMTokenList stand-in (the handlers pass the real thing). */
const cl = (...names: string[]): ClassListLike => ({
  contains: (token: string) => names.includes(token),
});

const ARMED: GestureMode[] = ["selector", "path", "sign-choice"];

describe("idle is the plain Level 1 canvas", () => {
  test("idle restores word press, pan and creation", () => {
    expect(isGestureArmed("idle")).toBe(false);
    expect(shouldStartWordPress("idle", cl("word-name"))).toBe(true);
    expect(shouldStartWordPress("idle")).toBe(true);
    expect(shouldPan("idle")).toBe(true);
    expect(shouldCreate("idle")).toBe(true);
  });

  test("Level 1's content controls keep their own presses in idle", () => {
    for (const control of [
      "memory-dot",
      "connect-handle",
      "word-remove",
      "word-reject",
      "word-mark",
    ]) {
      expect(shouldStartWordPress("idle", cl(control))).toBe(false);
    }
  });
});

describe("an armed gesture suspends the plane's own gestures", () => {
  test("the selector suppresses word press, pan and creation", () => {
    expect(isGestureArmed("selector")).toBe(true);
    expect(shouldStartWordPress("selector", cl("word-name"))).toBe(false);
    expect(shouldPan("selector")).toBe(false);
    expect(shouldCreate("selector")).toBe(false);
  });

  test("the later modes suspend the same three (the seam is ready)", () => {
    for (const mode of ["path", "sign-choice"] as const) {
      expect(shouldStartWordPress(mode, cl("word-name"))).toBe(false);
      expect(shouldPan(mode)).toBe(false);
      expect(shouldCreate(mode)).toBe(false);
    }
  });

  test("every armed mode suppresses, so no mode is missing from the gate", () => {
    for (const mode of ARMED) {
      expect(shouldStartWordPress(mode, cl("word-name"))).toBe(false);
      expect(shouldPan(mode)).toBe(false);
      expect(shouldCreate(mode)).toBe(false);
    }
  });
});

describe("the content list", () => {
  test("words, wires, lacks, fields, the menu and the selector are content", () => {
    for (const classes of [
      ["word"],
      ["lack-mark"],
      ["distance-label"],
      ["distance-ring"],
      ["distance-coinfield"],
      ["grow-field"],
      ["plane-menu"],
      ["playing-set-word"],
    ]) {
      expect(isContentElement(cl(...classes))).toBe(true);
    }
  });

  test("the selector's elements are in the shared content selector", () => {
    expect(CONTENT_CLASSES).toContain("playing-set-word");
    expect(CONTENT_SELECTOR).toContain(".word");
    expect(CONTENT_SELECTOR).toContain(".playing-set-word");
    // The whole previous list survives (no Level 1 regression).
    for (const name of [
      "word",
      "lack-mark",
      "distance-label",
      "distance-ring",
      "distance-coinfield",
      "grow-field",
      "plane-menu",
    ]) {
      expect(CONTENT_SELECTOR).toContain(`.${name}`);
    }
  });

  test("the plain plane and an ordinary word span are not content elements", () => {
    expect(isContentElement(cl("plane"))).toBe(false);
    expect(isContentElement(cl("plane-inner"))).toBe(false);
    expect(isContentElement(cl("word-name"))).toBe(false);
    expect(isContentElement(cl())).toBe(false);
  });

  test("a selector element never starts a word press in idle either", () => {
    expect(shouldStartWordPress("idle", cl("playing-set-word"))).toBe(false);
    expect(shouldStartWordPress("idle", cl("playing-set"))).toBe(false);
  });
});

/**
 * Story 2's growth, automated: the signed link's elements and the sign choice
 * join BOTH lists — the plane's content list and the word handler's early-return
 * list (ADR-0016's rule: every new element joins both as it lands) — and the
 * pending sign choice arms the gate like the selector does. The double-click
 * creation menu cannot open while it is pending.
 */

describe("the signed link's elements are content and own their presses", () => {
  const LINK_ELEMENTS = [
    "link",
    "link-head",
    "link-mark",
    "link-sign",
    "link-unknown",
    "link-remove",
  ];

  test("each link element is a content element (never a plane gesture)", () => {
    for (const name of LINK_ELEMENTS) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(isContentElement(cl(name))).toBe(true);
      expect(CONTENT_SELECTOR).toContain(`.${name}`);
    }
  });

  test("the link head controls are in the word handler's early-return list", () => {
    for (const name of ["link-head", "link-mark", "link-sign", "link-unknown"]) {
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
      expect(shouldStartWordPress("idle", cl(name))).toBe(false);
    }
  });

  test("the sign choice is content and never falls through to a word", () => {
    for (const name of ["sign-choice", "sign-choice-option"]) {
      expect(isContentElement(cl(name))).toBe(true);
      expect(isWordControl(cl(name))).toBe(true);
      expect(shouldStartWordPress("idle", cl(name))).toBe(false);
    }
  });

  test("the sign choice's pending mode suspends word press, pan and creation", () => {
    expect(isGestureArmed("sign-choice")).toBe(true);
    expect(shouldStartWordPress("sign-choice", cl("word-name"))).toBe(false);
    expect(shouldStartWordPress("sign-choice", cl("sign-choice-option"))).toBe(false);
    expect(shouldPan("sign-choice")).toBe(false);
    // The double-click creation menu must NOT open behind a pending sign.
    expect(shouldCreate("sign-choice")).toBe(false);
  });
});

/**
 * Story 3's growth, automated: the loop's route and coined name, the
 * rename/coin field, the path-collection layer and the walk's read all join the
 * content list (and the route/name join the word handler's early-return list),
 * and the `path` arm suppresses the plane's own gestures exactly as the earlier
 * modes do (ADR-0016 decision 4).
 */
describe("the loop's elements are content and the path gate owns the pointer", () => {
  const LOOP_CONTENT = [
    "loop-route",
    "loop-route-hit",
    "loop-name",
    "loop-name-text",
    "loop-remove",
    "loop-coinfield",
    "loop-coinfield-input",
    "path-collect",
    "path-word",
    "path-bar",
    "walk",
    "walk-step",
    "walk-gap",
    "walk-verdict",
    "walk-close",
  ];

  test("each loop element is content (never a plane gesture)", () => {
    for (const name of LOOP_CONTENT) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(isContentElement(cl(name))).toBe(true);
      expect(CONTENT_SELECTOR).toContain(`.${name}`);
    }
  });

  test("the route, its name and their presses join the word handler's list", () => {
    for (const name of [
      "loop-route",
      "loop-route-hit",
      "loop-name",
      "loop-name-text",
      "loop-remove",
      "loop-coinfield",
      "loop-coinfield-input",
      "path-collect",
      "path-word",
      "walk",
    ]) {
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
      expect(shouldStartWordPress("idle", cl(name))).toBe(false);
    }
  });

  test("the path arm suspends word press, pan and creation", () => {
    expect(isGestureArmed("path")).toBe(true);
    expect(shouldStartWordPress("path", cl("word-name"))).toBe(false);
    expect(shouldPan("path")).toBe(false);
    // The creation ring menu must not open behind the path gesture.
    expect(shouldCreate("path")).toBe(false);
  });

  test("the earlier lists are untouched (no Level 1 regression)", () => {
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
    ]) {
      expect(CONTENT_SELECTOR).toContain(`.${name}`);
    }
  });
});
