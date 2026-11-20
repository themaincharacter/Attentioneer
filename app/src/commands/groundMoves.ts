import type { GhostStep, GhostTarget } from "../ghost/envelope";
import { issue, type GhostIssue } from "../ghost/issues";
import {
  appendLine,
  type MoveDefinition,
} from "../ghost/registry";
import {
  GROUND_SELF_LINK_REFUSAL,
  parseGroundLinks,
  serializeGroundLinkLine,
  type GroundLink,
} from "../map/groundLinks";
import {
  parseGround,
  serializeGroundLine,
  addGroundReference,
} from "../map/ground";
import { parseAsks, serializeAskLine, addAsk } from "../map/asks";
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
 * ask is one peer card with no question recorded (an unsent question is not a
 * record; the person types it before sending).
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
  after: string,
): readonly GhostIssue[] {
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
  after: string,
): readonly GhostIssue[] {
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
  after: string,
): readonly GhostIssue[] {
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
  after: string,
): readonly GhostIssue[] {
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

/** The target rules every ground move shares: one kind, the rest refused. */
function only(
  allowed: "spot" | "link" | "card",
  refusals: ReadonlyArray<{ kind: "word" | "loop" | "spot" | "link" | "card"; why: string }>,
): MoveDefinition["targets"] {
  const rows: Array<MoveDefinition["targets"][number]> = [];
  for (const kind of ["word", "loop", "spot", "link", "card"] as const) {
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
  params: [{ key: "label", kind: "text" }],
  targetCount: 1,
  targets: only("spot", [
    { kind: "word", why: "an ask card is placed at a point; the point is the target" },
    { kind: "card", why: "an ask card is placed at a point; the point is the target" },
    { kind: "link", why: "an ask card is placed at a point; the point is the target" },
  ]),
  steps: deriveAddAskSteps,
  closure: closureAddAsk,
  boundary:
    "Add one ask card at one point, with the words it would carry. Nothing is sent and no question is recorded: sending is the person's, and an unsent question is not a record.",
};

/**
 * The command card's ground rows, in the vocabulary's order. Handed to the
 * ghost session's `moves` option by `attentioneerHost.ts`; NEVER appended to
 * the live `MOVES` table (the app's expansion gate is ADR-0025's).
 */
export const GROUND_MOVES: readonly MoveDefinition[] = [
  CARD_ROW,
  WIRE_ROW,
  NOTE_ROW,
  ASK_ROW,
];
