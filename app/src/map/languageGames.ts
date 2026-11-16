import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";

/**
 * Language games (PROVISIONAL, added 2026-11-16 per the lead's brief): one
 * `map/language-games.jsonl` line per NAMED, COLOURED REGION of the concept
 * map — a shape drawn by the selection tool, remembered as a language game.
 *
 * THE LINE is exactly one of
 *
 *   {"color":"#cfe0d6","name":"rain","shape":{"kind":"polygon","points":[[0,0],[90,12],[40,70]]}}
 *   {"color":"#e2d4e6","name":"soil","shape":{"cx":40,"cy":30,"kind":"circle","r":26}}
 *   {"color":"#e6ddc8","name":"mulch","shape":{"h":48,"kind":"rect","w":120,"x":10,"y":20}}
 *
 *   - `name` is the person's coin, and it is the NATURAL KEY: there are no
 *     ids, no slugs and no timestamps. Only the person names a game; a
 *     duplicate name is refused at submit, and the writer refuses to append
 *     one (the record's own guard). A hand-edited duplicate line is preserved
 *     as it stands (the family never drops a line it did not write), and a
 *     delete by name removes every line bearing that name — the name IS the
 *     game.
 *   - `color` is the pastel the tool picked when the shape was drawn, stored
 *     VERBATIM as a string. The render falls back to the rule module's quiet
 *     default when a hand edit names something CSS cannot paint — the record
 *     is never rewritten into a "valid" colour.
 *   - `shape` is the drawn REGION in WORLD coordinates, with a `kind`
 *     discriminator: a polygon whose points are the sampled drag path (the
 *     release closes it with an implicit straight segment back to the first
 *     point — the ring does not repeat its first point), or a circle (centre
 *     and radius), or a rectangle (top-left corner and size). The shape is
 *     STORED, never its membership: a game's words and wires are derived
 *     geometrically at read time (`canvas/languageGameRules.ts`), so moving a
 *     word in or out of a region changes what the game holds without a write.
 *
 * The family posture holds (ADR-0004's canonical bytes, ADR-0006's
 * preservation): unknown keys on a line survive every rewrite, and so do
 * unknown keys INSIDE `shape` (the shape's `extra`); malformed or out-of-shape
 * lines are preserved verbatim AND surfaced by the read (the notices strip
 * names them — never silently hidden); a BOM and CRLF from a hand edit are
 * tolerated; a missing file means no games. Canonical serialization is
 * serialize.ts's job; this module only turns the file's bytes into records and
 * back.
 *
 * Language games are COMMITTED-MODEL records: they live in `map/` and are
 * never copied into a `scenarios/<slug>/` branch (the veils' and the ink's
 * rule, ADR-0021's seam). Nothing references a language game, so no map batch
 * touches this file — a word's rename or removal simply changes what the shape
 * derives.
 *
 * Provisional (the lead's brief): the `language-games.jsonl` name, this
 * line's shape (the nested `kind`-discriminated `shape` object, the `[x, y]`
 * pair form), the world-space geometry, and the name as the only key.
 */

/** One point of a shape, in world space. */
export interface GamePoint {
  x: number;
  y: number;
}

/** Unknown keys a hand edit left inside `shape`, preserved across rewrites. */
interface ShapeExtras {
  extra?: Record<string, unknown>;
}

/**
 * The drawn region, in world coordinates. The `kind` is the shape's type (the
 * record's only discriminator); a polygon's ring is closed implicitly by the
 * renderer and by every hit test, so its points never repeat the first one.
 */
export type GameShape =
  | ({ kind: "polygon"; points: readonly GamePoint[] } & ShapeExtras)
  | ({ kind: "circle"; cx: number; cy: number; r: number } & ShapeExtras)
  | ({ kind: "rect"; x: number; y: number; w: number; h: number } & ShapeExtras);

/** One language game as the file holds it. */
export interface LanguageGame {
  /** The person's coined name — the game's identity (never an agent's). */
  name: string;
  /** The pastel the tool picked, stored verbatim (the render falls back). */
  color: string;
  /** The drawn region, in world space. */
  shape: GameShape;
  /** Unknown JSON keys preserved across rewrites (the family's posture). */
  extra: Record<string, unknown>;
}

/** One game fresh from the tool, before it meets the file. */
export interface NewLanguageGame {
  name: string;
  color: string;
  shape: GameShape;
}

export interface ParsedLanguageGames {
  games: LanguageGame[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

export function languageGamesPath(workspacePath: string): string {
  return `${workspacePath}/map/language-games.jsonl`;
}

/** A finite JS number (JSON cannot carry NaN/Infinity; a hand edit can). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** One `[x, y]` pair, or null. */
function parsePair(value: unknown): GamePoint | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return { x, y };
}

/**
 * Parse the `shape` object; null when it is not one of the three shapes. A
 * polygon needs at least THREE points (fewer enclose no area — the lasso's
 * rule); a circle needs a positive radius; a rectangle a positive size. A
 * degenerate shape is out of shape, never repaired into something it does not
 * say. Unknown keys inside the object ride along as `extra`.
 */
export function parseGameShape(value: unknown): GameShape | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const { kind, ...rest } = obj;
  if (kind === "polygon") {
    const { points, ...extra } = rest;
    if (!Array.isArray(points) || points.length < 3) return null;
    const parsed: GamePoint[] = [];
    for (const pair of points) {
      const point = parsePair(pair);
      if (point === null) return null;
      parsed.push(point);
    }
    return { kind: "polygon", points: parsed, extra };
  }
  if (kind === "circle") {
    const { cx, cy, r, ...extra } = rest;
    if (!isFiniteNumber(cx) || !isFiniteNumber(cy)) return null;
    if (!isFiniteNumber(r) || !(r > 0)) return null;
    return { kind: "circle", cx, cy, r, extra };
  }
  if (kind === "rect") {
    const { x, y, w, h, ...extra } = rest;
    if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
    if (!isFiniteNumber(w) || !(w > 0)) return null;
    if (!isFiniteNumber(h) || !(h > 0)) return null;
    return { kind: "rect", x, y, w, h, extra };
  }
  return null;
}

/**
 * Parse one JSONL line into a LanguageGame; malformed or out-of-shape lines
 * become `null`. A game needs a non-empty name, a non-empty colour string
 * (stored verbatim, never judged here) and a valid shape.
 */
export function parseLanguageGameLine(line: string): LanguageGame | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const { name, color, shape, ...extra } = obj;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (typeof color !== "string" || color.trim() === "") return null;
  const parsed = parseGameShape(shape);
  if (parsed === null) return null;
  return { name, color, shape: parsed, extra };
}

/** The shape as the file's JSON (unknown shape keys first, canonical last). */
export function shapeToJson(shape: GameShape): Record<string, unknown> {
  const extra = shape.extra ?? {};
  if (shape.kind === "polygon") {
    return {
      ...extra,
      kind: "polygon",
      points: shape.points.map((point) => [point.x, point.y]),
    };
  }
  if (shape.kind === "circle") {
    return { ...extra, kind: "circle", cx: shape.cx, cy: shape.cy, r: shape.r };
  }
  return {
    ...extra,
    kind: "rect",
    x: shape.x,
    y: shape.y,
    w: shape.w,
    h: shape.h,
  };
}

/** Serialize one LanguageGame to its canonical JSONL line (sorted keys). */
export function serializeLanguageGameLine(game: LanguageGame): string {
  return canonicalJsonlLine({
    ...game.extra,
    name: game.name,
    color: game.color,
    shape: shapeToJson(game.shape),
  });
}

/**
 * Read `map/language-games.jsonl`. Terminating newlines are ignored;
 * malformed or out-of-shape lines are preserved as unknowns (the family
 * posture) so the app never silently drops what it cannot read. Tolerates a
 * BOM and CRLF. Hand duplicates are NOT deduped here: the record never drops a
 * line it did not write (the name's uniqueness is enforced at submit and at
 * append).
 */
export function parseLanguageGames(text: string): ParsedLanguageGames {
  const games: LanguageGame[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseLanguageGameLine(line);
    if (parsed) {
      games.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return { games, malformed };
}

/** Read the file from a workspace; a missing file means no games. */
export async function loadLanguageGames(
  workspacePath: string,
): Promise<ParsedLanguageGames> {
  const text = await readTextFile(languageGamesPath(workspacePath));
  return text === null ? { games: [], malformed: [] } : parseLanguageGames(text);
}

/**
 * The file's exact bytes. Known games serialize canonically (sorted keys) in
 * FILE ORDER — the order the games were made, which is also the render order
 * (later games paint over earlier ones) and the list's order — and malformed
 * lines are re-emitted verbatim after them. An empty document is the canonical
 * empty JSONL (one newline).
 */
export function serializeLanguageGames(
  games: readonly LanguageGame[],
  malformed: readonly string[] = [],
): string {
  const known = games.map(serializeLanguageGameLine);
  return canonicalJsonlLines([...known, ...malformed]);
}

export async function saveLanguageGames(
  workspacePath: string,
  games: readonly LanguageGame[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(
    languageGamesPath(workspacePath),
    serializeLanguageGames(games, malformed),
  );
}

/** The game whose name matches exactly, if any (the natural key's reading). */
export function findLanguageGame(
  games: readonly LanguageGame[],
  name: string,
): LanguageGame | null {
  return games.find((game) => game.name === name) ?? null;
}

/** Is this name already a language game's? (the submit rule's reading) */
export function languageGameNameTaken(
  games: readonly LanguageGame[],
  name: string,
): boolean {
  return games.some((game) => game.name === name);
}

/**
 * Append one game, last (file order is the render and list order). The name is
 * trimmed (the coin's spelling); a blank name, or one already taken, writes
 * nothing — the person's duplicate is refused, never silently renamed (the
 * veils mint a suffix because a veil has a slug; a language game's identity IS
 * the name the person said). `null` when nothing was added.
 */
export function addLanguageGame(
  games: readonly LanguageGame[],
  game: NewLanguageGame,
): LanguageGame[] | null {
  const trimmed = game.name.trim();
  if (trimmed === "") return null;
  if (languageGameNameTaken(games, trimmed)) return null;
  return [
    ...games,
    {
      name: trimmed,
      color: game.color,
      shape: game.shape,
      extra: {},
    },
  ];
}

/**
 * Delete a game by its name: every line bearing that name goes, and only those
 * lines (a hand duplicate is the same game). No tombstone and no dependent
 * record — nothing references a game.
 */
export function removeLanguageGame(
  games: readonly LanguageGame[],
  name: string,
): LanguageGame[] {
  return games.filter((game) => game.name !== name);
}
