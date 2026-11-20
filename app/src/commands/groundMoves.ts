import type { GhostStep, GhostTarget } from "../ghost/envelope";
import { issue, type GhostIssue } from "../ghost/issues";
import {
  appendLine,
  type MoveDefinition,
} from "../ghost/registry";
import {
  GROUND_SELF_LINK_REFUSAL,
  parseGroundLinkLine,
  parseGroundLinks,
  serializeGroundLinkLine,
  type GroundLink,
} from "../map/groundLinks";
import {
  parseGround,
  parseGroundLine,
  serializeGroundLine,
  addGroundReference,
} from "../map/ground";
import { parseAskLine, parseAsks, serializeAskLine, addAsk } from "../map/asks";
import { noteByteLength, NOTE_MAX_BYTES } from "../map/notes";

/**
 * STORY 21.1 — THE GROUND MOVES THE COMMAND CARD SPEAKS (ADR-0038 §3 and §4).
 *
 * The PORTABLE vocabulary (`commands/acts.ts`) names acts, never record files.
 * This module is the app's half of the seam: it turns one act into ONE ghost
 * body the existing intake already knows how to wrap, validate, file and
 * apply — a registered move, its params schema, its target rules, one deriver
 * and one dry-run closure, exactly as `ghost/registry.ts` declares them.
 *
 * WHY A TABLE HERE AND NOT A NEW ROW IN `MOVES`: the app's registry is the
 * LIVE map-edit table (ADR-0025's expansion gate), and it stays one move. The
 * ghost SESSION takes a table as an option (STORY 21.1), so the command card's
 * headless host can register the ground rows it needs WITHOUT registering them
 * in the app: a ghost filed by a script accepts only through the session that
 * filed it, and the app's own tablets are unchanged.
 *
 * The rows are PROVISIONAL with the act names (ADR-0038's consequences): a
 * card carries the words the person will read as its name — the one place a
 * proposal carries a name, which the person coins by accepting (AGENTS.md's
 * guardrail) — a wire is one wordless pair, a note is one card's file, and an
 * ask is one peer card, with the person's unsent question riding the proposal
 * as a DRAFT and never a record (STORY 21.7: an unsent question is a draft;
 * only the person's send writes a conversation line).
 *
 * THE NEVER-LIST IS ABSENT BY CONSTRUCTION: there is no row here for deleting,
 * renaming, keys, provider rows, runs, turns or anything outside the map
 * folder. The table cannot say what it does not carry, and the vocabulary is
 * the whole of what a command can name (ADR-0038 §7).
 */

/** The ground map's card records file (PROVISIONAL with the act names). */
export const GROUND_CARD_FILE = "map/ground.txt";

/** The ground map's wiring file. */
export const GROUND_WIRE_FILE = "map/ground-links.txt";

/** The ask cards' file. */
export const GROUND_ASK_FILE = "map/asks.txt";

/** One note's file, named by the card it is about. */
export function groundNoteFile(slug: string): string {
  return `map/notes/${slug}.md`;
}

/**
 * STORY 21.7 — ONE ASK CARD'S CONVERSATION FILE, named by the card it belongs
 * to (`map/asks/<slug>.jsonl`, the shape `map/asks.ts` reads). A removal that
 * takes the transcript names it the way the note removal names `map/notes/`.
 */
export function groundAskTurnFile(slug: string): string {
  return `map/asks/${slug}.jsonl`;
}

/** The one sentence a note proposal answers when its card is gone. */
export const NOTE_CARD_REFUSAL =
  "a note needs a card on the map; that one is not here.";

/** The one sentence a note that is too long answers. */
export const NOTE_LENGTH_REFUSAL = "that note is too long to keep.";

/**
 * A line-for-line comparison of two collections rendered by one serializer.
 * The closures use it so an existing line is never rewritten or reordered —
 * the append-only rule the ghost grammar proves.
 */
function prefixIssues(
  before: readonly string[],
  after: readonly string[],
): GhostIssue[] {
  if (after.length !== before.length + 1) {
    return [
      issue(
        "append-only",
        `the dry run would hold ${after.length} records, not ${before.length + 1}`,
      ),
    ];
  }
  for (let index = 0; index < before.length; index += 1) {
    if (before[index] !== after[index]) {
      return [
        issue("append-only", "the dry run would rewrite or reorder an existing line"),
      ];
    }
  }
  return [];
}

/**
 * CARD/ADD — one card at a stated point, named by the proposal. The slug is
 * minted the map's own way against the references already on the ground, so
 * the accepted record is exactly what the app's own `addGroundReference`
 * would have written.
 */
function deriveAddCardSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  const label = params.label;
  if (target.kind !== "spot" || typeof label !== "string") return [];
  const base = parseGround(before ?? "");
  const addition = addGroundReference(base.references, label, target.x, target.y);
  return [
    {
      op: "append",
      file: GROUND_CARD_FILE,
      line: serializeGroundLine(addition.reference),
    },
  ];
}

function closureAddCard(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (after === null) {
    return [issue("append-only", "adding a card cannot remove the file")];
  }
  const label = params.label;
  if (target.kind !== "spot" || typeof label !== "string") {
    return [issue("params", "the card proposal has no point or no label")];
  }
  const base = parseGround(before ?? "");
  const addition = addGroundReference(base.references, label, target.x, target.y);
  const expected = serializeGroundLine(addition.reference);
  const result = parseGround(after);
  const issues = prefixIssues(
    base.references.map(serializeGroundLine),
    result.references.map(serializeGroundLine),
  );
  if (issues.length > 0) return issues;
  if (result.references[result.references.length - 1] !== undefined) {
    if (serializeGroundLine(result.references[result.references.length - 1]) !== expected) {
      return [issue("append-only", "the dry run's last record is not this card")];
    }
  }
  if (result.malformed.length !== base.malformed.length) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/**
 * WIRE/ADD — one wordless pair of existing cards (a ground link has no word,
 * no sign and no reader of its direction). The record layer's own draw would
 * REPLACE an identical pair; a ghost only appends, so a pair already drawn is
 * refused rather than silently re-ordered.
 */
function deriveAddWireSteps(
  target: GhostTarget,
  _params: Record<string, unknown>,
  _before: string | null,
): GhostStep[] {
  if (target.kind !== "link") return [];
  return [
    {
      op: "append",
      file: GROUND_WIRE_FILE,
      line: serializeGroundLinkLine({ from: target.from, to: target.to }),
    },
  ];
}

function closureAddWire(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (after === null) {
    return [issue("append-only", "adding a wire cannot remove the file")];
  }
  if (target.kind !== "link") {
    return [issue("params", "the wire proposal has no pair")];
  }
  if (target.from === target.to) {
    return [issue("params", GROUND_SELF_LINK_REFUSAL)];
  }
  const base = parseGroundLinks(before ?? "");
  const pair = base.links.find(
    (link: GroundLink) => link.from === target.from && link.to === target.to,
  );
  if (pair !== undefined) {
    return [
      issue(
        "append-only",
        "the map already wires those two cards; v1 only appends a new pair",
      ),
    ];
  }
  const expected = serializeGroundLinkLine({ from: target.from, to: target.to });
  const result = parseGroundLinks(after);
  const issues = prefixIssues(
    base.links.map(serializeGroundLinkLine),
    result.links.map(serializeGroundLinkLine),
  );
  if (issues.length > 0) return issues;
  const last = result.links[result.links.length - 1];
  if (last === undefined || serializeGroundLinkLine(last) !== expected) {
    return [issue("append-only", "the dry run's last record is not this wire")];
  }
  if (result.malformed.length !== base.malformed.length) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/**
 * NOTE/ADD — one card's note, in the file the card's slug names. A note is the
 * person's own words in a plain file (never a line record), so this move's
 * file is TARGET-DEPENDENT — the reason `MoveDefinition.filesFor` exists.
 */
function deriveAddNoteSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  _before: string | null,
): GhostStep[] {
  const text = params.text;
  if (target.kind !== "card" || typeof text !== "string") return [];
  return [{ op: "append", file: groundNoteFile(target.slug), line: text }];
}

function closureAddNote(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (after === null) {
    return [issue("append-only", "adding a note cannot remove the file")];
  }
  const text = params.text;
  if (target.kind !== "card") {
    return [issue("params", NOTE_CARD_REFUSAL)];
  }
  if (typeof text !== "string") {
    return [issue("params", "the note proposal has no words")];
  }
  if (noteByteLength(text) > NOTE_MAX_BYTES) {
    return [issue("params", NOTE_LENGTH_REFUSAL)];
  }
  if (!after.startsWith(before ?? "")) {
    return [issue("append-only", "the dry run would rewrite the note's existing bytes")];
  }
  if (after !== appendLine(before, text)) {
    return [issue("append-only", "the dry run's bytes are not the base plus this note")];
  }
  return [];
}

/**
 * ASK/ADD — one PEER ask card at a stated point, named by the proposal. The
 * question is NOT carried: an unsent question is not a record, and only a sent
 * turn is written (the person types before pressing send). The card is the
 * record this act can honestly propose.
 */
function deriveAddAskSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  const label = params.label;
  if (target.kind !== "spot" || typeof label !== "string") return [];
  const base = parseAsks(before ?? "");
  const taken = new Set(base.asks.map((ask) => ask.on));
  const addition = addAsk(base.asks, taken, label, target.x, target.y);
  return [
    {
      op: "append",
      file: GROUND_ASK_FILE,
      line: serializeAskLine(addition.ask),
    },
  ];
}

function closureAddAsk(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (after === null) {
    return [issue("append-only", "adding an ask card cannot remove the file")];
  }
  const label = params.label;
  if (target.kind !== "spot" || typeof label !== "string") {
    return [issue("params", "the ask proposal has no point or no label")];
  }
  const base = parseAsks(before ?? "");
  const taken = new Set(base.asks.map((ask) => ask.on));
  const addition = addAsk(base.asks, taken, label, target.x, target.y);
  const expected = serializeAskLine(addition.ask);
  const result = parseAsks(after);
  const issues = prefixIssues(
    base.asks.map(serializeAskLine),
    result.asks.map(serializeAskLine),
  );
  if (issues.length > 0) return issues;
  const last = result.asks[result.asks.length - 1];
  if (last === undefined || serializeAskLine(last) !== expected) {
    return [issue("append-only", "the dry run's last record is not this ask")];
  }
  if (result.malformed.length !== base.malformed.length) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/*
 * STORY 21.7 — AN ASK CARD'S REMOVAL IS THE APP'S OWN DELETE SHAPE (ADR-0038's
 * 2026-11-20 amendment: the command card is a PRIMARY way to use the app, and
 * "remove that ask" has to mean what the card's own x means). The app's shape
 * has exactly two steps — the record line first (the record is the truth),
 * then the conversation file that goes with it — and they are TWO ghosts
 * because a ghost is one file, one change (ADR-0025 decision 3): the act files
 * the documented pair, in the shape's own order. Restoring is the app's own
 * Restore, which is why the pair writes nothing but the two files the app's
 * delete reads before it unlinks.
 *
 * THE SECOND STEP CAN NAME A CARD WHOSE LINE JUST LEFT: `snapshot.asks` counts
 * an ask card while its conversation is still on the map (grammar.ts states
 * why), so the two accepts do not race each other in the wrong direction.
 */

/** REMOVE ASK — drop the one `asks.txt` line naming this card. */
function deriveRemoveAskSteps(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "ask") return [];
  const line = rawLineWhere(before, (raw) => {
    const ask = parseAskLine(raw);
    return ask !== null && ask.on === target.slug;
  });
  if (line === null) return [];
  return [{ op: "remove", file: GROUND_ASK_FILE, line }];
}

function closureRemoveAsk(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "ask") {
    return [issue("params", "the ask removal has no ask card")];
  }
  if (after === null) {
    return [issue("append-only", "removing one ask card cannot leave no file")];
  }
  const base = parseAsks(before ?? "");
  const at = base.asks.findIndex((ask) => ask.on === target.slug);
  if (at === -1) {
    return [issue("append-only", "the map does not carry that ask card")];
  }
  const expected = base.asks
    .filter((_ask, index) => index !== at)
    .map(serializeAskLine);
  const result = parseAsks(after);
  if (result.asks.map(serializeAskLine).join("\n") !== expected.join("\n")) {
    return [issue("append-only", "the dry run did not drop exactly this one ask card")];
  }
  if (result.malformed.join("\n") !== base.malformed.join("\n")) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/**
 * REMOVE ASK TURNS — the conversation file goes, the way the app's own delete
 * takes it AFTER the record line. No line is named because the whole file is
 * the one thing this ghost removes; `null` before means there is no
 * conversation to take (a card never asked in), which the deriver refuses by
 * deriving nothing rather than inventing an empty file to delete.
 */
function deriveRemoveAskTurnsSteps(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "ask" || before === null) return [];
  return [{ op: "remove", file: groundAskTurnFile(target.slug) }];
}

function closureRemoveAskTurns(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "ask") {
    return [issue("params", "the conversation removal has no ask card")];
  }
  if (before === null) {
    return [issue("append-only", "there is no conversation file for that ask card")];
  }
  if (after !== null) {
    return [issue("append-only", "removing a conversation must remove its one file")];
  }
  return [];
}

/*
 * STORY 21.6 — THE REMOVALS (ADR-0038's 2026-11-20 amendment: a primary
 * surface with only adds cannot fix a mistake it just made). Each row removes
 * exactly ONE thing and derives exactly ONE step; nothing here cascades and
 * nothing here deletes more than the person named.
 *
 * HOW A REMOVAL IS EXPRESSED: the ghost step vocabulary gained a second op
 * (envelope.ts). A record-file removal names the EXACT line the base holds, so
 * the dry run drops that one line and keeps every other byte (malformed and
 * hand-formatted lines included); a note is one file, so its removal names no
 * line and the file itself goes. The line is read from the base bytes the
 * deriver is handed — never re-serialized from a parse — so a hand-edited file
 * keeps every byte the removal did not take. PROVISIONAL with the act names.
 *
 * A CARD'S WIRES ARE NOT THIS MOVE'S BUSINESS: removing a card's ground line
 * leaves its links in `ground-links.txt` as preserved, REPORTED orphans (the
 * links family's own rule); the app's delete path is where the cascade lives
 * and this ghost must not guess at it.
 */

/**
 * The raw line in a record file whose parsed form satisfies `matches`, or
 * null. The RAW segment is returned (a CR included when the file is CRLF), so
 * the step names bytes the file actually holds.
 */
function rawLineWhere(
  before: string | null,
  matches: (line: string) => boolean,
): string | null {
  if (before === null) return null;
  for (const segment of before.split("\n")) {
    const bare = segment.replace(/\r$/, "");
    if (matches(bare)) return segment;
  }
  return null;
}

/** UNWIRE — drop the one line holding this exact ordered pair. */
function deriveUnwireSteps(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "link") return [];
  const line = rawLineWhere(before, (raw) => {
    const link = parseGroundLinkLine(raw);
    return link !== null && link.from === target.from && link.to === target.to;
  });
  if (line === null) return [];
  return [{ op: "remove", file: GROUND_WIRE_FILE, line }];
}

function closureUnwire(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "link") {
    return [issue("params", "the unwire proposal has no pair")];
  }
  if (after === null) {
    return [issue("append-only", "removing one wire cannot leave no file")];
  }
  const base = parseGroundLinks(before ?? "");
  const key = serializeGroundLinkLine({ from: target.from, to: target.to });
  const at = base.links.findIndex(
    (link: GroundLink) => serializeGroundLinkLine(link) === key,
  );
  if (at === -1) {
    return [issue("append-only", "the map does not wire those two cards")];
  }
  const expected = base.links
    .filter((_link: GroundLink, index: number) => index !== at)
    .map(serializeGroundLinkLine);
  const result = parseGroundLinks(after);
  if (result.links.map(serializeGroundLinkLine).join("\n") !== expected.join("\n")) {
    return [issue("append-only", "the dry run did not drop exactly this one wire")];
  }
  if (result.malformed.join("\n") !== base.malformed.join("\n")) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/** REMOVE NOTE — one card's note file goes; no line is named because no line exists. */
function deriveRemoveNoteSteps(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "card" || before === null) return [];
  return [{ op: "remove", file: groundNoteFile(target.slug) }];
}

function closureRemoveNote(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "card") {
    return [issue("params", NOTE_CARD_REFUSAL)];
  }
  if (before === null) {
    return [
      issue(
        "append-only",
        "there is no note file to remove for that card",
      ),
    ];
  }
  if (after !== null) {
    return [issue("append-only", "removing a note must remove its one file")];
  }
  return [];
}

/** REMOVE CARD — drop the one ground line naming this card. */
function deriveRemoveCardSteps(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "card") return [];
  const line = rawLineWhere(before, (raw) => {
    const card = parseGroundLine(raw);
    return card !== null && card.on === target.slug;
  });
  if (line === null) return [];
  return [{ op: "remove", file: GROUND_CARD_FILE, line }];
}

function closureRemoveCard(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "card") {
    return [issue("params", "the card removal has no card")];
  }
  if (after === null) {
    return [issue("append-only", "removing one card cannot leave no file")];
  }
  const base = parseGround(before ?? "");
  const key = target.slug;
  const at = base.references.findIndex((reference) => reference.on === key);
  if (at === -1) {
    return [issue("append-only", "the map does not carry that card")];
  }
  const expected = base.references
    .filter((_reference, index) => index !== at)
    .map(serializeGroundLine);
  const result = parseGround(after);
  if (result.references.map(serializeGroundLine).join("\n") !== expected.join("\n")) {
    return [issue("append-only", "the dry run did not drop exactly this one card")];
  }
  if (result.malformed.join("\n") !== base.malformed.join("\n")) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/** The target rules every ground move shares: one kind, the rest refused. */
function only(
  allowed: "spot" | "link" | "card" | "ask",
  refusals: ReadonlyArray<{
    kind: "word" | "loop" | "spot" | "link" | "card" | "ask";
    why: string;
  }>,
): MoveDefinition["targets"] {
  const rows: Array<MoveDefinition["targets"][number]> = [];
  for (const kind of ["word", "loop", "spot", "link", "card", "ask"] as const) {
    if (kind === allowed) {
      rows.push({ kind, allowed: true });
    } else {
      const refusal = refusals.find((entry) => entry.kind === kind);
      rows.push({
        kind,
        allowed: false,
        refusal: refusal?.why ?? `this move is about one ${allowed}`,
      });
    }
  }
  return rows;
}

const CARD_ROW: MoveDefinition = {
  move: { family: "card", verb: "add" },
  game: "ground",
  files: [GROUND_CARD_FILE],
  params: [{ key: "label", kind: "text" }],
  targetCount: 1,
  targets: only("spot", [
    { kind: "word", why: "a card is placed at a point; the point is the target" },
    { kind: "card", why: "a card is placed at a point; the point is the target" },
    { kind: "link", why: "a card is placed at a point; the point is the target" },
  ]),
  steps: deriveAddCardSteps,
  closure: closureAddCard,
  boundary:
    "Add one card at one point, with the words it would carry. Nothing else changes: no existing card, wire, note, reading or ask is rewritten, renamed or removed. Nothing is wired and nothing is asked.",
};

const WIRE_ROW: MoveDefinition = {
  move: { family: "wire", verb: "add" },
  game: "ground",
  files: [GROUND_WIRE_FILE],
  params: [],
  targetCount: 1,
  targets: only("link", [
    { kind: "word", why: "a wire names the two cards it joins" },
    { kind: "loop", why: "a wire names the two cards it joins" },
    { kind: "spot", why: "a wire names the two cards it joins" },
    { kind: "card", why: "a wire names BOTH cards; one card is not a wire" },
  ]),
  steps: deriveAddWireSteps,
  closure: closureAddWire,
  boundary:
    "Wire two cards that are already on the map. Nothing else changes: no card, note, reading, ask or existing wire is added, rewritten or removed.",
};

const NOTE_ROW: MoveDefinition = {
  move: { family: "note", verb: "add" },
  game: "ground",
  files: [],
  filesFor: (target) =>
    target.kind === "card" ? [groundNoteFile(target.slug)] : [],
  params: [{ key: "text", kind: "text" }],
  targetCount: 1,
  targets: only("card", [
    { kind: "word", why: "a note belongs to a card on this map" },
    { kind: "loop", why: "a note belongs to a card on this map" },
    { kind: "spot", why: "a note belongs to a card on this map" },
    { kind: "link", why: "a note belongs to a card on this map" },
  ]),
  steps: deriveAddNoteSteps,
  closure: closureAddNote,
  boundary:
    "Add the person's words as one card's note. Nothing else changes: the card's name, point, reading and wires stay exactly as they are, and no other card is touched.",
};

const ASK_ROW: MoveDefinition = {
  move: { family: "ask", verb: "add" },
  game: "ground",
  files: [GROUND_ASK_FILE],
  // STORY 21.7 — THE DRAFT IS A PROPOSAL'S OWN WORD, NOT A RECORD'S. `draft` is
  // the question the person has not sent: the deriver IGNORES it (the steps are
  // exactly the one card line), so accepting this ghost writes no question
  // anywhere. The adapter reads it back off the accepted proposal and hands it
  // to the card's composer, where an unsent question belongs.
  params: [
    { key: "label", kind: "text" },
    { key: "draft", kind: "text" },
  ],
  targetCount: 1,
  targets: only("spot", [
    { kind: "word", why: "an ask card is placed at a point; the point is the target" },
    { kind: "card", why: "an ask card is placed at a point; the point is the target" },
    { kind: "link", why: "an ask card is placed at a point; the point is the target" },
    { kind: "ask", why: "an ask card is placed at a point; the point is the target" },
  ]),
  steps: deriveAddAskSteps,
  closure: closureAddAsk,
  boundary:
    "Add one ask card at one point, with the words it would carry. Nothing is sent and no question is recorded: a question the person has not sent waits in the card's composer as a draft, and an unsent question is not a record.",
};

const ASK_REMOVE_ROW: MoveDefinition = {
  move: { family: "ask", verb: "remove" },
  game: "ground",
  files: [GROUND_ASK_FILE],
  params: [],
  targetCount: 1,
  targets: only("ask", [
    { kind: "word", why: "an ask removal names one ask card on this map" },
    { kind: "loop", why: "an ask removal names one ask card on this map" },
    { kind: "spot", why: "an ask removal names one ask card on this map" },
    { kind: "link", why: "an ask removal names one ask card on this map" },
    { kind: "card", why: "an ask card is its own family; a reference card is not one" },
  ]),
  steps: deriveRemoveAskSteps,
  closure: closureRemoveAsk,
  // THE APP'S OWN DELETE SHAPE, STEP ONE: the record line goes first (the
  // record is the truth), and the conversation is its own ghost because a ghost
  // is one file, one change. No cascade is invented here.
  boundary:
    "Remove one ask card's record line, the way the card's own x does first. Nothing else changes here: the conversation is taken by its own step of the same shape.",
};

const ASK_TURNS_REMOVE_ROW: MoveDefinition = {
  move: { family: "ask", verb: "remove-turns" },
  game: "ground",
  files: [],
  filesFor: (target) =>
    target.kind === "ask" ? [groundAskTurnFile(target.slug)] : [],
  params: [],
  targetCount: 1,
  targets: only("ask", [
    { kind: "word", why: "a conversation belongs to one ask card on this map" },
    { kind: "loop", why: "a conversation belongs to one ask card on this map" },
    { kind: "spot", why: "a conversation belongs to one ask card on this map" },
    { kind: "link", why: "a conversation belongs to one ask card on this map" },
    { kind: "card", why: "a reference card has a note and a reading, not a conversation" },
  ]),
  steps: deriveRemoveAskTurnsSteps,
  closure: closureRemoveAskTurns,
  // THE APP'S OWN DELETE SHAPE, STEP TWO: the conversation file goes, whole and
  // only after its line. The bytes a Restore needs were the app's to read
  // before the unlink; this step removes exactly the file that read named.
  boundary:
    "Remove one ask card's conversation, the way the card's own x does after its record line. Nothing else changes: no other card, wire, note or record is touched.",
};

const UNWIRE_ROW: MoveDefinition = {
  move: { family: "wire", verb: "remove" },
  game: "ground",
  files: [GROUND_WIRE_FILE],
  params: [],
  targetCount: 1,
  targets: only("link", [
    { kind: "word", why: "an unwire names the two cards it separates" },
    { kind: "loop", why: "an unwire names the two cards it separates" },
    { kind: "spot", why: "an unwire names the two cards it separates" },
    { kind: "card", why: "an unwire names BOTH cards; one card is not a wire" },
  ]),
  steps: deriveUnwireSteps,
  closure: closureUnwire,
  boundary:
    "Remove one wire between two cards that are already on the map. Nothing else changes: no card, note, reading or other wire is added, rewritten or removed.",
};

const NOTE_REMOVE_ROW: MoveDefinition = {
  move: { family: "note", verb: "remove" },
  game: "ground",
  files: [],
  filesFor: (target) =>
    target.kind === "card" ? [groundNoteFile(target.slug)] : [],
  params: [],
  targetCount: 1,
  targets: only("card", [
    { kind: "word", why: "a note belongs to a card on this map" },
    { kind: "loop", why: "a note belongs to a card on this map" },
    { kind: "spot", why: "a note belongs to a card on this map" },
    { kind: "link", why: "a note belongs to a card on this map" },
  ]),
  steps: deriveRemoveNoteSteps,
  closure: closureRemoveNote,
  boundary:
    "Remove one card's note, with every word it holds. Nothing else changes: the card, its name, point, reading and wires stay exactly as they are.",
};

const CARD_REMOVE_ROW: MoveDefinition = {
  move: { family: "card", verb: "remove" },
  game: "ground",
  files: [GROUND_CARD_FILE],
  params: [],
  targetCount: 1,
  targets: only("card", [
    { kind: "word", why: "a card is one ground line, and its line names it" },
    { kind: "loop", why: "a card is one ground line, and its line names it" },
    { kind: "spot", why: "a card is one ground line, and its line names it" },
    { kind: "link", why: "a card is one ground line, and its line names it" },
  ]),
  steps: deriveRemoveCardSteps,
  closure: closureRemoveCard,
  // NO INVENTED CASCADE: this move takes the card's ground line and stops. Its
  // links stay in `ground-links.txt` as preserved, reported orphans; its
  // reading, note and picture stay where they are. The app's own delete path is
  // where a person's card deletion cascades, and a ghost does not guess at it.
  boundary:
    "Remove one card from the map. Nothing else changes: its wires, reading, note and picture are not taken, because the app's own delete path is where that cascade lives.",
};

/**
 * The command card's ground rows, in the vocabulary's order. Handed to the
 * ghost session's `moves` option by `attentioneerHost.ts`; NEVER appended to
 * the live `MOVES` table (the app's expansion gate is ADR-0025's). STORY 21.6
 * appends the three removal rows — each one ghost, each one change.
 */
export const GROUND_MOVES: readonly MoveDefinition[] = [
  CARD_ROW,
  WIRE_ROW,
  NOTE_ROW,
  ASK_ROW,
  UNWIRE_ROW,
  NOTE_REMOVE_ROW,
  CARD_REMOVE_ROW,
  // STORY 21.7 — the app's delete shape for an ask card, one ghost per step.
  ASK_REMOVE_ROW,
  ASK_TURNS_REMOVE_ROW,
];
