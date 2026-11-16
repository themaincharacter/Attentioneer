import { describe, expect, test } from "bun:test";
import {
  appendSketch,
  clearSketches,
  parseSketchLine,
  parseSketches,
  serializeSketchLine,
  serializeSketches,
  sketchesPath,
  undoLastSketch,
  type Sketch,
  type SketchPoint,
} from "../src/map/sketches";

/**
 * The map's ink, automated (added 2026-11-16 per user review):
 * `map/sketches.jsonl` — one canonical line per freehand stroke, in DRAW ORDER
 * (which is undo order and stacking order), with the family's posture: unknown
 * keys preserved, malformed lines preserved AND surfaced, CRLF/BOM tolerated, a
 * missing file means no strokes. A stroke has no natural key, so there is no
 * dedupe: a hand-edited duplicate is two strokes and both draw.
 *
 * PROVISIONAL (the review asked only for "pen size, color, undo"): the line's
 * shape (`color`, `size` in WORLD units, `points` as `[x, y]` pairs), the
 * two-point minimum, and undo-by-position.
 */

const NL = "\n";

function stroke(
  points: SketchPoint[] = [
    { x: 10, y: 20 },
    { x: 12, y: 22 },
  ],
  color = "#3b3a35",
  size = 2,
  extra: Record<string, unknown> = {},
): Sketch {
  return { color, size, points, extra };
}

describe("the stroke line's canonical bytes", () => {
  test("compact, sorted keys, the points as [x, y] pairs", () => {
    expect(serializeSketchLine(stroke())).toBe(
      '{"color":"#3b3a35","points":[[10,20],[12,22]],"size":2}',
    );
  });

  test("a document is one line per stroke, in FILE ORDER, trailing newline", () => {
    const text = serializeSketches([
      stroke(undefined, "#a9522f", 1),
      stroke(undefined, "#4d5f86", 8),
    ]);
    expect(text).toBe(
      '{"color":"#a9522f","points":[[10,20],[12,22]],"size":1}' +
        NL +
        '{"color":"#4d5f86","points":[[10,20],[12,22]],"size":8}' +
        NL,
    );
    // The order is the record's own order, never sorted away.
    expect(parseSketches(text).sketches.map((s) => s.size)).toEqual([1, 8]);
  });

  test("an empty drawing is the canonical empty JSONL", () => {
    expect(serializeSketches([])).toBe(NL);
  });

  test("the world coordinates survive a round trip exactly", () => {
    const points = [
      { x: -120.5, y: 33.25 },
      { x: 1440.125, y: -0.5 },
    ];
    const parsed = parseSketchLine(serializeSketchLine(stroke(points)));
    expect(parsed?.points).toEqual(points);
  });
});

describe("the read: what is a stroke, and what is preserved", () => {
  test("a line with a colour, a size and two points parses", () => {
    const parsed = parseSketchLine(
      '{"color":"#8d887c","points":[[0,0],[1,1]],"size":4}',
    );
    expect(parsed).toEqual({
      color: "#8d887c",
      size: 4,
      points: [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ],
      extra: {},
    });
  });

  test("a stroke needs TWO points: a press with no movement is not one", () => {
    expect(
      parseSketchLine('{"color":"#3b3a35","points":[[0,0]],"size":2}'),
    ).toBeNull();
    expect(parseSketchLine('{"color":"#3b3a35","points":[],"size":2}')).toBeNull();
  });

  test("the size is never repaired: zero, negative, a string or a NaN is out of shape", () => {
    for (const size of ["0", "-2", '"2"', "null", "1e999"]) {
      expect(
        parseSketchLine(
          `{"color":"#3b3a35","points":[[0,0],[1,1]],"size":${size}}`,
        ),
      ).toBeNull();
    }
  });

  test("a point pair must be two finite numbers", () => {
    for (const points of ['[[0,0],[1]]', '[[0,0],["1",2]]', '[[0,0],[1,2,3]]']) {
      expect(
        parseSketchLine(`{"color":"#3b3a35","points":${points},"size":2}`),
      ).toBeNull();
    }
  });

  test("the colour is an authored string kept verbatim (never validated here)", () => {
    // The record's posture: it stores what the person (or a hand edit) wrote.
    // The RENDER falls back when CSS cannot paint it (sketchRules.penInk).
    const parsed = parseSketchLine(
      '{"color":"chartreuse-ish","points":[[0,0],[1,1]],"size":2}',
    );
    expect(parsed?.color).toBe("chartreuse-ish");
    expect(serializeSketchLine(parsed!)).toContain('"color":"chartreuse-ish"');
  });

  test("unknown keys are preserved across a rewrite", () => {
    const parsed = parseSketchLine(
      '{"author":"me","color":"#3b3a35","points":[[0,0],[1,1]],"size":2}',
    );
    expect(parsed?.extra).toEqual({ author: "me" });
    expect(serializeSketchLine(parsed!)).toBe(
      '{"author":"me","color":"#3b3a35","points":[[0,0],[1,1]],"size":2}',
    );
  });

  test("malformed lines are preserved verbatim AND surfaced", () => {
    const text = [
      '{"color":"#3b3a35","points":[[0,0],[1,1]],"size":2}',
      "not json at all",
      '{"color":"#3b3a35","points":[[0,0]],"size":2}',
      "",
    ].join(NL);
    const parsed = parseSketches(text);
    expect(parsed.sketches).toHaveLength(1);
    expect(parsed.malformed).toEqual([
      "not json at all",
      '{"color":"#3b3a35","points":[[0,0]],"size":2}',
    ]);
    // The bytes come back with the unreadable lines after the known ones.
    expect(serializeSketches(parsed.sketches, parsed.malformed)).toBe(
      '{"color":"#3b3a35","points":[[0,0],[1,1]],"size":2}' +
        NL +
        "not json at all" +
        NL +
        '{"color":"#3b3a35","points":[[0,0]],"size":2}' +
        NL,
    );
  });

  test("a BOM and CRLF from a hand edit are tolerated", () => {
    const text =
      '\uFEFF{"color":"#3b3a35","points":[[0,0],[1,1]],"size":2}\r\n';
    const parsed = parseSketches(text);
    expect(parsed.sketches).toHaveLength(1);
    expect(parsed.malformed).toEqual([]);
  });

  test("a stroke has no natural key: hand-edited duplicates are two strokes", () => {
    const line = '{"color":"#3b3a35","points":[[0,0],[1,1]],"size":2}';
    const parsed = parseSketches(line + NL + line);
    expect(parsed.sketches).toHaveLength(2);
    expect(serializeSketches(parsed.sketches)).toBe(line + NL + line + NL);
  });

  test("the file lives in map/, the committed model (no branch copy)", () => {
    expect(sketchesPath("/maps/garden")).toBe("/maps/garden/map/sketches.jsonl");
  });
});

describe("the pen's three moves: append, undo, clear", () => {
  test("a stroke appends LAST: later ink draws on top and undoes first", () => {
    const first = appendSketch([], {
      color: "#3b3a35",
      size: 2,
      points: [
        { x: 0, y: 0 },
        { x: 4, y: 4 },
      ],
    });
    const second = appendSketch(first, {
      color: "#a9522f",
      size: 1,
      points: [
        { x: 9, y: 9 },
        { x: 8, y: 8 },
      ],
    });
    expect(second.map((s) => s.color)).toEqual(["#3b3a35", "#a9522f"]);
    expect(second[1].extra).toEqual({});
  });

  test("a stroke with fewer than two points writes nothing", () => {
    const before = [stroke()];
    expect(
      appendSketch(before, {
        color: "#3b3a35",
        size: 2,
        points: [{ x: 1, y: 1 }],
      }),
    ).toEqual(before);
  });

  test("undo takes the LAST stroke's line and nothing else", () => {
    const strokes = [stroke(), stroke(undefined, "#a9522f")];
    const after = undoLastSketch(strokes);
    expect(after).toHaveLength(1);
    expect(after[0].color).toBe("#3b3a35");
    // Undo on an empty drawing is quiet, never a throw.
    expect(undoLastSketch([])).toEqual([]);
  });

  test("undo of the last stroke rewrites the file without its line", () => {
    const strokes = [
      stroke(undefined, "#3b3a35"),
      stroke(undefined, "#a9522f"),
    ];
    const text = serializeSketches(undoLastSketch(strokes));
    expect(text).toBe(
      '{"color":"#3b3a35","points":[[10,20],[12,22]],"size":2}' + NL,
    );
  });

  test("clear drops every stroke — and the malformed lines still survive", () => {
    expect(clearSketches([stroke(), stroke()])).toEqual([]);
    expect(serializeSketches(clearSketches([stroke()]), ["kept raw"])).toBe(
      "kept raw" + NL,
    );
  });
});
