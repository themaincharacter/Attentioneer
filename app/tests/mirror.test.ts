import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  MIRROR_FILE,
  MIRROR_WRITE_REFUSAL,
  mirrorPath,
  mirrorWriteTask,
  renderMirror,
  writeMirror,
  type MirrorIo,
  type MirrorView,
} from "../src/map/mirror";
import {
  loadGround,
  saveGround,
  type GroundReference,
} from "../src/map/ground";
import {
  loadGroundLinks,
  orphanGroundLinks,
  saveGroundLinks,
  serializeGroundLinkLine,
  type GroundLink,
} from "../src/map/groundLinks";
import {
  loadReadings,
  loadReadingTexts,
  readingTextPath,
  resolveReadingState,
  saveReadings,
  type Reading,
} from "../src/map/readings";
import { loadNotes, notePath, notesDir } from "../src/map/notes";

/**
 * Story 16.9 — THE MIRROR: a human-readable index of the ground map, written
 * beside the map and disposable.
 *
 * The story's check is human ("open the folder: MAP.md lists every ground card
 * by name with its file and state, then its links, then what is unknown;
 * change something and the file changes; delete it, make one small change:
 * it comes back identical; delete a file a card points at: the mirror says
 * missing instead of dropping the card"). This file pins the rules underneath:
 *
 *   - the render is PURE and REPRODUCIBLE: the same view twice is the same
 *     bytes, with no clock, no counts and no "generated at";
 *   - the state word is honest (current says nothing; the other four say their
 *     sentence) and a missing file never drops the card;
 *   - orphans and malformed lines are reproduced in the unknowns, marked
 *     unreadable;
 *   - only file NAMES appear — never a full path;
 *   - the artifact is `<workspace>/MAP.md` and is rewritten whole;
 *   - a mirror failure is ONE sentence and never rejects (the move stands);
 *   - the mirror is never written on open: deleting it leaves it absent until
 *     the next move, then it returns byte-identically;
 *   - every ground write path queues it (source assertion: the hook is the
 *     seam, and the eight call sites are counted).
 *
 * PROVISIONAL (the story's artifact): the name, the block layout, the section
 * order, the preview length and the state sentences.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const HOOK = source("canvas/useGround.ts");
const APP = source("App.tsx");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-mirror-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

const fsTextIo = {
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
};

const groundIo = fsTextIo;
const readingIo = {
  readTextFile: fsTextIo.readTextFile,
  readTextHead: async () => {
    throw new Error("unused");
  },
  writeTextFile: fsTextIo.writeTextFile,
  createDirAll: async (path: string) => {
    mkdirSync(path, { recursive: true });
  },
  fileMeta: async () => ({ kind: "refused" as const }),
  readFileBytes: async () => ({ kind: "refused" as const, code: "io" as const }),
  pdfText: async () => ({ kind: "refused" as const, message: "unused" }),
};
const linkIo = fsTextIo;

const RAIN: GroundReference = {
  on: "rain-gauge",
  name: "Rain gauge",
  x: 10,
  y: 20,
};
const SOIL: GroundReference = {
  on: "soil",
  name: "Soil",
  x: 30,
  y: 40,
};
const RAIN_READING: Reading = {
  on: "rain-gauge",
  form: "path",
  from: "notes/gauge.txt",
  taken: "2026-11-17T12:00:00.000Z",
  bytes: 20,
};
const SOIL_READING: Reading = {
  on: "soil",
  form: "at",
  from: "/Users/them/Documents/soil report.md",
  taken: "2026-11-17T12:01:00.000Z",
  bytes: 40,
};
const LINK: GroundLink = { from: "rain-gauge", to: "soil" };

/** A complete view, deliberately carrying every kind of unknown. */
function fullView(): MirrorView {
  return {
    references: [RAIN, SOIL],
    readings: [RAIN_READING, SOIL_READING],
    texts: {
      "rain-gauge": "first line of the gauge\nsecond line\n",
      soil: "soil report opening",
    },
    states: { "rain-gauge": "current", soil: "missing" },
    notes: { "rain-gauge": "my own first line\nsecond line" },
    orphanNotes: ["ghost-note"],
    orphanMedia: [],
    links: [LINK],
    orphanLinks: [{ from: "rain-gauge", to: "gone" }],
    malformedGround: ["this ground line is not a reference"],
    malformedReadings: ["a broken readings line"],
    malformedLinks: ["a broken link line"],
    asks: [],
    malformedAsks: [],
    orphanAskTurns: [],
    // STORY 18.5: no session cards in this view — the section still appears.
    sessions: [],
    sessionToolNames: {},
    sessionEndings: {},
    orphanSessionTranscripts: [],
  };
}

describe("the render: pure, reproducible, plain", () => {
  test("the same view renders byte-identically twice", () => {
    const first = renderMirror(fullView());
    const second = renderMirror(fullView());
    expect(second).toBe(first);
    // A second, structurally identical view is the same records too.
    const third = renderMirror({ ...fullView() });
    expect(third).toBe(first);
  });

  test("no clock, no counts, no totals, no generated-at line", () => {
    const text = renderMirror(fullView());
    // The reading took its stamp in the past; the mirror must not repeat it.
    expect(text).not.toContain("2026-11-17T12:00:00.000Z");
    expect(text).not.toMatch(/generated at/i);
    expect(text).not.toMatch(/\b\d+\s+(cards?|references?|links?|notes?)\b/i);
    // The fixed marker says what the file is and that the records are truth.
    expect(text).toContain("the ground map, written out");
    expect(text).toContain("The records are the truth");
    expect(text).toContain("Deleting it is safe");
  });

  test("cards keep record order; links are sorted; sections are fixed", () => {
    const text = renderMirror(fullView());
    expect(text.indexOf("### Rain gauge")).toBeLessThan(
      text.indexOf("### Soil"),
    );
    expect(text).toContain("## References");
    expect(text).toContain("## Links");
    expect(text).toContain("## What is unknown");
    // Sort is by the recorded pair, not by the array's arrival order.
    const reversed: MirrorView = {
      ...fullView(),
      links: [
        { from: "soil", to: "rain-gauge" },
        { from: "rain-gauge", to: "soil" },
      ],
    };
    const a = renderMirror(reversed);
    const b = renderMirror({
      ...reversed,
      links: [
        { from: "rain-gauge", to: "soil" },
        { from: "soil", to: "rain-gauge" },
      ],
    });
    expect(a).toBe(b);
    expect(a).toContain("Rain gauge → Soil");
    expect(a).toContain("Soil → Rain gauge");
  });

  test("an empty map still has a stable shape", () => {
    const text = renderMirror({
      references: [],
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
      asks: [],
      malformedAsks: [],
      orphanAskTurns: [],
      sessions: [],
      sessionToolNames: {},
      sessionEndings: {},
      orphanSessionTranscripts: [],
    });
    expect(text).toContain("none yet.");
    expect(text).toContain("nothing is unknown.");
    expect(text).not.toMatch(/\b0\b/);
  });
});

describe("the state word: honest, and never a dropped card", () => {
  test("current says nothing; the other four say their sentence", () => {
    const view = fullView();
    const text = renderMirror(view);
    // Rain gauge is current: no state line in its block.
    const rainBlock = text.slice(
      text.indexOf("### Rain gauge"),
      text.indexOf("### Soil"),
    );
    expect(rainBlock).not.toContain("state:");
    // Soil is missing: the sentence and the card both stay.
    const soilBlock = text.slice(
      text.indexOf("### Soil"),
      text.indexOf("## Links"),
    );
    expect(soilBlock).toContain("state: the file is missing");
    expect(soilBlock).toContain("Soil");
    expect(soilBlock).toContain("file: soil report.md");
  });

  test("changed, unreadable and unread each say their one sentence", () => {
    const base = fullView();
    const sentence = (state: MirrorView["states"][string]) =>
      renderMirror({
        ...base,
        states: { "rain-gauge": "changed", soil: state },
      });
    expect(sentence("unreadable")).toContain("state: the file cannot be read");
    expect(sentence("unread")).toContain("state: no reading has been taken");
    expect(renderMirror({ ...base, states: { "rain-gauge": "changed", soil: "missing" } })).toContain(
      "state: changed since this reading was taken",
    );
  });

  test("a reference with no reading line still appears", () => {
    const text = renderMirror({
      ...fullView(),
      readings: [RAIN_READING],
      states: { "rain-gauge": "current", soil: "unread" },
      texts: { "rain-gauge": "first line of the gauge" },
    });
    expect(text).toContain("### Soil");
    expect(text).toContain("state: no reading has been taken");
    expect(text).not.toContain("file: soil report.md");
  });
});

describe("the preview, the note and the filename-only rule", () => {
  test("the first line is the preview; the note's first line follows", () => {
    const text = renderMirror(fullView());
    expect(text).toContain("reading: first line of the gauge");
    expect(text).not.toContain("second line of the gauge");
    expect(text).toContain("note: my own first line");
  });

  test("a long first line is cropped, deterministically", () => {
    const long = "x".repeat(400);
    const text = renderMirror({
      ...fullView(),
      texts: { "rain-gauge": long },
    });
    expect(text).toContain("reading: " + "x".repeat(120) + "…");
    expect(text).not.toContain(long);
  });

  test("only the file NAME appears, never the full path", () => {
    const text = renderMirror(fullView());
    expect(text).toContain("file: soil report.md");
    expect(text).toContain("file: gauge.txt");
    expect(text).not.toContain("/Users/them");
    expect(text).not.toContain("Documents");
    expect(text).not.toContain("notes/gauge.txt");
  });
});

describe("what is unknown: reproduced, marked unreadable", () => {
  test("every malformed line, orphan link and orphan note is named", () => {
    const text = renderMirror(fullView());
    expect(text).toContain("unreadable line in ground.txt: this ground line is not a reference");
    expect(text).toContain("unreadable line in readings.txt: a broken readings line");
    expect(text).toContain("unreadable line in ground-links.txt: a broken link line");
    expect(text).toContain(
      "unreadable link, a card is not on the map: " + serializeGroundLinkLine({ from: "rain-gauge", to: "gone" }),
    );
    expect(text).toContain("unreadable note, no card is on the map: ghost-note.md");
  });

  test("the pipeline: a missing file, an orphan and a malformed line from disk", async () => {
    const workspace = freshWorkspace();
    const malformedGround = "this ground line is not a reference";
    const malformedReadings = "a broken readings line";
    await saveGround(workspace, [RAIN], [malformedGround], groundIo);
    await saveReadings(workspace, [RAIN_READING], [malformedReadings], readingIo);
    await saveGroundLinks(
      workspace,
      [{ from: "rain-gauge", to: "gone" }],
      [],
      linkIo,
    );
    mkdirSync(notesDir(workspace), { recursive: true });
    writeFileSync(notePath(workspace, "ghost-note"), "a note with no card");
    const ground = await loadGround(workspace, groundIo);
    const readings = await loadReadings(workspace, readingIo);
    const links = await loadGroundLinks(workspace, linkIo);
    const notes = await loadNotes(
      workspace,
      ground.references.map((reference) => reference.on),
      {
        ...fsTextIo,
        createDirAll: async () => {},
        removeFile: async () => {},
        listDir: async (path) => {
          try {
            return readdirSync(path);
          } catch {
            return [];
          }
        },
      },
    );
    const text = renderMirror({
      references: ground.references,
      readings: readings.readings,
      texts: {},
      // The state the app computes at load: the pointed-at file is gone.
      states: {
        [RAIN.on]: resolveReadingState(
          readings.readings[0],
          { kind: "facts", exists: false, is_file: false, len: null, modified_ms: null },
          Date.now(),
        ),
      },
      notes: notes.notes,
      orphanNotes: notes.orphans,
      orphanMedia: [],
      links: links.links,
      orphanLinks: orphanGroundLinks(
        links.links,
        ground.references.map((reference) => reference.on),
      ),
      malformedGround: ground.malformed,
      malformedReadings: readings.malformed,
      malformedLinks: links.malformed,
      asks: [],
      malformedAsks: [],
      orphanAskTurns: [],
      sessions: [],
      sessionToolNames: {},
      sessionEndings: {},
      orphanSessionTranscripts: [],
    });
    expect(text).toContain("### Rain gauge");
    expect(text).toContain("state: the file is missing");
    expect(text).toContain("unreadable line in ground.txt: " + malformedGround);
    expect(text).toContain(
      "unreadable line in readings.txt: " + malformedReadings,
    );
    expect(text).toContain("unreadable link, a card is not on the map");
    expect(text).toContain("unreadable note, no card is on the map: ghost-note.md");
  });

  test("with nothing unknown the section still says so, without a count", () => {
    const text = renderMirror({
      ...fullView(),
      orphanNotes: [],
      orphanLinks: [],
      malformedGround: [],
      malformedReadings: [],
      malformedLinks: [],
    });
    expect(text).toContain("nothing is unknown.");
  });
});

describe("the artifact: MAP.md at the workspace root, rewritten whole", () => {
  test("writeMirror writes <workspace>/MAP.md and overwrites it whole", async () => {
    const workspace = freshWorkspace();
    expect(mirrorPath(workspace)).toBe(join(workspace, MIRROR_FILE));
    expect(mirrorPath(workspace).endsWith("/MAP.md")).toBe(true);
    const first = renderMirror(fullView());
    await writeMirror(workspace, first, fsTextIo);
    expect(readFileSync(mirrorPath(workspace), "utf8")).toBe(first);
    // A second write replaces every byte: no append, no edit in place.
    const shorter = renderMirror({ ...fullView(), references: [RAIN] });
    await writeMirror(workspace, shorter, fsTextIo);
    expect(readFileSync(mirrorPath(workspace), "utf8")).toBe(shorter);
  });
});

describe("a mirror failure never fails the move", () => {
  test("the task resolves, reports ONE sentence, and keeps the record write", async () => {
    const workspace = freshWorkspace();
    const reports: (string | null)[] = [];
    const failing: MirrorIo = {
      writeTextFile: async () => {
        throw new Error("disk refused");
      },
    };
    const task = mirrorWriteTask(
      workspace,
      () => renderMirror(fullView()),
      (notice) => reports.push(notice),
      failing,
    );
    // It never rejects: the queue's next task is not blocked, and a move that
    // queued this after its own record write has already stood.
    await expect(task()).resolves.toBeUndefined();
    expect(reports).toEqual([MIRROR_WRITE_REFUSAL]);
    // The sentence names the file and says the map changed; it is not a move
    // failure and it carries no count.
    expect(MIRROR_WRITE_REFUSAL).toContain("MAP.md");
    expect(MIRROR_WRITE_REFUSAL).not.toMatch(/\d/);
    // A successful task clears the notice, once.
    const okReports: (string | null)[] = [];
    const ok = mirrorWriteTask(
      workspace,
      () => renderMirror(fullView()),
      (notice) => okReports.push(notice),
      fsTextIo,
    );
    await ok();
    expect(okReports).toEqual([null]);
  });

  test("a render bug is a notice too, not a failed move", async () => {
    const reports: (string | null)[] = [];
    const task = mirrorWriteTask(
      freshWorkspace(),
      () => {
        throw new Error("render bug");
      },
      (notice) => reports.push(notice),
      fsTextIo,
    );
    await task();
    expect(reports).toEqual([MIRROR_WRITE_REFUSAL]);
  });

  test("the move's record write lands before the mirror is queued", () => {
    const move = HOOK.slice(
      HOOK.indexOf("const move = useCallback"),
      HOOK.indexOf("const writtenReading = useCallback"),
    );
    expect(move.indexOf("await saveGround")).toBeGreaterThan(-1);
    expect(move.indexOf("await saveGround")).toBeLessThan(
      move.indexOf("queueMirror()"),
    );
    // It is pushed, not awaited: the move's own outcome never waits on it.
    expect(move).not.toContain("await queueMirror");
  });
});

describe("the hook queues the mirror after every ground write", () => {
  const verbs = [
    "create",
    "createPage",
    // STORY 16.15: a video card is authored like a page card — fetched once,
    // then written — and re-derives the map.
    "createVideo",
    "move",
    "refresh",
    "repoint",
    "remove",
    "link",
    "unlink",
    "setNote",
    // STORY 16.13: a restore is a tenth authored write and re-derives the map.
    "restore",
    // STORY 17.8: the ask cards' authored moves. A turn is NOT here: it adds
    // no name, anchor or parent, so MAP.md did not change.
    //
    // STORY 17.10: `ask about this` and the bubble's ASK door both reach the
    // ONE empty-ask writer (`writeEmptyAsk`), and the retired re-anchor verb is
    // replaced by the rename path. The delegating verbs (`createAsk`,
    // `createEmptyAsk`) are not listed: they hold no write of their own.
    "writeEmptyAsk",
    "renameAskTo",
    "forkAskAt",
    "removeAsk",
    // STORY 16.19: an ask made from a selection writes the ask line and the
    // wire from the source card, so MAP.md gains the card like any other add.
    "askFromSelection",
  ];

  for (const verb of verbs) {
    test(verb + " queues the mirror after its write", () => {
      const start = HOOK.indexOf("const " + verb + " = useCallback");
      expect(start).toBeGreaterThan(-1);
      const next = HOOK.indexOf("\n  const ", start + 1);
      const body = HOOK.slice(start, next === -1 ? HOOK.length : next);
      expect(body).toContain("queueMirror();");
      const mirrorAt = body.lastIndexOf("queueMirror();");
      const writeAt = Math.max(
        body.lastIndexOf("await save"),
        body.lastIndexOf("await remove"),
        // STORY 18.4: the run's result card delegates to `writeSelectionCard`
        // (text first, lines last) and then mirrors. STORY 18 removed the
        // concept-map selection verb, not this writer.
        body.lastIndexOf("await writeSelectionCard"),
        // STORY 16.19: the selection's ask writes the ask line and the wire
        // through its own writer, then mirrors.
        body.lastIndexOf("await writeSelectionAsk"),
        // Story 16.13: a restore delegates its five writes to
        // `restoreGroundCard` (pieces first, reference last) and then mirrors.
        body.lastIndexOf("await restoreGroundCard"),
        // Story 16.14/16.15: a fetched card delegates its writes (copies first,
        // ground line last) and then mirrors.
        body.lastIndexOf("await createFetchedPage"),
        body.lastIndexOf("await createFetchedVideo"),
        // STORY 17.8, 17.10: the ask moves delegate their record writes (and
        // an ask restore its two, the empty-ask writer its wire too) and then
        // mirror.
        body.lastIndexOf("await writeAskCard"),
        body.lastIndexOf("await saveGroundLinks"),
        body.lastIndexOf("await writeForkAsk"),
        body.lastIndexOf("await removeAskRecords"),
        body.lastIndexOf("await restoreAskCard"),
      );
      expect(writeAt).toBeGreaterThan(-1);
      expect(writeAt).toBeLessThan(mirrorAt);
    });
  }

  test("exactly twenty-three call sites (one per write path, not on load)", () => {
    // STORY 18 removes story 16.12's selection card from the write paths with
    // its verb, so this is one fewer than the twenty-three 18.5 left.
    // Story 16.13 adds restore as the tenth; story 16.14 the page card and
    // story 16.15 the video card. STORY 17.8 adds four ask moves; STORY 17.10
    // (the addendum) retires the re-anchor verb and adds the rename and the
    // empty-ask writer in its place, so the count is unchanged.
    // STORY 18.4 adds the run's result card, which is an ordinary reference.
    // STORY 18.5 adds three session moves (create, remove, run) and the session
    // restore inside the one toast handler.
    // STORY 17.10 adds one mirror for the FIRST question's short-form rename
    // (an empty card names itself), which is a name change like any other.
    // STORY 16.19 adds one: the ask a selection makes writes a card and a wire.
    expect(HOOK.match(/queueMirror\(\);/g)?.length ?? 0).toBe(23);
  });

  test("opening never writes the mirror", () => {
    // The load path and the workspace effect own no mirror call, so deleting
    // MAP.md leaves it absent until the person makes a move.
    const reload = HOOK.slice(
      HOOK.indexOf("const reload = useCallback"),
      HOOK.indexOf("const snapshot ="),
    );
    expect(reload).not.toContain("queueMirror");
    expect(reload).not.toContain("writeMirror");
    const effect = HOOK.slice(
      HOOK.indexOf("useEffect(() => {"),
      HOOK.indexOf("const create = useCallback"),
    );
    expect(effect).not.toContain("queueMirror");
    expect(HOOK).not.toContain("writeMirror(");
  });

  test("a deleted mirror returns on the next move, byte-identically", async () => {
    const workspace = freshWorkspace();
    // The records exist and the mirror was written once.
    await saveGround(workspace, [RAIN], [], groundIo);
    await saveReadings(workspace, [RAIN_READING], [], readingIo);
    mkdirSync(dirname(readingTextPath(workspace, "rain-gauge")), {
      recursive: true,
    });
    writeFileSync(readingTextPath(workspace, "rain-gauge"), "first line\n");
    await saveGroundLinks(workspace, [LINK], [], linkIo);
    const view: MirrorView = {
      references: [RAIN],
      readings: [RAIN_READING],
      texts: { "rain-gauge": "first line" },
      states: { "rain-gauge": "current" },
      notes: {},
      orphanNotes: [],
      orphanMedia: [],
      links: [LINK],
      orphanLinks: [],
      malformedGround: [],
      malformedReadings: [],
      malformedLinks: [],
      asks: [],
      malformedAsks: [],
      orphanAskTurns: [],
      sessions: [],
      sessionToolNames: {},
      sessionEndings: {},
      orphanSessionTranscripts: [],
    };
    const first = renderMirror(view);
    await writeMirror(workspace, first, fsTextIo);
    // Deleting it and making NO move leaves it absent (opening is a look):
    // nothing in this test writes it again.
    unlinkSync(mirrorPath(workspace));
    expect(existsSync(mirrorPath(workspace))).toBe(false);
    expect(await loadGround(workspace, groundIo)).toEqual({
      references: [RAIN],
      malformed: [],
    });
    expect(await loadReadings(workspace, readingIo)).toEqual({
      readings: [RAIN_READING],
      malformed: [],
    });
    expect(await loadGroundLinks(workspace, linkIo)).toEqual({
      links: [LINK],
      malformed: [],
    });
    expect(await loadNotes(workspace, ["rain-gauge"], { ...fsTextIo, listDir: async () => [], createDirAll: async () => {}, removeFile: async () => {} })).toEqual({ notes: {}, orphans: [] });
    expect(await loadReadingTexts(workspace, ["rain-gauge"], readingIo)).toEqual({
      "rain-gauge": "first line\n",
    });
    expect(existsSync(mirrorPath(workspace))).toBe(false);
    // The next move queues the mirror from the freshly loaded view; the bytes
    // are identical to the first render, because the records did not change.
    const reports: (string | null)[] = [];
    await mirrorWriteTask(workspace, () => renderMirror(view), (n) => reports.push(n), fsTextIo)();
    expect(reports).toEqual([null]);
    expect(readFileSync(mirrorPath(workspace), "utf8")).toBe(first);
    // And the artifacts on disk are untouched by the mirror.
    expect(readFileSync(join(workspace, "map", "ground.txt"), "utf8")).toContain(
      "on: rain-gauge",
    );
    expect(existsSync(join(workspace, "map", "readings.txt"))).toBe(true);
  });
});

describe("the wiring: notices and the separation of the maps", () => {
  test("the failure sentence rides the ground notices group", () => {
    expect(APP).toContain("mirrorNotice={ground.mirrorNotice}");
    expect(APP).toContain("mirrorNotice !== null");
    expect(APP).toContain("{mirrorNotice}");
  });

  test("the ground map's rendered content is still blank (no second map)", () => {
    expect(renderedMapContent("ground")).toEqual([]);
    // The mirror describes the ground map only; it never mentions concept.
    expect(renderMirror(fullView()).toLowerCase()).not.toContain("concept");
  });
});
