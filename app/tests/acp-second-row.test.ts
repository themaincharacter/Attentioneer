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
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ACP_SPECS,
  acpDeclaration,
  acpRowLabel,
  validateAcpSpec,
  type AcpSpec,
} from "../src/turn/acpSpecs";
import { beginSessionRun } from "../src/canvas/useGround";
import {
  runOutcomeOf,
  serializeSessionTranscript,
  sessionResultSize,
  sessionTranscriptPath,
  type SessionIo,
} from "../src/map/sessions";
import type { AcpProgressEntry } from "../src/turn/acpEntries";
import { startSessionRun } from "../src/turn/acpSession";
import {
  commandFound,
  createRunLane,
  runMissingCommandSentence,
} from "../sidecar/runs";
import { parseSidecarLine, type RunRequest } from "../src/turn/protocol";
import { runRunContact } from "../src/contacts/run";
import type { SidecarStart } from "../src/turn/sidecar";
import { SessionCard } from "../src/canvas/SessionCard";
import {
  BUN,
  FAKE_SERVER,
  openSidecar,
  type SidecarPipe,
} from "./fixtures/sidecar-pipe";

/**
 * STORY 18.6 — A SECOND TOOL IS A ROW, NOT CODE.
 *
 * The claim the research made was that one ACP client covers ~10 of 12 agent
 * tools. Everything before this story proved it with ONE tool plus a fake; this
 * file proves the part that matters: the SECOND row is DATA, the pickers list
 * it by name and say it is unverified, and the lane takes a row by its id and
 * argv without ever knowing the product behind them.
 *
 * Four things are pinned:
 *
 *   1. The rows are data: the second one ships with its documented argv, no env
 *      entry and an honest note, and a typed row can never claim verification.
 *   2. The pickers offer every row and mark the unverified ones from the data.
 *   3. A row whose command is not there refuses in ONE sentence naming it,
 *      before anything is spawned.
 *   4. A SECOND row id rides the whole path unchanged — declaration, stream,
 *      ending, transcript and the PRISM's `tool` field — against the fake child.
 *   5. A GREP over every module that runs, renders or records a run finds no
 *      product name, command or id anywhere but the spec-row data.
 *
 * Naming a product is allowed HERE, in the rows' test: the constraint is about
 * the modules that do the work, not about the fixture that watches them.
 */

const APP = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");
const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-second-row-"));

/** The task every direct run in this suite hands the seam (story 19.3). */
const TASK = "say what this folder is for";

const PIPES: SidecarPipe[] = [];

afterAll(() => {
  for (const pipe of PIPES) pipe.stop();
  rmSync(ROOT, { recursive: true, force: true });
});

const RUNNING: SidecarStart = {
  kind: "running",
  status: { running: true, entry: "", entryKind: "dev-entry", bun: "" },
};

async function lane(): Promise<{ pipe: SidecarPipe; transport: SidecarPipe["transport"] }> {
  const pipe = openSidecar();
  PIPES.push(pipe);
  await pipe.hello();
  return { pipe, transport: pipe.transport };
}

/** One fresh workspace with a map folder. */
function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

/** The test's bridge: node's fs behind the narrow interface the record takes. */
function nodeIo(): SessionIo {
  return {
    async readTextFile(path) {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    async writeTextFile(path, content) {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content);
    },
    async createDirAll(path) {
      mkdirSync(path, { recursive: true });
    },
  };
}

/** The shipped second row, pointed at the fake child so it can really run. */
function secondRow(reportPath: string): AcpSpec {
  const shipped = ACP_SPECS[1]!;
  return {
    ...shipped,
    command: BUN,
    args: [FAKE_SERVER, "tools", "--report", reportPath],
  };
}

async function reportOf(path: string): Promise<{ pid: number }> {
  for (let at = 0; at < 300; at += 1) {
    try {
      return JSON.parse(readFileSync(path, "utf8")) as { pid: number };
    } catch {
      await Bun.sleep(10);
    }
  }
  throw new Error("the fake server wrote no report");
}

async function gone(pid: number): Promise<boolean> {
  for (let at = 0; at < 200; at += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
    await Bun.sleep(10);
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 1. The second row is data.
 * ------------------------------------------------------------------ */

describe("the second ACP row is data, and says it is unverified", () => {
  test("it ships with its argv, no env entry and an honest note", () => {
    const rows = ACP_SPECS;
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const second = rows[1]!;
    expect(second.kind).toBe("acp");
    expect(second.id).toBe("opencode-acp");
    expect(second.name).toBe("OpenCode (ACP)");
    // The documented entry point, argv only, and a bare command on purpose.
    expect(second.command).toBe("opencode");
    expect(second.args).toEqual(["acp"]);
    expect(second.cwdPolicy).toBe("session");
    expect(second.env).toEqual([]);
    expect(second.timeoutMinutes).toBeGreaterThanOrEqual(1);
    // The row says it is unverified, in its mark and in its words.
    expect(second.verified).toBe(false);
    expect(second.notes).toContain("UNVERIFIED");
    expect(second.notes).toContain("out of band");
    expect(second.notes).toContain("sandbox");
    expect(second.notes).toContain("resume");
    expect(second.notes).toContain("one fresh session directory");
    // No key has a field or a value anywhere in the row.
    expect(second).not.toHaveProperty("apiKey");
    expect(JSON.stringify(second)).not.toContain("sk-");
  });

  test("a typed row cannot claim a verification this file did not see", () => {
    const read = validateAcpSpec({
      name: "Mine",
      command: "/opt/acp/server",
      args: ["acp"],
    });
    expect(read.kind).toBe("row");
    if (read.kind !== "row") throw new Error("unreachable");
    expect(read.row.verified).toBe(false);
  });

  test("the label marks what the data says is unverified", () => {
    const shipped = ACP_SPECS[0]!;
    expect(acpRowLabel(shipped)).toBe(shipped.name + " (unverified)");
    expect(acpRowLabel({ ...shipped, verified: true })).toBe(shipped.name);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The pickers list every row, marked from the data.
 * ------------------------------------------------------------------ */

describe("the pickers offer every row and mark the unverified ones", () => {
  test("the card's picker lists both rows by name, marked", () => {
    const tools = ACP_SPECS.map((spec) => ({
      id: spec.id,
      name: acpRowLabel(spec),
    }));
    const html = renderToStaticMarkup(
      createElement(SessionCard, {
        session: { on: "a-run", name: "A run", x: 0, y: 0, tool: "a-row-gone" },
        toolName: null,
        declaration: null,
        tools,
        entries: [],
        running: false,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onChooseTool: async () => ({ ok: true as const }),
      }),
    );
    for (const spec of ACP_SPECS) {
      expect(html).toContain(acpRowLabel(spec));
    }
    // Every unverified row says so, and only a verified one would not.
    expect(html).toContain("(unverified)");
    expect(ACP_SPECS.every((spec) => !spec.verified)).toBe(true);
  });

  test("the bubble's picker builds its labels from the rows, never a name", () => {
    const bubble = readFileSync(join(APP, "src", "canvas", "GroundBubble.tsx"), "utf8");
    expect(bubble).toContain("ACP_SPECS.map(");
    expect(bubble).toContain("acpRowLabel(spec)");
  });

  test("the card's re-bind picker does the same", () => {
    const layer = readFileSync(join(APP, "src", "canvas", "GroundLayer.tsx"), "utf8");
    expect(layer).toContain("name: acpRowLabel(spec)");
  });
});

/* ------------------------------------------------------------------ *
 * 3. A missing command refuses in one sentence, before any spawn.
 * ------------------------------------------------------------------ */

describe("a row whose command is not there refuses, naming it, before spawning", () => {
  test("the sentence names the command, once", () => {
    const sentence = runMissingCommandSentence("no-such-tool");
    expect(sentence).toContain("no-such-tool");
    expect(sentence.trim().split(/[.!?]/).filter((part) => part !== "")).toHaveLength(1);
    expect(sentence.endsWith(".")).toBe(true);
  });

  test("the command lookup is a pure fact, and an absolute path is checked where it points", () => {
    expect(commandFound(BUN)).toBe(true);
    expect(commandFound("/definitely/not/here/attentioneer-tool")).toBe(false);
    expect(commandFound("attentioneer-no-such-tool-on-path")).toBe(false);
    expect(commandFound("/opt/tool", () => true)).toBe(true);
    expect(commandFound("/opt/tool", () => false)).toBe(false);
    expect(commandFound("tool", () => false)).toBe(false);
  });

  test("the lane refuses that row and spawns nothing", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const said: string[] = [];
    const runLane = createRunLane({ say: (line) => said.push(line) });
    const request: RunRequest = {
      id: 7,
      kind: "run",
      run: 7,
      tool: {
        command: "/definitely/not/here/attentioneer-tool",
        args: [FAKE_SERVER, "tools", "--report", reportPath],
        timeoutMinutes: 1,
      },
      env: {},
      prompt: "say one sentence and change nothing",
    };
    runLane.start(request);
    const line = parseSidecarLine(said[0] ?? "");
    expect(line?.kind).toBe("error");
    if (line?.kind !== "error") throw new Error("the lane said nothing");
    expect(line.message).toBe(
      runMissingCommandSentence("/definitely/not/here/attentioneer-tool"),
    );
    // NOTHING WAS SPAWNED: the fake child never wrote its report.
    await Bun.sleep(150);
    expect(existsSync(reportPath)).toBe(false);
    expect(said).toHaveLength(1);
  });

  test("a run through the sidecar ends 'failed' with that sentence, not a hang", async () => {
    const pipe = openSidecar();
    PIPES.push(pipe);
    await pipe.hello();
    const second = ACP_SPECS[1]!;
    const handle = startSessionRun(
      { ...second, command: "/definitely/not/here/attentioneer-tool", args: [] },
      "say one sentence and change nothing",
      { transport: pipe.transport, start: async () => RUNNING },
    );
    const ended = await handle.ended;
    expect(ended.ending).toBe("failed");
    expect(ended.sentence).toContain("/definitely/not/here/attentioneer-tool");
  });
});

/* ------------------------------------------------------------------ *
 * 4. The SECOND row id rides the whole path unchanged.
 * ------------------------------------------------------------------ */

describe("a second row id rides the whole lane unchanged", () => {
  test("declaration, stream and ending, against the fake child", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const row = secondRow(reportPath);
    expect(row.id).toBe(ACP_SPECS[1]!.id);
    const { transport } = await lane();
    const entries: AcpProgressEntry[] = [];
    const handle = startSessionRun(row, "say one sentence and change nothing", {
      transport,
      start: async () => RUNNING,
      onEntry: (entry) => entries.push(entry),
    });
    const ended = await handle.ended;

    expect(ended).toEqual({ ending: "completed", sentence: null });
    const started = entries.find((entry) => entry.kind === "started");
    expect(started).toBeDefined();
    if (started?.kind !== "started") throw new Error("no started entry");
    // The declaration is the ROW's (no env entry), never a name.
    expect(started.declaration).toBe(acpDeclaration(row));
    expect(started.declaration).toContain("no key");
    expect(started.command).toBe(BUN);
    expect(started.args).toEqual([
      FAKE_SERVER,
      "tools",
      "--report",
      reportPath,
    ]);
    // The stream carried the agent's words and the ending says completed.
    expect(
      entries.some(
        (entry) => entry.kind === "update" && entry.text === "one ",
      ),
    ).toBe(true);
    expect(
      entries.some(
        (entry) => entry.kind === "update" && entry.updateKind === "tool_call",
      ),
    ).toBe(true);
    // The ENDING rides `run-end` alone, never a second progress entry (the
    // ending the card records is the map's, not a streamed duplicate).
    expect(entries.some((entry) => entry.kind === "ended")).toBe(false);
    expect(await gone((await reportOf(reportPath)).pid)).toBe(true);
  });

  test("the transcript is the run's own bytes, exactly as for the first row", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const row = secondRow(reportPath);
    const { transport } = await lane();
    const slug = "a-second-run";
    const done = await beginSessionRun(base, row, slug, {
      task: TASK,
      readKey: async () => {
        throw new Error("a row with no env entry reads no key");
      },
      transport,
      start: async () => RUNNING,
      transcriptIo: nodeIo(),
      now: () => "2026-11-18T00:00:00.000Z",
    }).done;

    expect(done.ending).toBe("completed");
    expect(done.notice).toBeNull();
    // STORY 19.3 — the first line is the send itself; the run's beats follow.
    expect(done.entries.map((entry) => entry.kind)).toEqual([
      "sent",
      "started",
      "session",
      "tool",
      "text",
      "tool",
      "text",
      "ended",
    ]);
    const file = readFileSync(sessionTranscriptPath(base, slug), "utf8");
    expect(file).toBe(serializeSessionTranscript(done.entries));
    expect(file).not.toContain("opencode");
    expect(await gone((await reportOf(reportPath)).pid)).toBe(true);
  });

  test("the PRISM's tool field is the row's id, whatever the row is", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const row = secondRow(reportPath);
    const { transport } = await lane();
    const slug = "a-second-run";
    const done = await beginSessionRun(base, row, slug, {
      task: TASK,
      transport,
      start: async () => RUNNING,
      transcriptIo: nodeIo(),
    }).done;

    let log: string | null = null;
    let minted = 0;
    const moved = await runRunContact(
      {
        workspacePath: base,
        on: slug,
        tool: row.id,
        outcome: runOutcomeOf(done.ending),
        resultSize: sessionResultSize(done.entries),
      },
      {
        readPrismsText: async () => log,
        writePrismsText: async (next) => {
          log = next;
        },
        mintId: () => "prism-" + (minted += 1),
      },
    );
    expect(moved.prism.contact).toBe("run");
    const change = moved.prism.changes[0];
    expect(change).toMatchObject({
      kind: "run",
      tool: "opencode-acp",
      outcome: "answered",
      resultSize: 7,
    });
    expect(JSON.stringify(change)).not.toContain("one two");
    expect(await gone((await reportOf(reportPath)).pid)).toBe(true);
  });
});

/* ------------------------------------------------------------------ *
 * 5. The one grep: no product is known outside the row data.
 * ------------------------------------------------------------------ */

describe("no tool is named in a module that runs, renders or records a run", () => {
  // TWO DATA FILES may name a product: the ACP rows, and (story 15.13) the
  // provider catalogue, whose whole job is to name providers. The constraint
  // is about the modules that RUN, RENDER or RECORD a run, not about data.
  const DATA = new Set([
    join(APP, "src", "turn", "acpSpecs.ts"),
    join(APP, "src", "turn", "providerCatalog.ts"),
  ]);

  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        sources(full, out);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || DATA.has(full)) continue;
      out.push(full);
    }
    return out;
  }

  /**
   * A MENTION, not a substring: a row's name is hard-coded when it stands as a
   * word, never when it happens to sit inside another one (a handshake is not a
   * product).
   */
  function mentions(text: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      "(^|[^A-Za-z0-9_])" + escaped + "($|[^A-Za-z0-9_])",
      "i",
    ).test(text);
  }

  /** Every way a row could be hard-coded: its id, its name, its command. */
  function rowTokens(): string[] {
    const tokens = new Set<string>(["opencode", "dsh"]);
    for (const spec of ACP_SPECS) {
      tokens.add(spec.id);
      tokens.add(spec.name);
      tokens.add(spec.command);
      const base = spec.command.split(/[\\/]/).pop() ?? "";
      tokens.add(base);
      tokens.add(base.replace(/\.(cmd|exe|bat|sh)$/i, ""));
    }
    return [...tokens].filter((token) => token.trim().length >= 3);
  }

  test("a row's id, name or command appears in no window or sidecar module", () => {
    const files = [...sources(join(APP, "src")), ...sources(join(APP, "sidecar"))];
    // The scan really covers the run, the card and the records.
    for (const rel of [
      "src/turn/acpSession.ts",
      "src/turn/acpRun.ts",
      "src/canvas/SessionCard.tsx",
      "src/canvas/GroundBubble.tsx",
      "src/canvas/useGround.ts",
      "src/map/sessions.ts",
      "sidecar/runs.ts",
    ]) {
      expect(files.map((file) => file.slice(APP.length + 1))).toContain(rel);
    }
    const tokens = rowTokens();
    // The tokens are the products' own, live from the rows.
    expect(tokens).toContain("opencode");
    expect(tokens).toContain("dsh-acp");
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const token of tokens) {
        if (mentions(text, token)) {
          hits.push(file.slice(APP.length + 1) + " -> " + token);
        }
      }
    }
    expect(hits).toEqual([]);
    // POSITIVE CONTROL: the data file is where the names belong, and it has
    // them; the scan is not passing because the file set is empty.
    const data = readFileSync(join(APP, "src", "turn", "acpSpecs.ts"), "utf8");
    expect(data).toContain("opencode-acp");
    expect(data).toContain("dsh-acp");
  });
});
