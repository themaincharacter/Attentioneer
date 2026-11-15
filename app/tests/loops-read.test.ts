import { describe, expect, test } from "bun:test";
import type { Link, LinkSign } from "../src/map/links";
import { flipLink } from "../src/map/links";
import { readLoop, type LoopRead, type LoopReadContext } from "../src/map/loopRead";
import type { Loop } from "../src/map/loops";
import type { Mark, MarkTarget } from "../src/map/marks";
import type { PlayingSet } from "../src/map/model";

/**
 * Story-3 guarantee, automated: the walk is a READ of authored structure
 * (ADR-0015 in full). Steps are exact-direction; a mark hides its link's sign;
 * the verdict word appears only when every step resolves AND every path word is
 * on the map and in the playing set. Every gap kind withholds it, and no gap
 * read contains the word at all. Nothing here writes: the read is derived, and
 * a flip changes it in the same breath.
 */

const A = "a";
const B = "b";
const C = "c";
const X = "gone"; // a slug the map does not have

const loop = (path: string[], name = "rain loop"): Loop => ({
  name,
  path,
  extra: {},
});

const link = (from: string, to: string, sign: LinkSign): Link => ({
  from,
  to,
  sign,
  extra: {},
});

const mark = (from: string, to: string): Mark => ({
  kind: "open",
  target: { type: "link", from, to },
  extra: {},
});

const play = (words: string[]): PlayingSet => ({ words, extra: {} });

const CONTEXT: LoopReadContext = {
  links: [],
  marks: [],
  model: play([A, B, C]),
  words: new Set([A, B, C]),
};

function ctx(over: Partial<LoopReadContext> = {}): LoopReadContext {
  return { ...CONTEXT, ...over };
}

const read = (l: Loop, over: Partial<LoopReadContext> = {}): LoopRead =>
  readLoop(l, ctx(over));

/** The verdict word must not exist anywhere in an incomplete read. */
function expectNoVerdictWord(result: LoopRead): void {
  expect(result.verdict).toBeNull();
  expect(result.complete).toBe(false);
  expect(JSON.stringify(result)).not.toContain("reinforcing");
  expect(JSON.stringify(result)).not.toContain("balancing");
}

describe("a complete walk reads its parity", () => {
  test("three positives read reinforcing", () => {
    const result = read(loop([A, B, C, A]), {
      links: [link(A, B, "+"), link(B, C, "+"), link(C, A, "+")],
    });
    expect(result.complete).toBe(true);
    expect(result.steps).toEqual([
      { kind: "sign", from: A, to: B, sign: "+" },
      { kind: "sign", from: B, to: C, sign: "+" },
      { kind: "sign", from: C, to: A, sign: "+" },
    ]);
    expect(result.verdict).toBe("reinforcing");
  });

  test("one negative reads balancing, two read reinforcing (parity, no ratio)", () => {
    const one = read(loop([A, B, C, A]), {
      links: [link(A, B, "-"), link(B, C, "+"), link(C, A, "+")],
    });
    expect(one.verdict).toBe("balancing");
    const two = read(loop([A, B, C, A]), {
      links: [link(A, B, "-"), link(B, C, "-"), link(C, A, "+")],
    });
    expect(two.verdict).toBe("reinforcing");
  });

  test("the walk keeps the path's order and starts where the record starts", () => {
    const result = read(loop([B, C, A, B]), {
      links: [link(A, B, "+"), link(B, C, "+"), link(C, A, "+")],
    });
    expect(result.complete).toBe(true);
    expect(result.steps.map((step) => step.kind === "sign" && `${step.from}>${step.to}`)).toEqual([
      "b>c",
      "c>a",
      "a>b",
    ]);
  });
});

describe("every gap kind withholds the verdict", () => {
  test("a missing link is named, never invented", () => {
    const result = read(loop([A, B, C, A]), {
      links: [link(A, B, "+"), link(B, C, "+")],
    });
    expect(result.steps[2]).toEqual({
      kind: "gap",
      from: C,
      to: A,
      gap: { kind: "missing-link", reverse: false },
    });
    expectNoVerdictWord(result);
  });

  test("a reverse-only link is a gap with the reverse hint", () => {
    const result = read(loop([A, B, A]), {
      links: [link(A, B, "+"), link(A, C, "+")],
    });
    // The second step B -> A has no line, but A -> B does.
    expect(result.steps[1]).toEqual({
      kind: "gap",
      from: B,
      to: A,
      gap: { kind: "missing-link", reverse: true },
    });
    expectNoVerdictWord(result);
  });

  test("a 2-cycle needs BOTH directed links", () => {
    const oneWay = read(loop([A, B, A]), { links: [link(A, B, "+")] });
    expect(oneWay.steps[0].kind).toBe("sign");
    expect(oneWay.steps[1]).toEqual({
      kind: "gap",
      from: B,
      to: A,
      gap: { kind: "missing-link", reverse: true },
    });
    expectNoVerdictWord(oneWay);

    const both = read(loop([A, B, A]), {
      links: [link(A, B, "+"), link(B, A, "-")],
    });
    expect(both.complete).toBe(true);
    expect(both.verdict).toBe("balancing");
  });

  test("a marked link shows unknown, never its stored sign", () => {
    const result = read(loop([A, B, A]), {
      links: [link(A, B, "+"), link(B, A, "+")],
      marks: [mark(A, B)],
    });
    expect(result.steps[0]).toEqual({
      kind: "gap",
      from: A,
      to: B,
      gap: { kind: "marked-link" },
    });
    // The stored "+" must not appear among the resolved signs.
    expect(result.steps.some((step) => step.kind === "sign" && step.from === A)).toBe(false);
    expectNoVerdictWord(result);
  });

  test("withdrawing the mark restores the stored sign and the verdict", () => {
    const l = loop([A, B, A]);
    const links = [link(A, B, "+"), link(B, A, "+")];
    const marked = read(l, { links, marks: [mark(A, B)] });
    expectNoVerdictWord(marked);
    const restored = read(l, { links, marks: [] });
    expect(restored.complete).toBe(true);
    expect(restored.verdict).toBe("reinforcing");
  });

  test("a mark cannot invent a link that is not there", () => {
    const result = read(loop([A, B, A]), {
      links: [link(B, A, "+")],
      marks: [mark(A, B)],
    });
    expect(result.steps[0]).toEqual({
      kind: "gap",
      from: A,
      to: B,
      gap: { kind: "missing-link", reverse: true },
    });
    expectNoVerdictWord(result);
  });

  test("a dangling path word is named (never repaired)", () => {
    const result = read(loop([A, X, A]), {
      links: [link(A, X, "+"), link(X, A, "+")],
    });
    expect(result.wordGaps).toEqual([{ kind: "dangling", slug: X }]);
    expect(result.path).toEqual([A, X, A]);
    expectNoVerdictWord(result);
  });

  test("an out-of-play word is named even though it is on the map", () => {
    const result = read(loop([A, B, C, A]), {
      links: [link(A, B, "+"), link(B, C, "+"), link(C, A, "+")],
      model: play([A, B]),
    });
    expect(result.wordGaps).toEqual([{ kind: "out-of-play", slug: C }]);
    expectNoVerdictWord(result);
  });

  test("no accepted playing set means nothing is in play", () => {
    const result = read(loop([A, B, A]), {
      links: [link(A, B, "+"), link(B, A, "+")],
      model: null,
    });
    expect(result.wordGaps).toEqual([
      { kind: "out-of-play", slug: A },
      { kind: "out-of-play", slug: B },
    ]);
    expectNoVerdictWord(result);
  });

  test("a repeated path word is named once, not per occurrence", () => {
    const result = read(loop([A, B, A, B, A]), {
      model: play([A]),
      links: [
        link(A, B, "+"),
        link(B, A, "+"),
      ],
    });
    expect(result.wordGaps).toEqual([{ kind: "out-of-play", slug: B }]);
    expectNoVerdictWord(result);
  });

  test("an unclosed path is named and still shows its steps", () => {
    const result = read(loop([A, B, C]), {
      links: [link(A, B, "+"), link(B, C, "+")],
    });
    expect(result.pathGaps).toEqual([{ kind: "unclosed" }]);
    expect(result.steps).toHaveLength(2);
    expectNoVerdictWord(result);
  });

  test("an empty path has no steps", () => {
    const result = read(loop([]));
    expect(result.pathGaps).toEqual([{ kind: "no-steps" }]);
    expect(result.steps).toEqual([]);
    expectNoVerdictWord(result);
  });

  test("a one-slug path has no steps either", () => {
    const result = read(loop([A]));
    expect(result.pathGaps).toEqual([{ kind: "no-steps" }]);
    expectNoVerdictWord(result);
  });
});

describe("self-links are ordinary one-step loops", () => {
  test("+ reads reinforcing and - reads balancing", () => {
    const plus = read(loop([A, A]), { links: [link(A, A, "+")] });
    expect(plus.complete).toBe(true);
    expect(plus.verdict).toBe("reinforcing");
    const minus = read(loop([A, A]), { links: [link(A, A, "-")] });
    expect(minus.complete).toBe(true);
    expect(minus.verdict).toBe("balancing");
  });

  test("a marked self-link withholds the verdict like any other", () => {
    const result = read(loop([A, A]), {
      links: [link(A, A, "+")],
      marks: [mark(A, A)],
    });
    expect(result.steps[0]).toEqual({
      kind: "gap",
      from: A,
      to: A,
      gap: { kind: "marked-link" },
    });
    expectNoVerdictWord(result);
  });
});

describe("a repeated pair is read per step (the product handles repeats)", () => {
  test("A,B,A,B,A uses all four signs", () => {
    const links = [link(A, B, "-"), link(B, A, "+")];
    const result = read(loop([A, B, A, B, A]), { links });
    expect(result.steps).toHaveLength(4);
    // Two negatives: even -> reinforcing.
    expect(result.complete).toBe(true);
    expect(result.verdict).toBe("reinforcing");
  });

  test("the repeat itself changes the parity (the same links, walked twice)", () => {
    const links = [link(A, B, "-"), link(B, A, "+")];
    // Once each: one negative, so balancing.
    expect(read(loop([A, B, A]), { links }).verdict).toBe("balancing");
    // Twice each: two negatives, so reinforcing — the walk counts per step.
    const walked = read(loop([A, B, A, B, A]), { links });
    expect(walked.steps).toHaveLength(4);
    expect(walked.verdict).toBe("reinforcing");
  });

  test("flipping a pair the walk traverses twice keeps the parity (both count)", () => {
    const l = loop([A, B, A, B, A]);
    const before = read(l, { links: [link(A, B, "-"), link(B, A, "+")] });
    const after = read(l, { links: [link(A, B, "+"), link(B, A, "+")] });
    expect(before.verdict).toBe("reinforcing");
    // Two flips (one per occurrence) leave the negative count even.
    expect(after.verdict).toBe("reinforcing");
  });
});

describe("a flip updates the read in the same breath (derived, never stored)", () => {
  test("flipping a link flips the next read's verdict", () => {
    const l = loop([A, B, C, A]);
    const links = [link(A, B, "+"), link(B, C, "+"), link(C, A, "+")];
    const before = read(l, { links });
    expect(before.verdict).toBe("reinforcing");
    const after = read(l, { links: flipLink(links, A, B) });
    expect(after.verdict).toBe("balancing");
    // The record itself never carries a verdict field.
    expect(JSON.stringify(links)).not.toContain("reinforcing");
  });

  test("the read's object carries no verdict while any gap stands, for every gap", () => {
    const gapReads: LoopRead[] = [
      read(loop([A, B, A]), { links: [link(A, B, "+")] }), // missing
      read(loop([A, B, A]), {
        links: [link(A, B, "+"), link(B, A, "+")],
        marks: [mark(B, A)], // marked
      }),
      read(loop([A, X, A]), { links: [link(A, X, "+"), link(X, A, "+")] }), // dangling
      read(loop([A, B, A]), {
        links: [link(A, B, "+"), link(B, A, "+")],
        model: play([A]), // out of play
      }),
      read(loop([A, B, C])), // unclosed
      read(loop([])), // empty
      read(loop([A])), // no steps
    ];
    for (const result of gapReads) {
      expectNoVerdictWord(result);
    }
  });
});
