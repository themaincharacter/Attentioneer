/**
 * ONE ACP RUN (Epic 18 story 2; PROVISIONAL).
 *
 * WHAT THIS FILE IS: the lifecycle the card will later drive — compose the
 * child's environment from the row, spawn it, create a session in a fresh
 * session directory, send ONE prompt, relay every streamed update in arrival
 * order, answer a permission request with the CALLER'S reply, let the caller
 * cancel, and close. It composes the transport from story 18.1; it does not
 * re-implement framing, correlation or the wire.
 *
 * THE ENV RULE, IN ONE PLACE. The spike (18.1) found the first break is
 * credentials: `session/prompt` was refused with `-32603` because the spawned
 * server had no DEEPSEEK_API_KEY, and ACP advertises no auth (`authMethods: []`).
 * A child therefore receives a stored key ONLY through an explicit env entry
 * on its row, naming one provider row; the key is read from the store in
 * memory for this spawn and appears in no argv, no file and no log line. The
 * run's first progress entry COMES BEFORE THE SPAWN and states, in one
 * sentence, which key it will receive — or that it receives none.
 *
 * WHAT IS INHERITED: PATH and HOME, when they are set, and NOTHING ELSE. Not
 * this app's key store, not the parent's DEEPSEEK_API_KEY, not any other
 * variable. The spawned child's environment is exactly that pair plus the
 * row's declared entries. (A Windows `.cmd` shim may in time want SystemRoot;
 * that would be a second explicit name, never a blanket inherit.)
 *
 * A PARTIAL NEVER COUNTS AS A RESULT. Only a turn that settles `end_turn`
 * produces `answer`; stopped, failed and timed-out keep what arrived as
 * `partial`, named as a partial, and every one of them kills the child.
 *
 * KILL ON EVERY PATH. Cancellation sends `session/cancel` first, gives the
 * server a short grace to settle the turn, then close kills the child. A
 * timeout, a dying server and an ordinary finish all pass through the same
 * `finish`, so there is no path that leaves an orphan. The run writes nothing
 * to its session directory and nothing to the map.
 *
 * STORY 21.1 — A RUN MAY CONTINUE A SESSION THE SERVER ALREADY HAS
 * (PROVISIONAL). When the caller hands `resume` (the server's session id and
 * the EXACT folder it was recorded in), the session step asks the server to
 * resume that pair instead of making a new session; the prompt, the update
 * stream, the permission path and the kill are the SAME code, so a follow-up
 * is one ordinary spawn that happens to reach an existing memory. A resume
 * whose cwd is absent or is another folder is refused BEFORE any spawn.
 *
 * STORY 22.5 — THE RUN MAY ASK FOR A MODEL THE PERSON PICKED (PROVISIONAL).
 * The card's record may carry one of the tool's own model VALUES (`model`),
 * and the tool's own option id comes with it from the recorded options. When
 * it does, the run speaks `session/set_config_option` AFTER the session step
 * (new or resumed) and BEFORE the prompt, so the turn answers on the chosen
 * model rather than the tool's default. A set the tool refuses ends the run
 * with the tool's own sentence: a failed choice never becomes a quiet default.
 * The session step's `configOptions` come back with the result, verbatim, so
 * the caller can record what this machine's tool offers.
 *
 * 18.3b: WHERE THIS FILE RUNS NOW. Story 18.3 proved the card under Bun and
 * then could not run it in the shipped app: this module needs `node:fs` and a
 * spawner, and the window is a WebView with neither, so pressing RUN there was
 * refused. The lane therefore lives in the Bun sidecar (`sidecar/runs.ts`),
 * which is the app's only process that talks to the outside world. The sidecar
 * hands this module a RESOLVED environment map (the key crossed the wire in the
 * payload, exactly as a turn's does); the map is used as given, PATH/HOME are
 * the only names added, and this module still reads no key store. The window
 * no longer imports this file — it reads the vocabulary from `acpEntries.ts`.
 *
 * WHAT STAYS UNPROVEN WITHOUT A REAL KEY. The spike saw no live
 * `session/update`, no live permission request, no live cancel and no
 * `session/close` (the transport kills the child instead), because the first
 * prompt was refused for a missing DEEPSEEK_API_KEY. Every shape and every
 * ending here is proven against the fake server and matches the installed
 * server's source, but a real model turn, a real permission prompt and a real
 * cancel still need a person's working key. This module never asks for one,
 * never stores one and never writes one.
 */

// @ts-expect-error this module runs under Bun, whose node builtins have no types in this build
import { mkdtempSync } from "node:fs";
// @ts-expect-error no node types in this build
import { tmpdir } from "node:os";
// @ts-expect-error no node types in this build
import { join } from "node:path";

import {
  AcpFailure,
  acpSentence,
  startAcp,
  type AcpNotificationMessage,
  type AcpServerRequest,
  type AcpSpawner,
  type AcpTransport,
} from "./acp";
import {
  acpDeclaration,
  acpMissingKeySentence,
  acpResolvedDeclaration,
  acpScopeDeclaration,
  type AcpSpec,
} from "./acpSpecs";
// 18.3b: the progress vocabulary lives in its own window-safe module (`acpEntries`),
// because the card reads these entries off the wire and must never import this
// file — its `node:fs`, `node:os` and spawner are what the window lacks.
import type {
  AcpEnding,
  AcpPermissionAsk,
  AcpPermissionOption,
  AcpProgressEntry,
} from "./acpEntries";

export type {
  AcpEnding,
  AcpPermissionAsk,
  AcpPermissionOption,
  AcpPermissionOutcome,
  AcpProgressEntry,
} from "./acpEntries";

/** The environment names a run inherits, and the complete list of them. */
export const ACP_INHERITED_ENV = ["PATH", "HOME"] as const;

/** How long one request may wait while the run's own budget is the backstop. */
export const ACP_REQUEST_TIMEOUT_MS = 30_000;

/**
 * STORY 21.0 — HOW MUCH LATER THAN THE BUDGET THE PROMPT'S WAIT EXPIRES.
 *
 * The budget's own timer is armed a fraction of a millisecond AFTER the clock
 * reading this wait is computed from, so a wait of exactly the remaining
 * budget can land FIRST. When it does, the request timeout states "the run
 * failed" while the run's own clock was about to state a timed-out ending —
 * and a permission request still waiting gets recorded as cancelled rather
 * than unanswered. The run's budget timer is the one authority for a timed-out
 * ending, so the prompt's wait always outlasts it by this margin; the prompt
 * request is only ever a backstop for a transport that stops reading at all.
 */
export const ACP_PROMPT_OUTLAST_MS = 100;

/**
 * STORY 22.2 — HOW LONG THE PROMPT MAY WAIT (PURE, PROVISIONAL). \`session/prompt\`
 * answers at TURN END, so its wait is whatever the run's own budget has left —
 * never the flat request default that suits a handshake — plus the stated
 * outlast. A run whose budget has already gone still waits that margin, so the
 * budget timer can state the ending first rather than a request timeout.
 */
export function acpPromptTimeoutMs(
  budgetMs: number,
  elapsedMs: number,
): number {
  return (
    Math.max(1, Math.ceil(budgetMs - elapsedMs)) + ACP_PROMPT_OUTLAST_MS
  );
}

/** How long a cancelled turn may take to settle before the child is killed. */
export const ACP_CANCEL_GRACE_MS = 3_000;

/** The prefix of a run's session directory under the app's temp root. */
export const ACP_SESSION_PREFIX = "attentioneer-acp-session-";

/** The sentences the run reports (PROVISIONAL wording). */
export const ACP_RUN_SENTENCES = {
  timedOut:
    "the run ran out of its budget, so what arrived is a partial, not a result",
  /**
   * STORY 18.4 — the run waited for a person, nobody answered, and the budget
   * ran out. The transcript states that the request went UNANSWERED; it is
   * never a refusal the person did not make and never a silent yes.
   */
  permissionUnanswered:
    "the run ran out of its budget with a permission request unanswered, so what arrived is a partial, not a result",
  noDirectory: "the run's session directory could not be made",
  noSession:
    "the server did not create a session, so the run is not a finished run",
  /**
   * STORY 21.1 — A CONTINUATION NAMED ONE FOLDER AND THE RUN STARTED IN
   * ANOTHER (PROVISIONAL). The tool refuses a mismatched directory, so this is
   * refused here too, BEFORE the spawn: nothing is started, and the sentence
   * is the whole of the answer.
   */
  resumeOtherFolder:
    "the session was recorded in another folder, so the run was not started",
} as const;

/**
 * STORY 22.3 — HOW MUCH OF THE CHILD'S LAST LINE AN ENDING MAY CARRY
 * (PROVISIONAL). The tail is diagnostics, not a transcript: one line, one short
 * sentence's worth. The ending remains the run's own sentence with an aside,
 * never a second report.
 */
export const ACP_CHILD_WORDS_MAX = 200;

/**
 * STORY 22.3 — IS THIS THE TRANSPORT'S TEARDOWN SENTENCE? (PROVISIONAL)
 *
 * `the transport closed` is what a close says to every pending request, and
 * `the server exited (code N)` is what the exit watcher says when the child
 * goes away. EITHER can be TRUE and still not be the run's ending: the run's
 * own budget, or a person's stop, is what tore the child down, and the run
 * already knows the sentence for that. This predicate is what tells the two
 * apart; it names no cause, only the transport's vocabulary.
 */
export function acpIsTransportTeardown(sentence: string): boolean {
  return (
    sentence === "the transport closed" ||
    /^the server exited \(code -?\d+\)$/.test(sentence)
  );
}

/**
 * STORY 22.3 — A CHILD THAT REALLY DIED EARLY SAYS SO, AND ITS LAST WORDS
 * (PURE, PROVISIONAL). The exit sentence is kept, and the child's own newest
 * stderr line rides after it, collapsed to one line and clipped; a child that
 * wrote nothing on stderr gets the bare sentence. This is the ONLY ending that
 * carries the tail: the run's own endings say the run's own words.
 */
export function acpChildExitSentence(sentence: string, tail: string): string {
  const words = acpSentence(tail);
  if (words === "") return sentence;
  const room = ACP_CHILD_WORDS_MAX;
  const bounded =
    words.length <= room
      ? words
      : words.slice(0, Math.max(1, room - 1)).trimEnd() + "…";
  return sentence + "; its last words were: " + bounded;
}

/**
 * The caller's reply: one option id, or null for "cancelled". The policy is
 * the smallest one (18.4 decides who decides); this is only what crossed.
 */
export interface AcpPermissionReply {
  optionId: string | null;
}

/** What one run produced. `answer` is the ONLY result; `partial` is not one. */
export interface AcpRunResult {
  ending: AcpEnding;
  /** The agent's text when the turn completed; null for every other ending. */
  answer: string | null;
  /** What arrived before a non-completing ending; null when it completed. */
  partial: string | null;
  /** The server's stop reason when it gave one. */
  stopReason: string | null;
  /** One quiet sentence for failed and timed-out runs. */
  sentence: string | null;
  /** The ordered sequence the caller watched, kept whole. */
  entries: AcpProgressEntry[];
  sessionId: string | null;
  directory: string | null;
  /** The declaration that was emitted before the spawn. */
  declaration: string;
  /** The child's exit code once it was killed and reaped; null if never spawned. */
  childExitCode: number | null;
  /**
   * STORY 22.5 — THE SESSION STEP'S OWN OPTIONS, AS THEY ARRIVED
   * (PROVISIONAL). `session/new` and `session/resume` both answer with the
   * tool's `configOptions`; the run keeps that list so the caller can record
   * what the tool offers on this machine. It is the answer VERBATIM, never
   * interpreted here — the caller reads the model option out of it. `null` means
   * the answer carried no list at all; a run that never reached its session
   * step also has null.
   */
  configOptions: unknown[] | null;
}

/** The caller's side of a run: watch, stop, close. */
export interface AcpRunHandle {
  /** Settles once the run has ended and the child is dead. */
  readonly result: Promise<AcpRunResult>;
  /** Ask the server to cancel, then let the run settle (it closes itself). */
  cancel(): void;
  /** Close now: cancel, kill, and settle as stopped. Safe after completion. */
  close(): Promise<void>;
}

/**
 * STORY 21.0 — THE CLOCK A RUN READS, AND THE TIMERS IT ARMS (PROVISIONAL).
 * One narrow pair, the same shape the platform gives, so production's default
 * is the platform itself and a test's is a hand it can move.
 */
export interface AcpRunClock {
  /** Milliseconds since the epoch; only differences are used. */
  now(): number;
  /** Arm one timer and hand back its handle. */
  setTimeout(callback: () => void, ms: number): unknown;
  /** Drop one armed timer. */
  clearTimeout(handle: unknown): void;
}

/** The clock production uses: the platform's own timers and wall clock. */
export const ACP_REAL_CLOCK: AcpRunClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/** What a run needs from the app. Everything here is injected and testable. */
export interface AcpRunOptions {
  /**
   * The key for ONE provider row, read at run time and never logged. Not used
   * when `resolvedEnv` is given: the values already crossed a wire.
   */
  readKey: (providerId: string) => Promise<string>;
  /**
   * STORY 18.3b — A RESOLVED ENVIRONMENT MAP, as the card's window sent it.
   * The sidecar names no provider row and reads no key store: the payload's
   * map IS the grant, and PATH/HOME are still the only other names. Never
   * logged, never written, never placed in an argv.
   */
  resolvedEnv?: Readonly<Record<string, string>>;
  /**
   * THE CALLER'S ANSWER to a permission request (the person's choice). STORY
   * 18.4: the run WAITS on this promise — the sidecar's lane resolves it when a
   * person presses allow-once or refuse, and leaves it pending when nobody
   * does (the budget then ends the run as a timeout). There is no default and
   * no fallback answer here: an unanswered await means the run waits.
   */
  replyToPermission: (
    request: AcpPermissionAsk,
  ) => AcpPermissionReply | Promise<AcpPermissionReply>;
  /**
   * STORY 18.4 — the ask AS IT ARRIVES, before any reply. The sidecar turns it
   * into one `run-permission` line so the card can show what the tool wants
   * and offer its two verbs. Optional: a run with nobody watching simply waits.
   */
  onPermissionAsk?: (ask: AcpPermissionAsk) => void;
  /** Injected for tests; the default is the Bun runtime's spawn. */
  spawn?: AcpSpawner;
  /** The environment the run may inherit FROM; only PATH/HOME are read. */
  environment?: Record<string, string | undefined>;
  /** The temp root the session directory is made under; the OS temp by default. */
  sessionRoot?: string;
  /**
   * STORY 19.2 — WHERE THE RUN STARTS, when the person bound a project card and
   * declared a boundary (PROVISIONAL). An ABSOLUTE folder path; it REPLACES the
   * fresh session directory. Absent (or relative) keeps exactly the old rule: a
   * fresh temp directory and nothing assumed about where a run lands.
   */
  cwd?: string;
  /**
   * STORY 19.2 — WHAT THE PERSON DECLARED the run may do there (PROVISIONAL).
   * It only shapes the declaration sentence here: who auto-answers an ask is
   * the lane's decision (sidecar/runs.ts), not this lifecycle's.
   */
  scope?: { boundary: "read" | "write" };
  /**
   * STORY 21.1 — CONTINUE THIS SESSION INSTEAD OF MAKING ONE (PROVISIONAL).
   * The pair is the delegate's own: its session id and the EXACT folder it was
   * recorded in. A resume REQUIRES `cwd` to be that same folder; anything else
   * is refused before any spawn, because the tool refuses mismatched
   * directories and a follow-up must never land in a folder whose delegate has
   * none of the earlier turns. The run is still ONE spawn, killed on every
   * exit path: a continuation changes which session the prompt reaches, not how
   * the child lives and dies.
   */
  resume?: { sessionId: string; cwd: string };
  /**
   * STORY 22.5 — THE MODEL THE CARD'S RECORD ASKS FOR (PROVISIONAL). The pair is
   * the TOOL's: the id of the config option a person picked from the tool's own
   * list, and that list's value string. The id came from the recorded options
   * (the fact layer) — this run never hard-codes one — and the value is opaque,
   * so it rides to the server untouched. The set is spoken AFTER the session
   * step (the option only exists on a session) and BEFORE the prompt, so the
   * turn answers on the chosen model rather than the tool's default.
   */
  model?: { optionId: string; value: string };
  /** Shorten the row's budget (a caller's own deadline; tests use it too). */
  timeoutMs?: number;
  /**
   * STORY 22.2 — SHORTEN THE WAIT FOR EVERY REQUEST THAT IS NOT THE PROMPT
   * (PROVISIONAL). A caller may tighten it; the prompt's wait is never this
   * number, it is the run's remaining budget. Absent keeps
   * \`ACP_REQUEST_TIMEOUT_MS\`.
   */
  requestTimeoutMs?: number;
  /**
   * STORY 21.0 — THE RUN'S CLOCK AND TIMERS (INJECTED FOR TESTS). Production
   * passes nothing and gets the wall clock; a test hands over a clock it can
   * advance, so a budget can expire at a stated instant instead of a real one.
   * Every timer the run owns (the budget, the cancel grace) and every elapsed
   * reading comes from here, so no ending depends on how fast the machine is.
   */
  clock?: AcpRunClock;
  /** Every progress entry as it happens, in order. */
  onProgress?: (entry: AcpProgressEntry) => void;
  /** The name this client tells the server in `initialize`. */
  clientName?: string;
  clientVersion?: string;
}

/* ------------------------------------------------------------------ *
 * The pure part: declaration, inheritance, the composed environment.
 * ------------------------------------------------------------------ */

/**
 * The ONLY names a child inherits from this process: PATH and HOME, when they
 * are set. A missing one is simply absent; nothing is synthesized.
 */
export function acpInheritedEnvironment(
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const inherited: Record<string, string> = {};
  for (const name of ACP_INHERITED_ENV) {
    const value = environment[name];
    if (typeof value === "string") inherited[name] = value;
  }
  return inherited;
}

/**
 * Compose the child's environment: PATH/HOME plus the run's key values, and
 * nothing else. A key reaches a child by ONE of two roads, never both:
 *
 *   - a ROW declares an env entry naming a provider row, and the value was
 *     read from the store (18.2's rule, unchanged); or
 *   - `resolved` is given because the value CROSSED A WIRE instead (18.3b: the
 *     window resolved the row's keys and the sidecar uses that map as given —
 *     the sidecar reads no key store and names no provider row).
 *
 * Either way an absent value is simply not set, and nothing else in
 * `environment` can ride along: a key this process holds is invisible unless
 * one of those two roads names it.
 */
export function acpRunEnvironment(
  spec: AcpSpec,
  keys: ReadonlyMap<string, string>,
  environment: Record<string, string | undefined>,
  resolved?: Readonly<Record<string, string>>,
): Record<string, string> {
  const env = acpInheritedEnvironment(environment);
  for (const entry of spec.env) {
    const value = keys.get(entry.key);
    if (value !== undefined && value !== "") env[entry.name] = value;
  }
  for (const [name, value] of Object.entries(resolved ?? {})) {
    if (value !== "") env[name] = value;
  }
  return env;
}

/**
 * Make the run's fresh session directory under the app's temp root. There is
 * no other cwd policy: a run must not start in whatever directory the window
 * happened to have.
 */
export function createSessionDirectory(root?: string): string {
  return mkdtempSync(join(root ?? tmpdir(), ACP_SESSION_PREFIX));
}

/* ------------------------------------------------------------------ *
 * The run.
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * STORY 19.2 — IS THIS THE ABSOLUTE FOLDER A RUN MAY START IN? (PROVISIONAL)
 * POSIX's leading slash, a Windows drive and a UNC all count. The WIRE's reader
 * refuses every other spelling, so this is the second, local check a run makes
 * before trusting a cwd it was handed.
 */
function isAbsoluteFolderPath(value: string): boolean {
  if (value === "") return false;
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The runtime environment, read without assuming a Node type set. */
function runtimeEnvironment(): Record<string, string | undefined> {
  const runtime = (
    globalThis as {
      process?: { env?: Record<string, string | undefined> };
    }
  ).process;
  return runtime?.env ?? {};
}

/** Narrow a permission request into what a caller may decide on. */
function permissionAsk(request: AcpServerRequest): AcpPermissionAsk {
  const params = isRecord(request.params) ? request.params : {};
  const options: AcpPermissionOption[] = [];
  if (Array.isArray(params.options)) {
    for (const candidate of params.options) {
      if (!isRecord(candidate)) continue;
      const optionId = textOf(candidate.optionId);
      if (optionId === "") continue;
      options.push({
        optionId,
        name: textOf(candidate.name),
        kind: textOf(candidate.kind),
      });
    }
  }
  return {
    id: request.id,
    method: request.method,
    toolCall: params.toolCall,
    options,
  };
}

/** One update, summarized for the sequence but carried whole too. */
function summarizeUpdate(params: unknown): {
  updateKind: string;
  text: string;
  update: unknown;
} {
  const record = isRecord(params) ? params : {};
  const update = record.update;
  if (!isRecord(update)) return { updateKind: "unknown", text: "", update };
  const updateKind = textOf(update.sessionUpdate) || "unknown";
  const content = isRecord(update.content) ? update.content : {};
  const text = content.type === "text" ? textOf(content.text) : "";
  return { updateKind, text, update };
}

/**
 * Start ONE run. The promise settles after the child is dead, whatever the
 * ending; `cancel` is the caller's stop, and `close` is the same stop without
 * waiting for a graceful cancel.
 */
export function startAcpRun(
  spec: AcpSpec,
  prompt: string,
  options: AcpRunOptions,
): AcpRunHandle {
  const entries: AcpProgressEntry[] = [];
  // 18.3b: the sidecar is handed a RESOLVED map, so the declaration it reports
  // names those variable names; a run in the window's own process names rows.
  const keyDeclaration =
    options.resolvedEnv === undefined
      ? acpDeclaration(spec)
      : acpResolvedDeclaration(Object.keys(options.resolvedEnv));
  // STORY 19.2 — A BOUND RUN SAYS ITS BLAST RADIUS BEFORE IT SPAWNS. The scope
  // sentence is appended ONLY when both the folder and the declaration arrived,
  // so an unbound (or undeclared) run's declaration is the same sentence it
  // always was.
  const declaration =
    options.cwd === undefined || options.scope === undefined
      ? keyDeclaration
      : keyDeclaration +
        ". " +
        acpScopeDeclaration(options.cwd, options.scope.boundary);
  const budgetMs =
    options.timeoutMs ?? Math.max(1, Math.round(spec.timeoutMinutes * 60_000));

  let transport: AcpTransport | null = null;
  let sessionId: string | null = null;
  let directory: string | null = null;
  let childExitCode: number | null = null;
  let answerText = "";
  /**
   * STORY 22.5 — WHAT THE SESSION STEP ANSWERED ABOUT THE TOOL'S OPTIONS
   * (PROVISIONAL). Filled once, from `session/new` or `session/resume`, and
   * handed back with the result; the caller records what the tool offers.
   */
  let sessionConfigOptions: unknown[] | null = null;
  let cancelled = false;
  let timedOut = false;
  let settled = false;
  /**
   * STORY 18.4 — WHAT THE RUN IS WAITING FOR, if anything. Set before the
   * caller is asked and cleared when its answer arrives. If the run ends while
   * it is still here, the ending records the outcome honestly: unanswered for
   * a budget that ran out, cancelled for a stop.
   */
  let pendingPermission: AcpPermissionAsk | null = null;
  // The run's clock and timers are the platform's unless a test handed its own
  // (STORY 21.0): every deadline below is read from and armed on this one.
  const clock = options.clock ?? ACP_REAL_CLOCK;
  let timer: unknown = null;
  let grace: unknown = null;

  let resolveResult!: (result: AcpRunResult) => void;
  const result = new Promise<AcpRunResult>((resolve) => {
    resolveResult = resolve;
  });

  function emit(entry: AcpProgressEntry): void {
    entries.push(entry);
    try {
      options.onProgress?.(entry);
    } catch {
      // A watcher's failure is the watcher's; the run keeps its own record.
    }
  }

  /**
   * The ONE way a run ends. It clears both clocks, kills and reaps the child,
   * records the ending, and resolves — so no ending can leak a process.
   */
  async function finish(
    ending: AcpEnding,
    sentence: string | null = null,
    stopReason: string | null = null,
  ): Promise<void> {
    if (settled) return;
    settled = true;
    if (timer !== null) {
      clock.clearTimeout(timer);
      timer = null;
    }
    if (grace !== null) {
      clock.clearTimeout(grace);
      grace = null;
    }
    const live = transport;
    transport = null;
    if (live !== null) {
      // close() kills the child and waits for it; the spike's rule, kept.
      await live.close();
      childExitCode = live.exited;
    }
    // STORY 18.4 — A REQUEST STILL WAITING WHEN THE RUN ENDS is recorded as it
    // stood: unanswered when the budget ran out, cancelled when the run was
    // stopped or closed. It is never dressed as an answer nobody gave.
    if (pendingPermission !== null) {
      const ask = pendingPermission;
      pendingPermission = null;
      emit({
        kind: "permission",
        method: ask.method,
        toolCall: ask.toolCall,
        options: ask.options,
        reply: {
          outcome: ending === "timed-out" ? "unanswered" : "cancelled",
        },
      });
    }
    const partialText = answerText === "" ? null : answerText;
    emit({
      kind: "ended",
      ending,
      stopReason,
      sentence,
      partial: ending !== "completed" && partialText !== null,
    });
    resolveResult({
      ending,
      answer: ending === "completed" ? answerText : null,
      partial: ending === "completed" ? null : partialText,
      stopReason,
      sentence,
      entries: [...entries],
      sessionId,
      directory,
      declaration,
      childExitCode,
      configOptions: sessionConfigOptions,
    });
  }

  function failureSentence(error: unknown): string {
    return error instanceof AcpFailure
      ? error.sentence
      : "the run stopped before the turn settled";
  }

  /**
   * STORY 22.3 — THE RUN'S OWN ENDING WINS OVER A TEARDOWN SENTENCE.
   *
   * A pending request rejects the moment the transport tears the child down:
   * `the transport closed` from a close, `the server exited (code N)` from the
   * exit watcher. That rejection is TRUE, but it is the run's own teardown
   * talking, not a fact about the work. So the catch maps the transport's
   * sentence onto the ending the run is already giving it: this flag pair is
   * the run's own account of who ended the child, and an exit the run did not
   * cause keeps its own sentence (with the child's last words beside it).
   */
  function finishFromFailure(error: unknown): Promise<void> {
    const sentence = failureSentence(error);
    if (acpIsTransportTeardown(sentence)) {
      // The ending is already being given; a teardown that arrives during it
      // changes nothing.
      if (settled) return Promise.resolve();
      if (timedOut) {
        return finish(
          "timed-out",
          pendingPermission !== null
            ? ACP_RUN_SENTENCES.permissionUnanswered
            : ACP_RUN_SENTENCES.timedOut,
        );
      }
      if (cancelled) return finish("stopped", null, "cancelled");
      // NO run-side ending is pending: the child really died on its own. The
      // sentence stays honest and gains the one line the child last wrote.
      return finish(
        "failed",
        acpChildExitSentence(sentence, transport?.stderrTail ?? ""),
      );
    }
    if (timedOut) return finish("timed-out", ACP_RUN_SENTENCES.timedOut);
    if (cancelled) return finish("stopped", null, "cancelled");
    return finish("failed", sentence);
  }

  /** Answer one permission request with the caller's reply, then record it. */
  async function answerPermission(request: AcpServerRequest): Promise<void> {
    const ask = permissionAsk(request);
    // STORY 18.4: the run is WAITING from this line on. The ask is reported to
    // the caller's surface first, and nothing answers it but the person (or
    // the budget, honestly).
    pendingPermission = ask;
    try {
      options.onPermissionAsk?.(ask);
    } catch {
      // A surface that broke is not permission to act.
    }
    let reply: AcpPermissionReply;
    try {
      reply = await options.replyToPermission(ask);
    } catch {
      // A decider that broke is not permission to act.
      reply = { optionId: null };
    }
    // A run that ended while waiting recorded its own outcome in finish(); the
    // late answer changes nothing.
    if (settled) return;
    pendingPermission = null;
    const optionId =
      typeof reply.optionId === "string" && reply.optionId !== ""
        ? reply.optionId
        : null;
    emit({
      kind: "permission",
      method: ask.method,
      toolCall: ask.toolCall,
      options: ask.options,
      reply:
        optionId === null
          ? { outcome: "cancelled" }
          : { outcome: "selected", optionId },
    });
    try {
      await transport?.respondToPermission(request.id, optionId);
    } catch {
      // Closing and answering can race; the reply is simply not needed then.
    }
  }

  const cancel = (): void => {
    if (settled) return;
    cancelled = true;
    if (sessionId !== null) transport?.cancel(sessionId);
    // Give the turn a moment to settle as cancelled; if it cannot, the grace
    // timer closes the run and the child dies anyway.
    if (grace === null) {
      grace = clock.setTimeout(() => {
        void finish("stopped", null, "cancelled");
      }, ACP_CANCEL_GRACE_MS);
    }
  };

  const close = async (): Promise<void> => {
    if (!settled) {
      cancelled = true;
      if (sessionId !== null) transport?.cancel(sessionId);
      await finish("stopped", null, "cancelled");
    }
    await result;
  };

  // The overall budget starts now: it covers the handshake, the session and
  // the turn. Timeout is its own ending, never a failed one.
  const budgetStartedAt = clock.now();
  timer = clock.setTimeout(() => {
    if (settled) return;
    timedOut = true;
    // STORY 18.4: a request nobody answered is SAID as unanswered, not folded
    // into the ordinary budget sentence.
    const waiting = pendingPermission !== null;
    if (sessionId !== null) transport?.cancel(sessionId);
    void finish(
      "timed-out",
      waiting ? ACP_RUN_SENTENCES.permissionUnanswered : ACP_RUN_SENTENCES.timedOut,
    );
  }, budgetMs);

  void (async () => {
    // STORY 21.1 — A CONTINUATION STARTS IN THE FOLDER IT WAS RECORDED IN, OR
    // NOT AT ALL. This is the one shape check before the key, the directory or
    // the child: a resume whose cwd is absent or different would hand the tool
    // a folder it refuses, so it is refused here in one sentence and nothing is
    // started.
    if (
      options.resume !== undefined &&
      (options.cwd === undefined || options.cwd !== options.resume.cwd)
    ) {
      await finish("failed", ACP_RUN_SENTENCES.resumeOtherFolder);
      return;
    }
    const environment = options.environment ?? runtimeEnvironment();
    // TWO ROADS, NEVER BOTH (18.3b): a resolved map came over a wire and is
    // used as given — no store is read, no row is named. Otherwise the row's
    // env entries are read from the store, and a missing key refuses before
    // any spawn.
    const resolved = options.resolvedEnv;
    const keys = new Map<string, string>();
    if (resolved === undefined) {
      for (const entry of spec.env) {
        let value = "";
        try {
          value = await options.readKey(entry.key);
        } catch {
          value = "";
        }
        if (value === "") {
          await finish("failed", acpMissingKeySentence(entry.key));
          return;
        }
        keys.set(entry.key, value);
      }
    }
    if (settled) return;

    const env = acpRunEnvironment(spec, keys, environment, resolved);
    // STORY 19.2 — A BOUND RUN STARTS IN THE PERSON'S FOLDER. The lane has
    // already refused a folder that is not there; an absolute path here is used
    // as given, and the fresh temp directory stays the fallback for every other
    // run (a relative path is not a folder this rule accepted).
    let made: string;
    if (options.cwd !== undefined && isAbsoluteFolderPath(options.cwd)) {
      made = options.cwd;
    } else {
      try {
        made = createSessionDirectory(options.sessionRoot);
      } catch {
        await finish("failed", ACP_RUN_SENTENCES.noDirectory);
        return;
      }
    }
    directory = made;
    if (settled) return;

    // THE DECLARATION COMES BEFORE THE SPAWN. It names provider rows, never
    // key values, and the inherited list is exactly PATH/HOME.
    emit({
      kind: "started",
      command: spec.command,
      args: [...spec.args],
      cwd: made,
      declaration,
      inherited: Object.keys(acpInheritedEnvironment(environment)),
      envNames:
        resolved === undefined
          ? spec.env.map((entry) => entry.name)
          : Object.keys(resolved),
    });

    const started = startAcp({
      command: spec.command,
      args: [...spec.args],
      cwd: made,
      env,
      spawn: options.spawn,
      requestTimeoutMs: options.requestTimeoutMs ?? ACP_REQUEST_TIMEOUT_MS,
      onNotification: (notification: AcpNotificationMessage) => {
        const summary = summarizeUpdate(notification.params);
        // Only agent text is a candidate answer; a thought or a tool call is
        // progress, not words the person asked for.
        if (summary.updateKind === "agent_message_chunk") {
          answerText += summary.text;
        }
        emit({
          kind: "update",
          updateKind: summary.updateKind,
          text: summary.text,
          update: summary.update,
        });
      },
      onRequest: (request: AcpServerRequest) => {
        void answerPermission(request);
      },
      onProblem: (sentence: string) => {
        emit({ kind: "problem", sentence });
      },
      // stderr is diagnostics, not protocol (the spike's finding); the run
      // neither parses it nor logs it.
    });
    if (started.kind === "refused") {
      await finish("failed", started.sentence);
      return;
    }
    transport = started.transport;
    if (settled) {
      await transport.close();
      return;
    }

    let createdSession: string;
    try {
      // The handshake is still the first word, resumed or not: the server
      // advertises its capabilities (session/resume among them) there.
      await transport.initialize(
        options.clientName ?? "attentioneer",
        options.clientVersion ?? "0.0.0",
      );
      // STORY 21.1 — ONE BRANCH, AND ONLY ONE: a continuation asks the server
      // for the session it already recorded (the id and folder it named), and
      // a fresh run makes a new one. Everything after this line — the prompt
      // call, the update stream, the permission path and the kill — is the
      // same code, so a follow-up cannot drift from an ordinary run.
      const session =
        options.resume === undefined
          ? await transport.newSession(made)
          : await transport.resumeSession(
              options.resume.sessionId,
              made,
            );
      createdSession = session.sessionId;
      // STORY 22.5 — THE ANSWER'S OWN OPTIONS ARE KEPT VERBATIM. The session
      // step is where the tool says which models and settings it offers; the
      // run hands that list back rather than interpreting it, so the fact layer
      // records the tool's words and the card picks from them.
      sessionConfigOptions =
        session.configOptions === undefined ? null : session.configOptions;
    } catch (error) {
      await finishFromFailure(error);
      return;
    }
    if (settled) return;
    sessionId = createdSession;
    // STORY 21.1 — THE FOLDER RIDES WITH THE SESSION, so the card's record
    // keeps the pair a later continuation needs. Same entry kind, same place in
    // the stream; the folder is what makes it resumable.
    emit({ kind: "session", sessionId, cwd: made });

    // STORY 22.5 — THE MODEL IS CHOSEN BEFORE THE TURN, NEVER AFTER. The option
    // exists only on a session, so this speaks after the session step and
    // before the prompt; a resume takes the same road, because a continued
    // conversation must answer on the model the card records. The id and the
    // value are the tool's own strings, sent unchanged. A refusal is the
    // server's own sentence and ENDS the run: nothing pretends the model
    // changed, and no prompt is sent on a model nobody chose.
    if (options.model !== undefined) {
      try {
        await transport.setConfigOption(
          sessionId,
          options.model.optionId,
          options.model.value,
        );
      } catch (error) {
        await finishFromFailure(error);
        return;
      }
      if (settled) return;
    }

    try {
      // STORY 22.2 — THE TURN IS WAITED FOR WITH THE RUN'S OWN BUDGET. The
      // prompt answers at turn end, and a tool-using turn may legitimately run
      // for minutes; the flat request default stays for every other call.
      const turned = await transport.prompt(sessionId, prompt, {
        timeoutMs: acpPromptTimeoutMs(
          budgetMs,
          clock.now() - budgetStartedAt,
        ),
      });
      if (cancelled || turned.stopReason === "cancelled") {
        await finish("stopped", null, turned.stopReason);
        return;
      }
      if (turned.stopReason === "end_turn") {
        await finish("completed", null, turned.stopReason);
        return;
      }
      await finish(
        "failed",
        "the server settled the turn as " +
          turned.stopReason +
          ", so it is not a finished run",
        turned.stopReason,
      );
    } catch (error) {
      await finishFromFailure(error);
    }
  })();

  return { result, cancel, close };
}
