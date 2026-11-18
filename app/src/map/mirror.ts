import { writeTextFile } from "../lib/fs";
import { canonicalText } from "../lib/serialize";
import { isFork, type AskCard } from "./asks";
import type { GroundReference } from "./ground";
import { serializeGroundLinkLine, type GroundLink } from "./groundLinks";
import { serializeMediaLine, type Media } from "./media";
import {
  pageHost,
  readingExtract,
  readingFileName,
  selectionSourceSlug,
  type Reading,
  type ReadingState,
} from "./readings";

/**
 * THE MIRROR (story 16.9): a human-readable index of the ground map, written
 * beside the map at the workspace root.
 *
 *   MAP.md   the whole ground map, rewritten whole on every ground write
 *
 * WHY IT EXISTS: the records are line-oriented and honest, but a person (or
 * another agent) should be able to read the board without parsing JSONL. The
 * mirror is the legible face of the same records — Slashspace's generated
 * Context.md, with our honesty rule added: it also says what is UNKNOWN (a
 * card whose file is missing, an orphan link, an unreadable record line)
 * instead of dropping the line that cannot be placed.
 *
 * WHY IT IS DERIVED: the records in map/ are the only truth. This file is
 * regenerated wholesale on every ground write, never authored, and a hand edit
 * is overwritten without ceremony. Deleting it is safe: the next move writes
 * it again — the app never writes it on open, because opening is a look.
 *
 * WHY IT IS REPRODUCIBLE: the same records must produce the same bytes, so a
 * person can diff it and an agent can trust it. That rules out a clock, a
 * "generated at" line and every count or total: the list is the summary. Order
 * comes from the records (their file order) or from a fixed sort (links by
 * slug pair, unknown notes by slug), never from anything ambient.
 *
 * ONLY THE GROUND MAP IS DESCRIBED. The concept map gets its own mirror later
 * if it earns one (the epic's separate-maps rule); nothing here reads or
 * names a concept record.
 *
 * ASK CARDS ARE HERE NOW (story 17.8), in their own section and with NOT ONE
 * WORD of any conversation. One line per ask card, in the record's own order:
 * its NAME, what it is ABOUT (the anchor reference's name, or the name the
 * record remembered with a gone mark), and its PARENT when it is a fork. No
 * counts of turns, no previews, no last-turn time, no content — the record's
 * own file holds the words, and the mirror is a shareable derived file. The
 * gone mark is the SAME fact the card states (story 17.6): the anchor does not
 * resolve, and this renderer says so rather than repairing, replacing or
 * dropping the card. A fork's parent that is gone is marked the same way.
 * An orphan conversation (a `map/asks/<slug>.jsonl` whose card is gone) is an
 * UNKNOWN like the orphan notes and media lines: named, kept, never adopted.
 *
 * NO FULL PATHS: a mirror may be shared with another agent or pasted into a
 * message, so a card names its reading's FILE NAME only (readingFileName).
 * STORY 16.15: an image card says `image: <file name>` and a video says
 * `video: <host>` — the same two quiet facts the card's face carries, no count
 * and no reading claimed.
 *
 * STORY 16.14b: a media line whose card is gone is an UNKNOWN, like an orphan
 * link or note. It is reproduced in "What is unknown" from the record itself,
 * never dropped to make the index look tidy and never repaired into a card.
 *
 * PROVISIONAL (the story's artifact, before an ADR settles it): the MAP.md
 * name and location, the block layout, the section order, the preview length
 * and the exact state sentences.
 */

/** The mirror's file name at the workspace root (PROVISIONAL). */
export const MIRROR_FILE = "MAP.md";

/** Where the mirror lives: workspace root, beside the map folder. */
export function mirrorPath(workspacePath: string): string {
  return workspacePath + "/" + MIRROR_FILE;
}

/**
 * How much of a reading's or a note's first line a block carries. PROVISIONAL
 * (not a rule): the line is a preview — the full text lives in the record and
 * the card's own surface.
 */
export const MIRROR_PREVIEW_CHARS = 120;

/**
 * The ONE sentence a mirror write failure answers. It rides the ground notices
 * group and never fails the move that caused it (rule 3): the records are
 * already written when the mirror is queued, so the person's move stands.
 */
export const MIRROR_WRITE_REFUSAL =
  "the map changed, but MAP.md could not be written.";

/**
 * The loaded ground view the mirror renders — exactly the fields the index
 * speaks for, and no verb. Taking the shape as a parameter keeps the render
 * PURE: same view, same bytes, no disk and no React.
 */
export interface MirrorView {
  references: readonly GroundReference[];
  readings: readonly Reading[];
  texts: Readonly<Record<string, string>>;
  states: Readonly<Record<string, ReadingState>>;
  notes: Readonly<Record<string, string>>;
  orphanNotes: readonly string[];
  /**
   * STORY 16.14b — media lines naming a card the map does not carry: kept in
   * `map/media.jsonl` and named under "What is unknown", never adopted.
   */
  orphanMedia: readonly Media[];
  links: readonly GroundLink[];
  orphanLinks: readonly GroundLink[];
  /**
   * STORY 17.8 — every ask card, in the record's own order. The section names
   * each card, what it is about and (for a fork) its parent; the CONVERSATION
   * is never read here, so not one word of it can reach the mirror.
   */
  asks: readonly AskCard[];
  /** Unreadable `map/asks.txt` lines, kept and named under "What is unknown". */
  malformedAsks: readonly string[];
  /**
   * STORY 17.8 — conversation files whose ask card is gone: kept where they
   * are, named under "What is unknown", never adopted into a card.
   */
  orphanAskTurns: readonly string[];
  malformedGround: readonly string[];
  malformedReadings: readonly string[];
  malformedLinks: readonly string[];
}

/** The fixed first lines: what this file is, and that the records are truth. */
const HEADER = [
  "# MAP.md — the ground map, written out",
  "",
  "This file is generated from the map's records. The records are the truth;",
  "this is a mirror. It is rewritten whole on every move, and a hand edit is",
  "overwritten. Deleting it is safe: the next move writes it again.",
  "",
];

/**
 * The state words. current says NOTHING (a quiet file needs no line); the
 * other four say their one sentence, because a stale, absent or unreadable
 * file is content the person must see. PROVISIONAL wording.
 */
const STATE_SENTENCES: Record<ReadingState, string | null> = {
  current: null,
  changed: "changed since this reading was taken",
  missing: "the file is missing",
  unreadable: "the file cannot be read",
  unread: "no reading has been taken",
};

/** One line's text, flattened for the markdown block (no embedded breaks). */
function flat(text: string): string {
  return text.replace(/[\r\n]+/g, " ").trimEnd();
}

/** The first line of a text, cropped to the provisional preview length. */
function previewLine(text: string): string {
  const first = flat(text.split(/\r?\n/, 1)[0] ?? "");
  if (first.length <= MIRROR_PREVIEW_CHARS) return first;
  return first.slice(0, MIRROR_PREVIEW_CHARS).trimEnd() + "…";
}

/** The links' deterministic order: by the slugs they were recorded with. */
function sortedLinks(links: readonly GroundLink[]): GroundLink[] {
  return [...links].sort((a, b) => {
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    if (a.to !== b.to) return a.to < b.to ? -1 : 1;
    return 0;
  });
}

/**
 * STORY 17.8 — THE ONE LINE AN ASK CARD GETS IN THE MIRROR (PURE, PROVISIONAL
 * wording): its name, what it is about, and its parent when it is a fork.
 *
 * The ABOUT is the anchor reference's LIVE name; when the anchor does not
 * resolve it is the name the record REMEMBERED, marked gone — the same fact the
 * card says (story 17.6), said in this derived file and never repaired. A card
 * that never remembered a name (recorded before 17.6) falls back to the generic
 * phrase rather than inventing one. A fork's parent is named the same way: its
 * live name, or its slug marked gone.
 *
 * NOT A WORD OF THE CONVERSATION: the words, the turn count, the last turn's
 * time and every size live in the record's files. This line has one format and
 * no slot for any of them.
 */
export const MIRROR_ASK_GONE = " (gone)";
export const MIRROR_ASK_UNKNOWN = "a card that is not here";

export function mirrorAskLine(
  ask: AskCard,
  anchorName: string | null,
  parentName: string | null,
): string {
  const remembered = ask.anchorName === undefined ? null : ask.anchorName;
  const about = anchorName ?? remembered ?? MIRROR_ASK_UNKNOWN;
  // The gone mark follows the FIELD, not the name: a resolved anchor is never
  // marked, and an unresolved one is marked whether or not a name was kept.
  let line = ask.name + " — about " + about;
  if (anchorName === null) line += MIRROR_ASK_GONE;
  if (isFork(ask) && ask.from !== undefined) {
    line +=
      "; forked from " +
      (parentName === null ? ask.from + MIRROR_ASK_GONE : parentName);
  }
  return flat(line);
}

/**
 * THE RENDER, pure: the loaded ground view in, the mirror's exact bytes out.
 * Same view -> same bytes. Every section is present in a fixed order; an empty
 * section says "none yet." rather than vanishing, so the file's shape does not
 * flicker with the map's contents.
 */
export function renderMirror(view: MirrorView): string {
  const nameOf = new Map(
    view.references.map((reference) => [reference.on, reference.name]),
  );
  const readingOf = new Map(
    view.readings.map((reading) => [reading.on, reading]),
  );
  const lines: string[] = [...HEADER];

  lines.push("## References", "");
  if (view.references.length === 0) lines.push("none yet.", "");
  for (const reference of view.references) {
    const reading = readingOf.get(reference.on) ?? null;
    const state =
      view.states[reference.on] ?? (reading === null ? "unread" : "unreadable");
    lines.push("### " + flat(reference.name));
    // The file's NAME only: the mirror may be shared, and a full path is the
    // person's machine and folder. The reading's record keeps the path. STORY
    // 16.12: a selection has no file — it says which CARD it came from, by the
    // source's NAME, and a source the map no longer carries is said quietly.
    if (reading !== null) {
      const sourceSlug = selectionSourceSlug(reading);
      if (reading.form === "url") {
        // STORY 16.14: the mirror names the page's HOST only; the full address
        // stays in the reading's record, never in a shareable derived file.
        // STORY 16.15: a video says its own one word, same host-only rule.
        lines.push(
          (readingExtract(reading) === "video" ? "video: " : "page: ") +
            pageHost(reading.from),
        );
      } else if (readingExtract(reading) === "image") {
        // STORY 16.15: an image is a FILE reading with no text; the mirror says
        // so in one line, with the file's NAME and never its path.
        lines.push("image: " + readingFileName(reading.from));
      } else if (sourceSlug === null) {
        lines.push("file: " + readingFileName(reading.from));
      } else {
        lines.push(
          "from: " + (nameOf.get(sourceSlug) ?? "a card that is gone"),
        );
      }
    }
    const sentence = STATE_SENTENCES[state];
    if (sentence !== null) lines.push("state: " + sentence);
    const text = view.texts[reference.on];
    if (text !== undefined) lines.push("reading: " + previewLine(text));
    const note = view.notes[reference.on];
    if (note !== undefined) lines.push("note: " + previewLine(note));
    lines.push("");
  }

  // STORY 17.8 — THE ASKS. One line per card, in the record's order: what it
  // is, what it is about, and its parent when it is a fork. The conversation
  // is never read: this section cannot say a word of it, a count of turns or a
  // preview, because neither is in hand here.
  lines.push("## Asks", "");
  if (view.asks.length === 0) lines.push("none yet.", "");
  const askNameOf = new Map(view.asks.map((ask) => [ask.on, ask.name]));
  for (const ask of view.asks) {
    const anchorName = nameOf.get(ask.anchor) ?? null;
    const parentName =
      ask.from === undefined ? null : (askNameOf.get(ask.from) ?? null);
    lines.push(mirrorAskLine(ask, anchorName, parentName));
  }
  if (view.asks.length > 0) lines.push("");

  lines.push("## Links", "");
  const links = sortedLinks(view.links);
  if (links.length === 0) {
    lines.push("none yet.", "");
  }
  for (const link of links) {
    // The direction AS RECORDED, in the person's names; a link carries no
    // meaning, so the mirror adds none.
    const from = nameOf.get(link.from) ?? link.from;
    const to = nameOf.get(link.to) ?? link.to;
    lines.push(from + " → " + to);
  }
  if (links.length > 0) lines.push("");

  // WHAT IS UNKNOWN: every kept-but-unplaceable thing, reproduced as it is and
  // marked unreadable. Nothing is dropped to make the index look tidy.
  const unknown: string[] = [];
  for (const line of view.malformedGround) {
    unknown.push("unreadable line in ground.txt: " + flat(line));
  }
  for (const line of view.malformedReadings) {
    unknown.push("unreadable line in readings.txt: " + flat(line));
  }
  for (const line of view.malformedLinks) {
    unknown.push("unreadable line in ground-links.txt: " + flat(line));
  }
  // STORY 17.8 — the asks' two kept-but-unplaceable kinds, reproduced as the
  // records hold them: an unreadable ask line, and a conversation whose card is
  // gone (the notes' and the media lines' rule, one family over).
  for (const line of view.malformedAsks) {
    unknown.push("unreadable line in asks.txt: " + flat(line));
  }
  for (const slug of [...view.orphanAskTurns].sort()) {
    unknown.push(
      "a conversation with no ask card, kept in map/asks/" + slug + ".jsonl",
    );
  }
  for (const link of view.orphanLinks) {
    unknown.push(
      "unreadable link, a card is not on the map: " +
        serializeGroundLinkLine(link),
    );
  }
  for (const slug of [...view.orphanNotes].sort()) {
    unknown.push("unreadable note, no card is on the map: " + slug + ".md");
  }
  // STORY 16.14b: the media line is reproduced as the record holds it — title
  // and all — so a reader can tell which orphan it is without the map.
  for (const entry of view.orphanMedia) {
    unknown.push("media with no card on the map: " + serializeMediaLine(entry));
  }
  lines.push("## What is unknown", "");
  if (unknown.length === 0) lines.push("nothing is unknown.", "");
  else lines.push(...unknown, "");

  return canonicalText(lines.join("\n"));
}

/** The bridges the mirror needs; the app passes lib/fs, a test a fake. */
export interface MirrorIo {
  writeTextFile(path: string, content: string): Promise<void>;
}

/** The real bridges, bound once so the module stays importable in tests. */
export const MIRROR_IO: MirrorIo = { writeTextFile };

/** Write the mirror WHOLE (the one file this family rewrites, not appends). */
export async function writeMirror(
  workspacePath: string,
  text: string,
  io: MirrorIo = MIRROR_IO,
): Promise<void> {
  await io.writeTextFile(mirrorPath(workspacePath), text);
}

/**
 * ONE queued mirror write, ready for the per-file queue: render from the
 * CALLER's latest view, write, and answer the notice. It never rejects — a
 * mirror failure is one sentence in the ground notices group, never a failed
 * move (rule 3). The render is inside the try as well: a bug in the derived
 * face must not take the person's record write with it.
 */
export function mirrorWriteTask(
  workspacePath: string,
  text: () => string,
  report: (notice: string | null) => void,
  io: MirrorIo = MIRROR_IO,
): () => Promise<void> {
  return async () => {
    try {
      await writeMirror(workspacePath, text(), io);
      report(null);
    } catch {
      report(MIRROR_WRITE_REFUSAL);
    }
  };
}
