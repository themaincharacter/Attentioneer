import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { DEFAULT_SHELF_X } from "../src/map/shelf";
import {
  agentsMd,
  scaffoldWrites,
  workspaceScaffold,
  workspaceYml,
  type ScaffoldFile,
} from "../src/lib/serialize";

/**
 * Story-5 guarantee, automated: the scaffolded workspace `AGENTS.md` gains the
 * Level 2 orientation and the reading rule (ADR-0015's write-once rule), while
 * Level 1's orientation text stays exactly as it was. Epic 5 story 3 adds
 * Level 3's orientation (the render map, the three `level` values with garbage
 * tolerance, the pointer forms and their resolution, the window's snapshot
 * wording) the same way: only NEW workspaces get it. The scaffold is
 * WRITE-ONCE: only files that are missing are written, so an old workspace
 * keeps its own bytes and only a NEW workspace gets the new orientation.
 *
 * `scaffoldWorkspace` crosses the Tauri fs bridge, which no unit test has; the
 * scaffold's content and its write-once rule are pure here (`workspaceScaffold`,
 * `scaffoldWrites`), and "opening never writes" is asserted against the
 * lifecycle source the app runs (no fs stub invented for it).
 */

const OLD_AGENTS_MD = [
  "# garden — agent orientation",
  "",
  "The pre-Epic-4 orientation text a workspace created by an older app holds.",
  "",
].join("\n");

/** A workspace created by the Level 2 app: it has Level 2's text, not level 3's. */
const PRE_LEVEL_3_AGENTS_MD = [
  "# garden — agent orientation",
  "",
  "## Level 2 — the dynamics model",
  "",
  "The pre-Epic-5 orientation text a workspace created by the previous app holds.",
  "",
].join("\n");

const WS = "/home/maps/garden";

/** The bytes a folder would hold after one scaffold pass (write-once). */
function scaffoldInto(
  disk: Map<string, string>,
  name: string,
): Map<string, string> {
  const files = workspaceScaffold(WS, name);
  for (const file of scaffoldWrites(files, new Set(disk.keys()))) {
    disk.set(file.path, file.content);
  }
  return disk;
}

function scaffoldFile(name: string): ScaffoldFile {
  const file = workspaceScaffold(WS, "garden").find((candidate) =>
    candidate.path.endsWith(name),
  );
  if (!file) throw new Error(`the scaffold must offer ${name}`);
  return file;
}

/** The source text of one exported function in a module file. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf("\n}", start);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("the new workspace scaffold gains the Level 2 orientation", () => {
  const md = agentsMd("garden");

  test("the four records are named, each with its shape", () => {
    expect(md).toContain("map/model.json");
    expect(md).toContain("map/links.jsonl");
    expect(md).toContain("map/loops.jsonl");
    expect(md).toContain("map/assumptions.jsonl");

    // model.json: a playing set of sorted slugs; links: from/to/sign.
    expect(md).toContain('"words": [...]');
    expect(md).toContain("The ordered pair is the key");
    // loops: a coined name and a closed path; assumptions: text + one target.
    expect(md).toContain("closed `path`");
    expect(md).toContain("its `text` and");
    expect(md).toContain("`from`/`to` link pair");
  });

  test("the level key is the one source of the active game", () => {
    expect(md).toContain("`workspace.yml`'s `level` key");
    expect(md).toContain('"concept"');
    expect(md).toContain('"dynamics"');
    expect(md).toContain("the only source of the active game");
  });

  test("the reading rule: polarity, exact direction, rotation, exact matching", () => {
    // + = same direction, - = opposite (polarity, never a magnitude).
    expect(md).toContain("`+` means the pair moves");
    expect(md).toContain("`-` means opposite");
    // exact-direction matching, never a reversed link.
    expect(md).toContain("by EXACT direction");
    expect(md).toContain('from: "A", to: "B"');
    expect(md).toContain("Never read a reverse-only link");
    // rotation-canonical paths.
    expect(md).toContain("rotation-canonical");
    expect(md).toContain("the smallest");
  });

  test("the verdict appears only when every step and every word qualifies", () => {
    expect(md).toContain('Say "reinforcing"');
    expect(md).toContain('"balancing"');
    expect(md).toContain("every step's sign is known and every path word");
    expect(md).toContain("is on the map and in the playing set");
    // A mark overrides the stored sign while it stands; withdrawing restores it.
    expect(md).toContain("A mark on a link overrides its stored");
    expect(md).toContain("withdrawing the mark restores it");
    // Gaps are named, never guessed or repaired.
    expect(md).toContain("name the gap and");
    expect(md).toContain("never guess a sign");
    expect(md).toContain("never repair a path");
  });

  test("the no-label rule: a loop's behavior is read, never stored", () => {
    expect(md).toContain("READ from its links, never stored");
    expect(md).toContain("No record carries a");
    expect(md).toContain("a count or a score");
    // An assumption is a claim, a mark is doubt — neither is a label.
    expect(md).toContain("claim kept");
    expect(md).toContain("something is not settled");
  });

  test("Level 1's orientation text stays intact", () => {
    // The map, the shelf, the ground rules — the same words as before.
    expect(md).toContain("a user-authored map of references and");
    expect(md).toContain("`map/references/`");
    expect(md).toContain("`map/distances.jsonl`");
    expect(md).toContain("`map/marks.jsonl`");
    expect(md).toContain("`notes/` — working notes from before the map");
    expect(md).toContain("`ontology/` arrives in later efforts.");
    // The shelf section (ADR-0010) is untouched.
    expect(md).toContain("`shelf_x`");
    expect(md).toContain("word's centre");
    expect(md).toContain("set-aside");
    expect(md).toContain("deferred");
    expect(md).toContain("rejected");
    expect(md).toContain(String(DEFAULT_SHELF_X));
    // The ground rules (ghosts, coining rights, ignorance is content).
    expect(md).toContain("Your edits arrive as ghosts");
    expect(md).toContain("Only the user coins a name");
    expect(md).toContain("Ignorance is content");
    // The machine-file style paragraph now names all four records.
    expect(md).toContain("canonical style: LF newlines");
    expect(md).toContain("`map/model.json`");
    expect(md).toContain("`map/links.jsonl`");
    expect(md).toContain("`map/loops.jsonl`");
    expect(md).toContain("`map/assumptions.jsonl`");
    // No verdict is stored in the orientation either — it only states the rule.
    expect(md).toContain("keep it out of the files");
  });
});

describe("the new workspace scaffold gains the Level 3 orientation", () => {
  const md = agentsMd("garden");

  test("the render map names every game's records (additive, never exclusive)", () => {
    expect(md).toContain("## Level 3 — the reach beyond the map");
    // Every game: words, distances, marks and the shelf.
    expect(md).toContain("Every game draws the words,");
    expect(md).toContain("distances, marks and the shelf");
    // The dynamics game adds its own four records.
    expect(md).toContain("the dynamics game adds the links, loops,");
    expect(md).toContain("assumptions and the playing set");
    // The ground game adds the reach and takes nothing away.
    expect(md).toContain("the ground game adds the pointers");
    expect(md).toContain("Nothing");
    expect(md).toContain("is taken away");
  });

  test("the three level values and the garbage-tolerance rule", () => {
    expect(md).toContain('`"concept"`');
    expect(md).toContain('`"dynamics"`');
    expect(md).toContain('`"ground"`');
    expect(md).toContain("The three");
    expect(md).toContain("absent, empty, unreadable or any other value means concept");
    expect(md).toContain("never asks twice");
    expect(md).toContain("opens exactly as before");
  });

  test("the pointer forms and their resolution rules", () => {
    expect(md).toContain("`map/pointers.jsonl`");
    expect(md).toContain("AUTHORED target form");
    expect(md).toContain("never sniffed from the value");
    // path: workspace-relative, joined as written, never normalized.
    expect(md).toContain("a path INSIDE this workspace");
    expect(md).toContain("workspace root");
    expect(md).toContain("An absolute-looking value is still a `path`");
    // at: absolute, machine-local, may dangle elsewhere, answered cannot read.
    expect(md).toContain("an absolute path on THIS machine");
    expect(md).toContain("machine-local");
    expect(md).toContain("may dangle on another machine");
    expect(md).toContain('answers "cannot read"');
    expect(md).toContain("never repaired");
    // url: any scheme, stored verbatim, refused schemes said plainly.
    expect(md).toContain("any scheme, stored verbatim");
    expect(md).toContain('says "cannot open this scheme"');
    // The form is structure: the value is never classified into another form.
    expect(md).toContain("never classify a value");
    // A mark may address a pointer LINE (the pointer-key mark grammar).
    expect(md).toContain("A mark may also sit on a pointer LINE");
  });

  test("the window is an open-moment glimpse — reopen to refresh", () => {
    expect(md).toContain(
      "The window is an open-moment glimpse — reopen to refresh.",
    );
    expect(md).toContain("not a record");
    expect(md).toContain("nothing about it is written");
    expect(md).toContain("never a cached earlier read");
  });

  test("the pointers file joins the orientation inventory and the machine-files rule", () => {
    expect(md).toContain(
      "- `map/pointers.jsonl` — one line per reach beyond the map",
    );
    expect(md).toContain("`map/pointers.jsonl`, and later");
  });
});

describe("the scaffold is write-once (an older workspace keeps its text)", () => {
  test("a new workspace gets both files, AGENTS.md with the new orientation", () => {
    const files = workspaceScaffold(WS, "garden");
    expect(files.map((file) => file.path)).toEqual([
      `${WS}/workspace.yml`,
      `${WS}/AGENTS.md`,
    ]);
    expect(scaffoldFile("workspace.yml").content).toBe(workspaceYml());
    expect(scaffoldFile("AGENTS.md").content).toBe(agentsMd("garden"));
    expect(scaffoldFile("AGENTS.md").content).toContain(
      "## Level 2 — the dynamics model",
    );
    expect(scaffoldFile("AGENTS.md").content).toContain(
      "## Level 3 — the reach beyond the map",
    );
  });

  test("an old workspace is written nothing: its AGENTS.md bytes never change", () => {
    const disk = new Map<string, string>([
      [`${WS}/workspace.yml`, '# old\nformat: "attentioneer-workspace/1"\n'],
      [`${WS}/AGENTS.md`, OLD_AGENTS_MD],
    ]);
    const writes = scaffoldWrites(workspaceScaffold(WS, "garden"), new Set(disk.keys()));

    // Nothing is offered to be written, so nothing can be overwritten.
    expect(writes).toEqual([]);
    expect(disk.get(`${WS}/AGENTS.md`)).toBe(OLD_AGENTS_MD);
    expect(disk.get(`${WS}/AGENTS.md`)).not.toContain("Level 2");
    expect(disk.get(`${WS}/workspace.yml`)).toContain("old");
  });

  test("a Level 2-era workspace keeps its bytes on open: only new spaces get Level 3", () => {
    const disk = new Map<string, string>([
      [`${WS}/workspace.yml`, workspaceYml()],
      [`${WS}/AGENTS.md`, PRE_LEVEL_3_AGENTS_MD],
    ]);
    const writes = scaffoldWrites(
      workspaceScaffold(WS, "garden"),
      new Set(disk.keys()),
    );

    // The scaffold offers nothing: no write path can touch the old text, so
    // opening (which does not scaffold at all) leaves these bytes identical.
    expect(writes).toEqual([]);
    expect(disk.get(`${WS}/AGENTS.md`)).toBe(PRE_LEVEL_3_AGENTS_MD);
    expect(disk.get(`${WS}/AGENTS.md`)).not.toContain("Level 3");
    // The current scaffold, by contrast, carries the Level 3 orientation —
    // only a workspace created now receives it.
    expect(agentsMd("garden")).toContain(
      "## Level 3 — the reach beyond the map",
    );
  });

  test("a Level 2-era workspace missing its yml gains only the yml, not the new text", () => {
    const disk = new Map<string, string>([
      [`${WS}/AGENTS.md`, PRE_LEVEL_3_AGENTS_MD],
    ]);
    scaffoldInto(disk, "garden");

    expect(disk.get(`${WS}/workspace.yml`)).toBe(workspaceYml());
    expect(disk.get(`${WS}/AGENTS.md`)).toBe(PRE_LEVEL_3_AGENTS_MD);
  });

  test("a half-scaffolded folder gains only the missing file", () => {
    const oldYml = '# hand-edited marker\nformat: "attentioneer-workspace/1"\n';
    const disk = new Map<string, string>([[`${WS}/workspace.yml`, oldYml]]);
    scaffoldInto(disk, "garden");

    expect(disk.get(`${WS}/workspace.yml`)).toBe(oldYml);
    expect(disk.get(`${WS}/AGENTS.md`)).toBe(agentsMd("garden"));
  });

  test("a second scaffold pass over a new workspace changes no byte", () => {
    const disk = scaffoldInto(new Map(), "garden");
    const first = new Map(disk);
    scaffoldInto(disk, "garden");
    expect(disk).toEqual(first);
  });

  test("opening a workspace reads only — no write path runs on open", () => {
    const source = readFileSync(
      new URL("../src/workspace/lifecycle.ts", import.meta.url),
      "utf8",
    );
    const open = functionBody(source, "openWorkspace");
    // Open checks the marker, reads the fields and remembers the recent: it
    // never scaffolds, rewrites workspace.yml or touches AGENTS.md.
    expect(open).toContain("pathExists");
    expect(open).not.toContain("scaffoldWorkspace");
    expect(open).not.toContain("writeMachineFile");
    expect(open).not.toContain("writeTextFile");
    expect(open).not.toContain("saveWorkspaceLevel");
    expect(open).not.toContain("AGENTS.md");

    // Create is the only door that scaffolds, and it is the write-once one.
    const create = functionBody(source, "createWorkspace");
    expect(create).toContain("scaffoldWorkspace(");
  });
});
