import { describe, expect, test } from "bun:test";
import {
  distanceToSegment,
  resolveMarkDrop,
  wireAtPoint,
  wordAtPoint,
  WIRE_DROP_SLOP,
  type WireHit,
  type WordHit,
} from "../src/canvas/markTargets";

/**
 * Story-2 guarantee, automated: a ring dropped on the plane resolves to a
 * word, then a wire, else a bare spot at the drop point (ADR-0009's three
 * target forms). Pure hit-testing over the canvas's own geometry.
 */

function word(slug: string, x: number, y: number, w = 100, h = 30): WordHit {
  return { slug, pos: { x, y }, box: { w, h } };
}

function wire(
  from: string,
  to: string,
  distanceWord: string,
  a: { x: number; y: number },
  b: { x: number; y: number },
): WireHit {
  return { from, to, word: distanceWord, fromPoint: a, toPoint: b };
}

const words = [word("rain", 0, 0), word("soil", 400, 100)];
const wires = [wire("rain", "soil", "soaks", { x: 50, y: 15 }, { x: 450, y: 115 })];

describe("a dropped ring finds its target", () => {
  test("inside a word's box binds to that word", () => {
    expect(wordAtPoint({ x: 50, y: 15 }, words)?.slug).toBe("rain");
  });

  test("just outside the box still means the word (the ring's reach)", () => {
    expect(wordAtPoint({ x: -2, y: 15 }, words)?.slug).toBe("rain");
    expect(wordAtPoint({ x: 50, y: -3 }, words)?.slug).toBe("rain");
  });

  test("a point near a wire binds to the wire's natural key", () => {
    const hit = wireAtPoint({ x: 250, y: 70 }, wires);
    expect(hit).not.toBeNull();
    expect(hit!.from).toBe("rain");
    expect(hit!.to).toBe("soil");
    expect(hit!.word).toBe("soaks");
  });

  test("a point beyond the wire slop misses it", () => {
    expect(wireAtPoint({ x: 250, y: 70 + WIRE_DROP_SLOP + 6 }, wires)).toBeNull();
  });

  test("a word wins over a wire passing through it", () => {
    const point = { x: 50, y: 15 }; // inside "rain" and on the wire's start
    expect(resolveMarkDrop(point, words, wires)).toEqual({ type: "word", slug: "rain" });
  });

  test("the nearest wire wins when two are in reach", () => {
    const near = wire("a", "b", "near", { x: 0, y: 100 }, { x: 300, y: 100 });
    const far = wire("c", "d", "far", { x: 0, y: 108 }, { x: 300, y: 108 });
    expect(wireAtPoint({ x: 100, y: 100 }, [far, near])?.word).toBe("near");
  });

  test("empty plane leaves the mark bare at the drop point", () => {
    expect(resolveMarkDrop({ x: 900, y: 600 }, words, wires)).toEqual({
      type: "spot",
      x: 900,
      y: 600,
    });
  });

  test("wire direction is preserved exactly as drawn (ADR-0006)", () => {
    const reversed = wire("soil", "rain", "soaks", { x: 450, y: 115 }, { x: 50, y: 15 });
    expect(resolveMarkDrop({ x: 250, y: 70 }, [], [reversed])).toEqual({
      type: "wire",
      from: "soil",
      to: "rain",
      word: "soaks",
    });
  });
});

describe("distance to a segment", () => {
  test("uses the perpendicular foot", () => {
    expect(distanceToSegment({ x: 50, y: 40 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(40);
  });

  test("clamps beyond the endpoints", () => {
    expect(distanceToSegment({ x: -30, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(30);
    expect(distanceToSegment({ x: 130, y: 0 }, { x: 0, y: 0 }, { x: 100, y: 0 })).toBe(30);
  });

  test("a degenerate segment is a point", () => {
    expect(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 })).toBe(5);
  });
});
