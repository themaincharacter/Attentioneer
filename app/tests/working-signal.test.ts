import { describe, expect, test } from "bun:test";
import { conduitLegs, pointAlongRoute } from "../src/canvas/GroundWires";
import { createWorkingChannel } from "../src/canvas/workingRef";

describe("the current's spark rides the route (story 24-15)", () => {
  test("t walks the legs' total length, in order", () => {
    const legs = conduitLegs({ x: 0, y: 0 }, { x: 100, y: 40 });
    const route = [legs.first, legs.second];
    expect(pointAlongRoute(route, 0)).toEqual({ x: 0, y: 0 });
    // Halfway along the 140px route is 70px — still on the first (100px) leg.
    const mid = pointAlongRoute(route, 0.5);
    expect(mid.x).toBeCloseTo(70, 5);
    expect(mid.y).toBeCloseTo(0, 5);
    // 120 of 140 = 20 into the second (40px) leg: the bend is at (100, 0), so
    // the leg's own middle is (100, 20).
    const beyond = pointAlongRoute(route, 120 / 140);
    expect(beyond.x).toBeCloseTo(100, 5);
    expect(beyond.y).toBeCloseTo(20, 5);
    const end = pointAlongRoute(route, 1);
    expect(end.x).toBeCloseTo(100, 5);
    expect(end.y).toBeCloseTo(40, 5);
  });

  test("a straight route is one leg's walk, and an empty route is the origin", () => {
    const legs = conduitLegs({ x: 0, y: 0 }, { x: 100, y: 0 });
    const route = [legs.first, legs.second];
    expect(pointAlongRoute(route, 0.25)).toEqual({ x: 25, y: 0 });
    expect(pointAlongRoute([], 0.5)).toEqual({ x: 0, y: 0 });
  });
});

describe("the working channel (story 24-15)", () => {
  test("a card publishes its work and hears it leave", () => {
    const working = createWorkingChannel();
    const heard: number[] = [];
    const unsubscribe = working.subscribe(() => heard.push(1));
    working.set("ask-1", true);
    expect(working.is("ask-1")).toBe(true);
    working.set("ask-1", true); // the same truth twice is no event
    working.set("ask-1", false);
    expect(working.is("ask-1")).toBe(false);
    expect(heard.length).toBe(2);
    unsubscribe();
    working.set("ask-1", true);
    expect(heard.length).toBe(2);
  });
});
