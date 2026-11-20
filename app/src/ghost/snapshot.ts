import { askTurnsDir, asksPath, parseAsks } from "../map/asks";
import { groundPath, parseGround } from "../map/ground";
import { loopSlug, loopsPath, parseLoops } from "../map/loops";
import { modelPath, parseModel } from "../map/model";
import { recordsDirOf, recordsRelDirOf } from "../map/records";
// STORY 21.11 — the session cards' line file and their transcripts' folder, read
// through the same port as everything else.
import {
  parseSessions,
  sessionTranscriptsDir,
  sessionsPath,
} from "../map/sessions";
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
  /**
   * STORY 21.1 — every GROUND reference's slug, the cards a command can be
   * about (a note) or point at (a wire). Absent on a snapshot built for the
   * concept or dynamics games; a card target then refuses rather than guess.
   */
  cards?: ReadonlySet<string>;
  /**
   * STORY 21.7 — every ASK CARD's slug: its `asks.txt` line, and the slug of
   * any conversation under `map/asks/` whose line is gone. The second half is
   * not a guess: the app's own delete shape takes the record line first and the
   * conversation after it, so the shape's second step must still resolve the
   * card it is about. An orphan conversation is that card's remains — the app
   * already reports it as an orphan and never repairs it. Absent on a snapshot
   * built for the concept or dynamics games; an ask target then refuses rather
   * than guess.
   */
  asks?: ReadonlySet<string>;
  /**
   * STORY 21.11 — every SESSION CARD's slug: its line, and the slug of any
   * transcript under `map/sessions/` whose line is gone. The second half is not
   * a guess for the same reason the ask's is not: the app's own delete shape
   * takes the record line first and the transcript after it, so the shape's
   * second step must still resolve the card it is about. Absent on a snapshot
   * built for the concept or dynamics games; a session target then refuses
   * rather than guess.
   */
  sessions?: ReadonlySet<string>;
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
  // STORY 21.1: the ground cards, read through the same port as everything
  // else — a proposal about an existing card is checked against the file the
  // accept will read, never against a remembered list.
  const groundText = await fs.readText(groundPath(workspacePath));
  // STORY 21.7: the ask cards, read through the same port — a proposal about an
  // ask card is checked against the record the accept will read. The folder
  // listing adds the conversations whose line is already gone (the app's own
  // delete shape's two steps, in its own order).
  const asksText = await fs.readText(asksPath(workspacePath));
  const askConversations = await fs.list(askTurnsDir(workspacePath));
  // STORY 21.11: the session cards and their transcripts, read the same way —
  // the record for the line, the listing for a transcript whose line is gone.
  const sessionsText = await fs.readText(sessionsPath(workspacePath));
  const sessionTranscripts = await fs.list(sessionTranscriptsDir(workspacePath));
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
  const asks = new Set<string>(
    parseAsks(asksText ?? "").asks.map((entry) => entry.on),
  );
  for (const name of askConversations) {
    if (name.endsWith(".jsonl") && name.length > ".jsonl".length) {
      asks.add(name.slice(0, -".jsonl".length));
    }
  }
  const sessions = new Set<string>(
    parseSessions(sessionsText ?? "").sessions.map((entry) => entry.on),
  );
  for (const name of sessionTranscripts) {
    if (name.endsWith(".jsonl") && name.length > ".jsonl".length) {
      sessions.add(name.slice(0, -".jsonl".length));
    }
  }
  return {
    level: request.level,
    scenario: request.scenario,
    dir: recordsRelDirOf(request.scenario),
    playing,
    words,
    loops,
    cards: new Set(parseGround(groundText ?? "").references.map((entry) => entry.on)),
    asks,
    sessions,
    files,
  };
}
