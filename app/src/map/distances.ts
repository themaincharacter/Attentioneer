import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonl, canonicalJsonlLine } from "../lib/serialize";

/**
 * Distances (ADR-0006): one `map/distances.jsonl` line per typed distance —
 * the ordered pair as drawn plus its coined word. Fields `from`/`to` (endpoint
 * slugs) and `word` (the coined distance-word, non-empty). Identity is the
 * natural key (from, to, word): no id, and at most one line per key — drawing
 * the identical distance again rewrites that line (re-coin), never duplicates.
 *
 * Canonical serialization is serialize.ts's job; this module only turns the
 * file's bytes into records and back.
 */

export interface Distance {
  /** Endpoint slug of the origin reference. */
  from: string;
  /** Endpoint slug of the destination reference. */
  to: string;
  /** The user-coined distance-word — the distance's type and context. */
  word: string;
  /** Unknown JSON keys preserved across rewrites (story 4's guarantee). */
  extra: Record<string, unknown>;
}

/** The natural key that names one distance (ADR-0006). */
export function distanceKey(from: string, to: string, word: string): string {
  return `${from}\u0000${to}\u0000${word}`;
}

export function distancesPath(workspacePath: string): string {
  return `${workspacePath}/map/distances.jsonl`;
}

/** Parse a JSONL line into a Distance; malformed lines become `null`. */
export function parseDistanceLine(line: string): Distance | null {
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
  const { from, to, word, ...extra } = obj;
  if (typeof from !== "string" || typeof to !== "string" || typeof word !== "string") {
    return null;
  }
  if (word === "") {
    return null;
  }
  return { from, to, word, extra };
}

/** Serialize one Distance to its canonical JSONL line. */
export function serializeDistanceLine(d: Distance): string {
  return canonicalJsonlLine({ ...d.extra, from: d.from, to: d.to, word: d.word });
}

interface Parsed {
  distances: Distance[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

/**
 * Read `map/distances.jsonl`. Terminating newlines are ignored; malformed or
 * out-of-shape lines are preserved as unknowns (ADR-0005's posture) so the app
 * never silently drops what it cannot read.
 */
export function parseDistances(text: string): Parsed {
  const distances: Distance[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseDistanceLine(line);
    if (parsed) {
      distances.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return { distances, malformed };
}

export async function loadDistances(workspacePath: string): Promise<Parsed> {
  const text = await readTextFile(distancesPath(workspacePath));
  return text === null ? { distances: [], malformed: [] } : parseDistances(text);
}

/**
 * Write the distance file. Known lines serialize canonically (sorted keys),
 * deduplicated by their natural key; unknown/malformed lines are re-emitted
 * verbatim so nothing is lost (ADR-0006's self-describing, ADR-0005's visible
 * unknown).
 */
export async function saveDistances(
  workspacePath: string,
  distances: readonly Distance[],
  malformed: readonly string[] = [],
): Promise<void> {
  // One line per natural key, last write wins (the re-coin rule).
  const byKey = new Map<string, Distance>();
  for (const d of distances) {
    byKey.set(distanceKey(d.from, d.to, d.word), d);
  }
  const known = [...byKey.values()].map(serializeDistanceLine);
  const lines = [...known, ...malformed];
  await writeTextFile(distancesPath(workspacePath), canonicalJsonl(lines));
}