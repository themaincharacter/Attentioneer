import { PAGE_MAX_REDIRECTS, PAGE_TIMEOUT_MS } from "./pageExtract";
import { isLoopbackHost } from "./providers";

/**
 * THE VIDEO'S LOOK (story 16.15) — the dependency-free half of "a video is a
 * reference": which hosts this app can ask, the small guards, and the reducer
 * that turns one oEmbed answer into a title and a thumbnail address. The fetch
 * itself lives in `sidecar/main.ts`, the only process with network.
 *
 * WHAT AN OEMBED READ IS, AND IS NOT: the video's own site answers with a
 * small JSON document carrying its title and a thumbnail — the metadata a site
 * offers for EMBEDDING it. It is not the video, its transcript or its frames:
 * this story fetches the look, copies the thumbnail beside the map, and says
 * plainly that the transcript needs a model that can read video.
 *
 * THE HOSTS: YouTube and Vimeo, by hostname. A URL from any other host is
 * refused with ONE sentence that suggests adding it as a web page instead —
 * this app will not guess an oEmbed endpoint for a site it does not know.
 *
 * THE ADDRESS RULE is the page's, reused in shape but said in a video's words:
 * `https` anywhere, `http` only on this machine's loopback. The thumbnail
 * address the answer names is checked against the same rule.
 *
 * THE CAPS ARE STATED AND PROVISIONAL: a timeout, a response-body cap and a
 * bounded number of redirects (the page's own). An oEmbed answer is small; the
 * thumbnail goes through the same `thumb` wire a page's does.
 *
 * PROVISIONAL: the two providers, the endpoint shapes, the sentences and the
 * caps.
 */

/** The video hosts this app knows how to ask. */
export type VideoProvider = "youtube" | "vimeo";

/** How long one oEmbed answer has to arrive. The page's budget. PROVISIONAL. */
export const VIDEO_TIMEOUT_MS = PAGE_TIMEOUT_MS;

/** The largest oEmbed answer this app will read. PROVISIONAL. */
export const VIDEO_MAX_BYTES = 256 * 1024;

/** How many redirects one oEmbed fetch follows. The page's bound. */
export const VIDEO_MAX_REDIRECTS = PAGE_MAX_REDIRECTS;

/**
 * THE STORY'S PROOF SEAM (PROVISIONAL): when this variable is set, the sidecar
 * sends every oEmbed request to `<base>/<provider>` instead of the real site.
 * The APP never sets it. The story's own test sets it to a local stub so the
 * oEmbed path is exercised end to end with no external network — a proof about
 * this app's behaviour, not a setting a person is expected to use.
 */
export const OEMBED_BASE_ENV = "ATTIONEER_OEMBED_BASE";

/** The one quiet sentence per video refusal (PROVISIONAL wording). */
export const VIDEO_SENTENCES = {
  badUrl: "that is not a web address.",
  insecure:
    "a video must be https; plain http is only for a video on this machine.",
  unsupported:
    "this app knows YouTube and Vimeo videos only; add it as a web page instead.",
  unreachable: "that video could not be reached.",
  notFound: "that video is not there.",
  notOembed: "that host did not answer with a video's title and picture.",
  tooLarge: "that video's answer is too large to read.",
  brokeOff: "that video's answer broke off.",
} as const;

/** Is this hostname one of YouTube's own spellings? PURE. */
function isYoutubeHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "youtube.com" ||
    host.endsWith(".youtube.com") ||
    host === "youtu.be" ||
    host.endsWith(".youtu.be")
  );
}

/** Is this hostname one of Vimeo's own spellings? PURE. */
function isVimeoHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "vimeo.com" || host.endsWith(".vimeo.com");
}

/**
 * Which provider this address belongs to, or null when it is a host this app
 * does not know. PURE: no request is made and no endpoint is guessed.
 */
export function videoProviderFor(value: string): VideoProvider | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (isYoutubeHost(url.hostname)) return "youtube";
  if (isVimeoHost(url.hostname)) return "vimeo";
  return null;
}

/**
 * THE VIDEO'S ADDRESS RULE: https anywhere, http only on this machine — the
 * page's rule, said for a video. PURE.
 */
export function videoUrlProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return VIDEO_SENTENCES.badUrl;
  }
  if (url.protocol === "https:") return null;
  if (url.protocol !== "http:") return VIDEO_SENTENCES.badUrl;
  // The provider rows' loopback rule, reused: one definition of "this machine".
  return isLoopbackHost(url.hostname) ? null : VIDEO_SENTENCES.insecure;
}

/** The real oEmbed endpoint per provider. */
const OEMBED_ENDPOINTS: Readonly<Record<VideoProvider, string>> = {
  youtube: "https://www.youtube.com/oembed",
  vimeo: "https://vimeo.com/api/oembed.json",
};

/**
 * The one request address for a video: the provider's oEmbed endpoint with the
 * video's address and `format=json`. PURE. `base` is the story's proof seam
 * above; the app always passes null and the real endpoint is used.
 */
export function oembedEndpoint(
  provider: VideoProvider,
  videoUrl: string,
  base: string | null = null,
): string {
  const target =
    base === null || base.trim() === ""
      ? OEMBED_ENDPOINTS[provider]
      : base.replace(/\/+$/, "") + "/" + provider;
  const endpoint = new URL(target);
  endpoint.searchParams.set("url", videoUrl);
  endpoint.searchParams.set("format", "json");
  return endpoint.href;
}

/** What one oEmbed answer said: a title, and an image if it named one. */
export interface VideoLook {
  title: string;
  /** The thumbnail address, resolved and http(s)-only; null when none. */
  thumbUrl: string | null;
}

/**
 * Reduce one oEmbed JSON answer to its title and thumbnail, or answer null
 * when the answer is not one (bad JSON, no title). PURE. The thumbnail is
 * resolved against the answer's final address and only an http(s) one is
 * offered: a `data:` or `file:` address is not a picture this app will fetch.
 * The title is one line — whitespace collapsed, as the card shows it.
 */
export function parseOembed(
  text: string,
  finalUrl: string,
): VideoLook | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  const title =
    typeof source.title === "string"
      ? source.title.replace(/\s+/g, " ").trim()
      : "";
  if (title === "") return null;
  let thumbUrl: string | null = null;
  const raw = source.thumbnail_url;
  if (typeof raw === "string" && raw.trim() !== "") {
    try {
      const resolved = new URL(raw.trim(), finalUrl);
      if (resolved.protocol === "http:" || resolved.protocol === "https:") {
        thumbUrl = resolved.href;
      }
    } catch {
      // A broken address is simply no picture; the title still stands.
    }
  }
  return { title, thumbUrl };
}
