import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { parseSidecarLine, type SidecarLine } from "./protocol";
import {
  buildTurnMessages,
  errorSentence,
  runRoute,
  runRoutePacket,
  stopTurn,
  type CliTurnRunner,
  type PacketTurnAnswer,
  type TurnPort,
  type TurnResult,
  type TurnRoute,
  type TurnStart,
  type TurnTransport,
} from "./turn";
import { cliRunArgs, cliWhereArgs } from "./cliBridge";
import type { AskPacket } from "./packet";

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
    return await begin();
  }

  /**
   * One CLI turn: no sidecar, no pipe, no record — the host runs one argv and
   * hands back the facts.
   */
  async function runCli(route: TurnRoute, question: string): Promise<TurnResult> {
    return await runRoute(transport, route, buildTurnMessages(question), {
      cli,
    });
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
  ): Promise<PacketTurnAnswer> {
    // A CLI route starts nothing here: the host spawns the command for the one
    // turn, and its own timeout is the kill. An endpoint route is story 3's.
    if (route.kind === "cli") {
      return await runRoutePacket(transport, route, packet, fetchBlock, {
        cli,
      });
    }
    const started = await begin();
    if (started.kind === "refused") {
      return {
        result: { kind: "error", sentence: started.sentence },
        messages: [...packet.messages],
        read: null,
        missed: null,
      };
    }
    const answer = await runRoutePacket(transport, route, packet, fetchBlock, {
      onStart: (id) => {
        active = id;
      },
    });
    active = null;
    return answer;
  }

  return {
    start,
    ask: (route, question) =>
      route.kind === "cli" ? runCli(route, question) : runRoute(transport, route, buildTurnMessages(question), {
        onStart: (id) => {
          active = id;
        },
      }),
    sendPacket: runPacket,
    async stop() {
      // A stop reaches the sidecar's turn; a CLI child is the host's and its
      // stated timeout is what ends it (PROVISIONAL: no mid-turn CLI cancel).
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
  return (spec, args, timeoutMs) =>
    cliRunArgs(spec.command, spec.wellKnown ?? [], args, timeoutMs);
}
