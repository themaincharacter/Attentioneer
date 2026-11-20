import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import type { GroundReference } from "../src/map/ground";
import type { GroundLink } from "../src/map/groundLinks";
import type { Media } from "../src/map/media";
import { removeGroundRecords, restoreGroundCard } from "../src/canvas/useGround";
import {
  acceptLine,
  createAttentioneerHost,
} from "../src/commands/attentioneerHost";
import { executeScript } from "../src/commands/execute";
import {
  groundPath,
  loadGround,
  saveGround,
} from "../src/map/ground";
import {
  groundLinksPath,
  loadGroundLinks,
  saveGroundLinks,
} from "../src/map/groundLinks";
import { loadNotes, notePath, restoreNote } from "../src/map/notes";
import { restoreThumb, saveMedia } from "../src/map/media";
import {
  restoreReadingText,
  saveReadings,
  type Reading,
} from "../src/map/readings";
import { nodeCommandIo } from "../scripts/commands";

/**
 * STORY 21.6 — THE VOCABULARY LEARNS TO REMOVE (ADR-0038's 2026-11-20
 * amendment: the command card is a PRIMARY way to use the app, and a surface
 * that can only add cannot fix a mistake it just made).
 *
 * What this file proves, in the story's own words:
 *
 *   - each removing act files exactly ONE ghost and changes NO record until the
 *     person accepts;
 *   - accepting produces exactly the expected removal (the one wire line, the
 *     one note file, the one card line);
 *   - a removal ghosts ONLY the removal: a removed card's wires, note and
 *     reading stay put (the app's own delete path is where the cascade lives);
 *   - a card that is not there is refused BY NAME, before any ghost;
 *   - the app's own delete/Restore path still works afterwards;
 *   - how the intake expresses a removal: the ghost step vocabulary's second
 *     op, pinned here through a real accept.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-removal-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const GROUND =
  "on: rain | name: rain | x: 0 | y: 0\non: soil | name: soil | x: 120 | y: 0\n";
const LINKS = "from: rain | to: soil\n";
const NOTE = "the gauge is the rain card\n";

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map/notes"), { recursive: true });
  writeFileSync(join(path, "map/ground.txt"), GROUND, "utf8");
  writeFileSync(join(path, "map/ground-links.txt"), LINKS, "utf8");
  writeFileSync(join(path, "map/notes/rain.md"), NOTE, "utf8");
  return path;
}

/** Every file under the workspace except the intake's own folder, byte for byte. */
function recordsOf(path: string): Map<string, Buffer> {
  const found = new Map<string, Buffer>();
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(path, full);
      if (rel === ".attentioneer" || rel.startsWith(".attentioneer/")) continue;
      if (entry.isDirectory()) walk(full);
      else found.set(rel, readFileSync(full));
    }
  };
  walk(path);
  return found;
}

function expectSameRecords(before: Map<string, Buffer>, after: Map<string, Buffer>): void {
  expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
  for (const [rel, bytes] of before) {
    expect(after.get(rel)?.equals(bytes)).toBe(true);
  }
}

function inboxNames(path: string): string[] {
  try {
    return readdirSync(join(path, ".attentioneer/inbox")).sort();
  } catch {
    return [];
  }
}

function text(path: string): string {
  return readFileSync(path, "utf8");
}

/** The real node bridge, for the record loaders the app normally calls. */
const IO = nodeCommandIo();

/** The app's own delete path's bridges, over the same real filesystem. */
const REMOVAL_IO = {
  saveGround: (
    workspacePath: string,
    references: readonly GroundReference[],
    malformed: readonly string[],
  ) => saveGround(workspacePath, references, malformed, IO),
  saveReadings: (
    workspacePath: string,
    readings: readonly Reading[],
    malformed: readonly string[],
  ) => saveReadings(workspacePath, readings, malformed, IO),
  removeFile: (path: string) => IO.removeFile(path),
  readTextFile: (path: string) => IO.readTextFile(path),
};

/** The app's own Restore bridges, over the same real filesystem. */
const RESTORE_IO = {
  saveGround: REMOVAL_IO.saveGround,
  saveReadings: REMOVAL_IO.saveReadings,
  saveGroundLinks: (
    workspacePath: string,
    links: readonly GroundLink[],
    malformed: readonly string[],
  ) => saveGroundLinks(workspacePath, links, malformed, IO),
  saveMedia: (
    workspacePath: string,
    media: readonly Media[],
    malformed: readonly string[],
  ) => saveMedia(workspacePath, media, malformed, IO),
  restoreReadingText: (workspacePath: string, slug: string, bytes: string) =>
    restoreReadingText(workspacePath, slug, bytes, IO),
  restoreNote: (workspacePath: string, slug: string, bytes: string) =>
    restoreNote(workspacePath, slug, bytes, IO),
  restoreThumb: (workspacePath: string, name: string, bytes: string) =>
    restoreThumb(workspacePath, name, bytes, IO),
};

describe("a removal is a ghost: ONE ghost, and no record changes until the accept", () => {
  test("unwire: one ghost, the links byte-identical, then the one line leaves", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [{ act: "propose_unwire", map: "ground", payload: { from: "rain", to: "soil" } }],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(1);
    expect(run.lines[0]).toContain("proposed removing the wire");
    expect(inboxNames(path)).toHaveLength(1);
    expectSameRecords(before, recordsOf(path));

    // The filed envelope names ONE removal, through the intake's second step op.
    const envelope = JSON.parse(
      text(join(path, ".attentioneer/inbox", inboxNames(path)[0]!)),
    );
    expect(envelope.steps).toHaveLength(1);
    expect(envelope.steps[0].op).toBe("remove");
    expect(envelope.steps[0].file).toBe("map/ground-links.txt");
    expect(envelope.steps[0].line).toBe("from: rain | to: soil");

    const answers = await host.accept(run.ids);
    expect(answers[0]?.outcome.outcome).toBe("applied");
    expect((await loadGroundLinks(path, IO)).links).toEqual([]);
    expect(text(join(path, "map/ground.txt"))).toBe(GROUND);
    expect(text(join(path, "map/notes/rain.md"))).toBe(NOTE);
    expect(inboxNames(path)).toEqual([]);
  });

  test("remove_note: one ghost and the note file, then the file itself goes", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [{ act: "propose_remove_note", map: "ground", payload: { card: "rain" } }],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(1);
    expect(inboxNames(path)).toHaveLength(1);
    expectSameRecords(before, recordsOf(path));

    const answers = await host.accept(run.ids);
    expect(answers[0]?.outcome.outcome).toBe("applied");
    expect(existsSync(notePath(path, "rain"))).toBe(false);
    // The card, the wire and every other record are untouched.
    expect(text(join(path, "map/ground.txt"))).toBe(GROUND);
    expect(text(join(path, "map/ground-links.txt"))).toBe(LINKS);
    expect(await loadNotes(path, ["rain", "soil"], IO)).toEqual({
      notes: {},
      orphans: [],
    });
  });

  test("remove_card: one ghost and one line, then the card's line leaves", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    const run = await executeScript(
      [{ act: "propose_remove_card", map: "ground", payload: { card: "rain" } }],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(1);
    expect(inboxNames(path)).toHaveLength(1);
    expectSameRecords(before, recordsOf(path));

    const answers = await host.accept(run.ids);
    expect(answers[0]?.outcome.outcome).toBe("applied");
    expect(acceptLine(run.ids[0]!, answers[0]!.outcome)).toContain("1 line(s) written");
    const ground = await loadGround(path, IO);
    expect(ground.references.map((entry) => entry.on)).toEqual(["soil"]);
    expect(ground.malformed).toEqual([]);
  });
});

describe("a removal ghosts ONLY the removal: no invented cascade", () => {
  test("a removed card leaves its wire, note and reading where they are", async () => {
    const path = freshWorkspace();
    mkdirSync(join(path, "map/readings"), { recursive: true });
    writeFileSync(join(path, "map/readings/rain.md"), "the reading text\n", "utf8");
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [{ act: "propose_remove_card", map: "ground", payload: { card: "rain" } }],
      host,
    );
    expect(run.ok).toBe(true);
    await host.accept(run.ids);

    // The card's line is gone…
    expect(text(groundPath(path))).toBe(
      "on: soil | name: soil | x: 120 | y: 0\n",
    );
    // …and the app's cascade did NOT ride along: the wire (an orphan the links
    // family preserves and reports), the note and the reading are untouched.
    expect(text(groundLinksPath(path))).toBe(LINKS);
    expect(text(notePath(path, "rain"))).toBe(NOTE);
    expect(text(join(path, "map/readings/rain.md"))).toBe("the reading text\n");
    const links = await loadGroundLinks(path, IO);
    expect(links.links).toEqual([{ from: "rain", to: "soil" }]);
    // The removed card's name is no longer one the digest records can resolve.
    expect(renderedMapContent("ground")).toEqual([]);
  });
});

describe("a card named must EXIST: the refusal is by name, before any ghost", () => {
  test("every removing act refuses a card that is not on the map", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);
    for (const act of [
      { act: "propose_remove_card", map: "ground", payload: { card: "the sea" } },
      { act: "propose_remove_note", map: "ground", payload: { card: "the sea" } },
      { act: "propose_unwire", map: "ground", payload: { from: "rain", to: "the sea" } },
    ]) {
      const run = await executeScript([act], host);
      expect(run.ok).toBe(false);
      expect(run.sentence).toContain('"the sea"');
      expect(run.ids).toEqual([]);
    }
    expect(inboxNames(path)).toEqual([]);
    expectSameRecords(before, recordsOf(path));
  });

  test("a wire the map does not hold, and a card with no note, are refused by name", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const noWire = await executeScript(
      [{ act: "propose_unwire", map: "ground", payload: { from: "soil", to: "rain" } }],
      host,
    );
    expect(noWire.ok).toBe(false);
    expect(noWire.sentence).toContain('the map does not wire "soil" to "rain"');
    const noNote = await executeScript(
      [{ act: "propose_remove_note", map: "ground", payload: { card: "soil" } }],
      host,
    );
    expect(noNote.ok).toBe(false);
    expect(noNote.sentence).toContain('"soil" has no note to remove');
    expect(inboxNames(path)).toEqual([]);
  });
});

describe("the app's own Restore still works afterwards", () => {
  test("the card-delete path still removes and puts a card back byte for byte", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [{ act: "propose_remove_card", map: "ground", payload: { card: "rain" } }],
      host,
    );
    expect(run.ok).toBe(true);
    await host.accept(run.ids);
    const afterCommand = recordsOf(path);

    // The person's own delete path (the card's ×) is untouched by the story:
    // delete the remaining card through it, then press its Restore.
    const ground = await loadGround(path, IO);
    const readings: Reading[] = [];
    const links = await loadGroundLinks(path, IO);
    const removal = await removeGroundRecords(
      path,
      "soil",
      ground.references,
      readings,
      ground.malformed,
      [],
      REMOVAL_IO,
    );
    expect(removal.removed).not.toBeNull();
    // The app's own cascade: the caller takes the links naming the card, with
    // their file positions, so Restore can put them back there.
    const naming = links.links
      .map((link, index) => ({ link, index }))
      .filter(({ link }) => link.from === "soil" || link.to === "soil");
    const linksAfter = links.links.filter(
      (link) => link.from !== "soil" && link.to !== "soil",
    );
    await saveGroundLinks(path, linksAfter, links.malformed, IO);
    const restore = await restoreGroundCard(
      path,
      { ...removal.removed!, links: naming },
      removal.references,
      removal.readings,
      linksAfter,
      [],
      ground.malformed,
      [],
      links.malformed,
      [],
      RESTORE_IO,
    );
    expect(restore.restoredReference).toBe(true);
    expect(restore.refusal).toBeNull();
    // The map is back to exactly what the command's own removal left.
    expect(recordsOf(path).get("map/ground.txt")).toEqual(afterCommand.get("map/ground.txt"));
    // And the removed card's own records were never touched by that restore.
    expect(text(notePath(path, "rain"))).toBe(NOTE);
  });
});
