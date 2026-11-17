/**
 * THE TURN'S SIDECAR (Epic 15 story 1; ADR-0034) — the one process the app
 * spawns to make a turn, and the app's ONLY network call.
 *
 * WHY STDIO AND NOT A SOCKET: ADR-0034 forbids a listening port, so nothing
 * binds, nothing is discoverable by another process on the machine, and the
 * turn is only reachable by the parent that already holds the pipe. The host
 * (Tauri) owns the child: it spawns on first use, writes request lines and
 * reads response lines, and kills the child when the app exits. This file is
 * therefore a FILTER, not a service: stdin in, one provider POST, stdout out.
 *
 * WHY THE KEY IS IN MEMORY: the key arrives inside a request line, is used for
 * exactly one `fetch`, and is not stored by this process. Nothing is written
 * to disk here at all — the sidecar never opens a workspace file and never
 * reads a config file, so it has no grant on the map folder (ADR-0034
 * decision 4). The OS-keychain story is still to come (story 4, and its ADR is
 * still to be written); until then the window holds the key in its own memory
 * for the session and passes it per turn.
 *
 * The wire's types and its strict readers/builders live in
 * `app/src/turn/protocol.ts` — the SAME file the window imports, so the two
 * ends cannot drift. The line format, the part vocabulary and the sentence
 * wording are PROVISIONAL; the transport is not.
 */

import {
  cancelledLine,
  doneLine,
  errorLine,
  helloLine,
  parseRequestLine,
  partLine,
  requestIdOf,
  scrubSecret,
  type SidecarRequest,
  type TurnRequest,
} from "../src/turn/protocol.ts";

/**
 * One serialized writer: lines must reach the pipe in the order they were
 * produced (a `part` before its `done`), and Bun's stdout is a stream, not a
 * queue. Every `say` chains onto the previous write; the main body awaits the
 * chain before it exits, so no answer is lost on the way out.
 */
let outbox: Promise<unknown> = Promise.resolve();

function say(line: string): void {
  outbox = outbox
    .then(() => Bun.write(Bun.stdout, line + "\n"))
    .catch(() => {
      // A closed pipe means the host is gone; there is nobody left to tell.
    });
}

/** The turns in flight, by id, so `stop` can abort one. */
const inFlight = new Map<number, AbortController>();
/** Ids already answered `cancelled`: the abort's rejection must stay quiet. */
const stopped = new Set<number>();

/** `{baseUrl}` + `/chat/completions`, tolerating a trailing slash. */
function endpointOf(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + "/chat/completions";
}

/**
 * The ONE part story 1 reads from a non-streaming chat completion: the first
 * choice's message content. Anything else is "no text", not a guess.
 */
function answerText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return null;
  const content = (message as { content?: unknown }).content;
  return typeof content === "string" && content.trim() !== "" ? content : null;
}

/**
 * Run ONE turn. The request is the only thing this process knows: there is no
 * map, no file and no packet here. A failure becomes ONE error line, said in
 * plain words, with the key scrubbed out of it before it can reach the pipe.
 */
async function runTurn(request: TurnRequest): Promise<void> {
  const id = request.id;
  const controller = new AbortController();
  inFlight.set(id, controller);

  const fail = (message: string): void => {
    say(errorLine(id, scrubSecret(message, request.provider.apiKey)));
  };

  try {
    let response: Response;
    try {
      response = await fetch(endpointOf(request.provider.baseUrl), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${request.provider.apiKey}`,
        },
        // stream:false — story 1 buys one answer, not deltas (story 7 streams).
        body: JSON.stringify({
          model: request.provider.model,
          messages: request.messages,
          stream: false,
        }),
        signal: controller.signal,
      });
    } catch {
      // The abort's own rejection is the stop handler's business, not an error.
      if (!stopped.has(id)) fail("the provider could not be reached");
      return;
    }
    if (stopped.has(id)) return;

    if (!response.ok) {
      const reason =
        typeof response.statusText === "string" && response.statusText.trim() !== ""
          ? ` ${response.statusText.trim()}`
          : "";
      fail(`the provider answered ${response.status}${reason}`);
      return;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      if (!stopped.has(id)) fail("the provider answered with something that is not JSON");
      return;
    }
    if (stopped.has(id)) return;

    const text = answerText(payload);
    if (text === null) {
      fail("the provider answered with no text");
      return;
    }
    say(partLine(id, text));
    say(doneLine(id));
  } finally {
    inFlight.delete(id);
    stopped.delete(id);
  }
}

/**
 * A stop for an in-flight turn: answer `cancelled` NOW (the request may be
 * waiting on a slow provider), then abort the fetch so the process lets go of
 * it. A stop naming an id there is nothing to stop is ignored — there is no
 * turn to answer for.
 */
function stopTurn(id: number): void {
  const controller = inFlight.get(id);
  if (controller === undefined) return;
  stopped.add(id);
  controller.abort();
  say(cancelledLine(id));
}

/**
 * One input line. A malformed line is ANSWERED when it carries an id to answer
 * to, and ignored when it does not — either way the sidecar keeps reading: one
 * bad line must never kill the conversation.
 */
function handleLine(raw: string): void {
  if (raw.trim() === "") return;
  const request: SidecarRequest | null = parseRequestLine(raw);
  if (request === null) {
    const id = requestIdOf(raw);
    if (id !== null) say(errorLine(id, "the request could not be read"));
    return;
  }
  if (request.kind === "stop") {
    stopTurn(request.id);
    return;
  }
  // Not awaited: turns are concurrent by id, and the read loop must keep
  // reading so a stop can arrive while a provider is slow.
  void runTurn(request);
}

// The first thing the host hears: this process is alive and speaks wire v1.
// The host's 5-second health budget watches for THIS line (sidecar.rs).
say(helloLine());

const decoder = new TextDecoder();
let buffer = "";
try {
  for await (const chunk of Bun.stdin.stream()) {
    buffer += decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      handleLine(buffer.slice(0, newline).replace(/\r$/, ""));
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
    }
  }
  // A last line without its newline is still a line (a host may close the pipe
  // right after writing).
  if (buffer.trim() !== "") handleLine(buffer.replace(/\r$/, ""));
} finally {
  // stdin closed: the app is quitting. Let go of every turn; the host kills
  // this process, and nothing here outlives it.
  for (const controller of inFlight.values()) controller.abort();
  inFlight.clear();
  await outbox;
}
