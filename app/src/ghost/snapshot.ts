import { loopSlug, loopsPath, parseLoops } from "../map/loops";
import { modelPath, parseModel } from "../map/model";
import { recordsDirOf, recordsRelDirOf } from "../map/records";
import { referencesDir } from "../map/refs";
import type { GhostGame } from "./envelope";
import type { GhostFs } from "./port";

/**
 * The in-memory snapshot the grammar dry-applies a ghost to (Epic 10 story 1,
 * ADR-0025 decision 1).
 *
 * A ghost's closure is proved by APPLYING its derived steps to this snapshot —
 * the derived list alone proves nothing — and its base pin is proved against
 * the bytes here (the files actually on disk at the accept moment). The
 * snapshot is read ONCE per intake/accept through the ghost's fs port, so the
 * grammar itself is pure: same envelope + same snapshot = same verdict.
 *
 * What a move needs: the map's word slugs (the targets a claim may name), the
 * loop slugs (a loop target), the records folder at the time
 * (`recordsRelDirOf`), the ACCEPTED PLAYING SET that folder holds (a dynamics
 * move is refused without one — ADR-0025 decision 3) and the bytes of every
 * file the registry move writes. `files` is keyed by the same workspace-
 * relative paths the envelope's pin uses.
 */
export interface GhostSnapshot {
  /** The game/band running now. */
  level: GhostGame;
  /** The active branch, or null for the committed map. */
  scenario: string | null;
  /** The records folder, workspace-relative (`map` or `scenarios/<slug>`). */
  dir: string;
  /**
   * The accepted playing set's member slugs (ADR-0013), or null when no set is
   * accepted. Absence is the record's absence: a missing or unreadable
   * `model.json` means no set. The dynamics game authors only behind one
   * (ADR-0025 decision 3), so the grammar refuses a dynamics move whenever this
   * is null; an accepted EMPTY set is still an accepted set.
   */
  playing: readonly string[] | null;
  /** Every reference slug on the map. */
  words: ReadonlySet<string>;
  /** Every loop slug (name-derived) on the map. */
  loops: ReadonlySet<string>;
  /** Workspace-relative path → the file's bytes (null = absent). */
  files: Readonly<Record<string, string | null>>;
}

/** What to read for a snapshot: the context and the move's files. */
export interface SnapshotRequest {
  /** The game/band running now (the app's level). */
  level: GhostGame;
  /** The active branch, or null. */
  scenario: string | null;
  /** The workspace-relative files the move writes (the registry entry's). */
  files: readonly string[];
}

/**
 * Read the snapshot through the port. Pure apart from the reads: the word slugs
 * are the reference file slugs (identity is the file, ADR-0005), the loop slugs
 * are the names' keys (ADR-0012), and each requested file is its bytes or null.
 * A workspace with no references folder and no loops file reads as an empty
 * map, exactly as the app reads them.
 */
export async function readGhostSnapshot(
  fs: GhostFs,
  workspacePath: string,
  request: SnapshotRequest,
): Promise<GhostSnapshot> {
  const names = await fs.list(referencesDir(workspacePath));
  const loopsText = await fs.readText(loopsPath(workspacePath));
  // The accepted playing set is the records folder's own `model.json` (ADR-0013):
  // read through the same port as the rest, so the accept sees the set on disk
  // at the write moment, not a memory that may have moved.
  const playingText = await fs.readText(
    modelPath(recordsDirOf(workspacePath, request.scenario)),
  );
  const playing = parseModel(playingText).model?.words ?? null;
  const fileTexts: Array<string | null> = [];
  for (const file of request.files) {
    fileTexts.push(await fs.readText(`${workspacePath}/${file}`));
  }
  const words = new Set(
    names
      .filter((name) => name.endsWith(".md"))
      .map((name) => name.slice(0, -3)),
  );
  const loops = new Set(
    parseLoops(loopsText ?? "").loops.map((loop) => loopSlug(loop.name)),
  );
  const files: Record<string, string | null> = {};
  request.files.forEach((file, index) => {
    files[file] = fileTexts[index] ?? null;
  });
  return {
    level: request.level,
    scenario: request.scenario,
    dir: recordsRelDirOf(request.scenario),
    playing,
    words,
    loops,
    files,
  };
}
