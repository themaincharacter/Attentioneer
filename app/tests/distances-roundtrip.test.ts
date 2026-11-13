import { describe, expect, test } from "bun:test";
import {
  coinDistance,
  distanceKey,
  parseDistanceLine,
  parseDistances,
  recoinDistanceLine,
  serializeDistanceLine,
  serializeDistances,
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

describe("the coin gesture keeps sibling distances (red-team trap)", () => {
  test("a second word on the same pair survives", () => {
    const one = [distance({ word: "feeds" })];
    const two = coinDistance(one, "a", "b", "needs");
    expect(two).toHaveLength(2);
    expect(two.map((d) => d.word)).toEqual(["feeds", "needs"]);
  });

  test("re-drawing the identical key never duplicates and keeps its unknown keys", () => {
    const existing = distance({ word: "feeds", extra: { rank: 2 } });
    expect(coinDistance([existing], "a", "b", "feeds")).toEqual([existing]);
  });

  test("the sibling survives a full serialize/parse cycle", () => {
    const two = coinDistance([distance({ word: "feeds" })], "a", "b", "needs");
    const parsed = parseDistances(serializeDistances(two));
    expect(parsed.malformed).toEqual([]);
    expect(parsed.distances.map((d) => d.word)).toEqual(["feeds", "needs"]);
  });
});

describe("re-coin has a pinned survivor (red-team trap)", () => {
  test("the re-coined line wins, the colliding sibling dies", () => {
    const first = distance({ word: "w1", extra: { rank: 1 } });
    const second = distance({ word: "w2", extra: { rank: 2 } });
    const { distances, collided } = recoinDistanceLine([first, second], first, "w2");
    expect(collided).toBe(true);
    expect(distances).toHaveLength(1);
    expect(distances[0].word).toBe("w2");
    // The re-coined line's unknown keys are the survivor's.
    expect(distances[0].extra).toEqual({ rank: 1 });
  });

  test("a free re-coin keeps the sibling on the pair", () => {
    const first = distance({ word: "w1", extra: { rank: 1 } });
    const sibling = distance({ word: "w2" });
    const { distances, collided } = recoinDistanceLine([first, sibling], first, "w3");
    expect(collided).toBe(false);
    expect(distances.map((d) => d.word).sort()).toEqual(["w2", "w3"]);
    expect(distances.find((d) => d.word === "w3")!.extra).toEqual({ rank: 1 });
  });

  test("re-coining the same word is a no-op", () => {
    const list = [distance({ word: "w" })];
    const out = recoinDistanceLine(list, list[0], "w");
    expect(out.collided).toBe(false);
    expect(out.distances).toEqual(list);
  });
});

describe("the distance file's bytes (regression: no double-encoding)", () => {
  test("known lines are canonical JSONL, not JSON-encoded strings", () => {
    expect(serializeDistances([distance()])).toBe(
      '{"from":"a","to":"b","word":"friend"}\n',
    );
  });

  test("a written file parses back to the same records", () => {
    const list = [distance(), distance({ from: "b", to: "a", word: "friend" })];
    const parsed = parseDistances(serializeDistances(list));
    expect(parsed.malformed).toEqual([]);
    expect(parsed.distances).toEqual(list);
  });

  test("malformed lines are re-emitted verbatim", () => {
    expect(serializeDistances([distance({ word: "w" })], ["{bad"])).toBe(
      '{"from":"a","to":"b","word":"w"}\n{bad\n',
    );
  });
});