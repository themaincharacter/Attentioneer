import { sha256Hex } from "./digest";
import {
  AGENT_PATCH_KEYS,
  GHOST_FORMAT,
  GHOST_GAMES,
  GHOST_KEYS,
  isGhostId,
  isNameSlot,
  isPlainObject,
  type GhostEnvelope,
  type GhostExpect,
  type GhostGame,
  type GhostMove,
  type GhostStep,
  type GhostTarget,
} from "./envelope";
import { issue, type GhostIssue } from "./issues";
import {
  appendLine,
  filesOf,
  findMove,
  gamePolicyOf,
  isParamKind,
  moveOf,
  MOVES,
  replacedLine,
  withoutLine,
  type DryRun,
  type DryRunFile,
  type MoveDefinition,
  type ParamField,
} from "./registry";
import type { GhostSnapshot } from "./snapshot";

/**
 * THE GRAMMAR (Epic 10 story 1, ADR-0025 decision 1) — a PURE, registry-checked
 * checklist with dry-run closure.
 *
 * It checks: the envelope's shape and keys (its own keys exactly; no name slot
 * anywhere; no unknown key in the agent's body, move, params or target); that
 * the move is registered; its declared target count (the envelope carries one);
 * the move's params schema and target rules; the game, level and folder pins;
 * THE SET GATE, read from the game's POLICY DATA (GAME_POLICY — a game whose
 * policy requires an accepted playing set refuses without one; ADR-0025
 * decision 3, the authoring rule the plane's writers obey through
 * `authoringLive`); the base pin against the file ACTUALLY
 * on disk; and closure by APPLYING the derived steps to the
 * snapshot and parsing
 * the result back — a derived list alone proves nothing. It re-derives the
 * steps every time, so a tampered stored list is IGNORED: the deriver owns the
 * steps. It also recognises an APPLIED ghost (the files already hold the
 * derived bytes and stripping the appended line reproduces the pin) — the
 * crash story's applied-but-unmarked reconcile.
 *
 * STORY 21.6 — THE STEPS ARE APPENDS OR REMOVALS (ADR-0038's 2026-11-20
 * amendment: coverage grows act by act, and a primary surface must be able to
 * take back what it just did). The closure rule is the same in both
 * directions: the produced bytes must be the base PLUS one claim, or the base
 * MINUS exactly the one line the deriver named (or minus the file, for a
 * note). The reconcile stays append-only; a removal is never reconstructed
 * from nothing.
 *
 * STORY 21.8 — A STEP MAY REWRITE ONE LINE IN PLACE (ADR-0038's amendment: an
 * agent can place and propose a name, the two things a person does most after
 * making a card). The dry run proves the rewrite is EXACTLY one line's bytes:
 * the named line must be in the base, every other byte is untouched, and the
 * move's or rename's own closure re-parses the result. A rewrite is never
 * reconciled from nothing either: applied-but-unmarked refuses by the pin.
 *
 * It cannot check meaning, same-thing-ness, prose quality or "small" (ADR-0025
 * decision 1). A ghost that passes is still a claim the person judges.
 *
 * Pure: no fs, no React, same inputs = same verdict. The impure half is the
 * snapshot read (`snapshot.ts`) and the writes (`apply.ts`).
 */

/** The grammar's verdict. */
export interface GhostValidation {
  /** The envelope (with the DERIVED steps) passed every check. */
  ok: boolean;
  /** The normalized envelope: derived steps in place, proposals empty. */
  envelope: GhostEnvelope | null;
  /** The dry run the deriver produced (null when it refused before deriving). */
  run: DryRun | null;
  /** The files already hold the derived result: applied but unmarked. */
  applied: boolean;
  /** Why it was refused. */
  issues: readonly GhostIssue[];
}

/** The known target kinds' own keys (kind plus the kind's payload). */
const TARGET_KEYS: Record<GhostTarget["kind"], readonly string[]> = {
  word: ["kind", "slug"],
  loop: ["kind", "slug"],
  spot: ["kind", "x", "y"],
  link: ["kind", "from", "to"],
  // STORY 21.1: one existing card, by slug — the kind a note is about.
  card: ["kind", "slug"],
  // STORY 21.7: one existing ask card, by slug — the kind an ask's removal is
  // about. An ask is its own family, so it gets its own kind rather than
  // teaching the card kind that an ask is a reference.
  ask: ["kind", "slug"],
  // STORY 21.11: one existing session card, by slug — the kind a rebind and a
  // removal are about. The third family is its own kind, exactly as the ask is.
  session: ["kind", "slug"],
};

/** A digest's shape: 64 lower-case hex chars. */
const DIGEST = /^[0-9a-f]{64}$/;

function refused(issues: readonly GhostIssue[]): GhostValidation {
  return { ok: false, envelope: null, run: null, applied: false, issues };
}

/**
 * Every key below `allowed` must be allowed; a name-shaped key is always a
 * "name-slot" (its own refusal, because the guardrail names it), anything else
 * is an unknown key. The envelope is hand-editable by VALUE, never by key.
 */
function keyIssuesOf(
  value: Record<string, unknown>,
  allowed: readonly string[],
): GhostIssue[] {
  const issues: GhostIssue[] = [];
  for (const key of Object.keys(value)) {
    if (isNameSlot(key)) {
      issues.push(
        issue(
          "name-slot",
          `"${key}" would coin a name; an agent may propose one only as a read-only sibling, and v1 carries none`,
        ),
      );
      continue;
    }
    if (!allowed.includes(key)) {
      issues.push(issue("unknown-key", `unknown key "${key}"`));
    }
  }
  return issues;
}

function readMove(
  value: unknown,
): { ok: true; move: GhostMove } | { ok: false; issues: readonly GhostIssue[] } {
  if (!isPlainObject(value)) {
    return { ok: false, issues: [issue("shape", "move must be a JSON object")] };
  }
  const keys = keyIssuesOf(value, ["family", "verb"]);
  if (keys.length > 0) return { ok: false, issues: keys };
  if (
    typeof value.family !== "string" ||
    value.family === "" ||
    typeof value.verb !== "string" ||
    value.verb === ""
  ) {
    return {
      ok: false,
      issues: [issue("shape", "move needs a non-empty family and verb")],
    };
  }
  return { ok: true, move: { family: value.family, verb: value.verb } };
}

function readTarget(
  value: unknown,
  entry: MoveDefinition,
): { ok: true; target: GhostTarget } | { ok: false; issues: readonly GhostIssue[] } {
  if (!isPlainObject(value)) {
    return { ok: false, issues: [issue("target-shape", "target must be a JSON object")] };
  }
  if (typeof value.kind !== "string") {
    return {
      ok: false,
      issues: [issue("target-shape", "target needs a kind")],
    };
  }
  const rule = entry.targets.find((candidate) => candidate.kind === value.kind);
  if (rule === undefined) {
    return {
      ok: false,
      issues: [
        issue(
          "target-shape",
          `the record grammar has no "${value.kind}" target`,
        ),
      ],
    };
  }
  if (!rule.allowed) {
    return {
      ok: false,
      issues: [
        issue(
          "refused-target",
          rule.refusal ?? `the move refuses a "${value.kind}" target in v1`,
        ),
      ],
    };
  }
  const kind = value.kind as GhostTarget["kind"];
  const keys = keyIssuesOf(value, TARGET_KEYS[kind]);
  if (keys.length > 0) return { ok: false, issues: keys };

  if (
    kind === "word" ||
    kind === "loop" ||
    kind === "card" ||
    kind === "ask" ||
    kind === "session"
  ) {
    if (typeof value.slug !== "string" || value.slug === "") {
      return {
        ok: false,
        issues: [issue("target-shape", `a ${kind} target needs a non-empty slug`)],
      };
    }
    return { ok: true, target: { kind, slug: value.slug } };
  }
  if (kind === "spot") {
    if (
      typeof value.x !== "number" ||
      typeof value.y !== "number" ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y)
    ) {
      return {
        ok: false,
        issues: [issue("target-shape", "a spot target needs finite x and y")],
      };
    }
    return { ok: true, target: { kind: "spot", x: value.x, y: value.y } };
  }
  if (
    typeof value.from !== "string" ||
    value.from === "" ||
    typeof value.to !== "string" ||
    value.to === ""
  ) {
    return {
      ok: false,
      issues: [issue("target-shape", "a link target needs a non-empty from and to")],
    };
  }
  return { ok: true, target: { kind: "link", from: value.from, to: value.to } };
}

/**
 * ONE params field, validated by its declared kind — FAIL-CLOSED (Epic 11
 * story 2). An unknown kind REFUSES (it is never skipped as "nothing to
 * check", which is how an unvalidated params value would slip through under
 * a cheap model); an enum whose allowed values are not data REFUSES; and a
 * value that is not the declared kind REFUSES. The grammar understands
 * exactly the kinds in `PARAM_KINDS`.
 */
function paramIssuesOf(field: ParamField, raw: unknown): GhostIssue[] {
  if (!isParamKind(field.kind)) {
    return [
      issue(
        "params",
        `"${field.key}" declares the "${field.kind}" kind, which this grammar does not know; only text, number and enum are checked, so the value is refused rather than passed unvalidated`,
      ),
    ];
  }
  if (field.kind === "text") {
    if (typeof raw !== "string" || raw.trim() === "") {
      return [issue("params", `"${field.key}" must be non-empty prose`)];
    }
    if (raw !== raw.trim()) {
      return [
        issue(
          "params",
          `"${field.key}" has surrounding whitespace; the app writes exactly what the envelope says`,
        ),
      ];
    }
    return [];
  }
  if (field.kind === "number") {
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      return [issue("params", `"${field.key}" must be a finite number`)];
    }
    return [];
  }
  // An enum: the allowed values are the schema's DATA, and a missing or
  // malformed list cannot be honoured, so every value refuses.
  const values = field.values;
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((entry) => typeof entry !== "string" || entry === "")
  ) {
    return [
      issue(
        "params",
        `"${field.key}" is an enum with no allowed values; a declaration whose data is missing refuses rather than accepts any value`,
      ),
    ];
  }
  if (typeof raw !== "string" || !values.includes(raw)) {
    return [
      issue(
        "params",
        `"${field.key}" must be one of ${values.map((entry) => JSON.stringify(entry)).join(", ")}`,
      ),
    ];
  }
  return [];
}

function readParams(
  value: unknown,
  entry: MoveDefinition,
): { ok: true; params: Record<string, unknown> } | { ok: false; issues: readonly GhostIssue[] } {
  if (!isPlainObject(value)) {
    return { ok: false, issues: [issue("params", "params must be a JSON object")] };
  }
  const keys = keyIssuesOf(value, entry.params.map((field) => field.key));
  if (keys.length > 0) return { ok: false, issues: keys };
  for (const field of entry.params) {
    const issues = paramIssuesOf(field, value[field.key]);
    if (issues.length > 0) return { ok: false, issues };
  }
  return { ok: true, params: value };
}

function isGhostGame(value: unknown): value is GhostGame {
  return (
    typeof value === "string" &&
    (GHOST_GAMES as readonly string[]).includes(value)
  );
}

function readExpect(
  value: unknown,
  entry: MoveDefinition,
): { ok: true; expect: GhostExpect } | { ok: false; issues: readonly GhostIssue[] } {
  if (!isPlainObject(value)) {
    return { ok: false, issues: [issue("expect-shape", "expect must be a JSON object")] };
  }
  const keys = keyIssuesOf(value, ["dir", "files", "level", "game"]);
  if (keys.length > 0) return { ok: false, issues: keys };
  if (typeof value.dir !== "string" || value.dir === "") {
    return { ok: false, issues: [issue("expect-shape", "expect.dir must name the records folder")] };
  }
  if (!isGhostGame(value.level)) {
    return { ok: false, issues: [issue("expect-shape", `expect.level is not one of the three games`)] };
  }
  if (!isGhostGame(value.game)) {
    return { ok: false, issues: [issue("expect-shape", "expect.game is not one of the three games")] };
  }
  if (value.game !== entry.game) {
    return {
      ok: false,
      issues: [
        issue(
          "game",
          `the ghost's pin names the ${value.game} game; ${entry.move.family}/${entry.move.verb} belongs to ${entry.game}`,
        ),
      ],
    };
  }
  if (!isPlainObject(value.files)) {
    return { ok: false, issues: [issue("expect-shape", "expect.files must be an object of digests")] };
  }
  const files: Record<string, string> = {};
  for (const [path, digest] of Object.entries(value.files)) {
    if (path === "") {
      return { ok: false, issues: [issue("expect-shape", "a pinned file path is empty")] };
    }
    if (typeof digest !== "string" || !DIGEST.test(digest)) {
      return {
        ok: false,
        issues: [issue("expect-shape", `the pin for "${path}" is not a digest`)],
      };
    }
    files[path] = digest;
  }
  return {
    ok: true,
    expect: { dir: value.dir, files, level: value.level, game: value.game },
  };
}

/** Does a target name something on the map? (A spot is its own target.) */
function targetExists(target: GhostTarget, snapshot: GhostSnapshot): boolean {
  if (target.kind === "word") return snapshot.words.has(target.slug);
  if (target.kind === "loop") return snapshot.loops.has(target.slug);
  // STORY 21.1: a card target is a ground reference's slug. A snapshot that
  // carries no card set (every concept/dynamics snapshot) refuses it: absence
  // must never read as "the card is there".
  if (target.kind === "card") return snapshot.cards?.has(target.slug) === true;
  // STORY 21.7 — AN ASK CARD IS ON THE MAP when its line is, and ALSO while
  // only its conversation is: the app's own delete shape takes the record line
  // first and the conversation after it, so the second step of that shape must
  // still be able to name the card whose line just left. The orphan
  // conversation IS that card's remains, which the app already reports as one.
  if (target.kind === "ask") return snapshot.asks?.has(target.slug) === true;
  // STORY 21.11 — A SESSION CARD IS ON THE MAP when its line is, and ALSO while
  // only its transcript is: the app's own delete shape takes the record line
  // first and the transcript after it, so the shape's second step must still be
  // able to name the card whose line just left. The orphan transcript IS that
  // card's remains, which the app already reports as an orphan.
  if (target.kind === "session") {
    return snapshot.sessions?.has(target.slug) === true;
  }
  return true;
}

/** The bases a byte-append leaves behind, when `line` is the file's last line. */
function reconstructedBases(current: string, line: string): string[] {
  const tail = `${line}\n`;
  if (!current.endsWith(tail)) return [];
  const base = current.slice(0, -tail.length);
  return base.endsWith("\n") ? [base, base.slice(0, -1)] : [base];
}

/**
 * An APPLIED ghost: strip every derived line back off the file, in reverse,
 * and the base each strip recovers hashes to the pin. The append rule never
 * rewrites a line, so this is the exact reconcile — keyed on the in-session
 * id's envelope and the base pin it minted (ADR-0025 decision 2).
 *
 * STORY 21.6 — A REMOVAL IS NEVER RECONCILED. The append reconcile works by
 * stripping the appended bytes back off; a removal cannot be undone that way
 * without re-inventing the bytes it took, and a guess is not a reconcile. So a
 * removal that landed without its marker is REFUSED by the pin on the retry
 * (the file no longer hashes to the base it was built on) — the person can see
 * the removal already happened and propose nothing more. Failure closes the
 * honest half of the crash story here.
 *
 * STORY 21.8 — A REWRITE IS NEVER RECONCILED either, for the same reason: the
 * line it replaced is gone from the base, so a retry after a landed rewrite is
 * refused by the pin rather than re-invented.
 */
function reconciled(
  steps: readonly GhostStep[],
  current: string | null,
  pinDigest: string,
): boolean {
  if (steps.length === 0) return false;
  let tail = current ?? "";
  for (const step of steps) {
    if (step.op !== "append") return false;
    const bases = reconstructedBases(tail, step.line);
    if (bases.length === 0) return false;
    const match = bases.find((base) => sha256Hex(base) === pinDigest);
    if (match === undefined) return false;
    tail = match;
  }
  return true;
}

/**
 * Validate one envelope against one snapshot. The `candidate` is the raw JSON
 * (from a file or the intake's wrap), read defensively: this is the same
 * grammar for the agent's body, a hand-edited envelope and the intake's own
 * output, so there is one door.
 *
 * The MOVE TABLE is a parameter (Epic 11 story 2): the shipped default is the
 * live registry, and a fixture table lets a test prove the expansion path —
 * the same checklist, a second row — WITHOUT registering a move.
 */
export function validateGhost(
  candidate: unknown,
  snapshot: GhostSnapshot,
  moves: readonly MoveDefinition[] = MOVES,
): GhostValidation {
  if (!isPlainObject(candidate)) {
    return refused([issue("shape", "the envelope is not a JSON object")]);
  }
  const envelopeKeys = keyIssuesOf(candidate, GHOST_KEYS);
  if (envelopeKeys.length > 0) return refused(envelopeKeys);

  if (candidate.format !== GHOST_FORMAT) {
    return refused([
      issue("format", `the format key is not "${GHOST_FORMAT}"`),
    ]);
  }
  if (!isGhostId(candidate.id)) {
    return refused([
      issue("id", "the id is not the app's in-session id shape (letters, digits, dot, dash, underscore)"),
    ]);
  }

  const move = readMove(candidate.move);
  if (!move.ok) return refused(move.issues);
  const entry = findMove(move.move, moves);
  if (entry === null) {
    return refused([
      issue(
        "unregistered-move",
        `${move.move.family}/${move.move.verb} is not a registered move`,
      ),
    ]);
  }

  // TARGET ARITY IS GRAMMAR-READ (Epic 11 story 2): the envelope carries
  // exactly one `target` and the params never copy it, so a row declaring
  // another count cannot be honoured. Fail-closed: refuse rather than check
  // one target of several (a malformed count refuses too).
  if (entry.targetCount !== 1) {
    return refused([
      issue(
        "target-shape",
        `the move declares ${entry.targetCount} targets; the envelope carries exactly one, so the grammar refuses rather than check a single target of ${entry.targetCount}`,
      ),
    ]);
  }

  const target = readTarget(candidate.target, entry);
  if (!target.ok) return refused(target.issues);
  const params = readParams(candidate.params, entry);
  if (!params.ok) return refused(params.issues);

  if (
    typeof candidate.rationale !== "string" ||
    candidate.rationale.trim() === ""
  ) {
    return refused([
      issue("rationale", "a ghost carries the prose why it is proposed"),
    ]);
  }
  if (!Array.isArray(candidate.steps)) {
    return refused([
      issue("shape", "steps must be the derived list (its content is the deriver's)"),
    ]);
  }
  if (!Array.isArray(candidate.proposals)) {
    return refused([issue("shape", "proposals must be the read-only sibling list")]);
  }
  if (candidate.proposals.length > 0) {
    return refused([
      issue(
        "name-slot",
        "v1 carries no proposal kinds; a name is the person's to coin and no sibling is applied",
      ),
    ]);
  }
  const expect = readExpect(candidate.expect, entry);
  if (!expect.ok) return refused(expect.issues);

  const contextIssues: GhostIssue[] = [];
  if (snapshot.level !== entry.game) {
    contextIssues.push(
      issue(
        "game",
        `${entry.move.family}/${entry.move.verb} belongs to the ${entry.game} game; the app is at ${snapshot.level}`,
      ),
    );
  }
  if (expect.expect.level !== snapshot.level) {
    contextIssues.push(
      issue(
        "level",
        `the ghost was built at ${expect.expect.level}; the app is at ${snapshot.level}`,
      ),
    );
  }
  if (snapshot.scenario !== null) {
    contextIssues.push(
      issue(
        "branch",
        "a branch is active: a ghost is refused rather than write a committed orphan unseen",
      ),
    );
  }
  if (expect.expect.dir !== snapshot.dir) {
    contextIssues.push(
      issue(
        "pin",
        `the records folder is now ${snapshot.dir}; the ghost's pin says ${expect.expect.dir}`,
      ),
    );
  }
  if (contextIssues.length > 0) return refused(contextIssues);

  // THE SET GATE (ADR-0025 decision 3; ADR-0013 decision 1) — read from the
  // game's POLICY DATA (Epic 11 story 2), never from a game-name branch: a
  // ghost is an authoring move, and a game whose policy requires an accepted
  // playing set authors nothing until one is. This is the same rule the
  // plane's writers obey through `authoringLive`, enforced at BOTH ghost
  // doors — the intake and the accept each read a fresh snapshot, so a set
  // withdrawn between them refuses the accept. Absence, not emptiness, is
  // what "no set" means: an accepted EMPTY set is still an accepted set (the
  // selector's own rule).
  //
  // Fail-closed: a game with no policy row (or a malformed row) REFUSES; a
  // missing requirement must never read as "no requirements".
  const policy = gamePolicyOf(entry.game);
  if (!policy.ok) return refused(policy.issues);
  if (policy.policy.requiresPlayingSet === true && snapshot.playing === null) {
    return refused([
      issue(
        "no-playing-set",
        `no playing set is accepted: the ${entry.game} game authors nothing until one is, so the ghost is refused`,
      ),
    ]);
  }

  if (!targetExists(target.target, snapshot)) {
    const label =
      target.target.kind === "word" || target.target.kind === "loop"
        ? target.target.slug
        : target.target.kind;
    return refused([
      issue("dangling-target", `the target "${label}" is not on the map`),
    ]);
  }

  // ONE FILE, ONE MOVE (crash sufficiency, ADR-0025 decision 3). The move's
  // files may be TARGET-DEPENDENT (STORY 21.1: a note is named by the card it
  // is about), so the list is read for this target, never assumed. STORY 21.6's
  // removals keep the same single-file rule: a removal ghosts ONE thing.
  const declaredFiles = filesOf(entry, target.target);
  if (declaredFiles.length !== 1) {
    return refused([
      issue("single-file", "v1 moves write exactly one file"),
    ]);
  }
  const file = declaredFiles[0];

  // The derived steps are the deriver's; the stored list is never read. The
  // base bytes ride along for the one move that mints a slug against the file.
  const steps = entry.steps(
    target.target,
    params.params,
    snapshot.files[file] ?? null,
  );
  if (steps.length === 0) {
    return refused([issue("params", "the move derived no step")]);
  }
  const stepFiles = new Set(steps.map((step) => step.file));
  if (stepFiles.size !== 1 || !stepFiles.has(file)) {
    return refused([
      issue(
        "single-file",
        `the derived steps write ${[...stepFiles].join(", ")}; the move writes ${file}`,
      ),
    ]);
  }

  // The pin names exactly the file the move writes — no extra, no missing.
  const pinKeys = Object.keys(expect.expect.files).sort();
  const declared = [...declaredFiles].sort();
  const extra = pinKeys.filter((path) => !declared.includes(path));
  if (extra.length > 0) {
    return refused([
      issue(
        "single-file",
        `the pin names ${extra.join(", ")}, which the move never writes`,
      ),
    ]);
  }
  if (pinKeys.length !== declared.length) {
    return refused([issue("pin", `the pin does not name ${file}`)]);
  }
  const pinDigest = expect.expect.files[file];

  // The dry run: apply the derived steps to the snapshot's bytes. Three ops,
  // one rule each — append one line, remove one line (or the file itself), or
  // rewrite one line in place (STORY 21.8's move and rename).
  const runFiles: DryRunFile[] = [];
  let current = snapshot.files[file] ?? null;
  for (const step of steps) {
    let after: string | null;
    if (step.op === "append") {
      after = appendLine(current, step.line);
    } else if (step.op === "remove") {
      if (step.line === undefined) {
        // No line named: the file itself goes (a note is one file).
        after = null;
      } else {
        const without = withoutLine(current, step.line);
        if (without === undefined) {
          return refused([
            issue(
              "append-only",
              `the dry run would remove "${step.line}", which ${file} does not hold`,
            ),
          ]);
        }
        after = without;
      }
    } else if (step.op === "replace") {
      const replaced = replacedLine(current, step.line, step.with);
      if (replaced === undefined) {
        return refused([
          issue(
            "append-only",
            `the dry run would rewrite "${step.line}", which ${file} does not hold`,
          ),
        ]);
      }
      after = replaced;
    } else {
      return refused([
        issue(
          "append-only",
          `this build knows appends, removals and one-line rewrites; the step op "${String(
            (step as { op?: unknown }).op,
          )}" is none of them`,
        ),
      ]);
    }
    runFiles.push({ path: file, before: current, after });
    current = after;
  }
  const run: DryRun = { steps, files: runFiles };

  // The crash story: applied but unmarked. Every step's line is the file's tail
  // and the base before it is the pinned base — the write already landed.
  const applied = reconciled(steps, snapshot.files[file] ?? null, pinDigest);

  const normalized: GhostEnvelope = {
    format: GHOST_FORMAT,
    id: candidate.id,
    move: moveOf(entry),
    target: target.target,
    params: params.params,
    expect: expect.expect,
    rationale: candidate.rationale,
    steps,
    proposals: [],
  };

  if (applied) {
    return { ok: true, envelope: normalized, run, applied: true, issues: [] };
  }

  // Closure by dry application: each produced file must parse back as exactly
  // its base plus the one new claim, and nothing may be rewritten or dropped.
  const before = snapshot.files[file] ?? null;
  const closureIssues: GhostIssue[] = [];
  for (const output of run.files) {
    closureIssues.push(
      ...entry.closure(
        target.target,
        params.params,
        output.before,
        output.after,
      ),
    );
  }
  if (closureIssues.length > 0) return refused(closureIssues);

  // The base pin against the file actually read (the accept re-checks at the
  // write itself — `applyGhost` reads the file it is about to replace).
  if (pinDigest !== sha256Hex(before ?? "")) {
    return refused([
      issue(
        "pin",
        `${file} moved since the ghost was built (its base pin no longer matches)`,
      ),
    ]);
  }

  return { ok: true, envelope: normalized, run, applied: false, issues: [] };
}

/**
 * The agent's body keys: the model may author `move`, `target`, `params` and
 * `rationale` and NOTHING else (ADR-0024 decision 6). The app mints the id, the
 * pin, the steps and the proposals sibling, so a body carrying any of them — or
 * any name slot — is refused before wrapping. Unknown keys are refused for the
 * agent (hand tolerance is for humans; the envelope is re-validated the same).
 */
export function agentBodyIssues(body: unknown): GhostIssue[] {
  if (!isPlainObject(body)) {
    return [issue("intake", "the patch body is not a JSON object")];
  }
  return keyIssuesOf(body, AGENT_PATCH_KEYS);
}
