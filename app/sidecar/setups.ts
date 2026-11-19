/**
 * THE SETUP CHILD LANE (story 22.1b; PROVISIONAL) — A TOOL'S OWN SIGN-IN, HOSTED.
 *
 * WHAT THIS IS: one small process class of its own. A row may declare the argv
 * that opens its tool's sign-in (`signIn.args`); this lane starts the row's
 * command with that argv in a FRESH TEMP DIRECTORY, relays what the child
 * prints one line at a time (stdout and stderr kept apart on the wire), writes
 * the person's pasted code to the child's stdin when it arrives, and states the
 * exit code and the child's last line when it ends. The person does the
 * interactive part in their own browser; the app only hosts the child.
 *
 * WHY IT IS NOT A RUN. A run is the app's delegation to an agent: it writes a
 * transcript, sends a prompt, carries the row's key grant, answers permission
 * requests, records a session and can be resumed. A sign-in is the TOOL's own
 * business, invisible egress the app hosts and does not broker: it gets no
 * prompt, no transcript entry, no map write, no history event, no PRISM, no
 * session record and no permission surface. It is therefore a SECOND, SMALLER
 * class with its own table — not a switch on the run lane. The run lane's
 * lifecycle and its kill-on-every-exit rule are untouched by this file.
 *
 * WHAT IT NEVER DOES: never writes a file, never sends a prompt, never touches
 * the map or the transcript, never gets a PRISM, and never receives the code in
 * any argv, log line, file or sentence — the code goes to the child's stdin and
 * nowhere else. This process reads no key store; the env map crossed the wire
 * already resolved, exactly as a run's does, and PATH/HOME are the only names
 * added.
 *
 * KILL ON EVERY PATH, THE SAME THREE AS THE RUN LANE: a cancel, the child's own
 * exit, and sidecar shutdown (stdin closed or a closed stdout). One setup child
 * per number at a time; a second `setup` with a live number answers one
 * sentence and starts nothing.
 *
 * PROVISIONAL: the table's keying (the same number as the request), the fresh
 * temp directory policy, the line cap and the lane's sentences.
 */

// @ts-expect-error this module runs under Bun, whose node builtins have no types in this build
import { mkdtempSync } from "node:fs";
// @ts-expect-error no node types in this build
import { tmpdir } from "node:os";
// @ts-expect-error no node types in this build
import { join } from "node:path";

import {
  errorLine,
  setupEndLine,
  setupPartLine,
  type SetupCancelRequest,
  type SetupEnding,
  type SetupRequest,
  type SetupStdinRequest,
  type SetupStream,
} from "../src/turn/protocol.ts";
import { bunSpawn, type AcpChild } from "../src/turn/acp.ts";
import { ACP_INHERITED_ENV } from "../src/turn/acpRun.ts";
import { commandFound } from "./runs.ts";

/** The prefix of the fresh directory a setup child runs in. */
export const SETUP_DIR_PREFIX = "attentioneer-setup-";

/** How long one child may print before its line is cut (characters). */
export const SETUP_LINE_WIRE_MAX = 2_000;

/** How long shutdown waits for one child to be reaped, in milliseconds. */
export const SETUP_REAP_MS = 2_000;

/**
 * How long the lane waits for the child's pipes to drain AFTER its exit before
 * it states the ending. A tool may leave a pipe open (something it spawned can
 * hold it), and the exit is the ending either way.
 */
export const SETUP_DRAIN_MS = 1_500;

/** The lane's own sentences, in the sidecar's one-sentence voice. */
export const SETUP_LANE_SENTENCES = {
  busy: "that sign-in is already running.",
  unknown: "no sign-in is live with that number.",
  noDirectory: "the sign-in had nowhere to run, so nothing was started.",
  spawnFailed: "the sign-in could not be started.",
} as const;

/** One sentence naming the command that was not there, said before any spawn. */
export function setupMissingCommandSentence(command: string): string {
  return (
    "the command " +
    command +
    " was not found, so the sign-in was not started."
  );
}

/** What the lane needs from the process that owns it: one writer, nothing else. */
export interface SetupLaneOptions {
  /** Write ONE already-built line to the host. */
  say: (line: string) => void;
}

/**
 * One live setup child: its originating request id, the child, and the last
 * line it printed. The last line is kept ONLY to report the ending — it is
 * never written anywhere.
 */
interface LiveSetup {
  id: number;
  child: AcpChild;
  lastLine: string | null;
  /** The person stopped it, so the ending is "stopped" whatever the code. */
  killed: boolean;
}

/** The lane's contract with main.ts: start, feed, cancel, close everything. */
export interface SetupLane {
  /** Start one setup child from a parsed `setup` request. Never awaited. */
  start(request: SetupRequest): void;
  /** Write the person's line to one child's stdin, plus a newline. */
  feed(request: SetupStdinRequest): void;
  /** Cancel one live child by its number; its own `setup-end` is the answer. */
  cancel(request: SetupCancelRequest): void;
  /** Kill every live child (shutdown or a dead stdout). Idempotent. */
  shutdown(): Promise<void>;
}

/** The environment the child receives: PATH/HOME, then the resolved map. */
export function setupEnvironment(
  resolved: Readonly<Record<string, string>>,
  environment: Record<string, string | undefined>,
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of ACP_INHERITED_ENV) {
    const value = environment[name];
    if (typeof value === "string") env[name] = value;
  }
  for (const [name, value] of Object.entries(resolved)) {
    if (value !== "") env[name] = value;
  }
  return env;
}

/** One stream's lines, in order, each cut at the wire's cap. */
async function pump(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  const take = (raw: string): void => {
    const line = raw.replace(/\r$/, "");
    if (line === "") return;
    onLine(
      line.length > SETUP_LINE_WIRE_MAX
        ? line.slice(0, SETUP_LINE_WIRE_MAX)
        : line,
    );
  };
  for await (const chunk of stream) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      take(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  buffer += decoder.decode();
  take(buffer);
}

/** Build the lane over one process's writer. */
export function createSetupLane(options: SetupLaneOptions): SetupLane {
  const live = new Map<number, LiveSetup>();
  let closing = false;

  /**
   * THE ONE WAY A SETUP CHILD ENDS. It leaves the table first, so a cancel
   * racing the exit cannot answer twice, then states the ending: stopped when
   * the person stopped it, completed on exit code zero, failed otherwise.
   */
  const finish = (
    setup: number,
    entry: LiveSetup,
    exitCode: number | null,
  ): void => {
    if (live.get(setup) !== entry) return;
    live.delete(setup);
    const ending: SetupEnding =
      entry.killed
        ? "stopped"
        : exitCode === 0
          ? "completed"
          : "failed";
    options.say(
      setupEndLine(entry.id, setup, ending, exitCode, entry.lastLine),
    );
  };

  const start = (request: SetupRequest): void => {
    // A lane that is closing starts nothing: its child would have nobody to
    // report to and nobody to stop it.
    if (closing) return;
    const setup = request.setup;
    if (live.has(setup)) {
      options.say(errorLine(request.id, SETUP_LANE_SENTENCES.busy));
      return;
    }
    // THE COMMAND IS CHECKED BEFORE ANY SPAWN, said in one sentence naming it:
    // a tool the person installs may be gone, and that must not become a
    // half-started child or a timeout dressed up as a failure.
    if (!commandFound(request.tool.command)) {
      options.say(
        errorLine(
          request.id,
          setupMissingCommandSentence(request.tool.command),
        ),
      );
      return;
    }
    // A FRESH TEMP DIRECTORY, never the app's tree and never the map: the
    // child's blast radius is its own empty folder. It is left on disk (the
    // lane writes no cleanup) exactly as a run's session directory is.
    let directory: string;
    try {
      directory = mkdtempSync(join(tmpdir(), SETUP_DIR_PREFIX));
    } catch {
      options.say(errorLine(request.id, SETUP_LANE_SENTENCES.noDirectory));
      return;
    }
    const runtime = (
      globalThis as { process?: { env?: Record<string, string | undefined> } }
    ).process;
    const env = setupEnvironment(request.env, runtime?.env ?? {});
    let child: AcpChild;
    try {
      child = bunSpawn(request.tool.command, request.tool.args, {
        cwd: directory,
        env,
      });
    } catch {
      options.say(errorLine(request.id, SETUP_LANE_SENTENCES.spawnFailed));
      return;
    }
    const entry: LiveSetup = { id: request.id, child, lastLine: null, killed: false };
    live.set(setup, entry);

    const part = (stream: SetupStream) => (line: string) => {
      entry.lastLine = line;
      options.say(setupPartLine(entry.id, setup, stream, line));
    };
    const stdout = pump(child.stdout, part("stdout"));
    const stderr =
      child.stderr === undefined
        ? Promise.resolve()
        : pump(child.stderr, part("stderr"));
    // THE ENDING COMES AFTER BOTH PIPES ARE DRAINED, so the last line the child
    // printed is the one `setup-end` states rather than one that raced it. The
    // drain is BOUNDED: a pipe something else holds open must not hide an exit.
    const drained = Promise.all([stdout, stderr]);
    void child.exited
      .then(async (code) => {
        await Promise.race([
          drained,
          new Promise<void>((resolve) => {
            setTimeout(resolve, SETUP_DRAIN_MS);
          }),
        ]);
        finish(setup, entry, code);
      })
      .catch(() => {
        void drained.then(() => finish(setup, entry, null));
      });
  };

  const feed = (request: SetupStdinRequest): void => {
    const entry = live.get(request.setup);
    if (entry === undefined) {
      options.say(errorLine(request.id, SETUP_LANE_SENTENCES.unknown));
      return;
    }
    // THE ONLY ROAD THE CODE TAKES: the child's stdin, then a newline. It is
    // not kept here, not echoed and not written anywhere; the child's own
    // output is the child's business.
    try {
      entry.child.write(request.text + "\n");
    } catch {
      // A child that is already gone takes nothing; its ending is the answer.
    }
  };

  const cancel = (request: SetupCancelRequest): void => {
    const entry = live.get(request.setup);
    if (entry === undefined) {
      // A cancel for a child that already ended is answered, not ignored.
      options.say(errorLine(request.id, SETUP_LANE_SENTENCES.unknown));
      return;
    }
    entry.killed = true;
    try {
      entry.child.kill();
    } catch {
      // Already gone: its exit still states the ending.
    }
  };

  const shutdown = async (): Promise<void> => {
    closing = true;
    const running = [...live.values()];
    // Kill, then wait for each child to be reaped so this process cannot exit
    // before its children are gone. The table empties through finish().
    await Promise.all(
      running.map(async (entry) => {
        entry.killed = true;
        try {
          entry.child.kill();
        } catch {
          // Already gone.
        }
        await Promise.race([
          entry.child.exited.catch(() => 0),
          new Promise<void>((resolve) => {
            setTimeout(resolve, SETUP_REAP_MS);
          }),
        ]);
      }),
    );
  };

  return { start, feed, cancel, shutdown };
}
