import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ASK_CONTEXT_EMPTY,
  ASK_CONTEXT_DANGLING,
  ASK_CONTEXT_LABEL,
  AskCard,
} from "../src/canvas/AskCard";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  ASK_CONTEXT_NO_ANSWER,
  ASK_CONTEXT_NO_RUN,
  ASK_CONTEXT_RUN_UNFINISHED,
  askContextFactsOf,
  askContextInclusion,
  askContextSources,
} from "../src/canvas/useGround";
import { pointerKey } from "../src/map/pointers";
import type { GroundReference } from "../src/map/ground";
import type { AskCard as AskCardRecord, AskTurn } from "../src/map/asks";
import type { GroundLink } from "../src/map/groundLinks";
import type { SessionCard as SessionCardRecord, SessionEntry } from "../src/map/sessions";
import type { Reading } from "../src/map/readings";
import { parsePrismChange } from "../src/map/prisms";
import { askCardOf } from "../src/turn/context";
import {
  ASK_PACKET_CONTEXT_OMITTED,
  assembleAskCardPacket,
  selectAskContextCards,
  type AskPacketCard,
} from "../src/turn/packet";
import { askTurnPacket } from "../src/turn/turn";
import { parseRequestLine, type SidecarLine } from "../src/turn/protocol";

/**
 * STORY 17.9 - A WIRE IS CONTEXT.
 *
 * The user's correction: an ask card is on the same level as a reference card,
 * and the cards LINKED TO it give the model context. These tests pin the rules
 * underneath the human check: the context is the incoming links; each wired
 * card lends what it has; the packet bounds the whole context; READ may name an
 * included card; the PRISM's inclusion set is the wired readings' keys and the
 * legacy anchor is parse-only.
 */

const SLUG = "rain-question";
const NOW = "2026-11-18T02:00:00.000Z";

function reference(on: string, name: string): GroundReference {
  return { on, name, x: 0, y: 0 };
}

function link(from: string, to: string): GroundLink {
  return { from, to };
}

function ask(on: string, name: string): AskCardRecord {
  return { on, name, x: 0, y: 0, anchor: "rain-gauge" };
}

const GAUGE = reference("rain-gauge", "Rain gauge");
const WELL = reference("old-well", "Old well");

const READING: Reading = {
  on: GAUGE.on,
  form: "path",
  from: "notes/gauge.md",
  taken: NOW,
};

const NOTE_READING: Reading = {
  on: WELL.on,
  form: "path",
  from: "notes/well.md",
  taken: NOW,
};

function answerTurn(text: string): AskTurn {
  return { role: "answer", text, t: NOW };
}

function personTurn(text: string): AskTurn {
  return { role: "person", text, t: NOW };
}

describe("the context is the wires, in file order", () => {
  test("only links whose TARGET is the ask card count, deduped", () => {
    const wires = askContextSources(
      SLUG,
      [
        link(GAUGE.on, SLUG),
        link(WELL.on, "another-question"),
        link(GAUGE.on, SLUG),
        link(WELL.on, SLUG),
      ],
      [GAUGE.on, WELL.on],
    );
    expect(wires.sources).toEqual([GAUGE.on, WELL.on]);
    expect(wires.dangling).toEqual([]);
  });

  test("a wire whose source is gone is DANGLING, said not repaired", () => {
    const wires = askContextSources(
      SLUG,
      [link("gone-card", SLUG), link(GAUGE.on, SLUG)],
      [GAUGE.on],
    );
    expect(wires.sources).toEqual([GAUGE.on]);
    expect(wires.dangling).toEqual(["gone-card"]);
  });
});

describe("a wired card contributes what it HAS", () => {
  test("a reference lends name, state, reading crop and note crop", () => {
    const context = askContextFactsOf({
      ask: SLUG,
      links: [link(GAUGE.on, SLUG)],
      references: [GAUGE],
      asks: [],
      askTurns: {},
      readings: [READING],
      texts: { [GAUGE.on]: "the gauge reads twelve" },
      notes: { [GAUGE.on]: "a note about rain" },
      states: { [GAUGE.on]: "current" },
    });
    expect(context.facts).toHaveLength(1);
    const card = askCardOf(context.facts[0]!);
    expect(card.name).toBe("Rain gauge");
    expect(card.reading).toContain("the gauge reads twelve");
    expect(card.note).toBe("a note about rain");
  });

  test("an ask card lends its most recent COMPLETED answer, whole", () => {
    const parent = ask("parent-ask", "Parent ask");
    const context = askContextFactsOf({
      ask: SLUG,
      links: [link(parent.on, SLUG)],
      references: [],
      asks: [parent],
      askTurns: {
        [parent.on]: [
          personTurn("what is it?"),
          answerTurn("a first answer"),
          personTurn("and now?"),
          answerTurn("the newer answer, whole"),
        ],
      },
      readings: [],
      texts: {},
      notes: {},
      states: {},
    });
    const card = askCardOf(context.facts[0]!);
    expect(card.answer).toBe("the newer answer, whole");
  });

  test("an ask card with no completed answer still rides, and says so", () => {
    const parent = ask("parent-ask", "Parent ask");
    const context = askContextFactsOf({
      ask: SLUG,
      links: [link(parent.on, SLUG)],
      references: [],
      asks: [parent],
      askTurns: { [parent.on]: [personTurn("unanswered")] },
      readings: [],
      texts: {},
      notes: {},
      states: {},
    });
    expect(askCardOf(context.facts[0]!).empty).toBe(ASK_CONTEXT_NO_ANSWER);
  });

  test("a session card lends its newest COMPLETED run's text", () => {
    const session: SessionCardRecord = {
      on: "session-1",
      name: "A run",
      x: 0,
      y: 0,
      tool: "a-tool",
    };
    const entries: SessionEntry[] = [
      { kind: "started", t: NOW },
      { kind: "text", text: "the first run's words" },
      { kind: "ended", ending: "completed", t: NOW },
      { kind: "started", t: NOW },
      { kind: "text", text: "the newest completed run" },
      { kind: "ended", ending: "completed", t: NOW },
    ];
    const context = askContextFactsOf({
      ask: SLUG,
      links: [link(session.on, SLUG)],
      references: [],
      asks: [],
      askTurns: {},
      sessions: [session],
      sessionEntries: { [session.on]: entries },
      readings: [],
      texts: {},
      notes: {},
      states: {},
    });
    expect(askCardOf(context.facts[0]!).result).toBe("the newest completed run");
  });

  test("a session card whose last run did not finish says that instead", () => {
    const session: SessionCardRecord = {
      on: "session-1",
      name: "A run",
      x: 0,
      y: 0,
      tool: "a-tool",
    };
    const context = askContextFactsOf({
      ask: SLUG,
      links: [link(session.on, SLUG)],
      references: [],
      asks: [],
      askTurns: {},
      sessions: [session],
      sessionEntries: {
        [session.on]: [
          { kind: "started", t: NOW },
          { kind: "text", text: "a partial" },
          { kind: "ended", ending: "stopped", t: NOW },
        ],
      },
      readings: [],
      texts: {},
      notes: {},
      states: {},
    });
    const card = askCardOf(context.facts[0]!);
    expect(card.result).toBeUndefined();
    expect(card.empty).toBe(ASK_CONTEXT_RUN_UNFINISHED);
  });

  test("a session card that never ran says so with its own line", () => {
    const session: SessionCardRecord = {
      on: "session-1",
      name: "A run",
      x: 0,
      y: 0,
      tool: "a-tool",
    };
    const context = askContextFactsOf({
      ask: SLUG,
      links: [link(session.on, SLUG)],
      references: [],
      asks: [],
      askTurns: {},
      sessions: [session],
      sessionEntries: {},
      readings: [],
      texts: {},
      notes: {},
      states: {},
    });
    expect(askCardOf(context.facts[0]!).empty).toBe(ASK_CONTEXT_NO_RUN);
  });
});

const ONE: AskPacketCard = askCardOf({
  on: GAUGE.on,
  name: "Rain gauge",
  state: null,
  reading: READING,
  readingText: "the gauge reads twelve",
  note: null,
});
const TWO: AskPacketCard = askCardOf({
  on: WELL.on,
  name: "Old well",
  state: null,
  reading: NOTE_READING,
  readingText: "the well is deep",
  note: null,
});

describe("the packet carries the WHOLE wired context under the stated bound", () => {
  test("two wired cards both ride and are declared by name", () => {
    const packet = assembleAskCardPacket([ONE, TWO], [], "both?");
    expect(packet.declaration.blocks.map((block) => block.kind)).toEqual([
      "question",
      "card",
      "card",
      "instruction",
      "bound",
    ]);
    expect(
      packet.declaration.blocks
        .filter((block) => block.kind === "card")
        .map((block) => block.name),
    ).toEqual(["Rain gauge", "Old well"]);
    expect(packet.text).toContain("## Rain gauge");
    expect(packet.text).toContain("## Old well");
  });

  test("unwiring one removes it from the packet", () => {
    const wired = selectAskContextCards([ONE], { cards: 4, bytes: 8 * 1024 }).cards;
    const packet = assembleAskCardPacket(wired, [], "only one?");
    expect(packet.text).toContain("## Rain gauge");
    expect(packet.text).not.toContain("## Old well");
  });

  test("a card with NO context still sends, and says no card is wired", () => {
    const packet = assembleAskCardPacket([], [], "alone?");
    expect(packet.text).toContain("## the question");
    expect(packet.text).toContain("No card is wired into this question");
    expect(packet.declaration.blocks.some((block) => block.kind === "card")).toBe(false);
  });

  test("the card count bound drops the rest, with the qualitative sentence", () => {
    const cards = ["A", "B", "C", "D", "E"].map((name) => ({
      name,
      state: null,
      reading: null,
      note: "note " + name,
    }));
    const selected = selectAskContextCards(cards, { cards: 4, bytes: 8 * 1024 });
    expect(selected.cards.map((card) => card.name)).toEqual(["A", "B", "C", "D"]);
    expect(selected.omitted).toBe(true);
    const packet = assembleAskCardPacket(cards, [], "five?");
    expect(packet.text).toContain(ASK_PACKET_CONTEXT_OMITTED);
    expect(packet.text).not.toContain("## E");
  });

  test("the byte budget drops WHOLE cards only: the block is never cut", () => {
    const big = {
      name: "Big",
      state: null,
      reading: null,
      note: "x".repeat(200),
    };
    const small = { name: "Small", state: null, reading: null, note: "ok" };
    const selected = selectAskContextCards([big, small], { cards: 4, bytes: 40 });
    expect(selected.cards).toEqual([]);
    expect(selected.omitted).toBe(true);
    const noRoom = selectAskContextCards([big, small], { cards: 4, bytes: 200 });
    expect(noRoom.cards).toEqual([]);
  });

  test("the declaration's sizes are the bytes actually sent", () => {
    const packet = assembleAskCardPacket([ONE, TWO], [], "sizes?");
    packet.declaration.blocks.forEach((line, index) => {
      expect(line.size).toBe(
        new TextEncoder().encode(packet.blocks[index]!.text).length,
      );
    });
    expect(packet.declaration.total).toBe(
      new TextEncoder().encode(packet.text).length,
    );
  });
});

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
        waiting.get(request.id)?.({ id: request.id, kind: "part", part: "text", text });
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

describe("READ is ONE, and may name any INCLUDED card", () => {
  test("the wired cards are retrievable; an unwired name is not", () => {
    const packet = assembleAskCardPacket(
      [ONE, TWO],
      [],
      "read?",
      undefined,
      ["Rain gauge", "Old well", "Rain gauge"],
    );
    expect(packet.retrievable.sort()).toEqual(["Old well", "Rain gauge"]);
    const unwired = assembleAskCardPacket(
      [ONE],
      [],
      "read?",
      undefined,
      ["Old well"],
    );
    expect(unwired.retrievable).toEqual([]);
  });

  test("a READ of a wired card fetches it ONCE", async () => {
    const { transport, sent } = scripted(["READ: Rain gauge", "final"]);
    const names: string[] = [];
    const packet = assembleAskCardPacket(
      [ONE],
      [],
      "read?",
      undefined,
      ["Rain gauge"],
    );
    const answered = await askTurnPacket(transport, PROVIDER, packet, async (name) => {
      names.push(name);
      return "the gauge in full";
    });
    expect(names).toEqual(["Rain gauge"]);
    expect(sent).toHaveLength(2);
    expect(answered.read).toBe("Rain gauge");
    expect(answered.missed).toBeNull();
  });

  test("a READ of an unwired card gets NO follow-up", async () => {
    const { transport, sent } = scripted(["READ: Old well", "first answer stands"]);
    let fetched = 0;
    const packet = assembleAskCardPacket(
      [ONE],
      [],
      "read?",
      undefined,
      ["Rain gauge"],
    );
    const answered = await askTurnPacket(transport, PROVIDER, packet, async () => {
      fetched += 1;
      return "never";
    });
    expect(fetched).toBe(0);
    expect(sent).toHaveLength(1);
    expect(answered.read).toBeNull();
    expect(answered.missed).toBe("Old well");
  });
});

describe("the PRISM: the inclusion set is the wired readings, anchor is legacy", () => {
  test("the included set names both wired cards' readings", () => {
    const included = askContextInclusion([ONE, TWO], [READING, NOTE_READING]);
    expect(included).toEqual([
      pointerKey(GAUGE.on, "path", "notes/gauge.md"),
      pointerKey(WELL.on, "path", "notes/well.md"),
    ]);
  });

  test("one wired reading, or none, is the set", () => {
    expect(askContextInclusion([ONE], [READING])).toEqual([
      pointerKey(GAUGE.on, "path", "notes/gauge.md"),
    ]);
    expect(askContextInclusion([], [READING])).toBeNull();
    expect(askContextInclusion([], [])).toBeNull();
  });

  test("an OLD line with an anchor still parses", () => {
    const old = parsePrismChange({
      kind: "ask",
      pointer: null,
      anchor: "rain-gauge",
      outcome: "no-response",
      included: null,
      responseSize: null,
      decode: null,
    });
    expect(old).not.toBeNull();
    if (old === null || old.kind !== "ask") throw new Error("unreachable");
    expect(old.anchor).toBe("rain-gauge");
  });
});

describe("the card says what it has", () => {
  const CARD: AskCardRecord = {
    on: SLUG,
    name: "Rain question",
    x: 0,
    y: 0,
    anchor: "rain-gauge",
  };

  test("expanded, the names are listed above the thread", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: CARD,
        anchorName: "Rain gauge",
        context: [ONE, TWO],
        turns: [personTurn("the asked words"), answerTurn("an answer")],
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain(ASK_CONTEXT_LABEL + "Rain gauge \u00b7 Old well");
    expect(html.indexOf(ASK_CONTEXT_LABEL)).toBeLessThan(
      html.indexOf("the asked words"),
    );
  });

  test("no context says so in one quiet line, and the card still sends", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: CARD,
        anchorName: "Rain gauge",
        context: [],
        turns: [],
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain(ASK_CONTEXT_EMPTY);
    expect(html).toContain("ask-card-send");
  });

  test("a dangling wire is said, not repaired", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: CARD,
        anchorName: "Rain gauge",
        context: [],
        contextMissing: true,
        turns: [],
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain(ASK_CONTEXT_DANGLING);
    expect(html).not.toContain(ASK_CONTEXT_EMPTY);
  });

  test("the ground map still renders no concept family", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
