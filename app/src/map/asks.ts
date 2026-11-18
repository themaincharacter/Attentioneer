import {
  createDirAll,
  listDir,
  readTextFile,
  writeTextFile,
} from "../lib/fs";
import { canonicalJsonlLine, canonicalText, nextSlug, slugName } from "../lib/serialize";
import { utf8ByteLength } from "../lib/textBytes";
import type { GroundReference } from "./ground";
import { ASK_RECORD_FILE, ASK_TURNS_DIR, mapDir } from "./records";
// STORY 18.3 — the shared slug space now spans THREE families; the type is all
// this module needs from the session card's record.
import type { SessionCard } from "./sessions";

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
 * the same set so neither direction can coin a twin. STORY 18.3 EXTENDS IT TO
 * THREE: the session cards (`sessions.ts`) are a third family on the same
 * ground map, so the one check now spans ground + asks + sessions and every
 * minting path is handed all three.
 *
 * THE ANCHOR IS A FIELD, NEVER A LINK. `anchor: <reference-slug>` says what the
 * ask is about, in one place. Wiring a link would spend a meaning the epic
 * defers, and an anchor that names a card the map no longer carries is LEGAL:
 * story 17.6 STATES it (by the remembered `anchorName`, or generically when an
 * older card has none) and never repairs it — the record keeps the slug it was
 * given and the thread bytes are never touched.
 *
 * THE CONVERSATION IS APPEND-ONLY, one line per turn, the words VERBATIM. JSONL
 * because a message may hold anything (a newline and a quote included), and the
 * shape is chosen so story 17.2's thread needs no migration. A line that does
 * not parse is PRESERVED verbatim and reported (ADR-0009's honesty surfaces),
 * never dropped by a write: the earlier bytes are a prefix that never changes.
 *
 * A FORK IS A BRANCH (story 17.5): an ask card may carry `from: <ask-slug>`
 * and `carry: <n>` — the parent it was forked from and how many of that
 * parent's turns (the first n, WHOLE turns) it READS. Its own conversation
 * file holds only its own turns and never a copy of the prefix: the carried
 * part is read from the parent's record every time the card renders or sends.
 * Cheap, honest and reversible — a parent that is gone is a stated hole, not a
 * silent truncation, and the fork's own turns still read and still send.
 *
 * ONE LEVEL OF CARRY (the story's explicit answer): `carry` counts the
 * PARENT'S OWN TURNS, never its carried prefix. So a fork may itself be forked,
 * but a fork of a fork reads only the second card's own turns — the first
 * card's words are one branch back and are NOT carried transitively. The verb
 * is offered only on a card's own turns; a carried turn belongs to the parent,
 * and the way to fork it is to fork the parent.
 *
 * PROVISIONAL (the story's record shapes, before an ADR settles them): the
 * `asks.txt` name, the line shape and its key order, the turn line's shape,
 * the coordinates as ints, the `asks/` folder name, a turn's optional `move`
 * field (story 17.4's join to its PRISM), story 17.5's optional `from`/`carry`
 * tail, the divider and missing-parent wording, the choice that a fork carries
 * one level only, and — STORY 17.6's addition — the optional `anchorName` tail:
 * the name the anchor had, so a dangling anchor can be SAID by name and never
 * repaired. Story 17.7 retired the embedded panel; 17.8 puts asks in the
 * mirror and the history (neither is written here) and adds the folder's one
 * listing, the restore's exact bytes and the two removal helpers below.
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
   *
   * STORY 17.9/17.10 — LEGACY, DISPLAY ONLY. Context is the incoming wires,
   * never this field; after 17.10 no shipped path writes an anchor, and the
   * re-anchor verb is gone. Old records still PARSE and still say what they
   * were about. Optional because an ask card made now (the double-click's ask,
   * or a fork of an unanchored card) has no anchor at all: nothing from the
   * click but the point.
   */
  anchor?: string;
  /**
   * STORY 17.6 — THE NAME THE ANCHOR HAD, remembered on the ask card itself
   * (PROVISIONAL record addition, flagged for an ADR). While the anchor is on
   * the map the card reads the reference's own name; once it is gone the card
   * can still say "this was about <the name it had>; that card is gone" instead
   * of a generic "a card that is not here". A card that cannot be named is a
   * worse hole than one that can, so the name was written at the moment the
   * person anchored (creation, fork inheritance, re-anchor) and never rewritten
   * by a reference going away: remembering is not repairing. STORY 17.9/17.10
   * make the whole field LEGACY: new cards are peers with no anchor, so they
   * write no remembered name either; old records keep reading theirs. Optional because
   * cards recorded before this story simply have no remembered name; their card
   * falls back to the generic line rather than inventing one.
   */
  anchorName?: string;
  /**
   * STORY 17.5 — the ask card this one was FORKED FROM (a slug in the asks
   * file), or absent on a card made from a reference. `from` and `carry`
   * always travel together: the record names the parent and how much of it the
   * fork reads.
   */
  from?: string;
  /**
   * STORY 17.5 — how many of the parent's turns the fork carries: the first
   * `n`, WHOLE turns only, read from the parent's file at render and send
   * time. Never a copy. PROVISIONAL: the field's name and position, and the
   * one-level rule stated in this module's header.
   */
  carry?: number;
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
  /**
   * THE JOIN (Epic 17 story 4) — the Move's id, on an ANSWER line only. The
   * sending turn appended ONE PRISM and this points at it, so a thread line and
   * its record point at each other without either copying the other. The
   * person's line never carries one: no Move happened until the turn sent, and
   * a stopped or broken turn's answer line is never written at all. PROVISIONAL
   * (the field's name and position, with the story's record-shape note).
   */
  move?: string;
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
  /**
   * STORY 17.8 — the conversations folder's ONE listing, so a conversation
   * whose ask card is gone can be REPORTED (kept, never adopted, never
   * deleted). Optional so the older fakes and the write paths need not list
   * anything: absent means "no listing", never "no conversations".
   */
  listDir?(path: string): Promise<string[]>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const ASK_IO: AskIo = {
  readTextFile,
  writeTextFile,
  createDirAll,
  listDir,
};

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
 * ` | x: N | y: N | anchor: <slug>` tail is structural). STORY 17.5 appends ONE
 * optional tail — ` | from: <ask-slug> | carry: <n>` — and STORY 17.6 appends
 * the LAST optional tail — ` | anchorName: <the name the anchor had>` — after
 * it. Both are optional, so a card recorded before either story writes exactly
 * the line it always did, byte for byte, and a fork's pair still travels
 * together. PROVISIONAL: the field's name and its last position.
 */
const ASK_LINE =
  /^on: (\S+) \| name: (.+) \| x: (-?\d+) \| y: (-?\d+)(?: \| anchor: (\S+))?(?: \| from: (\S+) \| carry: (\d+))?(?: \| anchorName: (.+))?$/;

/**
 * Parse one line. Anything out of shape — a missing key, a decimal coordinate,
 * an empty name or anchor, or half a fork — becomes `null`: it is kept and
 * reported, never guessed into an ask card. The ANCHOR is NOT checked against
 * the ground map (a dangling anchor is a legal record, story 17.6), and neither
 * is the fork's `from`: a parent that is gone is stated by the card, never
 * repaired here.
 */
export function parseAskLine(line: string): AskCard | null {
  const match = ASK_LINE.exec(line);
  if (!match) return null;
  const [, on, name, x, y, anchor, from, carry, anchorName] = match;
  if (on === "" || name.trim() === "") return null;
  const ask: AskCard = { on, name, x: Number(x), y: Number(y) };
  // STORY 17.10 — AN ASK WITHOUT AN ANCHOR IS A LEGAL RECORD. The anchor is
  // legacy display only, so its absence means "this card was never bound to a
  // reference", not a malformed line. An EMPTY tail stays out of shape (a name
  // that is nothing is not a name), exactly as it was before.
  if (anchor !== undefined) {
    if (anchor === "") return null;
    ask.anchor = anchor;
  }
  if (from !== undefined) {
    const count = Number(carry);
    if (!Number.isSafeInteger(count) || count < 0) return null;
    ask.from = from;
    ask.carry = count;
  }
  // STORY 17.6: an EMPTY remembered name is out of shape — a name that is
  // nothing is not a name — and the line stays preserved rather than becoming a
  // card with a hole where the anchor's name should be. Stored VERBATIM.
  if (anchorName !== undefined) {
    if (anchorName.trim() === "") return null;
    ask.anchorName = anchorName;
  }
  return ask;
}

/** One ask card as its canonical line (no trailing newline). */
export function serializeAskLine(ask: AskCard): string {
  // STORY 17.10 — THE ANCHOR TAIL IS LEGACY AND OPTIONAL. A card made now names
  // no anchor; an old card's anchor is PRESERVED byte for byte when the file is
  // rewritten, so display-only means display-only. No shipped path can put a
  // NEW anchor here: `addAsk`, `forkAsk` and `renameAsk` never take one.
  const anchored =
    ask.anchor === undefined ? "" : ` | anchor: ${ask.anchor}`;
  const base = `on: ${ask.on} | name: ${ask.name} | x: ${ask.x} | y: ${ask.y}${anchored}`;
  // STORY 17.5: the fork's tail rides only when the record is a fork, and only
  // as the pair — a card made from a reference is byte-identical to story 17.1
  // UNTIL 17.6 remembers a name, which adds its own last optional tail.
  const forked =
    ask.from === undefined || ask.carry === undefined
      ? base
      : `${base} | from: ${ask.from} | carry: ${ask.carry}`;
  // STORY 17.6: the remembered name rides LAST and only when the record has
  // one — a card that never knew its anchor's name writes no empty tail.
  return ask.anchorName === undefined
    ? forked
    : `${forked} | anchorName: ${ask.anchorName}`;
}

/** Whether a card is a fork: it names a parent and carries a count of its turns. */
export function isFork(ask: AskCard): boolean {
  return ask.from !== undefined && ask.carry !== undefined;
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
 * THE SHARED SLUG SPACE (the epic's ruling), PURE: every slug ALL THREE
 * families hold — the ground references, the ask cards and (Epic 18 story 3)
 * the session cards. A link, a mention or an anchor must resolve to exactly one
 * card, so every minting path is handed THIS set and none of them can coin a
 * twin; the session cards are the third family and the same one check, extended
 * rather than duplicated.
 *
 * The sessions default to none so a caller that knows only two families (and
 * an older test) keeps the two-family reading; the hook always passes all
 * three. `sessions.ts` imports nothing from here, so the arrow points one way.
 */
export function sharedSlugs(
  references: readonly GroundReference[],
  asks: readonly AskCard[],
  sessions: readonly SessionCard[] = [],
): Set<string> {
  const taken = new Set<string>();
  for (const reference of references) taken.add(reference.on);
  for (const ask of asks) taken.add(ask.on);
  for (const session of sessions) taken.add(session.on);
  return taken;
}

/**
 * Append an EMPTY ask card at a point, minting its slug against the SHARED slug
 * space (both files) with the concept map's dedupe rule. PURE: the caller
 * writes the file, so a test can assert the line without a disk. A blank name
 * is the caller's refusal; this function only names and places.
 *
 * STORY 17.10 — THE USER'S CORRECTION: "a double click opens a bubble menu and
 * you can select reference or ask." An ask is a PEER card, so creation takes
 * NOTHING from the click but the point — no anchor, no theme, no source. The
 * old creation path bound a reference by field; that mechanism is retired, and
 * the reference verb buys the same result by WIRING the source into this card
 * (17.9's mechanism) after it exists.
 */
export function addAsk(
  asks: readonly AskCard[],
  taken: ReadonlySet<string>,
  name: string,
  x: number,
  y: number,
): AskAddition {
  const ask: AskCard = {
    on: nextSlug(slugName(name), taken),
    name,
    x: Math.round(x),
    y: Math.round(y),
  };
  return { asks: [...asks, ask], ask };
}

/**
 * FORK an ask card at a turn (story 17.5), PURE apart from naming: the new card
 * names the parent with `from` and how many of its turns it reads with `carry`
 * (STORY 17.10: no anchor is inherited — a fork is a peer card), and
 * is placed beside it. Nothing of the parent's conversation is written here or
 * anywhere — the parent's own file is never read by this function and never
 * touched by the caller's write; only `asks.txt` gains one line. The slug is
 * minted in the SHARED ground slug space like every other card.
 *
 * PROVISIONAL: the `carry` number is the WHOLE turns up to and including the
 * turn the person pressed fork on, and the placement is the selection's usual
 * offset (the caller computes the point, as it does for every card).
 */
export function forkAsk(
  asks: readonly AskCard[],
  taken: ReadonlySet<string>,
  parent: AskCard,
  carry: number,
  name: string,
  x: number,
  y: number,
): AskAddition {
  // STORY 17.10 — A FORK IS A PEER CARD TOO. It branches the conversation and
  // nothing else: the parent's anchor is LEGACY DISPLAY on the parent's own
  // line, and the addendum's rule — no shipped path writes an anchor — means
  // the branch starts with none. Context arrives by wire, as it does for every
  // ask made after 17.9.
  const ask: AskCard = {
    on: nextSlug(slugName(name), taken),
    name,
    x: Math.round(x),
    y: Math.round(y),
    from: parent.on,
    carry: Math.max(0, Math.floor(carry)),
  };
  return { asks: [...asks, ask], ask };
}

/**
 * RENAME one ask card: the person's name changes and NOTHING else does.
 *
 * STORY 17.10 — an empty ask card names itself from its first question's short
 * form, and the person can rename it at any time. Identity is the SLUG (the
 * wire target and the conversation's file name), so a rename never mints a new
 * one and never moves a wire. The anchor is legacy display and is left exactly
 * as the record had it: this helper cannot write one. A slug this file does not
 * carry answers `null`, never an appended card.
 */
export function renameAsk(
  asks: readonly AskCard[],
  slug: string,
  name: string,
): AskCard[] | null {
  if (!asks.some((ask) => ask.on === slug)) return null;
  return asks.map((ask) => (ask.on === slug ? { ...ask, name } : ask));
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
  // The optional join, read as written: a non-empty id on an answer line, or
  // the key absent. Anything else is out of shape and stays a preserved line.
  const move = record.move;
  if (move !== undefined && (typeof move !== "string" || move === "")) return null;
  const turn: AskTurn = { role, text, t };
  if (move !== undefined) turn.move = move;
  return turn;
}

/** One turn as its canonical JSONL line (keys sorted by the house seam). */
export function serializeTurnLine(turn: AskTurn): string {
  return canonicalJsonlLine({
    role: turn.role,
    text: turn.text,
    t: turn.t,
    ...(turn.move === undefined ? {} : { move: turn.move }),
  });
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
 * STORY 17.8 — EVERY CONVERSATION THE FOLDER HOLDS, and the ones whose ask card
 * is gone. ONE listing of `map/asks/`, then one read per card that is on the
 * map; a `.jsonl` whose slug `asks.txt` does not carry is an ORPHAN — named
 * for the notices group and the mirror, kept exactly where it is, never read
 * into a card, never adopted and never deleted (the notes' rule, one family
 * over). A missing folder is a fresh workspace, not an error.
 */
export interface LoadedAskConversations {
  /** Each ask card's turns, keyed by the slug the card carries. */
  turns: Record<string, ParsedTurns>;
  /** Slugs whose conversation file exists but whose ask card is gone. */
  orphans: string[];
}

export async function loadAskConversations(
  workspacePath: string,
  slugs: readonly string[],
  io: AskIo = ASK_IO,
): Promise<LoadedAskConversations> {
  const names = io.listDir === undefined
    ? slugs.map((slug) => slug + ".jsonl")
    : await io.listDir(askTurnsDir(workspacePath));
  const onMap = new Set(slugs);
  const turns: Record<string, ParsedTurns> = {};
  const orphans: string[] = [];
  // A stray file that is not a conversation is left alone: the folder is the
  // person's, and only `.jsonl` names a conversation here.
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
      turns[slug] = await loadTurns(workspacePath, slug, io);
    }),
  );
  // A card whose conversation file is absent still has an empty conversation;
  // an absent file is never invented into turns.
  for (const slug of slugs) {
    if (turns[slug] === undefined) turns[slug] = { turns: [], malformed: [] };
  }
  orphans.sort();
  return { turns, orphans };
}

/**
 * STORY 17.8 — RESTORE one conversation EXACTLY: the bytes the delete read into
 * memory go back verbatim, whole. This is deliberately NOT a turn append: a
 * restored conversation is the same document it was, malformed lines and all,
 * and the writer never re-serializes what it did not author.
 */
export async function restoreConversation(
  workspacePath: string,
  slug: string,
  text: string,
  io: AskIo = ASK_IO,
): Promise<void> {
  await io.createDirAll(askTurnsDir(workspacePath));
  await io.writeTextFile(askTurnPath(workspacePath, slug), text);
}

/** The ask lines without one slug (the removal's next record). */
export function withoutAsk(
  asks: readonly AskCard[],
  slug: string,
): AskCard[] {
  return asks.filter((ask) => ask.on !== slug);
}

/** Put one ask line back at its old file position (clamped, never out of range). */
export function insertAskAt(
  asks: readonly AskCard[],
  index: number,
  ask: AskCard,
): AskCard[] {
  const without = withoutAsk(asks, ask.on);
  const at = index < 0 || index > without.length ? without.length : index;
  return [...without.slice(0, at), ask, ...without.slice(at)];
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
  move: string | null = null,
): Promise<AskTurn[]> {
  const turns = await appendTurn(
    workspacePath,
    slug,
    { role: "person", text: question, t: now() },
    io,
  );
  if (answer === null) return turns;
  // THE JOIN (story 17.4): the answer line names the Move the sending turn
  // made, so the two records point at each other. The person's line above
  // never does — no Move happened until the turn sent. The PRISM was written
  // before this call, so its id exists; null means no Move was made (a turn
  // that never left, which also has no answer line).
  return await appendTurn(
    workspacePath,
    slug,
    {
      role: "answer",
      text: answer,
      t: now(),
      ...(move === null ? {} : { move }),
    },
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
 * STORY 17.10 — WHAT AN EMPTY ASK READS UNTIL IT HAS ASKED ANYTHING. The
 * double-click's ask is created with nothing from the click but the point, so
 * it needs a name that says what it is rather than inventing a topic.
 * PROVISIONAL wording.
 */
export const ASK_UNTITLED_NAME = "Untitled ask";

/** How much of the first question becomes the card's name (PROVISIONAL). */
export const ASK_NAME_SHORT = 40;

/**
 * STORY 17.10 — THE SHORT FORM OF A QUESTION, PURE: the first non-empty line,
 * its runs of whitespace collapsed to one space, cut at a stated length with an
 * ellipsis. The card NAMES ITSELF from this when it is still "Untitled ask";
 * the person's own rename always wins (the writer checks the sentinel first).
 * The name is a title, not a record of the question — the conversation holds
 * the words verbatim.
 */
export function askNameFromQuestion(question: string): string {
  const line =
    question
      .split(/\r?\n/)
      .map((part) => part.trim())
      .find((part) => part !== "") ?? "";
  const oneLine = line.replace(/\s+/g, " ").trim();
  if (oneLine.length <= ASK_NAME_SHORT) return oneLine;
  return oneLine.slice(0, ASK_NAME_SHORT).trimEnd() + "…";
}

/**
 * The name the affordance PROPOSES for a new ask card (PROVISIONAL): the
 * source card's name plus the noun for what the card is, so the person edits
 * their own words rather than typing a name from nothing. The selection card's
 * idiom, with the source's name in place of selected text. STORY 17.10: the
 * proposal names the SOURCE, never binds it — the source arrives as a wire.
 * Only the person's confirm writes anything.
 */
export function proposeAskName(anchorName: string): string {
  const name = anchorName.trim();
  return name === "" ? "a question" : name + " question";
}

/**
 * The name the fork verb PROPOSES (story 17.5), PURE and PROVISIONAL: the
 * parent's own words plus the noun for the new card, so the person edits or
 * accepts rather than typing a name from nothing (the creation idiom). A blank
 * parent name still proposes a noun rather than an empty field.
 */
export function proposeForkName(parentName: string): string {
  const name = parentName.trim();
  return name === "" ? "a fork" : name + " fork";
}

/**
 * THE ROLE MARK (story 17.2), PURE: one quiet word that says who spoke, so a
 * person's line and an answer line are told apart without a bubble, an avatar
 * or a timestamp. The words themselves are never prefixed inside the record;
 * only the reading surface adds the mark.
 */
export function askRoleMark(role: AskRole): string {
  return role === "person" ? "you" : "answer";
}

/** One turn as the small face reads it: role mark, then the words VERBATIM. */
export function askTurnLine(turn: AskTurn): string {
  return askRoleMark(turn.role) + ": " + turn.text;
}

/**
 * THE LAST TURN (story 17.2), PURE: the small face shows the newest turn, not
 * the first line of the thread and not a count. File order IS conversation
 * order — the append-only record is never sorted — so the last element is the
 * last thing said. An empty conversation has no last turn (never an invented
 * one).
 */
export function askLastTurn(turns: readonly AskTurn[]): AskTurn | null {
  return turns.length === 0 ? null : turns[turns.length - 1]!;
}

/**
 * What the small card CROPS (story 17.2): the LAST turn as a role-marked line,
 * which the card's existing `previewText` helper then cuts at the person's
 * stated count. PURE, so the crop is not the JSX's only truth. The words are
 * verbatim; only the mark is the reader's.
 */
export function askLastTurnText(turns: readonly AskTurn[]): string {
  const last = askLastTurn(turns);
  return last === null ? "" : askTurnLine(last);
}

/* ------------------------------------------------------------------------- *
 * THE THREAD'S BOUND (story 17.3) — what a packet may carry of what was said.
 *
 * The conversation becomes CONTEXT for the next turn, but a conversation grows
 * without limit and a packet is a BOUNDED view (ADR-0029's amendment). So the
 * thread rides under a stated bound: the most recent WHOLE turns, capped by a
 * turn count AND a byte budget — whichever bites first. The numbers are
 * PROVISIONAL and they live HERE, never in the packet's text: the text says
 * the bound in words, and the declaration shows the bytes.
 *
 * WHOLE TURNS ONLY. A turn is never cut mid-sentence to make the numbers fit:
 * a turn that does not fit as a whole is left out, and because the selection is
 * always the newest turns in order, what is left out is always the OLDER ones —
 * a contiguous tail of the conversation, never a gap and never a half turn.
 * ------------------------------------------------------------------------- */

/** One stated bound: the smaller of a turn count and a byte budget (PROVISIONAL). */
export interface AskThreadBound {
  /** The most turns one packet's thread may carry. */
  turns: number;
  /** The most bytes the rendered thread may take. */
  bytes: number;
}

/**
 * THE STATED BOUND (PROVISIONAL, story 17.3): eight turns or four KiB,
 * whichever is smaller. Provisional because a bound is a product choice, not a
 * law: the law is that a bound is stated and the exact bytes are openable.
 */
export const ASK_THREAD_BOUND: AskThreadBound = { turns: 8, bytes: 4 * 1024 };

/** What the bound selected: the newest whole turns, in conversation order. */
export interface AskThreadSelection {
  /** The selected turns, OLDEST first — the order they were said. */
  turns: AskTurn[];
  /** Whether earlier turns were left out (the qualitative fact, never a count). */
  omitted: boolean;
}

/**
 * THE ROLE AS THE RECORD HEARS IT (story 17.3), PURE: a packet's thread is read
 * by a MODEL, so the card's "you" would point at the wrong speaker. The words
 * stay verbatim; only the mark is the reader's — and it is the same mark the
 * byte budget counts, so the bound measures exactly what the block shows.
 */
export function askThreadLine(turn: AskTurn): string {
  return (turn.role === "person" ? "person" : "answer") + ": " + turn.text;
}

/**
 * THE THREAD UNDER ITS BOUND (story 17.3), PURE: the most recent WHOLE turns
 * that fit BOTH bounds, returned in conversation order. The walk goes backwards
 * from the newest turn and stops at the first one that does not fit — so a turn
 * is never truncated, and the selection is always a contiguous tail of the
 * conversation. `omitted` is the one fact the packet turns into a sentence; the
 * numbers themselves never enter the packet's text.
 */
export function lastTurns(
  turns: readonly AskTurn[],
  count: number,
  bytes: number,
): AskThreadSelection {
  const selected: AskTurn[] = [];
  let size = 0;
  for (let at = turns.length - 1; at >= 0; at -= 1) {
    if (selected.length + 1 > count) break;
    // The budget counts the thread AS IT RENDERS: the role word, the words
    // verbatim, and the newline that joins this turn to the one before it.
    const add =
      utf8ByteLength(askThreadLine(turns[at]!)) +
      (selected.length === 0 ? 0 : 1);
    if (size + add > bytes) break;
    selected.push(turns[at]!);
    size += add;
  }
  return {
    turns: selected.reverse(),
    omitted: selected.length < turns.length,
  };
}

/* ------------------------------------------------------------------------- *
 * THE FORK'S THREAD (story 17.5) — carried by reference, never copied.
 *
 * A fork reads the parent's first `carry` turns from the PARENT'S OWN FILE on
 * every render and every send; the fork's file holds only what was said in the
 * fork. These functions are PURE: they are handed the parent's turns (or null,
 * when the parent is not on the map) and arrange a view. Nothing is written,
 * repaired or invented, and the missing case is exactly the state the card
 * states in one quiet line.
 *
 * ONE LEVEL, DELIBERATELY: the parent's turns are its OWN turns. A fork of a
 * fork therefore carries the second card's words only — the first card's
 * prefix is one branch back and is never resolved transitively. That keeps
 * every fork one record away from the words it shows.
 * ------------------------------------------------------------------------- */

/** What a fork's card reads: the carried prefix, then its own turns. */
export interface AskForkThread {
  /** The turns carried from the parent (the first `carry`, whole turns). */
  carried: readonly AskTurn[];
  /** The thread as the card renders and the packet sends: carried, then own. */
  turns: readonly AskTurn[];
  /** The parent the record names is not on the map (stated, never repaired). */
  missing: boolean;
}

/**
 * THE CARRIED PREFIX, PURE: the parent's first `carry` turns, WHOLE turns only
 * (a prefix by count can never cut one), in the order they were said. A parent
 * with fewer turns than the record asks for yields what it has — the record is
 * the person's, and reading is not repairing. A missing parent yields none.
 */
export function carriedTurns(
  carry: number,
  parentTurns: readonly AskTurn[] | null,
): AskTurn[] {
  if (parentTurns === null) return [];
  const count = Number.isFinite(carry) ? Math.max(0, Math.floor(carry)) : 0;
  return parentTurns.slice(0, count);
}

/**
 * THE FORK'S WHOLE THREAD, PURE: the carried prefix then the card's own turns,
 * or just its own turns when it is not a fork. `parentTurns` is null exactly
 * when the map does not carry the parent card — the card then says so and
 * still reads and sends everything that is its own. The prefix is read, never
 * copied: this function only arranges the caller's arrays.
 */
export function forkThread(
  ask: AskCard,
  ownTurns: readonly AskTurn[],
  parentTurns: readonly AskTurn[] | null,
): AskForkThread {
  if (!isFork(ask)) {
    return { carried: [], turns: ownTurns, missing: false };
  }
  const carried = carriedTurns(ask.carry ?? 0, parentTurns);
  return {
    carried,
    turns: carried.length === 0 ? ownTurns : [...carried, ...ownTurns],
    missing: parentTurns === null,
  };
}
