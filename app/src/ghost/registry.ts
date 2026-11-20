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
  targetFromValue,
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

/*
 * THE PER-GAME AUTHORING POLICY (Epic 11 story 2, ADR-0025 decision 1 as
 * amended): game rules are DATA, never a game-name branch in the checklist.
 *
 * A policy row says what the GAME requires before the game authors anything at
 * all. The one requirement the table carries today is ADR-0025 decision 3's
 * (ADR-0013 decision 1): the dynamics game authors nothing until a playing set
 * is accepted. The grammar ASKS the row (`gamePolicyOf`) and refuses with the
 * record's own words, so a second game's requirement is a second field here
 * plus the one check that reads it, and a new game is a new row.
 *
 * FAIL-CLOSED, like everything in this table: a game with no row, a row
 * carrying a field this build does not know, or a field whose value is not the
 * declared type REFUSES. A missing requirement must never read as "no
 * requirements".
 *
 * Provisional: the shape (one optional boolean today), the field names and
 * whether a policy ever grows more than requirements (story 2's own note).
 */
export interface GamePolicy {
  /** May a ghost author in this game only behind an accepted playing set? */
  readonly requiresPlayingSet?: boolean;
}

/** The policy row's known fields, exactly (an unknown field refuses). */
export const GAME_POLICY_KEYS: readonly string[] = ["requiresPlayingSet"];

/** The per-game authoring policy table (PROVISIONAL shape). */
export const GAME_POLICY: Readonly<Record<string, GamePolicy>> = {
  concept: {},
  dynamics: { requiresPlayingSet: true },
  ground: {},
};

/** What reading one game's policy yielded: the row, or why it refuses. */
export type GamePolicyRead =
  | { ok: true; policy: GamePolicy }
  | { ok: false; issues: readonly GhostIssue[] };

/**
 * Read one game's policy row, fail-closed (see the table's note). The table is
 * a parameter so a fixture can prove the reader's refusals without touching
 * the live data; the grammar calls it with the shipped table.
 */
export function gamePolicyOf(
  game: string,
  table: Readonly<Record<string, unknown>> = GAME_POLICY,
): GamePolicyRead {
  if (!Object.prototype.hasOwnProperty.call(table, game)) {
    return {
      ok: false,
      issues: [
        issue(
          "policy",
          `the ${game} game has no authoring policy; a missing policy refuses rather than permits`,
        ),
      ],
    };
  }
  const row = table[game];
  if (!isPlainObject(row)) {
    return {
      ok: false,
      issues: [
        issue(
          "policy",
          `the ${game} game's policy is not a row of named requirements`,
        ),
      ],
    };
  }
  const issues: GhostIssue[] = [];
  for (const key of Object.keys(row)) {
    if (!GAME_POLICY_KEYS.includes(key)) {
      issues.push(
        issue(
          "policy",
          `the ${game} game's policy carries an unknown field "${key}"; the grammar refuses rather than ignore a requirement it cannot read`,
        ),
      );
    }
  }
  if (
    "requiresPlayingSet" in row &&
    typeof row.requiresPlayingSet !== "boolean"
  ) {
    issues.push(
      issue(
        "policy",
        `the ${game} game's policy "requiresPlayingSet" is not a yes/no`,
      ),
    );
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, policy: row as GamePolicy };
}

/**
 * The params kinds the grammar VALIDATES (Epic 11 story 2). Fail-closed: a row
 * may declare a kind this list does not carry, and the grammar then REFUSES —
 * it never skips the value unvalidated (the cheap-model default would
 * otherwise pass an unknown kind straight through).
 */
export type ParamKind = "text" | "number" | "enum";

/** The known params kinds, as data (the grammar's check and tests read it). */
export const PARAM_KINDS: readonly ParamKind[] = ["text", "number", "enum"];

/** Is a declared kind one the grammar validates? */
export function isParamKind(value: unknown): value is ParamKind {
  return (
    typeof value === "string" &&
    (PARAM_KINDS as readonly string[]).includes(value)
  );
}

/** One params field the agent may author. */
export interface ParamField {
  /** The params key. */
  key: string;
  /**
   * Its declared JSON kind. Deliberately a plain string: a row may DECLARE a
   * kind this grammar build does not know, and the grammar must refuse the
   * value fail-closed rather than wave it through.
   */
  kind: string;
  /**
   * An enum's allowed values, as data — present exactly when `kind` is
   * "enum". A missing or malformed list refuses (the declaration cannot be
   * honoured, so no value may pass).
   */
  values?: readonly string[];
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
  /**
   * The bytes the steps produce; null = the file is gone (STORY 21.6's one
   * removal that leaves no file: a note). A null after is a DELETE, pinned and
   * applied like every other step — never a truncation pretending to be one.
   */
  after: string | null;
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
  /**
   * STORY 21.1 — THE FILES A TARGET NAMES, when one is not enough. A note's
   * file is named by the CARD it is about (`map/notes/<slug>.md`), so a move
   * whose file list depends on its target declares this instead of a fixed
   * `files` list. Absent on every shipped move: the field exists because the
   * ground family keys a note by its card's slug, and the ghost machinery must
   * be able to say that without a record path leaking into the vocabulary.
   * PROVISIONAL with the act names (ADR-0038 §3).
   */
  filesFor?: (target: GhostTarget) => readonly string[];
  /** The params the agent may author, and nothing else (no name slot). */
  params: readonly ParamField[];
  /**
   * How many targets one authored body may name — GRAMMAR-READ, not merely
   * declared (Epic 11 story 2). The envelope's shape carries exactly ONE
   * `target` (the params never copy it — one place a target lives), so the
   * grammar refuses any row whose count is not the number 1 rather than
   * check one target of several. Fail-closed: a malformed count refuses.
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
  /**
   * The ONE deriver: build the read-only steps from target + params (and the
   * file's bytes BEFORE the write, when the move mints a slug against what is
   * already on the map — a ground card's name-derived slug is the reason the
   * base is here; a move that ignores it is exactly as pure).
   */
  steps: (
    target: GhostTarget,
    params: Record<string, unknown>,
    before: string | null,
  ) => GhostStep[];
  /**
   * The dry-run closure: given the base bytes and the produced bytes, does the
   * move hold its own record rule (append-only, exactly one new claim)? Pure;
   * the grammar never trusts the derived list alone.
   */
  closure: (
    target: GhostTarget,
    params: Record<string, unknown>,
    before: string | null,
    after: string | null,
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

/**
 * STORY 21.6 — THE REMOVAL'S ONE BYTE RULE. Drop the FIRST line that equals
 * the step's line, keeping every other byte: the file's line ending style is
 * untouched, a hand-formatted or malformed line the deriver did not name stays
 * exactly as it is, and a file that still holds records keeps the record
 * files' trailing newline. Returns `undefined` when the line is not there —
 * the grammar refuses rather than writing "close enough".
 *
 * A removal never reorders, rewrites or re-serializes: it is the append rule's
 * mirror image, so the closure can prove the produced bytes are the base minus
 * exactly the one line the deriver named.
 */
export function withoutLine(
  before: string | null,
  line: string,
): string | undefined {
  if (before === null) return undefined;
  const parts = before.split("\n");
  const index = parts.indexOf(line);
  if (index === -1) return undefined;
  parts.splice(index, 1);
  const joined = parts.join("\n");
  // The record files' convention: a file that held a trailing newline still
  // does, even when the removal took its last line.
  if (before.endsWith("\n") && !joined.endsWith("\n")) return `${joined}\n`;
  return joined;
}

/** Build the derived step: one canonical JSONL line, appended to the one file. */
function deriveAddAssumptionSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  _before: string | null,
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
  after: string | null,
): readonly GhostIssue[] {
  // An add never deletes the file; a null here is a deriver bug, refused.
  if (after === null) {
    return [issue("append-only", "adding a claim cannot remove the file")];
  }
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
 * The move a value names in a table, or null. Shape-only: an object with a
 * family and a verb that the table carries. The grammar has already checked
 * the move's keys when this is used after shape checks; it stays defensive
 * because the registry is the only door to "only registered ids accept".
 *
 * The TABLE is a parameter (Epic 11 story 2) so a fixture table can prove
 * the expansion path through the same door — the shipped default is MOVES,
 * and a fixture row is never registered by being validated.
 */
export function findMove(
  value: unknown,
  moves: readonly MoveDefinition[] = MOVES,
): MoveDefinition | null {
  if (!isPlainObject(value)) return null;
  const family = value.family;
  const verb = value.verb;
  if (typeof family !== "string" || typeof verb !== "string") return null;
  return (
    moves.find(
      (entry) => entry.move.family === family && entry.move.verb === verb,
    ) ?? null
  );
}

/** The move a registry entry declares, as the envelope spells it. */
export function moveOf(entry: MoveDefinition): GhostMove {
  return { family: entry.move.family, verb: entry.move.verb };
}

/**
 * THE FILES A MOVE WRITES FOR THIS TARGET (STORY 21.1): a fixed list, or the
 * target-dependent one a note needs. The ONE arithmetic, so the pin, the
 * grammar and the apply cannot disagree about which file a move writes.
 */
export function filesOf(
  entry: MoveDefinition,
  target: GhostTarget,
): readonly string[] {
  return entry.filesFor === undefined ? entry.files : entry.filesFor(target);
}

/**
 * The same file list read from an UNTRUSTED target value (the intake wraps a
 * body before the grammar has spoken). An out-of-shape target reads as no
 * files, which the grammar then refuses against the move's pin — fail-closed.
 */
export function filesForValue(
  entry: MoveDefinition,
  value: unknown,
): readonly string[] {
  const target = targetFromValue(value);
  return target === null ? [] : filesOf(entry, target);
}

/**
 * The base pin an intake mints from a snapshot: one digest per file the move
 * writes (an absent file pins as the empty string's digest), the records
 * folder, the running level and the move's game.
 *
 * THE LEVEL IS THE BINDING (Epic 11 story 2): `level` is the running band,
 * and the grammar compares it with the snapshot's running level, exactly as
 * it compares the move's game (`entry.game`) with that same running level.
 * `game` is DOCUMENTATION — the move's registry game, recorded so the pin
 * says which game it was minted for. The grammar never compares the pin's
 * `game` with the app: the move's game is registry data, not a fact the
 * snapshot carries. (The game pin must still NAME the move's game — a
 * self-consistency shape check, never an environment binding.)
 */
export function pinOf(
  snapshot: GhostSnapshot,
  entry: MoveDefinition,
  target: GhostTarget,
): {
  dir: string;
  files: Record<string, string>;
  level: GhostGame;
  game: GhostGame;
} {
  const files: Record<string, string> = {};
  for (const file of filesOf(entry, target)) {
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
 * THE GAME'S REGISTERED MOVES (Epic 11 story 2), in table order, spelled
 * `family/verb` — the packet's operations line. Derived from the SAME table
 * `findMove` reads, so a second row changes the packet without a rendering
 * edit and the packet never invents a move. Only REGISTERED rows here: the
 * canvas's authored kinds are the card's other source (`gameMovesOf`), not
 * this line's.
 */
export function registeredMovesOf(
  game: GhostGame,
  moves: readonly MoveDefinition[] = MOVES,
): string[] {
  return moves
    .filter((entry) => entry.game === game)
    .map((entry) => `${entry.move.family}/${entry.move.verb}`);
}

/**
 * ONE REGISTRY ROW as the cards' moves derivation reads it: the game and the
 * move. `MoveDefinition` satisfies it structurally, so the live table (or a
 * test's fixture table) passes without adaptation.
 */
export interface GameMoveRow {
  game: GhostGame;
  move: GhostMove;
}

/**
 * THE MOVES LINE OF A GAME'S CARD (Epic 11 story 1, ADR-0027 §3 as amended) —
 * DERIVED, never authored, from the game's TWO move sources, both PASSED AS
 * DATA:
 *
 *   - the registry rows (the game's registered agent moves, spelled
 *     `family/verb`);
 *   - the canvas's `creationKinds` for the game (the ring menu's authored
 *     kinds), passed as a plain list rather than imported. This module is the
 *     ghost layer, and the ghost layer NEVER imports the canvas (a source scan
 *     in `cards.test.ts` holds that seam); the app — or a test — reads
 *     `creationKinds(game)` and hands the result in.
 *
 * One helper, two sources: the order is the registry's table order first, then
 * the ring's order, deduped. The line is never stored in a card (a card's
 * authored parts are its conventions and its examples); deriving it where it
 * is read is what keeps a hand-edited copy from becoming a second truth.
 *
 * Provisional: the spelling (a registered move as `family/verb`, a creation
 * kind as its bare name) and the source order.
 */
export function gameMovesOf(
  game: GhostGame,
  registryRows: readonly GameMoveRow[],
  creationKindsData: readonly string[],
): string[] {
  const moves: string[] = [];
  for (const row of registryRows) {
    if (row.game !== game) continue;
    moves.push(`${row.move.family}/${row.move.verb}`);
  }
  for (const kind of creationKindsData) {
    if (!moves.includes(kind)) moves.push(kind);
  }
  return moves;
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
        // An enum's allowed values are part of the schema (data), so the
        // version hash moves when the set of allowed values does.
        values: field.values ?? null,
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
