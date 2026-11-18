import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { FileMetaAnswer, TextHead } from "../src/lib/fs";
import {
  beginGroundDrag,
  dropGroundDrag,
  GROUND_DRAG_THRESHOLD,
  moveGroundDrag,
} from "../src/canvas/groundDrag";
import {
  groundPath,
  loadGround,
  moveGroundReference,
  saveGround,
  type GroundIo,
  type GroundReference,
} from "../src/map/ground";
import {
  readingAbsolutePath,
  readingStateWord,
  readingTextPath,
  refreshReading,
  resolveReadingState,
  saveReadings,
  serializeReadingLine,
  takeReading,
  type Reading,
  type ReadingIo,
} from "../src/map/readings";

/**
 * Story 16.2 — the reading can go STALE, and the map says so honestly.
 *
 * The story's check is human ("rename the file, reopen, the reference still
 * shows the lines it took and says the file has changed; rename it back, press
 * refresh, the note clears"). This file pins the rules underneath it:
 *
 *   - the five states are COMPUTED from metadata at load and never stored, and
 *     `changed` is a size/time claim (never "the text differs");
 *   - refresh is the only re-read, writes the text file FIRST and the line
 *     LAST, and a refused re-point writes nothing at all (both files stay
 *     byte-identical);
 *   - a drag commits ONE point on release, through one line write.
 *
 * PROVISIONAL (the story's decisions, before an ADR): the state names and
 * words, the form rule, the drag threshold and the write order.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-stale-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

const TAKEN = "2026-11-17T12:00:00.000Z";
const TAKEN_MS = Date.parse(TAKEN);

/** A reading line, by default a current one (bytes and time both agree). */
function reading(overrides: Partial<Reading> = {}): Reading {
  return {
    on: "rain-gauge",
    form: "path",
    from: "notes/gauge.txt",
    taken: TAKEN,
    bytes: 100,
    ...overrides,
  };
}

/** Metadata facts with the pieces a test cares about. */
function facts(overrides: Partial<{
  exists: boolean;
  is_file: boolean;
  len: number | null;
  modified_ms: number | null;
}> = {}): FileMetaAnswer {
  return {
    kind: "facts",
    exists: true,
    is_file: true,
    len: 100,
    modified_ms: TAKEN_MS - 1000,
    ...overrides,
  };
}

const NOW = TAKEN_MS + 60_000;

describe("the five states are computed from metadata, never stored", () => {
  test("a regular file whose size and time agree is current", () => {
    expect(resolveReadingState(reading(), facts(), NOW)).toBe("current");
  });

  test("no reading line is unread", () => {
    expect(resolveReadingState(null, null, NOW)).toBe("unread");
    // Even if a text file somehow exists, no line means nothing was recorded.
    expect(resolveReadingState(null, facts(), NOW)).toBe("unread");
  });

  test("a missing path is missing; a non-file or a refused stat is unreadable", () => {
    expect(
      resolveReadingState(reading(), facts({ exists: false, len: null, modified_ms: null }), NOW),
    ).toBe("missing");
    expect(
      resolveReadingState(reading(), facts({ is_file: false, len: null, modified_ms: null }), NOW),
    ).toBe("unreadable");
    expect(resolveReadingState(reading(), { kind: "refused" }, NOW)).toBe(
      "unreadable",
    );
  });

  test("changed is the SIZE differing, or the mtime newer than taken", () => {
    // Size moved: the metadata claim, not a text claim.
    expect(
      resolveReadingState(reading(), facts({ len: 101 }), NOW),
    ).toBe("changed");
    // Time moved past the reading.
    expect(
      resolveReadingState(reading(), facts({ modified_ms: TAKEN_MS + 1 }), NOW),
    ).toBe("changed");
    // Exactly at the reading's moment is not "newer".
    expect(
      resolveReadingState(reading(), facts({ modified_ms: TAKEN_MS }), NOW),
    ).toBe("current");
    // Same size, older time: current.
    expect(
      resolveReadingState(reading(), facts({ modified_ms: TAKEN_MS - 5 }), NOW),
    ).toBe("current");
  });

  test("a legacy line without bytes skips the size half but keeps the time", () => {
    const legacy = reading({ bytes: undefined });
    expect(resolveReadingState(legacy, facts({ len: 9999 }), NOW)).toBe(
      "current",
    );
    expect(
      resolveReadingState(legacy, facts({ modified_ms: TAKEN_MS + 1 }), NOW),
    ).toBe("changed");
  });

  test("clock skew: a taken in the future trusts only the size half", () => {
    const future = reading({ taken: "2099-01-01T00:00:00.000Z" });
    // The file's mtime is "newer" only because the record's clock is ahead:
    // the map must not claim a change it cannot order.
    expect(resolveReadingState(future, facts({ modified_ms: NOW }), NOW)).toBe(
      "current",
    );
    expect(resolveReadingState(future, facts({ len: 101 }), NOW)).toBe(
      "changed",
    );
  });

  test("the state word is quiet, exact and never a text claim", () => {
    expect(readingStateWord("current")).toBeNull();
    // STORY 16.13 (shortlist item 10): the kept-copy clause is part of the
    // state word, so a person is told what the words on screen are.
    expect(readingStateWord("changed")).toBe(
      "the file has changed since this reading; this is the copy kept when it was added",
    );
    expect(readingStateWord("missing")).toBe(
      "the file is gone; this is the copy kept when it was added",
    );
    expect(readingStateWord("unreadable")).toBe("the file cannot be read");
    expect(readingStateWord("unread")).toBe("no reading taken yet");
    for (const word of ["changed", "missing", "unreadable", "unread"] as const) {
      expect(readingStateWord(word)).not.toMatch(/\b(the text|differs|modified)\b/i);
      expect(readingStateWord(word)).not.toMatch(/\d/);
    }
  });

  test("no state word can enter a record through the writer", () => {
    const line = serializeReadingLine(reading());
    expect(line).not.toMatch(/current|changed|missing|unreadable|unread/);
    const groundLine = serializeReadingLine(
      reading({ on: "rain", from: "notes/a.txt" }),
    );
    expect(groundLine).not.toMatch(/\| state:/);
  });
});

/** An IO double that records every write, in order (and still hits node fs). */
function recordingIo(log: string[]): ReadingIo {
  const io: ReadingIo = {
    readTextFile: async (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    readFileBytes: async (path) => {
      try {
        return { kind: "bytes", bytes: new Uint8Array(readFileSync(path)) };
      } catch {
        return { kind: "refused", code: "cannot-reach" as const };
      }
    },
    pdfText: async () => {
      throw new Error("this fake reads no PDFs");
    },
    readTextHead: async (path, maxLines, maxBytes): Promise<TextHead> => {
      let bytes: Buffer;
      try {
        bytes = readFileSync(path);
      } catch {
        return {
          head: "",
          truncated: false,
          exists: false,
          size: null,
          mtime: null,
          decode: "clean",
        };
      }
      const text = bytes.toString("utf8");
      const lines = text.split(/\n/);
      const head = lines.slice(0, maxLines).join("\n");
      return {
        head: head.length > maxBytes ? head.slice(0, maxBytes) : head,
        truncated: false,
        exists: true,
        size: bytes.length,
        mtime: null,
        decode: "clean",
      };
    },
    writeTextFile: async (path, content) => {
      log.push(path.endsWith("readings.txt") ? "line" : "text");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    },
    createDirAll: async (path) => {
      mkdirSync(path, { recursive: true });
    },
    fileMeta: async (path) => {
      try {
        const stat = statSync(path);
        return {
          kind: "facts",
          exists: true,
          is_file: stat.isFile(),
          len: stat.isFile() ? stat.size : null,
          modified_ms: Math.floor(stat.mtimeMs),
        };
      } catch {
        return {
          kind: "facts",
          exists: false,
          is_file: false,
          len: null,
          modified_ms: null,
        };
      }
    },
  };
  return io;
}

/** The ground records' fake bridge, logging writes too. */
function recordingGroundIo(log: string[]): GroundIo {
  return {
    readTextFile: async (path) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    writeTextFile: async (path, content) => {
      log.push("ground");
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    },
  };
}

describe("refresh is the only re-read, and it writes text first, line last", () => {
  test("a refresh rewrites the text, then the caller's line (in that order)", async () => {
    const workspace = freshWorkspace();
    const source = join(workspace, "gauge.txt");
    writeFileSync(source, "one\n", "utf8");
    const first = await takeReading(workspace, "rain", source, recordingIo([]), TAKEN);
    if (first.kind !== "taken") throw new Error("expected a reading");

    writeFileSync(source, "one\ntwo\n", "utf8");
    const log: string[] = [];
    const io = recordingIo(log);
    const refreshed = await refreshReading(workspace, first.reading, io, TAKEN);
    if (refreshed.kind !== "taken") throw new Error("expected a reading");
    expect(log).toEqual(["text"]);
    await saveReadings(workspace, [refreshed.reading], [], io);
    // The line lands AFTER the text: a crash can never leave a line pointing
    // at text that is not there.
    expect(log).toEqual(["text", "line"]);
    expect(readFileSync(readingTextPath(workspace, "rain"), "utf8")).toBe(
      "one\ntwo\n",
    );
  });

  test("a refused refresh keeps the old reading and writes nothing", async () => {
    const workspace = freshWorkspace();
    const source = join(workspace, "gauge.txt");
    writeFileSync(source, "kept\n", "utf8");
    const first = await takeReading(workspace, "rain", source, recordingIo([]), TAKEN);
    if (first.kind !== "taken") throw new Error("expected a reading");
    rmSync(source);

    const log: string[] = [];
    const refused = await refreshReading(workspace, first.reading, recordingIo(log));
    expect(refused.kind).toBe("refused");
    expect(log).toEqual([]);
    expect(readFileSync(readingTextPath(workspace, "rain"), "utf8")).toBe(
      "kept\n",
    );
  });
});

describe("a refused re-point leaves both files byte-identical", () => {
  test("the pick's refusal writes neither the text nor the line", async () => {
    const workspace = freshWorkspace();
    const source = join(workspace, "gauge.txt");
    writeFileSync(source, "kept\n", "utf8");
    const io = recordingIo([]);
    const first = await takeReading(workspace, "rain", source, io, TAKEN);
    if (first.kind !== "taken") throw new Error("expected a reading");
    await saveReadings(workspace, [first.reading], [], io);
    // A ground line beside it, so "both files" means both ground families.
    const ground = [{ on: "rain", name: "Rain gauge", x: 40, y: 60 }];
    await saveGround(workspace, ground, [], recordingGroundIo([]));

    const before = {
      readings: readFileSync(join(workspace, "map", "readings.txt"), "utf8"),
      text: readFileSync(readingTextPath(workspace, "rain"), "utf8"),
      ground: readFileSync(groundPath(workspace), "utf8"),
    };
    const log: string[] = [];
    const refused = await takeReading(
      workspace,
      "rain",
      join(workspace, "absent.txt"),
      recordingIo(log),
    );
    expect(refused.kind).toBe("refused");
    expect(log).toEqual([]);
    expect(readFileSync(join(workspace, "map", "readings.txt"), "utf8")).toBe(
      before.readings,
    );
    expect(readFileSync(readingTextPath(workspace, "rain"), "utf8")).toBe(
      before.text,
    );
    expect(readFileSync(groundPath(workspace), "utf8")).toBe(before.ground);
    expect(existsSync(join(workspace, "map", "readings.txt"))).toBe(true);
  });
});

describe("a drag commits one point, on release, through one line write", () => {
  test("below the threshold is a press: no drop, no write", () => {
    const drag = beginGroundDrag({ x: 10, y: 20 }, { x: 100, y: 100 }, 1);
    const tiny = moveGroundDrag(drag, { x: 102, y: 102 });
    expect(tiny.moved).toBe(false);
    expect(dropGroundDrag(tiny)).toEqual([]);
    expect(GROUND_DRAG_THRESHOLD).toBeGreaterThan(0);
  });

  test("past the threshold the world point follows the camera's zoom", () => {
    const drag = beginGroundDrag({ x: 10, y: 20 }, { x: 100, y: 100 }, 2);
    const moved = moveGroundDrag(drag, { x: 110, y: 100 });
    expect(moved.moved).toBe(true);
    expect(moved.at).toEqual({ x: 15, y: 20 });
    // Every later move updates the live point but never adds a second commit:
    // the drop answers ONE point, whatever the trail did.
    const later = moveGroundDrag(moved, { x: 120, y: 120 });
    expect(dropGroundDrag(later)).toEqual([{ x: 20, y: 30 }]);
  });

  test("the move rewrites exactly one line, in place, on one write", async () => {
    const workspace = freshWorkspace();
    const log: string[] = [];
    const io = recordingGroundIo(log);
    const references: GroundReference[] = [
      { on: "rain", name: "Rain gauge", x: 10, y: 20 },
      { on: "sea", name: "Sea", x: 30, y: 40 },
    ];
    await saveGround(workspace, references, ["an unreadable line"], io);
    log.length = 0;

    const moved = moveGroundReference(references, "rain", 15.4, 19.6);
    await saveGround(workspace, moved, ["an unreadable line"], io);
    expect(log).toEqual(["ground"]);
    expect(moved).toEqual([
      { on: "rain", name: "Rain gauge", x: 15, y: 20 },
      { on: "sea", name: "Sea", x: 30, y: 40 },
    ]);
    // The other line and the preserved unreadable line are byte-identical.
    expect(readFileSync(groundPath(workspace), "utf8")).toBe(
      "on: rain | name: Rain gauge | x: 15 | y: 20\n" +
        "on: sea | name: Sea | x: 30 | y: 40\n" +
        "an unreadable line\n",
    );
    // The state of the file on disk is exactly what a later load computes.
    const loaded = await loadGround(workspace, io);
    expect(loaded.references).toEqual(moved);
    expect(loaded.malformed).toEqual(["an unreadable line"]);
  });

  test("a reading's absolute path resolves for the stat, legacy included", () => {
    expect(readingAbsolutePath("/w", reading({ from: "notes/a.txt" }))).toBe(
      "/w/notes/a.txt",
    );
    expect(
      readingAbsolutePath("/w", reading({ form: "at", from: "C:\\x\\a.txt" })),
    ).toBe("C:\\x\\a.txt");
  });
});
