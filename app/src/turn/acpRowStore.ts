/**
 * A TOOL ROW'S STATE ON THIS MACHINE (story 22.1; PROVISIONAL shape).
 *
 * WHAT THIS FILE IS: the ONE place the app config's `toolRows` key and the
 * shipped ACP rows meet. The shipped rows are DATA and never change at run
 * time; what changes is a per-machine FACT — whether a person pressed "test
 * this row" and what came back — and a fact belongs in the config file, not in
 * the row data.
 *
 * WHAT IS STORED: an array of `{ id, verified, seen }` facts and NOTHING
 * else. `seen` is the ISO date of the test and the FIRST LINE of what it
 * answered, clipped (turn/acpSpecs.ts's `acpSeenLine`). A test that fails
 * writes nothing at all: the state stays untested, and no half-fact is left
 * behind to look like a result.
 *
 * WHY A LAYER, NOT AN EDIT: a stored id that the shipped list does not carry
 * SURVIVES a load and a save. The row may come back in a later build, and
 * silently dropping a person's fact because this build does not ship that row
 * would be a deletion nobody asked for. A fact whose fields are unreadable is
 * dropped on read (it cannot be laid over anything honestly), but an absent id
 * is only absent from the view, never from the file.
 *
 * THE WRITE GOES THROUGH THE ONE QUEUED MERGE (lib/appConfig.ts), so a tool
 * row's fact can never drop another feature's key and two edits never
 * interleave. The stored object is built FIELD BY FIELD, so a stray property
 * (a name, a command, anything a row once carried) can never ride into the
 * file; a row's facts are exactly id, verified and seen.
 *
 * PROVISIONAL: the config key's name, the array shape, and the clip length.
 */

import { loadAppConfig, saveAppConfig, type AppConfig } from "../lib/appConfig";
import {
  acpSeenLine,
  type AcpRowSeen,
  type AcpSpec,
} from "./acpSpecs";

/** The config key the tool-row facts live under. */
export const TOOL_ROWS_CONFIG_KEY = "toolRows";

/**
 * ONE ROW'S PER-MACHINE FACT. It answers two questions only: did a test pass
 * here (`verified`), and what did that test see (`seen`). It never carries a
 * name, a command, an argv or a key — those are the row's, and the row is data.
 */
export interface AcpRowFact {
  /** The shipped row's id; the fact is laid over that row. */
  id: string;
  /** True only when a test on this machine completed with words. */
  verified: boolean;
  /** What that test answered, or null when no test has passed here. */
  seen: AcpRowSeen | null;
}

/**
 * WHAT THIS MODULE NEEDS FROM THE CONFIG: one read and one queued save. The
 * default pair is lib/appConfig.ts's; a test hands its own so the exact bytes
 * of a patch can be read without a Tauri window.
 */
export interface ToolRowStoreIo {
  load: () => Promise<AppConfig>;
  save: (patch: AppConfig) => Promise<void>;
}

const TOOL_ROW_STORE_IO: ToolRowStoreIo = {
  load: loadAppConfig,
  save: saveAppConfig,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** One fact, built field by field from whatever the file held, or null. */
function readFact(value: unknown): AcpRowFact | null {
  if (!isRecord(value)) return null;
  const id = textOf(value.id).trim();
  if (id === "") return null;
  const seenValue = value.seen;
  let seen: AcpRowSeen | null = null;
  if (isRecord(seenValue)) {
    const date = textOf(seenValue.date).trim();
    const line = acpSeenLine(textOf(seenValue.line));
    if (date !== "" && line !== "") seen = { date, line };
  }
  // Only `true` is a yes; anything else (a string "true", a number, absent)
  // reads as the honest false.
  return { id, verified: value.verified === true, seen };
}

/**
 * THE FACTS THE FILE HOLDS (PURE). A missing key, a value that is not an array
 * and an entry without an id all read as nothing; a fact with no id cannot be
 * laid over a row, so it is dropped rather than guessed at. Two entries with
 * the same id keep the FIRST — a file with a duplicate is ambiguous, and the
 * earlier one is the one a patch would have replaced.
 */
export function readToolRowFacts(value: unknown): AcpRowFact[] {
  if (!Array.isArray(value)) return [];
  const facts: AcpRowFact[] = [];
  const seen = new Set<string>();
  for (const candidate of value) {
    const fact = readFact(candidate);
    if (fact === null || seen.has(fact.id)) continue;
    seen.add(fact.id);
    facts.push(fact);
  }
  return facts;
}

/**
 * THE SAME FACTS, AS THEY GO TO THE FILE (PURE): built field by field, in one
 * order, with every field a row's fact is allowed to have and no other. An
 * entry that cannot be stored honestly is dropped here rather than written as
 * a shape a later load would have to guess at.
 */
export function storedToolRowFacts(facts: readonly AcpRowFact[]): AcpRowFact[] {
  const stored: AcpRowFact[] = [];
  const seen = new Set<string>();
  for (const fact of facts) {
    const read = readFact(fact);
    if (read === null || seen.has(read.id)) continue;
    seen.add(read.id);
    stored.push(read);
  }
  return stored;
}

/** ONE stored fact by id, or null. The merge's whole lookup. */
export function rowFactOf(
  facts: readonly AcpRowFact[],
  id: string,
): AcpRowFact | null {
  return facts.find((fact) => fact.id === id) ?? null;
}

/**
 * THE MERGED ROW (PURE, shippedAcpSpec's sibling): the shipped row with the
 * one field a machine may change laid over it. Only `verified` is overlaid —
 * the row's command, argv, env entries, budget and notes stay the data's — so
 * the picker's label (acpRowLabel reads `verified`) flips when a test passes
 * and nowhere else. `seen` is not a row field; the status sentence takes it
 * from the fact.
 */
export function rowWithFacts(
  spec: AcpSpec,
  facts: readonly AcpRowFact[],
): AcpSpec {
  const fact = rowFactOf(facts, spec.id);
  return fact === null || !fact.verified
    ? spec
    : { ...spec, verified: true };
}

/** WHAT A PASSING TEST SAW, from its answer (PURE apart from the clock). */
export function rowSeenOf(answer: string, at: Date = new Date()): AcpRowSeen {
  return {
    date: at.toISOString().slice(0, 10),
    line: acpSeenLine(answer),
  };
}

/** The facts this machine keeps, from the config file. */
export async function loadToolRowFacts(
  io: ToolRowStoreIo = TOOL_ROW_STORE_IO,
): Promise<AcpRowFact[]> {
  try {
    const config = await io.load();
    return readToolRowFacts(config[TOOL_ROWS_CONFIG_KEY]);
  } catch {
    return [];
  }
}

/**
 * Persist the whole fact list through the ONE queued merge. Field by field, so
 * nothing but a fact can be written; the key is the only top-level one touched.
 */
export async function saveToolRowFacts(
  facts: readonly AcpRowFact[],
  io: ToolRowStoreIo = TOOL_ROW_STORE_IO,
): Promise<AcpRowFact[]> {
  const stored = storedToolRowFacts(facts);
  await io.save({ [TOOL_ROWS_CONFIG_KEY]: stored });
  return stored;
}

/**
 * ONE FACT PATCHED IN (the test verb's only write): the current file, this row
 * replaced in place (or appended), and the whole list written back. An id the
 * shipped list does not carry is left exactly as the file holds it — a patch
 * never cleans up after another build's row.
 */
export async function patchToolRowFact(
  fact: AcpRowFact,
  io: ToolRowStoreIo = TOOL_ROW_STORE_IO,
): Promise<AcpRowFact[]> {
  const current = await loadToolRowFacts(io);
  const next = storedToolRowFacts([fact]);
  const stored = next[0];
  if (stored === undefined) return current;
  const at = current.findIndex((entry) => entry.id === stored.id);
  const nextFacts =
    at < 0
      ? [...current, stored]
      : current.map((entry, index) => (index === at ? stored : entry));
  return saveToolRowFacts(nextFacts, io);
}
