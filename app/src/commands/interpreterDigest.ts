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
 *
 * STORY 21.9 — THE DIGEST SEES EVERY MAP (ADR-0038's 2026-11-20 amendment: the
 * command card is a PRIMARY way to use the app and it is mounted on every map,
 * so a digest that could only describe the ground map made the card a dead box
 * on the other two). The composer is now MAP-AWARE — {@link interpreterDigestOf}
 * takes the map's own records and answers in that map's vocabulary:
 *
 *   - ground  — the cards, exactly as before (this function is untouched, which
 *               is what keeps the ground digest byte-identical);
 *   - concept — the words, by NAME only. A word's memory is a BODY, so the
 *               concept input's shape carries a slug and a name and no memory
 *               at all: there is no door for one to ride.
 *   - dynamics — whatever that map's records hold: the playing set's words, the
 *               signed links, the named loops, the claims (as TARGETS only —
 *               never their words) and the quantities (never a word's text).
 *
 * WHAT DOES NOT CHANGE: names, kinds and one line about, never a body, for
 * every map; the same two bounds; whole entries only; ONE sentence when the
 * list is short, with no count in it. PROVISIONAL: the concept and dynamics
 * line shapes and their omitted sentences.
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

/* ------------------------------------------------------------------ *
 * STORY 21.9 — THE OTHER TWO MAPS' DIGESTS
 *
 * The ground composer above is untouched on purpose: the same records must
 * compose the same bytes (a test pins the exact text). Everything below is the
 * SAME discipline on the other maps' records — names, kinds, one line about,
 * the same bounds, whole items only, ONE sentence when the list is short — and
 * the same absence of a door for a body.
 * ------------------------------------------------------------------ */

/**
 * One item as the digest may see it. The concept input's shape is a slug and a
 * name and NOTHING else: a word's file also holds its memory, and a digest that
 * could hold one is how prose ends up in a prompt. The record's own type is
 * deliberately not imported — the narrowing happens where a caller hands it in.
 */
export interface DigestWord {
  /** Record identity: the word's file slug (the mention's key). */
  slug: string;
  /** The person's coined name. */
  name: string;
}

/** The concept map's digest input: its words, by name only. */
export interface ConceptDigestInput {
  words: readonly DigestWord[];
}

/** One signed link as the digest may see it: the pair and its authored sign. */
export interface DynamicsDigestLink {
  from: string;
  to: string;
  sign: "+" | "-";
}

/** One named loop as the digest may see it: its name and its slug. */
export interface DynamicsDigestLoop {
  name: string;
  slug: string;
}

/**
 * What a claim or a quantity is about, in the digest's own words. The record's
 * target union is mirrored here WITHOUT the claim's text: an assumption is
 * prose the person keeps revisable, and a body has no door into this module.
 */
export type DynamicsDigestTarget =
  | { type: "word"; slug: string }
  | { type: "link"; from: string; to: string }
  | { type: "loop"; slug: string }
  | { type: "spot" };

/** One claim, as its TARGET only — never its words. */
export interface DynamicsDigestAssumption {
  target: DynamicsDigestTarget;
}

/** One quantity, as its target and whether a number was stated. */
export interface DynamicsDigestQuantity {
  target: DynamicsDigestTarget;
  /** A stated amount rides as its own fact; an absent amount is a visible unknown. */
  stated: boolean;
}

/**
 * The dynamics map's digest input: whatever that map's records hold. `names`
 * is every word on the map by slug, so a link or a claim can be NAMED the way
 * the person sees it rather than cited by a slug; `playingSet` says whether the
 * map plays at all (absence is a fact, not an emptiness to hide).
 */
export interface DynamicsDigestInput {
  names: Readonly<Record<string, string>>;
  playingSet: boolean;
  words: readonly DigestWord[];
  links: readonly DynamicsDigestLink[];
  loops: readonly DynamicsDigestLoop[];
  assumptions: readonly DynamicsDigestAssumption[];
  quantities: readonly DynamicsDigestQuantity[];
}

/** The one sentence a bounded concept digest ends with (PROVISIONAL). */
export const INTERPRETER_DIGEST_WORDS_OMITTED_SENTENCE =
  "some words on this map were left out, because this digest is bounded.";

/** The one sentence a bounded dynamics digest ends with (PROVISIONAL). */
export const INTERPRETER_DIGEST_ITEMS_OMITTED_SENTENCE =
  "some items on this map were left out, because this digest is bounded.";

/**
 * The one sentence a dynamics digest opens with when no playing set has been
 * accepted (PROVISIONAL): the map's own rule is that nothing plays without one,
 * so the model is told before it is offered any content.
 */
export const INTERPRETER_DIGEST_NO_SET_SENTENCE =
  "no playing set is accepted on this map yet, so nothing here plays.";

/** One digest line off the ground map: name, kind and ONE line about. */
interface MapEntry {
  name: string;
  kind: string;
  about: string;
}

/** One entry as its line: whole, one line, quoted name (the ground line's opening). */
function mapLineOf(entry: MapEntry): string {
  return "- " + JSON.stringify(entry.name) + " — " + entry.kind + " — " + entry.about;
}

/**
 * THE SAME BOUND, for the other maps' entries: the count first, then the bytes,
 * WHOLE ENTRIES ONLY — the first entry that does not fit stops the list, and the
 * one qualitative sentence says the list is short. Never a count of what was
 * left out (the app has no counters, and one dressed as context would be one).
 */
function boundedMapLines(
  head: string,
  entries: readonly MapEntry[],
  omittedSentence: string,
): string {
  if (entries.length === 0 && head === "") return "";
  const lines: string[] = head === "" ? [] : [head];
  let omitted = false;
  for (const entry of entries) {
    if (lines.length >= INTERPRETER_DIGEST_MAX_CARDS) {
      omitted = true;
      break;
    }
    const candidate = [...lines, mapLineOf(entry)].join("\n");
    if (utf8ByteLength(candidate) > INTERPRETER_DIGEST_MAX_BYTES) {
      omitted = true;
      break;
    }
    lines.push(mapLineOf(entry));
  }
  if (omitted) lines.push(omittedSentence);
  return lines.join("\n");
}

/**
 * THE CONCEPT MAP'S DIGEST (story 21.9): its words, each with its name and one
 * line about, and NO memory. An empty string means the map holds no words, and
 * the caller omits the section rather than sending a heading with nothing
 * under it.
 */
export function conceptDigest(input: ConceptDigestInput): string {
  return boundedMapLines(
    "",
    input.words.map((word) => ({
      name: word.name,
      kind: "word",
      about: "a coined word",
    })),
    INTERPRETER_DIGEST_WORDS_OMITTED_SENTENCE,
  );
}

/**
 * THE DYNAMICS MAP'S DIGEST (story 21.9): whatever that map's records hold —
 * the playing set's words, the signed links, the named loops, the claims (as
 * their targets, never their words) and the quantities (as targets and whether
 * a number was stated). Rendered in that order, which is also the order the
 * bound trims: the model reads the map's shape from the top.
 *
 * NO AMOUNT VALUE rides. A quantity's number is the map's content, and the
 * digest's job is to let the model NAME what is there, not to restate it.
 */
export function dynamicsDigest(input: DynamicsDigestInput): string {
  const loopNames = new Map(input.loops.map((loop) => [loop.slug, loop.name]));
  const nameOf = (slug: string): string => input.names[slug] ?? slug;
  const labelOf = (target: DynamicsDigestTarget): string => {
    switch (target.type) {
      case "word":
        return nameOf(target.slug);
      case "link":
        return nameOf(target.from) + " → " + nameOf(target.to);
      case "loop":
        return loopNames.get(target.slug) ?? target.slug;
      case "spot":
        return "a spot on the map";
    }
  };

  const entries: MapEntry[] = [];
  for (const word of input.words) {
    entries.push({ name: word.name, kind: "word", about: "in the playing set" });
  }
  for (const link of input.links) {
    entries.push({
      name: nameOf(link.from) + " → " + nameOf(link.to),
      kind: "link",
      about: "a signed link, sign " + link.sign,
    });
  }
  for (const loop of input.loops) {
    entries.push({ name: loop.name, kind: "loop", about: "a named loop of words" });
  }
  for (const assumption of input.assumptions) {
    entries.push({
      name: labelOf(assumption.target),
      kind: "assumption",
      about: "a claim kept open",
    });
  }
  for (const quantity of input.quantities) {
    entries.push({
      name: labelOf(quantity.target),
      kind: "quantity",
      about: quantity.stated ? "a stated number" : "a number not stated yet",
    });
  }
  return boundedMapLines(
    input.playingSet ? "" : INTERPRETER_DIGEST_NO_SET_SENTENCE,
    entries,
    INTERPRETER_DIGEST_ITEMS_OMITTED_SENTENCE,
  );
}

/** What {@link interpreterDigestOf} composes, per map. */
export type MapDigestInput =
  | ({ map: "ground" } & InterpreterDigestInput)
  | ({ map: "concept" } & ConceptDigestInput)
  | ({ map: "dynamics" } & DynamicsDigestInput);

/**
 * THE MAP-AWARE DIGEST (story 21.9): one door, the map's own vocabulary. The
 * ground branch is the function above unchanged — that is what keeps the ground
 * path's bytes identical — and the other two are their own composers, so no
 * map's input shape can carry another map's body.
 */
export function interpreterDigestOf(input: MapDigestInput): string {
  switch (input.map) {
    case "ground":
      return interpreterDigest(input);
    case "concept":
      return conceptDigest(input);
    case "dynamics":
      return dynamicsDigest(input);
  }
}
