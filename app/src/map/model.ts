import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJson } from "../lib/serialize";

/**
 * The playing set (ADR-0013): a dynamics model plays with a literal set of
 * words, kept as one record — `map/model.json`, one canonical JSON object
 * `{"words": [sorted member slugs]}`. Absence is exclusion: a word not named
 * here is out of play, and nothing else records the choice. A missing file
 * means no accepted set (the selector opens before play); an empty file is
 * tolerated as the same nothing.
 *
 * Unknown top-level keys are preserved across rewrites (ADR-0006's posture),
 * and a file the app cannot read is preserved byte-for-byte and surfaced by
 * the loader — never silently repaired or guessed at.
 *
 * Provisional: the record's shape (a JSON object with one `words` array) and
 * the `model.json` name are ADR-0013's, not settled beyond it. Rename/remove
 * grow membership steps in `patches.ts`; composed joins (a link to an outsider
 * pulls it in, coining while playing joins) are story 2's.
 *
 * Canonical serialization is serialize.ts's job (ADR-0004); this module only
 * turns the file's bytes into the record and back.
 */

/** The playing set: member reference slugs plus any hand-written extras. */
export interface PlayingSet {
  /** Member reference slugs — sorted and unique in canonical form. */
  words: string[];
  /** Unknown top-level JSON keys preserved across rewrites. */
  extra: Record<string, unknown>;
}

export interface ParsedModel {
  /** The accepted set, or null when there is none. */
  model: PlayingSet | null;
  /**
   * The file's bytes when they are not a playing set. Preserved exactly for
   * the next write and surfaced by the app; an empty file is not malformed.
   */
  malformed: string | null;
}

export function modelPath(workspacePath: string): string {
  return `${workspacePath}/map/model.json`;
}

/** Sorted, unique, non-empty member slugs — the canonical member order. */
export function dedupe(words: readonly string[]): string[] {
  return [...new Set(words.filter((word) => word !== ""))].sort();
}

/**
 * Parse `map/model.json`. Missing (`null`) and empty text are no accepted
 * set; unreadable or out-of-shape content is preserved as `malformed` and
 * yields no set (a record the app cannot read never half-plays). A readable
 * set is deduped and sorted, and its unknown top-level keys are kept.
 * Tolerates a BOM and CRLF from a hand edit.
 */
export function parseModel(text: string | null): ParsedModel {
  if (text === null) return { model: null, malformed: null };
  const body = text.replace(/^\uFEFF/, "").trim();
  if (body === "") return { model: null, malformed: null };

  let value: unknown;
  try {
    value = JSON.parse(body);
  } catch {
    return { model: null, malformed: text };
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return { model: null, malformed: text };
  }

  const { words, ...extra } = value as Record<string, unknown>;
  if (
    !Array.isArray(words) ||
    !words.every((word) => typeof word === "string" && word !== "")
  ) {
    return { model: null, malformed: text };
  }
  return {
    model: { words: dedupe(words as string[]), extra },
    malformed: null,
  };
}

/**
 * The model.json bytes. A set serializes through `canonicalJson` (sorted keys,
 * 2-space indent, LF, trailing newline). With no set, unreadable bytes are
 * re-emitted exactly as they came in, and an empty/missing file writes nothing
 * — an explicit accept is the only thing that replaces unreadable content.
 */
export function serializeModel(
  model: PlayingSet | null,
  malformed: string | null = null,
): string {
  if (model === null) return malformed ?? "";
  return canonicalJson({ ...model.extra, words: dedupe(model.words) });
}

export async function loadModel(workspacePath: string): Promise<ParsedModel> {
  return parseModel(await readTextFile(modelPath(workspacePath)));
}

/**
 * Write the record. `writeTextFile` is the byte door here (not
 * `writeMachineFile`) so a preserved unreadable file keeps its exact bytes;
 * a real set is already canonical before it arrives.
 */
export async function saveModel(
  workspacePath: string,
  model: PlayingSet | null,
  malformed: string | null = null,
): Promise<void> {
  await writeTextFile(modelPath(workspacePath), serializeModel(model, malformed));
}

/** Is this slug in the playing set? No set means nothing is in play. */
export function hasWord(model: PlayingSet | null, slug: string): boolean {
  return model !== null && model.words.includes(slug);
}

/** Add a word to play. */
export function withWord(model: PlayingSet, slug: string): PlayingSet {
  return { ...model, words: dedupe([...model.words, slug]) };
}

/**
 * The composed join (ADR-0013 decision 4): every word a move names is in play
 * afterwards. A drawn link names its two endpoints, so linking to an outsider
 * pulls it into the set; coining a word while playing joins it the same way.
 *
 * Pure step only: the caller writes the DURABLE thing first (the link line, the
 * reference file) and this membership write second, so a crash leaves the
 * visible move and a word briefly out of play — fixable by one accept — never a
 * member naming no move. No accepted set means nothing to join (the selector is
 * the door, ADR-0013); the same record comes back untouched when every word is
 * already in play, so the caller can skip the write.
 */
export function joinWords(
  model: PlayingSet | null,
  slugs: readonly string[],
): PlayingSet | null {
  if (model === null) return null;
  const missing = dedupe(slugs).filter((slug) => !model.words.includes(slug));
  if (missing.length === 0) return model;
  return { ...model, words: dedupe([...model.words, ...missing]) };
}

/** The composed join for one word (a coin while playing). */
export function joinWord(
  model: PlayingSet | null,
  slug: string,
): PlayingSet | null {
  return joinWords(model, [slug]);
}

/** Take a word out of play — a quiet edit, absence is the record (ADR-0013). */
export function withoutWord(model: PlayingSet, slug: string): PlayingSet {
  return { ...model, words: dedupe(model.words.filter((word) => word !== slug)) };
}

/**
 * The selector's opening selection: the accepted set when one exists (only
 * words still on the map show up, since the selector draws over the plane),
 * otherwise every current word — the pre-filled first entry (ADR-0013).
 */
export function prefilledSelection(
  model: PlayingSet | null,
  available: readonly string[],
): string[] {
  if (model === null) return dedupe(available);
  const onMap = new Set(available);
  return dedupe(model.words.filter((slug) => onMap.has(slug)));
}
