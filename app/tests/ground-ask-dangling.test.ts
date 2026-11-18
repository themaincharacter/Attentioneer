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
  ASK_EMPTY_SENTENCE,
  AskCard,
  askDanglingLine,
  askKindLine,
} from "../src/canvas/AskCard";
import { GroundLayer } from "../src/canvas/GroundLayer";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  askAnchorOf,
  removeGroundRecords,
  restoreGroundCard,
  writeAskCard,
  writeAskTurn,
  type AskTurnWriteIo,
  type GroundRemovalIo,
  type GroundRestoreIo,
} from "../src/canvas/useGround";
import {
  appendExchange,
  askTurnPath,
  forkAsk,
  loadAsks,
  loadTurns,
  parseAskLine,
  parseAsks,
  reanchorAsk,
  saveAsks,
  serializeAskLine,
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
import {
  groundPath,
  loadGround,
  saveGround,
  type GroundIo,
  type GroundReference,
} from "../src/map/ground";
import { parsePrisms, type Prism } from "../src/map/prisms";
import { readingsPath, saveReadings, type ReadingIo } from "../src/map/readings";
import {
  assembleAskCardPacket,
  type AskPacketCard,
} from "../src/turn/packet";

/**
 * STORY 17.6 — A DANGLING ANCHOR IS SAID, NOT REPAIRED.
 *
 * The story's check is human ("delete the reference an ask card is about;
 * reopen: the card says its anchor is gone, naming what it was, the thread
 * still reads and can still send; re-anchor it: the sentence clears; restore the
 * deleted card: the sentence clears by itself"). This file pins the rules
 * underneath it:
 *
 *   - the record gains ONE optional tail, \`anchorName\` — the name the anchor had
 *     when the person bound it — and a card without it writes its old line bytes;
 *   - the remembered name is inherited by a fork and kept in step by a re-anchor;
 *   - the view resolves a gone anchor to "gone" WITH the remembered name, never
 *     to a replacement card;
 *   - the card states it in ONE quiet line (no error state, no red, no modal),
 *     the thread still reads, and send is still there;
 *   - a send with a gone anchor still makes its PRISM with \`included: null\`;
 *   - deleting the reference writes NOTHING to asks.txt or the conversation;
 *   - restoring the reference clears the sentence as a consequence — still with
 *     no repair write.
 *
 * PROVISIONAL: the remembered-name field and its position, and the sentence's
 * wording and place.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-ask-dangling-"));
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

const groundIo: GroundIo = {
  readTextFile: askIo.readTextFile,
  writeTextFile: askIo.writeTextFile,
};

const readingIo: ReadingIo = {
  ...groundIo,
  readTextHead: async () => ({
    head: "",
    truncated: false,
    exists: false,
    size: null,
    mtime: null,
    decode: "clean",
  }),
  createDirAll: askIo.createDirAll,
  fileMeta: async () => ({
    kind: "facts",
    exists: false,
    is_file: false,
    len: 0,
    modified_ms: 0,
  }),
  readFileBytes: async () => ({ kind: "refused", code: "cannot-reach" }),
  pdfText: async () => {
    throw new Error("no pdf here");
  },
};

function freshWorkspace(): string {
  return mkdtempSync(join(ROOT, "workspace-"));
}

const REFERENCE: GroundReference = {
  on: "rain-gauge",
  name: "Rain gauge",
  x: 40,
  y: 60,
};
const OTHER: GroundReference = { on: "old-well", name: "Old well", x: 400, y: 60 };

function turn(role: "person" | "answer", text: string): AskTurn {
  return { role, text, t: TAKEN };
}

/** The anchor's packet facts: name only, no previews (the block's shape). */
function anchorFacts(name: string): AskPacketCard {
  return { name, state: null, reading: null, note: null };
}

/** One conversation file's bytes, or "" when the file is absent. */
function conversationBytes(workspace: string, slug: string): string {
  try {
    return readFileSync(askTurnPath(workspace, slug), "utf8");
  } catch {
    return "";
  }
}

/** asks.txt's exact bytes. */
function asksBytes(workspace: string): string {
  return readFileSync(join(workspace, "map", "asks.txt"), "utf8");
}

/** The one ask card every test starts from, written the way the app writes it. */
async function seedAsk(workspace: string): Promise<AskCardRecord> {
  await saveGround(workspace, [REFERENCE, OTHER], [], groundIo);
  const written = await writeAskCard(
    workspace,
    [REFERENCE, OTHER],
    [],
    [],
    REFERENCE.on,
    "Rain gauge question",
    360,
    60,
    { saveAsks: (ws, asks, malformed) => saveAsks(ws, asks, malformed, askIo) },
  );
  await appendExchange(
    workspace,
    written.ask.on,
    "which harbor keeps the lantern lit",
    "the northern pier",
    askIo,
    () => TAKEN,
  );
  return written.ask;
}

/** The delete's real bridges (the same files, on disk). */
const removalIo: GroundRemovalIo = {
  saveGround: (workspace, references, malformed) =>
    saveGround(workspace, references, malformed, groundIo),
  saveReadings: (workspace, readings, malformed) =>
    saveReadings(workspace, readings, malformed, readingIo),
  removeFile: async (path) => rmSync(path, { force: true }),
  readTextFile: askIo.readTextFile,
};

/**
 * The restore's bridges. This ask's anchor has no reading, no note, no picture
 * and no links, so the only write Restore makes here is the ground line; the
 * other bridges are stubs that would fail loudly if that changed.
 */
const restoreIo: GroundRestoreIo = {
  saveGround: (workspace, references, malformed) =>
    saveGround(workspace, references, malformed, groundIo),
  saveReadings: async () => {
    throw new Error("this card has no reading");
  },
  saveGroundLinks: async () => {
    throw new Error("this card has no links");
  },
  saveMedia: async () => {
    throw new Error("this card has no media");
  },
  restoreReadingText: async () => {
    throw new Error("this card has no reading text");
  },
  restoreNote: async () => {
    throw new Error("this card has no note");
  },
  restoreThumb: async () => {
    throw new Error("this card has no picture");
  },
};

/** Render the layer the way the app mounts it, over loaded records. */
function renderLayer(
  references: readonly GroundReference[],
  asks: readonly AskCardRecord[],
  askTurns: Readonly<Record<string, readonly AskTurn[]>>,
): string {
  return renderToStaticMarkup(
    createElement(GroundLayer, {
      references,
      readings: [],
      texts: {},
      states: {},
      asks,
      askTurns,
      onMove: async () => ({ ok: true }),
      onRefresh: async () => ({ ok: true }),
      onRepoint: async () => ({ ok: true }),
      onRemove: async () => ({ ok: true }),
    }),
  );
}

describe("the record remembers the name the anchor had", () => {
  const ASK: AskCardRecord = {
    on: "rain-gauge-question",
    name: "Rain gauge question",
    x: 360,
    y: 60,
    anchor: "rain-gauge",
    anchorName: "Rain gauge",
  };

  test("anchorName rides LAST and round-trips byte-exactly", () => {
    expect(parseAskLine(serializeAskLine(ASK))).toEqual(ASK);
    expect(serializeAskLine(ASK)).toBe(
      "on: rain-gauge-question | name: Rain gauge question | x: 360 | y: 60 | anchor: rain-gauge | anchorName: Rain gauge",
    );
    // A fork keeps its pair and appends the remembered name after it.
    const forked: AskCardRecord = {
      ...ASK,
      on: "fork",
      from: "rain-gauge-question",
      carry: 2,
    };
    expect(parseAskLine(serializeAskLine(forked))).toEqual(forked);
    expect(serializeAskLine(forked)).toContain(
      "| from: rain-gauge-question | carry: 2 | anchorName: Rain gauge",
    );
  });

  test("a card without a remembered name writes the old line byte for byte", () => {
    const plain: AskCardRecord = {
      on: "rain-gauge-question",
      name: "Rain gauge question",
      x: 360,
      y: 60,
      anchor: "rain-gauge",
    };
    expect(serializeAskLine(plain)).toBe(
      "on: rain-gauge-question | name: Rain gauge question | x: 360 | y: 60 | anchor: rain-gauge",
    );
  });

  test("an empty remembered name is out of shape: preserved, never guessed", () => {
    const empty =
      "on: a | name: A | x: 1 | y: 2 | anchor: rain-gauge | anchorName:  ";
    const parsed = parseAsks(empty + "\n");
    expect(parsed.asks).toEqual([]);
    expect(parsed.malformed).toEqual([empty]);
    // The name is stored verbatim, spaces and all, when it is a name.
    const spaced: AskCardRecord = {
      on: "a",
      name: "A",
      x: 1,
      y: 2,
      anchor: "rain-gauge",
      anchorName: "Rain  gauge",
    };
    expect(parseAskLine(serializeAskLine(spaced))).toEqual(spaced);
  });

  test("creation remembers the anchor's name; a source not on the map stays unnamed", async () => {
    const workspace = freshWorkspace();
    await saveGround(workspace, [REFERENCE], [], groundIo);
    const written = await writeAskCard(
      workspace,
      [REFERENCE],
      [],
      [],
      REFERENCE.on,
      "Rain gauge question",
      360,
      60,
      { saveAsks: (ws, asks, malformed) => saveAsks(ws, asks, malformed, askIo) },
    );
    expect(written.ask.anchorName).toBe("Rain gauge");
    expect(readFileSync(join(workspace, "map", "asks.txt"), "utf8")).toContain(
      "anchorName: Rain gauge",
    );
    // A card made about a card the map does not carry writes no invented name.
    const dangling = await writeAskCard(
      workspace,
      [],
      written.asks,
      [],
      "a-card-that-went",
      "Gone question",
      10,
      20,
      { saveAsks: (ws, asks, malformed) => saveAsks(ws, asks, malformed, askIo) },
    );
    expect(dangling.ask.anchorName).toBeUndefined();
  });

  test("a fork inherits it; a re-anchor keeps it in step with the new anchor", () => {
    const parent: AskCardRecord = {
      on: "rain-gauge-question",
      name: "Rain gauge question",
      x: 360,
      y: 60,
      anchor: "rain-gauge",
      anchorName: "Rain gauge",
    };
    const forked = forkAsk(
      [parent],
      sharedSlugs([REFERENCE], [parent]),
      parent,
      2,
      "Another question",
      680,
      60,
    );
    expect(forked.ask.anchorName).toBe("Rain gauge");
    // The re-anchor writes the name of the card it is NOW about.
    const moved = reanchorAsk([forked.ask], forked.ask.on, "old-well", "Old well");
    expect(moved).not.toBeNull();
    expect(moved![0]!.anchor).toBe("old-well");
    expect(moved![0]!.anchorName).toBe("Old well");
    // Without a new name the stale one is not left claiming the new anchor.
    const unnamed = reanchorAsk([forked.ask], forked.ask.on, "old-well");
    expect(unnamed![0]!.anchorName).toBeUndefined();
  });
});

describe("the view resolves a gone anchor with the name it had", () => {
  const ASK: AskCardRecord = {
    on: "rain-gauge-question",
    name: "Rain gauge question",
    x: 360,
    y: 60,
    anchor: "rain-gauge",
    anchorName: "Rain gauge",
  };

  test("present: the live name; gone: gone WITH the remembered name", () => {
    expect(askAnchorOf(ASK, [REFERENCE])).toEqual({
      name: "Rain gauge",
      gone: false,
      remembered: "Rain gauge",
    });
    expect(askAnchorOf(ASK, [OTHER])).toEqual({
      name: null,
      gone: true,
      remembered: "Rain gauge",
    });
    // No replacement is looked for, and nothing is invented.
    expect(askAnchorOf(ASK, []).name).toBeNull();
  });

  test("an older card with no remembered name says so honestly", () => {
    const legacy: AskCardRecord = {
      on: "old",
      name: "Old",
      x: 0,
      y: 0,
      anchor: "rain-gauge",
    };
    expect(askAnchorOf(legacy, []).remembered).toBeNull();
    expect(askDanglingLine(null)).toBe(
      "this was about a card that is not here; it is gone.",
    );
  });
});

describe("the card says it in ONE quiet line, named", () => {
  const ASK: AskCardRecord = {
    on: "rain-gauge-question",
    name: "Rain gauge question",
    x: 360,
    y: 60,
    anchor: "rain-gauge",
    anchorName: "Rain gauge",
  };
  const threads: AskTurn[] = [
    turn("person", "which harbor keeps the lantern lit"),
    turn("answer", "the northern pier"),
  ];

  test("the line names what it was about, above the thread, with no error state", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: ASK,
        anchorName: null,
        turns: threads,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onAskTurn: async () => ({ ok: true }),
        onReanchor: async () => ({ ok: true }),
        anchorChoices: [{ slug: OTHER.on, name: OTHER.name }],
      }),
    );
    expect(html).toContain(askDanglingLine("Rain gauge"));
    expect(html).toContain("this was about Rain gauge; that card is gone");
    expect(html).not.toContain(askKindLine("Rain gauge"));
    // The thread still reads top to bottom, the words untouched.
    expect(html.indexOf("which harbor keeps the lantern lit")).toBeLessThan(
      html.indexOf("the northern pier"),
    );
    // It can still send, and re-anchoring is offered.
    expect(html).toContain("ask-card-send");
    expect(html).toContain("ask-card-reanchor");
    // One quiet line, never an error, a colour or a modal.
    expect(html).not.toContain("ask-card-problem");
    expect(html).not.toMatch(/error|danger|red|modal/i);
    // No counts or timestamps ride the sentence.
    expect(askDanglingLine("Rain gauge")).not.toMatch(/\d/);
  });

  test("a re-anchored card clears the line and names the new card", () => {
    const moved = reanchorAsk([ASK], ASK.on, OTHER.on, OTHER.name)![0]!;
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: moved,
        anchorName: OTHER.name,
        turns: threads,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain(askKindLine("Old well"));
    expect(html).not.toContain(askDanglingLine("Rain gauge"));
  });

  test("the small face states it too — the sentence is not hidden in the body", () => {
    const html = renderToStaticMarkup(
      createElement(AskCard, {
        ask: ASK,
        anchorName: null,
        turns: threads,
        open: false,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain("this was about Rain gauge; that card is gone");
    expect(html).not.toContain(ASK_EMPTY_SENTENCE);
  });
});

describe("a gone anchor still sends, and its PRISM records the null inclusion", () => {
  test("the packet composes with the thread and no anchor block", () => {
    const packet = assembleAskCardPacket(
      anchorFacts("rain-gauge"),
      [turn("person", "who mends the copper wire")],
      "and the wire?",
    );
    expect(packet.messages).toHaveLength(1);
    expect(packet.text).toContain("who mends the copper wire");
    expect(packet.text).toContain("## the conversation so far");
  });

  test("the sending turn writes its Move with included: null and touches no ask line", async () => {
    const workspace = freshWorkspace();
    const ask = await seedAsk(workspace);
    const asksBefore = asksBytes(workspace);
    const conversationBefore = conversationBytes(workspace, ask.on);

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
      ask.on,
      ask.anchor,
      null,
      "does the gauge still read",
      {
        result: { kind: "answer", text: "it rusted shut" },
        ending: "answered",
        left: true,
      },
      io,
    );
    expect(wrote.prism).not.toBeNull();
    const prisms: Prism[] = parsePrisms(before!).prisms;
    expect(prisms).toHaveLength(1);
    const change = prisms[0]!.changes[0]!;
    expect(change.kind).toBe("ask");
    if (change.kind === "ask") {
      expect(change.anchor).toBe("rain-gauge");
      expect(change.included).toBeNull();
      expect(change.outcome).toBe("answered");
    }
    // The words went to the conversation; the ask line was not rewritten.
    expect(conversationBytes(workspace, ask.on)).not.toBe(conversationBefore);
    expect(conversationBytes(workspace, ask.on)).toContain("it rusted shut");
    expect(asksBytes(workspace)).toBe(asksBefore);
  });
});

describe("delete says it, restore clears it, and neither repairs anything", () => {
  test("the thread bytes and the ask line survive both moves unchanged", async () => {
    const workspace = freshWorkspace();
    const ask = await seedAsk(workspace);
    const asksBefore = asksBytes(workspace);
    const conversationBefore = conversationBytes(workspace, ask.on);

    // THE DELETE (the reference's own records only — asks are never read).
    const ground = await loadGround(workspace, groundIo);
    const removal = await removeGroundRecords(
      workspace,
      REFERENCE.on,
      ground.references,
      [],
      [],
      [],
      removalIo,
    );
    expect(removal.refusal).toBeNull();
    expect(removal.removed).not.toBeNull();

    // A REOPEN: the load, then the layer the app mounts.
    const groundGone = await loadGround(workspace, groundIo);
    const asksGone = await loadAsks(workspace, askIo);
    const turnsGone = await loadTurns(workspace, ask.on, askIo);
    expect(asksGone.asks).toEqual([ask]);
    expect(asksGone.asks[0]!.anchorName).toBe("Rain gauge");
    const htmlGone = renderLayer(groundGone.references, asksGone.asks, {
      [ask.on]: turnsGone.turns,
    });
    expect(htmlGone).toContain("this was about Rain gauge; that card is gone");
    // NOT REPAIRED: the field still names the deleted card's slug, both files
    // are byte-identical, and the conversation was never touched.
    expect(asksGone.asks[0]!.anchor).toBe(REFERENCE.on);
    expect(asksBytes(workspace)).toBe(asksBefore);
    expect(conversationBytes(workspace, ask.on)).toBe(conversationBefore);
    expect(readFileSync(join(workspace, "map", "asks.txt"), "utf8")).toContain(
      "anchor: rain-gauge",
    );

    // THE RESTORE writes the ground line back and nothing else.
    const restored = await restoreGroundCard(
      workspace,
      removal.removed!,
      groundGone.references,
      [],
      [],
      [],
      [],
      [],
      [],
      [],
      restoreIo,
    );
    expect(restored.refusal).toBeNull();
    expect(restored.restoredReference).toBe(true);

    const groundBack = await loadGround(workspace, groundIo);
    const asksBack = await loadAsks(workspace, askIo);
    const htmlBack = renderLayer(groundBack.references, asksBack.asks, {
      [ask.on]: turnsGone.turns,
    });
    // CLEARED BY CONSEQUENCE: the anchor resolves again, so the sentence is
    // simply not true any more. No repair wrote anything.
    expect(htmlBack).not.toContain("this was about Rain gauge; that card is gone");
    expect(htmlBack).toContain("a question about Rain gauge");
    expect(asksBytes(workspace)).toBe(asksBefore);
    expect(conversationBytes(workspace, ask.on)).toBe(conversationBefore);
    expect(readFileSync(groundPath(workspace), "utf8")).toContain(
      "on: rain-gauge",
    );
    expect(readFileSync(readingsPath(workspace), "utf8").trim()).toBe("");
  });

  test("re-anchoring clears it too, without writing a thread byte", async () => {
    const workspace = freshWorkspace();
    const ask = await seedAsk(workspace);
    const conversationBefore = conversationBytes(workspace, ask.on);
    await removeGroundRecords(
      workspace,
      REFERENCE.on,
      (await loadGround(workspace, groundIo)).references,
      [],
      [],
      [],
      removalIo,
    );
    const asksGone = await loadAsks(workspace, askIo);
    const moved = reanchorAsk(
      asksGone.asks,
      ask.on,
      OTHER.on,
      OTHER.name,
    )!;
    await saveAsks(workspace, moved, asksGone.malformed, askIo);
    const asksBack = await loadAsks(workspace, askIo);
    const html = renderLayer(
      [OTHER],
      asksBack.asks,
      { [ask.on]: (await loadTurns(workspace, ask.on, askIo)).turns },
    );
    expect(html).toContain("a question about Old well");
    expect(html).not.toContain("that card is gone");
    expect(asksBack.asks[0]!.anchor).toBe(OTHER.on);
    expect(asksBack.asks[0]!.anchorName).toBe("Old well");
    expect(conversationBytes(workspace, ask.on)).toBe(conversationBefore);
  });

  test("the ground map still renders no concept content", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
