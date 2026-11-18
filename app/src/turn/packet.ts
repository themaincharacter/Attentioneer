import { utf8ByteLength } from "../lib/textBytes";
import {
  ASK_THREAD_BOUND,
  askThreadLine,
  lastTurns,
  type AskThreadBound,
  type AskTurn,
} from "../map/asks";
import type { PointerForm } from "../map/pointers";
import type { TurnMessage } from "./protocol";

/**
 * THE ASK'S PACKET (Epic 15 story 3, ADR-0029's 2026-11-17 amendment) — the
 * bounded view the app assembles around ONE anchored card, PURE.
 *
 * WHY PREVIEWS RIDE NOW. Rule 3 of ADR-0029 ("the app never pre-reads a target
 * to compose a question") governed the COPY route, where the app could not
 * know what a target held and must not extract silently. The APP-SENT route
 * makes the app the asker, and an answer needs context. So the amendment lets
 * a BOUNDED preview of each included target ride — the existing head reader's
 * cap and the existing card crops, never a whole file — provided the person
 * sees the exact bytes before they leave and the declaration names every block
 * with its size. The clipboard route keeps rule 3 unchanged: this module never
 * builds the clipboard's packet (contacts/ask.ts's askPacket does).
 *
 * WHY ONE RETRIEVAL. A preview cannot answer every question, and a model that
 * cannot see more will guess. The amendment allows the model to ask for ONE
 * named target in full — the existing pull reader, the existing budget — and
 * exactly one follow-up. One, not many, because a loop of reads is the app
 * widening its own view without the person: a packet is a BOUNDED view, and
 * the retrieval is the single exception that keeps it honest rather than a
 * step toward "read everything". No chained retrieval, no target outside the
 * blocks that already rode.
 *
 * SIZES LIVE IN THE DECLARATION, NEVER IN THE TEXT. The bytes that leave carry
 * no counts, no token numbers and no size figures: the bound is said in words
 * ("This view; the map is larger.") in the existing voice (ADR-0026's limit
 * sentence, which the ghost packet uses too — the voice, not its machinery).
 * The sizes belong to the person's pre-send declaration, which is a fact this
 * module returns alongside the bytes, never inside them.
 *
 * THE CARD'S ASK USES THE SAME ASSEMBLER (story 3b). The ground card's ask…
 * sends the same packet with ONE anchored block — the card — and no reaches:
 * its links are wordless wiring and must not become context, so they are
 * never handed in here. One entry point is not poorer than the other, and the
 * two cannot drift because they share this module's block renderer, its
 * instruction and its bound.
 *
 * THE ASK CARD'S PACKET CARRIES THE THREAD (Epic 17 story 3). An ask card is a
 * conversation about one anchored reference, so its turn sends the card's
 * blocks AND the conversation so far, under a bound the person can see: the
 * most recent WHOLE turns that fit a turn count and a byte budget (map/asks.ts
 * chooses them). The thread is CONTEXT and the anchored card is the MATERIAL —
 * the instruction says so, and the READ set stays the anchor's name alone, so
 * a request for the thread's block is refused exactly like any other name the
 * view did not offer. The text says the bound in words ("earlier turns in this
 * conversation are not included"); the sizes live only in the declaration.
 *
 * PURE BY CONSTRUCTION: no reader, no writer, no clock and no randomness of
 * its own. The app reads the previews (turn/context.ts) and the pure assembler
 * below only arranges what it is handed — the thread included, which map/asks.ts
 * selects with a pure function — so bun can pin the exact bytes without a
 * window or a workspace.
 *
 * PROVISIONAL: the block order, the headings and their wording, the READ
 * syntax, the instruction paragraph, the preview lengths (the existing crops),
 * and the one-user-message shape the turn sends.
 */

/** The packet's first line (PROVISIONAL, and part of the bytes). */
export const ASK_PACKET_TITLE = "# a question about one card on an attention map";

/** The qualitative bound, in the existing voice (ADR-0026's limit sentence). */
export const ASK_PACKET_BOUND = "This view; the map is larger.";

/**
 * The fixed instruction (the plain packet's third block; the ask card's fourth,
 * where the thread sits between the card and this paragraph). It says what this
 * view is, that it is a view and not the map, the ONE form a retrieval may use,
 * and that a missing target is answered from what is here. No counts, no sizes:
 * the bound is the bound, said in words.
 */
const INSTRUCTION_OPEN = [
  "## what you may ask for",
  "",
  "This view is one view of a map that is larger than it; it is not the map. Every block above is headed by its own name, exactly as written after the two hashes.",
];

/** The READ form, shared by both instruction wordings (the syntax is one). */
const INSTRUCTION_READ = [
  "",
  "You may ask for one block in full: write, on a line of its own, exactly",
  "",
  "READ: <name>",
];

/** The plain tail: one block at most, and a name that is not here is not read. */
const INSTRUCTION_TAIL =
  "with the name written exactly as the block's heading. Ask for one block at most, and only when you need it. If what you need is not here, do not ask for it: answer from what this view gives you, and say plainly what you could not see.";

export const ASK_PACKET_INSTRUCTION = [
  ...INSTRUCTION_OPEN,
  ...INSTRUCTION_READ,
  "",
  INSTRUCTION_TAIL,
].join("\n");

/** The thread block's name: its heading text, and NEVER a READ name. */
export const ASK_PACKET_THREAD_NAME = "the conversation so far";

/** The thread block's heading (the name, as a block heading). */
export const ASK_PACKET_THREAD_HEADING = "## " + ASK_PACKET_THREAD_NAME;

/**
 * What the bound says when it bit (PROVISIONAL, and qualitative on purpose):
 * the person's declaration shows the bytes; the model is told only that the
 * conversation has an earlier part it cannot see. No count, no size, no token
 * number ever rides here.
 */
export const ASK_PACKET_THREAD_OMITTED =
  "earlier turns in this conversation are not included.";

/**
 * THE ASK CARD'S INSTRUCTION (story 17.3): the same paragraph, extended to say
 * that the conversation so far is CONTEXT and the anchored card is the
 * MATERIAL, and that the ONE read is the anchored block's — never the thread's.
 * The extension only appears when the thread block actually rode: a first
 * question has no conversation to point at, and the packet never claims a block
 * it does not carry.
 */
export function askCardInstruction(threadRides: boolean): string {
  const lines = [...INSTRUCTION_OPEN];
  if (threadRides) {
    lines.push("");
    lines.push(
      "One of those blocks is " +
        ASK_PACKET_THREAD_NAME +
        ": what has already been said in this conversation, and context, not material. The anchored card is the material.",
    );
  }
  lines.push(...INSTRUCTION_READ);
  lines.push("");
  lines.push(
    "with the name written exactly as the block's heading. The anchored card is the only block you may ask for, and you may ask for it at most once. If what you need is not here, do not ask for it: answer from what this view gives you, and say plainly what you could not see.",
  );
  return lines.join("\n");
}

/** The heading of the question block (the person's own words, verbatim). */
export const ASK_PACKET_QUESTION_HEADING = "## the question";

/** One card's bounded preview, as the app read it (never the whole file). */
export interface AskPacketCard {
  /** The person's coined name for the card (the block's heading and name). */
  name: string;
  /** The state sentence, or null when the reading is current (says nothing). */
  state: string | null;
  /** The reading's bounded preview (the existing crop), or null. */
  reading: string | null;
  /** The note's bounded preview (the person's words), or null. */
  note: string | null;
}

/** One included reach: its citation and its target's bounded preview. */
export interface AskPacketReach {
  /** The pointer's authored form (path/at/url). */
  form: PointerForm;
  /** The pointer's authored value, verbatim. */
  value: string;
  /** The target's bounded head preview, or null (a url is named, not read). */
  preview: string | null;
}

/**
 * What the CARD's pure assembler is handed (Epic 15 story 3b). The card's ask
 * is the same packet with ONE anchored block: the card. No reaches ride (the
 * card's links are wordless wiring, never context), and the fixed instruction
 * offers the ONE read of that card's own block.
 */
export interface CardPacketInput {
  /** The person's authored question, verbatim. */
  question: string;
  /** The anchored card's name, state and bounded previews. */
  card: AskPacketCard;
  /** The block names whose fuller text the app can fetch (the card, or none). */
  retrievable?: readonly string[];
}

/** What the pure assembler is handed. It reads nothing; every byte is here. */
export interface AskPacketInput {
  /** The person's authored question, verbatim. */
  question: string;
  /** The anchored card's name, state and bounded previews. */
  card: AskPacketCard;
  /** The reaches the person INCLUDED, in their order (never the others). */
  reaches: readonly AskPacketReach[];
  /**
   * The block names whose fuller text the app can fetch for ONE follow-up. The
   * app knows (it holds the reading that locates each block); the assembler
   * only honours names it actually rendered, so a caller cannot name a block
   * that did not ride.
   */
  retrievable?: readonly string[];
}

/** The block kinds, in the packet's fixed order. */
export type AskPacketBlockKind =
  | "question"
  | "card"
  | "thread"
  | "reach"
  | "instruction"
  | "bound";

/** One rendered block: its kind, its name and its exact bytes. */
export interface AskPacketBlock {
  kind: AskPacketBlockKind;
  /** The block's name: the heading's text, and what a READ line may name. */
  name: string;
  /** The block's exact bytes (LF inside; no trailing newline). */
  text: string;
}

/** One line of the pre-send declaration: a block and its exact byte size. */
export interface AskPacketDeclarationLine {
  kind: AskPacketBlockKind;
  name: string;
  size: number;
}

/**
 * THE DECLARATION (the person's pre-send fact): every block with its size and
 * the whole packet's total. It is derived from the SAME block bytes the send
 * carries, so the line cannot drift from the packet.
 */
export interface AskPacketDeclaration {
  blocks: readonly AskPacketDeclarationLine[];
  total: number;
}

/** One assembled packet: the blocks, the exact bytes, the messages, the sizes. */
export interface AskPacket {
  blocks: readonly AskPacketBlock[];
  /** The exact bytes of the turn's ONE message (what leaves). */
  text: string;
  /** The messages the turn sends, verbatim (one user message, provisional). */
  messages: readonly TurnMessage[];
  /** Every block and its size, plus the total — the pre-send declaration. */
  declaration: AskPacketDeclaration;
  /** The block names a single READ line may name. */
  retrievable: readonly string[];
}

/**
 * WHAT ONE SENT PACKET LEFT (story 17.3): every message in the order it left,
 * and the one block a follow-up fetched (or null). A surface opens these bytes
 * verbatim, so the readback can never be a second summary of the send.
 */
export interface AskPacketReadback {
  messages: readonly TurnMessage[];
  /** The block the one follow-up fetched, or null when none happened. */
  read: string | null;
}

/** The name a reach's block carries: its citation, exactly as the person sees it. */
export function askReachName(form: PointerForm, value: string): string {
  return form + " " + value;
}

/**
 * The card's block bytes: its name, its state sentence (nothing when the
 * reading is current), the reading preview and the note preview. A card with
 * neither preview says so in one sentence rather than looking empty.
 */
function cardText(card: AskPacketCard): string {
  const lines: string[] = ["## " + card.name, ""];
  if (card.state !== null) {
    lines.push("state: " + card.state);
    lines.push("");
  }
  if (card.reading !== null) {
    lines.push("reading, first lines:");
    lines.push(card.reading);
    lines.push("");
  }
  if (card.note !== null) {
    lines.push("note, the person's own words, first lines:");
    lines.push(card.note);
    lines.push("");
  }
  if (card.reading === null && card.note === null) {
    lines.push(
      "no reading and no note ride with this card — its name and its state are all it says here.",
    );
  }
  return lines.join("\n").replace(/\n+$/, "");
}

/** One reach's block bytes: its citation heading and its bounded preview. */
function reachText(reach: AskPacketReach): string {
  const lines: string[] = [
    "## " + askReachName(reach.form, reach.value),
    "",
  ];
  if (reach.preview !== null) {
    lines.push("reading, first lines:");
    lines.push(reach.preview);
  } else {
    lines.push("a citation only — no preview rides with this reach.");
  }
  return lines.join("\n");
}

/**
 * THE THREAD'S BLOCK (story 17.3): the conversation so far, as WHOLE turns in
 * the order they were said, under the stated bound. The bound's own numbers
 * never appear — when it bit, the block says so in one qualitative sentence, so
 * the model knows an earlier part exists without being handed a count.
 */
function threadText(thread: readonly AskTurn[], bound: AskThreadBound): string {
  const selected = lastTurns(thread, bound.turns, bound.bytes);
  const lines: string[] = [ASK_PACKET_THREAD_HEADING, ""];
  for (const turn of selected.turns) lines.push(askThreadLine(turn));
  if (selected.omitted) {
    if (selected.turns.length > 0) lines.push("");
    lines.push(ASK_PACKET_THREAD_OMITTED);
  }
  return lines.join("\n");
}

/** The bound block: the qualitative posture, in words (never a number). */
function boundText(): string {
  return ["## the bound", "", ASK_PACKET_BOUND].join("\n");
}

/**
 * The blocks in the packet's fixed order. The anchored card first, then the
 * included reaches in the person's order, then the instruction, then the
 * bound. A reach the person did not include is never handed in, so it can
 * never ride and is never named.
 */
function blocksOf(input: AskPacketInput): AskPacketBlock[] {
  const blocks: AskPacketBlock[] = [
    {
      kind: "question",
      name: "the question",
      text: ASK_PACKET_QUESTION_HEADING + "\n\n" + input.question,
    },
    {
      kind: "card",
      name: input.card.name,
      text: cardText(input.card),
    },
  ];
  for (const reach of input.reaches) {
    blocks.push({
      kind: "reach",
      name: askReachName(reach.form, reach.value),
      text: reachText(reach),
    });
  }
  blocks.push({
    kind: "instruction",
    name: "the instruction",
    text: ASK_PACKET_INSTRUCTION,
  });
  blocks.push({ kind: "bound", name: "the bound", text: boundText() });
  return blocks;
}

/**
 * ASSEMBLE the packet: the anchored card, the included reaches, the fixed
 * instruction and the bound, then the exact bytes, the ONE message, the
 * declaration and the READ set. Pure and total over its inputs: same input,
 * same bytes, no reader and no writer anywhere in this file.
 */
export function assembleAskPacket(input: AskPacketInput): AskPacket {
  return assemblePacket(input.question, input.card, input.reaches, input.retrievable);
}

/**
 * ASSEMBLE the CARD's packet (Epic 15 story 3b): the SAME assembler, the SAME
 * card block renderer, the SAME instruction and bound — but ONE anchored block
 * and no reaches. The card's links never ride and are never read: a link is
 * wordless wiring, and giving it meaning here would spend a meaning the epic
 * defers. ONE retrieval: the card's own block, on its exact heading name.
 */
export function assembleCardPacket(input: CardPacketInput): AskPacket {
  return assemblePacket(input.question, input.card, [], input.retrievable);
}

/** The one assembler the two Epic 15 entry points use, so their bytes cannot drift. */
function assemblePacket(
  question: string,
  card: AskPacketCard,
  reaches: readonly AskPacketReach[],
  asked: readonly string[] | undefined,
): AskPacket {
  const blocks = blocksOf({ question, card, reaches, retrievable: asked });
  // The READ set: only a block that actually rode, and only where the app can
  // read a target at all. A url is named in the packet but never fetched, so it
  // is never a retrieval either.
  const readable = new Set<string>([card.name]);
  for (const reach of reaches) {
    if (reach.form !== "url") readable.add(askReachName(reach.form, reach.value));
  }
  return packetOf(blocks, asked, readable);
}

/**
 * THE FINALIZER every assembler ends with: the exact bytes, the ONE message,
 * the declaration (each block's own bytes, then the total) and the READ set.
 * One place, so no entry point can declare a block it does not send.
 */
function packetOf(
  blocks: readonly AskPacketBlock[],
  asked: readonly string[] | undefined,
  readable: ReadonlySet<string>,
): AskPacket {
  const text = [ASK_PACKET_TITLE, ...blocks.map((block) => block.text)].join(
    "\n\n",
  );
  const declaration: AskPacketDeclaration = {
    blocks: blocks.map((block) => ({
      kind: block.kind,
      name: block.name,
      size: utf8ByteLength(block.text),
    })),
    total: utf8ByteLength(text),
  };
  const retrievable = [...new Set(asked ?? [])].filter((name) =>
    readable.has(name),
  );
  return {
    blocks,
    text,
    messages: [{ role: "user", content: text }],
    declaration,
    retrievable,
  };
}

/**
 * ASSEMBLE the ASK CARD's packet (Epic 17 story 3): the person's question, the
 * anchored card — exactly the blocks a card ask sends today — then THE THREAD
 * SO FAR, the same instruction extended to name the conversation as context,
 * and the bound. The thread is chosen by `lastTurns` under `bound`: the most
 * recent WHOLE turns that fit a turn count and a byte budget, in conversation
 * order; when the bound bit, the block says so in one qualitative sentence.
 *
 * ONE RETRIEVAL, AND ONLY OF THE ANCHORED BLOCK. The readable set is the
 * anchor's name alone: the thread's block is a block the model can SEE, never
 * one it can ask for in full, so a "READ: the conversation so far" is refused
 * by the same rule that refuses any other name the packet did not offer. The
 * thread is context; the anchored card is the material.
 */
export function assembleAskCardPacket(
  anchorCtx: AskPacketCard,
  thread: readonly AskTurn[],
  question: string,
  bound: AskThreadBound = ASK_THREAD_BOUND,
  asked?: readonly string[],
): AskPacket {
  const blocks: AskPacketBlock[] = [
    {
      kind: "question",
      name: "the question",
      text: ASK_PACKET_QUESTION_HEADING + "\n\n" + question,
    },
    {
      kind: "card",
      name: anchorCtx.name,
      text: cardText(anchorCtx),
    },
  ];
  // A conversation that has said nothing yet has no thread block to declare:
  // the first question carries the card and the bound, and says nothing about
  // turns that do not exist.
  if (thread.length > 0) {
    blocks.push({
      kind: "thread",
      name: ASK_PACKET_THREAD_NAME,
      text: threadText(thread, bound),
    });
  }
  blocks.push({
    kind: "instruction",
    name: "the instruction",
    text: askCardInstruction(thread.length > 0),
  });
  blocks.push({ kind: "bound", name: "the bound", text: boundText() });
  return packetOf(blocks, asked, new Set<string>([anchorCtx.name]));
}

/**
 * The follow-up message ONE retrieval sends: the block in full, then the fixed
 * sentence that says no further read is coming. The first message stays first
 * (the person's bytes are never re-sent edited); this one is appended.
 */
export function followUpMessages(
  messages: readonly TurnMessage[],
  name: string,
  text: string,
): TurnMessage[] {
  return [...messages, { role: "user", content: followUpText(name, text) }];
}

/** The follow-up's bytes: a heading, the block, and the one-read sentence. */
export function followUpText(name: string, text: string): string {
  return [
    "## the block you asked for: " + name,
    "",
    text,
    "",
    "## now",
    "",
    "Answer the question with what you have. This is the one read; no further read is coming.",
  ].join("\n");
}
