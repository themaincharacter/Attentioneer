import type { MarkTarget } from "../map/marks";
import type { Box, Point } from "./geometry";

/**
 * Where a dragged ring lands (Epic 3 story 2, ADR-0009): a mark is addressed
 * by what it is on, so binding is simply choosing a new target — a word, a
 * wire, or a bare spot of plane. Pure hit-testing over the same geometry the
 * canvas renders, so a drop can be tested without a DOM.
 */

/** World-unit reach around a wire that counts as "on the wire". */
export const WIRE_DROP_SLOP = 12;

/** A word as the drop test sees it: its slug, top-left position and box. */
export interface WordHit {
  slug: string;
  pos: Point;
  box: Box;
}

/** A wire as the drop test sees it: its natural key and rendered endpoints. */
export interface WireHit {
  from: string;
  to: string;
  word: string;
  fromPoint: Point;
  toPoint: Point;
}

/** Distance from a point to a segment (zero for a degenerate segment). */
export function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared,
    ),
  );
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

/**
 * The word under `point`, if any: its measured box grown by `pad` world units
 * (the ring may sit just outside the text and still mean the word). Overlapping
 * boxes resolve to the nearest word centre.
 */
export function wordAtPoint(
  point: Point,
  words: readonly WordHit[],
  pad = 4,
): WordHit | null {
  let best: WordHit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const word of words) {
    if (
      point.x < word.pos.x - pad ||
      point.x > word.pos.x + word.box.w + pad ||
      point.y < word.pos.y - pad ||
      point.y > word.pos.y + word.box.h + pad
    ) {
      continue;
    }
    const dx = point.x - (word.pos.x + word.box.w / 2);
    const dy = point.y - (word.pos.y + word.box.h / 2);
    const distance = dx * dx + dy * dy;
    if (distance < bestDistance) {
      best = word;
      bestDistance = distance;
    }
  }
  return best;
}

/** The nearest wire within `maxDistance` world units of `point`, or null. */
export function wireAtPoint(
  point: Point,
  wires: readonly WireHit[],
  maxDistance = WIRE_DROP_SLOP,
): WireHit | null {
  let best: WireHit | null = null;
  let bestDistance = maxDistance;
  for (const wire of wires) {
    const distance = distanceToSegment(point, wire.fromPoint, wire.toPoint);
    if (distance <= bestDistance) {
      best = wire;
      bestDistance = distance;
    }
  }
  return best;
}

/**
 * Resolve a ring drop: a word wins (the mark binds to it), then a wire near
 * the pointer, else the drop leaves the mark bare at that spot.
 */
export function resolveMarkDrop(
  point: Point,
  words: readonly WordHit[],
  wires: readonly WireHit[],
  wireSlop = WIRE_DROP_SLOP,
): MarkTarget {
  const word = wordAtPoint(point, words);
  if (word) return { type: "word", slug: word.slug };
  const wire = wireAtPoint(point, wires, wireSlop);
  if (wire) return { type: "wire", from: wire.from, to: wire.to, word: wire.word };
  return { type: "spot", x: point.x, y: point.y };
}
