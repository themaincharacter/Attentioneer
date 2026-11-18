import { describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import { moveChangedThePoint } from "../src/map/history";
import { moveAskRecords, moveSessionRecords } from "../src/canvas/useGround";
import {
  asksPath,
  loadAsks,
  parseAsks,
  saveAsks,
  withAskMoved,
} from "../src/map/asks";
import {
  loadSessions,
  saveSessions,
  sessionsPath,
  withSessionMoved,
} from "../src/map/sessions";

/**
 * STORY 16.23 — ASK AND SESSION CARDS CAN BE MOVED.
 *
 * The story's check is human ("drag an ask card by its name to empty canvas,
 * quit and reopen: it is where you left it; do the same for a session card by
 * its body; a reference card still moves as before; the other cards' positions
 * are untouched, byte for byte") and needs a window. This file pins what can be
 * pinned without one:
 *
 *   - a move rewrites ONLY the dragged card's line: the whole file is compared
 *     byte for byte, and every other line — malformed ones included — survives;
 *   - a card's other fields (name, anchor, fork fields, chosen words, tool row)
 *     are untouched, and coordinates round exactly as creation does;
 *   - a card that is gone writes NOTHING (no save call at all);
 *   - the position survives a load, which is what a reopen does;
 *   - the pure writer writes no history and no mirror — the hook's move verb
 *     queues the shared `card.move` (story 16.24), so all three families log
 *     the same line and a no-op drop logs none;
 *   - there is ONE drag rule: the shared helper in groundDrag.ts, its own
 *     threshold, and one call per card kind.
 */

const APP_DIR = new URL("..", import.meta.url).pathname;
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const DRAG = source("canvas/groundDrag.ts");
const HOOK = source("canvas/useGround.ts");
const LAYER = source("canvas/GroundLayer.tsx");
const ASK_CARD = source("canvas/AskCard.tsx");
const SESSION_CARD = source("canvas/SessionCard.tsx");
const APP = source("App.tsx");
const PILL = source("canvas/CardNamePill.tsx");

/** A fresh workspace root with the map folder the record writers need. */
function freshWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), "attentioneer-card-move-"));
  mkdirSync(join(root, "map"), { recursive: true });
  return root;
}

/**
 * THE RECORD FILES THROUGH NODE, not the window: the real bridges reach Tauri's
 * invoke, so the test hands the writers the same file-shaped seam the other
 * map tests use (one read, one write, the folder already made).
 */
const IO = {
  readTextFile: async (path: string): Promise<string | null> => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path: string, content: string): Promise<void> => {
    writeFileSync(path, content, "utf8");
  },
  createDirAll: async (path: string): Promise<void> => {
    mkdirSync(path, { recursive: true });
  },
};

/** The two families' move bridges, through the same node-backed files. */
const ASK_MOVE_IO = {
  saveAsks: (ws: string, asks: Parameters<typeof saveAsks>[1], malformed: readonly string[]) =>
    saveAsks(ws, asks, malformed, IO),
};
const SESSION_MOVE_IO = {
  saveSessions: (
    ws: string,
    sessions: Parameters<typeof saveSessions>[1],
    malformed: readonly string[],
  ) => saveSessions(ws, sessions, malformed, IO),
};

describe("the ask card's one move writer", () => {
  const ASKS = [
    "on: rain | name: Rain gauge | x: 10 | y: 20 | anchor: soil",
    "on: fork | name: A branch | x: 300 | y: 400 | from: rain | carry: 2 | anchorName: Rain gauge | chosenFrom: soil | chosen: \"the topsoil reads wet\"",
    "on: broken | line",
  ];
  const text = ASKS.join("\n") + "\n";

  test("only the dragged card's line changes, byte for byte", async () => {
    const path = freshWorkspace();
    const parsed = parseAsks(text);
    await saveAsks(path, parsed.asks, parsed.malformed, IO);
    const before = readFileSync(asksPath(path), "utf8");
    expect(before).toBe(text);

    const result = await moveAskRecords(
      path,
      "rain",
      101.4,
      55.6,
      parsed.asks,
      parsed.malformed,
      ASK_MOVE_IO,
    );
    expect(result.moved).not.toBeNull();
    const after = readFileSync(asksPath(path), "utf8");
    // ONE line rewritten, rounded like creation; every other byte is untouched,
    // the preserved malformed line included.
    expect(after).toBe(
      before.replace(
        "on: rain | name: Rain gauge | x: 10 | y: 20 | anchor: soil",
        "on: rain | name: Rain gauge | x: 101 | y: 56 | anchor: soil",
      ),
    );
    expect(after.endsWith("on: broken | line\n")).toBe(true);
  });

  test("the other fields ride through untouched, and a reopen finds the point", async () => {
    const path = freshWorkspace();
    const parsed = parseAsks(text);
    await saveAsks(path, parsed.asks, parsed.malformed, IO);
    await moveAskRecords(
      path,
      "fork",
      -9,
      12,
      parsed.asks,
      parsed.malformed,
      ASK_MOVE_IO,
    );
    const reopened = await loadAsks(path, IO);
    const moved = reopened.asks.find((ask) => ask.on === "fork")!;
    expect(moved).toEqual({
      on: "fork",
      name: "A branch",
      x: -9,
      y: 12,
      from: "rain",
      carry: 2,
      anchorName: "Rain gauge",
      chosenFrom: "soil",
      chosen: "the topsoil reads wet",
    });
    // The malformed line is still preserved and reported, never repaired.
    expect(reopened.malformed).toEqual(["on: broken | line"]);
  });

  test("a move of a card that is gone writes nothing at all", async () => {
    const path = freshWorkspace();
    const parsed = parseAsks(text);
    await saveAsks(path, parsed.asks, parsed.malformed, IO);
    const before = readFileSync(asksPath(path), "utf8");
    let saves = 0;
    const result = await moveAskRecords(path, "gone", 1, 2, parsed.asks, parsed.malformed, {
      saveAsks: async () => {
        saves += 1;
      },
    });
    expect(result.moved).toBeNull();
    expect(saves).toBe(0);
    expect(readFileSync(asksPath(path), "utf8")).toBe(before);
  });

  test("the pure rule answers null for a slug the file does not carry", () => {
    const asks = parseAsks(text).asks;
    expect(withAskMoved(asks, "gone", 1, 2)).toBeNull();
    expect(withAskMoved(asks, "rain", 3, 4)![0]).toEqual({
      on: "rain",
      name: "Rain gauge",
      x: 3,
      y: 4,
      anchor: "soil",
    });
  });

  test("the pure writer writes no history and no mirror of its own", async () => {
    const path = freshWorkspace();
    const parsed = parseAsks(text);
    await saveAsks(path, parsed.asks, parsed.malformed, IO);
    await moveAskRecords(
      path,
      "rain",
      5,
      6,
      parsed.asks,
      parsed.malformed,
      ASK_MOVE_IO,
    );
    // This writer is the record and nothing else: the hook queues the log
    // line and no derived index exists to rewrite.
    expect(existsSync(join(path, "MAP.md"))).toBe(false);
    expect(existsSync(join(path, "map", "ground-history.jsonl"))).toBe(false);
  });
});

describe("the session card's one move writer", () => {
  const SESSIONS = [
    "on: gauge | name: Gauge run | x: 40 | y: 60 | tool: dsh",
    "on: probe | name: Probe run | x: 500 | y: 700 | tool: opencode",
  ];
  const text = SESSIONS.join("\n") + "\n";

  test("only the dragged card's line changes, byte for byte", async () => {
    const path = freshWorkspace();
    await saveSessions(
      path,
      [
        { on: "gauge", name: "Gauge run", x: 40, y: 60, tool: "dsh" },
        { on: "probe", name: "Probe run", x: 500, y: 700, tool: "opencode" },
      ],
      [],
      IO,
    );
    const before = readFileSync(sessionsPath(path), "utf8");
    expect(before).toBe(text);
    const parsed = await loadSessions(path, IO);
    const result = await moveSessionRecords(
      path,
      "probe",
      12.6,
      -4.2,
      parsed.sessions,
      parsed.malformed,
      SESSION_MOVE_IO,
    );
    expect(result.moved).not.toBeNull();
    const after = readFileSync(sessionsPath(path), "utf8");
    expect(after).toBe(
      before.replace(
        "on: probe | name: Probe run | x: 500 | y: 700 | tool: opencode",
        "on: probe | name: Probe run | x: 13 | y: -4 | tool: opencode",
      ),
    );
  });

  test("the tool row survives, and a reopen finds the point", async () => {
    const path = freshWorkspace();
    await saveSessions(
      path,
      [{ on: "gauge", name: "Gauge run", x: 40, y: 60, tool: "dsh" }],
      [],
      IO,
    );
    const parsed = await loadSessions(path, IO);
    await moveSessionRecords(
      path,
      "gauge",
      7,
      8,
      parsed.sessions,
      [],
      SESSION_MOVE_IO,
    );
    const reopened = await loadSessions(path, IO);
    expect(reopened.sessions[0]).toEqual({
      on: "gauge",
      name: "Gauge run",
      x: 7,
      y: 8,
      tool: "dsh",
    });
  });

  test("a move of a card that is gone writes nothing at all", async () => {
    const path = freshWorkspace();
    const sessions = [
      { on: "gauge", name: "Gauge run", x: 40, y: 60, tool: "dsh" },
    ];
    await saveSessions(path, sessions, [], IO);
    const before = readFileSync(sessionsPath(path), "utf8");
    let saves = 0;
    const result = await moveSessionRecords(path, "gone", 1, 2, sessions, [], {
      saveSessions: async () => {
        saves += 1;
      },
    });
    expect(result.moved).toBeNull();
    expect(saves).toBe(0);
    expect(readFileSync(sessionsPath(path), "utf8")).toBe(before);
    expect(withSessionMoved(sessions, "gone", 1, 2)).toBeNull();
  });
});

describe("one drag rule, three kinds", () => {
  test("the threshold is the same one constant, never restated by a card", () => {
    expect(DRAG).toContain("export const GROUND_DRAG_THRESHOLD = 4;");
    expect(DRAG.split("GROUND_DRAG_THRESHOLD =").length - 1).toBe(1);
    // The helper calls the rule with its DEFAULT threshold.
    expect(DRAG).toContain(
      "moveGroundDrag(drag, { x: ev.clientX, y: ev.clientY })",
    );
    for (const kind of [LAYER, ASK_CARD, SESSION_CARD, PILL]) {
      expect(kind).not.toContain("GROUND_DRAG_THRESHOLD");
    }
  });

  test("the three kinds share one press->drop join, and each calls it once", () => {
    expect(DRAG.split("let drag = beginGroundDrag(").length - 1).toBe(1);
    expect(DRAG.split("const dropped = dropGroundDrag(").length - 1).toBe(1);
    for (const kind of [LAYER, ASK_CARD, SESSION_CARD]) {
      expect(kind.split("attachGroundCardDrag(").length - 1).toBe(1);
      // No kind implements its own threshold or pointer capture.
      expect(kind).not.toContain("beginGroundDrag");
      expect(kind).not.toContain("dropGroundDrag");
    }
    // The pill is the handle but owns no pointer handling (story 16.21's rule).
    for (const forbidden of [
      "beginGroundDrag",
      "moveGroundDrag",
      "dropGroundDrag",
      "addEventListener",
      "onMouseDown",
    ]) {
      expect(PILL.includes(forbidden)).toBe(false);
    }
  });

  test("the app hands the two new movers to the layer, beside the reference's", () => {
    expect(APP).toContain("onMoveAsk={ground.moveAsk}");
    expect(APP).toContain("onMoveSession={ground.moveSession}");
    expect(APP).toContain("onMove={ground.move}");
    expect(LAYER).toContain("onMoveAsk?: (slug: string, x: number, y: number)");
    expect(LAYER).toContain(
      "onMoveSession?: (",
    );
    // Each card reaches the one writer through its own onMove prop.
    expect(ASK_CARD).toContain("onMove?: (x: number, y: number)");
    expect(SESSION_CARD).toContain("onMove?: (x: number, y: number)");
  });

  test("one card.move for every family, queued after the record write", () => {
    // STORY 16.24: the same event, in the same place, through the same queue.
    for (const verb of ["move", "moveAsk", "moveSession"]) {
      const start = HOOK.indexOf("const " + verb + " = useCallback(");
      expect(start).toBeGreaterThan(-1);
      const next = HOOK.indexOf("\n  const ", start + 1);
      const block = HOOK.slice(start, next === -1 ? HOOK.length : next);
      expect(block).toContain("queueHistory(() => [");
      expect(block).toContain("cardMoveEvent(");
      // No kind field: the shared slug space names the card on its own.
      expect(block).not.toContain('kind: "');
      // After the record write, exactly as the reference path always did.
      expect(block.indexOf("queueHistory(")).toBeGreaterThan(
        block.indexOf("setState("),
      );
      // A drop that lands on the card's own point is no move.
      expect(block).toContain("moveChangedThePoint(");
    }
    // The false 16.23 claim is gone from the hook and both writers.
    expect(HOOK).not.toContain("NO HISTORY LINE");
    expect(source("map/asks.ts")).not.toContain("NO HISTORY LINE, DELIBERATELY");
    expect(source("map/sessions.ts")).not.toContain(
      "NO HISTORY LINE, DELIBERATELY",
    );
    // A point changes no name MAP.md prints, so the two new families still
    // queue no mirror (only the reference path ever did).
    for (const verb of ["moveAsk", "moveSession"]) {
      const start = HOOK.indexOf("const " + verb + " = useCallback(");
      const next = HOOK.indexOf("\n  const ", start + 1);
      expect(HOOK.slice(start, next === -1 ? HOOK.length : next)).not.toContain(
        "queueMirror",
      );
    }
    // The true rule is stated where a later reader looks for it.
    expect(source("map/history.ts")).toContain(
      "A DROP THAT LANDS WHERE THE CARD ALREADY WAS IS NOT A MOVE",
    );
    // And the ground map still renders no map content family.
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("the shared no-op rule rounds like the record does", () => {
    expect(moveChangedThePoint({ x: 10, y: 20 }, { x: 10, y: 20 })).toBe(false);
    // A four-pixel drag can round back onto the same whole point.
    expect(moveChangedThePoint({ x: 10, y: 20 }, { x: 10.4, y: 19.6 })).toBe(
      false,
    );
    expect(moveChangedThePoint({ x: 10, y: 20 }, { x: 11, y: 20 })).toBe(true);
    expect(moveChangedThePoint({ x: 10, y: 20 }, { x: 10, y: 21 })).toBe(true);
    // A card the write never found is not a move.
    expect(moveChangedThePoint(undefined, { x: 1, y: 2 })).toBe(false);
    expect(moveChangedThePoint(null, { x: 1, y: 2 })).toBe(false);
    expect(moveChangedThePoint({ x: 1, y: 2 }, null)).toBe(false);
  });
});
