import { afterAll, describe, expect, test } from "bun:test";
import {
  appendFileSync,
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
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { renderedMapContent } from "../src/canvas/mapContentRules";
import {
  applyCommandScript,
  createAttentioneerHost,
} from "../src/commands/attentioneerHost";
import { nodeCommandIo } from "../scripts/commands";
import { DEV_COMMANDS_ENV, devCommandsPath } from "../src/dev/gate";
import {
  UNREADABLE_SCRIPT,
  createDevCommandFile,
  resultsPathOf,
  type DevResultLine,
} from "../src/dev/commandFile";

/**
 * STORY 21.4 — THE DEV COMMAND FILE (ADR-0038 decision 6, second half).
 *
 * The story's one risk is the release build: a file that drives the app must
 * not exist in a shipped bundle. Two proofs stand here — the gate REFUSES a
 * developer path whenever the build flag is not exactly true, and the mount in
 * `App.tsx` is a dynamic import inside `if (import.meta.env.DEV) {`, the
 * build-time flag Vite replaces with `false`, leaving the watcher module with
 * no reference at all. The rest drives a REAL temp workspace through the same
 * apply seam the command card uses: a script appends one line per act and its
 * summary, a bad act stops the script and is named, an unparsable script writes
 * one line and applies nothing, and the results file only ever grows.
 *
 * What is left for a human is the window pass: setting the variable, starting
 * the developer build, writing a script and watching the map change.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-dev-file-"));
const APP = fileURLToPath(new URL("..", import.meta.url));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

function source(rel: string): string {
  return readFileSync(join(APP, rel), "utf8");
}

const APP_TSX = source("src/App.tsx");
const WATCHER = source("src/dev/commandFile.ts");
const GATE = source("src/dev/gate.ts");

const GROUND =
  "on: rain | name: rain | x: 0 | y: 0\non: soil | name: soil | x: 120 | y: 0\n";

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  writeFileSync(join(path, "map/ground.txt"), GROUND, "utf8");
  return path;
}

/** Every record file under the workspace, byte for byte (the inbox excluded). */
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

function expectSameRecords(
  before: Map<string, Buffer>,
  after: Map<string, Buffer>,
): void {
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

/** The watcher's deps over node:fs — the SAME apply seam the card runs. */
function depsFor(workspacePath: string) {
  return {
    readText: async (path: string): Promise<string | null> => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    appendText: async (path: string, text: string): Promise<void> => {
      appendFileSync(path, text, "utf8");
    },
    applyScript: async (acts: Parameters<typeof applyCommandScript>[0]) => {
      const host = createAttentioneerHost({
        workspacePath,
        io: nodeCommandIo(),
      });
      return await applyCommandScript(acts, host);
    },
  };
}

function resultsLines(scriptPath: string): DevResultLine[] {
  const file = resultsPathOf(scriptPath);
  if (!existsSync(file)) return [];
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as DevResultLine);
}

/** One fresh script path (outside the workspace, as a person's scratch file). */
function freshScriptPath(): string {
  return join(mkdtempSync(join(ROOT, "script-")), "dev-acts.json");
}

const RUN_SCRIPT = [
  { act: "read_card", map: "ground", payload: { card: "rain" } },
  { act: "propose_card", map: "ground", payload: { name: "rain gauge", x: 40, y: 60 } },
  { act: "propose_note", map: "ground", payload: { card: "rain", note: "the gauge is new" } },
];

describe("the gate: two conditions, both required", () => {
  test("a release build refuses even when a path is named", () => {
    // THE STORY'S ONE REAL RISK: not "the watcher is quiet", but "it is not
    // there". A path alone never opens it.
    expect(devCommandsPath("/tmp/acts.json", false)).toBeNull();
    expect(devCommandsPath("C:\\scratch\\acts.json", false)).toBeNull();
  });

  test("no path named means no watcher", () => {
    expect(devCommandsPath(undefined, true)).toBeNull();
    expect(devCommandsPath("", true)).toBeNull();
    expect(devCommandsPath("   ", true)).toBeNull();
    expect(devCommandsPath(7, true)).toBeNull();
  });

  test("only an absolute path — never a convention or a guess", () => {
    expect(devCommandsPath("acts.json", true)).toBeNull();
    expect(devCommandsPath("./.dev/acts.json", true)).toBeNull();
    expect(devCommandsPath("/tmp/acts.json", true)).toBe("/tmp/acts.json");
    expect(devCommandsPath("  /tmp/acts.json  ", true)).toBe("/tmp/acts.json");
  });

  test("the variable has one name, declared once", () => {
    expect(DEV_COMMANDS_ENV).toBe("ATTENTIONEER_DEV_COMMANDS");
    expect(GATE).toContain(DEV_COMMANDS_ENV);
  });
});

describe("the release build refuses: the watcher is excluded, not hidden", () => {
  test("App guards the mount with the build flag and imports the watcher lazily", () => {
    const guard = "if (import.meta.env.DEV) {";
    const guardAt = APP_TSX.indexOf(guard);
    expect(guardAt).toBeGreaterThan(-1);
    // THE ONLY REFERENCE: a dynamic import, so tree-shaking can drop the module
    // when the flag is folded to false. A static import would ship it.
    expect(APP_TSX.match(/\.\/dev\/commandFile/g)).toHaveLength(1);
    const importAt = APP_TSX.indexOf('import("./dev/commandFile")');
    expect(importAt).toBeGreaterThan(guardAt);
    // The import sits INSIDE the guarded block: the brace depth between the
    // guard's opening brace and the import never falls back to zero.
    let depth = 0;
    for (const char of APP_TSX.slice(guardAt + guard.length, importAt)) {
      if (char === "{") depth += 1;
      else if (char === "}") depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
    expect(depth).toBeGreaterThanOrEqual(1);
  });

  test("nothing else imports the watcher, and it is headless", () => {
    const walk = (dir: string): string[] => {
      const found: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...walk(full));
        else if (/\.(ts|tsx)$/.test(entry.name)) found.push(full);
      }
      return found;
    };
    const importers = walk(join(APP, "src"))
      .filter((file) => !file.endsWith("dev/commandFile.ts"))
      .filter((file) => readFileSync(file, "utf8").includes("dev/commandFile"));
    expect(importers.map((file) => relative(APP, file))).toEqual(["src/App.tsx"]);
    // No socket, no port, no listening surface: a file and a poll.
    expect(WATCHER).not.toMatch(/createServer|WebSocket|listen\(|\.connect\(/);
  });

  test("a RELEASE BUNDLE carries no watcher", async () => {
    // The claim is about the SHIPPED bundle, so build one: the production
    // config, in memory, and search every emitted chunk for the watcher's own
    // words. With the flag folded to false the module has no reference, so it
    // is not emitted at all — this is the build-time guard, observed.
    // Vite's CLI sets NODE_ENV=production before building; the programmatic
    // API expects the caller to. The flag under test (import.meta.env.DEV) is
    // derived from it, so set it for this build only and restore it after.
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    let out;
    try {
      out = await build({
        root: APP,
        mode: "production",
        logLevel: "silent",
        build: { write: false },
      });
    } finally {
      process.env.NODE_ENV = previous;
    }
    const builds = Array.isArray(out) ? out : [out];
    const code = builds
      .flatMap((result) => ("output" in result ? result.output : []))
      .filter((item) => item.type === "chunk")
      .map((item) => item.code)
      .join("\n");
    expect(code).not.toContain("startDevCommandFile");
    expect(code).not.toContain(UNREADABLE_SCRIPT);
    expect(code).not.toContain("commandFile");
  }, 120000);

  test("the gate itself is the build flag, not a runtime setting", () => {
    expect(APP_TSX).toContain("if (import.meta.env.DEV) {");
    expect(APP_TSX).not.toContain("import.meta.env.PROD");
  });
});

describe("a script runs through the card's own seam", () => {
  test("one line per act, the summary last, and the map shows the accepted cards", async () => {
    const workspace = freshWorkspace();
    const scriptPath = freshScriptPath();
    const watcher = createDevCommandFile({
      path: scriptPath,
      deps: depsFor(workspace),
    });

    // The file does not exist yet: the first poll is a quiet no-op.
    await watcher.poll();
    expect(resultsLines(scriptPath)).toHaveLength(0);

    writeFileSync(scriptPath, JSON.stringify(RUN_SCRIPT), "utf8");
    await watcher.poll();

    const lines = resultsLines(scriptPath);
    expect(lines).toHaveLength(RUN_SCRIPT.length + 1);
    const acts = lines.filter((line) => line.kind === "act");
    expect(acts.map((line) => (line.kind === "act" ? line.act : ""))).toEqual([
      "read_card",
      "propose_card",
      "propose_note",
    ]);
    for (const line of acts) expect(line.ok).toBe(true);
    const card = acts[1];
    expect(card.kind === "act" && card.ghostId).toBeTruthy();
    const note = acts[2];
    expect(note.kind === "act" && note.ghostId).toBeTruthy();
    expect(acts[0].kind === "act" && acts[0].sentence).toContain("rain");

    const summary = lines[lines.length - 1];
    expect(summary).toMatchObject({
      kind: "summary",
      ok: true,
      acts: 3,
      applied: 3,
      ghosts: 2,
    });

    // THE SAME ACCEPT PATH AS THE CARD: the card and the note are records now.
    const ground = readFileSync(join(workspace, "map/ground.txt"), "utf8");
    expect(ground).toContain("name: rain gauge");
    expect(readFileSync(join(workspace, "map/notes/rain.md"), "utf8")).toContain(
      "the gauge is new",
    );
    expect(inboxNames(workspace)).toHaveLength(0);
  });

  test("the same bytes are one run, never two", async () => {
    const workspace = freshWorkspace();
    const scriptPath = freshScriptPath();
    const watcher = createDevCommandFile({
      path: scriptPath,
      deps: depsFor(workspace),
    });
    await watcher.poll();

    writeFileSync(scriptPath, JSON.stringify(RUN_SCRIPT.slice(0, 1)), "utf8");
    await watcher.poll();
    const once = readFileSync(resultsPathOf(scriptPath), "utf8");
    await watcher.poll();
    await watcher.poll();
    expect(readFileSync(resultsPathOf(scriptPath), "utf8")).toBe(once);
  });
});

describe("a bad act stops the script and says which act", () => {
  test("an act out of shape applies NOTHING and is the line that names it", async () => {
    const workspace = freshWorkspace();
    const scriptPath = freshScriptPath();
    const watcher = createDevCommandFile({
      path: scriptPath,
      deps: depsFor(workspace),
    });
    await watcher.poll();
    const before = recordsOf(workspace);

    writeFileSync(
      scriptPath,
      JSON.stringify([
        { act: "map_overview", map: "ground", payload: {} },
        { act: "propose_wire", map: "ground", payload: { from: "rain" } },
      ]),
      "utf8",
    );
    await watcher.poll();

    const lines = resultsLines(scriptPath);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ kind: "act", act: "propose_wire", ok: false });
    expect(lines[0].kind === "act" && lines[0].sentence).toContain('needs "to"');
    expect(lines[1]).toMatchObject({
      kind: "summary",
      ok: false,
      acts: 2,
      applied: 0,
    });
    // Whole-script validation: the good act before it did NOT run either.
    expect(inboxNames(workspace)).toHaveLength(0);
    expectSameRecords(before, recordsOf(workspace));
  });

  test("a host refusal mid-script stops it, names the act, and applies nothing", async () => {
    const workspace = freshWorkspace();
    const scriptPath = freshScriptPath();
    const watcher = createDevCommandFile({
      path: scriptPath,
      deps: depsFor(workspace),
    });
    await watcher.poll();
    const before = recordsOf(workspace);

    writeFileSync(
      scriptPath,
      JSON.stringify([
        { act: "propose_card", map: "ground", payload: { name: "rain gauge", x: 1, y: 2 } },
        { act: "propose_wire", map: "ground", payload: { from: "rain", to: "the sea" } },
        { act: "map_overview", map: "ground", payload: {} },
      ]),
      "utf8",
    );
    await watcher.poll();

    const lines = resultsLines(scriptPath);
    expect(lines.map((line) => line.kind)).toEqual(["act", "act", "summary"]);
    const failed = lines[1];
    expect(failed).toMatchObject({ kind: "act", act: "propose_wire", ok: false });
    expect(failed.kind === "act" && failed.sentence).toContain("the sea");
    expect(lines[2]).toMatchObject({
      kind: "summary",
      ok: false,
      acts: 3,
      applied: 1,
      ghosts: 1,
    });
    // The first proposal is a filed ghost, not a write; nothing was accepted.
    expect(inboxNames(workspace)).toHaveLength(1);
    expectSameRecords(before, recordsOf(workspace));
  });
});

describe("an unparsable script applies nothing and writes ONE line", () => {
  test("the one line says so", async () => {
    const workspace = freshWorkspace();
    const scriptPath = freshScriptPath();
    const watcher = createDevCommandFile({
      path: scriptPath,
      deps: depsFor(workspace),
    });
    await watcher.poll();
    const before = recordsOf(workspace);

    writeFileSync(scriptPath, "{ this is not an act script", "utf8");
    await watcher.poll();

    const lines = resultsLines(scriptPath);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      kind: "script",
      ok: false,
      sentence: UNREADABLE_SCRIPT,
    });
    expect(inboxNames(workspace)).toHaveLength(0);
    expectSameRecords(before, recordsOf(workspace));
  });
});

describe("the results file is append-only", () => {
  test("an earlier run's bytes stay a byte-for-byte prefix", async () => {
    const workspace = freshWorkspace();
    const scriptPath = freshScriptPath();
    const watcher = createDevCommandFile({
      path: scriptPath,
      deps: depsFor(workspace),
    });
    await watcher.poll();

    writeFileSync(scriptPath, JSON.stringify([{ act: "map_overview", map: "ground", payload: {} }]), "utf8");
    await watcher.poll();
    const first = readFileSync(resultsPathOf(scriptPath), "utf8");
    expect(first.length).toBeGreaterThan(0);

    writeFileSync(scriptPath, JSON.stringify([{ act: "read_wires", map: "ground", payload: {} }]), "utf8");
    await watcher.poll();

    const all = readFileSync(resultsPathOf(scriptPath), "utf8");
    expect(all.startsWith(first)).toBe(true);
    expect(all.length).toBeGreaterThan(first.length);
    expect(resultsLines(scriptPath).map((line) => line.kind)).toEqual([
      "act",
      "summary",
      "act",
      "summary",
    ]);
  });
});

describe("no new surface", () => {
  test("the ground map renders no extra content", () => {
    expect(renderedMapContent("ground")).toEqual([]);
  });
});
