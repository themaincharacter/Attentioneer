import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { creationKinds } from "../src/canvas/gates";
import { GHOST_GAMES } from "../src/ghost/envelope";
import {
  gameMovesOf,
  MOVES,
  type GameMoveRow,
} from "../src/ghost/registry";
import {
  CARD_KEYS,
  CARDS_FILE,
  cardOf,
  cardsPath,
  dedupeCards,
  findDuplicateCards,
  parseCardLine,
  parseCards,
  removeCard,
  serializeCardLine,
  serializeCards,
  setCard,
  type Card,
  type CardGame,
} from "../src/map/cards";

/**
 * Epic 11 story 1 — the card record (ADR-0027), automated.
 *
 * `map/cards.jsonl` is one line per GAME: the authored parts are conventions
 * and placeholder examples ONLY; the moves line is DERIVED through the one
 * helper (registry rows + the canvas's creation kinds, both passed as data).
 * The family posture holds: unknown keys preserved, malformed lines preserved
 * AND surfaced, CRLF/BOM tolerated. The shape has NO name slot. And the record
 * stays independent of the grammar: the grammar never reads a card, and the
 * ghost layer never imports the canvas.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");
const NL = "\n";

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

/** Every .ts/.tsx file under src/, recursively. */
function sourceFiles(dir: string = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

function ghostSources(): string[] {
  return sourceFiles(join(SRC, "ghost"));
}

function card(
  game: CardGame = "dynamics",
  conventions = "one way to play",
  extra: Record<string, unknown> = {},
): Card {
  return {
    game,
    conventions,
    examples: ["a placeholder word -> another placeholder word"],
    extra,
  };
}

function lineOf(value: Card): string {
  return serializeCardLine(value).trim();
}

describe("the card line's canonical bytes", () => {
  test("compact, sorted keys, the authored parts and their game", () => {
    expect(lineOf(card())).toBe(
      '{"conventions":"one way to play","examples":["a placeholder word -> another placeholder word"],"game":"dynamics"}',
    );
  });

  test("a document is one line per game, in FILE ORDER, trailing newline", () => {
    const text = serializeCards([
      card("concept"),
      card("dynamics"),
      card("ground"),
    ]);
    expect(text.split(NL)).toHaveLength(4);
    expect(text.endsWith(NL)).toBe(true);
    expect(text.split(NL)[0]).toContain('"concept"');
    expect(text.split(NL)[1]).toContain('"dynamics"');
  });

  test("an empty document is the canonical empty JSONL (one newline)", () => {
    expect(serializeCards([])).toBe(NL);
  });

  test("a line round-trips through parse and serialize byte-exactly", () => {
    const line = lineOf(card());
    const parsed = parseCardLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed).toEqual(card());
    expect(serializeCardLine(parsed as Card)).toBe(line);
  });

  test("the file path is map/cards.jsonl under the workspace", () => {
    expect(cardsPath("/maps/garden")).toBe("/maps/garden/map/cards.jsonl");
    expect(CARDS_FILE).toBe("map/cards.jsonl");
  });
});

describe("the family convergence: one line per game", () => {
  test("a rewritten line REPLACES the standing one at its own position", () => {
    const before = [card("concept"), card("dynamics", "first")];
    const after = setCard(before, card("dynamics", "second"));
    expect(after).toHaveLength(2);
    expect(after[0].game).toBe("concept");
    expect(after[1].conventions).toBe("second");
  });

  test("a game with no card gains one last; an unknown game is not invented", () => {
    const after = setCard([card("concept")], card("ground"));
    expect(after.map((entry) => entry.game)).toEqual(["concept", "ground"]);
  });

  test("a hand-duplicated second line collides and resolves (last write wins)", () => {
    const hand =
      lineOf(card("dynamics", "first")) +
      NL +
      lineOf(card("dynamics", "second")) +
      NL;
    const parsed = parseCards(hand);
    // The read preserves both and surfaces the collision.
    expect(parsed.cards).toHaveLength(2);
    expect(parsed.duplicates).toHaveLength(1);
    expect(parsed.duplicates[0].conventions).toBe("second");
    // The effective card is the LAST line; the key itself is unchanged.
    expect(cardOf(parsed.cards, "dynamics")?.conventions).toBe("second");
    // The write resolves it to ONE line for the game.
    const written = serializeCards(parsed.cards, parsed.malformed);
    expect(written.trim().split(NL)).toHaveLength(1);
    expect(written).toContain('"second"');
    expect(written).not.toContain('"first"');
  });

  test("setting a card over a hand-duplicated file leaves exactly one, the edited one", () => {
    const hand =
      lineOf(card("concept")) +
      NL +
      lineOf(card("dynamics", "first")) +
      NL +
      lineOf(card("dynamics", "second")) +
      NL;
    const parsed = parseCards(hand);
    const next = setCard(parsed.cards, card("dynamics", "edited"));
    expect(dedupeCards(next)).toHaveLength(2);
    expect(cardOf(next, "dynamics")?.conventions).toBe("edited");
    expect(serializeCards(next).trim().split(NL)).toHaveLength(2);
  });

  test("removeCard drops one game's line and only that line", () => {
    const cards = [card("concept"), card("dynamics"), card("ground")];
    const next = removeCard(cards, "dynamics");
    expect(next.map((entry) => entry.game)).toEqual(["concept", "ground"]);
    // Deleting the line returns the default: no card means the shipped one stands.
    expect(cardOf(next, "dynamics")).toBeNull();
  });

  test("duplicate detection is by the game key, in file order", () => {
    const cards = [
      card("concept"),
      card("dynamics", "a"),
      card("dynamics", "b"),
      card("concept", "c"),
    ];
    expect(findDuplicateCards(cards).map((entry) => entry.conventions)).toEqual([
      "b",
      "c",
    ]);
  });
});

describe("field validation by KEY SET", () => {
  test("the game must be one of the three games", () => {
    expect(
      parseCardLine(
        '{"conventions":"x","examples":["y"],"game":"play"}',
      ),
    ).toBeNull();
    expect(
      parseCardLine('{"conventions":"x","examples":["y"]}'),
    ).toBeNull();
    for (const game of GHOST_GAMES) {
      expect(
        parseCardLine(
          JSON.stringify({
            game,
            conventions: "x",
            examples: ["y"],
          }),
        )?.game,
      ).toBe(game);
    }
  });

  test("the authored conventions must be a non-empty string", () => {
    expect(parseCardLine('{"examples":["y"],"game":"dynamics"}')).toBeNull();
    expect(
      parseCardLine('{"conventions":"","examples":["y"],"game":"dynamics"}'),
    ).toBeNull();
    expect(
      parseCardLine(
        '{"conventions":"   ","examples":["y"],"game":"dynamics"}',
      ),
    ).toBeNull();
    expect(
      parseCardLine('{"conventions":7,"examples":["y"],"game":"dynamics"}'),
    ).toBeNull();
  });

  test("the examples must be a non-empty list of non-empty strings", () => {
    expect(
      parseCardLine('{"conventions":"x","game":"dynamics"}'),
    ).toBeNull();
    expect(
      parseCardLine('{"conventions":"x","examples":[],"game":"dynamics"}'),
    ).toBeNull();
    expect(
      parseCardLine('{"conventions":"x","examples":"y","game":"dynamics"}'),
    ).toBeNull();
    expect(
      parseCardLine('{"conventions":"x","examples":["ok",""],"game":"dynamics"}'),
    ).toBeNull();
    expect(
      parseCardLine('{"conventions":"x","examples":["ok","  "],"game":"dynamics"}'),
    ).toBeNull();
    expect(
      parseCardLine('{"conventions":"x","examples":["ok",3],"game":"dynamics"}'),
    ).toBeNull();
  });

  test("unknown keys are PRESERVED (the family posture)", () => {
    const hand =
      '{"conventions":"x","examples":["y"],"game":"dynamics","note":"kept","z":2}';
    const parsed = parseCardLine(hand);
    expect(parsed).not.toBeNull();
    expect(parsed?.extra).toEqual({ note: "kept", z: 2 });
    expect(serializeCardLine(parsed as Card)).toBe(
      '{"conventions":"x","examples":["y"],"game":"dynamics","note":"kept","z":2}',
    );
    // A rewrite that keeps the record keeps its unknown keys too.
    const edited: Card = { ...(parsed as Card), conventions: "edited" };
    expect(
      serializeCardLine(setCard([parsed as Card], edited)[0]),
    ).toContain('"note":"kept"');
  });

  test("the shape has NO name slot: the key set is game, conventions, examples", () => {
    expect([...CARD_KEYS]).toEqual(["game", "conventions", "examples"]);
    expect(CARD_KEYS as readonly string[]).not.toContain("name");
    const parsed = parseCardLine(lineOf(card()));
    expect(parsed).not.toBeNull();
    expect(parsed as Card).not.toHaveProperty("name");
    // The record's own fields are exactly the known keys plus the unknown store.
    expect(Object.keys(parsed as Card).sort()).toEqual([
      "conventions",
      "examples",
      "extra",
      "game",
    ]);
  });

  test("a card naming a word is refused at the FIELD level (no name slot)", () => {
    // A name-shaped key is out of shape: the line is malformed, preserved and
    // surfaced — never read as a card. (The structural check above is the test;
    // this is the belt-and-braces field refusal.)
    const named =
      '{"conventions":"x","examples":["y"],"game":"dynamics","name":"the moon"}';
    expect(parseCardLine(named)).toBeNull();
    expect(
      parseCardLine(
        '{"conventions":"x","examples":["y"],"game":"dynamics"," Name ":"the moon"}',
      ),
    ).toBeNull();
    const parsed = parseCards(named + NL);
    expect(parsed.cards).toHaveLength(0);
    expect(parsed.malformed).toEqual([named]);
  });

  test("a hand-added moves key is tolerated as an unknown, never read as a card", () => {
    const hand =
      '{"conventions":"x","examples":["y"],"game":"dynamics","moves":["a coined name"]}';
    const parsed = parseCardLine(hand);
    expect(parsed).not.toBeNull();
    expect(parsed?.extra.moves).toEqual(["a coined name"]);
    // The shape has no authored moves slot: the real moves line is derived.
    expect(CARD_KEYS as readonly string[]).not.toContain("moves");
  });
});

describe("the family posture: malformed preserved AND surfaced, CRLF/BOM tolerated", () => {
  test("malformed lines ride verbatim after the known lines and are surfaced", () => {
    const good = lineOf(card("concept"));
    const broken = "not json at all";
    const named =
      '{"conventions":"x","examples":["y"],"game":"dynamics","name":"the moon"}';
    const text = "\uFEFF" + good + "\r\n" + broken + "\r\n" + named + "\r\n";
    const parsed = parseCards(text);
    expect(parsed.cards).toHaveLength(1);
    expect(parsed.cards[0].game).toBe("concept");
    expect(parsed.malformed).toEqual([broken, named]);
    expect(serializeCards(parsed.cards, parsed.malformed)).toBe(
      good + NL + broken + NL + named + NL,
    );
  });

  test("a missing file means no cards (the read's empty shape)", () => {
    const empty = parseCards("");
    expect(empty).toEqual({ cards: [], malformed: [], duplicates: [] });
  });

  test("terminating newlines and blank lines are ignored", () => {
    const text = NL + lineOf(card()) + NL + NL;
    expect(parseCards(text).cards).toHaveLength(1);
    expect(parseCards(text).malformed).toHaveLength(0);
  });
});

describe("the derived moves line: two sources, ONE helper", () => {
  test("dynamics: the registry's registered move plus the ring's kinds", () => {
    expect(
      gameMovesOf("dynamics", MOVES, creationKinds("dynamics")),
    ).toEqual(["assumption/add", "word", "lack", "assumption"]);
  });

  test("concept and ground: no registered move, so the ring's kinds speak", () => {
    expect(gameMovesOf("concept", MOVES, creationKinds("concept"))).toEqual([
      "word",
      "lack",
    ]);
    expect(gameMovesOf("ground", MOVES, creationKinds("ground"))).toEqual([
      "word",
      "lack",
    ]);
  });

  test("the one helper reads BOTH sources and filters rows by game", () => {
    const rows: GameMoveRow[] = [
      { game: "concept", move: { family: "mark", verb: "add" } },
      { game: "dynamics", move: { family: "link", verb: "sign" } },
      { game: "dynamics", move: { family: "loop", verb: "name" } },
    ];
    expect(gameMovesOf("concept", rows, ["word"])).toEqual(["mark/add", "word"]);
    expect(gameMovesOf("dynamics", rows, [])).toEqual([
      "link/sign",
      "loop/name",
    ]);
    expect(gameMovesOf("ground", rows, ["word", "lack"])).toEqual([
      "word",
      "lack",
    ]);
  });

  test("the two sources are deduped, registry order then the ring's order", () => {
    expect(gameMovesOf("concept", [], ["word", "word", "lack"])).toEqual([
      "word",
      "lack",
    ]);
  });

  test("a card's moves line reads DERIVED, never the line's authored bytes", () => {
    const hand =
      '{"conventions":"x","examples":["y"],"game":"dynamics","moves":["a coined name"]}';
    const parsed = parseCardLine(hand);
    expect(parsed).not.toBeNull();
    const derived = gameMovesOf(
      (parsed as Card).game,
      MOVES,
      creationKinds((parsed as Card).game),
    );
    expect(derived).toEqual(["assumption/add", "word", "lack", "assumption"]);
    expect(derived).not.toContain("a coined name");
  });

  test("there is exactly ONE implementation, in the ghost/registry side", () => {
    const definitions = sourceFiles().filter((file) =>
      readFileSync(file, "utf8").includes("function gameMovesOf"),
    );
    expect(definitions).toEqual([join(SRC, "ghost/registry.ts")]);
    // The record module derives no moves of its own: it names no move and
    // calls no derivation (the doc may point at the helper; the code may not).
    const cards = source("src/map/cards.ts");
    expect(cards).not.toContain("assumption/add");
    expect(cards).not.toMatch(/creationKinds\s*\(/);
    expect(cards).not.toMatch(/gameMovesOf\s*\(/);
  });

  test("creationKinds arrives as DATA: the helper takes a plain list", () => {
    const registry = source("src/ghost/registry.ts");
    expect(registry).toContain("creationKindsData: readonly string[]");
    expect(registry).not.toContain("canvas/gates");
  });
});

describe("card-independence in code: the grammar never reads a card", () => {
  test("ghost/grammar.ts gains no card import and no card reading", () => {
    const grammar = source("src/ghost/grammar.ts");
    expect(grammar).not.toContain("map/cards");
    expect(grammar).not.toContain("parseCards");
    expect(grammar).not.toContain("cardOf");
    expect(grammar).not.toContain("CARD_KEYS");
    expect(grammar).not.toContain("gameMovesOf");
    expect(grammar).not.toContain("cards.jsonl");
  });

  test("no ghost module imports the card record (the grammar's graph is clear)", () => {
    for (const file of ghostSources()) {
      const text = readFileSync(file, "utf8");
      expect(text).not.toMatch(/"\.\.\/map\/cards/);
      expect(text).not.toMatch(/"\.\.\/\.\.\/map\/cards/);
    }
  });

  test("the ghost layer NEVER imports the canvas (creation kinds arrive as data)", () => {
    const offenders: string[] = [];
    for (const file of ghostSources()) {
      const text = readFileSync(file, "utf8");
      if (
        /from\s+["']\.\.\/canvas\//.test(text) ||
        /import\(\s*["']\.\.\/canvas\//.test(text)
      ) {
        offenders.push(file.slice(SRC.length + 1));
      }
    }
    expect(offenders).toEqual([]);
  });
});
