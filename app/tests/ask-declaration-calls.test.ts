import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AskCard } from "../src/canvas/AskCard";
import { PacketSurface } from "../src/canvas/PacketSurface";
import {
  ASK_BYTES_OPEN,
  ASK_CALLS_CONDITION,
  ASK_CALLS_MANAGER,
  ASK_CALLS_NO_MANAGER,
  ASK_CALLS_SAME,
  ASK_CALLS_TASK,
  askCallsWords,
  packetDeclarationWords,
  type AskCallsFacts,
} from "../src/canvas/contactRules";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import type { AskCard as AskCardRecord, AskTurn } from "../src/map/asks";
import {
  assembleAskCardPacket,
  type AskPacketCard,
} from "../src/turn/packet";
import { utf8ByteLength } from "../src/lib/textBytes";

/**
 * STORY 17.13 — THE DECLARATION NAMES BOTH CALLS (ADR-0037 decision 1).
 *
 * The human check is "press the declaration before a send: it lists the blocks
 * as today AND says which model answers and which one distils, with the distil
 * step marked as happening only after a completed answer; with the two rows on
 * the same model it says so instead of inventing a difference." This file pins
 * the rules underneath it:
 *
 *   - THREE states, three wordings: two models (with the condition), one model
 *     both (ONE line), no manager (a RULE makes the card, 17.11's path);
 *   - the section states roles and conditionality only — no token count, no
 *     cost, no timer;
 *   - the blocks, their sizes, the exact-bytes verb, READ and the bytes sent
 *     are BYTE-IDENTICAL to before this section arrived (golden values below,
 *     captured from the code before the calls section existed);
 *   - the card draws the calls line before the send, and the surface draws
 *     nothing when its caller cannot name the models;
 *   - renderedMapContent("ground") stays [].
 *
 * PROVISIONAL: the wording of every line and the section's place in the
 * declaration.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const TASK = { row: "workbench", model: "hammer" };

const TWO: AskCallsFacts = {
  task: TASK,
  manager: { row: "workbench", model: "lantern" },
};

const ONE: AskCallsFacts = { task: TASK, manager: TASK };

const NO_MANAGER: AskCallsFacts = { task: TASK, manager: null };

/* ------------------------------------------------------------------ *
 * THREE STATES, THREE WORDINGS
 * ------------------------------------------------------------------ */

describe("the calls section says two calls, one model, or a rule", () => {
  test("two different models: the rows, the order, and the condition", () => {
    expect(askCallsWords(TWO)).toEqual([
      "the task model answers: workbench / hammer",
      "then the manager model distils the reply into a card: workbench / lantern",
      "the distil step runs only if the answer completes",
    ]);
    // The exact constants the surface draws, so no second wording exists.
    expect(askCallsWords(TWO)[0]).toBe(ASK_CALLS_TASK + "workbench / hammer");
    expect(askCallsWords(TWO)[1]).toBe(
      ASK_CALLS_MANAGER + "workbench / lantern",
    );
    expect(askCallsWords(TWO)[2]).toBe(ASK_CALLS_CONDITION);
  });

  test("the same model both roles: ONE line, no invented difference", () => {
    const lines = askCallsWords(ONE);
    expect(lines).toEqual(["one model does both: workbench / hammer"]);
    expect(lines[0]).toBe(ASK_CALLS_SAME + "workbench / hammer");
    // A single line is the whole section: no second role sentence.
    expect(lines).toHaveLength(1);
    for (const contradiction of [
      "then the manager",
      "the distil step",
      "answers:",
    ]) {
      expect(lines[0]).not.toContain(contradiction);
    }
  });

  test("no manager configured: a RULE makes the card, said plainly", () => {
    expect(askCallsWords(NO_MANAGER)).toEqual([
      "the task model answers: workbench / hammer",
      "no manager model is configured, so the card will be made by a rule instead",
    ]);
    expect(askCallsWords(NO_MANAGER)[1]).toBe(ASK_CALLS_NO_MANAGER);
    // No second call is promised when none will be made.
    expect(askCallsWords(NO_MANAGER).join(" ")).not.toContain("distils");
    expect(askCallsWords(NO_MANAGER).join(" ")).not.toContain(
      "only if the answer completes",
    );
  });

  test("a row that already says the model names it once", () => {
    expect(
      askCallsWords({
        task: { row: "local", model: "local" },
        manager: { row: "local", model: "local" },
      }),
    ).toEqual(["one model does both: local"]);
  });

  test("roles and conditionality only: no count, cost or timer", () => {
    for (const facts of [TWO, ONE, NO_MANAGER]) {
      const words = askCallsWords(facts).join(" ");
      // The fixtures avoid digits, so any digit would be a count or a size.
      expect(words).not.toMatch(/[0-9]/);
      expect(words).not.toMatch(
        /bytes?|tokens?|chars?|cost|price|seconds?|minutes?|time[sd]?|budget/i,
      );
    }
  });
});

/* ------------------------------------------------------------------ *
 * THE BLOCKS ARE BYTE-IDENTICAL TO BEFORE
 * ------------------------------------------------------------------ */

const CARD: AskPacketCard = {
  name: "rain",
  state: "the file is gone; this is the copy kept when it was added",
  reading: "first line\nsecond line",
  note: "my note",
};

const QUESTION = "what does this card say about rain?";

const TAKEN = "2026-11-18T02:00:00.000Z";

const SHORT_THREAD: AskTurn[] = [
  { role: "person", text: "is the gauge calibrated?", t: TAKEN },
  { role: "answer", text: "the note says it was, in March.", t: TAKEN },
];

/**
 * THE GOLDEN VALUES (captured from this code BEFORE the calls section existed;
 * this story touches no packet block and no declaration block line). If a
 * change to the calls section ever moves one of these, the declaration has
 * started describing different bytes from the ones that leave.
 */
const GOLDEN_DECLARATION =
  "will go: your question (52 bytes) · the card “rain” (171 bytes) · " +
  "the conversation (100 bytes) · the instruction (780 bytes) · " +
  "the bound (43 bytes) · 1203 bytes in all";

const GOLDEN_MESSAGE = [
  "# a question about one card on an attention map",
  "",
  "## the question",
  "",
  "what does this card say about rain?",
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
  "This view is one view of a map that is larger than it; it is not the map. " +
    "Every block above is headed by its own name, exactly as written after the two hashes.",
  "",
  "The cards above are the cards wired into this question: they are what it " +
    "is about, and their readings are the material.",
  "",
  "One of those blocks is the conversation so far: what has already been said " +
    "in this conversation, and context, not material. The cards are the material.",
  "",
  "You may ask for one block in full: write, on a line of its own, exactly",
  "",
  "READ: <name>",
  "",
  "with the name written exactly as the block's heading. You may ask for one " +
    "of the cards above at most once. If what you need is not here, do not ask " +
    "for it: answer from what this view gives you, and say plainly what you " +
    "could not see.",
  "",
  "## the bound",
  "",
  "This view; the map is larger.",
].join("\n");

const GOLDEN_BLOCKS = [
  { kind: "question", name: "the question", size: 52 },
  { kind: "card", name: "rain", size: 171 },
  { kind: "thread", name: "the conversation so far", size: 100 },
  { kind: "instruction", name: "the instruction", size: 780 },
  { kind: "bound", name: "the bound", size: 43 },
];

describe("the material blocks and the sent bytes are byte-identical", () => {
  test("the declaration's exact sentence is unchanged", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    expect(packetDeclarationWords(packet.declaration)).toBe(GOLDEN_DECLARATION);
    // Every declared size is still its block's own byte count, and the total
    // is still the one message's bytes.
    expect(packet.declaration.blocks).toEqual(GOLDEN_BLOCKS);
    for (const [index, line] of packet.declaration.blocks.entries()) {
      expect(line.size).toBe(utf8ByteLength(packet.blocks[index]!.text));
    }
    expect(packet.declaration.total).toBe(1203);
    expect(packet.declaration.total).toBe(
      utf8ByteLength(packet.messages[0]!.content),
    );
  });

  test("the bytes that leave are unchanged, verbatim", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    expect(packet.messages).toHaveLength(1);
    expect(packet.messages[0]!.role).toBe("user");
    expect(packet.messages[0]!.content).toBe(GOLDEN_MESSAGE);
    // THE ONE READ verb is still there, exactly once, for the one block the
    // model may ask for in full.
    expect(GOLDEN_MESSAGE.match(/^READ: <name>$/gm)).toHaveLength(1);
    for (const block of packet.blocks) {
      expect(packet.messages[0]!.content).toContain(block.text);
    }
  });
});

/* ------------------------------------------------------------------ *
 * THE SURFACE DRAWS IT BESIDE THE DECLARATION
 * ------------------------------------------------------------------ */

describe("the calls section rides beside the declaration, never inside it", () => {
  test("the surface draws the calls after the blocks, blocks untouched", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    const html = renderToStaticMarkup(
      createElement(PacketSurface, {
        declaration: packet.declaration,
        calls: TWO,
        messages: packet.messages,
      }),
    );
    expect(html).toContain(GOLDEN_DECLARATION);
    expect(html).toContain("the task model answers: workbench / hammer");
    expect(html).toContain(
      "then the manager model distils the reply into a card: workbench / lantern",
    );
    expect(html).toContain("the distil step runs only if the answer completes");
    // The section is a second block, after the declaration sentence.
    expect(html.indexOf("will go:")).toBeLessThan(
      html.indexOf("the task model answers:"),
    );
    // The one verb that opens the exact bytes is unchanged.
    expect(html).toContain(ASK_BYTES_OPEN);
    expect(ASK_BYTES_OPEN).toBe("the exact bytes");
  });

  test("a caller that cannot name the models draws nothing new", () => {
    const packet = assembleAskCardPacket([CARD], SHORT_THREAD, QUESTION);
    const html = renderToStaticMarkup(
      createElement(PacketSurface, {
        declaration: packet.declaration,
        messages: packet.messages,
      }),
    );
    expect(html).toContain(GOLDEN_DECLARATION);
    expect(html).not.toContain("the task model answers:");
    expect(html).not.toContain("one model does both");
    expect(html).not.toContain("made by a rule");
  });
});

/* ------------------------------------------------------------------ *
 * THE CARD SHOWS IT BEFORE THE SEND
 * ------------------------------------------------------------------ */

const ASK: AskCardRecord = {
  on: "rain-question",
  name: "Rain question",
  x: 360,
  y: 60,
  anchor: "rain",
};

function renderCard(calls: AskCallsFacts | null) {
  return renderToStaticMarkup(
    createElement(AskCard, {
      ask: ASK,
      anchorName: "rain",
      context: [CARD],
      turns: SHORT_THREAD,
      open: true,
      previewLines: 6,
      hasProvider: true,
      calls,
      onOpen: () => {},
      onClose: () => {},
    }),
  );
}

describe("the ask card names both calls before the send", () => {
  test("the row names and the condition are on screen, before the send", () => {
    const html = renderCard(TWO);
    expect(html).toContain("will go:");
    expect(html).toContain("the task model answers: workbench / hammer");
    expect(html).toContain("the manager model distils the reply into a card");
    expect(html).toContain("the distil step runs only if the answer completes");
    // Declared before the send, and before the one bytes verb.
    expect(html.indexOf("the task model answers:")).toBeLessThan(
      html.indexOf("ask-card-send"),
    );
    expect(html.indexOf("the task model answers:")).toBeLessThan(
      html.indexOf("the exact bytes"),
    );
  });

  test("the same model reads as ONE line on the card too", () => {
    const html = renderCard(ONE);
    expect(html).toContain("one model does both: workbench / hammer");
    expect(html).not.toContain("the manager model distils");
    expect(html).not.toContain("the distil step runs");
  });

  test("no manager says a rule makes the card", () => {
    const html = renderCard(NO_MANAGER);
    expect(html).toContain("made by a rule instead");
    expect(html).not.toContain("the manager model distils");
  });

  test("a card whose caller cannot say the calls draws no calls line", () => {
    const html = renderCard(null);
    expect(html).toContain("will go:");
    expect(html).not.toContain("the task model answers:");
  });
});

/* ------------------------------------------------------------------ *
 * THE PLUMBING AND THE TRUTHFUL RULE PATH
 * ------------------------------------------------------------------ */

describe("the facts come from Settings and a missing manager really is a rule", () => {
  test("App resolves the SAME manager the send path uses", () => {
    const app = source("App.tsx");
    expect(app).toContain("resolveManager(settings)");
    expect(app).toContain("resolveSelection(settings)");
    expect(app).toContain("calls={askCalls}");
    // The manager row is resolved through the one helper, never re-derived.
    expect(app).not.toContain("settings.managerProviderId ===");
    const card = source("canvas/AskCard.tsx");
    expect(card).toContain("calls={calls}");
    const layer = source("canvas/GroundLayer.tsx");
    expect(layer).toContain("calls={calls}");
  });

  test("no manager: the hook writes 17.11's rule card, never a fancier sentence", () => {
    const hook = source("canvas/useGround.ts");
    const at = hook.indexOf("if (manager.kind !== \"resolved\")");
    expect(at).toBeGreaterThan(-1);
    const branch = hook.slice(at, at + 700);
    // The branch returns the task's send with NO curator facts, so the rule
    // writer makes the card — exactly what the declaration promised.
    expect(branch).toContain("return sent;");
    expect(branch).not.toContain("curator:");
    expect(branch).not.toContain("curatorPrism");
    // There is still exactly one seat that writes an artifact.
    expect(hook.match(/await writeDistilledCard\(/g) ?? []).toHaveLength(1);
  });

  test("the ground map still renders no content of its own", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
