import { isLoopbackHost } from "./providers";

/**
 * THE PAGE'S READ (story 16.14) — the dependency-free half of "a web page is a
 * reference": the guards on an address, and the small reducer that turns one
 * HTML body into a title, readable text and a candidate thumbnail. The fetch
 * itself lives in `sidecar/main.ts`, the only process with network.
 *
 * NO PARSER PACKAGE, BY THE STORY'S RULE. This is deliberately a reducer, not
 * a browser: scripts, styles and markup are stripped, block boundaries become
 * newlines, entities common in prose are decoded, and runs of whitespace are
 * collapsed. It cannot and does not try to render a page or recover its
 * structure. If that leaves no words, the caller refuses with one sentence
 * rather than creating an empty reading.
 *
 * THE ADDRESS RULE is the provider rows' rule, reused: `https` anywhere,
 * `http` only for this machine's loopback (`127.0.0.1`, `[::1]`,
 * `localhost`). A page reached over plain http from a remote host would put
 * the whole read in clear text, so it is refused, never silently upgraded.
 * EVERY redirect hop is re-checked against the same rule.
 *
 * THE CAPS ARE STATED AND PROVISIONAL: a body cap (the HTML we are willing to
 * read), a text cap (what the reading may keep), a thumbnail cap, a timeout
 * and a bounded number of redirects. The reading's own 64-line / 8 KiB crop is
 * `readings.ts`'s provisional cap, applied after this one.
 *
 * The snapshot is the extracted TEXT and a local thumbnail — NOT a rendered
 * screenshot. A visual snapshot needs a headless browser and is out of scope.
 */

/** How long one page (or one thumbnail) has to answer. PROVISIONAL. */
export const PAGE_TIMEOUT_MS = 15_000;

/** The largest HTML body this app will read. PROVISIONAL. */
export const PAGE_MAX_BODY_BYTES = 2 * 1024 * 1024;

/** The largest extracted text the sidecar will carry back. PROVISIONAL. */
export const PAGE_MAX_TEXT_BYTES = 32 * 1024;

/** The largest thumbnail this app will keep. PROVISIONAL. */
export const PAGE_MAX_THUMB_BYTES = 512 * 1024;

/** How many redirects one fetch follows before it refuses. PROVISIONAL. */
export const PAGE_MAX_REDIRECTS = 5;

/** The one quiet sentence per page refusal (PROVISIONAL wording). */
export const PAGE_SENTENCES = {
  badUrl: "that is not a web address.",
  insecure:
    "a web page must be https; plain http is only for a page on this machine.",
  unreachable: "that page could not be reached.",
  notFound: "that page is not there.",
  notPage: "that link is not a web page; add it as the file or image it is instead.",
  tooLarge: "that page is too large to read.",
  tooManyRedirects: "that link redirects too many times.",
  noText: "that page has no text to read.",
  brokeOff: "that page's answer broke off.",
  thumbNotImage: "that image could not be taken.",
} as const;

/** The one address rule: https anywhere, http only on this machine. PURE. */
export function pageUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return PAGE_SENTENCES.badUrl;
  }
  if (url.protocol === "https:") return null;
  if (url.protocol !== "http:") return PAGE_SENTENCES.badUrl;
  return isLoopbackHost(url.hostname) ? null : PAGE_SENTENCES.insecure;
}

/** Is this content-type a page the reducer may read? PURE. */
export function isPageContentType(value: string | null): boolean {
  if (value === null) return false;
  const type = value.split(";")[0].trim().toLowerCase();
  return (
    type === "text/html" ||
    type === "application/xhtml+xml" ||
    type === "text/plain"
  );
}

/** The RASTER types the local wrapper may embed (no SVG: it could fetch). */
const RASTER_IMAGE_TYPES: ReadonlySet<string> = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/avif",
]);

/** Is this content-type an image a thumbnail may keep? PURE. */
export function isImageContentType(value: string | null): boolean {
  return imageMime(value) !== null;
}

/**
 * The image's MIME for the local wrapper, or null. Raster only, deliberately:
 * an SVG thumbnail could reference the network from inside the copied file,
 * which would make the card's offline render a lie.
 */
export function imageMime(value: string | null): string | null {
  if (value === null) return null;
  const type = value.split(";")[0].trim().toLowerCase();
  return RASTER_IMAGE_TYPES.has(type) ? type : null;
}

/** Decode the handful of entities prose actually carries. PURE. */
export function decodeEntities(text: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
    ndash: "\u2013",
    mdash: "\u2014",
    hellip: "\u2026",
    rsquo: "\u2019",
    lsquo: "\u2018",
    rdquo: "\u201d",
    ldquo: "\u201c",
  };
  return text.replace(
    /&(#[0-9]+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      if (body.startsWith("#")) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole;
      }
      return named[body] ?? whole;
    },
  );
}

/** The visible text of one HTML body, reduced to readable lines. PURE. */
export function readableText(html: string): string {
  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    // The head is metadata, not reading: the TITLE is read separately, and a
    // page whose only words are its title has no text to read.
    .replace(/<head\b[\s\S]*?<\/head\s*>/gi, " ")
    .replace(/<title\b[\s\S]*?<\/title\s*>/gi, " ")
    .replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<(script|style|noscript|template|svg)\b[^>]*\/?>/gi, " ");
  // Block boundaries are the page's own paragraphing; make them newlines so
  // the reading keeps a shape rather than one long ribbon.
  body = body.replace(
    /<\/?(p|div|section|article|header|footer|main|aside|nav|li|ul|ol|tr|table|blockquote|pre|h[1-6]|br|hr)\b[^>]*>/gi,
    "\n",
  );
  body = body.replace(/<[^>]*>/g, " ");
  body = decodeEntities(body);
  return body
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The document's title, decoded and reduced to one line. PURE. */
export function pageTitle(html: string): string {
  const match = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(html);
  if (match === null) return "";
  return decodeEntities(match[1].replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

/** One tag's attributes, lower-cased names, when the tag carries a value. */
function attributesOf(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const pattern =
    /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(tag)) !== null) {
    attrs[match[1].toLowerCase()] = decodeEntities(
      match[2] ?? match[3] ?? match[4] ?? "",
    );
  }
  return attrs;
}

/**
 * The best thumbnail address the page declares: Open Graph, then Twitter's
 * card, then the older `image_src` link. Resolved against the page's FINAL
 * address; only an absolute http(s) answer is offered. PURE. A page that
 * declares none simply has no image.
 */
export function thumbnailUrl(html: string, baseUrl: string): string | null {
  const candidates: string[] = [];
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const attrs = attributesOf(tag);
    const key = (attrs.property ?? attrs.name ?? "").toLowerCase();
    if (key === "og:image" || key === "twitter:image") {
      if (attrs.content !== undefined) candidates.push(attrs.content);
    }
  }
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    const attrs = attributesOf(tag);
    if ((attrs.rel ?? "").toLowerCase() === "image_src" && attrs.href !== undefined) {
      candidates.push(attrs.href);
    }
  }
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (trimmed === "") continue;
    try {
      const resolved = new URL(trimmed, baseUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        return resolved.href;
      }
    } catch {
      // A broken candidate is simply not the thumbnail.
    }
  }
  return null;
}

/** Cut a string to a UTF-8 byte budget on a character boundary. PURE. */
export function capTextBytes(
  text: string,
  maxBytes: number = PAGE_MAX_TEXT_BYTES,
): string {
  const bytes = new TextEncoder().encode(text);
  if (bytes.byteLength <= maxBytes) return text;
  let end = maxBytes;
  // Walk back off a continuation byte so the decoder never sees half a char.
  while (end > 0 && (bytes[end] & 0xc0) === 0x80) end -= 1;
  return new TextDecoder().decode(bytes.subarray(0, end));
}

/** What one page's body offered: its title, its text and its image, if any. */
export interface ExtractedPage {
  title: string;
  text: string;
  thumbUrl: string | null;
}

/**
 * Reduce one page. `null` means NO READABLE TEXT — the one refusal the caller
 * answers with a sentence and creates nothing for. PURE, so the reducer is not
 * the sidecar's only truth.
 */
export function extractPage(
  html: string,
  finalUrl: string,
): ExtractedPage | null {
  const text = capTextBytes(readableText(html));
  if (text === "") return null;
  return {
    title: pageTitle(html),
    text,
    thumbUrl: thumbnailUrl(html, finalUrl),
  };
}
