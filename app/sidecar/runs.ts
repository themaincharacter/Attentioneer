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
 * PROVISIONAL: the run numbers, the two refusals below and the choice to route
 * the ending through `run-end` rather than a final `run-part`.
 */

import {
  errorLine,
  runEndLine,
  runPartLine,
  type RunRequest,
} from "../src/turn/protocol.ts";
import {
  sessionPermissionReply,
  startAcpRun,
  type AcpRunHandle,
} from "../src/turn/acpRun.ts";
import type { AcpSpec } from "../src/turn/acpSpecs.ts";

/** The lane's own two refusals, in the sidecar's one-sentence voice. */
export const RUN_LANE_SENTENCES = {
  busy: "that run number is already running.",
  unknown: "no run is live with that number.",
} as const;

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

/** One live run: the run's originating request id, and its handle. */
interface LiveRun {
  id: number;
  handle: AcpRunHandle;
}

/** The lane's contract with main.ts: start, cancel, close everything. */
export interface RunLane {
  /** Start one run from a parsed `run` request. Never awaited by the reader. */
  start(request: RunRequest): void;
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
    const handle = startAcpRun(runSpecOf(request), request.prompt, {
      // THE KEY IS ALREADY HERE, and it is the only road: no store, no row.
      readKey: async () => "",
      resolvedEnv: request.env,
      // 18.3's smallest permission policy stays where the run is (18.4 decides
      // who decides; this story moves the lane, not the policy).
      replyToPermission: sessionPermissionReply,
      onProgress: (entry) => {
        // The ending is run-end's, said ONCE — never a second run-part.
        if (entry.kind === "ended") return;
        options.say(runPartLine(request.id, request.run, entry));
      },
    });
    live.set(request.run, { id: request.id, handle });
    // The window's subscription is by the run's OWN request id, so the ending
    // arrives on the id it asked with even when the answer is a cancel's.
    void handle.result.then((result) => {
      live.delete(request.run);
      options.say(
        runEndLine(request.id, request.run, result.ending, result.sentence),
      );
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

  return { start, cancel, shutdown };
}
