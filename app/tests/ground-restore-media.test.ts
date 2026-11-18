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
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  captureGroundMedia,
  removeGroundLinksNaming,
  removeGroundMedia,
  removeGroundNote,
  removeGroundRecords,
  restoreGroundCard,
  type GroundRestoreIo,
  type GroundMediaCapture,
  type RemovedCard,
} from "../src/canvas/useGround";
import {
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
  loadMedia,
  mediaPath,
  orphanMedia,
  restoreThumb,
  saveMedia,
  serializeMediaLine,
  thumbRelPath,
  type Media,
  type MediaIo,
} from "../src/map/media";
import { notePath, restoreNote } from "../src/map/notes";
import {
  readingTextPath,
  restoreReadingText,
  saveReadings,
  type Reading,
} from "../src/map/readings";
import { renderMirror } from "../src/map/mirror";
import { renderedMapContent } from "../src/canvas/mapContentRules";

/**
 * STORY 16.14b — Restore keeps a page's picture, and orphans say so.
 *
 * The story's check is human ("add a page, note its title and picture, delete,
 * press Restore: the card comes back with its title, picture and text; compare
 * the folder with a copy taken before the delete — byte-identical. Then
 * hand-write a media.jsonl line naming a card that does not exist: the ground
 * notices name it and the app does not delete it"). This file pins the rules
 * underneath it:
 *
 *   - the delete READS the media line and the thumbnail wrapper's bytes BEFORE
 *     ANY unlink, and Restore writes the SAME BYTES back;
 *   - the whole map folder is compared, not "contains": every file, byte for
 *     byte, after a delete and a restore;
 *   - a missing thumbnail is not an error: it restores nothing and invents
 *     nothing;
 *   - a media line whose card is gone is an ORPHAN: preserved, reported in the
 *     notices group and in the mirror's unknowns, never adopted, never deleted;
 *   - no counter, no nudge, and `renderedMapContent("ground")` stays [].
 *
 * PROVISIONAL: the labels a partial restore uses for the picture and the media
 * line, and the orphan sentence's wording.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}
const HOOK = source("canvas/useGround.ts");
const APP = source("App.tsx");

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-restore-media-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map", "readings"), { recursive: true });
  mkdirSync(join(path, "map", "notes"), { recursive: true });
  mkdirSync(join(path, "map", "media"), { recursive: true });
  return path;
}

/** The app's text-file bridges, bound to the real disk (no Tauri window). */
const textIo = {
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
  createDirAll: async (path: string): Promise<void> => {
    mkdirSync(path, { recursive: true });
  },
};

const groundIo: GroundIo = {
  readTextFile: textIo.readTextFile,
  writeTextFile: textIo.writeTextFile,
};
const mediaIo: MediaIo = {
  readTextFile: textIo.readTextFile,
  writeTextFile: textIo.writeTextFile,
  createDirAll: textIo.createDirAll,
  removeFile: async (path: string) => rmSync(path, { force: true }),
};

const TAKEN = "2026-11-17T12:00:00.000Z";
const RAIN: GroundReference = { on: "rain-gauge", name: "Rain gauge", x: 40, y: 60 };
const SOIL: GroundReference = { on: "soil", name: "Soil", x: 400, y: 60 };
const READING: Reading = {
  on: "rain-gauge",
  form: "url",
  from: "https://example.com/rain",
  taken: TAKEN,
  extract: "page",
};
/** Odd whitespace: every byte must come back exactly. */
const READING_TEXT = "  the rain gauge page\n\n\ttabbed,  two spaces \nlast line\n";
const NOTE_TEXT = "the person's note\n\nwith  two spaces and a tab\t\n";
const THUMB_TEXT =
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180">\n' +
  '  <image width="320" height="180" href="data:image/png;base64,AA=="/>\n' +
  "</svg>\n";
const RAIN_MEDIA: Media = {
  on: "rain-gauge",
  kind: "page",
  title: "Rain, measured",
  thumb: thumbRelPath("rain-gauge"),
  fetched: TAKEN,
};
const SOIL_MEDIA: Media = {
  on: "soil",
  kind: "video",
  title: "Soil, in motion",
  thumb: thumbRelPath("soil"),
  fetched: TAKEN,
};
/** A hand-written line naming no card: the orphan the app must keep. */
const GHOST_MEDIA: Media = {
  on: "ghost-card",
  kind: "page",
  title: "A page that is not on the map",
  thumb: thumbRelPath("ghost-card"),
  fetched: TAKEN,
};
const LINKS: GroundLink[] = [
  { from: "rain-gauge", to: "soil" },
  { from: "soil", to: "rain-gauge" },
  { from: "soil", to: "unrelated" },
];
const MALFORMED_GROUND = "not a ground line";
const MALFORMED_READINGS = "not a reading line";
const MALFORMED_LINKS = "not a link line";
const MALFORMED_MEDIA = "not a media line";

/** Seed the card the way the app's own writes did, byte for byte. */
async function seed(workspace: string): Promise<void> {
  await saveGround(workspace, [RAIN, SOIL], [MALFORMED_GROUND], groundIo);
  await saveReadings(workspace, [READING], [MALFORMED_READINGS], textIo as never);
  writeFileSync(readingTextPath(workspace, "rain-gauge"), READING_TEXT, "utf8");
  writeFileSync(notePath(workspace, "rain-gauge"), NOTE_TEXT, "utf8");
  await saveGroundLinks(workspace, LINKS, [MALFORMED_LINKS], groundIo);
  await saveMedia(
    workspace,
    [RAIN_MEDIA, SOIL_MEDIA, GHOST_MEDIA],
    [MALFORMED_MEDIA],
    mediaIo,
  );
  const rainThumb = join(workspace, "map", RAIN_MEDIA.thumb as string);
  const soilThumb = join(workspace, "map", SOIL_MEDIA.thumb as string);
  writeFileSync(rainThumb, THUMB_TEXT, "utf8");
  writeFileSync(soilThumb, THUMB_TEXT, "utf8");
}

/** EVERY file in the folder, keyed by its workspace-relative path. */
function folderBytes(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(path);
      } else {
        out[relative(root, path).split(sep).join("/")] = readFileSync(path, "utf8");
      }
    }
  }
  walk(root);
  return out;
}

/** The delete's order, the way the hook's one queued pass runs it. */
interface DeleteRun {
  captured: GroundMediaCapture;
  removed: RemovedCard;
  log: string[];
}

async function deleteCard(workspace: string, slug: string): Promise<DeleteRun> {
  const log: string[] = [];
  const loggingMediaIo: MediaIo = {
    ...mediaIo,
    readTextFile: async (path: string) => {
      log.push("read-media");
      return textIo.readTextFile(path);
    },
  };
  // STORY 16.14b — THE CAPTURE COMES FIRST, before any unlink (the hook's order).
  const loaded = await loadMedia(workspace, mediaIo);
  const captured = await captureGroundMedia(
    workspace,
    slug,
    loaded.media,
    loggingMediaIo,
  );
  const removalIo = {
    saveGround: async (
      workspace: string,
      references: readonly GroundReference[],
      malformed?: readonly string[],
    ) => {
      log.push("save-ground");
      await saveGround(workspace, [...references], malformed ?? [], groundIo);
    },
    saveReadings: async (
      workspace: string,
      readings: readonly Reading[],
      malformed?: readonly string[],
    ) => {
      log.push("save-readings");
      await saveReadings(workspace, [...readings], malformed ?? [], textIo as never);
    },
    removeFile: async (path: string) => {
      log.push("unlink-reading-text");
      rmSync(path, { force: true });
    },
    readTextFile: async (path: string) => {
      log.push("read-text");
      return textIo.readTextFile(path);
    },
  };
  const ground = await loadGround(workspace, groundIo);
  const removal = await removeGroundRecords(
    workspace,
    slug,
    ground.references,
    [READING],
    [MALFORMED_GROUND],
    [MALFORMED_READINGS],
    removalIo,
  );
  const noteRefusal = await removeGroundNote(workspace, slug, {
    ...textIo,
    listDir: async () => [],
    removeFile: async (path: string) => {
      log.push("unlink-note-file");
      rmSync(path, { force: true });
    },
    readTextFile: async (path: string) => {
      log.push("read-note");
      return textIo.readTextFile(path);
    },
  } as never);
  expect(noteRefusal).toBeNull();
  const mediaRemoval = await removeGroundMedia(
    workspace,
    slug,
    loaded.media,
    loaded.malformed,
    {
      ...mediaIo,
      writeTextFile: async (path: string, content: string) => {
        log.push("save-media");
        await textIo.writeTextFile(path, content);
      },
    },
  );
  expect(mediaRemoval.refusal).toBeNull();
  const links = await loadGroundLinks(workspace, groundIo);
  const cascaded = links.links
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => link.from === slug || link.to === slug);
  await removeGroundLinksNaming(workspace, slug, links.links, [MALFORMED_LINKS], groundIo);
  return {
    captured,
    log,
    removed: {
      ...(removal.removed as RemovedCard),
      links: cascaded,
      state: "current",
      media: captured.entry,
      mediaIndex: captured.index,
      thumbSvgText: captured.thumbSvgText,
    },
  };
}

/** The restore's real bridges (the same files, the same bytes). */
const restoreIo: GroundRestoreIo = {
  saveGround: (workspace, references, malformed) =>
    saveGround(workspace, [...references], malformed, groundIo),
  saveReadings: (workspace, readings, malformed) =>
    saveReadings(workspace, [...readings], malformed, textIo as never),
  saveGroundLinks: (workspace, links, malformed) =>
    saveGroundLinks(workspace, [...links], malformed, groundIo),
  saveMedia: (workspace, media, malformed) =>
    saveMedia(workspace, [...media], malformed, mediaIo),
  restoreReadingText: (workspace, on, text) =>
    restoreReadingText(workspace, on, text, textIo as never),
  restoreNote: (workspace, slug, text) =>
    restoreNote(workspace, slug, text, {
      ...textIo,
      listDir: async () => [],
      removeFile: async () => {},
    } as never),
  restoreThumb: (workspace, thumb, text) =>
    restoreThumb(workspace, thumb, text, mediaIo),
};

async function restoreCard(workspace: string, removed: RemovedCard) {
  const ground = await loadGround(workspace, groundIo);
  const links = await loadGroundLinks(workspace, groundIo);
  const media = await loadMedia(workspace, mediaIo);
  return restoreGroundCard(
    workspace,
    removed,
    ground.references,
    [READING],
    links.links,
    media.media,
    [MALFORMED_GROUND],
    [MALFORMED_READINGS],
    [MALFORMED_LINKS],
    media.malformed,
    restoreIo,
  );
}

describe("the delete reads the media line and the picture BEFORE any unlink", () => {
  test("the capture is first, and holds the exact line and wrapper bytes", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const { captured, log } = await deleteCard(workspace, "rain-gauge");
    // The capture's read is the FIRST thing the delete does...
    expect(log[0]).toBe("read-media");
    // ...and it lands before every save and every unlink.
    const firstUnlink = log.findIndex((entry) => entry.startsWith("unlink"));
    const firstSave = log.findIndex((entry) => entry.startsWith("save"));
    expect(firstUnlink).toBeGreaterThan(0);
    expect(firstSave).toBeGreaterThan(0);
    expect(log.indexOf("read-media")).toBeLessThan(firstUnlink);
    expect(log.indexOf("read-media")).toBeLessThan(firstSave);
    // THE BYTES, not a containment: exactly the line and the wrapper.
    expect(captured.entry).toEqual(RAIN_MEDIA);
    expect(captured.index).toBe(0);
    expect(captured.thumbSvgText).toBe(THUMB_TEXT);
  });

  test("a card with no media line captures nothing, quietly", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const media = await loadMedia(workspace, mediaIo);
    const captured = await captureGroundMedia(
      workspace,
      "a-card-with-no-line",
      media.media,
      mediaIo,
    );
    expect(captured.entry).toBeNull();
    expect(captured.index).toBe(-1);
    expect(captured.thumbSvgText).toBeNull();
    expect(
      existsSync(join(workspace, "map", "media", "a-card-with-no-line.svg")),
    ).toBe(false);
  });
});

describe("Restore keeps the picture, and the folder is byte-identical", () => {
  test("delete then restore: every file equals the copy taken before", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const before = folderBytes(workspace);
    const { removed } = await deleteCard(workspace, "rain-gauge");
    // Gone first: the media line and the wrapper really left the disk.
    expect(readFileSync(mediaPath(workspace), "utf8")).not.toContain("rain-gauge");
    expect(existsSync(join(workspace, "map", "media", "rain-gauge.svg"))).toBe(false);

    const result = await restoreCard(workspace, removed);
    expect(result.refusal).toBeNull();
    expect(result.restoredReference).toBe(true);
    expect(result.cameBack).toContain("the picture");
    expect(result.cameBack).toContain("the media line");
    // THE WHOLE FOLDER: every file, byte for byte, not "contains".
    expect(folderBytes(workspace)).toEqual(before);
    // The picture is back as the very bytes that were there (not a rewritten
    // wrapper built from base64).
    expect(readFileSync(join(workspace, "map", "media", "rain-gauge.svg"), "utf8")).toBe(
      THUMB_TEXT,
    );
    // The media line returned where it sat, not appended after Soil's and the
    // hand-written orphan's.
    const media = await loadMedia(workspace, mediaIo);
    expect(media.media.map((entry) => entry.on)).toEqual([
      "rain-gauge",
      "soil",
      "ghost-card",
    ]);
    expect(media.malformed).toEqual([MALFORMED_MEDIA]);
    // The card is back at its original file position too.
    const ground = await loadGround(workspace, groundIo);
    expect(ground.references.map((reference) => reference.on)).toEqual([
      "rain-gauge",
      "soil",
    ]);
  });

  test("a thumbnail that was already missing restores nothing and invents nothing", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    // The line stays; the picture is already gone before the delete (16.14's
    // rule: a missing thumbnail is not an error).
    rmSync(join(workspace, "map", "media", "rain-gauge.svg"));
    const before = folderBytes(workspace);
    const { captured, removed } = await deleteCard(workspace, "rain-gauge");
    expect(captured.entry).toEqual(RAIN_MEDIA);
    expect(captured.thumbSvgText).toBeNull();

    const result = await restoreCard(workspace, removed);
    expect(result.refusal).toBeNull();
    expect(result.cameBack).not.toContain("the picture");
    expect(result.didNot).not.toContain("the picture");
    // The folder is exactly the copy taken before — no picture was invented.
    expect(folderBytes(workspace)).toEqual(before);
    expect(existsSync(join(workspace, "map", "media", "rain-gauge.svg"))).toBe(false);
  });

  test("a refused picture write is ONE sentence naming what did not come back", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const { removed } = await deleteCard(workspace, "rain-gauge");
    const failing: GroundRestoreIo = {
      ...restoreIo,
      restoreThumb: async () => {
        throw new Error("EPERM");
      },
    };
    const ground = await loadGround(workspace, groundIo);
    const links = await loadGroundLinks(workspace, groundIo);
    const media = await loadMedia(workspace, mediaIo);
    const result = await restoreGroundCard(
      workspace,
      removed,
      ground.references,
      [READING],
      links.links,
      media.media,
      [MALFORMED_GROUND],
      [MALFORMED_READINGS],
      [MALFORMED_LINKS],
      media.malformed,
      failing,
    );
    expect(result.refusal).not.toBeNull();
    expect(result.refusal).toContain("the picture did not");
    // Everything else came back, so the card's title and text are not lost.
    expect(result.cameBack).toContain("the media line");
    expect(result.cameBack).toContain("the reading text");
    expect(result.cameBack).toContain("the reference");
  });
});

describe("a media line whose card is gone is an orphan: kept, reported, never adopted", () => {
  test("the pure rule finds it and leaves the map's references alone", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const media = await loadMedia(workspace, mediaIo);
    const ground = await loadGround(workspace, groundIo);
    const orphans = orphanMedia(
      media.media,
      ground.references.map((reference) => reference.on),
    );
    expect(orphans).toEqual([GHOST_MEDIA]);
    // Never adopted: a line is not a card, and the map still carries two.
    expect(ground.references.map((reference) => reference.on)).toEqual([
      "rain-gauge",
      "soil",
    ]);
    // Never deleted: the folder still holds every line, the orphan included.
    expect(existsSync(mediaPath(workspace))).toBe(true);
    expect(readFileSync(mediaPath(workspace), "utf8")).toContain('"on":"ghost-card"');
  });

  test("the mirror names it under what is unknown, read from disk", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const media = await loadMedia(workspace, mediaIo);
    const ground = await loadGround(workspace, groundIo);
    const text = renderMirror({
      references: ground.references,
      readings: [READING],
      texts: {},
      states: { "rain-gauge": "current", soil: "unread" },
      notes: {},
      orphanNotes: [],
      // The same computation the hook's mirror view makes: the filter is the
      // load's, so the mirror cannot disagree with the notices about it.
      orphanMedia: orphanMedia(
        media.media,
        ground.references.map((reference) => reference.on),
      ),
      links: [],
      orphanLinks: [],
      malformedGround: ground.malformed,
      malformedReadings: [],
      malformedLinks: [],
      asks: [],
      malformedAsks: [],
      orphanAskTurns: [],
    });
    expect(text).toContain("## What is unknown");
    expect(text).toContain(
      "media with no card on the map: " + serializeMediaLine(GHOST_MEDIA),
    );
    // A picture with no card is never drawn on the map itself.
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("the hook computes orphans on load and every write, and App names them", () => {
    expect(HOOK).toContain("orphanMedia(");
    expect(HOOK).toContain("orphanMedia: orphanMedia(");
    expect(APP).toContain("orphanGroundMedia={ground.orphanMedia}");
    expect(APP).toContain("map/media.jsonl");
    // The notices reuse the existing quiet class: no new surface, no count.
    expect(APP).toContain("orphan-ground-media-");
    expect(APP).not.toMatch(/media\s+(count|total|score)/i);
  });

  test("a delete of another card never takes the orphan with it", async () => {
    const workspace = freshWorkspace();
    await seed(workspace);
    const { removed } = await deleteCard(workspace, "rain-gauge");
    // The orphan's line is still in the file while the card is away.
    const mid = await loadMedia(workspace, mediaIo);
    expect(mid.media.map((entry) => entry.on)).toEqual(["soil", "ghost-card"]);
    await restoreCard(workspace, removed);
    const after = await loadMedia(workspace, mediaIo);
    expect(after.media).toContainEqual(GHOST_MEDIA);
  });
});
