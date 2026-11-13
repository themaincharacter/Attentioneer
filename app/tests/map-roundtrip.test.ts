import { describe, expect, test } from "bun:test";
import {
  dropMarksTouching,
  dropTouching,
  nextSlug,
  rewriteEndpoints,
  rewriteMarkEndpoints,
} from "../src/map/patches";
import { parseReference, serializeReference, type Reference } from "../src/map/refs";
import {
  distanceKey,
  parseDistances,
  parseDistanceLine,
  serializeDistanceLine,
  serializeDistances,
  type Distance,
} from "../src/map/distances";
import {
  findOrphanMarks,
  parseMarks,
  serializeMarks,
  type Mark,
} from "../src/map/marks";
import { slugName } from "../src/lib/serialize";

/**
 * Story-4 guarantee, automated at the map level: coin a small map (words +
 * lines), serialize both files, parse back — byte-for-byte stable — then
 * change a distinction (rename a word, merge two by hand into one) and confirm
 * the map stays readable: no dangling lines, no lost prose, no lost unknown
 * keys (the epic's evidence line).
 */

function ref(slug: string, name: string, body: string): Reference {
  return { id: slug, slug, name, x: 0, y: 0, body, extra: {} };
}

function dist(from: string, to: string, word: string): Distance {
  return { from, to, word, extra: {} };
}

/** Serialize a full map to its two file strings. */
function serializeMap(refs: Reference[], lines: Distance[]) {
  const refTexts = refs.map((r) => serializeReference(r));
  const distText = lines.map(serializeDistanceLine).join("\n") + "\n";
  return { refTexts, distText };
}

/** All slugs referenced by a distance list — used to assert no danglers. */
function endpointSlugs(lines: Distance[]): Set<string> {
  const out = new Set<string>();
  for (const d of lines) {
    out.add(d.from);
    out.add(d.to);
  }
  return out;
}

describe("map round-trips byte-for-byte", () => {
  test("words and lines survive a serialize→parse cycle", () => {
    const words = [ref("a", "garden", "grows slowly\n"), ref("b", "seed", "\tplanted")];
    const lines = [dist("a", "b", "needs"), dist("b", "a", "feeds")];
    const { refTexts, distText } = serializeMap(words, lines);

    // references: parse(save) is byte-stable on every field
    for (const text of refTexts) {
      const p = parseReference("x", "x", text);
      expect(serializeReference(p)).toBe(text);
    }
    // distances: each line round-trips
    const parsed = parseDistances(distText);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.distances.map(serializeDistanceLine).join("\n") + "\n").toBe(distText);
  });

  test("prose is never normalized (hostile bodies)", () => {
    const bodies = ["line one\r\nline two\r\n", "trailing   \n\n", "---\ndecoy\n---\n"];
    for (const body of bodies) {
      const r = ref("t", "t", body);
      expect(parseReference("t", "t", serializeReference(r)).body).toBe(body);
    }
  });
});

describe("changing a distinction keeps the map readable", () => {
  test("rename propagates to every endpoint and leaves no dangler", () => {
    const lines = [dist("old", "b", "feeds"), dist("c", "old", "reads"), dist("c", "b", "w")];
    const renamed = rewriteEndpoints(lines, "old", "new");
    // every reference to "old" is now "new"
    expect(endpointSlugs(renamed).has("old")).toBe(false);
    expect(endpointSlugs(renamed).has("new")).toBe(true);
    // the untouched line survives
    expect(renamed).toContainEqual(dist("c", "b", "w"));
  });

  test("merge two words into one by hand drops the absorbed word's lines", () => {
    // merge "old" into "new": drop old's lines, keep new's
    const lines = [dist("old", "b", "w"), dist("new", "b", "w"), dist("c", "d", "w")];
    const merged = dropTouching(lines, "old");
    expect(endpointSlugs(merged).has("old")).toBe(false);
    expect(merged).toContainEqual(dist("new", "b", "w"));
    expect(merged).toContainEqual(dist("c", "d", "w"));
  });

  test("remove never dangles and keeps unknown keys", () => {
    const d = { from: "old", to: "b", word: "w", extra: { status: "draft" } } as Distance;
    const dropped = dropTouching([d], "old");
    expect(dropped).toEqual([]);
    // unknown keys on a surviving line survive a rewrite
    expect(parseDistanceLine(serializeDistanceLine(d))?.extra).toEqual({ status: "draft" });
  });
});

describe("slug minting (ADR-0005 collision rule)", () => {
  test("unicode names keep their letters; collisions get a suffix", () => {
    expect(slugName("想法")).toBe("想法");
    expect(nextSlug("apple", new Set(["banana"]))).toBe("apple");
    expect(nextSlug("apple", new Set(["apple"]))).toBe("apple-2");
    expect(nextSlug("apple", new Set(["apple", "apple-2"]))).toBe("apple-3");
  });
});

describe("the map's three records round-trip together", () => {
  const words = [
    ref("rain", "rain", "the water that arrives without being asked\n"),
    ref("soil", "soil", ""),
    ref("mulch", "mulch", "keeps the soil cool"),
    ref("tap-water", "tap water", ""),
  ];
  const lines = [
    dist("rain", "soil", "soaks"),
    dist("soil", "mulch", "protects"),
    dist("rain", "tap-water", "vs"),
  ];
  const marks: Mark[] = [
    {
      kind: "open",
      target: { type: "word", slug: "rain" },
      extra: { note: "tentative" },
    },
    {
      kind: "open",
      target: { type: "wire", from: "soil", to: "mulch", word: "protects" },
      extra: {},
    },
    { kind: "open", target: { type: "spot", x: 560, y: 470 }, extra: {} },
  ];
  const malformedMarks = ["{hand"];

  function slugsOf(list: Reference[]): Set<string> {
    return new Set(list.map((r) => r.slug).filter((s): s is string => s !== null));
  }

  function wireKeysOf(list: Distance[]): Set<string> {
    return new Set(list.map((d) => distanceKey(d.from, d.to, d.word)));
  }

  test("every file re-reads byte-for-byte and no mark dangles", () => {
    const refTexts = words.map(serializeReference);
    const distText = serializeDistances(lines);
    const markText = serializeMarks(marks, malformedMarks);

    for (const [index, text] of refTexts.entries()) {
      const owner = words[index];
      const parsed = parseReference(owner.id, owner.slug, text);
      expect(serializeReference(parsed)).toBe(text);
      expect(parsed.body).toBe(owner.body);
    }

    const parsedDistances = parseDistances(distText);
    expect(parsedDistances.malformed).toEqual([]);
    expect(serializeDistances(parsedDistances.distances)).toBe(distText);

    const parsedMarks = parseMarks(markText);
    expect(parsedMarks.malformed).toEqual(malformedMarks);
    expect(serializeMarks(parsedMarks.marks, parsedMarks.malformed)).toBe(markText);
    expect(parsedMarks.marks[0]).toEqual(marks[0]);

    expect(
      findOrphanMarks(parsedMarks.marks, slugsOf(words), wireKeysOf(lines)),
    ).toEqual([]);
  });

  test("renaming a word stays readable across all three files", () => {
    const renamedWords = words.map((word) =>
      word.slug === "soil"
        ? { ...word, id: "ground", slug: "ground", name: "ground" }
        : word,
    );
    const renamedLines = rewriteEndpoints(lines, "soil", "ground");
    const renamedMarks = rewriteMarkEndpoints(marks, "soil", "ground");

    // Prose rides along byte-verbatim; only the identity moved.
    expect(renamedWords.find((word) => word.slug === "ground")!.body).toBe(
      words.find((word) => word.slug === "soil")!.body,
    );
    expect(renamedLines).toEqual([
      dist("rain", "ground", "soaks"),
      dist("ground", "mulch", "protects"),
      dist("rain", "tap-water", "vs"),
    ]);
    // The wire mark follows its endpoint; untouched marks ride along with
    // their unknown keys, and the bare spot is untouched.
    expect(renamedMarks).toContainEqual({
      kind: "open",
      target: { type: "wire", from: "ground", to: "mulch", word: "protects" },
      extra: {},
    });
    expect(renamedMarks).toContainEqual(marks[0]);
    expect(renamedMarks).toContainEqual(marks[2]);

    expect(
      findOrphanMarks(
        renamedMarks,
        slugsOf(renamedWords),
        wireKeysOf(renamedLines),
      ),
    ).toEqual([]);
    const text = serializeMarks(renamedMarks);
    expect(serializeMarks(parseMarks(text).marks)).toBe(text);
  });

  test("removing a word leaves no line and no mark dangling", () => {
    const removedLines = dropTouching(lines, "soil");
    const removedMarks = dropMarksTouching(marks, "soil");

    expect(removedLines.map((d) => d.word)).toEqual(["vs"]);
    expect(removedMarks).toEqual([marks[0], marks[2]]);
    expect(
      findOrphanMarks(
        removedMarks,
        slugsOf(words.filter((word) => word.slug !== "soil")),
        wireKeysOf(removedLines),
      ),
    ).toEqual([]);
  });
});
