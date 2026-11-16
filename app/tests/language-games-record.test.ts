import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  addLanguageGame,
  findLanguageGame,
  languageGameNameTaken,
  languageGamesPath,
  loadLanguageGames,
  parseGameShape,
  parseLanguageGameLine,
  parseLanguageGames,
  removeLanguageGame,
  serializeLanguageGameLine,
  serializeLanguageGames,
  type GameShape,
  type LanguageGame,
} from "../src/map/languageGames";
import { NOTICE_FAMILY_GAME, noticeVisibleIn } from "../src/canvas/notices";

/**
 * THE LANGUAGE-GAME RECORD, automated (PROVISIONAL, added 2026-11-16 per the
 * lead's brief): `map/language-games.jsonl` — one canonical line per named,
 * coloured region of the concept map.
 *
 * The line is the family's: canonical bytes through `canonicalJsonlLine`
 * (compact, sorted keys, recursive), no ids and no timestamps (the NAME is the
 * natural key), the drawn SHAPE in world coordinates with a `kind`
 * discriminator, and the pastel stored verbatim. The family posture holds:
 * unknown keys — on the line AND inside `shape` — survive every rewrite;
 * malformed lines are preserved verbatim AND surfaced through the notices
 * strip; a missing file means no games. Delete by name is the record's one
 * exit.
 */

const NL = "\n";

const polygon: GameShape = {
  kind: "polygon",
  points: [
    { x: 0, y: 0 },
    { x: 90, y: 12 },
    { x: 40, y: 70 },
  ],
};
const circle: GameShape = { kind: "circle", cx: 40, cy: 30, r: 26 };
const rect: GameShape = { kind: "rect", x: 10, y: 20, w: 120, h: 48 };

function game(
  name: string,
  shape: GameShape = rect,
  color = "#cfe0d6",
): LanguageGame {
  return { name, color, shape, extra: {} };
}

describe("the language game line's canonical bytes", () => {
  test("a polygon line: compact, sorted keys, points as [x, y] pairs", () => {
    expect(serializeLanguageGameLine(game("rain", polygon))).toBe(
      '{"color":"#cfe0d6","name":"rain","shape":{"kind":"polygon","points":[[0,0],[90,12],[40,70]]}}',
    );
  });

  test("a circle line: the centre and the radius, keys sorted recursively", () => {
    expect(serializeLanguageGameLine(game("soil", circle, "#e2d4e6"))).toBe(
      '{"color":"#e2d4e6","name":"soil","shape":{"cx":40,"cy":30,"kind":"circle","r":26}}',
    );
  });

  test("a rectangle line: the corner and the size", () => {
    expect(serializeLanguageGameLine(game("mulch", rect, "#e6ddc8"))).toBe(
      '{"color":"#e6ddc8","name":"mulch","shape":{"h":48,"kind":"rect","w":120,"x":10,"y":20}}',
    );
  });

  test("a document is one line per game, in FILE ORDER, trailing newline", () => {
    const text = serializeLanguageGames([
      game("rain", polygon),
      game("soil", circle, "#e2d4e6"),
    ]);
    expect(text).toBe(
      '{"color":"#cfe0d6","name":"rain","shape":{"kind":"polygon","points":[[0,0],[90,12],[40,70]]}}' +
        NL +
        '{"color":"#e2d4e6","name":"soil","shape":{"cx":40,"cy":30,"kind":"circle","r":26}}' +
        NL,
    );
    // The order the games were made is the order they render and list in.
    expect(text.split(NL)[0]).toContain('"rain"');
  });

  test("an empty document is the canonical empty JSONL (one newline)", () => {
    expect(serializeLanguageGames([])).toBe(NL);
  });

  test("every shape round-trips through parse and serialize byte-exactly", () => {
    for (const shape of [polygon, circle, rect]) {
      const line = serializeLanguageGameLine(game("rain", shape)).trim();
      const parsed = parseLanguageGameLine(line);
      expect(parsed).not.toBeNull();
      expect(serializeLanguageGameLine(parsed as LanguageGame)).toBe(line);
    }
  });

  test("the file path is map/language-games.jsonl under the workspace", () => {
    expect(languageGamesPath("/maps/garden")).toBe(
      "/maps/garden/map/language-games.jsonl",
    );
  });
});

describe("the name is the natural key", () => {
  test("find and the taken check read the name exactly", () => {
    const games = [game("rain"), game("soil")];
    expect(findLanguageGame(games, "rain")?.name).toBe("rain");
    expect(findLanguageGame(games, "Rain")).toBeNull();
    expect(languageGameNameTaken(games, "soil")).toBe(true);
    expect(languageGameNameTaken(games, "Soil")).toBe(false);
  });

  test("append writes one line, trims the coin, and refuses a duplicate", () => {
    const first = addLanguageGame([], {
      name: "  rain  ",
      color: "#cfe0d6",
      shape: polygon,
    });
    expect(first).not.toBeNull();
    expect(first?.[0].name).toBe("rain");
    // A blank name writes nothing.
    expect(
      addLanguageGame([], { name: "   ", color: "#cfe0d6", shape: polygon }),
    ).toBeNull();
    // A taken name writes nothing, and the existing game is never renamed.
    expect(
      addLanguageGame(first as LanguageGame[], {
        name: "rain",
        color: "#e2d4e6",
        shape: circle,
      }),
    ).toBeNull();
    // Appending does not mutate the list it was given.
    expect((first as LanguageGame[]).length).toBe(1);
    // Two games, two lines.
    const two = addLanguageGame(first as LanguageGame[], {
      name: "soil",
      color: "#e2d4e6",
      shape: circle,
    });
    expect(serializeLanguageGames(two as LanguageGame[]).split(NL)).toHaveLength(
      3,
    );
  });

  test("delete by name removes that game, and only it", () => {
    const games = [game("rain"), game("soil"), game("mulch")];
    const next = removeLanguageGame(games, "soil");
    expect(next.map((entry) => entry.name)).toEqual(["rain", "mulch"]);
    // File order is kept; nothing else is rewritten.
    expect(serializeLanguageGames(next).split(NL)).toHaveLength(3);
    // An unknown name is a quiet no-op.
    expect(removeLanguageGame(games, "gone")).toEqual(games);
  });

  test("a hand-duplicated name is one game for deletion (every line goes)", () => {
    const games = [game("rain"), game("soil"), game("rain")];
    expect(removeLanguageGame(games, "rain").map((entry) => entry.name)).toEqual(
      ["soil"],
    );
  });
});

describe("the family posture: unknown keys, malformed lines, CRLF/BOM", () => {
  test("unknown keys on a known game survive a rewrite", () => {
    const line =
      '{"name":"rain","color":"#cfe0d6","shape":{"kind":"rect","x":0,"y":0,"w":10,"h":10},"why":7}';
    const parsed = parseLanguageGameLine(line);
    expect(parsed?.extra).toEqual({ why: 7 });
    const rewritten = serializeLanguageGameLine(parsed as LanguageGame);
    expect(rewritten).toContain('"why":7');
    expect(parseLanguageGameLine(rewritten)?.extra).toEqual({ why: 7 });
  });

  test("unknown keys INSIDE the shape survive a rewrite too", () => {
    const line =
      '{"name":"rain","color":"#cfe0d6","shape":{"kind":"rect","x":0,"y":0,"w":10,"h":10,"note":"hand"}}';
    const parsed = parseLanguageGameLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed?.shape.extra).toEqual({ note: "hand" });
    const rewritten = serializeLanguageGameLine(parsed as LanguageGame);
    expect(rewritten).toContain('"note":"hand"');
    expect(parseLanguageGameLine(rewritten)?.shape.extra).toEqual({
      note: "hand",
    });
  });

  test("out-of-shape lines are malformed: kept AND surfaced, never guessed at", () => {
    const good = serializeLanguageGameLine(game("good")).trim();
    const bad = [
      "not json at all",
      '["an","array"]',
      '{"color":"#cfe0d6","shape":{"kind":"rect","x":0,"y":0,"w":10,"h":10}}',
      '{"name":"","color":"#cfe0d6","shape":{"kind":"rect","x":0,"y":0,"w":10,"h":10}}',
      '{"name":"   ","color":"#cfe0d6","shape":{"kind":"rect","x":0,"y":0,"w":10,"h":10}}',
      '{"name":"no colour","shape":{"kind":"rect","x":0,"y":0,"w":10,"h":10}}',
      '{"name":"bad colour","color":7,"shape":{"kind":"rect","x":0,"y":0,"w":10,"h":10}}',
      '{"name":"no shape","color":"#cfe0d6"}',
      '{"name":"array shape","color":"#cfe0d6","shape":[]}',
      '{"name":"unknown kind","color":"#cfe0d6","shape":{"kind":"star"}}',
      '{"name":"two points","color":"#cfe0d6","shape":{"kind":"polygon","points":[[0,0],[1,1]]}}',
      '{"name":"bad pair","color":"#cfe0d6","shape":{"kind":"polygon","points":[[0,0],[1,1],[2]]}}',
      '{"name":"infinite","color":"#cfe0d6","shape":{"kind":"polygon","points":[[0,0],[1,1],[1e999,0]]}}',
      '{"name":"zero radius","color":"#cfe0d6","shape":{"kind":"circle","cx":0,"cy":0,"r":0}}',
      '{"name":"negative radius","color":"#cfe0d6","shape":{"kind":"circle","cx":0,"cy":0,"r":-2}}',
      '{"name":"no centre","color":"#cfe0d6","shape":{"kind":"circle","cy":0,"r":2}}',
      '{"name":"zero width","color":"#cfe0d6","shape":{"kind":"rect","x":0,"y":0,"w":0,"h":10}}',
      '{"name":"string size","color":"#cfe0d6","shape":{"kind":"rect","x":0,"y":0,"w":"10","h":10}}',
    ];
    const parsed = parseLanguageGames([good, ...bad, good].join(NL));
    expect(parsed.games).toHaveLength(2);
    expect(parsed.games.map((entry) => entry.name)).toEqual(["good", "good"]);
    expect(parsed.malformed).toEqual(bad);
    // Preserved verbatim through the writer: the app never drops a byte it
    // could not read.
    const rewritten = serializeLanguageGames(parsed.games, parsed.malformed);
    for (const line of bad) expect(rewritten).toContain(line);
  });

  test("the malformed lines are SURFACED (the notices family), not invisible", () => {
    expect(NOTICE_FAMILY_GAME.games).toBe("all");
    for (const level of ["concept", "dynamics", "ground"] as const) {
      expect(noticeVisibleIn("games", level)).toBe(true);
    }
    const app = readFileSync(
      new URL("../src/App.tsx", import.meta.url),
      "utf8",
    );
    expect(app).toContain("malformedGames");
    expect(app).toContain("unreadable line in map/language-games.jsonl");
  });

  test("a BOM and CRLF from a hand edit are tolerated", () => {
    const a = serializeLanguageGameLine(game("rain", polygon)).trim();
    const b = serializeLanguageGameLine(game("soil", circle)).trim();
    const parsed = parseLanguageGames("\uFEFF" + a + "\r\n" + b + "\r\n");
    expect(parsed.malformed).toEqual([]);
    expect(parsed.games.map((entry) => entry.name)).toEqual(["rain", "soil"]);
  });

  test("terminating and blank lines are ignored; an empty file means none", () => {
    expect(parseLanguageGames("")).toEqual({ games: [], malformed: [] });
    expect(parseLanguageGames(NL + NL)).toEqual({ games: [], malformed: [] });
    expect(parseLanguageGames("\r\n")).toEqual({ games: [], malformed: [] });
    // A MISSING file is a missing read, never an error: load answers none.
    const source = readFileSync(
      new URL("../src/map/languageGames.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      "text === null ? { games: [], malformed: [] } : parseLanguageGames(text)",
    );
    // The reader is the only door, and it is never called for a fallback.
    expect(typeof loadLanguageGames).toBe("function");
  });

  test("language games are committed-model records (map/, never a branch)", () => {
    const source = readFileSync(
      new URL("../src/map/languageGames.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("map/language-games.jsonl");
    // A branch copies the model's three variant records; a language game is
    // spatial, so it is never read through the records folder (the module
    // joins the workspace's `map/` itself).
    expect(source).not.toContain("recordsDir");
  });
});

describe("the shape parser's own edge", () => {
  test("a shape needs one of the three kinds", () => {
    expect(parseGameShape(null)).toBeNull();
    expect(parseGameShape([1, 2])).toBeNull();
    expect(parseGameShape({ kind: "triangle" })).toBeNull();
    expect(parseGameShape({ kind: "polygon", points: [[0, 0]] })).toBeNull();
    expect(parseGameShape({ kind: "circle", cx: 0, cy: 0, r: 1 })).toEqual({
      kind: "circle",
      cx: 0,
      cy: 0,
      r: 1,
      extra: {},
    });
    expect(parseGameShape({ kind: "rect", x: 1, y: 2, w: 3, h: 4 })).toEqual({
      kind: "rect",
      x: 1,
      y: 2,
      w: 3,
      h: 4,
      extra: {},
    });
  });
});
