import type { PullReading, PullSite } from "../pull/ask";

/**
 * THE PULL ASK'S WORDS (Epic 13 story 2) — the door's one quiet label, the
 * reading's chrome, and the rule that turns a site into the lines the reading
 * shows.
 *
 * THE RECORDS ARE THE EXPLANATION (ADR-0030's amendment): a site's lines are
 * its OWN bytes — the record's canonical line, the standing rule sentence a
 * dangling pin carries — and a veil's are the projection's two fields, its
 * coined name and its location. Nothing is derived here: no name is looked up,
 * no sentence is composed, no amount is formatted, no reason is read (the veil
 * has none, structurally). The surface renders these lines and adds nothing; it
 * does not sort them, group them, label a family, number them or count them.
 *
 * CO-PRESENCE, NEVER ARRANGEMENT: the reading is ONE block of lines in the
 * reader's own walk order — an order that is the walk, never a salience
 * verdict. There is no per-family heading, no blank-line grouping and no site
 * badge: two records at one anchor simply stand next to each other, each with
 * its own words.
 *
 * THE DOOR IS "THE PULL ASK" in code (the contacts' Ask owns its own phrase, and
 * the pull never borrows it): the label below is the person's own question, the
 * one the glossary gives the pull, and pressing it is the ask. The button is
 * the ONLY trigger (the handler's scans hold that).
 *
 * Provisional (ADR-0003's seam): the door's wording and look, the reading's
 * title, and the one-block rendering (a per-record element would need an
 * identity and a position, and the reading has neither).
 */

/** The door's ONE quiet label: the question the pull answers. */
export const PULL_DOOR_LABEL = "where am I thin…";

/** The door's quiet hover title: what pressing it does. */
export const PULL_DOOR_TITLE = "read the records that exist — each at its own site";

/** The reading's title (the surface's chrome, never a claim). */
export const PULL_TITLE = "the pull";

/** The reading's accessible name. */
export const PULL_PANEL_LABEL = "the pull — the records' own words";

/** The close button's accessible name (closing IS the dismissal). */
export const PULL_CLOSE_LABEL = "close the reading";

/**
 * One site's lines, as the reading shows them. A record's are its own line and,
 * when the record requires one, its standing rule sentence (the dangling pin's);
 * a veil's are its name and its location — the projection's two fields, and
 * nothing else. The words are handed through byte for byte.
 */
export function pullSiteLines(site: PullSite): readonly string[] {
  if (site.family === "veil") {
    return site.location === null ? [site.name] : [site.name, site.location];
  }
  return site.note === null ? [site.words] : [site.words, site.note];
}

/**
 * The reading as the one block of lines the surface shows: every site's lines,
 * in the walk's own order, one per line. Co-presence made visible — no heading,
 * no grouping, no marker, no count, and not a position in sight.
 */
export function pullLines(reading: PullReading): string {
  const lines: string[] = [];
  for (const site of reading.sites) {
    for (const line of pullSiteLines(site)) {
      lines.push(line);
    }
  }
  return lines.join("\n");
}
