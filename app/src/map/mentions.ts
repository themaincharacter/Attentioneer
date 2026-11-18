/**
 * Story 16.7 — MENTIONS IN A GROUND NOTE (PROVISIONAL syntax, before an ADR).
 *
 * A mention is a piece of PLAIN TEXT in the person's note that names something
 * else on the map. It is not markup rendered from a record: the note file keeps
 * the bytes the person could have typed by hand, and this module only READS
 * those bytes into segments so the card can draw a chip.
 *
 *   [@Label](card://<slug>)   navigation: the chip opens that ground card
 *   [@Label](word://<slug>)   context: the chip shows that concept's name and
 *                             memory (read-only, from the CONCEPT map)
 *
 * The form is a markdown link: the LABEL is display text and the
 * SLUG is identity, so a hand-edited label never renames anything — the app
 * keeps the person's words and resolves by the slug. Identity is
 * `mentionKey(kind, slug)`; nothing here writes, and nothing here reaches a
 * file (the cross-map read lives in `conceptWords.ts`, the one place allowed).
 *
 * THE ONE RULE THIS MODULE PROTECTS: a malformed mention is TEXT. Anything
 * that does not parse — a missing bracket, an empty slug, an unknown scheme, a
 * slug with a path separator — is displayed exactly as written and never
 * crashes, never reports an error and never disappears. The person's text is
 * the truth; a chip is a convenience drawn over it.
 *
 * PROVISIONAL: the two schemes, the `[@…](…)` shape, the label escaping (a
 * backslash escapes `]` and itself) and the slug alphabet below.
 */

/** The two kinds of mention, and the whole list of them (the user's ruling: both). */
export type MentionKind = "card" | "word";

/** One mention: the target's kind and slug, plus the authored display label. */
export interface Mention {
  kind: MentionKind;
  /** The target's identity: a ground card's slug, or a concept reference's slug. */
  slug: string;
  /** The display text as the person (or the picker) wrote it. Never an identity. */
  label: string;
}

/** A note split into plain text and mentions, in file order, losslessly. */
export type NoteSegment =
  | { kind: "text"; text: string }
  | { kind: "mention"; mention: Mention };

/**
 * A slug a mention may name: a letter or digit first, then letters, digits and
 * `._~-`. PROVISIONAL, and deliberately the SAME rule for both kinds: the
 * concept map's slugs are minted by `slugName`, and ground slugs by `ground.ts`.
 * No separator can appear, so a mention can never be steered at another path.
 */
const MENTION_SLUG = /^[\p{L}\p{N}][\p{L}\p{N}._~-]*$/u;

/** Is this text a slug a mention may name? (The one rule; no IO.) */
export function isMentionSlug(value: string): boolean {
  return MENTION_SLUG.test(value);
}

/** The key a mention is identified by, for a React key or a lookup. */
export function mentionKey(kind: MentionKind, slug: string): string {
  return `${kind}://${slug}`;
}

/**
 * The canonical mention text for a target. The label is escaped (`]` and a
 * backslash), so a name with a bracket still round-trips; the slug is written
 * as it stands (it cannot contain a separator or a bracket).
 */
export function serializeMention(
  kind: MentionKind,
  slug: string,
  label: string,
): string {
  const safe = label.replace(/\\/g, "\\\\").replace(/\]/g, "\\]");
  return `[@${safe}](${mentionKey(kind, slug)})`;
}

/** Undo the label's escaping (only `]` and a backslash are escaped). */
function unescapeLabel(raw: string): string {
  return raw.replace(/\\(.)/g, "$1");
}

/** The scanner: a mention token, anywhere in a note. */
const MENTION_SCAN = /\[@((?:\\.|[^\]\\])*)\]\((card|word):\/\/([^()\s]+)\)/g;

/** The same shape, anchored: `parseMention` reads exactly one token. */
const MENTION_EXACT =
  /^\[@((?:\\.|[^\]\\])*)\]\((card|word):\/\/([^()\s]+)\)$/;

/**
 * Parse ONE exact mention token, or null. The slug's alphabet is checked here,
 * so a token naming an impossible slug is not a mention (it stays text).
 */
export function parseMention(raw: string): Mention | null {
  const match = MENTION_EXACT.exec(raw);
  if (match === null) return null;
  const kind = match[2] as MentionKind;
  const slug = match[3];
  if (!isMentionSlug(slug)) return null;
  return { kind, slug, label: unescapeLabel(match[1]) };
}

/**
 * Split a note into text and mentions. Every byte of the input appears in the
 * answer (a text segment or a mention's canonical text), so a note edited by
 * hand and a note written by the picker read the same way; anything that is not
 * a well-formed mention — including a broken one — stays plain text.
 */
export function parseMentions(text: string): NoteSegment[] {
  const segments: NoteSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MENTION_SCAN)) {
    const raw = match[0];
    const mention = parseMention(raw);
    const at = match.index ?? 0;
    if (mention === null) continue; // Not a mention: the scan moves on.
    if (at > last) segments.push({ kind: "text", text: text.slice(last, at) });
    segments.push({ kind: "mention", mention });
    last = at + raw.length;
  }
  if (last < text.length) segments.push({ kind: "text", text: text.slice(last) });
  return segments;
}

/**
 * Does a mention's target still exist? A ground card's slug comes from the map
 * the layer just loaded, so the answer is always known; a concept word's set
 * comes from the read-only concept index, and `null` means it was not read
 * (nothing is judged dangling on ignorance). A dangling mention is drawn muted
 * and does nothing — it is NEVER removed from the note and never called
 * malformed (the story's rule).
 */
export function mentionDangling(
  kind: MentionKind,
  slug: string,
  cardSlugs: ReadonlySet<string>,
  wordSlugs: ReadonlySet<string> | null,
): boolean {
  if (kind === "card") return !cardSlugs.has(slug);
  return wordSlugs !== null && !wordSlugs.has(slug);
}

/**
 * How many lines a note holds, by the SMALL face's rule: a single trailing
 * newline is a terminator, not a line (the same rule `previewText` uses, so a
 * note's crop does not change when a mention arrives).
 */
function lineCount(text: string): number {
  const lines = text.split(/\r?\n/);
  return text.endsWith("\n") ? lines.length - 1 : lines.length;
}

/**
 * The SMALL card's crop, in SEGMENTS (story 16.7): the first `maxLines` lines
 * of the note, with chips kept whole. A token that would start past the crop is
 * dropped with the rest of the text; ONE ellipsis marks the cut. PURE, so the
 * note's face is not the DOM's only truth — only the FACE is cropped, the
 * stored file keeps every line.
 *
 * `null` maxLines means "no crop" (the expanded card shows the whole note).
 */
export function cropSegments(
  segments: readonly NoteSegment[],
  maxLines: number | null,
): NoteSegment[] {
  if (maxLines === null) return [...segments];
  if (maxLines <= 0) return [];
  const text = segments
    .map((segment) => (segment.kind === "text" ? segment.text : ""))
    .join("");
  if (lineCount(text) <= maxLines) {
    // A single trailing newline is a TERMINATOR, not a line the face shows:
    // dropping it from the CROPPED face (never from the stored note, and never
    // from the expanded face, which asks for `null`) keeps the small card's
    // crop identical to the reading preview's.
    const copy = [...segments];
    const last = copy[copy.length - 1];
    if (last !== undefined && last.kind === "text" && last.text.endsWith("\n")) {
      const trimmed = last.text.slice(0, -1);
      if (trimmed === "") copy.pop();
      else copy[copy.length - 1] = { kind: "text", text: trimmed };
    }
    return copy;
  }

  const out: NoteSegment[] = [];
  let newlines = 0;
  for (const segment of segments) {
    if (segment.kind === "mention") {
      out.push(segment);
      continue;
    }
    let end = segment.text.length;
    let hitCut = false;
    for (let i = 0; i < segment.text.length; i += 1) {
      if (segment.text[i] !== "\n") continue;
      newlines += 1;
      // The maxLines-th newline starts a line the face does not show: cut
      // before it and let the one ellipsis say so.
      if (newlines >= maxLines) {
        end = i;
        hitCut = true;
        break;
      }
    }
    if (end > 0) out.push({ kind: "text", text: segment.text.slice(0, end) });
    if (hitCut) break;
  }
  // The one ellipsis, attached to the last text so it stays on its line.
  const last = out[out.length - 1];
  if (last !== undefined && last.kind === "text") {
    out[out.length - 1] = { kind: "text", text: `${last.text}…` };
  } else {
    out.push({ kind: "text", text: "…" });
  }
  return out;
}
