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
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  DELETE_IS_IMMEDIATE,
  GroundEmpty,
  GroundLayer,
  GROUND_EMPTY_SENTENCE,
  readingAbsenceLine,
  readingKind,
} from "../src/canvas/GroundLayer";
import {
  GroundToast,
  RESTORE_SENTENCE,
} from "../src/canvas/GroundToast";
import { CONTENT_CLASSES } from "../src/canvas/gates";
import {
  pendingRestoreAfter,
  removeGroundLinksNaming,
  removeGroundRecords,
  RESTORE_WINDOW_MS,
  restoreGroundCard,
  restoreSentence,
  type GroundRemovalIo,
  type GroundRestoreIo,
  type RemovedCard,
} from "../src/canvas/useGround";
import {
  groundPath,
  loadGround,
  saveGround,
  type GroundIo,
  type GroundReference,
} from "../src/map/ground";
import {
  groundLinksPath,
  loadGroundLinks,
  saveGroundLinks,
  type GroundLink,
} from "../src/map/groundLinks";
import {
  restoreThumb,
  saveMedia,
} from "../src/map/media";
import {
  notePath,
  restoreNote,
  saveNote,
} from "../src/map/notes";
import {
  readingTextPath,
  readingsPath,
  restoreReadingText,
  saveReadings,
  readingStateWord,
  REFRESH_UNCHANGED,
  type Reading,
} from "../src/map/readings";

/**
 * STORY 16.13 — the map explains itself.
 *
 * The story's check is human ("delete a card that has a note and two links: it
 * goes at once and a bar says it was deleted with Restore; press Restore and
 * the card, its note and both links come back in place, and the log has one
 * line for the delete and one for the restore"). This file pins the rules
 * underneath it:
 *
 *   - the delete READS the removed texts BEFORE it unlinks, and Restore writes
 *     the SAME BYTES back (compared with `toBe`, never "contains");
 *   - one pending restore: a second delete commits the first;
 *   - the log records BOTH moves — a silent restore is a bug;
 *   - a partial restore answers ONE sentence naming what came back and what did
 *     not;
 *   - the empty map is one muted sentence with no verb;
 *   - a refused/absent reading still renders with the card's three-line
 *     grammar;
 *   - a selection says what it is and why its file verbs are absent;
 *   - a refused refresh says the old reading still stands;
 *   - the toast carries no countdown, counter or nudge.
 *
 * PROVISIONAL: the toast's wording and 10 s window, the empty/absence sentences,
 * the restore event's name and the partial-restore sentence.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const HOOK = source("canvas/useGround.ts");
const LAYER = source("canvas/GroundLayer.tsx");
const TOAST = source("canvas/GroundToast.tsx");
const CSS = source("canvas/canvas.css");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-restore-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map", "readings"), { recursive: true });
  mkdirSync(join(path, "map", "notes"), { recursive: true });
  return path;
}

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

const TAKEN = "2026-11-17T12:00:00.000Z";
const REFERENCE: GroundReference = {
  on: "rain-gauge",
  name: "Rain gauge",
  x: 40,
  y: 60,
};
const OTHER: GroundReference = { on: "soil", name: "Soil", x: 400, y: 60 };
const READING: Reading = {
  on: "rain-gauge",
  form: "path",
  from: "notes/gauge.txt",
  taken: TAKEN,
  bytes: 123,
};
/** Odd whitespace: every byte must come back exactly. */
const READING_TEXT = "  first line\n\n\ttabbed,  two spaces \nlast line\n";
const NOTE_TEXT = "the person's note\n\nwith  two spaces and a tab\t\n";
const LINKS: GroundLink[] = [
  { from: "rain-gauge", to: "soil" },
  { from: "soil", to: "rain-gauge" },
  { from: "soil", to: "other" },
];
const MALFORMED_GROUND = "not a ground line";
const MALFORMED_READINGS = "not a reading line";
const MALFORMED_LINKS = "not a link line";

/** Seed the card the way the app's own writes did, byte for byte. */
async function seed(workspace: string) {
  await saveGround(workspace, [REFERENCE, OTHER], [MALFORMED_GROUND], groundIo);
  await saveReadings(workspace, [READING], [MALFORMED_READINGS], {
    ...groundIo,
    createDirAll: async (path) => mkdirSync(path, { recursive: true }),
    fileMeta: async () => ({
      kind: "facts",
      exists: true,
      is_file: true,
      len: 123,
      modified_ms: Date.parse(TAKEN) - 1,
    }),
    readFileBytes: async () => ({ kind: "refused", code: "cannot-reach" }),
    pdfText: async () => {
      throw new Error("no pdf here");
    },
    readTextHead: async () => ({
      head: "",
      truncated: false,
      exists: false,
      size: null,
      mtime: null,
      decode: "clean",
    }),
  });
  writeFileSync(readingTextPath(workspace, "rain-gauge"), READING_TEXT, "utf8");
  writeFileSync(notePath(workspace, "rain-gauge"), NOTE_TEXT, "utf8");
  await saveGroundLinks(workspace, LINKS, [MALFORMED_LINKS], groundIo);
}

/** All five files a card owns, exactly as they are on disk. */
function bytesOf(workspace: string): Record<string, string> {
  return {
    ground: readFileSync(groundPath(workspace), "utf8"),
    readings: readFileSync(readingsPath(workspace), "utf8"),
    readingText: readFileSync(readingTextPath(workspace, "rain-gauge"), "utf8"),
    note: readFileSync(notePath(workspace, "rain-gauge"), "utf8"),
    links: readFileSync(groundLinksPath(workspace), "utf8"),
  };
}

/** The delete's real bridges, logging WHICH piece moved and when. */
function removalIo(log: string[]): GroundRemovalIo {
  return {
    saveGround: async (workspace, references, malformed) => {
      log.push("save-ground");
      await saveGround(workspace, references, malformed ?? [], groundIo);
    },
    saveReadings: async (workspace, readings, malformed) => {
      log.push("save-readings");
      await saveReadings(workspace, readings, malformed ?? [], groundIo as never);
    },
    removeFile: async (path) => {
      log.push("unlink");
      try {
        rmSync(path);
      } catch (error) {
        if ((error as { code?: string }).code !== "ENOENT") throw error;
      }
    },
    readTextFile: async (path) => {
      log.push(path.includes("notes") ? "read-note" : "read-reading-text");
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
  };
}

/** The tests' file bridges, bound so no Tauri window is needed. */
const readingIo = {
  ...groundIo,
  createDirAll: async (path: string) => mkdirSync(path, { recursive: true }),
  fileMeta: async () => ({
    kind: "facts" as const,
    exists: true,
    is_file: true,
    len: 123,
    modified_ms: Date.parse(TAKEN) - 1,
  }),
  readFileBytes: async () => ({ kind: "refused" as const, code: "cannot-reach" as const }),
  pdfText: async () => {
    throw new Error("no pdf here");
  },
  readTextHead: async () => ({
    head: "",
    truncated: false,
    exists: false,
    size: null,
    mtime: null,
    decode: "clean" as const,
  }),
};

const noteIo = {
  ...groundIo,
  createDirAll: async (path: string) => mkdirSync(path, { recursive: true }),
  listDir: async () => [],
  removeFile: async (path: string) => rmSync(path, { force: true }),
};

/** The media file's bridges, for the restore's picture and media line. */
const mediaIo = {
  readTextFile: groundIo.readTextFile,
  writeTextFile: groundIo.writeTextFile,
  createDirAll: async (path: string) => mkdirSync(path, { recursive: true }),
  removeFile: async (path: string) => rmSync(path, { force: true }),
};

/** The restore's real bridges (the same files, the same bytes). */
const restoreIo: GroundRestoreIo = {
  saveGround: (workspace, references, malformed) =>
    saveGround(workspace, references, malformed, groundIo),
  saveReadings: (workspace, readings, malformed) =>
    saveReadings(workspace, readings, malformed, readingIo),
  saveGroundLinks: (workspace, links, malformed) =>
    saveGroundLinks(workspace, links, malformed, groundIo),
  saveMedia: (workspace, media, malformed) =>
    saveMedia(workspace, media, malformed, mediaIo),
  restoreThumb: (workspace, thumb, text) =>
    restoreThumb(workspace, thumb, text, mediaIo),
  restoreReadingText: (workspace, on, text) =>
    restoreReadingText(workspace, on, text, readingIo),
  restoreNote: (workspace, slug, text) =>
    restoreNote(workspace, slug, text, noteIo),
};

/** Delete the card and hand back the snapshot the toast would hold. */
async function removeForRestore(workspace: string) {
  const log: string[] = [];
  const ground = await loadGround(workspace, groundIo);
  const readings = [
    READING,
  ];
  const removal = await removeGroundRecords(
    workspace,
    "rain-gauge",
    ground.references,
    readings,
    [MALFORMED_GROUND],
    [MALFORMED_READINGS],
    removalIo(log),
  );
  const links = await loadGroundLinks(workspace, groundIo);
  // THE CASCADE (the hook's own step): every link naming the card leaves.
  await removeGroundLinksNaming(
    workspace,
    "rain-gauge",
    links.links,
    [MALFORMED_LINKS],
    groundIo,
  );
  const removed: RemovedCard = {
    ...(removal.removed as RemovedCard),
    links: LINKS.map((link, index) => ({ link, index })).filter(
      ({ link }) => link.from === "rain-gauge" || link.to === "rain-gauge",
    ),
    state: "current",
    media: null,
    mediaIndex: -1,
    thumbSvgText: null,
  };
  return { log, removal, removed, links: links.links };
}

describe("delete reads the moved texts BEFORE it unlinks", () => {
  test("the reading text and the note are in memory, byte-exact", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const { log, removal, removed } = await removeForRestore(workspace);
    // Both texts were read before the first write (and before the unlink).
    expect(log.slice(0, 2).sort()).toEqual([
      "read-note",
      "read-reading-text",
    ]);
    expect(log.indexOf("unlink")).toBeGreaterThan(1);
    // THE BYTES, not a containment: the toast holds exactly what was there.
    expect(removed.readingText).toBe(READING_TEXT);
    expect(removed.note).toBe(NOTE_TEXT);
    expect(removed.reference).toEqual(REFERENCE);
    // The delete itself landed, and the files lost the card.
    expect(removal.refusal).toBeNull();
    expect(readFileSync(groundPath(workspace), "utf8")).not.toContain(
      "on: rain-gauge",
    );
  });

  test("a second delete commits the first: one pending restore only", () => {
    const first = { reference: REFERENCE } as unknown as RemovedCard;
    const second = { reference: OTHER } as unknown as RemovedCard;
    expect(pendingRestoreAfter(null, first)).toBe(first);
    expect(pendingRestoreAfter(first, second)).toBe(second);
    // A delete with no snapshot never revives an older one.
    expect(pendingRestoreAfter(first, null)).toBe(first);
    // The hook uses the pure rule at the delete's one call site.
    const removeBlock = HOOK.slice(
      HOOK.indexOf("const remove = useCallback"),
      HOOK.indexOf("const link = useCallback"),
    );
    expect(removeBlock).toContain("pendingRestoreAfter(");
    expect(removeBlock.match(/restorableRef\.current =/g)?.length ?? 0).toBe(1);
  });
});

describe("Restore puts the SAME BYTES back", () => {
  test("the whole folder is byte-identical except the history", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const before = bytesOf(workspace);
    const { removed, links } = await removeForRestore(workspace);
    // Gone first: the text and the note files really left the disk.
    expect(readFileSync(groundPath(workspace), "utf8")).not.toContain(
      "rain-gauge",
    );
    expect(readFileSync(groundLinksPath(workspace), "utf8")).not.toContain(
      "rain-gauge",
    );

    const result = await restoreGroundCard(
      workspace,
      removed,
      (await loadGround(workspace, groundIo)).references,
      [READING],
      links,
      [],
      [MALFORMED_GROUND],
      [MALFORMED_READINGS],
      [MALFORMED_LINKS],
      [],
      restoreIo,
    );
    expect(result.refusal).toBeNull();
    expect(result.restoredReference).toBe(true);
    expect(result.restoredLinks).toHaveLength(2);
    const after = bytesOf(workspace);
    // BYTE-FOR-BYTE, every file, including the note and both links.
    for (const key of ["ground", "readings", "readingText", "note", "links"]) {
      expect({ key, bytes: after[key] }).toEqual({ key, bytes: before[key] });
    }
    expect(after.readingText).toBe(READING_TEXT);
    expect(after.note).toBe(NOTE_TEXT);
    // The card is back at its original FILE position, not appended.
    const reloaded = await loadGround(workspace, groundIo);
    expect(reloaded.references.map((reference) => reference.on)).toEqual([
      "rain-gauge",
      "soil",
    ]);
  });

  test("a partial restore answers ONE sentence: what came back, what did not", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const before = bytesOf(workspace);
    const { removed, links } = await removeForRestore(workspace);
    const failing: GroundRestoreIo = {
      ...restoreIo,
      restoreReadingText: async () => {
        throw new Error("EPERM");
      },
      restoreNote: async () => {
        throw new Error("EPERM");
      },
    };
    const result = await restoreGroundCard(
      workspace,
      removed,
      (await loadGround(workspace, groundIo)).references,
      [READING],
      links,
      [],
      [MALFORMED_GROUND],
      [MALFORMED_READINGS],
      [MALFORMED_LINKS],
      [],
      failing,
    );
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain("the reading text and the note did not");
    expect(result.refusal).toContain("came back");
    // The line and the card did come back; only the two text files refused.
    expect(result.restoredReference).toBe(true);
    expect(readFileSync(groundPath(workspace), "utf8")).toBe(before.ground);
    expect(readFileSync(readingsPath(workspace), "utf8")).toBe(before.readings);
  });

  test("restoreSentence is pure and names both sides", () => {
    expect(restoreSentence(["the reference"], [])).toBeNull();
    expect(restoreSentence(["the reference"], ["the note"])).toBe(
      "The reference came back, but the note did not.",
    );
    expect(restoreSentence(["the links", "the reading"], ["the reference"])).toBe(
      "The links and the reading came back, but the reference did not.",
    );
    expect(restoreSentence([], ["the reference"])).toBe(
      "The reference did not come back.",
    );
  });
});

describe("the log records BOTH moves, and a restore is never silent", () => {
  test("card.restore exists in the vocabulary and parses back", async () => {
    const { cardRestoreEvent, parseHistoryEvent, serializeHistoryEvent } =
      await import("../src/map/history");
    const event = cardRestoreEvent(123, "rain-gauge");
    expect(event.type).toBe("card.restore");
    expect(parseHistoryEvent(serializeHistoryEvent(event))).toEqual(event);
  });

  test("a delete then a restore writes remove lines, then restore lines", async () => {
    const workspace = freshWorkspace();
    const {
      appendEvents,
      cardRemovalEvents,
      cardRestoreEvent,
      linkAddEvent,
      readHistory,
    } = await import("../src/map/history");
    await appendEvents(
      workspace,
      cardRemovalEvents(5, "rain-gauge", [
        { from: "rain-gauge", to: "soil" },
      ]),
      groundIo,
    );
    await appendEvents(
      workspace,
      [
        cardRestoreEvent(9, "rain-gauge"),
        linkAddEvent(9, "rain-gauge", "soil"),
      ],
      groundIo,
    );
    const read = await readHistory(workspace, groundIo);
    expect(read.events.map((event) => event.type)).toEqual([
      "baseline",
      "card.remove",
      "link.remove",
      "card.restore",
      "link.add",
    ]);
    expect(read.events[3]).toEqual(cardRestoreEvent(9, "rain-gauge"));
  });

  test("the hook's restore queues card.restore through the same history", () => {
    const restoreBlock = HOOK.slice(
      HOOK.indexOf("const restore = useCallback"),
      HOOK.indexOf("const dismissRestore = useCallback"),
    );
    expect(restoreBlock).toContain("cardRestoreEvent(Date.now(), slug)");
    expect(restoreBlock).toContain("linkAddEvent(");
    expect(restoreBlock).toContain("queueHistory(() =>");
    // It logs ONLY when the card actually came back; a failed ground line has
    // no card to name.
    expect(restoreBlock).toContain("if (restored.restoredReference)");
    expect(TOAST).not.toContain("cardRestoreEvent");
  });
});

describe("the toast: one sentence, Restore and a quiet x", () => {
  test("the one sentence and its verbs, with no counter or countdown", () => {
    const html = renderToStaticMarkup(
      createElement(GroundToast, {
        onRestore: () => {},
        onDismiss: () => {},
      }),
    );
    expect(html).toContain(RESTORE_SENTENCE);
    expect(html).toContain("restore");
    expect(html).toContain("×");
    expect(html).toContain("ground-toast");
    expect(html).not.toMatch(/\d/);
    expect(html).not.toMatch(/(countdown|seconds|undo \(|progress|count)/i);
    // One sentence, not a dialogue: no other question.
    expect(RESTORE_SENTENCE).toBe("this reference was removed");
  });

  test("a partial restore's sentence replaces the verb", () => {
    const html = renderToStaticMarkup(
      createElement(GroundToast, {
        notice: "The reference came back, but the note did not.",
        onDismiss: () => {},
      }),
    );
    expect(html).toContain("The reference came back, but the note did not.");
    expect(html).not.toContain("ground-toast-restore");
    expect(html).toContain("ground-toast-dismiss");
  });

  test("the window is stated, not counted down", () => {
    expect(RESTORE_WINDOW_MS).toBe(10_000);
    const toastCode = TOAST.replace(/\/\*[\s\S]*?\*\//g, "").replace(
      /^\s*\/\/.*$/gm,
      "",
    );
    expect(toastCode).not.toMatch(/setInterval|setTimeout|countdown|progress/i);
    // The hook owns the one timer, and its clear is the toast's close.
    expect(HOOK).toContain("RESTORE_WINDOW_MS");
    expect(HOOK).toContain("clearTimeout(timer)");
    expect(CSS).toContain(".ground-toast");
  });
});

describe("the empty map is one muted sentence", () => {
  test("no verb, no illustration, no number", () => {
    expect(GROUND_EMPTY_SENTENCE).toBe("nothing on this map yet");
    const html = renderToStaticMarkup(createElement(GroundEmpty));
    expect(html).toContain(GROUND_EMPTY_SENTENCE);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("<svg");
    expect(html).not.toMatch(/\d/);
    // The app mounts it in screen space and suppresses the hint (which offers
    // a verb) while the ground map is empty.
    const APP = source("App.tsx");
    expect(APP).toContain("<GroundEmpty />");
    expect(APP).toContain('level === "ground" && ground.loaded && ground.references.length === 0');
  });
});

describe("a refused reading still renders as a card", () => {
  const inert = {
    onMove: async () => ({ ok: true as const }),
    onRefresh: async () => ({ ok: true as const }),
    onRepoint: async () => ({ ok: true as const }),
    onRemove: async () => ({ ok: true as const }),
  };

  function render(overrides: Record<string, unknown>) {
    return renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [REFERENCE],
        readings: [READING],
        texts: {},
        states: { "rain-gauge": "missing" },
        ...inert,
        ...overrides,
      } as never),
    );
  }

  test("name, what this is, and the refusal as the third line", () => {
    const html = render({});
    expect(html).toContain("Rain gauge");
    expect(html).toContain("the reading kept from gauge.txt");
    expect(html).toContain(readingAbsenceLine("missing"));
    expect(html).toContain("ground-refusal");
    // Never a broken box: the body, kind and name lines all render.
    expect(html).toContain("ground-kind");
    expect(html).toContain("ground-body");
    expect(html).not.toContain("ground-reading\"></div>");
  });

  test("a selection says what it is and why its verbs are absent", () => {
    const selection: Reading = {
      on: "nights",
      form: "selection",
      from: "card://rain-gauge",
      taken: TAKEN,
    };
    const html = render({
      references: [REFERENCE, { on: "nights", name: "Nights", x: 360, y: 60 }],
      readings: [READING, selection],
      texts: { "rain-gauge": "source", nights: "the excerpt" },
      states: { "rain-gauge": "current", nights: "current" },
    });
    const kind = readingKind(
      selection,
      new Map([["rain-gauge", "Rain gauge"]]),
    );
    expect(kind).toBe("a copy of text selected from Rain gauge");
    expect(html).toContain(kind);
    expect(html).toContain(
      "this is a copy; there is no file to refresh or point at.",
    );
    expect(html).toContain("ground-quiet");
    // The file verbs are absent for this card (the quiet line says why).
    expect(html.match(/ground-refresh/g) ?? []).toHaveLength(1);
    expect(html.match(/ground-repoint/g) ?? []).toHaveLength(1);
  });

  test("changed and missing say what the words on screen are", () => {
    expect(readingStateWord("changed")).toContain(
      "this is the copy kept when it was added",
    );
    expect(readingStateWord("missing")).toContain(
      "this is the copy kept when it was added",
    );
  });
});

describe("a refused refresh says what still stands", () => {
  test("one sentence, and the old reading is untouched", () => {
    expect(REFRESH_UNCHANGED).toBe(
      "the file could not be read; the reading you have is unchanged.",
    );
    const refreshBlock = HOOK.slice(
      HOOK.indexOf("const refresh = useCallback"),
      HOOK.indexOf("const repoint = useCallback"),
    );
    expect(refreshBlock).toContain("REFRESH_UNCHANGED");
    // The refusal writes nothing: the return precedes every save.
    const refusalAt = refreshBlock.indexOf("REFRESH_UNCHANGED");
    const saveAt = refreshBlock.indexOf("await saveReadings");
    expect(refusalAt).toBeGreaterThan(-1);
    expect(saveAt).toBeGreaterThan(refusalAt);
  });
});

describe("the story's classes are content and the confirm's are gone", () => {
  test("the gate knows the new lines and the toast", () => {
    for (const name of [
      "ground-kind",
      "ground-refusal",
      "ground-quiet",
      "ground-empty",
      "ground-toast",
      "ground-toast-sentence",
      "ground-toast-restore",
      "ground-toast-dismiss",
    ]) {
      expect(CONTENT_CLASSES).toContain(name as never);
    }
    for (const gone of [
      "ground-confirm",
      "ground-confirm-question",
      "ground-confirm-actions",
      "ground-confirm-remove",
      "ground-confirm-cancel",
    ]) {
      expect(CONTENT_CLASSES).not.toContain(gone as never);
    }
  });

  test("the immediate delete is recorded, not asked twice", () => {
    expect(DELETE_IS_IMMEDIATE).toBe(true);
    expect(LAYER).not.toContain("ground-confirm");
    expect(CSS).not.toContain(".ground-confirm");
    // No countdown or counter anywhere in the story's new surfaces.
    const FORBIDDEN =
      /\b(badge|count|counts|score|scores|streak|heat|progress|tally|meter|nudge|countdown)\b/i;
    for (const text of [
      RESTORE_SENTENCE,
      GROUND_EMPTY_SENTENCE,
      REFRESH_UNCHANGED,
      ...["missing", "changed", "unreadable", "unread"].map((state) =>
        readingAbsenceLine(state as never),
      ),
    ]) {
      expect({ text, found: text.match(FORBIDDEN)?.[0] ?? null }).toEqual({
        text,
        found: null,
      });
    }
  });
});
