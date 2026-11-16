import { readTextFile, writeTextFile } from "../lib/fs";
import {
  canonicalJsonlLine,
  canonicalJsonlLines,
  nextSlug,
  slugName,
} from "../lib/serialize";

/**
 * Veils (ADR-0023, Epic 9 story 1): one `map/veils.jsonl` line per veil — a
 * NAMED COVER over a rectangle of the plane. The line is exactly
 * `{"name":"<coined>","x":…,"y":…,"w":…,"h":…,"reason":"<text>"}`:
 *
 *   - `name` is the person's coin (never an agent's — an agent may only
 *     propose one as a ghost). Its name-derived slug is the natural key
 *     (`slugName`, unique among veils; veils and references/loops are separate
 *     namespaces). Because the line carries no separate slug field, uniqueness
 *     is kept at coining time: a coin whose slug is already taken gains a
 *     numeric suffix in the name itself (`"rain veil"` -> `"rain veil 2"`,
 *     whose slug is `rain-veil-2`), the same `nextSlug` rule a reference's
 *     file slug and a loop's key follow. A RENAME mints the same way and
 *     rewrites the line IN PLACE — one claim, not a new one.
 *   - `x`/`y` is the captured rectangle's TOP-LEFT and `w`/`h` its size:
 *     the BOX the draw gun caught, never the stroke that drew it. The numbers
 *     are the world-space geometry exactly as captured; a hand-edited box is
 *     never repaired, and a box that covers nothing (non-positive `w`/`h`)
 *     is preserved and covers nothing.
 *   - `reason` is PROSE (World B): stored as a JSON string verbatim, never
 *     trimmed, parsed, classified or searched. This module never interprets it.
 *
 * THE COVER IS A RENDER-TIME REGION TEST ONLY (ADR-0023 decision 2): a word is
 * covered iff the CENTRE of its word box is inside the veil's box — the same
 * "in a region" rule the playing-set selector's lasso uses — and that is all.
 * No record carries a veil field; covered is not settled (a covered word
 * stays tentative underneath); the sheet owns presses; sheets stack in FILE
 * ORDER (later on top); wires cross through. Levels 1–2 only (the render gate
 * lives in `canvas/veilRules.ts`; at ground the sheet is absent).
 *
 * RETIRE = DELETE THE LINE (ammo, one click, no ceremony, no tombstone). A
 * rename or a removal of a word never touches a veil: a veil has no slugs
 * pointing at it and references none, so the map's batches leave this file
 * alone — that is why `map/patches.ts` has no veil writer at all.
 *
 * Veils are COMMITTED-MODEL records: they live in `map/` and are never copied
 * into a `scenarios/<slug>/` branch (ADR-0021's seam; see `map/records.ts`).
 *
 * The family posture holds: unknown keys on a known veil survive a rewrite;
 * malformed lines are preserved verbatim AND surfaced by the read (the notices
 * strip names them — never silently hidden); CRLF and a BOM are tolerated; a
 * missing file means no veils. Canonical serialization is serialize.ts's job
 * (ADR-0004); this module only turns the file's bytes into records and back.
 *
 * Provisional (ADR-0023's own list): the `veils.jsonl` name, the box-vs-stroke
 * shape, the stacking/overlap rule and the wire-crossing rendering. Nothing
 * addresses a veil yet — the slug exists for dedupe and the person's handle.
 */

/** The captured rectangle, in world space: the box, never the stroke. */
export interface VeilBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One named veil as the file holds it. */
export interface Veil extends VeilBox {
  /** The user's coined name — the veil's identity (never an agent's). */
  name: string;
  /**
   * The person's prose reason, stored verbatim. World B: this module never
   * reads it — no trim, no parse, no classification, no search.
   */
  reason: string;
  /** Unknown JSON keys preserved across rewrites (ADR-0006's posture). */
  extra: Record<string, unknown>;
}

export interface ParsedVeils {
  veils: Veil[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

/** A placed word, as the centre rule needs it (a word box plus its slug). */
export interface PlacedWord {
  slug: string;
  pos: { x: number; y: number };
  box: { w: number; h: number };
}

export function veilsPath(workspacePath: string): string {
  return `${workspacePath}/map/veils.jsonl`;
}

/** The slug a coined name derives — the veil's natural key part (ADR-0005). */
export function veilSlug(name: string): string {
  return slugName(name);
}

/** The natural key that names one veil (its name's slug). */
export function veilKey(veil: Veil): string {
  return veilSlug(veil.name);
}

/** Every veil key currently taken (one per line). */
export function veilKeys(veils: readonly Veil[]): Set<string> {
  return new Set(veils.map(veilKey));
}

/**
 * Mint a coin that keeps its natural key unique among veils. The base coin is
 * returned untouched when its slug is free; on a collision the name gains the
 * same numeric suffix the slug does (`nextSlug`), so the record stays
 * self-describing: there is no hidden slug field to drift from the name.
 * Used at COIN and at RENAME — the same rule, one implementation.
 */
export function uniqueVeilName(
  name: string,
  taken: ReadonlySet<string>,
): string {
  const base = veilSlug(name);
  const slug = nextSlug(base, taken);
  if (slug === base) return name;
  return `${name} ${slug.slice(base.length + 1)}`;
}

/** The rectangle a veil covers, as a box (the capture's own shape). */
export function veilBox(veil: Veil): VeilBox {
  return { x: veil.x, y: veil.y, w: veil.w, h: veil.h };
}

/** A finite JS number (JSON cannot carry NaN/Infinity; a hand edit can). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Parse a JSONL line into a Veil; malformed or out-of-shape lines become
 * `null`. A veil needs a non-empty name, four finite box numbers and a
 * `reason` STRING (name and reason are coined TOGETHER at creation — the
 * pre-verbal case stays the bare mark, so a line with no reason, or with a
 * blank one, is out of shape: preserved and surfaced, never guessed at). The
 * presence test is whitespace-insensitive; the VALUE is stored exactly as it
 * stands — no trim, no normalization (World B). Any non-positive box is
 * accepted as written and covers nothing — never repaired.
 */
export function parseVeilLine(line: string): Veil | null {
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
  const { name, x, y, w, h, reason, ...extra } = obj;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  if (!isFiniteNumber(w) || !isFiniteNumber(h)) return null;
  if (typeof reason !== "string" || reason.trim() === "") return null;
  return { name, x, y, w, h, reason, extra };
}

/** Serialize one Veil to its canonical JSONL line (compact, sorted keys). */
export function serializeVeilLine(veil: Veil): string {
  return canonicalJsonlLine({
    ...veil.extra,
    name: veil.name,
    x: veil.x,
    y: veil.y,
    w: veil.w,
    h: veil.h,
    reason: veil.reason,
  });
}

/**
 * Read `map/veils.jsonl`. Terminating newlines are ignored; malformed or
 * out-of-shape lines are preserved as unknowns (the family posture) so the app
 * never silently drops what it cannot read. Tolerates a BOM and CRLF from a
 * hand edit.
 */
export function parseVeils(text: string): ParsedVeils {
  const veils: Veil[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseVeilLine(line);
    if (parsed) {
      veils.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return { veils, malformed };
}

/** Read the file from a workspace; a missing file means no veils. */
export async function loadVeils(workspacePath: string): Promise<ParsedVeils> {
  const text = await readTextFile(veilsPath(workspacePath));
  return text === null ? { veils: [], malformed: [] } : parseVeils(text);
}

/** Deduplicate by natural key, last write wins (the hand-duplicate rule). */
export function dedupeVeils(veils: readonly Veil[]): Veil[] {
  const byKey = new Map<string, Veil>();
  for (const veil of veils) {
    byKey.set(veilKey(veil), veil);
  }
  return [...byKey.values()];
}

/**
 * The veils file's exact bytes. Known lines serialize canonically (sorted
 * keys), one per natural key (last write wins, FILE ORDER kept — sheets stack
 * in that order); malformed lines are re-emitted verbatim. An empty document is
 * the canonical empty JSONL (one newline).
 */
export function serializeVeils(
  veils: readonly Veil[],
  malformed: readonly string[] = [],
): string {
  const known = dedupeVeils(veils).map(serializeVeilLine);
  return canonicalJsonlLines([...known, ...malformed]);
}

export async function saveVeils(
  workspacePath: string,
  veils: readonly Veil[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(veilsPath(workspacePath), serializeVeils(veils, malformed));
}

/** The veil whose key matches this name or slug, if any. */
export function findVeil(
  veils: readonly Veil[],
  nameOrSlug: string,
): Veil | null {
  const key = veilSlug(nameOrSlug);
  return veils.find((veil) => veilKey(veil) === key) ?? null;
}

/**
 * Coin a veil: the captured box plus the person's name and reason, written
 * last (file order is the stacking order). Name and reason are coined TOGETHER:
 * a blank name or a blank reason writes nothing — the pre-verbal case stays the
 * bare mark, so a veil is only made once the person has said both. The name is
 * trimmed (the coin's spelling); the REASON is stored exactly as it arrived,
 * untrimmed and unread (World B).
 */
export function nameVeil(
  veils: readonly Veil[],
  name: string,
  box: VeilBox,
  reason: string,
): Veil[] {
  const trimmed = name.trim();
  if (trimmed === "" || reason.trim() === "") return [...veils];
  const minted = uniqueVeilName(trimmed, veilKeys(veils));
  return [
    ...veils,
    {
      name: minted,
      x: box.x,
      y: box.y,
      w: box.w,
      h: box.h,
      reason,
      extra: {},
    },
  ];
}

/**
 * Rename a veil: the line changes IN PLACE at its index — name and key in one
 * rewrite, the box, the reason and unknown keys preserved (the record is one
 * claim, not a new one). A taken key mints the collision suffix; an empty name,
 * the same name or an unknown veil is a quiet no-op.
 */
export function renameVeil(
  veils: readonly Veil[],
  veil: Veil,
  newName: string,
): Veil[] {
  const key = veilKey(veil);
  const index = veils.findIndex((candidate) => veilKey(candidate) === key);
  if (index === -1) return [...veils];
  const trimmed = newName.trim();
  if (trimmed === "" || trimmed === veils[index].name) return [...veils];
  const taken = new Set(veils.filter((_, i) => i !== index).map(veilKey));
  const minted = uniqueVeilName(trimmed, taken);
  const next = [...veils];
  next[index] = { ...veils[index], name: minted };
  return next;
}

/**
 * Retire a veil (ammo): the line goes, and only that line. There is no
 * tombstone, no history and no scenario copy to sweep — nothing references a
 * veil, so no dependent record dies with it.
 */
export function removeVeil(
  veils: readonly Veil[],
  veil: Veil | string,
): Veil[] {
  const key = typeof veil === "string" ? veilSlug(veil) : veilKey(veil);
  return veils.filter((candidate) => veilKey(candidate) !== key);
}

/**
 * Is this world point inside the veil's box? The selector's rule (ADR-0013):
 * a point exactly ON the border counts as inside, so a box drawn along a word's
 * centre line still covers it. A non-positive extent covers nothing — the
 * honest reading of a degenerate hand edit, never repaired into something it
 * does not say.
 */
export function veilCoversPoint(veil: Veil, point: { x: number; y: number }): boolean {
  if (!(veil.w > 0) || !(veil.h > 0)) return false;
  return (
    point.x >= veil.x &&
    point.x <= veil.x + veil.w &&
    point.y >= veil.y &&
    point.y <= veil.y + veil.h
  );
}

/** The centre of a word's box — the point the cover's region test uses. */
export function centreOfWord(word: PlacedWord): { x: number; y: number } {
  return {
    x: word.pos.x + word.box.w / 2,
    y: word.pos.y + word.box.h / 2,
  };
}

/** The veils covering one word, in FILE ORDER (later ones on top). */
export function veilsCoveringWord(
  veils: readonly Veil[],
  word: PlacedWord,
): Veil[] {
  const centre = centreOfWord(word);
  return veils.filter((veil) => veilCoversPoint(veil, centre));
}

/**
 * The slugs of the covered words: a word is covered iff its CENTRE is inside a
 * veil (the one region rule). Wires are never words and never enter this test;
 * every other record keeps its own reading (covered is not settled).
 */
export function coveredWordSlugs(
  veils: readonly Veil[],
  words: readonly PlacedWord[],
): Set<string> {
  const covered = new Set<string>();
  for (const word of words) {
    if (veilsCoveringWord(veils, word).length > 0) covered.add(word.slug);
  }
  return covered;
}

/**
 * The TOP veil over a word: sheets stack in file order, so the last covering
 * line is the one the person sees (provisional, ADR-0023). Null when nothing
 * covers the word.
 */
export function topVeilOf(
  veils: readonly Veil[],
  word: PlacedWord,
): Veil | null {
  const covering = veilsCoveringWord(veils, word);
  return covering.length === 0 ? null : covering[covering.length - 1];
}
