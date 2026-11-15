import { describe, expect, test } from "bun:test";
import {
  addAssumption,
  assumptionKey,
  assumptionTargetKey,
  convergeAssumptionEdit,
  findAssumptions,
  findDuplicateAssumptions,
  findOrphanAssumptions,
  parseAssumptionLine,
  parseAssumptions,
  removeAssumption,
  reviseAssumption,
  serializeAssumptionLine,
  serializeAssumptions,
  targetsWithAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "../src/map/assumptions";
import { linkKey } from "../src/map/links";

/**
 * Story-4 guarantee at the record layer, automated (ADR-0012 decision 4):
 * `map/assumptions.jsonl` round-trips canonically — one line per claim on a
 * word, a signed link's wordless pair, a loop slug or a bare spot. The natural
 * key is target + text: several claims may sit on one target (a rival),
 * an identical re-statement rewrites its one line, a revision replaces the
 * line AT ITS INDEX, and an edit that lands on another line's key converges to
 * one line (the edited line survives with its unknown keys). Hand-edited
 * duplicate keys are preserved and surfaced, never deduped. A missing file
 * means no assumptions.
 */

const NL = "\n";

function a(
  text: string,
  target: AssumptionTarget,
  extra: Record<string, unknown> = {},
): Assumption {
  return { text, target, extra };
}

const word = (slug: string): AssumptionTarget => ({ type: "word", slug });
const link = (from: string, to: string): AssumptionTarget => ({
  type: "link",
  from,
  to,
});
const loop = (slug: string): AssumptionTarget => ({ type: "loop", slug });
const spot = (x: number, y: number): AssumptionTarget => ({ type: "spot", x, y });

describe("the assumption line's canonical bytes", () => {
  test("the first write is one canonical line with a trailing newline", () => {
    expect(
      serializeAssumptions([a("mulch holds the rain", word("mulch"))]),
    ).toBe('{"on":"mulch","text":"mulch holds the rain"}' + NL);
  });

  test("each target form serializes compactly, keys sorted", () => {
    expect(serializeAssumptionLine(a("stays damp", link("rain", "soil")))).toBe(
      '{"from":"rain","text":"stays damp","to":"soil"}',
    );
    expect(serializeAssumptionLine(a("goes round", loop("rain-loop")))).toBe(
      '{"loop":"rain-loop","text":"goes round"}',
    );
    expect(serializeAssumptionLine(a("holds", spot(12, -4)))).toBe(
      '{"text":"holds","x":12,"y":-4}',
    );
  });

  test("re-reading and re-writing is byte-stable (unicode and newlines too)", () => {
    const claims = [
      a("想法 — holds “water”", word("soil")),
      a("two\nlines\twith tabs and  spaces", spot(1.5, 2)),
    ];
    const once = serializeAssumptions(claims);
    expect(serializeAssumptions(parseAssumptions(once).assumptions)).toBe(once);
  });

  test("unknown keys survive a rewrite, sorting alongside the record's", () => {
    const parsed = parseAssumptionLine(
      '{"on":"soil","note":"why","text":"holds","rank":2}',
    )!;
    expect(parsed.extra).toEqual({ note: "why", rank: 2 });
    expect(serializeAssumptionLine(parsed)).toBe(
      '{"note":"why","on":"soil","rank":2,"text":"holds"}',
    );
  });

  test("an empty assumptions document is the canonical empty JSONL", () => {
    expect(serializeAssumptions([])).toBe(NL);
    expect(parseAssumptions("")).toEqual({
      assumptions: [],
      malformed: [],
      duplicates: [],
    });
    expect(parseAssumptions(NL)).toEqual({
      assumptions: [],
      malformed: [],
      duplicates: [],
    });
  });
});

describe("the four target kinds parse and serialize distinctly", () => {
  test("each form lands on its own target type", () => {
    expect(parseAssumptionLine('{"on":"soil","text":"x"}')!.target).toEqual(
      word("soil"),
    );
    expect(
      parseAssumptionLine('{"from":"rain","text":"x","to":"soil"}')!.target,
    ).toEqual(link("rain", "soil"));
    expect(
      parseAssumptionLine('{"loop":"rain-loop","text":"x"}')!.target,
    ).toEqual(loop("rain-loop"));
    expect(parseAssumptionLine('{"text":"x","x":12,"y":-4}')!.target).toEqual(
      spot(12, -4),
    );
  });

  test("the same slug on a word and on a loop is two different targets", () => {
    expect(assumptionTargetKey(word("rain"))).not.toBe(
      assumptionTargetKey(loop("rain")),
    );
    expect(assumptionTargetKey(word("rain"))).not.toBe(
      assumptionTargetKey(link("rain", "rain")),
    );
    expect(assumptionTargetKey(link("a", "b"))).not.toBe(
      assumptionTargetKey(link("b", "a")),
    );
    expect(assumptionTargetKey(spot(1, 2))).not.toBe(
      assumptionTargetKey(spot(2, 1)),
    );
  });

  test("no cross-ambiguity: a wire's word is never an assumption target", () => {
    // The distance/wire grammar carries a coined word; an assumption does
    // not, so such a line is malformed rather than guessed into a pair target.
    expect(
      parseAssumptionLine('{"from":"a","text":"x","to":"b","word":"feeds"}'),
    ).toBeNull();
    // Mixing two target forms is malformed too.
    expect(parseAssumptionLine('{"loop":"l","on":"a","text":"x"}')).toBeNull();
    expect(parseAssumptionLine('{"on":"a","text":"x","x":1,"y":2}')).toBeNull();
    // Half a pair or half a spot is not a target.
    expect(parseAssumptionLine('{"from":"a","text":"x"}')).toBeNull();
    expect(parseAssumptionLine('{"text":"x","x":1}')).toBeNull();
    expect(parseAssumptionLine('{"from":"a","text":"x","to":""}')).toBeNull();
  });

  test("a claim needs a non-empty text", () => {
    expect(parseAssumptionLine('{"on":"a"}')).toBeNull();
    expect(parseAssumptionLine('{"on":"a","text":""}')).toBeNull();
    expect(parseAssumptionLine('{"on":"a","text":"   "}')).toBeNull();
    expect(parseAssumptionLine('{"on":"a","text":3}')).toBeNull();
    expect(parseAssumptionLine('{"on":"","text":"x"}')).toBeNull();
    expect(parseAssumptionLine("[1,2,3]")).toBeNull();
    expect(parseAssumptionLine("{bad json}")).toBeNull();
  });
});

describe("tolerant read of the assumptions file", () => {
  test("blank lines, CRLF, a BOM and terminating newlines are tolerated", () => {
    const parsed = parseAssumptions(
      '\uFEFF{"on":"soil","text":"holds"}\r\n\r\n',
    );
    expect(parsed.malformed).toEqual([]);
    expect(parsed.duplicates).toEqual([]);
    expect(parsed.assumptions).toEqual([a("holds", word("soil"))]);
  });

  test("malformed and out-of-shape lines surface verbatim, never dropped", () => {
    const text = [
      "{bad json}",
      "[1,2,3]",
      '{"text":"x"}', // no target
      '{"on":"a","text":"x","x":1,"y":2}', // two targets mixed
      '{"from":"a","text":"x"}', // half a pair
      '{"on":"a","text":""}', // an empty claim is not a claim
      '{"on":"soil","text":"holds"}',
    ].join(NL);
    const parsed = parseAssumptions(text);
    expect(parsed.assumptions).toEqual([a("holds", word("soil"))]);
    expect(parsed.malformed).toHaveLength(6);
    expect(parsed.malformed[0]).toBe("{bad json}");
    // Malformed lines are re-emitted byte-identically, after the known lines.
    const written = serializeAssumptions(parsed.assumptions, parsed.malformed);
    expect(written).toContain("{bad json}" + NL);
    expect(written).toContain('{"text":"x"}' + NL);
  });

  test("a hand-edited known line comes back canonical", () => {
    const parsed = parseAssumptions(
      '{ "text": "holds", "on": "soil", "rank": 1 }',
    );
    expect(parsed.malformed).toEqual([]);
    expect(serializeAssumptions(parsed.assumptions)).toBe(
      '{"on":"soil","rank":1,"text":"holds"}' + NL,
    );
  });
});

describe("the natural key is target + text", () => {
  test("the key names the address and the claim", () => {
    expect(assumptionKey(a("holds", word("soil")))).not.toBe(
      assumptionKey(a("holds wetter", word("soil"))),
    );
    expect(assumptionKey(a("holds", word("soil")))).not.toBe(
      assumptionKey(a("holds", word("rain"))),
    );
    expect(assumptionKey(a("holds", word("soil")))).toBe(
      assumptionKey(a("holds", word("soil"), { rank: 9 })),
    );
  });

  test("several claims sit on one target: findAssumptions keeps FILE ORDER", () => {
    const claims = [
      a("mulch holds the rain", word("mulch")),
      a("rain feeds the soil", link("rain", "soil")),
      a("mulch is patchy", word("mulch")),
      a("a rival", word("mulch")),
    ];
    const found = findAssumptions(claims, word("mulch"));
    expect(found.map((entry) => entry.assumption.text)).toEqual([
      "mulch holds the rain",
      "mulch is patchy",
      "a rival",
    ]);
    expect(found.map((entry) => entry.index)).toEqual([0, 2, 3]);
    expect(targetsWithAssumptions(claims)).toEqual([
      word("mulch"),
      link("rain", "soil"),
    ]);
  });
});

describe("stating a claim", () => {
  test("a new claim appends one line in file order", () => {
    const first = addAssumption([], "mulch holds the rain", word("mulch"));
    const both = addAssumption(first, "mulch is patchy", word("mulch"));
    expect(both.map((claim) => claim.text)).toEqual([
      "mulch holds the rain",
      "mulch is patchy",
    ]);
  });

  test("stating the identical claim rewrites its one line, not a second", () => {
    const first = addAssumption(
      [],
      "mulch holds the rain",
      word("mulch"),
      { note: "why" },
    );
    const again = addAssumption(first, "mulch holds the rain", word("mulch"));
    expect(again).toHaveLength(1);
    expect(again[0]).toEqual(first[0]);
    // Whitespace is trimmed at the edges; the prose inside is untouched.
    const spaced = addAssumption([], "  mulch holds the rain  ", word("mulch"));
    expect(spaced[0].text).toBe("mulch holds the rain");
  });

  test("an empty claim writes nothing", () => {
    expect(addAssumption([], "", word("mulch"))).toEqual([]);
    expect(addAssumption([], "   ", spot(1, 2))).toEqual([]);
  });

  test("unknown keys ride with a newly stated claim", () => {
    const claims = addAssumption([], "holds", word("soil"), { rank: 1 });
    expect(serializeAssumptions(claims)).toBe(
      '{"on":"soil","rank":1,"text":"holds"}' + NL,
    );
  });
});

describe("revising replaces the line IN PLACE at its index", () => {
  test("one line changes, order and neighbours are stable", () => {
    const claims = [
      a("one", word("a")),
      a("two", word("a"), { rank: 2 }),
      a("three", word("a")),
    ];
    const next = reviseAssumption(claims, 1, "two, revised");
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(claims[0]);
    expect(next[1]).toEqual(a("two, revised", word("a"), { rank: 2 }));
    expect(next[2]).toBe(claims[2]);
    expect(next.map((claim) => claim.text)).toEqual([
      "one",
      "two, revised",
      "three",
    ]);
  });

  test("a revision to a brand-new key never moves to the end", () => {
    const claims = [a("one", word("a")), a("two", word("a"))];
    const next = reviseAssumption(claims, 0, "something else");
    expect(next[0].text).toBe("something else");
    expect(next.map((claim) => claim.text)).toEqual([
      "something else",
      "two",
    ]);
  });

  test("an unknown index or an empty claim is a quiet no-op", () => {
    const claims = [a("one", word("a"))];
    expect(reviseAssumption(claims, 4, "x")).toEqual(claims);
    expect(reviseAssumption(claims, -1, "x")).toEqual(claims);
    expect(reviseAssumption(claims, 0, "  ")).toEqual(claims);
  });
});

describe("edit-convergence: A edited into B's key leaves ONE line", () => {
  test("the edited line survives at its index with its own unknown keys; B is dropped", () => {
    const b = a("mulch is patchy", word("mulch"), { from: "b" });
    const claims = [
      a("mulch holds the rain", word("mulch"), { from: "a" }),
      a("unrelated", spot(1, 2)),
      b,
    ];
    const edit = convergeAssumptionEdit(claims, 0, "mulch is patchy");
    expect(edit.dropped).toEqual([b]);
    expect(edit.assumptions).toHaveLength(2);
    expect(edit.assumptions[0]).toEqual(
      a("mulch is patchy", word("mulch"), { from: "a" }),
    );
    expect(edit.assumptions[1]).toEqual(a("unrelated", spot(1, 2)));
    expect(findDuplicateAssumptions(edit.assumptions)).toEqual([]);
    // Revising through the list API is the same rule.
    expect(reviseAssumption(claims, 0, "mulch is patchy")).toEqual(
      edit.assumptions,
    );
  });

  test("a colliding line BEFORE the edit shifts the survivor's index by one", () => {
    const b = a("same", word("a"), { from: "b" });
    const claims = [
      b,
      a("other", word("a"), { from: "a" }),
      a("tail", word("a")),
    ];
    const edit = convergeAssumptionEdit(claims, 1, "same");
    expect(edit.dropped).toEqual([b]);
    expect(edit.assumptions.map((claim) => claim.text)).toEqual([
      "same",
      "tail",
    ]);
    expect(edit.assumptions[0].extra).toEqual({ from: "a" });
  });

  test("the same text on a DIFFERENT target is not a collision", () => {
    const claims = [a("holds", word("a")), a("holds", word("b"))];
    expect(reviseAssumption(claims, 0, "holds")).toEqual(claims);
    expect(convergeAssumptionEdit(claims, 0, "holds").dropped).toEqual([]);
  });

  test("a converging edit against a hand-duplicated key drops only the colliding lines", () => {
    const claims = [
      a("one", word("a"), { n: 1 }),
      a("two", word("a"), { n: 2 }),
      a("two", word("a"), { n: 3 }),
    ];
    const edit = convergeAssumptionEdit(claims, 0, "two");
    expect(edit.assumptions).toHaveLength(1);
    expect(edit.assumptions[0].extra).toEqual({ n: 1 });
    expect(edit.dropped).toHaveLength(2);
  });
});

describe("removal is ammo", () => {
  test("the line goes, order is kept, no tombstone", () => {
    const claims = [
      a("one", word("a")),
      a("two", word("a")),
      a("three", word("a")),
    ];
    expect(removeAssumption(claims, 1).map((claim) => claim.text)).toEqual([
      "one",
      "three",
    ]);
    expect(removeAssumption(claims, 9)).toEqual(claims);
  });
});

describe("hand-edited duplicate keys are preserved AND surfaced, never deduped", () => {
  const text = [
    '{"on":"mulch","text":"mulch holds the rain"}',
    '{"on":"mulch","text":"mulch holds the rain"}',
    '{"on":"mulch","text":"mulch is patchy"}',
  ].join(NL);

  test("the read keeps every line and reports the duplicate", () => {
    const parsed = parseAssumptions(text);
    expect(parsed.assumptions).toHaveLength(3);
    expect(parsed.duplicates).toHaveLength(1);
    expect(parsed.duplicates[0].text).toBe("mulch holds the rain");
    expect(findDuplicateAssumptions(parsed.assumptions)).toEqual(
      parsed.duplicates,
    );
  });

  test("a write on an unrelated move never collapses the duplicates", () => {
    const parsed = parseAssumptions(text);
    const next = addAssumption(parsed.assumptions, "new claim", word("soil"));
    expect(next).toHaveLength(4);
    const written = serializeAssumptions(next, parsed.malformed);
    expect(written.split(NL).filter(Boolean)).toHaveLength(4);
    expect(written.split(NL)[0]).toBe(written.split(NL)[1]);
  });

  test("a duplicate on another target is surfaced on its own", () => {
    const parsed = parseAssumptions(
      [
        '{"on":"a","text":"x"}',
        '{"on":"b","text":"x"}',
        '{"on":"a","text":"x"}',
      ].join(NL),
    );
    expect(parsed.assumptions).toHaveLength(3);
    expect(parsed.duplicates).toHaveLength(1);
  });
});

describe("orphaned targets are surfaced, never guessed away", () => {
  test("a missing word, link or loop is an orphan; a bare spot never is", () => {
    const claims = [
      a("on a word", word("gone")),
      a("on a link", link("gone", "also-gone")),
      a("on a loop", loop("gone-loop")),
      a("on a spot", spot(3, 4)),
      a("still fine", word("here")),
    ];
    const orphans = findOrphanAssumptions(
      claims,
      new Set(["here"]),
      new Set([linkKey("here", "here")]),
      new Set(["kept-loop"]),
    );
    expect(orphans.map((claim) => claim.text)).toEqual([
      "on a word",
      "on a link",
      "on a loop",
    ]);
  });
});
