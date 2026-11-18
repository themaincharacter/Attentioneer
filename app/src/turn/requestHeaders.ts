/**
 * A ROW'S REQUEST HEADERS, AS DATA (Epic 15 story 17; PROVISIONAL).
 *
 * WHY THIS EXISTS: one gateway refuses a chat request that names no session,
 * and we answered it with a GENERIC `x-session-id` — a compatibility that
 * happens to work today but is not the name that provider documents. Hard-coding
 * a documented name in the lane would make one vendor's knob part of the turn
 * path (the story 18.6 rule: the lane never names a product). So a row may
 * carry a HEADER MAP as data, the catalogue ships the documented header, and
 * this module is the one place that decides what a header may look like.
 *
 * WHAT MAY NOT BE A ROW'S HEADER: `authorization`, `content-type`, `host`
 * and `content-length` are the turn's own facts. Letting a row set them would
 * silently swap the key, lie about the body, or point the request at another
 * host — so they are refused when a row is WRITTEN and refused again when the
 * headers reach the WIRE (defence in depth: a hand-edited config, or a future
 * caller that skips validation, still cannot override them).
 *
 * A value that carries a newline is refused for the same reason a URL parser
 * refuses a space in a host: a header value that breaks the line could inject
 * a second header. Names and values are bounded so one row cannot turn a
 * request line into a memory problem.
 *
 * THE SESSION PLACEHOLDER (PROVISIONAL): a catalogue header may write
 * `{session-id}` as its value. The sidecar replaces it with the SAME stable
 * session id the generic header carries, so the documented header and the
 * generic one name one conversation, and the id stays stable across turns.
 * The placeholder is generic lane vocabulary, never a vendor's.
 *
 * PROVISIONAL: the limits, the sentence wording, the placeholder spelling.
 */

/** The header names a row may never set: the turn owns every one of them. */
export const RESERVED_REQUEST_HEADERS = [
  "authorization",
  "content-type",
  "host",
  "content-length",
] as const;

/** The value a catalogue header writes to mean "the turn's session id". */
export const SESSION_HEADER_PLACEHOLDER = "{session-id}";

/**
 * The bounds (PROVISIONAL). They are ordinary HTTP-shape limits, not a
 * judgement about any provider: thirty-two headers is more than a row needs,
 * and one value of two kilobytes is already a long one.
 */
export const HEADER_LIMITS = {
  /** How many headers one provider row may carry. */
  count: 32,
  /** A name's longest allowed length in characters. */
  name: 128,
  /** A value's longest allowed length in characters. */
  value: 2048,
} as const;

/** The sentences a header refusal is said in (PROVISIONAL wording). */
export const HEADER_SENTENCES = {
  /** A line in the panel that is not `name: value`. */
  line: "write each request header on its own line as name: value",
  /** The reserved set, said once; the offending name is not echoed here. */
  reserved:
    "a request header may not be named authorization, content-type, host or content-length",
  noName: "a request header needs a name",
  badName:
    "a request header's name may contain only letters, digits and common symbols",
  nameTooLong: "a request header's name is too long",
  valueTooLong: "a request header's value is too long",
  newline: "a request header's value must stay on one line",
  duplicate: "a provider may not name the same request header twice",
  tooMany: "a provider may carry at most " + HEADER_LIMITS.count + " request headers",
} as const;

/** A refused header map, or the map as the row carries it. */
export type HeaderRead =
  | { kind: "headers"; headers: Record<string, string> }
  | { kind: "refused"; sentence: string };

/** Is this name one the turn owns, whatever case or spacing it arrived in? */
export function isReservedHeaderName(name: string): boolean {
  const lowered = name.trim().toLowerCase();
  return (RESERVED_REQUEST_HEADERS as readonly string[]).includes(lowered);
}

/** A header name is a single HTTP token: letters, digits and common symbols. */
function nameShape(name: string): boolean {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name);
}

/**
 * ONE header's problem, or null when it may be sent. The VALUE is never put in
 * a sentence: a value may be the person's credential-shaped string, and a
 * refusal is shown on screen.
 */
export function headerProblem(name: string, value: string): string | null {
  if (name.trim() === "") return HEADER_SENTENCES.noName;
  if (name.trim().length > HEADER_LIMITS.name) {
    return HEADER_SENTENCES.nameTooLong;
  }
  if (!nameShape(name.trim())) return HEADER_SENTENCES.badName;
  if (isReservedHeaderName(name)) return HEADER_SENTENCES.reserved;
  if (value.length > HEADER_LIMITS.value) return HEADER_SENTENCES.valueTooLong;
  if (/[\r\n\0]/.test(value)) return HEADER_SENTENCES.newline;
  return null;
}

/**
 * A whole map's problem, or null. Checked at the WRITE (a row cannot be stored
 * with a header the wire would refuse) and again at the WIRE.
 */
export function headerMapProblem(
  headers: Readonly<Record<string, string>>,
): string | null {
  const names = Object.keys(headers);
  if (names.length > HEADER_LIMITS.count) return HEADER_SENTENCES.tooMany;
  const seen = new Set<string>();
  for (const name of names) {
    const problem = headerProblem(name, headers[name] ?? "");
    if (problem !== null) return problem;
    const lowered = name.trim().toLowerCase();
    if (seen.has(lowered)) return HEADER_SENTENCES.duplicate;
    seen.add(lowered);
  }
  return null;
}

/**
 * Read a stored header map TOLERANTLY, as a config written by an older story
 * or edited by hand must open. Only string-to-string entries of a sane shape
 * survive; a broken entry is dropped (the write is what refuses, never the
 * read). Reserved names SURVIVE here on purpose: the wire refuses them with a
 * sentence, so a hand-edited config is told, not silently stripped.
 */
export function readRequestHeaders(value: unknown): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return headers;
  }
  let count = 0;
  for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
    if (count >= HEADER_LIMITS.count) break;
    if (typeof raw !== "string") continue;
    const trimmedName = name.trim();
    if (trimmedName === "" || trimmedName.length > HEADER_LIMITS.name) continue;
    if (!nameShape(trimmedName)) continue;
    if (raw.length > HEADER_LIMITS.value) continue;
    if (/[\r\n\0]/.test(raw)) continue;
    headers[trimmedName] = raw;
    count += 1;
  }
  return headers;
}

/**
 * The panel's text for a map: one `name: value` line each, in the map's order.
 * Plain text on purpose — a header value is stored, and shown, as written.
 */
export function headersText(
  headers: Readonly<Record<string, string>>,
): string {
  return Object.entries(headers)
    .map(([name, value]) => name + ": " + value)
    .join("\n");
}

/**
 * The map a person's typed lines describe, or the one sentence a malformed
 * line is refused with. A value may contain a colon; the FIRST colon splits.
 */
export function headersFromText(text: string): HeaderRead {
  const headers: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    const at = trimmed.indexOf(":");
    if (at <= 0) return { kind: "refused", sentence: HEADER_SENTENCES.line };
    const name = trimmed.slice(0, at).trim();
    const value = trimmed.slice(at + 1).trim();
    const problem = headerProblem(name, value);
    if (problem !== null) return { kind: "refused", sentence: problem };
    headers[name] = value;
  }
  const problem = headerMapProblem(headers);
  if (problem !== null) return { kind: "refused", sentence: problem };
  return { kind: "headers", headers };
}

/**
 * ONE request's header set: the app's own headers first, the row's AFTER them.
 * The row can never win a reserved name because it is refused here, and the
 * placeholder is replaced with the session id the generic header carries. The
 * refusal is ONE sentence (the name only, never the value), so the sidecar can
 * say it and send nothing rather than silently drop a header.
 */
export function headersForRequest(
  appHeaders: Readonly<Record<string, string>>,
  rowHeaders: Readonly<Record<string, string>> | undefined,
  sessionId: string,
): HeaderRead {
  const built: Record<string, string> = {};
  for (const [name, value] of Object.entries(appHeaders)) {
    built[name] = value;
  }
  if (rowHeaders === undefined) return { kind: "headers", headers: built };
  const problem = headerMapProblem(rowHeaders);
  if (problem !== null) return { kind: "refused", sentence: problem };
  for (const [name, value] of Object.entries(rowHeaders)) {
    const lowered = name.trim().toLowerCase();
    if (lowered in built) {
      // Defence in depth: the only names the app itself sets are reserved, so
      // this branch is the reserved rule with the app's header in hand. The
      // sentence names the header, never its value.
      return { kind: "refused", sentence: HEADER_SENTENCES.reserved };
    }
    built[name] = value.split(SESSION_HEADER_PLACEHOLDER).join(sessionId);
  }
  return { kind: "headers", headers: built };
}
