import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  EXPLORER_UNREACHABLE,
  ascendExplorer,
  closeExplorer,
  descendExplorer,
  explorerEntryPath,
  explorerPathLine,
  explorerRows,
  openExplorerEntry,
  openExplorerRoot,
  rowAction,
  type ExplorerIo,
  type ExplorerView,
} from "../src/canvas/explorerRules";
import { FolderExplorerFace } from "../src/canvas/FolderExplorer";
import {
  GroundLayer,
  readingAbsenceLine,
} from "../src/canvas/GroundLayer";
import { openFileOutward } from "../src/canvas/outward";
import { CANNOT_OPEN } from "../src/canvas/outwardRules";
import type { GroundReference } from "../src/map/ground";
import {
  LISTING_MAX_ENTRIES,
  folderKeptProvenance,
  folderReading,
  serializeReadingLine,
  type Reading,
} from "../src/map/readings";
import { renderMirror } from "../src/map/mirror";
import type { DirEntry } from "../src/lib/fs";

/**
 * STORY 20.2 — THE PROJECT CARD OPENS A MINI FILE EXPLORER.
 *
 * The human check is "I expand my project card and see the folder's entries. I
 * click into a subfolder and back out. I double-click a file and the OS opens
 * it in its default app. Nothing on the card writes; the kept listing and its
 * refresh stay as they were." The pins below are the rules under it:
 *
 *   - a level's rows are the folder's entries, folders first and marked with
 *     the trailing slash the kept listing uses, names verbatim, over-cap rows
 *     dropped whole;
 *   - the quiet path line is the path from the project root, never absolute;
 *   - the stack is VIEW STATE: descend, ascend, and a closed card holds no
 *     explorer at all;
 *   - an unreadable level answers one sentence in place and never becomes
 *     where the person is, while the way back up is always taken;
 *   - a double click on a FILE row hands the exact joined path to the opener,
 *     and a directory row never does;
 *   - browsing writes nothing to the map — no reading, no history, no mirror;
 *   - the block is drawn only on an expanded folder card, and the kept reading
 *     is exactly what it was.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(relative: string): string {
  return readFileSync(APP_DIR + "src/" + relative, "utf8");
}

const FOLDER = "/home/ada/code/attentioneer";
const WINDOWS_FOLDER = String.raw`C:\Users\ada\code\attentioneer`;
const SLUG = "attentioneer";
const TAKEN = "2026-11-19T09:00:00.000Z";

const reference: GroundReference = { on: SLUG, name: "Attentioneer", x: 40, y: 60 };

const ENTRIES: DirEntry[] = [
  { name: "zeta.txt", isDir: false },
  { name: "src", isDir: true },
  { name: "README.md", isDir: false },
  { name: "alpha", isDir: true },
  { name: "package.json", isDir: false },
];

const SRC_ENTRIES: DirEntry[] = [
  { name: "main.rs", isDir: false },
  { name: "canvas", isDir: true },
];

/** A fake bridge: the levels it answers by path, the paths it refuses, and a log. */
function bridge(options: {
  levels?: Record<string, DirEntry[]>;
  refuse?: string[];
} = {}): { io: ExplorerIo; log: string[] } {
  const log: string[] = [];
  const levels = options.levels ?? {};
  const refuse = options.refuse ?? [];
  const io: ExplorerIo = {
    async listDirEntries(path) {
      log.push(path);
      if (refuse.includes(path)) throw new Error("cannot list");
      return levels[path] ?? [];
    },
  };
  return { io, log };
}

const inertVerbs = {
  onMove: async () => ({ ok: true as const }),
  onRefresh: async () => ({ ok: true as const }),
  onRepoint: async () => ({ ok: true as const }),
  onRemove: async () => ({ ok: true as const }),
};

function face(view: ExplorerView, folder = FOLDER): string {
  return renderToStaticMarkup(
    createElement(FolderExplorerFace, {
      folder,
      view,
      busy: false,
      onEnter: () => {},
      onAscend: () => {},
      onOpenFile: () => {},
    }),
  );
}

describe("a level's rows are the folder's own words", () => {
  test("folders come first, then names; folders carry the kept listing's slash", () => {
    const rows = explorerRows(ENTRIES, false);
    expect(rows.map((row) => row.label)).toEqual([
      "alpha/",
      "src/",
      "README.md",
      "package.json",
      "zeta.txt",
    ]);
    expect(rows.map((row) => row.isDir)).toEqual([true, true, false, false, false]);
    // Every row is a COMPLETE name, a folder's marked the way the kept listing
    // marks it — one marking rule, never a second guess.
    for (const row of rows) {
      expect(row.kind).toBe("entry");
      expect(row.label).toBe(row.isDir ? row.name + "/" : row.name);
    }
  });

  test("names are verbatim: capitals, dots and spaces all survive", () => {
    const odd: DirEntry[] = [
      { name: "A File With Spaces.md", isDir: false },
      { name: "Zed", isDir: false },
      { name: ".hidden", isDir: true },
    ];
    expect(explorerRows(odd, false).map((row) => row.label)).toEqual([
      ".hidden/",
      "A File With Spaces.md",
      "Zed",
    ]);
  });

  test("over-cap entries drop WHOLE: no partial name, no counter, no \"more\"", () => {
    const many: DirEntry[] = Array.from({ length: LISTING_MAX_ENTRIES + 5 }, (_, index) => ({
      name: "f" + String(index).padStart(3, "0"),
      isDir: false,
    }));
    const rows = explorerRows(many, false);
    expect(rows).toHaveLength(LISTING_MAX_ENTRIES);
    expect(rows[0].label).toBe("f000");
    expect(rows[LISTING_MAX_ENTRIES - 1].label).toBe("f199");
    // Every kept row is a COMPLETE name; the dropped tails appear nowhere —
    // no partial name, no count and no "more" line standing in for them.
    for (const row of rows) expect(row.label).toMatch(/^f\d{3}$/);
    expect(rows.map((row) => row.label)).not.toContain("f200");
    expect(face({ segments: [], entries: many, problem: null })).not.toContain("more");
    // The way up is not an entry: a descended over-cap level still shows the
    // cap's whole entries plus the one row out.
    expect(explorerRows(many, true)).toHaveLength(LISTING_MAX_ENTRIES + 1);
    // Folders first, then names: a mixed level's cap still drops WHOLE rows
    // from the end of that order, never a half name.
    const mixed: DirEntry[] = Array.from({ length: LISTING_MAX_ENTRIES + 5 }, (_, index) => ({
      name: "m" + String(index).padStart(3, "0"),
      isDir: index % 2 === 0,
    }));
    const mixedRows = explorerRows(mixed, false);
    expect(mixedRows).toHaveLength(LISTING_MAX_ENTRIES);
    for (const row of mixedRows) {
      expect(row.label).toBe(row.isDir ? row.name + "/" : row.name);
    }
  });

  test("the 'up' row exists only when descended, and it climbs", () => {
    expect(explorerRows(ENTRIES, false).some((row) => row.kind === "up")).toBe(false);
    const descended = explorerRows(ENTRIES, true);
    expect(descended[0]).toEqual({
      kind: "up",
      label: "up",
      name: null,
      isDir: false,
    });
    expect(rowAction(descended[0])).toBe("ascend");
    for (const row of descended.slice(1)) expect(rowAction(row)).not.toBe("ascend");
  });

  test("the quiet path line is the path from the project root, never absolute", () => {
    expect(explorerPathLine(FOLDER, [])).toBe("attentioneer");
    expect(explorerPathLine(FOLDER, ["src", "canvas"])).toBe(
      "attentioneer/src/canvas",
    );
    expect(explorerPathLine(WINDOWS_FOLDER, ["src"])).toBe("attentioneer/src");
    for (const line of [
      explorerPathLine(FOLDER, []),
      explorerPathLine(FOLDER, ["src"]),
      explorerPathLine(WINDOWS_FOLDER, ["src"]),
    ]) {
      expect(line.startsWith("/")).toBe(false);
      expect(line).not.toContain("C:");
      expect(line).not.toContain("/home/ada");
      expect(line).not.toContain("\\");
    }
  });

  test("one entry's path joins in the folder's own convention", () => {
    expect(explorerEntryPath(FOLDER, [], "README.md")).toBe(FOLDER + "/README.md");
    expect(explorerEntryPath(FOLDER, ["src", "canvas"], "GroundLayer.tsx")).toBe(
      FOLDER + "/src/canvas/GroundLayer.tsx",
    );
    expect(explorerEntryPath(WINDOWS_FOLDER, ["src"], "main.rs")).toBe(
      WINDOWS_FOLDER + "\\" + "src" + "\\" + "main.rs",
    );
  });
});

describe("the stack is view state: down, up, and gone on close", () => {
  test("the top level is one read, and every step down is exactly one more", async () => {
    const b = bridge({
      levels: { [FOLDER]: ENTRIES, [FOLDER + "/src"]: SRC_ENTRIES },
    });
    const root = await openExplorerRoot(FOLDER, b.io);
    expect(root).toEqual({ segments: [], entries: ENTRIES, problem: null });
    expect(b.log).toEqual([FOLDER]);
    const down = await descendExplorer(root, FOLDER, "src", b.io);
    expect(down).toEqual({ segments: ["src"], entries: SRC_ENTRIES, problem: null });
    expect(b.log).toEqual([FOLDER, FOLDER + "/src"]);
    // Nothing was watched, polled or held: two gestures, two reads.
    expect(b.log).toHaveLength(2);
  });

  test("the way up pops one level and re-reads it; the root has no way up", async () => {
    const b = bridge({
      levels: { [FOLDER]: ENTRIES, [FOLDER + "/src"]: SRC_ENTRIES },
    });
    const down: ExplorerView = { segments: ["src"], entries: SRC_ENTRIES, problem: null };
    const up = await ascendExplorer(down, FOLDER, b.io);
    expect(up).toEqual({ segments: [], entries: ENTRIES, problem: null });
    expect(b.log).toEqual([FOLDER]);
    // At the root there is nothing above it: the answer is the same view, and
    // no read is spent on it.
    const atRoot = await ascendExplorer(up, FOLDER, b.io);
    expect(atRoot).toEqual(up);
    expect(b.log).toEqual([FOLDER]);
  });

  test("an unreadable level answers its sentence and keeps the stack sane", async () => {
    const b = bridge({
      levels: { [FOLDER]: ENTRIES, [FOLDER + "/alpha"]: [] },
      refuse: [FOLDER + "/alpha/broken"],
    });
    const root = await openExplorerRoot(FOLDER, b.io);
    const alpha = await descendExplorer(root, FOLDER, "alpha", b.io);
    expect(alpha.segments).toEqual(["alpha"]);
    const stuck = await descendExplorer(alpha, FOLDER, "broken", b.io);
    // The level never became where the person is: the sentence stands in
    // place over the level that DID answer, and the way back up still works.
    expect(stuck).toEqual({ segments: ["alpha"], entries: [], problem: EXPLORER_UNREACHABLE });
    const back = await ascendExplorer(stuck, FOLDER, b.io);
    expect(back).toEqual({ segments: [], entries: ENTRIES, problem: null });
  });

  test("a landing that cannot be read falls back one level, with the same honesty", async () => {
    const b = bridge({
      levels: { [FOLDER + "/src"]: SRC_ENTRIES },
      refuse: [FOLDER],
    });
    const down: ExplorerView = { segments: ["src"], entries: SRC_ENTRIES, problem: null };
    const up = await ascendExplorer(down, FOLDER, b.io);
    // The way out is ALWAYS taken — the person is never trapped in a folder
    // that went away — and the landed level says plainly it cannot be read.
    expect(up).toEqual({ segments: [], entries: [], problem: EXPLORER_UNREACHABLE });
  });

  test("a root that cannot be read says its sentence and offers no rows", async () => {
    const b = bridge({ refuse: [FOLDER] });
    expect(await openExplorerRoot(FOLDER, b.io)).toEqual({
      segments: [],
      entries: [],
      problem: EXPLORER_UNREACHABLE,
    });
  });

  test("a closing card holds no explorer at all", () => {
    expect(closeExplorer()).toBeNull();
    // And the card's own effect empties the shape when it is not open: closing
    // drops the level rather than keeping a history of where the person walked.
    const layer = source("canvas/GroundLayer.tsx");
    expect(layer).toContain("setExplorer(closeExplorer())");
  });
});

describe("a double click opens a file; a folder descends on one click", () => {
  test("the row's gesture is decided by what the row IS", () => {
    const rows = explorerRows(ENTRIES, true);
    const open = rows.filter((row) => rowAction(row) === "open");
    const down = rows.filter((row) => rowAction(row) === "descend");
    expect(open.map((row) => row.label)).toEqual([
      "README.md",
      "package.json",
      "zeta.txt",
    ]);
    expect(down.map((row) => row.label)).toEqual(["alpha/", "src/"]);
    // A directory row is NEVER an open: no single press on a folder launches
    // an app, and no press on a file launches one either.
    for (const row of down) expect(row.isDir).toBe(true);
    for (const row of open) expect(row.isDir).toBe(false);
  });

  test("the exact joined path is the one the opener is handed", async () => {
    const opened: string[] = [];
    const result = await openExplorerEntry(
      FOLDER,
      ["src", "canvas"],
      "GroundLayer.tsx",
      async (path) => {
        opened.push(path);
        return { ok: true, message: null };
      },
    );
    expect(result).toEqual({ ok: true, message: null });
    expect(opened).toEqual([FOLDER + "/src/canvas/GroundLayer.tsx"]);
  });

  test("a refused path answers the existing sentence and launches nothing else", async () => {
    let attempts = 0;
    const refused = await openFileOutward("/srv/elsewhere/notes.md", async () => {
      attempts += 1;
      throw new Error("the scope refused this path");
    });
    expect(attempts).toBe(1);
    expect(refused).toEqual({ ok: false, message: CANNOT_OPEN });
    // The explorer's own door answers the same way, and nothing was written.
    const viaExplorer = await openExplorerEntry(FOLDER, [], "README.md", async () => {
      return { ok: false, message: CANNOT_OPEN };
    });
    expect(viaExplorer).toEqual({ ok: false, message: CANNOT_OPEN });
  });

  test("the face wires the double click to files only, and the click to folders", () => {
    const faceSource = source("canvas/FolderExplorer.tsx");
    expect(faceSource).toContain('action === "open"');
    expect(faceSource).toContain("onDoubleClick");
    expect(faceSource).toContain("onClick");
    expect(faceSource).toContain("rowAction(row)");
    // A double click on a folder is still ONE descent: the second press the
    // browser reports (detail 2) is ignored, while a keyboard press
    // (detail 0) still walks in.
    expect(faceSource).toContain("event.detail < 2");
    // The opener is only ever reached through the outward door, which stays
    // the ONE call site that imports the opener plugin.
    const rules = source("canvas/explorerRules.ts");
    expect(rules).toContain("openFileOutward");
    expect(rules).not.toContain("@tauri-apps/plugin-opener");
    expect(source("canvas/outward.ts")).toContain("export async function openFileOutward");
  });
});

describe("browsing writes nothing to the map", () => {
  const RULES = source("canvas/explorerRules.ts");
  const FACE = source("canvas/FolderExplorer.tsx");
  const LAYER = source("canvas/GroundLayer.tsx");

  test("the explorer has ONE door and it only reads", () => {
    for (const forbidden of [
      "writeTextFile",
      "saveReadings",
      "saveGround",
      "removeFile",
      "removeDirAll",
      "renameFile",
      "createDirAll",
      "createMarkerExclusive",
      "readTextFile",
      "readTextHead",
      "readFileBytes",
      "fileMeta",
      "queueHistory",
      "queueMirror",
      "map/history",
      "map/mirror",
    ]) {
      expect(RULES).not.toContain(forbidden);
      expect(FACE).not.toContain(forbidden);
    }
  });

  test("no watcher, no timer, no held handle", () => {
    for (const forbidden of ["setInterval", "setTimeout", "fs.watch", "watchFile"]) {
      expect(RULES).not.toContain(forbidden);
      expect(FACE).not.toContain(forbidden);
    }
  });

  test("every outcome — read, refused, opened, refused open — touches only that door", async () => {
    const b = bridge({
      levels: { [FOLDER]: ENTRIES, [FOLDER + "/alpha"]: [] },
      refuse: [FOLDER + "/alpha/broken"],
    });
    const root = await openExplorerRoot(FOLDER, b.io);
    const alpha = await descendExplorer(root, FOLDER, "alpha", b.io);
    const stuck = await descendExplorer(alpha, FOLDER, "broken", b.io);
    await ascendExplorer(stuck, FOLDER, b.io);
    await openExplorerEntry(FOLDER, [], "README.md", async () => ({
      ok: false,
      message: CANNOT_OPEN,
    }));
    // Every path touched is a listing path under the project root: nothing
    // outside it, and nothing that is not a read.
    expect(b.log.length).toBeGreaterThan(0);
    for (const path of b.log) expect(path.startsWith(FOLDER)).toBe(true);
  });

  test("no browsing handler reaches a card verb that writes or reads a record", () => {
    const start = LAYER.indexOf("async function exploreStep");
    const end = LAYER.indexOf("function beginNoteEdit");
    const handlers = LAYER.slice(start, end);
    expect(handlers.length).toBeGreaterThan(0);
    for (const forbidden of [
      "onRefresh",
      "onTakeListing",
      "onSetNote",
      "onRepoint",
      "onRemove",
      "onPull",
      "setReadings",
      "saveReadings",
    ]) {
      expect(handlers).not.toContain(forbidden);
    }
    // The card's own reading line is not even in reach here.
    expect(handlers).not.toContain("reading");
  });

  test("the mirror and the kept line are untouched by a browse", () => {
    const reading: Reading = {
      ...folderReading(SLUG, FOLDER, TAKEN),
      bytes: 64,
      extract: "listing",
    };
    const line = serializeReadingLine(reading);
    expect(line).toContain("| extract: listing");
    expect(folderKeptProvenance(reading)).toBe(
      "the listing kept when it was read · 2026-11-19",
    );
    // Browsing lives beside the reading, not inside it: MAP.md never carries
    // an entry name, before or after any navigation.
    const view = {
      references: [reference],
      readings: [reading],
      texts: { [SLUG]: "README.md\nsrc/\n" },
      states: { [SLUG]: "current" as const },
      notes: {},
      orphanNotes: [],
      orphanMedia: [],
      links: [],
      orphanLinks: [],
      asks: [],
      sessions: [],
      sessionToolNames: {},
      sessionEndings: {},
      orphanSessionTranscripts: [],
      malformedAsks: [],
      orphanAskTurns: [],
      malformedGround: [],
      malformedReadings: [],
      malformedLinks: [],
    };
    const text = renderMirror(view);
    for (const entry of ENTRIES) expect(text).not.toContain(entry.name);
  });
});

describe("the explorer block is drawn only on an expanded folder card", () => {
  function render(card: Reading, text: string | undefined): string {
    return renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [card],
        texts: text === undefined ? {} : { [SLUG]: text },
        states: { [SLUG]: "current" },
        ...inertVerbs,
      }),
    );
  }

  test("a collapsed card has no explorer block, whatever its form", () => {
    expect(render(folderReading(SLUG, FOLDER, TAKEN), undefined)).not.toContain(
      "ground-explorer",
    );
    expect(render(folderReading(SLUG, FOLDER, TAKEN), "README.md\nsrc/\n")).not.toContain(
      "ground-explorer",
    );
  });

  test("the block is gated on the EXPANDED folder card, and on nothing else", () => {
    const layer = source("canvas/GroundLayer.tsx");
    expect(layer).toContain("{open &&\n          folderCard &&");
    expect(layer).toContain("<FolderExplorerFace");
    // It sits inside the body, BEFORE the kept reading's own slot.
    const body = layer.indexOf('<div className="ground-body"');
    const block = layer.indexOf("<FolderExplorerFace");
    const readingSlot = layer.indexOf('<div className="ground-reading" ref={readingRef}>');
    expect(body).toBeGreaterThan(-1);
    expect(block).toBeGreaterThan(body);
    expect(block).toBeLessThan(readingSlot);
  });

  test("the block shows a level's rows and the quiet path, and no absolute path", () => {
    const html = face({ segments: [], entries: ENTRIES, problem: null });
    expect(html).toContain("ground-explorer");
    expect(html).toContain("attentioneer");
    for (const entry of ENTRIES) {
      expect(html).toContain(entry.isDir ? entry.name + "/" : entry.name);
    }
    // Folders before names, on the face exactly as in the model.
    expect(html.indexOf("alpha/")).toBeLessThan(html.indexOf("README.md"));
    expect(html).not.toContain(FOLDER);
    expect(html).not.toContain("<span");
    expect(html).not.toContain("24 files");
  });

  test("a descended level puts the way up first and names the way there", () => {
    const html = face({ segments: ["src"], entries: SRC_ENTRIES, problem: null });
    expect(html).toContain("attentioneer/src");
    expect(html).toContain(">up<");
    expect(html.indexOf(">up<")).toBeLessThan(html.indexOf("canvas/"));
    expect(html).not.toContain(FOLDER);
  });

  test("a level that could not be read says its one sentence in place", () => {
    const html = face({ segments: [], entries: [], problem: EXPLORER_UNREACHABLE });
    expect(html).toContain(EXPLORER_UNREACHABLE);
    expect(html).toContain("ground-explorer-problem");
    expect(html).not.toContain("<button");
  });

  test("the kept reading is exactly what it was beside the block", () => {
    const kept: Reading = {
      ...folderReading(SLUG, FOLDER, TAKEN),
      bytes: 64,
      extract: "listing",
    };
    const listing = "README.md\nsrc/\n\nreadme:\n# A quiet map\n";
    const html = render(kept, listing);
    expect(html).toContain("src/");
    expect(html).toContain("# A quiet map");
    expect(html).toContain("the listing kept when it was read");
    expect(html).toContain("2026-11-19");
    // Collapsed, the explorer is not on the face; the kept block is.
    expect(html).not.toContain("ground-explorer");
    expect(html).toContain("ground-reading");
    // The absence line for a card with no copy is unchanged by this story.
    const bare = render(folderReading(SLUG, FOLDER, TAKEN), undefined);
    expect(bare).toContain(readingAbsenceLine("current", folderReading(SLUG, FOLDER, TAKEN)));
  });
});
