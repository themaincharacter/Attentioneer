import { describe, expect, test } from "bun:test";
import {
  dropLoopsTouching,
  dropMarksTouching,
  dropMembership,
  dropTouching,
  dropWireMarks,
  nextSlug,
  recoinWireMarks,
  rewriteEndpoints,
  rewriteLoopPaths,
  rewriteMarkEndpoints,
  rewriteMembership,
} from "../src/map/patches";
import type { Distance } from "../src/map/distances";
import { markTargetKey, type Mark, type MarkTarget } from "../src/map/marks";
import type { PlayingSet } from "../src/map/model";
import type { Loop } from "../src/map/loops";
import { serializeLoops as serializeLoopPaths } from "../src/map/loops";

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
describe("the playing set follows a rename and a remove (ADR-0013)", () => {
  const play = (words: string[], extra: Record<string, unknown> = {}): PlayingSet => ({
    words,
    extra,
  });

  test("rename rewrites the member slug and keeps sorted order and unknown keys", () => {
    const model = play(["rain", "soil"], { note: "why" });
    expect(rewriteMembership(model, "rain", "showers")).toEqual({
      words: ["showers", "soil"],
      extra: { note: "why" },
    });
    // Sorted order is the record's canonical member order, not draw order.
    expect(rewriteMembership(model, "soil", "air").words).toEqual(["air", "rain"]);
  });

  test("renaming a non-member is a no-op (the same record)", () => {
    const model = play(["rain"]);
    expect(rewriteMembership(model, "gone", "there")).toBe(model);
    expect(rewriteMembership(model, "rain", "rain")).toBe(model);
  });

  test("renaming onto an existing member collapses to one slug", () => {
    expect(rewriteMembership(play(["a", "b"]), "b", "a").words).toEqual(["a"]);
  });

  test("remove drops the membership line and leaves the rest", () => {
    const model = play(["rain", "soil", "mulch"], { note: "why" });
    expect(dropMembership(model, "soil")).toEqual({
      words: ["mulch", "rain"],
      extra: { note: "why" },
    });
  });

  test("removing a non-member is a no-op (no membership line exists)", () => {
    const model = play(["rain"]);
    expect(dropMembership(model, "gone")).toBe(model);
  });

  test("the batch's crash order keeps the word: membership is the pure step, the file is durable", () => {
    // removeReference writes the membership drop before deleting the file, so
    // a crash leaves the word on the map and out of play (visible, one accept
    // from being put back). renameReference writes the renamed file before the
    // membership rewrite, so a crash leaves a stale member name — visible, and
    // rewritten by the selector — never a member naming no word. This pins the
    // pure semantics the ordered batch relies on.
    const renamed = rewriteMembership(play(["rain"]), "rain", "showers");
    expect(renamed.words).toEqual(["showers"]);
    expect(dropMembership(renamed, "showers").words).toEqual([]);
  });
});

function lp(
  name: string,
  path: string[],
  extra: Record<string, unknown> = {},
): Loop {
  return { name, path, extra };
}

describe("a rename rewrites loop path slugs in the same batch (ADR-0012/0015)", () => {
  test("every path is rewritten and rotation-canonicalized again", () => {
    const loops = [
      lp("rain loop", ["soil", "plant", "rain", "soil"]),
      lp("other", ["a", "b", "a"]),
    ];
    const out = rewriteLoopPaths(loops, "soil", "earth");
    // Re-canonicalized: 'earth' now sorts before 'rain' but after 'plant'?
    // p < r and e < p, so the smallest is 'earth': the rotation moves.
    expect(out[0].path).toEqual(["earth", "plant", "rain", "earth"]);
    expect(out[1]).toEqual(loops[1]);
  });

  test("a rename that changes the smallest slug rotates the line", () => {
    const loops = [lp("loop", ["b", "c", "a", "b"])];
    const out = rewriteLoopPaths(loops, "b", "z");
    // body z,c,a -> smallest a -> [a,z,c] + closure.
    expect(out[0].path).toEqual(["a", "z", "c", "a"]);
    // ...and writing it again is byte-stable.
    expect(serializeLoopPaths(out)).toBe(
      '{"name":"loop","path":["a","z","c","a"]}' + "\n",
    );
  });

  test("the collision-suffixed slug a rename resolved flows straight into paths", () => {
    // renameReference resolves a name collision to 'rain-2' before this step.
    const loops = [lp("loop", ["rain", "soil", "rain"])];
    const out = rewriteLoopPaths(loops, "rain", "rain-2");
    expect(out[0].path).toEqual(["rain-2", "soil", "rain-2"]);
  });

  test("names, unknown keys, line count and line order are untouched", () => {
    const loops = [
      lp("rain loop", ["a", "b", "a"], { rank: 1 }),
      lp("soil loop", ["b", "c", "b"], { rank: 2 }),
    ];
    const out = rewriteLoopPaths(loops, "b", "z");
    expect(out).toHaveLength(2);
    expect(out.map((loop) => loop.name)).toEqual(["rain loop", "soil loop"]);
    expect(out.map((loop) => loop.extra)).toEqual([{ rank: 1 }, { rank: 2 }]);
    expect(out[0].path).toEqual(["a", "z", "a"]);
    // 'z' is no longer the smallest, so the line's rotation moves to 'c'.
    expect(out[1].path).toEqual(["c", "z", "c"]);
  });

  test("a self-loop and a path that never mentions the slug are handled", () => {
    const loops = [
      lp("self", ["a", "a"]),
      lp("untouched", ["c", "d", "c"]),
    ];
    const out = rewriteLoopPaths(loops, "c", "e");
    expect(out[0]).toEqual(loops[0]);
    // Renamed to 'e', which sorts after 'd': the canonical start is 'd'.
    expect(out[1].path).toEqual(["d", "e", "d"]);
    // Rewriting the same slug again is a no-op copy.
    expect(rewriteLoopPaths(loops, "c", "c")).toEqual(loops);
  });

  test("an unclosed hand-edited path is rewritten but never repaired", () => {
    const out = rewriteLoopPaths([lp("open", ["a", "b", "c"])], "a", "z");
    expect(out[0].path).toEqual(["z", "b", "c"]);
  });

  test("nextSlug is still exported where callers expect it", () => {
    expect(nextSlug("apple", new Set(["apple"]))).toBe("apple-2");
  });
});

describe("removing a reference drops the loops its path names (die-with-target)", () => {
  test("only the paths mentioning the slug go; the rest keep their bytes", () => {
    const loops = [
      lp("one", ["a", "b", "a"]),
      lp("two", ["b", "c", "b"]),
      lp("three", ["d", "e", "d"]),
    ];
    expect(dropLoopsTouching(loops, "b")).toEqual([loops[2]]);
  });

  test("a self-loop naming the removed word goes with it", () => {
    expect(dropLoopsTouching([lp("self", ["a", "a"])], "a")).toEqual([]);
  });

  test("nothing mentions the slug: no line is touched", () => {
    const loops = [lp("one", ["a", "b", "a"])];
    expect(dropLoopsTouching(loops, "gone")).toEqual(loops);
  });
});
