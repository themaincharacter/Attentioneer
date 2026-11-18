import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine } from "../lib/serialize";
import type { GroundLink } from "./groundLinks";
import { isRunOutcome, type RunOutcome } from "./prisms";
import type { ReadingForm } from "./readings";
import { mapDir } from "./records";

/**
 * THE GROUND MAP'S HISTORY (story 16.10): one line per AUTHORED move, and
 * never one for looking around.
 *
 *   map/ground-history.jsonl   {"v":1,"t":<ms>,"type":"card.add",...}
 *
 * WHY IT EXISTS: a later story wants to replay, undo or review the board, and
 * an agent should be able to see how the map got where it is. This file is the
 * record of the PERSON'S MOVES — the map's own past, not a meter of anything.
 *
 * WHY APPEND-ONLY: a move already made cannot be taken back by rewriting the
 * log. Every line is a fact about a moment that happened, so no line is ever
 * rewritten, reordered or deleted — a later move may only add after the
 * earlier bytes, which is what lets a reader trust that a prefix means the
 * same thing it meant yesterday. Repairing or compacting the file would let
 * the app quietly forget a move, so it never does.
 *
 * WHY NO CONTENT: a note is the person's words and a reading is a copy of
 * their file; neither belongs in a log that a future story, agent or shared
 * folder may read. A line carries the MOVE — slugs, geometry, the storage
 * form, a byte count, and a file's NAME where the move needs to name one —
 * never the text. The log records THAT a note changed, not what it says.
 *
 * WHY A BASELINE: a replay that starts mid-history cannot know where the board
 * began. The first time the file appears, one baseline line goes in BEFORE the
 * first event, and now a reader can tell "the map started here" from "the log
 * starts here". It is one line and no state dump: the records beside it are
 * the state.
 *
 * A MALFORMED LINE IS PRESERVED AND REPORTED, never dropped and never
 * repaired (ADR-0009's honesty surfaces): the loader hands it to the ground
 * notices group and every append leaves the earlier bytes exactly as they
 * were. An append that fails is ONE sentence in that group too — the move
 * itself already landed (the records are the truth) and is never undone.

 * STORY 17.8 — THE ASK CARDS' OWN MOVES, STRUCTURE ONLY. Six events name
 * what happened to an ask card and never a word of it: `ask.add` (the slug and
 * the anchor it is about), `ask.remove` and `ask.restore` (the slug),
 * `ask.reanchor` (the slug and the NEW anchor), `ask.fork` (the new slug, the
 * parent's slug and how many of the parent's turns it carries) and `ask.turn`
 * (the slug and the turn's ENDING). A conversation is a document held by its
 * own file (`map/asks/<slug>.jsonl`); it is never quoted, previewed, sized or
 * counted here — the same rule the notes and the readings already live by.
 *
 * THE TURN'S ENDING IS THE PRISM'S OUTCOME. `ask.turn` carries exactly the two
 * words the `ask` Change's outcome carries — `answered` or `no-response` —
 * because the same fact is said twice and the two records must never disagree.
 * A stopped, broken or timed-out turn is `no-response` in BOTH, even when the
 * card still shows a partial (the partial is a view, never an answer).
 *
 * WHERE A TURN'S LINE SITS (the stated order, story 17.4 plus this story):
 * first the PRISM the sending turn made, then the conversation line that names
 * its id, then `ask.turn`. The two records join by the PRISM's id; this log
 * only says the turn happened and how it ended. A turn that never left the app
 * makes no PRISM and therefore no `ask.turn` line either.
 *
 * STORY 18.5 — THE SESSION CARDS' OWN MOVES, STRUCTURE ONLY. Five events name
 * what happened to a session card and never a word of what its runs said:
 * `session.add`, `session.remove` and `session.restore` (the slug),
 * `session.run` (the slug and the run's ENDING) and `session.result` (the card
 * that was made, and the session it came from). A run's transcript is a
 * document held by its own file (`map/sessions/<slug>.jsonl`); it is never
 * quoted, previewed, sized or counted here.
 *
 * A RUN'S ENDING IS THE PRISM'S OUTCOME, through ONE mapping (`runOutcomeOf` in
 * map/sessions.ts): `answered` only for a completed run, `no-response` for a
 * stop, a failure, a timeout or a dead connection. The PRISM's `run` Change and
 * this line are the same fact said twice.
 *
 * Written through the ground family's per-file queue (useGround), AFTER the
 * record write the line describes, so a reader never sees a line for a move
 * that did not happen.
 *
 * NOT YET: replay, undo, redo, branching history, a history surface, and the
 * concept map's own history. This story only writes the lines down.
 *
 * PROVISIONAL (the story's artifact, before an ADR): the file name, the event
 * vocabulary, the baseline line, whether t (ms) is carried, the exact payload
 * keys, and the notice wording. The line's key order is the app's canonical
 * JSONL order (sorted), not the illustrative order in the story.
 */

/** The history's file name, inside map/ beside the records (PROVISIONAL). */
export const HISTORY_FILE = "ground-history.jsonl";

/** Where the history lives: <workspace>/map/ground-history.jsonl. */
export function historyPath(workspacePath: string): string {
  return mapDir(workspacePath) + "/" + HISTORY_FILE;
}

/** The line's version, so a later shape can be told apart from this one. */
export const HISTORY_VERSION = 1;

/**
 * How an ask card's sending turn ended, in the PRISM's own two words (story
 * 17.8). The closed pair is the `ask` Change's outcome vocabulary: a completed
 * turn is `answered`; a stop, a break and a timeout are all `no-response`.
 * PROVISIONAL with the rest of the event shape.
 */
export const ASK_TURN_ENDINGS = ["answered", "no-response"] as const;
export type AskTurnEnding = (typeof ASK_TURN_ENDINGS)[number];

/** Is a value one of the two endings an ask turn's line may carry? */
export function isAskTurnEnding(value: unknown): value is AskTurnEnding {
  return (
    typeof value === "string" &&
    (ASK_TURN_ENDINGS as readonly string[]).includes(value)
  );
}

/**
 * The event vocabulary. Each line carries only what the move needs: a slug,
 * a point, a storage form, a size, or two slugs. No text, ever.
 */
export type HistoryEvent =
  | { readonly v: 1; readonly t: number; readonly type: "baseline" }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "card.add";
      readonly slug: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "card.move";
      readonly slug: string;
      readonly x: number;
      readonly y: number;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "card.remove";
      readonly slug: string;
    }
  | {
      // STORY 16.13 (shortlist item 1): a delete is reversible, so the log
      // records the RESTORE too. A silent restore would break the one promise
      // the log makes: every authored move is on it. PROVISIONAL name/payload.
      readonly v: 1;
      readonly t: number;
      readonly type: "card.restore";
      readonly slug: string;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "reading.take" | "reading.refresh";
      readonly slug: string;
      readonly form: ReadingForm;
      readonly bytes: number | null;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "reading.repoint";
      readonly slug: string;
      readonly form: ReadingForm;
      /** The NEW target's file NAME only — never the path (content rule). */
      readonly from: string;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "note.set" | "note.remove";
      readonly slug: string;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "link.add" | "link.remove";
      readonly from: string;
      readonly to: string;
    }
  // STORY 17.8 — the ask cards' own moves. Every one names structure only:
  // slugs, an anchor, a fork's parent and branch count, a turn's ending. There
  // is no key here for a word, a preview or a content size, by construction.
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "ask.add";
      readonly slug: string;
      /** The reference the new card is ABOUT (a slug, never a link). */
      readonly anchor: string;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "ask.remove" | "ask.restore";
      readonly slug: string;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "ask.reanchor";
      readonly slug: string;
      /** The NEW anchor's slug; the old one is not restated. */
      readonly anchor: string;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "ask.fork";
      readonly slug: string;
      /** The ask card this one was forked from (a slug). */
      readonly from: string;
      /** How many of the parent's turns the fork carries (a count of TURNS). */
      readonly carry: number;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "ask.turn";
      readonly slug: string;
      /** The SAME two words the PRISM's ask outcome carries. */
      readonly ending: AskTurnEnding;
    }
  // STORY 18.5 — THE SESSION CARDS' OWN MOVES. Five events, structure only: a
  // slug, a pair of slugs, or a run's ending. There is no key here for a word,
  // a command, a directory, an argv or a count of entries, by construction.
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "session.add";
      readonly slug: string;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "session.remove" | "session.restore";
      readonly slug: string;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "session.run";
      readonly slug: string;
      /** The SAME two words the PRISM's run outcome carries (one mapping). */
      readonly ending: RunOutcome;
    }
  | {
      readonly v: 1;
      readonly t: number;
      readonly type: "session.result";
      /** The CARD that was made from the run (a slug, never a link). */
      readonly slug: string;
      /** The session card the run was made in (a slug). */
      readonly from: string;
    };

/**
 * THE BASELINE, as an event: it says only "this is where the log starts".
 * No state dump, no clock beyond t, nothing to disagree with the records.
 */
export function baselineEvent(t: number): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "baseline" };
}

/** The baseline AS A LINE — the story names this seam baselineLine. */
export function baselineLine(t: number): string {
  return serializeHistoryEvent(baselineEvent(t));
}

/** A card was added at a point, with its name-derived slug. */
export function cardAddEvent(
  t: number,
  slug: string,
  x: number,
  y: number,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "card.add", slug, x, y };
}

/** A card was dropped at a new point (one authored move on release). */
export function cardMoveEvent(
  t: number,
  slug: string,
  x: number,
  y: number,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "card.move", slug, x, y };
}

/** A card was removed (its own record only; the cascade is separate lines). */
export function cardRemoveEvent(t: number, slug: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "card.remove", slug };
}

/**
 * STORY 16.13 — the card CAME BACK through the toast's Restore: the same slug
 * and point, logged as its own move. The links the restore re-adds are their
 * own lines (links are their own records), so the log reads remove → restore →
 * link.adds, never a deletion that quietly undid itself.
 */
export function cardRestoreEvent(t: number, slug: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "card.restore", slug };
}

/** The source was read at creation: the storage form and the file's size. */
export function readingTakeEvent(
  t: number,
  slug: string,
  form: ReadingForm,
  bytes: number | null,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "reading.take", slug, form, bytes };
}

/** The person pressed refresh: a new read of the SAME file. */
export function readingRefreshEvent(
  t: number,
  slug: string,
  form: ReadingForm,
  bytes: number | null,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "reading.refresh", slug, form, bytes };
}

/** The card was pointed at ANOTHER file: its form and the new file's NAME. */
export function readingRepointEvent(
  t: number,
  slug: string,
  form: ReadingForm,
  from: string,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "reading.repoint", slug, form, from };
}

/** The person saved a note (the words themselves stay out of the log). */
export function noteSetEvent(t: number, slug: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "note.set", slug };
}

/** The person emptied a note, so its file went away. */
export function noteRemoveEvent(t: number, slug: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "note.remove", slug };
}

/** A wordless link was drawn from one card to another. */
export function linkAddEvent(t: number, from: string, to: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "link.add", from, to };
}

/** A link was removed (by its own verb, or by the delete cascade below). */
export function linkRemoveEvent(
  t: number,
  from: string,
  to: string,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "link.remove", from, to };
}

/* ------------------------------------------------------------------------- *
 * THE ASK CARDS' MOVES (story 17.8) — six structural events, no words.
 *
 * Each constructor takes only what the line needs: a slug, an anchor, a fork's
 * parent and branch count, or a turn's ending. Nothing here can accept a
 * question, an answer, a preview or a size of content, because the payload's
 * key set has no slot for one (the PRISM's structural rule, one family over).
 * ------------------------------------------------------------------------- */

/** One ask card was made, about one reference. */
export function askAddEvent(
  t: number,
  slug: string,
  anchor: string,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "ask.add", slug, anchor };
}

/** One ask card was removed (its conversation goes with it, restored by Restore). */
export function askRemoveEvent(t: number, slug: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "ask.remove", slug };
}

/** The toast's Restore put the ask card (and its conversation) back. */
export function askRestoreEvent(t: number, slug: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "ask.restore", slug };
}

/** One ask card was re-anchored: the NEW anchor's slug, nothing else. */
export function askReanchorEvent(
  t: number,
  slug: string,
  anchor: string,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "ask.reanchor", slug, anchor };
}

/** One ask card was forked: the new card, the parent and the carried count. */
export function askForkEvent(
  t: number,
  slug: string,
  from: string,
  carry: number,
): HistoryEvent {
  return {
    v: HISTORY_VERSION,
    t,
    type: "ask.fork",
    slug,
    from,
    carry: Math.max(0, Math.floor(carry)),
  };
}

/**
 * One sending turn happened, with the ENDING the PRISM recorded for the same
 * turn. `answered` and `no-response` are the PRISM's own two words; the
 * caller forms it from the same function the PRISM's outcome comes from, so the
 * two records can never disagree. A turn that never left the app is no Move and
 * gets no line.
 */
export function askTurnEvent(
  t: number,
  slug: string,
  ending: AskTurnEnding,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "ask.turn", slug, ending };
}

/* ------------------------------------------------------------------------- *
 * THE SESSION CARDS' MOVES (story 18.5) — five structural events, no words.
 *
 * Each constructor takes only what the line needs: a slug, a pair of slugs, or
 * a run's ending. Nothing here can accept the run's text, its prompt, the tool
 * command, a directory, an argv or a count of entries, because the payload's
 * key set has no slot for one (the PRISM's structural rule, one family over).
 * ------------------------------------------------------------------------- */

/** One session card was made, bound to one tool row (named in the record). */
export function sessionAddEvent(t: number, slug: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "session.add", slug };
}

/** One session card was removed (its transcript goes with it, restored by Restore). */
export function sessionRemoveEvent(t: number, slug: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "session.remove", slug };
}

/** The toast's Restore put the session card (and its transcript) back. */
export function sessionRestoreEvent(t: number, slug: string): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "session.restore", slug };
}

/**
 * One run happened, with the ENDING the PRISM recorded for the same run.
 * `answered` and `no-response` are the PRISM's own two words; the caller forms
 * it from the same function the PRISM's outcome comes from (`runOutcomeOf`), so
 * the two records can never disagree. A run that never started is no Move and
 * gets no line.
 */
export function sessionRunEvent(
  t: number,
  slug: string,
  ending: RunOutcome,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "session.run", slug, ending };
}

/**
 * One completed run's text became a card: the NEW card's slug and the session
 * card it came from. The copy's words are the card's reading, never this line's.
 */
export function sessionResultEvent(
  t: number,
  slug: string,
  from: string,
): HistoryEvent {
  return { v: HISTORY_VERSION, t, type: "session.result", slug, from };
}

/**
 * THE DELETE'S LINES: card.remove first, then one link.remove for every link
 * the cascade took (links are their own records, so their passing is its own
 * move). The caller hands the links it actually removed — in file order — and
 * this only names them; it reads and writes nothing.
 */
export function cardRemovalEvents(
  t: number,
  slug: string,
  removedLinks: readonly GroundLink[],
): HistoryEvent[] {
  return [
    cardRemoveEvent(t, slug),
    ...removedLinks.map((link) => linkRemoveEvent(t, link.from, link.to)),
  ];
}

/** One event as its canonical JSONL line (no trailing newline). */
export function serializeHistoryEvent(event: HistoryEvent): string {
  return canonicalJsonlLine(event);
}

/** A parsed JSON value that is a plain object, or null. */
function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** A non-empty string field, or null when the line did not carry one. */
function stringField(
  record: Record<string, unknown>,
  key: string,
): string | null {
  const value = record[key];
  return typeof value === "string" && value !== "" ? value : null;
}

/** A finite numeric field, or null. */
function numberField(
  record: Record<string, unknown>,
  key: string,
): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The two slug keys a link event needs. */
function linkFields(
  record: Record<string, unknown>,
): { from: string; to: string } | null {
  const from = stringField(record, "from");
  const to = stringField(record, "to");
  return from !== null && to !== null ? { from, to } : null;
}

/**
 * Parse ONE line into an event. Anything out of shape — not JSON, not an
 * object, a version this app does not write, an unknown type, a missing or
 * mistyped payload key — is null: the caller KEEPS the raw line and reports
 * it, never guesses it into an event and never drops it.
 */
export function parseHistoryEvent(line: string): HistoryEvent | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const record = asRecord(value);
  if (record === null) return null;
  if (record.v !== HISTORY_VERSION) return null;
  const t = numberField(record, "t");
  if (t === null) return null;
  switch (record.type) {
    case "baseline":
      return baselineEvent(t);
    case "card.add":
    case "card.move": {
      const slug = stringField(record, "slug");
      const x = numberField(record, "x");
      const y = numberField(record, "y");
      if (slug === null || x === null || y === null) return null;
      return record.type === "card.add"
        ? cardAddEvent(t, slug, x, y)
        : cardMoveEvent(t, slug, x, y);
    }
    case "card.remove": {
      const slug = stringField(record, "slug");
      return slug === null ? null : cardRemoveEvent(t, slug);
    }
    case "card.restore": {
      const slug = stringField(record, "slug");
      return slug === null ? null : cardRestoreEvent(t, slug);
    }
    case "reading.take":
    case "reading.refresh": {
      const slug = stringField(record, "slug");
      const form = stringField(record, "form");
      const raw = record.bytes;
      const bytes =
        raw === undefined || raw === null
          ? null
          : typeof raw === "number" && Number.isFinite(raw)
            ? raw
            : null;
      if (slug === null || form === null) return null;
      return record.type === "reading.take"
        ? readingTakeEvent(t, slug, form as ReadingForm, bytes)
        : readingRefreshEvent(t, slug, form as ReadingForm, bytes);
    }
    case "reading.repoint": {
      const slug = stringField(record, "slug");
      const form = stringField(record, "form");
      const from = stringField(record, "from");
      if (slug === null || form === null || from === null) return null;
      return readingRepointEvent(t, slug, form as ReadingForm, from);
    }
    case "note.set":
    case "note.remove": {
      const slug = stringField(record, "slug");
      if (slug === null) return null;
      return record.type === "note.set"
        ? noteSetEvent(t, slug)
        : noteRemoveEvent(t, slug);
    }
    case "link.add":
    case "link.remove": {
      const pair = linkFields(record);
      if (pair === null) return null;
      return record.type === "link.add"
        ? linkAddEvent(t, pair.from, pair.to)
        : linkRemoveEvent(t, pair.from, pair.to);
    }
    // STORY 17.8 — the ask cards' moves. Each reads exactly the keys its
    // constructor writes; a line missing one, or carrying a turn ending outside
    // the PRISM's two words, stays PRESERVED and reported, never guessed at.
    case "ask.add": {
      const slug = stringField(record, "slug");
      const anchor = stringField(record, "anchor");
      if (slug === null || anchor === null) return null;
      return askAddEvent(t, slug, anchor);
    }
    case "ask.remove":
    case "ask.restore": {
      const slug = stringField(record, "slug");
      if (slug === null) return null;
      return record.type === "ask.remove"
        ? askRemoveEvent(t, slug)
        : askRestoreEvent(t, slug);
    }
    case "ask.reanchor": {
      const slug = stringField(record, "slug");
      const anchor = stringField(record, "anchor");
      if (slug === null || anchor === null) return null;
      return askReanchorEvent(t, slug, anchor);
    }
    case "ask.fork": {
      const slug = stringField(record, "slug");
      const from = stringField(record, "from");
      const carry = numberField(record, "carry");
      if (slug === null || from === null || carry === null) return null;
      if (!Number.isSafeInteger(carry) || carry < 0) return null;
      return askForkEvent(t, slug, from, carry);
    }
    case "ask.turn": {
      const slug = stringField(record, "slug");
      if (slug === null) return null;
      if (!isAskTurnEnding(record.ending)) return null;
      return askTurnEvent(t, slug, record.ending);
    }
    // STORY 18.5 — the session cards' moves. Each reads exactly the keys its
    // constructor writes; a run ending outside the PRISM's two words stays
    // PRESERVED and reported, never guessed at.
    case "session.add":
    case "session.remove":
    case "session.restore": {
      const slug = stringField(record, "slug");
      if (slug === null) return null;
      if (record.type === "session.add") return sessionAddEvent(t, slug);
      return record.type === "session.remove"
        ? sessionRemoveEvent(t, slug)
        : sessionRestoreEvent(t, slug);
    }
    case "session.run": {
      const slug = stringField(record, "slug");
      if (slug === null) return null;
      if (!isRunOutcome(record.ending)) return null;
      return sessionRunEvent(t, slug, record.ending);
    }
    case "session.result": {
      const slug = stringField(record, "slug");
      const from = stringField(record, "from");
      if (slug === null || from === null) return null;
      return sessionResultEvent(t, slug, from);
    }
    default:
      return null;
  }
}

/** A read of map/ground-history.jsonl: what parsed and what is kept raw. */
export interface ParsedHistory {
  /** Every readable event, in FILE ORDER. */
  events: HistoryEvent[];
  /** Raw non-empty lines that did not parse — reported, never dropped. */
  malformed: string[];
  /** The file exists (a workspace with no authored move has none). */
  exists: boolean;
}

/**
 * Read the file's lines. A BOM and CRLF from a hand edit are tolerated; a
 * blank line is nothing, not a malformed event. An unparsable line is kept
 * VERBATIM so an append can leave it exactly where it was.
 */
export function parseHistory(text: string): ParsedHistory {
  const events: HistoryEvent[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line.trim() === "") continue;
    const event = parseHistoryEvent(line);
    if (event === null) malformed.push(line);
    else events.push(event);
  }
  return { events, malformed, exists: true };
}

/** The bridges this family needs; the app passes lib/fs, a test a fake. */
export interface HistoryIo {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
}

/** The real bridges, bound once so the module stays importable in tests. */
export const HISTORY_IO: HistoryIo = { readTextFile, writeTextFile };

/** Read every event and every kept raw line; a missing file is empty. */
export async function readHistory(
  workspacePath: string,
  io: HistoryIo = HISTORY_IO,
): Promise<ParsedHistory> {
  const text = await io.readTextFile(historyPath(workspacePath));
  if (text === null) return { events: [], malformed: [], exists: false };
  return parseHistory(text);
}

/** What one append produced: the file's next bytes and the lines it added. */
export interface HistoryAppend {
  /** The file's complete next content (the earlier bytes are its prefix). */
  text: string;
  /** The lines this append added, in order (the baseline included when new). */
  lines: string[];
  /** True when this append wrote the baseline: the file had no line yet. */
  baseline: boolean;
}

/**
 * ONE append, PURE: the file's current bytes (or null when absent) and the
 * events to add, in the order the move made them. The earlier bytes are handed
 * back as they were — the prefix is never rewritten — and the new lines go
 * after them, one per event. When the file holds no line yet, the baseline
 * goes in FIRST, because a replay needs to know where the log starts.
 *
 * PROVISIONAL: a file left without a final newline gets one before the new
 * line (a line needs an end); that inserted newline is the only byte this
 * module ever adds before the append point, and the earlier content still
 * reads back identically.
 */
export function appendedHistory(
  existing: string | null,
  events: readonly HistoryEvent[],
): HistoryAppend {
  const raw = existing ?? "";
  const prior = raw === "" || raw.endsWith("\n") ? raw : raw + "\n";
  const hasLine = prior.split(/\r?\n/).some((line) => line.trim() !== "");
  const lines: string[] = [];
  const baseline = !hasLine && events.length > 0;
  if (baseline) lines.push(baselineLine(events[0].t));
  for (const event of events) {
    lines.push(serializeHistoryEvent(event));
  }
  if (lines.length === 0) return { text: prior, lines: [], baseline: false };
  return { text: prior + lines.join("\n") + "\n", lines, baseline };
}

/**
 * APPEND the move's events to the file. It reads the bytes, adds the lines and
 * writes the whole content back through the app's one text bridge (there is no
 * append syscall here, and this story adds no Rust): the earlier bytes are
 * never touched, only followed. The caller's queue makes the read and the
 * write one serial step, so no other write can land between them.
 */
export async function appendEvents(
  workspacePath: string,
  events: readonly HistoryEvent[],
  io: HistoryIo = HISTORY_IO,
): Promise<HistoryAppend> {
  const existing = await io.readTextFile(historyPath(workspacePath));
  const append = appendedHistory(existing, events);
  if (append.lines.length > 0) {
    await io.writeTextFile(historyPath(workspacePath), append.text);
  }
  return append;
}

/** The single-event form of appendEvents (the story names this seam). */
export function appendEvent(
  workspacePath: string,
  event: HistoryEvent,
  io: HistoryIo = HISTORY_IO,
): Promise<HistoryAppend> {
  return appendEvents(workspacePath, [event], io);
}

/**
 * THE ONE SENTENCE an append failure answers. It rides the ground notices
 * group and NEVER fails the move that caused it: the records were written
 * first, the move stands, and the log simply says it could not follow.
 */
export const HISTORY_WRITE_REFUSAL =
  "the map changed, but its history could not be written.";

/**
 * ONE queued append, ready for the per-file queue: take the events at the
 * moment the queue runs (after every earlier write), append, and answer the
 * notice. It never rejects — a history failure is one sentence, never a
 * failed move — and an empty event list writes nothing.
 */
export function historyWriteTask(
  workspacePath: string,
  events: () => readonly HistoryEvent[],
  report: (notice: string | null) => void,
  io: HistoryIo = HISTORY_IO,
): () => Promise<void> {
  return async () => {
    try {
      const append = await appendEvents(workspacePath, events(), io);
      if (append.lines.length > 0) report(null);
    } catch {
      report(HISTORY_WRITE_REFUSAL);
    }
  };
}
