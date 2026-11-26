import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  askTurnHistoryEvent,
  removeAskRecords,
  restoreAskCard,
  writeAskTurn,
  type AskRemovalIo,
  type AskRestoreIo,
} from "../src/canvas/useGround";
import {
  ASK_TURN_ENDINGS,
  appendEvents,
  appendedHistory,
  askAddEvent,
  askForkEvent,
  askReanchorEvent,
  askRemoveEvent,
  askRestoreEvent,
  askTurnEvent,
  historyPath,
  parseHistoryEvent,
  serializeHistoryEvent,
  type HistoryEvent,
} from "../src/map/history";
import {
  asksPath,
  askTurnPath,
  loadAskConversations,
  loadAsks,
  parseAskLine,
  restoreConversation,
  saveAsks,
  serializeAskLine,
  type AskCard,
  type AskIo,
} from "../src/map/asks";
import { serializeTurns, type AskTurn } from "../src/map/asks";
import {
  MIRROR_ASK_GONE,
  MIRROR_ASK_UNKNOWN,
  MIRROR_FILE,
  mirrorPath,
  mirrorAskLine,
  renderMirror,
  writeMirror,
  type MirrorView,
} from "../src/map/mirror";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { AskCard as AskCardView } from "../src/canvas/AskCard";
import { GroundLayer } from "../src/canvas/GroundLayer";
import { ASK_RESTORE_SENTENCE, RESTORE_SENTENCE } from "../src/canvas/GroundToast";
import {
  askCardInFlight,
  recordAskCardTurn,
  type AskContactDeps,
  type AskEnding,
} from "../src/contacts/ask";
import { parsePrisms } from "../src/map/prisms";
import type { GroundReference } from "../src/map/ground";
import type { Reading } from "../src/map/readings";

/**
 * STORY 17.8 — the map remembers asks.
 *
 * The story's check is human ("with two ask cards on the map, open MAP.md:
 * each is named with what it is about and a fork shows its parent; make an
 * anchor disappear and MAP.md says it is gone; delete an ask card: the toast
 * offers Restore and the history grows one line; restore it and another; search
 * both files for a sentence from any conversation: nothing"). This file pins
 * the rules underneath:
 *
 *   - the mirror's asks section: name, anchor (or the remembered name marked
 *     gone), the fork's parent — never a word, a count, a preview or a time;
 *   - the six structural history events and their closed ending pair, which is
 *     the PRISM's own outcome: one fact, two records that never disagree;
 *   - the turn's stated order: PRISM first, then the conversation line, then
 *     ask.turn (queued, never awaited);
 *   - the removal's capture-before-unlink and the Restore's SAME BYTES, proved
 *     by a whole-folder comparison;
 *   - a conversation whose card is gone is an ORPHAN: kept, named, never
 *     adopted and never deleted;
 *   - the no-words search over both files, over EVERY >=3-char token of a
 *     thread, and `renderedMapContent("ground")` still [].
 *
 * PROVISIONAL (the story's own note): the six event names and payloads, the
 * asks section's heading and format, the gone mark and the turn's ordering.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const HOOK = source("canvas/useGround.ts");
const APP = source("App.tsx");
const LAYER = source("canvas/GroundLayer.tsx");
const ASK_CARD = source("canvas/AskCard.tsx");
const TOAST = source("canvas/GroundToast.tsx");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-ask-memory-"));
afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const fsIo = {
  readTextFile: async (path: string): Promise<string | null> => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path: string, content: string): Promise<void> => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
  createDirAll: async (path: string): Promise<void> => {
    mkdirSync(path, { recursive: true });
  },
};

const askIo: AskIo = {
  ...fsIo,
  listDir: async (path: string): Promise<string[]> => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
};

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map", "asks"), { recursive: true });
  return path;
}

const RAIN: GroundReference = { on: "rain-gauge", name: "Rain gauge", x: 0, y: 0 };
const GONE = "a reference that is gone";

const Q1: AskCard = {
  on: "gauge-question",
  name: "Gauge question",
  x: 10,
  y: 10,
  anchor: "rain-gauge",
  anchorName: "Rain gauge",
};
const Q2: AskCard = {
  on: "bow-question",
  name: "Bow question",
  x: 20,
  y: 20,
  anchor: "rain-gauge",
  anchorName: "Rain gauge",
};
const FORK: AskCard = {
  on: "gauge-question-fork",
  name: "Gauge question fork",
  x: 30,
  y: 30,
  anchor: "rain-gauge",
  anchorName: "Rain gauge",
  from: "gauge-question",
  carry: 2,
};
const LOST: AskCard = {
  on: "lost-question",
  name: "Lost question",
  x: 40,
  y: 40,
  anchor: "gone-card",
  anchorName: "the old gauge",
};
const LOST_UNNAMED: AskCard = {
  on: "nameless-question",
  name: "Nameless question",
  x: 50,
  y: 50,
  anchor: "gone-card",
};

const THREAD: AskTurn[] = [
  { role: "person", text: "quasar lantern meadow", t: "2026-11-18T12:00:00.000Z" },
  {
    role: "answer",
    text: "pixel zephyr orchard",
    t: "2026-11-18T12:00:01.000Z",
    move: "prism-1",
  },
];

/** Every >=3-character token of the thread's words (the hard constraint). */
function threadTokens(): string[] {
  const tokens = new Set<string>();
  for (const turn of THREAD) {
    for (const token of turn.text.split(/\s+/)) {
      if (token.length >= 3) tokens.add(token);
    }
  }
  return [...tokens];
}

/** A deterministic view: references, asks and nothing conversational. */
function viewOf(asks: readonly AskCard[], over: Partial<MirrorView> = {}): MirrorView {
  return {
    references: [RAIN],
    readings: [],
    texts: {},
    states: {},
    notes: {},
    orphanNotes: [],
    orphanMedia: [],
    links: [],
    orphanLinks: [],
    malformedGround: [],
    malformedReadings: [],
    malformedLinks: [],
    asks,
    malformedAsks: [],
    orphanAskTurns: [],
    // STORY 18.5: these tests are about the asks; the sessions section is empty.
    sessions: [],
    sessionToolNames: {},
    sessionEndings: {},
    orphanSessionTranscripts: [],
    ...over,
  };
}

/* ========================================================================= *
 * 1. The mirror's asks section.
 * ========================================================================= */

describe("MAP.md's asks section: what it is, what it is about, no words", () => {
  test("one line per card: the name, the anchor, the fork's parent", () => {
    const text = renderMirror(viewOf([Q1, FORK, LOST]));
    expect(text).toContain("## Asks");
    expect(text).toContain("Gauge question — about Rain gauge");
    expect(text).toContain(
      "Gauge question fork — about Rain gauge; forked from Gauge question",
    );
    // A gone anchor is SAID with the remembered name and the mark.
    expect(text).toContain("Lost question — about the old gauge" + MIRROR_ASK_GONE);
    // One line per card, never a block with a state or a preview.
    expect(text.match(/^### /gm)?.length ?? 0).toBe(1); // only the reference
    expect(text).not.toContain("turns");
    expect(text).not.toContain("preview");
    expect(text).not.toContain("last turn");
  });

  test("the record's own order is the section's order", () => {
    const forward = renderMirror(viewOf([Q1, Q2]));
    const backward = renderMirror(viewOf([Q2, Q1]));
    expect(forward.indexOf("Gauge question —")).toBeLessThan(
      forward.indexOf("Bow question —"),
    );
    expect(backward.indexOf("Bow question —")).toBeLessThan(
      backward.indexOf("Gauge question —"),
    );
  });

  test("sections keep their fixed order: references, asks, links, unknowns", () => {
    const text = renderMirror(viewOf([Q1]));
    expect(text.indexOf("## References")).toBeLessThan(text.indexOf("## Asks"));
    expect(text.indexOf("## Asks")).toBeLessThan(text.indexOf("## Links"));
    expect(text.indexOf("## Links")).toBeLessThan(text.indexOf("## What is unknown"));
  });

  test("an empty asks section says none yet, with no count", () => {
    const text = renderMirror(viewOf([]));
    const section = text.slice(text.indexOf("## Asks"), text.indexOf("## Links"));
    expect(section).toContain("none yet.");
    expect(section).not.toMatch(/\b\d+\b/);
  });

  test("a card that never remembered a name says the generic phrase, marked", () => {
    const text = renderMirror(viewOf([LOST_UNNAMED]));
    expect(text).toContain(
      "Nameless question — about " + MIRROR_ASK_UNKNOWN + MIRROR_ASK_GONE,
    );
  });

  test("a fork of a parent that is gone is marked the same way", () => {
    const orphanFork: AskCard = {
      on: "orphan-fork",
      name: "Orphan fork",
      x: 1,
      y: 1,
      anchor: "rain-gauge",
      anchorName: "Rain gauge",
      from: "a-parent-that-is-gone",
      carry: 1,
    };
    const text = renderMirror(viewOf([orphanFork]));
    expect(text).toContain(
      "Orphan fork — about Rain gauge; forked from a-parent-that-is-gone" +
        MIRROR_ASK_GONE,
    );
  });

  test("the line builder is pure and reproducible", () => {
    expect(mirrorAskLine(Q1, "Rain gauge", null)).toBe(
      "Gauge question — about Rain gauge",
    );
    expect(mirrorAskLine(LOST, null, null)).toBe(
      "Lost question — about the old gauge (gone)",
    );
    expect(renderMirror(viewOf([Q1, Q2]))).toBe(renderMirror(viewOf([Q1, Q2])));
  });

  test("unreadable ask lines and orphan conversations are unknowns", () => {
    const text = renderMirror(
      viewOf([Q1], {
        malformedAsks: ["a line that is not an ask"],
        orphanAskTurns: ["ghost-ask"],
      }),
    );
    expect(text).toContain("unreadable line in asks.txt: a line that is not an ask");
    expect(text).toContain(
      "a conversation with no ask card, kept in map/asks/ghost-ask.jsonl",
    );
  });
});

/* ========================================================================= *
 * 2. The six history events.
 * ========================================================================= */

describe("the history's six ask events: structural, closed, append-only", () => {
  const events: HistoryEvent[] = [
    askAddEvent(1, "gauge-question", "rain-gauge"),
    askForkEvent(2, "gauge-question-fork", "gauge-question", 2),
    askReanchorEvent(3, "gauge-question-fork", "bow"),
    askTurnEvent(4, "gauge-question", "answered"),
    askRemoveEvent(5, "gauge-question"),
    askRestoreEvent(6, "gauge-question"),
  ];

  test("every event round-trips through one canonical line", () => {
    for (const event of events) {
      const line = serializeHistoryEvent(event);
      expect(parseHistoryEvent(line)).toEqual(event);
    }
    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "ask.add",
      "ask.fork",
      "ask.reanchor",
      "ask.turn",
      "ask.remove",
      "ask.restore",
    ]);
  });

  test("the turn's ending is the closed pair the PRISM uses", () => {
    expect(ASK_TURN_ENDINGS).toEqual(["answered", "no-response"]);
    for (const ending of ASK_TURN_ENDINGS) {
      const event = askTurnEvent(1, "gauge-question", ending);
      expect(parseHistoryEvent(serializeHistoryEvent(event))).toEqual(event);
    }
    // An ending outside the pair is not guessed into an event: the line stays
    // preserved and reported (the family posture).
    const bad = serializeHistoryEvent(askTurnEvent(1, "q", "answered")).replace(
      '"answered"',
      '"stopped"',
    );
    expect(parseHistoryEvent(bad)).toBeNull();
  });

  test("the payloads hold no slot for a word, a preview or a content size", () => {
    const allowed: Record<string, string[]> = {
      "ask.add": ["v", "t", "type", "slug", "anchor"],
      "ask.remove": ["v", "t", "type", "slug"],
      "ask.restore": ["v", "t", "type", "slug"],
      "ask.reanchor": ["v", "t", "type", "slug", "anchor"],
      "ask.fork": ["v", "t", "type", "slug", "from", "carry"],
      "ask.turn": ["v", "t", "type", "slug", "ending"],
    };
    for (const event of events) {
      const line = serializeHistoryEvent(event);
      expect(Object.keys(JSON.parse(line)).sort()).toEqual(
        allowed[(event as { type: string }).type]!.slice().sort(),
      );
    }
  });

  test("the append is after the earlier bytes, never a rewrite", () => {
    const before = serializeHistoryEvent(askAddEvent(1, "a", "rain")) + "\n";
    const append = appendedHistory(before, [
      askTurnEvent(2, "a", "answered"),
      askRemoveEvent(3, "a"),
    ]);
    expect(append.text.startsWith(before)).toBe(true);
    const lines = append.text.trimEnd().split("\n");
    expect(JSON.parse(lines[lines.length - 2]).type).toBe("ask.turn");
    expect(JSON.parse(lines[lines.length - 1]).type).toBe("ask.remove");
    // A malformed line already in the file is a prefix, never touched.
    const hand = before + "{hand edit\n";
    const nextAppend = appendedHistory(hand, [askRestoreEvent(4, "a")]);
    expect(nextAppend.text.startsWith(hand)).toBe(true);
    expect(nextAppend.text.trimEnd().split("\n").slice(-2)).toEqual([
      "{hand edit",
      serializeHistoryEvent(askRestoreEvent(4, "a")),
    ]);
  });
});

/* ========================================================================= *
 * 3. The ending agreement: ask.turn's ending IS the PRISM's outcome.
 * ========================================================================= */

function contactDeps(): { deps: AskContactDeps; prisms: () => string } {
  let text: string | null = null;
  let minted = 0;
  return {
    deps: {
      copy: async () => true,
      handOff: async () => {},
      canonicalize: async (path: string) => path,
      readPrismsText: async () => text,
      writePrismsText: async (next: string) => {
        text = next;
      },
      mintId: () => "prism-" + (minted += 1),
    },
    prisms: () => text ?? "",
  };
}

describe("one ending, two records that never disagree", () => {
  const cases: { ending: AskEnding; outcome: "answered" | "no-response" }[] = [
    { ending: "answered", outcome: "answered" },
    { ending: "stopped", outcome: "no-response" },
    { ending: "failed", outcome: "no-response" },
    { ending: "timed-out", outcome: "no-response" },
  ];

  for (const { ending, outcome } of cases) {
    test("a " + ending + " turn logs " + outcome + ", exactly as its PRISM says", async () => {
      const { deps, prisms } = contactDeps();
      const moved = await recordAskCardTurn(
        askCardInFlight("/w", {
          on: "gauge-question",
          anchor: "rain-gauge",
          included: null,
        }),
        ending,
        ending === "answered" ? "pixel zephyr orchard" : null,
        deps,
      );
      const parsed = parsePrisms(prisms());
      expect(parsed.prisms.length).toBe(1);
      const change = parsed.prisms[0]!.changes[0]!;
      if (change.kind !== "ask") throw new Error("not an ask change");
      const event = askTurnHistoryEvent(1, "gauge-question", ending, moved.prism);
      if (event === null || event.type !== "ask.turn") {
        throw new Error("no ask.turn event");
      }
      // THE SAME FACT, SAID TWICE.
      expect(event.ending).toBe(change.outcome);
      expect(event.ending).toBe(outcome);
      // And no word of the response can be in the history's line.
      const line = serializeHistoryEvent(event);
      for (const token of ["pixel", "zephyr", "orchard"]) {
        expect(line).not.toContain(token);
      }
    });
  }

  test("a turn that never left the app made no Move and gets no line", () => {
    expect(askTurnHistoryEvent(1, "gauge-question", "failed", null)).toBeNull();
  });
});

/* ========================================================================= *
 * 4. The turn's stated order: PRISM, the words, then ask.turn.
 * ========================================================================= */

describe("the turn's order is a stated contract", () => {
  test("the PRISM lands first, then the conversation names its id, then ask.turn", async () => {
    const order: string[] = [];
    const { deps } = contactDeps();
    const logging: AskContactDeps = {
      ...deps,
      writePrismsText: async (next: string) => {
        order.push("prism");
        await deps.writePrismsText(next);
      },
    };
    const moved = await recordAskCardTurn(
      askCardInFlight("/w", {
        on: "gauge-question",
        included: null,
      }),
      "answered",
      "pixel zephyr orchard",
      logging,
    );
    const workspace = freshWorkspace();
    order.length = 0;
    // The real writeAskTurn order, with the Move logged and the words going
    // through the real append-only conversation writer.
    const written = await writeAskTurn(
      workspace,
      "gauge-question",
      null,
      "quasar lantern meadow",
      {
        result: { kind: "answer", text: "pixel zephyr orchard" },
        ending: "answered",
        left: true,
        reached: null,
        missed: null,
      },
      {
        appendMove: async () => {
          order.push("prism");
          return moved.prism;
        },
        appendExchange: async (w, slug, question, answer, _io, now, move) => {
          order.push("conversation");
          const asks = await import("../src/map/asks");
          return asks.appendExchange(w, slug, question, answer, askIo, now, move);
        },
      },
    );
    expect(order).toEqual(["prism", "conversation"]);
    // The conversation names the Move's id on the ANSWER line only.
    expect(written.turns.length).toBe(2);
    expect(written.turns[1]!.move).toBe(moved.prism.id);
    expect(written.turns[0]!.move).toBeUndefined();
    // Then the history line, formed from the same ending the PRISM recorded.
    const historyEvent = askTurnHistoryEvent(
      7,
      "gauge-question",
      "answered",
      written.prism,
    )!;
    expect(historyEvent.type).toBe("ask.turn");
    if (historyEvent.type !== "ask.turn") throw new Error("unreachable");
    expect(historyEvent.ending).toBe("answered");
  });

  test("the hook queues ask.turn AFTER writeAskTurn, and never awaits it", () => {
    const start = HOOK.indexOf("const askTurn = useCallback");
    const next = HOOK.indexOf("\n  const askStop = useCallback", start);
    const body = HOOK.slice(start, next === -1 ? HOOK.length : next);
    const writeAt = body.indexOf("await writeAskTurn(");
    const historyAt = body.indexOf("askTurnHistoryEvent(");
    expect(writeAt).toBeGreaterThan(-1);
    expect(historyAt).toBeGreaterThan(writeAt);
    expect(body).not.toContain("await queueHistory");
    // STORY 17.10: the FIRST question may rename an Untitled ask (a mirror
    // BEFORE the send). STORY 17.11: a COMPLETED turn now makes a reference
    // card, so a mirror follows that card's add — never a line describing the
    // turn. The ask record still adds nothing MAP.md speaks about.
    const mirrorAt = body.indexOf("queueMirror(", writeAt);
    expect(mirrorAt).toBeGreaterThan(writeAt);
    expect(body.slice(writeAt, mirrorAt)).toContain("await writeDistilledCard(");
  });
});

/* ========================================================================= *
 * 5. Removal and Restore: capture first, same bytes back.
 * ========================================================================= */

function saveAsksFs(
  workspace: string,
  asks: readonly AskCard[],
  malformed: readonly string[],
): Promise<void> {
  return saveAsks(workspace, asks, malformed, askIo);
}

const removalIo: AskRemovalIo = {
  saveAsks: saveAsksFs,
  readTextFile: fsIo.readTextFile,
  removeFile: async (path) => {
    unlinkSync(path);
  },
};
const restoreIo: AskRestoreIo = {
  saveAsks: saveAsksFs,
  restoreConversation: (workspace, slug, bytes) =>
    restoreConversation(workspace, slug, bytes, askIo),
};

function folderState(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(dir: string, prefix: string): void {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      const rel = prefix === "" ? name : prefix + "/" + name;
      if (statSync(path).isDirectory()) walk(path, rel);
      else out[rel] = readFileSync(path, "utf8");
    }
  }
  walk(root, "");
  return out;
}

describe("an ask card is removable, with the same reversible promise", () => {
  test("the delete reads the line and the conversation BEFORE the unlink", async () => {
    const workspace = freshWorkspace();
    writeFileSync(asksPath(workspace), [Q1, Q2].map(serializeAskLine).join("\n") + "\n", "utf8");
    writeFileSync(askTurnPath(workspace, Q1.on), serializeTurns(THREAD), "utf8");
    const result = await removeAskRecords(
      workspace,
      Q1.on,
      [Q1, Q2],
      [],
      removalIo,
    );
    expect(result.refusal).toBeNull();
    expect(result.removed).not.toBeNull();
    expect(result.removed!.ask).toEqual(Q1);
    expect(result.removed!.conversation).toBe(serializeTurns(THREAD));
    // The record is gone and so is the file; the OTHER card is untouched.
    expect(existsSync(askTurnPath(workspace, Q1.on))).toBe(false);
    expect(readFileSync(asksPath(workspace), "utf8")).toBe(
      serializeAskLine(Q2) + "\n",
    );
  });

  test("Restore writes the SAME BYTES: the whole folder compares identical", async () => {
    const workspace = freshWorkspace();
    writeFileSync(asksPath(workspace), [Q1, Q2, FORK].map(serializeAskLine).join("\n") + "\n", "utf8");
    // A hand-edited, malformed line proves the writer never re-serializes.
    writeFileSync(
      askTurnPath(workspace, Q1.on),
      serializeTurns(THREAD) + "{a hand line\n",
      "utf8",
    );
    const before = folderState(workspace);
    const removal = await removeAskRecords(
      workspace,
      Q1.on,
      [Q1, Q2, FORK],
      [],
      removalIo,
    );
    expect(folderState(workspace)).not.toEqual(before);
    const restored = await restoreAskCard(
      workspace,
      removal.removed!,
      removal.asks,
      [],
      restoreIo,
    );
    expect(restored.refusal).toBeNull();
    expect(restored.restoredAsk).toBe(true);
    expect(restored.cameBack).toEqual(["the conversation", "the ask card"]);
    // THE WHOLE FOLDER, byte for byte — the restored line sits where it sat.
    expect(folderState(workspace)).toEqual(before);
  });

  test("a card with no conversation restores none and invents nothing", async () => {
    const workspace = freshWorkspace();
    writeFileSync(asksPath(workspace), serializeAskLine(Q1) + "\n", "utf8");
    const removal = await removeAskRecords(workspace, Q1.on, [Q1], [], removalIo);
    expect(removal.removed!.conversation).toBeNull();
    const restored = await restoreAskCard(
      workspace,
      removal.removed!,
      removal.asks,
      [],
      restoreIo,
    );
    expect(restored.cameBack).toEqual(["the ask card"]);
    expect(existsSync(askTurnPath(workspace, Q1.on))).toBe(false);
  });

  test("the toast says which card went, and one toast holds both kinds", () => {
    expect(RESTORE_SENTENCE).toBe("this reference was removed");
    expect(ASK_RESTORE_SENTENCE).toBe("this ask card was removed");
    expect(APP).toContain("ground.restorableAsk");
    expect(APP).toContain("ASK_RESTORE_SENTENCE");
    // One pending of either kind: each delete clears the other.
    const removeBlock = HOOK.slice(
      HOOK.indexOf("const remove = useCallback"),
      HOOK.indexOf("const link = useCallback"),
    );
    expect(removeBlock).toContain("restorableAskRef.current = null");
    const removeAskBlock = HOOK.slice(
      HOOK.indexOf("const removeAsk = useCallback"),
      HOOK.indexOf("const askTurn = useCallback"),
    );
    expect(removeAskBlock).toContain("restorableRef.current = null");
  });

  test("the verbs are wired: the card, the layer, the app", () => {
    expect(ASK_CARD).toContain("onRemove");
    // STORY 25-15: the remove verb is its own strip key now — ground-remove.
    expect(ASK_CARD).toContain('className="ground-remove"');
    expect(ASK_CARD).toContain('label="remove"');
    expect(LAYER).toContain("onRemoveAsk");
    expect(LAYER).toContain("onRemoveAsk(ask.on)");
    expect(APP).toContain("onRemoveAsk={ground.removeAsk}");
  });

  test("an ask card renders its remove verb", () => {
    const html = renderToStaticMarkup(
      createElement(AskCardView, {
        ask: Q1,
        anchorName: "Rain gauge",
        turns: [],
        open: true,
        previewLines: 4,
        onOpen: () => {},
        onClose: () => {},
        onRemove: async () => ({ ok: true }),
      }),
    );
    // STORY 25-15: the remove key is a VerbBubble on the strip — its class,
    // and its word in the tip.
    expect(html).toContain('class="verb-key ground-remove"');
    expect(html).toContain('class="verb-tip">remove</span>');
  });
});

/* ========================================================================= *
 * 6. A conversation whose card is gone is an ORPHAN.
 * ========================================================================= */

describe("an orphan conversation is reported, never adopted and never deleted", () => {
  test("the load names it and leaves the bytes exactly where they are", async () => {
    const workspace = freshWorkspace();
    writeFileSync(asksPath(workspace), serializeAskLine(Q1) + "\n", "utf8");
    writeFileSync(askTurnPath(workspace, Q1.on), serializeTurns(THREAD), "utf8");
    const ghost = askTurnPath(workspace, "ghost-ask");
    const ghostText = serializeTurns(THREAD) + "{hand\n";
    writeFileSync(ghost, ghostText, "utf8");

    const loaded = await loadAskConversations(workspace, [Q1.on], askIo);
    expect(loaded.orphans).toEqual(["ghost-ask"]);
    // Never adopted into a card.
    const cards = await loadAsks(workspace, askIo);
    expect(cards.asks.map((ask) => ask.on)).toEqual([Q1.on]);
    // Never deleted, never rewritten.
    expect(readFileSync(ghost, "utf8")).toBe(ghostText);

    // And it is SAID in the mirror's unknowns.
    const text = renderMirror(viewOf(cards.asks, { orphanAskTurns: loaded.orphans }));
    expect(text).toContain(
      "a conversation with no ask card, kept in map/asks/ghost-ask.jsonl",
    );
    // The notices group names it too.
    expect(APP).toContain("orphanAskTurns");
    expect(APP).toContain("a conversation for “{slug}” has no ask card");
  });

  test("a dangling anchor is said in the mirror, never repaired", () => {
    const text = renderMirror(viewOf([LOST]));
    expect(text).toContain("about the old gauge (gone)");
    // The record itself is untouched: the anchor slug stays as written.
    expect(LOST.anchor).toBe("gone-card");
    expect(text).not.toContain(GONE);
  });
});

/* ========================================================================= *
 * 7. The no-words search, over both files, over EVERY >=3-char token.
 * ========================================================================= */

describe("no conversation text in either memory file", () => {
  test("every >=3-char token of a thread is absent from MAP.md and the history", async () => {
    const workspace = freshWorkspace();
    // A real map: one reference, three ask cards, a fork and a thread.
    writeFileSync(asksPath(workspace), [Q1, Q2, FORK].map(serializeAskLine).join("\n") + "\n", "utf8");
    writeFileSync(askTurnPath(workspace, Q1.on), serializeTurns(THREAD), "utf8");
    writeFileSync(askTurnPath(workspace, FORK.on), serializeTurns(THREAD.slice(0, 1)), "utf8");

    // MAP.md, the real writer.
    const loaded = await loadAsks(workspace, askIo);
    const view = viewOf(loaded.asks, { references: [RAIN] });
    await writeMirror(workspace, renderMirror(view), fsIo);

    // The history, the real append-only writer: every ask move of the story.
    const events = [
      askAddEvent(1, Q1.on, "rain-gauge"),
      askForkEvent(2, FORK.on, Q1.on, 1),
      askTurnEvent(3, Q1.on, "answered"),
      askTurnEvent(4, Q1.on, "no-response"),
      askReanchorEvent(5, Q2.on, "rain-gauge"),
      askRemoveEvent(6, Q1.on),
      askRestoreEvent(7, Q1.on),
    ];
    await appendEvents(workspace, events, fsIo);

    const mapText = readFileSync(mirrorPath(workspace), "utf8");
    const logText = readFileSync(historyPath(workspace), "utf8");
    const tokens = threadTokens();
    expect(tokens.length).toBe(6);
    for (const token of tokens) {
      expect({ token, inMap: mapText.includes(token) }).toEqual({
        token,
        inMap: false,
      });
      expect({ token, inLog: logText.includes(token) }).toEqual({
        token,
        inLog: false,
      });
    }
    // The SAME files do name the structure (a positive control: the search is
    // not passing because the files are empty).
    expect(mapText).toContain("Gauge question — about Rain gauge");
    expect(logText).toContain("\"type\":\"ask.add\"");
    expect(logText).toContain("\"ending\":\"answered\"");
    // The conversation itself still holds every word, verbatim.
    expect(readFileSync(askTurnPath(workspace, Q1.on), "utf8")).toContain(
      "quasar lantern meadow",
    );
    // The ask cards render no map content off their own game (unchanged).
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("the mirror's view never carries a turn at all", () => {
    const view = viewOf([Q1]);
    expect(Object.keys(view).sort()).not.toContain("askTurns");
    expect(renderMirror(view)).not.toContain("quasar");
  });
});
