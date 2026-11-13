import { describe, expect, test } from "bun:test";
import {
  dedupeMarks,
  findOrphanMarks,
  hasMark,
  markTargetKey,
  parseMarkLine,
  parseMarks,
  serializeMarkLine,
  serializeMarks,
  withMark,
  withoutMark,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import { distanceKey } from "../src/map/distances";

/**
 * Story-1 guarantee, automated: `map/marks.jsonl` round-trips canonically with
 * all three target forms (ADR-0009), keeps unknown keys, preserves malformed
 * lines verbatim, collapses by natural key, and exposes orphans.
 */

const word = (slug: string): MarkTarget => ({ type: "word", slug });
const wire = (from: string, to: string, word: string): MarkTarget => ({
  type: "wire",
  from,
  to,
  word,
});
const spot = (x: number, y: number): MarkTarget => ({ type: "spot", x, y });

function mark(over: Partial<Mark> = {}): Mark {
  return { kind: "open", target: { type: "word", slug: "rain" }, extra: {}, ...over };
}

describe("the mark line, one canonical form per target", () => {
  test("word, wire and bare spot serialize compact with sorted keys", () => {
    expect(serializeMarkLine(mark())).toBe('{"kind":"open","on":"rain"}');
    expect(serializeMarkLine(mark({ target: wire("a", "b", "feeds") }))).toBe(
      '{"from":"a","kind":"open","to":"b","word":"feeds"}',
    );
    expect(serializeMarkLine(mark({ target: spot(12, -3.5) }))).toBe(
      '{"kind":"open","x":12,"y":-3.5}',
    );
  });

  test("all three forms round-trip byte-for-byte", () => {
    const marks = [
      mark(),
      mark({ target: wire("a", "b", "feeds") }),
      mark({ target: spot(250.33333333333334, -12.000000000000002) }),
    ];
    for (const original of marks) {
      const line = serializeMarkLine(original);
      const parsed = parseMarkLine(line);
      expect(parsed).not.toBeNull();
      expect(parsed!.target).toEqual(original.target);
      expect(serializeMarkLine(parsed!)).toBe(line);
    }
  });

  test("unknown keys on a known mark survive a rewrite", () => {
    const original = mark({ extra: { note: "why", rank: 3 } });
    const line = serializeMarkLine(original);
    const parsed = parseMarkLine(line)!;
    expect(parsed.extra).toEqual({ note: "why", rank: 3 });
    expect(serializeMarkLine(parsed)).toBe(line);
  });

  test("unknown keys on a wire mark survive too", () => {
    const original = mark({ target: wire("a", "b", "feeds"), extra: { held: true } });
    expect(parseMarkLine(serializeMarkLine(original))!.extra).toEqual({ held: true });
  });

  test("any kind string parses; only open is a cast mark", () => {
    const parsed = parseMarkLine('{"kind":"tentative","on":"rain"}')!;
    expect(parsed.kind).toBe("tentative");
    expect(hasMark([parsed], "open", word("rain"))).toBe(false);
    expect(hasMark([parsed], "tentative", word("rain"))).toBe(true);
  });
});

describe("tolerant read of the marks file", () => {
  test("blank lines and terminating newlines are ignored", () => {
    expect(parseMarks("")).toEqual({ marks: [], malformed: [] });
    expect(parseMarks("\n\n")).toEqual({ marks: [], malformed: [] });
  });

  test("CRLF and a BOM are tolerated", () => {
    const parsed = parseMarks(
      '\uFEFF{"kind":"open","on":"a"}\r\n{"kind":"open","x":2,"y":3}\r\n',
    );
    expect(parsed.malformed).toEqual([]);
    expect(parsed.marks.map((m) => m.target.type)).toEqual(["word", "spot"]);
  });

  test("malformed and out-of-shape lines surface, never dropped", () => {
    const text = [
      "{bad json}",
      "[1,2]",
      '{"on":"a"}',
      '{"kind":"","on":"a"}',
      '{"kind":"open"}',
      '{"kind":"open","on":""}',
      '{"kind":"open","on":"a","x":1}',
      '{"kind":"open","from":"a","to":"b"}',
      '{"kind":"open","x":1}',
      '{"kind":"open","x":"1","y":2}',
      '{"kind":"open","from":"a","to":"b","word":""}',
      '{"kind":"open","from":"a","to":"b","word":"feeds"}',
    ].join("\n");
    const parsed = parseMarks(text);
    expect(parsed.marks).toHaveLength(1);
    expect(parsed.marks[0].target).toEqual(wire("a", "b", "feeds"));
    expect(parsed.malformed).toHaveLength(11);
    expect(parsed.malformed[0]).toBe("{bad json}");
  });
});

describe("the natural key names one mark", () => {
  test("kind + target: words, wires (ordered) and spots are distinct", () => {
    expect(markTargetKey(word("a"))).not.toBe(markTargetKey(word("b")));
    expect(markTargetKey(wire("a", "b", "feeds"))).not.toBe(
      markTargetKey(wire("b", "a", "feeds")),
    );
    expect(markTargetKey(wire("a", "b", "feeds"))).not.toBe(
      markTargetKey(wire("a", "b", "needs")),
    );
    expect(markTargetKey(spot(1, 2))).not.toBe(markTargetKey(spot(1, 3)));
    // Two distances on one pair carry two marks (the sibling survives).
    expect(markTargetKey(wire("a", "b", "feeds"))).toBe(
      markTargetKey(wire("a", "b", "feeds")),
    );
  });

  test("the kind is part of the key", () => {
    const open = mark();
    const other = mark({ kind: "later" });
    expect(dedupeMarks([open, other])).toHaveLength(2);
  });

  test("re-casting an identical mark rewrites one line, last wins", () => {
    const first = mark({ extra: { rank: 1 } });
    const second = mark({ extra: { rank: 2 } });
    const next = withMark([first], second);
    expect(next).toHaveLength(1);
    expect(next[0].extra).toEqual({ rank: 2 });
  });

  test("withdrawing settles only the open mark on that exact target", () => {
    const open = mark();
    const other = mark({ kind: "later" });
    expect(withoutMark([open, other], "open", word("rain"))).toEqual([other]);
  });
});

describe("the marks file's bytes", () => {
  test("one line per key, malformed lines re-emitted verbatim", () => {
    const text = serializeMarks(
      [mark({ extra: { rank: 1 } }), mark({ extra: { rank: 2 } })],
      ["{bad json", "not even json"],
    );
    expect(text).toBe(
      '{"kind":"open","on":"rain","rank":2}\n{bad json\nnot even json\n',
    );
  });

  test("hand-duplicated lines collapse on the next rewrite", () => {
    const line = serializeMarkLine(mark());
    const parsed = parseMarks(`${line}\n${line}`);
    expect(parsed.marks).toHaveLength(2);
    expect(serializeMarks(parsed.marks)).toBe(`${line}\n`);
  });

  test("a hand-edited bare-spot line is kept even though story 1 doesn't render it", () => {
    const line = serializeMarkLine(mark({ target: spot(10, 20) }));
    const parsed = parseMarks(line);
    expect(parsed.marks).toHaveLength(1);
    expect(serializeMarks(parsed.marks)).toBe(`${line}\n`);
  });

  test("an orphan survives an unrelated rewrite byte-for-byte", () => {
    const orphan = serializeMarkLine(mark({ target: wire("gone", "away", "feeds") }));
    const parsed = parseMarks(orphan);
    expect(serializeMarks(parsed.marks)).toBe(`${orphan}\n`);
  });
});

describe("orphans are surfaced, not hidden", () => {
  test("a missing word or wire target is an orphan; a spot never is", () => {
    const rain = mark();
    const sea = mark({ target: word("sea") });
    const feeds = mark({ target: wire("a", "b", "feeds") });
    const needs = mark({ target: wire("a", "c", "needs") });
    const bare = mark({ target: spot(1, 2) });
    const orphans = findOrphanMarks(
      [rain, sea, feeds, needs, bare],
      new Set(["rain"]),
      new Set([distanceKey("a", "b", "feeds")]),
    );
    expect(orphans).toEqual([sea, needs]);
  });
});
