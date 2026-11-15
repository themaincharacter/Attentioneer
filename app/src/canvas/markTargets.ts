import type { MarkTarget } from "../map/marks";
import type { Box, Point } from "./geometry";

/**
 * Where a dragged ring lands (Epic 3 story 2, ADR-0009): a mark is addressed
 * by what it is on, so binding is simply choosing a new target — a word, a
 * distance wire, a signed link's wordless pair, or a bare spot of plane.
 *
 * Pick binding is ELEMENT-UNDER-POINTER (ADR-0016 decision 5): the canvas asks
 * the DOM what is under the pointer and `resolveElementPick` reads the first
 * element in the chain that names a target. No nearest-element math decides a
 * drop — array order can never break a tie. The point helpers below
 * (`wordAtPoint`/`wireAtPoint`/`resolveMarkDrop`) stay as pure geometry
 * utilities (used by the wire tests); they no longer drive a drop.
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
 * Resolve a ring drop by geometry: a word wins (the mark binds to it), then a
 * wire near the pointer, else the drop leaves the mark bare at that spot.
 * PROVISIONAL: retained as a geometry utility for the wire tests; the canvas's
 * drop path binds element-under-pointer instead (ADR-0016).
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

/**
 * The element-under-pointer pick (ADR-0016 decision 5). The canvas flattens
 * the DOM under the pointer into a chain — the hit element first, then its
 * ancestors up to the plane — and this pure rule reads it: the first element
 * that NAMES a mark target wins, else the drop leaves the mark bare.
 *
 * Provisional: the data attribute names (slug / from / to / word) and the
 * class names are the canvas's own markup contract.
 */

/** A target-carrying word element is `.word` with its slug. */
export const PICK_WORD_CLASS = "word";
/** A distance wire's container is `.distance` with from/to/word. */
export const PICK_DISTANCE_CLASS = "distance";
/** A signed link's container is `.link` with from/to. */
export const PICK_LINK_CLASS = "link";

/** One element of the chain, as the canvas can describe it (DOM-free). */
export interface PickedElement {
  classes: readonly string[];
  data: Readonly<Record<string, string | undefined>>;
}

/** The elements under the pointer, nearest first (the hit element's ancestors). */
export type ElementChain = readonly PickedElement[];

/** The mark target this element names, or null when it names none. */
export function targetOfPickedElement(el: PickedElement): MarkTarget | null {
  const has = (name: string) => el.classes.includes(name);
  const from = el.data.from;
  const to = el.data.to;
  if (has(PICK_WORD_CLASS) && el.data.slug) {
    return { type: "word", slug: el.data.slug };
  }
  if (has(PICK_LINK_CLASS) && from && to) {
    return { type: "link", from, to };
  }
  if (has(PICK_DISTANCE_CLASS) && from && to && el.data.word) {
    return { type: "wire", from, to, word: el.data.word };
  }
  return null;
}

/**
 * Resolve a ring drop by the element under the pointer: the nearest chain
 * element that names a target wins (a word, a link wire, a distance wire), and
 * a pointer over bare plane leaves the mark bare at the drop point. The chain's
 * order is the DOM's, never an array's — no nearest-element math.
 */
export function resolveElementPick(
  chain: ElementChain,
  point: Point,
): MarkTarget {
  for (const el of chain) {
    const target = targetOfPickedElement(el);
    if (target) return target;
  }
  return { type: "spot", x: point.x, y: point.y };
}
