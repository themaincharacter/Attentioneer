import {
  oneLine,
  requestLine,
  stopLine,
  type SidecarLine,
  type TurnMessage,
  type TurnProvider,
} from "./protocol";

/**
 * ONE TURN (Epic 15 story 1): a provider, a question, one answer.
 *
 * A turn is NOT a move. It writes no record, adds no history line, rewrites no
 * mirror and adds nothing to the map: the question leaves, one answer comes
 * back into the panel's view state, and closing the panel forgets it. That is
 * why this module has no fs import and no write path at all — the only thing
 * it can do is build a request line, await the sidecar's lines for its id, and
 * hand back a sentence.
 *
 * The transport is injected (`TurnTransport`) so the rules below are testable
 * without a process: the app passes the real sidecar (`turn/sidecar.ts`) and
 * a test passes a scripted stand-in. No retry in this story — a failed turn is
 * one sentence, and the person may ask again.
 *
 * TWO MESSAGES: a fixed instruction plus the person's hand-written words. The
 * instruction says, in the model's terms, that it received no map content —
 * story 3 adds the packet, and until then the panel's question is the whole of
 * what leaves (besides the provider's own base URL and model).
 *
 * PROVISIONAL: the timeout (60 s), the instruction's wording and the refusal
 * sentences. ADR-0034 settles the transport, not these.
 */

/** How long the panel waits for the answer before it stops the turn. */
export const TURN_TIMEOUT_MS = 60_000;

/**
 * The fixed instruction. It is deliberately short and says what did NOT come:
 * no map, no previews, no references. PROVISIONAL wording; story 3 replaces
 * the hand-written question with the packet.
 */
export const SYSTEM_MESSAGE =
  "You are answering one question a person asked about one reference on their attention map. No map content was sent with the question — answer from what you know, and say plainly when you do not know.";

/** The sentences the panel shows when the answer is not an answer. */
export const TURN_SENTENCES = {
  /** The person pressed stop (or the sidecar answered `cancelled`). */
  cancelled: "the turn was stopped",
  /** The awaited answer never arrived inside the budget. */
  timeout: "the provider did not answer in time",
  /** The window could not hand the line to the sidecar at all. */
  unreachable: "the turn could not be sent to the sidecar",
  /** The sidecar said `done` without ever sending text. */
  unanswered: "the turn ended without an answer",
  /** Nothing configured yet (the panel's own guard, said in place). */
  noProvider: "a base URL and a model are needed before a turn can leave",
  /** Nothing typed yet (the panel's own guard, said in place). */
  noQuestion: "write a question first",
} as const;

/** The result of one turn: one answer, or one sentence. */
export type TurnResult =
  | { kind: "answer"; text: string }
  | { kind: "error"; sentence: string }
  | { kind: "cancelled"; sentence: string }
  | { kind: "timeout"; sentence: string };

/**
 * What the panel and the port need from a transport: write one line, and be
 * told about the lines that carry one id. The real one wraps Tauri's invokes
 * and its `sidecar-line` event; a test wraps a script.
 */
export interface TurnTransport {
  send: (line: string) => Promise<void>;
  subscribe: (id: number, handler: (line: SidecarLine) => void) => () => void;
}

/** The two messages every hand-written turn sends (story 1). */
export function buildTurnMessages(question: string): TurnMessage[] {
  return [
    { role: "system", content: SYSTEM_MESSAGE },
    { role: "user", content: question.trim() },
  ];
}

/**
 * The PACKET Ask's two messages (Epic 15 story 2): the same fixed instruction,
 * and the packet the Ask composed — the SAME bytes the clipboard route carries.
 * The packet is passed VERBATIM: no trim, no normalization, so the transport
 * can never edit the person's words or the citations the declaration named.
 * PROVISIONAL wording (the instruction is story 1's).
 */
export function buildPacketMessages(packet: string): TurnMessage[] {
  return [
    { role: "system", content: SYSTEM_MESSAGE },
    { role: "user", content: packet },
  ];
}

/** The sentence to show for a result (the answer itself is not a sentence). */
export function turnSentence(result: TurnResult): string {
  return result.kind === "answer" ? result.text : result.sentence;
}

/**
 * A sidecar/provider error line becomes the one sentence the panel shows. The
 * sidecar already worded it and scrubbed the key; this only guarantees one
 * line, and refuses to show an empty one.
 */
export function errorSentence(message: string): string {
  const line = oneLine(message);
  return line === "" ? "the turn failed without a reason" : line;
}

/** Turn ids are local to this window and only need to be unique per session. */
let nextId = 1;

export interface TurnOptions {
  /** Override the stated budget (a test uses a short one). */
  timeoutMs?: number;
  /** Called with the id before the request leaves (the port uses it to stop). */
  onStart?: (id: number) => void;
}

/**
 * Ask one question and await ONE answer.
 *
 * The flow: subscribe for this id, write the request, then wait for
 *   - one `part` (story 1 sends exactly one, and it is the whole answer),
 *   - `done` (the part was the answer; no part is "no answer"),
 *   - `error` (the provider's refusal, as the sidecar worded it),
 *   - `cancelled` (the person's stop reached the sidecar).
 * On timeout it writes a `stop` and answers the timeout sentence. Every path
 * unsubscribes, so a late line for this id reaches nobody.
 */
export async function askTurn(
  transport: TurnTransport,
  provider: TurnProvider,
  question: string,
  options: TurnOptions = {},
): Promise<TurnResult> {
  return askTurnMessages(
    transport,
    provider,
    buildTurnMessages(question),
    options,
  );
}

/**
 * The same turn, with the messages the caller built — the packet Ask's door
 * (story 2). Everything below is the story-1 turn unchanged: one request, one
 * answer, one stop.
 */
export async function askTurnMessages(
  transport: TurnTransport,
  provider: TurnProvider,
  messages: readonly TurnMessage[],
  options: TurnOptions = {},
): Promise<TurnResult> {
  const timeoutMs = options.timeoutMs ?? TURN_TIMEOUT_MS;
  const id = nextId++;
  options.onStart?.(id);

  let settle: (result: TurnResult) => void = () => {};
  let unsubscribe: () => void = () => {};
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let text = "";

  const result = new Promise<TurnResult>((resolve) => {
    settle = resolve;
  });

  const finish = (answer: TurnResult): void => {
    if (settled) return;
    settled = true;
    if (timer !== null) clearTimeout(timer);
    unsubscribe();
    settle(answer);
  };

  unsubscribe = transport.subscribe(id, (line) => {
    if (line.kind === "part" && line.part === "text") {
      text += line.text;
      return;
    }
    if (line.kind === "done") {
      finish(
        text === ""
          ? { kind: "error", sentence: TURN_SENTENCES.unanswered }
          : { kind: "answer", text },
      );
      return;
    }
    if (line.kind === "error") {
      finish({ kind: "error", sentence: errorSentence(line.message) });
      return;
    }
    if (line.kind === "cancelled") {
      finish({ kind: "cancelled", sentence: TURN_SENTENCES.cancelled });
    }
  });

  timer = setTimeout(() => {
    // Settle FIRST (the turn is over by its own budget), then stop it at the
    // source: the panel must not leave a provider call running behind a turn
    // it already gave up on. Settling first also means a `cancelled` that
    // races back cannot turn "it was too slow" into "it was stopped".
    finish({ kind: "timeout", sentence: TURN_SENTENCES.timeout });
    void transport.send(stopLine(id)).catch(() => {
      // A pipe that is already gone is the same timeout, said once.
    });
  }, timeoutMs);

  try {
    await transport.send(requestLine(id, provider, messages));
  } catch {
    finish({ kind: "error", sentence: TURN_SENTENCES.unreachable });
  }

  return await result;
}

/** Ask the sidecar to stop one turn; its `cancelled` line settles `askTurn`. */
export async function stopTurn(
  transport: TurnTransport,
  id: number,
): Promise<void> {
  await transport.send(stopLine(id));
}

/** Whether a turn can leave: a live child, or the one sentence why not. */
export type TurnStart =
  | { kind: "running" }
  | { kind: "refused"; sentence: string };

/**
 * The whole of what the app needs from a turn: ask, the packet Ask (the same
 * envelope, a caller-built message), start (so the app-sent Ask can tell "no
 * provider / no sidecar" from "the turn failed" BEFORE anything leaves), and
 * stop. The panels take this as a prop, so a render test never needs a live
 * sidecar.
 */
export interface TurnPort {
  ask: (provider: TurnProvider, question: string) => Promise<TurnResult>;
  /** The same turn, with the packet as the ONE user message, verbatim. */
  sendPacket: (provider: TurnProvider, packet: string) => Promise<TurnResult>;
  /** Start the child without asking (the app-sent Ask's egress check). */
  start: () => Promise<TurnStart>;
  stop: () => Promise<void>;
}
