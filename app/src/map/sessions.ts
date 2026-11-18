import {
  createDirAll,
  listDir,
  readTextFile,
  removeFile,
  writeTextFile,
} from "../lib/fs";
import { utf8ByteLength } from "../lib/textBytes";
import type { RunOutcome } from "./prisms";
import { canonicalJsonlLine, canonicalText, nextSlug, slugName } from "../lib/serialize";
import { SESSION_RECORD_FILE, SESSION_TRANSCRIPTS_DIR, mapDir } from "./records";

/**
 * THE SESSION CARD'S RECORD FAMILY (Epic 18 story 3): one `map/sessions.txt`
 * line per session card, and one transcript per card under `map/sessions/`.
 *
 *   on: <slug> | name: <the person's words> | x: <int> | y: <int> | tool: <row-id>
 *
 *   map/sessions/<slug>.jsonl   one JSON line per progress entry, in ARRIVAL ORDER
 *
 * A SESSION CARD IS NOT A READING AND NOT AN ASK. It has no source file, no
 * reading text, no note and no anchor: it names ONE TOOL ROW (a row of the
 * app's ACP tool rows, by id — never a key and never a command) and holds what
 * a run of that row reported. It is a citizen BESIDE the reference and the ask
 * cards on the ground map, rendered from the same grammar (name, what this is,
 * the crop).
 *
 * ONE SLUG SPACE, NOW THREE FAMILIES (the epic's ruling, extended): a link, a
 * mention or an anchor must resolve to exactly ONE card, so minting a session
 * card checks ground + asks + sessions and dedupes with the concept map's
 * suffix rule (`nextSlug`). `asks.ts`'s `sharedSlugs` takes all three and is
 * the one check every minting path is handed.
 *
 * THE TRANSCRIPT IS APPEND-ONLY, one line per progress entry, and it holds
 * whatever the run reported with its kind:
 *
 *   {"kind":"started","t":"<ISO>"}
 *   {"kind":"session","id":"<session id>"}
 *   {"kind":"text","text":"<the agent's words, verbatim>"}
 *   {"kind":"tool","name":"<what the tool call was>","status":"<its status>"}
 *   {"kind":"permission","name":"<what was asked>","reply":"allowed-once"|"refused"|"cancelled"|"unanswered"}
 *   {"kind":"ended","ending":"stopped","t":"<ISO>","sentence":"<why, when failed>"}
 *
 * WHAT IS NOT ONE OF THESE: a thought (the agent's private reasoning), a plan
 * and a transport diagnostic are progress the card cannot state honestly as
 * words, a tool call or an ending, so they are not dressed as one. The run's
 * ending carries its ONE sentence, which is why a failed run still says why
 * after a reopen. PROVISIONAL: if a later story wants to show a thought, that
 * is a seventh kind and an ADR's decision — not a quiet promotion here.
 *
 * A SECOND RUN APPENDS AFTER THE PREVIOUS ONE'S `ended` LINE — the transcript
 * is a conversation with the tool, like the ask card's thread, not a snapshot
 * of the last run. ONE RUN PER CARD AT A TIME is the caller's rule (`useGround`
 * holds the live run); this module only writes what it is handed.
 *
 * WHOLE ENTRIES ONLY. Every write reads the file's existing bytes, keeps them
 * as a PREFIX and appends COMPLETE lines; nothing earlier is parsed, repaired
 * or re-serialized, so a hand-edited or malformed line survives and a crash can
 * lose the last entry but can never splice one in half. A line that does not
 * parse is PRESERVED verbatim and reported (ADR-0009's honesty surfaces).
 *
 * NO KEY EVER REACHES THIS FILE. The entry shapes have no field for one, and
 * the sentences this module composes name a TOOL ROW, never a value. The run's
 * declaration (which names a provider row, never its key) lives in
 * `turn/acpRun.ts` and is drawn by the card; it is not a record.
 *
 * STORY 18.5 — A CARD IS REMOVABLE AND ITS TRANSCRIPT IS KEPT HONEST. A delete
 * captures the record line and the transcript's BYTES before unlinking and
 * Restore writes them back verbatim (`removeSessionRecords` /
 * `restoreSessionCard`); a transcript whose card is gone is an ORPHAN, listed by
 * `loadSessionTranscriptsWithOrphans` and never adopted or deleted. A run's
 * ending maps to the PRISM's two words through `runOutcomeOf`, so the record and
 * the log cannot disagree.
 *
 * PROVISIONAL (the story's record shapes, before an ADR settles them): the
 * `sessions.txt` name, the line shape and its key order, the coordinates as
 * ints, the `sessions/` folder name, the six entry kinds and their fields, the
 * optional `sentence` on an ending (the run's one-sentence reason, kept so a
 * failed run still says why after a reopen), the orphan/restore shapes and every
 * sentence below.
 */

/** One session card: a name at a point, bound to one tool row. */
export interface SessionCard {
  /** Record identity: the name-derived slug, in the shared slug space. */
  on: string;
  /** The person's exact words — the name they accepted or edited. */
  name: string;
  /** World-space point of the card, in whole map units (provisional). */
  x: number;
  y: number;
  /**
   * The TOOL ROW this card runs, by id — never a key, never a command and
   * never a value. A row that is no longer shipped is a stated hole the card
   * offers to fill again; it is never repaired here.
   */
  tool: string;
}

/** A read of `map/sessions.txt`: what parsed, and what is kept but unreadable. */
export interface ParsedSessions {
  sessions: SessionCard[];
  malformed: string[];
}

/** How a run ended. Only "completed" is a result (the 18.2 vocabulary). */
export type SessionEnding = "completed" | "stopped" | "failed" | "timed-out";

/** The endings a transcript line may carry (the vocabulary is provisional). */
export const SESSION_ENDINGS: readonly SessionEnding[] = [
  "completed",
  "stopped",
  "failed",
  "timed-out",
];

/**
 * The replies the run can record for a permission request (PROVISIONAL). STORY
 * 18.4 changes 18.3's "allowed" to `allowed-once`: the app can only ever send
 * the protocol's allow_once option, and the record says which one it was.
 * `unanswered` is the budget running out while a request waited; `cancelled`
 * is a run stopped or closed with the ask still pending.
 */
export type SessionPermissionReply =
  | "allowed-once"
  | "refused"
  | "cancelled"
  | "unanswered";

/** The replies a transcript line may carry. */
export const SESSION_PERMISSION_REPLIES: readonly SessionPermissionReply[] = [
  "allowed-once",
  "refused",
  "cancelled",
  "unanswered",
];

/**
 * ONE PROGRESS ENTRY, with its kind. The six kinds are exactly what the card
 * can state: the run starting, the session it made, the agent's words, a tool
 * call with its status, a permission with the reply, and the ending. Anything
 * the run reports that is not one of these is not dressed as one (see the
 * module header's provisional note on thoughts, plans and diagnostics).
 */
export type SessionEntry =
  | { kind: "started"; t: string }
  | { kind: "session"; id: string }
  /** The agent's words VERBATIM — never trimmed, re-wrapped or normalized. */
  | { kind: "text"; text: string }
  /** A tool call: what it was, plus the status the server reported for it. */
  | { kind: "tool"; name: string; status: string }
  /** A permission request and the reply that crossed the wire. */
  | { kind: "permission"; name: string; reply: SessionPermissionReply }
  /**
   * The ending, with the run's ONE sentence when it has one (a failed or
   * timed-out run). PROVISIONAL: the field, so a reopen can still say WHY the
   * run failed instead of a bare "failed".
   */
  | { kind: "ended"; ending: SessionEnding; t: string; sentence?: string };

/** A read of one transcript: what parsed, and what is kept unreadable. */
export interface ParsedSessionTranscript {
  entries: SessionEntry[];
  malformed: string[];
}

/** The bridges this family needs; the app passes lib/fs, a test a fake. */
export interface SessionIo {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
  createDirAll(path: string): Promise<void>;
  /**
   * STORY 18.5 — the transcripts folder's ONE listing, so a transcript whose
   * session card is gone can be REPORTED (kept, never adopted, never deleted).
   * Optional so the older fakes and the write paths need not list anything:
   * absent means "no listing", never "no transcript".
   */
  listDir?(path: string): Promise<string[]>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const SESSION_IO: SessionIo = {
  readTextFile,
  writeTextFile,
  createDirAll,
  listDir,
};

/** The session cards' lines file: `<workspace>/map/sessions.txt`. */
export function sessionsPath(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${SESSION_RECORD_FILE.sessions}`;
}

/** The transcripts' folder: `<workspace>/map/sessions`. */
export function sessionTranscriptsDir(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${SESSION_TRANSCRIPTS_DIR}`;
}

/** One transcript: `<workspace>/map/sessions/<slug>.jsonl`. */
export function sessionTranscriptPath(
  workspacePath: string,
  slug: string,
): string {
  return `${sessionTranscriptsDir(workspacePath)}/${slug}.jsonl`;
}

/**
 * The line shape, in the order the writer emits it. `name` is greedy so the
 * person's words may contain the ` | ` separator; only the exact ` | x: N |
 * y: N | tool: <row-id>` tail is structural. PROVISIONAL with the record.
 */
const SESSION_LINE =
  /^on: (\S+) \| name: (.+) \| x: (-?\d+) \| y: (-?\d+) \| tool: (\S+)$/;

/**
 * Parse one line. Anything out of shape — a missing key, a decimal coordinate,
 * an empty name or tool — becomes `null`: it is kept and reported, never
 * guessed into a card. The TOOL is NOT checked against the rows this build
 * ships: a row that is no longer there is a legal record the card states.
 */
export function parseSessionLine(line: string): SessionCard | null {
  const match = SESSION_LINE.exec(line);
  if (!match) return null;
  const [, on, name, x, y, tool] = match;
  if (on === "" || name.trim() === "" || tool === "") return null;
  return { on, name, x: Number(x), y: Number(y), tool };
}

/** One session card as its canonical line (no trailing newline). */
export function serializeSessionLine(session: SessionCard): string {
  return `on: ${session.on} | name: ${session.name} | x: ${session.x} | y: ${session.y} | tool: ${session.tool}`;
}

/** Read the file's bytes: LF/BOM/CRLF tolerated, unreadable lines kept. */
export function parseSessions(text: string): ParsedSessions {
  const sessions: SessionCard[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseSessionLine(line);
    if (parsed === null) malformed.push(line);
    else sessions.push(parsed);
  }
  return { sessions, malformed };
}

/** The file's exact canonical bytes: known lines, then the preserved ones. */
export function serializeSessions(
  sessions: readonly SessionCard[],
  malformed: readonly string[] = [],
): string {
  return canonicalText(
    [...sessions.map(serializeSessionLine), ...malformed].join("\n"),
  );
}

export async function loadSessions(
  workspacePath: string,
  io: SessionIo = SESSION_IO,
): Promise<ParsedSessions> {
  const text = await io.readTextFile(sessionsPath(workspacePath));
  return text === null ? { sessions: [], malformed: [] } : parseSessions(text);
}

export async function saveSessions(
  workspacePath: string,
  sessions: readonly SessionCard[],
  malformed: readonly string[] = [],
  io: SessionIo = SESSION_IO,
): Promise<void> {
  await io.writeTextFile(
    sessionsPath(workspacePath),
    serializeSessions(sessions, malformed),
  );
}

/* ------------------------------------------------------------------------- *
 * THE TRANSCRIPT — one JSON line per progress entry, append-only.
 *
 * JSONL because a sentence may hold anything (a newline and a quote included);
 * the writer hands the object to the house JSONL seam (`canonicalJsonlLine`,
 * keys sorted) and the reader refuses anything that is not an entry rather than
 * guessing. A malformed line is preserved by every write: the earlier bytes
 * are a prefix.
 * ------------------------------------------------------------------------- */

/** The six kinds a transcript line may carry. */
export const SESSION_ENTRY_KINDS = [
  "started",
  "session",
  "text",
  "tool",
  "permission",
  "ended",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse one entry line; anything out of shape is `null` (kept and reported). */
export function parseSessionEntryLine(line: string): SessionEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (kind === "started") {
    return typeof value.t === "string" ? { kind, t: value.t } : null;
  }
  if (kind === "session") {
    return typeof value.id === "string" && value.id !== ""
      ? { kind, id: value.id }
      : null;
  }
  if (kind === "text") {
    return typeof value.text === "string" ? { kind, text: value.text } : null;
  }
  if (kind === "tool") {
    return typeof value.name === "string" && typeof value.status === "string"
      ? { kind, name: value.name, status: value.status }
      : null;
  }
  if (kind === "permission") {
    const reply = value.reply;
    if (typeof value.name !== "string") return null;
    if (
      reply !== "allowed-once" &&
      reply !== "refused" &&
      reply !== "cancelled" &&
      reply !== "unanswered"
    ) {
      return null;
    }
    return { kind, name: value.name, reply };
  }
  if (kind === "ended") {
    const ending = value.ending;
    if (typeof value.t !== "string") return null;
    if (
      ending !== "completed" &&
      ending !== "stopped" &&
      ending !== "failed" &&
      ending !== "timed-out"
    ) {
      return null;
    }
    const sentence = value.sentence;
    if (sentence !== undefined && (typeof sentence !== "string" || sentence.trim() === "")) {
      return null;
    }
    const entry: SessionEntry = { kind, ending, t: value.t };
    if (sentence !== undefined) entry.sentence = sentence;
    return entry;
  }
  return null;
}

/** One entry as its canonical JSONL line (keys sorted by the house seam). */
export function serializeSessionEntryLine(entry: SessionEntry): string {
  switch (entry.kind) {
    case "started":
      return canonicalJsonlLine({ kind: "started", t: entry.t });
    case "session":
      return canonicalJsonlLine({ kind: "session", id: entry.id });
    case "text":
      return canonicalJsonlLine({ kind: "text", text: entry.text });
    case "tool":
      return canonicalJsonlLine({
        kind: "tool",
        name: entry.name,
        status: entry.status,
      });
    case "permission":
      return canonicalJsonlLine({
        kind: "permission",
        name: entry.name,
        reply: entry.reply,
      });
    case "ended":
      return canonicalJsonlLine({
        kind: "ended",
        ending: entry.ending,
        t: entry.t,
        ...(entry.sentence === undefined ? {} : { sentence: entry.sentence }),
      });
  }
}

/** Read a transcript's bytes: unreadable lines kept, verbatim. */
export function parseSessionTranscript(
  text: string,
): ParsedSessionTranscript {
  const entries: SessionEntry[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseSessionEntryLine(line);
    if (parsed === null) malformed.push(line);
    else entries.push(parsed);
  }
  return { entries, malformed };
}

/** One transcript's bytes: known entries, then the preserved lines. */
export function serializeSessionTranscript(
  entries: readonly SessionEntry[],
  malformed: readonly string[] = [],
): string {
  return canonicalText(
    [...entries.map(serializeSessionEntryLine), ...malformed].join("\n"),
  );
}

/**
 * Read one session card's transcript. An absent file is no entries (a card
 * made but never run); it is never invented from anything else.
 */
export async function loadSessionTranscript(
  workspacePath: string,
  slug: string,
  io: SessionIo = SESSION_IO,
): Promise<ParsedSessionTranscript> {
  const text = await io.readTextFile(sessionTranscriptPath(workspacePath, slug));
  return text === null
    ? { entries: [], malformed: [] }
    : parseSessionTranscript(text);
}

/** Read every session card's transcript, keyed by slug, one read per card. */
export async function loadSessionTranscripts(
  workspacePath: string,
  slugs: readonly string[],
  io: SessionIo = SESSION_IO,
): Promise<Record<string, ParsedSessionTranscript>> {
  const pairs = await Promise.all(
    slugs.map(
      async (slug) =>
        [slug, await loadSessionTranscript(workspacePath, slug, io)] as const,
    ),
  );
  const transcripts: Record<string, ParsedSessionTranscript> = {};
  for (const [slug, parsed] of pairs) transcripts[slug] = parsed;
  return transcripts;
}

/**
 * STORY 18.5 — EVERY TRANSCRIPT THE FOLDER HOLDS, and the ones whose session
 * card is gone. ONE listing of `map/sessions/`, then one read per card that is
 * on the map; a `.jsonl` whose slug `sessions.txt` does not carry is an
 * ORPHAN — named for the notices group and the mirror, kept exactly where it
 * is, never read into a card, never adopted and never deleted (the notes' and
 * the ask conversations' rule, one family over). A missing folder is a fresh
 * workspace, not an error.
 */
export interface LoadedSessionTranscripts {
  /** Each session card's transcript, keyed by the slug the card carries. */
  transcripts: Record<string, ParsedSessionTranscript>;
  /** Slugs whose transcript exists but whose session card is gone. */
  orphans: string[];
}

export async function loadSessionTranscriptsWithOrphans(
  workspacePath: string,
  slugs: readonly string[],
  io: SessionIo = SESSION_IO,
): Promise<LoadedSessionTranscripts> {
  const names =
    io.listDir === undefined
      ? slugs.map((slug) => slug + ".jsonl")
      : await io.listDir(sessionTranscriptsDir(workspacePath));
  const onMap = new Set(slugs);
  const transcripts: Record<string, ParsedSessionTranscript> = {};
  const orphans: string[] = [];
  // A stray file that is not a transcript is left alone: the folder is the
  // person's, and only `.jsonl` names one here.
  const candidates = names.filter(
    (name) => name.endsWith(".jsonl") && name.length > ".jsonl".length,
  );
  await Promise.all(
    candidates.map(async (name) => {
      const slug = name.slice(0, -".jsonl".length);
      if (!onMap.has(slug)) {
        orphans.push(slug);
        return;
      }
      transcripts[slug] = await loadSessionTranscript(workspacePath, slug, io);
    }),
  );
  // A card whose transcript is absent still has no entries; an absent file is
  // never invented into one.
  for (const slug of slugs) {
    if (transcripts[slug] === undefined) {
      transcripts[slug] = { entries: [], malformed: [] };
    }
  }
  orphans.sort();
  return { transcripts, orphans };
}

/** The one sentence a transcript that could not be written answers. */
export const SESSION_TRANSCRIPT_REFUSAL =
  "the run's transcript could not be written.";

/**
 * APPEND WHOLE ENTRIES to a card's transcript, APPEND-ONLY: the file's existing
 * bytes are kept as a PREFIX (a hand-edited, empty or malformed line therefore
 * survives), one canonical JSONL line per entry is added IN THE ORDER GIVEN,
 * and nothing earlier is parsed and rewritten. ONE write per call, and every
 * line it writes is complete — a crash can lose the last entry but can never
 * leave half of one. The caller serializes its calls, so arrival order is file
 * order.
 *
 * An EMPTY list writes nothing at all: a report that has no entry to make (a
 * thought, a transport diagnostic) is not an occasion for a rewrite.
 */
export async function appendSessionEntries(
  workspacePath: string,
  slug: string,
  entries: readonly SessionEntry[],
  io: SessionIo = SESSION_IO,
): Promise<SessionEntry[]> {
  if (entries.length === 0) {
    return (await loadSessionTranscript(workspacePath, slug, io)).entries;
  }
  await io.createDirAll(sessionTranscriptsDir(workspacePath));
  const path = sessionTranscriptPath(workspacePath, slug);
  const existing = (await io.readTextFile(path)) ?? "";
  const prefix =
    existing === "" || existing.endsWith("\n") ? existing : existing + "\n";
  const content =
    prefix + entries.map(serializeSessionEntryLine).join("\n") + "\n";
  await io.writeTextFile(path, content);
  return parseSessionTranscript(content).entries;
}

/* ------------------------------------------------------------------------- *
 * STORY 18.5 — REMOVING A SESSION CARD, and putting it back.
 *
 * The same promise every other card makes (story 16.13): the delete is
 * IMMEDIATE, and the toast's Restore writes the SAME BYTES back. What a delete
 * keeps in memory is the record line (as the card, with its file position) and
 * the TRANSCRIPT'S BYTES, read BEFORE any write or unlink — so a restore is a
 * byte-identical folder, never a re-serialization of what the run said.
 *
 * NOT ONE WORD LEAVES the card's files here: the bytes are read into memory and
 * written back verbatim; nothing is parsed, trimmed, previewed or logged. The
 * history line beside the move names the slug only.
 * ------------------------------------------------------------------------- */

/** What a session-card delete keeps in memory, so Restore can put it back. */
export interface RemovedSession {
  session: SessionCard;
  /** Where the line sat in sessions.txt's file order. */
  sessionIndex: number;
  /**
   * The transcript file's bytes, read before its unlink; null when the card had
   * no transcript (a card made but never run — a quiet absence, not an invented
   * empty file).
   */
  transcript: string | null;
}

/** The bridges a session-card delete needs; a test passes its own fakes. */
export interface SessionRemovalIo {
  saveSessions: typeof saveSessions;
  readTextFile: (path: string) => Promise<string | null>;
  removeFile: (path: string) => Promise<void>;
}

/** The real bridges, bound once so this module stays importable in bun tests. */
const SESSION_REMOVAL_IO: SessionRemovalIo = {
  saveSessions,
  readTextFile,
  removeFile,
};

/** What deleting one session card left: the next lines, the held bytes, a sentence. */
export interface SessionRemoval {
  sessions: SessionCard[];
  /** The card and its transcript as they were; null if it was not on the map. */
  removed: RemovedSession | null;
  /**
   * One sentence when the transcript file could not be unlinked; null when it
   * went. The line is already gone either way — one sentence, never a repair,
   * and the leftover file is an ORPHAN the notices group names.
   */
  refusal: string | null;
}

/** The one sentence a refused transcript unlink answers (PROVISIONAL). */
export const SESSION_TRANSCRIPT_REMOVAL_REFUSAL =
  "the session card was removed, but its transcript could not be removed.";

/**
 * THE SESSION DELETE'S ONE SEQUENCE, pure apart from the bridges:
 *
 *   1. READ the transcript's bytes and the line's position (before anything);
 *   2. write sessions.txt without the card — the record is the truth;
 *   3. unlink the transcript file; a refusal answers one sentence and leaves the
 *      file exactly where it is (an orphan, reported, never deleted twice).
 */
export async function removeSessionRecords(
  workspacePath: string,
  slug: string,
  sessions: readonly SessionCard[],
  malformedSessions: readonly string[],
  io: SessionRemovalIo = SESSION_REMOVAL_IO,
): Promise<SessionRemoval> {
  const sessionIndex = sessions.findIndex((session) => session.on === slug);
  const session = sessionIndex >= 0 ? (sessions[sessionIndex] ?? null) : null;
  let transcript: string | null = null;
  try {
    transcript = await io.readTextFile(sessionTranscriptPath(workspacePath, slug));
  } catch {
    transcript = null;
  }
  const next = withoutSession(sessions, slug);
  await io.saveSessions(workspacePath, next, malformedSessions);
  let refusal: string | null = null;
  try {
    await io.removeFile(sessionTranscriptPath(workspacePath, slug));
  } catch {
    refusal = SESSION_TRANSCRIPT_REMOVAL_REFUSAL;
  }
  return {
    sessions: next,
    removed: session === null ? null : { session, sessionIndex, transcript },
    refusal,
  };
}

/** The bridges a session-card restore needs; a test passes its own fakes. */
export interface SessionRestoreIo {
  saveSessions: typeof saveSessions;
  /**
   * Write the transcript's held bytes back EXACTLY, creating the folder if the
   * delete took it with the file. Never a re-serialization: the bytes read
   * before the unlink are the bytes written.
   */
  restoreTranscript: (
    workspacePath: string,
    slug: string,
    text: string,
  ) => Promise<void>;
}

/** Write one transcript's bytes back verbatim (the restore's first step). */
export async function restoreSessionTranscript(
  workspacePath: string,
  slug: string,
  text: string,
  io: SessionIo = SESSION_IO,
): Promise<void> {
  await io.createDirAll(sessionTranscriptsDir(workspacePath));
  await io.writeTextFile(sessionTranscriptPath(workspacePath, slug), text);
}

/** The real bridges, bound once so this module stays importable in bun tests. */
const SESSION_RESTORE_IO: SessionRestoreIo = {
  saveSessions,
  restoreTranscript: (workspacePath, slug, text) =>
    restoreSessionTranscript(workspacePath, slug, text),
};

/** What putting a session card back did: the next lines, what came back. */
export interface SessionRestoreResult {
  sessions: SessionCard[];
  /** True when the card's own sessions.txt line went back. */
  restoredSession: boolean;
  cameBack: readonly string[];
  didNot: readonly string[];
  /** One sentence when a write failed; null when everything came back. */
  refusal: string | null;
}

/**
 * STORY 18.5 — PUT A SESSION CARD BACK, SAME BYTES, in the house order:
 *
 *   1. the transcript (exactly the bytes read before its unlink);
 *   2. the sessions.txt line, at its old file position — last, so a crash can
 *      never leave a card whose transcript is missing.
 *
 * Every write is attempted even after an earlier one fails, so the one sentence
 * can name BOTH what came back and what did not. A card with no transcript
 * restores none and invents nothing. The one sentence is the shared
 * restoreSentence wording, handed in by the caller's own module.
 */
export async function restoreSessionCard(
  workspacePath: string,
  removed: RemovedSession,
  sessions: readonly SessionCard[],
  malformedSessions: readonly string[],
  sentenceOf: (
    cameBack: readonly string[],
    didNot: readonly string[],
  ) => string | null,
  io: SessionRestoreIo = SESSION_RESTORE_IO,
): Promise<SessionRestoreResult> {
  const cameBack: string[] = [];
  const didNot: string[] = [];
  let nextSessions = [...sessions];

  // 1. the transcript, byte for byte.
  if (removed.transcript !== null) {
    try {
      await io.restoreTranscript(
        workspacePath,
        removed.session.on,
        removed.transcript,
      );
      cameBack.push("the transcript");
    } catch {
      didNot.push("the transcript");
    }
  }
  // 2. the record line, back where it sat.
  const candidate = insertSessionAt(
    nextSessions,
    removed.sessionIndex,
    removed.session,
  );
  let restoredSession = false;
  try {
    await io.saveSessions(workspacePath, candidate, malformedSessions);
    nextSessions = candidate;
    restoredSession = true;
    cameBack.push("the session card");
  } catch {
    didNot.push("the session card");
  }

  return {
    sessions: nextSessions,
    restoredSession,
    cameBack,
    didNot,
    refusal: sentenceOf(cameBack, didNot),
  };
}

/** The session lines without one slug (the removal's next record). */
export function withoutSession(
  sessions: readonly SessionCard[],
  slug: string,
): SessionCard[] {
  return sessions.filter((session) => session.on !== slug);
}

/** Put one session line back at its old file position (clamped, never out of range). */
export function insertSessionAt(
  sessions: readonly SessionCard[],
  index: number,
  session: SessionCard,
): SessionCard[] {
  const at = index < 0 || index > sessions.length ? sessions.length : index;
  return [...sessions.slice(0, at), session, ...sessions.slice(at)];
}

/* ------------------------------------------------------------------------- *
 * THE CARD'S OWN MOVES AND SENTENCES.
 * ------------------------------------------------------------------------- */

/** What adding one session card did: the new list and the line it appended. */
export interface SessionAddition {
  sessions: SessionCard[];
  session: SessionCard;
}

/**
 * Append a session card at a point, minting its slug against the SHARED slug
 * space (all three files) with the concept map's dedupe rule. PURE: the caller
 * writes the file. A blank name or a missing tool row is the caller's refusal;
 * this function only names, places and binds.
 */
export function addSession(
  sessions: readonly SessionCard[],
  taken: ReadonlySet<string>,
  name: string,
  x: number,
  y: number,
  tool: string,
): SessionAddition {
  const session: SessionCard = {
    on: nextSlug(slugName(name), taken),
    name,
    x: Math.round(x),
    y: Math.round(y),
    tool,
  };
  return { sessions: [...sessions, session], session };
}

/**
 * BIND one session card to another tool row: ONE field's change — the name,
 * the point and the transcript stay exactly as they were. PURE: the caller
 * checks the row exists and writes the whole file once. A slug this file does
 * not carry answers `null`, never an appended card. PROVISIONAL (the story
 * gives the card the choice again when its row is gone; writing that choice is
 * this one field).
 */
export function bindSessionTool(
  sessions: readonly SessionCard[],
  slug: string,
  tool: string,
): SessionCard[] | null {
  if (!sessions.some((session) => session.on === slug)) return null;
  return sessions.map((session) =>
    session.on === slug ? { ...session, tool } : session,
  );
}

/** The ending sentences (PROVISIONAL wording): only "completed" is a result. */
export const SESSION_ENDING_SENTENCES = {
  completed: "the run finished.",
  stopped: "you stopped it; what arrived stays.",
  failed: "the run failed.",
  "timed-out": "it ran out of its budget; what arrived stays.",
} as const;

/** What the card says when its tool row is not one this build ships. */
export const SESSION_MISSING_TOOL_SENTENCE =
  "the tool this card runs is not here, so choose another one.";

/**
 * THE ENDING IN ONE SENTENCE (PURE): completed says it finished, stopped says
 * the person stopped it and what arrived stays, timed-out says the same about
 * its budget, and a failed run carries the run's OWN one-sentence reason (the
 * 18.2 sentence, which names a provider row and never a key). A partial never
 * counts as a result in any of them.
 */
export function sessionEndingLine(
  ending: SessionEnding,
  sentence: string | null,
): string {
  if (ending === "failed") {
    const reason = sentence === null ? "" : sentence.trim();
    return reason === "" ? SESSION_ENDING_SENTENCES.failed : "the run failed: " + reason;
  }
  return SESSION_ENDING_SENTENCES[ending];
}

/**
 * ONE PERMISSION REPLY AS THE CARD'S WORDS (PURE, PROVISIONAL). The record's
 * value is precise (`allowed-once`); the card's line is the person's language.
 * "allowed once" is the strongest claim this app can ever make — there is no
 * "always" spelling here because there is no always answer.
 */
export function permissionReplyWord(reply: SessionPermissionReply): string {
  switch (reply) {
    case "allowed-once":
      return "allowed once";
    case "refused":
      return "refused";
    case "cancelled":
      return "cancelled";
    case "unanswered":
      return "unanswered";
  }
}

/**
 * ONE ENTRY AS THE LINE THE CARD READS (PURE): a quiet sentence per kind, never
 * a count, a percentage or a step number. Text is the agent's words VERBATIM;
 * a tool call is its name plus its status; a permission is what was asked plus
 * the reply; the ending is the sentence above.
 */
export function sessionEntryLine(entry: SessionEntry): string {
  switch (entry.kind) {
    case "started":
      return "the run started";
    case "session":
      return "a session is open";
    case "text":
      return entry.text;
    case "tool":
      return entry.status.trim() === ""
        ? entry.name
        : entry.name + " — " + entry.status;
    case "permission":
      return entry.name + " — " + permissionReplyWord(entry.reply);
    case "ended":
      return sessionEndingLine(entry.ending, entry.sentence ?? null);
  }
}

/**
 * THE NEWEST ENTRY (PURE): the small face shows what arrived last, not the
 * first line and not a count. File order IS arrival order — the append-only
 * record is never sorted — so the last element is the newest thing the run
 * reported. A card that has never run has no newest entry (never an invented
 * one).
 */
export function sessionNewestEntry(
  entries: readonly SessionEntry[],
): SessionEntry | null {
  return entries.length === 0 ? null : entries[entries.length - 1]!;
}

/** What this session card runs, as its second line (PURE, PROVISIONAL). */
export function sessionKindLine(toolName: string | null): string {
  return "a run of " + (toolName === null ? "a tool that is not here" : toolName);
}

/**
 * STORY 18.4 — THE RESULT OF THE LAST RUN (PURE). This is the run's TEXT
 * entries, IN ORDER, JOINED — the run's result as it was, stated plainly. The
 * join is the empty string: the transcript records the agent's chunks one at a
 * time, verbatim, so concatenating them in arrival order reconstructs exactly
 * the words that were streamed (a newline would invent one mid-sentence). A
 * run that did not complete has NO result, even when text arrived: a partial is
 * never a result (18.2's rule). An absent or empty result means "nothing to
 * copy", never an empty card.
 */
export interface SessionRunResult {
  /** The latest run's ending, or null when the card has never run. */
  ending: SessionEnding | null;
  /** The latest COMPLETED run's text entries joined in order ("" otherwise). */
  text: string;
}

export function sessionRunResult(
  entries: readonly SessionEntry[],
): SessionRunResult {
  let lastEnd = -1;
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    if (entries[at]!.kind === "ended") {
      lastEnd = at;
      break;
    }
  }
  if (lastEnd < 0) return { ending: null, text: "" };
  const ended = entries[lastEnd]!;
  if (ended.kind !== "ended" || ended.ending !== "completed") {
    return { ending: ended.kind === "ended" ? ended.ending : null, text: "" };
  }
  // The run's own span: from the PREVIOUS ending (exclusive) to this one.
  let start = 0;
  for (let at = lastEnd - 1; at >= 0; at -= 1) {
    if (entries[at]!.kind === "ended") {
      start = at + 1;
      break;
    }
  }
  let text = "";
  for (let at = start; at < lastEnd; at += 1) {
    const entry = entries[at]!;
    if (entry.kind === "text") text += entry.text;
  }
  return { ending: "completed", text };
}

/**
 * STORY 18.5 — HOW A RUN ENDED, IN THE PRISM'S TWO WORDS (PURE). This is the ONE
 * mapping the story's hard constraint asks for: the PRISM's `run` Change and the
 * history's `session.run` line are both formed from it, so the two records can
 * never disagree about the same run. Only a completed run ANSWERED; a stop, a
 * failure, a timeout and a dead connection are all `no-response` — the 15.7b
 * rule, one layer down (a partial is never a result).
 *
 * PROVISIONAL with the record: the words are the Ask's own pair.
 */
export function runOutcomeOf(ending: SessionEnding): RunOutcome {
  return ending === "completed" ? "answered" : "no-response";
}

/**
 * STORY 18.5 — THE RESULT'S EXACT BYTE SIZE, or null when the last run did not
 * complete (PURE). The size is the ONE fact the PRISM keeps about the result:
 * the bytes of the joined text entries, never a count of entries and never a
 * word. A completed run that said nothing is size zero, said exactly.
 */
export function sessionResultSize(
  entries: readonly SessionEntry[],
): number | null {
  const result = sessionRunResult(entries);
  return result.ending === "completed" ? utf8ByteLength(result.text) : null;
}

/**
 * STORY 18.5 — THE LAST ENDING the transcript holds, or null when the card has
 * never run (PURE). The MAP.md line says it, and the card's own small face
 * already reads the newest entry: this is the one structural fact the mirror
 * needs, and it is deliberately NOT the transcript (which holds the words).
 */
export function sessionLastEnding(
  entries: readonly SessionEntry[],
): SessionEnding | null {
  for (let at = entries.length - 1; at >= 0; at -= 1) {
    const entry = entries[at]!;
    if (entry.kind === "ended") return entry.ending;
  }
  return null;
}

/**
 * The one sentence a result that is not there answers (PROVISIONAL). Nothing is
 * written for either: an empty card is never invented.
 */
export const SESSION_RESULT_EMPTY_SENTENCE =
  "this run left no text, so there is no card to make.";

/** The one sentence for a last run that did not complete (PROVISIONAL). */
export const SESSION_RESULT_UNFINISHED_SENTENCE =
  "the last run did not finish, so it has no result to copy.";

/**
 * The name the result card PROPOSES (PROVISIONAL): the session card's name plus
 * a short suffix, so the copy says where it came from before its reading does.
 * The person's naming rule still applies — the suffix is only a proposal.
 */
export function sessionResultName(sessionName: string): string {
  return sessionName.trim() + " result";
}

/** The quiet line a session card that has never run shows (PROVISIONAL). */
export const SESSION_EMPTY_SENTENCE = "nothing has run yet";

/** The quiet line while a run is live (PROVISIONAL wording). */
export const SESSION_RUNNING_SENTENCE = "the run is going";

/** The one sentence a second run at once answers (PROVISIONAL). */
export const SESSION_BUSY_SENTENCE = "this card is already running; stop it first.";

/**
 * The one sentence a blank session-card name answers (PROVISIONAL wording).
 */
export const SESSION_NAME_REFUSAL = "name it first.";

/** The one sentence a card with no tool row answers when run is pressed. */
export const SESSION_NO_TOOL_REFUSAL = SESSION_MISSING_TOOL_SENTENCE;

/** The one sentence a session slug this file does not carry answers. */
export const SESSION_MISSING_REFUSAL = "there is no session card here.";

/** The one sentence a creation with no chosen tool row answers. */
export const SESSION_TOOL_REFUSAL = "pick a tool to run.";

/**
 * STORY 16.22 — THE SESSION CARD'S NAME, AS THE SHARED PILL SHOWS AND STORES IT.
 * A session line cannot carry an empty name (the parser keeps it as a malformed
 * line, and the card would lose the one word that identifies it), so a blank
 * field becomes THIS sentence — the reference card's rule, one family over. An
 * ask card refuses a blank name instead; the difference is deliberate, and it is
 * the family's own rule that decides, not the pill. PROVISIONAL wording.
 */
export const SESSION_UNTITLED_NAME = "Untitled session";

/** The name a session card SHOWS: the record's words, or the untitled sentence. */
export function sessionDisplayName(name: string): string {
  return name.trim() === "" ? SESSION_UNTITLED_NAME : name;
}

/**
 * The name a session rename STORES: trimmed, and the untitled sentence when the
 * field is blank. Never an empty name — an empty `name:` tail would make the
 * line unreadable on the next load, and an empty field is a legal name here,
 * not a refusal (the ask card's rule is the strict one).
 */
export function sessionNameForWrite(name: string): string {
  const trimmed = name.trim();
  return trimmed === "" ? SESSION_UNTITLED_NAME : trimmed;
}

/**
 * STORY 16.22 — RENAME one session card: the NAME changes and NOTHING else
 * does. Identity is the SLUG (the transcript's file name and the card a wire
 * points at), so a rename never mints a new one, never moves a wire and never
 * touches the transcript. One line is rewritten in place, so a rename can
 * neither reorder `sessions.txt` nor orphan a transcript. PURE — the caller
 * writes the file through the ground family's one write queue. A slug this
 * file does not carry answers `null`, never an appended card.
 */
export function renameSession(
  sessions: readonly SessionCard[],
  slug: string,
  name: string,
): SessionCard[] | null {
  if (!sessions.some((session) => session.on === slug)) return null;
  const next = sessionNameForWrite(name);
  return sessions.map((session) =>
    session.on === slug ? { ...session, name: next } : session,
  );
}

/** The creation's ONE refusal rule, PURE: a blank name writes nothing. */
export function sessionRefusal(name: string): string | null {
  return name.trim() === "" ? SESSION_NAME_REFUSAL : null;
}

/**
 * The name the bubble PROPOSES for a session card (PROVISIONAL): the tool row's
 * own name, so the person edits or accepts rather than typing from nothing (the
 * ask card's idiom). Only the person's confirm writes anything.
 */
export function proposeSessionName(toolName: string): string {
  const name = toolName.trim();
  return name === "" ? "a session" : name + " session";
}
