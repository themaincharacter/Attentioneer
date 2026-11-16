import type { GhostMove, GhostTarget } from "./envelope";
import type { GhostIssue, GhostIssueCode } from "./issues";

/**
 * THE RUN STATE (Epic 14 story 1, ADR-0031) — one ghost session's ephemeral
 * trace: the attempts it has made and the words each refusal already said,
 * held in MEMORY for the session's open moment and discarded when it closes.
 *
 * THE RUN IS THE GHOST SESSION'S OPEN MOMENT (ADR-0031's final amendments): the
 * session's `open()` discards this state exactly as it discards the inbox, so
 * the trace never crosses a task boundary. This module has NO writer, no port,
 * no clock and no storage import: nothing here can reach a file, a bridge, a
 * browser store or a React surface. The only state it keeps is the closures
 * below, and `discard()` empties them. A test asserts the module's imports and
 * its absence of I/O; the "nothing on disk" behaviour is asserted by a
 * byte-identical fixture tree around a session's refusals and close.
 *
 * THE RUN KEY (ADR-0031, final amendments) = (move, target, issue code):
 * "same refusal = the same key". The encoding is length-prefixed, so no two
 * different triples can collide (a NUL, a dash or a colon in a slug cannot
 * forge another refusal's identity). The key is OPAQUE outside this module: a
 * caller builds one only through `runKeyOf` and otherwise keeps it as a value.
 * A `word` and a `loop` with the same slug are different targets; a link's
 * direction is part of its identity; a spot's coordinates are part of its.
 *
 * THE COUNTER: `N_RUN_LIMIT` is the bound (ADR-0031, FINAL AMENDMENTS:
 * "N = 3 (in this decision; changed only by ADR amendment)"). It lives HERE,
 * in run state only. Tests read it; the person never does — it is never
 * rendered, never persisted, never spoken. Changing it is an ADR amendment,
 * not a tuning knob (the comment at the constant says so). An attempt is one
 * REFUSED INTAKE: a reply that names the same code twice is still one attempt
 * at that refusal, and a key's attempt count is the only arithmetic here.
 *
 * THE REFUSAL REASONS are the sentences the refusals already said
 * (`GhostIssue.message`), kept verbatim and in arrival order. `sentencesForTarget`
 * is what the packet's bounded run block reads (ADR-0031's packet bound,
 * amending ADR-0026): at most N sentences, one per refusal KEY — never a trail
 * (the same refusal's words appear once), never an attempt count, never an
 * ordering beyond arrival. The block is keyed on the (move, target) pair
 * because a packet is asked BEFORE the next reply has an issue code; the code
 * remains the counter's granularity.
 *
 * THE MARK-READ (Epic 14 story 2, ADR-0031's final amendments): at RUN START
 * (the session's open moment) the harness reads which targets carry an open
 * mark and fixes that reading here. The read answers the refusal's stand-down:
 * a target marked at start does not fire the refusal for the rest of the run —
 * the mark is READ as "the person has spoken here", never rendered, never a
 * switch, never a second meaning for the mark (ADR-0009's "not settled" stands
 * untouched). The reading is FIXED at the start: a mark cast later is never
 * seen, and a mark withdrawn later does not cancel the read — it also does not
 * reset the counter, which lives until the session closes, so the refusal can
 * fire in a LATER task and never within the one that started marked. Loops are
 * EXEMPT: a mark has no loop target form (ADR-0009), so no mark can sit on a
 * loop, and a word mark whose slug spells a loop's name stands the WORD down,
 * never the loop. The run state never writes a mark and never decides what one
 * means; it only remembers what the session read.
 *
 * Provisional: the module's home (`ghost/runState.ts`), the key's encoding,
 * the block's shape (sentences only) and the fact that every refused intake is
 * recorded. Story 2 fires on every refusal code alike: a reply that names a
 * readable move and target records one attempt per code, and any key reaching
 * the bound can fire (the mark reading is the only stand-down).
 */

/**
 * THE COUNTER'S BOUND — N = 3, per ADR-0031's FINAL AMENDMENTS ("N = 3 (in this
 * decision; changed only by ADR amendment)"). It is run state only: never
 * rendered, never persisted, never spoken. Changing it requires amending
 * ADR-0031, not editing this line.
 */
export const N_RUN_LIMIT = 3;

/** A run key, opaque outside this module (build one with `runKeyOf`). */
export type RunKey = string;

/** One refused intake: the move and target it named, and why it was refused. */
export interface RunRefusedAttempt {
  /** The move the reply named (shape-checked before it reaches this module). */
  readonly move: GhostMove;
  /** The one target the reply named. */
  readonly target: GhostTarget;
  /** The refusals the intake produced (codes are the key's granularity). */
  readonly issues: readonly GhostIssue[];
}

/** What one refused intake did at one key. */
export interface RunStrike {
  /** The refusal's run key: (move, target, issue code). */
  readonly key: RunKey;
  /** How many attempts this key has now had, this one included (never shown). */
  readonly attempts: number;
  /**
   * Did this key reach `N_RUN_LIMIT` on this attempt? Story 2's trigger. It is
   * pure counting: the mark's stand-down is a SEPARATE read (`markedAtStart`),
   * never folded in here, so the count means the same thing marked or not.
   */
  readonly limitReached: boolean;
}

/** What one refused intake did, key by key. */
export interface RunRecord {
  /** One strike per distinct issue code the reply named. */
  readonly strikes: readonly RunStrike[];
  /** Did ANY of this attempt's keys reach the bound? (never rendered) */
  readonly limitReached: boolean;
}

/** One session's run state: the attempts, their reasons, the counter. */
export interface RunState {
  /**
   * Record ONE refused intake. Each distinct issue code is one attempt at that
   * refusal's key; the same code twice in one reply is one attempt. An attempt
   * whose reply named no readable move/target never reaches this module (it has
   * no key to count).
   */
  recordRefusedAttempt(attempt: RunRefusedAttempt): RunRecord;
  /** How many attempts this key has had (a count: tests and the harness see it). */
  attemptsFor(key: RunKey): number;
  /**
   * The refusal sentences already said for this move AND target, deduped by key
   * and in arrival order, at most `N_RUN_LIMIT` — the packet's run block, never
   * a count and never a trail. The issue code is the counter's granularity;
   * the block cannot know the next reply's code.
   */
  sentencesForTarget(
    move: GhostMove,
    target: GhostTarget,
  ): readonly string[];
  /**
   * THE MARK-READ (Epic 14 story 2, ADR-0031): fix the targets that carried an
   * open mark at RUN START (the session's `open()`), replacing any earlier
   * reading. Called once per run; a run that never started has read no marks.
   * The list is plain targets — the caller has already read and mapped the map's
   * marks, so this module never touches marks.jsonl, never writes one and never
   * decides what a mark means. It also does not touch the counter: a mark's
   * presence is the refusal's stand-down, never a reset.
   */
  start(marked: readonly GhostTarget[]): void;
  /**
   * Did this target carry an open mark at run start? The refusal's stand-down
   * read. Fixed for the run: a mark cast after the start answers false, a mark
   * withdrawn after the start still answers true. A loop always answers false
   * (a mark has no loop target form: marks cannot sit on a loop).
   */
  markedAtStart(target: GhostTarget): boolean;
  /** Discard the whole run (the session closed). Idempotent; nothing is written. */
  discard(): void;
}

/** The run's parts as a reply spells them, when it spells readable ones. */
export interface RunParts {
  readonly move: GhostMove;
  readonly target: GhostTarget;
}

/**
 * Length-prefix one string part, so concatenation cannot forge another key:
 * `"1:a1:b"` is `["a","b"]`, never `["a1:b"]`.
 */
function part(value: string): string {
  return `${value.length}:${value}`;
}

/** A target's run-key share: its kind and its own identity, nothing else. */
function targetKeyOf(target: GhostTarget): string {
  switch (target.kind) {
    case "word":
      return part("word") + part(target.slug);
    case "loop":
      return part("loop") + part(target.slug);
    case "spot":
      return part("spot") + part(String(target.x)) + part(String(target.y));
    case "link":
      return part("link") + part(target.from) + part(target.to);
  }
}

/** A move's run-key share: its family and verb (the registry's identity). */
function moveKeyOf(move: GhostMove): string {
  return part(move.family) + part(move.verb);
}

/**
 * THE RUN KEY: (move, target, issue code). Same refusal, same key; any of the
 * three changing makes another key. Opaque outside the module by construction —
 * callers pass it back, never parse it.
 */
export function runKeyOf(
  move: GhostMove,
  target: GhostTarget,
  code: GhostIssueCode,
): RunKey {
  return (
    part("run") + moveKeyOf(move) + targetKeyOf(target) + part(code)
  );
}

/** A plain JSON object (never an array, never null). */
function objectOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** A non-empty string, or null (the shape a run's identity may carry). */
function textOf(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** A move shape, copied fresh: extra keys never become part of a key. */
function moveOf(value: unknown): GhostMove | null {
  const record = objectOf(value);
  if (record === null) return null;
  const family = textOf(record.family);
  const verb = textOf(record.verb);
  if (family === null || verb === null) return null;
  return { family, verb };
}

/** A target shape, copied fresh: extra keys never become part of a key. */
function targetOf(value: unknown): GhostTarget | null {
  const record = objectOf(value);
  if (record === null) return null;
  if (record.kind === "word" || record.kind === "loop") {
    const slug = textOf(record.slug);
    if (slug === null) return null;
    return record.kind === "word"
      ? { kind: "word", slug }
      : { kind: "loop", slug };
  }
  if (record.kind === "spot") {
    const x = record.x;
    const y = record.y;
    if (
      typeof x !== "number" ||
      typeof y !== "number" ||
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return null;
    }
    return { kind: "spot", x, y };
  }
  if (record.kind === "link") {
    const from = textOf(record.from);
    const to = textOf(record.to);
    if (from === null || to === null) return null;
    return { kind: "link", from, to };
  }
  return null;
}

/**
 * The run's parts from a reply body, or null when the reply names no readable
 * move and target. A run is keyed on a refusal: a body that cannot say what it
 * is about has no key to count (the refusal is still spoken; it is just not a
 * run attempt). Pure and map-independent.
 */
export function runPartsOf(body: unknown): RunParts | null {
  const record = objectOf(body);
  if (record === null) return null;
  const move = moveOf(record.move);
  const target = targetOf(record.target);
  if (move === null || target === null) return null;
  return { move, target };
}

/** The refusal sentence a refused intake already said (verbatim). */
function sentenceOf(refusal: GhostIssue): string {
  return typeof refusal.message === "string" ? refusal.message : "";
}

/** One recorded refusal, kept only while the session is open. */
interface RunEntry {
  readonly key: RunKey;
  readonly moveKey: string;
  readonly targetKey: string;
  readonly sentence: string;
}

/**
 * Open an empty run state. It lives in the session's closure; `discard()`
 * empties it at the session's close. No clock, no ids, no ordering field:
 * arrival order is the array's order and nothing else orders anything.
 */
export function createRunState(): RunState {
  const entries: RunEntry[] = [];
  const attemptsByKey = new Map<RunKey, number>();
  // THE MARK-READ: the targets that carried an open mark at run start, keyed
  // like a run target. Fixed for the run (nothing re-reads it) and NEVER a
  // counter: marking or unmarking a target changes no attempt here.
  let markedTargetKeys = new Set<string>();

  function recordRefusedAttempt(attempt: RunRefusedAttempt): RunRecord {
    const moveKey = moveKeyOf(attempt.move);
    const targetKey = targetKeyOf(attempt.target);
    const seenCodes = new Set<GhostIssueCode>();
    const strikes: RunStrike[] = [];
    for (const refusal of attempt.issues) {
      // One reply is one attempt per refusal code: the same code twice must not
      // read as two strikes at the same key.
      if (seenCodes.has(refusal.code)) continue;
      seenCodes.add(refusal.code);
      const key = runKeyOf(attempt.move, attempt.target, refusal.code);
      const attempts = (attemptsByKey.get(key) ?? 0) + 1;
      attemptsByKey.set(key, attempts);
      entries.push({
        key,
        moveKey,
        targetKey,
        sentence: sentenceOf(refusal),
      });
      strikes.push({
        key,
        attempts,
        limitReached: attempts >= N_RUN_LIMIT,
      });
    }
    return {
      strikes,
      limitReached: strikes.some((strike) => strike.limitReached),
    };
  }

  function sentencesForTarget(
    move: GhostMove,
    target: GhostTarget,
  ): readonly string[] {
    const moveKey = moveKeyOf(move);
    const targetKey = targetKeyOf(target);
    const order: RunKey[] = [];
    const latest = new Map<RunKey, string>();
    for (const entry of entries) {
      if (entry.moveKey !== moveKey || entry.targetKey !== targetKey) continue;
      // One line per refusal key, never one per attempt: the block is the
      // sentences, not a trail. The latest words for the key stand (a refusal
      // reworded in a later attempt says the newer thing), at its first place.
      if (!latest.has(entry.key)) order.push(entry.key);
      latest.set(entry.key, entry.sentence);
    }
    const sentences: string[] = [];
    for (const key of order) {
      const sentence = latest.get(key);
      if (sentence === undefined || sentence.trim() === "") continue;
      sentences.push(sentence);
      if (sentences.length >= N_RUN_LIMIT) break;
    }
    return sentences;
  }

  return {
    recordRefusedAttempt,
    attemptsFor(key) {
      return attemptsByKey.get(key) ?? 0;
    },
    sentencesForTarget,
    start(marked) {
      markedTargetKeys = new Set(marked.map(targetKeyOf));
    },
    markedAtStart(target) {
      return markedTargetKeys.has(targetKeyOf(target));
    },
    discard() {
      entries.length = 0;
      attemptsByKey.clear();
      markedTargetKeys = new Set();
    },
  };
}
