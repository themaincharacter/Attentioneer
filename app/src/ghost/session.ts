import { createWriteQueue } from "../lib/writeQueue";
import { marksPath, parseMarks } from "../map/marks";
import { applyGhost, GhostPinError } from "./apply";
import {
  extractAgentOutput,
  GHOST_FORMAT,
  isPlainObject,
  mintGhostId,
  readEnvelope,
  targetFromValue,
  withPacketHash,
  type GhostEnvelope,
  type GhostGame,
  type GhostMove,
  type GhostStep,
  type GhostTarget,
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
import { issue, type GhostIssue, type GhostIssueCode } from "./issues";
import { tauriGhostFs, type GhostFs } from "./port";
import { refusalFor, type GhostFlow } from "./refusal";
import {
  filesForValue,
  findMove,
  MOVES,
  pinOf,
  type MoveDefinition,
} from "./registry";
import { createRunState, runKeyOf, runPartsOf } from "./runState";
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
 * THE PACKET-HASH PROVENANCE (Epic 11 story 3) is attached HERE, after the
 * grammar has spoken: the intake files the validated envelope with
 * `withPacketHash` (the frozen packet the reply answers), and a reshape keeps
 * the same proposal's hash. Nothing reads it back — the accept re-validates
 * the bytes and the key is allowed but never inspected.
 *
 * THE RUN STATE (Epic 14 story 1, ADR-0031) is the session's ephemeral trace:
 * every REFUSED intake that named a readable move and target records one
 * attempt per refusal code in `createRunState` (in memory only), and
 * `open()` discards it with the inbox — the ghost session's open moment IS the
 * task. The session exposes the run's PRIOR REFUSAL SENTENCES for one move and
 * target (`priorRefusals`) so a packet's bounded run block can carry them, and
 * the attempt count (`runAttempts`) for the harness. Neither is rendered,
 * persisted or spoken: the counter is never a person-facing value (the source
 * scan asserts the surfaces' silence), and story 2's loud refusal reads it
 * (ghost/refusal.ts) without ever rendering the count.
 *
 * THE REFUSAL (Epic 14 story 2, ADR-0031) fires HERE, at the third same-key
 * failure (the run's `limitReached`): the intake returns ONE issue in the
 * app's vocabulary (`"stop"`), the flow's sentence, in place of the grammar's
 * sentence for that attempt (ghost/refusal.ts). The run kept the grammar's
 * words, so the packet's bounded run block still carries them. The refusal is
 * a REFUSAL: it writes nothing, it records no marker and it retires no
 * proposal; a later valid reply still lands (a run is not a lock).
 *
 * THE FLOW (PROVISIONAL) scopes the sentence: a session created for an AGENT
 * flow may say the assistant stops (an assistant is present in that flow); a
 * session created for the PASTE (or scripted) flow, the default, never names an
 * absent actor. No transport exists yet, so the app always opens the paste
 * flow; the agent flow is the harness seam a transport would use.
 *
 * THE MARK-READ (Epic 14 story 2, ADR-0031's final amendments): at the session's
 * open moment the session reads `map/marks.jsonl` ONCE through the port and
 * fixes the targets that carry an open mark in the run state. A marked target's
 * refusal stands down for the whole run (the mark is READ as "the person has
 * spoken here" — never rendered, never a switch, never a second meaning for the
 * mark; ADR-0009 stands untouched). The read is fixed at the start: a mark cast
 * mid-run is not seen, and a withdrawn mark still stands — and never resets the
 * counter, which lives until the session closes. Loops are exempt (no mark can
 * sit on a loop). A failed mark read means no marks: the refusal stands (a guess
 * is never a stand-down). The session only reads marks, never writes one.
 *
 * Provisional: the session's shape (the UI wiring is story 3's), the fact
 * that a level/branch switch is passed per call rather than held, the
 * intake's optional `packetHash` argument, the flow's two names, the
 * sentence's wording, and the run state's home and accessor names.
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
  /**
   * STORY 21.1 — THE MOVE TABLE this session's intake and accept read. The
   * app leaves it out (the live registry, one move); the command card's
   * headless host passes the ground rows its acts speak, so the SAME intake,
   * grammar and accept run for a script. A table is DATA: it never registers a
   * move in the app, and a session that is handed one still refuses anything
   * the table does not carry.
   */
  moves?: readonly MoveDefinition[];
  /**
   * How replies reach this session (PROVISIONAL, Epic 14 story 2): `"agent"`
   * when an assistant answers through the harness, `"paste"` when the person
   * pastes a reply. It scopes the refusal's sentence only — an agent flow may
   * say the assistant stops; a paste (or scripted) flow never names an absent
   * actor. Defaults to paste: no transport exists yet, so the app's session is
   * always the paste flow, and the agent flow is the seam a transport will use.
   */
  flow?: GhostFlow;
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
  /**
   * THE RUN'S PRIOR REFUSAL SENTENCES (Epic 14 story 1, ADR-0031): what this
   * session's refused intakes already said for one move and target, deduped by
   * refusal key, in arrival order, at most N (ADR-0031's bound). Empty until
   * an intake fails, and empty again after `open()` (the run is the open
   * moment). The packet's bounded run block is handed these sentences; no
   * surface renders them on its own.
   */
  priorRefusals(move: GhostMove, target: GhostTarget): readonly string[];
  /**
   * How many attempts the run has at one refusal key (move, target, issue
   * code) — the harness's read of the counter. The person cannot see it: no
   * surface renders it and nothing persists it; the count lives in
   * `runState.ts`'s closure only.
   */
  runAttempts(
    move: GhostMove,
    target: GhostTarget,
    code: GhostIssueCode,
  ): number;
  /**
   * The open moment: discard the inbox (replay refused), forget ids, discard
   * the run state and read the map's marks ONCE (the refusal's stand-down —
   * story 2). The ghost session's open moment IS the task (ADR-0031), so
   * nothing from the previous open survives; the mark reading is this run's
   * alone and is never re-read.
   */
  open(): Promise<DiscardReport>;
  /**
   * Paste/import raw model output -> wrap -> validate -> inbox.
   *
   * `packetHash` is the frozen packet's hash when the reply answers an ask the
   * person made (Epic 11 story 3). The app passes it; the agent never does
   * (the body has no such key), and it is attached to the filed envelope as
   * PROVENANCE ONLY — the grammar never reads it and no accept can refuse on
   * its account.
   *
   * A refused intake that reaches the run's bound returns the refusal issue
   * instead of the grammar's sentence (story 2's loud stop); a refusal on a
   * target marked at run start returns the grammar's sentence and no refusal.
   */
  intake(
    raw: string,
    context: GhostContext,
    packetHash?: string | null,
  ): Promise<IntakeResult>;
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
  // THE FLOW (Epic 14 story 2, PROVISIONAL): the session's one flow, fixed at
  // construction. It scopes the refusal's sentence; it changes nothing else.
  const flow: GhostFlow = options.flow ?? "paste";
  // STORY 21.1: the move table, fixed at construction (see the option's note).
  const moves = options.moves ?? MOVES;
  const queue = createWriteQueue();
  const registeredIds = new Set<string>();
  // THE RUN STATE (Epic 14 story 1, ADR-0031): the session's ephemeral trace,
  // discarded at open() with the inbox. In memory only; runState.ts has no
  // writer, no port and no storage import.
  const run = createRunState();

  /**
   * THE MARK-READ (Epic 14 story 2, ADR-0031): the targets that carry an open
   * mark NOW, as ghost targets, read once at the run's start through the port.
   * A word, a link or a bare spot can be a ghost target; a wire or a pointer
   * mark names a record no ghost move targets, so it is not a stand-down. The
   * mark line is trusted as it stands (an orphan mark is still the person's own
   * record; the run never repairs or grades it). A failed read is NO marks: the
   * refusal stands, because a stand-down is the person's act, never a guess.
   * This function only reads; the session never writes a mark.
   */
  async function markedTargetsNow(): Promise<GhostTarget[]> {
    let text: string | null = null;
    try {
      text = await fs.readText(marksPath(workspacePath));
    } catch {
      return [];
    }
    if (text === null) return [];
    const targets: GhostTarget[] = [];
    for (const mark of parseMarks(text).marks) {
      const target = mark.target;
      if (target.type === "word") {
        targets.push({ kind: "word", slug: target.slug });
      } else if (target.type === "link") {
        targets.push({ kind: "link", from: target.from, to: target.to });
      } else if (target.type === "spot") {
        targets.push({ kind: "spot", x: target.x, y: target.y });
      }
      // A wire mark and a pointer mark name no ghost target: they cannot stand
      // a refusal down, and a loop has no mark form at all.
    }
    return targets;
  }

  async function intakeInner(
    raw: string,
    context: GhostContext,
    packetHash: string | null | undefined,
  ): Promise<IntakeResult> {
    /**
     * Record the refusal as a run attempt when the reply named a readable move
     * and target (ADR-0031's run key), then speak the story-2 refusal when the
     * run reached its bound. A reply with no readable parts has no key to count:
     * it is refused exactly as before. The refusal REPLACES the grammar's
     * sentence for this attempt (the grammar already said it before; the packet
     * carries the prior sentences) and stands down when the target carried an
     * open mark at run start. The run's own record keeps the grammar's words.
     */
    const refused = (
      issues: readonly GhostIssue[],
      body?: unknown,
    ): IntakeResult => {
      const parts = body === undefined ? null : runPartsOf(body);
      if (parts === null) {
        return { ok: false, envelope: null, path: null, issues };
      }
      const record = run.recordRefusedAttempt({
        move: parts.move,
        target: parts.target,
        issues,
      });
      const refusal = refusalFor(
        record,
        flow,
        run.markedAtStart(parts.target),
      );
      return {
        ok: false,
        envelope: null,
        path: null,
        issues: refusal === null ? issues : [refusal],
      };
    };

    const extracted = extractAgentOutput(raw);
    if (extracted.body === null) {
      return refused(extracted.problems.map((problem) => issue("intake", problem)));
    }
    const bodyIssues = agentBodyIssues(extracted.body);
    if (bodyIssues.length > 0) return refused(bodyIssues, extracted.body);

    const entry = findMove(extracted.body.move, moves);
    const targetShape = targetFromValue(extracted.body.target);
    const snapshot = await readGhostSnapshot(fs, workspacePath, {
      level: context.level,
      scenario: context.scenario,
      files: entry ? filesForValue(entry, extracted.body.target) : [],
    });
    const candidate: Record<string, unknown> = {
      format: GHOST_FORMAT,
      id: mintId(),
      move: extracted.body.move,
      target: extracted.body.target,
      params: canonicalParams(extracted.body.params),
      expect: entry && targetShape
        ? pinOf(snapshot, entry, targetShape)
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
    const validation = validateGhost(candidate, snapshot, moves);
    if (!validation.ok || validation.envelope === null) {
      return refused(validation.issues, extracted.body);
    }
    if (validation.applied) {
      return refused(
        [issue("append-only", "the file already holds this claim; v1 only appends")],
        extracted.body,
      );
    }
    // THE PACKET-HASH PROVENANCE (Epic 11 story 3): attached AFTER the grammar
    // spoke. The hash names the frozen packet this reply answers; the filed
    // envelope carries it so the ask is visible later, and nothing downstream
    // reads it (accept, pin and grammar all ignore the key).
    const envelope = withPacketHash(validation.envelope, packetHash);
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

    const entry = findMove(read.value.move, moves);
    const snapshot = await readGhostSnapshot(fs, workspacePath, {
      level: context.level,
      scenario: context.scenario,
      files: entry ? filesForValue(entry, read.value.target) : [],
    });
    const validation = validateGhost(read.value, snapshot, moves);
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

    const entry = findMove(read.value.move, moves);
    const snapshot = await readGhostSnapshot(fs, workspacePath, {
      level: context.level,
      scenario: context.scenario,
      files: entry ? filesForValue(entry, read.value.target) : [],
    });
    const validation = validateGhost(
      { ...read.value, params: canonicalParams(params) },
      snapshot,
      moves,
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
    // The re-filed envelope keeps the ask it already answered: the reshape's
    // own five fields stay in flight (ADR-0024 decision 5), and the intake's
    // packet hash rides the SAME proposal it was minted for.
    const envelope = withPacketHash(validation.envelope, read.value.packetHash);
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

    priorRefusals(move, target) {
      return run.sentencesForTarget(move, target);
    },

    runAttempts(move, target, code) {
      return run.attemptsFor(runKeyOf(move, target, code));
    },

    async open() {
      const report = await discardInbox(workspacePath, fs);
      registeredIds.clear();
      // The run is the open moment: closing it discards every attempt and its
      // refusal sentence. Nothing was ever written, so there is nothing to undo.
      run.discard();
      // THE MARK-READ (Epic 14 story 2): the marks read HERE, once, are the
      // run's fixed stand-down. A mark cast later is never seen; a mark
      // withdrawn later still stands — and never resets the counter, which is
      // this run's alone.
      run.start(await markedTargetsNow());
      return report;
    },

    async intake(raw, context, packetHash) {
      let result: IntakeResult = {
        ok: false,
        envelope: null,
        path: null,
        issues: [issue("write", "the intake did not run")],
      };
      await queue.push(async () => {
        result = await intakeInner(raw, context, packetHash);
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
