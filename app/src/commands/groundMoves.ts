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
  moveGroundReference,
  withGroundRenamed,
} from "../map/ground";
import {
  parseAskLine,
  parseAsks,
  serializeAskLine,
  addAsk,
  withAskMoved,
  renameAsk,
} from "../map/asks";
// STORY 21.11 — the session card's own record family and its OWN pure writers
// (addSession, bindSessionTool), so an accepted ghost writes exactly the bytes
// the card's own creation and binding verbs write.
import {
  addSession,
  bindSessionTool,
  parseSessionLine,
  parseSessions,
  serializeSessionLine,
} from "../map/sessions";
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
 * THE NEVER-LIST IS ABSENT BY CONSTRUCTION: there is no row here for a key, a
 * provider row, a run, a turn or anything outside the map folder. The table
 * cannot say what it does not carry, and the vocabulary is the whole of what a
 * command can name (ADR-0038 §7). Removal and a proposed name are NOT on that
 * list — a person can take a card back and name one by hand (STORY 21.6, STORY
 * 21.8, and STORY 21.11 for the session card), so the acts may propose them too.
 *
 * STORY 21.11 — THE SESSION CARD'S ROWS. The third family joins the table with
 * its own ghost KIND (`session`, in envelope.ts) and four rows: add, bind, and
 * the two steps of the app's own delete shape. A RUN IS STILL NOT A ROW: a run
 * is an egress and stays the person's press on the card.
 */

/** The ground map's card records file (PROVISIONAL with the act names). */
export const GROUND_CARD_FILE = "map/ground.txt";

/** The ground map's wiring file. */
export const GROUND_WIRE_FILE = "map/ground-links.txt";

/** The ask cards' file. */
export const GROUND_ASK_FILE = "map/asks.txt";

/**
 * STORY 21.11 — the session cards' record file: one line per card, the shape
 * map/sessions.ts reads and writes. PROVISIONAL with the act names.
 */
export const GROUND_SESSION_FILE = "map/sessions.txt";

/**
 * STORY 21.11 — ONE SESSION CARD'S TRANSCRIPT FILE. A session card's removal
 * takes its transcript with it (the app's own delete shape), so the second ghost
 * names this file the way a note's removal names map/notes/.
 */
export function groundSessionTranscriptFile(slug: string): string {
  return "map/sessions/" + slug + ".jsonl";
}

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

/*
 * STORY 21.8 — PLACING AND NAMING, THROUGH THE APP'S OWN ONE-LINE WRITERS
 * (ADR-0038's 2026-11-20 amendment: an agent can add, wire, remove and ask, and
 * what a person does next is TIDY — "put the new card under the rain gauge" and
 * "call this one the evidence gap"). Each row derives exactly ONE rewrite step:
 * the raw line the base holds, and the line the family's own pure writer
 * produces. So the accepted bytes are exactly what the person's drag
 * (`moveGroundReference`, `withAskMoved`) or name pill (`withGroundRenamed`,
 * `renameAsk`) would have written, and every other byte stays put.
 *
 * THE POINT IS THE HOST'S, NEVER THE MODEL'S: the move row reads `x` and `y`
 * from its params, which the adapter computes from two cards' positions with the
 * pure geometry helper. The vocabulary's act payload has no coordinate at all.
 *
 * THE NAME IS A PROPOSAL: the rename row carries the words in `to` (a params key
 * called "name" would hit the ghost grammar's guardrail slot, which is exactly
 * right — a generic patch may not coin a name; THIS row is the one place a name
 * rides a proposal, and the person's accept is the coining). Empty names are
 * refused in the adapter before a ghost is ever filed.
 *
 * PROVISIONAL with the act names: the params keys (`x`, `y`, `to`) and the
 * family/verb spellings here.
 */

/** The exact segment a ground card's line occupies, or null (raw, CR included). */
function groundCardLine(before: string | null, slug: string): string | null {
  return rawLineWhere(before, (raw) => {
    const card = parseGroundLine(raw);
    return card !== null && card.on === slug;
  });
}

/** The exact segment an ask card's line occupies, or null (raw, CR included). */
function askCardLine(before: string | null, slug: string): string | null {
  return rawLineWhere(before, (raw) => {
    const ask = parseAskLine(raw);
    return ask !== null && ask.on === slug;
  });
}

/** The CR a raw record segment carried, so a rewrite keeps the file's style. */
function carriageOf(raw: string): string {
  return raw.endsWith("\r") ? "\r" : "";
}

/** A move's destination, when the adapter computed a finite pair. */
function pointOf(
  params: Record<string, unknown>,
): { x: number; y: number } | null {
  const x = params.x;
  const y = params.y;
  if (typeof x !== "number" || !Number.isFinite(x)) return null;
  if (typeof y !== "number" || !Number.isFinite(y)) return null;
  return { x, y };
}

/** A rename's proposed words, when the adapter handed a non-empty name. */
function proposedNameOf(params: Record<string, unknown>): string | null {
  const to = params.to;
  return typeof to === "string" && to !== "" ? to : null;
}

/** One replace step for the card's exact line and its rewritten bytes. */
function replaceStep(
  file: string,
  line: string,
  withLine: string,
): GhostStep {
  return { op: "replace", file, line, with: withLine };
}

/** MOVE a ground reference to the host's point (the drag's own writer). */
function deriveMoveCardSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "card") return [];
  const point = pointOf(params);
  if (point === null) return [];
  const line = groundCardLine(before, target.slug);
  if (line === null) return [];
  const was = parseGroundLine(line.replace(/\r$/, ""));
  if (was === null) return [];
  const moved = moveGroundReference([was], target.slug, point.x, point.y)[0];
  if (moved === undefined) return [];
  return [
    replaceStep(
      GROUND_CARD_FILE,
      line,
      serializeGroundLine(moved) + carriageOf(line),
    ),
  ];
}

function closureMoveCard(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "card") {
    return [issue("params", "the move has no card")];
  }
  if (after === null) {
    return [issue("append-only", "moving a card cannot remove the file")];
  }
  const point = pointOf(params);
  if (point === null) {
    return [issue("params", "the move has no computed point")];
  }
  const base = parseGround(before ?? "");
  if (!base.references.some((reference) => reference.on === target.slug)) {
    return [issue("append-only", "the map does not carry that card")];
  }
  const expected = moveGroundReference(
    base.references,
    target.slug,
    point.x,
    point.y,
  ).map(serializeGroundLine);
  const result = parseGround(after);
  if (result.references.map(serializeGroundLine).join("\n") !== expected.join("\n")) {
    return [issue("append-only", "the dry run did not move exactly this one card")];
  }
  if (result.malformed.join("\n") !== base.malformed.join("\n")) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/** MOVE an ask card to the host's point (the ask drag's own writer). */
function deriveMoveAskSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "ask") return [];
  const point = pointOf(params);
  if (point === null) return [];
  const line = askCardLine(before, target.slug);
  if (line === null) return [];
  const was = parseAskLine(line.replace(/\r$/, ""));
  if (was === null) return [];
  const moved = withAskMoved([was], target.slug, point.x, point.y)?.[0];
  if (moved === undefined) return [];
  return [
    replaceStep(
      GROUND_ASK_FILE,
      line,
      serializeAskLine(moved) + carriageOf(line),
    ),
  ];
}

function closureMoveAsk(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "ask") {
    return [issue("params", "the move has no ask card")];
  }
  if (after === null) {
    return [issue("append-only", "moving an ask card cannot remove the file")];
  }
  const point = pointOf(params);
  if (point === null) {
    return [issue("params", "the move has no computed point")];
  }
  const base = parseAsks(before ?? "");
  if (!base.asks.some((ask) => ask.on === target.slug)) {
    return [issue("append-only", "the map does not carry that ask card")];
  }
  const moved = withAskMoved(base.asks, target.slug, point.x, point.y);
  if (moved === null) {
    return [issue("append-only", "the map does not carry that ask card")];
  }
  const expected = moved.map(serializeAskLine);
  const result = parseAsks(after);
  if (result.asks.map(serializeAskLine).join("\n") !== expected.join("\n")) {
    return [issue("append-only", "the dry run did not move exactly this one ask card")];
  }
  if (result.malformed.join("\n") !== base.malformed.join("\n")) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/** RENAME a ground reference (the name pill's own writer). */
function deriveRenameCardSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "card") return [];
  const name = proposedNameOf(params);
  if (name === null) return [];
  const line = groundCardLine(before, target.slug);
  if (line === null) return [];
  const was = parseGroundLine(line.replace(/\r$/, ""));
  if (was === null) return [];
  const renamed = withGroundRenamed([was], target.slug, name)[0];
  if (renamed === undefined) return [];
  return [
    replaceStep(
      GROUND_CARD_FILE,
      line,
      serializeGroundLine(renamed) + carriageOf(line),
    ),
  ];
}

function closureRenameCard(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "card") {
    return [issue("params", "the name proposal has no card")];
  }
  if (after === null) {
    return [issue("append-only", "naming a card cannot remove the file")];
  }
  const name = proposedNameOf(params);
  if (name === null) {
    return [issue("params", "the name proposal has no name")];
  }
  const base = parseGround(before ?? "");
  if (!base.references.some((reference) => reference.on === target.slug)) {
    return [issue("append-only", "the map does not carry that card")];
  }
  const expected = withGroundRenamed(
    base.references,
    target.slug,
    name,
  ).map(serializeGroundLine);
  const result = parseGround(after);
  if (result.references.map(serializeGroundLine).join("\n") !== expected.join("\n")) {
    return [issue("append-only", "the dry run did not name exactly this one card")];
  }
  if (result.malformed.join("\n") !== base.malformed.join("\n")) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/** RENAME an ask card (its name pill's own writer). */
function deriveRenameAskSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "ask") return [];
  const name = proposedNameOf(params);
  if (name === null) return [];
  const line = askCardLine(before, target.slug);
  if (line === null) return [];
  const was = parseAskLine(line.replace(/\r$/, ""));
  if (was === null) return [];
  const renamed = renameAsk([was], target.slug, name)?.[0];
  if (renamed === undefined) return [];
  return [
    replaceStep(
      GROUND_ASK_FILE,
      line,
      serializeAskLine(renamed) + carriageOf(line),
    ),
  ];
}

function closureRenameAsk(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "ask") {
    return [issue("params", "the name proposal has no ask card")];
  }
  if (after === null) {
    return [issue("append-only", "naming an ask card cannot remove the file")];
  }
  const name = proposedNameOf(params);
  if (name === null) {
    return [issue("params", "the name proposal has no name")];
  }
  const base = parseAsks(before ?? "");
  if (!base.asks.some((ask) => ask.on === target.slug)) {
    return [issue("append-only", "the map does not carry that ask card")];
  }
  const renamed = renameAsk(base.asks, target.slug, name);
  if (renamed === null) {
    return [issue("append-only", "the map does not carry that ask card")];
  }
  const expected = renamed.map(serializeAskLine);
  const result = parseAsks(after);
  if (result.asks.map(serializeAskLine).join("\n") !== expected.join("\n")) {
    return [issue("append-only", "the dry run did not name exactly this one ask card")];
  }
  if (result.malformed.join("\n") !== base.malformed.join("\n")) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}


/*
 * STORY 21.11 — THE SESSION CARD JOINS THE VOCABULARY (ADR-0038 Amendment 2:
 * the card proposes and the person accepts; undo is the second net AFTER the
 * accept, never a way to start something). Three changes, each through the
 * family's OWN pure writer, so an accepted ghost writes exactly the bytes the
 * card's own verbs write:
 *
 *   - SESSION/ADD appends one sessions.txt line, its slug minted the map's own
 *     way against the cards already in that file (the adapter has already
 *     refused a name the whole shared slug space holds, exactly as the ask row
 *     relies on its adapter to);
 *   - SESSION/BIND rewrites ONE line, and only its row field: bindSessionTool is
 *     the same writer the card's own rebind verb uses, so the name, the point,
 *     the project, the boundary, the model and the transcript are untouched;
 *   - SESSION/REMOVE drops the one sessions.txt line, and SESSION/REMOVE-
 *     TRANSCRIPT takes the transcript file after it — the app's own delete
 *     shape, two ghosts because a ghost is one file, one change (ADR-0025
 *     decision 3).
 *
 * NO ROW HERE STARTS A RUN (ADR-0038 §7's never-list, Amendment 2's spirit): a
 * run is an egress, the task leaves the machine, and that press is the person's.
 * There is no row for a run, a task, a prompt or a message in this table, and
 * there is no key for one.
 */

/** The exact segment a session card's line occupies, or null (raw, CR included). */
function sessionCardLine(before: string | null, slug: string): string | null {
  return rawLineWhere(before, (raw) => {
    const session = parseSessionLine(raw);
    return session !== null && session.on === slug;
  });
}

/** A session card's tool row, when the adapter handed a non-empty row id. */
function toolRowOf(params: Record<string, unknown>): string | null {
  const tool = params.tool;
  return typeof tool === "string" && tool !== "" ? tool : null;
}

/** SESSION/ADD — one session card's line, minted against the file's own slugs. */
function deriveAddSessionSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  const label = params.label;
  const tool = toolRowOf(params);
  if (target.kind !== "spot" || typeof label !== "string" || tool === null) {
    return [];
  }
  const base = parseSessions(before ?? "");
  const taken = new Set(base.sessions.map((session) => session.on));
  const addition = addSession(base.sessions, taken, label, target.x, target.y, tool);
  return [
    {
      op: "append",
      file: GROUND_SESSION_FILE,
      line: serializeSessionLine(addition.session),
    },
  ];
}

function closureAddSession(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (after === null) {
    return [issue("append-only", "adding a session card cannot remove the file")];
  }
  const label = params.label;
  const tool = toolRowOf(params);
  if (target.kind !== "spot" || typeof label !== "string" || tool === null) {
    return [issue("params", "the session proposal has no point, no label or no row")];
  }
  const base = parseSessions(before ?? "");
  const taken = new Set(base.sessions.map((session) => session.on));
  const addition = addSession(base.sessions, taken, label, target.x, target.y, tool);
  const expected = serializeSessionLine(addition.session);
  const result = parseSessions(after);
  const issues = prefixIssues(
    base.sessions.map(serializeSessionLine),
    result.sessions.map(serializeSessionLine),
  );
  if (issues.length > 0) return issues;
  const last = result.sessions[result.sessions.length - 1];
  if (last === undefined || serializeSessionLine(last) !== expected) {
    return [issue("append-only", "the dry run's last record is not this session card")];
  }
  if (result.malformed.length !== base.malformed.length) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/** SESSION/BIND — one line's ROW field, through the card's own binder. */
function deriveBindSessionSteps(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "session") return [];
  const tool = toolRowOf(params);
  if (tool === null) return [];
  const line = sessionCardLine(before, target.slug);
  if (line === null) return [];
  const was = parseSessionLine(line.replace(/\r$/, ""));
  if (was === null) return [];
  const bound = bindSessionTool([was], target.slug, tool)?.[0];
  if (bound === undefined) return [];
  return [
    replaceStep(
      GROUND_SESSION_FILE,
      line,
      serializeSessionLine(bound) + carriageOf(line),
    ),
  ];
}

function closureBindSession(
  target: GhostTarget,
  params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "session") {
    return [issue("params", "the rebind has no session card")];
  }
  if (after === null) {
    return [issue("append-only", "rebinding a card cannot remove the file")];
  }
  const tool = toolRowOf(params);
  if (tool === null) {
    return [issue("params", "the rebind has no tool row")];
  }
  const base = parseSessions(before ?? "");
  if (!base.sessions.some((session) => session.on === target.slug)) {
    return [issue("append-only", "the map does not carry that session card")];
  }
  const bound = bindSessionTool(base.sessions, target.slug, tool);
  if (bound === null) {
    return [issue("append-only", "the map does not carry that session card")];
  }
  const expected = bound.map(serializeSessionLine);
  const result = parseSessions(after);
  if (result.sessions.map(serializeSessionLine).join("\n") !== expected.join("\n")) {
    return [issue("append-only", "the dry run did not rebind exactly this one card")];
  }
  if (result.malformed.join("\n") !== base.malformed.join("\n")) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/** SESSION/REMOVE — drop the one sessions.txt line naming this card. */
function deriveRemoveSessionSteps(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "session") return [];
  const line = sessionCardLine(before, target.slug);
  if (line === null) return [];
  return [{ op: "remove", file: GROUND_SESSION_FILE, line }];
}

function closureRemoveSession(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "session") {
    return [issue("params", "the session removal has no session card")];
  }
  if (after === null) {
    return [issue("append-only", "removing one session card cannot leave no file")];
  }
  const base = parseSessions(before ?? "");
  const at = base.sessions.findIndex((session) => session.on === target.slug);
  if (at === -1) {
    return [issue("append-only", "the map does not carry that session card")];
  }
  const expected = base.sessions
    .filter((_session, index) => index !== at)
    .map(serializeSessionLine);
  const result = parseSessions(after);
  if (result.sessions.map(serializeSessionLine).join("\n") !== expected.join("\n")) {
    return [issue("append-only", "the dry run did not drop exactly this one session card")];
  }
  if (result.malformed.join("\n") !== base.malformed.join("\n")) {
    return [issue("append-only", "the dry run would change the file's preserved lines")];
  }
  return [];
}

/** SESSION/REMOVE-TRANSCRIPT — the transcript file, after its line. */
function deriveRemoveSessionTranscriptSteps(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
): GhostStep[] {
  if (target.kind !== "session" || before === null) return [];
  return [{ op: "remove", file: groundSessionTranscriptFile(target.slug) }];
}

function closureRemoveSessionTranscript(
  target: GhostTarget,
  _params: Record<string, unknown>,
  before: string | null,
  after: string | null,
): readonly GhostIssue[] {
  if (target.kind !== "session") {
    return [issue("params", "the transcript removal has no session card")];
  }
  if (before === null) {
    return [issue("append-only", "there is no transcript file for that session card")];
  }
  if (after !== null) {
    return [issue("append-only", "removing a transcript must remove its one file")];
  }
  return [];
}

/** The target rules every ground move shares: one kind, the rest refused. */
function only(
  allowed: "spot" | "link" | "card" | "ask" | "session",
  refusals: ReadonlyArray<{
    kind: "word" | "loop" | "spot" | "link" | "card" | "ask" | "session";
    why: string;
  }>,
): MoveDefinition["targets"] {
  const rows: Array<MoveDefinition["targets"][number]> = [];
  // STORY 21.11 adds the session card to the kinds a move may be about: the
  // third family gets its own kind for the same reason the ask did — it is not a
  // ground reference, and a rebind or a removal names exactly it.
  for (const kind of ["word", "loop", "spot", "link", "card", "ask", "session"] as const) {
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

/*
 * STORY 21.8 — THE PLACE AND THE NAME, one rewrite each. The destination point
 * and the proposed name ride the ghost's PARAMS; the ghost's target is the card
 * the move/name is about. A reference and an ask card have separate files and
 * separate families, so the same act files one of two rows and the adapter
 * chooses by the card it found.
 */

const CARD_MOVE_ROW: MoveDefinition = {
  move: { family: "card", verb: "move" },
  game: "ground",
  files: [GROUND_CARD_FILE],
  params: [
    { key: "x", kind: "number" },
    { key: "y", kind: "number" },
  ],
  targetCount: 1,
  targets: only("card", [
    { kind: "word", why: "a move is about one card on this map" },
    { kind: "loop", why: "a move is about one card on this map" },
    { kind: "spot", why: "a move is about one card on this map" },
    { kind: "link", why: "a move names BOTH cards; the moving one is the target" },
  ]),
  steps: deriveMoveCardSteps,
  closure: closureMoveCard,
  boundary:
    "Move one card to the point the app computed from two cards' positions. Nothing else changes: no card is added, removed, renamed or wired, and no reading, note or ask is touched. The point is never the model's.",
};

const ASK_MOVE_ROW: MoveDefinition = {
  move: { family: "ask", verb: "move" },
  game: "ground",
  files: [GROUND_ASK_FILE],
  params: [
    { key: "x", kind: "number" },
    { key: "y", kind: "number" },
  ],
  targetCount: 1,
  targets: only("ask", [
    { kind: "word", why: "a move is about one ask card on this map" },
    { kind: "loop", why: "a move is about one ask card on this map" },
    { kind: "spot", why: "a move is about one ask card on this map" },
    { kind: "link", why: "a move names BOTH cards; the moving one is the target" },
    { kind: "card", why: "an ask card is its own family; a reference card is not one" },
  ]),
  steps: deriveMoveAskSteps,
  closure: closureMoveAsk,
  boundary:
    "Move one ask card to the point the app computed from two cards' positions. Nothing else changes: its name, its question's draft and its conversation stay exactly as they are.",
};

const CARD_RENAME_ROW: MoveDefinition = {
  move: { family: "card", verb: "rename" },
  game: "ground",
  files: [GROUND_CARD_FILE],
  // THE KEY IS "to", NOT "name": the ghost grammar reserves a "name" slot for
  // the person's coining, and a generic patch may never fill one. This row is
  // the ONE proposal that carries words for a name, and the person's accept is
  // the coining — so it says "to", the same word the history's rename line uses.
  params: [{ key: "to", kind: "text" }],
  targetCount: 1,
  targets: only("card", [
    { kind: "word", why: "a name proposal is about one card on this map" },
    { kind: "loop", why: "a name proposal is about one card on this map" },
    { kind: "spot", why: "a name proposal is about one card on this map" },
    { kind: "link", why: "a name proposal is about one card, never a pair" },
  ]),
  steps: deriveRenameCardSteps,
  closure: closureRenameCard,
  boundary:
    "Propose a new name for one card. Accepting it is the person's coining; refusing it leaves the name as it was. Nothing else changes: the slug, point, reading, note and wires stay exactly as they are.",
};

const ASK_RENAME_ROW: MoveDefinition = {
  move: { family: "ask", verb: "rename" },
  game: "ground",
  files: [GROUND_ASK_FILE],
  params: [{ key: "to", kind: "text" }],
  targetCount: 1,
  targets: only("ask", [
    { kind: "word", why: "a name proposal is about one ask card on this map" },
    { kind: "loop", why: "a name proposal is about one ask card on this map" },
    { kind: "spot", why: "a name proposal is about one ask card on this map" },
    { kind: "link", why: "a name proposal is about one card, never a pair" },
    { kind: "card", why: "an ask card is its own family; a reference card is not one" },
  ]),
  steps: deriveRenameAskSteps,
  closure: closureRenameAsk,
  boundary:
    "Propose a new name for one ask card. Accepting it is the person's coining; refusing it leaves the name as it was. Nothing else changes: its slug, point, anchor and conversation stay exactly as they are.",
};


/* ------------------------------------------------------------------------ *
 * STORY 21.11 — THE SESSION CARD'S ROWS
 *
 * Each row is one ghost and one change, and each uses the family's OWN writer.
 * NO ROW STARTS A RUN: a run is an egress, so the create row names a row and a
 * name and there is no key here for a task, a prompt or a message.
 * ------------------------------------------------------------------------ */

const SESSION_ROW: MoveDefinition = {
  move: { family: "session", verb: "add" },
  game: "ground",
  files: [GROUND_SESSION_FILE],
  // THE NAME RIDES A PROPOSAL, exactly as a card's does: "label" is the words
  // the person accepts, and the accept is the coining (AGENTS.md's guardrail).
  // The ROW is the tool row's ID as the record stores it; the adapter resolved
  // the name the person or model used against the rows this build ships, and
  // refused an unknown one by name before this ghost existed.
  params: [
    { key: "label", kind: "text" },
    { key: "tool", kind: "text" },
  ],
  targetCount: 1,
  targets: only("spot", [
    { kind: "word", why: "a session card is placed at a point; the point is the target" },
    { kind: "card", why: "a session card is placed at a point; the point is the target" },
    { kind: "ask", why: "a session card is placed at a point; the point is the target" },
    { kind: "link", why: "a session card is placed at a point; the point is the target" },
  ]),
  steps: deriveAddSessionSteps,
  closure: closureAddSession,
  boundary:
    "Add one session card at one point, bound to a tool row this build ships. Nothing is started: no task leaves the machine, no permission is answered, and no other card, wire, note or transcript is touched.",
};

const SESSION_BIND_ROW: MoveDefinition = {
  move: { family: "session", verb: "bind" },
  game: "ground",
  files: [GROUND_SESSION_FILE],
  params: [{ key: "tool", kind: "text" }],
  targetCount: 1,
  targets: only("session", [
    { kind: "word", why: "a rebind is about one session card on this map" },
    { kind: "loop", why: "a rebind is about one session card on this map" },
    { kind: "spot", why: "a rebind is about one session card on this map" },
    { kind: "link", why: "a rebind names one card, never a pair" },
    { kind: "card", why: "a session card is its own family; a reference card is not one" },
    { kind: "ask", why: "a session card is its own family; an ask card is not one" },
  ]),
  steps: deriveBindSessionSteps,
  closure: closureBindSession,
  // ONE FIELD, THE ROW'S: the name, the point, the project, the boundary, the
  // model and the transcript are not this move's business, and the writer it
  // uses (bindSessionTool) cannot touch them.
  boundary:
    "Change which tool row one session card runs on. Nothing else changes: its name, its point, its project, its boundary, its model and its transcript stay exactly as they are.",
};

const SESSION_REMOVE_ROW: MoveDefinition = {
  move: { family: "session", verb: "remove" },
  game: "ground",
  files: [GROUND_SESSION_FILE],
  params: [],
  targetCount: 1,
  targets: only("session", [
    { kind: "word", why: "a session removal names one session card on this map" },
    { kind: "loop", why: "a session removal names one session card on this map" },
    { kind: "spot", why: "a session removal names one session card on this map" },
    { kind: "link", why: "a session removal names one session card on this map" },
    { kind: "card", why: "a session card is its own family; a reference card is not one" },
    { kind: "ask", why: "a session card is its own family; an ask card is not one" },
  ]),
  steps: deriveRemoveSessionSteps,
  closure: closureRemoveSession,
  // THE APP'S OWN DELETE SHAPE, STEP ONE: the record line goes first (the record
  // is the truth), and the transcript is its own ghost because a ghost is one
  // file, one change. No cascade is invented here.
  boundary:
    "Remove one session card's record line, the way the card's own removal does first. Nothing else changes here: the transcript is taken by its own step of the same shape.",
};

const SESSION_TRANSCRIPT_REMOVE_ROW: MoveDefinition = {
  move: { family: "session", verb: "remove-transcript" },
  game: "ground",
  files: [],
  filesFor: (target) =>
    target.kind === "session" ? [groundSessionTranscriptFile(target.slug)] : [],
  params: [],
  targetCount: 1,
  targets: only("session", [
    { kind: "word", why: "a transcript belongs to one session card on this map" },
    { kind: "loop", why: "a transcript belongs to one session card on this map" },
    { kind: "spot", why: "a transcript belongs to one session card on this map" },
    { kind: "link", why: "a transcript belongs to one session card on this map" },
    { kind: "card", why: "a reference card has a note and a reading, not a transcript" },
    { kind: "ask", why: "an ask card has a conversation, not a transcript" },
  ]),
  steps: deriveRemoveSessionTranscriptSteps,
  closure: closureRemoveSessionTranscript,
  // THE APP'S OWN DELETE SHAPE, STEP TWO: the transcript file goes, whole and
  // only after its line. The bytes a Restore needs were the app's to read before
  // the unlink; this step removes exactly the file that read named.
  boundary:
    "Remove one session card's transcript, the way the card's own removal does after its record line. Nothing else changes: no other card, wire, note or record is touched.",
};

/**
 * The command card's ground rows, in the vocabulary's order. Handed to the
 * ghost session's `moves` option by `attentioneerHost.ts`; NEVER appended to
 * the live `MOVES` table (the app's expansion gate is ADR-0025's). STORY 21.6
 * appends the three removal rows — each one ghost, each one change. STORY 21.8
 * appends the place and the name (one row per card family). STORY 21.11 appends
 * the session card's three changes and its transcript's own step.
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
  // STORY 21.8 — the place and the name, one rewrite each.
  CARD_MOVE_ROW,
  ASK_MOVE_ROW,
  CARD_RENAME_ROW,
  ASK_RENAME_ROW,
  // STORY 21.11 — the session card's three changes, and its transcript's own
  // step of the app's delete shape. None of them starts a run.
  SESSION_ROW,
  SESSION_BIND_ROW,
  SESSION_REMOVE_ROW,
  SESSION_TRANSCRIPT_REMOVE_ROW,
];
