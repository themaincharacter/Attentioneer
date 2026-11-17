import { gameMembership, type ShapeWire } from "../canvas/languageGameRules";
import type { Box, Point } from "../canvas/geometry";
import { recordSetAside, setAsideShown } from "../canvas/shelfRules";
import { DEFAULT_SHELF_X } from "../map/shelf";
import type { GameShape } from "../map/languageGames";

/**
 * THE PER-GAME ONTOLOGY EXPORT — the DERIVATION (PROVISIONAL, added 2026-11-16
 * per ADR-0033 and notes/ontology-language-games-research.md §5).
 *
 * ADR-0033's rule, and this module's whole brief: STRUCTURE may be derived from
 * what the person did; MEANING may never be generated. So the derivation reads
 * the map's own records — the person's coined words, the person's drawn wires
 * and the person's relation words — and turns them into the smallest honest
 * structure: the words the game holds now, the relations grouped under the
 * person's own relation words, and the words that also play elsewhere. It
 * defines nothing, merges nothing, infers nothing, and picks no winner where
 * the map disagrees with itself.
 *
 * SIX INVARIANTS (research note §5.1), all structural here:
 *   1. one file per game — this derives ONE game; the caller owns the folder;
 *   2. the scope is the game — membership is the drawn shape (`gameMembership`,
 *      the canvas's own reading) and nothing else;
 *   3. the system authors no content — every noun returned is the person's
 *      word or game name; the only other words are the renderer's fixed
 *      template (render.ts);
 *   4. contradictions and overlaps are STATED — a pair carrying two relation
 *      words is listed under both; a shared word is listed on both sides and
 *      neither file resolves the difference;
 *   5. derived and never read back — pure; no model, no I/O, no clock; the map
 *      records remain the only source and nothing parses the artifact;
 *   6. it says what it is not — the renderer's fixed honesty block.
 *
 * ORDERING is the record's, never invented: the words in MAP order (the order
 * of the words list the caller hands in, which is the map's own order), the
 * relation words in FIRST-USE order over the held wires in FILE order, and the
 * pairs within a group in that same file order. Two runs over the same records
 * produce the same derivation, so the bytes rebuild identically.
 *
 * THE MEMBERSHIP FIX (PROVISIONAL — the lead's call, 2026-11-16): the artifact
 * must not list words the map does not show. While the shelf is hidden
 * (canvas/deprecations.ts's SHELF_HIDDEN, read through canvas/shelfRules.ts),
 * a word set aside by the shelf is excluded from this derivation's membership,
 * and so is every wire that touches one — the same both-ends rule the canvas
 * uses. This is NOT a feature of this module: DEPRECATED cross-reference — it
 * is a consequence of the shelf's hiding, it disappears when that flag flips
 * back, and it lives here (not in gameMembership) so the selector's own
 * at-least-one-word rule keeps its shipped meaning. PROVISIONAL because the
 * shelf's hiding is itself the review's provisional call.
 *
 * Provisional: the record shapes (OntologyWord/OntologyGame), the anchor rule
 * inherited from the canvas (a word counts at the centre of its measured box)
 * and the overlap's ordering are the research note's §5.3 proposal, not an ADR.
 */

/** One word as the derivation sees it: record identity, the person's coin, its plane place and measured box. */
export interface OntologyWord {
  /** The reference's file slug — the record's identity. */
  slug: string;
  /** The person's coined name — the only noun the artifact may print. */
  name: string;
  /** The word's stored top-left corner on the plane (the record's x/y). */
  pos: Point;
  /** The word's measured box (DEFAULT_BOX before measurement, as the canvas reads it). */
  box: Box;
}

/** One language game as the derivation sees it: the person's name and the drawn shape. */
export interface OntologyGame {
  name: string;
  shape: GameShape;
}

/** One relation the person drew, in the person's names (never slugs). */
export interface OntologyPair {
  from: string;
  to: string;
}

/** The pairs carrying one relation word, in the distance file's order. */
export interface OntologyRelation {
  /** The person's coined relation word — printed only as this heading. */
  relation: string;
  pairs: OntologyPair[];
}

/** One word that also plays in another game, and the games it plays in. */
export interface OntologyOverlap {
  /** The person's word (its coined name). */
  word: string;
  /** The other games holding it, in game file order. Never this game. */
  alsoIn: string[];
}

/** One game's derived structure — the renderer's only input. */
export interface DerivedGameOntology {
  /** The game's name (the scope, and the frontmatter's `game`). */
  game: string;
  /** The held words' coined names, in map order. */
  words: string[];
  /** The held relations, grouped by the person's relation word in first-use order. */
  propositions: OntologyRelation[];
  /** The held words that also play in another game, in map order. */
  overlaps: OntologyOverlap[];
}

/**
 * The words this derivation may draw on: the map's words that the map also
 * SHOWS right now. A word the shelf is hiding is not shown anywhere
 * (`setAsideShown`), so it is not a word of the game as the person sees it and
 * it must not appear in the artifact. The reading is the RECORD's stored left
 * edge — the same one the app hides by (`recordSetAside`) — never a live drag
 * position or a re-measure.
 *
 * PROVISIONAL, and a DEPRECATED cross-reference: this is a consequence of
 * `SHELF_HIDDEN` (canvas/deprecations.ts), not a rule of its own. Flipping that
 * flag back makes the filter a no-op and puts every set-aside word back, with
 * no edit here.
 */
export function ontologisableWords(
  words: readonly OntologyWord[],
  shelfX: number = DEFAULT_SHELF_X,
): OntologyWord[] {
  return words.filter((word) =>
    setAsideShown(recordSetAside(word.pos.x, shelfX)),
  );
}

/** The person's name for every slug the records hold (a gone slug falls back to itself). */
function namesOf(words: readonly OntologyWord[]): Map<string, string> {
  const names = new Map<string, string>();
  for (const word of words) {
    names.set(word.slug, word.name.trim() === "" ? word.slug : word.name);
  }
  return names;
}

/**
 * Derive one game's ontology from the map's records. Pure: the same records
 * always give the same derivation, and nothing here reads the artifact back.
 *
 * `allGames` is the game list (file order); the overlap pass asks every OTHER
 * game — matched by NAME, because the name is the record's natural key — which
 * of this game's held words it also holds, and reports those names in game
 * file order. A game that holds none of this game's words says nothing.
 *
 * `shelfX` is the workspace's fold (workspace.yml's `shelf_x`, defaulted);
 * it is only consulted by `ontologisableWords` (see the membership fix).
 */
export function deriveGameOntology(
  game: OntologyGame,
  words: readonly OntologyWord[],
  wires: readonly ShapeWire[],
  allGames: readonly OntologyGame[],
  shelfX: number = DEFAULT_SHELF_X,
): DerivedGameOntology {
  const visible = ontologisableWords(words, shelfX);
  const names = namesOf(words);
  const nameOf = (slug: string): string => names.get(slug) ?? slug;

  const membership = gameMembership(game.shape, visible, wires);
  const held = membership.words.map((slug) => ({ slug, name: nameOf(slug) }));

  // The relations: first use of a relation word opens its group, and each
  // wire follows in file order — a pair carrying two words appears in BOTH
  // groups (contradictions kept, never resolved).
  const order: string[] = [];
  const byRelation = new Map<string, OntologyPair[]>();
  for (const wire of membership.wires) {
    let pairs = byRelation.get(wire.word);
    if (pairs === undefined) {
      pairs = [];
      byRelation.set(wire.word, pairs);
      order.push(wire.word);
    }
    pairs.push({ from: nameOf(wire.from), to: nameOf(wire.to) });
  }
  const propositions: OntologyRelation[] = order.map((relation) => ({
    relation,
    pairs: byRelation.get(relation) ?? [],
  }));

  // The overlaps: every other game is asked once, under the SAME visibility
  // rule, so a word the shelf hides in the other game is not named there.
  const others = allGames
    .filter((other) => other.name !== game.name)
    .map((other) => ({
      name: other.name,
      held: new Set(gameMembership(other.shape, visible, wires).words),
    }));
  const overlaps: OntologyOverlap[] = [];
  for (const word of held) {
    const alsoIn: string[] = [];
    for (const other of others) {
      if (!other.held.has(word.slug)) continue;
      if (!alsoIn.includes(other.name)) alsoIn.push(other.name);
    }
    if (alsoIn.length > 0) overlaps.push({ word: word.name, alsoIn });
  }

  return {
    game: game.name,
    words: held.map((word) => word.name),
    propositions,
    overlaps,
  };
}
