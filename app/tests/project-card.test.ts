import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  GroundLayer,
  readingAbsenceLine,
  readingKind,
} from "../src/canvas/GroundLayer";
import {
  ProjectCardIo,
  metasOf,
  projectCardRefusal,
  writeProjectCard,
} from "../src/canvas/useGround";
import { dropCardName } from "../src/canvas/osDrop";
import type { GroundReference } from "../src/map/ground";
import {
  PROJECT_FOLDER_GONE,
  PROJECT_FOLDER_GONE_KEPT,
  PROJECT_FOLDER_SENTENCE,
  PROJECT_FOLDER_UNREACHABLE,
  folderKeptProvenance,
  folderReading,
  parseReadingLine,
  parseReadings,
  readingStateWord,
  resolveReadingState,
  serializeReadingLine,
  serializeReadings,
  type Reading,
} from "../src/map/readings";
import { renderMirror } from "../src/map/mirror";
import { pullReading, type PullIo } from "../src/map/pull";
import type { FileMetaAnswer, TextHead } from "../src/lib/fs";

/**
 * PROVISIONAL — THE PROJECT CARD: a ground reference whose pointer is a FOLDER
 * elsewhere on this machine (a repo the workspace does not own).
 *
 * The human check is "double-click the ground map, choose the folder door,
 * name it, pick a repo folder on disk, and the card says plainly it is a
 * folder elsewhere that this workspace does not own it. Quit, reopen — the
 * card is there, same place, same sentence." This file pins the rules under
 * it:
 *
 *   - the `folder` reading line round-trips, with an absolute Windows path;
 *   - a folder is NOT "unreadable": the stat-only state is current when the
 *     place is there and gone when it is not;
 *   - the face says what the card IS and claims no reading content, and no
 *     full path reaches the face;
 *   - MAP.md names the folder only, never its path;
 *   - an empty name or no folder writes NOTHING at all;
 *   - the face names no other product.
 *
 * PROVISIONAL (the story's record shape, before an ADR settles it): the
 * `folder` form, the absolute `from` value, the one sentence and the mirror's
 * `folder:` row.
 */

const APP_DIR = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP_DIR, "src", rel), "utf8");
}

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-project-card-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  return path;
}

const TAKEN = "2026-11-19T09:00:00.000Z";
const WINDOWS_FOLDER = String.raw`C:\Users\ada\code\attentioneer`;
const POSIX_FOLDER = "/home/ada/code/attentioneer";
const SLUG = "attentioneer";

const reference: GroundReference = {
  on: SLUG,
  name: "Attentioneer",
  x: 40,
  y: 60,
};

const reading: Reading = folderReading(SLUG, POSIX_FOLDER, TAKEN);

const FOLDER_META: FileMetaAnswer = {
  kind: "facts",
  exists: true,
  // A folder's stat answer: there, not a regular file, no size.
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

const inertVerbs = {
  onMove: async () => ({ ok: true as const }),
  onRefresh: async () => ({ ok: true as const }),
  onRepoint: async () => ({ ok: true as const }),
  onRemove: async () => ({ ok: true as const }),
};

describe("the folder line round-trips", () => {
  test("an absolute Windows folder path parses, serializes and parses again", () => {
    const card = folderReading(SLUG, WINDOWS_FOLDER, TAKEN);
    const line = serializeReadingLine(card);
    expect(line).toBe(
      `on: ${SLUG} | form: folder | from: ${WINDOWS_FOLDER} | taken: ${TAKEN}`,
    );
    expect(parseReadingLine(line)).toEqual(card);
    const bytes = serializeReadings([card]);
    expect(parseReadings(bytes).readings).toEqual([card]);
    expect(parseReadings(bytes).malformed).toEqual([]);
  });

  test("a POSIX path with a separator inside it survives the greedy `from`", () => {
    const odd = "/home/ada/code/a|b/attentioneer";
    const card = folderReading(SLUG, odd, TAKEN);
    expect(parseReadingLine(serializeReadingLine(card))).toEqual(card);
  });

  test("a relative value is refused, kept and reported — never half-read", () => {
    const line = `on: ${SLUG} | form: folder | from: code/repo | taken: ${TAKEN}`;
    expect(parseReadingLine(line)).toBeNull();
    const parsed = parseReadings(line);
    expect(parsed.readings).toEqual([]);
    expect(parsed.malformed).toEqual([line]);
  });

  test("a folder card carries no extract, no bytes and no reading text", () => {
    const card = folderReading(SLUG, POSIX_FOLDER, TAKEN);
    expect("extract" in card).toBe(false);
    expect("bytes" in card).toBe(false);
    expect(card.form).toBe("folder");
    expect(card.from).toBe(POSIX_FOLDER);
  });
});

describe("a folder is a pointer, not an unreadable file", () => {
  test("the stat-only state is current when the folder is there", () => {
    expect(resolveReadingState(reading, FOLDER_META, Date.now())).toBe(
      "current",
    );
    // The absence of an extract does not make it "unreadable": nothing was
    // taken, so there is nothing that could fail to be read.
    expect(resolveReadingState(reading, MISSING_META, Date.now())).toBe(
      "missing",
    );
    expect(
      resolveReadingState(reading, { kind: "refused" }, Date.now()),
    ).toBe("unreadable");
  });

  test("with NO copy kept, the card never claims one", () => {
    expect(readingStateWord("current", reading)).toBeNull();
    expect(readingAbsenceLine("current", reading)).toBe(
      PROJECT_FOLDER_SENTENCE,
    );
    expect(readingAbsenceLine("missing", reading)).toBe(PROJECT_FOLDER_GONE);
    expect(readingAbsenceLine("unreadable", reading)).toBe(
      PROJECT_FOLDER_UNREACHABLE,
    );
    // STORY 20.1: the place is elsewhere and NOT owned — the user's words stay.
    // "reads nothing from it" is gone, because an expand now keeps a listing.
    expect(PROJECT_FOLDER_SENTENCE).toContain("does not own it");
    expect(PROJECT_FOLDER_SENTENCE).not.toContain("reads nothing");
    // The no-copy sentences stay true: nothing was copied, so nothing is left.
    for (const sentence of [PROJECT_FOLDER_GONE, PROJECT_FOLDER_UNREACHABLE]) {
      expect(sentence).not.toContain("verified");
      expect(sentence).toContain("nothing was copied");
    }
  });

  test("with a copy kept, the card says WHAT the words are and WHEN", () => {
    const kept: Reading = {
      ...folderReading(SLUG, POSIX_FOLDER, TAKEN),
      bytes: 64,
      extract: "listing",
    };
    // The footer's one line names the kept listing and its one quiet date.
    expect(folderKeptProvenance(kept)).toBe(
      "the listing kept when it was read · 2026-11-19",
    );
    // A bare card keeps naming the folder instead.
    expect(folderKeptProvenance(reading)).toBeNull();
    // A gone folder WITH a copy says the copy is still what is on screen.
    expect(readingStateWord("missing", kept)).toBe(PROJECT_FOLDER_GONE_KEPT);
    expect(readingAbsenceLine("missing", kept)).toBe(PROJECT_FOLDER_GONE_KEPT);
    // Unreachable keeps its existing shape; a current card says nothing.
    expect(readingAbsenceLine("unreadable", kept)).toBe(
      PROJECT_FOLDER_UNREACHABLE,
    );
    expect(readingStateWord("current", kept)).toBeNull();
    // A line that claims a listing whose text file is gone says so plainly.
    expect(readingAbsenceLine("current", kept)).toBe(
      "the reading text is not here.",
    );
    for (const sentence of [
      PROJECT_FOLDER_GONE_KEPT,
      folderKeptProvenance(kept) as string,
    ]) {
      expect(sentence).not.toContain("verified");
    }
  });

  test("nothing opens the folder: the pull guard refuses before a read", async () => {
    let opened = 0;
    const io: PullIo = {
      readTextHead: async (): Promise<TextHead> => {
        opened += 1;
        return {
          head: "SHOULD NOT BE READ",
          truncated: false,
          exists: true,
          size: 1,
          mtime: null,
          decode: "clean",
        };
      },
      readFileBytes: async () => ({ kind: "refused", code: "io" }),
      pdfText: async () => null,
    };
    const pulled = await pullReading("/w/garden", reading, 1024, io);
    expect(pulled.kind).toBe("refused");
    expect(opened).toBe(0);
  });

  test("the load asks the bridge for a folder's metadata, and only that", async () => {
    const asked: string[] = [];
    const metas = await metasOf(
      "/w/garden",
      [reading, folderReading("other", WINDOWS_FOLDER, TAKEN)],
      async (path) => {
        asked.push(path);
        return FOLDER_META;
      },
    );
    expect(asked.sort()).toEqual([POSIX_FOLDER, WINDOWS_FOLDER].sort());
    expect(metas.get(SLUG)?.kind).toBe("facts");
  });
});

describe("the card's face says what it is and claims no reading", () => {
  function render(state: "current" | "missing" = "current"): string {
    return renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [reading],
        texts: {},
        states: { [SLUG]: state },
        ...inertVerbs,
      }),
    );
  }

  test("the one sentence is on the face; no reading content is claimed", () => {
    const html = render();
    expect(html).toContain(PROJECT_FOLDER_SENTENCE);
    expect(html).toContain("ground-reading ground-refusal");
    // The reading slot must not borrow another form's lines.
    expect(html).not.toContain("the reading text is not here");
    expect(html).not.toContain("the reading kept from");
    expect(html).not.toContain("no reading was taken yet");
    // No full path on the plane: the footer names the folder only.
    expect(html).toContain("attentioneer");
    expect(html).not.toContain(POSIX_FOLDER);
  });

  test("a gone folder says gone and still claims no copy", () => {
    expect(render("missing")).toContain(PROJECT_FOLDER_GONE);
  });

  test("a TAKEN card renders the kept listing, the date and no verdict", () => {
    const kept: Reading = {
      ...folderReading(SLUG, POSIX_FOLDER, TAKEN),
      bytes: 64,
      extract: "listing",
    };
    const listing = "readme.md\nsrc/\n\nreadme:\n# A quiet map\n";
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [kept],
        texts: { [SLUG]: listing },
        states: { [SLUG]: "current" },
        ...inertVerbs,
      }),
    );
    // The kept words render like any reading, with the kept line in the footer.
    expect(html).toContain("src/");
    expect(html).toContain("# A quiet map");
    expect(html).toContain("the listing kept when it was read");
    expect(html).toContain("2026-11-19");
    // The no-copy sentence is not repeated once a copy is kept.
    expect(html).not.toContain(PROJECT_FOLDER_SENTENCE);
    expect(html).not.toContain("verified");
    // No full path reaches the plane, exactly as before.
    expect(html).not.toContain(POSIX_FOLDER);
  });

  test("a gone folder WITH a kept copy still shows the words and says why", () => {
    const kept: Reading = {
      ...folderReading(SLUG, POSIX_FOLDER, TAKEN),
      bytes: 64,
      extract: "listing",
    };
    const html = renderToStaticMarkup(
      createElement(GroundLayer, {
        references: [reference],
        readings: [kept],
        texts: { [SLUG]: "readme.md\nsrc/\n" },
        states: { [SLUG]: "missing" },
        ...inertVerbs,
      }),
    );
    expect(html).toContain(PROJECT_FOLDER_GONE_KEPT);
    expect(html).toContain("src/");
    expect(html).not.toContain(PROJECT_FOLDER_GONE);
  });

  test("the expanded card grows the refresh and the folder verbs, and the expand takes", () => {
    // The layer is the app's view; the take and the opener are the hook's and
    // the outward door's. The card only asks, and only on the person's gesture.
    const layer = source("canvas/GroundLayer.tsx");
    expect(layer).toContain("onTakeListing(reference.on)");
    expect(layer).toContain("folderListingKept(reading)");
    expect(layer).toContain("const canOpenFolder = open && folderCard;");
    expect(layer).toContain("const canRefresh =");
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("takeFolderReading");
    expect(hook).toContain("refreshFolderReading");
  });

  test("no separate kind row repeats what the one sentence already says", () => {
    expect(readingKind(reading, new Map())).toBeNull();
  });

  test("the face speaks only the map's quiet lowercase words", () => {
    const face = render();
    const text = face.replace(/<[^>]*>/g, " ");
    // The person's own coined name is the only capitalised word the face may
    // carry; a borrowed product's name would arrive capitalised, and the face
    // says nothing about whose design this is.
    const capitals = text
      .split(/\s+/)
      .filter((word) => word !== "" && /[A-Z]/.test(word) && !word.includes("Attentioneer"));
    expect(capitals).toEqual([]);
    expect(face).not.toContain("://");
  });
});

describe("MAP.md names the folder, never its path", () => {
  const view = {
    references: [reference],
    readings: [reading],
    texts: {},
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

  test("the row says folder and the folder's name only", () => {
    const text = renderMirror(view);
    expect(text).toContain("### Attentioneer");
    expect(text).toContain("folder: attentioneer");
    expect(text).toContain("a folder elsewhere; this workspace does not own it");
    expect(text).not.toContain(POSIX_FOLDER);
    expect(text).not.toContain("/home/ada");
  });

  test("a gone folder's row says so without inventing a reading", () => {
    const text = renderMirror({
      ...view,
      states: { [SLUG]: "missing" as const },
    });
    expect(text).toContain("state: the folder is not there");
    expect(text).not.toContain("reading:");
  });
});

describe("a refused project card writes nothing", () => {
  function loggingIo(log: string[]): ProjectCardIo {
    return {
      saveReadings: async () => {
        log.push("readings");
      },
      saveGround: async () => {
        log.push("ground");
      },
    };
  }

  test("the refusal rule is the bubble's and the writer's one rule: only the folder", () => {
    // A NAME IS OPTIONAL (the person, 2026-11-25): a blank one is named from
    // the folder's own name at the commit, so it never refuses here.
    expect(projectCardRefusal("", POSIX_FOLDER)).toBeNull();
    expect(projectCardRefusal("   ", POSIX_FOLDER)).toBeNull();
    expect(projectCardRefusal("Repo", "")).toBe("pick a folder first.");
    expect(projectCardRefusal("Repo", "code/repo")).toBe(
      "pick a folder first.",
    );
    expect(projectCardRefusal("Repo", POSIX_FOLDER)).toBeNull();
    // The world's name for a blank field: the folder's own name.
    expect(dropCardName(POSIX_FOLDER)).toBe("attentioneer");
  });

  test("a missing folder reaches neither writer nor disk; a blank name is named from the folder", async () => {
    const workspace = freshWorkspace();
    const log: string[] = [];
    const io = loggingIo(log);
    const before = existsSync(join(workspace, "map", "readings"));

    const noFolder = await writeProjectCard(
      workspace,
      [],
      [],
      [],
      [],
      "Repo",
      10,
      20,
      "",
      new Set(),
      TAKEN,
      io,
    );
    expect(noFolder).toEqual({ ok: false, message: "pick a folder first." });

    const relative = await writeProjectCard(
      workspace,
      [],
      [],
      [],
      [],
      "Repo",
      10,
      20,
      "code/repo",
      new Set(),
      TAKEN,
      io,
    );
    expect(relative).toEqual({ ok: false, message: "pick a folder first." });

    // A refusal reaches neither writer nor disk.
    expect(log).toEqual([]);
    expect(existsSync(join(workspace, "map", "readings"))).toBe(before);
    expect(existsSync(join(workspace, "map", "ground.txt"))).toBe(false);
    expect(existsSync(join(workspace, "map", "readings.txt"))).toBe(false);

    // A blank name is no longer a refusal (the person, 2026-11-25): the
    // bubble names it from the folder's own name before the writer, and the
    // named card lands.
    const named = await writeProjectCard(
      workspace,
      [],
      [],
      [],
      [],
      dropCardName(POSIX_FOLDER),
      10,
      20,
      POSIX_FOLDER,
      new Set(),
      TAKEN,
      io,
    );
    expect(named.ok).toBe(true);
    if (!named.ok) return;
    expect(named.reference.name).toBe("attentioneer");
    expect(named.reference.on).toBe("attentioneer");
  });

  test("a committed card writes the reading line first, the ground line last", async () => {
    const workspace = freshWorkspace();
    const log: string[] = [];
    const written = await writeProjectCard(
      workspace,
      [],
      [],
      [],
      [],
      "Attentioneer",
      41.6,
      60.4,
      POSIX_FOLDER,
      new Set(),
      TAKEN,
      loggingIo(log),
    );
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    expect(log).toEqual(["readings", "ground"]);
    expect(written.reference.on).toBe(SLUG);
    // Coordinates round to whole map units, like every ground line.
    expect([written.reference.x, written.reference.y]).toEqual([42, 60]);
    expect(written.reading).toEqual(folderReading(SLUG, POSIX_FOLDER, TAKEN));
    // Nothing was read, so no reading text file is written beside the map.
    expect(existsSync(join(workspace, "map", "readings", SLUG + ".md"))).toBe(
      false,
    );
  });

  test("the written line is canonical bytes and re-opens to the same pointer", () => {
    const card = folderReading(SLUG, WINDOWS_FOLDER, TAKEN);
    const readingsText = serializeReadings([card]);
    // LF and ONE trailing newline: the record files' convention.
    expect(readingsText).toBe(
      `on: attentioneer | form: folder | from: ${WINDOWS_FOLDER} | taken: ${TAKEN}\n`,
    );
    expect(readingsText.endsWith("\r")).toBe(false);
    // Reopening parses the line back to the same absolute pointer.
    const reopened = parseReadings(readingsText);
    expect(reopened.malformed).toEqual([]);
    expect(reopened.readings).toEqual([card]);
  });
});

describe("the code says nothing about whose design it is", () => {
  test("the folder picker is a directory dialog, with no new bridge", () => {
    const dialogs = source("workspace/dialogs.ts");
    const bubble = source("canvas/GroundBubble.tsx");
    expect(dialogs).toContain("directory: true");
    expect(bubble).toContain('pickFolder("pick a folder")');
    // The pick is handed through the app's one flow; the face never reads it.
    expect(bubble).toContain('intent === "folder" ? onAddFolder : onAdd');
  });
});
