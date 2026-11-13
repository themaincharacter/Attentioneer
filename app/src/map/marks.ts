import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";
import { distanceKey } from "./distances";

/**
 * Marks (ADR-0009): one `map/marks.jsonl` line per mark — an anonymous
 * annotation over the map's citizens. A mark lands on a word, a wire, or a
 * bare spot of plane; it has no name, slug or id of its own, it is addressed
 * by what it is on, and it settles by being withdrawn (the line goes).
 *
 * Identity is the natural key (kind + target): at most one line per key, and
 * re-casting an identical mark rewrites its line rather than duplicating it
 * (ADR-0006's posture). Unknown keys on a known mark are preserved across
 * rewrites; malformed lines are preserved verbatim; a missing file means no
 * marks.
 *
 * Provisional: `kind` has one value, `"open"` — it names the mark's flavor,
 * never a lifecycle (absence is the only settled state, ADR-0009). The record
 * carries all three target forms: a bare spot is cast, named (grow) and bound
 * by the canvas's ring gestures (story 2), and `retargetMark` is their one
 * pure write.
 *
 * Canonical serialization is serialize.ts's job (ADR-0004); this module only
 * turns the file's bytes into records and back.
 */

/** What a mark sits on: a word slug, a wire's natural key, or a bare spot. */
export type MarkTarget =
  | { type: "word"; slug: string }
  | { type: "wire"; from: string; to: string; word: string }
  | { type: "spot"; x: number; y: number };

export interface Mark {
  /** The mark's flavor — provisional, single value `"open"` (ADR-0009). */
  kind: string;
  /** The target the mark is addressed by (a mark has no identity of its own). */
  target: MarkTarget;
  /** Unknown JSON keys preserved across rewrites (an Epic 9 seam). */
  extra: Record<string, unknown>;
}

interface ParsedMarks {
  marks: Mark[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

export function marksPath(workspacePath: string): string {
  return `${workspacePath}/map/marks.jsonl`;
}

/** The target's part of the natural key. */
export function markTargetKey(target: MarkTarget): string {
  switch (target.type) {
    case "word":
      return `word\u0000${target.slug}`;
    case "wire":
      // The wire is named exactly as its distance is (ADR-0006's natural key).
      return `wire\u0000${distanceKey(target.from, target.to, target.word)}`;
    case "spot":
      return `spot\u0000${target.x}\u0000${target.y}`;
  }
}

/** The mark's natural key: kind + target (ADR-0009). */
export function markKey(mark: Mark): string {
  return `${mark.kind}\u0000${markTargetKey(mark.target)}`;
}

/**
 * Parse one JSONL line into a Mark; malformed or out-of-shape lines become
 * `null`. A line must carry `kind` and exactly one target form — a line that
 * mixes forms or half-states a wire/spot is malformed, never guessed at.
 */
export function parseMarkLine(line: string): Mark | null {
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
  const { kind, ...rest } = obj;
  if (typeof kind !== "string" || kind === "") return null;

  if ("on" in rest) {
    if (typeof rest.on !== "string" || rest.on === "") return null;
    if ("from" in rest || "to" in rest || "word" in rest || "x" in rest || "y" in rest) {
      return null;
    }
    const { on, ...extra } = rest;
    return { kind, target: { type: "word", slug: on }, extra };
  }

  if ("from" in rest || "to" in rest || "word" in rest) {
    if (
      typeof rest.from !== "string" ||
      typeof rest.to !== "string" ||
      typeof rest.word !== "string" ||
      rest.word === ""
    ) {
      return null;
    }
    if ("x" in rest || "y" in rest) return null;
    const { from, to, word, ...extra } = rest;
    return { kind, target: { type: "wire", from, to, word }, extra };
  }

  if ("x" in rest || "y" in rest) {
    if (typeof rest.x !== "number" || typeof rest.y !== "number") return null;
    if (!Number.isFinite(rest.x) || !Number.isFinite(rest.y)) return null;
    const { x, y, ...extra } = rest;
    return { kind, target: { type: "spot", x, y }, extra };
  }

  return null;
}

/** Serialize one Mark to its canonical JSONL line (compact, sorted keys). */
export function serializeMarkLine(mark: Mark): string {
  return canonicalJsonlLine({
    ...mark.extra,
    ...targetFields(mark.target),
    kind: mark.kind,
  });
}

function targetFields(target: MarkTarget): Record<string, string | number> {
  switch (target.type) {
    case "word":
      return { on: target.slug };
    case "wire":
      return { from: target.from, to: target.to, word: target.word };
    case "spot":
      return { x: target.x, y: target.y };
  }
}

/**
 * Read `map/marks.jsonl`. Terminating newlines are ignored; malformed or
 * out-of-shape lines are preserved as unknowns (ADR-0005's posture) so the app
 * never silently drops what it cannot read. Tolerates BOM and CRLF on read.
 */
export function parseMarks(text: string): ParsedMarks {
  const marks: Mark[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseMarkLine(line);
    if (parsed) {
      marks.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return { marks, malformed };
}

export async function loadMarks(workspacePath: string): Promise<ParsedMarks> {
  const text = await readTextFile(marksPath(workspacePath));
  return text === null ? { marks: [], malformed: [] } : parseMarks(text);
}

/**
 * The marks file's exact bytes. Known lines serialize canonically (sorted
 * keys), one per natural key (last write wins); malformed lines are re-emitted
 * verbatim. Orphan and bare-spot lines ride along untouched by the app.
 */
export function serializeMarks(
  marks: readonly Mark[],
  malformed: readonly string[] = [],
): string {
  const byKey = new Map<string, Mark>();
  for (const mark of marks) {
    byKey.set(markKey(mark), mark);
  }
  const known = [...byKey.values()].map(serializeMarkLine);
  return canonicalJsonlLines([...known, ...malformed]);
}

export async function saveMarks(
  workspacePath: string,
  marks: readonly Mark[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(marksPath(workspacePath), serializeMarks(marks, malformed));
}

/** Deduplicate by natural key, last write wins (the re-cast / hand-duplicate rule). */
export function dedupeMarks(marks: readonly Mark[]): Mark[] {
  const byKey = new Map<string, Mark>();
  for (const mark of marks) {
    byKey.set(markKey(mark), mark);
  }
  return [...byKey.values()];
}

/** Is this exact (kind, target) already marked? */
export function hasMark(
  marks: readonly Mark[],
  kind: string,
  target: MarkTarget,
): boolean {
  const key = `${kind}\u0000${markTargetKey(target)}`;
  return marks.some((mark) => markKey(mark) === key);
}

/** Re-cast a mark: one line per natural key — the new line replaces the old. */
export function withMark(marks: readonly Mark[], mark: Mark): Mark[] {
  return [...withoutMark(marks, mark.kind, mark.target), mark];
}

/** Withdraw a mark: settle is deletion, no tombstone (ADR-0009). */
export function withoutMark(
  marks: readonly Mark[],
  kind: string,
  target: MarkTarget,
): Mark[] {
  const key = `${kind}\u0000${markTargetKey(target)}`;
  return marks.filter((mark) => markKey(mark) !== key);
}

/**
 * Retarget one mark (bind / unbind / grow): the line's address moves from
 * `source` to `target` in one write, the record itself carrying over — a mark
 * is one annotation, not a copy, so its unknown keys follow (ADR-0009). The
 * target's natural key wins: if another mark already sits there, the app's
 * move is the survivor, exactly as a re-coin pins its line. No source mark, or
 * a drop on the source itself, is a no-op and returns the same array, so the
 * caller can skip the write.
 */
export function retargetMark(
  marks: readonly Mark[],
  source: MarkTarget,
  target: MarkTarget,
  kind = "open",
): readonly Mark[] {
  if (markTargetKey(source) === markTargetKey(target)) return marks;
  const sourceKey = `${kind}\u0000${markTargetKey(source)}`;
  const existing = marks.find((mark) => markKey(mark) === sourceKey);
  if (!existing) return marks;
  return withMark(withoutMark(marks, kind, source), { ...existing, target });
}

/**
 * Marks whose target is not on the map: a word slug that no longer exists, or
 * a wire whose distance line is gone (hand edits, partial writes). They are
 * preserved in the file and surfaced by the app, never rendered or guessed
 * away (ADR-0009). A bare spot is its own target, so it is never an orphan.
 */
export function findOrphanMarks(
  marks: readonly Mark[],
  wordSlugs: ReadonlySet<string>,
  wireKeys: ReadonlySet<string>,
): Mark[] {
  return marks.filter((mark) => {
    if (mark.target.type === "word") return !wordSlugs.has(mark.target.slug);
    if (mark.target.type === "wire") {
      const { from, to, word } = mark.target;
      return !wireKeys.has(distanceKey(from, to, word));
    }
    return false;
  });
}
