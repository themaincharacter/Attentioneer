import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ASK_FORK_DIVIDER,
  ASK_FORK_MISSING,
  AskCard,
} from "../src/canvas/AskCard";
import {
  askThreadOf,
  reanchorRefusal,
  writeAskTurn,
  writeForkAsk,
  type AskTurnWriteIo,
} from "../src/canvas/useGround";
import {
  ASK_MISSING_REFUSAL,
  ASK_SOURCE_REFUSAL,
  addAsk,
  appendExchange,
  askTurnPath,
  carriedTurns,
  forkAsk,
  forkThread,
  isFork,
  loadAsks,
  loadTurns,
  parseAskLine,
  parseAsks,
  proposeForkName,
  reanchorAsk,
  saveAsks,
  serializeAskLine,
  serializeAsks,
  sharedSlugs,
  type AskCard as AskCardRecord,
  type AskIo,
  type AskTurn,
} from "../src/map/asks";
import {
  askCardInFlight,
  recordAskCardTurn,
  type AskContactDeps,
} from "../src/contacts/ask";
import type { GroundReference } from "../src/map/ground";
import {
  parsePrisms,
  type Prism,
} from "../src/map/prisms";
import {
  ASK_PACKET_THREAD_OMITTED,
  assembleAskCardPacket,
  type AskPacketCard,
} from "../src/turn/packet";

/**
 * STORY 17.5 — A FORK IS A BRANCH, NOT A DUPLICATE.
 *
 * The story's check is human ("fork a two-turn ask at its first answer, ask
 * something different in the fork: both cards read correctly; delete the
 * parent: the fork says its earlier turns are gone and its own still read;
 * re-anchor the fork: the next answer is about that card"). This file pins the
 * rules underneath it:
 *
 *   - the record gains ONE optional tail (`from`/`carry`), and a card that was
 *     not forked writes byte-identically to story 17.1;
 *   - a fork INHERITS the anchor, is placed beside its parent and mints its own
 *     slug in the shared space;
 *   - NO COPY: the fork's file holds only its own turns, the parent's file is
 *     untouched, and the prefix is READ from the parent at render/send time;
 *   - a missing parent is STATED in one line, the fork's own turns still read,
 *     and its packet still composes (it can still send);
 *   - ONE BOUND, ON THE WHOLE COMPOSED THREAD (carried + own), never per part;
 *   - RE-ANCHORING changes ONE field; a target that is gone refuses with one
 *     sentence; and the next packet names the new anchor;
 *   - a fork's sending turn is its own Move: the PRISM's `on` is the fork's
 *     slug and its Change names the fork's own anchor;
 *   - ONE LEVEL: a fork of a fork carries the second card's own turns only.
 *
 * PROVISIONAL: the field names and positions, the divider and missing-parent
 * wording, and the one-level answer.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-ask-fork-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const TAKEN = "2026-11-18T12:00:00.000Z";

const askIo: AskIo = {
  readTextFile: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path, content) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
  createDirAll: async (path) => {
    mkdirSync(path, { recursive: true });
  },
};

function freshWorkspace(): string {
  return mkdtempSync(join(ROOT, "workspace-"));
}

const GAUGE: GroundReference = {
  on: "rain-gauge",
  name: "Rain gauge",
  x: 0,
  y: 0,
};
const WELL: GroundReference = {
  on: "old-well",
  name: "Old well",
  x: 0,
  y: 0,
};

function turn(role: "person" | "answer", text: string): AskTurn {
  return { role, text, t: TAKEN };
}

/** Read one card's conversation bytes, or "" when the file is absent. */
function conversationBytes(workspace: string, slug: string): string {
  try {
    return readFileSync(askTurnPath(workspace, slug), "utf8");
  } catch {
    return "";
  }
}

/** The anchor's packet facts: name only, no previews (the block's shape). */
function anchorFacts(name: string): AskPacketCard {
  return { name, state: null, reading: null, note: null };
}

describe("the record: from/carry is one optional tail", () => {
  test("a fork round-trips line-exactly and the pair always travels together", () => {
    const fork: AskCardRecord = {
      on: "rain-gauge-question-fork",
      name: "Rain gauge question fork",
      x: 680,
      y: 60,
      anchor: "rain-gauge",
      from: "rain-gauge-question",
      carry: 2,
    };
    expect(isFork(fork)).toBe(true);
    expect(parseAskLine(serializeAskLine(fork))).toEqual(fork);
    expect(serializeAskLine(fork)).toBe(
      "on: rain-gauge-question-fork | name: Rain gauge question fork | x: 680 | y: 60 | anchor: rain-gauge | from: rain-gauge-question | carry: 2",
    );
  });

  test("a card that was not forked writes the story-17.1 line byte for byte", () => {
    const plain: AskCardRecord = {
      on: "rain-gauge-question",
      name: "Rain gauge question",
      x: 360,
      y: 60,
      anchor: "rain-gauge",
    };
    expect(isFork(plain)).toBe(false);
    expect(serializeAskLine(plain)).toBe(
      "on: rain-gauge-question | name: Rain gauge question | x: 360 | y: 60 | anchor: rain-gauge",
    );
  });

  test("half a fork is malformed: preserved and reported, never guessed", () => {
    const fromOnly =
      "on: a | name: A | x: 1 | y: 2 | anchor: rain-gauge | from: parent";
    const carryOnly =
      "on: b | name: B | x: 1 | y: 2 | anchor: rain-gauge | carry: 2";
    const badCount =
      "on: c | name: C | x: 1 | y: 2 | anchor: rain-gauge | from: parent | carry: -1";
    const parsed = parseAsks([fromOnly, carryOnly, badCount].join("\n"));
    expect(parsed.asks).toEqual([]);
    expect(parsed.malformed).toEqual([fromOnly, carryOnly, badCount]);
    // A preserved line is never dropped by a write.
    expect(serializeAsks([], parsed.malformed)).toBe(
      [fromOnly, carryOnly, badCount].join("\n") + "\n",
    );
  });
});

describe("a fork inherits the anchor and mints its own slug", () => {
  test("forkAsk copies the anchor, names the parent, and carries whole turns", () => {
    const parent: AskCardRecord = {
      on: "rain-gauge-question",
      name: "Rain gauge question",
      x: 360,
      y: 60,
      anchor: "rain-gauge",
    };
    const taken = sharedSlugs([GAUGE], [parent]);
    const made = forkAsk([parent], taken, parent, 2, "Another question", 680, 60);
    expect(made.ask).toEqual({
      on: "another-question",
      name: "Another question",
      x: 680,
      y: 60,
      anchor: "rain-gauge",
      from: "rain-gauge-question",
      carry: 2,
    });
    // The parent's own line is untouched: one card in, one card untouched.
    expect(made.asks[0]).toEqual(parent);
    expect(made.asks).toHaveLength(2);
  });

  test("the fork's name dedupes against BOTH files (the shared slug space)", () => {
    const parent: AskCardRecord = {
      on: "rain-gauge-question",
      name: "Rain gauge question",
      x: 360,
      y: 60,
      anchor: "rain-gauge",
    };
    const taken = sharedSlugs([GAUGE], [parent]);
    const made = forkAsk([parent], taken, parent, 1, "Rain gauge question", 680, 60);
    expect(made.ask.on).toBe("rain-gauge-question-2");
  });

  test("the proposed fork name is the parent's words plus the noun", () => {
    expect(proposeForkName("Rain gauge question")).toBe(
      "Rain gauge question fork",
    );
    expect(proposeForkName("   ")).toBe("a fork");
  });
});

describe("NO COPY: the prefix is read from the parent", () => {
  test("writing a fork and its own turn leaves the parent's file byte-identical", async () => {
    const workspace = freshWorkspace();
    // The parent card and its two turns (one exchange).
    const parent: AskCardRecord = {
      on: "rain-gauge-question",
      name: "Rain gauge question",
      x: 360,
      y: 60,
      anchor: "rain-gauge",
    };
    await saveAsks(workspace, [parent], [], askIo);
    const asksBefore = readFileSync(join(workspace, "map", "asks.txt"), "utf8");
    const parentTurns = await appendExchange(
      workspace,
      parent.on,
      "which harbor keeps the lantern lit",
      "the northern pier",
      askIo,
      () => TAKEN,
    );
    expect(parentTurns).toHaveLength(2);
    const parentBytes = conversationBytes(workspace, parent.on);

    // The fork: ONE record line, then ONE own turn. No parent bytes are read,
    // copied or written by either write.
    const made = await writeForkAsk(
      workspace,
      [GAUGE],
      [parent],
      [],
      parent.on,
      2,
      "Another question",
      680,
      60,
      { saveAsks: (ws, asks, malformed) => saveAsks(ws, asks, malformed, askIo) },
    );
    expect(made).not.toBeNull();
    const fork = made!.ask;
    const wrote = await writeAskTurn(
      workspace,
      fork.on,
      fork.anchor,
      null,
      "who mends the copper wire",
      {
        result: { kind: "answer", text: "a patient tinker" },
        ending: "answered",
        left: true,
      },
      {
        appendExchange: (ws, slug, q, a, _io, _now, move = null) =>
          appendExchange(ws, slug, q, a, askIo, () => TAKEN, move),
        appendMove: async (): Promise<Prism> => ({
          id: "prism-x",
          on: fork.on,
          contact: "ask",
          pointer: null,
          changes: [],
          explanation: "",
          extra: {},
        }),
      },
    );
    expect(wrote.turns).toHaveLength(2);

    // THE PARENT'S FILE IS UNTOUCHED — bytes, not a summary.
    expect(conversationBytes(workspace, parent.on)).toBe(parentBytes);
    // THE FORK'S FILE HOLDS ONLY ITS OWN TURNS.
    const forkBytes = conversationBytes(workspace, fork.on);
    expect(forkBytes).toContain("who mends the copper wire");
    expect(forkBytes).toContain("a patient tinker");
    expect(forkBytes).not.toContain("which harbor keeps the lantern lit");
    expect(forkBytes).not.toContain("the northern pier");
    // asks.txt gained ONE line; the parent's line is a prefix of the new file.
    const asksAfter = readFileSync(join(workspace, "map", "asks.txt"), "utf8");
    expect(asksAfter.startsWith(asksBefore)).toBe(true);
    expect(asksAfter.trim().split("\n")).toHaveLength(2);

    // A REOPEN composes the prefix from the PARENT's file.
    const reopenedAsks = await loadAsks(workspace, askIo);
    const reopenedTurns = {
      [parent.on]: (await loadTurns(workspace, parent.on, askIo)).turns,
      [fork.on]: (await loadTurns(workspace, fork.on, askIo)).turns,
    };
    const composed = askThreadOf(
      reopenedAsks.asks.find((entry) => entry.on === fork.on)!,
      reopenedAsks.asks,
      reopenedTurns,
    );
    expect(composed.missing).toBe(false);
    expect(composed.carried).toEqual(parentTurns);
    expect(composed.turns.map((entry) => entry.text)).toEqual([
      "which harbor keeps the lantern lit",
      "the northern pier",
      "who mends the copper wire",
      "a patient tinker",
    ]);
  });
});

describe("one level: a fork of a fork carries the second card's own turns", () => {
  test("the parent's carried prefix is never resolved transitively", () => {
    const P: AskCardRecord = {
      on: "p",
      name: "P",
      x: 0,
      y: 0,
      anchor: "rain-gauge",
    };
    const F: AskCardRecord = {
      on: "f",
      name: "F",
      x: 320,
      y: 0,
      anchor: "rain-gauge",
      from: "p",
      carry: 2,
    };
    const FF: AskCardRecord = {
      on: "ff",
      name: "FF",
      x: 640,
      y: 0,
      anchor: "rain-gauge",
      from: "f",
      carry: 1,
    };
    const parentTurns: AskTurn[] = [
      turn("person", "P first"),
      turn("answer", "P answer"),
    ];
    const forkTurns: AskTurn[] = [turn("person", "F first")];
    const forkForkTurns: AskTurn[] = [turn("person", "FF first")];
    const turns = { p: parentTurns, f: forkTurns, ff: forkForkTurns };

    // The fork reads P's two turns...
    expect(forkThread(F, forkTurns, parentTurns).turns.map((t) => t.text)).toEqual([
      "P first",
      "P answer",
      "F first",
    ]);
    // ...and FF reads F's OWN turn only: P is one branch back.
    const answered = askThreadOf(FF, [P, F, FF], turns);
    expect(answered.missing).toBe(false);
    expect(answered.carried).toEqual(forkTurns);
    expect(answered.turns.map((t) => t.text)).toEqual(["F first", "FF first"]);
    expect(answered.turns.map((t) => t.text)).not.toContain("P first");
  });

  test("carriedTurns is a prefix by count, whole turns only", () => {
    const parent = [
      turn("person", "one"),
      turn("answer", "two"),
      turn("person", "three"),
    ];
    expect(carriedTurns(2, parent).map((t) => t.text)).toEqual(["one", "two"]);
    expect(carriedTurns(99, parent)).toEqual(parent);
    expect(carriedTurns(0, parent)).toEqual([]);
    expect(carriedTurns(-2, parent)).toEqual([]);
    expect(carriedTurns(2, null)).toEqual([]);
  });
});

describe("a missing parent is stated, never repaired", () => {
  const FORK: AskCardRecord = {
    on: "orphan-fork",
    name: "Orphan fork",
    x: 680,
    y: 60,
    anchor: "rain-gauge",
    from: "a-card-that-is-gone",
    carry: 4,
  };
  const own: AskTurn[] = [turn("person", "who mends the copper wire")];

  test("the fork's own turns read, and the missing parent is a flag", () => {
    const view = askThreadOf(FORK, [FORK], { [FORK.on]: own });
    expect(view.missing).toBe(true);
    expect(view.carried).toEqual([]);
    expect(view.turns).toEqual(own);
  });

  test("the expanded card shows ONE quiet line and its own turn; no error", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: FORK,
        anchorName: "Rain gauge",
        turns: own,
        carried: 0,
        forkMissing: true,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onForkTurn: async () => ({ ok: true }),
      }),
    );
    expect(html).toContain(ASK_FORK_MISSING);
    expect(html).toContain("who mends the copper wire");
    expect(html).not.toContain(ASK_FORK_DIVIDER);
    // The verb is still there: the fork can still fork at its own turn.
    expect(html).toContain("ask-turn-fork");
  });

  test("it can still send: the composed thread makes a full packet", () => {
    const view = askThreadOf(FORK, [FORK], { [FORK.on]: own });
    const packet = assembleAskCardPacket(
      anchorFacts("Rain gauge"),
      view.turns,
      "and the wire?",
    );
    expect(packet.messages).toHaveLength(1);
    expect(packet.text).toContain("who mends the copper wire");
    expect(packet.text).toContain("## the conversation so far");
    expect(packet.declaration.blocks.some((block) => block.kind === "thread")).toBe(
      true,
    );
  });
});

describe("the ONE bound applies to the WHOLE composed thread", () => {
  test("carried + own are bounded together, newest whole turns only", () => {
    const parent: AskTurn[] = [];
    for (let at = 1; at <= 10; at += 1) {
      parent.push(turn(at % 2 === 1 ? "person" : "answer", "carried " + at));
    }
    const own: AskTurn[] = [
      turn("person", "own question"),
      turn("answer", "own answer"),
    ];
    const FORK: AskCardRecord = {
      on: "fork",
      name: "Fork",
      x: 0,
      y: 0,
      anchor: "rain-gauge",
      from: "parent",
      carry: 10,
    };
    const composed = forkThread(FORK, own, parent).turns;
    expect(composed).toHaveLength(12);

    // The story's own bound is 8/4 KiB; a TIGHTER stated bound makes the
    // whole-thread arithmetic legible: three turns from the END of the whole.
    const packet = assembleAskCardPacket(
      anchorFacts("Rain gauge"),
      composed,
      "next?",
      { turns: 3, bytes: 4096 },
    );
    const thread = packet.blocks.find((block) => block.kind === "thread")!;
    expect(thread.text).toContain("carried 10");
    expect(thread.text).toContain("own question");
    expect(thread.text).toContain("own answer");
    expect(thread.text).not.toContain("carried 1\n");
    expect(thread.text).not.toContain("carried 9");
    expect(thread.text).toContain(ASK_PACKET_THREAD_OMITTED);
  });
});

describe("re-anchoring is ONE field's change", () => {
  const FORK: AskCardRecord = {
    on: "fork",
    name: "Fork",
    x: 680,
    y: 60,
    anchor: "rain-gauge",
    from: "parent",
    carry: 2,
  };
  const OTHER: AskCardRecord = {
    on: "other",
    name: "Other",
    x: 0,
    y: 0,
    anchor: "rain-gauge",
  };

  test("only the anchor changes; the name, point, words and branch point stay", () => {
    const next = reanchorAsk([FORK, OTHER], FORK.on, "old-well")!;
    const changed = next.find((entry) => entry.on === FORK.on)!;
    expect(changed).toEqual({ ...FORK, anchor: "old-well" });
    expect(changed.from).toBe("parent");
    expect(changed.carry).toBe(2);
    expect(next.find((entry) => entry.on === OTHER.on)).toEqual(OTHER);
    // The serialized file changes ONE line, and only its anchor field.
    const before = serializeAsks([FORK, OTHER]);
    const after = serializeAsks(next);
    expect(after.split("\n")[1]).toBe(before.split("\n")[1]);
    expect(after.split("\n")[0]).toBe(
      serializeAskLine({ ...FORK, anchor: "old-well" }),
    );
  });

  test("a target that is already gone refuses with ONE sentence", () => {
    expect(reanchorRefusal([FORK], ["rain-gauge"], FORK.on, "old-well")).toBe(
      ASK_SOURCE_REFUSAL,
    );
    expect(reanchorRefusal([FORK], [], "no-such-card", "rain-gauge")).toBe(
      ASK_MISSING_REFUSAL,
    );
    expect(reanchorRefusal([FORK], [GAUGE.on, WELL.on], FORK.on, "old-well")).toBe(
      null,
    );
  });

  test("the next packet names the NEW anchor, and the fork still carries", () => {
    const next = reanchorAsk([FORK], FORK.on, "old-well")!;
    const moved = next[0]!;
    // The hook's own lookup: find the reference the card names NOW.
    const anchor = [GAUGE, WELL].find((entry) => entry.on === moved.anchor)!;
    const view = askThreadOf(moved, [moved], {
      [FORK.on]: [turn("person", "own question")],
    });
    const packet = assembleAskCardPacket(
      anchorFacts(anchor.name),
      view.turns,
      "and now?",
    );
    expect(anchor.name).toBe("Old well");
    expect(packet.text).toContain("## Old well");
    expect(packet.text).not.toContain("## Rain gauge");
  });
});

describe("the fork's turn is its OWN Move", () => {
  test("the PRISM's on is the fork's slug and its Change names the fork's anchor", async () => {
    const workspace = freshWorkspace();
    const FORK: AskCardRecord = {
      on: "fork",
      name: "Fork",
      x: 680,
      y: 60,
      anchor: "old-well",
      from: "parent",
      carry: 2,
    };
    let before: string | null = null;
    let minted = 0;
    const deps: AskContactDeps = {
      copy: async () => true,
      handOff: async () => {},
      canonicalize: async (path) => path,
      readPrismsText: async () => before,
      writePrismsText: async (text) => {
        before = text;
      },
      mintId: () => {
        minted += 1;
        return "prism-" + minted;
      },
    };
    const io: AskTurnWriteIo = {
      appendExchange: (ws, slug, q, a, _io, _now, move = null) =>
        appendExchange(ws, slug, q, a, askIo, () => TAKEN, move),
      appendMove: async (ws, on, anchor, included, ending, answer) => {
        const moved = await recordAskCardTurn(
          askCardInFlight(ws, { on, anchor, included }),
          ending,
          answer,
          deps,
        );
        return moved.prism;
      },
    };
    const wrote = await writeAskTurn(
      workspace,
      FORK.on,
      FORK.anchor,
      null,
      "the well's water",
      {
        result: { kind: "answer", text: "cold and clear" },
        ending: "answered",
        left: true,
      },
      io,
    );
    expect(wrote.prism).not.toBeNull();
    const prisms: Prism[] = parsePrisms(before!).prisms;
    expect(prisms).toHaveLength(1);
    expect(prisms[0]!.on).toBe("fork");
    const change = prisms[0]!.changes[0]!;
    expect(change.kind).toBe("ask");
    if (change.kind === "ask") {
      expect(change.anchor).toBe("old-well");
      expect(change.pointer).toBeNull();
      expect(change.included).toBeNull();
      expect(change.outcome).toBe("answered");
    }
  });
});

describe("the fork's face: carried turns, ONE divider, own turns", () => {
  const FORK: AskCardRecord = {
    on: "fork",
    name: "Fork",
    x: 680,
    y: 60,
    anchor: "rain-gauge",
    from: "parent",
    carry: 2,
  };
  const composed: AskTurn[] = [
    turn("person", "carried question"),
    turn("answer", "carried answer"),
    turn("person", "own question"),
  ];

  test("the thread renders carried then divider then own, in order", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: FORK,
        anchorName: "Rain gauge",
        turns: composed,
        carried: 2,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onForkTurn: async () => ({ ok: true }),
      }),
    );
    expect(html).toContain("carried question");
    expect(html).toContain("carried answer");
    expect(html).toContain("own question");
    expect(html.indexOf("carried question")).toBeLessThan(
      html.indexOf("carried answer"),
    );
    expect(html.indexOf("carried answer")).toBeLessThan(
      html.indexOf(ASK_FORK_DIVIDER),
    );
    expect(html.indexOf(ASK_FORK_DIVIDER)).toBeLessThan(
      html.indexOf("own question"),
    );
    // One line, never a count: the divider carries no digits.
    expect(ASK_FORK_DIVIDER).not.toMatch(/\d/);
  });

  test("the fork verb sits on the card's OWN turns, never on a carried one", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: FORK,
        anchorName: "Rain gauge",
        turns: composed,
        carried: 2,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onForkTurn: async () => ({ ok: true }),
      }),
    );
    // Two carried turns, one own turn: exactly one fork verb.
    expect((html.match(/ask-turn-fork/g) ?? []).length).toBe(1);
  });

  test("a non-fork renders exactly its own turns and no fork furniture", () => {
    const PLAIN: AskCardRecord = {
      on: "plain",
      name: "Plain",
      x: 0,
      y: 0,
      anchor: "rain-gauge",
    };
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: PLAIN,
        anchorName: "Rain gauge",
        turns: [turn("person", "just a question")],
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("just a question");
    expect(html).not.toContain(ASK_FORK_DIVIDER);
    expect(html).not.toContain(ASK_FORK_MISSING);
  });
});
