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
 * `dsh` had no DEEPSEEK_API_KEY, and ACP advertises no auth (`authMethods: []`).
 * A child therefore receives a stored key ONLY through an explicit env entry
 * on its row, naming one provider row; the key is read from the store in
 * memory for this spawn and appears in no argv, no file and no log line. The
 * run's first progress entry COMES BEFORE THE SPAWN and states, in one
 * sentence, which key it will receive — or that it receives none.
 *
 * WHAT IS INHERITED: PATH and HOME, when they are set, and NOTHING ELSE. Not
 * this app's key store, not the parent's DEEPSEEK_API_KEY, not any other
 * variable. The spawned child's environment is exactly that pair plus the
 * row's declared entries. (A Windows `dsh.cmd` may in time want SystemRoot;
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
  startAcp,
  type AcpNotificationMessage,
  type AcpServerRequest,
  type AcpSpawner,
  type AcpTransport,
} from "./acp";
import type { AcpSpec } from "./acpSpecs";

/** The environment names a run inherits, and the complete list of them. */
export const ACP_INHERITED_ENV = ["PATH", "HOME"] as const;

/** How long one request may wait while the run's own budget is the backstop. */
export const ACP_REQUEST_TIMEOUT_MS = 30_000;

/** How long a cancelled turn may take to settle before the child is killed. */
export const ACP_CANCEL_GRACE_MS = 3_000;

/** The prefix of a run's session directory under the app's temp root. */
export const ACP_SESSION_PREFIX = "attentioneer-acp-session-";

/** The sentences the run reports (PROVISIONAL wording). */
export const ACP_RUN_SENTENCES = {
  timedOut:
    "the run ran out of its budget, so what arrived is a partial, not a result",
  noDirectory: "the run's session directory could not be made",
  noSession:
    "the server did not create a session, so the run is not a finished run",
} as const;

/** The sentence for a declared key that is not in the store. */
export function acpMissingKeySentence(providerId: string): string {
  return (
    "the key named " +
    providerId +
    " is not kept, so the run was not started"
  );
}

/** How a run ended. Only "completed" is a result. */
export type AcpEnding = "completed" | "stopped" | "failed" | "timed-out";

/** One permission option the server offered (the ids a caller may pick). */
export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

/** What the server asked, as the caller's decider sees it. */
export interface AcpPermissionAsk {
  method: string;
  sessionId: string | null;
  toolCall: unknown;
  options: AcpPermissionOption[];
  /** The request's params verbatim, for a surface that wants the whole shape. */
  params: unknown;
}

/**
 * The caller's reply: one option id, or null for "cancelled". This story does
 * not decide policy (18.4 does); it only carries the answer the caller chose.
 */
export interface AcpPermissionReply {
  optionId: string | null;
}

/** The reply as it crossed the wire, recorded in the progress sequence. */
export type AcpPermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

/**
 * One entry in the run's ordered progress sequence. The caller watches this
 * and nothing else; the result's `entries` is the same sequence kept.
 */
export type AcpProgressEntry =
  | {
      kind: "started";
      command: string;
      args: string[];
      cwd: string;
      /** The one sentence, emitted BEFORE the spawn. Never contains a key. */
      declaration: string;
      /** Exactly the inherited names: PATH and HOME when they were set. */
      inherited: string[];
      /** The variable names the row filled, if any. Never their values. */
      envNames: string[];
    }
  | { kind: "session"; sessionId: string }
  | {
      kind: "update";
      /** `sessionUpdate`'s kind: agent_message_chunk, tool_call, plan, … */
      updateKind: string;
      /** The text this update carried ("" for kinds that carry none). */
      text: string;
      /** The update object verbatim, so a later surface can use all of it. */
      update: unknown;
    }
  | {
      kind: "permission";
      method: string;
      toolCall: unknown;
      options: AcpPermissionOption[];
      reply: AcpPermissionOutcome;
    }
  | { kind: "problem"; sentence: string }
  | {
      kind: "ended";
      ending: AcpEnding;
      stopReason: string | null;
      sentence: string | null;
      /** True when words arrived but the ending is not a result. */
      partial: boolean;
    };

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

/** What a run needs from the app. Everything here is injected and testable. */
export interface AcpRunOptions {
  /** The key for ONE provider row, read at run time and never logged. */
  readKey: (providerId: string) => Promise<string>;
  /** The caller's answer to a permission request (the person's choice). */
  replyToPermission: (
    request: AcpPermissionAsk,
  ) => AcpPermissionReply | Promise<AcpPermissionReply>;
  /** Injected for tests; the default is the Bun runtime's spawn. */
  spawn?: AcpSpawner;
  /** The environment the run may inherit FROM; only PATH/HOME are read. */
  environment?: Record<string, string | undefined>;
  /** The temp root the session directory is made under; the OS temp by default. */
  sessionRoot?: string;
  /** Shorten the row's budget (a caller's own deadline; tests use it too). */
  timeoutMs?: number;
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
 * The one sentence the run says BEFORE it starts: which key (by provider row,
 * never by value) it will receive, or that it receives none. This is the
 * env rule made audible; it is computed from the row alone, so no key read can
 * appear in it.
 */
export function acpDeclaration(spec: AcpSpec): string {
  const names = spec.env.map((entry) => entry.key);
  if (names.length === 0) {
    return "this run will receive no key: no environment entry names a provider row";
  }
  if (names.length === 1) {
    return "this run will receive the key named " + names[0];
  }
  const last = names[names.length - 1];
  return (
    "this run will receive the keys named " +
    names.slice(0, -1).join(", ") +
    " and " +
    last
  );
}

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
 * Compose the child's environment: PATH/HOME plus one value per declared env
 * entry. Nothing else from `environment` can ride along — in particular a key
 * this app holds is invisible unless a row names it. A missing key is the
 * caller's problem (the run refuses before spawning); here an absent value is
 * simply not set.
 */
export function acpRunEnvironment(
  spec: AcpSpec,
  keys: ReadonlyMap<string, string>,
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const env = acpInheritedEnvironment(environment);
  for (const entry of spec.env) {
    const value = keys.get(entry.key);
    if (value !== undefined && value !== "") env[entry.name] = value;
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
    method: request.method,
    sessionId: textOf(params.sessionId) === "" ? null : textOf(params.sessionId),
    toolCall: params.toolCall,
    options,
    params: request.params,
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
  const declaration = acpDeclaration(spec);
  const budgetMs =
    options.timeoutMs ?? Math.max(1, Math.round(spec.timeoutMinutes * 60_000));

  let transport: AcpTransport | null = null;
  let sessionId: string | null = null;
  let directory: string | null = null;
  let childExitCode: number | null = null;
  let answerText = "";
  let cancelled = false;
  let timedOut = false;
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let grace: ReturnType<typeof setTimeout> | null = null;

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
      clearTimeout(timer);
      timer = null;
    }
    if (grace !== null) {
      clearTimeout(grace);
      grace = null;
    }
    const live = transport;
    transport = null;
    if (live !== null) {
      // close() kills the child and waits for it; the spike's rule, kept.
      await live.close();
      childExitCode = live.exited;
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
    });
  }

  function failureSentence(error: unknown): string {
    return error instanceof AcpFailure
      ? error.sentence
      : "the run stopped before the turn settled";
  }

  /** A failure seen through the run's flags: a stop we asked for is not a failure. */
  function finishFromFailure(error: unknown): Promise<void> {
    if (timedOut) return finish("timed-out", ACP_RUN_SENTENCES.timedOut);
    if (cancelled) return finish("stopped", null, "cancelled");
    return finish("failed", failureSentence(error));
  }

  /** Answer one permission request with the caller's reply, then record it. */
  async function answerPermission(request: AcpServerRequest): Promise<void> {
    const ask = permissionAsk(request);
    let reply: AcpPermissionReply;
    try {
      reply = await options.replyToPermission(ask);
    } catch {
      // A decider that broke is not permission to act.
      reply = { optionId: null };
    }
    const optionId =
      typeof reply.optionId === "string" && reply.optionId !== ""
        ? reply.optionId
        : null;
    if (!settled) {
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
    }
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
      grace = setTimeout(() => {
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
  timer = setTimeout(() => {
    if (settled) return;
    timedOut = true;
    if (sessionId !== null) transport?.cancel(sessionId);
    void finish("timed-out", ACP_RUN_SENTENCES.timedOut);
  }, budgetMs);

  void (async () => {
    const environment = options.environment ?? runtimeEnvironment();
    const keys = new Map<string, string>();
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
    if (settled) return;

    const env = acpRunEnvironment(spec, keys, environment);
    let made: string;
    try {
      made = createSessionDirectory(options.sessionRoot);
    } catch {
      await finish("failed", ACP_RUN_SENTENCES.noDirectory);
      return;
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
      envNames: spec.env.map((entry) => entry.name),
    });

    const started = startAcp({
      command: spec.command,
      args: [...spec.args],
      cwd: made,
      env,
      spawn: options.spawn,
      requestTimeoutMs: ACP_REQUEST_TIMEOUT_MS,
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
      await transport.initialize(
        options.clientName ?? "attentioneer",
        options.clientVersion ?? "0.0.0",
      );
      const session = await transport.newSession(made);
      createdSession = session.sessionId;
    } catch (error) {
      await finishFromFailure(error);
      return;
    }
    if (settled) return;
    sessionId = createdSession;
    emit({ kind: "session", sessionId });

    try {
      const turned = await transport.prompt(sessionId, prompt);
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
