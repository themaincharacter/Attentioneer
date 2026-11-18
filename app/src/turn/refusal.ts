import { oneLine } from "./protocol.ts";

/**
 * A PROVIDER'S REFUSAL IS THE PROVIDER'S OWN SENTENCE (story 15.16).
 *
 * WHY THIS FILE EXISTS: a subscription gateway's 400 answered with the whole
 * answer in its body — a JSON error naming the session header the request
 * omitted — and the sidecar threw that body away and said "the provider
 * answered 400 Bad Request". An opaque
 * sentence sent a whole investigation looking at the catalogue and the model
 * id, while the missing header had been named all along. The body was never a
 * secret; we simply discarded it. So a non-2xx answer now keeps the provider's
 * own message, scrubbed and bounded, beside the status.
 *
 * THE RULES, in one place, because a refusal is a judgement and judgements
 * should be testable as values:
 *   - The STATUS always stays. 400, 429 and 500 are different facts, and the
 *     person's next move differs with them.
 *   - 401 AND 403 KEEP THE ACTIONABLE FACT: the key was refused. Quoting the
 *     provider's login page there would bury the one thing to fix.
 *   - THE MESSAGE IS ONE LINE, tagless and tagged as text only when it IS
 *     text. A body of bytes or an HTML error page is said to be not text,
 *     never quoted.
 *   - IT IS BOUNDED. Roughly 200 characters, then an ellipsis. A provider's
 *     paragraph is not this app's paragraph.
 *
 * THE SCRUB IS DELIBERATELY NOT HERE: the sidecar runs the EXISTING
 * `scrubSecret` over the candidate BEFORE it calls `refusalSentence`, so the
 * sentence is shaped only from a message the key was already removed from.
 * Keeping the scrub at the seam that owns the key means this module never
 * needs to be handed a secret at all.
 *
 * PROVISIONAL: the preference order, the byte cap, the character cap and the
 * exact sentence shape. The story settles none of them as permanent.
 */

/**
 * The most of a refusal's body this app will read. A refusal is a sentence,
 * not a payload: past this the read is cancelled, and the sentence is built
 * from the head it already has. PROVISIONAL.
 */
export const REFUSAL_MAX_BODY_BYTES = 64 * 1024;

/** How long the provider's sentence may get before the ellipsis. PROVISIONAL. */
export const REFUSAL_MAX_CHARS = 200;

/** What a body that is not a sentence is called, rather than quoted. */
export const REFUSAL_NOT_TEXT = "the body was not text";

/** What one bounded body read settled as, before any meaning is read into it. */
export type RefusalBody =
  | { kind: "text"; text: string }
  | { kind: "not-text" }
  | { kind: "empty" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Is this content-type — or this opening tag — an HTML answer? PURE. */
function looksLikeHtml(contentType: string | null, text: string): boolean {
  const type = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (type === "text/html" || type === "application/xhtml+xml") return true;
  return /^<(!doctype\b|html\b|head\b|body\b|\/?[a-z][\w:-]*[\s>])/i.test(text);
}

/**
 * Decide what a refusal's bytes ARE. Bytes that do not decode as UTF-8, or
 * that carry NUL/other non-whitespace control characters, are not text; an
 * HTML page is not text either, because tags are noise the person cannot act
 * on. An empty body is empty rather than an invented sentence.
 *
 * `truncated` says the cap cut the body: a trailing partial character is then
 * the cap's doing, not evidence of binary data.
 */
export function classifyRefusalBody(
  bytes: Uint8Array,
  contentType: string | null,
  truncated = false,
): RefusalBody {
  const text = new TextDecoder().decode(bytes);
  // A replacement character means the bytes were not UTF-8. When the cap cut
  // the read, only the very end may be half a character; anywhere else is
  // still evidence of bytes.
  const evidence = truncated ? text.slice(0, -1) : text;
  if (evidence.includes("\uFFFD")) return { kind: "not-text" };
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
    return { kind: "not-text" };
  }
  const trimmed = text.trim();
  if (trimmed === "") return { kind: "empty" };
  if (looksLikeHtml(contentType, trimmed)) return { kind: "not-text" };
  return { kind: "text", text };
}

/** Strip tag-shaped runs so an error page's markup never reaches the person. */
function stripTags(text: string): string {
  return text.replace(/<\/?[a-z][^>]*>/gi, " ");
}

/** One candidate message, made quiet: one line, no tags, no whitespace runs. */
function quiet(text: string): string {
  return oneLine(stripTags(text));
}

/** The first non-empty line of a body that is text, collapsed. PURE. */
function firstLine(text: string): string {
  for (const line of text.split(/\r?\n|\r/)) {
    const quietLine = quiet(line);
    if (quietLine !== "") return quietLine;
  }
  return "";
}

/**
 * The message inside a JSON refusal, in the story's preference order:
 * `error.message`, then `message`, then an `error` that is itself the
 * sentence. A JSON body with none of those is NOT quoted — dumping raw JSON
 * at the person is the failure this story exists to undo. PURE.
 */
function jsonMessage(value: unknown): string | null {
  if (!isRecord(value)) return null;
  const error = value.error;
  if (isRecord(error)) {
    const message = error.message;
    if (typeof message === "string" && message.trim() !== "") {
      return quiet(message);
    }
  }
  const message = value.message;
  if (typeof message === "string" && message.trim() !== "") {
    return quiet(message);
  }
  if (typeof error === "string" && error.trim() !== "") return quiet(error);
  return null;
}

/**
 * The provider's own message inside a text body, or null when there is no
 * sentence to show. PURE.
 *
 * JSON is tried first. A body that starts like JSON but does not parse (a
 * truncated object, a garbled answer) yields null rather than a raw fragment:
 * a half sentence is better than half a payload.
 */
export function refusalMessage(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  let parsed: unknown;
  let wasJson = false;
  try {
    parsed = JSON.parse(trimmed);
    wasJson = true;
  } catch {
    // Not JSON: the body may still be prose.
  }
  if (wasJson) return jsonMessage(parsed);
  if (/^[{\[]/.test(trimmed)) return null;
  const line = firstLine(trimmed);
  return line === "" ? null : line;
}

/**
 * Cut a sentence to the stated cap, ending with an ellipsis. The cut never
 * splits a surrogate pair, and never leaves whitespace before the mark. PURE.
 */
export function capRefusalSentence(
  sentence: string,
  maxChars: number = REFUSAL_MAX_CHARS,
): string {
  if (sentence.length <= maxChars) return sentence;
  let cut = sentence.slice(0, maxChars - 1);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1);
  return cut.replace(/\s+$/, "") + "\u2026";
}

/**
 * THE ONE SENTENCE a non-2xx answer becomes. PURE.
 *
 * `scrubbed` must ALREADY have the key removed: the sidecar scrubs the
 * candidate before calling here, so no sentence can ever contain it. The
 * status is always there; 401/403 say the key was refused rather than echoing
 * a provider's login page.
 */
export function refusalSentence(
  status: number,
  statusText: string,
  body: RefusalBody,
  scrubbed: string | null,
): string {
  const base = "the provider answered " + String(status);
  if (status === 401 || status === 403) {
    return base + ": the key was refused";
  }
  if (body.kind === "not-text") return base + ": " + REFUSAL_NOT_TEXT;
  if (scrubbed !== null && scrubbed.trim() !== "") {
    return capRefusalSentence(base + ": " + scrubbed);
  }
  // Nothing readable in the body: the old sentence is still true, and a
  // status is never withheld just because the provider said nothing.
  const reason = statusText.trim();
  return reason === "" ? base : base + " " + reason;
}
