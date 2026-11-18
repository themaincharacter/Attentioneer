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
import { fileURLToPath } from "node:url";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  HISTORY_FILE,
  HISTORY_WRITE_REFUSAL,
  appendEvent,
  appendEvents,
  appendedHistory,
  baselineEvent,
  baselineLine,
  cardAddEvent,
  cardMoveEvent,
  cardRemovalEvents,
  cardRemoveEvent,
  historyPath,
  historyWriteTask,
  linkAddEvent,
  linkRemoveEvent,
  noteRemoveEvent,
  noteSetEvent,
  parseHistory,
  parseHistoryEvent,
  readHistory,
  readingRefreshEvent,
  readingRepointEvent,
  readingTakeEvent,
  serializeHistoryEvent,
  type HistoryEvent,
  type HistoryIo,
} from "../src/map/history";
import { saveGround, type GroundReference } from "../src/map/ground";
import {
  loadGroundLinks,
  saveGroundLinks,
  type GroundLink,
} from "../src/map/groundLinks";
import {
  readingTextPath,
  saveReadings,
  type Reading,
} from "../src/map/readings";
import { notePath, notesDir, saveNote } from "../src/map/notes";

/**
 * Story 16.10 — HISTORY: the map remembers the moves, not the cursor.
 *
 * The story's check is human ("add a card, move it, write a note, link it...
 * open map/ground-history.jsonl: one line per move you actually authored, and
 * nothing from the looking; quit and reopen, make one more change: the file
 * grew by exactly one line and the earlier lines are byte-identical"). This
 * file pins the rules underneath:
 *
 *   - APPEND-ONLY: the earlier bytes are a prefix that never changes, across
 *     later moves and across a hand-edited malformed line;
 *   - authored moves only: one line per move, and NOTHING for look-around
 *     (opening, closing, pulling, panning, typing) — proven at the seam;
 *   - no CONTENT: a note's words and a reading's text never appear, and a
 *     repoint carries the file's NAME, never the path;
 *   - the baseline lands once, first, and only when the file first gets a line;
 *   - a malformed line is preserved and reported, never dropped or repaired;
 *   - an append failure is ONE sentence and never undoes the move;
 *   - a card's removal carries one link.remove per cascaded link;
 *   - every line is JSONL and every event round-trips;
 *   - the log is written through the ground queue AFTER the record it
 *     describes, and nothing in the UI counts its lines.
 *
 * PROVISIONAL (the story's artifact): the file name, the event vocabulary, the
 * baseline line, `t` in ms, the payload keys and the notice wording.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const HOOK = source("canvas/useGround.ts");
const APP = source("App.tsx");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-history-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

const fsTextIo: HistoryIo = {
  readTextFile: async (path: string): Promise<string | null> => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path: string, content: string): Promise<void> => {
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  },
};

const RAIN: GroundReference = { on: "rain-gauge", name: "Rain gauge", x: 10, y: 20 };
const SOIL: GroundReference = { on: "soil", name: "Soil", x: 30, y: 40 };
const RAIN_READING: Reading = {
  on: "rain-gauge",
  form: "path",
  from: "docs/gauge.txt",
  taken: "2026-11-17T12:00:00.000Z",
  bytes: 20,
};
const LINK: GroundLink = { from: "rain-gauge", to: "soil" };

/** The readings' bridges, shaped like the module's own (a test fake). */
const readingIo = {
  readTextFile: fsTextIo.readTextFile,
  readTextHead: async () => {
    throw new Error("unused");
  },
  writeTextFile: fsTextIo.writeTextFile,
  createDirAll: async (path: string) => mkdirSync(path, { recursive: true }),
  fileMeta: async () => ({ kind: "refused" as const }),
  readFileBytes: async () => ({ kind: "refused" as const, code: "io" as const }),
  pdfText: async () => ({ kind: "refused" as const, message: "unused" }),
};

/** The lines the file holds, read from disk. */
function linesOf(workspace: string): string[] {
  return readFileSync(historyPath(workspace), "utf8")
    .split("\n")
    .filter((line) => line !== "");
}

/** A complete authored sequence: every event kind the story allows. */
function authoredSequence(at: number): HistoryEvent[] {
  return [
    cardAddEvent(at, "rain-gauge", 10, 20),
    readingTakeEvent(at, "rain-gauge", "path", 20),
    cardMoveEvent(at + 1, "rain-gauge", 12, 22),
    readingRefreshEvent(at + 2, "rain-gauge", "path", 24),
    readingRepointEvent(at + 3, "rain-gauge", "path", "gauge.txt"),
    noteSetEvent(at + 4, "rain-gauge"),
    linkAddEvent(at + 5, "rain-gauge", "soil"),
    linkRemoveEvent(at + 6, "rain-gauge", "soil"),
    noteRemoveEvent(at + 7, "rain-gauge"),
    cardRemovalEvents(at + 8, "rain-gauge", [LINK])[0],
    linkRemoveEvent(at + 8, LINK.from, LINK.to),
  ];
}

describe("the line and the event vocabulary", () => {
  test("every event round-trips through its canonical JSONL line", () => {
    for (const event of authoredSequence(1_700_000_000_000)) {
      const line = serializeHistoryEvent(event);
      expect(parseHistoryEvent(line)).toEqual(event);
      // One JSON object per line.
      expect(JSON.parse(line)).toEqual(event);
    }
  });

  test("a line carries the version and a millisecond stamp", () => {
    const line = serializeHistoryEvent(cardAddEvent(1_700_000_000_000, "rain", 1, 2));
    const parsed = JSON.parse(line);
    expect(parsed.v).toBe(1);
    expect(parsed.t).toBe(1_700_000_000_000);
    expect(parsed.type).toBe("card.add");
  });

  test("the vocabulary is exactly the story's ten moves plus the baseline", () => {
    const types = new Set(
      authoredSequence(1).map((event) => (event as { type: string }).type),
    );
    expect([...types].sort()).toEqual(
      [
        "card.add",
        "card.move",
        "card.remove",
        "link.add",
        "link.remove",
        "note.remove",
        "note.set",
        "reading.refresh",
        "reading.repoint",
        "reading.take",
      ].sort(),
    );
  });

  test("the baseline is the one type no move produces", () => {
    expect(baselineEvent(1).type).toBe("baseline");
  });

  test("a malformed line parses to null and is not guessed at", () => {
    expect(parseHistoryEvent("not json")).toBeNull();
    expect(parseHistoryEvent(JSON.stringify({ v: 2, t: 1, type: "baseline" }))).toBeNull();
    expect(parseHistoryEvent(JSON.stringify({ t: 1, type: "baseline" }))).toBeNull();
    expect(parseHistoryEvent(JSON.stringify({ v: 1, t: 1, type: "invented" }))).toBeNull();
    expect(
      parseHistoryEvent(JSON.stringify({ v: 1, t: 1, type: "card.add", slug: "a" })),
    ).toBeNull();
    expect(parseHistoryEvent(JSON.stringify({ v: 1, t: 1, type: "baseline" }))).toEqual(
      baselineEvent(1),
    );
  });
});

describe("append-only: the earlier bytes never change", () => {
  test("a later move only adds after the earlier bytes", async () => {
    const workspace = freshWorkspace();
    await appendEvent(workspace, cardAddEvent(1000, "rain-gauge", 10, 20), fsTextIo);
    const first = readFileSync(historyPath(workspace), "utf8");
    await appendEvent(workspace, cardMoveEvent(1001, "rain-gauge", 12, 22), fsTextIo);
    const second = readFileSync(historyPath(workspace), "utf8");
    expect(second.startsWith(first)).toBe(true);
    expect(second.length).toBeGreaterThan(first.length);
    await appendEvent(workspace, linkAddEvent(1002, "rain-gauge", "soil"), fsTextIo);
    const third = readFileSync(historyPath(workspace), "utf8");
    expect(third.startsWith(second)).toBe(true);
    // Nothing was reordered, rewritten or deleted: the file is only longer.
    expect(third.slice(0, second.length)).toBe(second);
  });

  test("a hand-edited line is preserved byte for byte, then followed", async () => {
    const workspace = freshWorkspace();
    const handmade =
      '{ "type" : "card.add" , "slug" : "rain-gauge" , "v" : 1 , "t" : 5 , "x" : 0 , "y" : 0 }';
    writeFileSync(
      historyPath(workspace),
      handmade + "\n" + "this line was never JSON" + "\n",
      "utf8",
    );
    const before = readFileSync(historyPath(workspace), "utf8");
    await appendEvent(workspace, cardMoveEvent(6, "rain-gauge", 1, 1), fsTextIo);
    const after = readFileSync(historyPath(workspace), "utf8");
    expect(after.startsWith(before)).toBe(true);
    // The hand-edited duplicate of a real move parses; the junk is reported.
    expect(parseHistory(after).events.map((event) => event.type)).toEqual([
      "card.add",
      "card.move",
    ]);
    expect(parseHistory(after).malformed).toEqual(["this line was never JSON"]);
  });

  test("a file without a final newline is followed, not rewritten", async () => {
    const workspace = freshWorkspace();
    writeFileSync(
      historyPath(workspace),
      serializeHistoryEvent(baselineEvent(1)) + "\n" + serializeHistoryEvent(cardAddEvent(2, "a", 0, 0)),
      "utf8",
    );
    const before = readFileSync(historyPath(workspace), "utf8");
    await appendEvent(workspace, cardMoveEvent(3, "a", 4, 5), fsTextIo);
    const after = readFileSync(historyPath(workspace), "utf8");
    expect(after.startsWith(before)).toBe(true);
    expect(after.slice(before.length)).toContain("card.move");
    expect(linesOf(workspace).length).toBe(3);
  });
});

describe("the baseline", () => {
  test("the first append writes the baseline first, then the event", async () => {
    const workspace = freshWorkspace();
    const append = await appendEvent(workspace, cardAddEvent(7, "rain", 1, 2), fsTextIo);
    expect(append.baseline).toBe(true);
    const lines = linesOf(workspace);
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]).type).toBe("baseline");
    expect(JSON.parse(lines[0]).v).toBe(1);
    expect(JSON.parse(lines[1]).type).toBe("card.add");
    // The baseline is ONE line with no state dump: only v, t and type.
    expect(Object.keys(JSON.parse(lines[0])).sort()).toEqual(["t", "type", "v"]);
  });

  test("the baseline is written once, before everything else", async () => {
    const workspace = freshWorkspace();
    await appendEvent(workspace, cardAddEvent(7, "rain", 1, 2), fsTextIo);
    await appendEvents(
      workspace,
      [cardMoveEvent(8, "rain", 3, 4), noteSetEvent(9, "rain")],
      fsTextIo,
    );
    const lines = linesOf(workspace);
    expect(lines.filter((line) => JSON.parse(line).type === "baseline").length).toBe(1);
    expect(JSON.parse(lines[0]).type).toBe("baseline");
    expect(lines.length).toBe(4);
  });

  test("an existing log gets no new baseline", async () => {
    const workspace = freshWorkspace();
    writeFileSync(
      historyPath(workspace),
      serializeHistoryEvent(cardAddEvent(1, "rain", 0, 0)) + "\n",
      "utf8",
    );
    const append = await appendEvent(workspace, cardMoveEvent(2, "rain", 1, 1), fsTextIo);
    expect(append.baseline).toBe(false);
    expect(linesOf(workspace).some((line) => JSON.parse(line).type === "baseline")).toBe(false);
  });

  test("an empty file is the same as no file: the baseline goes in", async () => {
    const workspace = freshWorkspace();
    writeFileSync(historyPath(workspace), "", "utf8");
    const append = await appendEvent(workspace, cardAddEvent(1, "rain", 0, 0), fsTextIo);
    expect(append.baseline).toBe(true);
    expect(JSON.parse(linesOf(workspace)[0]).type).toBe("baseline");
  });

  test("the pure append says the same thing without a disk", () => {
    const append = appendedHistory(null, [cardAddEvent(4, "a", 1, 2)]);
    expect(append.baseline).toBe(true);
    expect(append.lines[0]).toBe(baselineLine(4));
    expect(append.text).toBe(append.lines.join("\n") + "\n");
    // No events, no line, no baseline: a look writes nothing.
    expect(appendedHistory(null, []).lines).toEqual([]);
  });
});

describe("authored moves only: the look leaves no line", () => {
  test("opening a workspace reads the history and writes nothing", async () => {
    const workspace = freshWorkspace();
    const read = await readHistory(workspace, fsTextIo);
    expect(read).toEqual({ events: [], malformed: [], exists: false });
    expect(existsSync(historyPath(workspace))).toBe(false);
  });

  test("the hook appends from the twelve authored write paths, no more", () => {
    // The only call form the verbs use; the definition is not a call site.
    // Story 16.12 added the selection card as the ninth authored write path;
    // story 16.13 adds the restore as the tenth; story 16.14 the page card and
    // story 16.15 the video card.
    const calls = HOOK.match(/queueHistory\(\(\) =>/g) ?? [];
    expect(calls.length).toBe(12);
  });

  test("the mirror and the history own the same twelve verbs", () => {
    const verbs = [
      "create",
      "createSelection",
      "createPage",
      "createVideo",
      "move",
      "refresh",
      "repoint",
      "remove",
      "link",
      "unlink",
      "setNote",
      // STORY 16.13: a restore is an authored move, and it logs its own line.
      "restore",
    ];
    for (const verb of verbs) {
      const start = HOOK.indexOf("const " + verb + " = useCallback");
      expect(start).toBeGreaterThan(-1);
      const next = HOOK.indexOf("\n  const ", start + 1);
      const body = HOOK.slice(start, next === -1 ? HOOK.length : next);
      expect(body).toContain("queueHistory(() =>");
    }
  });

  test("the look verbs and the load path write no history", () => {
    for (const verb of ["pull", "dismissPull"]) {
      const start = HOOK.indexOf("const " + verb + " = useCallback");
      expect(start).toBeGreaterThan(-1);
      const next = HOOK.indexOf("\n  const ", start + 1);
      const body = HOOK.slice(start, next === -1 ? HOOK.length : next);
      expect(body).not.toContain("queueHistory");
      expect(body).not.toContain("appendEvent");
    }
    // The load and the workspace effect only READ the file (they report its
    // malformed lines); opening is a look, so nothing is created or appended.
    const reload = HOOK.slice(
      HOOK.indexOf("const reload = useCallback"),
      HOOK.indexOf("const snapshot ="),
    );
    expect(reload).toContain("readHistory(workspacePath)");
    expect(reload).not.toContain("queueHistory");
    expect(reload).not.toContain("appendEvents");
    expect(reload).not.toContain("appendEvent(");
    const effect = HOOK.slice(
      HOOK.indexOf("useEffect(() => {"),
      HOOK.indexOf("const create = useCallback"),
    );
    expect(effect).not.toContain("queueHistory");
    expect(effect).not.toContain("appendEvent");
    // No watcher, timer or background read anywhere in the hook.
    expect(HOOK).not.toContain("setInterval");
    expect(HOOK).not.toContain("watch(");
  });
});

describe("no content, ever", () => {
  test("a note's words never reach the log", async () => {
    const workspace = freshWorkspace();
    const secret = "the private words the person wrote";
    mkdirSync(notesDir(workspace), { recursive: true });
    writeFileSync(notePath(workspace, "rain-gauge"), secret, "utf8");
    mkdirSync(join(workspace, "map", "readings"), { recursive: true });
    writeFileSync(readingTextPath(workspace, "rain-gauge"), "reading body text", "utf8");
    await saveGround(workspace, [RAIN], [], fsTextIo);
    await saveReadings(workspace, [RAIN_READING], [], readingIo);
    await saveNote(workspace, "rain-gauge", secret, {
      readTextFile: fsTextIo.readTextFile,
      writeTextFile: fsTextIo.writeTextFile,
      createDirAll: async (path: string) => mkdirSync(path, { recursive: true }),
      listDir: async () => [],
      removeFile: async () => undefined,
    });
    await appendEvents(
      workspace,
      [
        cardAddEvent(1, "rain-gauge", 10, 20),
        readingTakeEvent(1, "rain-gauge", "path", 20),
        noteSetEvent(2, "rain-gauge"),
      ],
      fsTextIo,
    );
    const log = readFileSync(historyPath(workspace), "utf8");
    expect(log).not.toContain("private words");
    expect(log).not.toContain("reading body text");
    // The move is still recorded; only its CONTENT is absent.
    expect(log).toContain("\"note.set\"");
    expect(log).toContain("\"reading.take\"");
  });

  test("a repoint names the new file, never its path", async () => {
    const workspace = freshWorkspace();
    await appendEvent(
      workspace,
      readingRepointEvent(1, "rain-gauge", "at", "gauge.txt"),
      fsTextIo,
    );
    const log = readFileSync(historyPath(workspace), "utf8");
    expect(log).toContain("gauge.txt");
    expect(log).not.toContain("/home/");
    expect(log).not.toContain("C:");
    expect(log).not.toContain("docs/");
  });
});

describe("a malformed line is kept and reported", () => {
  test("the loader reports it and an append leaves it in place", async () => {
    const workspace = freshWorkspace();
    writeFileSync(
      historyPath(workspace),
      "{ not really json }\n" + serializeHistoryEvent(cardAddEvent(1, "rain", 0, 0)) + "\n",
      "utf8",
    );
    const read = await readHistory(workspace, fsTextIo);
    expect(read.malformed).toEqual(["{ not really json }"]);
    expect(read.events.map((event) => event.type)).toEqual(["card.add"]);
    await appendEvent(workspace, cardMoveEvent(2, "rain", 1, 1), fsTextIo);
    const lines = linesOf(workspace);
    expect(lines[0]).toBe("{ not really json }");
    expect(parseHistory(readFileSync(historyPath(workspace), "utf8")).malformed).toEqual([
      "{ not really json }",
    ]);
  });

  test("the notices group renders the kept lines and the failure sentence", () => {
    expect(APP).toContain("malformedHistory={ground.malformedHistory}");
    expect(APP).toContain("historyNotice={ground.historyNotice}");
    expect(APP).toContain("unreadable line in map/ground-history.jsonl: {line}");
    expect(APP).toContain("{historyNotice}");
  });
});

describe("an append failure never undoes the move", () => {
  test("one sentence, the task settles, and the record stands", async () => {
    const workspace = freshWorkspace();
    await saveGround(workspace, [RAIN], [], fsTextIo);
    const reports: (string | null)[] = [];
    const failing: HistoryIo = {
      readTextFile: async () => null,
      writeTextFile: async () => {
        throw new Error("disk refused");
      },
    };
    const task = historyWriteTask(
      workspace,
      () => [cardAddEvent(1, "rain-gauge", 10, 20)],
      (notice) => reports.push(notice),
      failing,
    );
    await expect(task()).resolves.toBeUndefined();
    expect(reports).toEqual([HISTORY_WRITE_REFUSAL]);
    expect(HISTORY_WRITE_REFUSAL).not.toMatch(/\d/);
    expect(HISTORY_WRITE_REFUSAL.split(".").filter((s) => s.trim() !== "").length).toBe(1);
    // The move itself was already written and is untouched by the refusal.
    expect(readFileSync(join(workspace, "map", "ground.txt"), "utf8")).toContain(
      "on: rain-gauge",
    );
    expect(existsSync(historyPath(workspace))).toBe(false);
  });

  test("a successful append clears the notice", async () => {
    const workspace = freshWorkspace();
    const reports: (string | null)[] = [];
    await historyWriteTask(
      workspace,
      () => [cardAddEvent(1, "rain", 0, 0)],
      (notice) => reports.push(notice),
      fsTextIo,
    )();
    expect(reports).toEqual([null]);
  });
});

describe("the delete cascade logs its links", () => {
  test("card.remove comes first, then one link.remove per cascaded link", async () => {
    const workspace = freshWorkspace();
    const links: GroundLink[] = [
      { from: "rain-gauge", to: "soil" },
      { from: "soil", to: "rain-gauge" },
      { from: "soil", to: "other" },
    ];
    await saveGroundLinks(workspace, links, [], fsTextIo);
    // The delete removes exactly the links NAMING the card, in BOTH
    // directions; the hook hands the same pass's take to the history.
    const cascaded = links.filter(
      (link) => link.from === "rain-gauge" || link.to === "rain-gauge",
    );
    await appendEvents(
      workspace,
      cardRemovalEvents(5, "rain-gauge", cascaded),
      fsTextIo,
    );
    const events = parseHistory(readFileSync(historyPath(workspace), "utf8")).events;
    expect(events[0].type).toBe("baseline");
    expect(events.slice(1).map((event) => event.type)).toEqual([
      "card.remove",
      "link.remove",
      "link.remove",
    ]);
    expect(events[2]).toEqual(linkRemoveEvent(5, "rain-gauge", "soil"));
    expect(events[3]).toEqual(linkRemoveEvent(5, "soil", "rain-gauge"));
    // The cascade in the hook uses the same filter (the links it removed).
    // STORY 16.13 keeps each line's index beside it, so Restore can put it
    // back, so the hook maps the entries back to links for the log.
    expect(HOOK).toContain("const cascaded = linksRef.current");
    expect(HOOK).toContain("cardRemovalEvents(");
    expect(HOOK).toContain("cascaded.map((entry) => entry.link)");
    // The link record itself still holds the untouched third pair.
    const stored = await loadGroundLinks(workspace, fsTextIo);
    expect(stored.links).toEqual(links);
  });
});

describe("the whole log", () => {
  test("every line is JSON and every event is readable", async () => {
    const workspace = freshWorkspace();
    await saveGround(workspace, [RAIN, SOIL], [], fsTextIo);
    await saveGroundLinks(workspace, [LINK], [], fsTextIo);
    for (const event of authoredSequence(100)) {
      await appendEvent(workspace, event, fsTextIo);
    }
    const lines = linesOf(workspace);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
    expect(lines[0]).toContain("baseline");
    const read = parseHistory(readFileSync(historyPath(workspace), "utf8"));
    expect(read.malformed).toEqual([]);
    expect(read.events.length).toBe(lines.length);
  });

  test("the history is written AFTER the record it describes", () => {
    const verbs = [
      "create",
      "createSelection",
      "createPage",
      "move",
      "refresh",
      "repoint",
      "remove",
      "link",
      "unlink",
      "setNote",
    ];
    for (const verb of verbs) {
      const start = HOOK.indexOf("const " + verb + " = useCallback");
      const next = HOOK.indexOf("\n  const ", start + 1);
      const body = HOOK.slice(start, next === -1 ? HOOK.length : next);
      const historyAt = body.indexOf("queueHistory(() =>");
      const writeAt = Math.max(
        body.lastIndexOf("await save"),
        body.lastIndexOf("await remove"),
        // Story 16.12: the selection's write delegates to its helper.
        body.lastIndexOf("await writeSelectionCard"),
        // Story 16.14: so does the page card's.
        body.lastIndexOf("await writePageCard"),
        body.lastIndexOf("await createFetchedPage"),
      );
      expect(writeAt).toBeGreaterThan(-1);
      expect(writeAt).toBeLessThan(historyAt);
      // Queued, never awaited: a failed append cannot fail or delay the move.
      expect(body).not.toContain("await queueHistory");
    }
  });

  test("a file name, a path and the ground map stay separate", () => {
    expect(HISTORY_FILE).toBe("ground-history.jsonl");
    expect(historyPath("/w")).toBe("/w/map/ground-history.jsonl");
    // The log is a RECORD, not a second map: the ground map still renders no
    // content, and nothing here touches the concept map's records.
    expect(renderedMapContent("ground")).toEqual([]);
    // The hook writes no concept-map record: its records are map/ground,
    // map/readings, map/ground-links, map/notes and the history.
    expect(HOOK).not.toContain("map/references");
    expect(HOOK).not.toContain("distances.jsonl");
  });
});
