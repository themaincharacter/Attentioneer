import { describe, expect, test } from "bun:test";
import {
  dropMarksTouching,
  dropTouching,
  dropWireMarks,
  recoinWireMarks,
  rewriteEndpoints,
  rewriteMarkEndpoints,
} from "../src/map/patches";
import type { Distance } from "../src/map/distances";
import { markTargetKey, type Mark, type MarkTarget } from "../src/map/marks";

function d(from: string, to: string, word: string): Distance {
  return { from, to, word, extra: {} };
}

function mk(target: MarkTarget, extra: Record<string, unknown> = {}): Mark {
  return { kind: "open", target, extra };
}

const word = (slug: string): MarkTarget => ({ type: "word", slug });
const wire = (from: string, to: string, word: string): MarkTarget => ({
  type: "wire",
  from,
  to,
  word,
});
const spot = (x: number, y: number): MarkTarget => ({ type: "spot", x, y });

describe("rewriteEndpoints (rename propagates)", () => {
  test("rewrites from and to, touches the word not", () => {
    const out = rewriteEndpoints(
      [d("old", "b", "feeds"), d("c", "old", "reads"), d("x", "y", "old")],
      "old",
      "new",
    );
    expect(out).toEqual([
      d("new", "b", "feeds"),
      d("c", "new", "reads"),
      d("x", "y", "old"), // a word that spells the old name is not an endpoint
    ]);
  });

  test("records whose word equals the old slug are left alone", () => {
    const out = rewriteEndpoints([d("a", "b", "old")], "old", "new");
    expect(out).toEqual([d("a", "b", "old")]);
  });

  test("no match is a no-op (same records)", () => {
    const list = [d("a", "b", "w")];
    expect(rewriteEndpoints(list, "z", "q")).toEqual(list);
  });

  test("self-distance endpoints both flip", () => {
    const out = rewriteEndpoints([d("old", "old", "self")], "old", "new");
    expect(out).toEqual([d("new", "new", "self")]);
  });
});

describe("dropTouching (remove propagates)", () => {
  test("drops every line touching the slug, keeps the rest", () => {
    const out = dropTouching(
      [d("old", "b", "w"), d("c", "old", "w"), d("c", "d", "w")],
      "old",
    );
    expect(out).toEqual([d("c", "d", "w")]);
  });

  test("removing a word never leaves a dangler", () => {
    const out = dropTouching([d("old", "b", "w"), d("old", "c", "w")], "old");
    expect(out).toEqual([]);
    // nothing references "old" afterwards
    expect(out.some((x) => x.from === "old" || x.to === "old")).toBe(false);
  });
});

describe("marks follow a rename (ADR-0009)", () => {
  test("word `on` and wire endpoints follow; the wire word and extras survive", () => {
    const marks = [
      mk(word("old"), { rank: 1 }),
      mk(wire("old", "b", "feeds")),
      mk(wire("c", "old", "old")),
      mk(spot(1, 2)),
    ];
    const out = rewriteMarkEndpoints(marks, "old", "new");
    // Untouched marks are emitted first, rewritten ones last (the collision rule).
    expect(out).toEqual([
      mk(spot(1, 2)),
      mk(word("new"), { rank: 1 }),
      mk(wire("new", "b", "feeds")),
      mk(wire("c", "new", "old")), // a word that spells the old slug is not an endpoint
    ]);
  });

  test("both ends of a self-wire flip", () => {
    expect(rewriteMarkEndpoints([mk(wire("old", "old", "self"))], "old", "new")).toEqual([
      mk(wire("new", "new", "self")),
    ]);
  });

  test("an orphan already on the new slug loses to the app's renamed mark", () => {
    const orphan = mk(word("new"), { rank: 2 });
    const renamed = mk(word("old"), { rank: 1 });
    const out = rewriteMarkEndpoints([orphan, renamed], "old", "new");
    expect(out).toHaveLength(1);
    expect(out[0].extra).toEqual({ rank: 1 });
  });

  test("no marks touch the old slug afterwards", () => {
    const out = rewriteMarkEndpoints(
      [mk(word("old")), mk(wire("old", "b", "w")), mk(wire("c", "old", "w"))],
      "old",
      "new",
    );
    const touchingOld = out.some((mark) =>
      mark.target.type === "wire"
        ? mark.target.from === "old" || mark.target.to === "old"
        : mark.target.type === "word" && mark.target.slug === "old",
    );
    expect(touchingOld).toBe(false);
  });
});

describe("marks die with their target (ADR-0009)", () => {
  test("removing a word drops word marks on it and wire marks through it", () => {
    const marks = [
      mk(word("old")),
      mk(wire("old", "b", "w")),
      mk(wire("c", "old", "w")),
      mk(wire("c", "d", "w")),
      mk(word("sea")),
      mk(spot(1, 2)),
    ];
    expect(dropMarksTouching(marks, "old")).toEqual([
      mk(wire("c", "d", "w")),
      mk(word("sea")),
      mk(spot(1, 2)),
    ]);
  });

  test("removing a distance drops only the marks targeting that line", () => {
    const marks = [
      mk(wire("a", "b", "feeds")),
      mk(wire("a", "b", "needs")),
      mk(word("a")),
      mk(spot(1, 2)),
    ];
    expect(dropWireMarks(marks, "a", "b", "feeds")).toEqual([
      mk(wire("a", "b", "needs")),
      mk(word("a")),
      mk(spot(1, 2)),
    ]);
  });
});

describe("re-coin moves a wire mark and pins the collision survivor", () => {
  test("a free re-coin follows the relation and leaves the sibling alone", () => {
    const recast = mk(wire("a", "b", "w1"), { rank: 1 });
    const sibling = mk(wire("a", "b", "w2"));
    const out = recoinWireMarks([recast, sibling], "a", "b", "w1", "w3", false);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual(sibling);
    expect(out).toContainEqual(mk(wire("a", "b", "w3"), { rank: 1 }));
  });

  test("on collision the re-coined line's mark wins and the collided one is dropped", () => {
    const recast = mk(wire("a", "b", "w1"), { rank: 1 });
    const collided = mk(wire("a", "b", "w2"), { rank: 2 });
    const other = mk(wire("a", "b", "w3"));
    const out = recoinWireMarks([recast, collided, other], "a", "b", "w1", "w2", true);
    expect(out).toHaveLength(2);
    expect(out).toContainEqual(mk(wire("a", "b", "w2"), { rank: 1 }));
    expect(out).toContainEqual(other);
    expect(out).not.toContainEqual(mk(wire("a", "b", "w2"), { rank: 2 }));
  });

  test("colliding into an unmarked re-coined line still drops the collided mark", () => {
    const collided = mk(wire("a", "b", "w2"));
    expect(recoinWireMarks([collided], "a", "b", "w1", "w2", true)).toEqual([]);
  });

  test("a free key already named by an orphan mark loses to the app's move", () => {
    const recast = mk(wire("a", "b", "w1"), { rank: 1 });
    const orphan = mk(wire("a", "b", "w2"), { rank: 2 });
    const out = recoinWireMarks([recast, orphan], "a", "b", "w1", "w2", false);
    expect(out).toHaveLength(1);
    expect(out[0].extra).toEqual({ rank: 1 });
  });

  test("word and spot marks are untouched", () => {
    const words = [mk(word("a")), mk(spot(1, 2))];
    expect(recoinWireMarks(words, "a", "b", "w1", "w2", true)).toEqual(words);
  });

  test("markTargetKey is the wire's distance key", () => {
    expect(markTargetKey(wire("a", "b", "feeds"))).toBe(
      markTargetKey({ type: "wire", from: "a", to: "b", word: "feeds" }),
    );
  });
});