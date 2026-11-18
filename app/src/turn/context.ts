import { resolveWithin, type Canonicalize } from "../contacts/boundary";
import { canonicalizePath, readTextHead, type TextHead } from "../lib/fs";
import { extractKindFor } from "../map/extract";
import { NOTE_PREVIEW_LINES } from "../map/notes";
import {
  READING_MAX_BYTES,
  READING_MAX_LINES,
  READING_PREVIEW_LINES,
  previewText,
  readingExtract,
  readingStateWord,
  type Reading,
  type ReadingState,
} from "../map/readings";
import {
  PULL_BUDGET_BYTES,
  PULL_IO,
  pullReading,
  type PullIo,
  type PullResult,
} from "../map/pull";
import type { PointerForm } from "../map/pointers";
import {
  askReachName,
  type AskPacketCard,
  type AskPacketReach,
} from "./packet";

/**
 * READING THE PACKET'S PREVIEWS (Epic 15 story 3) — the ONE new IO in the
 * story, and the only place a target is read to compose the app-sent packet.
 *
 * WHY THIS EXISTS AT ALL: ADR-0029's amendment lets a BOUNDED preview of each
 * INCLUDED target ride, because the app-sent route makes the app the asker.
 * This module is that bounded read and nothing else. It reads only the reaches
 * the person included — a reach they did not include is never handed in and
 * never opened — and it uses the EXISTING caps: the head reader's 64 lines /
 * 8 KiB for a reach, the card's own stored crop (6 lines) for its reading, the
 * note's crop (2 lines) for the person's words. A reach is previewed with
 * previewText over the head, so the bytes that ride are a crop of a crop, not
 * a second reading discipline.
 *
 * IT WRITES NOTHING. There is no writer in this module's bridge surface — no
 * writeTextFile, no createDirAll, no queue — so "the previews never land on
 * disk" is a property of the code, not of discipline. The card's reading text
 * and note are already in the app's loaded state; only the included reaches'
 * heads are read here.
 *
 * THE BOUNDARY APPLIES. A pointer's path form is resolved against the
 * workspace root by the SAME pure resolver every contact uses (realpath after
 * join, escapes refused); an at-form is the authored machine-local exception
 * (read as it stands, exactly like a reading), and a url is not a filesystem
 * target at all: it rides as a citation only, never fetched. A refused or
 * missing file is simply no preview — the reach still rides as its citation,
 * and the packet says so in one sentence rather than pretending.
 *
 * THE RETRIEVAL has ONE source per block, recorded at the same moment the
 * preview is read: the card's own reading, or an at-form reading built from
 * the reach's resolved path (so the one follow-up reads exactly the file the
 * preview came from, never a second resolution that could differ). The fuller
 * text is the PULL reader under its 96 KiB budget (story 16.8's reader, reused
 * — no new budget is invented here).
 *
 * PROVISIONAL: the preview lengths (the existing crops), the null-for-empty
 * rule, and the at-form reading built for a reach (a carrier for the pull, not
 * a record).
 */

/** The anchored card, as the app already holds it (no IO for these). */
export interface AskCardFacts {
  /** The person's coined name for the card. */
  name: string;
  /** The reading state computed at load, or null when there is no card line. */
  state: ReadingState | null;
  /** The card's reading LINE (where its fuller text can be found), or null. */
  reading: Reading | null;
  /** The stored reading text (already read by the ground layer), or null. */
  readingText: string | null;
  /** The person's note (already read by the ground layer), or null. */
  note: string | null;
  /**
   * STORY 17.9 — the slug the card carries, when the app knows it. It is used
   * only to name the card's reading in the PRISM's inclusion set and to match
   * the wire's source; the packet never renders it.
   */
  on?: string;
  /** STORY 17.9 — an ASK card's most recent completed answer, whole, or null. */
  answer?: string | null;
  /** STORY 17.9 — a SESSION card's most recent completed run's text, or null. */
  result?: string | null;
  /**
   * STORY 17.9 — the one line a wired card with no material says. Present
   * exactly when the card is an ask or session card with nothing to lend; a
   * reference with no reading and no note keeps the packet's generic sentence.
   */
  empty?: string | null;
  /**
   * STORY 16.19 — THE WORDS A SELECTION CHOSE, when this fact is the selection's
   * own context block rather than a wired card: one line, verbatim, already
   * collapsed by the record. It has no slug, no reading and no note, so it can
   * never name a card in the PRISM's inclusion set.
   */
  chosen?: string | null;
}

/** One reach the person included, as the pointer cites it. */
export interface AskIncludedReach {
  form: PointerForm;
  value: string;
}

/** What the context reader is handed. */
export interface AskContextInput {
  workspacePath: string;
  card: AskCardFacts;
  /** The INCLUDED reaches, in the person's order. Nothing else is read. */
  included: readonly AskIncludedReach[];
}

/** One block's fuller text, and where it lives (the one READ's source). */
export interface AskRetrievalSource {
  /** The block's name, exactly as the packet rendered its heading. */
  name: string;
  /** The reading that locates the fuller text (an at-form carrier for a reach). */
  reading: Reading;
}

/** The previews the packet rides, and what one follow-up may fetch. */
export interface AskContext {
  /** The anchored card's block facts (name, state, reading and note previews). */
  card: AskPacketCard;
  /** The included reaches, each with its bounded preview (or none). */
  reaches: AskPacketReach[];
  /** The block names a single READ line may name. */
  retrievable: string[];
  /** Where each retrievable block's fuller text lives (never logged). */
  sources: AskRetrievalSource[];
}

/** The bridges this reader needs; the app passes lib/fs, a test passes a fake. */
export interface AskContextDeps {
  readTextHead(
    path: string,
    maxLines: number,
    maxBytes: number,
  ): Promise<TextHead>;
  canonicalize: Canonicalize;
  /** The existing pull reader, injected so a test's bytes are deterministic. */
  pull: (
    workspacePath: string,
    reading: Reading,
    budget: number,
    io: PullIo,
  ) => Promise<PullResult>;
  pullIo: PullIo;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const ASK_CONTEXT_DEPS: AskContextDeps = {
  readTextHead,
  canonicalize: canonicalizePath,
  pull: pullReading,
  pullIo: PULL_IO,
};

/** The card's packet facts from the app's loaded state (pure). */
export function askCardOf(card: AskCardFacts): AskPacketCard {
  const state = card.state === null ? null : readingStateWord(card.state);
  const reading = cropped(card.readingText, READING_PREVIEW_LINES);
  const note = cropped(card.note, NOTE_PREVIEW_LINES);
  const built: AskPacketCard = { name: card.name, state, reading, note };
  // STORY 17.9 — WHAT THE WIRED CARD HAS: a slug (never rendered), an ask
  // card's completed answer, a session card's completed run, or the one line
  // saying it has nothing to lend. Absent fields stay absent, so a reference's
  // block is byte-identical to before the story.
  if (card.on !== undefined) built.on = card.on;
  if (card.answer !== undefined && card.answer !== null) {
    built.answer = card.answer;
  }
  if (card.result !== undefined && card.result !== null) {
    built.result = card.result;
  }
  if (card.empty !== undefined && card.empty !== null) {
    built.empty = card.empty;
  }
  // STORY 16.19 — the selection's words ride as their own block, whole: they are
  // one line by construction, so there is nothing to crop.
  if (card.chosen !== undefined && card.chosen !== null) {
    built.chosen = card.chosen;
  }
  // STORY 16.26 — A PAGE CARD CARRIES ITS ADDRESS so the ask can OPEN it at
  // send time. The address is never rendered and never sent: what rides is the
  // read, not a link. A video is not a page (it has a look, not words), so it
  // carries no address here and the ask opens nothing for it.
  if (
    card.reading !== null &&
    card.reading.form === "url" &&
    readingExtract(card.reading) === "page"
  ) {
    built.pageUrl = card.reading.from;
  }
  return built;
}

/** A crop of a text, or null when there is nothing to ride (never an empty one). */
function cropped(text: string | null, maxLines: number): string | null {
  if (text === null) return null;
  const crop = previewText(text, maxLines);
  return crop === "" ? null : crop;
}

/**
 * The ABSOLUTE path a reach's preview reads, or null when the reach has none:
 * a path form goes through the boundary resolver (escapes refuse), an at form
 * is the authored machine-local exception, and a url is never fetched.
 */
async function reachPath(
  workspacePath: string,
  pointer: AskIncludedReach,
  deps: AskContextDeps,
): Promise<string | null> {
  if (pointer.form === "url") return null;
  if (pointer.form === "at") return pointer.value;
  try {
    const resolved = await resolveWithin(
      workspacePath,
      pointer.value,
      deps.canonicalize,
    );
    return resolved.outcome === "resolved" ? resolved.path : null;
  } catch {
    return null;
  }
}

/** One reach's bounded preview: the head reader's cap, then the card's crop. */
async function reachPreview(
  path: string | null,
  deps: AskContextDeps,
): Promise<string | null> {
  if (path === null) return null;
  try {
    const head = await deps.readTextHead(
      path,
      READING_MAX_LINES,
      READING_MAX_BYTES,
    );
    if (!head.exists) return null;
    return cropped(head.head, READING_PREVIEW_LINES);
  } catch {
    return null;
  }
}

/** The card's fuller text, when the card has a reading to locate it. */
function cardSource(card: AskCardFacts): AskRetrievalSource | null {
  if (card.reading === null) return null;
  return { name: card.name, reading: card.reading };
}

/**
 * A reach's fuller text, as an at-form reading over the path the preview
 * already resolved: the follow-up reads the SAME file, and the reading is a
 * carrier for the pull, never a record that gets written.
 */
function reachSource(
  pointer: AskIncludedReach,
  path: string | null,
): AskRetrievalSource | null {
  if (path === null) return null;
  return {
    name: askReachName(pointer.form, pointer.value),
    reading: {
      on: "",
      form: "at",
      from: path,
      taken: "",
      extract: extractKindFor(pointer.value),
    },
  };
}

/**
 * THE CARD'S OWN CONTEXT (Epic 15 story 3b): the anchored card's block and the
 * one source a single READ may fetch, both from the app's ALREADY-LOADED state.
 * No IO, no reach and no link: the card's links are wordless wiring, not
 * context, so this function is handed none and reads none.
 */
export function cardAskContext(card: AskCardFacts): AskContext {
  const source = cardSource(card);
  return {
    card: askCardOf(card),
    reaches: [],
    retrievable: source === null ? [] : [source.name],
    sources: source === null ? [] : [source],
  };
}

/**
 * THE ASK CARD'S CONTEXT (Epic 17 story 9; the user's correction): the cards
 * WIRED INTO the ask card, each as its own packet block. No IO, no reach: every
 * fact is already in the app's loaded state, and the wires are the only
 * selection rule. The packet's own bound is applied by `assembleAskCardPacket`,
 * so this function only says what the wired cards HAVE.
 *
 * THE ONE READ IS ANY INCLUDED CARD: every wired card's name is offered (a card
 * with no fuller text simply fetches nothing), and the sources locate the
 * fuller text for the cards that have a reading. A card that is not wired never
 * appears here, so it can never be read.
 */
export function askCardsContext(cards: readonly AskCardFacts[]): {
  cards: AskPacketCard[];
  context: AskContext;
} {
  const packetCards = cards.map(askCardOf);
  const sources: AskRetrievalSource[] = [];
  cards.forEach((card, index) => {
    if (card.reading === null) return;
    sources.push({ name: packetCards[index]!.name, reading: card.reading });
  });
  return {
    cards: packetCards,
    context: {
      // The panel's single-card field is not what an ask card's turn uses; it
      // is filled with the first card so the shared type stays honest, and no
      // caller of the ask-card route reads it.
      card:
        packetCards[0] ??
        { name: "", state: null, reading: null, note: null },
      reaches: [],
      retrievable: [...new Set(packetCards.map((card) => card.name))],
      sources,
    },
  };
}

/**
 * READ the packet's previews: the card's crops from the app's state, and one
 * bounded head per INCLUDED reach (the boundary applies; a refusal is simply
 * no preview). Total over its inputs and never throwing: a target that cannot
 * be read is a citation without a preview, which is what the packet says. It
 * writes nothing.
 */
export async function readAskContext(
  input: AskContextInput,
  deps: AskContextDeps = ASK_CONTEXT_DEPS,
): Promise<AskContext> {
  const card = cardAskContext(input.card);
  const sources: AskRetrievalSource[] = [...card.sources];

  const reaches: AskPacketReach[] = [];
  for (const pointer of input.included) {
    const path = await reachPath(input.workspacePath, pointer, deps);
    const preview = await reachPreview(path, deps);
    reaches.push({ form: pointer.form, value: pointer.value, preview });
    const reach = reachSource(pointer, path);
    if (reach !== null) sources.push(reach);
  }
  return {
    card: card.card,
    reaches,
    retrievable: sources.map((entry) => entry.name),
    sources,
  };
}

/**
 * FETCH one block's fuller text for the ONE follow-up: the pull reader under
 * its stated budget, from the source recorded when the preview was read. A
 * name this view did not carry, a refused read or an empty text answers null —
 * the app then answers as if the model had to proceed without it, and the
 * first answer stands. Never a second name, never a second read.
 */
export async function fetchAskBlock(
  workspacePath: string,
  name: string,
  context: AskContext | null,
  deps: AskContextDeps = ASK_CONTEXT_DEPS,
): Promise<string | null> {
  if (context === null) return null;
  const source = context.sources.find((entry) => entry.name === name);
  if (source === undefined) return null;
  try {
    const pulled = await deps.pull(
      workspacePath,
      source.reading,
      PULL_BUDGET_BYTES,
      deps.pullIo,
    );
    return pulled.kind === "text" && pulled.text !== "" ? pulled.text : null;
  } catch {
    return null;
  }
}
