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
import { fileURLToPath } from "node:url";
import {
  askContextInclusion,
  askEndingOf,
  writeAskTurn,
  type AskTurnSend,
  type AskTurnWriteIo,
} from "../src/canvas/useGround";
import { pointerKey } from "../src/map/pointers";
import {
  CHANGE_KEYS,
  CHANGE_KINDS,
  CHANGE_OPTIONAL_KEYS,
  PRISM_KEYS,
  parsePrismChange,
  parsePrisms,
  type Prism,
} from "../src/map/prisms";
import {
  appendExchange,
  askTurnPath,
  loadTurns,
  parseTurnLine,
  type AskIo,
  type AskTurn,
} from "../src/map/asks";
import {
  askCardInFlight,
  recordAskCardTurn,
  type AskContactDeps,
} from "../src/contacts/ask";
import type { Reading } from "../src/map/readings";

/**
 * STORY 17.4 — every sending turn is a Move.
 *
 * The story's check is human ("send two questions, stop a third: three lines —
 * two answered, one no-response — and not one word of the thread in any of
 * them"). This file pins the rules underneath it:
 *
 *   - ONE PRISM per SENDING turn, counted as appended lines, not call sites;
 *   - the ending forms the record, exactly as 15.7b settled: a completed turn
 *     answers with the exact byte size and decode, and a stop, a break or a
 *     timeout is the existing no-response with null size and decode, even with
 *     a partial visible on the card;
 *   - the ask Change names the anchor by slug, rides no pointer, and the
 *     inclusion set is the anchor's natural key (or null when there is none);
 *   - NO WORD of any question, answer or partial reaches the PRISM;
 *   - the answer line names the Move's id, the person's line never does, and a
 *     stopped turn writes no answer line at all;
 *   - a draft writes nothing, and a turn that never left the app is no Move.
 *
 * PROVISIONAL (the story's own note): the anchor field and the turn's move
 * field, and the order the two writes land in.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const HOOK = source("canvas/useGround.ts");
const ASK_CARD = source("canvas/AskCard.tsx");
const ASK = "gauge-question";
const ANCHOR = "rain-gauge";
const INCLUDED = [pointerKey(ANCHOR, "path", "notes/gauge.md")];

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-ask-moves-"));
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

interface Harness {
  /** The bridges writeAskTurn is handed: the Move, then the words. */
  io: AskTurnWriteIo;
  /** Every PRISM line the Ask machinery appended, in order. */
  prisms: () => Prism[];
  /** How many times the PRISM file was written. */
  writes: () => number;
}

/**
 * The wiring's own path with the Tauri files replaced by memory: the Move goes
 * through contacts/ask.ts's real commit (its size, decode, outcome and closed
 * keys), and the words through the real append-only conversation writer.
 */
function harness(): Harness {
  let before: string | null = null;
  let writes = 0;
  let minted = 0;
  const deps: AskContactDeps = {
    copy: async () => true,
    handOff: async () => {},
    canonicalize: async (path) => path,
    readPrismsText: async () => before,
    writePrismsText: async (text) => {
      before = text;
      writes += 1;
    },
    mintId: () => {
      minted += 1;
      return "prism-" + minted;
    },
  };
  const io: AskTurnWriteIo = {
    appendExchange: (workspace, slug, question, answer, _io, _now, move = null) =>
      appendExchange(
        workspace,
        slug,
        question,
        answer,
        askIo,
        () => TAKEN,
        move,
      ),
    appendMove: async (workspacePath, on, included, ending, answer) => {
      const moved = await recordAskCardTurn(
        askCardInFlight(workspacePath, { on, included }),
        ending,
        answer,
        deps,
      );
      return moved.prism;
    },
  };
  return {
    io,
    prisms: () => (before === null ? [] : parsePrisms(before).prisms),
    writes: () => writes,
  };
}

function answered(text: string): AskTurnSend {
  return {
    result: { kind: "answer", text },
    ending: "answered",
    left: true,
    reached: null,
    missed: null,
  };
}

function stopped(sentence: string): AskTurnSend {
  return {
    result: { kind: "failed", sentence },
    ending: "stopped",
    left: true,
    reached: null,
    missed: null,
  };
}

/** Every word of the thread, so the search is not one long string's accident. */
function threadWords(thread: readonly string[]): string[] {
  const words = new Set<string>();
  for (const line of thread) {
    for (const word of line.split(/\s+/)) {
      if (word.length >= 3) words.add(word);
    }
  }
  return [...words];
}

const Q1 = "which harbor keeps the lantern lit";
const A1 = "the northern pier";
const Q2 = "who mends the copper wire";
const A2 = "a patient tinker";
const Q3 = "will the whistle sound at dawn";
const PARTIAL = "the whistle will";

describe("two answered turns and a stopped one: three lines, in order", () => {
  test("each sending turn appends exactly ONE PRISM, and the ending forms it", async () => {
    const workspace = freshWorkspace();
    const h = harness();
    const one = await writeAskTurn(
      workspace, ASK, INCLUDED, Q1, answered(A1), h.io,
    );
    const two = await writeAskTurn(
      workspace, ASK, INCLUDED, Q2, answered(A2), h.io,
    );
    const three = await writeAskTurn(
      workspace, ASK, INCLUDED, Q3, stopped("stopped before the end"), h.io,
    );

    // THREE sending turns, THREE appended lines — counted, not inferred.
    expect(h.writes()).toBe(3);
    const prisms = h.prisms();
    expect(prisms).toHaveLength(3);
    expect(prisms.map((prism) => prism.id)).toEqual([
      "prism-1",
      "prism-2",
      "prism-3",
    ]);
    expect(prisms.map((prism) => prism.on)).toEqual([ASK, ASK, ASK]);
    expect(prisms.map((prism) => prism.contact)).toEqual(["ask", "ask", "ask"]);
    expect(prisms.map((prism) => prism.pointer)).toEqual([null, null, null]);

    const changes = prisms.map((prism) => {
      expect(prism.changes).toHaveLength(1);
      return prism.changes[0]!;
    });
    if (changes[0].kind !== "ask" || changes[1].kind !== "ask" || changes[2].kind !== "ask") {
      throw new Error("unreachable");
    }
    // The ending decides the outcome, exactly as 15.7b settled.
    expect(changes.map((change) => change.outcome)).toEqual([
      "answered",
      "answered",
      "no-response",
    ]);
    // An answer carries the response's EXACT byte size and its decode.
    expect(changes[0].responseSize).toBe(
      new TextEncoder().encode(A1).length,
    );
    expect(changes[0].decode).toBe("clean");
    expect(changes[1].responseSize).toBe(
      new TextEncoder().encode(A2).length,
    );
    expect(changes[1].decode).toBe("clean");
    // A partial never looks like an answer: no size, no decode.
    expect(changes[2].responseSize).toBeNull();
    expect(changes[2].decode).toBeNull();
    expect(three.prism?.id).toBe("prism-3");
    expect(one.prism?.id).toBe("prism-1");
    expect(two.prism?.id).toBe("prism-2");
  });

  test("the Change names NO anchor (17.9) and rides no pointer", async () => {
    const workspace = freshWorkspace();
    const h = harness();
    await writeAskTurn(
      workspace, ASK, INCLUDED, Q1, answered(A1), h.io);
    const change = h.prisms()[0]!.changes[0]!;
    if (change.kind !== "ask") throw new Error("unreachable");
    expect(change.anchor).toBeUndefined();
    expect(change.pointer).toBeNull();
    // The inclusion set: the WIRED cards' natural keys, never their bytes.
    expect(change.included).toEqual(INCLUDED);
    // The closed union still PARSES the legacy anchor, but no new line writes
    // it: the keys present are the required set only.
    expect(Object.keys(change).sort()).toEqual([...CHANGE_KEYS.ask].sort());
  });

  test("a card with no wired context records no inclusion and no anchor", async () => {
    const workspace = freshWorkspace();
    const h = harness();
    await writeAskTurn(
      workspace, ASK, null, Q1, answered(A1), h.io,
    );
    const change = h.prisms()[0]!.changes[0]!;
    if (change.kind !== "ask") throw new Error("unreachable");
    expect(change.anchor).toBeUndefined();
    expect(change.included).toBeNull();
  });
});

describe("not one word of the thread reaches the record", () => {
  test("every word of every question and answer is absent from the log", async () => {
    const workspace = freshWorkspace();
    const h = harness();
    await writeAskTurn(
      workspace, ASK, INCLUDED, Q1, answered(A1), h.io);
    await writeAskTurn(
      workspace, ASK, INCLUDED, Q2, answered(A2), h.io);
    await writeAskTurn(
      workspace, ASK, INCLUDED, Q3, stopped("stopped"), h.io);
    const log = JSON.stringify(h.prisms());
    for (const word of threadWords([Q1, A1, Q2, A2, Q3, PARTIAL])) {
      expect(log.toLowerCase()).not.toContain(word.toLowerCase());
    }
    // The words live in the conversation instead — the split is real.
    const conversation = readFileSync(askTurnPath(workspace, ASK), "utf8");
    for (const word of threadWords([Q1, A1, Q2, A2, Q3])) {
      expect(conversation.toLowerCase()).toContain(word.toLowerCase());
    }
    // The stopped partial was never written either: it is a view, not an answer.
    expect(conversation).not.toContain(PARTIAL);
    // And no content-shaped key appears anywhere in a line's tree.
    for (const prism of h.prisms()) {
      const keys = new Set<string>();
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) {
          node.forEach(walk);
          return;
        }
        if (node !== null && typeof node === "object") {
          for (const [key, child] of Object.entries(node)) {
            keys.add(key);
            walk(child);
          }
        }
      };
      walk(JSON.parse(JSON.stringify(prism)));
      for (const forbidden of ["content", "text", "question", "answer", "body", "preview"]) {
        expect([...keys]).not.toContain(forbidden);
      }
    }
  });
});

describe("the join: the answer line names the Move, the person's line does not", () => {
  test("each answer line's move is the PRISM's id, in order", async () => {
    const workspace = freshWorkspace();
    const h = harness();
    const one = await writeAskTurn(
      workspace, ASK, INCLUDED, Q1, answered(A1), h.io);
    const two = await writeAskTurn(
      workspace, ASK, INCLUDED, Q2, answered(A2), h.io);
    const three = await writeAskTurn(
      workspace, ASK, INCLUDED, Q3, stopped("stopped"), h.io);

    const turns = (await loadTurns(workspace, ASK, askIo)).turns;
    expect(turns.map((turn) => turn.role)).toEqual([
      "person",
      "answer",
      "person",
      "answer",
      "person",
    ]);
    expect(turns[0]!.move).toBeUndefined();
    expect(turns[1]!.move).toBe(one.prism!.id);
    expect(turns[2]!.move).toBeUndefined();
    expect(turns[3]!.move).toBe(two.prism!.id);
    expect(turns[4]!.move).toBeUndefined();
    // The stopped turn made a Move and wrote no answer line: its id joins
    // nothing in the thread, and no line claims it.
    expect(three.prism!.id).toBe("prism-3");
    expect(turns.some((turn) => turn.move === three.prism!.id)).toBe(false);

    // The file says it too: the key is present on answer lines only.
    const lines = readFileSync(askTurnPath(workspace, ASK), "utf8")
      .split("\n")
      .filter((line) => line !== "");
    expect(lines).toHaveLength(5);
    for (const [index, line] of lines.entries()) {
      const parsed = JSON.parse(line) as { role: string; move?: string };
      if (parsed.role === "person") expect("move" in parsed).toBe(false);
      else expect(parsed.move).toBe(turns[index]!.move);
    }
  });

  test("a turn that never left the app writes no Move (but keeps the question)", async () => {
    const workspace = freshWorkspace();
    const h = harness();
    const sent: AskTurnSend = {
      result: { kind: "failed", sentence: "no provider is configured" },
      ending: "failed",
      left: false,
      reached: null,
      missed: null,
    };
    const recorded = await writeAskTurn(
      workspace, ASK, INCLUDED, Q1, sent, h.io);
    expect(recorded.prism).toBeNull();
    expect(h.writes()).toBe(0);
    expect(h.prisms()).toEqual([]);
    // The person's words are still the conversation's: they asked.
    expect(recorded.turns).toHaveLength(1);
    expect(recorded.turns[0]!.role).toBe("person");
    expect(recorded.turns[0]!.text).toBe(Q1);
    expect(recorded.sentence).toBe("no provider is configured");
  });

  test("a draft writes nothing at all", () => {
    // The card's only writer is the send, and the send refuses a blank draft.
    expect(ASK_CARD).toContain('setQuestion("");');
    expect(ASK_CARD.match(/onAskTurn\(/g)?.length ?? 0).toBe(1);
    // The Esc path (a draft abandoned) touches no writer and no Move.
    const esc = ASK_CARD.slice(
      ASK_CARD.indexOf("if (!open) return;"),
      ASK_CARD.indexOf("// THE CARD'S WHEEL NEVER ZOOMS THE PLANE"),
    );
    expect(esc).not.toContain("onAskTurn");
    expect(esc).not.toContain("prism");
    // The hook appends a Move only inside writeAskTurn and only when sent.
    const hookCode = HOOK.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    // The machinery is named in THREE places and called in ONE: the import,
    // the injected-bridge type and the bound constant.
    expect(hookCode.match(/appendAskCardMove/g)).toHaveLength(3);
    expect(hookCode.match(/io\.appendMove\(/g)).toHaveLength(1);
    expect(hookCode).toContain("const ASK_TURN_WRITE_IO: AskTurnWriteIo = {");
    // A turn that never left records no Move: the call is gated by `sent.left`.
    const write = hookCode.slice(
      hookCode.indexOf("export async function writeAskTurn"),
    );
    expect(write).toContain("sent.left");
    expect(write.indexOf("sent.left")).toBeLessThan(
      write.indexOf("io.appendMove("),
    );
  });
});

describe("the ending vocabulary, and the closing of the union", () => {
  test("the transport's own results map to the four endings", () => {
    expect(askEndingOf({ kind: "answer", text: "a" })).toBe("answered");
    expect(askEndingOf({ kind: "cancelled", sentence: "s" })).toBe("stopped");
    expect(askEndingOf({ kind: "timeout", sentence: "s" })).toBe("timed-out");
    expect(askEndingOf({ kind: "error", sentence: "s" })).toBe("failed");
  });

  test("the CONTEXT's natural keys, or null when nothing pointer-identified rode", () => {
    const reading: Reading = {
      on: ANCHOR,
      form: "path",
      from: "notes/gauge.md",
      taken: TAKEN,
    };
    // STORY 17.9: the included set is the keys of the WIRED cards' readings.
    const card = { name: "rain", state: null, reading: null, note: null, on: ANCHOR };
    expect(askContextInclusion([card], [reading])).toEqual(INCLUDED);
    // No card with a reading rode: no key.
    expect(askContextInclusion([], [reading])).toBeNull();
    expect(askContextInclusion([card], [])).toBeNull();
    // A selection reading is not a pointer: nothing pointer-identified rode.
    expect(
      askContextInclusion([card], [{ ...reading, form: "selection" }]),
    ).toBeNull();
  });

  test("anchor is the ONE optional key, and no kind gained a content slot", () => {
    const FORBIDDEN = ["content", "text", "head", "question", "answer", "body", "bytes", "preview"];
    for (const kind of CHANGE_KINDS) {
      const optional = CHANGE_OPTIONAL_KEYS[kind];
      for (const key of optional) expect(FORBIDDEN).not.toContain(key);
      for (const key of CHANGE_KEYS[kind]) expect(FORBIDDEN).not.toContain(key);
      if (kind !== "ask") expect(optional).toEqual([]);
    }
    expect(CHANGE_OPTIONAL_KEYS.ask).toEqual(["anchor"]);
    for (const key of PRISM_KEYS) expect(FORBIDDEN).not.toContain(key);
  });

  test("an ask Change carrying a content key is malformed, not guessed at", () => {
    const base = {
      kind: "ask",
      pointer: null,
      anchor: ANCHOR,
      outcome: "answered",
      included: null,
      responseSize: 3,
      decode: "clean",
    };
    expect(parsePrismChange(base)).not.toBeNull();
    expect(parsePrismChange({ ...base, text: "a word" })).toBeNull();
    expect(parsePrismChange({ ...base, preview: "a crop" })).toBeNull();
    // A non-string or empty anchor is out of shape too.
    expect(parsePrismChange({ ...base, anchor: "" })).toBeNull();
    expect(parsePrismChange({ ...base, anchor: 7 })).toBeNull();
    // The concept map's Ask is unchanged: no anchor key, no added field.
    const concept = {
      kind: "ask",
      pointer: "rain\u0000url\u0000https://example.org",
      outcome: "no-response",
      included: null,
      responseSize: null,
      decode: null,
    };
    const parsed = parsePrismChange(concept);
    expect(parsed).not.toBeNull();
    expect(Object.keys(parsed as object)).not.toContain("anchor");
  });
});
