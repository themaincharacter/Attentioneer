import { isWebUrl, pageHost } from "../map/readings";

/**
 * STORY 16.34 — ONE WEB LINK, ONE VALIDATOR, TWO DOORS.
 *
 * A web address can now arrive by DROP and by PASTE, and both must mean the
 * same thing the bubble's page intent means: `http(s)`, nothing else, and a
 * page card made through the EXISTING creator. So the two small rules that say
 * what a link IS and what a card made from one is CALLED live here, once, and
 * the drop (`osDrop.ts`) and the paste (`linkPaste.ts`) both read them.
 *
 * The validator is the map's own record-shape check (`readings.ts`'s
 * `isWebUrl`), not a second pattern: a scheme test copied into this module
 * could drift from the one that decides whether a stored reading is legal.
 *
 * PROVISIONAL: the card's name is the address's HOST. A dropped or pasted link
 * arrives without a name, and the creator insists on one; the host is the
 * smallest true name the card already shows on its face. The fetch still
 * supplies the title for the card's reading line.
 */

/**
 * The ONE sentence a drop says when an item is neither a file this app reads
 * nor an http(s) web address. 16.20's file-only sentence would be a lie about a
 * dropped string, so the drop's own wording broadened; the file picker's
 * refusal (`extract.ts`'s `PICK_UNKNOWN`) is unchanged.
 */
export const NOT_A_FILE_OR_LINK =
  "that cannot be added: not text, a PDF, an image or a web page.";

/**
 * The web address a dropped or pasted string names, or null (PURE). The whole
 * string must be the address, trimmed: a sentence that CONTAINS a link is not
 * a link, and this app does not go fishing in prose.
 */
export function webLinkOf(text: string): string | null {
  const value = text.trim();
  if (value === "") return null;
  return isWebUrl(value) ? value : null;
}

/**
 * The name a link-made card carries: the address's host, which the page card
 * already shows as its quiet provenance. Never empty for a valid address.
 */
export function webLinkName(url: string): string {
  return pageHost(url);
}
