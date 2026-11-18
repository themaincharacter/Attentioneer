import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskCard } from "../src/canvas/AskCard";
import { packetDeclarationWords } from "../src/canvas/contactRules";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  ASK_THREAD_BOUND,
  askThreadLine,
  lastTurns,
  type AskCard as AskCardRecord,
  type AskTurn,
} from "../src/map/asks";
import { askPacket } from "../src/contacts/ask";
import {
  ASK_PACKET_BOUND,
  ASK_PACKET_THREAD_HEADING,
  ASK_PACKET_THREAD_NAME,
  ASK_PACKET_THREAD_OMITTED,
  assembleAskCardPacket,
  type AskPacketCard,
} from "../src/turn/packet";
import { askTurnPacket, type TurnPort } from "../src/turn/turn";
import { parseRequestLine, type SidecarLine } from "../src/turn/protocol";
import { utf8ByteLength } from "../src/lib/textBytes";

/**
 * STORY 17.3 — the packet carries the card and the thread.
 *
 * The human check is "open an ask card with a long thread and send another
 * question; before sending, the declaration names the thread's block and its
 * size, and the exact bytes can be opened; the answer shows it used the thread
 * without having been handed the map." This file pins the rules underneath it:
 *
 *   - `lastTurns` selects the most recent WHOLE turns under BOTH bounds (a
 *     turn count and a byte budget), in conversation order, never cutting one;
 *   - the packet is the card's blocks PLUS the thread, then the extended
 *     instruction and the bound — with golden bytes for a short thread and a
 *     long one;
 *   - when the bound bites the thread block says so in ONE qualitative
 *     sentence, and the text carries no counts, sizes or token numbers;
 *   - the declaration's sizes are the bytes actually sent, block by block;
 *   - a READ naming the THREAD is refused: the retrieval is the anchored
 *     block's alone, one follow-up at most;
 *   - the clipboard route is unchanged, and `renderedMapContent("ground")`
 *     stays [].
 *
 * PROVISIONAL: the bound's numbers, the thread heading and the qualitative
 * sentence (the story marks them so).
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const CARD: AskPacketCard = {
  name: "rain",
  state: "the file is gone; this is the copy kept when it was added",
  reading: "first line\nsecond line",
  note: "my note",
};

const QUESTION = "what does this card say about rain?";

const TAKEN = "2026-11-18T02:00:00.000Z";

function person(text: string): AskTurn {
  return { role: "person", text, t: TAKEN };
}

function answer(text: string): AskTurn {
  return { role: "answer", text, t: TAKEN };
}

/** A two-turn conversation with no digits in it, so "no counts" is provable. */
const SHORT_THREAD: AskTurn[] = [
  person("is the gauge calibrated?"),
  answer("the note says it was, in March."),
];

/* ------------------------------------------------------------------ *
 * THE THREAD UNDER ITS BOUND
 * ------------------------------------------------------------------ */

describe("the thread is the newest WHOLE turns under both bounds", () => {
  test("the count bound takes the newest turns, in conversation order", () => {
    const turns = ["one", "two", "three", "four", "five"].map((text) =>
      person(text),
    );
    const selected = lastTurns(turns, 3, Number.MAX_SAFE_INTEGER);
    expect(selected.turns.map((turn) => turn.text)).toEqual([
      "three",
      "four",
      "five",
    ]);
    expect(selected.omitted).toBe(true);
  });

  test("the byte budget takes fewer turns and NEVER cuts one", () => {
    const turns = [person("one"), person("two"), person("three")];
    // "person: three" is thirteen bytes, so only the newest fits in twenty.
    const selected = lastTurns(turns, 8, 20);
    expect(selected.turns).toEqual([turns[2]!]);
    // The words are the turn's OWN bytes: no ellipsis, no mid-sentence cut.
    expect(selected.turns[0]!.text).toBe("three");
    expect(askThreadLine(selected.turns[0]!)).toBe("person: three");
    expect(selected.omitted).toBe(true);
  });

  test("a turn bigger than the whole budget is left out, not truncated", () => {
    const turns = [person("kept"), person("x".repeat(300))];
    const selected = lastTurns(turns, 8, 100);
    expect(selected.turns).toEqual([]);
    expect(selected.omitted).toBe(true);
  });

  test("the newest turns that fit are a contiguous tail, never a gap", () => {
    const turns = [person("a"), person("b"), person("c"), person("d")];
    // Room for "person: c"/"person: d": thirteen bytes plus one newline.
    const selected = lastTurns(turns, 8, 8 + 1 + 1 + 8 + 1 + 1);
    expect(selected.turns.map((turn) => turn.text)).toEqual(["c", "d"]);
    expect(selected.omitted).toBe(true);
  });

  test("when neither bound bites, every turn rides and nothing is omitted", () => {
    const selected = lastTurns(SHORT_THREAD, 8, 4096);
    expect(selected.turns).toEqual(SHORT_THREAD);
    expect(selected.omitted).toBe(false);
  });

  test("the count bound is a count of turns, and zero carries none", () => {
    expect(lastTurns(SHORT_THREAD, 0, 4096)).toEqual({
      turns: [],
      omitted: true,
    });
    expect(lastTurns([], 8, 4096)).toEqual({ turns: [], omitted: false });
  });

  test("the selection's bytes fit the budget it was given", () => {
    const turns = Array.from({ length: 12 }, (_, index) =>
      person("turn " + String(index) + " words words words"),
    );
    const selected = lastTurns(turns, 8, 120);
    const rendered = selected.turns.map(askThreadLine).join("\n");
    expect(utf8ByteLength(rendered)).toBeLessThanOrEqual(120);
    expect(selected.turns.length).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ *
 * THE GOLDEN BYTES
 * ------------------------------------------------------------------ */

/** The exact bytes of the ask card's packet with a two-turn thread. */
const GOLDEN_SHORT = [
  "# a question about one card on an attention map",
  "",
  "## the question",
  "",
  QUESTION,
  "",
  "## rain",
  "",
  "state: the file is gone; this is the copy kept when it was added",
  "",
  "reading, first lines:",
  "first line",
  "second line",
  "",
  "note, the person's own words, first lines:",
  "my note",
  "",
  "## the conversation so far",
  "",
  "person: is the gauge calibrated?",
  "answer: the note says it was, in March.",
  "",
  "## what you may ask for",
  "",
  "This view is one view of a map that is larger than it; it is not the map. Every block above is headed by its own name, exactly as written after the two hashes.",
  "",
  "The cards above are the cards wired into this question: they are what it is about, and their readings are the material.",
  "",
  "One of those blocks is the conversation so far: what has already been said in this conversation, and context, not material. The cards are the material.",
  "",
  "You may ask for one block in full: write, on a line of its own, exactly",
  "",
  "READ: <name>",
  "",
  "with the name written exactly as the block's heading. You may ask for one of the cards above at most once. If what you need is not here, do not ask for it: answer from what this view gives you, and say plainly what you could not see.",
  "",
  "## the bound",
  "",
  ASK_PACKET_BOUND,
].join("\n");

describe("the ask card's packet is the card AND the thread", () => {
  test("the assembled text is pinned, byte for byte", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    expect(packet.text).toBe(GOLDEN_SHORT);
  });

  test("the blocks ride in the story's order", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    expect(packet.declaration.blocks.map((block) => block.kind)).toEqual([
      "question",
      "card",
      "thread",
      "instruction",
      "bound",
    ]);
  });

  test("a first question has no thread block and says nothing about turns", () => {
    const packet = assembleAskCardPacket([CARD], [], QUESTION);
    expect(packet.declaration.blocks.map((block) => block.kind)).toEqual([
      "question",
      "card",
      "instruction",
      "bound",
    ]);
    expect(packet.text).not.toContain(ASK_PACKET_THREAD_NAME);
    expect(packet.text).not.toContain(ASK_PACKET_THREAD_OMITTED);
  });

  test("a long thread: the bound bites, says so in words, and rides the newest", () => {
    // Twenty turns, each long enough that the byte budget bites before eight.
    const long = Array.from({ length: 20 }, (_, index) =>
      index % 2 === 0
        ? person("person line " + String(index) + " " + "w".repeat(220))
        : answer("answer line " + String(index) + " " + "w".repeat(230)),
    );
    const packet = assembleAskCardPacket([CARD], long, QUESTION);
    const thread = packet.blocks.find((block) => block.kind === "thread");
    if (thread === undefined) throw new Error("the thread block did not ride");
    // The qualitative sentence, and NEVER a count, a size or a token number:
    // the turns' own words are the person's (they may hold digits); the lines
    // this story writes may not.
    expect(thread.text).toContain(ASK_PACKET_THREAD_OMITTED);
    expect(thread.text.endsWith(ASK_PACKET_THREAD_OMITTED)).toBe(true);
    const written = [ASK_PACKET_THREAD_HEADING, ASK_PACKET_THREAD_OMITTED];
    for (const line of written) {
      expect(line).not.toMatch(/[0-9]/);
      expect(line).not.toMatch(/\bbytes?\b|\btokens?\b|\bKiB\b/i);
    }
    // Only whole turns, and only the NEWEST ones: the conversation's first
    // line is not here, and every line that is here is a turn verbatim.
    expect(thread.text).not.toContain("person line 0 ");
    const selected = lastTurns(long, ASK_THREAD_BOUND.turns, ASK_THREAD_BOUND.bytes);
    expect(selected.omitted).toBe(true);
    expect(selected.turns.length).toBeLessThan(long.length);
    for (const turn of selected.turns) {
      expect(thread.text).toContain(askThreadLine(turn));
    }
    expect(thread.text.split("\n").slice(2, 2 + selected.turns.length)).toEqual(
      selected.turns.map(askThreadLine),
    );
  });

  test("the TEXT carries no counts, sizes or token numbers", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    // The fixture's words avoid digits, so any digit would be a count or size.
    expect(packet.text).not.toMatch(/[0-9]/);
    expect(packet.text).not.toMatch(/\bbytes?\b|\btokens?\b|\bchars?\b/i);
  });
});

/* ------------------------------------------------------------------ *
 * THE DECLARATION
 * ------------------------------------------------------------------ */

describe("the declaration names every block with the bytes actually sent", () => {
  test("each size is its block's own bytes; the total is the one message's", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    for (const [index, line] of packet.declaration.blocks.entries()) {
      expect(line.kind).toBe(packet.blocks[index]!.kind);
      expect(line.name).toBe(packet.blocks[index]!.name);
      expect(line.size).toBe(utf8ByteLength(packet.blocks[index]!.text));
    }
    expect(packet.declaration.total).toBe(utf8ByteLength(packet.text));
    expect(packet.declaration.total).toBe(
      utf8ByteLength(packet.messages[0]!.content),
    );
  });

  test("the thread's declaration line is the block's size, said plainly", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    const thread = packet.declaration.blocks.find(
      (block) => block.kind === "thread",
    );
    if (thread === undefined) throw new Error("no thread line");
    expect(thread.name).toBe(ASK_PACKET_THREAD_NAME);
    const words = packetDeclarationWords(packet.declaration);
    expect(words).toContain("the conversation (" + thread.size + " bytes)");
    expect(words).toContain("will go:");
    expect(words).toContain(packet.declaration.total + " bytes in all");
    // The size is the DECLARATION's fact: it never rides in the text sent.
    expect(packet.text).not.toContain(String(thread.size));
    expect(packet.text).not.toContain(String(packet.declaration.total));
  });

  test("the bytes the surface opens ARE the bytes the turn sends", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    expect(packet.messages).toHaveLength(1);
    expect(packet.messages[0]!.role).toBe("user");
    expect(packet.messages[0]!.content).toBe(packet.text);
    // Every block rides inside the one message: nothing is declared and not
    // sent, and nothing is sent and not declared.
    for (const block of packet.blocks) {
      expect(packet.messages[0]!.content).toContain(block.text);
    }
  });
});

/* ------------------------------------------------------------------ *
 * ONE RETRIEVAL, ONLY OF THE ANCHORED BLOCK
 * ------------------------------------------------------------------ */

/** A scripted transport: the n-th turn is answered with the n-th string. */
function scripted(answers: readonly string[]) {
  const sent: string[] = [];
  const waiting = new Map<number, (line: SidecarLine) => void>();
  let index = 0;
  const transport = {
    async send(line: string): Promise<void> {
      sent.push(line);
      const request = parseRequestLine(line);
      if (request === null || request.kind !== "turn") return;
      const text = answers[index] ?? "";
      index += 1;
      setTimeout(() => {
        waiting.get(request.id)?.({
          id: request.id,
          kind: "part",
          part: "text",
          text,
        });
        waiting.get(request.id)?.({ id: request.id, kind: "done" });
      }, 0);
    },
    subscribe(id: number, handler: (line: SidecarLine) => void) {
      waiting.set(id, handler);
      return () => waiting.delete(id);
    },
  };
  return { transport, sent };
}

const PROVIDER = { baseUrl: "http://x", model: "m", apiKey: "sk-never-logged" };

function threadPacket(asked: readonly string[] = ["rain"]) {
  return assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION, ASK_THREAD_BOUND, asked);
}

describe("the READ set is the anchored block alone", () => {
  test("the thread's block name is never retrievable, even when handed in", () => {
    const packet = threadPacket(["rain", ASK_PACKET_THREAD_NAME, "the bound"]);
    expect(packet.retrievable).toEqual(["rain"]);
  });

  test("a READ naming the thread gets NO follow-up: the first answer stands", async () => {
    const { transport, sent } = scripted([
      "I can see the conversation.\nREAD: " + ASK_PACKET_THREAD_NAME,
    ]);
    let fetched = 0;
    const answered = await askTurnPacket(
      transport,
      PROVIDER,
      threadPacket(),
      async () => {
        fetched += 1;
        return "never used";
      },
    );
    expect(fetched).toBe(0);
    expect(sent).toHaveLength(1);
    expect(answered.read).toBeNull();
    expect(answered.missed).toBe(ASK_PACKET_THREAD_NAME);
    expect(answered.result.kind).toBe("answer");
  });

  test("a READ naming a turn's own line is refused the same way", async () => {
    const { transport, sent } = scripted([
      "READ: person: is the gauge calibrated?",
    ]);
    let fetched = 0;
    const answered = await askTurnPacket(
      transport,
      PROVIDER,
      threadPacket(),
      async () => {
        fetched += 1;
        return "never used";
      },
    );
    expect(fetched).toBe(0);
    expect(sent).toHaveLength(1);
    expect(answered.read).toBeNull();
    expect(answered.missed).toBe("person: is the gauge calibrated?");
  });

  test("a READ of the anchored card fetches it ONCE, with one follow-up", async () => {
    const { transport, sent } = scripted([
      "READ: rain",
      "the final answer",
    ]);
    const names: string[] = [];
    const answered = await askTurnPacket(
      transport,
      PROVIDER,
      threadPacket(),
      async (name) => {
        names.push(name);
        return "the card in full";
      },
    );
    expect(names).toEqual(["rain"]);
    expect(sent).toHaveLength(2);
    expect(answered.read).toBe("rain");
    expect(answered.missed).toBeNull();
    expect(answered.result).toEqual({ kind: "answer", text: "the final answer" });
    const first = parseRequestLine(sent[0] as string);
    if (first === null || first.kind !== "turn") throw new Error("unreachable");
    expect(first.messages).toEqual(threadPacket().messages);
  });
});

/* ------------------------------------------------------------------ *
 * THE CARD DECLARES BEFORE THE SEND
 * ------------------------------------------------------------------ */

const ASK: AskCardRecord = {
  on: "rain-question",
  name: "Rain question",
  x: 360,
  y: 60,
  anchor: "rain",
};

function renderCard() {
  return renderToStaticMarkup(
    createElement(AskCard, {
      ask: ASK,
      anchorName: "rain",
      context: [CARD],
      turns: SHORT_THREAD,
      open: true,
      previewLines: 6,
      onOpen: () => {},
      onClose: () => {},
    }),
  );
}

describe("the card shows the declaration and the bytes verb BEFORE the send", () => {
  test("the thread's block, its size and the total are on screen before send", () => {
    const html = renderCard();
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, "");
    const thread = packet.declaration.blocks.find(
      (block) => block.kind === "thread",
    );
    if (thread === undefined) throw new Error("no thread line");
    expect(html).toContain("will go:");
    expect(html).toContain("the conversation (" + thread.size + " bytes)");
    expect(html).toContain(packet.declaration.total + " bytes in all");
    expect(html).toContain("the exact bytes");
    // Declared, then openable, then sent: the verb precedes the button.
    expect(html.indexOf("the exact bytes")).toBeGreaterThan(
      html.indexOf("will go:"),
    );
    expect(html.indexOf("ask-card-send")).toBeGreaterThan(
      html.indexOf("the exact bytes"),
    );
  });

  test("the card composes the SAME packet the hook sends", () => {
    const card = source("canvas/AskCard.tsx");
    const hook = source("canvas/useGround.ts");
    for (const text of [card, hook]) {
      expect(text).toContain("assembleAskCardPacket(");
      expect(text).toContain("ASK_THREAD_BOUND");
    }
    // The thread is the record the card already shows, in file order; the
    // WIRED cards' blocks are the same already-cropped descriptions (17.9).
    expect(card).toContain("assembleAskCardPacket(");
    expect(card).toContain("context,");
    // STORY 17.5: the hook hands the assembler the COMPOSED thread (a fork's
    // carried prefix read from the parent, then its own turns) through the one
    // pure helper, so the bound is applied to the whole thread in one place.
    expect(hook).toContain("askThreadOf(ask, asksRef.current, askTurnsRef.current).turns");
    // The shared surface is reused, not copied: one declaration, one verb.
    expect(card).toContain('from "./PacketSurface"');
    expect(card).toContain("<PacketSurface");
    // The surface itself is untouched by this story.
    const surface = source("canvas/PacketSurface.tsx");
    expect(surface).not.toContain("ASK_PACKET_THREAD");
    expect(surface).not.toContain("lastTurns");
  });

  test("a card with NO context still composes and says nothing is wired in", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: ASK,
        anchorName: "rain",
        turns: SHORT_THREAD,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("is the gauge calibrated?");
    expect(html).toContain("nothing is wired into this question.");
    // It still sends: the question and the thread, with no card block.
    expect(html).toContain("will go:");
    expect(html).not.toContain("the card \u201c");
  });
});

/* ------------------------------------------------------------------ *
 * ELSEWHERE: THE CLIPBOARD ROUTE AND THE GROUND MAP'S CONTENT
 * ------------------------------------------------------------------ */

describe("the clipboard route is untouched and the ground map renders nothing", () => {
  test("the copy route still carries the question and citations only", () => {
    const copied = askPacket("what changed?", [
      { form: "path", value: "notes/x.md" },
    ]);
    expect(copied).toBe("what changed?\n\nincluded:\n- path notes/x.md");
    expect(copied).not.toContain(ASK_PACKET_THREAD_NAME);
    expect(copied).not.toContain("READ:");
    const ask = source("contacts/ask.ts");
    expect(ask).not.toContain("assembleAskCardPacket");
    expect(ask).not.toContain("lastTurns");
    expect(ask).not.toContain("ASK_THREAD_BOUND");
  });

  test("renderedMapContent('ground') stays []", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("the turn's READ rule needed no second branch", () => {
    // The packet's READ set is the whole of the rule: the thread's block is
    // never listed, so the existing refusal covers it.
    const turn = source("turn/turn.ts");
    expect(turn).toContain("packet.retrievable.includes(name)");
    expect(turn).not.toContain("ASK_PACKET_THREAD_NAME");
  });
});

/** The surface's own type is shared with the turn port (a compile-time tie). */
const PORT: TurnPort | null = null;
void PORT;
