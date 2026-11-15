import { describe, expect, test } from "bun:test";
import {
  parseDistances,
  serializeDistances,
  type Distance,
} from "../src/map/distances";
import {
  flipLink,
  linkKey,
  parseLinks,
  serializeLinks,
  type Link,
} from "../src/map/links";
import {
  findOrphanMarks,
  hasMark,
  markTargetKey,
  parseMarks,
  serializeMarkLine,
  serializeMarks,
  withMark,
  withoutMark,
  type Mark,
  type MarkTarget,
} from "../src/map/marks";
import {
  joinWord,
  joinWords,
  parseModel,
  serializeModel,
  type PlayingSet,
} from "../src/map/model";
import {
  dropLinkMarks,
  dropMarksTouching,
  dropTouching,
  dropTouchingLinks,
  dropWireMarks,
  recoinWireMarks,
  rewriteEndpoints,
  rewriteLinkEndpoints,
  rewriteMarkEndpoints,
  rewriteMembership,
  dropMembership,
} from "../src/map/patches";

/**
 * Story-2 guarantees around the mark-on-link and the link lifecycle:
 *
 * - a wordless pair names a LINK; its natural key is distinct from the wire
 *   triple (and from the word), so one pair can carry both marks;
 * - cast, settle, rename, remove and flip each do the one right thing (flip
 *   keeps the mark; remove drops it; a removed word takes its links with it);
 * - the atomic batches grow the link step next to endpoints, marks and
 *   membership, and the two record families never couple (ADR-0014);
 * - the composed joins pull a linked outsider into play and join a word coined
 *   while playing (ADR-0013 decision 4).
 */

const NL = "\n";

const linkTarget = (from: string, to: string): MarkTarget => ({
  type: "link",
  from,
  to,
});
const wire = (from: string, to: string, word: string): MarkTarget => ({
  type: "wire",
  from,
  to,
  word,
});
const word = (slug: string): MarkTarget => ({ type: "word", slug });

function open(target: MarkTarget): Mark {
  return { kind: "open", target, extra: {} };
}

function link(from: string, to: string, sign: "+" | "-" = "+"): Link {
  return { from, to, sign, extra: {} };
}

function distance(from: string, to: string, word: string): Distance {
  return { from, to, word, extra: {} };
}

const play = (words: string[], extra: Record<string, unknown> = {}): PlayingSet => ({
  words,
  extra,
});

/** A workspace's records, as the app's batch steps see them. */
interface Files {
  distances: string;
  links: string;
  marks: string;
  model: string;
  malformedLinks: string[];
  malformedMarks: string[];
}

function files(over: Partial<Files> = {}): Files {
  return {
    distances: serializeDistances([]), // an empty JSONL document is a lone newline
    links: serializeLinks([]),
    marks: serializeMarks([]),
    model: serializeModel(play([])),
    malformedLinks: [],
    malformedMarks: [],
    ...over,
  };
}

describe("a mark lands on a link's wordless pair", () => {
  test("cast writes the wordless-pair line, compact and sorted", () => {
    const marks = withMark([], open(linkTarget("a", "b")));
    expect(serializeMarks(marks)).toBe('{"from":"a","kind":"open","to":"b"}' + NL);
    // The cast is idempotent: one line per ordered pair.
    expect(withMark(marks, open(linkTarget("a", "b")))).toHaveLength(1);
    expect(hasMark(marks, "open", linkTarget("a", "b"))).toBe(true);
  });

  test("the wordless key is distinct from the wire triple and from the word", () => {
    expect(markTargetKey(linkTarget("a", "b"))).not.toBe(
      markTargetKey(wire("a", "b", "feeds")),
    );
    expect(markTargetKey(linkTarget("a", "b"))).not.toBe(markTargetKey(word("a")));
    // Two marks on one pair (its link and its distance) coexist.
    const both = [
      open(linkTarget("a", "b")),
      open(wire("a", "b", "feeds")),
    ];
    expect(serializeMarks(both).split(NL).filter(Boolean)).toHaveLength(2);
  });

  test("settle withdraws only that ordered pair; the reverse mark stays", () => {
    const marks = [
      open(linkTarget("a", "b")),
      open(linkTarget("b", "a")),
    ];
    expect(withoutMark(marks, "open", linkTarget("a", "b"))).toEqual([
      open(linkTarget("b", "a")),
    ]);
    expect(hasMark(marks, "open", linkTarget("b", "a"))).toBe(true);
  });

  test("a flipped sign keeps the mark: the key carries no sign", () => {
    const before = serializeMarks([open(linkTarget("a", "b"))]);
    const links = parseLinks(serializeLinks([link("a", "b", "+")])).links;
    const flipped = flipLink(links, "a", "b");
    // The flip changes the link line...
    expect(serializeLinks(flipped)).toBe('{"from":"a","sign":"-","to":"b"}' + NL);
    // ...and the mark file is not part of that batch at all: same bytes, same key.
    expect(serializeMarks(parseMarks(before).marks)).toBe(before);
    expect(hasMark(parseMarks(before).marks, "open", linkTarget("a", "b"))).toBe(true);
    expect(markTargetKey(linkTarget("a", "b"))).not.toContain("+");
  });

  test("a mark dies with its link; the reverse pair's mark does not", () => {
    const marks = [
      open(linkTarget("a", "b")),
      open(linkTarget("b", "a")),
      open(wire("a", "b", "feeds")),
      open(word("a")),
    ];
    expect(dropLinkMarks(marks, "a", "b")).toEqual([
      open(linkTarget("b", "a")),
      open(wire("a", "b", "feeds")),
      open(word("a")),
    ]);
  });

  test("a link mark is an orphan when its pair has no link line", () => {
    const onLink = open(linkTarget("a", "b"));
    const onReverse = open(linkTarget("b", "a"));
    expect(
      findOrphanMarks(
        [onLink, onReverse],
        new Set(["a", "b"]),
        new Set(),
        new Set([linkKey("a", "b")]),
      ),
    ).toEqual([onReverse]);
    // With the link set empty (the loader's default), a link mark is surfaced.
    expect(
      findOrphanMarks([onLink], new Set(["a", "b"]), new Set()),
    ).toEqual([onLink]);
  });
});

describe("the link patches", () => {
  test("rename rewrites from/to and never the sign or the other records", () => {
    const links = [
      link("old", "b", "+"),
      link("c", "old", "-"),
      link("x", "y", "+"),
    ];
    const out = rewriteLinkEndpoints(links, "old", "new");
    // Untouched links first, rewritten ones last (the collision rule).
    expect(out).toEqual([
      link("x", "y", "+"),
      link("new", "b", "+"),
      link("c", "new", "-"),
    ]);
    // A slug that merely equals a sign or a neighbour is not an endpoint.
    expect(rewriteLinkEndpoints([link("a", "b", "-")], "old", "new")).toEqual([
      link("a", "b", "-"),
    ]);
  });

  test("rename flips both ends of a self-link", () => {
    expect(rewriteLinkEndpoints([link("old", "old", "-")], "old", "new")).toEqual([
      link("new", "new", "-"),
    ]);
  });

  test("a renamed link colliding with a hand-edited duplicate keeps one line", () => {
    const out = rewriteLinkEndpoints(
      [link("new", "c", "-"), link("old", "c", "+")],
      "old",
      "new",
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual(link("new", "c", "+"));
  });

  test("remove drops every link touching the slug, in both directions", () => {
    expect(
      dropTouchingLinks(
        [link("old", "b"), link("c", "old"), link("c", "d"), link("d", "c")],
        "old",
      ),
    ).toEqual([link("c", "d"), link("d", "c")]);
  });

  test("removing a distance never touches a link (no coupling, ADR-0014)", () => {
    const links = serializeLinks([link("a", "b"), link("b", "a", "-")]);
    const distances = [
      distance("a", "b", "feeds"),
      distance("b", "a", "needs"),
    ];
    // Every distance operation, in sequence, on the pair and around it.
    let next = dropTouching(distances, "a");
    next = rewriteEndpoints(next, "a", "z");
    const recoined = recoinWireMarks([], "a", "b", "feeds", "feeds2", false);
    next = [...next, distance("a", "b", "feeds")];
    next = next.filter((d) => d.word !== "needs");
    expect(recoined).toEqual([]);
    expect(serializeLinks(parseLinks(links).links)).toBe(links);
    expect(next.every((d) => d.word !== "feeds2")).toBe(true);
  });

  test("removing a link never touches a distance's marks", () => {
    const marks = [
      open(linkTarget("a", "b")),
      open(wire("a", "b", "feeds")),
    ];
    expect(dropLinkMarks(marks, "a", "b")).toEqual([open(wire("a", "b", "feeds"))]);
    expect(dropWireMarks(marks, "a", "b", "feeds")).toEqual([open(linkTarget("a", "b"))]);
  });
});

describe("the atomic batches grow the link step", () => {
  /** The rename batch's pure steps, in the app's write order. */
  function renameBatch(before: Files, oldSlug: string, newSlug: string): Files {
    const distances = rewriteEndpoints(
      parseDistances(before.distances).distances,
      oldSlug,
      newSlug,
    );
    const links = rewriteLinkEndpoints(
      parseLinks(before.links).links,
      oldSlug,
      newSlug,
    );
    const marks = rewriteMarkEndpoints(
      parseMarks(before.marks).marks,
      oldSlug,
      newSlug,
    );
    const model = parseModel(before.model).model!;
    return {
      distances: serializeDistances(distances),
      links: serializeLinks(links, before.malformedLinks),
      marks: serializeMarks(marks, before.malformedMarks),
      model: serializeModel(rewriteMembership(model, oldSlug, newSlug)),
      malformedLinks: before.malformedLinks,
      malformedMarks: before.malformedMarks,
    };
  }

  /** The remove batch's pure steps, in the app's write order (file last). */
  function removeBatch(before: Files, slug: string): Files {
    const distances = dropTouching(
      parseDistances(before.distances).distances,
      slug,
    );
    const links = dropTouchingLinks(parseLinks(before.links).links, slug);
    const marks = dropMarksTouching(parseMarks(before.marks).marks, slug);
    const model = parseModel(before.model).model!;
    return {
      ...before,
      distances: serializeDistances(distances),
      links: serializeLinks(links, before.malformedLinks),
      marks: serializeMarks(marks, before.malformedMarks),
      model: serializeModel(dropMembership(model, slug)),
    };
  }

  test("rename rewrites link endpoints, link-mark targets, distances and membership in one batch", () => {
    const before = files({
      distances: serializeDistances([distance("old", "b", "feeds")]),
      links: serializeLinks([link("old", "b", "+"), link("c", "old", "-")]),
      marks: serializeMarks([
        open(linkTarget("old", "b")),
        open(linkTarget("c", "old")),
        open(word("old")),
        open(wire("old", "b", "feeds")),
      ]),
      model: serializeModel(play(["old", "b", "c"], { note: "why" })),
      malformedLinks: ["{hand edit"],
      malformedMarks: ["{hand edit"],
    });

    const after = renameBatch(before, "old", "new");

    expect(after.links).toBe(
      [
        '{"from":"new","sign":"+","to":"b"}',
        '{"from":"c","sign":"-","to":"new"}',
        "{hand edit",
        "",
      ].join(NL),
    );
    // The link's own marks follow the pair, alongside the wire and word marks.
    expect(after.marks).toContain('{"from":"new","kind":"open","to":"b"}');
    expect(after.marks).toContain('{"from":"c","kind":"open","to":"new"}');
    expect(after.distances).toBe('{"from":"new","to":"b","word":"feeds"}' + NL);
    expect(JSON.parse(after.model)).toEqual({ note: "why", words: ["b", "c", "new"] });
    // Canonical on re-read: the patch leaves nothing to rewrite.
    const rereadLinks = parseLinks(after.links);
    expect(serializeLinks(rereadLinks.links, rereadLinks.malformed)).toBe(after.links);
    const rereadMarks = parseMarks(after.marks);
    expect(serializeMarks(rereadMarks.marks, rereadMarks.malformed)).toBe(after.marks);
  });

  test("remove drops the word's links and their marks (and membership), leaving the rest", () => {
    const before = files({
      distances: serializeDistances([distance("old", "b", "feeds"), distance("c", "d", "reads")]),
      links: serializeLinks([
        link("old", "b", "+"),
        link("b", "old", "-"),
        link("c", "d", "+"),
      ]),
      marks: serializeMarks([
        open(linkTarget("old", "b")),
        open(linkTarget("b", "old")),
        open(linkTarget("c", "d")),
        open(word("old")),
        open({ type: "spot", x: 1, y: 2 }),
      ]),
      model: serializeModel(play(["old", "b", "c", "d"])),
      malformedLinks: ["{hand edit"],
    });

    const after = removeBatch(before, "old");

    expect(after.links).toBe(
      ['{"from":"c","sign":"+","to":"d"}', "{hand edit", ""].join(NL),
    );
    expect(after.marks).toBe(
      [
        '{"from":"c","kind":"open","to":"d"}',
        '{"kind":"open","x":1,"y":2}',
        "",
      ].join(NL),
    );
    expect(after.distances).toBe('{"from":"c","to":"d","word":"reads"}' + NL);
    expect(JSON.parse(after.model)).toEqual({ words: ["b", "c", "d"] });
    // Nothing dangling survives the batch.
    const slugs = new Set(["b", "c", "d"]);
    const linkKeys = new Set(
      parseLinks(after.links).links.map((l) => linkKey(l.from, l.to)),
    );
    expect(
      findOrphanMarks(
        parseMarks(after.marks).marks,
        slugs,
        new Set(),
        linkKeys,
      ),
    ).toEqual([]);
  });
});

describe("composed joins pull words into play (ADR-0013 decision 4)", () => {
  test("a link to an outsider pulls that word (and its origin) into the set", () => {
    const joined = joinWords(play(["rain", "soil"]), ["rain", "mulch"])!;
    expect(joined.words).toEqual(["mulch", "rain", "soil"]);
    // A second join of the same word is the same record — no write needed.
    expect(joinWords(joined, ["mulch"])).toBe(joined);
  });

  test("a coin while playing joins the same way", () => {
    expect(joinWord(play(["rain"]), "mulch")!.words).toEqual(["mulch", "rain"]);
  });

  test("no accepted set means nothing to join (the selector is the door)", () => {
    expect(joinWords(null, ["rain"])).toBeNull();
    expect(joinWord(null, "rain")).toBeNull();
  });

  test("the join keeps sorted canonical order, unique slugs and unknown keys", () => {
    const model = play(["soil", "rain"], { note: "why", rank: 2 });
    const joined = joinWords(model, ["rain", "soil", "mulch", "mulch"])!;
    expect(joined.words).toEqual(["mulch", "rain", "soil"]);
    expect(joined.extra).toEqual({ note: "why", rank: 2 });
    expect(serializeModel(joined)).toBe(
      [
        "{",
        '  "note": "why",',
        '  "rank": 2,',
        '  "words": [',
        '    "mulch",',
        '    "rain",',
        '    "soil"',
        "  ]",
        "}",
        "",
      ].join(NL),
    );
  });
});
