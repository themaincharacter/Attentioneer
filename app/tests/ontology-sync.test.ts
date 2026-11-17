import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import {
  syncOntology,
  isOurOntology,
  ONTOLOGY_FOREIGN_NOTICE,
  type OntologyFs,
  type OntologySnapshot,
} from "../src/ontology/sync";
import { ONTOLOGY_FORMAT, renderGameOntology } from "../src/ontology/render";
import { deriveGameOntology } from "../src/ontology/derive";
import { ontologyFilePath } from "../src/ontology/filename";
import { DEFAULT_BOX } from "../src/canvas/geometry";

/**
 * The per-game ontology export's SYNC, automated (PROVISIONAL, added 2026-11-16
 * per ADR-0033 and notes/ontology-language-games-research.md §5.3).
 *
 * The claims: a sync REBUILDS every game's file (no incremental bookkeeping),
 * writes only when the bytes changed, creates the folder on first generation,
 * leaves unchanged files alone, and sweeps only files whose format marker is
 * OURS — a file the app did not write is left where it is and named in a
 * notice. The map is the only source: the folder is read for the sweep and
 * never as data.
 *
 * The filesystem is an in-memory port, the same five calls the Tauri bridge
 * answers, so the whole rule is testable without a disk or a DOM.
 */

const WS = "/maps/garden";

/** An in-memory workspace: files by absolute path, plus the folders created. */
class MemFs implements OntologyFs {
  files = new Map<string, string>();
  dirs = new Set<string>();

  async createDirAll(path: string): Promise<void> {
    this.dirs.add(path);
  }

  async listDir(path: string): Promise<string[]> {
    const prefix = path + "/";
    return [...this.files.keys()]
      .filter((key) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .map((key) => key.slice(prefix.length))
      .sort();
  }

  async readTextFile(path: string): Promise<string | null> {
    return this.files.get(path) ?? null;
  }

  async writeTextFile(path: string, content: string): Promise<void> {
    this.files.set(path, content);
  }

  async removeFile(path: string): Promise<void> {
    this.files.delete(path);
  }
}

/** The reference files as the app writes them. */
function reference(name: string, x: number, y: number): string {
  return '---\nname: "' + name + '"\nx: ' + x + '\ny: ' + y + '\n---\n';
}

/** The §5.4 fixture: garden bed around rain/soil/mulch, heap holding soil. */
function fixtureFiles(): Record<string, string> {
  return {
    "workspace.yml": 'format: "attentioneer-workspace/1"\nshelf_x: 1280\n',
    "map/language-games.jsonl":
      '{"color":"#cfe0d6","name":"garden bed","shape":{"h":120,"kind":"rect","w":200,"x":0,"y":0}}\n' +
      '{"color":"#e2d4e6","name":"heap","shape":{"h":120,"kind":"rect","w":40,"x":120,"y":0}}\n',
    "map/distances.jsonl":
      '{"from":"mulch","to":"soil","word":"covers"}\n' +
      '{"from":"rain","to":"soil","word":"soaks"}\n',
    "map/references/rain.md": reference("rain", 40, 60),
    "map/references/soil.md": reference("soil", 90, 60),
    "map/references/mulch.md": reference("mulch", 140, 60),
    "map/references/compost.md": reference("compost", 400, 60),
  };
}

function memWorkspace(files: Record<string, string>): MemFs {
  const fs = new MemFs();
  for (const [relative, content] of Object.entries(files)) {
    fs.files.set(WS + "/" + relative, content);
  }
  return fs;
}

/** A snapshot in the app's own shape (map order, measured boxes). */
function snapshot(): OntologySnapshot {
  const word = (slug: string, name: string, x: number, y: number) => ({
    slug,
    name,
    pos: { x, y },
    box: DEFAULT_BOX,
  });
  return {
    words: [
      word("rain", "rain", 40, 60),
      word("soil", "soil", 90, 60),
      word("mulch", "mulch", 140, 60),
      word("compost", "compost", 400, 60),
    ],
    wires: [
      { from: "mulch", to: "soil", word: "covers" },
      { from: "rain", to: "soil", word: "soaks" },
    ],
    games: [
      { name: "garden bed", shape: { kind: "rect", x: 0, y: 0, w: 200, h: 120 } },
      { name: "heap", shape: { kind: "rect", x: 120, y: 0, w: 40, h: 120 } },
    ],
    shelfX: 1280,
  };
}

describe("a sync rebuilds every game's file", () => {
  test("one file per game, at the encoded name, with the folder created", async () => {
    const fs = new MemFs();
    const result = await syncOntology(WS, { fs, snapshot: snapshot() });
    expect(fs.dirs.has(WS + "/ontology")).toBe(true);
    expect(result.written).toEqual([
      ontologyFilePath(WS, "garden bed"),
      ontologyFilePath(WS, "heap"),
    ]);
    expect(result.removed).toEqual([]);
    expect(result.notices).toEqual([]);
    const bed = fs.files.get(ontologyFilePath(WS, "garden bed"));
    expect(bed).toBeDefined();
    expect(bed).toContain('game: "garden bed"');
    expect(bed).toContain("- soil — also in: heap");
    // The other side states the same overlap, and neither resolves it.
    expect(fs.files.get(ontologyFilePath(WS, "heap"))).toContain(
      "- soil — also in: garden bed",
    );
  });

  test("a second sync with unchanged records writes nothing", async () => {
    const fs = new MemFs();
    await syncOntology(WS, { fs, snapshot: snapshot() });
    const bytes = new Map(fs.files);
    const again = await syncOntology(WS, { fs, snapshot: snapshot() });
    expect(again.written).toEqual([]);
    expect(again.removed).toEqual([]);
    expect(fs.files).toEqual(bytes);
  });

  test("deleting every file and rebuilding restores the same bytes", async () => {
    const fs = new MemFs();
    await syncOntology(WS, { fs, snapshot: snapshot() });
    const before = new Map(fs.files);
    fs.files.clear();
    await syncOntology(WS, { fs, snapshot: snapshot() });
    expect(fs.files).toEqual(before);
  });

  test("no game writes no file and does not create the folder", async () => {
    const fs = new MemFs();
    const result = await syncOntology(WS, { fs, snapshot: { words: [], wires: [], games: [], shelfX: 1280 } });
    expect(result).toEqual({ written: [], removed: [], notices: [] });
    expect(fs.dirs.has(WS + "/ontology")).toBe(false);
  });
});

describe("the deletion rules: the marker guards every removal", () => {
  const oldFile = (game: string): string => {
    const derived = deriveGameOntology(
      { name: game, shape: { kind: "rect", x: 0, y: 0, w: 10, h: 10 } },
      [],
      [],
      [],
      1280,
    );
    return renderGameOntology(derived);
  };

  test("a game gone from the records takes its file with it", async () => {
    const fs = new MemFs();
    await syncOntology(WS, { fs, snapshot: snapshot() });
    const bed = ontologyFilePath(WS, "garden bed");
    const onlyHeap: OntologySnapshot = {
      ...snapshot(),
      games: [snapshot().games[1]],
    };
    const result = await syncOntology(WS, { fs, snapshot: onlyHeap });
    expect(fs.files.has(bed)).toBe(false);
    expect(result.removed).toEqual([bed]);
    expect(result.notices).toEqual([]);
  });

  test("a renamed game's old file is swept and the new one written", async () => {
    const fs = new MemFs();
    await syncOntology(WS, { fs, snapshot: snapshot() });
    const renamed: OntologySnapshot = {
      ...snapshot(),
      games: [
        { name: "the bed", shape: snapshot().games[0].shape },
        snapshot().games[1],
      ],
    };
    const result = await syncOntology(WS, { fs, snapshot: renamed });
    // The renamed game's file appears; the old name's file goes. The other
    // game's overlap line changes (the old name is gone), so it is rewritten.
    expect(result.written).toContain(ontologyFilePath(WS, "the bed"));
    expect(result.removed).toEqual([ontologyFilePath(WS, "garden bed")]);
    expect(fs.files.has(ontologyFilePath(WS, "garden bed"))).toBe(false);
    expect(fs.files.get(ontologyFilePath(WS, "heap"))).not.toContain("garden bed");
  });

  test("an orphan file of OURS is swept; one we did not write is left and named", async () => {
    const fs = new MemFs();
    fs.files.set(WS + "/ontology/gone.md", oldFile("gone"));
    fs.files.set(WS + "/ontology/hand note.md", "# a note the person wrote\n");
    fs.files.set(WS + "/ontology/foreign.md", "---\nformat: \"something-else/1\"\n---\n");
    const result = await syncOntology(WS, { fs, snapshot: { words: [], wires: [], games: [], shelfX: 1280 } });
    expect(result.removed).toEqual([WS + "/ontology/gone.md"]);
    expect(fs.files.has(WS + "/ontology/hand note.md")).toBe(true);
    expect(fs.files.has(WS + "/ontology/foreign.md")).toBe(true);
    expect(result.notices).toEqual([
      ONTOLOGY_FOREIGN_NOTICE + "foreign.md",
      ONTOLOGY_FOREIGN_NOTICE + "hand note.md",
    ]);
  });

  test("only .md files are considered at all", async () => {
    const fs = new MemFs();
    fs.files.set(WS + "/ontology/notes.txt", "not ours, not a .md");
    const result = await syncOntology(WS, { fs, snapshot: { words: [], wires: [], games: [], shelfX: 1280 } });
    expect(result).toEqual({ written: [], removed: [], notices: [] });
    expect(fs.files.has(WS + "/ontology/notes.txt")).toBe(true);
  });

  test("a hand-edited file at a game's own name is simply rebuilt (R7)", async () => {
    const fs = new MemFs();
    fs.files.set(ontologyFilePath(WS, "garden bed"), "# my own notes\n");
    const result = await syncOntology(WS, { fs, snapshot: snapshot() });
    expect(result.written).toContain(ontologyFilePath(WS, "garden bed"));
    expect(fs.files.get(ontologyFilePath(WS, "garden bed"))).toContain(
      'format: "' + ONTOLOGY_FORMAT + '"',
    );
  });

  test("the marker is the frontmatter's format, tolerantly read", () => {
    expect(isOurOntology(oldFile("x"))).toBe(true);
    expect(isOurOntology('\uFEFF---\r\nformat: "' + ONTOLOGY_FORMAT + '"\r\n---\r\n')).toBe(true);
    expect(isOurOntology("no frontmatter at all\n")).toBe(false);
    expect(isOurOntology('---\nformat: "other/1"\n---\n')).toBe(false);
    expect(isOurOntology('---\ngame: "x"\n---\n')).toBe(false);
  });
});

describe("the records come from the map files when no snapshot is given", () => {
  test("the derivation reads the records, in the listing's (map) order", async () => {
    const fs = memWorkspace(fixtureFiles());
    const result = await syncOntology(WS, { fs });
    expect(result.written).toEqual([
      ontologyFilePath(WS, "garden bed"),
      ontologyFilePath(WS, "heap"),
    ]);
    const bed = fs.files.get(ontologyFilePath(WS, "garden bed")) ?? "";
    // loadReferences walks listDir's sorted names: compost, mulch, rain, soil —
    // so the map order is mulch, rain, soil once compost falls outside.
    const words = bed.slice(bed.indexOf("## Words in this game"), bed.indexOf("## Relations"));
    expect(words).toContain("- mulch");
    expect(words.indexOf("- mulch")).toBeLessThan(words.indexOf("- rain"));
    expect(words.indexOf("- rain")).toBeLessThan(words.indexOf("- soil"));
    expect(words).not.toContain("compost");
    expect(bed).toContain("- mulch → soil");
    expect(bed).toContain("- rain → soil");
    expect(bed).toContain("words: 3");
    expect(bed).toContain("wires: 2");
  });

  test("a word moved past the shelf's fold leaves the artifact (the membership fix)", async () => {
    const files = fixtureFiles();
    files["map/references/mulch.md"] = reference("mulch", 1280, 60);
    const fs = memWorkspace(files);
    await syncOntology(WS, { fs });
    const bed = fs.files.get(ontologyFilePath(WS, "garden bed")) ?? "";
    expect(bed).not.toContain("- mulch");
    expect(bed).not.toContain("mulch → soil");
    expect(bed).toContain("words: 2");
    expect(bed).toContain("wires: 1");
  });

  test("the fold is workspace.yml's, not a constant", async () => {
    const files = fixtureFiles();
    files["workspace.yml"] = 'format: "attentioneer-workspace/1"\nshelf_x: 300\n';
    const fs = memWorkspace(files);
    await syncOntology(WS, { fs });
    const bed = fs.files.get(ontologyFilePath(WS, "garden bed")) ?? "";
    // With the fold at 300, mulch at x 140 is left of it and stays.
    expect(bed).toContain("- mulch");
    expect(bed).toContain("words: 3");
  });

  test("a missing workspace.yml falls back to the default fold", async () => {
    const files = fixtureFiles();
    delete files["workspace.yml"];
    const fs = memWorkspace(files);
    await syncOntology(WS, { fs });
    const bed = fs.files.get(ontologyFilePath(WS, "garden bed")) ?? "";
    expect(bed).toContain("words: 3");
  });

  test("malformed record lines never reach the artifact and never stop a sync", async () => {
    const files = fixtureFiles();
    files["map/distances.jsonl"] += "not json at all\n";
    files["map/language-games.jsonl"] += '{"name":"","color":"#fff","shape":{"kind":"rect","x":0,"y":0,"w":1,"h":1}}\n';
    const fs = memWorkspace(files);
    const result = await syncOntology(WS, { fs });
    expect(result.written).toHaveLength(2);
    const bed = fs.files.get(ontologyFilePath(WS, "garden bed")) ?? "";
    expect(bed).not.toContain("not json at all");
  });
});


/* ----------------------------------------------------------------------- *
 * The app's wiring: where a sync is invoked from and what it may read.
 * ----------------------------------------------------------------------- */

describe("the app invokes the sync and never reads the artifact back", () => {
  const APP = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

  test("the trigger is the three records the games derive from, on load", () => {
    // The snapshot is what the app already holds: the words (with their
    // measured boxes), the wires and the games.
    expect(APP).toContain("syncOntology(path, { snapshot })");
    expect(APP).toContain("words: ontologyWords");
    expect(APP).toContain("wires: distances");
    expect(APP).toContain("games: languageGames");
    expect(APP).toContain("shelfX,");
    // The effect's dependency list IS the recipe: the records (so every map
    // write that can change a game's content re-runs it) and `loaded` (the
    // one run on open).
    expect(APP).toContain(
      "[loaded, workspace?.path, ontologyWords, distances, languageGames, shelfX]",
    );
  });

  test("the app parses no ontology file: the sync is the only door", () => {
    // The app imports the sync, not the renderer or the derivation.
    expect(APP).not.toContain("renderGameOntology");
    expect(APP).not.toContain("deriveGameOntology");
    // And it never reads an artifact: no path builder or read of the folder
    // appears here — the sync owns both.
    expect(APP).not.toContain("ontologyDir");
    expect(APP).not.toContain("ontologyFilePath");
  });

  test("the files it declined to sweep reach the notices strip, not the bin", () => {
    expect(APP).toContain("ontologyNotices={ontologyNotices}");
    expect(APP).toContain("ontologyNotices.length > 0");
    expect(APP).toContain("{ontologyNotices.map((line, index) => (");
  });
});


/* ----------------------------------------------------------------------- *
 * The generation path itself: pure code, no timer, no watcher, no second door.
 * ----------------------------------------------------------------------- */

describe("the generation path is code, not a process", () => {
  const MODULES = ["derive.ts", "render.ts", "filename.ts", "sync.ts"];

  test("no timer, no watcher, no clock, no randomness, no network", () => {
    for (const file of MODULES) {
      const source = readFileSync(
        new URL("../src/ontology/" + file, import.meta.url),
        "utf8",
      );
      expect({
        file,
        found:
          /\b(setTimeout|setInterval|requestAnimationFrame|clearInterval|Date|Math\.random|fetch|XMLHttpRequest|WebSocket)\b/.test(
            source,
          ),
      }).toEqual({ file, found: false });
    }
  });

  test("only the ontology folder names an artifact path or builds a file name", () => {
    const src = fileURLToPath(new URL("../src", import.meta.url));
    const own = fileURLToPath(new URL("../src/ontology/", import.meta.url));
    const offenders = walk(src).filter(
      (file) =>
        (file.endsWith(".ts") || file.endsWith(".tsx")) &&
        !file.startsWith(own) &&
        /ontologyDir\(|ontologyFilePath\(|encodeGameFileName\(/.test(
          readFileSync(file, "utf8"),
        ),
    );
    expect(offenders).toEqual([]);
  });
});

/** Every file under a folder (the src tree, recursively). */
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(path));
    else out.push(path);
  }
  return out;
}
