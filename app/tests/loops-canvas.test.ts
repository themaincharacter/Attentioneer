import { describe, expect, test } from "bun:test";
import {
  LOOP_ROUTE_STAGGER,
  LOOP_ROUTE_STANDOFF,
  loopRoutePoints,
  pairLoopPoints,
  pointInPolygon,
  routeCenter,
  routeRim,
  selfLoopPoints,
  type Box,
  type Point,
  type RouteVisit,
} from "../src/canvas/geometry";
import { isContentElement, shouldCreate, shouldPan, shouldStartWordPress } from "../src/canvas/gates";

/**
 * Story-3 canvas rules, asserted without a DOM:
 *
 * - the route hugs the words: every rim point sits off the box, and a walk that
 *   passes straight through a word sends the route around its side (never over
 *   the text);
 * - overlapping loops are staggered apart by their rank;
 * - a self-loop gets its own orbit and a 2-cycle a ring that encloses both
 *   words;
 * - the gate's path mode suspends word press, pan and creation, and the loop
 *   elements are content/word controls.
 */

const BOX: Box = { w: 96, h: 28 };
const CENTER = { x: 0, y: 0 };

const visit = (x: number, y: number, box: Box = BOX): RouteVisit => ({
  center: { x, y },
  box,
});

/** The four corners of a word's box, as the route's containment test sees them. */
function corners(center: Point, box: Box): Point[] {
  return [
    { x: center.x - box.w / 2, y: center.y - box.h / 2 },
    { x: center.x + box.w / 2, y: center.y - box.h / 2 },
    { x: center.x + box.w / 2, y: center.y + box.h / 2 },
    { x: center.x - box.w / 2, y: center.y + box.h / 2 },
  ];
}

function insideBox(point: Point, center: Point, box: Box): boolean {
  return (
    point.x >= center.x - box.w / 2 &&
    point.x <= center.x + box.w / 2 &&
    point.y >= center.y - box.h / 2 &&
    point.y <= center.y + box.h / 2
  );
}

describe("the route hugs its words (never through text)", () => {
  test("every rim point sits outside the box it belongs to", () => {
    // Both neighbours on one side: the bisector points that way, and the rim
    // is the box edge plus the standoff along it.
    const rim = routeRim(visit(0, 0), { x: 200, y: 0 }, { x: 200, y: 0 });
    expect(insideBox(rim, CENTER, BOX)).toBe(false);
    expect(rim.x).toBeCloseTo(BOX.w / 2 + LOOP_ROUTE_STANDOFF, 10);
    expect(rim.y).toBeCloseTo(0, 10);
  });

  test("a straight-through walk sends the route around the word's side", () => {
    // prev and next are opposite: the bisector is degenerate, so the route
    // steps sideways rather than crossing the word.
    const rim = routeRim(visit(0, 0), { x: -200, y: 0 }, { x: 200, y: 0 });
    expect(Math.abs(rim.y)).toBeGreaterThan(BOX.h / 2);
    expect(Math.abs(rim.y)).toBeCloseTo(BOX.h / 2 + LOOP_ROUTE_STANDOFF, 10);
  });

  test("a corner visit still lands off the text", () => {
    const a = visit(0, 0);
    const b = visit(200, 120);
    const c = visit(-60, 180);
    const rim = routeRim(b, a.center, c.center);
    expect(insideBox(rim, b.center, b.box)).toBe(false);
  });

  test("a three-word route: three points, each outside every box", () => {
    const visits = [visit(0, 0), visit(200, 0), visit(100, 160)];
    const points = loopRoutePoints(visits);
    expect(points).toHaveLength(3);
    for (const point of points) {
      for (const v of visits) {
        expect(insideBox(point, v.center, v.box)).toBe(false);
      }
    }
  });

  test("the segments between rim points never cross a word's text", () => {
    const visits = [visit(0, 0), visit(200, 0), visit(100, 160)];
    const points = loopRoutePoints(visits);
    for (let i = 0; i < points.length; i += 1) {
      const from = points[i];
      const to = points[(i + 1) % points.length];
      for (let t = 0; t <= 1; t += 0.05) {
        const sample = {
          x: from.x + (to.x - from.x) * t,
          y: from.y + (to.y - from.y) * t,
        };
        for (const v of visits) {
          expect(insideBox(sample, v.center, v.box)).toBe(false);
        }
      }
    }
  });

  test("the route's rank staggers it further out, so overlapping loops differ", () => {
    const visits = [visit(0, 0), visit(200, 0), visit(100, 160)];
    const base = loopRoutePoints(visits, 0);
    const staggered = loopRoutePoints(visits, LOOP_ROUTE_STAGGER);
    expect(staggered).not.toEqual(base);
    for (let i = 0; i < base.length; i += 1) {
      const center = visits[i].center;
      const r0 = Math.hypot(base[i].x - center.x, base[i].y - center.y);
      const r1 = Math.hypot(staggered[i].x - center.x, staggered[i].y - center.y);
      expect(r1).toBeGreaterThan(r0);
    }
  });

  test("an empty walk has no route", () => {
    expect(loopRoutePoints([])).toEqual([]);
  });
});

describe("self-loops and 2-cycles have their own quiet shape", () => {
  test("a self-loop's orbit is a circle off the word's right edge", () => {
    const points = selfLoopPoints(visit(0, 0));
    expect(points).toHaveLength(10);
    for (const point of points) {
      expect(insideBox(point, CENTER, BOX)).toBe(false);
    }
    // Every orbit point is the same distance from the orbit's centre.
    const center = routeCenter(points);
    const radii = points.map((point) => Math.hypot(point.x - center.x, point.y - center.y));
    for (const radius of radii) expect(radius).toBeCloseTo(radii[0], 10);
    expect(center.x).toBeGreaterThan(BOX.w / 2);
  });

  test("a 2-cycle's ring encloses both words and crosses neither", () => {
    const a = visit(0, 0);
    const b = visit(240, 0);
    const points = pairLoopPoints(a, b);
    expect(points.length).toBeGreaterThan(4);
    for (const corner of corners(a.center, a.box)) {
      expect(pointInPolygon(corner, points)).toBe(true);
    }
    for (const corner of corners(b.center, b.box)) {
      expect(pointInPolygon(corner, points)).toBe(true);
    }
    for (const point of points) {
      expect(insideBox(point, a.center, a.box)).toBe(false);
      expect(insideBox(point, b.center, b.box)).toBe(false);
    }
  });

  test("loopRoutePoints picks the orbit, the ring and the polyline", () => {
    expect(loopRoutePoints([visit(0, 0)])).toHaveLength(10);
    expect(loopRoutePoints([visit(0, 0), visit(240, 0)]).length).toBeGreaterThan(4);
    expect(loopRoutePoints([visit(0, 0), visit(200, 0), visit(100, 160)])).toHaveLength(3);
  });
});

describe("the route's middle names the loop", () => {
  test("routeCenter averages the points", () => {
    expect(
      routeCenter([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ]),
    ).toEqual({ x: 5, y: 5 });
    expect(routeCenter([])).toEqual({ x: 0, y: 0 });
  });
});

describe("the path gate suppresses the plane's own gestures", () => {
  test("path mode suspends word press, pan and creation", () => {
    expect(shouldStartWordPress("path", { contains: (token) => token === "word-name" })).toBe(false);
    expect(shouldPan("path")).toBe(false);
    // The creation ring menu must not open behind the path gesture.
    expect(shouldCreate("path")).toBe(false);
  });

  test("the loop elements are content, never plane gestures", () => {
    for (const name of [
      "loop-route",
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
    ]) {
      expect(isContentElement({ contains: (token) => token === name })).toBe(true);
    }
  });

  test("idle leaves the route's own presses alone (Level 1 is unchanged)", () => {
    // The loop classes never reach a word press in idle either; Level 1 has no
    // loop elements at all, so nothing about its behavior changes.
    expect(shouldStartWordPress("idle", { contains: (token) => token === "loop-name" })).toBe(false);
    expect(shouldPan("idle")).toBe(true);
    expect(shouldCreate("idle")).toBe(true);
  });
});
