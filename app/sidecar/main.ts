/**
 * THE TURN'S SIDECAR (Epic 15 story 1; ADR-0034) — the one process the app
 * spawns to make a turn, and the app's ONLY network call.
 *
 * WHY STDIO AND NOT A SOCKET: ADR-0034 forbids a listening port, so nothing
 * binds, nothing is discoverable by another process on the machine, and the
 * turn is only reachable by the parent that already holds the pipe. The host
 * (Tauri) owns the child: it spawns on first use, writes request lines and
 * reads response lines, and kills the child when the app exits. This file is
 * therefore a FILTER, not a service: stdin in, one provider request, stdout
 * out. Story 15.11 adds a second request kind — a model list's `GET` — to the
 * same filter; the app still makes no other network call.
 *
 * WHY THE KEY IS IN MEMORY: the key arrives inside a request line, is used for
 * exactly one `fetch`, and is not stored by this process. Nothing is written
 * to disk here at all — the sidecar never opens a workspace file and never
 * reads a config file, so it has no grant on the map folder (ADR-0034
 * decision 4). Until story 4's keychain owns the key, the window holds it for
 * the session and passes it per turn.
 *
 * STREAMING (story 7). The POST asks for `stream: true` and this process
 * forwards each provider delta as its own `part` line, in order, then `done`.
 * Three things make that safe rather than hopeful:
 *   - A provider that ignores `stream: true` and answers with one JSON body
 *     still works: when the response is not an event stream, the body is read
 *     once and its one answer becomes one part.
 *   - A malformed event is SKIPPED, never fatal: a provider's bad line must
 *     not take the answer it already sent with it.
 *   - A stop aborts the fetch (AbortController), so the reader lets go rather
 *     than finishing a stream nobody is reading. Whatever parts already left
 *     stay left; the window keeps them and marks the turn stopped.
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
  modelsLine,
  parseRequestLine,
  partLine,
  requestIdOf,
  scrubSecret,
  type ModelsRequest,
  type SidecarRequest,
  type TurnRequest,
} from "../src/turn/protocol.ts";
import {
  MODEL_LIST_LIMIT,
  MODEL_LIST_SENTENCES,
  capModelIds,
  providerRefusal,
  readModelIds,
} from "../src/turn/modelList.ts";

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

/** `{baseUrl}` + `/models`, the same tolerance (story 15.11). */
function modelsEndpointOf(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, "") + "/models";
}

/**
 * The ONE part a non-streaming chat completion carries: the first choice's
 * message content. Anything else is "no text", not a guess.
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
 * The delta in one streamed chunk: `choices[0].delta.content`. A provider
 * that sent its final message inside the event stream instead (`message`)
 * still yields a part; the delta wins when both are present, because it is the
 * one that arrives once.
 */
function deltaText(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) return null;
  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null) return null;
  const delta = (first as { delta?: unknown }).delta;
  if (typeof delta === "object" && delta !== null) {
    const content = (delta as { content?: unknown }).content;
    if (typeof content === "string") return content;
  }
  const message = (first as { message?: unknown }).message;
  if (typeof message === "object" && message !== null) {
    const content = (message as { content?: unknown }).content;
    if (typeof content === "string" && content !== "") return content;
  }
  return null;
}

/** The provider's own error sentence inside a chunk, or null. */
function providerError(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const error = (payload as { error?: unknown }).error;
  if (typeof error === "string" && error.trim() !== "") return error;
  if (typeof error === "object" && error !== null) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") return message;
  }
  return null;
}

/** Does this body look like server-sent events rather than one JSON body? */
function looksLikeSse(text: string): boolean {
  return /(^|\n)\s*data:/.test(text);
}

/**
 * Incremental SSE reader: feed it lines, and it emits one part per delta.
 *
 * Only `data:` lines matter; `event:`, `id:`, `retry:` and comments are not
 * this reader's business. An event is dispatched on a blank line (or by
 * `flush` at the end of the body), and `data: [DONE]` ends the stream. A
 * payload that is not JSON is SKIPPED: one bad event must not take the answer
 * with it. An `error` in a payload is the provider's own sentence, kept for
 * the one error line.
 */
class SseSink {
  private data: string[] = [];
  private ended = false;
  private failure: string | null = null;

  constructor(private readonly emit: (text: string) => void) {}

  /** The stream's own end sentinel was seen. */
  get done(): boolean {
    return this.ended;
  }

  /** The provider's error sentence, or null. */
  get error(): string | null {
    return this.failure;
  }

  /** Nothing more will be read: the sentinel or an error settled it. */
  get finished(): boolean {
    return this.ended || this.failure !== null;
  }

  line(raw: string): void {
    const line = raw.replace(/\r$/, "");
    if (line === "") {
      this.dispatch();
      return;
    }
    // A comment is the provider keeping the pipe warm; it says nothing.
    if (line.startsWith(":")) return;
    if (!line.startsWith("data:")) return;
    // SSE drops ONE leading space after the colon; anything else is payload.
    this.data.push(line.slice(5).replace(/^ /, ""));
  }

  flush(): void {
    this.dispatch();
  }

  private dispatch(): void {
    if (this.finished) {
      this.data = [];
      return;
    }
    if (this.data.length === 0) return;
    const payload = this.data.join("\n");
    this.data = [];
    if (payload.trim() === "[DONE]") {
      this.ended = true;
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(payload);
    } catch {
      // A malformed event is skipped; the answer already sent stands.
      return;
    }
    const failure = providerError(value);
    if (failure !== null) {
      this.failure = failure;
      return;
    }
    const text = deltaText(value);
    if (text !== null && text !== "") this.emit(text);
  }
}

/** What one streamed (or buffered) body settled as. */
type BodyOutcome =
  | { kind: "done" }
  | { kind: "error"; message: string }
  | { kind: "quiet" };

/**
 * Read one event stream to its end, emitting a part per delta. A stop makes
 * the read reject, and that rejection is QUIET: the stop handler already
 * answered `cancelled`, and a second line would be a second outcome. Anything
 * else that breaks the read is one error, with the parts already sent kept.
 */
async function streamBody(
  id: number,
  response: Response,
  emit: (text: string) => void,
): Promise<BodyOutcome> {
  const body = response.body;
  if (body === null) {
    return { kind: "error", message: "the provider answered with no body" };
  }
  const sink = new SseSink(emit);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!sink.finished) {
      const read = await reader.read();
      if (read.done) break;
      buffer += decoder.decode(read.value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        sink.line(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (sink.finished) break;
      }
    }
    if (!sink.finished) {
      // A last line or event without its blank line is still one.
      buffer += decoder.decode();
      if (buffer !== "") sink.line(buffer);
      sink.flush();
    }
  } catch {
    if (stopped.has(id)) return { kind: "quiet" };
    return { kind: "error", message: "the provider's answer broke off" };
  }
  if (sink.finished) void reader.cancel().catch(() => {});
  if (stopped.has(id)) return { kind: "quiet" };
  if (sink.error !== null) return { kind: "error", message: sink.error };
  return { kind: "done" };
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
        // stream:true — the answer arrives as deltas (story 7). A provider
        // that ignores this answers one JSON body, handled below.
        body: JSON.stringify({
          model: request.provider.model,
          messages: request.messages,
          stream: true,
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

    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    let emitted = 0;
    const emit = (text: string): void => {
      emitted += 1;
      say(partLine(id, text));
    };

    if (contentType.includes("text/event-stream")) {
      const outcome = await streamBody(id, response, emit);
      if (outcome.kind === "quiet") return;
      if (outcome.kind === "error") {
        fail(outcome.message);
        return;
      }
      if (emitted === 0) {
        fail("the provider answered with no text");
        return;
      }
      say(doneLine(id));
      return;
    }

    // NOT AN EVENT STREAM: a provider that ignored `stream: true`, or one
    // that streams without saying so. One body, read once.
    let body: string;
    try {
      body = await response.text();
    } catch {
      if (stopped.has(id)) return;
      fail("the provider's answer broke off");
      return;
    }
    if (stopped.has(id)) return;

    if (looksLikeSse(body)) {
      const sink = new SseSink(emit);
      for (const line of body.split("\n")) sink.line(line);
      sink.flush();
      if (stopped.has(id)) return;
      if (sink.error !== null) {
        fail(sink.error);
        return;
      }
      if (emitted === 0) {
        fail("the provider answered with no text");
        return;
      }
      say(doneLine(id));
      return;
    }

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      fail("the provider answered with something that is not JSON");
      return;
    }
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
 * Fetch ONE provider's model list (story 15.11). Same envelope, same fetch
 * idiom, same one-sentence failure: a GET to `{baseUrl}/models` with the
 * bearer key, read as the OpenAI shape, de-duplicated, sorted and capped.
 *
 * THREE THINGS THIS DELIBERATELY DOES NOT DO: it does not retry (a fetch is
 * the person's press), it does not cache anything on disk (there is nothing
 * here to cache into), and it does not write a row — the window decides what
 * the person ticked, and only then writes. A keyless loopback endpoint is a
 * legitimate list, so an empty key omits the bearer header rather than sending
 * "Bearer " with nothing after it.
 */
async function runModels(request: ModelsRequest): Promise<void> {
  const id = request.id;
  const controller = new AbortController();
  inFlight.set(id, controller);

  const fail = (message: string): void => {
    say(errorLine(id, scrubSecret(message, request.provider.apiKey)));
  };

  try {
    const headers: Record<string, string> = { accept: "application/json" };
    if (request.provider.apiKey !== "") {
      headers.authorization = `Bearer ${request.provider.apiKey}`;
    }
    let response: Response;
    try {
      response = await fetch(modelsEndpointOf(request.provider.baseUrl), {
        method: "GET",
        headers,
        signal: controller.signal,
      });
    } catch {
      if (!stopped.has(id)) fail(MODEL_LIST_SENTENCES.unreachable);
      return;
    }
    if (stopped.has(id)) return;
    if (!response.ok) {
      fail(providerRefusal(response.status));
      return;
    }

    let body: string;
    try {
      body = await response.text();
    } catch {
      if (!stopped.has(id)) fail(MODEL_LIST_SENTENCES.brokeOff);
      return;
    }
    if (stopped.has(id)) return;

    let payload: unknown;
    try {
      payload = JSON.parse(body);
    } catch {
      fail(MODEL_LIST_SENTENCES.notJson);
      return;
    }
    const ids = readModelIds(payload);
    if (ids === null) {
      fail(MODEL_LIST_SENTENCES.notTheShape);
      return;
    }
    if (ids.length === 0) {
      fail(MODEL_LIST_SENTENCES.noModels);
      return;
    }
    const capped = capModelIds(ids, MODEL_LIST_LIMIT);
    say(
      modelsLine(
        id,
        capped.ids,
        capped.truncated ? capped.offered : undefined,
      ),
    );
  } finally {
    inFlight.delete(id);
    stopped.delete(id);
  }
}

/**
 * A stop for an in-flight turn or model fetch: answer `cancelled` NOW (the
 * request may be waiting on a slow provider), then abort the fetch so the
 * process lets go of it. A stop naming an id there is nothing to stop is
 * ignored — there is no turn to answer for.
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
  if (request.kind === "models") {
    void runModels(request);
    return;
  }
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
