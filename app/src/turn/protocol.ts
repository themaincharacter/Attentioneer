/**
 * THE TURN'S WIRE — one envelope, one strict reader, one set of builders
 * (Epic 15 story 1; ADR-0034's transport, implemented not decided).
 *
 * STORY 15.11 ADDS ONE REQUEST AND ONE LINE, not a second wire: a `models`
 * request asks the sidecar for the provider's own model list, and a `models`
 * line carries what it found. STORY 16.14 adds a `page` request/line for a
 * web reference (the title, its extracted text and a thumbnail address) and a
 * `thumb` request/line that carries the image's bytes back as base64 — the
 * same one pipe, the same one-sentence errors. STORY 16.15 adds a `video`
 * request/line (a pasted video's TITLE and thumbnail address, read through
 * oEmbed) and reuses the same `thumb` line for its copied picture. The key
 * still rides inside a request line and nowhere else.
 *
 * STORY 18.3b ADDS THE RUN LANE'S FOUR KINDS, and they are the reason the
 * window can finally press RUN: a `run` request asks the SIDECAR to spawn the
 * tool, `run-part` carries ONE progress entry at a time in arrival order,
 * `run-end` carries the ending (and its one sentence when it has one), and
 * `run-cancel` names a live run and is answered by that run's own `run-end`.
 * The key rides INSIDE the `run` request's `env` payload — a resolved map,
 * exactly as a turn carries its key — never an argv and never a log line.
 *
 * STORY 18.4 ADDS THE PERMISSION PAIR (names PROVISIONAL): `run-permission`
 * carries a server's `session/request_permission` DOWN to the person — the
 * tool call and the options the server offered — and `run-permission-reply`
 * carries ONE choice UP (`allow-once` or `refuse`). It carries no option id:
 * the sidecar turns the verb into the matching option against the ask it is
 * holding, so an "always" option can never be selected on the wire. A request
 * left unanswered settles as the run's own timeout.
 *
 * STORY 22.1b ADDS THE SETUP CHILD'S FIVE KINDS (names PROVISIONAL), and they
 * are deliberately NOT the run lane's: `setup` asks the sidecar to start a
 * tool's own sign-in as a SETUP CHILD (a process class of its own), `setup-part`
 * carries ONE line the child printed DOWN with the stream it came from,
 * `setup-stdin` carries ONE string UP that is written to the child's stdin with
 * a newline, `setup-cancel` stops a live child (its own `setup-end` answers),
 * and `setup-end` states the exit code and the last line. No prompt, no
 * transcript entry, no permission and no key grant of its own ride any of them.
 * A setup child is never a run: the run lane's lifecycle and its kill-on-every-
 * exit rule are untouched by these lines.
 *
 * Newline-delimited JSON travels in BOTH directions over stdio, so every
 * builder here answers exactly one line (JSON.stringify never emits a raw
 * newline) and every reader REFUSES rather than guesses: a malformed line is
 * `null`, never an exception and never a half-understood request. The Bun
 * sidecar (`app/sidecar/main.ts`) and the window import this SAME file, so the
 * contract cannot drift into two dialects.
 *
 * There is no socket in any of this: the envelope is a pipe's contents. The
 * sidecar reads no workspace file, and the API key lives inside this envelope
 * only for the length of one turn — it is never written, never logged and
 * never echoed back in an error line (see `scrubSecret`).
 *
 * PROVISIONAL: the field names, the part vocabulary (story 1 sends ONE final
 * text part) and the message roles are this story's, to be revised by story 7
 * when streaming arrives. The transport itself is ADR-0034's.
 */

import type {
  AcpEnding,
  AcpPermissionAsk,
  AcpPermissionChoice,
  AcpPermissionOption,
  AcpProgressEntry,
  RunScope,
} from "./acpEntries";

/** The envelope's version. A `hello` says which one the sidecar speaks. */
export const WIRE_VERSION = 1;

/** Where a turn may run: one HTTP endpoint, one model, one key. */
export interface TurnProvider {
  /** The provider's base URL; `/chat/completions` is appended by the sidecar. */
  baseUrl: string;
  /** The model row's id, passed through unchanged. */
  model: string;
  /** The key for this turn ONLY. Held in the window's memory, never on disk. */
  apiKey: string;
  /**
   * The row's request headers (story 15.17; PROVISIONAL). DATA the catalogue
   * supplied, merged by the sidecar AFTER its own generic headers. A name the
   * turn owns (authorization, content-type, host, content-length) is refused
   * at the wire as well as at the write — defence in depth, never a silent
   * override. Absent means the row carries none.
   */
  headers?: Record<string, string>;
  /**
   * STORY 16.29 — THE EFFORT THE PERSON PICKED FOR THIS ASK, or absent for
   * "default". The VALUE comes from the vendored catalogue's own per-model
   * list (never a hard-coded level); this wire carries it unchanged and the
   * sidecar writes it as the request body's `reasoning_effort` when it is
   * present. Absent means the body carries no such field at all, so a provider
   * that does not know the name sees exactly the request it always did. The
   * CURATOR call never sets this: it distils, it does not reason.
   */
  reasoningEffort?: string;
}

/** The two roles story 1 sends: one fixed instruction and the person's words. */
export type TurnRole = "system" | "user";

export interface TurnMessage {
  role: TurnRole;
  content: string;
}

/** The first line the sidecar writes: it is alive and speaks this wire. */
export interface HelloLine {
  kind: "hello";
  version: number;
}

/** One piece of the answer. Story 1 sends exactly one `text` part. */
export interface TextPartLine {
  id: number;
  kind: "part";
  part: "text";
  text: string;
}

export interface DoneLine {
  id: number;
  kind: "done";
}

export interface ErrorLine {
  id: number;
  kind: "error";
  /** One sentence, already scrubbed of anything secret. */
  message: string;
}

export interface CancelledLine {
  id: number;
  kind: "cancelled";
}

/**
 * Where a model list comes from (story 15.11): the row's base URL and the key
 * for exactly this one fetch. There is no model: asking for a list is asking
 * before one is chosen.
 */
export interface ModelListProvider {
  /** The provider's base URL; `/models` is appended by the sidecar. */
  baseUrl: string;
  /** The key for this fetch ONLY. It may be empty for a keyless loopback. */
  apiKey: string;
}

/** One id the provider listed, as the wire carries it. */
export interface ModelIdLine {
  id: string;
}

/**
 * The provider's list: ids, sorted and de-duplicated by the sidecar. `offered`
 * is present only when the cap dropped some — it says how many there were, so
 * the window can state the truncation without keeping a count of its own.
 */
export interface ModelsLine {
  id: number;
  kind: "models";
  models: ModelIdLine[];
  /** How many ids the provider offered before the cap, when it truncated. */
  offered?: number;
}

/** Ask the sidecar to fetch ONE web page (story 16.14). No key. */
export interface PageRequest {
  id: number;
  kind: "page";
  /** The address EXACTLY as the person gave it; the sidecar's guard decides. */
  url: string;
}

/** Ask the sidecar to fetch ONE thumbnail image (story 16.14). No key. */
export interface ThumbRequest {
  id: number;
  kind: "thumb";
  /** The image URL the page declared, already resolved. */
  url: string;
}

/**
 * What one page read found: its title, the extracted text, the thumbnail's
 * address (if the page declared one) and the HTTP status. The text is already
 * reduced and capped; the thumbnail itself is a second, separate fetch.
 */
export interface PageLine {
  id: number;
  kind: "page";
  title: string;
  text: string;
  thumbUrl: string | null;
  http: number;
}

/** Ask the sidecar to read ONE video's oEmbed look (story 16.15). No key. */
export interface VideoRequest {
  id: number;
  kind: "video";
  /** The address EXACTLY as the person gave it; the sidecar's guard decides. */
  url: string;
}

/**
 * What one video read found: its title, its thumbnail's address, the provider
 * that answered and the HTTP status. There is NO transcript — this line carries
 * the look only, and the card says the text needs a model that can read video.
 */
export interface VideoLine {
  id: number;
  kind: "video";
  title: string;
  thumbUrl: string | null;
  provider: string;
  http: number;
}

/** One thumbnail's bytes, base64 — the image never becomes a remote URL. */
export interface ThumbLine {
  id: number;
  kind: "thumb";
  /** The image MIME type, e.g. `image/png`. */
  mime: string;
  /** The image's bytes, base64-encoded. */
  data: string;
  http: number;
}

/**
 * THE TOOL A RUN STARTS (story 18.3b): argv only, never a shell string, and no
 * key anywhere near it.
 *
 * STORY 19.2 — A CWD CROSSES ONLY WHEN THE PERSON BOUND A PROJECT. The sidecar
 * still makes a fresh session directory by default; a `cwd` appears on this
 * wire ONLY when the card is bound to a project card and the person declared a
 * boundary, and then it is one ABSOLUTE folder path. Absent means exactly the
 * old rule: a fresh temp directory and no assumption about where a run lands.
 */
export interface RunTool {
  /** The server executable, an absolute path the row already validated. */
  command: string;
  /** The argv that makes it an ACP server, one entry each. */
  args: string[];
  /**
   * The budget, in MINUTES. It is a positive number rather than an integer so a
   * test can state a short one; a row still refuses anything under a minute.
   */
  timeoutMinutes: number;
}

/**
 * Ask the sidecar to start ONE run. The `env` map is the RESOLVED grant —
 * variable NAME to VALUE — and it is the only road a key takes: it rides inside
 * this payload exactly as a turn's key does, never an argv, never a log line.
 * The child receives that map plus PATH/HOME and nothing else (18.2's rule).
 */
export interface RunRequest {
  id: number;
  kind: "run";
  /** The run's number in the sidecar's table; `run-part`/`run-end` echo it. */
  run: number;
  tool: RunTool;
  env: Record<string, string>;
  prompt: string;
  /**
   * STORY 19.2 — WHERE THE RUN STARTS, when the person bound a project and
   * declared a boundary (PROVISIONAL). An ABSOLUTE folder path; absent means a
   * fresh session directory, exactly as before. The lane refuses a folder that
   * is not there before any child is spawned.
   */
  cwd?: string;
  /**
   * STORY 19.2 — WHAT THE PERSON DECLARED the run may do in that folder
   * (PROVISIONAL). Absent means "not declared": every ask reaches the person.
   */
  scope?: RunScope;
  /**
   * STORY 21.1 — CONTINUE THIS SESSION INSTEAD OF MAKING ONE (PROVISIONAL).
   * The pair is the delegate's own: the id it recorded, and the EXACT folder it
   * recorded the session in (a resume refuses any other directory, so the two
   * always ride together). Absent means a fresh session, exactly as before. The
   * lane refuses a resume whose folder is not the run's `cwd`.
   */
  resume?: RunResume;
  /**
   * STORY 22.5 — THE MODEL THE CARD'S RECORD ASKS THE TOOL FOR (PROVISIONAL).
   * The option id and value are the TOOL's own strings: the id names the config
   * option the person picked from the tool's list, the value is that list's
   * opaque selection. Absent means no choice was made, and the request keeps
   * the bytes it always had — the tool answers on its own default.
   */
  model?: RunModel;
}

/**
 * STORY 22.5 — ONE MODEL CHOICE ON THE WIRE (PROVISIONAL). `optionId` comes from
 * the options the tool named (the recorded fact), never from a constant here;
 * `value` is the tool's own string and crosses VERBATIM — this wire never
 * parses it, so a JSON-encoded value arrives at the sidecar exactly as written.
 */
export interface RunModel {
  optionId: string;
  value: string;
}

/**
 * STORY 21.1 — THE TWO FACTS A CONTINUATION NEEDS (PROVISIONAL). The id is the
 * server's own; the folder is the directory it was recorded in. Neither is
 * ever invented: a session entry that lacks one simply cannot be continued.
 */
export interface RunResume {
  sessionId: string;
  cwd: string;
}

/**
 * A SERVER'S PERMISSION REQUEST, down to the person (story 18.4). `id` is the
 * run's originating request id, so the window's run subscription hears it; `ask`
 * is the ACP request id the reply must echo. The tool call and the options are
 * the protocol's own fields, carried whole: the card decides what to show, and
 * the sidecar decides what an answer may mean.
 */
export interface RunPermissionLine {
  id: number;
  kind: "run-permission";
  run: number;
  /** The JSON-RPC request id of the server's ask. */
  ask: number;
  method: string;
  toolCall: unknown;
  options: AcpPermissionOption[];
}

/**
 * THE PERSON'S ANSWER, up (story 18.4). It names the run and the exact ask, and
 * carries a VERB — never an option id. The sidecar maps the verb against the ask
 * it is holding, so an "always" option can never cross this wire.
 */
export interface RunPermissionReplyRequest {
  id: number;
  kind: "run-permission-reply";
  run: number;
  ask: number;
  choice: AcpPermissionChoice;
}

/** Ask the sidecar to cancel a live run. That run's OWN `run-end` answers. */
export interface RunCancelRequest {
  id: number;
  kind: "run-cancel";
  run: number;
}

/* ------------------------------------------------------------------ *
 * STORY 22.1b — THE SETUP CHILD'S FIVE KINDS (PROVISIONAL).
 *
 * A setup child is the tool's OWN sign-in: the row's command with its sign-in
 * argv, its stdout and stderr relayed one line at a time, and its stdin fed by
 * the person's pasted code. It is NOT a run — no prompt, no transcript, no map,
 * no key grant of its own — so it has its own kinds rather than a run with a
 * flag. A `setup` request's env is a RESOLVED map, exactly as a run's is.
 * ------------------------------------------------------------------ */

/** The tool a setup child starts: the row's command, and the sign-in argv. */
export interface SetupTool {
  /** The server executable, exactly as the row declares it. */
  command: string;
  /** The argv that opens the tool's own sign-in, one entry each. */
  args: string[];
}

/**
 * Ask the sidecar to start ONE setup child. It is a fresh temp directory, the
 * RESOLVED env map plus PATH/HOME, and nothing else; the child lives until it
 * exits or the person stops it.
 */
export interface SetupRequest {
  id: number;
  kind: "setup";
  /** The setup number in the sidecar's own table; the other kinds echo it. */
  setup: number;
  tool: SetupTool;
  /** The resolved env map, NAME to VALUE, exactly as a run's payload carries it. */
  env: Record<string, string>;
}

/**
 * ONE string UP, written to the child's stdin followed by a newline. This is
 * the road the person's pasted code takes, and the ONLY one: the value is not
 * stored, logged, transcripted or recorded anywhere, on either side.
 */
export interface SetupStdinRequest {
  id: number;
  kind: "setup-stdin";
  setup: number;
  /** The exact line to write; the sidecar adds the newline and nothing else. */
  text: string;
}

/** Ask the sidecar to stop a live setup child. Its OWN `setup-end` answers. */
export interface SetupCancelRequest {
  id: number;
  kind: "setup-cancel";
  setup: number;
}

/** Which pipe a setup line came from. The card never merges the two. */
export type SetupStream = "stdout" | "stderr";

/** ONE line the setup child printed, in arrival order, with its stream. */
export interface SetupPartLine {
  id: number;
  kind: "setup-part";
  setup: number;
  stream: SetupStream;
  line: string;
}

/**
 * How a setup child ended: it exited by itself with code 0 ("completed"), it
 * was stopped by the person ("stopped"), or it exited some other way
 * ("failed"). `line` is the child's last line when it printed one; a child
 * that never started is answered by an `error` line, not by this one.
 */
export type SetupEnding = "completed" | "failed" | "stopped";

/** The setup child's ending: its exit code and the last line it printed. */
export interface SetupEndLine {
  id: number;
  kind: "setup-end";
  setup: number;
  ending: SetupEnding;
  /** The child's exit code, or null when no code could be read. */
  exitCode: number | null;
  /** The last line the child printed, or null when it printed none. */
  line: string | null;
}

/** ONE progress entry, in arrival order. The transcript's order is this one. */
export interface RunPartLine {
  id: number;
  kind: "run-part";
  run: number;
  entry: AcpProgressEntry;
}

/**
 * The run's ending. Only "completed" is a result, and a partial is never one
 * (18.2's rule, unchanged); `sentence` is the one quiet line for failed and
 * timed-out runs.
 */
export interface RunEndLine {
  id: number;
  kind: "run-end";
  run: number;
  ending: AcpEnding;
  sentence: string | null;
  /**
   * STORY 22.5 — WHAT THE SESSION STEP SAID THE TOOL OFFERS (PROVISIONAL). The
   * `configOptions` list the tool's own session answer carried, verbatim, so
   * the window can record it as a fact about this machine. Absent means the
   * answer carried no list (nothing is claimed); an empty array is a list that
   * named no options.
   */
  configOptions?: unknown[];
}

/** What the window may read from the sidecar's stdout. */
export type SidecarLine =
  | HelloLine
  | TextPartLine
  | DoneLine
  | ErrorLine
  | CancelledLine
  | ModelsLine
  | PageLine
  | VideoLine
  | ThumbLine
  | RunPartLine
  | RunPermissionLine
  | RunEndLine
  | SetupPartLine
  | SetupEndLine;

/** One turn's request. The messages are ALL that leaves the app. */
export interface TurnRequest {
  id: number;
  kind: "turn";
  provider: TurnProvider;
  messages: TurnMessage[];
}

/**
 * Ask the provider for its model list (story 15.11). No messages, no model:
 * it is the request a person's press makes, and it is answered by ONE `models`
 * line or ONE `error` line.
 */
export interface ModelsRequest {
  id: number;
  kind: "models";
  provider: ModelListProvider;
}

/** Stop the in-flight turn — or model fetch — with this id; `cancelled` answers. */
export interface StopRequest {
  id: number;
  kind: "stop";
}

/** What the sidecar may read from its stdin. */
export type SidecarRequest =
  | TurnRequest
  | ModelsRequest
  | PageRequest
  | VideoRequest
  | ThumbRequest
  | RunRequest
  | RunCancelRequest
  | RunPermissionReplyRequest
  | SetupRequest
  | SetupStdinRequest
  | SetupCancelRequest
  | StopRequest;

/* ------------------------------------------------------------------ *
 * Builders — each answer ONE line, ready for the pipe.
 * ------------------------------------------------------------------ */

export function helloLine(): string {
  return JSON.stringify({ kind: "hello", version: WIRE_VERSION });
}

export function requestLine(
  id: number,
  provider: TurnProvider,
  messages: readonly TurnMessage[],
): string {
  return JSON.stringify({ id, kind: "turn", provider, messages });
}

export function stopLine(id: number): string {
  return JSON.stringify({ id, kind: "stop" });
}

export function partLine(id: number, text: string): string {
  return JSON.stringify({ id, kind: "part", part: "text", text });
}

export function doneLine(id: number): string {
  return JSON.stringify({ id, kind: "done" });
}

export function errorLine(id: number, message: string): string {
  return JSON.stringify({ id, kind: "error", message });
}

export function cancelledLine(id: number): string {
  return JSON.stringify({ id, kind: "cancelled" });
}

/** The page's request line: one address, one read. */
export function pageRequestLine(id: number, url: string): string {
  return JSON.stringify({ id, kind: "page", url });
}

/** The thumbnail's request line: one image address. */
export function thumbRequestLine(id: number, url: string): string {
  return JSON.stringify({ id, kind: "thumb", url });
}

/** One page, one line: title, extracted text, thumbnail address, status. */
export function pageLine(
  id: number,
  title: string,
  text: string,
  thumbUrl: string | null,
  http: number,
): string {
  return JSON.stringify({ id, kind: "page", title, text, thumbUrl, http });
}

/** The video's request line: one address, one oEmbed read. */
export function videoRequestLine(id: number, url: string): string {
  return JSON.stringify({ id, kind: "video", url });
}

/** One video, one line: title, thumbnail address, provider, status. */
export function videoLine(
  id: number,
  title: string,
  thumbUrl: string | null,
  provider: string,
  http: number,
): string {
  return JSON.stringify({ id, kind: "video", title, thumbUrl, provider, http });
}

/** One thumbnail, one line: MIME and base64 bytes. */
export function thumbLine(
  id: number,
  mime: string,
  data: string,
  http: number,
): string {
  return JSON.stringify({ id, kind: "thumb", mime, data, http });
}

/**
 * The run's request line: one tool, one resolved env map, one prompt.
 *
 * STORY 19.2 — THE BOUND RUN'S TWO OPTIONAL FIELDS (PROVISIONAL). `extra.cwd`
 * and `extra.scope` ride the line ONLY when they are given, so an unbound card's
 * request is byte-for-byte what it always was.
 *
 * STORY 21.1 — `extra.resume` is the THIRD optional field (PROVISIONAL), and it
 * rides the same way: a fresh run's line is unchanged to the byte, and a
 * continuation speaks the pair the delegate recorded.
 */
export function runRequestLine(
  id: number,
  run: number,
  tool: RunTool,
  env: Readonly<Record<string, string>>,
  prompt: string,
  extra: {
    cwd?: string;
    scope?: RunScope;
    resume?: RunResume;
    model?: RunModel;
  } = {},
): string {
  return JSON.stringify({
    id,
    kind: "run",
    run,
    tool: {
      command: tool.command,
      args: [...tool.args],
      timeoutMinutes: tool.timeoutMinutes,
    },
    env: { ...env },
    prompt,
    ...(extra.cwd === undefined ? {} : { cwd: extra.cwd }),
    ...(extra.scope === undefined
      ? {}
      : { scope: { boundary: extra.scope.boundary } }),
    ...(extra.resume === undefined
      ? {}
      : {
          resume: {
            sessionId: extra.resume.sessionId,
            cwd: extra.resume.cwd,
          },
        }),
    // STORY 22.5 — the chosen model rides ONLY when one was chosen, so a card
    // with none sends exactly the bytes it always did. Both strings are the
    // tool's own; the value is never inspected here.
    ...(extra.model === undefined
      ? {}
      : { model: { optionId: extra.model.optionId, value: extra.model.value } }),
  });
}

/** The cancel's request line: a run number, and the cancel's own request id. */
export function runCancelLine(id: number, run: number): string {
  return JSON.stringify({ id, kind: "run-cancel", run });
}

/**
 * ONE permission request, down: the run it belongs to, the exact ask, and the
 * protocol's own fields (the tool call and the offered options). The options
 * are carried WHOLE — an "always" offer is visible on this wire, and is never
 * turned into a presented verb by the card.
 */
export function runPermissionLine(
  id: number,
  run: number,
  ask: AcpPermissionAsk,
): string {
  return JSON.stringify({
    id,
    kind: "run-permission",
    run,
    ask: ask.id,
    method: ask.method,
    toolCall: ask.toolCall,
    options: ask.options.map((option) => ({
      optionId: option.optionId,
      name: option.name,
      kind: option.kind,
    })),
  });
}

/**
 * The person's answer, up: the run, the exact ask and ONE verb. The option id
 * is derived by the sidecar from what the server actually offered, so this line
 * cannot smuggle an "always" choice.
 */
export function runPermissionReplyLine(
  id: number,
  run: number,
  ask: number,
  choice: AcpPermissionChoice,
): string {
  return JSON.stringify({ id, kind: "run-permission-reply", run, ask, choice });
}

/** ONE progress entry, one line, in the order the run reported it. */
export function runPartLine(
  id: number,
  run: number,
  entry: AcpProgressEntry,
): string {
  return JSON.stringify({ id, kind: "run-part", run, entry });
}

/** The run's ending, one line: the ending and its one sentence when it has one. */
export function runEndLine(
  id: number,
  run: number,
  ending: AcpEnding,
  sentence: string | null,
  configOptions?: readonly unknown[],
): string {
  return JSON.stringify({
    id,
    kind: "run-end",
    run,
    ending,
    sentence,
    ...(configOptions === undefined ? {} : { configOptions: [...configOptions] }),
  });
}

/**
 * STORY 22.1b — THE SETUP CHILD'S LINES (PROVISIONAL).
 *
 * The longest string the wire will carry to a child's stdin. A code is short;
 * a paste that is longer than this is REFUSED rather than truncated, because a
 * silently cut code is a wrong code.
 */
export const SETUP_STDIN_MAX = 4096;

/** The setup child's request line: one tool, one resolved env map. */
export function setupRequestLine(
  id: number,
  setup: number,
  tool: SetupTool,
  env: Readonly<Record<string, string>>,
): string {
  return JSON.stringify({
    id,
    kind: "setup",
    setup,
    tool: { command: tool.command, args: [...tool.args] },
    env: { ...env },
  });
}

/** ONE string up to the child's stdin; the sidecar writes it and a newline. */
export function setupStdinLine(id: number, setup: number, text: string): string {
  return JSON.stringify({ id, kind: "setup-stdin", setup, text });
}

/** The cancel's request line: a setup number, and the cancel's own request id. */
export function setupCancelLine(id: number, setup: number): string {
  return JSON.stringify({ id, kind: "setup-cancel", setup });
}

/** ONE line the setup child printed, down, marked with its stream. */
export function setupPartLine(
  id: number,
  setup: number,
  stream: SetupStream,
  line: string,
): string {
  return JSON.stringify({ id, kind: "setup-part", setup, stream, line });
}

/** The setup child's ending: the exit code and the last line it printed. */
export function setupEndLine(
  id: number,
  setup: number,
  ending: SetupEnding,
  exitCode: number | null,
  line: string | null,
): string {
  return JSON.stringify({
    id,
    kind: "setup-end",
    setup,
    ending,
    exitCode,
    line,
  });
}

/** The fetch's request line: one endpoint, one key, no model. */
export function modelsRequestLine(
  id: number,
  provider: ModelListProvider,
): string {
  return JSON.stringify({ id, kind: "models", provider });
}

/**
 * The list, one line. `offered` rides ONLY when the cap dropped some: a line
 * that truncated says so, and a line that did not carries no count to misread.
 */
export function modelsLine(
  id: number,
  models: readonly string[],
  offered?: number,
): string {
  const line: Record<string, unknown> = {
    id,
    kind: "models",
    models: models.map((model) => ({ id: model })),
  };
  if (offered !== undefined) line.offered = offered;
  return JSON.stringify(line);
}

/* ------------------------------------------------------------------ *
 * Readers — strict, total, and never throwing.
 * ------------------------------------------------------------------ */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A request id: a positive integer, so `id: 0` never means "no turn". */
function isId(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isInteger(value) && value >= 1
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * STORY 19.2 — IS THIS THE ABSOLUTE FOLDER A RUN MAY START IN? POSIX's leading
 * slash, a Windows drive and a UNC all count, and the same three spellings the
 * record's own path check accepts. PURE, so the reader and a test share it.
 */
function isAbsoluteFolder(value: unknown): value is string {
  if (typeof value !== "string" || value === "") return false;
  return (
    value.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(value) ||
    value.startsWith("\\\\")
  );
}

function isMessage(value: unknown): value is TurnMessage {
  if (!isRecord(value)) return false;
  return (
    (value.role === "system" || value.role === "user") &&
    typeof value.content === "string"
  );
}

/** A row's header map as the wire may carry it: string names and values. */
function isHeaderMap(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(
    ([name, headerValue]) =>
      name.trim() !== "" && typeof headerValue === "string",
  );
}

function isProvider(value: unknown): value is TurnProvider {
  if (!isRecord(value)) return false;
  if (!(
    isNonEmptyString(value.baseUrl) &&
    isNonEmptyString(value.model) &&
    typeof value.apiKey === "string"
  )) {
    return false;
  }
  if (value.headers !== undefined && !isHeaderMap(value.headers)) return false;
  // STORY 16.29 — an effort may ride or be absent; when it rides it is a
  // non-empty string and nothing else. "default" is not refused HERE: the
  // builder never puts it on this wire, and the sidecar passes what it is given
  // through unchanged (a hand-built line is not this reader's to reinterpret).
  return (
    value.reasoningEffort === undefined ||
    isNonEmptyString(value.reasoningEffort)
  );
}

/** A model-list provider: a base URL and a key that may be empty. */
function isModelListProvider(value: unknown): value is ModelListProvider {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.baseUrl) && typeof value.apiKey === "string";
}

/** A name a process may carry, so a run's env map can only fill real names. */
function isEnvName(value: unknown): value is string {
  return (
    typeof value === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)
  );
}

/** How a setup child ended; anything else is not this wire's ending. */
function isSetupEnding(value: unknown): value is SetupEnding {
  return (
    value === "completed" || value === "failed" || value === "stopped"
  );
}

/** How a run ended; anything else is not this wire's ending. */
function isEnding(value: unknown): value is AcpEnding {
  return (
    value === "completed" ||
    value === "stopped" ||
    value === "failed" ||
    value === "timed-out"
  );
}

/** The tool a setup child starts: the row's command and its sign-in argv. */
function isSetupTool(value: unknown): value is SetupTool {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.command)) return false;
  if (!Array.isArray(value.args)) return false;
  return value.args.every((arg) => typeof arg === "string");
}

/** The tool a run starts: argv only, an absolute-ish command and a budget. */
function isRunTool(value: unknown): value is RunTool {
  if (!isRecord(value)) return false;
  if (!isNonEmptyString(value.command)) return false;
  if (!Array.isArray(value.args)) return false;
  if (!value.args.every((arg) => typeof arg === "string")) return false;
  const minutes = value.timeoutMinutes;
  return (
    typeof minutes === "number" &&
    Number.isFinite(minutes) &&
    minutes > 0
  );
}

/** One permission option, as the server offered it. */
function readPermissionOptions(value: unknown): AcpPermissionOption[] | null {
  if (!Array.isArray(value)) return null;
  const options: AcpPermissionOption[] = [];
  for (const candidate of value) {
    if (!isRecord(candidate)) return null;
    if (
      typeof candidate.optionId !== "string" ||
      typeof candidate.name !== "string" ||
      typeof candidate.kind !== "string"
    ) {
      return null;
    }
    options.push({
      optionId: candidate.optionId,
      name: candidate.name,
      kind: candidate.kind,
    });
  }
  return options;
}

/**
 * Read ONE progress entry (story 18.3b). `null` for anything that is not
 * exactly one entry of this vocabulary — the run's own record is never asked to
 * survive a guess, and the window ignores a line it cannot read.
 */
function readProgressEntry(value: unknown): AcpProgressEntry | null {
  if (!isRecord(value)) return null;
  if (value.kind === "started") {
    if (typeof value.command !== "string") return null;
    if (!Array.isArray(value.args)) return null;
    if (!value.args.every((arg) => typeof arg === "string")) return null;
    if (typeof value.cwd !== "string") return null;
    if (typeof value.declaration !== "string") return null;
    if (!Array.isArray(value.inherited)) return null;
    if (!value.inherited.every((name) => typeof name === "string")) return null;
    if (!Array.isArray(value.envNames)) return null;
    if (!value.envNames.every((name) => typeof name === "string")) return null;
    return {
      kind: "started",
      command: value.command,
      args: [...(value.args as string[])],
      cwd: value.cwd,
      declaration: value.declaration,
      inherited: [...(value.inherited as string[])],
      envNames: [...(value.envNames as string[])],
    };
  }
  if (value.kind === "session") {
    if (!isNonEmptyString(value.sessionId)) return null;
    // STORY 21.1 — the folder rides when the run stated one; an older entry
    // with none is still this vocabulary's session, just not a continuable one.
    if (value.cwd !== undefined && !isNonEmptyString(value.cwd)) return null;
    return {
      kind: "session",
      sessionId: value.sessionId,
      ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
    };
  }
  if (value.kind === "update") {
    if (typeof value.updateKind !== "string") return null;
    if (typeof value.text !== "string") return null;
    return {
      kind: "update",
      updateKind: value.updateKind,
      text: value.text,
      update: value.update,
    };
  }
  if (value.kind === "permission") {
    if (typeof value.method !== "string") return null;
    const options = readPermissionOptions(value.options);
    if (options === null) return null;
    const reply = value.reply;
    if (!isRecord(reply)) return null;
    if (reply.outcome === "selected") {
      if (!isNonEmptyString(reply.optionId)) return null;
      return {
        kind: "permission",
        method: value.method,
        toolCall: value.toolCall,
        options,
        reply: { outcome: "selected", optionId: reply.optionId },
      };
    }
    // STORY 18.4 — a request the budget left waiting is its own outcome. It is
    // neither a selection nor a cancellation, and the transcript states it.
    if (reply.outcome === "unanswered") {
      return {
        kind: "permission",
        method: value.method,
        toolCall: value.toolCall,
        options,
        reply: { outcome: "unanswered" },
      };
    }
    if (reply.outcome !== "cancelled") return null;
    return {
      kind: "permission",
      method: value.method,
      toolCall: value.toolCall,
      options,
      reply: { outcome: "cancelled" },
    };
  }
  if (value.kind === "problem") {
    if (typeof value.sentence !== "string") return null;
    return { kind: "problem", sentence: value.sentence };
  }
  if (value.kind === "ended") {
    if (!isEnding(value.ending)) return null;
    if (value.stopReason !== null && typeof value.stopReason !== "string") {
      return null;
    }
    if (value.sentence !== null && typeof value.sentence !== "string") {
      return null;
    }
    if (typeof value.partial !== "boolean") return null;
    return {
      kind: "ended",
      ending: value.ending,
      stopReason: value.stopReason,
      sentence: value.sentence,
      partial: value.partial,
    };
  }
  return null;
}

/** Read one `models` line; null for anything that is not exactly that line. */
function readModelsLine(
  id: number,
  value: Record<string, unknown>,
): ModelsLine | null {
  if (!Array.isArray(value.models)) return null;
  const models: ModelIdLine[] = [];
  const seen = new Set<string>();
  for (const candidate of value.models) {
    if (!isRecord(candidate) || !isNonEmptyString(candidate.id)) return null;
    const modelId = candidate.id.trim();
    // The sidecar de-duplicates before it writes; a duplicate is a broken line.
    if (seen.has(modelId)) return null;
    seen.add(modelId);
    models.push({ id: modelId });
  }
  if (value.offered === undefined) {
    return { id, kind: "models", models };
  }
  const offered = value.offered;
  if (
    typeof offered !== "number" ||
    !Number.isInteger(offered) ||
    offered < models.length
  ) {
    return null;
  }
  return { id, kind: "models", models, offered };
}

/**
 * Parse one line the SIDECAR wrote. `null` for anything that is not exactly a
 * line of this wire: bad JSON, a missing id, an unknown kind, a part that is
 * not text. The window ignores nulls rather than reporting them (an unknown
 * line from a newer sidecar is not this turn's business).
 */
export function parseSidecarLine(raw: string): SidecarLine | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;

  if (value.kind === "hello") {
    return typeof value.version === "number" && Number.isInteger(value.version)
      ? { kind: "hello", version: value.version }
      : null;
  }
  if (!isId(value.id)) return null;

  if (value.kind === "part") {
    if (value.part !== "text" || typeof value.text !== "string") return null;
    return { id: value.id, kind: "part", part: "text", text: value.text };
  }
  if (value.kind === "done") {
    return { id: value.id, kind: "done" };
  }
  if (value.kind === "error") {
    if (typeof value.message !== "string") return null;
    return { id: value.id, kind: "error", message: value.message };
  }
  if (value.kind === "cancelled") {
    return { id: value.id, kind: "cancelled" };
  }
  if (value.kind === "models") {
    return readModelsLine(value.id, value);
  }
  if (value.kind === "page") {
    if (typeof value.title !== "string" || typeof value.text !== "string") {
      return null;
    }
    if (value.thumbUrl !== null && typeof value.thumbUrl !== "string") {
      return null;
    }
    if (!isId(value.http)) return null;
    return {
      id: value.id,
      kind: "page",
      title: value.title,
      text: value.text,
      thumbUrl: value.thumbUrl,
      http: value.http,
    };
  }
  if (value.kind === "video") {
    if (typeof value.title !== "string") return null;
    if (value.thumbUrl !== null && typeof value.thumbUrl !== "string") {
      return null;
    }
    if (!isNonEmptyString(value.provider)) return null;
    if (!isId(value.http)) return null;
    return {
      id: value.id,
      kind: "video",
      title: value.title,
      thumbUrl: value.thumbUrl,
      provider: value.provider,
      http: value.http,
    };
  }
  if (value.kind === "thumb") {
    if (typeof value.mime !== "string" || typeof value.data !== "string") {
      return null;
    }
    if (!isId(value.http)) return null;
    return {
      id: value.id,
      kind: "thumb",
      mime: value.mime,
      data: value.data,
      http: value.http,
    };
  }
  if (value.kind === "run-part") {
    if (!isId(value.run)) return null;
    const entry = readProgressEntry(value.entry);
    if (entry === null) return null;
    return { id: value.id, kind: "run-part", run: value.run, entry };
  }
  if (value.kind === "run-permission") {
    if (!isId(value.run)) return null;
    if (!isId(value.ask)) return null;
    if (typeof value.method !== "string" || value.method === "") return null;
    const options = readPermissionOptions(value.options);
    if (options === null) return null;
    return {
      id: value.id,
      kind: "run-permission",
      run: value.run,
      ask: value.ask,
      method: value.method,
      toolCall: value.toolCall,
      options,
    };
  }
  if (value.kind === "setup-part") {
    if (!isId(value.setup)) return null;
    if (value.stream !== "stdout" && value.stream !== "stderr") return null;
    if (typeof value.line !== "string") return null;
    return {
      id: value.id,
      kind: "setup-part",
      setup: value.setup,
      stream: value.stream,
      line: value.line,
    };
  }
  if (value.kind === "setup-end") {
    if (!isId(value.setup)) return null;
    if (!isSetupEnding(value.ending)) return null;
    if (value.exitCode !== null && !Number.isInteger(value.exitCode)) return null;
    if (value.line !== null && typeof value.line !== "string") return null;
    return {
      id: value.id,
      kind: "setup-end",
      setup: value.setup,
      ending: value.ending,
      exitCode: value.exitCode as number | null,
      line: value.line as string | null,
    };
  }
  if (value.kind === "run-end") {
    if (!isId(value.run)) return null;
    if (!isEnding(value.ending)) return null;
    if (value.sentence !== null && typeof value.sentence !== "string") {
      return null;
    }
    // STORY 22.5 — the options list rides only when the run saw one. It is
    // carried WHOLE and unread here: the window decides what the tool's own
    // objects mean, and this wire never repairs a shape it did not expect.
    if (value.configOptions !== undefined && !Array.isArray(value.configOptions)) {
      return null;
    }
    return {
      id: value.id,
      kind: "run-end",
      run: value.run,
      ending: value.ending,
      sentence: value.sentence,
      ...(value.configOptions === undefined
        ? {}
        : { configOptions: value.configOptions }),
    };
  }
  return null;
}

/**
 * Parse one line the WINDOW wrote. `null` for a malformed request — the
 * sidecar then answers an error for the id when it can read one
 * (`requestIdOf`) and ignores the line when it cannot.
 */
export function parseRequestLine(raw: string): SidecarRequest | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || !isId(value.id)) return null;

  if (value.kind === "stop") {
    return { id: value.id, kind: "stop" };
  }
  if (value.kind === "models") {
    if (!isModelListProvider(value.provider)) return null;
    return {
      id: value.id,
      kind: "models",
      provider: {
        baseUrl: value.provider.baseUrl,
        apiKey: value.provider.apiKey,
      },
    };
  }
  if (value.kind === "page") {
    if (!isNonEmptyString(value.url)) return null;
    return { id: value.id, kind: "page", url: value.url };
  }
  if (value.kind === "video") {
    if (!isNonEmptyString(value.url)) return null;
    return { id: value.id, kind: "video", url: value.url };
  }
  if (value.kind === "thumb") {
    if (!isNonEmptyString(value.url)) return null;
    return { id: value.id, kind: "thumb", url: value.url };
  }
  if (value.kind === "run-cancel") {
    if (!isId(value.run)) return null;
    return { id: value.id, kind: "run-cancel", run: value.run };
  }
  // STORY 22.1b — THE SETUP CHILD'S THREE REQUESTS (PROVISIONAL). Its tool is
  // the row's command and argv and nothing else; its env map is a resolved map
  // whose names a process can carry (the run payload's rule, one class over).
  if (value.kind === "setup") {
    if (!isId(value.setup)) return null;
    if (!isSetupTool(value.tool)) return null;
    if (!isRecord(value.env)) return null;
    const env: Record<string, string> = {};
    for (const [name, secret] of Object.entries(value.env)) {
      if (!isEnvName(name)) return null;
      if (typeof secret !== "string" || secret === "") return null;
      env[name] = secret;
    }
    return {
      id: value.id,
      kind: "setup",
      setup: value.setup,
      tool: {
        command: value.tool.command,
        args: [...value.tool.args],
      },
      env,
    };
  }
  if (value.kind === "setup-stdin") {
    if (!isId(value.setup)) return null;
    // A blank line is not a code; a paste over the cap is refused rather than
    // cut. Both are the wire refusing, never a silent write.
    if (!isNonEmptyString(value.text)) return null;
    if (value.text.length > SETUP_STDIN_MAX) return null;
    return {
      id: value.id,
      kind: "setup-stdin",
      setup: value.setup,
      text: value.text,
    };
  }
  if (value.kind === "setup-cancel") {
    if (!isId(value.setup)) return null;
    return { id: value.id, kind: "setup-cancel", setup: value.setup };
  }
  if (value.kind === "run-permission-reply") {
    if (!isId(value.run)) return null;
    if (!isId(value.ask)) return null;
    if (
      value.choice !== "allow-once" &&
      value.choice !== "refuse"
    ) {
      return null;
    }
    return {
      id: value.id,
      kind: "run-permission-reply",
      run: value.run,
      ask: value.ask,
      choice: value.choice,
    };
  }
  if (value.kind === "run") {
    if (!isId(value.run)) return null;
    if (!isRunTool(value.tool)) return null;
    if (!isRecord(value.env)) return null;
    // STORY 19.2 — A CWD CROSSES ONLY AS AN ABSOLUTE PATH, AND A SCOPE ONLY AS
    // ONE OF THE TWO BOUNDARY WORDS. Anything else is refused, never repaired:
    // a relative path would let a run land in whatever directory the sidecar
    // happened to have, and an unknown boundary would be a quiet widening.
    if (value.cwd !== undefined && !isAbsoluteFolder(value.cwd)) return null;
    let scope: RunScope | undefined;
    if (value.scope !== undefined) {
      if (!isRecord(value.scope)) return null;
      const boundary = value.scope.boundary;
      if (boundary !== "read" && boundary !== "write") return null;
      // A DECLARATION WITHOUT A FOLDER IS REFUSED: the consent is about the
      // bound folder, so a scope that arrived without one would be an
      // auto-answer for a run that is not in the place the person named.
      if (value.cwd === undefined) return null;
      scope = { boundary };
    }
    // STORY 21.1 — A CONTINUATION CARRIES ITS ID AND ITS EXACT FOLDER, AND A
    // RESUME WITHOUT A FOLDER IS REFUSED (the scope-without-cwd precedent one
    // field over): an id alone would make the lane guess a directory, and the
    // tool refuses every guess. An empty id or a relative folder is not a
    // continuation this wire can state.
    let resume: RunResume | undefined;
    if (value.resume !== undefined) {
      if (!isRecord(value.resume)) return null;
      if (!isNonEmptyString(value.resume.sessionId)) return null;
      if (!isAbsoluteFolder(value.resume.cwd)) return null;
      resume = { sessionId: value.resume.sessionId, cwd: value.resume.cwd };
    }
    // The payload's map is the WHOLE grant: every name is a name a process can
    // carry, every value is a string, and a name with no value is refused here
    // rather than silently dropped.
    const env: Record<string, string> = {};
    for (const [name, secret] of Object.entries(value.env)) {
      if (!isEnvName(name)) return null;
      if (typeof secret !== "string" || secret === "") return null;
      env[name] = secret;
    }
    if (!isNonEmptyString(value.prompt)) return null;
    // STORY 22.5 — A MODEL CHOICE CARRIES THE TOOL'S TWO STRINGS AND NOTHING
    // ELSE. Both must be non-empty; the VALUE is opaque, so this wire never
    // parses it (a JSON-encoded value is just a string here). A choice without
    // its option id names no option and is refused rather than repaired.
    let model: RunModel | undefined;
    if (value.model !== undefined) {
      if (!isRecord(value.model)) return null;
      if (!isNonEmptyString(value.model.optionId)) return null;
      if (!isNonEmptyString(value.model.value)) return null;
      model = { optionId: value.model.optionId, value: value.model.value };
    }
    return {
      id: value.id,
      kind: "run",
      run: value.run,
      tool: {
        command: value.tool.command,
        args: [...value.tool.args],
        timeoutMinutes: value.tool.timeoutMinutes,
      },
      env,
      prompt: value.prompt,
      ...(value.cwd === undefined ? {} : { cwd: value.cwd }),
      ...(scope === undefined ? {} : { scope }),
      ...(resume === undefined ? {} : { resume }),
      ...(model === undefined ? {} : { model }),
    };
  }
  if (value.kind !== "turn") return null;
  if (!isProvider(value.provider)) return null;
  if (!Array.isArray(value.messages) || value.messages.length === 0) return null;
  if (!value.messages.every(isMessage)) return null;

  const provider = value.provider;
  const parsedProvider: TurnProvider = {
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKey: provider.apiKey,
  };
  // The row's header map is DATA and rides the parsed request unchanged; an
  // absent map stays absent, so the three-field provider is still exactly what
  // a headerless row carries.
  if (provider.headers !== undefined) {
    parsedProvider.headers = { ...provider.headers };
  }
  // STORY 16.29 — the effort rides the parsed provider unchanged, and an
  // absent one stays absent (the three-field shape every earlier test pinned).
  if (provider.reasoningEffort !== undefined) {
    parsedProvider.reasoningEffort = provider.reasoningEffort;
  }
  return {
    id: value.id,
    kind: "turn",
    provider: parsedProvider,
    messages: value.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
}

/**
 * The best-effort id of a line that did NOT parse, so a malformed request can
 * be answered `error` rather than vanish. `null` when the line has no id to
 * answer to.
 */
export function requestIdOf(raw: string): number | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || !isId(value.id)) return null;
    return value.id;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ *
 * Text hygiene for anything that travels as a sentence.
 * ------------------------------------------------------------------ */

/** Collapse a message onto one quiet line (no stack traces, no blank runs). */
export function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Remove the key from a sentence before it can reach a pipe, an event or a
 * log. Defence in depth: the sidecar builds its messages without the key in
 * the first place, and this makes a future careless `e.message` harmless.
 * An empty key is not scrubbed (nothing to remove, and an empty needle would
 * match everywhere).
 */
export function scrubSecret(text: string, secret: string): string {
  const clean = secret === "" ? text : text.split(secret).join("[the key]");
  return oneLine(clean);
}
