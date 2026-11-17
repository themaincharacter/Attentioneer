import { describe, expect, test } from "bun:test";
import {
  deriveGameOntology,
  ontologisableWords,
  type OntologyGame,
  type OntologyWord,
} from "../src/ontology/derive";
import { DEFAULT_BOX } from "../src/canvas/geometry";
import { DEFAULT_SHELF_X } from "../src/map/shelf";

/**
 * The per-game ontology export's DERIVATION, automated (PROVISIONAL, added
 * 2026-11-16 per ADR-0033 and notes/ontology-language-games-research.md §5).
 *
 * The derivation is structure only: the words a game's drawn shape holds (the
 * canvas's own membership), the relations grouped under the person's relation
 * words in FIRST-USE order, the overlaps stated across games, and no inference,
 * no merge and no winner. The one exception to "the shape decides" is the
 * lead's membership fix: while the shelf is hidden, a word the shelf hides is
 * not shown by the map, so it is not a word of the artifact either.
 */

const shelfX = DEFAULT_SHELF_X;

function word(slug: string, name: string, x: number, y: number): OntologyWord {
  return { slug, name, pos: { x, y }, box: DEFAULT_BOX };
}

/** The §5.4 garden bed: rain and mulch around soil, compost outside. */
const W = [
  word("rain", "rain", 40, 60),
  word("soil", "soil", 90, 60),
  word("mulch", "mulch", 140, 60),
  word("compost", "compost", 400, 60),
];

const gardenBed: OntologyGame = {
  name: "garden bed",
  shape: { kind: "rect", x: 0, y: 0, w: 200, h: 120 },
};

/** A second game holding soil only (the overlap's other side). */
const heap: OntologyGame = {
  name: "heap",
  // Holds soil's centre (138) and neither rain's (88) nor mulch's (188).
  shape: { kind: "rect", x: 120, y: 0, w: 40, h: 120 },
};

const WIRES = [
  { from: "mulch", to: "soil", word: "covers" },
  { from: "rain", to: "soil", word: "soaks" },
];

describe("the words are the shape's words, in map order", () => {
  test("the drawn shape decides membership; a word outside is not held", () => {
    const derived = deriveGameOntology(gardenBed, W, WIRES, [gardenBed], shelfX);
    expect(derived.game).toBe("garden bed");
    expect(derived.words).toEqual(["rain", "soil", "mulch"]);
    // The map's order is the words list's order — not sorted, not alphabetical.
    expect(derived.words).not.toEqual([...derived.words].sort());
    // compost is outside the rectangle.
    expect(derived.words).not.toContain("compost");
  });

  test("the person's name is printed, never the file slug", () => {
    const named = [
      word("rain", "rain water", 40, 60),
      word("soil", "the soil", 90, 60),
    ];
    const derived = deriveGameOntology(gardenBed, named, [], [gardenBed], shelfX);
    expect(derived.words).toEqual(["rain water", "the soil"]);
  });

  test("an empty region derives an empty view, never a guess", () => {
    const away: OntologyGame = {
      name: "empty",
      shape: { kind: "rect", x: 900, y: 900, w: 10, h: 10 },
    };
    const derived = deriveGameOntology(away, W, WIRES, [away], shelfX);
    expect(derived).toEqual({
      game: "empty",
      words: [],
      propositions: [],
      overlaps: [],
    });
  });
});

describe("the relations: the person's words, in first-use order", () => {
  test("groups open in first use, pairs follow in file order", () => {
    const wires = [
      { from: "mulch", to: "soil", word: "covers" },
      { from: "rain", to: "soil", word: "soaks" },
      { from: "soil", to: "mulch", word: "covers" },
    ];
    const derived = deriveGameOntology(gardenBed, W, wires, [gardenBed], shelfX);
    expect(derived.propositions).toEqual([
      {
        relation: "covers",
        pairs: [
          { from: "mulch", to: "soil" },
          { from: "soil", to: "mulch" },
        ],
      },
      { relation: "soaks", pairs: [{ from: "rain", to: "soil" }] },
    ]);
  });

  test("a pair carrying two relation words is under BOTH headings, no winner", () => {
    const both = [
      { from: "rain", to: "soil", word: "soaks" },
      { from: "rain", to: "soil", word: "feeds" },
    ];
    const derived = deriveGameOntology(gardenBed, W, both, [gardenBed], shelfX);
    expect(derived.propositions.map((entry) => entry.relation)).toEqual([
      "soaks",
      "feeds",
    ]);
    for (const relation of derived.propositions) {
      expect(relation.pairs).toEqual([{ from: "rain", to: "soil" }]);
    }
  });

  test("a wire with one end outside the game is not a relation of the game", () => {
    const outside = [{ from: "compost", to: "soil", word: "feeds" }];
    const derived = deriveGameOntology(gardenBed, W, outside, [gardenBed], shelfX);
    expect(derived.propositions).toEqual([]);
  });

  test("the arrow keeps the record's stored order (from then to)", () => {
    const reversed = [{ from: "soil", to: "mulch", word: "covers" }];
    const derived = deriveGameOntology(gardenBed, W, reversed, [gardenBed], shelfX);
    expect(derived.propositions[0].pairs[0]).toEqual({
      from: "soil",
      to: "mulch",
    });
  });
});

describe("the overlaps: family resemblance, never a merge", () => {
  test("a shared word names the other game; a word held nowhere else is silent", () => {
    const derived = deriveGameOntology(gardenBed, W, WIRES, [gardenBed, heap], shelfX);
    expect(derived.overlaps).toEqual([{ word: "soil", alsoIn: ["heap"] }]);
  });

  test("a game does not overlap itself, even when it appears twice in the list", () => {
    const derived = deriveGameOntology(gardenBed, W, WIRES, [gardenBed], shelfX);
    expect(derived.overlaps).toEqual([]);
  });

  test("two other games are named in game file order", () => {
    const heapA: OntologyGame = { ...heap, name: "heap" };
    const heapB: OntologyGame = { ...heap, name: "compost corner" };
    const derived = deriveGameOntology(
      gardenBed,
      W,
      WIRES,
      [gardenBed, heapA, heapB],
      shelfX,
    );
    expect(derived.overlaps).toEqual([
      { word: "soil", alsoIn: ["heap", "compost corner"] },
    ]);
  });
});

describe("the membership fix: the shelf's hiding is not the artifact's word", () => {
  /** A word parked past the fold: the record's x is at the fold. */
  const shelved = word("mulch", "mulch", shelfX, 60);

  test("a shelf-hidden word is not held, even when the shape covers it", () => {
    // The shape covers the wide plane, so only the shelf reading can exclude.
    const wide: OntologyGame = {
      name: "garden bed",
      shape: { kind: "rect", x: 0, y: 0, w: shelfX + 500, h: 400 },
    };
    const words = [word("rain", "rain", 40, 60), word("soil", "soil", 90, 60), shelved];
    const derived = deriveGameOntology(wide, words, WIRES, [wide], shelfX);
    expect(derived.words).toEqual(["rain", "soil"]);
    expect(derived.words).not.toContain("mulch");
    // The wire that needed mulch goes with it (both ends held, the canvas rule).
    expect(derived.propositions).toEqual([
      { relation: "soaks", pairs: [{ from: "rain", to: "soil" }] },
    ]);
    // And a hidden word is never named as an overlap either.
    expect(derived.overlaps).toEqual([]);
  });

  test("the filter reads the stored left edge, not the word's centre", () => {
    const justShort = word("mulch", "mulch", shelfX - 1, 60);
    expect(ontologisableWords([justShort], shelfX)).toHaveLength(1);
    expect(ontologisableWords([shelved], shelfX)).toHaveLength(0);
    // The filter alone, with the flag's default (the hiding is live).
    expect(ontologisableWords([shelved, justShort], shelfX).map((w) => w.name)).toEqual([
      "mulch",
    ]);
  });

  test("a word hidden in ANOTHER game is not named there in the overlap", () => {
    // heap holds soil at x = 90 in this reading; move soil past the fold and the
    // second game no longer holds it, so garden bed's soil has no overlap.
    const hiddenSoil = word("soil", "soil", shelfX, 60);
    const words = [word("rain", "rain", 40, 60), hiddenSoil, word("mulch", "mulch", 140, 60)];
    const derived = deriveGameOntology(
      gardenBed,
      words,
      WIRES,
      [gardenBed, heap],
      shelfX,
    );
    expect(derived.words).toEqual(["rain", "mulch"]);
    expect(derived.overlaps).toEqual([]);
  });
});
