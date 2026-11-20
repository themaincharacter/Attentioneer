import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ACT_NAMES,
  type CommandAct,
} from "../src/commands/acts";
import {
  applyCommandScript,
  createAttentioneerHost,
} from "../src/commands/attentioneerHost";
import { nodeCommandIo } from "../scripts/commands";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { groundLinksPath, loadGroundLinks } from "../src/map/groundLinks";
import { loadGround } from "../src/map/ground";
import { loadAsks } from "../src/map/asks";
import { loadNote, notePath } from "../src/map/notes";
import {
  COMMAND_ACCEPT_VERB,
  COMMAND_EXCHANGE_MAX_ACTS,
  COMMAND_UNDO_BOUNDED_SENTENCE,
  COMMAND_UNDO_COMPLETE_SENTENCE,
  COMMAND_UNDO_PARTIAL_PREFIX,
  COMMAND_UNDO_SECOND_SENTENCE,
  COMMAND_UNDO_SENTENCE,
  COMMAND_UNDO_TAKES_BACK_LABEL,
  CommandCard,
  EMPTY_COMMAND_THREAD,
  actLine,
  appendExchange,
  appliedExchange,
  lastAppliedExchangeOf,
  nothingExchange,
  undoLine,
  undoOfferOf,
  undoScriptOf,
  undoSecondSentence,
  type CommandExchange,
  type CommandUndoOffer,
} from "../src/canvas/CommandCard";

/**
 * STORY 21.10 — UNDO THE WHOLE SCRIPT, NOT JUST ITS LAST ACT (ADR-0038
 * Amendment 2: propose AND undo, both deliberately).
 *
 * The story in one sentence: "undo that" after an accepted script offers the
 * inverse of EVERY act in that script, in REVERSE order, as ONE press — and
 * says plainly if an act has no expressible inverse.
 *
 * What this file proves, in the story's own words:
 *
 *   - a three-act script (card, wire, note) undoes in reverse order as ONE
 *     script, and applying it once takes all three back;
 *   - a partial undo NAMES the act it cannot take back and still applies the
 *     rest, never claiming completeness;
 *   - a second "undo that" after an undo does not double-invert: it either
 *     restores a whole invertible undo or says why it will not;
 *   - an unaccepted undo changes nothing;
 *   - the applied script's act list is the WHOLE script, bounded, said in one
 *     sentence when its earliest acts are out of reach;
 *   - there is no new act, no record change and no counter.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-undo-script-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const GROUND =
  "on: rain | name: rain | x: 0 | y: 0\non: soil | name: soil | x: 120 | y: 0\n";

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  writeFileSync(join(path, "map/ground.txt"), GROUND, "utf8");
  return path;
}

function hostFor(path: string) {
  return createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
}

/** The three acts the story names: a card, then a wire, then a note. */
const CARD: CommandAct = {
  act: "propose_card",
  map: "ground",
  payload: { name: "rain gauge", x: 240, y: 0 },
};
// The wire and the note name cards the map ALREADY holds: a script's ghost is
// not on the map until its accept, so a same-script wire to the new card would
// be refused by the host (an earlier story's rule, unchanged here).
const WIRE: CommandAct = {
  act: "propose_wire",
  map: "ground",
  payload: { from: "rain", to: "soil" },
};
const NOTE: CommandAct = {
  act: "propose_note",
  map: "ground",
  payload: { card: "rain", note: "the gauge" },
};

/** One script, applied the way the card's one press applies it. */
async function run(path: string, acts: readonly CommandAct[]) {
  return applyCommandScript(acts, hostFor(path));
}

/** What the map folder holds for this story: cards, wires and the note. */
async function recordsOf(path: string): Promise<string> {
  const io = nodeCommandIo();
  const [ground, asks, links, note] = await Promise.all([
    loadGround(path, io),
    loadAsks(path, io),
    loadGroundLinks(path, io),
    loadNote(path, "rain", io),
  ]);
  return [
    ...ground.references.map((reference) => reference.on),
    ...asks.asks.map((ask) => ask.on),
    ...links.links.map((link) => link.from + "->" + link.to),
    note === null ? "no note" : "note " + note.trim(),
  ].join("|");
}

function renderCard(props: {
  exchanges?: readonly CommandExchange[];
  view?: {
    kind: "acts";
    instruction: string;
    acts: readonly CommandAct[];
    question: null;
    undo?: ReturnType<typeof undoNote>;
  } | null;
}): string {
  return renderToStaticMarkup(
    createElement(CommandCard, {
      level: "ground",
      open: true,
      instruction: "",
      answer: "",
      exchanges: props.exchanges ?? [],
      dropped: false,
      view: props.view ?? null,
      busy: null,
      onOpen: () => {},
      onClose: () => {},
      onInstruction: () => {},
      onAnswer: () => {},
      onInterpret: () => {},
      onAnswerQuestion: () => {},
      onAccept: () => {},
      onRefuse: () => {},
    }),
  );
}

/** The note an accepted undo keeps, built the way App builds it. */
function undoNote(offer: CommandUndoOffer, instruction: string) {
  return {
    instruction,
    omitted: offer.omitted.map(actLine),
    bounded: offer.bounded,
  };
}

describe("a three-act script undoes in reverse order, as one script", () => {
  test("the offer is every inverse, last act first, and one apply takes all back", async () => {
    const path = freshWorkspace();
    const host = hostFor(path);
    const applied = await run(path, [CARD, WIRE, NOTE]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    // The exchange keeps the WHOLE script, not only its last act.
    const exchange = appliedExchange("do three things", applied.applied, null);
    expect(exchange.acts!.map((act) => act.act)).toEqual([
      "propose_card",
      "propose_wire",
      "propose_note",
    ]);
    expect(lastAppliedExchangeOf([exchange])).toBe(exchange);

    const offer = undoOfferOf("undo that", exchange);
    expect(offer).not.toBeNull();
    if (offer === null) return;
    // REVERSE ORDER: the note goes before the wire, the wire before the card.
    expect(offer.acts.map((act) => act.act)).toEqual([
      "propose_remove_note",
      "propose_unwire",
      "propose_remove_card",
    ]);
    expect(offer.omitted).toEqual([]);

    expect(await recordsOf(path)).toBe(
      "rain|soil|rain-gauge|rain->soil|note the gauge",
    );

    // ONE PRESS: the inverses are ONE script, applied once like any other.
    const undone = await run(path, offer.acts);
    expect(undone.ok).toBe(true);
    expect(await recordsOf(path)).toBe("rain|soil|no note");
    expect(existsSync(notePath(path, "rain-gauge"))).toBe(false);
  });

  test("undoScriptOf is the script of that offer, and reads-only acts are silent", () => {
    const read: CommandAct = {
      act: "read_card",
      map: "ground",
      payload: { card: "rain" },
    };
    // A read changed nothing, so it is neither undone nor named as undone.
    expect(undoScriptOf("undo that", [WIRE, read])).toEqual([
      {
        act: "propose_unwire",
        map: "ground",
        payload: { from: "rain", to: "soil" },
      },
    ]);
    // No applied act, no script.
    expect(undoScriptOf("undo that", null)).toBeNull();
    expect(undoScriptOf("wire rain to soil", [WIRE])).toBeNull();
  });
});

describe("a partial undo names what it will not take back", () => {
  test("an ask has no inverse, so the offer says so and still unwires", async () => {
    const path = freshWorkspace();
    // An ask always carries the question waiting unsent in its composer (the
    // ghost's own required draft), which is why it is a real change and not a
    // read — and why it is the act this story's partial undo has to name.
    const ask: CommandAct = {
      act: "propose_ask",
      map: "ground",
      payload: {
        name: "gauge question",
        x: 240,
        y: 120,
        question: "what does the rain gauge say?",
      },
    };
    const wire: CommandAct = {
      act: "propose_wire",
      map: "ground",
      payload: { from: "rain", to: "soil" },
    };
    const applied = await run(path, [ask, wire]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const exchange = appliedExchange("ask and wire", applied.applied, null);
    const offer = undoOfferOf("undo that", exchange);
    expect(offer).not.toBeNull();
    if (offer === null) return;

    // The unwire is offered; the ask is NAMED, never silently dropped.
    expect(offer.acts.map((act) => act.act)).toEqual(["propose_unwire"]);
    expect(offer.omitted.map(actLine)).toEqual([
      'add an ask card "gauge question"; put the question in it, unsent',
    ]);

    const note = undoNote(offer, "ask and wire");
    expect(undoLine(note)).toContain(COMMAND_UNDO_PARTIAL_PREFIX);
    expect(undoLine(note)).toContain('add an ask card "gauge question"');
    expect(undoLine(note)).toContain("put the question in it, unsent");
    expect(undoLine(note)).not.toBe(COMMAND_UNDO_COMPLETE_SENTENCE);

    // The card says it BEFORE the press, and still offers the one accept.
    const html = renderCard({
      view: {
        kind: "acts",
        instruction: "undo that",
        acts: offer.acts,
        question: null,
        undo: note,
      },
    });
    expect(html).toContain(COMMAND_UNDO_TAKES_BACK_LABEL + "ask and wire");
    expect(html).toContain(COMMAND_UNDO_PARTIAL_PREFIX);
    expect(html).toContain("add an ask card");
    expect(html).toContain(COMMAND_ACCEPT_VERB);

    // The rest still applies: the wire goes, the ask stays, and the exchange
    // that completes notes the act it could not take back.
    const undone = await run(path, offer.acts);
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(await recordsOf(path)).toBe(
      "rain|soil|gauge-question|no note",
    );
    const completed = appliedExchange(
      "undo that",
      undone.applied,
      null,
      note,
    );
    expect(completed.undo!.instruction).toBe("ask and wire");
    expect(completed.undo!.omitted).toEqual([
      'add an ask card "gauge question"; put the question in it, unsent',
    ]);
    const exchangeHtml = renderCard({ exchanges: [completed] });
    expect(exchangeHtml).toContain("took back: ask and wire");
    expect(exchangeHtml).toContain("not taken back: add an ask card");
  });

  test("a whole-script undo with nothing invertible is the one honest sentence", () => {
    // A removal's inverse needs the record's words or point, which the applied
    // act does not carry: no script, and the 21.5 sentence answers.
    const removedNote: CommandAct = {
      act: "propose_remove_note",
      map: "ground",
      payload: { card: "rain" },
    };
    const exchange = appliedExchange("remove the note", [removedNote], null);
    expect(undoOfferOf("undo that", exchange)).toBeNull();
    expect(undoScriptOf("undo that", exchange.acts!)).toBeNull();
    expect(undoSecondSentence("undo that", exchange)).toBeNull();
  });
});

describe("a second undo after an undo does not double-invert", () => {
  test("a partial restore of an undo is refused, with its own sentence", () => {
    const exchange = appliedExchange("do three things", [CARD, WIRE, NOTE], null);
    const first = undoOfferOf("undo that", exchange);
    expect(first).not.toBeNull();
    if (first === null) return;

    // The accept of the undo is an applied exchange like any other, and it
    // carries the note that says what it took back.
    const undoExchange = appliedExchange(
      "undo that",
      first.acts,
      null,
      undoNote(first, "do three things"),
    );
    expect(undoExchange.undo).toBeDefined();

    // A second undo would invert the undo's own acts. The card and the note
    // cannot be put back (their point and words are gone), so putting back
    // only the wire would point at a card that stayed removed: refused whole.
    expect(undoOfferOf("undo that", undoExchange)).toBeNull();
    expect(undoSecondSentence("undo that", undoExchange)).toBe(
      COMMAND_UNDO_SECOND_SENTENCE,
    );
    // The original script is never re-offered as a redo.
    expect(undoScriptOf("undo that", undoExchange.acts!)).not.toEqual(
      [CARD, WIRE, NOTE],
    );

    // The card answers with the sentence and offers nothing to accept.
    const second = nothingExchange(
      "undo that",
      null,
      COMMAND_UNDO_SECOND_SENTENCE,
    );
    const html = renderCard({ exchanges: [undoExchange, second] });
    expect(html).toContain(COMMAND_UNDO_SECOND_SENTENCE);
    expect(html).toContain("took back: do three things");
  });

  test("an undo that CAN be put back whole is offered, one generation on", () => {
    // Undoing a wire is an unwire; undoing the unwire is the wire again. The
    // existing pairing keeps working, and the second undo is offered.
    const wireUndo = appliedExchange(
      "undo that",
      [{ act: "propose_unwire", map: "ground", payload: { from: "rain", to: "soil" } }],
      null,
      { instruction: "wire rain to soil", omitted: [], bounded: false },
    );
    const second = undoOfferOf("undo that", wireUndo);
    expect(second).not.toBeNull();
    expect(second!.acts).toEqual([
      {
        act: "propose_wire",
        map: "ground",
        payload: { from: "rain", to: "soil" },
      },
    ]);
  });
});

describe("an unaccepted undo changes nothing", () => {
  test("the offer is view state; the map folder is untouched until the press", async () => {
    const path = freshWorkspace();
    const applied = await run(path, [CARD, WIRE, NOTE]);
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;

    const before = await recordsOf(path);
    const linksBefore = readFileSync(groundLinksPath(path), "utf8");
    const groundBefore = readFileSync(join(path, "map/ground.txt"), "utf8");

    const exchange = appliedExchange("do three things", applied.applied, null);
    const thread = appendExchange(EMPTY_COMMAND_THREAD, exchange);
    const offer = undoOfferOf("undo that", lastAppliedExchangeOf(thread.exchanges));
    expect(offer).not.toBeNull();
    // Building the offer, and rendering it, writes nothing.
    renderCard({
      view: {
        kind: "acts",
        instruction: "undo that",
        acts: offer!.acts,
        question: null,
        undo: undoNote(offer!, "do three things"),
      },
    });

    expect(await recordsOf(path)).toBe(before);
    expect(readFileSync(groundLinksPath(path), "utf8")).toBe(linksBefore);
    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toBe(groundBefore);
  });
});

describe("the applied script's act list is bounded, and said", () => {
  test("the tail is kept, the bound is flagged, and the undo says so", () => {
    const many: CommandAct[] = Array.from(
      { length: COMMAND_EXCHANGE_MAX_ACTS + 3 },
      (_, index) => ({
        act: "propose_note" as const,
        map: "ground" as const,
        payload: { card: "rain", note: "note " + index },
      }),
    );
    const exchange = appliedExchange("too much", many, null);
    expect(exchange.acts!.length).toBe(COMMAND_EXCHANGE_MAX_ACTS);
    expect(exchange.acts![0]).toEqual(
      many[many.length - COMMAND_EXCHANGE_MAX_ACTS]!,
    );
    expect(exchange.acts![exchange.acts!.length - 1]).toEqual(
      many[many.length - 1]!,
    );
    expect(exchange.actsBounded).toBe(true);

    const offer = undoOfferOf("undo that", exchange);
    expect(offer).not.toBeNull();
    if (offer === null) return;
    expect(offer.bounded).toBe(true);
    const note = undoNote(offer, "too much");
    expect(undoLine(note)).toContain(COMMAND_UNDO_BOUNDED_SENTENCE);
    expect(undoLine(note)).not.toBe(COMMAND_UNDO_COMPLETE_SENTENCE);
    // Never a count: the sentence is qualitative, like the conversation's.
    expect(COMMAND_UNDO_BOUNDED_SENTENCE).not.toMatch(/[0-9]/);
  });

  test("the complete offer says the whole script comes back, in reverse order", () => {
    const offer = undoOfferOf(
      "undo that",
      appliedExchange("do three things", [CARD, WIRE, NOTE], null),
    );
    expect(offer).not.toBeNull();
    if (offer === null) return;
    expect(undoLine(undoNote(offer, "do three things"))).toBe(
      COMMAND_UNDO_COMPLETE_SENTENCE,
    );
    expect(COMMAND_UNDO_COMPLETE_SENTENCE).toContain("reverse order");
    expect(COMMAND_UNDO_COMPLETE_SENTENCE).not.toMatch(/[0-9]/);
  });
});

describe("nothing new is recorded and nothing new can be said", () => {
  test("no new act, no counter, and the map draws none of it", () => {
    // STORY 21.10 adds no act: the undo is the vocabulary's own inverse script.
    expect(ACT_NAMES.some((name) => name.includes("undo"))).toBe(false);
    // The card's model is still view state, and the map still draws no card
    // content for any of it.
    expect(renderedMapContent("ground")).toEqual([]);
    expect(COMMAND_UNDO_SENTENCE).toBe(
      "there is no change here the app can take back, so nothing was applied.",
    );
  });
});
