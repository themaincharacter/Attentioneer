import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FOLDER_README_HEADING,
  FOLDER_TAKE_EMPTY,
  FOLDER_TAKE_GONE,
  FOLDER_TAKE_UNREACHABLE,
  LISTING_MAX_ENTRIES,
  READING_MAX_BYTES,
  READING_MAX_LINES,
  REFRESH_SAME,
  REFRESH_UNCHANGED,
  folderReading,
  folderReadingText,
  parseReadingLine,
  parseReadings,
  refreshFolderReading,
  serializeReadingLine,
  serializeReadings,
  takeFolderReading,
  type FolderReadingIo,
  type Reading,
} from "../src/map/readings";
import { readingTakeEvent, readingRefreshEvent, serializeHistoryEvent } from "../src/map/history";
import { openFolderOutward } from "../src/canvas/outward";
import { CANNOT_OPEN } from "../src/canvas/outwardRules";
import { renderMirror } from "../src/map/mirror";
import type { GroundReference } from "../src/map/ground";
import type { DirEntry, FileMetaAnswer, TextHead } from "../src/lib/fs";

/**
 * STORY 20.1 — THE PROJECT CARD OPENS: a KEPT READING (a bounded top-level
 * listing with directories marked, plus the README's head, verbatim), an
 * explicit REFRESH that re-takes it and says "unchanged" when the bytes match,
 * and an open-in-file-explorer verb. No watchers, no held handles, no live
 * reference: the map opens and works with no project present, and the card
 * re-reads only on the person's gesture.
 *
 * The human check is "I expand my project card and it shows the folder's
 * listing and the README's head, saying when it was read. I press refresh: it
 * re-reads (or says unchanged). I press open in file explorer and the OS file
 * manager opens at the folder. I rename the folder away and reopen: the card
 * still works and says plainly what is missing." The pins below are the rules
 * under it:
 *
 *   - the text is the listing and the README's head, VERBATIM — nothing is
 *     interpreted, summarised or counted;
 *   - the caps are respected (whole entries drop; the README keeps the reading
 *     head's own caps);
 *   - the taken line round-trips (`bytes` + `extract: listing`) while an old
 *     bare folder line still parses;
 *   - refresh compares BYTES: identical bytes write NOTHING and say so;
 *   - the folder opener hands over the exact folder and answers one sentence
 *     when the OS (or the capability) refuses — and writes nothing;
 *   - MAP.md never carries a word of the listing.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(relative: string): string {
  return readFileSync(APP_DIR + "src/" + relative, "utf8");
}

const SLUG = "attentioneer";
const FOLDER = "/home/ada/code/attentioneer";
const TAKEN = "2026-11-19T09:00:00.000Z";
const LATER = "2026-11-19T10:30:00.000Z";

const reference: GroundReference = { on: SLUG, name: "Attentioneer", x: 40, y: 60 };

const ENTRIES: DirEntry[] = [
  { name: "zeta.txt", isDir: false },
  { name: "src", isDir: true },
  { name: "README.md", isDir: false },
  { name: "alpha", isDir: true },
  { name: "package.json", isDir: false },
];

const README_HEAD = "# Attentioneer\n\nA map of attention.\n";

const LISTING = [
  "README.md",
  "alpha/",
  "package.json",
  "src/",
  "zeta.txt",
].join("\n");

const EXPECTED = LISTING + "\n\n" + FOLDER_README_HEADING + "\n" + README_HEAD;

const FOLDER_META: FileMetaAnswer = {
  kind: "facts",
  exists: true,
  is_file: false,
  len: null,
  modified_ms: null,
};

const MISSING_META: FileMetaAnswer = {
  kind: "facts",
  exists: false,
  is_file: false,
  len: null,
  modified_ms: null,
};

/** A folder reading's fakes: one bridge set, recording every write and read. */
function folderIo(options: {
  entries?: DirEntry[];
  meta?: FileMetaAnswer;
  readme?: string | null;
  oldText?: string | null;
  listThrows?: boolean;
} = {}): {
  io: FolderReadingIo;
  log: string[];
  writes: { path: string; content: string }[];
  heads: { path: string; maxLines: number; maxBytes: number }[];
} {
  const log: string[] = [];
  const writes: { path: string; content: string }[] = [];
  const heads: { path: string; maxLines: number; maxBytes: number }[] = [];
  const io: FolderReadingIo = {
    async readTextFile() {
      return options.oldText ?? null;
    },
    async readTextHead(path, maxLines, maxBytes): Promise<TextHead> {
      heads.push({ path, maxLines, maxBytes });
      const exists = options.readme !== null && options.readme !== undefined;
      return {
        head: exists ? (options.readme as string) : "",
        truncated: false,
        exists,
        size: exists ? (options.readme as string).length : null,
        mtime: null,
        decode: "clean",
      };
    },
    async writeTextFile(path, content) {
      writes.push({ path, content });
      log.push("text");
    },
    async createDirAll() {
      log.push("dir");
    },
    async fileMeta() {
      return options.meta ?? FOLDER_META;
    },
    async readFileBytes() {
      return { kind: "refused", code: "io" };
    },
    async pdfText() {
      return null;
    },
    async listDirEntries() {
      if (options.listThrows === true) throw new Error("cannot list");
      return options.entries ?? ENTRIES;
    },
  };
  return { io, log, writes, heads };
}

function takenReading(text: string, when = TAKEN): Reading {
  return {
    ...folderReading(SLUG, FOLDER, when),
    bytes: new TextEncoder().encode(text).length,
    extract: "listing",
  };
}

describe("the folder reading's text is the place's own words", () => {
  test("the listing sorts, marks folders with a slash and keeps names verbatim", () => {
    const text = folderReadingText(ENTRIES, null);
    expect(text).toBe(LISTING);
    expect(text.split("\n")).toEqual([
      "README.md",
      "alpha/",
      "package.json",
      "src/",
      "zeta.txt",
    ]);
  });

  test("the README's head follows under the quiet heading, byte for byte", () => {
    const text = folderReadingText(ENTRIES, README_HEAD);
    expect(text).toBe(EXPECTED);
    // VERBATIM: the head's own blank line, capitals and punctuation survive.
    expect(text).toContain(README_HEAD);
    expect(text.endsWith(FOLDER_README_HEADING + "\n" + README_HEAD)).toBe(
      true,
    );
  });

  test("nothing is interpreted: only names, slashes and the one heading", () => {
    const text = folderReadingText(ENTRIES, README_HEAD);
    const extra = text
      .split("\n")
      .filter((line) => !ENTRIES.some((entry) => line === (entry.isDir ? entry.name + "/" : entry.name)))
      .filter((line) => line !== "" && line !== FOLDER_README_HEADING && !README_HEAD.includes(line));
    // Every line is a verbatim name, the heading, or a line the README itself
    // carries. No sentence of the app's own is invented above the words.
    expect(extra).toEqual([]);
    for (const invented of ["summary", "this project", "contents", "described", "verified"]) {
      expect(text).not.toContain(invented);
    }
  });

  test("over-cap entries DROP whole, in name order, with nothing invented about them", () => {
    const many: DirEntry[] = Array.from({ length: LISTING_MAX_ENTRIES + 5 }, (_, index) => ({
      name: "f" + String(index).padStart(3, "0"),
      isDir: index % 2 === 0,
    }));
    const text = folderReadingText(many, null);
    const lines = text.split("\n");
    expect(lines).toHaveLength(LISTING_MAX_ENTRIES);
    expect(lines[0]).toBe("f000/");
    expect(lines[LISTING_MAX_ENTRIES - 1]).toBe("f199");
    // Whole entries only: every kept line is a complete name, and the dropped
    // ones (f200..f204) appear nowhere — no partial name and no "more".
    for (const line of lines) expect(line).toMatch(/^f\d{3}\/?$/);
    expect(text).not.toContain("f" + String(LISTING_MAX_ENTRIES).padStart(3, "0"));
    expect(text).not.toContain("more");
  });

  test("no README keeps the listing alone; no listing and no README is empty", () => {
    expect(folderReadingText(ENTRIES, null)).not.toContain(FOLDER_README_HEADING);
    expect(folderReadingText(ENTRIES, "")).not.toContain(FOLDER_README_HEADING);
    expect(folderReadingText([], README_HEAD)).toBe(
      FOLDER_README_HEADING + "\n" + README_HEAD,
    );
    expect(folderReadingText([], null)).toBe("");
  });
});

describe("the taken folder line round-trips beside the bare one", () => {
  test("an untouched folder card's line stays exactly the bare shape", () => {
    const bare = folderReading(SLUG, FOLDER, TAKEN);
    expect(serializeReadingLine(bare)).toBe(
      "on: " + SLUG + " | form: folder | from: " + FOLDER + " | taken: " + TAKEN,
    );
    expect(parseReadingLine(serializeReadingLine(bare))).toEqual(bare);
  });

  test("a taken folder line carries bytes and extract: listing, and re-parses", () => {
    const reading = takenReading(EXPECTED);
    const line = serializeReadingLine(reading);
    expect(line).toContain("| bytes: " + reading.bytes);
    expect(line).toContain("| extract: listing");
    expect(parseReadingLine(line)).toEqual(reading);
    expect(parseReadings(serializeReadings([reading])).readings).toEqual([reading]);
  });

  test("an OLD bare line still parses beside a new taken one", () => {
    const parsed = parseReadings(
      serializeReadings([
        folderReading(SLUG, FOLDER, TAKEN),
        takenReading(EXPECTED),
      ]),
    );
    expect(parsed.malformed).toEqual([]);
    expect(parsed.readings).toHaveLength(2);
    expect(parsed.readings[0].extract).toBeUndefined();
    expect(parsed.readings[1].extract).toBe("listing");
  });

  test("a listing on a file line is refused, kept and reported", () => {
    const line =
      "on: " + SLUG + " | form: path | from: notes.md | taken: " + TAKEN +
      " | bytes: 4 | extract: listing";
    expect(parseReadingLine(line)).toBeNull();
    expect(parseReadings(line).malformed).toEqual([line]);
  });
});

describe("taking a folder reading keeps the place's own words", () => {
  test("the listing and the README head land in the reading's text file", async () => {
    const fake = folderIo({ readme: README_HEAD });
    const result = await takeFolderReading("/w/garden", SLUG, FOLDER, fake.io, TAKEN);
    expect(result.kind).toBe("taken");
    if (result.kind !== "taken") return;
    expect(result.text).toBe(EXPECTED);
    expect(result.reading).toEqual(takenReading(EXPECTED));
    // The text file is written first, under the reading's own name.
    expect(fake.log[0]).toBe("dir");
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].path.endsWith(SLUG + ".md")).toBe(true);
    expect(fake.writes[0].content).toBe(EXPECTED);
    // The README is read with the SAME caps a text head uses.
    expect(fake.heads).toHaveLength(1);
    expect(fake.heads[0].path).toBe(FOLDER + "/README.md");
    expect(fake.heads[0].maxLines).toBe(READING_MAX_LINES);
    expect(fake.heads[0].maxBytes).toBe(READING_MAX_BYTES);
  });

  test("a folder with no README keeps its listing, and no heading is invented", async () => {
    const fake = folderIo({ readme: null });
    const result = await takeFolderReading("/w/garden", SLUG, FOLDER, fake.io, TAKEN);
    expect(result.kind).toBe("taken");
    if (result.kind !== "taken") return;
    expect(result.text).toBe(LISTING);
    expect(result.text).not.toContain(FOLDER_README_HEADING);
  });

  test("a folder that is not there writes NOTHING and answers one sentence", async () => {
    const fake = folderIo({ meta: MISSING_META });
    const result = await takeFolderReading("/w/garden", SLUG, FOLDER, fake.io, TAKEN);
    expect(result).toEqual({ kind: "refused", message: FOLDER_TAKE_GONE });
    expect(fake.writes).toEqual([]);
  });

  test("a listing that cannot be taken writes NOTHING and answers one sentence", async () => {
    const refused = folderIo({ listThrows: true });
    expect(await takeFolderReading("/w/garden", SLUG, FOLDER, refused.io, TAKEN)).toEqual({
      kind: "refused",
      message: FOLDER_TAKE_UNREACHABLE,
    });
    expect(refused.writes).toEqual([]);
    const aFile = folderIo({
      meta: { kind: "facts", exists: true, is_file: true, len: 3, modified_ms: null },
    });
    expect(await takeFolderReading("/w/garden", SLUG, FOLDER, aFile.io, TAKEN)).toEqual({
      kind: "refused",
      message: FOLDER_TAKE_UNREACHABLE,
    });
  });

  test("an empty folder refuses rather than pretending an empty reading", async () => {
    const fake = folderIo({ entries: [], readme: null });
    expect(await takeFolderReading("/w/garden", SLUG, FOLDER, fake.io, TAKEN)).toEqual({
      kind: "refused",
      message: FOLDER_TAKE_EMPTY,
    });
    expect(fake.writes).toEqual([]);
  });
});

describe("refresh compares the kept text with the new one, by bytes", () => {
  test("identical bytes write NOTHING and answer the unchanged sentence", async () => {
    const fake = folderIo({ readme: README_HEAD, oldText: EXPECTED });
    const result = await refreshFolderReading(
      "/w/garden",
      takenReading(EXPECTED),
      fake.io,
      LATER,
    );
    expect(result.kind).toBe("same");
    if (result.kind !== "same") return;
    expect(result.message).toBe(REFRESH_SAME);
    // The comparison wrote nothing at all: no text, no directory, no line.
    expect(fake.writes).toEqual([]);
    expect(fake.log).toEqual([]);
    // The "unchanged" sentence is NOT the refused read's sentence.
    expect(REFRESH_SAME).not.toBe(REFRESH_UNCHANGED);
  });

  test("changed bytes rewrite the text and answer a new stamped line", async () => {
    const fake = folderIo({ readme: README_HEAD, oldText: "the older listing\n" });
    const before = takenReading(EXPECTED);
    const result = await refreshFolderReading("/w/garden", before, fake.io, LATER);
    expect(result.kind).toBe("taken");
    if (result.kind !== "taken") return;
    expect(result.reading.taken).toBe(LATER);
    expect(result.reading.extract).toBe("listing");
    expect(result.reading.bytes).toBe(new TextEncoder().encode(EXPECTED).length);
    expect(result.reading.from).toBe(FOLDER);
    expect(fake.writes).toHaveLength(1);
    expect(fake.writes[0].content).toBe(EXPECTED);
  });

  test("a folder that is gone keeps the old copy and answers one sentence", async () => {
    const fake = folderIo({ meta: MISSING_META, oldText: EXPECTED });
    const result = await refreshFolderReading(
      "/w/garden",
      takenReading(EXPECTED),
      fake.io,
      LATER,
    );
    expect(result).toEqual({ kind: "refused", message: FOLDER_TAKE_GONE });
    expect(fake.writes).toEqual([]);
  });
});

describe("the reading's history is the existing vocabulary", () => {
  const HOOK = readFileSync(APP_DIR + "src/canvas/useGround.ts", "utf8");

  test("the expand take logs reading.take and the refresh logs reading.refresh", () => {
    const take = HOOK.slice(
      HOOK.indexOf("const takeListing = useCallback"),
      HOOK.indexOf("\n  const ", HOOK.indexOf("const takeListing = useCallback") + 1),
    );
    expect(take).toContain("readingTakeEvent");
    expect(take).toContain("queueMirror()");
    const refresh = HOOK.slice(
      HOOK.indexOf("const refresh = useCallback"),
      HOOK.indexOf("const repoint = useCallback"),
    );
    expect(refresh).toContain("refreshFolderReading");
    expect(refresh).toContain("readingRefreshEvent");
    expect(refresh).toContain("queueMirror()");
    // NO new event kinds: both lines are the two the log already has.
    expect(take).not.toContain("readingListing");
    expect(refresh).not.toContain("readingListing");
    expect(serializeHistoryEvent(readingTakeEvent(1, SLUG, "folder", 12))).toContain(
      '"type":"reading.take"',
    );
    expect(serializeHistoryEvent(readingRefreshEvent(1, SLUG, "folder", 12))).toContain(
      '"type":"reading.refresh"',
    );
  });
});

describe("MAP.md never carries a word of the listing", () => {
  const view = {
    references: [reference],
    readings: [takenReading(EXPECTED)],
    texts: { [SLUG]: EXPECTED },
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

  test("the row names the folder and its state, and no entry name leaks", () => {
    const text = renderMirror(view);
    expect(text).toContain("folder: attentioneer");
    for (const entry of ENTRIES) {
      expect(text).not.toContain(entry.name);
    }
    expect(text).not.toContain(FOLDER_README_HEADING);
    expect(text).not.toContain("A map of attention");
    // The row's one sentence says the place is elsewhere and not owned.
    expect(text).toContain("a folder elsewhere; this workspace does not own it");
    // And it is a folder row, never a reading line.
    expect(text).not.toContain("reading: README");
  });

  test("a gone folder's row still says its state and never the listing", () => {
    const text = renderMirror({ ...view, states: { [SLUG]: "missing" as const } });
    expect(text).toContain("state: the folder is not there");
    for (const entry of ENTRIES) expect(text).not.toContain(entry.name);
  });
});

describe("the folder opens in the system's file manager, or says it cannot", () => {
  test("the exact folder is handed to the opener; nothing is written", async () => {
    const opened: string[] = [];
    const result = await openFolderOutward(FOLDER, async (path) => {
      opened.push(path);
    });
    expect(result).toEqual({ ok: true, message: null });
    expect(opened).toEqual([FOLDER]);
  });

  test("a refused path answers the existing sentence and launches nothing", async () => {
    let attempts = 0;
    const result = await openFolderOutward(FOLDER, async () => {
      attempts += 1;
      throw new Error("the scope refused this path");
    });
    expect(attempts).toBe(1);
    expect(result).toEqual({ ok: false, message: CANNOT_OPEN });
  });

  test("one call site: only the outward module imports the opener plugin", () => {
    const outward = source("canvas/outward.ts");
    expect(outward).toContain('from "@tauri-apps/plugin-opener"');
    expect(outward).toContain("export async function openFolderOutward");
    expect(outward).toContain("= openPath");
    // No writer and no fallback shell in the outward door.
    expect(outward).not.toContain("writeTextFile");
    expect(outward).not.toContain("Command");
    // The card's verb only asks that one door.
    const layer = source("canvas/GroundLayer.tsx");
    expect(layer).toContain("openFolderOutward(reading.from)");
    expect(layer).toContain('className="ground-open-folder"');
    expect(layer).toContain("open in file explorer");
  });

  test("the capability's scope is the one authority: $HOME and /mnt/c only", () => {
    const capability = readFileSync(
      APP_DIR + "src-tauri/capabilities/default.json",
      "utf8",
    );
    expect(capability).toContain('"opener:allow-open-path"');
    expect(capability).toContain('"$HOME/**"');
    expect(capability).toContain('"/mnt/c/**"');
  });
});
