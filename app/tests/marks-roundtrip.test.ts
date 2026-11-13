import { describe, expect, test } from "bun:test";
import {
  dedupeMarks,
  findOrphanMarks,
  hasMark,
  markTargetKey,
  parseMarkLine,
  parseMarks,
  retargetMark,
  serializeMarkLine,
  serializeMarks,
  withMark,
  withoutMark,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import { distanceKey } from "../src/map/distances";
import {
  dropMarksTouching,
  recoinWireMarks,
  rewriteMarkEndpoints,
} from "../src/map/patches";

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

describe("retargetMark moves the one mark (bind / unbind / grow)", () => {
  test("a bare spot line becomes the word's line, record and extras carried over", () => {
    const original = mark({ target: spot(12, -3.5), extra: { rank: 2 } });
    const next = retargetMark([original], spot(12, -3.5), word("why"));
    expect(next).toHaveLength(1);
    expect(next[0].target).toEqual(word("why"));
    expect(next[0].extra).toEqual({ rank: 2 });
    expect(serializeMarks(next)).toBe('{"kind":"open","on":"why","rank":2}\n');
  });

  test("moving onto an already-marked target leaves one line per key", () => {
    const next = retargetMark(
      [
        mark({ target: word("a"), extra: { rank: 1 } }),
        mark({ target: word("b"), extra: { rank: 2 } }),
      ],
      word("a"),
      word("b"),
    );
    expect(next).toHaveLength(1);
    // The app's move is the survivor (the re-coin collision rule).
    expect(next[0]).toEqual(mark({ target: word("b"), extra: { rank: 1 } }));
    expect(serializeMarks(next)).toBe('{"kind":"open","on":"b","rank":1}\n');
  });

  test("dropping on the source itself is a no-op (the same list)", () => {
    const marks = [mark()];
    expect(retargetMark(marks, word("rain"), word("rain"))).toBe(marks);
  });

  test("a missing source mark is a no-op", () => {
    const marks = [mark({ target: word("sea") })];
    expect(retargetMark(marks, word("rain"), word("sea"))).toBe(marks);
  });

  test("bind and unbind are the same move: word→wire and wire→spot", () => {
    const onWord = mark({ target: word("rain") });
    const onWire = retargetMark([onWord], word("rain"), wire("rain", "soil", "soaks"));
    expect(onWire.map((m) => m.target)).toEqual([wire("rain", "soil", "soaks")]);
    const bare = retargetMark(onWire, wire("rain", "soil", "soaks"), spot(10, 20));
    expect(bare.map((m) => m.target)).toEqual([spot(10, 20)]);
    expect(serializeMarks(bare)).toBe('{"kind":"open","x":10,"y":20}\n');
  });

  test("a mark of another kind is not the one moved", () => {
    const marks = [mark(), mark({ kind: "later", target: word("sea") })];
    const next = retargetMark(marks, word("rain"), word("sea"));
    expect(next).toHaveLength(2);
    expect(next.some((m) => m.kind === "open" && m.target.type === "word" && m.target.slug === "sea")).toBe(true);
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

describe("rename, remove and re-coin rewrite the file's bytes", () => {
  /** Apply one atomic patch to a marks document and write it back. */
  function patch(text: string, apply: (marks: Mark[]) => Mark[]): string {
    const parsed = parseMarks(text);
    return serializeMarks(apply(parsed.marks), parsed.malformed);
  }

  test("rename follows `on`, wire endpoints and both ends of a self-wire", () => {
    const before = serializeMarks(
      [
        mark({ target: word("old"), extra: { rank: 1 } }),
        mark({ target: wire("old", "b", "feeds") }),
        mark({ target: wire("old", "old", "loops") }),
        mark({ target: wire("a", "b", "old") }),
        mark({ target: spot(1, 2) }),
      ],
      ["{hand edit"],
    );

    const after = patch(before, (marks) => rewriteMarkEndpoints(marks, "old", "new"));

    // Collision rule: untouched marks first, rewritten ones last, so a stale
    // mark already sitting on the new slug loses to the app's renamed mark.
    expect(after).toBe(
      [
        '{"from":"a","kind":"open","to":"b","word":"old"}',
        '{"kind":"open","x":1,"y":2}',
        '{"kind":"open","on":"new","rank":1}',
        '{"from":"new","kind":"open","to":"b","word":"feeds"}',
        '{"from":"new","kind":"open","to":"new","word":"loops"}',
        "{hand edit",
        "",
      ].join("\n"),
    );
    // A wire word that spells the old slug is not an endpoint: the coin is the
    // person's word and a rename never rewrites it (ADR-0005, ADR-0009).
    expect(after).toContain('{"from":"a","kind":"open","to":"b","word":"old"}');
    // The malformed line is exactly the bytes nobody can read.
    expect(parseMarks(after).malformed).toEqual(["{hand edit"]);
    // Canonical: re-reading the rewritten file rewrites nothing.
    const reread = parseMarks(after);
    expect(serializeMarks(reread.marks, reread.malformed)).toBe(after);
  });

  test("remove drops every touching mark; bare spots and malformed lines stay byte-identical", () => {
    const before = serializeMarks(
      [
        mark({ target: word("old") }),
        mark({ target: wire("old", "b", "feeds") }),
        mark({ target: wire("c", "old", "reads") }),
        mark({ target: wire("a", "b", "old") }),
        mark({ target: spot(3, 4) }),
        mark({ target: word("sea") }),
      ],
      ["{bad json"],
    );

    const after = patch(before, (marks) => dropMarksTouching(marks, "old"));

    expect(after).toBe(
      [
        '{"from":"a","kind":"open","to":"b","word":"old"}',
        '{"kind":"open","x":3,"y":4}',
        '{"kind":"open","on":"sea"}',
        "{bad json",
        "",
      ].join("\n"),
    );
    // A wire whose word simply spells the removed slug is untouched, and the
    // malformed line survives the patch verbatim.
    expect(after).toContain('{"from":"a","kind":"open","to":"b","word":"old"}');
    expect(parseMarks(after).malformed).toEqual(["{bad json"]);
  });

  test("a free re-coin follows the relation and leaves the sibling on the pair", () => {
    const before = serializeMarks([
      mark({ target: wire("a", "b", "w1"), extra: { rank: 1 } }),
      mark({ target: wire("a", "b", "w2") }),
    ]);

    const after = patch(before, (marks) =>
      recoinWireMarks(marks, "a", "b", "w1", "w3", false),
    );

    expect(after).toBe(
      [
        '{"from":"a","kind":"open","to":"b","word":"w2"}',
        '{"from":"a","kind":"open","rank":1,"to":"b","word":"w3"}',
        "",
      ].join("\n"),
    );
  });

  test("a colliding re-coin pins the re-coined line and drops the collided mark", () => {
    const before = serializeMarks([
      mark({ target: wire("a", "b", "w1"), extra: { rank: 1 } }),
      mark({ target: wire("a", "b", "w2"), extra: { rank: 2 } }),
    ]);

    const after = patch(before, (marks) =>
      recoinWireMarks(marks, "a", "b", "w1", "w2", true),
    );

    expect(after).toBe(
      '{"from":"a","kind":"open","rank":1,"to":"b","word":"w2"}\n',
    );
    expect(after).not.toContain('"rank":2');
  });
});

describe("the first write is canonical; an absent file is no marks", () => {
  test("an absent or empty file parses as no marks", () => {
    // `loadMarks` maps the fs bridge's missing-file null to this same empty
    // parse; the bridge itself needs Tauri, so the pure half is asserted here.
    expect(parseMarks("")).toEqual({ marks: [], malformed: [] });
    expect(parseMarks("\n")).toEqual({ marks: [], malformed: [] });
    expect(parseMarks("\r\n")).toEqual({ marks: [], malformed: [] });
  });

  test("the first cast writes one canonical line with a trailing newline", () => {
    const first = serializeMarks([mark({ target: spot(12, -3.5) })]);
    expect(first).toBe('{"kind":"open","x":12,"y":-3.5}\n');
    // And the document the app would write again is the same bytes.
    expect(serializeMarks(parseMarks(first).marks)).toBe(first);
  });

  test("an empty marks document is a lone newline (the canonical empty JSONL)", () => {
    expect(serializeMarks([])).toBe("\n");
    expect(parseMarks(serializeMarks([])).marks).toEqual([]);
  });
});

describe("the file keeps one line per natural key", () => {
  test("ordered pair, reversed pair and a sibling on one pair are three lines", () => {
    const text = serializeMarks([
      mark({ target: wire("a", "b", "feeds") }),
      mark({ target: wire("b", "a", "feeds") }),
      mark({ target: wire("a", "b", "needs") }),
    ]);
    expect(text.split("\n").filter(Boolean)).toHaveLength(3);
    expect(serializeMarks(parseMarks(text).marks)).toBe(text);
  });

  test("re-casting the same mark in the file rewrites its only line", () => {
    const first = serializeMarks([mark({ extra: { rank: 1 } })]);
    const recast = serializeMarks(
      withMark(parseMarks(first).marks, mark({ extra: { rank: 2 } })),
    );
    expect(recast).toBe('{"kind":"open","on":"rain","rank":2}\n');
  });
});

describe("orphans are preserved and only hand-edit accidents are exposed", () => {
  test("orphan lines survive an unrelated save byte-for-byte", () => {
    const wordOrphan = serializeMarkLine(
      mark({ target: word("gone"), extra: { note: "why" } }),
    );
    const wireOrphan = serializeMarkLine(mark({ target: wire("gone", "away", "feeds") }));
    const text = `${wordOrphan}\n${wireOrphan}\n`;

    const parsed = parseMarks(text);
    const after = serializeMarks(
      withMark(parsed.marks, { kind: "open", target: word("rain"), extra: {} }),
    );

    expect(after).toContain(wordOrphan);
    expect(after).toContain(wireOrphan);
    const reread = parseMarks(after);
    expect(reread.malformed).toEqual([]);
    expect(serializeMarks(reread.marks)).toBe(after);
    // Only the two hand-edited leftovers are exposed; the app's new mark is not.
    expect(
      findOrphanMarks(reread.marks, new Set(["rain"]), new Set())
        .map(serializeMarkLine)
        .sort(),
    ).toEqual([wireOrphan, wordOrphan].sort());
  });

  test("a hand-edited known line keeps its content, in the app's canonical style", () => {
    // AGENTS.md: hand edits are welcome and come back in canonical style;
    // verbatim bytes are the guarantee only for lines the app cannot parse.
    const handEdited = '{ "kind": "open", "on": "gone", "note": "x" }';
    const parsed = parseMarks(handEdited);
    expect(parsed.malformed).toEqual([]);
    expect(serializeMarks(parsed.marks)).toBe(
      '{"kind":"open","note":"x","on":"gone"}\n',
    );
  });
});
