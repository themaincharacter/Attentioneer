import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";

/**
 * Signed links (ADR-0012 decision 2, ADR-0014): one `map/links.jsonl` line per
 * causal link — a directed pair of reference slugs plus its authored sign.
 * `sign` is ASCII "+" (the pair moves together) or "-" (opposite). The sign is
 * structure, never a coined word: the software never interprets it, never
 * merges it with a distance and never guesses it (World B).
 *
 * Identity is the ORDERED natural key (from, to): one link per directed pair
 * and at most one line per key. Drawing the identical link rewrites that line;
 * A→B and B→A are two lines that coexist. Flipping a sign REWRITES the line in
 * place at its index (never append). Unknown keys on a known link survive a
 * rewrite; malformed lines are preserved verbatim and surfaced by the loader; a
 * missing file means no links.
 *
 * Provisional: the `sign` spelling (ASCII +/-), the `links.jsonl` name and the
 * record shape are ADR-0012/0014's, not settled beyond them. Cross-level
 * display stays Epic 6's.
 *
 * Canonical serialization is serialize.ts's job (ADR-0004); this module only
 * turns the file's bytes into records and back.
 */

/** The two authored signs. Provisional: polarity only, no magnitudes (ADR-0012). */
export type LinkSign = "+" | "-";

/** Both signs, in the order the choice offers them (never pre-selected). */
export const SIGNS: readonly LinkSign[] = ["+", "-"];

export interface Link {
  /** Endpoint slug of the origin reference. */
  from: string;
  /** Endpoint slug of the destination reference. */
  to: string;
  /** The authored sign — ASCII "+" or "-", never guessed. */
  sign: LinkSign;
  /** Unknown JSON keys preserved across rewrites (ADR-0006's posture). */
  extra: Record<string, unknown>;
}

interface ParsedLinks {
  links: Link[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

/** The natural key that names one directed link (the ORDERED pair). */
export function linkKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

export function linksPath(workspacePath: string): string {
  return `${workspacePath}/map/links.jsonl`;
}

/** Is this an authored sign? Anything else is malformed, never guessed at. */
export function isLinkSign(value: unknown): value is LinkSign {
  return value === "+" || value === "-";
}

/** Parse a JSONL line into a Link; malformed lines become `null`. */
export function parseLinkLine(line: string): Link | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const { from, to, sign, ...extra } = obj;
  if (typeof from !== "string" || typeof to !== "string" || from === "" || to === "") {
    return null;
  }
  if (!isLinkSign(sign)) return null;
  return { from, to, sign, extra };
}

/** Serialize one Link to its canonical JSONL line (compact, sorted keys). */
export function serializeLinkLine(link: Link): string {
  return canonicalJsonlLine({ ...link.extra, from: link.from, sign: link.sign, to: link.to });
}

/**
 * Read `map/links.jsonl`. Terminating newlines are ignored; malformed or
 * out-of-shape lines are preserved as unknowns (ADR-0005's posture) so the app
 * never silently drops what it cannot read. Tolerates BOM and CRLF on read.
 */
export function parseLinks(text: string): ParsedLinks {
  const links: Link[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseLinkLine(line);
    if (parsed) {
      links.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return { links, malformed };
}

export async function loadLinks(workspacePath: string): Promise<ParsedLinks> {
  const text = await readTextFile(linksPath(workspacePath));
  return text === null ? { links: [], malformed: [] } : parseLinks(text);
}

/** Deduplicate by natural key, last write wins (the hand-duplicate rule). */
export function dedupeLinks(links: readonly Link[]): Link[] {
  const byKey = new Map<string, Link>();
  for (const link of links) {
    byKey.set(linkKey(link.from, link.to), link);
  }
  return [...byKey.values()];
}

/**
 * The links file's exact bytes. Known lines serialize canonically (sorted
 * keys), one per ordered pair (last write wins); malformed lines are re-emitted
 * verbatim. A hand-duplicated line collapses here, one line per key.
 */
export function serializeLinks(
  links: readonly Link[],
  malformed: readonly string[] = [],
): string {
  const known = dedupeLinks(links).map(serializeLinkLine);
  return canonicalJsonlLines([...known, ...malformed]);
}

export async function saveLinks(
  workspacePath: string,
  links: readonly Link[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(linksPath(workspacePath), serializeLinks(links, malformed));
}

/** The one link on this ordered pair, if it exists. */
export function findLink(
  links: readonly Link[],
  from: string,
  to: string,
): Link | null {
  const key = linkKey(from, to);
  return links.find((link) => linkKey(link.from, link.to) === key) ?? null;
}

/** Is this ordered pair already drawn? */
export function hasLink(
  links: readonly Link[],
  from: string,
  to: string,
): boolean {
  return findLink(links, from, to) !== null;
}

/**
 * Draw a link: one line per ordered pair. The identical draw keeps the line
 * (unknown keys and all); a different sign on the same pair rewrites it IN
 * PLACE at its index — never a second line, never an append. The reverse pair
 * is a different key and coexists.
 */
export function drawLink(
  links: readonly Link[],
  from: string,
  to: string,
  sign: LinkSign,
): Link[] {
  const key = linkKey(from, to);
  const index = links.findIndex((link) => linkKey(link.from, link.to) === key);
  if (index === -1) {
    return [...links, { from, to, sign, extra: {} }];
  }
  const existing = links[index];
  if (existing.sign === sign) return [...links];
  const next = [...links];
  next[index] = { ...existing, sign };
  return next;
}

/**
 * Flip a link's sign: the line changes in place at its index (the sign is
 * revision, not a new record), and its unknown keys ride along. A pair with no
 * link is a no-op — flipping never invents a sign, and never touches a mark
 * (the mark's key has no sign, so it survives).
 */
export function flipLink(
  links: readonly Link[],
  from: string,
  to: string,
): Link[] {
  const index = links.findIndex(
    (link) => linkKey(link.from, link.to) === linkKey(from, to),
  );
  if (index === -1) return [...links];
  const next = [...links];
  next[index] = {
    ...next[index],
    sign: next[index].sign === "+" ? "-" : "+",
  };
  return next;
}

/** Remove one link (ammo: one click, no ceremony). The reverse pair stays. */
export function removeLink(
  links: readonly Link[],
  from: string,
  to: string,
): Link[] {
  const key = linkKey(from, to);
  return links.filter((link) => linkKey(link.from, link.to) !== key);
}
