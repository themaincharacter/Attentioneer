import { describe, expect, test } from "bun:test";
import {
  chordNormal,
  directedWireEndpoints,
  LINK_HEAD_BACK,
  LINK_PAIR_GAP_PX,
  pairGap,
  pairSide,
  pointToward,
} from "../src/canvas/geometry";
import { signChoiceOutcome } from "../src/canvas/signChoiceRules";
import { countsAsOneFlip, SIGN_PAIR_MS } from "../src/canvas/planePress";
import { SIGNS, type LinkSign } from "../src/map/links";

/**
 * Story-2 canvas rules, asserted without a DOM:
 *
 * - A→B and B→A over one pair render as two wires, offset onto opposite sides
 *   of the CANONICAL unordered chord, a constant screen gap apart at every
 *   zoom (so both are always distinguishable and clear of a wire's pick band);
 * - the sign choice has no default: Enter with nothing chosen discards, only an
 *   explicit pick authors a sign (World B);
 * - a double-click on a sign counts once (the press-pair guard), so a hurried
 *   double-click never flips and unflips back to where it started.
 */

const A = { slug: "a", point: { x: 0, y: 0 } };
const B = { slug: "b", point: { x: 100, y: 0 } };

describe("the pair's canonical frame", () => {
  test("the side is a property of the ordered pair, not the draw order", () => {
    expect(pairSide("a", "b")).toBe(1);
    expect(pairSide("b", "a")).toBe(-1);
    expect(pairSide("a", "a")).toBe(0);
  });

  test("the normal comes from the sorted chord, so both directions share it", () => {
    expect(chordNormal({ x: 0, y: 0 }, { x: 100, y: 0 })).toEqual({ x: 0, y: 1 });
    expect(chordNormal({ x: 0, y: 0 }, { x: 0, y: 50 })).toEqual({ x: -1, y: 0 });
    expect(chordNormal({ x: 3, y: 4 }, { x: 3, y: 4 })).toBeNull();
  });

  test("the gap is constant on screen at every zoom", () => {
    const gaps = [0.4, 0.75, 1, 1.5, 2].map((z) => pairGap(z) * z);
    for (const gap of gaps) expect(gap).toBeCloseTo(LINK_PAIR_GAP_PX, 10);
  });
});

describe("opposite links render as two distinguishable wires", () => {
  test("A→B and B→A sit on opposite sides of the chord, parallel to it", () => {
    const forward = directedWireEndpoints(A, B, 1);
    const reverse = directedWireEndpoints(B, A, 1);
    // The same direction (parallel to the chord)...
    expect(forward.from.y).toBe(forward.to.y);
    expect(reverse.from.y).toBe(reverse.to.y);
    // ...on opposite sides, both offset by the canonical gap.
    expect(forward.from.y).toBe(LINK_PAIR_GAP_PX);
    expect(reverse.from.y).toBe(-LINK_PAIR_GAP_PX);
    // ...and each keeps the draw's direction: origin first, target second.
    expect(forward.from.x).toBe(0);
    expect(forward.to.x).toBe(100);
    expect(reverse.from.x).toBe(100);
    expect(reverse.to.x).toBe(0);
  });

  test("the two wires never overlap and clear the pick band at every zoom", () => {
    const HIT_BAND_PX = 8; // .link-hit / .distance-hit height
    for (const zoom of [0.35, 0.5, 1, 2, 4]) {
      const forward = directedWireEndpoints(A, B, zoom);
      const reverse = directedWireEndpoints(B, A, zoom);
      // Screen-space separation between the two parallel wires.
      const separation = Math.abs(forward.from.y - reverse.from.y) * zoom;
      expect(separation).toBeCloseTo(2 * LINK_PAIR_GAP_PX, 10);
      expect(separation).toBeGreaterThan(HIT_BAND_PX);
    }
  });

  test("the side is stable when the words are dragged anywhere", () => {
    const diagonal = { slug: "a", point: { x: 40, y: -10 } };
    const other = { slug: "b", point: { x: -30, y: 80 } };
    const forward = directedWireEndpoints(diagonal, other, 1);
    const reverse = directedWireEndpoints(other, diagonal, 1);
    // The two wires are mirror images about the chord: their midpoints are
    // symmetric and the segments are the same length.
    const forwardMid = {
      x: (forward.from.x + forward.to.x) / 2,
      y: (forward.from.y + forward.to.y) / 2,
    };
    const reverseMid = {
      x: (reverse.from.x + reverse.to.x) / 2,
      y: (reverse.from.y + reverse.to.y) / 2,
    };
    const chordMid = {
      x: (diagonal.point.x + other.point.x) / 2,
      y: (diagonal.point.y + other.point.y) / 2,
    };
    expect((forwardMid.x + reverseMid.x) / 2).toBeCloseTo(chordMid.x, 10);
    expect((forwardMid.y + reverseMid.y) / 2).toBeCloseTo(chordMid.y, 10);
  });

  test("a self-link or a degenerate chord renders the plain points", () => {
    const same = directedWireEndpoints(
      { slug: "a", point: { x: 5, y: 5 } },
      { slug: "a", point: { x: 5, y: 5 } },
      1,
    );
    expect(same).toEqual({ from: { x: 5, y: 5 }, to: { x: 5, y: 5 } });
    const collapsed = directedWireEndpoints(
      { slug: "a", point: { x: 5, y: 5 } },
      { slug: "b", point: { x: 5, y: 5 } },
      1,
    );
    expect(collapsed).toEqual({ from: { x: 5, y: 5 }, to: { x: 5, y: 5 } });
  });

  test("the head cluster sits back toward the origin, never on the word", () => {
    expect(LINK_HEAD_BACK).toBeGreaterThan(0);
    expect(pointToward({ x: 100, y: 0 }, { x: 0, y: 0 }, LINK_HEAD_BACK)).toEqual({
      x: 100 - LINK_HEAD_BACK,
      y: 0,
    });
    // A degenerate direction leaves the head where it is (never NaN).
    expect(pointToward({ x: 2, y: 3 }, { x: 2, y: 3 }, 10)).toEqual({ x: 2, y: 3 });
  });
});

describe("the sign choice never guesses (World B)", () => {
  test("the choice offers both signs in one order and selects neither", () => {
    expect([...SIGNS]).toEqual(["+", "-"]);
  });

  test("Enter with nothing chosen discards; only an explicit pick authors", () => {
    expect(signChoiceOutcome(null, "Enter")).toBeNull();
    expect(signChoiceOutcome("+", "Enter")).toBe("+");
    expect(signChoiceOutcome("-", "Enter")).toBe("-");
  });

  test("Esc discards whatever was hovered or focused", () => {
    for (const chosen of [null, "+", "-"] as (LinkSign | null)[]) {
      expect(signChoiceOutcome(chosen, "Escape")).toBeNull();
    }
  });
});

describe("a double-click on a sign counts once", () => {
  test("the first press flips; the second half of the pair does not", () => {
    const t = 1_000;
    expect(countsAsOneFlip(null, t)).toBe(true);
    expect(countsAsOneFlip(t, t + 120)).toBe(false); // the double-click's 2nd click
    expect(countsAsOneFlip(t, t + SIGN_PAIR_MS)).toBe(false); // still the pair
    expect(countsAsOneFlip(t, t + SIGN_PAIR_MS + 1)).toBe(true); // a new press
  });

  test("the window is per sign glyph (the caller keeps one time per link)", () => {
    // Two links' last-press times are independent: this rule only answers
    // "does this press count?", given the link's own previous press.
    expect(countsAsOneFlip(5_000, 5_010)).toBe(false);
    expect(countsAsOneFlip(null, 5_010)).toBe(true);
  });
});
