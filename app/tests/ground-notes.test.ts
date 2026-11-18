import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { GroundLayer } from "../src/canvas/GroundLayer";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  GROUND_NOTE_REMOVAL_REFUSAL,
  removeGroundNote,
  removeGroundRecords,
} from "../src/canvas/useGround";
import {
  groundPath,
  loadGround,
  saveGround,
  type GroundReference,
} from "../src/map/ground";
import {
  loadReadings,
  readingTextPath,
  readingsPath,
  saveReadings,
  type Reading,
} from "../src/map/readings";
import {
  NOTE_MAX_BYTES,
  NOTE_NO_CARD,
  NOTE_PREVIEW_LINES,
  NOTE_TOO_LONG,
  loadNote,
  loadNotes,
  noteByteLength,
  notePath,
  notesDir,
  saveNote,
  type NoteIo,
} from "../src/map/notes";
import { previewText, READING_PREVIEW_LINES } from "../src/map/readings";

/**
 * Story 16.6 — the card gets a NOTE: the person's own words, one file beside
 * the reading and never mixed into it.
 *
 * The story's check is human ("type a note, click away, restart: it is there
 * above the reading; edit a word and it is saved; remove the note and the card
 * is back to its name, reading and file name — the reading byte-identical
 * throughout"). This file pins the rules underneath it:
 *
 *   - the record: `map/notes/<slug>.md`, one plain-text file, byte-exact
 *     in and out (newlines and `|` included);
 *   - no note file = no note; saving empty text REMOVES the file;
 *   - an over-cap note refuses with ONE sentence and writes NOTHING;
 *   - a note NEVER writes to readings.txt, readings/<slug>.md, ground.txt,
 *     the links or any concept record — proved by snapshotting the workspace;
 *   - an orphan note is REPORTED, never adopted and never deleted;
 *   - deleting a card removes its note in the same queued pass, after the
 *     reference line and before the links' cascade;
 *   - the small face crops the note to `NOTE_PREVIEW_LINES` above the reading
 *     crop; the expanded face has the whole note and the in-place editor.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the crop, the edit's verbs, the
 * note's face and the byte cap.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const LAYER = source("canvas/GroundLayer.tsx");
const NOTES = source("map/notes.ts");
const HOOK = source("canvas/useGround.ts");
const APP = source("App.tsx");
const CSS = source("canvas/canvas.css");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-notes-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

/** The record's real bridges, bound to node's fs so a test needs no Tauri. */
const fsIo: NoteIo = {
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
  listDir: async (path) => {
    try {
      return readdirSync(path);
    } catch {
      return [];
    }
  },
  removeFile: async (path) => {
    try {
      rmSync(path);
    } catch (error) {
      if ((error as { code?: string }).code !== "ENOENT") throw error;
    }
  },
};

/** Every file in the workspace, relative to its root, with exact bytes. */
function snapshotFiles(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const rel of readdirSync(root, { recursive: true, encoding: "utf8" })) {
    const path = join(root, rel);
    try {
      files[rel.replaceAll("\\", "/")] = readFileSync(path, "utf8");
    } catch {
      // A directory: not a file, not a snapshot entry.
    }
  }
  return files;
}

const reference: GroundReference = {
  on: "rain-gauge",
  name: "Rain gauge",
  x: 40,
  y: 60,
};
const reading: Reading = {
  on: "rain-gauge",
  form: "path",
  from: "notes/gauge.txt",
  taken: "2026-11-17T12:00:00.000Z",
  bytes: 260,
};
/** The reading record's fake bridges (a test never loads pdf.js or Tauri). */
const readingIo = {
  readTextFile: fsIo.readTextFile,
  readTextHead: async () => {
    throw new Error("unused");
  },
  writeTextFile: fsIo.writeTextFile,
  createDirAll: fsIo.createDirAll,
  fileMeta: async () => ({ kind: "refused" as const }),
  readFileBytes: async () => ({ kind: "refused" as const, code: "io" as const }),
  pdfText: async () => ({ kind: "refused" as const, message: "unused" }),
};

const groundIo = {
  readTextFile: fsIo.readTextFile,
  writeTextFile: fsIo.writeTextFile,
};

const MALFORMED_GROUND = "this ground line is not a reference";
const MALFORMED_READINGS = "a broken readings line";
const LINK_LINE = "from: rain-gauge | to: sea\n";
const LONG_READING = Array.from({ length: 10 }, (_, i) => "line " + (i + 1)).join(
  "\n",
);

describe("the record: one plain-text file per note, byte-exact", () => {
  test("save then load round-trips bytes, newlines, pipes and trailing space", async () => {
    const workspace = freshWorkspace();
    // The note is authored text, not a line-record: pipes, blank lines and
    // trailing whitespace all survive exactly.
    const text = "first thought\nsecond | with a pipe\n\n  indented and spaced  \n";
    const saved = await saveNote(workspace, "rain-gauge", text, fsIo);
    expect(saved).toEqual({ kind: "saved", text });
    expect(readFileSync(notePath(workspace, "rain-gauge"), "utf8")).toBe(text);
    expect(await loadNote(workspace, "rain-gauge", fsIo)).toBe(text);
    // A hand edit reads back as written, with no rewriting on load.
    writeFileSync(notePath(workspace, "rain-gauge"), "by hand\r\nsecond\r\n");
    expect(await loadNote(workspace, "rain-gauge", fsIo)).toBe(
      "by hand\r\nsecond\r\n",
    );
  });

  test("the file lives at map/notes/<slug>.md, keyed by the reading's slug", () => {
    const workspace = "/tmp/example";
    expect(notesDir(workspace)).toBe("/tmp/example/map/notes");
    expect(notePath(workspace, "rain-gauge")).toBe(
      "/tmp/example/map/notes/rain-gauge.md",
    );
    // The path is the reading's idiom, one folder over: the slug joins them.
    expect(notePath(workspace, "rain-gauge")).toContain("rain-gauge");
  });

  test("no file means no note; an empty file is no note either", async () => {
    const workspace = freshWorkspace();
    expect(await loadNote(workspace, "rain-gauge", fsIo)).toBeNull();
    mkdirSync(notesDir(workspace), { recursive: true });
    writeFileSync(notePath(workspace, "rain-gauge"), "");
    expect(await loadNote(workspace, "rain-gauge", fsIo)).toBeNull();
  });

  test("saving empty text REMOVES the file (no empty note, no placeholder)", async () => {
    const workspace = freshWorkspace();
    await saveNote(workspace, "rain-gauge", "some words", fsIo);
    expect(existsSync(notePath(workspace, "rain-gauge"))).toBe(true);
    expect(await saveNote(workspace, "rain-gauge", "", fsIo)).toEqual({
      kind: "removed",
    });
    expect(existsSync(notePath(workspace, "rain-gauge"))).toBe(false);
    expect(await loadNote(workspace, "rain-gauge", fsIo)).toBeNull();
    // Whitespace-only is silence too: a note of spaces is not a note.
    await saveNote(workspace, "rain-gauge", "words", fsIo);
    expect(await saveNote(workspace, "rain-gauge", "  \n\t ", fsIo)).toEqual({
      kind: "removed",
    });
    expect(existsSync(notePath(workspace, "rain-gauge"))).toBe(false);
    // Removing a note that never existed is the same quiet no-op.
    expect(await saveNote(workspace, "never-had-one", "", fsIo)).toEqual({
      kind: "removed",
    });
  });

  test("an over-cap note refuses with ONE sentence and writes nothing", async () => {
    const writes: string[] = [];
    let directories = 0;
    const recording: NoteIo = {
      ...fsIo,
      createDirAll: async () => {
        directories += 1;
      },
      writeTextFile: async (path) => {
        writes.push(path);
      },
    };
    const workspace = freshWorkspace();
    const tooLong = "x".repeat(NOTE_MAX_BYTES + 1);
    const result = await saveNote(workspace, "rain-gauge", tooLong, recording);
    expect(result).toEqual({ kind: "refused", message: NOTE_TOO_LONG });
    expect(NOTE_TOO_LONG).not.toMatch(/\b(error|failed|limit)\b/);
    expect(writes).toEqual([]);
    expect(directories).toBe(0);
    expect(existsSync(notePath(workspace, "rain-gauge"))).toBe(false);
    // The cap counts UTF-8 BYTES, not characters.
    expect(noteByteLength("é")).toBe(2);
    expect(noteByteLength("x".repeat(NOTE_MAX_BYTES))).toBe(NOTE_MAX_BYTES);
    const exact = "x".repeat(NOTE_MAX_BYTES);
    expect(await saveNote(workspace, "rain-gauge", exact, fsIo)).toEqual({
      kind: "saved",
      text: exact,
    });
  });

  test("a note with no slug refuses rather than manufacturing a path", async () => {
    const workspace = freshWorkspace();
    expect(await saveNote(workspace, "  ", "words", fsIo)).toEqual({
      kind: "refused",
      message: NOTE_NO_CARD,
    });
  });
});

describe("the split: a note never touches the reading or any other record", () => {
  test("the workspace's other files are byte-identical after a note save", async () => {
    const workspace = freshWorkspace();
    await saveGround(workspace, [reference], [MALFORMED_GROUND], groundIo);
    await saveReadings(workspace, [reading], [MALFORMED_READINGS], readingIo);
    mkdirSync(dirname(readingTextPath(workspace, "rain-gauge")), {
      recursive: true,
    });
    writeFileSync(
      readingTextPath(workspace, "rain-gauge"),
      LONG_READING + "\n",
      "utf8",
    );
    // A link and a concept record sit beside them; both must stay untouched.
    mkdirSync(join(workspace, "map", "references"), { recursive: true });
    writeFileSync(join(workspace, "map", "references", "rain.md"), "concept");
    writeFileSync(join(workspace, "map", "ground-links.txt"), LINK_LINE);

    const before = snapshotFiles(workspace);
    await saveNote(workspace, "rain-gauge", "my own words | two\nlines", fsIo);
    const after = snapshotFiles(workspace);

    // The ONLY new/changed path is the note's own file.
    const changed = Object.keys(after).filter(
      (path) => before[path] !== after[path],
    );
    expect(changed).toEqual(["map/notes/rain-gauge.md"]);
    // And the families the note must never write are exactly as they were.
    for (const path of [
      "map/readings.txt",
      "map/readings/rain-gauge.md",
      "map/ground.txt",
      "map/ground-links.txt",
      "map/references/rain.md",
    ]) {
      expect(after[path]).toBe(before[path]);
    }
    // Removing the note changes nothing except removing the note file.
    await saveNote(workspace, "rain-gauge", "", fsIo);
    const removed = snapshotFiles(workspace);
    expect(Object.keys(removed).sort()).toEqual(
      Object.keys(before).sort(),
    );
    for (const path of Object.keys(before)) {
      expect(removed[path]).toBe(before[path]);
    }
  });

  test("the notes module never names a reading, ground or concept record", () => {
    const code = NOTES.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    for (const forbidden of [
      "readings.txt",
      "readings/",
      "ground.txt",
      "ground-links",
      "references/",
      "distances",
    ]) {
      expect({ forbidden, found: code.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
    // The reading's own module is not even imported: the split is structural.
    expect(NOTES).not.toContain('from "./readings"');
  });

  test("setNote is the one write path, and it only calls saveNote", () => {
    const setNote = HOOK.slice(HOOK.indexOf("const setNote = useCallback"));
    expect(setNote).toContain("saveNote(workspacePath, on, text)");
    expect(setNote).toContain("queueRef.current");
    // A slug the map no longer carries refuses: no orphan is manufactured.
    expect(setNote).toContain("there is no card to hold that note.");
  });
});

describe("the orphan: reported, never adopted, never deleted", () => {
  test("a note whose card is gone is listed and its file is kept", async () => {
    const workspace = freshWorkspace();
    mkdirSync(notesDir(workspace), { recursive: true });
    writeFileSync(notePath(workspace, "rain-gauge"), "still mine");
    writeFileSync(notePath(workspace, "gone-card"), "no card now");
    writeFileSync(join(notesDir(workspace), "stray.txt"), "not a note");

    const loaded = await loadNotes(workspace, ["rain-gauge"], fsIo);
    expect(loaded.notes).toEqual({ "rain-gauge": "still mine" });
    expect(loaded.orphans).toEqual(["gone-card"]);
    // The orphan is NOT adopted and NOT deleted.
    expect(loaded.notes["gone-card"]).toBeUndefined();
    expect(readFileSync(notePath(workspace, "gone-card"), "utf8")).toBe(
      "no card now",
    );
    // A file that is not .md is not a note at all.
    expect(loaded.orphans).not.toContain("stray");
  });

  test("nothing exists for a fresh workspace; no folder is an error", async () => {
    const workspace = freshWorkspace();
    expect(await loadNotes(workspace, ["rain-gauge"], fsIo)).toEqual({
      notes: {},
      orphans: [],
    });
    expect(existsSync(notesDir(workspace))).toBe(false);
  });

  test("the notices group names an orphan note under the ground heading", () => {
    expect(APP).toContain("orphanGroundNotes");
    expect(APP).toContain("has no card");
    expect(APP).toContain("map/notes/");
    expect(APP).toContain("orphanGroundNotes.length > 0");
  });
});

describe("the delete: the note goes with the card, in the queue", () => {
  const other: GroundReference = { on: "sea", name: "Sea", x: 10, y: 20 };

  test("the note file leaves after the reference line and the reading text", async () => {
    const workspace = freshWorkspace();
    await saveGround(
      workspace,
      [reference, other],
      [MALFORMED_GROUND],
      groundIo,
    );
    await saveReadings(workspace, [reading], [MALFORMED_READINGS], readingIo);
    mkdirSync(dirname(readingTextPath(workspace, "rain-gauge")), {
      recursive: true,
    });
    writeFileSync(readingTextPath(workspace, "rain-gauge"), "the reading");
    await saveNote(workspace, "rain-gauge", "my note", fsIo);
    writeFileSync(join(workspace, "map", "ground-links.txt"), LINK_LINE);

    const references = (await loadGround(workspace, groundIo)).references;
    const readings = (await loadReadings(workspace, readingIo)).readings;
    const removal = await removeGroundRecords(
      workspace,
      "rain-gauge",
      references,
      readings,
      [MALFORMED_GROUND],
      [MALFORMED_READINGS],
      {
        saveGround: (path, refs, malformed) =>
          saveGround(path, refs, malformed ?? [], groundIo),
        saveReadings: (path, refs, malformed) =>
          saveReadings(path, refs, malformed ?? [], readingIo),
        removeFile: fsIo.removeFile,
      },
    );
    expect(removal.refusal).toBeNull();
    expect(await removeGroundNote(workspace, "rain-gauge", fsIo)).toBeNull();

    expect(existsSync(notePath(workspace, "rain-gauge"))).toBe(false);
    expect(existsSync(readingTextPath(workspace, "rain-gauge"))).toBe(false);
    expect(readFileSync(groundPath(workspace), "utf8")).toBe(
      "on: sea | name: Sea | x: 10 | y: 20\n" + MALFORMED_GROUND + "\n",
    );
    expect(readFileSync(readingsPath(workspace), "utf8")).toBe(
      MALFORMED_READINGS + "\n",
    );
    // The links are another family: the delete's own cascade leaves them here.
    expect(readFileSync(join(workspace, "map", "ground-links.txt"), "utf8")).toBe(
      LINK_LINE,
    );
  });

  test("the hook's order is reference -> reading -> note -> links, in one pass", () => {
    const remove = HOOK.slice(HOOK.indexOf("const remove = useCallback"));
    const groundAt = remove.indexOf("removeGroundRecords(");
    const noteAt = remove.indexOf("removeGroundNote(");
    const linksAt = remove.indexOf("saveGroundLinks(");
    expect(groundAt).toBeGreaterThan(-1);
    expect(noteAt).toBeGreaterThan(groundAt);
    expect(linksAt).toBeGreaterThan(noteAt);
    // The whole cascade is inside the same queued write.
    expect(remove).toContain("queueRef.current");
  });

  test("a refused note unlink is ONE sentence and keeps the note", async () => {
    const workspace = freshWorkspace();
    await saveNote(workspace, "rain-gauge", "my note", fsIo);
    const refusing: NoteIo = {
      ...fsIo,
      removeFile: async () => {
        throw new Error("EPERM");
      },
    };
    expect(await removeGroundNote(workspace, "rain-gauge", refusing)).toBe(
      GROUND_NOTE_REMOVAL_REFUSAL,
    );
    expect(GROUND_NOTE_REMOVAL_REFUSAL).not.toMatch(
      /\b(error|failed|EPERM)\b/,
    );
    expect(existsSync(notePath(workspace, "rain-gauge"))).toBe(true);
  });
});

describe("the card: the note above the reading, cropped, editable in place", () => {
  const inertVerbs = {
    onMove: async () => ({ ok: true as const }),
    onRefresh: async () => ({ ok: true as const }),
    onRepoint: async () => ({ ok: true as const }),
    onRemove: async () => ({ ok: true as const }),
  };
  const note = "note line one\nnote line two\nnote line three";

  test("the small face shows two note lines above the reading crop", () => {
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [reading],
        texts: { "rain-gauge": LONG_READING },
        notes: { "rain-gauge": note },
        states: { "rain-gauge": "current" },
        ...inertVerbs,
      }),
    );
    expect(NOTE_PREVIEW_LINES).toBe(2);
    expect(html).toContain("ground-note");
    expect(html).toContain("note line two…");
    // Only the FACE is cropped: the note's third line is not on the small card.
    expect(html).not.toContain("note line three");
    // And the note reads ABOVE the reading.
    expect(html.indexOf("ground-note")).toBeLessThan(
      html.indexOf("ground-reading"),
    );
    // The reading's own crop is untouched.
    expect(html).toContain("line 6…");
    expect(READING_PREVIEW_LINES).toBe(6);
    expect(previewText(note, NOTE_PREVIEW_LINES)).toBe(
      "note line one\nnote line two…",
    );
  });

  test("a card with no note renders none (no empty note element)", () => {
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [reading],
        texts: { "rain-gauge": LONG_READING },
        states: { "rain-gauge": "current" },
        ...inertVerbs,
      }),
    );
    expect(html).not.toContain("ground-note");
    expect(html).toContain("line 6…");
  });

  test("the expanded face has the whole note and the in-place editor", () => {
    // The expanded face is view state, so the source is the proof: open shows
    // the stored text, the small face crops it, the editor replaces it.
    // (Story 16.7 moved the face into `GroundNote`, which crops with the same
    // pure rule and keeps a mention's chip whole; `null` is the whole note.)
    expect(LAYER).toContain("<GroundNote");
    // STORY 17: the note's crop reads the person's STATED count.
    expect(LAYER).toContain("maxLines={open ? null : noteLines}");
    expect(LAYER).toContain("ground-note-edit");
    expect(LAYER).toContain("ground-note-done");
    expect(LAYER).toContain("ground-note-editor");
    expect(LAYER).toContain("<textarea");
    // Enter inserts a newline: no key handler swallows Enter.
    expect(LAYER).not.toContain('e.key === "Enter"');
    // Esc abandons and restores the stored note.
    expect(LAYER).toContain("cancelNoteEdit");
    expect(LAYER).toContain('e.key !== "Escape"');
    // A press away and the done verb both save; an abandoned edit writes none.
    expect(LAYER).toContain("saveNoteDraft");
    expect(LAYER).toContain("if (editingRef.current) void saveNoteDraft()");
    // The layer still does no I/O of its own: saving is the prop.
    expect(LAYER).toContain("onSetNote");
  });

  test("the note classes are content to the plane's gate", () => {
    for (const name of [
      "ground-note",
      "ground-note-edit",
      "ground-note-done",
      "ground-note-editor",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
  });

  test("the note's face and editor are styled, distinct from the reading", () => {
    expect(CSS).toContain(".ground-note {");
    expect(CSS).toContain(".ground-note-editor {");
    // Story 16.7 turned the note into a normal block (a mention chip is an
    // INLINE button in the sentence, which the legacy box clamp would blockify);
    // the crop guard is a max-height now, and the expanded face lifts it.
    expect(CSS).toMatch(
      /\.ground-reference\.expanded \.ground-note \{[^}]*max-height: none/s,
    );
    // A different body voice: the note is serif, the reading stays sans.
    expect(CSS).toMatch(/\.ground-note \{[^}]*font-family: Georgia/s);
    expect(CSS).not.toMatch(/\.ground-reading \{[^}]*font-family: Georgia/s);
  });

  test("App hands the notes to the layer and the orphans to the notices", () => {
    expect(APP).toContain("notes={ground.notes}");
    expect(APP).toContain("onSetNote={ground.setNote}");
    expect(APP).toContain("orphanGroundNotes={ground.orphanNotes}");
  });

  test("the ground map still renders no concept content", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("no counter, word count, autosave prompt or markdown renderer", () => {
    const code = (LAYER + NOTES + CSS).replace(
      /\/\*[\s\S]*?\*\//g,
      "",
    );
    for (const forbidden of [
      "wordCount",
      "word count",
      "character count",
      "autosav",
      "markdown",
    ]) {
      expect({ forbidden, found: code.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
  });
});
