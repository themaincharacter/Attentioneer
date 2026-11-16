import {
  GHOST_GAMES,
  isNameSlot,
  isPlainObject,
  type GhostGame,
} from "../ghost/envelope";
import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";

/**
 * GAME CARDS (Epic 11 story 1, ADR-0027) — one `map/cards.jsonl` line per GAME:
 * the person's NOTE on a language game, never a definition of it.
 *
 * The three game keys are the ghost envelope's `GHOST_GAMES` — ONE vocabulary,
 * not a fourth spelling of the level names. The envelope module is deliberately
 * map-independent (it imports no record module), so the record layer stays
 * acyclic.
 *
 * The key is the game itself (the family's convergence): a rewritten line
 * replaces the standing one; a hand-duplicated second line collides and
 * resolves (last write wins on the way out, and the extras are surfaced on the
 * way in). Several cards per game would need ids and a chooser — that is
 * imposition, not trial — so one line per game is the whole shape.
 *
 * WHAT IS AUTHORED: `conventions` (one prose paragraph) and `examples` (one or
 * more placeholder lines) — and NOTHING else. The MOVES line is DERIVED, never
 * stored, from the game's own move sources: the ghost registry's rows for that
 * game plus the canvas ring's `creationKinds` data, through the ONE helper
 * `gameMovesOf` (ghost/registry.ts). It is derived where it is read (the
 * packet, the screen) so a hand-edited copy can never become a second truth.
 * A line carrying a `moves` key is tolerated as an unknown: preserved, never
 * read; the derivation always wins.
 *
 * NO COINED NAMES, STRUCTURALLY: the card's looked-for keys are exactly
 * `game`, `conventions` and `examples`. There is no name slot to fill. A
 * name-shaped key is refused at the FIELD level — the line is malformed,
 * preserved verbatim and surfaced, exactly as the family preserves what it
 * cannot read — because a name is the person's to coin and a card is not a
 * place where one lives (ADR-0019's floor: a card describes a game's moves,
 * never a word's combined meaning). Examples use placeholder vocabulary by
 * convention: "a placeholder word" stands where a coined name would otherwise
 * tempt the author.
 *
 * THE FAMILY POSTURE holds: unknown keys on a known card survive a rewrite;
 * malformed lines are preserved verbatim AND surfaced by the record read's own
 * `malformed` list — never silently hidden (no card notice renders yet: a named
 * limit, not a promise); CRLF and a BOM are tolerated; a
 * missing file means no cards. Canonical serialization is serialize.ts's job
 * (ADR-0004); this module only turns the file's bytes into records and back.
 *
 * THE TRIAL'S SHAPE is NOT here yet (story 3): the shipped default always
 * stands, and a card rides the packet only when the person includes it for the
 * request. Deleting the line returns the default. Nothing in the grammar ever
 * reads a card — the card cannot change a verdict (card-independence; a
 * source-scan test holds the seam).
 *
 * No map batch touches a card: a card names no slug and no target, so a
 * rename, a remove or a branch's fan-out cannot reach it — `map/patches.ts`
 * has no cards writer, deliberately (the veils' posture).
 *
 * Provisional: the `cards.jsonl` name; the record's shape (`conventions` as
 * one prose string, `examples` as a non-empty list of non-empty placeholder
 * strings); the game keys being the ghost envelope's three games.
 */

/** The game a card is for — the same three games every ghost is pinned to. */
export type CardGame = GhostGame;

/** The card's looked-for keys: the game and its two AUTHORED parts. */
export const CARD_KEYS = ["game", "conventions", "examples"] as const;

/** The card record's file, workspace-relative (PROVISIONAL). */
export const CARDS_FILE = "map/cards.jsonl";

/** One game's card, as the file holds it: the person's note on one game. */
export interface Card {
  /** The game the note is about — the natural key (one line per game). */
  game: CardGame;
  /** The person's conventions prose, stored exactly as left (World B). */
  conventions: string;
  /**
   * Placeholder examples, stored verbatim. The convention is placeholder
   * vocabulary — never a coined name; nothing here is parsed, looked up or
   * applied.
   */
  examples: readonly string[];
  /** Unknown JSON keys preserved across rewrites (ADR-0006's posture). */
  extra: Record<string, unknown>;
}

/** What reading the cards file yields: the lines it could read and what it kept. */
export interface ParsedCards {
  /** Every readable line, in FILE ORDER, hand-duplicated keys included. */
  cards: Card[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
  /**
   * Lines whose game key already appeared earlier in the file. Preserved and
   * surfaced at read; a write resolves them (last write wins).
   */
  duplicates: Card[];
}

/** Is this value one of the three games? */
export function isCardGame(value: unknown): value is CardGame {
  return (
    typeof value === "string" &&
    (GHOST_GAMES as readonly string[]).includes(value)
  );
}

/** The card's natural key: the game (one line per game). */
export function cardKey(card: Card): CardGame {
  return card.game;
}

/** The cards file's path under one workspace. */
export function cardsPath(workspacePath: string): string {
  return `${workspacePath}/${CARDS_FILE}`;
}

/**
 * Parse one JSONL line into a Card; malformed or out-of-shape lines become
 * `null`. A card needs a known `game`, a non-empty `conventions` string and a
 * NON-EMPTY `examples` list of non-empty strings — the authored parts are
 * validated by KEY SET, never by a name scan. A name-shaped key is refused
 * here (the shape has no name slot), so such a line is malformed: preserved
 * and surfaced, never read as a card.
 */
export function parseCardLine(line: string): Card | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isPlainObject(value)) return null;
  const { game, conventions, examples, ...extra } = value;
  if (!isCardGame(game)) return null;
  if (typeof conventions !== "string" || conventions.trim() === "") return null;
  if (!Array.isArray(examples) || examples.length === 0) return null;
  if (
    !examples.every(
      (example) => typeof example === "string" && example.trim() !== "",
    )
  ) {
    return null;
  }
  // No name slot exists in the shape: a name-shaped key is out of shape, not
  // an unknown worth preserving (a card is not a place a coined name lives).
  if (Object.keys(extra).some((key) => isNameSlot(key))) return null;
  return { game, conventions, examples: examples as string[], extra };
}

/** Serialize one Card to its canonical JSONL line (compact, sorted keys). */
export function serializeCardLine(card: Card): string {
  return canonicalJsonlLine({
    ...card.extra,
    game: card.game,
    conventions: card.conventions,
    examples: [...card.examples],
  });
}

/**
 * Read `map/cards.jsonl` (from its bytes). Terminating newlines are ignored;
 * malformed or out-of-shape lines are preserved as unknowns (the family
 * posture) so the app never silently drops what it cannot read. Hand-duplicated
 * keys are kept as they came and reported as `duplicates`; `cardOf` reads the
 * LAST one (the second line resolves the collision). Tolerates a BOM and CRLF
 * from a hand edit.
 */
export function parseCards(text: string): ParsedCards {
  const cards: Card[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseCardLine(line);
    if (parsed) {
      cards.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return {
    cards,
    malformed,
    duplicates: findDuplicateCards(cards),
  };
}

/** Read the file from a workspace; a missing file means no cards. */
export async function loadCards(workspacePath: string): Promise<ParsedCards> {
  const text = await readTextFile(cardsPath(workspacePath));
  return text === null
    ? { cards: [], malformed: [], duplicates: [] }
    : parseCards(text);
}

/** The duplicate-key lines (every occurrence after the first), in file order. */
export function findDuplicateCards(cards: readonly Card[]): Card[] {
  const seen = new Set<CardGame>();
  const duplicates: Card[] = [];
  for (const card of cards) {
    if (seen.has(card.game)) {
      duplicates.push(card);
    } else {
      seen.add(card.game);
    }
  }
  return duplicates;
}

/**
 * Deduplicate by game, LAST write wins (the convergence rule), keeping the
 * file position of the key's first appearance. This is the write-side reading:
 * a rewritten line replaces the standing one; a hand-duplicated second line
 * resolves to the last.
 */
export function dedupeCards(cards: readonly Card[]): Card[] {
  const byGame = new Map<CardGame, Card>();
  for (const card of cards) {
    byGame.set(card.game, card);
  }
  return [...byGame.values()];
}

/**
 * The cards file's exact bytes. Known lines serialize canonically (sorted
 * keys), one per game (last write wins, FILE ORDER kept); malformed lines are
 * re-emitted verbatim. An empty document is the canonical empty JSONL (one
 * newline).
 */
export function serializeCards(
  cards: readonly Card[],
  malformed: readonly string[] = [],
): string {
  const known = dedupeCards(cards).map(serializeCardLine);
  return canonicalJsonlLines([...known, ...malformed]);
}

export async function saveCards(
  workspacePath: string,
  cards: readonly Card[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(cardsPath(workspacePath), serializeCards(cards, malformed));
}

/**
 * The effective card for one game, or null. With a hand-duplicated file the
 * LAST line wins — the second line collides and resolves (the write-side rule
 * made readable).
 */
export function cardOf(cards: readonly Card[], game: CardGame): Card | null {
  let found: Card | null = null;
  for (const card of cards) {
    if (card.game === game) found = card;
  }
  return found;
}

/**
 * Set one game's card: the standing line is REPLACED (at its own position when
 * it stands alone), never appended twice — a rewrite replaces. A hand-duplicated
 * file resolves to one line, the edited card as the survivor at the last
 * position. A game with no card gains one at the end.
 */
export function setCard(cards: readonly Card[], card: Card): Card[] {
  let lastIndex = -1;
  cards.forEach((existing, index) => {
    if (existing.game === card.game) lastIndex = index;
  });
  if (lastIndex === -1) return [...cards, card];
  const next: Card[] = [];
  cards.forEach((existing, index) => {
    if (existing.game !== card.game) {
      next.push(existing);
    } else if (index === lastIndex) {
      next.push(card);
    }
  });
  return next;
}

/** Remove one game's card line(s) — deleting the line returns the default. */
export function removeCard(cards: readonly Card[], game: CardGame): Card[] {
  return cards.filter((card) => card.game !== game);
}
