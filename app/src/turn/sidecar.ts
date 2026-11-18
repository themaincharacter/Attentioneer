import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  parseSidecarLine,
  type SidecarLine,
  type TurnMessage,
} from "./protocol";
import {
  buildTurnMessages,
  errorSentence,
  runRoute,
  runRoutePacket,
  stopTurn,
  type CliTurnRunner,
  type PacketTurnAnswer,
  type TurnOptions,
  type TurnPort,
  type TurnResult,
  type TurnRoute,
  type TurnStart,
  type TurnTransport,
} from "./turn";
import { cliCancelArgs, cliRunArgs, cliWhereArgs } from "./cliBridge";
import { startLocal } from "./localBridge";
import { localBaseUrl } from "./local";
import type { AskPacket } from "./packet";
import type { LocalProviderRow, ModelRow } from "./providers";

/**
 * THE WINDOW'S SIDE OF THE SIDECAR (Epic 15 story 1; ADR-0034).
 *
 * Three things and nothing else: start (spawn or reuse), send a line, and
 * listen for lines. The Rust side owns the process, so the window never sees a
 * PID, a path or a pipe — it sees `sidecar-line` events whose payload is one
 * line of the wire. Which turn a line belongs to is the line's `id`, and this
 * module fans lines out to the one subscriber waiting on that id.
 *
 * WHY NOT A SOCKET: ADR-0034. If a browser devtools or another app wanted to
 * talk to a turn, that would be a new ADR — there is deliberately no address
 * to find here.
 *
 * The API key crosses this module exactly once per turn, inside the request
 * line it is handed, and it is never logged: no `console` call in this file
 * takes a line or a provider.
 *
 * A STOP REACHES BOTH PLACES A TURN CAN RUN (story 7): the sidecar's fetch is
 * aborted, and a CLI child is killed by the token the turn minted for it. The
 * port remembers one token at a time and clears it after use, so a second
 * press can never kill a later turn's child.
 *
 * PROVISIONAL: the event's name (mirrored in `sidecar.rs`) and the status
 * shape. A compiled sidecar binary is a later story.
 */

/** What the host says about the child. Mirrors `sidecar.rs`'s camelCase. */
export interface SidecarStatus {
  /** A live child is there to take a line. */
  running: boolean;
  /** The entry the host runs (today always the dev `sidecar/main.ts`). */
  entry: string;
  /** `"dev-entry"` today; `"compiled"` is a later story. */
  entryKind: string;
  /** The Bun executable the host resolved (env var or PATH). */
  bun: string;
}

/** A start attempt: a running child, or the ONE sentence the panel shows. */
export type SidecarStart =
  | { kind: "running"; status: SidecarStatus }
  | { kind: "refused"; sentence: string };

/**
 * Spawn the child on first use (or reuse the live one) and wait for its
 * `hello` under the host's five-second budget. A refusal is a sentence, never
 * a thrown error and never a hang: the Rust command answers Err with one line
 * for a missing Bun, a missing entry, a spawn failure or a silent child.
 */
export async function startSidecar(): Promise<SidecarStart> {
  try {
    const status = await invoke<SidecarStatus>("sidecar_start");
    return { kind: "running", status };
  } catch (error) {
    return { kind: "refused", sentence: errorSentence(String(error)) };
  }
}

/** The child's state without spawning anything; `null` when none ever ran. */
export async function sidecarStatus(): Promise<SidecarStatus | null> {
  try {
    return await invoke<SidecarStatus | null>("sidecar_status");
  } catch {
    return null;
  }
}

/** Write one already-built line to the child (the host enforces one line). */
export async function sendSidecarLine(line: string): Promise<void> {
  await invoke("sidecar_send", { line });
}

/** The subscribers by turn id. One window, one map: ids are window-local. */
const waiting = new Map<number, (line: SidecarLine) => void>();

/** One shared listener for the whole window, started on first use. */
let listening: Promise<unknown> | null = null;

function ensureListening(): Promise<unknown> {
  if (listening === null) {
    listening = listen<string>("sidecar-line", (event) => {
      const line = parseSidecarLine(event.payload);
      // A hello is the start's business (Rust already waited on it); a line
      // that does not parse is ignored rather than reported — the window did
      // not ask the sidecar to write it.
      if (line === null || line.kind === "hello") return;
      waiting.get(line.id)?.(line);
    });
  }
  return listening;
}

/**
 * STORY 18.3c — THE CHANNEL'S CLOSE, AS THE WINDOW CAN KNOW IT.
 *
 * 18.3b's finding was that kill-on-every-path was proven from the SIDECAR'S
 * side: stdin closed, stdout closed, a cancel, an ending, a dead child. What it
 * could not prove is the other direction — a sidecar that DIES mid-run says
 * nothing, and the window sat on the run's last entry until the budget expired
 * and called it a timeout. That is the hang-in-a-costume this story removes.
 *
 * THE WINDOW CANNOT SEE A PIPE, so it asks the host that owns the child. The
 * host already reaps the sidecar and its `sidecar_status` (a `try_wait`) is
 * the one honest answer to "is it still there", so while anyone is listening
 * this asks — cheaply, and only while a run is live. A host that cannot answer
 * is not a host that lost the child: an invoke that throws keeps the watch
 * going rather than inventing a death.
 *
 * PROVISIONAL: the 250 ms cadence and the fact that the window polls at all.
 * A later story could have the host announce the exit instead; until then the
 * window asks, and a dead child settles a run well inside the second the story
 * promises.
 */
export const SIDECAR_WATCH_MS = 250;

/** The handlers waiting to hear the channel close (one run each). */
const watchingChannel = new Set<() => void>();

/** The one watch timer; it exists only while something is listening. */
let channelWatch: ReturnType<typeof setInterval> | null = null;

function stopChannelWatch(): void {
  if (channelWatch === null) return;
  clearInterval(channelWatch);
  channelWatch = null;
}

/** Is the child the host owns still there? An unanswerable host is not a death. */
async function childIsGone(): Promise<boolean> {
  try {
    const status = await invoke<SidecarStatus | null>("sidecar_status");
    return status === null || !status.running;
  } catch {
    return false;
  }
}

/**
 * Hear the close: register one handler, start the watch if it is the first, and
 * answer with an unsubscribe that stops the watch when it is the last. Every
 * handler is told ONCE and the set is emptied, so a housekeeping tick cannot
 * announce the same death twice.
 */
function watchChannel(handler: () => void): () => void {
  watchingChannel.add(handler);
  if (channelWatch === null) {
    channelWatch = setInterval(() => {
      void childIsGone().then((gone) => {
        if (!gone) return;
        const told = [...watchingChannel];
        watchingChannel.clear();
        stopChannelWatch();
        for (const listener of told) listener();
      });
    }, SIDECAR_WATCH_MS);
  }
  return () => {
    watchingChannel.delete(handler);
    if (watchingChannel.size === 0) stopChannelWatch();
  };
}

/**
 * The real transport: start listening before the request leaves (so a fast
 * answer cannot outrun its subscriber), then write the line.
 */
export function createSidecarTransport(): TurnTransport {
  return {
    async send(line) {
      await ensureListening();
      await sendSidecarLine(line);
    },
    subscribe(id, handler) {
      waiting.set(id, handler);
      void ensureListening();
      return () => {
        if (waiting.get(id) === handler) waiting.delete(id);
      };
    },
    // 18.3c: the seam that needs a close is a run's; a turn still ends by its
    // own budget, so nothing here changes a turn's behaviour.
    onClosed(handler) {
      return watchChannel(handler);
    },
  };
}

/**
 * THE APP'S TURN PORT: one call site for "ask this question", one for "stop
 * it". The panel takes it as a prop, so the panel (and a render test) never
 * touches Tauri; the app passes `createTurnPort()` once.
 */
export function createTurnPort(
  transport: TurnTransport = createSidecarTransport(),
  cli: CliTurnRunner = hostCliRunner(),
): TurnPort {
  let active: number | null = null;
  /** The CLI child a stop can kill: its token, never its PID or path. */
  let activeCli: string | null = null;

  /**
   * The local runtime's process layer, as the turn wants it: start (or reuse)
   * the child for this row and turn its launch facts into the SAME provider
   * shape the HTTP tier has always used. The key exists in this object for the
   * one request line and nowhere else.
   */
  async function ensureLocal(
    row: LocalProviderRow,
    model: ModelRow,
  ): Promise<
    { kind: "running"; provider: { baseUrl: string; model: string; apiKey: string } } | { kind: "refused"; sentence: string }
  > {
    const started = await startLocal(
      row.id,
      row.command,
      row.args,
      row.model,
      row.readyPattern,
      row.idleMinutes,
    );
    if (started.kind === "refused") return started;
    const port = started.status.port;
    const key = started.status.key;
    if (port === null || key === null) {
      return {
        kind: "refused",
        sentence: "the local runtime started without reporting its port",
      };
    }
    return {
      kind: "running",
      provider: { baseUrl: localBaseUrl(port), model: model.id, apiKey: key },
    };
  }

  /**
   * Start the child and say whether anything can leave. A refusal is one
   * sentence (Rust worded it), never a thrown error: the app-sent Ask uses
   * this to fall back to the clipboard BEFORE anything leaves — a sidecar that
   * cannot start is not an Ask that failed.
   */
  async function begin(): Promise<TurnStart> {
    const started = await startSidecar();
    return started.kind === "running"
      ? { kind: "running" }
      : { kind: "refused", sentence: started.sentence };
  }

  /**
   * Whether anything can leave for THIS route: an endpoint needs the child up,
   * a CLI needs its command to resolve. Both answers are one sentence.
   */
  async function start(route?: TurnRoute): Promise<TurnStart> {
    if (route?.kind === "cli") {
      const found = await cliWhereArgs(
        route.spec.command,
        route.spec.wellKnown ?? [],
      );
      return found.kind === "resolved"
        ? { kind: "running" }
        : { kind: "refused", sentence: found.sentence };
    }
    // A local route starts its child FIRST (and touches the idle timer); the
    // HTTP pipe is then the ordinary one.
    if (route?.kind === "local") {
      const local = await ensureLocal(route.row, route.model);
      if (local.kind === "refused") {
        return { kind: "refused", sentence: local.sentence };
      }
      // Both children must be up before a local turn can leave: the model
      // server on loopback, and the sidecar that makes the HTTP call.
      return await begin();
    }
    return await begin();
  }

  /**
   * One CLI turn: no sidecar, no pipe, no record — the host runs one argv and
   * hands back the facts.
   */
  async function runCli(
    route: TurnRoute,
    question: string,
    options: TurnOptions = {},
  ): Promise<TurnResult> {
    const result = await runRoute(
      transport,
      route,
      buildTurnMessages(question),
      {
        ...options,
        cli,
        // The token exists before the child does, so a stop that lands during
        // the spawn still names the child that is about to run.
        onCliStart: (runId) => {
          activeCli = runId;
        },
      },
    );
    // The child has answered (or failed); its token must not be aimed at a
    // later turn's child. A stop that arrives after this finds nothing.
    activeCli = null;
    return result;
  }

  /**
   * STORY 17.12 — THE CURATOR'S ONE TURN (ADR-0037 decision 9): the caller's
   * own messages, over the SAME route and the SAME request line as a task call,
   * with the MANAGER row. No READ follow-up and no proposal scan: the curator
   * reads the reply and answers one card. The child is started FIRST, so a
   * refused route is one sentence BEFORE anything is written to the pipe.
   */
  async function runMessages(
    route: TurnRoute,
    messages: readonly TurnMessage[],
    options: TurnOptions = {},
  ): Promise<TurnResult> {
    if (route.kind === "cli") {
      const result = await runRoute(transport, route, messages, {
        ...options,
        cli,
        onCliStart: (runId) => {
          activeCli = runId;
        },
      });
      activeCli = null;
      return result;
    }
    if (route.kind === "local") {
      const local = await ensureLocal(route.row, route.model);
      if (local.kind === "refused") {
        return { kind: "error", sentence: local.sentence };
      }
      const child = await begin();
      if (child.kind === "refused") {
        return { kind: "error", sentence: child.sentence };
      }
      return await runRoute(transport, route, messages, {
        ...options,
        onStart: (id) => {
          active = id;
        },
        local: ensureLocal,
      });
    }
    const started = await begin();
    if (started.kind === "refused") {
      return { kind: "error", sentence: started.sentence };
    }
    const result = await runRoute(transport, route, messages, {
      ...options,
      onStart: (id) => {
        active = id;
      },
    });
    active = null;
    return result;
  }

  /**
   * The app-sent Ask's packet turn (Epic 15 story 3): the child is started
   * FIRST, so "nothing left" is known rather than guessed; then the packet's
   * ONE message crosses the pipe and at most one READ follow-up follows it.
   */
  async function runPacket(
    route: TurnRoute,
    packet: AskPacket,
    fetchBlock: (name: string) => Promise<string | null>,
    options: TurnOptions = {},
  ): Promise<PacketTurnAnswer> {
    // A CLI route starts nothing here: the host spawns the command for the one
    // turn, and a stop kills that child by its token. An endpoint route is
    // story 3's.
    if (route.kind === "cli") {
      const answer = await runRoutePacket(transport, route, packet, fetchBlock, {
        ...options,
        cli,
        onCliStart: (runId) => {
          activeCli = runId;
        },
      });
      activeCli = null;
      return answer;
    }
    if (route.kind === "local") {
      const local = await ensureLocal(route.row, route.model);
      if (local.kind === "refused") {
        return {
          result: { kind: "error", sentence: local.sentence },
          messages: [...packet.messages],
          read: null,
          missed: null,
          reached: null,
        };
      }
      const child = await begin();
      if (child.kind === "refused") {
        return {
          result: { kind: "error", sentence: child.sentence },
          messages: [...packet.messages],
          read: null,
          missed: null,
          reached: null,
        };
      }
      return await runRoutePacket(transport, route, packet, fetchBlock, {
        ...options,
        onStart: (id) => {
          active = id;
        },
        local: ensureLocal,
      });
    }
    const started = await begin();
    if (started.kind === "refused") {
      return {
        result: { kind: "error", sentence: started.sentence },
        messages: [...packet.messages],
        read: null,
        missed: null,
        reached: null,
      };
    }
    const answer = await runRoutePacket(transport, route, packet, fetchBlock, {
      ...options,
      onStart: (id) => {
        active = id;
      },
    });
    active = null;
    return answer;
  }

  return {
    start,
    ask: async (route, question, options?: TurnOptions) => {
      if (route.kind === "cli") return await runCli(route, question, options);
      if (route.kind === "local") {
        // The HTTP pipe must be up for the turn, and the local child too.
        const child = await begin();
        if (child.kind === "refused") {
          return { kind: "error", sentence: child.sentence };
        }
        return await runRoute(transport, route, buildTurnMessages(question), {
          ...options,
          onStart: (id) => {
            active = id;
          },
          local: ensureLocal,
        });
      }
      return await runRoute(transport, route, buildTurnMessages(question), {
        ...options,
        onStart: (id) => {
          active = id;
        },
      });
    },
    sendPacket: runPacket,
    sendMessages: runMessages,
    async stop() {
      // A stop reaches BOTH places a turn can be running: the sidecar's fetch
      // (its AbortController answers cancelled) and a CLI child (the host
      // kills it by token). One is usually null; both are cleared, so a
      // second press cannot kill a later turn's child by a stale token.
      const cliRun = activeCli;
      activeCli = null;
      if (cliRun !== null) await cliCancelArgs(cliRun);
      if (active === null) return;
      const id = active;
      active = null;
      await stopTurn(transport, id);
    },
  };
}

/**
 * The host's CLI process layer, as the turn wants it: the spec's command and
 * places, the already-built argv, and the turn's stated budget.
 */
function hostCliRunner(): CliTurnRunner {
  return (spec, args, timeoutMs, runId) =>
    cliRunArgs(spec.command, spec.wellKnown ?? [], args, timeoutMs, runId);
}
