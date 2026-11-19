/**
 * THE RUN LANE (Epic 18 story 3b) — WHERE A SESSION CARD'S RUN NOW HAPPENS.
 *
 * WHY THIS FILE EXISTS. Story 18.3 built the session card and proved the run
 * under Bun, then the shipped app could not run it: `turn/acpRun.ts` needs
 * `node:fs` and a spawner, and the window is a WebView with neither, so pressing
 * RUN there was refused with one sentence. The fix is the shape this app already
 * chose (ADR-0034): the SIDECAR is the only process that talks to the outside
 * world, so the lane moves here. The window asks, this lane spawns, the entries
 * stream back, and a stop cancels.
 *
 * THE KEY CROSSES IN THE PAYLOAD, NEVER AN ARGV. The `run` request carries a
 * RESOLVED env map (variable name to value) — the same road a turn's key takes.
 * This process reads no key store and names no provider row: it hands the map
 * to the run as given, and the run adds PATH/HOME and nothing else (18.2's env
 * rule, unchanged). Nothing here logs, and no value is ever written anywhere.
 *
 * KILL ON EVERY EXIT PATH. The lifecycle (`acpRun`'s `finish`) kills the child
 * on cancel, on an ending, on a dead child and on a timeout; this lane adds the
 * two the run cannot see by itself:
 *
 *   - SIDECAR SHUTDOWN (stdin closed): every live run is closed, so no ACP
 *     child outlives the sidecar.
 *   - CLOSED STDOUT (the host is gone): the writer says so, and main.ts closes
 *     every live run through `shutdown` — a run nobody can hear is not left
 *     running.
 *
 * ONE ENTRY AT A TIME. `run-part` carries one progress entry, in arrival order;
 * the `ended` entry is NOT streamed twice: it rides `run-end` alone, so the
 * window appends each entry exactly once and the transcript stays append-only.
 *
 * STORY 18.4 — THE RUN WAITS FOR A PERSON. 18.3's lane auto-refused every
 * permission request; that is gone. A `session/request_permission` becomes one
 * `run-permission` line DOWN with the server's own tool call and options, and
 * the run's envelope sits on a promise until ONE `run-permission-reply` comes
 * UP (allow-once or refuse). The lane turns the verb into the matching option
 * against the held ask, so an "always" option on the wire can never be chosen;
 * a request nobody answers is the run's own timeout, and the run records it as
 * unanswered. No default allow exists on any path here.
 *
 * STORY 19.2 — A BOUND RUN STARTS IN THE PERSON'S FOLDER, AND THE DELEGATION IS
 * THE CONSENT. When the request carries an absolute `cwd` (the card is bound to
 * a project card) and a `scope` (the person declared a boundary) — the wire
 * carries neither without the other — the folder is checked BEFORE any spawn
 * and becomes the run's working directory. In that
 * same case, an ask INSIDE the declared scope is answered allow-once by the lane
 * itself — no `run-permission` line goes down, and the transcript still shows
 * the ask and its "allowed-once" reply, because the run records it — while an
 * ask OUTSIDE the scope flows to the person exactly as before. A run with no
 * cwd, no scope, or both absent is byte-for-byte the old lane: a fresh session
 * directory and every ask reaching the person. There is no default allow on any
 * path here, and only the allow_ONCE option is ever selected.
 *
 * PROVISIONAL: the run numbers, the refusals below (including the missing
 * folder's one sentence), the auto-answer rule and the choice to route the
 * ending through `run-end` rather than a final `run-part`.
 */

import {
  errorLine,
  runEndLine,
  runPartLine,
  runPermissionLine,
  type RunPermissionReplyRequest,
  type RunRequest,
} from "../src/turn/protocol.ts";
import {
  startAcpRun,
  type AcpPermissionAsk,
  type AcpPermissionReply,
  type AcpRunHandle,
} from "../src/turn/acpRun.ts";
import {
  optionIdForChoice,
  permissionInScope,
} from "../src/turn/acpEntries.ts";
import type { AcpSpec } from "../src/turn/acpSpecs.ts";
import { existsSync, statSync } from "node:fs";

/** The lane's own refusals, in the sidecar's one-sentence voice. */
export const RUN_LANE_SENTENCES = {
  busy: "that run number is already running.",
  unknown: "no run is live with that number.",
  noPermission: "no permission request is waiting on that run.",
} as const;

/**
 * STORY 18.6 — THE ROW'S COMMAND IS NOT THERE. One sentence, naming the
 * command, said BEFORE anything is spawned: a tool the person installed is
 * found on PATH, and a tool that is not there must not become a half-started
 * child, an empty transcript or a timeout dressed up as a failure.
 */
export function runMissingCommandSentence(command: string): string {
  return "the command " + command + " was not found, so nothing was started.";
}

/**
 * STORY 19.2 — THE BOUND RUN'S FOLDER IS NOT THERE (PROVISIONAL). One sentence,
 * naming the folder, said BEFORE anything is spawned: binding a project is a
 * consent to run IN that folder, so a folder that has gone must not become a
 * run somewhere else, an empty transcript or a timeout dressed up as a failure.
 * No child, no transcript and no budget clock are made.
 */
export function runMissingFolderSentence(folder: string): string {
  return "the folder " + folder + " is not there, so nothing was started.";
}

/**
 * STORY 19.2 — DOES A RUN'S FOLDER EXIST? A directory only: a file, a link
 * into nothing and an unset cwd all answer false. PURE apart from the two facts
 * it reads, so a test can stand behind either.
 */
export function folderFound(
  folder: string,
  isDirectory: (path: string) => boolean = existsDirectory,
): boolean {
  if (folder.trim() === "") return false;
  try {
    return isDirectory(folder);
  } catch {
    return false;
  }
}

/** The default check: an existing directory and nothing else. */
function existsDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Is this command there to run? An absolute path is checked where it points; a
 * bare name is looked up on PATH (the sidecar's own PATH — the person's). PURE
 * apart from the two facts it reads, so a test can stand behind either.
 */
export function commandFound(
  command: string,
  exists: (path: string) => boolean = existsSync,
): boolean {
  const text = command.trim();
  if (text === "") return false;
  const looksLikePath =
    text.includes("/") || text.includes("\\") || /^[A-Za-z]:/.test(text);
  if (looksLikePath) return exists(text);
  const runtime = (
    globalThis as { Bun?: { which?: (name: string) => string | null } }
  ).Bun;
  if (typeof runtime?.which !== "function") return false;
  try {
    return runtime.which(text) !== null;
  } catch {
    return false;
  }
}

/**
 * What the lane needs from the process that owns it: one writer, and nothing
 * else. The child's environment, its session directory and its spawner are this
 * process's own (PATH/HOME, the OS temp, Bun's spawn) — the lane takes no
 * shortcut around them.
 */
export interface RunLaneOptions {
  /** Write ONE already-built line to the host. */
  say: (line: string) => void;
}

/**
 * ONE PERMISSION REQUEST WHILE THE RUN WAITS (story 18.4). The ask is held
 * exactly as the server gave it; the one resolver is what lets the run go on.
 * The choice becomes an option id HERE against those options, so a wire that
 * sent an "always" id still cannot select it.
 */
interface PendingPermission {
  ask: AcpPermissionAsk;
  resolve: (reply: AcpPermissionReply) => void;
}

/**
 * One live run: the run's originating request id, its handle, and the ONE wait
 * it can have at a time. The holder is filled by the reply path and read by the
 * person's answer, so neither has to know the other's order.
 */
interface LiveRun {
  id: number;
  handle: AcpRunHandle;
  permission: { current: PendingPermission | null };
}

/** The lane's contract with main.ts: start, answer, cancel, close everything. */
export interface RunLane {
  /** Start one run from a parsed `run` request. Never awaited by the reader. */
  start(request: RunRequest): void;
  /**
   * STORY 18.4 — the person's answer to a pending ask. It names the run and
   * the exact ask; the verb becomes the matching option against what the
   * server offered. No default, no always: an unmatched ask is refused.
   */
  answerPermission(reply: RunPermissionReplyRequest): void;
  /** Cancel one live run by its number; its own `run-end` is the answer. */
  cancel(run: number, requestId: number): void;
  /** Close every live run (sidecar shutdown, or a dead stdout). Idempotent. */
  shutdown(): Promise<void>;
}

/**
 * The row this lane runs: the wire's tool and nothing else. The env entries are
 * empty on purpose — the grant already arrived as a resolved map, and naming a
 * provider row here would be a second, quieter road for a key.
 */
export function runSpecOf(request: RunRequest): AcpSpec {
  return {
    kind: "acp",
    id: "sidecar-run",
    name: "a run",
    // The lane does not judge a row's honesty; it only needs the argv.
    verified: false,
    command: request.tool.command,
    args: [...request.tool.args],
    cwdPolicy: "session",
    env: [],
    timeoutMinutes: request.tool.timeoutMinutes,
    notes: "",
  };
}

/** Build the lane over one process's writer. */
export function createRunLane(options: RunLaneOptions): RunLane {
  const live = new Map<number, LiveRun>();
  let closing = false;

  const start = (request: RunRequest): void => {
    // A lane that is closing starts nothing: its children would have nobody to
    // report to and nobody to stop them.
    if (closing) return;
    if (live.has(request.run)) {
      options.say(errorLine(request.id, RUN_LANE_SENTENCES.busy));
      return;
    }
    // STORY 18.6 — THE ROW'S COMMAND IS CHECKED BEFORE ANY SPAWN. A shipped
    // row may name a bare command; one that is not on PATH answers one sentence
    // naming it, and no child, transcript or budget clock is ever made.
    if (!commandFound(request.tool.command)) {
      options.say(
        errorLine(
          request.id,
          runMissingCommandSentence(request.tool.command),
        ),
      );
      return;
    }
    // STORY 19.2 — A BOUND RUN'S FOLDER IS CHECKED BEFORE ANY SPAWN. The person
    // bound a project and declared a boundary, so the folder is where this run
    // was consented to work; a folder that is gone answers one sentence and no
    // child, transcript or budget clock is ever made.
    if (request.cwd !== undefined && !folderFound(request.cwd)) {
      options.say(errorLine(request.id, runMissingFolderSentence(request.cwd)));
      return;
    }
    // ONE WAIT PER RUN. It is filled when the server asks and resolved by the
    // person's reply (or, after the run has ended, with null so nothing leaks).
    const waitFor: { current: PendingPermission | null } = { current: null };
    const handle = startAcpRun(runSpecOf(request), request.prompt, {
      // THE KEY IS ALREADY HERE, and it is the only road: no store, no row.
      readKey: async () => "",
      resolvedEnv: request.env,
      // STORY 18.4 — THE RUN WAITS FOR A PERSON. The ask goes DOWN the wire;
      // the promise settles only when an answer comes UP, and the run's own
      // budget is the only other way out. There is no default allow.
      replyToPermission: (ask: AcpPermissionAsk) => {
        // STORY 19.2 — THE DELEGATION IS THE CONSENT. When the person declared a
        // boundary and this ask is INSIDE it, the run answers allow-once itself
        // and NO run-permission line goes down: the card is not interrupted.
        // The run still records the ask and its reply in its own progress entry,
        // so the transcript shows "allowed-once" without a person pressing it.
        // An ask OUTSIDE the declaration (or any ask on a run with no scope)
        // takes exactly the old path and waits for the person.
        if (permissionInScope(request.scope, ask)) {
          return { optionId: optionIdForChoice("allow-once", ask.options) };
        }
        return new Promise<AcpPermissionReply>((resolve) => {
          waitFor.current = { ask, resolve };
          options.say(runPermissionLine(request.id, request.run, ask));
        });
      },
      onProgress: (progress) => {
        // The ending is run-end's, said ONCE — never a second run-part.
        if (progress.kind === "ended") return;
        options.say(runPartLine(request.id, request.run, progress));
      },
      // STORY 19.2 — the bound folder and the declared scope ride through to
      // the run: the cwd replaces the fresh session directory, and the scope
      // only shapes the declaration (the auto-answer happened above).
      ...(request.cwd === undefined ? {} : { cwd: request.cwd }),
      ...(request.scope === undefined ? {} : { scope: request.scope }),
    });
    const entry: LiveRun = {
      id: request.id,
      handle,
      permission: waitFor,
    };
    live.set(request.run, entry);
    // The window's subscription is by the run's OWN request id, so the ending
    // arrives on the id it asked with even when the answer is a cancel's.
    void handle.result.then((result) => {
      live.delete(request.run);
      // A run that ended with a request still pending settles the waiter so
      // the run's own answer path can finish; it changes no record (the run
      // already stated the outcome).
      const waiting = entry.permission.current;
      entry.permission.current = null;
      waiting?.resolve({ optionId: null });
      options.say(
        runEndLine(request.id, request.run, result.ending, result.sentence),
      );
    });
  };

  /**
   * THE PERSON'S ANSWER (story 18.4). The verb is turned into an option id
   * against the ask the server actually made: allow-once matches ONLY the
   * protocol's allow_once kind, refuse matches a reject kind, and anything else
   * is a cancelled outcome. An ask that is not waiting is answered with one
   * sentence rather than guessed at.
   */
  const answerPermission = (reply: RunPermissionReplyRequest): void => {
    const entry = live.get(reply.run);
    const pending = entry?.permission.current ?? null;
    if (entry === undefined || pending === null) {
      options.say(errorLine(reply.id, RUN_LANE_SENTENCES.noPermission));
      return;
    }
    if (pending.ask.id !== reply.ask) {
      // A reply must name the ask it answers; a stale id answers nothing.
      options.say(errorLine(reply.id, RUN_LANE_SENTENCES.noPermission));
      return;
    }
    entry.permission.current = null;
    pending.resolve({
      optionId: optionIdForChoice(reply.choice, pending.ask.options),
    });
  };

  const cancel = (run: number, requestId: number): void => {
    const entry = live.get(run);
    if (entry === undefined) {
      // A cancel for a run that already ended is answered, not ignored: the
      // host asked a question and gets one sentence back.
      options.say(errorLine(requestId, RUN_LANE_SENTENCES.unknown));
      return;
    }
    // The run's own cancel: session/cancel first, a grace, then the child.
    // Its own run-end settles the window, so the cancel answers no line here.
    entry.handle.cancel();
  };

  const shutdown = async (): Promise<void> => {
    closing = true;
    const running = [...live.values()];
    live.clear();
    // close() is the run's own stop AND its kill; awaiting them means the
    // process cannot exit before its children are gone.
    await Promise.all(
      running.map(async (entry) => {
        try {
          await entry.handle.close();
        } catch {
          // A run already settled has nothing left to close.
        }
      }),
    );
  };

  return { start, answerPermission, cancel, shutdown };
}
