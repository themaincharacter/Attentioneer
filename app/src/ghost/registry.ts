import { canonicalJson } from "../lib/serialize";
import {
  addAssumption,
  assumptionKey,
  parseAssumptions,
  serializeAssumptionLine,
  type Assumption,
  type AssumptionTarget,
} from "../map/assumptions";
import { sha256Hex } from "./digest";
import {
  isPlainObject,
  type GhostGame,
  type GhostMove,
  type GhostStep,
  type GhostTarget,
} from "./envelope";
import { issue, type GhostIssue } from "./issues";
import type { GhostSnapshot } from "./snapshot";

/**
 * THE REGISTRY (Epic 10 story 1, ADR-0025 decision 1) — one table of the moves
 * a ghost may carry, each naming the family's own derivers. Expansion is DATA
 * plus the derivers it names: a new move is a new row (its params schema, its
 * target rules, its steps and its closure check), never surgery in the
 * grammar. The registry stays at one move until the expansion protocol's
 * verdict is journaled (ADR-0025 decision 5, ADR-0026's amendment).
 *
 * The first move is `assumption/add` (ADR-0025 decision 3), deliberately not
 * called "the narrowest": it is the MOST gated move (Level 2 only), and its
 * honesty is that the v1 move CANNOT NAME ANYTHING. Its authored content is
 * one prose text and one target — a word or a loop ONLY in v1; a bare spot is
 * uncheckable and a link target crosses the branch seam (ADR-0025 decision 3).
 * It is append-only: a line on a target cannot dangle a branch pin, and the
 * claim never rewrites a standing line.
 *
 * The derived steps are the deriver's, not the agent's: `steps` builds the one
 * append from the validated target and params, and `closure` dry-applies it to
 * the file's bytes and re-parses the result — a move whose derived list does
 * not come back as exactly [before, new claim] is refused. Both reuse the
 * family's record functions (`addAssumption`, `serializeAssumptionLine`), the
 * same derivers the app's quiet assumption write uses (assumptions.ts); the
 * per-move fan-out and write ORDER stay in `map/patches.ts` for the record
 * batches, and this move's order is simply "the one file, once".
 *
 * Provisional: the move's key, the params field name (`text`), the target
 * vocabulary and the append byte rule.
 */

/** The one file `assumption/add` writes (workspace-relative; PROVISIONAL). */
export const ASSUMPTIONS_FILE = "map/assumptions.jsonl";

/** The registry description's format tag (PROVISIONAL) — part of its hash. */
export const REGISTRY_FORMAT = "attentioneer-registry/1";

/** One params field the agent may author. */
export interface ParamField {
  /** The params key. */
  key: string;
  /** Its JSON kind. v1 knows prose only. */
  kind: "text";
}

/** One target kind the move knows: allowed, or refused with a reason. */
export interface TargetRule {
  /** The envelope target's kind. */
  kind: GhostTarget["kind"];
  /** May the agent author it in v1? */
  allowed: boolean;
  /** Why it is refused (present exactly when `allowed` is false). */
  refusal?: string;
}

/** One file the dry run would write: its bytes now and after the steps. */
export interface DryRunFile {
  /** Workspace-relative path. */
  path: string;
  /** The bytes on disk (null = absent); the base the closure is proved on. */
  before: string | null;
  /** The bytes the steps produce. */
  after: string;
}

/** The dry run: the derived steps and the bytes they produce. */
export interface DryRun {
  /** The derived steps (the deriver's; a stored list is never trusted). */
  steps: readonly GhostStep[];
  /** One entry per file the steps write, in the deriver's write order. */
  files: readonly DryRunFile[];
}

/** One registered move. */
export interface MoveDefinition {
  /** The family and verb the envelope must name. */
  move: GhostMove;
  /** The game the move belongs to (the pin's `game`). */
  game: GhostGame;
  /** The record files the move writes — v1: exactly one. */
  files: readonly string[];
  /** The params the agent may author, and nothing else (no name slot). */
  params: readonly ParamField[];
  /**
   * How many targets one authored body may name. v1 is EXACTLY ONE: the
   * envelope carries one `target`, and the params carry none (the target is
   * never copied into params — there is one place a target lives).
   */
  targetCount: number;
  /** Every target kind the record grammar knows, allowed or refused. */
  targets: readonly TargetRule[];
  /**
   * What the move DOES, in the person's own language — the packet's behavioral
   * boundary (ADR-0026; the ticket's "explore vs edit" lane). It is registry
   * DATA, never a rendering of the validator: no issue code, no envelope key,
   * no grammar vocabulary may appear here (the packet states the behavior; the
   * grammar holds the keys — echoing them would turn a grammar-fail into a
   * prompt-compliance).
   */
  boundary: string;
  /** The ONE deriver: build the read-only steps from target + params. */
  steps: (target: GhostTarget, params: Record<string, unknown>) => GhostStep[];
  /**
   * The dry-run closure: given the base bytes and the produced bytes, does the
   * move hold its own record rule (append-only, exactly one new claim)? Pure;
   * the grammar never trusts the derived list alone.
   */
  closure: (
    target: GhostTarget,
    params: Record<string, unknown>,
    before: string | null,
    after: string,
  ) => readonly GhostIssue[];
}

/** A word target's or a loop target's record form (null for refused kinds). */
export function assumptionTargetOf(target: GhostTarget): AssumptionTarget | null {
  if (target.kind === "word") return { type: "word", slug: target.slug };
  if (target.kind === "loop") return { type: "loop", slug: target.slug };
  return null;
}

/** The claim the move would append (null when the target/params are refused). */
export function assumptionRecordOf(
  target: GhostTarget,
  params: Record<string, unknown>,
): Assumption | null {
  const assumptionTarget = assumptionTargetOf(target);
  const text = params.text;
  if (assumptionTarget === null || typeof text !== "string") return null;
  return { text, target: assumptionTarget, extra: {} };
}

/**
 * Append one canonical line to a file's bytes. The step NEVER rewrites an
 * existing line: a canonical file becomes the canonical file plus one line,
 * and a hand-formatted file keeps every byte (only the separator is inserted
 * when the file did not end with a newline). This is the v1 append rule —
 * stronger than the family's whole-file writer, chosen because it is
 * crash-sufficing (one file, one appended line) and because the applied-but-
 * unmarked reconcile can strip the line back off and hash the base the pin
 * names.
 */
export function appendLine(before: string | null, line: string): string {
  const base = before ?? "";
  if (base === "") return `${line}\n`;
  if (base.endsWith("\n")) return `${base}${line}\n`;
  return `${base}\n${line}\n`;
}

/** Build the derived step: one canonical JSONL line, appended to the one file. */
function deriveAddAssumptionSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
): GhostStep[] {
  const record = assumptionRecordOf(target, params);
  if (record === null) return [];
  return [
    {
      op: "append",
      file: ASSUMPTIONS_FILE,
      line: serializeAssumptionLine(record),
    },
  ];
}

/**
 * The dry-run closure for `assumption/add`: apply the line to the base bytes,
 * parse the result back, and require exactly the base's records plus the new
 * claim as the LAST record, with every malformed line preserved. Anything else
 * — a rewritten line, a dropped line, or a claim that already stands on that
 * target (which the family's `addAssumption` would rewrite in place) — is a
 * closure failure, never a silent "close enough".
 */
function closureAddAssumption(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string,
): readonly GhostIssue[] {
  const record = assumptionRecordOf(target, params);
  if (record === null) {
    return [issue("params", "the claim has no target or no text")];
  }
  const base = parseAssumptions(before ?? "");
  const appended = addAssumption(base.assumptions, record.text, record.target);
  if (appended.length !== base.assumptions.length + 1) {
    return [
      issue(
        "append-only",
        "the same claim already stands on that target; v1 only appends, never rewrites a line",
      ),
    ];
  }
  const last = appended[appended.length - 1];
  if (last === undefined || assumptionKey(last) !== assumptionKey(record)) {
    return [issue("append-only", "the deriver did not append this claim as the last record")];
  }
  const result = parseAssumptions(after);
  const issues: GhostIssue[] = [];
  if (result.assumptions.length !== base.assumptions.length + 1) {
    return [
      issue(
        "append-only",
        `the dry run would hold ${result.assumptions.length} claims, not ${base.assumptions.length + 1}`,
      ),
    ];
  }
  for (let index = 0; index < base.assumptions.length; index += 1) {
    const beforeKey = assumptionKey(base.assumptions[index]);
    const afterKey = assumptionKey(result.assumptions[index]);
    if (beforeKey !== afterKey) {
      issues.push(issue("append-only", "the dry run would rewrite or reorder an existing line"));
      break;
    }
  }
  const resultLast = result.assumptions[result.assumptions.length - 1];
  if (resultLast === undefined || assumptionKey(resultLast) !== assumptionKey(record)) {
    issues.push(issue("append-only", "the dry run's last record is not this claim"));
  }
  if (result.malformed.length !== base.malformed.length) {
    issues.push(issue("append-only", "the dry run would change the file's preserved lines"));
  }
  return issues;
}

/** `assumption/add` — the first move (ADR-0025 decision 3). */
export const ADD_ASSUMPTION: MoveDefinition = {
  move: { family: "assumption", verb: "add" },
  game: "dynamics",
  files: [ASSUMPTIONS_FILE],
  params: [{ key: "text", kind: "text" }],
  targetCount: 1,
  targets: [
    { kind: "word", allowed: true },
    { kind: "loop", allowed: true },
    {
      kind: "spot",
      allowed: false,
      refusal:
        "a bare spot is not on the map, so the claim's target cannot be checked",
    },
    {
      kind: "link",
      allowed: false,
      refusal: "a link target crosses the branch seam",
    },
  ],
  steps: deriveAddAssumptionSteps,
  closure: closureAddAssumption,
  boundary:
    "Add one claim beside one word or one loop. Nothing else changes: no word, mark, distance, loop, veil or existing claim is rewritten, renamed or removed. Nothing is named — a name is the person's to coin.",
};

/** The registry, in table order (the fact the derived hash will walk later). */
export const MOVES: readonly MoveDefinition[] = [ADD_ASSUMPTION];

/** A move's identity, for the registry lookup (a NUL keeps family/verb apart). */
export function moveKeyOf(move: GhostMove): string {
  return `${move.family}\u0000${move.verb}`;
}

/**
 * The registered move a value names, or null. Shape-only: an object with a
 * family and a verb that the table carries. The grammar has already checked
 * the move's keys when this is used after shape checks; it stays defensive
 * because the registry is the only door to "only registered ids accept".
 */
export function findMove(value: unknown): MoveDefinition | null {
  if (!isPlainObject(value)) return null;
  const family = value.family;
  const verb = value.verb;
  if (typeof family !== "string" || typeof verb !== "string") return null;
  return (
    MOVES.find(
      (entry) => entry.move.family === family && entry.move.verb === verb,
    ) ?? null
  );
}

/** The move a registry entry declares, as the envelope spells it. */
export function moveOf(entry: MoveDefinition): GhostMove {
  return { family: entry.move.family, verb: entry.move.verb };
}

/**
 * The base pin an intake mints from a snapshot: one digest per file the move
 * writes (an absent file pins as the empty string's digest), the records
 * folder, the running level and the move's game.
 */
export function pinOf(
  snapshot: GhostSnapshot,
  entry: MoveDefinition,
): {
  dir: string;
  files: Record<string, string>;
  level: GhostGame;
  game: GhostGame;
} {
  const files: Record<string, string> = {};
  for (const file of entry.files) {
    files[file] = sha256Hex(snapshot.files[file] ?? "");
  }
  return {
    dir: snapshot.dir,
    files,
    level: snapshot.level,
    game: entry.game,
  };
}

/*
 * The registry's TARGET RULES as data (Epic 10 story 2): the packet states the
 * move's shape and its operations from these helpers, so expansion (a new row)
 * changes the packet's move section without a rendering edit — and the story's
 * target rules are asserted at the registry, not in a prompt.
 */

/** The target kinds the agent may author, in table order (the move's operations). */
export function authorableTargetKinds(
  entry: MoveDefinition,
): GhostTarget["kind"][] {
  return entry.targets.filter((rule) => rule.allowed).map((rule) => rule.kind);
}

/** The registry's rule for one target kind; null when the record grammar has none. */
export function targetRuleOf(
  entry: MoveDefinition,
  kind: GhostTarget["kind"],
): TargetRule | null {
  return entry.targets.find((rule) => rule.kind === kind) ?? null;
}

/** The params keys the agent may author, in schema order (the move's content). */
export function authoredParamKeys(entry: MoveDefinition): string[] {
  return entry.params.map((field) => field.key);
}

/**
 * The registry as PLAIN DATA — the description the version hash walks. It is
 * derived from the live table (move, game, files, the params schema, the target
 * arity and rules incl. the refusal sentences, the boundary), so a new move or
 * an edited rule changes the hash and nothing else does. The derivers' code is
 * not hashed (a behavior hash is not a version): two tables that declare the
 * same rows are the same registry.
 */
export function registryDescription(
  moves: readonly MoveDefinition[] = MOVES,
): unknown {
  return {
    format: REGISTRY_FORMAT,
    moves: moves.map((entry) => ({
      move: { family: entry.move.family, verb: entry.move.verb },
      game: entry.game,
      files: [...entry.files],
      targetCount: entry.targetCount,
      params: entry.params.map((field) => ({
        key: field.key,
        kind: field.kind,
      })),
      targets: entry.targets.map((rule) => ({
        kind: rule.kind,
        allowed: rule.allowed,
        refusal: rule.refusal ?? null,
      })),
      boundary: entry.boundary,
    })),
  };
}

/**
 * The registry VERSION: a hash DERIVED from the table above, never a
 * hand-bumped literal (ADR-0025's amendment; ADR-0026 decision 3). It is the
 * third part of the packet's frozen triple, so two expansion runs are
 * comparable: the same bytes against the same pin under the same registry.
 */
export function registryHash(moves: readonly MoveDefinition[] = MOVES): string {
  return sha256Hex(canonicalJson(registryDescription(moves)));
}
