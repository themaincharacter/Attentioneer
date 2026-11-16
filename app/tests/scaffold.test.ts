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
 * wording) the same way: only NEW workspaces get it. Epic 6 story 1 AMENDS the
 * zoom/level contract in place (ADR-0018): the shipped "the only source of the
 * active game / Zoom never changes it" text is replaced by the strict handoff
 * — the band is the game, the key is the resume hint — and the assertion below
 * is updated in the same story, deliberately. The scaffold is WRITE-ONCE: only
 * files that are missing are written, so an old workspace keeps its own bytes
 * (the old contract included) and only a NEW workspace gets the new text.
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

/** A workspace created by the Epic 5 app: the pre-ADR-0018 zoom/level contract. */
const PRE_BINDING_AGENTS_MD = [
  "# garden — agent orientation",
  "",
  "## Level 2 — the dynamics model",
  "",
  "This workspace was created before zoom became the level (Epic 6 story 1).",
  "`workspace.yml`'s `level` key is the only source of the active game:",
  '`"concept"` (Level 1 — absent means this), `"dynamics"` (Level 2) or',
  '`"ground"` (Level 3 — the reach, below). Zoom never changes it.',
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

  test("the zoom band is the game; the level key is the resume hint", () => {
    expect(md).toContain("`workspace.yml`'s `level` key");
    expect(md).toContain('"concept"');
    expect(md).toContain('"dynamics"');
    // ADR-0018 amends the shipped "one source" contract (the story's deliberate
    // test update): the band is the game at runtime, the key is the hint, and
    // opening never writes it.
    expect(md).not.toContain("the only source of the active game");
    expect(md).not.toContain("Zoom never changes it");
    expect(md).toContain("Zoom is the level");
    expect(md).toContain("The zoom band is the active game AT RUNTIME");
    expect(md).toContain("RESUME HINT, not the switch");
    expect(md).toContain("The band writes it when a zoom gesture settles");
    expect(md).toContain("NOTHING is written");
    expect(md).toContain("rewritten only on the first settled crossing");
    // Story 2's pin rides the same contract: a crossing under an armed gesture
    // or a focused text field moves the camera and holds the game, so no
    // surface closes and typed text survives until the pin lifts (ADR-0018
    // decision 3).
    expect(md).toContain("While a gesture is armed or a text field holds focus");
    expect(md).toContain("the camera and holds the game");
    expect(md).toContain("typed text survives");
    expect(md).toContain("the crossing applies when the pin lifts");
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
    // Level 3's section carries the same handoff: the key is the hint the band
    // writes, not the switch.
    expect(md).toContain("key is only the resume hint the zoom band writes");
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
    expect(md).toContain("`map/pointers.jsonl`, `map/veils.jsonl`, and later");
  });
});

describe("the scaffold is write-once (an older workspace keeps its text)", () => {
  test("a new workspace gets its files, AGENTS.md with the new orientation", () => {
    const files = workspaceScaffold(WS, "garden");
    expect(files.map((file) => file.path)).toEqual([
      `${WS}/workspace.yml`,
      `${WS}/AGENTS.md`,
      // Epic 9 story 1: the veil record ships as an EMPTY canonical JSONL, so
      // a new workspace carries the file from its first day.
      `${WS}/map/veils.jsonl`,
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

  test("an old workspace's AGENTS.md bytes never change (only missing files arrive)", () => {
    const disk = new Map<string, string>([
      [`${WS}/workspace.yml`, '# old\nformat: "attentioneer-workspace/1"\n'],
      [`${WS}/AGENTS.md`, OLD_AGENTS_MD],
    ]);
    const writes = scaffoldWrites(workspaceScaffold(WS, "garden"), new Set(disk.keys()));

    // The only thing offered is the veil record's EMPTY file (Epic 9 story 1):
    // no text file is rewritten, so no orientation can be overwritten.
    expect(writes.map((file) => file.path)).toEqual([`${WS}/map/veils.jsonl`]);
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

    // The scaffold offers no TEXT file: no write path can touch the old text,
    // so opening (which does not scaffold at all) leaves these bytes identical.
    // Only the veil record's empty file is new (Epic 9 story 1).
    expect(writes.map((file) => file.path)).toEqual([`${WS}/map/veils.jsonl`]);
    expect(disk.get(`${WS}/AGENTS.md`)).toBe(PRE_LEVEL_3_AGENTS_MD);
    expect(disk.get(`${WS}/AGENTS.md`)).not.toContain("Level 3");
    // The current scaffold, by contrast, carries the Level 3 orientation —
    // only a workspace created now receives it.
    expect(agentsMd("garden")).toContain(
      "## Level 3 — the reach beyond the map",
    );
  });

  test("a Level 2-era workspace gains its missing files, never the new text", () => {
    const disk = new Map<string, string>([
      [`${WS}/AGENTS.md`, PRE_LEVEL_3_AGENTS_MD],
    ]);
    scaffoldInto(disk, "garden");

    expect(disk.get(`${WS}/workspace.yml`)).toBe(workspaceYml());
    expect(disk.get(`${WS}/AGENTS.md`)).toBe(PRE_LEVEL_3_AGENTS_MD);
    expect(disk.get(`${WS}/map/veils.jsonl`)).toBe("\n");
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
describe("the zoom/level contract amendment is write-once (ADR-0018)", () => {
  test("an Epic 5-era workspace keeps its old contract bytes on open", () => {
    const disk = new Map<string, string>([
      [`${WS}/workspace.yml`, workspaceYml()],
      [`${WS}/AGENTS.md`, PRE_BINDING_AGENTS_MD],
    ]);
    const writes = scaffoldWrites(
      workspaceScaffold(WS, "garden"),
      new Set(disk.keys()),
    );

    // No text file is offered, so no write path can touch the old contract: the
    // old "only source / Zoom never changes it" words stand exactly as they
    // were (the veil record's empty file is the one new file, Epic 9 story 1).
    expect(writes.map((file) => file.path)).toEqual([`${WS}/map/veils.jsonl`]);
    expect(disk.get(`${WS}/AGENTS.md`)).toBe(PRE_BINDING_AGENTS_MD);
    expect(disk.get(`${WS}/AGENTS.md`)).toContain(
      "the only source of the active game",
    );
    expect(disk.get(`${WS}/AGENTS.md`)).toContain("Zoom never changes it");

    // Only a workspace created NOW receives the amended text.
    expect(agentsMd("garden")).not.toContain("Zoom never changes it");
    expect(agentsMd("garden")).not.toContain("the only source of the active game");
    expect(agentsMd("garden")).toContain("Zoom is the level");
    // Story 2's pin is part of the amendment too: the old contract's bytes
    // never gained it, and only a NEW workspace is offered the sentence.
    expect(agentsMd("garden")).toContain("typed text survives");
    expect(PRE_BINDING_AGENTS_MD).not.toContain("typed text survives");
  });

  test("an existing AGENTS.md is never in the offered writes", () => {
    const offered = scaffoldWrites(
      workspaceScaffold(WS, "garden"),
      new Set([`${WS}/AGENTS.md`]),
    );
    expect(offered.map((file) => file.path)).toEqual([
      `${WS}/workspace.yml`,
      `${WS}/map/veils.jsonl`,
    ]);
  });
});

describe("the new workspace scaffold gains the veil record and its level rule", () => {
  const md = agentsMd("garden");

  test("the veil record is named with its shape, in the inventory and the machine-file rule", () => {
    expect(md).toContain("one line per named veil");
    expect(md).toContain("map/veils.jsonl");
    expect(md).toContain("the covered rectangle");
    expect(md).toContain("captured BOX");
    expect(md).toContain("stored verbatim and never interpreted");
    // The machine-file style paragraph names it too (the same list the record
    // files already ride).
    expect(md.lastIndexOf("map/veils.jsonl")).toBeGreaterThan(
      md.indexOf("Machine-written files"),
    );
  });

  test("the level rule: Levels 1–2 only, and no sheet at ground", () => {
    expect(md).toContain("## The veil (Levels 1–2)");
    expect(md).toContain("It renders in Levels 1 and 2 ONLY");
    expect(md).toContain("at ground the sheet is absent");
    expect(md).toContain("no veil is coined there either");
  });

  test("the centre rule and covered ≠ settled are stated", () => {
    expect(md).toContain("CENTRE of its word box is inside a veil's box");
    expect(md).toContain("render-time region test ONLY");
    expect(md).toContain("no record carries a veil field");
    expect(md).toContain("not settled");
    expect(md).toContain("the covered word is still tentative underneath");
    expect(md).toContain("Sheets stack in file order");
    expect(md).toContain("wires cross through");
    expect(md).toContain("Retiring a veil deletes the line");
    expect(md).toContain("(no tombstone, no history)");
    expect(md).toContain("never judged");
  });

  test("the veil is a committed-model record: a branch never copies it", () => {
    expect(md).toContain("a branch never copies it");
    expect(md).toContain("never adds or retires one");
  });

  test("the scaffold offers the veil record as an EMPTY canonical JSONL", () => {
    const file = scaffoldFile("veils.jsonl");
    expect(file.path).toBe(`${WS}/map/veils.jsonl`);
    expect(file.content).toBe("\n");
  });

  test("an existing veils.jsonl is never rewritten (write-once, per file)", () => {
    const hand = '{"name":"kept","reason":"mine","x":0,"y":0,"w":10,"h":10}\n';
    const disk = new Map<string, string>([
      [`${WS}/workspace.yml`, workspaceYml()],
      [`${WS}/AGENTS.md`, agentsMd("garden")],
      [`${WS}/map/veils.jsonl`, hand],
    ]);
    scaffoldInto(disk, "garden");
    expect(disk.get(`${WS}/map/veils.jsonl`)).toBe(hand);
  });

  test("the scaffold makes map/ before it writes the record into it", () => {
    const source = readFileSync(
      new URL("../src/lib/serialize.ts", import.meta.url),
      "utf8",
    );
    const dirs = source.indexOf("await createDirAll(`${path}/map/references`)");
    const write = source.indexOf("await writeMachineFile(file.path, file.content);");
    expect(dirs).toBeGreaterThan(-1);
    expect(write).toBeGreaterThan(-1);
    expect(dirs).toBeLessThan(write);
  });
});

describe("the same contract lands in the code (ADR-0018)", () => {
  const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

  test("level.ts names the handoff, not a sole source", () => {
    const levelSource = source("../src/workspace/level.ts");
    expect(levelSource).toContain("RESUME HINT");
    expect(levelSource).toContain("levelHandoff.ts");
    expect(levelSource).toContain("in-order write queue");
    expect(levelSource).toContain("read-modify-write");
    expect(levelSource).not.toContain("Zoom never changes it");
    expect(levelSource).not.toContain("sole source");
  });

  test("lifecycle.ts reads the key on open and calls it the resume hint", () => {
    const lifecycleSource = source("../src/workspace/lifecycle.ts");
    expect(lifecycleSource).toContain("resumeLevel");
    expect(lifecycleSource).toContain("RESUME HINT");
    expect(lifecycleSource).not.toContain("sole source");
    // Opening never writes the key: the body has no save path at all.
    expect(functionBody(lifecycleSource, "openWorkspace")).not.toContain(
      "saveWorkspaceLevel",
    );
  });

  // CONVERTED (hidden 2026-11-16 per user review — separate mini-apps,
  // ADR-0032): the control used to name the DERIVED game (the zoom band's) and
  // jump the camera into a band. It is now the MAP TABS: it names the map on
  // screen and switches to another one; the zoom derives nothing. The old band
  // wording stays written in the component's DEPRECATED note, which quotes it.
  test("the control names the running map and switches; it never writes", () => {
    const controlSource = source("../src/canvas/LevelControl.tsx");
    expect(controlSource).toContain("THE MAP TABS");
    expect(controlSource).toContain("onJump(game)");
    expect(controlSource).toContain("never from a zoom");
    expect(controlSource).not.toContain("zoom never changes the game");
    expect(controlSource).not.toContain("saveWorkspaceLevel");
  });

  test("App has ONE level write path: the handoff's queued trigger", () => {
    const appSource = source("../src/App.tsx");
    expect(appSource).toContain("createLevelHandoff(");
    expect(appSource).toContain("handoff.settle(");
    expect(appSource).toContain("handoff.jump(");
    expect(appSource).toContain("handoff.restore(");
    // Exactly one call site: the handoff's save dependency.
    expect(appSource.match(/saveWorkspaceLevel\(/g)?.length).toBe(1);
    expect(appSource).not.toContain("sole source");
    // Open-restore reads the resume hint and only moves the camera; the
    // control renders the DERIVED level, never the key.
    expect(appSource).toContain("handoff.restore(workspace.resumeLevel)");
    expect(appSource).toContain("level={level}");
    expect(appSource).not.toContain("level={workspace.resumeLevel}");
  });
});
