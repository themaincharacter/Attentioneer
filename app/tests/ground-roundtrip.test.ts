import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { clipHead } from "../src/lib/headBounds";
import type { TextHead } from "../src/lib/fs";
import {
  addGroundReference,
  groundPath,
  loadGround,
  parseGround,
  parseGroundLine,
  saveGround,
  serializeGround,
  serializeGroundLine,
  type GroundIo,
} from "../src/map/ground";
import {
  isAbsolutePath,
  isInsideWorkspace,
  loadReadingTexts,
  parseReadingLine,
  parseReadings,
  readingAbsolutePath,
  readingFileName,
  readingFormFor,
  readingTextPath,
  readingsPath,
  READING_MAX_LINES,
  READING_REFUSALS,
  refreshReading,
  serializeReadingLine,
  serializeReadings,
  takeReading,
  type ReadingIo,
} from "../src/map/readings";
import { GROUND_RECORD_FILE } from "../src/map/records";

/**
 * Story 16.1's record guarantee, automated: a ground reference (a coined name
 * at a point) and its reading (a pointed-at text file's opening lines) are
 * written into the workspace's `map/` folder and rebuilt from it alone.
 *
 * The story's check is human ("type a name, pick a file, quit, reopen"); this
 * file pins the record half: canonical bytes, a byte-identical rewrite, the
 * name-derived deduped slug, malformed lines preserved AND reported (ADR-0009),
 * and a reading that refuses with one sentence instead of creating a
 * half-formed reference.
 *
 * PROVISIONAL (the story's record shapes, before an ADR): the line shapes, the
 * 64-line / 8 KiB cap and the ISO timestamp.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-ground-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

/** The real bridges, backed by node fs on the temp dir (no Tauri runtime). */
const groundIo: GroundIo = {
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
};

/** The ground io plus the bridge's head read, its stat and the folder bridge. */
const readingIo: ReadingIo = {
  ...groundIo,
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
    const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    const bounded = clipHead(text, maxLines, maxBytes);
    return {
      head: bounded.head,
      truncated: bounded.truncated,
      exists: true,
      size: bytes.length,
      mtime: null,
      decode: "clean",
    };
  },
};

describe("the ground line's canonical bytes", () => {
  test("one reference is on: slug | name | x | y, LF, one trailing newline", () => {
    expect(
      serializeGroundLine({
        on: "rain-gauge",
        name: "Rain gauge",
        x: 40,
        y: 61,
      }),
    ).toBe("on: rain-gauge | name: Rain gauge | x: 40 | y: 61");
    expect(
      serializeGround([
        { on: "rain-gauge", name: "Rain gauge", x: 40, y: 61 },
      ]),
    ).toBe("on: rain-gauge | name: Rain gauge | x: 40 | y: 61\n");
    expect(serializeGround([])).toBe("\n");
  });

  test("the person's name is exact, including the separator", () => {
    const reference = {
      on: "rain-or-snow",
      name: "rain | snow",
      x: -3,
      y: 0,
    };
    const line = serializeGroundLine(reference);
    expect(parseGroundLine(line)).toEqual(reference);
    // A decimal coordinate is out of the provisional line shape: kept, never
    // silently rounded by the READ (the writer is the only rounder).
    expect(
      parseGroundLine("on: rain | name: Rain | x: 1.5 | y: 2"),
    ).toBeNull();
  });

  test("a missing key or an empty name is malformed, never guessed", () => {
    expect(parseGroundLine("on: rain | name: Rain | x: 1")).toBeNull();
    expect(
      parseGroundLine("on: rain | name:   | x: 1 | y: 2"),
    ).toBeNull();
    expect(parseGroundLine("name: Rain | on: rain | x: 1 | y: 2")).toBeNull();
  });
});

describe("a ground reference is rebuilt from the map folder alone", () => {
  test("add, write, re-read: byte-identical on a temp dir", async () => {
    const workspace = freshWorkspace();
    const added = addGroundReference([], "Rain gauge", 40.4, 60.6);
    // The slug is the coined name's; coordinates are whole map units.
    expect(added.reference).toEqual({
      on: "rain-gauge",
      name: "Rain gauge",
      x: 40,
      y: 61,
    });
    expect(groundPath(workspace)).toBe(
      workspace + "/map/" + GROUND_RECORD_FILE.ground,
    );

    await saveGround(workspace, added.references, [], groundIo);
    const bytes = readFileSync(groundPath(workspace), "utf8");
    expect(bytes).toBe("on: rain-gauge | name: Rain gauge | x: 40 | y: 61\n");

    const loaded = await loadGround(workspace, groundIo);
    expect(loaded).toEqual({ references: added.references, malformed: [] });
    // A rewrite from the read is byte-identical (no normalization drift).
    await saveGround(workspace, loaded.references, loaded.malformed, groundIo);
    expect(readFileSync(groundPath(workspace), "utf8")).toBe(bytes);
  });

  test("a second coined name dedupes the slug the concept map's way", async () => {
    const workspace = freshWorkspace();
    const first = addGroundReference([], "Rain gauge", 10, 20);
    const second = addGroundReference(first.references, "Rain gauge", 30, 40);
    expect(second.reference.on).toBe("rain-gauge-2");
    await saveGround(workspace, second.references, [], groundIo);
    const loaded = await loadGround(workspace, groundIo);
    expect(loaded.references.map((reference) => reference.on)).toEqual([
      "rain-gauge",
      "rain-gauge-2",
    ]);
  });

  test("an unreadable line is reported AND re-emitted verbatim", async () => {
    const workspace = freshWorkspace();
    const text =
      "on: rain | name: Rain | x: 10 | y: 20\n" +
      "this line is not a ground reference\n" +
      "on: sea | name: Sea | x: 1 | y: 2\n";
    writeFileSync(groundPath(workspace), text, "utf8");
    const parsed = await loadGround(workspace, groundIo);
    expect(parsed.references.map((reference) => reference.on)).toEqual([
      "rain",
      "sea",
    ]);
    expect(parsed.malformed).toEqual(["this line is not a ground reference"]);
    // The writer keeps the unknown line VERBATIM (the known records first, the
    // preserved lines after — the pointers' file rule): surfaced, never
    // silently dropped (ADR-0009).
    const rewritten = serializeGround(parsed.references, parsed.malformed);
    expect(rewritten).toBe(
      "on: rain | name: Rain | x: 10 | y: 20\n" +
        "on: sea | name: Sea | x: 1 | y: 2\n" +
        "this line is not a ground reference\n",
    );
    await saveGround(workspace, parsed.references, parsed.malformed, groundIo);
    expect(readFileSync(groundPath(workspace), "utf8")).toBe(rewritten);
  });

  test("a missing file means no ground references", async () => {
    expect(await loadGround(freshWorkspace(), groundIo)).toEqual({
      references: [],
      malformed: [],
    });
  });
});

describe("the reading line and its text", () => {
  test("one reading is on | form | from | taken, and round-trips", () => {
    const reading = {
      on: "rain-gauge",
      form: "path" as const,
      from: "/home/k/Documents/gauge.txt",
      taken: "2026-11-16T12:00:00.000Z",
    };
    const line = serializeReadingLine(reading);
    expect(line).toBe(
      "on: rain-gauge | form: path | from: /home/k/Documents/gauge.txt | taken: 2026-11-16T12:00:00.000Z",
    );
    expect(parseReadingLine(line)).toEqual(reading);
    expect(parseReadings(line + "\n").readings).toEqual([reading]);
  });

  test("an unknown form or a missing field is malformed, never guessed", () => {
    expect(
      parseReadingLine(
        "on: rain | form: url | from: https://x | taken: 2026-11-16T12:00:00.000Z",
      ),
    ).toBeNull();
    expect(parseReadingLine("on: rain | form: path | from: x")).toBeNull();
    expect(
      parseReadingLine("on: rain | form: path | from: x | taken: "),
    ).toBeNull();
  });

  test("malformed reading lines are preserved beside their reading", () => {
    const text =
      "on: rain | form: path | from: /x/gauge.txt | taken: 2026-11-16T12:00:00.000Z\n" +
      "a broken line\n";
    const parsed = parseReadings(text);
    expect(parsed.readings).toHaveLength(1);
    expect(parsed.malformed).toEqual(["a broken line"]);
    expect(serializeReadings(parsed.readings, parsed.malformed)).toBe(text);
    expect(readingsPath("/maps/garden")).toBe("/maps/garden/map/readings.txt");
  });
});

describe("taking a reading: the head verbatim, or one sentence", () => {
  test("the first 64 lines or 8 KiB are written beside the map, byte-exact", async () => {
    const workspace = freshWorkspace();
    const source = join(ROOT, "gauge.txt");
    const text = "first line\r\nsecond line   \n";
    writeFileSync(source, text, "utf8");
    const result = await takeReading(
      workspace,
      "rain-gauge",
      source,
      readingIo,
      "2026-11-16T12:00:00.000Z",
    );
    expect(result.kind).toBe("taken");
    if (result.kind !== "taken") throw new Error("expected a reading");
    // The text is the head as read, never canonicalized.
    expect(result.text).toBe(text);
    expect(readFileSync(readingTextPath(workspace, "rain-gauge"), "utf8")).toBe(
      text,
    );
    // Story 16.2's form rule: the temp source lives OUTSIDE this workspace, so
    // it is stored as the machine-local `at` with its absolute value. The
    // head's size is stamped beside `taken` (the staleness fact).
    expect(result.reading).toEqual({
      on: "rain-gauge",
      form: "at",
      from: source,
      taken: "2026-11-16T12:00:00.000Z",
      bytes: text.length,
    });
    // The cap is the story's provisional 64 lines / 8 KiB (a hypothesis, not a
    // rule): a longer file is cut at the 64th line's newline.
    const longSource = join(ROOT, "long.txt");
    const longText = Array.from(
      { length: READING_MAX_LINES + 6 },
      (_, index) => "line " + (index + 1),
    ).join("\n") + "\n";
    writeFileSync(longSource, longText, "utf8");
    const capped = await takeReading(
      workspace,
      "capped",
      longSource,
      readingIo,
      "2026-11-16T12:00:00.000Z",
    );
    expect(READING_MAX_LINES).toBe(64);
    expect(capped.kind).toBe("taken");
    if (capped.kind !== "taken") throw new Error("expected a reading");
    expect(capped.text).toBe(
      Array.from(
        { length: READING_MAX_LINES },
        (_, index) => "line " + (index + 1) + "\n",
      ).join(""),
    );
    expect(capped.text).not.toContain("line 65");
    expect(readFileSync(readingTextPath(workspace, "capped"), "utf8")).toBe(
      capped.text,
    );
  });

  test("a binary file is refused with the bridge's sentence; nothing is written", async () => {
    const workspace = freshWorkspace();
    const refusing: ReadingIo = {
      ...readingIo,
      readTextHead: async () => {
        throw { code: "not-text" };
      },
    };
    const result = await takeReading(
      workspace,
      "rain-gauge",
      "/picked/file.bin",
      refusing,
    );
    expect(result).toEqual({
      kind: "refused",
      message: READING_REFUSALS["not-text"],
    });
    expect(() =>
      readFileSync(readingTextPath(workspace, "rain-gauge"), "utf8"),
    ).toThrow();
  });

  test("an absent file is refused; the reference is never half-formed", async () => {
    const workspace = freshWorkspace();
    const result = await takeReading(
      workspace,
      "rain-gauge",
      join(ROOT, "absent.txt"),
      readingIo,
    );
    expect(result).toEqual({
      kind: "refused",
      message: READING_REFUSALS.absent,
    });
    expect(await loadReadingTexts(workspace, ["rain-gauge"], readingIo)).toEqual(
      {},
    );
  });

  test("only the file's NAME is the plane's handle", () => {
    expect(readingFileName("/home/k/Documents/gauge.txt")).toBe("gauge.txt");
    expect(readingFileName("C:\\Users\\k\\gauge.txt")).toBe("gauge.txt");
    expect(readingFileName("gauge.txt")).toBe("gauge.txt");
  });
});

describe("story 16.2: bytes in the line are tolerant, and the form follows the pick", () => {
  test("a line with bytes round-trips; a legacy line is unknown, never rewritten", () => {
    const fresh = {
      on: "rain-gauge",
      form: "path" as const,
      from: "notes/gauge.txt",
      taken: "2026-11-17T12:00:00.000Z",
      bytes: 128,
    };
    expect(serializeReadingLine(fresh)).toBe(
      "on: rain-gauge | form: path | from: notes/gauge.txt | taken: 2026-11-17T12:00:00.000Z | bytes: 128",
    );
    expect(parseReadingLine(serializeReadingLine(fresh))).toEqual(fresh);

    // A story-1 line has no bytes tail: unknown size, and serializing it back
    // must not invent one (no load-time migration).
    const legacy = parseReadingLine(
      "on: rain-gauge | form: path | from: notes/gauge.txt | taken: 2026-11-17T12:00:00.000Z",
    );
    expect(legacy).toEqual({
      on: "rain-gauge",
      form: "path",
      from: "notes/gauge.txt",
      taken: "2026-11-17T12:00:00.000Z",
    });
    expect(legacy?.bytes).toBeUndefined();
    expect(serializeReadingLine(legacy!)).toBe(
      "on: rain-gauge | form: path | from: notes/gauge.txt | taken: 2026-11-17T12:00:00.000Z",
    );

    // `at` is a reading form now; `url` is not one in this story.
    expect(
      parseReadingLine(
        "on: rain | form: at | from: C:\\Users\\k\\gauge.txt | taken: 2026-11-17T12:00:00.000Z",
      ),
    ).toEqual({
      on: "rain",
      form: "at",
      from: "C:\\Users\\k\\gauge.txt",
      taken: "2026-11-17T12:00:00.000Z",
    });
    expect(
      parseReadingLine(
        "on: rain | form: url | from: https://x | taken: 2026-11-17T12:00:00.000Z",
      ),
    ).toBeNull();
  });

  test("inside the workspace stores path/relative; outside stores at/absolute", () => {
    expect(readingFormFor("/w/garden", "/w/garden/notes/a.txt")).toEqual({
      form: "path",
      from: "notes/a.txt",
    });
    expect(readingFormFor("/w/garden", "/home/k/Documents/a.txt")).toEqual({
      form: "at",
      from: "/home/k/Documents/a.txt",
    });
    // A sibling whose name merely STARTS with the workspace's is outside.
    expect(readingFormFor("/w/garden", "/w/garden-2/a.txt").form).toBe("at");
    expect(isInsideWorkspace("/w/garden/", "/w/garden/notes/a.txt")).toBe(true);
    expect(isAbsolutePath("/x")).toBe(true);
    expect(isAbsolutePath("C:\\x")).toBe(true);
    expect(isAbsolutePath("notes/a.txt")).toBe(false);
  });

  test("a legacy absolute path is read as absolute and left exactly as written", () => {
    const legacy = {
      on: "rain",
      form: "path" as const,
      from: "/home/k/Documents/gauge.txt",
      taken: "2026-11-16T12:00:00.000Z",
    };
    expect(readingAbsolutePath("/w/garden", legacy)).toBe(
      "/home/k/Documents/gauge.txt",
    );
    expect(serializeReadingLine(legacy)).not.toContain("/w/garden");
    expect(
      readingAbsolutePath("/w/garden", {
        ...legacy,
        form: "at",
        from: "C:\\Users\\k\\gauge.txt",
      }),
    ).toBe("C:\\Users\\k\\gauge.txt");
    expect(
      readingAbsolutePath("/w/garden", { ...legacy, from: "notes/gauge.txt" }),
    ).toBe("/w/garden/notes/gauge.txt");
  });

  test("a refresh re-takes the same file and keeps the line's form and value", async () => {
    const workspace = freshWorkspace();
    const source = join(workspace, "notes.txt");
    writeFileSync(source, "one\ntwo\n", "utf8");
    const first = await takeReading(
      workspace,
      "rain",
      source,
      readingIo,
      "2026-11-16T12:00:00.000Z",
    );
    if (first.kind !== "taken") throw new Error("expected a reading");
    expect(first.reading.form).toBe("path");
    expect(first.reading.from).toBe("notes.txt");

    writeFileSync(source, "one\ntwo\nthree\n", "utf8");
    const refreshed = await refreshReading(
      workspace,
      first.reading,
      readingIo,
      "2026-11-17T12:00:00.000Z",
    );
    if (refreshed.kind !== "taken") throw new Error("expected a reading");
    // Same form and value: the file did not move, so nothing is migrated.
    expect(refreshed.reading.form).toBe("path");
    expect(refreshed.reading.from).toBe("notes.txt");
    expect(refreshed.reading.taken).toBe("2026-11-17T12:00:00.000Z");
    expect(refreshed.reading.bytes).toBe(14);
    expect(refreshed.text).toBe("one\ntwo\nthree\n");
    expect(readFileSync(readingTextPath(workspace, "rain"), "utf8")).toBe(
      "one\ntwo\nthree\n",
    );
  });
});
