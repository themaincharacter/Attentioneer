import {
  setupCancelLine,
  setupRequestLine,
  setupStdinLine,
  type SetupEnding,
  type SetupTool,
} from "./protocol";
import { createSidecarTransport, startSidecar } from "./sidecar";
import { errorSentence, type TurnTransport } from "./turn";
import { acpMissingKeySentence, type AcpSpec } from "./acpSpecs";
import { signInToolOf } from "./acpSetup";
import { readSecret } from "../lib/secret";
import type { SidecarStart } from "./sidecar";

/**
 * THE WINDOW'S SIDE OF ONE SETUP CHILD (story 22.1b; PROVISIONAL).
 *
 * WHAT THIS FILE IS: the small seam between a session card and the sidecar's
 * setup lane (`sidecar/setups.ts`), shaped exactly like `acpSession.ts`: the
 * same transport, the same fan-out by request id, the same one-sentence
 * refusal and no second pipe. A row that declares `signIn.args` gets one child;
 * its stdout and stderr arrive as lines, the person's code goes back up, and
 * the ending states the exit code and the last line.
 *
 * WHY IT IS ITS OWN FILE AND NOT A RUN: a run writes a transcript, sends a
 * prompt and carries a key grant; a sign-in is the TOOL's own business and the
 * app only hosts it. Nothing here imports the run lane, and nothing here writes
 * anything: the caller keeps view state, and the code lives in the card's field
 * for the length of one line.
 *
 * THE KEY IS READ HERE, AS A RUN'S IS, AND THEN ONLY ON THE WIRE. The row's env
 * entries name provider rows; this module asks the store for each value, builds
 * a RESOLVED map exactly as a run request does, and puts it in the setup
 * request's payload. The sidecar hands the map to the child (plus PATH/HOME)
 * and reads no store of its own.
 *
 * A SIDECAR THAT DIES MID-SIGN-IN IS SAID, NOT WAITED ON: the transport's
 * close signal settles the handle with one sentence, so the card never sits on
 * a child that is already gone. Nothing is retried here.
 *
 * PROVISIONAL: the setup numbers (one counter for the request id and the setup
 * number), and the two sentences below.
 */

/** The one sentence for a setup request that could not even leave. */
export const SETUP_UNREACHABLE =
  "the sign-in could not be asked for, so it was not started.";

/** The one sentence for a channel that closed under a live setup child. */
export const SETUP_CONNECTION_ENDED = "the connection to the sign-in ended";

/** How one setup child settled, as the sidecar said. */
export interface SetupChildEnd {
  ending: SetupEnding;
  /** The child's exit code, or null when it never started. */
  exitCode: number | null;
  /** The last line the child printed, or null when it printed none. */
  line: string | null;
  /** The lane's one sentence when nothing could start; null otherwise. */
  sentence: string | null;
}

/** The caller's side of one setup child: watch it, feed it, stop it. */
export interface SetupChildHandle {
  /** Settles once the sidecar stated how the child ended (or the seam refused). */
  readonly ended: Promise<SetupChildEnd>;
  /** Hand the person's code to the child's stdin. */
  sendCode(text: string): void;
  /** Stop the child: `setup-cancel`, answered by its own `setup-end`. */
  cancel(): void;
}

/** What one setup child needs from the app; everything is injected. */
export interface SetupChildWiring {
  /** The key for ONE provider row, read at request time and never logged. */
  readKey?: (providerId: string) => Promise<string>;
  /** The sidecar pipe; the app's own by default. */
  transport?: TurnTransport;
  /** Make sure the child is up; `startSidecar` by default. */
  start?: () => Promise<SidecarStart>;
  /** Every line the setup child printed, in arrival order, with its stream. */
  onLine?: (line: { stream: "stdout" | "stderr"; line: string }) => void;
}

/** One counter for the window's setup children and their cancels. */
let nextSetupId = 1;

/**
 * Start ONE setup child for a row. The handle settles with the ending the lane
 * stated; a row that declares no sign-in is refused here in one sentence and
 * nothing is spawned.
 */
export function startSetupChild(
  row: AcpSpec,
  wiring: SetupChildWiring = {},
): SetupChildHandle | null {
  const tool: SetupTool | null = signInToolOf(row);
  if (tool === null) return null;
  const transport = wiring.transport ?? createSidecarTransport();
  const start = wiring.start ?? startSidecar;
  const readKey = wiring.readKey ?? readSecret;

  let settled = false;
  let setup = 0;
  let unsubscribe: () => void = () => {};
  let stopClosing: () => void = () => {};
  let resolveEnded!: (end: SetupChildEnd) => void;
  const ended = new Promise<SetupChildEnd>((resolve) => {
    resolveEnded = resolve;
  });

  // THE ONE ENDING: a close that races a real ending finds `settled` already
  // true and says nothing, so one child never produces two endings.
  const finish = (end: SetupChildEnd): void => {
    if (settled) return;
    settled = true;
    unsubscribe();
    stopClosing();
    resolveEnded(end);
  };

  const sendCode = (text: string): void => {
    if (settled || setup === 0) return;
    void transport.send(setupStdinLine(nextSetupId++, setup, text)).catch(() => {});
  };

  const cancel = (): void => {
    if (settled || setup === 0) return;
    void transport.send(setupCancelLine(nextSetupId++, setup)).catch(() => {});
  };

  void (async () => {
    // THE KEY FIRST, exactly as a run reads its key: one store read per
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
        finish({
          ending: "failed",
          exitCode: null,
          line: null,
          sentence: acpMissingKeySentence(entry.key),
        });
        return;
      }
      env[entry.name] = value;
    }

    // The sidecar must exist before a request is handed to it.
    let started: SidecarStart;
    try {
      started = await start();
    } catch {
      finish({
        ending: "failed",
        exitCode: null,
        line: null,
        sentence: SETUP_UNREACHABLE,
      });
      return;
    }
    if (started.kind === "refused") {
      finish({
        ending: "failed",
        exitCode: null,
        line: null,
        sentence: started.sentence,
      });
      return;
    }

    const id = nextSetupId++;
    setup = id;
    // Subscribe BEFORE the request leaves, so a fast line cannot outrun us.
    unsubscribe = transport.subscribe(id, (line) => {
      if (line.kind === "hello") return;
      if (line.id !== id) return;
      if (line.kind === "setup-part") {
        wiring.onLine?.({ stream: line.stream, line: line.line });
        return;
      }
      if (line.kind === "setup-end") {
        // A lane's exit ENDING carries the child's last line and no sentence:
        // a child that never started was answered by an error line instead.
        finish({
          ending: line.ending,
          exitCode: line.exitCode,
          line: line.line,
          sentence: null,
        });
        return;
      }
      if (line.kind === "error") {
        finish({
          ending: "failed",
          exitCode: null,
          line: null,
          sentence: errorSentence(line.message),
        });
      }
    });

    stopClosing =
      transport.onClosed?.(() =>
        finish({
          ending: "failed",
          exitCode: null,
          line: null,
          sentence: SETUP_CONNECTION_ENDED,
        }),
      ) ?? (() => {});

    try {
      await transport.send(setupRequestLine(id, id, tool, env));
    } catch {
      finish({
        ending: "failed",
        exitCode: null,
        line: null,
        sentence: SETUP_UNREACHABLE,
      });
    }
  })();

  return { ended, sendCode, cancel };
}
