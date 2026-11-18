import { createDirAll, readTextFile, writeTextFile } from "../lib/fs";
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
 *   {"kind":"permission","name":"<what was asked>","reply":"refused"}
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
 * PROVISIONAL (the story's record shapes, before an ADR settles them): the
 * `sessions.txt` name, the line shape and its key order, the coordinates as
 * ints, the `sessions/` folder name, the six entry kinds and their fields, the
 * optional `sentence` on an ending (the run's one-sentence reason, kept so a
 * failed run still says why after a reopen), and every sentence below.
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

/** The three replies the run can give a permission request (provisional). */
export type SessionPermissionReply = "allowed" | "refused" | "cancelled";

/** The replies a transcript line may carry. */
export const SESSION_PERMISSION_REPLIES: readonly SessionPermissionReply[] = [
  "allowed",
  "refused",
  "cancelled",
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
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const SESSION_IO: SessionIo = {
  readTextFile,
  writeTextFile,
  createDirAll,
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
      reply !== "allowed" &&
      reply !== "refused" &&
      reply !== "cancelled"
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
      return entry.name + " — " + entry.reply;
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
