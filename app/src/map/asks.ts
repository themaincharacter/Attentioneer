import { createDirAll, readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalText, nextSlug, slugName } from "../lib/serialize";
import type { GroundReference } from "./ground";
import { ASK_RECORD_FILE, ASK_TURNS_DIR, mapDir } from "./records";

/**
 * THE ASK CARD'S RECORD FAMILY (Epic 17 story 1): one `map/asks.txt` line per
 * ask card, and one conversation file per card under `map/asks/`.
 *
 *   on: <slug> | name: <the person's words> | x: <int> | y: <int> | anchor: <reference-slug>
 *
 *   map/asks/<slug>.jsonl   one JSON line per turn: role, text, time
 *
 * AN ASK CARD IS NOT A READING. A reading is the file's opening lines kept
 * beside the map; an ask card is a conversation about one reference, and it has
 * no note and no reading text of its own (story 1 writes exactly one exchange).
 * It is a citizen BESIDE the reference, not a new kind of reference: the
 * ground map renders both from the same grammar (name, what this is, the crop).
 *
 * ONE SLUG SPACE WITH `ground.txt` (the epic's ruling): a link, a mention or an
 * anchor must resolve to exactly ONE card, so minting an ask card checks BOTH
 * files and dedupes with the concept map's existing suffix rule (`nextSlug`).
 * `sharedSlugs` is that one check, and the ground family's own minting is handed
 * the same set so neither direction can coin a twin.
 *
 * THE ANCHOR IS A FIELD, NEVER A LINK. `anchor: <reference-slug>` says what the
 * ask is about, in one place. Wiring a link would spend a meaning the epic
 * defers, and an anchor that names a card the map no longer carries is LEGAL:
 * story 17.6 states a dangling anchor; story 1 neither repairs nor refuses it.
 *
 * THE CONVERSATION IS APPEND-ONLY, one line per turn, the words VERBATIM. JSONL
 * because a message may hold anything (a newline and a quote included), and the
 * shape is chosen so story 17.2's thread needs no migration. A line that does
 * not parse is PRESERVED verbatim and reported (ADR-0009's honesty surfaces),
 * never dropped by a write: the earlier bytes are a prefix that never changes.
 *
 * PROVISIONAL (the story's record shapes, before an ADR settles them): the
 * `asks.txt` name, the line shape and its key order, the turn line's shape,
 * the coordinates as ints and the `asks/` folder name. Story 17.4 owns PRISM
 * (a sending turn's Move), 17.5 owns fork (`from`/`carry`), 17.6 owns dangling
 * anchors, 17.7 retires the embedded panel and 17.8 puts asks in the mirror and
 * the history — none of that is written here.
 */

/** One ask card: the person's name at their point, about one reference. */
export interface AskCard {
  /** Record identity: the name-derived slug, in the shared ground slug space. */
  on: string;
  /** The person's exact words — the name they accepted or edited. */
  name: string;
  /** World-space point of the card, in whole map units (provisional). */
  x: number;
  y: number;
  /**
   * The reference this ask is ABOUT — a field, never a link. A slug the map no
   * longer carries is kept exactly as written (story 17.6 states it).
   */
  anchor: string;
}

/** A read of `map/asks.txt`: what parsed, and what is kept but unreadable. */
export interface ParsedAsks {
  asks: AskCard[];
  malformed: string[];
}

/** One conversation turn. Story 1 writes `person` then `answer`, nothing else. */
export type AskRole = "person" | "answer";

/** The roles a turn line may carry (the vocabulary is provisional). */
export const ASK_ROLES: readonly AskRole[] = ["person", "answer"];

/** One turn: who spoke, the words EXACTLY, and when the line was written. */
export interface AskTurn {
  role: AskRole;
  /** The words verbatim — never trimmed, re-wrapped or normalized. */
  text: string;
  /** ISO-8601, the writer's clock (provisional). */
  t: string;
}

/** A read of one conversation file: what parsed, and what is kept unreadable. */
export interface ParsedTurns {
  turns: AskTurn[];
  malformed: string[];
}

/** The bridges this family needs; the app passes lib/fs, a test a fake. */
export interface AskIo {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
  createDirAll(path: string): Promise<void>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const ASK_IO: AskIo = { readTextFile, writeTextFile, createDirAll };

/** The ask cards' lines file: `<workspace>/map/asks.txt`. */
export function asksPath(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${ASK_RECORD_FILE.asks}`;
}

/** The conversations' folder: `<workspace>/map/asks`. */
export function askTurnsDir(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${ASK_TURNS_DIR}`;
}

/** One conversation: `<workspace>/map/asks/<slug>.jsonl`. */
export function askTurnPath(workspacePath: string, slug: string): string {
  return `${askTurnsDir(workspacePath)}/${slug}.jsonl`;
}

/**
 * The line shape, in the order the writer emits it. `name` is greedy so the
 * person's words may contain the ` | ` separator (only the exact
 * ` | x: N | y: N | anchor: <slug>` tail is structural).
 */
const ASK_LINE =
  /^on: (\S+) \| name: (.+) \| x: (-?\d+) \| y: (-?\d+) \| anchor: (\S+)$/;

/**
 * Parse one line. Anything out of shape — a missing key, a decimal coordinate,
 * an empty name or anchor — becomes `null`: it is kept and reported, never
 * guessed into an ask card. The ANCHOR is NOT checked against the ground map:
 * a dangling anchor is a legal record (story 17.6).
 */
export function parseAskLine(line: string): AskCard | null {
  const match = ASK_LINE.exec(line);
  if (!match) return null;
  const [, on, name, x, y, anchor] = match;
  if (on === "" || name.trim() === "" || anchor === "") return null;
  return { on, name, x: Number(x), y: Number(y), anchor };
}

/** One ask card as its canonical line (no trailing newline). */
export function serializeAskLine(ask: AskCard): string {
  return `on: ${ask.on} | name: ${ask.name} | x: ${ask.x} | y: ${ask.y} | anchor: ${ask.anchor}`;
}

/** Read the file's bytes: LF/BOM/CRLF tolerated, unreadable lines kept. */
export function parseAsks(text: string): ParsedAsks {
  const asks: AskCard[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseAskLine(line);
    if (parsed === null) malformed.push(line);
    else asks.push(parsed);
  }
  return { asks, malformed };
}

/** The file's exact canonical bytes: known lines, then the preserved ones. */
export function serializeAsks(
  asks: readonly AskCard[],
  malformed: readonly string[] = [],
): string {
  return canonicalText(
    [...asks.map(serializeAskLine), ...malformed].join("\n"),
  );
}

export async function loadAsks(
  workspacePath: string,
  io: AskIo = ASK_IO,
): Promise<ParsedAsks> {
  const text = await io.readTextFile(asksPath(workspacePath));
  return text === null ? { asks: [], malformed: [] } : parseAsks(text);
}

export async function saveAsks(
  workspacePath: string,
  asks: readonly AskCard[],
  malformed: readonly string[] = [],
  io: AskIo = ASK_IO,
): Promise<void> {
  await io.writeTextFile(
    asksPath(workspacePath),
    serializeAsks(asks, malformed),
  );
}

/** What adding one ask card did: the new list and the line it appended. */
export interface AskAddition {
  asks: AskCard[];
  ask: AskCard;
}

/**
 * THE SHARED SLUG SPACE (the epic's ruling), PURE: every slug either family
 * holds. A link, a mention or an anchor must resolve to exactly one card, so
 * both minting paths are handed THIS set and neither can coin a twin.
 */
export function sharedSlugs(
  references: readonly GroundReference[],
  asks: readonly AskCard[],
): Set<string> {
  const taken = new Set<string>();
  for (const reference of references) taken.add(reference.on);
  for (const ask of asks) taken.add(ask.on);
  return taken;
}

/**
 * Append an ask card at a point, minting its slug against the SHARED slug space
 * (both files) with the concept map's dedupe rule. PURE: the caller writes the
 * file, so a test can assert the line without a disk. A blank name is the
 * caller's refusal; this function only names, places and anchors.
 */
export function addAsk(
  asks: readonly AskCard[],
  taken: ReadonlySet<string>,
  name: string,
  x: number,
  y: number,
  anchor: string,
): AskAddition {
  const ask: AskCard = {
    on: nextSlug(slugName(name), taken),
    name,
    x: Math.round(x),
    y: Math.round(y),
    anchor,
  };
  return { asks: [...asks, ask], ask };
}

/* ------------------------------------------------------------------------- *
 * THE CONVERSATION — one JSON line per turn, append-only.
 *
 * JSONL because the words may hold a newline or a quote; the writer hands the
 * object to the house JSONL seam (`canonicalJsonlLine`, keys sorted) and the
 * reader refuses anything that is not a turn rather than guessing. A malformed
 * line is preserved by every write: the earlier bytes are a prefix.
 * ------------------------------------------------------------------------- */

/** Parse one turn line; anything out of shape is `null` (kept and reported). */
export function parseTurnLine(line: string): AskTurn | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const role = record.role;
  const text = record.text;
  const t = record.t;
  if (role !== "person" && role !== "answer") return null;
  if (typeof text !== "string" || typeof t !== "string") return null;
  return { role, text, t };
}

/** One turn as its canonical JSONL line (keys sorted by the house seam). */
export function serializeTurnLine(turn: AskTurn): string {
  return canonicalJsonlLine({ role: turn.role, text: turn.text, t: turn.t });
}

/** Read a conversation's bytes: unreadable lines kept, verbatim. */
export function parseTurns(text: string): ParsedTurns {
  const turns: AskTurn[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseTurnLine(line);
    if (parsed === null) malformed.push(line);
    else turns.push(parsed);
  }
  return { turns, malformed };
}

/** One conversation file's bytes: known turns, then the preserved lines. */
export function serializeTurns(
  turns: readonly AskTurn[],
  malformed: readonly string[] = [],
): string {
  return canonicalText(
    [...turns.map(serializeTurnLine), ...malformed].join("\n"),
  );
}

/**
 * Read one ask card's conversation. An absent file is no turns (a card made but
 * never asked in); it is never invented from anything else.
 */
export async function loadTurns(
  workspacePath: string,
  slug: string,
  io: AskIo = ASK_IO,
): Promise<ParsedTurns> {
  const text = await io.readTextFile(askTurnPath(workspacePath, slug));
  return text === null ? { turns: [], malformed: [] } : parseTurns(text);
}

/**
 * Read every ask card's conversation, keyed by slug. One read per card, in
 * parallel; an absent file is simply an empty conversation.
 */
export async function loadAskTurns(
  workspacePath: string,
  slugs: readonly string[],
  io: AskIo = ASK_IO,
): Promise<Record<string, ParsedTurns>> {
  const entries = await Promise.all(
    slugs.map(async (slug) => [slug, await loadTurns(workspacePath, slug, io)] as const),
  );
  const turns: Record<string, ParsedTurns> = {};
  for (const [slug, parsed] of entries) turns[slug] = parsed;
  return turns;
}

/**
 * APPEND ONE TURN to a card's conversation, APPEND-ONLY: the file's existing
 * bytes are kept as a PREFIX (a hand-edited or malformed line therefore
 * survives), one canonical JSONL line is added, and nothing earlier is parsed
 * and rewritten. The words go in VERBATIM; only the JSON envelope is the
 * writer's. The caller queues this, so two turns can never interleave.
 */
export async function appendTurn(
  workspacePath: string,
  slug: string,
  turn: AskTurn,
  io: AskIo = ASK_IO,
): Promise<AskTurn[]> {
  await io.createDirAll(askTurnsDir(workspacePath));
  const path = askTurnPath(workspacePath, slug);
  const existing = (await io.readTextFile(path)) ?? "";
  const prefix =
    existing === "" || existing.endsWith("\n") ? existing : existing + "\n";
  const content = prefix + serializeTurnLine(turn) + "\n";
  await io.writeTextFile(path, content);
  return parseTurns(content).turns;
}

/**
 * APPEND one exchange to a card's conversation, APPEND-ONLY: the person's line
 * always, the answer line only when the turn actually answered (null on a
 * failed or stopped turn, which leaves the person's line alone — story 1's
 * stated rule). Two calls to `appendTurn`, so the shape is the same one story
 * 17.2's thread appends to and no migration is needed. The caller queues the
 * whole exchange as ONE task, so a reader never sees the pair half-written.
 */
export async function appendExchange(
  workspacePath: string,
  slug: string,
  question: string,
  answer: string | null,
  io: AskIo = ASK_IO,
  now: () => string = () => new Date().toISOString(),
): Promise<AskTurn[]> {
  const turns = await appendTurn(
    workspacePath,
    slug,
    { role: "person", text: question, t: now() },
    io,
  );
  if (answer === null) return turns;
  return await appendTurn(
    workspacePath,
    slug,
    { role: "answer", text: answer, t: now() },
    io,
  );
}

/** The one sentence a blank ask-card name answers (PROVISIONAL wording). */
export const ASK_NAME_REFUSAL = "name it first.";

/** The one sentence an empty question answers (PROVISIONAL wording). */
export const ASK_QUESTION_REFUSAL = "write a question first.";

/** The one sentence a source the map does not carry answers (PROVISIONAL). */
export const ASK_SOURCE_REFUSAL = "that card is not on the map.";

/** The one sentence a question with no ask card answers (PROVISIONAL). */
export const ASK_MISSING_REFUSAL = "there is no ask card here.";

/** The creation's ONE refusal rule, PURE: a blank name writes nothing. */
export function askRefusal(name: string): string | null {
  return name.trim() === "" ? ASK_NAME_REFUSAL : null;
}

/** The turn's ONE refusal rule, PURE: a blank question writes nothing. */
export function askQuestionRefusal(question: string): string | null {
  return question.trim() === "" ? ASK_QUESTION_REFUSAL : null;
}

/**
 * The name the affordance PROPOSES for a new ask card (PROVISIONAL): the
 * anchored card's name plus the noun for what the card is, so the person edits
 * their own words rather than typing a name from nothing. The selection card's
 * idiom, with the anchor's name in place of selected text. Only the person's
 * confirm writes anything.
 */
export function proposeAskName(anchorName: string): string {
  const name = anchorName.trim();
  return name === "" ? "a question" : name + " question";
}

/**
 * What the small card CROPS (story 1; story 17.2 owns the real thread): the one
 * exchange as plain lines, role-labelled, which the card's existing `previewText`
 * helper then cuts at the person's stated count. PURE, so the crop is not the
 * JSX's only truth. The words are verbatim; only the label is the writer's.
 */
export function askExchangeText(turns: readonly AskTurn[]): string {
  return turns
    .map((turn) => (turn.role === "person" ? "you: " : "answer: ") + turn.text)
    .join("\n\n");
}
