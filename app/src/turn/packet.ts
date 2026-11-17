import { utf8ByteLength } from "../lib/textBytes";
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
 * PURE BY CONSTRUCTION: no fs import, no reader, no writer, no clock and no
 * randomness. The app reads the previews (turn/context.ts) and the pure
 * assembler below only arranges what it is handed, so bun can pin the exact
 * bytes without a window or a workspace.
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
 * The fixed instruction (block three). It says what this view is, that it is a
 * view and not the map, the ONE form a retrieval may use, and that a missing
 * target is answered from what is here. No counts, no sizes: the bound is the
 * bound, said in words.
 */
export const ASK_PACKET_INSTRUCTION = [
  "## what you may ask for",
  "",
  "This view is one view of a map that is larger than it; it is not the map. Every block above is headed by its own name, exactly as written after the two hashes.",
  "",
  "You may ask for one block in full: write, on a line of its own, exactly",
  "",
  "READ: <name>",
  "",
  "with the name written exactly as the block's heading. Ask for one block at most, and only when you need it. If what you need is not here, do not ask for it: answer from what this view gives you, and say plainly what you could not see.",
].join("\n");

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
  const blocks = blocksOf(input);
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
  // The READ set: only a block that actually rode, and only where the app can
  // read a target at all. A url is named in the packet but never fetched, so it
  // is never a retrieval either.
  const readable = new Set<string>([input.card.name]);
  for (const reach of input.reaches) {
    if (reach.form !== "url") readable.add(askReachName(reach.form, reach.value));
  }
  const retrievable = [...new Set(input.retrievable ?? [])].filter(
    (name) => readable.has(name),
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
