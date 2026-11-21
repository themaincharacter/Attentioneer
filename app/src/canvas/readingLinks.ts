import { isWebUrl } from "../map/readings";
import { openPageOutward } from "./outward";

/**
 * STORY 22.7 — A LINK IN A READING IS SOMETHING TO OPEN.
 *
 * The person can read a web address on an expanded card and had no way to open
 * it: until now the reading rendered every byte as one text node, so an address
 * was prose. This module is the ONE rule that says which part of a stored
 * reading is a link, and the ONE click that hands it to the browser.
 *
 * The validator is the map's own record-shape check (`readings.ts`'s
 * `isWebUrl`), not a second pattern: an address is `http(s)` and nothing else,
 * because only that is a page. A `javascript:` or `file:` string stays plain
 * text — the app never grows a prompt for it — and the opener path
 * (`openPageOutward`) asks the same scheme question before any handover.
 *
 * The click goes through the SAME opener the page card's "open the page" verb
 * uses: this module calls `openPageOutward`, which is still the app's only
 * opener call site. It stops the click's own propagation so the click is not
 * also the card's press; the reading's press is stopped one layer earlier (on
 * the reading element) so a click on a link never begins a drag or a selection.
 *
 * PURE except for the injected opener, so the rule is asserted without a DOM.
 * PROVISIONAL: the address's edge punctuation, and the hit area (the link's own
 * words, never the whole line).
 */

/** The class the reading's one link element wears (canvas.css styles it). */
export const READING_LINK_CLASS = "ground-reading-link";

/** One run of a reading: the stored words, or the address they name. */
export type ReadingLinkSegment =
  | { readonly kind: "text"; readonly text: string }
  | { readonly kind: "link"; readonly text: string; readonly url: string };

/**
 * An address as written in prose: `http(s)://` and everything that is not
 * whitespace or a quote/bracket that would end it. The stricter check below
 * still runs on the trimmed string.
 */
const ADDRESS = /https?:\/\/[^\s<>"'`]+/gi;

/**
 * The address a matched run actually names, or null (PURE). A sentence's
 * punctuation is not part of a link, and a closing bracket belongs to the
 * address only when the matching opener is inside it (the parenthesised URL
 * keeps its own pair). The result is then put through the record's `isWebUrl`
 * so `only http(s)` is the SAME rule everywhere.
 */
function addressOf(raw: string): string | null {
  let value = raw.replace(/[.,;:!?]+$/, "");
  while (value.length > 0) {
    const last = value[value.length - 1];
    const opener = last === ")" ? "(" : last === "]" ? "[" : last === "}" ? "{" : null;
    if (opener === null) break;
    const opens = value.split(opener).length - 1;
    const closes = value.split(last).length - 1;
    if (opens >= closes) break;
    value = value.slice(0, -1);
  }
  return isWebUrl(value) ? value : null;
}

/**
 * Split one stored reading into the words and the addresses it names. PURE:
 * the same bytes always give the same runs, and text with no address is ONE
 * text run (the caller can render it exactly as before).
 */
export function readingLinkSegments(text: string): readonly ReadingLinkSegment[] {
  const segments: ReadingLinkSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(ADDRESS)) {
    const start = match.index ?? 0;
    const url = addressOf(match[0]);
    if (url === null) continue;
    if (start > cursor) {
      segments.push({ kind: "text", text: text.slice(cursor, start) });
    }
    segments.push({ kind: "link", text: url, url });
    cursor = start + url.length;
  }
  if (cursor === 0) return [{ kind: "text", text }];
  if (cursor < text.length) {
    segments.push({ kind: "text", text: text.slice(cursor) });
  }
  return segments;
}

/** The press a link's click has to answer: stop the click and open the page. */
export interface ReadingLinkPress {
  preventDefault(): void;
  stopPropagation(): void;
}

/**
 * Open one reading link in the system's default browser (PURE apart from the
 * injected opener). The event is the link's own: the card must not also read
 * this click as its press, and the address is handed to `openPageOutward` —
 * the SAME guarded door the page card's "open the page" verb uses. `open` is
 * injectable so a test can prove the exact address handed over.
 */
export function followReadingLink(
  event: ReadingLinkPress,
  url: string,
  open: (value: string) => Promise<unknown> = openPageOutward,
): void {
  event.preventDefault();
  event.stopPropagation();
  void open(url);
}
