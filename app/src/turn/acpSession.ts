import {
  runCancelLine,
  runPermissionReplyLine,
  runRequestLine,
  type RunTool,
} from "./protocol";
import { createSidecarTransport, startSidecar } from "./sidecar";
import { errorSentence, type TurnTransport } from "./turn";
import { acpMissingKeySentence, type AcpSpec } from "./acpSpecs";
import type {
  AcpEnding,
  AcpPermissionAsk,
  AcpPermissionChoice,
  AcpProgressEntry,
} from "./acpEntries";
import { readSecret } from "../lib/secret";
import type { SidecarStart } from "./sidecar";

/**
 * THE WINDOW'S SIDE OF ONE SESSION RUN (Epic 18 story 3b).
 *
 * WHY THIS FILE EXISTS. Story 18.3 drove `startAcpRun` straight from the card's
 * hook, which meant the window itself had to spawn a process — and a WebView
 * cannot, so the shipped app refused RUN with one sentence and wrote nothing.
 * The run now happens in the Bun sidecar (`sidecar/runs.ts`); this module is the
 * small seam between the card and that lane, shaped like `pageFetch.ts` on
 * purpose: the same transport, the same fan-out by id, the same one-sentence
 * refusal, no second pipe.
 *
 * THE KEY IS READ HERE, AS A TURN'S IS, AND THEN ONLY ON THE WIRE. The row's
 * env entries name provider rows; this module asks the store for each value,
 * builds a RESOLVED map, and puts it in the run request's payload. It never
 * appears in an argv, a log line or a sentence — the sidecar hands the map to
 * the child (plus PATH/HOME) and reads no store of its own. A declared key the
 * store does not have is refused HERE, with 18.2's one sentence, before any
 * request leaves: the same rule a turn follows.
 *
 * A PARTIAL IS NOT A RESULT (unchanged): the ending the sidecar states is the
 * run's own, and only "completed" is a result. The window invents no ending and
 * appends nothing it did not hear.
 *
 * A SIDECAR THAT DIES MID-RUN IS SAID, NOT WAITED ON (story 18.3c). 18.3b's
 * finding was that its kill-on-every-path proof ran from the SIDECAR's side; the
 * window had no death signal, so a vanished child left the card on its last
 * entry until the budget expired and then called it a timeout — a hang dressed
 * as a timeout. The transport now says when the channel closes (`onClosed`),
 * and this seam turns that into the SAME ending a normal run writes: the
 * `failed` ending, one sentence, one `ended` entry, no new record shape. The
 * next request starts a fresh child on demand — the host already reaps the dead
 * one — so the seam stays usable and nothing here reports a health state.
 * PROVISIONAL: the sentence, and that the seam silently restarts rather than
 * telling the caller it is unhealthy.
 *
 * PROVISIONAL: the run numbers (one counter for both the request id and the run
 * number), the one sentence for a lane that cannot be asked, and the ending
 * being `run-end` rather than a final `run-part`.
 */

/** The one sentence for a run request that could not even leave (PROVISIONAL). */
export const SESSION_RUN_UNREACHABLE =
  "the run could not be asked for, so it was not started.";

/**
 * The one sentence for a channel that closed under a live run (story 18.3c,
 * PROVISIONAL). It names what happened and nothing else: no stack, no exit
 * code, no pid — the window did not see any of those. The card states it as
 * "the run failed: the connection to the run ended".
 */
export const SESSION_RUN_CONNECTION_ENDED = "the connection to the run ended";

/** How a run settled, as the sidecar said: the ending and its one sentence. */
export interface SessionRunEnded {
  ending: AcpEnding;
  /** One quiet sentence for failed and timed-out runs; null otherwise. */
  sentence: string | null;
}

/** The caller's side of one run: watch it, answer it, stop it, hear the ending. */
export interface SessionRunHandle {
  /** Settles once the sidecar stated how the run ended (or the lane refused). */
  readonly ended: Promise<SessionRunEnded>;
  /** Stop it: `run-cancel`, answered by the run's own `run-end`. */
  cancel(): void;
  /**
   * STORY 18.4 — answer the pending ask with ONE verb. The sidecar turns the
   * verb into the matching option; this seam never names an option id.
   */
  answerPermission(ask: number, choice: AcpPermissionChoice): void;
}

/** What one run needs from the app; everything here is injected and testable. */
export interface SessionRunWiring {
  /** The key for ONE provider row, read at request time and never logged. */
  readKey?: (providerId: string) => Promise<string>;
  /** The sidecar pipe; the app's own by default. */
  transport?: TurnTransport;
  /** Make sure the child is up; `startSidecar` by default. */
  start?: () => Promise<SidecarStart>;
  /** Every progress entry as it arrives, in order. */
  onEntry?: (entry: AcpProgressEntry) => void;
  /**
   * STORY 18.4 — a server's permission request, as it arrives. The person's
   * surface shows it and answers with the handle's `answerPermission`. Nothing
   * answers it here: an unwatched run waits for its budget.
   */
  onPermission?: (ask: AcpPermissionAsk) => void;
}

/** One counter for the window's runs and their cancels: ids never collide. */
let nextRunId = 1;

/** The wire's tool, built from the row. Argv only; no key is ever here. */
export function runToolOf(row: AcpSpec): RunTool {
  return {
    command: row.command,
    args: [...row.args],
    timeoutMinutes: row.timeoutMinutes,
  };
}

/**
 * Start ONE run through the sidecar. The handle settles with the ending the
 * lane stated; `cancel` asks the lane to stop it, and the lane's own ending is
 * the answer. Nothing is written here — the transcript is the caller's.
 */
export function startSessionRun(
  row: AcpSpec,
  prompt: string,
  wiring: SessionRunWiring = {},
): SessionRunHandle {
  const transport = wiring.transport ?? createSidecarTransport();
  const start = wiring.start ?? startSidecar;
  const readKey = wiring.readKey ?? readSecret;

  let settled = false;
  let run = 0;
  let unsubscribe: () => void = () => {};
  /** Stop hearing the channel close once this run has ended. */
  let stopClosing: () => void = () => {};
  let resolveEnded!: (ended: SessionRunEnded) => void;
  const ended = new Promise<SessionRunEnded>((resolve) => {
    resolveEnded = resolve;
  });

  // THE ONE ENDING (18.3c's guard): a close that races a real ending finds
  // `settled` already true and says nothing, so a run can never produce a
  // second `ended` line. Both listeners are dropped on the way out.
  const finish = (ending: AcpEnding, sentence: string | null): void => {
    if (settled) return;
    settled = true;
    unsubscribe();
    stopClosing();
    resolveEnded({ ending, sentence });
  };

  const cancel = (): void => {
    if (settled || run === 0) return;
    // A cancel that cannot leave is simply not heard; the run's own budget
    // ends it, and its ending is still written by the lane.
    void transport.send(runCancelLine(nextRunId++, run)).catch(() => {});
  };

  /**
   * STORY 18.4 — THE PERSON'S ONE VERB, sent up. A reply that cannot leave is
   * simply not heard: the run then waits for its budget, which is the honest
   * ending rather than an invented one.
   */
  const answerPermission = (ask: number, choice: AcpPermissionChoice): void => {
    if (settled || run === 0) return;
    void transport
      .send(runPermissionReplyLine(nextRunId++, run, ask, choice))
      .catch(() => {});
  };

  void (async () => {
    // THE KEY FIRST, exactly as a turn reads its key: one store read per
    // declared entry, in memory, into a map that rides the payload.
    const env: Record<string, string> = {};
    for (const entry of row.env) {
      let value = "";
      try {
        value = await readKey(entry.key);
      } catch {
        value = "";
      }
      if (value === "") {
        // 18.2's sentence, said before anything leaves: the row names a key
        // this app does not keep, so no child is spawned for it.
        finish("failed", acpMissingKeySentence(entry.key));
        return;
      }
      env[entry.name] = value;
    }

    // The child must exist before a request is handed to it.
    let started: SidecarStart;
    try {
      started = await start();
    } catch {
      finish("failed", SESSION_RUN_UNREACHABLE);
      return;
    }
    if (started.kind === "refused") {
      finish("failed", started.sentence);
      return;
    }

    const id = nextRunId++;
    run = id;
    // Subscribe BEFORE the request leaves, so a fast entry cannot outrun us.
    unsubscribe = transport.subscribe(id, (line) => {
      // A hello is the start's business; it never carries a run.
      if (line.kind === "hello") return;
      if (line.id !== id) return;
      // STORY 18.4: the server's ask reaches the person's surface. Nothing is
      // answered here — the card's two verbs call `answerPermission`.
      if (line.kind === "run-permission") {
        wiring.onPermission?.({
          id: line.ask,
          method: line.method,
          toolCall: line.toolCall,
          options: line.options,
        });
        return;
      }
      if (line.kind === "run-part") {
        wiring.onEntry?.(line.entry);
        return;
      }
      if (line.kind === "run-end") {
        finish(line.ending, line.sentence);
        return;
      }
      if (line.kind === "error") {
        finish("failed", errorSentence(line.message));
      }
    });

    // STORY 18.3c — THE CHANNEL'S CLOSE ENDS THIS RUN AT ONCE. A sidecar that
    // died says nothing on the wire, so the transport's own close signal is the
    // only notice we get; settling here means the card states the loss in the
    // same second it happened, never after the budget. The request goes out
    // only after this is in place, so even a send into a dead pipe is covered.
    stopClosing =
      transport.onClosed?.(() =>
        finish("failed", SESSION_RUN_CONNECTION_ENDED),
      ) ?? (() => {});

    try {
      await transport.send(
        runRequestLine(id, id, runToolOf(row), env, prompt),
      );
    } catch {
      finish("failed", SESSION_RUN_UNREACHABLE);
    }
  })();

  return { ended, cancel, answerPermission };
}
