import { describe, expect, test } from "bun:test";
import {
  dedupeLinks,
  drawLink,
  findLink,
  flipLink,
  hasLink,
  linkKey,
  parseLinkLine,
  parseLinks,
  removeLink,
  serializeLinkLine,
  serializeLinks,
  SIGNS,
  type Link,
} from "../src/map/links";

/**
 * Story-2 guarantee, automated: `map/links.jsonl` round-trips canonically —
 * one line per ORDERED pair, the sign exactly as authored, unknown keys kept,
 * malformed lines preserved and surfaced, a missing file meaning no links.
 * Flipping rewrites the line in place at its index (never an append), and
 * A→B and B→A coexist as two lines over one pair-spine (ADR-0014).
 */

const NL = "\n";

function link(over: Partial<Link> = {}): Link {
  return { from: "a", to: "b", sign: "+", extra: {}, ...over };
}

function roundTrip(l: Link): string {
  return serializeLinkLine(parseLinkLine(serializeLinkLine(l))!);
}

describe("the link line's canonical bytes", () => {
  test("compact, sorted keys, the ordered pair and the ASCII sign", () => {
    expect(serializeLinkLine(link())).toBe('{"from":"a","sign":"+","to":"b"}');
    expect(serializeLinkLine(link({ sign: "-" }))).toBe(
      '{"from":"a","sign":"-","to":"b"}',
    );
  });

  test("the first write is one canonical line with a trailing newline", () => {
    expect(serializeLinks([link()])).toBe('{"from":"a","sign":"+","to":"b"}' + NL);
    // And the document the app would write again is the same bytes.
    expect(serializeLinks(parseLinks(serializeLinks([link()])).links)).toBe(
      '{"from":"a","sign":"+","to":"b"}' + NL,
    );
  });

  test("unicode, quotes and backslashes in slugs round-trip byte-for-byte", () => {
    for (const slug of ['say "hi"', "back\\slash", "想法", "line" + NL + "break"]) {
      const l = link({ from: slug, to: "b" });
      expect(roundTrip(l)).toBe(serializeLinkLine({ ...l, extra: {} }));
    }
  });

  test("both signs are the only legal values, and both round-trip", () => {
    expect([...SIGNS]).toEqual(["+", "-"]);
    for (const sign of SIGNS) {
      expect(parseLinkLine(serializeLinkLine(link({ sign })))!.sign).toBe(sign);
    }
  });

  test("unknown keys survive a rewrite", () => {
    const l = link({ extra: { note: "why", rank: 3 } });
    const parsed = parseLinkLine(serializeLinkLine(l))!;
    expect(parsed.extra).toEqual({ note: "why", rank: 3 });
    // The unknown keys sort alongside the record's own keys (ADR-0004).
    expect(serializeLinkLine(parsed)).toBe(
      '{"from":"a","note":"why","rank":3,"sign":"+","to":"b"}',
    );
  });

  test("a self-link is legal and unremarkable", () => {
    const l = link({ from: "x", to: "x", sign: "-" });
    expect(roundTrip(l)).toBe('{"from":"x","sign":"-","to":"x"}');
  });
});

describe("the natural key is the ORDERED pair", () => {
  test("A→B and B→A are distinct keys and two lines that coexist", () => {
    expect(linkKey("a", "b")).not.toBe(linkKey("b", "a"));
    const text = serializeLinks([
      link({ from: "a", to: "b", sign: "+" }),
      link({ from: "b", to: "a", sign: "-" }),
    ]);
    expect(text.split(NL).filter(Boolean)).toHaveLength(2);
    expect(text).toBe(
      [
        '{"from":"a","sign":"+","to":"b"}',
        '{"from":"b","sign":"-","to":"a"}',
        "",
      ].join(NL),
    );
    // Re-reading the written file rewrites nothing.
    const parsed = parseLinks(text);
    expect(parsed.malformed).toEqual([]);
    expect(serializeLinks(parsed.links)).toBe(text);
  });

  test("the pair is shared with distances, the records are not", () => {
    // The link key names the ordered pair; a distance's key is a different
    // shape (ADR-0014: the pair is the only shared spine).
    expect(linkKey("a", "b")).toBe(linkKey("a", "b"));
    expect(linkKey("a", "b")).not.toBe(linkKey("a", "b\u0000feeds"));
  });
});

describe("drawing a link rewrites its one line", () => {
  test("the identical draw keeps the line, unknown keys and all", () => {
    const existing = link({ extra: { rank: 1 } });
    const next = drawLink([existing], "a", "b", "+");
    expect(next).toHaveLength(1);
    expect(next[0]).toEqual(existing);
  });

  test("a new sign on the same pair rewrites IN PLACE, never appends", () => {
    const list = [link({ from: "a", to: "b", sign: "+" }), link({ from: "a", to: "c" })];
    const next = drawLink(list, "a", "b", "-");
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(link({ from: "a", to: "b", sign: "-" }));
    expect(next[1]).toEqual(list[1]);
    // The line stays at its index in the file.
    expect(serializeLinks(next)).toBe(
      [
        '{"from":"a","sign":"-","to":"b"}',
        '{"from":"a","sign":"+","to":"c"}',
        "",
      ].join(NL),
    );
  });

  test("drawing the reverse pair is a second line, not a rewrite", () => {
    const next = drawLink([link({ from: "a", to: "b", sign: "+" })], "b", "a", "-");
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(link({ from: "a", to: "b", sign: "+" }));
    expect(next[1]).toEqual(link({ from: "b", to: "a", sign: "-" }));
  });

  test("a hand-duplicated key collapses to one line, last write wins", () => {
    const text = serializeLinks([
      link({ extra: { rank: 1 } }),
      link({ extra: { rank: 2 } }),
    ]);
    expect(text).toBe('{"from":"a","rank":2,"sign":"+","to":"b"}' + NL);
    expect(parseLinks(text).links).toHaveLength(1);
  });
});

describe("flipping is a quiet in-place revision", () => {
  test("the sign flips at the line's index; neighbours never move", () => {
    const list = [
      link({ from: "a", to: "b", sign: "+", extra: { note: "why" } }),
      link({ from: "a", to: "c", sign: "-" }),
    ];
    const next = flipLink(list, "a", "b");
    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(link({ from: "a", to: "b", sign: "-", extra: { note: "why" } }));
    expect(next[1]).toEqual(list[1]);
    expect(serializeLinks(next)).toBe(
      [
        '{"from":"a","note":"why","sign":"-","to":"b"}',
        '{"from":"a","sign":"-","to":"c"}',
        "",
      ].join(NL),
    );
  });

  test("flipping twice returns the bytes it started with", () => {
    const before = serializeLinks([link({ sign: "+" })]);
    const once = serializeLinks(flipLink(parseLinks(before).links, "a", "b"));
    const twice = serializeLinks(flipLink(parseLinks(once).links, "a", "b"));
    expect(twice).toBe(before);
  });

  test("flipping a pair with no link never invents one (and never guesses a sign)", () => {
    const list = [link({ from: "a", to: "c" })];
    expect(flipLink(list, "a", "b")).toEqual(list);
    expect(hasLink(flipLink([], "a", "b"), "a", "b")).toBe(false);
  });

  test("flipping A→B never touches B→A", () => {
    const list = [
      link({ from: "a", to: "b", sign: "+" }),
      link({ from: "b", to: "a", sign: "+" }),
    ];
    const next = flipLink(list, "a", "b");
    expect(next[0].sign).toBe("-");
    expect(next[1].sign).toBe("+");
  });
});

describe("removing a link is ammo", () => {
  test("only the ordered pair goes; the reverse pair stays", () => {
    const list = [
      link({ from: "a", to: "b" }),
      link({ from: "b", to: "a" }),
      link({ from: "a", to: "c" }),
    ];
    expect(removeLink(list, "a", "b")).toEqual([
      link({ from: "b", to: "a" }),
      link({ from: "a", to: "c" }),
    ]);
  });

  test("removing a pair with no link is a no-op", () => {
    const list = [link({ from: "a", to: "b" })];
    expect(removeLink(list, "z", "q")).toEqual(list);
  });
});

describe("tolerant read of the links file", () => {
  test("blank lines, CRLF, a BOM and terminating newlines are tolerated", () => {
    const parsed = parseLinks(
      "\uFEFF{" + '"from":"a","sign":"+","to":"b"}' + "\r\n\r\n",
    );
    expect(parsed.malformed).toEqual([]);
    expect(parsed.links).toEqual([link()]);
  });

  test("a missing file is no links (the loader's null maps to this parse)", () => {
    expect(parseLinks("")).toEqual({ links: [], malformed: [] });
    expect(parseLinks(NL)).toEqual({ links: [], malformed: [] });
  });

  test("malformed and out-of-shape lines surface verbatim, never dropped", () => {
    const text = [
      "{bad json}",
      "[1,2,3]",
      '{"from":"a","to":"b"}', // no sign: a link with no sign is not a link
      '{"from":"a","sign":"?","to":"b"}', // a sign the app never guesses
      '{"from":"a","sign":"\u00B1","to":"b"}',
      '{"from":"","sign":"+","to":"b"}',
      '{"to":"b","sign":"+"}',
      '{"from":"a","sign":"+","to":"b"}',
    ].join(NL);
    const parsed = parseLinks(text);
    expect(parsed.links).toEqual([link()]);
    expect(parsed.malformed).toHaveLength(7);
    expect(parsed.malformed[0]).toBe("{bad json}");
    // The malformed lines are re-emitted byte-identically.
    const written = serializeLinks(parsed.links, parsed.malformed);
    expect(written).toContain("{bad json}" + NL);
    expect(written).toContain('{"from":"a","sign":"\u00B1","to":"b"}');
  });

  test("a hand-edited known line comes back canonical, preserving its keys", () => {
    const parsed = parseLinks('{ "sign": "-", "from": "a", "to": "b", "note": "x" }');
    expect(parsed.malformed).toEqual([]);
    expect(serializeLinks(parsed.links)).toBe(
      '{"from":"a","note":"x","sign":"-","to":"b"}' + NL,
    );
  });
});

describe("the file's bytes", () => {
  test("known lines first, malformed lines last, verbatim", () => {
    expect(serializeLinks([link()], ["{bad line"])).toBe(
      '{"from":"a","sign":"+","to":"b"}' + NL + "{bad line" + NL,
    );
  });

  test("an empty links document is a lone newline (the canonical empty JSONL)", () => {
    expect(serializeLinks([])).toBe(NL);
    expect(parseLinks(serializeLinks([])).links).toEqual([]);
  });

  test("dedupe keeps the first position and the last value", () => {
    const deduped = dedupeLinks([
      link({ extra: { rank: 1 } }),
      link({ from: "a", to: "c" }),
      link({ extra: { rank: 2 } }),
    ]);
    expect(deduped).toHaveLength(2);
    expect(deduped[0]).toEqual(link({ extra: { rank: 2 } }));
    expect(findLink(deduped, "a", "b")!.extra).toEqual({ rank: 2 });
  });

  test("an orphan line survives an unrelated rewrite byte-for-byte", () => {
    const orphan = serializeLinkLine(link({ from: "gone", to: "away", sign: "-" }));
    const parsed = parseLinks(orphan);
    expect(serializeLinks(parsed.links)).toBe(orphan + NL);
  });
});
