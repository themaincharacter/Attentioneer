import { readTextFile } from "../lib/fs";
import { parseYamlFields, workspaceYml, writeMachineFile } from "../lib/serialize";
import {
  atOrAbove,
  BAND_ZOOM,
  DYNAMICS_FROM,
  GROUND_FROM,
} from "../canvas/zoomBands";

/**
 * The level's RECORD (ADR-0016, amended by ADR-0018): the game is a quiet band
 * over the same plane, and `workspace.yml`'s `level` key is its RESUME HINT —
 * `"concept"`, `"dynamics"` or `"ground"`; absent (or unreadable, or garbage)
 * means concept, so an older workspace opens exactly as before.
 *
 * THE strict handoff (ADR-0018 decision 2, `levelHandoff.ts`): the zoom band is
 * the game at runtime and WRITES this key when a zoom gesture settles or a
 * deliberate jump lands — through the workspace's in-order write queue, never an
 * unqueued read-modify-write. On open the key SETS the camera into its band and
 * never writes, so a hand-edited key is honored on open and rewritten only on
 * the first settled crossing. The band and the key cannot disagree while
 * running: one source of behavior, one source of record, one direction each.
 *
 * `levelFromZoom` is the derivation that makes the band the game: it reads the
 * band constants from `canvas/zoomBands.ts` through the one shared comparison
 * (`atOrAbove`, inclusive), so the strictness of every boundary is stated once.
 *
 * THE HONEST PARTITION (ADR-0016's amendment) — the render map, one source:
 *   - every game renders words, distances, marks and the shelf;
 *   - the dynamics game ADDS its own records: links, loops, assumptions and
 *     the playing set (model.json);
 *   - the ground game ADDS pointers (the reach beyond the map) and, in story
 *     2, the window. Nothing is taken away, no game hides another's content.
 * `RENDER_MAP` spells that table out for tests and for the app's wiring.
 *
 * The key is written canonically on change, and only the level line is
 * touched: comments, unknown keys and the shelf's fold stay exactly as they
 * were. Provisional: the key's name and the three value spellings are
 * ADR-0016's rule, not a settled format (ADR-0003's rendering seam covers the
 * control's look).
 */

export type Level = "concept" | "dynamics" | "ground";

/**
 * The three games, in the order the control names them. Provisional: the
 * order of the names on the quiet switch (ADR-0003's seam).
 */
export const LEVELS: readonly Level[] = ["concept", "dynamics", "ground"];

/** The provisional workspace key naming the game. */
export const LEVEL_KEY = "level";

export const DEFAULT_LEVEL: Level = "concept";

/**
 * The game a zoom sits in (ADR-0018 decision 1): concept below
 * `DYNAMICS_FROM`, dynamics from `DYNAMICS_FROM` up to (not including)
 * `GROUND_FROM`, ground at or above `GROUND_FROM`. The LOWER bound of each
 * band is INCLUSIVE and the upper bound is EXCLUSIVE — the one shared
 * `atOrAbove` reading, stated once for bands and labels alike.
 *
 * Garbage (NaN, ±Infinity) is the default level: a camera can never produce
 * it, and the key's read is tolerant the same way (absent or garbage in
 * `workspace.yml` means concept, ADR-0016). Provisional: the boundary values
 * are the band constants' (ADR-0003's seam, tuned at the slice).
 */
export function levelFromZoom(zoom: number): Level {
  if (!Number.isFinite(zoom)) return DEFAULT_LEVEL;
  if (atOrAbove(zoom, GROUND_FROM)) return "ground";
  if (atOrAbove(zoom, DYNAMICS_FROM)) return "dynamics";
  return "concept";
}

/**
 * The zoom a click-to-center lands on: its band's landing zoom. Centering can
 * never flip the game as a side effect (ADR-0018 decision 4 — the old
 * `centerOn(..., 1)` landed in dynamics from every concept zoom).
 */
export function centeringZoom(zoom: number): number {
  return BAND_ZOOM[levelFromZoom(zoom)];
}

/**
 * The default camera's zoom — ONE shared constant: the default level's landing
 * zoom, so the opening camera and the opening game can never disagree
 * (ADR-0018 decision 4). The old hard-coded 100% sat in the dynamics band while
 * the default level was concept.
 */
export const DEFAULT_CAMERA_ZOOM = BAND_ZOOM[DEFAULT_LEVEL];

/**
 * The render map (ADR-0016's amendment): which records each game draws. Words,
 * distances, marks and the shelf render in EVERY game — the partition is
 * additive, never exclusive — while each game only ADDS its own records.
 * Rendering (glyphs, geometry, zoom interplay) stays ADR-0003's seam.
 */
export const RENDER_MAP = {
  /** The plane's common content: rendered by every game, unchanged. */
  all: ["words", "distances", "marks", "shelf"],
  /** The dynamics game's own records (links, loops, assumptions, the set). */
  dynamics: ["links", "loops", "assumptions", "model"],
  /** The ground game's own records: the reach beyond the map. */
  ground: ["pointers"],
} as const;

/** A line that assigns the level key (never a comment). */
const LEVEL_LINE = /^\s*level\s*:/;

/**
 * The level from `workspace.yml`'s parsed fields. Tolerant on read: `dynamics`
 * or `ground` (quoted, unquoted, cased or padded) turns that game on; a
 * missing, empty, numeric or any other garbage value is concept — the app
 * never asks twice and never fails to open (ADR-0016). Documented and tested:
 * garbage = concept.
 */
export function levelOf(fields: Readonly<Record<string, string | number>>): Level {
  const value = fields[LEVEL_KEY];
  if (typeof value !== "string") return DEFAULT_LEVEL;
  const normalized = value.trim().toLowerCase();
  if (normalized === "dynamics") return "dynamics";
  if (normalized === "ground") return "ground";
  return DEFAULT_LEVEL;
}

/** The level from raw `workspace.yml` text (missing text = concept). */
export function levelOfText(text: string | null): Level {
  return text === null ? DEFAULT_LEVEL : levelOf(parseYamlFields(text));
}

/**
 * The workspace.yml bytes with the level set canonically. The line is
 * rewritten in place when it exists (duplicates collapse to one) and appended
 * otherwise; every other byte — comments included — is kept, with LF
 * newlines and exactly one trailing newline. Pure, so persistence is testable
 * without the fs bridge.
 */
export function withLevel(text: string, level: Level): string {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n*$/, "");
  const lines = normalized === "" ? [] : normalized.split("\n");
  const entry = `${LEVEL_KEY}: ${JSON.stringify(level)}`;

  const out: string[] = [];
  let written = false;
  for (const line of lines) {
    if (!LEVEL_LINE.test(line)) {
      out.push(line);
      continue;
    }
    if (written) continue; // a hand-duplicated key collapses to one line
    out.push(entry);
    written = true;
  }
  if (!written) out.push(entry);
  return `${out.join("\n")}\n`;
}

/**
 * Persist the level in the workspace's own file. The workspace must already
 * exist; if the file somehow reads empty the canonical scaffold stands in, so
 * the format key is never dropped.
 *
 * This is a READ-MODIFY-WRITE (it keeps every other byte), so it is only ever
 * reached through the level handoff's write queue (`levelHandoff.ts`) — never
 * called unqueued from a handler. Opening a workspace never calls it.
 */
export async function saveWorkspaceLevel(
  workspacePath: string,
  level: Level,
): Promise<void> {
  const path = `${workspacePath}/workspace.yml`;
  const text = await readTextFile(path);
  const base = text !== null && text.trim() !== "" ? text : workspaceYml();
  await writeMachineFile(path, withLevel(base, level));
}
