import type { DirEntry } from "../lib/fs";
import {
  LISTING_MAX_ENTRIES,
  folderEntryLine,
  joinFolderPath,
} from "../map/readings";
import { openFileOutward, type OutwardResult } from "./outward";

/**
 * STORY 20.2 (PROVISIONAL) — THE PROJECT CARD'S EXPLORER, PURE.
 *
 * A project card is a ground reference whose reading is `form: folder`: a
 * place elsewhere on this machine. Story 20.1 gave it a KEPT listing — a
 * snapshot it stores and refreshes on the person's gesture. This module is the
 * OTHER surface, and it is not a record at all: while the card is expanded the
 * person walks the folder level by level, and every level is ONE on-demand
 * listing read through the existing bridge (story 20.1's `listDirEntries`).
 * No watcher, no poll, no held handle: a read happens only because a hand
 * asked for one.
 *
 * THREE RULES, kept apart from the component so a test can pin them without a
 * DOM:
 *
 *   - WHAT A LEVEL SHOWS is the bridge's entries as ROWS: folders first, then
 *     names, folders marked with the trailing slash the kept listing uses.
 *     Over `LISTING_MAX_ENTRIES` rows the rest DROP WHOLE — no counter, no
 *     "more" line, nothing invented about what was not read.
 *   - THE PATH IS A STACK OF FOLDER NAMES under the project root, and it is
 *     VIEW STATE: never a record, never written, dropped when the card closes.
 *     The quiet line above the rows is the path from the project root
 *     (`src/lib`), never the absolute path — the plane never learns where the
 *     machine keeps its home.
 *   - A LEVEL THAT CANNOT BE READ never becomes where the person is. A step
 *     down that cannot be read falls back to the level it came from; a step
 *     back up is always taken (the way out exists even when the level does
 *     not answer). Either way ONE sentence stands in place, and nothing else
 *     about the card changes.
 *
 * The WRITE RULE IS ABSOLUTE: nothing in this module creates, renames, deletes
 * or edits. The person's writes happen in their own tools; the card's one
 * outward move (story 20.1's folder verb) stays for exactly that. The
 * explorer only reads, and a double-clicked FILE goes to the system's default
 * handler through the one outward door.
 */

/** The one quiet word on the row that climbs out of the level. */
export const EXPLORER_UP_LABEL = "up";

/**
 * PROVISIONAL — THE ONE HONEST SENTENCE for a level that cannot be read: a
 * folder that was removed under the person, a path that is no longer a folder,
 * a permission the OS refused. It reuses the 20.1 take's family ("the project
 * folder cannot be reached; nothing was kept.") minus its write half, because
 * browsing keeps nothing at all.
 */
export const EXPLORER_UNREACHABLE = "the folder cannot be reached.";

/** One row on an expanded card's explorer: the way up, or one entry. */
export interface ExplorerRow {
  /** The way back up, or one entry of the level. */
  kind: "up" | "entry";
  /** What the row shows: "up", or the entry's own name with a folder's slash. */
  label: string;
  /** The entry's name as the folder gave it; null for the way up. */
  name: string | null;
  /** A folder is marked (and descends); anything else is a file. */
  isDir: boolean;
}

/** What one gesture on a row means: climb, descend, or hand a file to the OS. */
export type ExplorerRowAction = "ascend" | "descend" | "open";

/**
 * What a row's gesture is. It is a FUNCTION, not a rule buried in the markup:
 * a folder descends on ONE click, a file needs the DOUBLE click, and the way
 * up always climbs. That asymmetry is the whole safety of the surface — no
 * single press on a file can ever launch anything.
 */
export function rowAction(row: ExplorerRow): ExplorerRowAction {
  if (row.kind === "up") return "ascend";
  return row.isDir ? "descend" : "open";
}

/**
 * One level's rows: the way up first when descended, then the folders by name,
 * then the files by name. The entries are ordered HERE, by name as this
 * language compares them, so the level never depends on a caller's order (the
 * bridge sorts by its own byte order; the two agree for the provisional
 * ASCII-named rule, exactly as the kept listing's take does). The cap drops
 * WHOLE entries: a kept row is always a complete name.
 */
export function explorerRows(
  entries: readonly DirEntry[],
  descended: boolean,
): ExplorerRow[] {
  const ordered = [...entries].sort((left, right) => {
    if (left.isDir !== right.isDir) return left.isDir ? -1 : 1;
    return left.name < right.name ? -1 : left.name > right.name ? 1 : 0;
  });
  const rows: ExplorerRow[] = ordered
    .slice(0, LISTING_MAX_ENTRIES)
    .map((entry) => ({
      kind: "entry",
      label: folderEntryLine(entry),
      name: entry.name,
      isDir: entry.isDir,
    }));
  return descended
    ? [{ kind: "up", label: EXPLORER_UP_LABEL, name: null, isDir: false }, ...rows]
    : rows;
}

/**
 * The project root's own name: the last component of the folder the card
 * points at, in either convention. It is the only part of the absolute path
 * the face ever shows.
 */
export function explorerRootName(folder: string): string {
  const parts = folder.split(/[\\/]+/).filter((part) => part !== "");
  return parts.length === 0 ? folder : parts[parts.length - 1];
}

/**
 * THE QUIET PATH LINE: where the person is, said from the project root —
 * "attentioneer" at the top, "attentioneer/src/lib" below it. Never the
 * absolute path: the folder's parent is the machine's business, not the map's.
 */
export function explorerPathLine(
  folder: string,
  segments: readonly string[],
): string {
  return [explorerRootName(folder), ...segments].join("/");
}

/** The absolute path of the level the stack names (the bridge's own path). */
export function explorerLevelPath(
  folder: string,
  segments: readonly string[],
): string {
  return segments.reduce((path, name) => joinFolderPath(path, name), folder);
}

/**
 * The absolute path of one entry in the level — the EXACT path a double-click
 * hands the OS. It joins the same way the kept listing's take joins, so the
 * file the system opens is the file the card's own words name.
 */
export function explorerEntryPath(
  folder: string,
  segments: readonly string[],
  name: string,
): string {
  return joinFolderPath(explorerLevelPath(folder, segments), name);
}

/**
 * The bridge door this surface reads through, and the ONLY one: one bounded
 * listing per gesture. It is a parameter so a test can record every read and
 * prove that browsing reaches nothing else.
 */
export interface ExplorerIo {
  listDirEntries(path: string): Promise<DirEntry[]>;
}

/**
 * ONE EXPANDED CARD'S EXPLORER, as VIEW STATE: where the person is (the folder
 * names under the project root), what that level said, and the one sentence
 * that stands in place when it had nothing to say. Nothing here is persisted,
 * mirrored or logged, and closing the card drops the whole shape
 * (`closeExplorer`).
 */
export interface ExplorerView {
  /** Where the person is: folder names under the project root, outermost first. */
  segments: string[];
  /** The level's entries as the bridge gave them; [] when it refused. */
  entries: DirEntry[];
  /** One quiet sentence in place, or null (a level that answered). */
  problem: string | null;
}

/** The one shape a closed card holds: there is no explorer. */
export function closeExplorer(): null {
  return null;
}

/** Read the top level, once, when the card is expanded. */
export async function openExplorerRoot(
  folder: string,
  io: ExplorerIo,
): Promise<ExplorerView> {
  try {
    return { segments: [], entries: await io.listDirEntries(folder), problem: null };
  } catch {
    return { segments: [], entries: [], problem: EXPLORER_UNREACHABLE };
  }
}

/**
 * STEP DOWN into one folder. The level is read FIRST: only a level the bridge
 * answered becomes where the person is. A refused level leaves the stack
 * exactly where it was (the step falls back to the level it came from) and
 * answers the one sentence — so the way back up still works.
 */
export async function descendExplorer(
  view: ExplorerView,
  folder: string,
  name: string,
  io: ExplorerIo,
): Promise<ExplorerView> {
  const segments = [...view.segments, name];
  try {
    const entries = await io.listDirEntries(explorerLevelPath(folder, segments));
    return { segments, entries, problem: null };
  } catch {
    return { ...view, problem: EXPLORER_UNREACHABLE };
  }
}

/**
 * STEP BACK UP one level. The way out is always taken, even when the level it
 * lands on cannot be read: the person is never trapped in a folder that went
 * away. A refused landing keeps the popped stack (it DID fall back one level)
 * and answers the same one sentence, so another step up still works.
 */
export async function ascendExplorer(
  view: ExplorerView,
  folder: string,
  io: ExplorerIo,
): Promise<ExplorerView> {
  if (view.segments.length === 0) return view;
  const segments = view.segments.slice(0, -1);
  try {
    const entries = await io.listDirEntries(explorerLevelPath(folder, segments));
    return { segments, entries, problem: null };
  } catch {
    return { segments, entries: [], problem: EXPLORER_UNREACHABLE };
  }
}

/**
 * DOUBLE-CLICK ON A FILE ROW: the exact joined path goes to the system's
 * default handler through the ONE outward door, and a refusal (outside the
 * capability's scope, or no handler on this box) answers the existing "cannot
 * open" sentence. It writes nothing, logs nothing and remembers nothing; the
 * caller states the sentence in the explorer's own line. Directories never
 * come here — `rowAction` sends them down a level instead.
 */
export async function openExplorerEntry(
  folder: string,
  segments: readonly string[],
  name: string,
  open: (path: string) => Promise<OutwardResult> = openFileOutward,
): Promise<OutwardResult> {
  return await open(explorerEntryPath(folder, segments, name));
}
