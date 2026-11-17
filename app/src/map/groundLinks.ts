import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalText } from "../lib/serialize";
import { GROUND_RECORD_FILE, mapDir } from "./records";

/**
 * The GROUND map's LINKS (story 16.5): two cards wired together, one
 * `map/ground-links.txt` line per ordered pair.
 *
 *   from: <slug> | to: <slug>
 *
 * A LINK IS NOT A DISTANCE (the epic's REFRAME, 2026-11-17): a Distance is a
 * concept-map citizen, a TYPED separation carrying a coined word, and the
 * cohesion between maps now comes from language games and their ontology files
 * instead of from typed pairs. On the ground map a link is WORDLESS wiring —
 * the thing that makes a board of cards feel like a board. So this record has
 * no word field, no sign, no meaning and no reader of its direction: the
 * direction is recorded because it was DRAWN, and nothing may interpret it.
 *
 * IDENTITY IS THE ORDERED PAIR (from, to). Drawing the identical link again
 * rewrites the one line, never duplicates it; dragging the other way makes a
 * second, separate line. Slugs are ground-reference slugs — the same keys
 * `ground.txt` and `readings.txt` join on.
 *
 * ORPHANS ARE PRESERVED AND REPORTED (ADR-0009). A line naming a slug that is
 * not in `ground.txt` is kept byte-identically and surfaced in the ground
 * notices group; it is never dropped, never repaired, never guessed into a
 * card. Malformed lines are treated the same way — kept verbatim, reported,
 * re-emitted by every write. The delete cascade is the ONE thing that removes
 * a link on the person's behalf, and only because the card it named is gone
 * (see `withoutGroundLinksFor`).
 *
 * THE FILE IS THE WHOLE TRUTH: one family's file, one read-modify-write at a
 * time through the app's per-file queue (writeQueue.ts in `useGround`), never
 * a whole-folder rewrite.
 *
 * PROVISIONAL (the story's record shape, before an ADR settles it): the
 * `ground-links.txt` name, the `from | to` line shape, the strict key order on
 * read, and the decision that direction is recorded but unread.
 */

/** One link: two ground-reference slugs, in the direction that was drawn. */
export interface GroundLink {
  /** The card the drag started on. */
  from: string;
  /** The card it was released on. */
  to: string;
}

/** A read of `map/ground-links.txt`: what parsed and what is kept unreadable. */
export interface ParsedGroundLinks {
  /** Every readable line, in FILE ORDER (hand duplicates included). */
  links: GroundLink[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

/** The bridges this family needs; the app passes lib/fs, a test passes a fake. */
export interface GroundLinkIo {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const GROUND_LINK_IO: GroundLinkIo = { readTextFile, writeTextFile };

/** The ground link file: `<workspace>/map/ground-links.txt`. */
export function groundLinksPath(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${GROUND_RECORD_FILE.links}`;
}

/** A link's identity: the ordered pair. Two directions are two keys. */
export function linkKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * The line shape, in the order the writer emits it. Slugs are the app's own
 * shape: no spaces. Both keys are structural — a link has no free text — so a
 * line missing either key, or carrying an extra field, is unreadable and kept.
 */
const GROUND_LINK_LINE = /^from: (\S+) \| to: (\S+)$/;

/** Parse one line; anything out of shape is `null` (kept and reported). */
export function parseGroundLinkLine(line: string): GroundLink | null {
  const match = GROUND_LINK_LINE.exec(line);
  if (!match) return null;
  const [, from, to] = match;
  if (from === "" || to === "") return null;
  return { from, to };
}

/** One link as its canonical line (no trailing newline). */
export function serializeGroundLinkLine(link: GroundLink): string {
  return `from: ${link.from} | to: ${link.to}`;
}

/**
 * Read the file's bytes. Terminating newlines are ignored, a BOM and CRLF from
 * a hand edit are tolerated, and an unparsable line lands in `malformed`
 * verbatim (ADR-0009) so a write can put it back.
 */
export function parseGroundLinks(text: string): ParsedGroundLinks {
  const links: GroundLink[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseGroundLinkLine(line);
    if (parsed === null) malformed.push(line);
    else links.push(parsed);
  }
  return { links, malformed };
}

/**
 * The file's exact canonical bytes: known links in FILE ORDER, then the
 * preserved unreadable lines, LF and one trailing newline (the record files'
 * convention, serialize.ts's `canonicalText`).
 */
export function serializeGroundLinks(
  links: readonly GroundLink[],
  malformed: readonly string[] = [],
): string {
  return canonicalText(
    [...links.map(serializeGroundLinkLine), ...malformed].join("\n"),
  );
}

export async function loadGroundLinks(
  workspacePath: string,
  io: GroundLinkIo = GROUND_LINK_IO,
): Promise<ParsedGroundLinks> {
  const text = await io.readTextFile(groundLinksPath(workspacePath));
  return text === null ? { links: [], malformed: [] } : parseGroundLinks(text);
}

export async function saveGroundLinks(
  workspacePath: string,
  links: readonly GroundLink[],
  malformed: readonly string[] = [],
  io: GroundLinkIo = GROUND_LINK_IO,
): Promise<void> {
  await io.writeTextFile(
    groundLinksPath(workspacePath),
    serializeGroundLinks(links, malformed),
  );
}

/**
 * DRAW one link: append it, or REPLACE the identical pair where it already
 * sits. Drawing the same link twice therefore leaves one line (the identity),
 * while the reverse drag appends a second, separate line — the pair is ORDERED
 * even though nothing reads the order. PURE: the caller writes the file.
 */
export function addGroundLink(
  links: readonly GroundLink[],
  from: string,
  to: string,
): GroundLink[] {
  const key = linkKey(from, to);
  let found = false;
  const next = links.map((link) => {
    if (linkKey(link.from, link.to) !== key) return link;
    found = true;
    return { from, to };
  });
  return found ? next : [...links, { from, to }];
}

/** REMOVE one exact ordered pair, keeping every other line in file order. */
export function withoutGroundLink(
  links: readonly GroundLink[],
  from: string,
  to: string,
): GroundLink[] {
  const key = linkKey(from, to);
  return links.filter((link) => linkKey(link.from, link.to) !== key);
}

/**
 * REMOVE every link that NAMES this slug, in BOTH directions. This is the
 * delete cascade's pure half: deleting a reference takes its links with it,
 * because a kept link to a gone card would be an orphan the app itself
 * manufactured. The caller writes the file in the same pass as the reference's
 * own removal.
 */
export function withoutGroundLinksFor(
  links: readonly GroundLink[],
  on: string,
): GroundLink[] {
  return links.filter((link) => link.from !== on && link.to !== on);
}

/**
 * The lines whose endpoints are not in `ground.txt` — ORPHANS, preserved and
 * REPORTED (ADR-0009), never dropped and never repaired into a card. A line is
 * an orphan when EITHER end names a slug the map does not carry. PURE: the
 * caller hands it the loaded reference slugs.
 */
export function orphanGroundLinks(
  links: readonly GroundLink[],
  slugs: Iterable<string>,
): GroundLink[] {
  const known = new Set(slugs);
  return links.filter(
    (link) => !known.has(link.from) || !known.has(link.to),
  );
}

/** The ONE sentence a refused draw answers: a link to itself is not a link. */
export const GROUND_SELF_LINK_REFUSAL = "a card cannot link to itself.";

/** The one sentence a draw answers when a card is not on the map. */
export const GROUND_LINK_UNKNOWN_REFUSAL =
  "both cards must already be on the map.";

/**
 * The DRAW'S guard (story 16.5), pure so the rule is not the DOM's only
 * truth: a self-link refuses with one sentence, and both endpoints must be
 * references the map already carries. Returns null when the draw may proceed.
 */
export function groundLinkRefusal(
  from: string,
  to: string,
  slugs: Iterable<string>,
): string | null {
  if (from === to) return GROUND_SELF_LINK_REFUSAL;
  const known = new Set(slugs);
  if (!known.has(from) || !known.has(to)) {
    return GROUND_LINK_UNKNOWN_REFUSAL;
  }
  return null;
}
