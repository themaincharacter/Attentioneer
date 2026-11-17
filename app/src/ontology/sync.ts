import type { Box } from "../canvas/geometry";
import { DEFAULT_BOX } from "../canvas/geometry";
import type { ShapeWire } from "../canvas/languageGameRules";
import { createDirAll, listDir, readTextFile, removeFile } from "../lib/fs";
import { parseYamlFields, writeMachineFile } from "../lib/serialize";
import { parseDistances } from "../map/distances";
import { parseLanguageGames } from "../map/languageGames";
import { parseReference } from "../map/refs";
import { DEFAULT_SHELF_X, shelfXOf } from "../map/shelf";
import type { DerivedGameOntology, OntologyGame, OntologyWord } from "./derive";
import { deriveGameOntology } from "./derive";
import { encodeGameFileName, ontologyDir, ontologyFilePath } from "./filename";
import { ONTOLOGY_FORMAT, renderGameOntology } from "./render";

/**
 * THE PER-GAME ONTOLOGY EXPORT — THE SYNC (PROVISIONAL, added 2026-11-16 per
 * ADR-0033 and notes/ontology-language-games-research.md §5.3).
 *
 * `syncOntology` makes the workspace's `ontology/` folder agree with the map's
 * records: every game's file is RENDERED AGAIN and written only when its bytes
 * changed, and any file in the folder that is not a current game's is swept
 * under the marker guard. There is no incremental bookkeeping — the game list
 * is few records, so rebuilding ALL games is cheaper than every drift bug a
 * ledger could carry, and it is the only way the "delete everything, rebuild,
 * identical bytes" test can hold.
 *
 * WHEN it runs (the caller's job, §5.3): after any map write that can change a
 * game's content — game create/delete, word add/move/rename/delete, wire
 * coin/recoin/delete — and once on workspace open. No watcher, no timer and no
 * cache lives here; every call is a fresh derivation from records that are
 * already in hand.
 *
 * THE MAP IS THE ONLY SOURCE. The artifact is never read back as input: this
 * module reads the RECORDS (or takes them as a snapshot) and reads the folder
 * only to sweep it. Deleting every generated file and calling again restores
 * the same bytes, because the derivation is pure (derive.ts) and the renderer
 * is deterministic (render.ts).
 *
 * DELETION RULE (§5.3): a file leaves only when its format marker is OURS
 * (`format: "attentioneer-ontology/1"`). Anything else — a hand-written note, an
 * older tool's file, a file whose marker says something else — is LEFT WHERE IT
 * IS and named in a notice (the family's posture: never silently drop what we
 * did not write). Orphan files (ours, but describing a game that is gone or was
 * renamed) are swept under the same rule.
 *
 * THE FOLDER needs no scaffold: it is created on the first generation. The
 * filesystem arrives as a port (`OntologyFs`) so the whole rebuild-and-sweep
 * rule is testable against an in-memory folder, and the records may arrive as a
 * SNAPSHOT — what the app already holds, including its measured word boxes —
 * so a sync never races a write still in flight and never needs a second read
 * of the map.
 *
 * Provisional: the folder's placement under the workspace root (ADR-0033's
 * amendment of ADR-0004), the five frontmatter lines and the notice's wording.
 */

/**
 * The notice a file the app did not write gets: it is left alone and named in
 * the strip. One quiet clause, the family's shape — never a warning, never a
 * count.
 */
export const ONTOLOGY_FOREIGN_NOTICE = "not the app's file, left alone — ontology/";

/** The filesystem port this module needs: five calls, no watchers, no metadata. */
export interface OntologyFs {
  createDirAll(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
  removeFile(path: string): Promise<void>;
}

/**
 * The app's port: the Tauri bridge, untouched and unscoped (the workspace's own
 * folder). Writes go through serialize.ts's one machine-file door, so the
 * canonical-bytes discipline holds even though the renderer already returns
 * canonical bytes.
 */
export const tauriOntologyFs: OntologyFs = {
  createDirAll,
  listDir,
  readTextFile,
  writeTextFile: writeMachineFile,
  removeFile,
};

/** The map records a sync derives from, as the app already holds them. */
export interface OntologySnapshot {
  /** Every coined word, in map order (a draft without a slug is not a word). */
  words: readonly OntologyWord[];
  /** Every distance record, in file order. */
  wires: readonly ShapeWire[];
  /** Every language game, in file order. */
  games: readonly OntologyGame[];
  /** The workspace's fold (`workspace.yml`'s `shelf_x`, defaulted). */
  shelfX: number;
}

export interface SyncOntologyOptions {
  /** The filesystem (tests hand in an in-memory folder). */
  fs?: OntologyFs;
  /**
   * The records, when the caller already holds them. Omitted, they are read
   * from the workspace through `fs` — a missing file is an empty record.
   */
  snapshot?: OntologySnapshot;
  /** Measured word boxes for the read-from-disk path (the app passes a snapshot instead). */
  boxes?: Readonly<Record<string, Box>>;
}

/** What one sync did: the game files written, the files swept, the files left and named. */
export interface SyncOntologyResult {
  /** Absolute paths written this call (unchanged bytes are not a write). */
  written: string[];
  /** Absolute paths removed under the marker guard. */
  removed: string[];
  /** Quiet clauses for the files left alone (the strip renders them). */
  notices: string[];
}

/** The artifact's frontmatter, tolerantly read (a BOM and CRLF from a hand edit are fine). */
const FRONTMATTER = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

/**
 * Is this file one of ours? The format marker in its flat frontmatter is the
 * one deletion guard: only a file that says it is an
 * `attentioneer-ontology/1` artifact may be swept.
 */
export function isOurOntology(text: string): boolean {
  const match = FRONTMATTER.exec(text);
  if (match === null) return false;
  return parseYamlFields(match[1]).format === ONTOLOGY_FORMAT;
}

/** The workspace's fold, read tolerantly (a missing or unreadable file means the default). */
async function readShelfX(fs: OntologyFs, workspacePath: string): Promise<number> {
  const text = await fs.readTextFile(workspacePath + "/workspace.yml");
  if (text === null) return DEFAULT_SHELF_X;
  return shelfXOf(parseYamlFields(text));
}

/**
 * The map records as the file layer holds them: the games, the wires and every
 * reference file (its slug is its file name, its name is the person's coin).
 * A word's box is the caller's measurement when it has one, else the canvas's
 * own fallback box — the same `DEFAULT_BOX` reading the app uses before a word is
 * measured.
 */
async function readSnapshot(
  fs: OntologyFs,
  workspacePath: string,
  boxes: Readonly<Record<string, Box>>,
): Promise<OntologySnapshot> {
  const gamesText = await fs.readTextFile(workspacePath + "/map/language-games.jsonl");
  const games: OntologyGame[] = gamesText === null
    ? []
    : parseLanguageGames(gamesText).games.map((game) => ({
        name: game.name,
        shape: game.shape,
      }));

  const distancesText = await fs.readTextFile(workspacePath + "/map/distances.jsonl");
  const wires: ShapeWire[] = distancesText === null
    ? []
    : parseDistances(distancesText).distances.map((distance) => ({
        from: distance.from,
        to: distance.to,
        word: distance.word,
      }));

  const words: OntologyWord[] = [];
  for (const entry of await fs.listDir(workspacePath + "/map/references")) {
    if (!entry.endsWith(".md")) continue;
    const slug = entry.slice(0, -".md".length);
    const text = await fs.readTextFile(workspacePath + "/map/references/" + entry);
    if (text === null) continue;
    const reference = parseReference(slug, slug, text);
    words.push({
      slug,
      name: reference.name,
      pos: { x: reference.x, y: reference.y },
      box: boxes[slug] ?? DEFAULT_BOX,
    });
  }

  return { words, wires, games, shelfX: await readShelfX(fs, workspacePath) };
}

/**
 * Rebuild every game's artifact and sweep the folder. The one entry point the
 * app calls, after a map write or on open; the records are the only input and
 * nothing here reads the artifact as data.
 *
 * Returns what changed so the app can surface the files it left alone; the
 * write itself is quiet (the family's posture — no confirmation, no history).
 */
export async function syncOntology(
  workspacePath: string,
  options: SyncOntologyOptions = {},
): Promise<SyncOntologyResult> {
  const fs = options.fs ?? tauriOntologyFs;
  const snapshot =
    options.snapshot ?? (await readSnapshot(fs, workspacePath, options.boxes ?? {}));
  const directory = ontologyDir(workspacePath);

  // Render every game first (pure), then touch the folder. File order is the
  // game list's order, so two syncs over the same records do the same writes
  // in the same sequence.
  const wanted = snapshot.games.map((game) => {
    const derived: DerivedGameOntology = deriveGameOntology(
      game,
      snapshot.words,
      snapshot.wires,
      snapshot.games,
      snapshot.shelfX,
    );
    return {
      path: ontologyFilePath(workspacePath, game.name),
      bytes: renderGameOntology(derived),
    };
  });

  const written: string[] = [];
  if (wanted.length > 0) {
    // The folder arrives with the first artifact — no scaffold entry needed.
    await fs.createDirAll(directory);
  }
  for (const file of wanted) {
    // Unchanged bytes are not rewritten: a sync after an unrelated write
    // leaves the file's mtime and its diff alone.
    if ((await fs.readTextFile(file.path)) === file.bytes) continue;
    await fs.writeTextFile(file.path, file.bytes);
    written.push(file.path);
  }

  // The sweep: every .md in the folder that is not a current game's file. Ours
  // leaves; anything else stays and is named. A missing folder lists as empty.
  const expected = new Set(wanted.map((file) => file.path));
  const removed: string[] = [];
  const notices: string[] = [];
  for (const entry of await fs.listDir(directory)) {
    if (!entry.endsWith(".md")) continue;
    const path = directory + "/" + entry;
    if (expected.has(path)) continue;
    const text = await fs.readTextFile(path);
    if (text !== null && isOurOntology(text)) {
      await fs.removeFile(path);
      removed.push(path);
    } else {
      notices.push(ONTOLOGY_FOREIGN_NOTICE + entry);
    }
  }

  return { written, removed, notices };
}

/** One game's artifact path — the filename rule, re-exported for callers and tests. */
export { encodeGameFileName, ontologyDir, ontologyFilePath };
