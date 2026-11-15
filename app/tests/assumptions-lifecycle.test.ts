import { describe, expect, test } from "bun:test";
import {
  assumptionKey,
  parseAssumptions,
  serializeAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "../src/map/assumptions";
import { flipLink, type Link } from "../src/map/links";
import { loopSlug, type Loop } from "../src/map/loops";
import {
  dropAssumptionsTouching,
  dropLinkAssumptions,
  dropLoopAssumptions,
  rewriteAssumptionLoopTargets,
  rewriteAssumptionTargets,
} from "../src/map/patches";

/**
 * Story-4 lifecycle, automated at the pure-step layer the atomic batches are
 * built from (ADR-0012 decision 6, the crash rule in patches.ts):
 *
 * - a reference rename rewrites word-target "on" slugs and link-target
 *   endpoints in the same batch, and touches neither loop targets nor spots;
 * - a reference remove drops the lines on the word and on its links
 *   (die-with-target), and a loop that dies with the same batch takes its own
 *   claims too; bare spots outlive the words around them;
 * - a loop rename rewrites loop targets with the resolved slug (a collision
 *   suffix flows through); a loop removal drops its lines;
 * - removing a link drops its pair's lines (the reverse pair stays); flipping a
 *   sign touches NO assumption because no key carries a sign.
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

describe("a reference rename rewrites word and link targets in the batch", () => {
  const claims = [
    a("on the word", word("old"), { rank: 1 }),
    a("on a link it starts", link("old", "b")),
    a("on a link it ends", link("a", "old")),
    a("on a self-link", link("old", "old")),
    a("on a loop", loop("old-loop")),
    a("on a spot", spot(1, 2)),
    a("on a stranger", word("other")),
  ];

  test("word on and both link endpoints follow; text and extras survive", () => {
    const next = rewriteAssumptionTargets(claims, "old", "new");
    expect(next[0]).toEqual(a("on the word", word("new"), { rank: 1 }));
    expect(next[1].target).toEqual(link("new", "b"));
    expect(next[2].target).toEqual(link("a", "new"));
    expect(next[3].target).toEqual(link("new", "new"));
  });

  test("loop targets, bare spots and unrelated words are untouched, order kept", () => {
    const next = rewriteAssumptionTargets(claims, "old", "new");
    expect(next).toHaveLength(claims.length);
    expect(next[4]).toBe(claims[4]);
    expect(next[5]).toBe(claims[5]);
    expect(next[6]).toBe(claims[6]);
    expect(next.map((claim) => claim.text)).toEqual(
      claims.map((claim) => claim.text),
    );
  });

  test("the same slug is a copy, and the lines serialize canonically", () => {
    expect(rewriteAssumptionTargets(claims, "old", "old")).toEqual(claims);
    const next = rewriteAssumptionTargets([claims[0]], "old", "new");
    expect(serializeAssumptions(next)).toBe(
      '{"on":"new","rank":1,"text":"on the word"}' + NL,
    );
  });

  test("an orphan already on the new slug loses to the app's renamed line", () => {
    const orphan = a("on the word", word("new"), { rank: 9 });
    const renamed = a("on the word", word("old"), { rank: 1 });
    const next = rewriteAssumptionTargets([orphan, renamed], "old", "new");
    expect(next).toHaveLength(1);
    expect(next[0].extra).toEqual({ rank: 1 });
    expect(assumptionKey(next[0])).toBe(assumptionKey(orphan));
  });

  test("hand-duplicated keys elsewhere are never collapsed by a rename", () => {
    const claims = [
      a("dup", word("keep")),
      a("dup", word("keep")),
      a("follows", word("old")),
    ];
    const next = rewriteAssumptionTargets(claims, "old", "new");
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(claims[0]);
    expect(next[1]).toBe(claims[1]);
    expect(parseAssumptions(serializeAssumptions(next)).assumptions).toHaveLength(3);
  });
});

describe("a reference remove drops the lines on it and its links (die-with-target)", () => {
  const claims = [
    a("on the word", word("gone")),
    a("on a link starting there", link("gone", "b")),
    a("on a link ending there", link("a", "gone")),
    a("on a self-link", link("gone", "gone")),
    a("on another word's link", link("a", "b")),
    a("on a loop", loop("rain-loop")),
    a("on a spot", spot(1, 2)),
  ];

  test("the word's lines and its links' lines go; everything else stays in order", () => {
    const next = dropAssumptionsTouching(claims, "gone");
    expect(next.map((claim) => claim.text)).toEqual([
      "on another word's link",
      "on a loop",
      "on a spot",
    ]);
  });

  test("a bare spot is its own target: removing a word never reaches it", () => {
    expect(dropAssumptionsTouching([a("on a spot", spot(1, 2))], "gone")).toHaveLength(1);
  });

  test("a loop removed by the same batch takes its own claims too", () => {
    // removeReference collects the slugs of the loops it drops, then this step
    // (the 1b2 seam) drops their lines in the same batch.
    const loops: Loop[] = [
      { name: "rain loop", path: ["gone", "b", "gone"], extra: {} },
      { name: "soil loop", path: ["c", "d", "c"], extra: {} },
    ];
    const deadLoopSlugs = loops
      .filter((candidate) => candidate.path.includes("gone"))
      .map((candidate) => loopSlug(candidate.name));
    expect(deadLoopSlugs).toEqual(["rain-loop"]);
    const next = dropLoopAssumptions(
      dropAssumptionsTouching(claims, "gone"),
      deadLoopSlugs,
    );
    expect(next.map((claim) => claim.text)).toEqual([
      "on another word's link",
      "on a spot",
    ]);
  });
});

describe("removing a link drops its lines; the reverse pair stays", () => {
  const claims = [
    a("forward", link("a", "b")),
    a("reverse", link("b", "a")),
    a("on the word", word("a")),
    a("on a spot", spot(0, 0)),
  ];

  test("only the ordered pair's lines go", () => {
    const next = dropLinkAssumptions(claims, "a", "b");
    expect(next.map((claim) => claim.text)).toEqual([
      "reverse",
      "on the word",
      "on a spot",
    ]);
  });

  test("a pair with no lines is untouched", () => {
    expect(dropLinkAssumptions(claims, "x", "y")).toEqual(claims);
  });
});

describe("a loop rename rewrites its loop targets, suffix included", () => {
  const claims = [
    a("about the loop", loop("rain-loop"), { rank: 1 }),
    a("about another loop", loop("soil-loop")),
    a("about the word", word("rain-loop")),
    a("about a link", link("rain-loop", "soil")),
    a("about a spot", spot(1, 2)),
  ];

  test("only loop targets follow the resolved slug; all else is untouched", () => {
    const next = rewriteAssumptionLoopTargets(claims, "rain-loop", "rain-loop-2");
    expect(next[0]).toEqual(a("about the loop", loop("rain-loop-2"), { rank: 1 }));
    expect(next[1]).toBe(claims[1]);
    expect(next[2]).toBe(claims[2]);
    expect(next[3]).toBe(claims[3]);
    expect(next[4]).toBe(claims[4]);
    // The collision suffix a rename mints is exactly what flows through.
    expect(serializeAssumptions(next).split(NL)[0]).toContain(
      '"loop":"rain-loop-2"',
    );
  });

  test("a loop and a word of the same slug are different targets", () => {
    const next = rewriteAssumptionLoopTargets(claims, "rain-loop", "weather-loop");
    expect(next[2]).toBe(claims[2]); // the word target stays
    expect(next[0].target).toEqual(loop("weather-loop"));
  });

  test("an unchanged or unknown slug is a quiet copy", () => {
    expect(rewriteAssumptionLoopTargets(claims, "rain-loop", "rain-loop")).toEqual(
      claims,
    );
    expect(rewriteAssumptionLoopTargets(claims, "nope", "other")).toEqual(claims);
  });

  test("a colliding orphan on the new slug loses to the rewritten line", () => {
    const orphan = a("about the loop", loop("rain-loop-2"), { rank: 9 });
    const renamed = a("about the loop", loop("rain-loop"), { rank: 1 });
    const next = rewriteAssumptionLoopTargets([orphan, renamed], "rain-loop", "rain-loop-2");
    expect(next).toHaveLength(1);
    expect(next[0].extra).toEqual({ rank: 1 });
  });
});

describe("a loop removal drops its lines (die-with-target)", () => {
  const claims = [
    a("about the loop", loop("rain-loop")),
    a("about another loop", loop("soil-loop")),
    a("about the word", word("rain-loop")),
    a("about a spot", spot(4, 5)),
  ];

  test("one slug drops its own loop lines only", () => {
    const next = dropLoopAssumptions(claims, "rain-loop");
    expect(next.map((claim) => claim.text)).toEqual([
      "about another loop",
      "about the word",
      "about a spot",
    ]);
  });

  test("a batch drops several (a reference remove can take several loops)", () => {
    const next = dropLoopAssumptions(claims, ["rain-loop", "soil-loop"]);
    expect(next.map((claim) => claim.text)).toEqual([
      "about the word",
      "about a spot",
    ]);
  });

  test("an empty batch or an unknown slug is a quiet copy", () => {
    expect(dropLoopAssumptions(claims, [])).toEqual(claims);
    expect(dropLoopAssumptions(claims, "nope")).toEqual(claims);
  });
});

describe("flipping a sign touches no assumption (the key carries no sign)", () => {
  const linkLine: Link = { from: "a", to: "b", sign: "+", extra: {} };

  test("the painted key is the wordless pair, so a flip cannot orphan it", () => {
    const claims = [a("forward", link("a", "b"), { committed: true })];
    const before = serializeAssumptions(claims);
    const flipped = flipLink([linkLine], "a", "b");
    expect(flipped[0].sign).toBe("-");
    // Nothing in the assumption batch reads a sign: the bytes are untouched.
    expect(serializeAssumptions(claims)).toBe(before);
    expect(assumptionKey(claims[0])).toBe(assumptionKey(a("forward", link("a", "b"))));
  });

  test("a hand-written sign is an unknown key: preserved, never interpreted", () => {
    const parsed = parseAssumptions(
      '{"from":"a","sign":"+","text":"forward","to":"b"}',
    ).assumptions[0];
    expect(parsed.extra).toEqual({ sign: "+" });
    expect(serializeAssumptions([parsed])).toBe(
      '{"from":"a","sign":"+","text":"forward","to":"b"}' + NL,
    );
  });
});

describe("bare spots are untouched by every rename and remove", () => {
  test("a word rename, a word remove, a loop rename and a loop remove all leave it", () => {
    const bare = a("the rain is not the whole story", spot(7, 8));
    const list = [bare];
    expect(rewriteAssumptionTargets(list, "soil", "earth")).toEqual(list);
    expect(dropAssumptionsTouching(list, "soil")).toEqual(list);
    expect(rewriteAssumptionLoopTargets(list, "rain-loop", "storm-loop")).toEqual(
      list,
    );
    expect(dropLoopAssumptions(list, "rain-loop")).toEqual(list);
    expect(dropLinkAssumptions(list, "a", "b")).toEqual(list);
  });
});
