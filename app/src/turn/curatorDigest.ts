import {
  askNameFromQuestion,
  type AskCard,
  type AskTurn,
} from "../map/asks";
import type { GroundReference } from "../map/ground";
import {
  distilledSourceSlug,
  pageHost,
  readingExtract,
  readingFileName,
  type Reading,
} from "../map/readings";
import type { SessionCard } from "../map/sessions";
import { utf8ByteLength } from "../lib/textBytes";

/**
 * THE MAP DIGEST (story 17.14) — what the curator is handed about the map it
 * is writing into. PROMPT MATERIAL ONLY: it is composed at the call site,
 * rides one prompt, and is never recorded, cached or rendered.
 *
 * WHY IT EXISTS (ADR-0037's amendment): the curator used to judge importance
 * blind — it saw the question and the reply and nothing else, so every answer
 * looked equally worth keeping. The amendment makes the missing half legal:
 * "it can see material but that's not what I mean here. It sees the big
 * picture of what really matters and should be brief". The digest is that big
 * picture in miniature: the cards on this map, which of them are wired into
 * this ask, and which artifacts this ask has already made. An answer is not
 * attention-worthy because it was returned; it earns a card by adding
 * something the map does not already hold, and this is the only view of the
 * map the curator gets.
 *
 * NO READING TEXT, BY CONSTRUCTION, NOT BY DISCIPLINE. This module's inputs
 * are records plus the READING LINES — never a reading's text, never a note,
 * never a conversation answer. The "one line about" each card is derived from
 * what the card IS (its reading's form, a file name, a page's host, a
 * session's tool) and, for an ask card, the person's own latest question. A
 * card's stored text cannot reach this function because no argument carries
 * it, which is what app/tests/curator-digest.test.ts holds: the builder has
 * no text map to leak.
 *
 * BOUNDED, AND SAYS SO. The digest is for a model with a small budget of
 * attention: {@link DIGEST_MAX_CARDS} entries and {@link DIGEST_MAX_BYTES}
 * bytes, WHOLE ENTRIES ONLY — an entry that does not fit is not clipped, it is
 * left out, and the one qualitative sentence
 * {@link DIGEST_OMITTED_SENTENCE} says the list is short rather than letting
 * the curator believe it has seen the whole map. PROVISIONAL: both bounds, the
 * sentence and every wording below; ADR-0037's amendment settles that the
 * digest exists and is brief, not its exact shape.
 */

/** What a card on this map is, in the one word the digest uses. */
export type DigestKind = "reference" | "ask" | "session";

/** The largest number of card entries a digest carries (PROVISIONAL). */
export const DIGEST_MAX_CARDS = 24;

/** The largest size a digest may reach, in UTF-8 bytes (PROVISIONAL). */
export const DIGEST_MAX_BYTES = 2048;

/**
 * The one qualitative sentence a bounded digest ends with. It says THAT cards
 * were left out, never how many: the curator is told the list is short, not
 * handed a progress count (the app has no counters, and a count here would be
 * one dressed as context).
 */
export const DIGEST_OMITTED_SENTENCE =
  "some cards on this map were left out, because this digest is bounded.";

/**
 * STORY 19.4 — WHICH CARD THE DIGEST IS ANCHORED ON. An ask card's reply is
 * distilled after the ask answered; a session card's completed run is distilled
 * when the person presses its distil verb. The anchor's own entry, the artifacts
 * already made from it and the relations of the cards wired into it are worded
 * by this word, so a run's digest never calls itself an ask.
 */
export type DigestAnchorKind = "ask" | "session";

/** What the digest's composer is handed: records and reading LINES only. */
export interface MapDigestInput {
  /** The card being distilled: its artifact and wire relations are its own. */
  anchorSlug: string;
  /** Whether that card is an ASK card or a SESSION card (story 19.4). */
  anchorKind: DigestAnchorKind;
  /**
   * The cards wired INTO this ask, in wire order, as the view already resolved
   * them (askContextSources is the authority; this module never re-derives the
   * rule). A slug the digest cannot resolve is simply not listed.
   */
  wired: readonly string[];
  references: readonly GroundReference[];
  asks: readonly AskCard[];
  askTurns: Readonly<Record<string, readonly AskTurn[]>>;
  sessions: readonly SessionCard[];
  readings: readonly Reading[];
}

/** One entry before it becomes a line. */
interface DigestEntry {
  name: string;
  kind: DigestKind;
  about: string;
  /** "wired into this ask" / "made from this run" / neither. */
  relation: string | null;
}

/** The one line about a REFERENCE card, from its reading's line (never text). */
function aboutOfReading(reading: Reading | null): string {
  if (reading === null) return "no reading taken yet";
  if (reading.form === "distilled") return "an artifact copied from an ask card";
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

/** The person's latest question in a card, one short line, or null. */
function lastQuestionOf(
  ask: AskCard,
  askTurns: Readonly<Record<string, readonly AskTurn[]>>,
): string | null {
  const turns = askTurns[ask.on] ?? [];
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index]!;
    if (turn.role !== "person") continue;
    const short = askNameFromQuestion(turn.text);
    return short === "" ? null : short;
  }
  return null;
}

/** The one line about a SESSION card, from its tool row (never its transcript). */
function aboutOfSession(session: SessionCard): string {
  return session.tool === "" ? "a run" : "a run with " + session.tool;
}

/** One entry as its digest line: whole, one line, quoted name. */
function lineOf(entry: DigestEntry): string {
  const relation = entry.relation === null ? "" : " (" + entry.relation + ")";
  return (
    "- " +
    JSON.stringify(entry.name) +
    " — " +
    entry.kind +
    " — " +
    entry.about +
    relation
  );
}

/**
 * THE DIGEST (story 17.14), pure and total over the loaded view. Entries ride
 * NEAREST FIRST — the anchor being distilled (an ask card, or since story 19.4
 * a session card), the artifacts already made from it, the cards wired into it,
 * then the rest of the map in record order — because the budget bites from the
 * end: the cards closest to this turn are the last ones a bound should ever
 * drop. Duplicate slugs are listed once (a card that is both an artifact and a
 * wire keeps its artifact line first).
 *
 * An EMPTY string means there is nothing to say (no cards at all): the caller
 * omits the section rather than sending a heading with nothing under it.
 */
export function mapDigest(input: MapDigestInput): string {
  const entries: DigestEntry[] = [];
  const seen = new Set<string>();
  const listing = (entry: DigestEntry, key: string): void => {
    if (seen.has(key)) return;
    seen.add(key);
    entries.push(entry);
  };

  const readingsBy = new Map<string, Reading>();
  for (const reading of input.readings) {
    if (!readingsBy.has(reading.on)) readingsBy.set(reading.on, reading);
  }
  const referenceBy = new Map<string, GroundReference>();
  for (const reference of input.references) {
    if (!referenceBy.has(reference.on)) referenceBy.set(reference.on, reference);
  }
  const askBy = new Map<string, AskCard>();
  for (const ask of input.asks) {
    if (!askBy.has(ask.on)) askBy.set(ask.on, ask);
  }
  const sessionBy = new Map<string, SessionCard>();
  for (const session of input.sessions) {
    if (!sessionBy.has(session.on)) sessionBy.set(session.on, session);
  }

  // 1. THE ANCHOR ITSELF: the card this reply will sit beside. An ask says it
  // is the ask being distilled; a session says what its run is (the same line
  // the rest of the map gets), never a second claim about itself.
  const sessionAnchor = input.anchorKind === "session";
  const ask = askBy.get(input.anchorSlug);
  if (!sessionAnchor && ask !== undefined) {
    listing(
      {
        name: ask.name,
        kind: "ask",
        about: "the ask being distilled now",
        relation: null,
      },
      "ask:" + ask.on,
    );
  }
  if (sessionAnchor) {
    const anchorSession = sessionBy.get(input.anchorSlug);
    if (anchorSession !== undefined) {
      listing(
        {
          name: anchorSession.name,
          kind: "session",
          about: aboutOfSession(anchorSession),
          relation: null,
        },
        "session:" + anchorSession.on,
      );
    }
  }

  // 2. THE ARTIFACTS ALREADY MADE FROM THIS CARD: a distilled reading whose
  // provenance names it. The reading IS the relation; no note is read.
  for (const reading of input.readings) {
    if (reading.form !== "distilled") continue;
    if (distilledSourceSlug(reading) !== input.anchorSlug) continue;
    const reference = referenceBy.get(reading.on);
    if (reference === undefined) continue;
    listing(
      {
        name: reference.name,
        kind: "reference",
        about: aboutOfReading(reading),
        relation: sessionAnchor ? "made from this run" : "made from this ask",
      },
      "reference:" + reference.on,
    );
  }

  // 3. THE CARDS WIRED INTO THIS CARD, in the view's wire order.
  const wiredRelation = sessionAnchor
    ? "wired into this run"
    : "wired into this ask";
  for (const slug of input.wired) {
    const reference = referenceBy.get(slug);
    if (reference !== undefined) {
      listing(
        {
          name: reference.name,
          kind: "reference",
          about: aboutOfReading(readingsBy.get(slug) ?? null),
          relation: wiredRelation,
        },
        "reference:" + slug,
      );
      continue;
    }
    const wiredAsk = askBy.get(slug);
    if (wiredAsk !== undefined) {
      const question = lastQuestionOf(wiredAsk, input.askTurns);
      listing(
        {
          name: wiredAsk.name,
          kind: "ask",
          about: question === null ? "no question yet" : "asks: " + question,
          relation: wiredRelation,
        },
        "ask:" + slug,
      );
      continue;
    }
    const session = sessionBy.get(slug);
    if (session !== undefined) {
      listing(
        {
          name: session.name,
          kind: "session",
          about: aboutOfSession(session),
          relation: wiredRelation,
        },
        "session:" + slug,
      );
    }
  }

  // 4. THE REST OF THE MAP, in record order, whole entries.
  for (const reference of input.references) {
    listing(
      {
        name: reference.name,
        kind: "reference",
        about: aboutOfReading(readingsBy.get(reference.on) ?? null),
        relation: null,
      },
      "reference:" + reference.on,
    );
  }
  for (const other of input.asks) {
    const question = lastQuestionOf(other, input.askTurns);
    listing(
      {
        name: other.name,
        kind: "ask",
        about: question === null ? "no question yet" : "asks: " + question,
        relation: null,
      },
      "ask:" + other.on,
    );
  }
  for (const session of input.sessions) {
    listing(
      {
        name: session.name,
        kind: "session",
        about: aboutOfSession(session),
        relation: null,
      },
      "session:" + session.on,
    );
  }

  if (entries.length === 0) return "";

  // THE BOUND, applied to WHOLE entries in order: the count first, then the
  // bytes, and the first entry that does not fit stops the list (a later
  // shorter entry never jumps a longer one — the order is the meaning).
  const lines: string[] = [];
  let omitted = false;
  for (const entry of entries) {
    if (lines.length >= DIGEST_MAX_CARDS) {
      omitted = true;
      break;
    }
    const candidate = [...lines, lineOf(entry)].join("\n");
    if (utf8ByteLength(candidate) > DIGEST_MAX_BYTES) {
      omitted = true;
      break;
    }
    lines.push(lineOf(entry));
  }
  if (omitted) lines.push(DIGEST_OMITTED_SENTENCE);
  return lines.join("\n");
}
