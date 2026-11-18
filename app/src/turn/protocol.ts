/**
 * THE TURN'S WIRE — one envelope, one strict reader, one set of builders
 * (Epic 15 story 1; ADR-0034's transport, implemented not decided).
 *
 * STORY 15.11 ADDS ONE REQUEST AND ONE LINE, not a second wire: a `models`
 * request asks the sidecar for the provider's own model list, and a `models`
 * line carries what it found. STORY 16.14 adds a `page` request/line for a
 * web reference (the title, its extracted text and a thumbnail address) and a
 * `thumb` request/line that carries the image's bytes back as base64 — the
 * same one pipe, the same one-sentence errors. The key still rides inside a
 * request line and nowhere else.
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

/** What the window may read from the sidecar's stdout. */
export type SidecarLine =
  | HelloLine
  | TextPartLine
  | DoneLine
  | ErrorLine
  | CancelledLine
  | ModelsLine
  | PageLine
  | ThumbLine;

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
  | ThumbRequest
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

/** One thumbnail, one line: MIME and base64 bytes. */
export function thumbLine(
  id: number,
  mime: string,
  data: string,
  http: number,
): string {
  return JSON.stringify({ id, kind: "thumb", mime, data, http });
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

function isProvider(value: unknown): value is TurnProvider {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value.baseUrl) &&
    isNonEmptyString(value.model) &&
    typeof value.apiKey === "string"
  );
}

/** A model-list provider: a base URL and a key that may be empty. */
function isModelListProvider(value: unknown): value is ModelListProvider {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value.baseUrl) && typeof value.apiKey === "string";
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
  if (value.kind === "thumb") {
    if (!isNonEmptyString(value.url)) return null;
    return { id: value.id, kind: "thumb", url: value.url };
  }
  if (value.kind !== "turn") return null;
  if (!isProvider(value.provider)) return null;
  if (!Array.isArray(value.messages) || value.messages.length === 0) return null;
  if (!value.messages.every(isMessage)) return null;

  const provider = value.provider;
  return {
    id: value.id,
    kind: "turn",
    provider: {
      baseUrl: provider.baseUrl,
      model: provider.model,
      apiKey: provider.apiKey,
    },
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
