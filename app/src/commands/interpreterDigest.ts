import type { AskCard } from "../map/asks";
import type { GroundReference } from "../map/ground";
import type { GroundLink } from "../map/groundLinks";
import {
  pageHost,
  readingExtract,
  readingFileName,
  type Reading,
  type ReadingState,
} from "../map/readings";
import type { SessionCard } from "../map/sessions";
import { utf8ByteLength } from "../lib/textBytes";

/**
 * STORY 21.2 — THE INTERPRETER'S MAP DIGEST (ADR-0038 decision 6).
 *
 * What the manager/curator model is told about the map it is being asked to
 * act on: every card's NAME, its KIND, ONE LINE about it, its reading STATE
 * and the names it is WIRED to. That is the whole of it. The digest exists so
 * the interpreter can reference a card the person can see instead of inventing
 * one; it is PROMPT MATERIAL ONLY, composed at the call site and never
 * recorded, cached or rendered.
 *
 * NO READING BODY, BY CONSTRUCTION. This module's input is the RECORDS and the
 * READING LINES' METADATA (form, source, state) — never a reading's text and
 * never a note. The "one line about" a card is derived from what the card IS
 * (a page's host, a file's name, a selection, an artifact), exactly the rule
 * turn/curatorDigest.ts follows for the curator; no argument here can carry a
 * body, which is what tests/commands-interpreter.test.ts checks by reading
 * this file's imports and by building a digest from records whose text lives
 * elsewhere. A card's words stay on the map, where the person put them.
 *
 * BOUNDED, AND SAYS SO. {@link INTERPRETER_DIGEST_MAX_CARDS} entries and
 * {@link INTERPRETER_DIGEST_MAX_BYTES} bytes, WHOLE ENTRIES ONLY — an entry
 * that does not fit is not clipped, it is left out, and
 * {@link INTERPRETER_DIGEST_OMITTED_SENTENCE} says the list is short rather
 * than letting the model believe it has seen the whole map. PROVISIONAL: both
 * bounds, the wire cap, the sentence and the line shape below.
 */

/** The largest number of card entries a digest carries (PROVISIONAL). */
export const INTERPRETER_DIGEST_MAX_CARDS = 24;

/** The largest size a digest may reach, in UTF-8 bytes (PROVISIONAL). */
export const INTERPRETER_DIGEST_MAX_BYTES = 2048;

/** The largest number of wire names one card's line carries (PROVISIONAL). */
export const INTERPRETER_DIGEST_MAX_WIRES = 6;

/**
 * The one qualitative sentence a bounded digest ends with: it says THAT cards
 * were left out, never how many (the app has no counters, and a count here
 * would be one dressed as context).
 */
export const INTERPRETER_DIGEST_OMITTED_SENTENCE =
  "some cards on this map were left out, because this digest is bounded.";

/**
 * What the digest's composer is handed: records and reading LINES only. There
 * is deliberately no notes argument and no reading-text argument — a body has
 * no door into this module.
 */
export interface InterpreterDigestInput {
  references: readonly GroundReference[];
  asks: readonly AskCard[];
  sessions: readonly SessionCard[];
  readings: readonly Reading[];
  links: readonly GroundLink[];
  /**
   * Each card's state as the loaded view already knows it (paper: current,
   * changed, missing, unreadable, unread). PROMPT MATERIAL ONLY; the composer
   * never stats a file. A card the map has no state for shows no state.
   */
  states: Readonly<Record<string, ReadingState>>;
}

/** The digest's kinds, in the vocabulary's words. */
type DigestKind = "reference" | "ask" | "session";

/** One entry before it becomes a line. */
interface DigestEntry {
  name: string;
  kind: DigestKind;
  about: string;
  state: ReadingState | null;
  slug: string;
}

/** The one line about a card, from its reading's metadata — never its text. */
function aboutOfReading(reading: Reading | null): string {
  if (reading === null) return "no reading yet";
  if (reading.form === "distilled") return "an artifact copied from a card";
  if (reading.form === "selection") {
    return "a copy of words chosen on another card";
  }
  if (reading.form === "url") {
    const extract = readingExtract(reading);
    if (extract === "page") return "a page at " + pageHost(reading.from);
    if (extract === "video") return "a video";
    if (extract === "image") return "an image";
    return "a web address";
  }
  const name = readingFileName(reading.from);
  const extract = readingExtract(reading);
  if (extract === "image") return "an image, " + name;
  if (extract === "video") return "a video, " + name;
  if (extract === "pdf") return "a pdf, " + name;
  return "a file, " + name;
}

/** The one line about an ask card: its question is not a record until sent. */
function aboutOfAsk(): string {
  return "an ask card";
}

/** The one line about a session card, from its tool row (never its transcript). */
function aboutOfSession(session: SessionCard): string {
  return session.tool === "" ? "a run" : "a run with " + session.tool;
}

/** One entry as its digest line: whole, one line, quoted name and wires. */
function lineOf(entry: DigestEntry, wires: readonly string[]): string {
  const state = entry.state === null ? "" : " — " + entry.state;
  const wired =
    wires.length === 0
      ? "no wires"
      : "wires: " + wires.map((name) => JSON.stringify(name)).join(", ");
  return (
    "- " +
    JSON.stringify(entry.name) +
    " — " +
    entry.kind +
    " — " +
    entry.about +
    state +
    " — " +
    wired
  );
}

/**
 * THE DIGEST (story 21.2), pure and total over the loaded view. Cards ride in
 * record order: the reference cards first (the map's own), then the ask cards,
 * then the session cards. Each line names the card's wires by NAME, never by
 * slug, because the model is asked to use the names the person sees.
 *
 * An EMPTY string means there is nothing to say (no cards at all): the caller
 * omits the section rather than sending a heading with nothing under it.
 */
export function interpreterDigest(input: InterpreterDigestInput): string {
  const namesBySlug = new Map<string, string>();
  for (const reference of input.references) {
    if (!namesBySlug.has(reference.on)) namesBySlug.set(reference.on, reference.name);
  }
  for (const ask of input.asks) {
    if (!namesBySlug.has(ask.on)) namesBySlug.set(ask.on, ask.name);
  }
  for (const session of input.sessions) {
    if (!namesBySlug.has(session.on)) namesBySlug.set(session.on, session.name);
  }

  // WIRES, resolved to names, once. A wire whose other end is not a card the
  // digest can name is simply not listed (the map may hold a dangling link).
  const wiresBySlug = new Map<string, string[]>();
  const addWire = (from: string, to: string): void => {
    const name = namesBySlug.get(to);
    if (name === undefined) return;
    const list = wiresBySlug.get(from) ?? [];
    if (list.length >= INTERPRETER_DIGEST_MAX_WIRES) return;
    if (!list.includes(name)) list.push(name);
    wiresBySlug.set(from, list);
  };
  for (const link of input.links) {
    addWire(link.from, link.to);
    addWire(link.to, link.from);
  }

  const readingsBySlug = new Map<string, Reading>();
  for (const reading of input.readings) {
    if (!readingsBySlug.has(reading.on)) readingsBySlug.set(reading.on, reading);
  }

  const entries: DigestEntry[] = [];
  for (const reference of input.references) {
    entries.push({
      name: reference.name,
      kind: "reference",
      about: aboutOfReading(readingsBySlug.get(reference.on) ?? null),
      // A card the loaded view has no state for shows no state: "unread" is
      // the state rule's word for NO reading line, and this composer does not
      // stat a file to learn it.
      state: input.states[reference.on] ?? null,
      slug: reference.on,
    });
  }
  for (const ask of input.asks) {
    entries.push({
      name: ask.name,
      kind: "ask",
      about: aboutOfAsk(),
      state: null,
      slug: ask.on,
    });
  }
  for (const session of input.sessions) {
    entries.push({
      name: session.name,
      kind: "session",
      about: aboutOfSession(session),
      state: null,
      slug: session.on,
    });
  }

  if (entries.length === 0) return "";

  // THE BOUND, applied to WHOLE entries in order: the count first, then the
  // bytes, and the first entry that does not fit stops the list (a later
  // shorter entry never jumps a longer one — the order is the meaning).
  const lines: string[] = [];
  let omitted = false;
  for (const entry of entries) {
    if (lines.length >= INTERPRETER_DIGEST_MAX_CARDS) {
      omitted = true;
      break;
    }
    const line = lineOf(entry, wiresBySlug.get(entry.slug) ?? []);
    const candidate = [...lines, line].join("\n");
    if (utf8ByteLength(candidate) > INTERPRETER_DIGEST_MAX_BYTES) {
      omitted = true;
      break;
    }
    lines.push(line);
  }
  if (omitted) lines.push(INTERPRETER_DIGEST_OMITTED_SENTENCE);
  return lines.join("\n");
}
