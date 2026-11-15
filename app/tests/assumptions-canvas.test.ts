import { describe, expect, test } from "bun:test";
import {
  addAssumption,
  assumptionTargetKey,
  parseAssumptions,
  serializeAssumptions,
  targetsWithAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "../src/map/assumptions";
import {
  CONTENT_CLASSES,
  CONTENT_SELECTOR,
  creationKinds,
  isContentElement,
  isWordControl,
  shouldCreate,
  shouldPan,
  shouldStartWordPress,
  WORD_CONTROL_CLASSES,
  type ClassListLike,
} from "../src/canvas/gates";

/**
 * Story-4 canvas rules, asserted without a DOM:
 *
 * - the hollow diamond and its quiet overlay join BOTH gate lists (the plane's
 *   content list and the word handler's early-return list), so a press on
 *   either is never a pan, never a creation and never a word gesture;
 * - one diamond per target: several claims on a target are one presence;
 * - the Level 2 double-click ring menu gains `assumption` as its THIRD kind
 *   (ADR-0011's open decision), which states a claim about the bare spot, and
 *   Level 1's menu is exactly the word/lack pair it always was.
 */

const cl = (...names: string[]): ClassListLike => ({
  contains: (token: string) => names.includes(token),
});

const word = (slug: string): AssumptionTarget => ({ type: "word", slug });
const spot = (x: number, y: number): AssumptionTarget => ({ type: "spot", x, y });

/** Every element class story 4 renders (diamond, spot, overlay and its parts). */
const ASSUMPTION_ELEMENTS = [
  "assumption-diamond",
  "assumption-spot",
  "assumption-overlay",
  "assumption-line",
  "assumption-text",
  "assumption-input",
  "assumption-remove",
  "assumption-close",
];

describe("the diamond and overlay join both gate lists", () => {
  test("each assumption element is content (never a plane gesture)", () => {
    for (const name of ASSUMPTION_ELEMENTS) {
      expect(CONTENT_CLASSES).toContain(name as never);
      expect(isContentElement(cl(name))).toBe(true);
      expect(CONTENT_SELECTOR).toContain(`.${name}`);
    }
  });

  test("a press on the diamond or overlay never starts a word gesture", () => {
    for (const name of ASSUMPTION_ELEMENTS) {
      expect(WORD_CONTROL_CLASSES).toContain(name as never);
      expect(isWordControl(cl(name))).toBe(true);
      expect(shouldStartWordPress("idle", cl(name))).toBe(false);
    }
  });

  test("the diamond sits in a word's hover row, so the word stays live around it", () => {
    // The row's own presses (name, memory dot, connect handle) are unaffected.
    expect(shouldStartWordPress("idle", cl("word-name"))).toBe(true);
    expect(shouldStartWordPress("idle", cl("memory-dot"))).toBe(false);
    expect(shouldStartWordPress("idle", cl("assumption-diamond"))).toBe(false);
  });

  test("an armed gesture suspends the plane's own gestures as before", () => {
    for (const mode of ["selector", "sign-choice", "path"] as const) {
      expect(shouldStartWordPress(mode, cl("word-name"))).toBe(false);
      expect(shouldPan(mode)).toBe(false);
      expect(shouldCreate(mode)).toBe(false);
    }
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
      "loop-route",
      "loop-name",
      "walk",
    ]) {
      expect(CONTENT_SELECTOR).toContain(`.${name}`);
    }
  });
});

describe("one diamond per target, however many claims sit on it", () => {
  test("a rival on the same target is still one presence", () => {
    const claims: Assumption[] = [
      { text: "mulch holds the rain", target: word("mulch"), extra: {} },
      { text: "mulch is patchy", target: word("mulch"), extra: {} },
    ];
    expect(targetsWithAssumptions(claims)).toHaveLength(1);
    expect(targetsWithAssumptions(claims)[0]).toEqual(word("mulch"));
  });

  test("a word and a loop of the same slug are two presences", () => {
    const claims: Assumption[] = [
      { text: "on the word", target: word("rain"), extra: {} },
      { text: "on the loop", target: { type: "loop", slug: "rain" }, extra: {} },
      { text: "on the spot", target: spot(3, 4), extra: {} },
    ];
    expect(targetsWithAssumptions(claims)).toHaveLength(3);
    const keys = targetsWithAssumptions(claims).map(assumptionTargetKey);
    expect(new Set(keys).size).toBe(3);
  });
});

describe("the Level 2 ring menu's third kind (ADR-0011's open decision)", () => {
  test("Level 1 offers exactly the word/lack pair it always did", () => {
    expect(creationKinds("concept")).toEqual(["word", "lack"]);
    expect(creationKinds("concept")).not.toContain("assumption");
  });

  test("Level 2 gains assumption as the THIRD kind", () => {
    const kinds = creationKinds("dynamics");
    expect(kinds).toEqual(["word", "lack", "assumption"]);
    expect(kinds[2]).toBe("assumption");
    // The first two are unchanged, so the existing choices keep their places.
    expect(kinds.slice(0, 2)).toEqual(creationKinds("concept"));
  });

  test("the third kind authors a bare-spot assumption, not a mark", () => {
    // Choosing assumption at a point states a claim about that spot: the
    // spot-target record the record layer stores (never a mark's spot ring).
    const claims = addAssumption([], "mulch holds the rain", spot(12, -4));
    expect(claims).toHaveLength(1);
    expect(claims[0].target).toEqual(spot(12, -4));
    const bytes = serializeAssumptions(claims);
    expect(bytes).toBe('{"text":"mulch holds the rain","x":12,"y":-4}' + "\n");
    expect(parseAssumptions(bytes).assumptions[0].target).toEqual(spot(12, -4));
    // A rival on the same bare spot is a second line, one diamond.
    const both = addAssumption(claims, "mulch is patchy", spot(12, -4));
    expect(both).toHaveLength(2);
    expect(targetsWithAssumptions(both)).toHaveLength(1);
  });

  test("Level 1 never authors a bare-spot assumption through its menu", () => {
    // The menu's contract is the kind list: with no assumption kind the
    // third choice does not exist, and Level 1 writes exactly as before.
    expect(creationKinds("concept")).toHaveLength(2);
  });
});
