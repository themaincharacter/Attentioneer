import { createWriteQueue } from "../lib/writeQueue";
import { applyGhost, GhostPinError } from "./apply";
import {
  extractAgentOutput,
  GHOST_FORMAT,
  isPlainObject,
  mintGhostId,
  readEnvelope,
  type GhostEnvelope,
  type GhostGame,
  type GhostStep,
} from "./envelope";
import { agentBodyIssues, validateGhost } from "./grammar";
import {
  claimInboxMarker,
  discardInbox,
  inboxEnvelopePath,
  readInboxEnvelope,
  releaseInboxMarker,
  removeInboxEnvelope,
  writeInboxEnvelope,
  type DiscardReport,
} from "./inbox";
import { issue, type GhostIssue } from "./issues";
import { tauriGhostFs, type GhostFs } from "./port";
import { findMove, pinOf } from "./registry";
import { readGhostSnapshot } from "./snapshot";

/**
 * The ghost session (Epic 10 story 1, ADR-0024 decisions 5 and 3) — the
 * app-owned half of the machinery: intake, the inbox, and the accept order
 * (marker -> apply -> delete).
 *
 * One session is one open moment. Its app-minted ids are IN-SESSION ONLY:
 * `open()` discards the whole inbox (envelopes and markers), so a ghost left by
 * an earlier session is refused by replay and a marker is never resumed. Only
 * ids this session minted accept — an envelope hand-placed in the inbox with a
 * different id is not a ghost the app knows.
 *
 * The crash story, in the accept:
 *   - the marker is created EXCLUSIVELY and means "in flight" only; it is never
 *     a lock and is never resumed;
 *   - a marker that already exists is released and re-claimed (a stale marker
 *     never blocks an accept);
 *   - a ghost whose file already holds the derived bytes (and whose base before
 *     the appended line hashes to the pin) is APPLIED-BUT-UNMARKED: the accept
 *     deletes it without writing again (the grammar's reconcile, keyed on the
 *     in-session id's envelope);
 *   - a failed accept releases the marker and leaves the envelope for the
 *     person to reject.
 *
 * The accept and the intake run through ONE in-order write queue, the app's
 * write-queue idiom: a burst of accepts can never read a stale file and
 * overwrite a line that landed before it. The grammar itself is pure; the
 * session is where its two impure halves (the snapshot read and the write)
 * live.
 *
 * Provisional: the session's shape (the UI wiring is story 3's) and the fact
 * that a level/branch switch is passed per call rather than held.
 */

/** The app's running context at an intake/accept moment. */
export interface GhostContext {
  /** The game/band running now (ADR-0018: the zoom band is the game). */
  level: GhostGame;
  /** The active branch, or null for the committed map. */
  scenario: string | null;
}

/** The session's construction: the workspace and the two injectable seams. */
export interface GhostSessionOptions {
  /** The workspace root (absolute, as the app holds it). */
  workspacePath: string;
  /** The fs port; defaults to the Tauri bridge. */
  fs?: GhostFs;
  /** The id minter; defaults to the app's UUID mint (tests inject one). */
  mintId?: () => string;
}

/** What an intake produced. */
export interface IntakeResult {
  /** The ghost was wrapped, validated and filed in the inbox. */
  ok: boolean;
  /** The envelope (with the app-minted id, pin and derived steps). */
  envelope: GhostEnvelope | null;
  /** The inbox file's absolute path, when filed. */
  path: string | null;
  /** Why it was refused. */
  issues: readonly GhostIssue[];
}

/** What an accept did. */
export type GhostAcceptResult =
  | {
      outcome: "applied";
      id: string;
      envelope: GhostEnvelope;
      steps: readonly GhostStep[];
    }
  | { outcome: "already-applied"; id: string; envelope: GhostEnvelope }
  | { outcome: "refused"; id: string; issues: readonly GhostIssue[] }
  | { outcome: "not-registered"; id: string }
  | { outcome: "missing"; id: string };

/**
 * What a reshape did (Epic 10 story 3): the re-validated envelope with the
 * DERIVED steps, filed back into the inbox under the same in-session id. The
 * person's reason is not here — it is in flight only (reshape.ts), never a
 * value the session writes.
 */
export type GhostReshapeResult =
  | {
      outcome: "reshaped";
      id: string;
      envelope: GhostEnvelope;
      steps: readonly GhostStep[];
    }
  | { outcome: "refused"; id: string; issues: readonly GhostIssue[] }
  | { outcome: "not-registered"; id: string }
  | { outcome: "missing"; id: string };

/** The app's handle on one open moment's ghosts. */
export interface GhostSession {
  /** The workspace root this session works in. */
  readonly workspacePath: string;
  /** The ids this session minted, in arrival order. */
  registered(): readonly string[];
  /** The open moment: discard the inbox (replay refused) and forget ids. */
  open(): Promise<DiscardReport>;
  /** Paste/import raw model output -> wrap -> validate -> inbox. */
  intake(raw: string, context: GhostContext): Promise<IntakeResult>;
  /** Accept one registered ghost: marker -> apply -> delete. */
  accept(id: string, context: GhostContext): Promise<GhostAcceptResult>;
  /**
   * Reshape one registered ghost: the NEW params re-validate against the bytes
   * on disk (the same grammar as the accept) and the re-derived envelope is
   * filed back into the inbox under the same id. The steps are the deriver's
   * again; a stored list is never read. Nothing else is written, and the
   * person's reason never reaches this call.
   */
  reshape(
    id: string,
    params: Record<string, unknown>,
    context: GhostContext,
  ): Promise<GhostReshapeResult>;
  /** Reject one registered ghost: delete it (and any marker) quietly. */
  reject(id: string): Promise<boolean>;
}

/**
 * The wrap canonicalizes the authored prose: a string `params.text` has its
 * edge whitespace trimmed, so the envelope says EXACTLY what the record will
 * hold (the grammar then refuses a hand-edited envelope whose text is padded).
 * This is a formatting canonicalization, never an authorship change: every
 * other key rides through untouched, unknown keys included, so the grammar
 * still refuses them.
 */
function canonicalParams(value: unknown): unknown {
  if (!isPlainObject(value)) return value;
  if (typeof value.text !== "string") return value;
  return { ...value, text: value.text.trim() };
}

/**
 * Open a ghost session over a workspace. Nothing is discarded until `open()`
 * is called, so the app chooses the open moment explicitly (and tests can
 * plant leftovers first).
 */
export function createGhostSession(options: GhostSessionOptions): GhostSession {
  const workspacePath = options.workspacePath;
  const fs = options.fs ?? tauriGhostFs;
  const mintId = options.mintId ?? mintGhostId;
  const queue = createWriteQueue();
  const registeredIds = new Set<string>();

  async function intakeInner(
    raw: string,
    context: GhostContext,
  ): Promise<IntakeResult> {
    const refused = (issues: readonly GhostIssue[]): IntakeResult => ({
      ok: false,
      envelope: null,
      path: null,
      issues,
    });

    const extracted = extractAgentOutput(raw);
    if (extracted.body === null) {
      return refused(extracted.problems.map((problem) => issue("intake", problem)));
    }
    const bodyIssues = agentBodyIssues(extracted.body);
    if (bodyIssues.length > 0) return refused(bodyIssues);

    const entry = findMove(extracted.body.move);
    const snapshot = await readGhostSnapshot(fs, workspacePath, {
      level: context.level,
      scenario: context.scenario,
      files: entry?.files ?? [],
    });
    const candidate: Record<string, unknown> = {
      format: GHOST_FORMAT,
      id: mintId(),
      move: extracted.body.move,
      target: extracted.body.target,
      params: canonicalParams(extracted.body.params),
      expect: entry
        ? pinOf(snapshot, entry)
        : {
            dir: snapshot.dir,
            files: {},
            level: snapshot.level,
            game: snapshot.level,
          },
      rationale: extracted.body.rationale ?? extracted.prose,
      steps: [],
      proposals: [],
    };
    const validation = validateGhost(candidate, snapshot);
    if (!validation.ok || validation.envelope === null) {
      return refused(validation.issues);
    }
    if (validation.applied) {
      return refused([
        issue("append-only", "the file already holds this claim; v1 only appends"),
      ]);
    }
    const envelope = validation.envelope;
    const path = await writeInboxEnvelope(workspacePath, envelope, fs);
    registeredIds.add(envelope.id);
    return { ok: true, envelope, path, issues: [] };
  }

  async function acceptInner(
    id: string,
    context: GhostContext,
  ): Promise<GhostAcceptResult> {
    if (!registeredIds.has(id)) return { outcome: "not-registered", id };
    const text = await readInboxEnvelope(workspacePath, id, fs);
    if (text === null) return { outcome: "missing", id };

    const released = async (): Promise<void> => {
      // A marker is in-flight only: whatever happened, a refused accept leaves
      // no marker behind, so a stale one can never block the next attempt.
      await releaseInboxMarker(workspacePath, id, fs);
    };

    const read = readEnvelope(text);
    if (read.value === null) {
      await released();
      return {
        outcome: "refused",
        id,
        issues: read.problems.map((problem) => issue("format", problem)),
      };
    }
    if (read.value.id !== id) {
      await released();
      return {
        outcome: "refused",
        id,
        issues: [
          issue(
            "id",
            `the file was filed under "${id}" but its envelope carries another id`,
          ),
        ],
      };
    }

    const entry = findMove(read.value.move);
    const snapshot = await readGhostSnapshot(fs, workspacePath, {
      level: context.level,
      scenario: context.scenario,
      files: entry?.files ?? [],
    });
    const validation = validateGhost(read.value, snapshot);
    if (!validation.ok || validation.envelope === null) {
      await released();
      return { outcome: "refused", id, issues: validation.issues };
    }

    // Applied but unmarked: the write landed and the marker (if any) is just a
    // leftover. Delete both, write nothing.
    if (validation.applied) {
      await released();
      await removeInboxEnvelope(workspacePath, id, fs);
      registeredIds.delete(id);
      return {
        outcome: "already-applied",
        id,
        envelope: validation.envelope,
      };
    }

    // The marker lands BEFORE the write. An existing marker is stale (never a
    // lock): release it and claim a fresh one.
    let claimed = await claimInboxMarker(workspacePath, id, fs);
    if (!claimed) {
      await released();
      claimed = await claimInboxMarker(workspacePath, id, fs);
    }
    if (!claimed) {
      await released();
      return {
        outcome: "refused",
        id,
        issues: [issue("write", "could not claim the accept marker")],
      };
    }

    const run = validation.run;
    if (run === null) {
      await released();
      return {
        outcome: "refused",
        id,
        issues: [issue("shape", "the validated ghost carried no dry run")],
      };
    }
    try {
      await applyGhost(workspacePath, run, fs);
    } catch (error) {
      await released();
      if (error instanceof GhostPinError) {
        return { outcome: "refused", id, issues: [issue("pin", error.message)] };
      }
      return {
        outcome: "refused",
        id,
        issues: [issue("write", `cannot write: ${String(error)}`)],
      };
    }
    await released();
    await removeInboxEnvelope(workspacePath, id, fs);
    registeredIds.delete(id);
    return {
      outcome: "applied",
      id,
      envelope: validation.envelope,
      steps: run.steps,
    };
  }

  async function reshapeInner(
    id: string,
    params: Record<string, unknown>,
    context: GhostContext,
  ): Promise<GhostReshapeResult> {
    if (!registeredIds.has(id)) return { outcome: "not-registered", id };
    const text = await readInboxEnvelope(workspacePath, id, fs);
    if (text === null) return { outcome: "missing", id };

    const read = readEnvelope(text);
    if (read.value === null) {
      return {
        outcome: "refused",
        id,
        issues: read.problems.map((problem) => issue("format", problem)),
      };
    }
    if (read.value.id !== id) {
      return {
        outcome: "refused",
        id,
        issues: [
          issue(
            "id",
            `the file was filed under "${id}" but its envelope carries another id`,
          ),
        ],
      };
    }

    const entry = findMove(read.value.move);
    const snapshot = await readGhostSnapshot(fs, workspacePath, {
      level: context.level,
      scenario: context.scenario,
      files: entry?.files ?? [],
    });
    const validation = validateGhost(
      { ...read.value, params: canonicalParams(params) },
      snapshot,
    );
    if (!validation.ok || validation.envelope === null) {
      return { outcome: "refused", id, issues: validation.issues };
    }
    // The reshaped claim already stands on the target: the append-only move has
    // nothing to add, so the reshape is refused rather than pretending to move.
    if (validation.applied) {
      return {
        outcome: "refused",
        id,
        issues: [
          issue(
            "append-only",
            "the claim this reshaping would state already stands on that target; v1 only appends",
          ),
        ],
      };
    }
    const envelope = validation.envelope;
    await writeInboxEnvelope(workspacePath, envelope, fs);
    return {
      outcome: "reshaped",
      id,
      envelope,
      steps: validation.run?.steps ?? envelope.steps,
    };
  }

  return {
    workspacePath,

    registered() {
      return [...registeredIds];
    },

    async open() {
      const report = await discardInbox(workspacePath, fs);
      registeredIds.clear();
      return report;
    },

    async intake(raw, context) {
      let result: IntakeResult = {
        ok: false,
        envelope: null,
        path: null,
        issues: [issue("write", "the intake did not run")],
      };
      await queue.push(async () => {
        result = await intakeInner(raw, context);
      });
      return result;
    },

    async accept(id, context) {
      let result: GhostAcceptResult = { outcome: "missing", id };
      await queue.push(async () => {
        result = await acceptInner(id, context);
      });
      return result;
    },

    async reshape(id, params, context) {
      let result: GhostReshapeResult = { outcome: "missing", id };
      await queue.push(async () => {
        result = await reshapeInner(id, params, context);
      });
      return result;
    },

    async reject(id) {
      if (!registeredIds.has(id)) return false;
      await releaseInboxMarker(workspacePath, id, fs);
      await removeInboxEnvelope(workspacePath, id, fs);
      registeredIds.delete(id);
      return true;
    },
  };
}

/** The inbox's envelope path for a session id (a test/UI convenience). */
export function ghostFilePath(workspacePath: string, id: string): string {
  return inboxEnvelopePath(workspacePath, id);
}
