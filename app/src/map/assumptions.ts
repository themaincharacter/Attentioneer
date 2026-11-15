import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";
import { linkKey } from "./links";

/**
 * Assumptions (ADR-0012 decision 4, Epic 4 story 4): one
 * `map/assumptions.jsonl` line per claim the person states about the dynamics
 * model and holds open to revision — anonymous free text plus its target.
 *
 * A target is ONE of four forms, a different grammar from a mark's (a mark's
 * wire triple is not an assumption target; an assumption never targets a
 * distance):
 *   - a word:            {"text": "...", "on": "<word slug>"}
 *   - a signed link:     {"text": "...", "from": "...", "to": "..."}  (the
 *                        wordless ordered pair — no sign, so a flip keeps it)
 *   - a loop:            {"text": "...", "loop": "<loop name-slug>"}
 *   - a bare spot:       {"text": "...", "x": 12, "y": -4}
 *
 * Natural key = target + text (mirroring a distance's natural key): several
 * assumptions may sit on one target — that is how a rival is stated — and an
 * identical re-statement rewrites its one line instead of duplicating it.
 *
 * Two write rules make revision quiet and in place (never a version, never a
 * history, never an append):
 *   - editing a line's text replaces it AT ITS INDEX (the line's position —
 *     and so the overlay's file order — is stable);
 *   - EDIT-CONVERGENCE: editing A's text until it equals B's text on the same
 *     target lands as A's line rewritten at A's index with the pre-existing
 *     colliding B line dropped; the edited line is the survivor and keeps A's
 *     unknown keys. `convergeAssumptionEdit` is that rule, pure.
 *
 * At READ time, hand-edited duplicate keys are PRESERVED (never deduped) and
 * surfaced (`duplicates`; `findDuplicateAssumptions` recomputes them live).
 * Unknown keys are preserved on every rewrite; malformed lines are preserved
 * verbatim and surfaced; a missing file means no assumptions.
 *
 * An assumption is NOT a mark: a mark says something is not settled; an
 * assumption is a claim kept revisable (the glossary). The software never
 * parses or interprets the text (World B) — it only stores, orders and
 * surfaces it. Only the person authors one.
 *
 * Provisional: the `assumptions.jsonl` name, the record shape and the target
 * grammar are ADR-0012's, not settled beyond it; the diamond glyph and the
 * overlay's layout are ADR-0003's rendering seam (ADR-0016 names the hollow
 * diamond). Lifecycle steps live in `patches.ts`; this module only turns the
 * file's bytes into records and back.
 */

/**
 * What an assumption is about: a word slug, a signed link's wordless ordered
 * pair, a loop's name-derived slug, or a bare spot of plane.
 */
export type AssumptionTarget =
  | { type: "word"; slug: string }
  | { type: "link"; from: string; to: string }
  | { type: "loop"; slug: string }
  | { type: "spot"; x: number; y: number };

export interface Assumption {
  /** The person's claim, stored exactly as left (never parsed, never scored). */
  text: string;
  /** What the claim is about (one target form). */
  target: AssumptionTarget;
  /** Unknown JSON keys preserved across rewrites (ADR-0006's posture). */
  extra: Record<string, unknown>;
}

export interface ParsedAssumptions {
  /** Every readable line, in FILE ORDER, hand-duplicated keys included. */
  assumptions: Assumption[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
  /**
   * Lines whose natural key already appeared earlier in the file. Preserved
   * and surfaced at read; never deduped by the app (a hand edit is content).
   */
  duplicates: Assumption[];
}

/** A line found for one target, with the line's index in the file. */
export interface FoundAssumption {
  assumption: Assumption;
  index: number;
}

/** The result of a quiet, in-place edit of one line (edit-convergence). */
export interface AssumptionEdit {
  assumptions: Assumption[];
  /** The pre-existing colliding lines the edit dropped (always the B side). */
  dropped: Assumption[];
}

export function assumptionsPath(workspacePath: string): string {
  return `${workspacePath}/map/assumptions.jsonl`;
}

/** The target's part of the natural key (distinct prefixes: no cross-kind tie). */
export function assumptionTargetKey(target: AssumptionTarget): string {
  switch (target.type) {
    case "word":
      return `word\u0000${target.slug}`;
    case "link":
      // The wordless ordered pair: a flip cannot orphan the assumption.
      return `link\u0000${target.from}\u0000${target.to}`;
    case "loop":
      // A loop's slug is its name's key (ADR-0012 decision 3), its own
      // namespace — a word and a loop of the same slug are different targets.
      return `loop\u0000${target.slug}`;
    case "spot":
      return `spot\u0000${target.x}\u0000${target.y}`;
  }
}

/** The assumption's natural key: target + text (ADR-0012 decision 4). */
export function assumptionKey(assumption: Assumption): string {
  return `${assumptionTargetKey(assumption.target)}\u0000${assumption.text}`;
}

/**
 * Parse one JSONL line into an Assumption; malformed or out-of-shape lines
 * become `null`. A line must carry a non-empty `text` and EXACTLY ONE target
 * form — a line that mixes forms or half-states a pair/spot is malformed,
 * never guessed at. `word` is the distance/wire grammar, not an assumption
 * target, so a line carrying it is malformed (no cross-ambiguity).
 */
export function parseAssumptionLine(line: string): Assumption | null {
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
  const { text, ...rest } = obj;
  if (typeof text !== "string" || text.trim() === "") return null;
  // A wire's coined word is a distance's field, never an assumption target.
  if ("word" in rest) return null;

  const hasOn = "on" in rest;
  const hasLoop = "loop" in rest;
  const hasPair = "from" in rest || "to" in rest;
  const hasSpot = "x" in rest || "y" in rest;
  if ([hasOn, hasLoop, hasPair, hasSpot].filter(Boolean).length !== 1) {
    // No target, or two targets mixed — never guessed at.
    return null;
  }

  if (hasOn) {
    if (typeof rest.on !== "string" || rest.on === "") return null;
    const { on, ...extra } = rest;
    return { text, target: { type: "word", slug: on }, extra };
  }

  if (hasLoop) {
    if (typeof rest.loop !== "string" || rest.loop === "") return null;
    const { loop, ...extra } = rest;
    return { text, target: { type: "loop", slug: loop }, extra };
  }

  if (hasPair) {
    if (
      typeof rest.from !== "string" ||
      rest.from === "" ||
      typeof rest.to !== "string" ||
      rest.to === ""
    ) {
      return null;
    }
    const { from, to, ...extra } = rest;
    return { text, target: { type: "link", from, to }, extra };
  }

  if (typeof rest.x !== "number" || typeof rest.y !== "number") return null;
  if (!Number.isFinite(rest.x) || !Number.isFinite(rest.y)) return null;
  const { x, y, ...extra } = rest;
  return { text, target: { type: "spot", x, y }, extra };
}

/** Serialize one Assumption to its canonical JSONL line (compact, sorted keys). */
export function serializeAssumptionLine(assumption: Assumption): string {
  return canonicalJsonlLine({
    ...assumption.extra,
    ...targetFields(assumption.target),
    text: assumption.text,
  });
}

function targetFields(
  target: AssumptionTarget,
): Record<string, string | number> {
  switch (target.type) {
    case "word":
      return { on: target.slug };
    case "link":
      return { from: target.from, to: target.to };
    case "loop":
      return { loop: target.slug };
    case "spot":
      return { x: target.x, y: target.y };
  }
}

/**
 * Read `map/assumptions.jsonl`. Terminating newlines are ignored; malformed
 * or out-of-shape lines are preserved as unknowns (ADR-0005's posture) so the
 * app never silently drops what it cannot read. Hand-duplicated keys are kept
 * as they came (never deduped here) and reported as `duplicates`. Tolerates a
 * BOM and CRLF from a hand edit.
 */
export function parseAssumptions(text: string): ParsedAssumptions {
  const assumptions: Assumption[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseAssumptionLine(line);
    if (parsed) {
      assumptions.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return {
    assumptions,
    malformed,
    duplicates: findDuplicateAssumptions(assumptions),
  };
}

export async function loadAssumptions(
  workspacePath: string,
): Promise<ParsedAssumptions> {
  const text = await readTextFile(assumptionsPath(workspacePath));
  return text === null
    ? { assumptions: [], malformed: [], duplicates: [] }
    : parseAssumptions(text);
}

/**
 * The assumptions file's exact bytes. Every record serializes canonically
 * (sorted keys), in FILE ORDER and preserving multiplicity — a hand-duplicated
 * key is never collapsed by a write (the read rule) — and malformed lines are
 * re-emitted verbatim. An empty document is the canonical empty JSONL (one
 * newline).
 */
export function serializeAssumptions(
  assumptions: readonly Assumption[],
  malformed: readonly string[] = [],
): string {
  return canonicalJsonlLines([
    ...assumptions.map(serializeAssumptionLine),
    ...malformed,
  ]);
}

export async function saveAssumptions(
  workspacePath: string,
  assumptions: readonly Assumption[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(
    assumptionsPath(workspacePath),
    serializeAssumptions(assumptions, malformed),
  );
}

/** The duplicate-key lines (every occurrence after the first), in file order. */
export function findDuplicateAssumptions(
  assumptions: readonly Assumption[],
): Assumption[] {
  const seen = new Set<string>();
  const duplicates: Assumption[] = [];
  for (const assumption of assumptions) {
    const key = assumptionKey(assumption);
    if (seen.has(key)) {
      duplicates.push(assumption);
    } else {
      seen.add(key);
    }
  }
  return duplicates;
}

/**
 * State a claim: one line per natural key. A new claim is appended; the
 * IDENTICAL claim already on that target rewrites its one line in place (its
 * unknown keys kept — the person's first statement survives a repetition).
 * An empty/whitespace claim is not a claim and writes nothing.
 */
export function addAssumption(
  assumptions: readonly Assumption[],
  text: string,
  target: AssumptionTarget,
  extra: Record<string, unknown> = {},
): Assumption[] {
  const claim = text.trim();
  if (claim === "") return [...assumptions];
  const record: Assumption = { text: claim, target, extra };
  const key = assumptionKey(record);
  const index = assumptions.findIndex(
    (assumption) => assumptionKey(assumption) === key,
  );
  if (index === -1) return [...assumptions, record];
  const next = [...assumptions];
  next[index] = { ...assumptions[index], text: claim };
  return next;
}

/**
 * Edit one line's text IN PLACE at its index (never append), applying the
 * edit-convergence rule: any OTHER line that now shares the edited line's
 * natural key is dropped in the same edit, so the file holds one line for the
 * key and the edited line — keeping its own unknown keys and index — is the
 * survivor. Lines before it that drop shift the array's indexes as any list
 * removal does. An unknown index or an empty claim is a quiet no-op.
 */
export function convergeAssumptionEdit(
  assumptions: readonly Assumption[],
  index: number,
  text: string,
): AssumptionEdit {
  const claim = text.trim();
  if (index < 0 || index >= assumptions.length || claim === "") {
    return { assumptions: [...assumptions], dropped: [] };
  }
  const edited: Assumption = { ...assumptions[index], text: claim };
  const key = assumptionKey(edited);
  const dropped: Assumption[] = [];
  const next: Assumption[] = [];
  assumptions.forEach((assumption, i) => {
    if (i === index) {
      next.push(edited);
      return;
    }
    if (assumptionKey(assumption) === key) {
      dropped.push(assumption);
      return;
    }
    next.push(assumption);
  });
  return { assumptions: next, dropped };
}

/** Revise a line's text: the line changes at its index (quiet, in place). */
export function reviseAssumption(
  assumptions: readonly Assumption[],
  index: number,
  text: string,
): Assumption[] {
  return convergeAssumptionEdit(assumptions, index, text).assumptions;
}

/** Remove one line by its index — ammo, one quiet ×, no tombstone. */
export function removeAssumption(
  assumptions: readonly Assumption[],
  index: number,
): Assumption[] {
  return assumptions.filter((_, i) => i !== index);
}

/**
 * Every line on one target, in FILE ORDER, each with its index in the file —
 * the overlay's list and its per-line handles. Several claims on one target
 * are siblings, never merged.
 */
export function findAssumptions(
  assumptions: readonly Assumption[],
  target: AssumptionTarget,
): FoundAssumption[] {
  const key = assumptionTargetKey(target);
  const found: FoundAssumption[] = [];
  assumptions.forEach((assumption, index) => {
    if (assumptionTargetKey(assumption.target) === key) {
      found.push({ assumption, index });
    }
  });
  return found;
}

/**
 * The distinct targets carrying at least one assumption, in file order of
 * first appearance — one diamond per target, however many claims sit on it.
 */
export function targetsWithAssumptions(
  assumptions: readonly Assumption[],
): AssumptionTarget[] {
  const seen = new Set<string>();
  const targets: AssumptionTarget[] = [];
  for (const assumption of assumptions) {
    const key = assumptionTargetKey(assumption.target);
    if (seen.has(key)) continue;
    seen.add(key);
    targets.push(assumption.target);
  }
  return targets;
}

/**
 * Assumptions whose target is not on the map: a word slug that no longer
 * exists, a link pair that is gone, or a loop slug no loop carries (hand
 * edits, partial writes). Preserved in the file and surfaced, never rendered
 * or guessed away (the no-validation posture). A bare spot is its own target,
 * so it is never an orphan.
 */
export function findOrphanAssumptions(
  assumptions: readonly Assumption[],
  wordSlugs: ReadonlySet<string>,
  linkKeys: ReadonlySet<string>,
  loopKeys: ReadonlySet<string>,
): Assumption[] {
  return assumptions.filter((assumption) => {
    switch (assumption.target.type) {
      case "word":
        return !wordSlugs.has(assumption.target.slug);
      case "link":
        return !linkKeys.has(
          linkKey(assumption.target.from, assumption.target.to),
        );
      case "loop":
        return !loopKeys.has(assumption.target.slug);
      case "spot":
        return false;
    }
  });
}
