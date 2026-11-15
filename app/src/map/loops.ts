import { readTextFile, writeTextFile } from "../lib/fs";
import {
  canonicalJsonlLine,
  canonicalJsonlLines,
  nextSlug,
  slugName,
} from "../lib/serialize";

/**
 * Feedback loops (ADR-0012 decision 3, ADR-0015 decision 5): one
 * `map/loops.jsonl` line per NAMED loop — the user's coined name plus the
 * CLOSED cycle of reference slugs it walks, the first slug repeated at the end
 * so every member pair reads explicitly.
 *
 * The name is the coin; its name-derived slug is the natural key (`slugName`,
 * unique among loops; loops and references are separate namespaces). Because
 * the line carries no separate slug field, uniqueness is kept at coining time:
 * a coin whose slug is already taken gains a numeric suffix in the name itself
 * (`"rain loop"` -> `"rain loop 2"`, whose slug is `rain-loop-2`), the same
 * `nextSlug` rule a reference's file slug follows (ADR-0005 rule 4). Nothing
 * is silently merged and no two lines share a key.
 *
 * The path is ROTATION-CANONICALIZED on write: rotated so the smallest slug is
 * first, DIRECTION PRESERVED, closure kept — so bytes are stable and an agent
 * can compare lines directly. A reversed cycle is a different line. An
 * UNCLOSED hand-edited path is never repaired or rotated (rotating it would
 * change its walks), only surfaced by the read.
 *
 * The record NEVER validates against `links.jsonl` or `model.json`: a missing
 * member link, a dangling slug or an out-of-play word is the read's business
 * (`loopRead.ts`), never a silent repair — ADR-0013 decision 4 lets a loop
 * reference non-members and surfaces that at read time.
 *
 * Unknown keys on a known loop survive a rewrite; malformed lines are
 * preserved verbatim and surfaced by the loader; a missing file means no
 * loops. Canonical serialization is serialize.ts's job (ADR-0004); this module
 * only turns the file's bytes into records and back.
 *
 * Provisional: the `loops.jsonl` name, the record shape and the collision
 * suffix's spelling are ADR-0012/0015's, not settled beyond them. The walk
 * lives in `loopRead.ts`; the canvas route and the coin gestures are the
 * rendering seam (ADR-0003/0016).
 */

export interface Loop {
  /** The user's coined name — the loop's identity (never an agent's). */
  name: string;
  /**
   * The closed cycle of reference slugs, in walk order: first slug repeated at
   * the end. Rotation-canonical on write; see `canonicalPath`.
   */
  path: string[];
  /** Unknown JSON keys preserved across rewrites (ADR-0006's posture). */
  extra: Record<string, unknown>;
}

export interface ParsedLoops {
  loops: Loop[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

export function loopsPath(workspacePath: string): string {
  return `${workspacePath}/map/loops.jsonl`;
}

/** The slug a coined name derives — the loop's natural key part (ADR-0005). */
export function loopSlug(name: string): string {
  return slugName(name);
}

/** The natural key that names one loop (its name's slug). */
export function loopKey(loop: Loop): string {
  return loopSlug(loop.name);
}

/** Every loop key currently taken (one per line). */
export function loopKeys(loops: readonly Loop[]): Set<string> {
  return new Set(loops.map(loopKey));
}

/**
 * Mint a coin that keeps its natural key unique among loops. The base coin is
 * returned untouched when its slug is free; on a collision the name gains the
 * same numeric suffix the slug does (`nextSlug`), so the record stays
 * self-describing: there is no hidden slug field to drift from the name.
 */
export function uniqueLoopName(
  name: string,
  taken: ReadonlySet<string>,
): string {
  const base = loopSlug(name);
  const slug = nextSlug(base, taken);
  if (slug === base) return name;
  return `${name} ${slug.slice(base.length + 1)}`;
}

/** A closed path: at least a self-loop, first slug repeated at the end. */
export function isClosedPath(path: readonly string[]): boolean {
  return path.length >= 2 && path[0] === path[path.length - 1];
}

/** Lexicographic order of two slug sequences (shorter first on a tie). */
function comparePaths(a: readonly string[], b: readonly string[]): number {
  const length = Math.min(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    if (a[i] === b[i]) continue;
    return a[i] < b[i] ? -1 : 1;
  }
  return a.length - b.length;
}

/**
 * The path's canonical rotation: the closed cycle rotated so the smallest slug
 * is first, direction preserved, closure kept. When the smallest slug occurs
 * more than once the lexicographically smallest rotation wins, so the result is
 * deterministic and idempotent. An unclosed path (a hand edit) is returned
 * exactly as it came — never repaired, never re-ordered, because rotating it
 * would silently change which pair-walks it names.
 */
export function canonicalPath(path: readonly string[]): string[] {
  if (!isClosedPath(path)) return [...path];
  const body = path.slice(0, -1);
  let best = body;
  for (let i = 1; i < body.length; i += 1) {
    const rotated = [...body.slice(i), ...body.slice(0, i)];
    if (comparePaths(rotated, best) < 0) best = rotated;
  }
  return [...best, best[0]];
}

/**
 * Parse a JSONL line into a Loop; malformed or out-of-shape lines become
 * `null`. A loop needs a non-empty name and a path of non-empty slug strings.
 * An empty or unclosed path parses (the read names "no steps" /
 * "path is not closed"); it is content, not garbage.
 */
export function parseLoopLine(line: string): Loop | null {
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
  const { name, path, ...extra } = obj;
  if (typeof name !== "string" || name.trim() === "") return null;
  if (!Array.isArray(path)) return null;
  if (!path.every((slug) => typeof slug === "string" && slug !== "")) {
    return null;
  }
  return { name, path: path as string[], extra };
}

/** Serialize one Loop to its canonical JSONL line (compact, sorted keys). */
export function serializeLoopLine(loop: Loop): string {
  return canonicalJsonlLine({
    ...loop.extra,
    name: loop.name,
    path: canonicalPath(loop.path),
  });
}

/**
 * Read `map/loops.jsonl`. Terminating newlines are ignored; malformed or
 * out-of-shape lines are preserved as unknowns (ADR-0005's posture) so the app
 * never silently drops what it cannot read. Tolerates a BOM and CRLF from a
 * hand edit.
 */
export function parseLoops(text: string): ParsedLoops {
  const loops: Loop[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseLoopLine(line);
    if (parsed) {
      loops.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return { loops, malformed };
}

export async function loadLoops(workspacePath: string): Promise<ParsedLoops> {
  const text = await readTextFile(loopsPath(workspacePath));
  return text === null ? { loops: [], malformed: [] } : parseLoops(text);
}

/** Deduplicate by natural key, last write wins (the hand-duplicate rule). */
export function dedupeLoops(loops: readonly Loop[]): Loop[] {
  const byKey = new Map<string, Loop>();
  for (const loop of loops) {
    byKey.set(loopKey(loop), loop);
  }
  return [...byKey.values()];
}

/**
 * The loops file's exact bytes. Known lines serialize canonically (sorted
 * keys, rotation-canonical path), one per natural key (last write wins);
 * malformed lines are re-emitted verbatim. An empty document is the canonical
 * empty JSONL (one newline).
 */
export function serializeLoops(
  loops: readonly Loop[],
  malformed: readonly string[] = [],
): string {
  const known = dedupeLoops(loops).map(serializeLoopLine);
  return canonicalJsonlLines([...known, ...malformed]);
}

export async function saveLoops(
  workspacePath: string,
  loops: readonly Loop[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(loopsPath(workspacePath), serializeLoops(loops, malformed));
}

/** The loop whose key matches this name or slug, if any. */
export function findLoop(
  loops: readonly Loop[],
  nameOrSlug: string,
): Loop | null {
  const key = loopSlug(nameOrSlug);
  return loops.find((loop) => loopKey(loop) === key) ?? null;
}

/**
 * Name a loop: coin it last, path rotation-canonical, key unique. An empty or
 * whitespace name writes nothing (a loop always has a coin). The path arrives
 * closed from the click gestures; if a caller hands an unclosed one it is kept
 * honestly and the read names the gap.
 */
export function nameLoop(
  loops: readonly Loop[],
  name: string,
  path: readonly string[],
): Loop[] {
  const trimmed = name.trim();
  if (trimmed === "") return [...loops];
  const minted = uniqueLoopName(trimmed, loopKeys(loops));
  return [...loops, { name: minted, path: canonicalPath(path), extra: {} }];
}

/**
 * Rename a loop: the line changes IN PLACE at its index — name and key in one
 * rewrite, path bytes and unknown keys preserved (the record is one claim, not
 * a new one). A taken key mints the collision suffix; an empty name, the same
 * name or an unknown loop is a quiet no-op. Story 4 grows the assumption
 * loop-targets step here (one atomic batch, ADR-0012 decision 6).
 */
export function renameLoop(
  loops: readonly Loop[],
  loop: Loop,
  newName: string,
): Loop[] {
  const key = loopKey(loop);
  const index = loops.findIndex((candidate) => loopKey(candidate) === key);
  if (index === -1) return [...loops];
  const trimmed = newName.trim();
  if (trimmed === "" || trimmed === loops[index].name) return [...loops];
  const taken = new Set(loops.filter((_, i) => i !== index).map(loopKey));
  const minted = uniqueLoopName(trimmed, taken);
  const next = [...loops];
  next[index] = {
    ...loops[index],
    name: minted,
    path: canonicalPath(loops[index].path),
  };
  return next;
}

/** Remove a loop (ammo, one click, no ceremony): only that line goes. */
export function removeLoop(
  loops: readonly Loop[],
  loop: Loop | string,
): Loop[] {
  const key = typeof loop === "string" ? loopSlug(loop) : loopKey(loop);
  return loops.filter((candidate) => loopKey(candidate) !== key);
}

/**
 * Loops that name a word which is not on the map (a hand edit or a partial
 * write): preserved in the file and surfaced quietly, never dropped on an
 * unrelated write — the no-validation posture (ADR-0012 decision 3). The read
 * names the gap inside the walk too.
 */
export function unusedLoopSlugs(
  loops: readonly Loop[],
  wordSlugs: ReadonlySet<string>,
): string[] {
  const unknown = new Set<string>();
  for (const loop of loops) {
    for (const slug of loop.path) {
      if (!wordSlugs.has(slug)) unknown.add(slug);
    }
  }
  return [...unknown];
}
