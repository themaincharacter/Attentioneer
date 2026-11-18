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
 * key anywhere near it. The sidecar makes the fresh session directory, so no
 * cwd crosses this wire.
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
  | RunEndLine;

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

/** The run's request line: one tool, one resolved env map, one prompt. */
export function runRequestLine(
  id: number,
  run: number,
  tool: RunTool,
  env: Readonly<Record<string, string>>,
  prompt: string,
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
): string {
  return JSON.stringify({ id, kind: "run-end", run, ending, sentence });
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
  return value.headers === undefined || isHeaderMap(value.headers);
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

/** How a run ended; anything else is not this wire's ending. */
function isEnding(value: unknown): value is AcpEnding {
  return (
    value === "completed" ||
    value === "stopped" ||
    value === "failed" ||
    value === "timed-out"
  );
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
    return { kind: "session", sessionId: value.sessionId };
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
  if (value.kind === "run-end") {
    if (!isId(value.run)) return null;
    if (!isEnding(value.ending)) return null;
    if (value.sentence !== null && typeof value.sentence !== "string") {
      return null;
    }
    return {
      id: value.id,
      kind: "run-end",
      run: value.run,
      ending: value.ending,
      sentence: value.sentence,
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
