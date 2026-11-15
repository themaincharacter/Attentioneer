import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  convergeQuantityEdit,
  findDuplicateQuantities,
  findOrphanQuantities,
  findOutOfPlayQuantities,
  findQuantity,
  formatAmount,
  isValidAmount,
  parseAmountInput,
  parseQuantities,
  parseQuantityLine,
  quantityKey,
  quantityTargetKey,
  quantityWords,
  removeQuantity,
  removeQuantityAt,
  serializeQuantities,
  serializeQuantityLine,
  setQuantity,
  type Quantity,
  type QuantityTarget,
} from "../src/map/quantities";

/**
 * Story-1 guarantee at the record layer, automated (ADR-0020):
 * `map/quantities.jsonl` round-trips canonically in TWO shapes — a stock line
 * `{on, amount?}` and a flow line `{from, to, amount?}` — where the shape IS
 * the type (no `kind` field) and the natural key is `on` or `from`+`to`.
 *
 * The amount is authored and OPTIONAL: absent means UNKNOWN, 0 means a stated
 * zero, and no line means no quantity — three different states that never
 * collapse. A negative, non-finite or null amount is out of shape, preserved
 * verbatim as malformed. Unknown keys survive rewrites; a hand-edited duplicate
 * key is preserved and surfaced; a missing file means no quantities.
 *
 * Quantities NEVER join or scope (ADR-0020 decision 3): the module never reads
 * or writes the playing set, so a line on a pruned word stays exactly where it
 * is and is surfaced as out of play — it can never resurrect the word.
 */

const NL = "\n";

function stock(
  on: string,
  amount: number | null = null,
  extra: Record<string, unknown> = {},
): Quantity {
  return { type: "stock", on, amount, extra };
}

function flow(
  from: string,
  to: string,
  amount: number | null = null,
  extra: Record<string, unknown> = {},
): Quantity {
  return { type: "flow", from, to, amount, extra };
}

const stockTarget = (on: string): QuantityTarget => ({ type: "stock", on });
const flowTarget = (from: string, to: string): QuantityTarget => ({
  type: "flow",
  from,
  to,
});

describe("the quantity line's canonical bytes (two shapes, no kind)", () => {
  test("a stock line is one canonical compact line with a trailing newline", () => {
    expect(serializeQuantities([stock("soil", 12)])).toBe(
      '{"amount":12,"on":"soil"}' + NL,
    );
  });

  test("a flow line serializes compactly, keys sorted", () => {
    expect(serializeQuantities([flow("rain", "soil", 3)])).toBe(
      '{"amount":3,"from":"rain","to":"soil"}' + NL,
    );
  });

  test("the shape IS the type: no kind field is ever written", () => {
    const written = serializeQuantities([
      stock("soil", 1),
      flow("rain", "soil", 2),
    ]);
    expect(written).not.toContain("kind");
    expect(written).not.toContain('"type"');
  });

  test("an absent amount writes NO amount key — unknown is not 0", () => {
    expect(serializeQuantityLine(stock("soil"))).toBe('{"on":"soil"}');
    expect(serializeQuantityLine(flow("rain", "soil"))).toBe(
      '{"from":"rain","to":"soil"}',
    );
  });

  test("a stated 0 writes the amount, and decimals are kept exactly", () => {
    expect(serializeQuantityLine(stock("soil", 0))).toBe('{"amount":0,"on":"soil"}');
    expect(serializeQuantityLine(flow("rain", "soil", 1.5))).toBe(
      '{"amount":1.5,"from":"rain","to":"soil"}',
    );
    expect(serializeQuantityLine(stock("soil", 0.25))).toBe(
      '{"amount":0.25,"on":"soil"}',
    );
  });

  test("unknown keys survive a rewrite, sorting alongside the record's", () => {
    const parsed = parseQuantityLine(
      '{"on":"soil","note":"why","amount":2,"rank":1}',
    )!;
    expect(parsed.extra).toEqual({ note: "why", rank: 1 });
    expect(serializeQuantityLine(parsed)).toBe(
      '{"amount":2,"note":"why","on":"soil","rank":1}',
    );
  });

  test("re-reading and re-writing is byte-stable", () => {
    const records = [stock("soil", 12.5, { note: "想法" }), flow("rain", "soil")];
    const once = serializeQuantities(records);
    expect(serializeQuantities(parseQuantities(once).quantities)).toBe(once);
  });

  test("an empty quantities document is the canonical empty JSONL", () => {
    expect(serializeQuantities([])).toBe(NL);
    expect(parseQuantities("")).toEqual({
      quantities: [],
      malformed: [],
      duplicates: [],
    });
    expect(parseQuantities(NL)).toEqual({
      quantities: [],
      malformed: [],
      duplicates: [],
    });
  });
});

describe("the two shapes parse distinctly and are never guessed at", () => {
  test("on alone is a stock; from+to together is a flow (ordered pair)", () => {
    expect(parseQuantityLine('{"on":"soil","amount":4}')).toEqual(
      stock("soil", 4),
    );
    expect(
      parseQuantityLine('{"from":"rain","to":"soil","amount":2}'),
    ).toEqual(flow("rain", "soil", 2));
    // The ordered pair: A→B and B→A are two different flows.
    expect(parseQuantityLine('{"from":"rain","to":"soil"}')).not.toEqual(
      parseQuantityLine('{"from":"soil","to":"rain"}'),
    );
  });

  test("mixed shapes, half pairs and no target are malformed", () => {
    expect(
      parseQuantityLine('{"on":"a","from":"b","to":"c","amount":1}'),
    ).toBeNull();
    expect(parseQuantityLine('{"from":"a","amount":1}')).toBeNull();
    expect(parseQuantityLine('{"to":"a","amount":1}')).toBeNull();
    expect(parseQuantityLine('{"amount":1}')).toBeNull();
    expect(parseQuantityLine('{"on":""}')).toBeNull();
    expect(parseQuantityLine('{"from":"","to":"b"}')).toBeNull();
    expect(parseQuantityLine('{"from":"a","to":""}')).toBeNull();
    expect(parseQuantityLine("[]")).toBeNull();
    expect(parseQuantityLine("{bad json}")).toBeNull();
  });

  test("an amount must be a non-negative finite number; unknown is ABSENCE", () => {
    // Absent is legal and reads as the unknown state, never as 0.
    expect(parseQuantityLine('{"on":"soil"}')!.amount).toBeNull();
    // A stated 0 is legal and is NOT the same state.
    expect(parseQuantityLine('{"on":"soil","amount":0}')!.amount).toBe(0);
    // Out-of-shape amounts are malformed, never clamped, never read as unknown.
    expect(parseQuantityLine('{"on":"soil","amount":-1}')).toBeNull();
    expect(parseQuantityLine('{"on":"soil","amount":null}')).toBeNull();
    expect(parseQuantityLine('{"on":"soil","amount":"12"}')).toBeNull();
    expect(parseQuantityLine('{"on":"soil","amount":[1]}')).toBeNull();
    expect(parseQuantityLine('{"on":"soil","amount":1e400}')).toBeNull();
  });

  test("validity is the record's own rule", () => {
    expect(isValidAmount(0)).toBe(true);
    expect(isValidAmount(12)).toBe(true);
    expect(isValidAmount(0.5)).toBe(true);
    expect(isValidAmount(-0)).toBe(true);
    expect(isValidAmount(-0.5)).toBe(false);
    expect(isValidAmount(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isValidAmount(Number.NaN)).toBe(false);
    expect(isValidAmount("3")).toBe(false);
    expect(isValidAmount(null)).toBe(false);
  });
});

describe("a tolerant read of the quantities file", () => {
  test("missing (null) and empty files mean no quantities", () => {
    expect(parseQuantities(null)).toEqual({
      quantities: [],
      malformed: [],
      duplicates: [],
    });
    // The loader hands `readTextFile`'s null straight to the same reading.
    const source = readFileSync(
      new URL("../src/map/quantities.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("parseQuantities(await readTextFile(");
  });

  test("blank lines, CRLF, a BOM and terminating newlines are tolerated", () => {
    const parsed = parseQuantities(
      '\uFEFF{"on":"soil","amount":2}\r\n\r\n',
    );
    expect(parsed.malformed).toEqual([]);
    expect(parsed.quantities).toEqual([stock("soil", 2)]);
  });

  test("malformed lines surface verbatim, never dropped", () => {
    const text = [
      "{bad}",
      '{"on":"a","amount":-1}',
      '{"amount":1}',
      "[1]",
      '{"on":"soil","amount":2}',
    ].join(NL);
    const parsed = parseQuantities(text);
    expect(parsed.quantities).toEqual([stock("soil", 2)]);
    expect(parsed.malformed).toHaveLength(4);
    expect(parsed.malformed[0]).toBe("{bad}");
    const written = serializeQuantities(parsed.quantities, parsed.malformed);
    expect(written).toContain("{bad}" + NL);
    expect(written).toContain('{"on":"a","amount":-1}' + NL);
  });

  test("a hand-edited known line comes back canonical", () => {
    const parsed = parseQuantities(
      '{ "amount": 2, "on": "soil", "rank": 1 }',
    );
    expect(parsed.malformed).toEqual([]);
    expect(serializeQuantities(parsed.quantities)).toBe(
      '{"amount":2,"on":"soil","rank":1}' + NL,
    );
  });
});

describe("the natural key: on (stock) or from+to (flow)", () => {
  test("the two shapes never share a key, and a flow's order matters", () => {
    expect(quantityKey(stock("rain"))).not.toBe(quantityKey(flow("rain", "rain")));
    expect(quantityKey(flow("rain", "soil"))).not.toBe(
      quantityKey(flow("soil", "rain")),
    );
    expect(quantityKey(stock("rain", 1))).toBe(quantityKey(stock("rain", 9)));
    expect(quantityTargetKey(stockTarget("rain"))).toBe(
      quantityTargetKey(stock("rain")),
    );
  });

  test("a line names its words (one for a stock, two for a flow)", () => {
    expect(quantityWords(stock("soil", 1))).toEqual(["soil"]);
    expect(quantityWords(flow("rain", "soil"))).toEqual(["rain", "soil"]);
  });

  test("findQuantity reports the line and its file index", () => {
    const records = [stock("soil", 1), flow("rain", "soil", 2)];
    expect(findQuantity(records, flowTarget("rain", "soil"))).toEqual({
      quantity: records[1],
      index: 1,
    });
    expect(findQuantity(records, flowTarget("soil", "rain"))).toBeNull();
    expect(findQuantity(records, stockTarget("mulch"))).toBeNull();
  });
});

describe("writing: replace in place, with edit-convergence", () => {
  test("a new amount appends one line in file order", () => {
    const first = setQuantity([], stockTarget("soil"), 12);
    const both = setQuantity(first, flowTarget("rain", "soil"), 3);
    expect(both.map(serializeQuantityLine)).toEqual([
      '{"amount":12,"on":"soil"}',
      '{"amount":3,"from":"rain","to":"soil"}',
    ]);
  });

  test("an existing amount is rewritten AT ITS INDEX, order and neighbours stable", () => {
    const records = [stock("a", 1), flow("rain", "soil", 2), stock("b", 3)];
    const next = setQuantity(records, flowTarget("rain", "soil"), 7);
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(records[0]);
    expect(next[1]).toEqual(flow("rain", "soil", 7));
    expect(next[2]).toBe(records[2]);
    expect(next[1].extra).toEqual({});
  });

  test("unknown keys ride along an in-place rewrite", () => {
    const records = [stock("soil", 2, { note: "why", rank: 1 })];
    const next = setQuantity(records, stockTarget("soil"), 0);
    expect(next[0]).toEqual(stock("soil", 0, { note: "why", rank: 1 }));
  });

  test("an edit converges a hand-duplicated key: one line survives with its extras", () => {
    const records = [
      stock("soil", 1, { from: "a" }),
      stock("other", 9),
      stock("soil", 5, { from: "b" }),
      stock("soil", 8, { from: "c" }),
    ];
    const edit = convergeQuantityEdit(records, 0, 2);
    expect(edit.dropped).toEqual([
      stock("soil", 5, { from: "b" }),
      stock("soil", 8, { from: "c" }),
    ]);
    expect(edit.quantities).toEqual([
      stock("soil", 2, { from: "a" }),
      stock("other", 9),
    ]);
    expect(findDuplicateQuantities(edit.quantities)).toEqual([]);
    // setQuantity runs the same rule through the target's first index.
    expect(setQuantity(records, stockTarget("soil"), 2)).toEqual(
      edit.quantities,
    );
  });

  test("an unknown index or an out-of-shape amount is a quiet no-op", () => {
    const records = [stock("soil", 1)];
    expect(convergeQuantityEdit(records, 4, 2)).toEqual({
      quantities: records,
      dropped: [],
    });
    expect(convergeQuantityEdit(records, -1, 2).quantities).toEqual(records);
    expect(convergeQuantityEdit(records, 0, -2).quantities).toEqual(records);
    expect(convergeQuantityEdit(records, 0, Number.NaN).quantities).toEqual(
      records,
    );
    expect(setQuantity(records, stockTarget("soil"), -2)).toEqual(records);
  });

  test("null is the reachable UNKNOWN line: the writer never writes 0 in its place", () => {
    const unknown = setQuantity([], stockTarget("soil"), null);
    expect(unknown[0].amount).toBeNull();
    expect(serializeQuantities(unknown)).toBe('{"on":"soil"}' + NL);
    // A later commit of 0 IS a stated zero and writes it.
    const zero = setQuantity(unknown, stockTarget("soil"), 0);
    expect(zero[0].amount).toBe(0);
    expect(serializeQuantities(zero)).toBe('{"amount":0,"on":"soil"}' + NL);
  });
});

describe("removing a line is ammo", () => {
  test("by index: one line goes, order kept, no tombstone", () => {
    const records = [stock("a", 1), flow("rain", "soil", 2), stock("b", 3)];
    expect(removeQuantityAt(records, 1)).toEqual([records[0], records[2]]);
    expect(removeQuantityAt(records, 9)).toEqual(records);
  });

  test("by target: one target's line goes (a hand duplicate too); others stay", () => {
    const records = [
      stock("soil", 1),
      flow("rain", "soil", 2),
      stock("soil", 3),
      stock("rain", 4),
    ];
    expect(removeQuantity(records, stockTarget("soil"))).toEqual([
      flow("rain", "soil", 2),
      stock("rain", 4),
    ]);
  });
});

describe("hand-edited duplicates are preserved AND surfaced, never deduped", () => {
  const text = [
    '{"on":"soil","amount":1}',
    '{"on":"soil","amount":2}',
    '{"from":"rain","to":"soil","amount":3}',
  ].join(NL);

  test("the read keeps every line and reports the duplicate", () => {
    const parsed = parseQuantities(text);
    expect(parsed.quantities).toHaveLength(3);
    expect(parsed.duplicates).toEqual([stock("soil", 2)]);
    expect(findDuplicateQuantities(parsed.quantities)).toEqual(parsed.duplicates);
  });

  test("a write on an unrelated target never collapses the duplicates", () => {
    const parsed = parseQuantities(text);
    const next = setQuantity(parsed.quantities, stockTarget("mulch"), 5);
    expect(next).toHaveLength(4);
    const written = serializeQuantities(next, parsed.malformed);
    expect(written.split(NL).filter(Boolean)).toHaveLength(4);
    expect(written.split(NL)[0]).toBe('{"amount":1,"on":"soil"}');
    expect(written.split(NL)[1]).toBe('{"amount":2,"on":"soil"}');
  });
});

describe("quantities never join and never scope (ADR-0020 decision 3)", () => {
  test("the module never reaches the playing set or a membership write", () => {
    const source = readFileSync(
      new URL("../src/map/quantities.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain('from "./model"');
    expect(source).not.toContain("joinWords");
    expect(source).not.toContain("saveModel");
    expect(source).not.toContain("PlayingSet");
  });

  test("a hand-edited line on a pruned word is preserved, never resurrecting it", () => {
    const records = [stock("pruned", 4), flow("pruned", "soil", 2)];
    const playing = new Set(["soil"]);
    const words = new Set(["pruned", "soil"]);
    // The record still names the pruned word: it is surfaced as out of play...
    expect(findOutOfPlayQuantities(records, playing, words)).toEqual(records);
    // ...while the pure write is an array write and nothing else: no set.
    const written = setQuantity(records, stockTarget("pruned"), 9);
    expect(written[0]).toEqual(stock("pruned", 9));
    expect(serializeQuantities(written)).toContain('"on":"pruned"');
  });

  test("no accepted set means nothing is out of play (the outOfPlay reading)", () => {
    const records = [stock("rain", 1)];
    expect(findOutOfPlayQuantities(records, null, new Set(["rain"]))).toEqual(
      [],
    );
    expect(
      findOutOfPlayQuantities(records, new Set(), new Set(["rain"])),
    ).toEqual(records);
  });

  test("orphans are a missing word at either end; a kept word is not an orphan", () => {
    const records = [
      stock("gone", 1),
      flow("gone", "also-gone", 2),
      flow("here", "gone", 3),
      flow("here", "also-here", 4),
    ];
    expect(findOrphanQuantities(records, new Set(["here", "also-here"]))).toEqual(
      [records[0], records[1], records[2]],
    );
    // An on-map word OUT of play is the out-of-play read's, not the orphan's.
    expect(
      findOrphanQuantities([stock("here", 1)], new Set(["here"])),
    ).toEqual([]);
  });
});

describe("the authoring field's reading (provisional)", () => {
  test("blank is the reachable unknown; a number commits as typed", () => {
    expect(parseAmountInput("")).toEqual({ ok: true, amount: null });
    expect(parseAmountInput("   ")).toEqual({ ok: true, amount: null });
    expect(parseAmountInput("0")).toEqual({ ok: true, amount: 0 });
    expect(parseAmountInput("12")).toEqual({ ok: true, amount: 12 });
    expect(parseAmountInput(" 1.5 ")).toEqual({ ok: true, amount: 1.5 });
    expect(parseAmountInput("1e3")).toEqual({ ok: true, amount: 1000 });
  });

  test("a negative or unreadable entry is REFUSED, never clamped to 0", () => {
    for (const text of ["-1", "-0.5", "abc", "1,5", "01", "+2", ".5", "1.", "1e400"]) {
      expect(parseAmountInput(text)).toEqual({ ok: false });
    }
  });

  test("the display formatting is the number as a JSON number spells it", () => {
    expect(formatAmount(0)).toBe("0");
    expect(formatAmount(12)).toBe("12");
    expect(formatAmount(1.5)).toBe("1.5");
  });
});
