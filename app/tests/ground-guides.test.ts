import { describe, expect, test } from "bun:test";
import {
  GUIDE_MAX_LINES,
  GUIDE_SNAP_PX,
  guideMatches,
} from "../src/canvas/GroundGuides";

describe("the alignment guides: pure matches, visual only", () => {
  test("aligned edges draw one line per position, spanning both boxes", () => {
    const lines = guideMatches({ x: 0, y: 0 }, [{ x: 2, y: 400 }], GUIDE_SNAP_PX);
    const vertical = lines.filter((line) => line.vertical);
    // Left, centre and right edges each line up (0/2, 150/152, 300/302) and
    // draw ONE line at the pair's midpoint; nothing on the y axis.
    expect(vertical.map((line) => line.at)).toEqual([1, 151, 301]);
    expect(lines.some((line) => !line.vertical)).toBe(false);
    // The line spans both cards and a little past them.
    expect(vertical[0]!.start).toBeLessThan(0);
    expect(vertical[0]!.end).toBeGreaterThan(620);
  });

  test("a card far from every neighbour draws nothing", () => {
    expect(guideMatches({ x: 0, y: 0 }, [{ x: 100, y: 100 }], GUIDE_SNAP_PX)).toEqual([]);
  });

  test("never more than four lines, even when everything lines up", () => {
    const others = [
      { x: 3, y: 400 },
      { x: -3, y: -430 },
      { x: 3, y: -430 },
    ];
    const lines = guideMatches({ x: 0, y: 0 }, others, GUIDE_SNAP_PX);
    expect(lines.length).toBeLessThanOrEqual(GUIDE_MAX_LINES);
    expect(lines.length).toBeGreaterThan(0);
  });
});
