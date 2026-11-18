import {
  oneLine,
  requestLine,
  stopLine,
  type SidecarLine,
  type TurnMessage,
  type TurnProvider,
} from "./protocol";
import { followUpMessages, type AskPacket } from "./packet";
import {
  CLI_TURN_TIMEOUT_MS,
  STOPPED_SENTENCE,
  buildCliArgs,
  cliAnswer,
} from "./cli";
import type { CliFacts, CliRefusal } from "./cli";
import type { CliSpec } from "./cliSpecs";
import { cliSpecOf, providerFrom } from "./providers";
import type { LocalProviderRow, ModelRow, ProviderRow } from "./providers";
import { STEP_LIMIT_SENTENCE, turnSteps, type StepBudget } from "./steps";
import { PROPOSAL_FENCE, readProposal, type ProposalRead } from "./proposal";

/**
 * The proposal seam is re-exported here so the contact flows (which must never
 * spell a gate word, by their own source scan) can name the type and the
 * predicate without importing the block scanner directly.
 */
export type { ProposalRead } from "./proposal";
export { isProposal } from "./proposal";

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
 * ONE RETRIEVAL (Epic 15 story 3). The app-sent Ask's packet is assembled by
 * the pure assembler (turn/packet.ts) and sent as its ONE message. If that
 * answer contains a single line of exactly the form "READ: <name>", and the
 * name is a block the packet already carried, the app performs exactly ONE
 * follow-up turn with that block's fuller text. One, because a chain of reads
 * would be the app widening its own view without the person: the packet is a
 * bounded view, and this single request is the amendment's whole exception. A
 * name that is not a block, a read that refuses, or more than one READ line
 * gets NO follow-up — the first answer stands, and the person is told so in
 * one sentence (never silently).
 *
 * PROVISIONAL: the timeout (60 s), the instruction's wording, the READ syntax
 * and the follow-up's sentence. ADR-0034 settles the transport, not these.
 */

/** How long the panel waits for the answer before it stops the turn. */
export const TURN_TIMEOUT_MS = 60_000;

/**
 * The fixed instruction. It is deliberately short and says what did NOT come:
 * no map, no previews, no references. STORY 8 adds the one reply shape: a
 * proposing answer ends with ONE tagged block carrying the agent's body, which
 * the turn scans after completion and hands to the existing ghost intake. The
 * shape is the intake's own body (move/target/params/rationale), never a second
 * ghost format. PROVISIONAL wording; story 3 replaced the hand-written
 * question with the packet.
 */
export const SYSTEM_MESSAGE =
  "You are answering one question a person asked about one reference on their attention map. No map content was sent with the question — answer from what you know, and say plainly when you do not know. " +
  "If your answer would propose ONE small edit to the map, end it with exactly one fenced code block whose language tag is " +
  PROPOSAL_FENCE +
  ". The block carries one JSON object with the keys move (its family and verb), target (its kind and that kind's own fields, such as a slug), params (one value for each field the move authors) and rationale (the prose why). " +
  "Write one block at most; a second is ignored. If nothing should change, write no block and answer in prose.";

/** The sentences the panel shows when the answer is not an answer. */
export const TURN_SENTENCES = {
  /** The person pressed stop (or the sidecar answered `cancelled`). */
  cancelled: STOPPED_SENTENCE,
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
  /** A CLI turn arrived without a process layer to run it (a wiring bug). */
  noCliRunner: "the CLI could not be started, so the turn did not leave",
  /** The process layer threw instead of reporting facts. */
  cliFailed: "the CLI could not be run",
  /** A local turn arrived without the local runtime's process layer. */
  noLocalRuntime: "the local runtime could not be started, so the turn did not leave",
} as const;

/**
 * The result of one turn: one answer, or one sentence.
 *
 * A STOPPED OR BROKEN TURN MAY CARRY WHAT ARRIVED (story 7): `partial` is the
 * text the person already saw streaming, kept so a stop never erases words
 * they read. It is present only when there were words, and its result kind
 * still says the turn did not finish — the panel must never present it as a
 * complete answer.
 */
export type TurnResult =
  | { kind: "answer"; text: string }
  | { kind: "error"; sentence: string; partial?: string }
  | { kind: "cancelled"; sentence: string; partial?: string }
  | { kind: "timeout"; sentence: string; partial?: string };

/**
 * What the panel and the port need from a transport: write one line, and be
 * told about the lines that carry one id. The real one wraps Tauri's invokes
 * and its `sidecar-line` event; a test wraps a script.
 *
 * STORY 18.3c ADDS ONE OPTIONAL FACT: `onClosed`, the channel saying it is
 * gone. 18.3b proved the sidecar kills its children on every path IT can see;
 * when the sidecar itself dies the window was told nothing and a run waited out
 * its whole budget for an answer that could never come. A transport that can say
 * "the pipe closed" says it here; a test's scripted transport may simply omit
 * it, and every caller must treat its absence as "this transport cannot know".
 */
export interface TurnTransport {
  send: (line: string) => Promise<void>;
  subscribe: (id: number, handler: (line: SidecarLine) => void) => () => void;
  /**
   * Hear the channel close (EOF, a failed write, a death): call `handler` once
   * when no further line can arrive, and answer with the unsubscribe. Optional
   * on purpose — the seam that needs it is a RUN, and a turn's own budget is
   * the turn's affair.
   */
  onClosed?: (handler: () => void) => () => void;
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

/* ------------------------------------------------------------------ *
 * ONE DISPATCH: a turn runs over an HTTP endpoint or through a CLI spec.
 * ------------------------------------------------------------------ */

/**
 * Where one turn runs. Built from a resolved row, so every door above this
 * line hands over the same value and the decision lives in one place.
 */
export type TurnRoute =
  | { kind: "http"; provider: TurnProvider }
  | { kind: "cli"; spec: CliSpec }
  | { kind: "local"; row: LocalProviderRow; model: ModelRow };

/**
 * What the local route needs before it can become an HTTP route: start the
 * child (or reuse it, touching the idle timer) and hand back the base URL, the
 * model id and the key that launch minted. Injected, so the pure turn rules
 * are testable without a process.
 */
export type LocalEnsure = (
  row: LocalProviderRow,
  model: ModelRow,
) => Promise<
  { kind: "running"; provider: TurnProvider } | { kind: "refused"; sentence: string }
>;

/**
 * The route a resolved row runs through. THE ONLY PLACE A ROW'S KIND IS READ:
 * a CLI row becomes its spec, an endpoint row becomes the wire's provider, and
 * everything downstream dispatches once on the route.
 */
export function routeOf(
  provider: ProviderRow,
  model: ModelRow,
  apiKey: string,
): TurnRoute {
  if (provider.kind === "cli") return { kind: "cli", spec: cliSpecOf(provider) };
  // A local row has no base URL until its child is running: the route carries
  // the row and the model, and the port/key arrive when the runtime starts.
  if (provider.kind === "local") {
    return { kind: "local", row: provider, model };
  }
  return { kind: "http", provider: providerFrom(provider, model, apiKey) };
}

/**
 * One already-built argv, run by the host's process layer (injected). The
 * run id is the token a stop names: the host registers the child under it
 * before it spawns, so one token reaches one child and no other.
 */
export type CliTurnRunner = (
  spec: CliSpec,
  args: readonly string[],
  timeoutMs: number,
  runId: string,
) => Promise<CliFacts | CliRefusal>;

export interface RouteOptions extends TurnOptions {
  /** The CLI process layer; absent for transports that only speak HTTP. */
  cli?: CliTurnRunner;
  /** The local runtime's process layer; absent where none can be started. */
  local?: LocalEnsure;
  /**
   * Called with the token one CLI child is run under, BEFORE it starts: the
   * port keeps the token so stop can kill that exact child. The token is the
   * app's, not the child's, so no PID or path crosses this seam.
   */
  onCliStart?: (runId: string) => void;
}

/**
 * The ONE message a CLI is handed: the person's words. A CLI carries its own
 * instruction and its own tools, so the app's fixed system message would be a
 * second instruction arguing with the first — the packet or the question is
 * what leaves.
 */
export function cliPromptOf(messages: readonly TurnMessage[]): string {
  for (let at = messages.length - 1; at >= 0; at -= 1) {
    if (messages[at].role === "user") return messages[at].content;
  }
  return messages.length === 0 ? "" : messages[messages.length - 1].content;
}

/** The token one CLI child runs under. Window-local and unique per run. */
let nextCliRun = 1;

function cliRunToken(): string {
  return "cli-run-" + String(nextCliRun++);
}

/** A CLI turn: one argv, then the answer or the one sentence. */
async function runCliTurn(
  spec: CliSpec,
  messages: readonly TurnMessage[],
  options: RouteOptions,
): Promise<TurnResult> {
  const runner = options.cli;
  if (runner === undefined) {
    return { kind: "error", sentence: TURN_SENTENCES.noCliRunner };
  }
  const args = buildCliArgs(spec.run.args, cliPromptOf(messages));
  // The token is handed over BEFORE the child starts: a stop between the
  // click and the spawn must still name the child that is about to exist.
  const runId = cliRunToken();
  options.onCliStart?.(runId);
  let facts: CliFacts | CliRefusal;
  try {
    facts = await runner(
      spec,
      args,
      options.timeoutMs ?? CLI_TURN_TIMEOUT_MS,
      runId,
    );
  } catch {
    return { kind: "error", sentence: TURN_SENTENCES.cliFailed };
  }
  const outcome = cliAnswer(spec, facts);
  if (outcome.kind === "answer") {
    return { kind: "answer", text: outcome.text };
  }
  // A stopped child is its own outcome, never folded into a timeout or an
  // error: the panel says "stopped", because that is what happened.
  if (outcome.kind === "cancelled") {
    return { kind: "cancelled", sentence: outcome.sentence };
  }
  return outcome.kind === "timeout"
    ? { kind: "timeout", sentence: outcome.sentence }
    : { kind: "error", sentence: outcome.sentence };
}

/**
 * ONE turn, over the route it names. The HTTP route is story 1's turn exactly
 * — same request line, same parts, same stop. The CLI route never touches the
 * sidecar: the prompt is one argv entry and the child is the host's.
 */
export async function runRoute(
  transport: TurnTransport,
  route: TurnRoute,
  messages: readonly TurnMessage[],
  options: RouteOptions = {},
): Promise<TurnResult> {
  if (route.kind === "http") {
    return await askTurnMessages(transport, route.provider, messages, options);
  }
  if (route.kind === "local") {
    const started = await ensureLocal(route.row, route.model, options);
    if (started.kind === "refused") {
      return { kind: "error", sentence: started.sentence };
    }
    // The local server is OpenAI-compatible on loopback: the turn is the SAME
    // HTTP turn as story 1, through the SAME sidecar pipe, with the port the
    // app chose and the key it minted as that provider's base URL and key.
    return await askTurnMessages(transport, started.provider, messages, options);
  }
  return await runCliTurn(route.spec, messages, options);
}

/**
 * Start (or reuse) the local child behind a route. A missing process layer is
 * a wiring bug said out loud; the runtime's own refusal is its sentence.
 */
async function ensureLocal(
  row: LocalProviderRow,
  model: ModelRow,
  options: RouteOptions,
): Promise<{ kind: "running"; provider: TurnProvider } | { kind: "refused"; sentence: string }> {
  if (options.local === undefined) {
    return { kind: "refused", sentence: TURN_SENTENCES.noLocalRuntime };
  }
  try {
    return await options.local(row, model);
  } catch {
    return { kind: "refused", sentence: TURN_SENTENCES.noLocalRuntime };
  }
}

/**
 * ONE packet turn over a route. The HTTP route is story 3's turn unchanged.
 * A CLI has no app-side pipe: the packet's own message is the prompt, its
 * answer stands, and the READ follow-up is not performed — PROVISIONAL, said
 * here so nobody believes a block was read.
 */
export async function runRoutePacket(
  transport: TurnTransport,
  route: TurnRoute,
  packet: AskPacket,
  fetchBlock: (name: string) => Promise<string | null>,
  options: RouteOptions = {},
): Promise<PacketTurnAnswer> {
  // THE ONE CEILING, asked here because only this level knows BOTH the route
  // and whether the packet offered the model a block it may ask for in full.
  const budget = turnSteps(route, packet.retrievable.length > 0);
  if (route.kind === "http") {
    return await askTurnPacket(
      transport,
      route.provider,
      packet,
      fetchBlock,
      { ...options, budget },
    );
  }
  if (route.kind === "local") {
    const started = await ensureLocal(route.row, route.model, options);
    if (started.kind === "refused") {
      return {
        result: { kind: "error", sentence: started.sentence },
        messages: [...packet.messages],
        read: null,
        missed: null,
        reached: null,
      };
    }
    return await askTurnPacket(transport, started.provider, packet, fetchBlock, {
      ...options,
      budget,
    });
  }
  const result = await runRoute(transport, route, packet.messages, options);
  return {
    result,
    messages: [...packet.messages],
    read: null,
    missed: null,
    reached: null,
  };
}

/** Turn ids are local to this window and only need to be unique per session. */
let nextId = 1;

export interface TurnOptions {
  /** Override the stated budget (a test uses a short one). */
  timeoutMs?: number;
  /** Called with the id before the request leaves (the port uses it to stop). */
  onStart?: (id: number) => void;
  /**
   * Called with the text accumulated SO FAR on every part. This is what lets
   * a panel show the answer arriving instead of waiting for the block; it is
   * a view of the same text the result settles with, never a second copy.
   */
  onPart?: (text: string) => void;
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

  // What arrived, when there is something to keep. A stopped or broken turn
  // carries the words the person already saw; a finished one is an answer.
  const partialOf = (): { partial?: string } =>
    text === "" ? {} : { partial: text };

  unsubscribe = transport.subscribe(id, (line) => {
    if (line.kind === "part" && line.part === "text") {
      text += line.text;
      // Show it arriving: the panel renders this accumulation while the turn
      // is still open. The same `text` settles the result, so the view and the
      // outcome can never disagree about what came back.
      options.onPart?.(text);
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
      // A mid-stream error keeps what arrived; the sentence still says the
      // turn did not finish, so the partial is never read as the answer.
      finish({
        kind: "error",
        sentence: errorSentence(line.message),
        ...partialOf(),
      });
      return;
    }
    if (line.kind === "cancelled") {
      finish({
        kind: "cancelled",
        sentence: TURN_SENTENCES.cancelled,
        ...partialOf(),
      });
    }
  });

  timer = setTimeout(() => {
    // Settle FIRST (the turn is over by its own budget), then stop it at the
    // source: the panel must not leave a provider call running behind a turn
    // it already gave up on. Settling first also means a `cancelled` that
    // races back cannot turn "it was too slow" into "it was stopped".
    finish({
      kind: "timeout",
      sentence: TURN_SENTENCES.timeout,
      ...partialOf(),
    });
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

/** The exact prefix a retrieval line must carry (PROVISIONAL, one space). */
export const READ_PREFIX = "READ: ";

/**
 * The ONE name a first answer asks for, or null. Only a line of exactly
 * "READ: <name>" counts — leading and trailing whitespace around the line is
 * tolerated, but two such lines are NOT one request (the packet allows one),
 * so the answer gets no follow-up rather than a guess at which it meant.
 */
export function readNameIn(answer: string): string | null {
  const pattern = new RegExp("^" + READ_PREFIX + "(\\S.*)$");
  let found: string | null = null;
  for (const raw of answer.split(/\r?\n/)) {
    const match = pattern.exec(raw.trim());
    if (match === null) continue;
    // Two requests are not one: the packet allows ONE named retrieval, so an
    // answer that names two gets none rather than a coin toss.
    if (found !== null) return null;
    found = match[1].trim();
  }
  return found;
}

/** What one packet turn answered, and every byte that left getting there. */
export interface PacketTurnAnswer {
  /** The final result: the first answer, or the follow-up's. */
  result: TurnResult;
  /** Every message that left, in order (the readback's own bytes). */
  messages: TurnMessage[];
  /** The block the one follow-up fetched, or null when none happened. */
  read: string | null;
  /** A name asked for that this view did not carry (the first answer stands). */
  missed: string | null;
  /** The sentence the ceiling said when it bit, or null when it never did. */
  reached: string | null;
  /**
   * THE PROPOSAL THE ANSWER CARRIED (Epic 15 story 8): the one tagged block,
   * parsed. Absent or `none` on a turn that never settled an answer. A body is
   * handed to the EXISTING ghost intake by the surface; this module only reads
   * the fence and says the one sentence when there is nothing usable in it.
   */
  proposal?: ProposalRead;
}

/** A packet turn's options: the ordinary turn's, plus the ceiling it asks. */
export interface PacketTurnOptions extends TurnOptions {
  /**
   * The ceiling, from turnSteps. runRoutePacket computes it from the route and
   * the packet; a direct caller may pass one, and when it does not, the
   * default is the SAME pure function's answer for an HTTP ask — never a
   * second number written here.
   */
  budget?: StepBudget;
}

/**
 * Ask ONE packet turn, then the follow-ups its ceiling allows for the single
 * block the model named. The packet's messages are sent verbatim; a READ of a
 * block the packet carried is fetched once (the injected reader) and appended
 * as ONE more user message; anything else settles the first answer as the
 * answer. There is no retry anywhere here.
 *
 * THE ASK CARD'S THREAD IS NOT READABLE (story 17.3). Its packet carries the
 * conversation's block as CONTEXT, and the assembler never lists that block in
 * `retrievable` — so a READ naming the thread is refused here by the SAME rule
 * that refuses any name the view did not offer: one request, the anchored
 * block's, and the first answer stands otherwise. The retrieval rule did not
 * need a second branch; the packet's READ set is the whole of it.
 *
 * THE CEILING IS ASKED HERE, not assumed: an HTTP ask with one readable block
 * gets two exchanges, a plain ask one, and a CLI turn never reaches this
 * function (its route dispatches once). When the model asks to read past the
 * ceiling the loop does NOT fetch: the answer stands, and the answer's
 * reached field says STEP_LIMIT_SENTENCE in words. No counter is kept, shown
 * or returned beyond the local exchanges that asks the budget.
 */
export async function askTurnPacket(
  transport: TurnTransport,
  provider: TurnProvider,
  packet: AskPacket,
  fetchBlock: (name: string) => Promise<string | null>,
  options: PacketTurnOptions = {},
): Promise<PacketTurnAnswer> {
  const budget =
    options.budget ??
    turnSteps({ kind: "http" }, packet.retrievable.length > 0);
  let messages: TurnMessage[] = [...packet.messages];
  let result = await askTurnMessages(transport, provider, messages, options);
  let read: string | null = null;
  let missed: string | null = null;
  let reached: string | null = null;
  let exchanges = 1;
  // The answer is final whenever this settles: read its ONE proposal block
  // HERE, after completion and before any surface sees the text. The scanner
  // is pure and the ghost's own grammar still holds the door; an error or a
  // stopped turn carries no proposal.
  const done = (): PacketTurnAnswer => ({
    result,
    messages,
    read,
    missed,
    reached,
    proposal:
      result.kind === "answer"
        ? readProposal(result.text)
        : { kind: "none" },
  });
  for (;;) {
    if (result.kind !== "answer") {
      return done();
    }
    const name = readNameIn(result.text);
    if (name === null) {
      return done();
    }
    if (!packet.retrievable.includes(name)) {
      missed = name;
      return done();
    }
    // The ceiling bites: the model asked to read again and this turn has
    // spent its budget. Say so; never fetch, never stop silently.
    if (exchanges >= budget.steps) {
      reached = STEP_LIMIT_SENTENCE;
      return done();
    }
    let text: string | null;
    try {
      text = await fetchBlock(name);
    } catch {
      text = null;
    }
    if (text === null || text === "") {
      missed = name;
      return done();
    }
    messages = followUpMessages(messages, name, text);
    exchanges += 1;
    result = await askTurnMessages(transport, provider, messages, options);
    read = name;
  }
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
  /** One turn over its route: HTTP through the sidecar, CLI through the host. */
  ask: (
    route: TurnRoute,
    question: string,
    options?: TurnOptions,
  ) => Promise<TurnResult>;
  /**
   * The packet turn: its ONE message, then the READ follow-up the ceiling
   * allows. The options carry the onPart view (so a panel streams) and never a
   * ceiling of their own: the route and the packet decide that, in one place.
   */
  sendPacket: (
    route: TurnRoute,
    packet: AskPacket,
    fetchBlock: (name: string) => Promise<string | null>,
    options?: TurnOptions,
  ) => Promise<PacketTurnAnswer>;
  /**
   * Whether anything can leave, checked BEFORE a request is written: an HTTP
   * route needs a live sidecar, a CLI route needs a command that resolves.
   * The route is optional so a caller that only knows it must start the
   * transport can still ask (a test's port, and story 1's shape).
   */
  start: (route?: TurnRoute) => Promise<TurnStart>;
  stop: () => Promise<void>;
}
