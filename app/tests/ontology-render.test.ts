import { describe, expect, test } from "bun:test";
import { DEFAULT_BOX } from "../src/canvas/geometry";
import {
  deriveGameOntology,
  type OntologyGame,
  type OntologyWord,
} from "../src/ontology/derive";
import {
  ONTOLOGY_INTRO,
  ONTOLOGY_NOT_HEADING,
  ONTOLOGY_OVERLAP_HEADING,
  ONTOLOGY_RELATIONS_HEADING,
  ONTOLOGY_SOURCE,
  ONTOLOGY_TEMPLATE,
  ONTOLOGY_WORDS_HEADING,
  ONTOLOGY_FORMAT,
  ontologyNotLines,
  renderGameOntology,
} from "../src/ontology/render";
import { ONTOLOGY_FOREIGN_NOTICE } from "../src/ontology/sync";
import { DEFAULT_SHELF_X } from "../src/map/shelf";

/**
 * The per-game ontology export's RENDERER, automated (PROVISIONAL, added
 * 2026-11-16 per ADR-0033 and notes/ontology-language-games-research.md §5.4).
 *
 * The byte claims: the §5.4 worked example reproduces EXACTLY, the bytes are
 * deterministic (render twice, equal), canonical (LF, one trailing newline) and
 * the honesty block is verbatim. The honesty claims: no score/streak/heat
 * vocabulary anywhere in the new text, and no noun in the artifact that is not
 * the person's own or a fixed template word (§5.8 R1's review test).
 */

const shelfX = DEFAULT_SHELF_X;

function word(slug: string, name: string, x: number, y: number): OntologyWord {
  return { slug, name, pos: { x, y }, box: DEFAULT_BOX };
}

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
const heap: OntologyGame = {
  name: "heap",
  // Holds soil's centre (138) and neither rain's (88) nor mulch's (188).
  shape: { kind: "rect", x: 120, y: 0, w: 40, h: 120 },
};
const WIRES = [
  { from: "mulch", to: "soil", word: "covers" },
  { from: "rain", to: "soil", word: "soaks" },
];

/** §5.4's worked example, byte for byte. */
const WORKED_EXAMPLE = `---
format: "attentioneer-ontology/1"
game: "garden bed"
source: "map/language-games.jsonl, map/distances.jsonl, map/references/"
wires: 2
words: 3
---

# garden bed

> A derived view of one language game on the person's concept map. Every noun here is the person's own coin. Nothing here says what a word means.

## Words in this game

- rain
- soil
- mulch

## Relations the person drew, grouped by the word they coined for them

### covers
- mulch → soil

### soaks
- rain → soil

## Words that also play in another game

- soil — also in: heap

## What this file is not

- Not a definition: no word here is assigned a meaning, a type, or a synonym.
- Not merged: a word shared with another game keeps its own sense there; contradictions are kept, not resolved.
- Not inferred: no broader/narrower, no transitivity, no closure. If the person did not draw it, it is not here.
- Not the map: this view holds 3 words; the map is larger. The boundary is the person's own drawn region, and membership changes when a word moves.
- Not editable: generated from the map files, never read back as data. Delete it and it returns.
`;

describe("the §5.4 worked example", () => {
  const derived = deriveGameOntology(
    gardenBed,
    W,
    WIRES,
    [gardenBed, heap],
    shelfX,
  );

  test("reproduces the artifact EXACTLY", () => {
    expect(renderGameOntology(derived)).toBe(WORKED_EXAMPLE);
  });

  test("the bytes are canonical: LF only, one trailing newline", () => {
    const text = renderGameOntology(derived);
    expect(text).not.toContain("\r");
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
  });

  test("rendering twice is byte-identical (deterministic, no clock, no rng)", () => {
    expect(renderGameOntology(derived)).toBe(renderGameOntology(derived));
    const again = deriveGameOntology(gardenBed, W, WIRES, [gardenBed, heap], shelfX);
    expect(renderGameOntology(again)).toBe(WORKED_EXAMPLE);
  });

  test("the frontmatter is five flat lines — no digests, no timestamps", () => {
    const changed = renderGameOntology(
      deriveGameOntology(
        gardenBed,
        [...W],
        WIRES,
        [gardenBed, heap],
        shelfX,
      ),
    );
    expect(changed).toBe(WORKED_EXAMPLE);
    const frontmatter = WORKED_EXAMPLE.split("---")[1].trim().split("\n");
    expect(frontmatter).toHaveLength(5);
    expect(frontmatter[0]).toBe('format: "' + ONTOLOGY_FORMAT + '"');
    expect(frontmatter[1]).toBe('game: "garden bed"');
    expect(frontmatter[2]).toBe('source: "' + ONTOLOGY_SOURCE + '"');
    expect(frontmatter[3]).toBe("wires: 2");
    expect(frontmatter[4]).toBe("words: 3");
    expect(WORKED_EXAMPLE).not.toMatch(/\b(sha|digest|date|time|generated_at)\b/i);
  });

  test("the honesty block is the fixed block, verbatim", () => {
    for (const line of ontologyNotLines(3)) {
      expect(WORKED_EXAMPLE).toContain("- " + line);
    }
    expect(ontologyNotLines(3)).toEqual([
      "Not a definition: no word here is assigned a meaning, a type, or a synonym.",
      "Not merged: a word shared with another game keeps its own sense there; contradictions are kept, not resolved.",
      "Not inferred: no broader/narrower, no transitivity, no closure. If the person did not draw it, it is not here.",
      "Not the map: this view holds 3 words; the map is larger. The boundary is the person's own drawn region, and membership changes when a word moves.",
      "Not editable: generated from the map files, never read back as data. Delete it and it returns.",
    ]);
    expect(WORKED_EXAMPLE).toContain("## " + ONTOLOGY_NOT_HEADING);
    expect(WORKED_EXAMPLE).toContain("> " + ONTOLOGY_INTRO);
    expect(WORKED_EXAMPLE).toContain("## " + ONTOLOGY_WORDS_HEADING);
    expect(WORKED_EXAMPLE).toContain("## " + ONTOLOGY_RELATIONS_HEADING);
    expect(WORKED_EXAMPLE).toContain("## " + ONTOLOGY_OVERLAP_HEADING);
  });

  test("a pair under two relation words prints under both headings", () => {
    const both = renderGameOntology(
      deriveGameOntology(
        gardenBed,
        W,
        [
          { from: "rain", to: "soil", word: "soaks" },
          { from: "rain", to: "soil", word: "feeds" },
        ],
        [gardenBed],
        shelfX,
      ),
    );
    expect(both.split("- rain → soil").length - 1).toBe(2);
    expect(both).toContain("### feeds");
    expect(both).toContain("### soaks");
  });

  test("an empty game still says everything it is and is not", () => {
    const away: OntologyGame = {
      name: "empty",
      shape: { kind: "rect", x: 900, y: 900, w: 10, h: 10 },
    };
    const text = renderGameOntology(
      deriveGameOntology(away, W, WIRES, [away], shelfX),
    );
    expect(text).toContain("# empty");
    expect(text).toContain("words: 0");
    expect(text).toContain("this view holds 0 words");
    expect(text).toContain("## " + ONTOLOGY_RELATIONS_HEADING);
    expect(text).toContain("## " + ONTOLOGY_OVERLAP_HEADING);
  });
});

/* ----------------------------------------------------------------------- *
 * The review tests (§5.8): the negative space, and the authored-noun guard.
 * ----------------------------------------------------------------------- */

/** The repo's quiet-vocabulary guard (the language games' own test uses it). */
const FORBIDDEN =
  /\b(badge|count|counts|score|scores|streak|streaks|heat|progress|tally|meter|nudge|remind|queue|backlog|total|points|rank|ranking)\b/i;

describe("the new text announces and ranks nothing", () => {
  test("the artifact carries no score/streak/heat vocabulary", () => {
    expect(WORKED_EXAMPLE.match(FORBIDDEN)?.[0] ?? null).toBeNull();
  });

  test("every fixed template string and the foreign-file notice is quiet too", () => {
    const strings = [...ONTOLOGY_TEMPLATE, ONTOLOGY_FOREIGN_NOTICE];
    expect(strings.length).toBeGreaterThan(10);
    for (const text of strings) {
      expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        text,
        found: null,
      });
    }
  });
});

/**
 * §5.8 R1's review test, as a machine check: tokenise the artifact, subtract
 * the fixed template's own words and the person's coins, and fail on anything
 * left. Section headings, frontmatter keys are template; "rain", "garden bed",
 * "covers", "heap" are the person's. Nothing else may appear.
 */
describe("no noun in the artifact that is not the person's or a template word", () => {
  const TOKEN = /[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu;

  test("every token is the person's coin or a fixed template word", () => {
    const artifact = WORKED_EXAMPLE;
    const template = new Set(
      ONTOLOGY_TEMPLATE.flatMap((text) => text.match(TOKEN) ?? []).map((t) => t.toLowerCase()),
    );
    const person = new Set(
      [
        "garden bed",
        "rain",
        "soil",
        "mulch",
        "covers",
        "soaks",
        "heap",
      ].flatMap((text) => text.match(TOKEN) ?? []).map((t) => t.toLowerCase()),
    );
    const stray = (artifact.match(TOKEN) ?? []).filter(
      (token) =>
        !template.has(token.toLowerCase()) &&
        !person.has(token.toLowerCase()) &&
        !/^[0-9]+$/.test(token),
    );
    expect(stray).toEqual([]);
  });
});
