import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  parseSidecarLine,
  type SidecarLine,
  type TurnMessage,
  type TurnProvider,
} from "./protocol";
import {
  askTurnMessages,
  buildPacketMessages,
  buildTurnMessages,
  errorSentence,
  stopTurn,
  type TurnPort,
  type TurnResult,
  type TurnStart,
  type TurnTransport,
} from "./turn";

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

  /** One turn over the shared transport, with the messages the caller built. */
  async function run(
    provider: TurnProvider,
    messages: readonly TurnMessage[],
  ): Promise<TurnResult> {
    const started = await begin();
    if (started.kind === "refused") {
      return { kind: "error", sentence: started.sentence };
    }
    const result = await askTurnMessages(transport, provider, messages, {
      onStart: (id) => {
        active = id;
      },
    });
    active = null;
    return result;
  }

  return {
    start: begin,
    ask: (provider, question) => run(provider, buildTurnMessages(question)),
    sendPacket: (provider, packet) => run(provider, buildPacketMessages(packet)),
    async stop() {
      if (active === null) return;
      const id = active;
      active = null;
      await stopTurn(transport, id);
    },
  };
}
