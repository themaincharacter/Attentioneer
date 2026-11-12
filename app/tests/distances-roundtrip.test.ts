import { describe, expect, test } from "bun:test";
import {
  distanceKey,
  parseDistanceLine,
  parseDistances,
  serializeDistanceLine,
  type Distance,
} from "../src/map/distances";
import { canonicalJsonlLine } from "../src/lib/serialize";

function distance(over: Partial<Distance> = {}): Distance {
  return { from: "a", to: "b", word: "friend", extra: {}, ...over };
}

function roundTrip(d: Distance): string {
  return serializeDistanceLine(parseDistanceLine(serializeDistanceLine(d))!);
}

describe("distance line round-trips", () => {
  test("ordered pair + word, compact sorted keys", () => {
    expect(serializeDistanceLine(distance())).toBe('{"from":"a","to":"b","word":"friend"}');
  });

  test("words with quotes, backslashes and unicode", () => {
    const words = ['say "hi" ok', "back\\slash", "想法", "line\nbreak"];
    for (const word of words) {
      const d = distance({ word });
      expect(roundTrip(d)).toBe(serializeDistanceLine({ from: "a", to: "b", word }));
    }
  });

  test("self-distances round-trip unchanged (legal, unremarkable)", () => {
    const d = distance({ from: "x", to: "x", word: "self" });
    expect(roundTrip(d)).toBe('{"from":"x","to":"x","word":"self"}');
  });

  test("drawn reverse is a distinct line, never merged", () => {
    const ab = serializeDistanceLine(distance({ from: "a", to: "b", word: "friend" }));
    const ba = serializeDistanceLine(distance({ from: "b", to: "a", word: "friend" }));
    expect(ab).not.toBe(ba);
    expect(distanceKey("a", "b", "friend")).not.toBe(distanceKey("b", "a", "friend"));
  });

  test("unknown keys survive a rewrite", () => {
    const d = distance({ extra: { status: "draft", rank: 3 } });
    const parsed = parseDistanceLine(serializeDistanceLine(d))!;
    expect(parsed.extra).toEqual({ status: "draft", rank: 3 });
  });
});

describe("tolerant read of the distances file", () => {
  test("blank lines and trailing newlines are ignored", () => {
    const parsed = parseDistances('{"from":"a","to":"b","word":"w"}\n\n');
    expect(parsed.distances).toHaveLength(1);
    expect(parsed.malformed).toEqual([]);
  });

  test("CRLF and BOM are tolerated", () => {
    const parsed = parseDistances('\uFEFF{"from":"a","to":"b","word":"w"}\r\n');
    expect(parsed.distances).toHaveLength(1);
    expect(parsed.distances[0].word).toBe("w");
  });

  test("malformed lines surface as visible unknowns, never dropped", () => {
    const parsed = parseDistances(
      '{bad json}\n{"from":"a","to":"b","word":"w"}\n[1,2,3]\n',
    );
    expect(parsed.distances).toHaveLength(1);
    expect(parsed.malformed).toEqual(["{bad json}", "[1,2,3]"]);
  });

  test("line missing a field is malformed, not a half-record", () => {
    expect(parseDistanceLine('{"from":"a","to":"b"}')).toBeNull();
    expect(parseDistanceLine('{"from":"a","word":"w"}')).toBeNull();
    expect(parseDistanceLine('{"from":"a","to":"b","word":""}')).toBeNull();
  });
});

describe("the natural key names one distance", () => {
  test("(from,to,word) is the identity; a changed word is a changed key", () => {
    expect(distanceKey("a", "b", "friend")).toBe(distanceKey("a", "b", "friend"));
    expect(distanceKey("a", "b", "friend")).not.toBe(distanceKey("a", "b", "ally"));
  });

  test("canonicalJsonlLine sorts keys", () => {
    expect(canonicalJsonlLine({ word: "w", to: "b", from: "a" })).toBe(
      '{"from":"a","to":"b","word":"w"}',
    );
  });
});