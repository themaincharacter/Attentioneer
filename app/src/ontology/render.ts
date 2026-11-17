import { canonicalText, canonicalYaml } from "../lib/serialize";
import type { DerivedGameOntology } from "./derive";

/**
 * THE PER-GAME ONTOLOGY EXPORT — the RENDERER (PROVISIONAL, added 2026-11-16
 * per ADR-0033 and notes/ontology-language-games-research.md §5.4).
 *
 * One Markdown file per language game: five flat frontmatter lines
 * (no digests, no timestamps — they churn diffs and add nothing, §5.8 R9), then
 * the §5.4 body — the game's name as the H1, the fixed blockquote that says what
 * the view is, the words in map order, the relations grouped under the person's
 * own relation words, the words that also play elsewhere, and the fixed honesty
 * block.
 *
 * THE TEMPLATE IS THE ONLY AUTHORED TEXT. Every other noun in the output is the
 * person's coin or the person's game name — no definitions, glosses, types,
 * synonyms or inferred links (§5.1.3). The template words are exported as one
 * list (`ONTOLOGY_TEMPLATE`) so the §5.8 R1 review test can prove no other
 * noun appears.
 *
 * THE SHAPE IS FIXED. The five frontmatter lines, the H1, the blockquote and
 * the four section headings are always present, even when a section is empty
 * (a game the shelf has emptied still says what it is). The honesty block's
 * fourth line names how many words this view holds — the view's own size, never
 * a measure of the map — and the rest of it is verbatim.
 *
 * BYTES: canonical serialization's discipline (serialize.ts) — LF, one trailing
 * newline, deterministic order inherited from the derivation. Nothing here
 * reads the clock, the environment or the filesystem.
 */

/** The format marker every artifact carries (ADR-0033; the deletion guard reads it). */
export const ONTOLOGY_FORMAT = "attentioneer-ontology/1";

/** The frontmatter's `source` line: the records this view is derived from. */
export const ONTOLOGY_SOURCE =
  "map/language-games.jsonl, map/distances.jsonl, map/references/";

/** The blockquote that opens the body (§5.4, verbatim). */
export const ONTOLOGY_INTRO =
  "A derived view of one language game on the person's concept map. Every noun here is the person's own coin. Nothing here says what a word means.";

/** The words section's heading. */
export const ONTOLOGY_WORDS_HEADING = "Words in this game";

/** The relations section's heading. */
export const ONTOLOGY_RELATIONS_HEADING =
  "Relations the person drew, grouped by the word they coined for them";

/** The overlap section's heading. */
export const ONTOLOGY_OVERLAP_HEADING = "Words that also play in another game";

/** The honesty block's heading. */
export const ONTOLOGY_NOT_HEADING = "What this file is not";

/** The honesty block's fixed lines, but the fourth (which names this view's size). */
const NOT_DEFINITION =
  "Not a definition: no word here is assigned a meaning, a type, or a synonym.";
const NOT_MERGED =
  "Not merged: a word shared with another game keeps its own sense there; contradictions are kept, not resolved.";
const NOT_INFERRED =
  "Not inferred: no broader/narrower, no transitivity, no closure. If the person did not draw it, it is not here.";
const NOT_THE_MAP_BEFORE = "Not the map: this view holds ";
const NOT_THE_MAP_AFTER =
  "; the map is larger. The boundary is the person's own drawn region, and membership changes when a word moves.";
const NOT_EDITABLE =
  "Not editable: generated from the map files, never read back as data. Delete it and it returns.";

/**
 * The honesty block's five lines, verbatim (§5.4). The fourth states the view's
 * own size — the one number the artifact carries besides the frontmatter's two.
 */
export function ontologyNotLines(wordCount: number): string[] {
  const noun = wordCount === 1 ? "word" : "words";
  return [
    NOT_DEFINITION,
    NOT_MERGED,
    NOT_INFERRED,
    NOT_THE_MAP_BEFORE + wordCount + " " + noun + NOT_THE_MAP_AFTER,
    NOT_EDITABLE,
  ];
}

/**
 * Every word this module authors: the headings, the blockquote, the honesty
 * block's lines and the two fixed bullets' prefixes. The review test (§5.8 R1)
 * subtracts this list and the person's own nouns from the artifact, and fails
 * on anything left — the machine check for "no noun the system coined".
 */
export const ONTOLOGY_TEMPLATE: readonly string[] = [
  ONTOLOGY_FORMAT,
  ONTOLOGY_SOURCE,
  ONTOLOGY_INTRO,
  ONTOLOGY_WORDS_HEADING,
  ONTOLOGY_RELATIONS_HEADING,
  ONTOLOGY_OVERLAP_HEADING,
  ONTOLOGY_NOT_HEADING,
  NOT_DEFINITION,
  NOT_MERGED,
  NOT_INFERRED,
  NOT_THE_MAP_BEFORE,
  NOT_THE_MAP_AFTER,
  NOT_EDITABLE,
  "also in:",
  "format",
  "game",
  "source",
  "wires",
  "words",
];

/**
 * One derived game as the artifact's exact bytes (§5.4).
 *
 * A pair carrying two relation words appears under both headings, with no
 * winner; the arrow is the distance record's stored order (`from` → `to`),
 * never a claim of causality; the overlap line is the only cross-game
 * statement.
 */
export function renderGameOntology(derived: DerivedGameOntology): string {
  const frontmatter = canonicalYaml({
    format: ONTOLOGY_FORMAT,
    game: derived.game,
    source: ONTOLOGY_SOURCE,
    wires: derived.propositions.reduce(
      (pairs, relation) => pairs + relation.pairs.length,
      0,
    ),
    words: derived.words.length,
  }).trimEnd();

  const wordsSection = [
    "## " + ONTOLOGY_WORDS_HEADING,
    ...(derived.words.length > 0 ? ["", ...derived.words.map((word) => "- " + word)] : []),
  ].join("\n");

  const relationLines: string[] = ["## " + ONTOLOGY_RELATIONS_HEADING];
  for (const relation of derived.propositions) {
    relationLines.push("", "### " + relation.relation);
    for (const pair of relation.pairs) {
      relationLines.push("- " + pair.from + " → " + pair.to);
    }
  }
  const relationsSection = relationLines.join("\n");

  const overlapSection = [
    "## " + ONTOLOGY_OVERLAP_HEADING,
    ...(derived.overlaps.length > 0
      ? [
          "",
          ...derived.overlaps.map(
            (overlap) => "- " + overlap.word + " — also in: " + overlap.alsoIn.join(", "),
          ),
        ]
      : []),
  ].join("\n");

  const notSection = [
    "## " + ONTOLOGY_NOT_HEADING,
    "",
    ...ontologyNotLines(derived.words.length).map((line) => "- " + line),
  ].join("\n");

  const body = [
    "# " + derived.game,
    "> " + ONTOLOGY_INTRO,
    wordsSection,
    relationsSection,
    overlapSection,
    notSection,
  ].join("\n\n");

  return canonicalText(
    ["---", frontmatter, "---", "", body].join("\n"),
  );
}
