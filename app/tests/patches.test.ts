import { describe, expect, test } from "bun:test";
import {
  dropTouching,
  rewriteEndpoints,
} from "../src/map/patches";
import type { Distance } from "../src/map/distances";

function d(from: string, to: string, word: string): Distance {
  return { from, to, word, extra: {} };
}

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