import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";
import { distanceKey } from "./distances";
import { isPointerForm, pointerKey, POINTER_FORMS, type PointerForm } from "./pointers";
import { linkKey } from "./links";

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
 * Five target forms now: a word, a distance wire (from, to, word), a signed
 * link's wordless pair (from, to — ADR-0009's 2026-11-15 amendment), a bare
 * spot, and a POINTER LINE (on + path/at/url — ADR-0009's tightened second
 * amendment, Epic 5). The wordless pair and the wire triple are DISTINCT
 * natural keys, so one pair may carry a mark on its distance and another on its
 * link. A link's key has no sign: flipping the sign keeps the mark; removing
 * the link drops it (die-with-target). The pointer-key form carries the
 * pointer's own key fields, so it is distinct from the word form (an `on`
 * alone): a mark on "the reach is open" is not a mark on the word. Byte-
 * identical hand duplicates share the key and both render marked; a
 * replace-in-place pointer edit carries its marks to the new key in the same
 * batch, and the mark dies with its pointer line.
 *
 * Provisional: `kind` has one value, `"open"` — it names the mark's flavor,
 * never a lifecycle (absence is the only settled state, ADR-0009). The record
 * carries all five target forms: a bare spot is cast, named (grow) and bound
 * by the canvas's ring gestures (story 2), and `retargetMark` is their one
 * pure write; the pointer-key form is cast from a pointer row (Epic 5).
 *
 * Canonical serialization is serialize.ts's job (ADR-0004); this module only
 * turns the file's bytes into records and back.
 */

/**
 * What a mark sits on: a word slug, a distance wire's natural key, a signed
 * link's wordless pair (ADR-0009's amendment), a bare spot, or a pointer line
 * (its owner plus the authored form and value — ADR-0009's tightened second
 * amendment, Epic 5).
 */
export type MarkTarget =
  | { type: "word"; slug: string }
  | { type: "wire"; from: string; to: string; word: string }
  | { type: "link"; from: string; to: string }
  | { type: "spot"; x: number; y: number }
  | { type: "pointer"; on: string; form: PointerForm; value: string };

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
    case "link":
      // The wordless pair names the link by its ordered pair — no sign, so a
      // flip cannot orphan the mark (ADR-0009's amendment, ADR-0014 decision 3).
      return `link\u0000${linkKey(target.from, target.to)}`;
    case "spot":
      return `spot\u0000${target.x}\u0000${target.y}`;
    case "pointer":
      // The pointer LINE is named exactly as the pointer record is (on + form
      // + value, ADR-0017 rule 3) under its own prefix, so a mark on the word
      // "rain" and a mark on rain's reach are two different marks.
      return `pointer\u0000${pointerKey(target.on, target.form, target.value)}`;
  }
}

/** The mark's natural key: kind + target (ADR-0009). */
export function markKey(mark: Mark): string {
  return `${mark.kind}\u0000${markTargetKey(mark.target)}`;
}

/**
 * Parse one JSONL line into a Mark; malformed or out-of-shape lines become
 * `null`. A line must carry `kind` and exactly one target form — a line that
 * mixes forms or half-states a pair/spot is malformed, never guessed at. A
 * `from`/`to` pair WITHOUT a `word` is the wordless pair: a mark on a link.
 * An `on` with exactly one of `path`/`at`/`url` is the pointer-key form.
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
    // The pointer-key form (ADR-0009's tightened second amendment, Epic 5): an
    // `on` plus EXACTLY ONE authored form key names a pointer LINE, not the
    // word. A line mixing two forms, or carrying a form that is not a string,
    // is malformed — the form is never guessed from the value (World B).
    const forms = POINTER_FORMS.filter((form) => form in rest);
    if (forms.length > 1) return null;
    if ("from" in rest || "to" in rest || "word" in rest || "x" in rest || "y" in rest) {
      return null;
    }
    if (forms.length === 1) {
      const form = forms[0];
      const value = rest[form];
      if (typeof value !== "string" || value === "") return null;
      const pointerExtra: Record<string, unknown> = {};
      for (const key of Object.keys(rest)) {
        if (key === "on" || isPointerForm(key)) continue;
        pointerExtra[key] = rest[key];
      }
      return {
        kind,
        target: { type: "pointer", on: rest.on, form, value },
        extra: pointerExtra,
      };
    }
    const { on, ...extra } = rest;
    return { kind, target: { type: "word", slug: on }, extra };
  }

  if ("from" in rest || "to" in rest || "word" in rest) {
    if (
      typeof rest.from !== "string" ||
      rest.from === "" ||
      typeof rest.to !== "string" ||
      rest.to === ""
    ) {
      return null;
    }
    if ("x" in rest || "y" in rest) return null;
    if (!("word" in rest)) {
      // The wordless pair targets a Level 2 signed link (ADR-0009's amendment).
      const { from, to, ...extra } = rest;
      return { kind, target: { type: "link", from, to }, extra };
    }
    if (typeof rest.word !== "string" || rest.word === "") return null;
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
    case "link":
      return { from: target.from, to: target.to };
    case "spot":
      return { x: target.x, y: target.y };
    case "pointer": {
      const fields: Record<string, string> = { on: target.on };
      fields[target.form] = target.value;
      return fields;
    }
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
 * Marks whose target is not on the map: a word slug that no longer exists, a
 * wire whose distance line is gone, or a link whose signed pair is gone (hand
 * edits, partial writes). They are preserved in the file and surfaced by the
 * app, never rendered or guessed away (ADR-0009). A bare spot is its own
 * target, so it is never an orphan.
 */
export function findOrphanMarks(
  marks: readonly Mark[],
  wordSlugs: ReadonlySet<string>,
  wireKeys: ReadonlySet<string>,
  linkKeys: ReadonlySet<string> = new Set(),
  pointerKeys: ReadonlySet<string> = new Set(),
): Mark[] {
  return marks.filter((mark) => {
    if (mark.target.type === "word") return !wordSlugs.has(mark.target.slug);
    if (mark.target.type === "wire") {
      const { from, to, word } = mark.target;
      return !wireKeys.has(distanceKey(from, to, word));
    }
    if (mark.target.type === "link") {
      return !linkKeys.has(linkKey(mark.target.from, mark.target.to));
    }
    if (mark.target.type === "pointer") {
      // A pointer mark outlives nothing: no pointer line for its exact
      // on + form + value means an orphan (a hand edit), surfaced quietly.
      const { on, form, value } = mark.target;
      return !pointerKeys.has(pointerKey(on, form, value));
    }
    return false;
  });
}
