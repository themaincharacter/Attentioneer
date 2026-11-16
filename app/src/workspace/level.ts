import { readTextFile } from "../lib/fs";
import { parseYamlFields, workspaceYml, writeMachineFile } from "../lib/serialize";
import {
  atOrAbove,
  BAND_ZOOM,
  distanceLabelVisible,
  DYNAMICS_FROM,
  GROUND_FROM,
  noteBand,
} from "../canvas/zoomBands";
import { zoomSwitchesMap } from "../canvas/shelfRules";

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
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps): ZOOM NO
 * LONGER CHANGES THE MAP (ADR-0032 supersedes the band rule above). The three
 * maps are separate mini-apps; the level TABS switch them and nothing else (plus
 * the open-restore below), and the wheel only zooms within the map you are on.
 * Everything above STAYS WRITTEN and type-checked — the derivation, the handoff,
 * its queue, the band constants, the camera's band intent, the level pin — and
 * simply stops driving the switch: `canvas/shelfRules.ts`'s `zoomSwitchesMap` is
 * the ONE reading the app asks, and it is false while the flag stands. The key is
 * STILL the resume hint: a tab press writes it, opening reads it. Delete the
 * zoom-derived path (not the key, not the tab write) in the deprecated sweep.
 *
 * `levelFromZoom` is the derivation that made the band the game: it reads the
 * band constants from `canvas/zoomBands.ts` through the one shared comparison
 * (`atOrAbove`, inclusive), so the strictness of every boundary is stated once.
 * DEPRECATED (hidden 2026-11-16 per user review): nothing derives the map from a
 * zoom any more; the function stays written (the sweep's record of the rule and
 * the band tests' subject) — delete it with the zoom switch.
 *
 * THE HONEST PARTITION (ADR-0016's amendment) — the render map, one source:
 *   - every game rendered words, distances, marks and the shelf;
 *   - the dynamics game ADDED its own records: links, loops, assumptions and
 *     the playing set (model.json);
 *   - the ground game ADDED pointers (the reach beyond the map) and, in story
 *     2, the window. Nothing was taken away, no game hid another's content.
 * `RENDER_MAP` spells that table out for tests and for the app's wiring.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate maps): the person's
 * verdict is that the maps will NOT be the same maps, so the partition above is
 * no longer what RENDERS. The dynamics and ground maps are blank paper for now:
 * `canvas/mapContentRules.ts` is the ONE reading ("map content renders at
 * concept only", behind a deprecations.ts flag) and every render path asks it.
 * `RENDER_MAP` stays exactly as written — it is the pre-hide table of the
 * records each game once drew, kept for the tests and for the deprecated sweep;
 * reading it as "what shows today" would be the lie this note removes.
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
 * The zoom a click-to-center lands on.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps): it used
 * to land on the CURRENT BAND's landing zoom, so centering could never flip the
 * game as a side effect (ADR-0018 decision 4). With the zoom no longer changing
 * the map, centering is ordinary navigation: it keeps the zoom the person is
 * already at. The band read stays written as the flip-back — `switches` false
 * restores the landing-zoom behavior — delete the band branch in the deprecated
 * sweep. PROVISIONAL: "centering keeps the current zoom" is this story's call.
 */
export function centeringZoom(
  zoom: number,
  switches: boolean = zoomSwitchesMap(),
): number {
  return switches ? BAND_ZOOM[levelFromZoom(zoom)] : zoom;
}

/**
 * The default camera's zoom — ONE shared constant: the default level's landing
 * zoom, so the opening camera and the opening game can never disagree
 * (ADR-0018 decision 4). The old hard-coded 100% sat in the dynamics band while
 * the default level was concept.
 */
export const DEFAULT_CAMERA_ZOOM = BAND_ZOOM[DEFAULT_LEVEL];

/**
 * The zoom chip's read (story 2): the percent the chip may show WITHOUT
 * contradicting what the plane is rendering. Rounding alone can lie at a
 * boundary — a zoom of 0.846 rounds to "85%", the dynamics band's floor, while
 * the game is still concept; a zoom of 0.549 rounds to "55%", the label
 * thresholds' floor, while distance words are still folded. The chip's number
 * therefore goes through the SAME readings the renderer uses — `levelFromZoom`
 * for the band (itself the one `atOrAbove` reading) plus `noteBand` and
 * `distanceLabelVisible` — and steps to the nearest whole percent that agrees
 * with all of them. So the chip can never say 55% while the labels are folded,
 * or 85% while the game is still concept.
 *
 * Provisional: the chip is one number (it does not name the map — that is the
 * level control's job), and the percent is not persisted anywhere.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps): the
 * band-aware agreement search above existed because the zoom PICKED the map, so
 * a rounded percent could name a map the plane was not in. The zoom no longer
 * changes the map (ADR-0032) and the chip is a plain rounding of the camera's
 * own zoom — it neither implies nor causes a switch. The old search stays
 * written as the flip-back (`switches` false) — delete it in the deprecated
 * sweep.
 */
export function zoomChipPercent(
  zoom: number,
  switches: boolean = zoomSwitchesMap(),
): number {
  if (!Number.isFinite(zoom)) return Math.round(DEFAULT_CAMERA_ZOOM * 100);
  if (!switches) return Math.round(zoom * 100);
  const band = levelFromZoom(zoom);
  const labels = distanceLabelVisible(zoom);
  const notes = noteBand(zoom);
  const agrees = (candidate: number): boolean =>
    levelFromZoom(candidate / 100) === band &&
    noteBand(candidate / 100) === notes &&
    distanceLabelVisible(candidate / 100) === labels;

  const rounded = Math.round(zoom * 100);
  if (agrees(rounded)) return rounded;
  // The boundaries are provisional constants, so the search does not assume
  // they sit on whole percents: with today's values the nearest agreeing
  // percent is one step away, and the loop keeps that true if tuning moves.
  for (let step = 1; step <= 100; step += 1) {
    const down = rounded - step;
    if (down >= 0 && agrees(down)) return down;
    const up = rounded + step;
    if (agrees(up)) return up;
  }
  return rounded;
}

/**
 * The render map (ADR-0016's amendment): which records each game ONCE drew.
 * Words, distances, marks and the shelf rendered in EVERY game — the partition
 * was additive, never exclusive — while each game only ADDED its own records.
 * Rendering (glyphs, geometry, zoom interplay) stays ADR-0003's seam.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate maps): this table is
 * now the PRE-HIDE record of what the copy-over consisted of, kept for the
 * tests and the deprecated sweep. What actually renders is
 * `canvas/mapContentRules.ts`'s rule: concept only, while the flag stands.
 */
export const RENDER_MAP = {
  /** The concept map's content: once rendered by every game, now concept only. */
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
