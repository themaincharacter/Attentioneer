import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";

/**
 * Pointers (ADR-0017, amended; Epic 5 story 1): one `map/pointers.jsonl`
 * line per reach — a reference's target OUTSIDE the map (a document, a code
 * path, a page). A pointer is its own record family over the slug-spine; the
 * reference file gains zero pointer awareness (the positive half of
 * faces-are-use, ADR-0013).
 *
 * THREE AUTHORED TARGET FORMS, picked by the person at write:
 *   - path: {"on":"<slug>","path":"<workspace-relative path>"}
 *   - at:   {"on":"<slug>","at":"<absolute path>"}      (machine-local)
 *   - url:  {"on":"<slug>","url":"<url>"}               (any scheme, verbatim)
 *
 * The form is authored structure like a link's sign: it is the JSON KEY the
 * person picked, NEVER sniffed or inferred from the value. A `path` value that
 * happens to look absolute stays a workspace-relative `path`; an `at` value is
 * stored exactly as typed (machine-local, so it may dangle honestly on another
 * machine — preserved, surfaced by the window as "cannot read" in story 2,
 * never repaired). Target strings are never interpreted (World B).
 *
 * Identity is the natural key on + form + value: several pointers per
 * reference (spellings are legal quiet duplicates), one line per key, and a
 * byte-exact re-statement rewrites its one line instead of appending a second.
 * Editing a form or a value REPLACES the line in place at its index with the
 * edit-convergence rule (the assumptions' rule, ADR-0017's amendment): if the
 * edited line's new key equals another line's key, the colliding line is
 * dropped in the same edit and the edited line — keeping its own unknown keys
 * and index — is the survivor.
 *
 * Unknown keys on a known pointer survive every rewrite. Malformed or
 * out-of-shape lines are preserved verbatim and surfaced by the loader; an
 * UNKNOWN FORM KEY (a line with no `path`/`at`/`url` field) is preserved and
 * surfaced too — never guessed into one of the three forms (the form
 * vocabulary is provisional, ADR-0017 rule 2). A missing file means no
 * pointers.
 *
 * Provisional: the `pointers.jsonl` name, the record shape and the three form
 * names are ADR-0017's (amended), not settled beyond them. The `path` field
 * name is the durable carrier for cheap agents, and its convention is
 * workspace-relative; `at` is the explicit outward exception and stays
 * machine-local.
 *
 * Canonical serialization is serialize.ts's job (ADR-0004); this module only
 * turns the file's bytes into records and back.
 */

/**
 * The three authored forms, in the order the chooser offers them (the pick
 * always starts UNPICKED: no pick, no write). Provisional: the order and the
 * labels (ADR-0003's rendering seam).
 */
export const POINTER_FORMS = ["path", "at", "url"] as const;

export type PointerForm = (typeof POINTER_FORMS)[number];

export interface Pointer {
  /** The reference slug the pointer hangs off (a pointer needs a word). */
  on: string;
  /** The form the person picked — authored key, never inferred from value. */
  form: PointerForm;
  /** The target, stored verbatim and never interpreted or repaired. */
  value: string;
  /** Unknown JSON keys preserved across rewrites (ADR-0006's posture). */
  extra: Record<string, unknown>;
}

export interface ParsedPointers {
  /** Every readable line, in FILE ORDER, hand-duplicated keys included. */
  pointers: Pointer[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
  /**
   * Lines whose natural key already appeared earlier in the file. Preserved
   * and surfaced at read; never deduped by the app (a hand edit is content).
   */
  duplicates: Pointer[];
}

/** A line found for one reference, with the line's index in the file. */
export interface FoundPointer {
  pointer: Pointer;
  index: number;
}

/** The result of a quiet, in-place edit of one line (edit-convergence). */
export interface PointerEdit {
  pointers: Pointer[];
  /** The pre-existing colliding lines the edit dropped (always the B side). */
  dropped: Pointer[];
}

export function pointersPath(workspacePath: string): string {
  return workspacePath + "/map/pointers.jsonl";
}

/** Is this one of the three authored forms? Anything else is never guessed. */
export function isPointerForm(value: unknown): value is PointerForm {
  return value === "path" || value === "at" || value === "url";
}

/**
 * The natural key: on + form + value (ADR-0017 rule 3). The form is part of
 * the key, so the same string authored as `path` and as `at` is two pointers.
 */
export function pointerKey(on: string, form: PointerForm, value: string): string {
  return [on, form, value].join("\u0000");
}

/**
 * The natural key of one record. Structural, so a pointer-key MARK target
 * (the same three fields under a `pointer` type) reads the key too.
 */
export function pointerKeyOf(pointer: {
  on: string;
  form: PointerForm;
  value: string;
}): string {
  return pointerKey(pointer.on, pointer.form, pointer.value);
}

/**
 * Parse one JSONL line into a Pointer; malformed or out-of-shape lines become
 * `null`. A line must carry a non-empty `on` and EXACTLY ONE of the three form
 * keys (`path`, `at`, `url`) with a non-empty string value. Two form keys
 * mixed, no form key at all (an unknown form the vocabulary does not know yet)
 * or a non-string value is malformed — never guessed at.
 */
export function parsePointerLine(line: string): Pointer | null {
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
  const on = obj.on;
  if (typeof on !== "string" || on === "") return null;

  const present = POINTER_FORMS.filter((form) => form in obj);
  if (present.length !== 1) return null;
  const form = present[0];
  const target = obj[form];
  if (typeof target !== "string" || target === "") return null;

  const extra: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    if (key === "on" || isPointerForm(key)) continue;
    extra[key] = obj[key];
  }
  return { on, form, value: target, extra };
}

/** Serialize one Pointer to its canonical JSONL line (compact, sorted keys). */
export function serializePointerLine(pointer: Pointer): string {
  return canonicalJsonlLine({
    ...pointer.extra,
    ...pointerFields(pointer.form, pointer.value),
    on: pointer.on,
  });
}

function pointerFields(
  form: PointerForm,
  value: string,
): Record<string, string> {
  switch (form) {
    case "path":
      return { path: value };
    case "at":
      return { at: value };
    case "url":
      return { url: value };
  }
}

/**
 * Read `map/pointers.jsonl`. Terminating newlines are ignored; malformed or
 * out-of-shape lines are preserved as unknowns (ADR-0005's posture) so the app
 * never silently drops what it cannot read. Hand-duplicated keys are kept as
 * they came (never deduped here) and reported as `duplicates`. Tolerates a
 * BOM and CRLF from a hand edit.
 */
export function parsePointers(text: string): ParsedPointers {
  const pointers: Pointer[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parsePointerLine(line);
    if (parsed) {
      pointers.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return {
    pointers,
    malformed,
    duplicates: findDuplicatePointers(pointers),
  };
}

export async function loadPointers(workspacePath: string): Promise<ParsedPointers> {
  const text = await readTextFile(pointersPath(workspacePath));
  return text === null
    ? { pointers: [], malformed: [], duplicates: [] }
    : parsePointers(text);
}

/**
 * The pointers file's exact bytes. Every record serializes canonically (sorted
 * keys), in FILE ORDER and preserving multiplicity — a hand-duplicated key is
 * never collapsed by a write (the read rule) — and malformed lines are
 * re-emitted verbatim. An empty document is the canonical empty JSONL (one
 * newline).
 */
export function serializePointers(
  pointers: readonly Pointer[],
  malformed: readonly string[] = [],
): string {
  return canonicalJsonlLines([
    ...pointers.map(serializePointerLine),
    ...malformed,
  ]);
}

export async function savePointers(
  workspacePath: string,
  pointers: readonly Pointer[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(
    pointersPath(workspacePath),
    serializePointers(pointers, malformed),
  );
}

/** The duplicate-key lines (every occurrence after the first), in file order. */
export function findDuplicatePointers(
  pointers: readonly Pointer[],
): Pointer[] {
  const seen = new Set<string>();
  const duplicates: Pointer[] = [];
  for (const pointer of pointers) {
    const key = pointerKeyOf(pointer);
    if (seen.has(key)) {
      duplicates.push(pointer);
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

/** Is this exact (on, form, value) already written? */
export function hasPointer(
  pointers: readonly Pointer[],
  on: string,
  form: PointerForm,
  value: string,
): boolean {
  const key = pointerKey(on, form, value);
  return pointers.some((pointer) => pointerKeyOf(pointer) === key);
}

/**
 * Write a pointer: one line per natural key. A NEW pointer is appended in file
 * order; the BYTE-EXACT re-statement of one already there keeps its one line
 * (its unknown keys and index survive a repetition). A blank owner or a blank
 * target is not a pointer and writes nothing — the form is the caller's
 * authored pick, never defaulted here.
 */
export function addPointer(
  pointers: readonly Pointer[],
  on: string,
  form: PointerForm,
  value: string,
  extra: Record<string, unknown> = {},
): Pointer[] {
  if (on === "" || value === "" || value.trim() === "") return [...pointers];
  const key = pointerKey(on, form, value);
  const index = pointers.findIndex((pointer) => pointerKeyOf(pointer) === key);
  if (index !== -1) return [...pointers];
  return [...pointers, { on, form, value, extra }];
}

/**
 * Edit one line's form and/or value IN PLACE at its index (never append),
 * applying the edit-convergence rule: any OTHER line that now shares the
 * edited line's natural key is dropped in the same edit, so the file holds one
 * line for the key and the edited line — keeping its own unknown keys and
 * index — is the survivor. Lines before it that drop shift the array's indexes
 * as any list removal does. An unknown index or a blank target is a quiet
 * no-op.
 */
export function convergePointerEdit(
  pointers: readonly Pointer[],
  index: number,
  form: PointerForm,
  value: string,
): PointerEdit {
  if (
    index < 0 ||
    index >= pointers.length ||
    value === "" ||
    value.trim() === ""
  ) {
    return { pointers: [...pointers], dropped: [] };
  }
  const edited: Pointer = { ...pointers[index], form, value };
  const key = pointerKeyOf(edited);
  const dropped: Pointer[] = [];
  const next: Pointer[] = [];
  pointers.forEach((pointer, i) => {
    if (i === index) {
      next.push(edited);
      return;
    }
    if (pointerKeyOf(pointer) === key) {
      dropped.push(pointer);
      return;
    }
    next.push(pointer);
  });
  return { pointers: next, dropped };
}

/** Revise one line in place: the line changes at its index (quiet). */
export function revisePointer(
  pointers: readonly Pointer[],
  index: number,
  form: PointerForm,
  value: string,
): Pointer[] {
  return convergePointerEdit(pointers, index, form, value).pointers;
}

/** Remove one line by its index — ammo, one quiet ×, no tombstone. */
export function removePointerAt(
  pointers: readonly Pointer[],
  index: number,
): Pointer[] {
  return pointers.filter((_, i) => i !== index);
}

/**
 * Every line on one reference, in FILE ORDER, each with its index in the file
 * — the chooser's rows and their per-line handles. Several pointers on one
 * reference are siblings, never merged.
 */
export function findPointers(
  pointers: readonly Pointer[],
  on: string,
): FoundPointer[] {
  const found: FoundPointer[] = [];
  pointers.forEach((pointer, index) => {
    if (pointer.on === on) found.push({ pointer, index });
  });
  return found;
}

/**
 * Pointers whose owner is not on the map: a slug that no longer exists (hand
 * edits, partial writes). Preserved in the file and surfaced, never rendered
 * or guessed away (the no-validation posture). The TARGET is never checked —
 * a path may be absent, and an `at` value is machine-local and may dangle
 * honestly: the record layer never stats, repairs or rewrites it.
 */
export function findOrphanPointers(
  pointers: readonly Pointer[],
  wordSlugs: ReadonlySet<string>,
): Pointer[] {
  return pointers.filter((pointer) => !wordSlugs.has(pointer.on));
}
