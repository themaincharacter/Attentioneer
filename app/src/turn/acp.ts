/**
 * THE ACP TRANSPORT (Epic 18 story 1) — one spawned server, one JSON-RPC pipe,
 * nothing else.
 *
 * WHAT THIS FILE IS NOT: a card, a policy, a map, a renderer. It knows how to
 * start a command, speak the Agent Client Protocol over that child's stdio,
 * carry a request to its answer, and hand every notification or server request
 * to the caller. Which permission to grant, what a streamed chunk means and
 * what to do with a stop reason are the caller's business.
 *
 * FRAMING, PROBED AND DOCUMENTED. ACP's stdio transport is NEWLINE-DELIMITED
 * JSON (one compact JSON object per line, trailing LF), not LSP's
 * \`Content-Length\` headers. The installed server proves it: its SDK's
 * \`ndJsonStream\` encodes \`JSON.stringify(message) + "\n"\` and splits input on
 * 0x0a. Both framings live here anyway, behind one reader and one writer, so a
 * second server's framing is a flag rather than a rewrite. The spike probes
 * newline framing first and records what the real server answered.
 *
 * CORRELATION AND ORDER. Outbound request ids are this transport's own
 * positive integers; an answer is matched by id and by nothing else. A
 * notification is relayed in arrival order. A malformed line is REPORTED and
 * the reader keeps reading — one bad line must not take the conversation with
 * it (the same rule the turn sidecar follows). A server request (in practice
 * \`session/request_permission\`) is relayed with its id, and
 * \`respondToPermission\` writes the answer the caller chose.
 *
 * THE CHILD IS KILLED BY \`close\`, by construction's caller, and on exit the
 * pending requests are answered with one sentence rather than a hang. This
 * module writes no file and reads no key: the only I/O is the child's pipes.
 *
 * STORY 21.1 — session/resume IS ONE MORE TYPED CALL (PROVISIONAL). It is an
 * optional capability a server advertises in initialize, so the handshake is
 * still spoken first; the call names the server's own session id and the EXACT
 * folder it was recorded in, and the answer is read strictly — an id the server
 * did not state is an honest failure, never an invented continuation.
 *
 * PROVISIONAL: the helper names, the capability object sent in \`initialize\`
 * and the sentence wording. The wire shapes are ACP v1's (as the spike's
 * server answered them); every observed shape is recorded in
 * \`notes/acp-spike.md\`.
 */

/** The one protocol version these helpers speak (ACP v1). */
export const ACP_PROTOCOL_VERSION = 1;

/** The methods this transport calls by name. Server methods are relayed raw. */
export const ACP_METHODS = {
  initialize: "initialize",
  sessionNew: "session/new",
  /**
   * STORY 21.1 — CONTINUE A SESSION THE SERVER ALREADY HAS (PROVISIONAL). It is
   * an OPTIONAL capability, advertised by the server in `initialize`; a row
   * that does not declare it is never asked, and a run of such a row makes a
   * new session exactly as before.
   */
  sessionResume: "session/resume",
  sessionPrompt: "session/prompt",
  sessionCancel: "session/cancel",
  sessionUpdate: "session/update",
  requestPermission: "session/request_permission",
} as const;

/**
 * How one JSON-RPC message is framed on the pipe. \`ndjson\` is ACP's; the
 * header form is here because "probe, do not assume" is the story's rule.
 */
export type AcpFraming = "ndjson" | "content-length";

/** What one push of bytes produced: complete payloads, and what could not be read. */
export interface AcpFrames {
  frames: string[];
  problems: string[];
}

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const HEADER_END = [CARRIAGE_RETURN, NEWLINE, CARRIAGE_RETURN, NEWLINE];
const HEADER_END_BARE = [NEWLINE, NEWLINE];
/** A frame header that never ends is not a frame; report it and resynchronize. */
const MAX_HEADER_BYTES = 8 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Concatenate two byte arrays without touching the first's storage. */
function concatBytes(left: Uint8Array, right: Uint8Array): Uint8Array {
  if (left.byteLength === 0) return right;
  const joined = new Uint8Array(left.byteLength + right.byteLength);
  joined.set(left, 0);
  joined.set(right, left.byteLength);
  return joined;
}

/** Find a byte sequence in a buffer; -1 when it is not there. */
function indexOfBytes(haystack: Uint8Array, needle: readonly number[]): number {
  const last = haystack.byteLength - needle.length;
  for (let at = 0; at <= last; at += 1) {
    let matched = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (haystack[at + offset] !== needle[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) return at;
  }
  return -1;
}

/**
 * An incremental frame reader. Bytes may arrive split anywhere — inside a
 * header, inside a JSON string, between two frames — so the reader keeps the
 * unfinished tail and answers only complete payloads.
 *
 * A payload that cannot be framed is a PROBLEM, never an exception and never a
 * silent drop: the caller decides whether to report, stop or retry.
 */
export class AcpFrameReader {
  private pending: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  constructor(private readonly framing: AcpFraming) {}

  push(chunk: Uint8Array): AcpFrames {
    this.pending = concatBytes(this.pending, chunk);
    return this.take();
  }

  /** The stream ended: flush a final unterminated newline frame, report a cut one. */
  flush(): AcpFrames {
    if (this.pending.byteLength === 0) return { frames: [], problems: [] };
    if (this.framing === "ndjson") {
      const rest = decoder.decode(this.pending).replace(/\r$/, "");
      this.pending = new Uint8Array(0);
      const payload = rest.trim();
      return payload === ""
        ? { frames: [], problems: [] }
        : { frames: [payload], problems: [] };
    }
    this.pending = new Uint8Array(0);
    return { frames: [], problems: ["the server's last frame was cut off"] };
  }

  private take(): AcpFrames {
    const frames: string[] = [];
    const problems: string[] = [];
    for (;;) {
      if (this.framing === "ndjson") {
        const end = this.pending.indexOf(NEWLINE);
        if (end < 0) break;
        const line = decoder.decode(this.pending.subarray(0, end)).replace(/\r$/, "");
        this.pending = this.pending.slice(end + 1);
        const payload = line.trim();
        if (payload !== "") frames.push(payload);
        continue;
      }
      const end = indexOfBytes(this.pending, HEADER_END) >= 0
        ? indexOfBytes(this.pending, HEADER_END)
        : indexOfBytes(this.pending, HEADER_END_BARE);
      if (end < 0) {
        if (this.pending.byteLength > MAX_HEADER_BYTES) {
          problems.push("the server's frame header never ended");
          this.pending = new Uint8Array(0);
        }
        break;
      }
      const headerLength = this.pending[end] === CARRIAGE_RETURN ? 4 : 2;
      const header = decoder.decode(this.pending.subarray(0, end));
      const contentStart = end + headerLength;
      const length = contentLengthOf(header);
      if (length === null) {
        problems.push("the server's frame header carried no length");
        this.pending = this.pending.slice(contentStart);
        continue;
      }
      if (this.pending.byteLength < contentStart + length) break;
      frames.push(decoder.decode(this.pending.subarray(contentStart, contentStart + length)));
      this.pending = this.pending.slice(contentStart + length);
    }
    return { frames, problems };
  }
}

/** Read one \`Content-Length\` header block; null when it has no usable length. */
function contentLengthOf(header: string): number | null {
  const match = /(^|\r?\n)\s*content-length\s*:\s*(\d+)\s*($|\r?\n)/i.exec(header);
  if (match === null) return null;
  const length = Number(match[2]);
  return Number.isSafeInteger(length) && length >= 0 ? length : null;
}

/** One payload, framed for the pipe. Bytes, not characters: headers count bytes. */
export function encodeAcpFrame(framing: AcpFraming, payload: string): string {
  if (framing === "ndjson") return payload + "\n";
  return "Content-Length: " + encoder.encode(payload).byteLength + "\r\n\r\n" + payload;
}

/* ------------------------------------------------------------------ *
 * The JSON-RPC shapes — only the fields this transport reads.
 * ------------------------------------------------------------------ */

export interface AcpErrorObject {
  code: number;
  message: string;
  data?: unknown;
}

export interface AcpRequestMessage {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

export interface AcpResponseMessage {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: AcpErrorObject;
}

export interface AcpNotificationMessage {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

/** What the server may write: an answer, a relayed notification, or a request. */
export type AcpInboundMessage =
  | AcpResponseMessage
  | AcpNotificationMessage
  | AcpRequestMessage;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/**
 * Parse one framed payload. \`null\` for anything that is not exactly one
 * JSON-RPC message: bad JSON, a missing \`jsonrpc\`, a request without a method,
 * an answer with neither result nor error.
 */
export function parseAcpMessage(raw: string): AcpInboundMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(value) || value.jsonrpc !== "2.0") return null;

  if (typeof value.method === "string" && value.method !== "") {
    if (value.id === undefined) {
      return { jsonrpc: "2.0", method: value.method, params: value.params };
    }
    if (!isId(value.id)) return null;
    return {
      jsonrpc: "2.0",
      id: value.id,
      method: value.method,
      params: value.params,
    };
  }

  if (!isId(value.id)) return null;
  if (value.error !== undefined) {
    if (!isRecord(value.error)) return null;
    if (typeof value.error.code !== "number") return null;
    if (typeof value.error.message !== "string") return null;
    return {
      jsonrpc: "2.0",
      id: value.id,
      error: {
        code: value.error.code,
        message: value.error.message,
        data: value.error.data,
      },
    };
  }
  if (!("result" in value)) return null;
  return { jsonrpc: "2.0", id: value.id, result: value.result };
}

/* ------------------------------------------------------------------ *
 * The child process, as a typed seam.
 * ------------------------------------------------------------------ */

/** The minimum a spawned ACP server must expose. Bun's Subprocess fits it. */
export interface AcpChild {
  readonly stdout: ReadableStream<Uint8Array>;
  readonly stderr?: ReadableStream<Uint8Array>;
  write(data: string): void;
  kill(): void;
  readonly exited: Promise<number>;
}

/** Where a new child's pipes and working directory come from. */
export interface AcpSpawnOptions {
  cwd: string;
  env?: Record<string, string>;
}

export type AcpSpawner = (
  command: string,
  args: readonly string[],
  options: AcpSpawnOptions,
) => AcpChild;

/**
 * The default spawner: the Bun runtime this app and its tests run under.
 * Looked up through \`globalThis\` so this module type-checks in the window's
 * browser build too; a build without Bun refuses with one sentence instead of
 * pretending to spawn.
 */
export const bunSpawn: AcpSpawner = (command, args, options) => {
  const runtime = (globalThis as unknown as { Bun?: BunSpawnRuntime }).Bun;
  if (runtime === undefined) {
    throw new Error("this build has no process spawner");
  }
  const proc = runtime.spawn({
    cmd: [command, ...args],
    cwd: options.cwd,
    env: options.env,
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  return {
    stdout: proc.stdout,
    stderr: proc.stderr,
    write: (data: string) => {
      proc.stdin?.write(data);
    },
    kill: () => {
      proc.kill();
    },
    exited: proc.exited,
  };
};

interface BunSpawnRuntime {
  spawn(options: {
    cmd: string[];
    cwd?: string;
    env?: Record<string, string>;
    stdin: "pipe";
    stdout: "pipe";
    stderr: "pipe";
  }): {
    stdin: { write(data: string | Uint8Array): unknown } | null;
    stdout: ReadableStream<Uint8Array>;
    stderr: ReadableStream<Uint8Array>;
    exited: Promise<number>;
    kill(): void;
  };
}

/* ------------------------------------------------------------------ *
 * The transport.
 * ------------------------------------------------------------------ */

/** A request id plus what the server asked; enough to answer it. */
export interface AcpServerRequest {
  id: number;
  method: string;
  params?: unknown;
}

/** One sentence for a failure the caller must see, never a stack trace. */
export class AcpFailure extends Error {
  readonly sentence: string;

  constructor(sentence: string) {
    super(sentence);
    this.name = "AcpFailure";
    this.sentence = sentence;
  }
}

/** Collapse a sentence onto one quiet line (no stack traces, no blank runs). */
export function acpSentence(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

export interface AcpTransportConfig {
  /** The executable to spawn; a full path is the caller's business. */
  command: string;
  args?: readonly string[];
  /** The session's working directory; ACP requires an absolute path. */
  cwd: string;
  env?: Record<string, string>;
  /** ACP's newline framing unless a probe says otherwise. */
  framing?: AcpFraming;
  /** Injected so tests can stand a fake child in front of the same rules. */
  spawn?: AcpSpawner;
  /** How long one request may wait for its answer. */
  requestTimeoutMs?: number;
  /** \`session/update\` and every other notification, in arrival order. */
  onNotification?: (notification: AcpNotificationMessage) => void;
  /** A server-to-client request (in practice a permission prompt). */
  onRequest?: (request: AcpServerRequest) => void;
  /** One sentence about a line that could not be read or framed. */
  onProblem?: (sentence: string) => void;
  /** The child's stderr, line by line: diagnostics, never protocol. */
  onStderr?: (line: string) => void;
  /** The child ended on its own. Not called for a caller's \`close\`. */
  onExit?: (code: number) => void;
  /** Every payload, in both directions, exactly as it crossed the pipe. */
  onWire?: (direction: "in" | "out", payload: string) => void;
}

/** What starting produced: a live transport, or one sentence why not. */
export type AcpStart =
  | { kind: "running"; transport: AcpTransport }
  | { kind: "refused"; sentence: string };

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (failure: AcpFailure) => void;
  timer: ReturnType<typeof setTimeout>;
  method: string;
}

/**
 * Start ONE ACP server. A spawn failure is a refused sentence, not a throw, so
 * a caller can report it without a try/catch around construction.
 */
export function startAcp(config: AcpTransportConfig): AcpStart {
  const spawner = config.spawn ?? bunSpawn;
  let child: AcpChild;
  try {
    child = spawner(config.command, config.args ?? [], {
      cwd: config.cwd,
      env: config.env,
    });
  } catch {
    return { kind: "refused", sentence: "the ACP server could not be started" };
  }
  return { kind: "running", transport: new AcpTransport(config, child) };
}

/** A live conversation with one child. One instance, one session at a time is the caller's choice. */
export class AcpTransport {
  private readonly framing: AcpFraming;
  private readonly reader: AcpFrameReader;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private closed = false;
  private exitCode: number | null = null;
  private stderrTail = "";

  constructor(
    private readonly config: AcpTransportConfig,
    private readonly child: AcpChild,
  ) {
    this.framing = config.framing ?? "ndjson";
    this.reader = new AcpFrameReader(this.framing);
    this.requestTimeoutMs = config.requestTimeoutMs ?? 30_000;
    void this.pump(child.stdout);
    if (child.stderr !== undefined) void this.pumpStderr(child.stderr);
    void this.watchExit();
  }

  /** The child's exit code, once it has exited; null while it is alive. */
  get exited(): number | null {
    return this.exitCode;
  }

  /** Has \`close\` run or the child gone away? */
  get closedForBusiness(): boolean {
    return this.closed;
  }

  /**
   * The handshake. The result is returned exactly as the server shaped it
   * (protocol version, capabilities, auth methods, agent info); this method
   * enforces only that a version number came back.
   */
  async initialize(clientName = "attentioneer-spike", clientVersion = "0.0.0"): Promise<AcpInitializeResult> {
    const result = await this.request(ACP_METHODS.initialize, {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: { name: clientName, version: clientVersion },
    });
    return readInitializeResult(result);
  }

  /** Create one session in an absolute working directory. */
  async newSession(cwd: string, mcpServers: readonly unknown[] = []): Promise<AcpSessionNewResult> {
    const result = await this.request(ACP_METHODS.sessionNew, { cwd, mcpServers });
    return readSessionResult(result);
  }

  /**
   * STORY 21.1 — CONTINUE ONE SESSION THE SERVER ALREADY RECORDED (PROVISIONAL).
   * The pair is the caller's: the server's own session id and the EXACT folder
   * it was recorded in (a server refuses any other directory). After this, the
   * prompt and the update stream are the same two calls a new session uses, so
   * nothing downstream can tell the two apart except the id they already had.
   * `initialize` is still the first word spoken: the server advertises
   * `session/resume` in that answer, and the row's capability is what decides
   * whether this is ever called.
   */
  async resumeSession(
    sessionId: string,
    cwd: string,
    mcpServers: readonly unknown[] = [],
  ): Promise<AcpSessionNewResult> {
    const result = await this.request(ACP_METHODS.sessionResume, {
      sessionId,
      cwd,
      mcpServers,
    });
    return readResumeResult(result, sessionId);
  }

  /**
   * Send ONE prompt and wait for the turn to settle. Streamed chunks arrive
   * through \`onNotification\` while this promise is pending; the answer is the
   * server's stop reason.
   */
  async prompt(sessionId: string, text: string): Promise<AcpPromptResult> {
    const result = await this.request(ACP_METHODS.sessionPrompt, {
      sessionId,
      prompt: [{ type: "text", text }],
    });
    return readPromptResult(result);
  }

  /**
   * Answer a permission request with the caller's decision. \`null\` says the
   * prompt was cancelled before a decision; an option id says the person (or
   * the caller's policy) picked that option.
   */
  async respondToPermission(requestId: number, optionId: string | null): Promise<void> {
    const outcome =
      optionId === null
        ? { outcome: "cancelled" }
        : { outcome: "selected", optionId };
    this.respond(requestId, outcome);
  }

  /** Cancel the session's in-flight prompt; the prompt answers \`cancelled\`. */
  cancel(sessionId: string): void {
    this.notify(ACP_METHODS.sessionCancel, { sessionId });
  }

  /**
   * Kill the child and answer every pending request with one sentence. Safe to
   * call twice; a close is not a failure and does not call \`onExit\`.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.failPending("the transport closed");
    try {
      this.child.kill();
    } catch {
      // Already gone: nothing left to kill.
    }
    await Promise.race([
      this.child.exited.catch(() => 0),
      new Promise<void>((resolve) => {
        setTimeout(resolve, 2_000);
      }),
    ]);
  }

  /* -------------------------------------------------------------- */

  private request(method: string, params: unknown): Promise<unknown> {
    if (this.closed) return Promise.reject(new AcpFailure("the transport is closed"));
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new AcpFailure("the server did not answer " + method + " in time"));
      }, this.requestTimeoutMs);
      this.pending.set(id, { resolve, reject, timer, method });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private respond(id: number, result: unknown): void {
    if (this.closed) return;
    this.send({ jsonrpc: "2.0", id, result });
  }

  private notify(method: string, params: unknown): void {
    if (this.closed) return;
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(message: Record<string, unknown>): void {
    const payload = JSON.stringify(message);
    this.config.onWire?.("out", payload);
    try {
      this.child.write(encodeAcpFrame(this.framing, payload));
    } catch {
      this.failPending("the server could not be written to");
      this.closed = true;
    }
  }

  private failPending(sentence: string): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new AcpFailure(sentence));
    }
    this.pending.clear();
  }

  private problem(sentence: string): void {
    if (this.closed) return;
    this.config.onProblem?.(sentence);
  }

  private handleFrame(raw: string): void {
    this.config.onWire?.("in", raw);
    const message = parseAcpMessage(raw);
    if (message === null) {
      this.problem("the server wrote a line that is not JSON-RPC");
      return;
    }
    if ("method" in message) {
      if ("id" in message) {
        this.serverRequest(message);
        return;
      }
      try {
        this.config.onNotification?.(message);
      } catch {
        this.problem("a notification handler failed");
      }
      return;
    }
    const pending = this.pending.get(message.id);
    if (pending === undefined) {
      this.problem("an answer named a request this transport did not send");
      return;
    }
    this.pending.delete(message.id);
    clearTimeout(pending.timer);
    if (message.error !== undefined) {
      pending.reject(
        new AcpFailure(
          acpSentence("the server refused " + pending.method + ": " + message.error.message),
        ),
      );
      return;
    }
    pending.resolve(message.result);
  }

  private serverRequest(message: AcpRequestMessage): void {
    if (this.config.onRequest === undefined) {
      this.problem("the server asked something this transport has no answer for");
      this.send({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32601, message: "no handler" },
      });
      return;
    }
    try {
      this.config.onRequest({ id: message.id, method: message.method, params: message.params });
    } catch {
      this.problem("a request handler failed");
    }
  }

  private onChunk(chunk: Uint8Array): void {
    const batch = this.reader.push(chunk);
    for (const sentence of batch.problems) this.problem(sentence);
    for (const raw of batch.frames) this.handleFrame(raw);
  }

  private async pump(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    try {
      for (;;) {
        const read = await reader.read();
        if (read.done) break;
        if (read.value !== undefined) this.onChunk(read.value);
      }
      const tail = this.reader.flush();
      for (const sentence of tail.problems) this.problem(sentence);
      for (const raw of tail.frames) this.handleFrame(raw);
    } catch {
      this.problem("the server's output broke off");
    }
  }

  private async pumpStderr(stream: ReadableStream<Uint8Array>): Promise<void> {
    const reader = stream.getReader();
    try {
      for (;;) {
        const read = await reader.read();
        if (read.done) break;
        if (read.value === undefined) continue;
        this.stderrTail += decoder.decode(read.value, { stream: true });
        let newline = this.stderrTail.indexOf("\n");
        while (newline >= 0) {
          const line = this.stderrTail.slice(0, newline).replace(/\r$/, "");
          this.stderrTail = this.stderrTail.slice(newline + 1);
          if (line.trim() !== "") this.config.onStderr?.(line);
          newline = this.stderrTail.indexOf("\n");
        }
      }
      const tail = this.stderrTail.replace(/\r$/, "");
      if (tail.trim() !== "") this.config.onStderr?.(tail);
    } catch {
      // A broken stderr is diagnostics, not the conversation.
    }
  }

  private async watchExit(): Promise<void> {
    let code = 0;
    try {
      code = await this.child.exited;
    } catch {
      code = -1;
    }
    this.exitCode = code;
    if (this.closed) return;
    this.closed = true;
    this.failPending("the server exited (code " + code + ")");
    this.config.onExit?.(code);
  }
}

/* ------------------------------------------------------------------ *
 * Strict readers for the three answers the typed helpers promise.
 * ------------------------------------------------------------------ */

export interface AcpInitializeResult {
  protocolVersion: number;
  agentInfo?: { name?: string; version?: string } | null;
  agentCapabilities?: unknown;
  authMethods?: unknown[];
}

export interface AcpSessionNewResult {
  sessionId: string;
  configOptions?: unknown[] | null;
}

export interface AcpPromptResult {
  stopReason: string;
  usage?: unknown;
}

function readInitializeResult(value: unknown): AcpInitializeResult {
  if (!isRecord(value)) {
    throw new AcpFailure("the server's initialize answer was not an object");
  }
  if (typeof value.protocolVersion !== "number" || !Number.isInteger(value.protocolVersion)) {
    throw new AcpFailure("the server's initialize answer named no protocol version");
  }
  const result: AcpInitializeResult = { protocolVersion: value.protocolVersion };
  if (isRecord(value.agentInfo)) {
    result.agentInfo = {
      name: typeof value.agentInfo.name === "string" ? value.agentInfo.name : undefined,
      version: typeof value.agentInfo.version === "string" ? value.agentInfo.version : undefined,
    };
  } else if (value.agentInfo !== undefined) {
    result.agentInfo = null;
  }
  if (value.agentCapabilities !== undefined) result.agentCapabilities = value.agentCapabilities;
  if (Array.isArray(value.authMethods)) result.authMethods = value.authMethods;
  return result;
}

function readSessionResult(value: unknown): AcpSessionNewResult {
  if (!isRecord(value) || typeof value.sessionId !== "string" || value.sessionId === "") {
    throw new AcpFailure("the server's session/new answer named no session");
  }
  const result: AcpSessionNewResult = { sessionId: value.sessionId };
  if (Array.isArray(value.configOptions)) result.configOptions = value.configOptions;
  else if (value.configOptions !== undefined) result.configOptions = null;
  return result;
}

/**
 * STORY 21.1 — READ THE ANSWER TO A CONTINUATION WITHOUT INVENTING AN ID
 * (PROVISIONAL). The server either echoes the session the caller named (a bare
 * id, or a session object carrying it) or this fails with one sentence: there is
 * no fallback to the caller's id, because a server that did not name the session
 * has not said it continued it. A server that names a DIFFERENT session is
 * refused too — that would be a different conversation, not this one's memory.
 */
function readResumeResult(
  value: unknown,
  sessionId: string,
): AcpSessionNewResult {
  if (!isRecord(value)) {
    throw new AcpFailure("the server's session/resume answer was not an object");
  }
  const named = resumeSessionIdOf(value);
  if (named === null) {
    throw new AcpFailure("the server's session/resume answer named no session");
  }
  if (named !== sessionId) {
    throw new AcpFailure(
      "the server's session/resume answer named another session",
    );
  }
  const result: AcpSessionNewResult = { sessionId: named };
  if (Array.isArray(value.configOptions)) result.configOptions = value.configOptions;
  else if (value.configOptions !== undefined) result.configOptions = null;
  return result;
}

/** The session a resume answer named, or null when it named none. */
function resumeSessionIdOf(value: Record<string, unknown>): string | null {
  if (typeof value.sessionId === "string" && value.sessionId !== "") {
    return value.sessionId;
  }
  const session = value.session;
  if (!isRecord(session)) return null;
  if (typeof session.sessionId === "string" && session.sessionId !== "") {
    return session.sessionId;
  }
  if (typeof session.id === "string" && session.id !== "") return session.id;
  return null;
}

function readPromptResult(value: unknown): AcpPromptResult {
  if (!isRecord(value) || typeof value.stopReason !== "string" || value.stopReason === "") {
    throw new AcpFailure("the server's prompt answer named no stop reason");
  }
  const result: AcpPromptResult = { stopReason: value.stopReason };
  if (value.usage !== undefined) result.usage = value.usage;
  return result;
}
