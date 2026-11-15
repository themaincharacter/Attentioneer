import { describe, expect, test } from "bun:test";
import {
  dedupe,
  hasWord,
  parseModel,
  prefilledSelection,
  serializeModel,
  withWord,
  withoutWord,
  type PlayingSet,
} from "../src/map/model";

/**
 * Story-1 guarantee, automated: map/model.json is one canonical JSON object —
 * sorted member slugs, unknown keys preserved, unreadable bytes preserved and
 * surfaced, a missing or empty file meaning no accepted set. Membership helpers
 * are the composed-join vocabulary (story 2); the selector's pre-fill is here
 * so "first entry shows every word" is asserted without a DOM.
 */

const playingSet = (
  words: string[],
  extra: Record<string, unknown> = {},
): PlayingSet => ({ words, extra });

describe("the first accepted set is canonical bytes", () => {
  test("sorted words, 2-space indent, sorted keys and a trailing newline", () => {
    expect(serializeModel(playingSet(["rain"]))).toBe(
      '{\n  "words": [\n    "rain"\n  ]\n}\n',
    );
    expect(serializeModel(playingSet(["soil", "rain"]))).toBe(
      '{\n  "words": [\n    "rain",\n    "soil"\n  ]\n}\n',
    );
    // Duplicates collapse and empty slugs never reach the file.
    expect(serializeModel(playingSet(["soil", "rain", "rain", ""]))).toBe(
      '{\n  "words": [\n    "rain",\n    "soil"\n  ]\n}\n',
    );
  });

  test("the canonical bytes re-read and re-write identically", () => {
    const text = serializeModel(playingSet(["soil", "rain"]));
    const parsed = parseModel(text);
    expect(parsed.malformed).toBeNull();
    expect(parsed.model).toEqual(playingSet(["rain", "soil"]));
    expect(serializeModel(parsed.model)).toBe(text);
  });

  test("an empty accepted set is a canonical object, not an empty file", () => {
    expect(serializeModel(playingSet([]))).toBe('{\n  "words": []\n}\n');
    expect(parseModel(serializeModel(playingSet([]))).model).toEqual(
      playingSet([]),
    );
  });
});

describe("a hand-edited file comes back canonical", () => {
  test("unsorted and duplicated words sort on read, rewrite sorted", () => {
    const parsed = parseModel('{"words":["soil","rain","soil"]}');
    expect(parsed.model!.words).toEqual(["rain", "soil"]);
    expect(serializeModel(parsed.model)).toBe(
      '{\n  "words": [\n    "rain",\n    "soil"\n  ]\n}\n',
    );
  });

  test("unknown top-level keys survive a rewrite", () => {
    const hand = serializeModel(playingSet(["rain"], { note: "why", rank: 3 }));
    expect(hand).toBe(
      '{\n  "note": "why",\n  "rank": 3,\n  "words": [\n    "rain"\n  ]\n}\n',
    );
    const parsed = parseModel(hand);
    expect(parsed.model).toEqual(playingSet(["rain"], { note: "why", rank: 3 }));
    // The keys sort alongside the record's own key, ADR-0004's style.
    expect(serializeModel(parsed.model)).toBe(hand);
  });

  test("a BOM and CRLF from a hand edit are tolerated", () => {
    const parsed = parseModel('\uFEFF{\r\n  "words": ["b", "a"]\r\n}\r\n');
    expect(parsed.model!.words).toEqual(["a", "b"]);
    expect(serializeModel(parsed.model)).toBe(
      '{\n  "words": [\n    "a",\n    "b"\n  ]\n}\n',
    );
  });
});

describe("a missing or empty file means no accepted set", () => {
  test("the fs bridge's null (missing file) is no set and no malformed bytes", () => {
    expect(parseModel(null)).toEqual({ model: null, malformed: null });
    // The bridge itself needs Tauri; the pure half is asserted as marks.ts's
    // missing-file case is (the model's loader maps null straight through).
  });

  test("an empty or whitespace-only file is tolerated as no set", () => {
    for (const text of ["", "\n", "  \n\t\n"]) {
      expect(parseModel(text)).toEqual({ model: null, malformed: null });
    }
  });

  test("no set writes nothing back unless a set is accepted", () => {
    expect(serializeModel(null)).toBe("");
    expect(serializeModel(null, null)).toBe("");
  });
});

describe("unreadable content is preserved and surfaced, never guessed at", () => {
  const bad = [
    "{bad json",
    "[]",
    "null",
    '"words"',
    '{"words":"rain"}',
    '{"words":[1]}',
    '{"words":["rain",null]}',
    '{"words":[""]}',
    '{"note":"no words key"}',
  ];

  test("each unreadable shape yields no set and reports its exact bytes", () => {
    for (const text of bad) {
      const parsed = parseModel(text);
      expect(parsed.model).toBeNull();
      expect(parsed.malformed).toBe(text);
    }
  });

  test("a write that does not accept a new set re-emits the bytes exactly", () => {
    for (const text of bad) {
      const parsed = parseModel(text);
      expect(serializeModel(parsed.model, parsed.malformed)).toBe(text);
    }
    // An explicit accept replaces them — the person's rewrite is the door.
    expect(serializeModel(playingSet(["rain"]), "{bad json")).toBe(
      '{\n  "words": [\n    "rain"\n  ]\n}\n',
    );
  });
});

describe("membership helpers", () => {
  test("dedupe sorts, removes duplicates and drops empty slugs", () => {
    expect(dedupe(["soil", "rain", "soil", ""])).toEqual(["rain", "soil"]);
    expect(dedupe([])).toEqual([]);
  });

  test("hasWord: no set means nothing is in play", () => {
    expect(hasWord(null, "rain")).toBe(false);
    expect(hasWord(playingSet(["rain"]), "rain")).toBe(true);
    expect(hasWord(playingSet(["rain"]), "soil")).toBe(false);
  });

  test("withWord joins once, sorted", () => {
    expect(withWord(playingSet(["soil"]), "rain").words).toEqual(["rain", "soil"]);
    expect(withWord(playingSet(["rain"]), "rain").words).toEqual(["rain"]);
  });

  test("withoutWord leaves the rest and keeps unknown keys", () => {
    const before = playingSet(["rain", "soil"], { note: "why" });
    const after = withoutWord(before, "rain");
    expect(after).toEqual({ words: ["soil"], extra: { note: "why" } });
    // Taking out a non-member changes nothing.
    expect(withoutWord(before, "mulch")).toEqual(before);
  });
});

describe("the selector opens pre-filled", () => {
  test("first entry (no set) pre-fills every current word", () => {
    expect(prefilledSelection(null, ["soil", "rain", "rain"])).toEqual([
      "rain",
      "soil",
    ]);
  });

  test("a re-run pre-fills the accepted set, limited to words on the map", () => {
    expect(
      prefilledSelection(playingSet(["rain", "gone"]), ["rain", "soil"]),
    ).toEqual(["rain"]);
  });

  test("an accepted empty set pre-fills nothing (absence is exclusion)", () => {
    expect(prefilledSelection(playingSet([]), ["rain", "soil"])).toEqual([]);
  });
});

describe("the shelf is a place, not an exclusion", () => {
  test("the selector's pool is every coined word — a shelved word included", () => {
    // The app hands the selector every reference slug; position past the fold
    // only decides the deferred/rejected read (ADR-0010), never membership.
    // Select-all therefore keeps set-aside words (story 1's test list).
    expect(prefilledSelection(null, ["mulch", "rain"])).toEqual([
      "mulch",
      "rain",
    ]);
  });
});
