import { afterAll, describe, expect, test } from "bun:test";
import {
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
import {
  acceptLine,
  createAttentioneerHost,
} from "../src/commands/attentioneerHost";
import { nodeCommandIo, runCommands } from "../scripts/commands";

/**
 * STORY 21.1 — the headless driver against a REAL temp workspace.
 *
 * The two claims this file proves, in the story's own words:
 *
 *   - A PROPOSAL IS NOT A WRITE: after a script proposes a card, a wire and a
 *     note, the map's records are BYTE-IDENTICAL (the whole folder, compared
 *     file by file). The ghosts live in `.attentioneer/inbox/`, which is the
 *     intake's derived, disposable area — not a record.
 *   - THE ACCEPT IS THE APP'S OWN: accepting through the session's accept
 *     produces exactly the lines and the file the app's own add paths would.
 *
 * A refused script leaves no ghosts and no byte changed; an unknown card in a
 * wire is ONE sentence and nothing filed.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-commands-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const GROUND = 'on: rain | name: rain | x: 0 | y: 0\non: soil | name: soil | x: 120 | y: 0\n';

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map"), { recursive: true });
  writeFileSync(join(path, "map/ground.txt"), GROUND, "utf8");
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

const SCRIPT = [
  { act: "map_overview", map: "ground", payload: {} },
  { act: "read_card", map: "ground", payload: { card: "rain" } },
  { act: "read_wires", map: "ground", payload: {} },
  {
    act: "propose_card",
    map: "ground",
    payload: { name: "rain gauge", x: 40, y: 60 },
  },
  { act: "propose_wire", map: "ground", payload: { from: "rain", to: "soil" } },
  {
    act: "propose_note",
    map: "ground",
    payload: { card: "rain", note: "the gauge is the new rain card" },
  },
];

function writeScript(acts: unknown[]): string {
  const path = join(mkdtempSync(join(ROOT, "script-")), "acts.json");
  writeFileSync(path, JSON.stringify(acts), "utf8");
  return path;
}

describe("a proposal is not a write (the story's proof)", () => {
  test("three ghosts are held and the records are BYTE-IDENTICAL", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const before = recordsOf(path);

    // Run the acts through the executor, as the driver does.
    const { executeScript } = await import("../src/commands/execute");
    const run = await executeScript(SCRIPT, host);
    expect(run.ok).toBe(true);
    expect(run.ids).toHaveLength(3);
    expect(run.lines[3]).toContain('proposed a card "rain gauge"');
    expect(run.lines[5]).toContain("proposed a note");

    // Unguessable ids are stripped: three envelope files, and nothing else.
    const names = inboxNames(path);
    expect(names).toHaveLength(3);
    for (const name of names) expect(name.endsWith(".json")).toBe(true);

    const after = recordsOf(path);
    expectSameRecords(before, after);
    // The records themselves are exactly the seed: no card, wire or note line.
    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toBe(GROUND);
    expect(() => readFileSync(join(path, "map/ground-links.txt"))).toThrow();
    expect(() => readFileSync(join(path, "map/notes/rain.md"))).toThrow();
    // The ground map still renders no map-content family.
    expect(renderedMapContent("ground")).toEqual([]);
  });

  test("accepting through the app's own accept writes exactly the expected records", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const { executeScript } = await import("../src/commands/execute");
    const run = await executeScript(SCRIPT, host);
    expect(run.ok).toBe(true);

    const answers = await host.accept(run.ids);
    expect(answers.map((entry) => entry.outcome.outcome)).toEqual([
      "applied",
      "applied",
      "applied",
    ]);
    for (const answer of answers) {
      expect(acceptLine(answer.id, answer.outcome)).toContain("1 line(s) written");
    }

    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toBe(
      `${GROUND}on: rain-gauge | name: rain gauge | x: 40 | y: 60\n`,
    );
    expect(readFileSync(join(path, "map/ground-links.txt"), "utf8")).toBe(
      "from: rain | to: soil\n",
    );
    expect(readFileSync(join(path, "map/notes/rain.md"), "utf8")).toBe(
      "the gauge is the new rain card\n",
    );
    // The intake is empty once the ghosts are accepted (the accept deletes).
    expect(inboxNames(path)).toEqual([]);
  });
});

describe("refusals are ONE sentence and leave no trace", () => {
  test("an unknown act is refused by name and validates NOTHING else", async () => {
    const path = freshWorkspace();
    const script = writeScript([
      SCRIPT[3],
      { act: "delete_card", map: "ground", payload: { card: "rain" } },
    ]);
    const before = recordsOf(path);
    const result = await runCommands(
      ["--workspace", path, "--script", script],
      nodeCommandIo(),
    );
    expect(result.code).toBe(1);
    expect(result.lines).toHaveLength(2);
    expect(result.lines[0]).toContain("delete_card");
    expect(result.lines[1]).toContain("stopped at act 1");
    // The first act was VALID but never ran: the script was validated whole.
    expect(inboxNames(path)).toEqual([]);
    expectSameRecords(before, recordsOf(path));
  });

  test("a wire to a card that does not exist is one sentence and no ghost", async () => {
    const path = freshWorkspace();
    const script = writeScript([
      { act: "propose_wire", map: "ground", payload: { from: "rain", to: "the sea" } },
    ]);
    const before = recordsOf(path);
    const result = await runCommands(
      ["--workspace", path, "--script", script],
      nodeCommandIo(),
    );
    expect(result.code).toBe(1);
    expect(result.lines[0]).toContain('"the sea" is not one of them.');
    expect(inboxNames(path)).toEqual([]);
    expectSameRecords(before, recordsOf(path));
  });

  test("a card that is not there is one sentence for a read and for a note", async () => {
    const path = freshWorkspace();
    const script = writeScript([
      { act: "read_card", map: "ground", payload: { card: "the sea" } },
      { act: "propose_note", map: "ground", payload: { card: "the sea", note: "x" } },
    ]);
    const result = await runCommands(
      ["--workspace", path, "--script", script],
      nodeCommandIo(),
    );
    expect(result.code).toBe(1);
    expect(result.lines[0]).toBe('"the sea" is not a card on this map.');
    expect(result.lines[1]).toContain("stopped at act 1");
  });
});

describe("the driver's own command", () => {
  test("bun run commands is wired in package.json", () => {
    const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"));
    expect(manifest.scripts.commands).toBe("bun scripts/commands.ts");
  });

  test("--accept runs the normal path and prints a summary; without it nothing lands", async () => {
    const path = freshWorkspace();
    const script = writeScript(SCRIPT.slice(3));
    const io = nodeCommandIo();

    const dry = await runCommands(["--workspace", path, "--script", script], io);
    expect(dry.code).toBe(0);
    expect(dry.lines).toHaveLength(4);
    expect(dry.lines[3]).toContain("3 ghost(s) held");
    expect(inboxNames(path)).toHaveLength(3);
    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toBe(GROUND);

    const accepted = await runCommands(
      ["--workspace", path, "--script", script, "--accept"],
      io,
    );
    expect(accepted.code).toBe(0);
    expect(accepted.lines.some((line) => line.startsWith("accepted ghost-"))).toBe(true);
    expect(accepted.lines[accepted.lines.length - 1]).toContain("3 of 3 ghost(s) accepted");
    expect(readFileSync(join(path, "map/ground.txt"), "utf8")).toContain(
      "on: rain-gauge | name: rain gauge | x: 40 | y: 60",
    );
  });

  test("a missing flag is the usage sentence, not a crash", async () => {
    const result = await runCommands(["--workspace", "/tmp"], nodeCommandIo());
    expect(result.code).toBe(1);
    expect(result.lines[0]).toContain("usage: bun run commands");
  });
});
