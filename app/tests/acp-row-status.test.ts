import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ACP_SEEN_LINE_MAX,
  ACP_SPECS,
  acpRowLabel,
  acpRowStatus,
  acpSeenLine,
  acpStatusSentence,
  type AcpSpec,
} from "../src/turn/acpSpecs";
import {
  TOOL_ROWS_CONFIG_KEY,
  loadToolRowFacts,
  patchToolRowFact,
  readToolRowFacts,
  rowFactOf,
  rowSeenOf,
  rowWithFacts,
  saveToolRowFacts,
  storedToolRowFacts,
  type AcpRowFact,
  type ToolRowStoreIo,
} from "../src/turn/acpRowStore";
import {
  ROW_TEST_PROMPT,
  ROW_TEST_SENTENCES,
  ROW_TEST_TIMEOUT_MINUTES,
  rowTestSpec,
  runRowTest,
} from "../src/turn/acpRowTest";
import { rowTestGate } from "../src/canvas/useGround";
import {
  SESSION_BUSY_SENTENCE,
  SESSION_NO_TOOL_REFUSAL,
} from "../src/map/sessions";
import { SessionCard } from "../src/canvas/SessionCard";
import { canonicalJson } from "../src/lib/serialize";
import {
  parseSidecarLine,
  runEndLine,
  runPartLine,
  type SidecarLine,
} from "../src/turn/protocol";
import type { TurnTransport } from "../src/turn/turn";
import { runMissingCommandSentence } from "../sidecar/runs";
import type { SidecarStart } from "../src/turn/sidecar";
import {
  BUN,
  FAKE_SERVER,
  openSidecar,
  type SidecarPipe,
} from "./fixtures/sidecar-pipe";
import type { AppConfig } from "../src/lib/appConfig";

/**
 * STORY 22.1 — A TOOL ROW SAYS WHAT IT IS MISSING, AND ONE PRESS PROVES IT.
 *
 * The row's shipped data never changes; what changes is a per-machine FACT the
 * app config keeps, laid over the shipped rows by id. This file pins:
 *
 *   1. the fact store: a round trip, the overlay by id, the survival of a row
 *      this build does not ship, and the EXACT shape of the one patch;
 *   2. the three status sentences: missing, never tested here, and tested (the
 *      date and the clipped first line), with no "verified" and no "working";
 *   3. the test verb end to end through the fake server: a completion records
 *      the fact and flips the picker's label; a failure writes nothing; a
 *      missing command answers the lane's sentence and spawns nothing;
 *   4. the test run leaves NO trace on the map (no transcript, no history, no
 *      mirror, no record) — its only write is the config fact;
 *   5. the card's shape: the state line and the verb live on the EXPANDED face,
 *      and a press while the card's run is live answers the existing busy
 *      sentence.
 *
 * The product names in the rows are DATA; this file never needs one, and every
 * fixture below names a row by its id.
 */

const APP = fileURLToPath(new URL("..", import.meta.url)).replace(/[\/]$/, "");
const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-row-status-"));

const PIPES: SidecarPipe[] = [];

const RUNNING: SidecarStart = {
  kind: "running",
  status: { running: true, entry: "", entryKind: "dev-entry", bun: "" },
};

afterAll(() => {
  for (const pipe of PIPES) pipe.stop();
  rmSync(ROOT, { recursive: true, force: true });
});

function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

async function lane(): Promise<SidecarPipe["transport"]> {
  const pipe = openSidecar();
  PIPES.push(pipe);
  await pipe.hello();
  return pipe.transport;
}

/**
 * A config file held in memory, with the SAME merge rule the real one applies:
 * a patch lays over the top level and every other feature key survives.
 */
function fakeConfig(initial: AppConfig = {}) {
  let current: AppConfig = initial;
  let writes = 0;
  const io: ToolRowStoreIo = {
    async load() {
      return current;
    },
    async save(patch: AppConfig) {
      writes += 1;
      current = { ...current, ...patch };
    },
  };
  return {
    io,
    bytes: () => canonicalJson(current),
    config: () => current,
    writes: () => writes,
  };
}

/** Every file under a folder, path → bytes, for the no-trace comparison. */
function treeOf(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      out[full.slice(root.length)] = readFileSync(full, "utf8");
    }
  }
  walk(root);
  return out;
}

async function waitFor(check: () => boolean, budgetMs = 5_000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > budgetMs) {
      throw new Error("timed out waiting for the fake server");
    }
    await Bun.sleep(5);
  }
}

async function gone(pid: number): Promise<boolean> {
  for (let at = 0; at < 200; at += 1) {
    try {
      process.kill(pid, 0);
    } catch {
      return true;
    }
  }
  return false;
}

/* ------------------------------------------------------------------ *
 * 1. The fact store.
 * ------------------------------------------------------------------ */

describe("a tool row's per-machine fact is a small, exact record in the config", () => {
  const fact = (): AcpRowFact => ({
    id: ACP_SPECS[0]!.id,
    verified: true,
    seen: { date: "2026-11-19", line: "OK." },
  });

  test("a config round trip keeps exactly what a test saw", async () => {
    const stored = fakeConfig();
    await saveToolRowFacts([fact()], stored.io);
    const loaded = await loadToolRowFacts(stored.io);
    expect(loaded).toEqual([fact()]);
    expect(Object.keys(stored.config())).toEqual([TOOL_ROWS_CONFIG_KEY]);
    expect(TOOL_ROWS_CONFIG_KEY).toBe("toolRows");
  });

  test("the fact is built field by field, so nothing else can ride in", () => {
    const smuggled = [
      {
        id: "a-row",
        verified: true,
        seen: { date: "2026-11-19", line: "OK.", extra: "not kept" },
        name: "a name",
        command: "/not/kept",
      },
    ];
    const facts = readToolRowFacts(smuggled);
    expect(facts).toHaveLength(1);
    expect(Object.keys(facts[0]!)).toEqual(["id", "verified", "seen"]);
    expect(Object.keys(facts[0]!.seen!)).toEqual(["date", "line"]);
    const stored = storedToolRowFacts(facts);
    expect(Object.keys(stored[0]!)).toEqual(["id", "verified", "seen"]);
    const bytes = JSON.stringify(stored);
    expect(bytes).not.toContain("a name");
    expect(bytes).not.toContain("/not/kept");
    expect(bytes).not.toContain("not kept");
  });

  test("a malformed entry is dropped, and only a true verified counts", () => {
    const facts = readToolRowFacts([
      { verified: true, seen: { date: "2026-11-19", line: "OK." } },
      "not a record",
      { id: "a-row", verified: "true", seen: null },
      { id: "a-row", verified: true, seen: { date: "2026-11-19", line: "OK." } },
      { id: "a-row", verified: true, seen: { date: "2026-11-19", line: "again" } },
      { id: "b-row", verified: true, seen: { date: "", line: "no date" } },
    ]);
    // No id reads as nothing; a string "true" is not a yes; the first of two
    // duplicate ids is the one a patch would have replaced; a seen with no date
    // is no seen at all.
    expect(facts).toEqual([
      { id: "a-row", verified: false, seen: null },
      { id: "b-row", verified: true, seen: null },
    ]);
    expect(readToolRowFacts({ not: "an array" })).toEqual([]);
  });

  test("the overlay is by id, and the picker's label reads it", () => {
    const shipped = ACP_SPECS[0]!;
    expect(rowWithFacts(shipped, [])).toBe(shipped);
    expect(acpRowLabel(rowWithFacts(shipped, []))).toBe(
      shipped.name + " (unverified)",
    );
    const overlayed = rowWithFacts(shipped, [fact()]);
    expect(overlayed.verified).toBe(true);
    expect(overlayed.command).toBe(shipped.command);
    expect(overlayed.args).toEqual(shipped.args);
    expect(overlayed.notes).toBe(shipped.notes);
    expect(acpRowLabel(overlayed)).toBe(shipped.name);
    // Another row's fact changes nothing about this one.
    expect(
      rowWithFacts(shipped, [{ ...fact(), id: "another-row" }]).verified,
    ).toBe(shipped.verified);
  });

  test("a stored id this build does not ship SURVIVES a load and a save", async () => {
    const other: AcpRowFact = {
      id: "a-row-from-another-build",
      verified: true,
      seen: { date: "2026-10-01", line: "hello." },
    };
    const stored = fakeConfig({ toolRows: [other, fact()] });
    await patchToolRowFact(
      { ...fact(), seen: { date: "2026-11-19", line: "OK." } },
      stored.io,
    );
    const facts = await loadToolRowFacts(stored.io);
    expect(facts.map((entry) => entry.id)).toEqual([
      other.id,
      fact().id,
    ]);
    expect(rowFactOf(facts, other.id)).toEqual(other);
  });

  test("the one patch is exactly {id, verified, seen}, in the config's bytes", async () => {
    const stored = fakeConfig({ turn: { untouched: true } });
    const facts = await patchToolRowFact(fact(), stored.io);
    expect(facts).toEqual([fact()]);
    // The whole file, byte for byte: keys sorted by the app's canonical writer,
    // one fact and nothing else, and the other feature's key untouched.
    const expected =
      '{\n' +
      '  "toolRows": [\n' +
      '    {\n' +
      '      "id": "' + ACP_SPECS[0]!.id + '",\n' +
      '      "seen": {\n' +
      '        "date": "2026-11-19",\n' +
      '        "line": "OK."\n' +
      '      },\n' +
      '      "verified": true\n' +
      '    }\n' +
      '  ],\n' +
      '  "turn": {\n' +
      '    "untouched": true\n' +
      '  }\n' +
      '}\n';
    expect(stored.bytes()).toBe(expected);
  });
});

/* ------------------------------------------------------------------ *
 * 2. The three states and their one sentence each.
 * ------------------------------------------------------------------ */

describe("a row's state is said in one sentence, and claims only what was seen", () => {
  test("the command is not on this machine", () => {
    const status = acpRowStatus(false, false, null);
    expect(status).toEqual({ kind: "missing" });
    expect(acpStatusSentence(status)).toBe(
      "this tool is not on this machine.",
    );
  });

  test("the row has never been tested here", () => {
    const status = acpRowStatus(true, false, null);
    expect(status).toEqual({ kind: "untested" });
    expect(acpStatusSentence(status)).toBe(
      "this row has never been tested here.",
    );
    // A mark without a seen record is not a test.
    expect(acpRowStatus(true, true, null)).toEqual({ kind: "untested" });
    expect(acpRowStatus(true, true, { date: "2026-11-19", line: "  " })).toEqual(
      { kind: "untested" },
    );
  });

  test("a tested row names the date and the words it answered", () => {
    const status = acpRowStatus(true, true, {
      date: "2026-11-19",
      line: "OK.",
    });
    expect(status.kind).toBe("tested");
    expect(acpStatusSentence(status)).toBe(
      "tested here on 2026-11-19; it answered: “OK.”",
    );
  });

  test("the first line is what is kept, clipped", () => {
    expect(acpSeenLine("OK.\nand more")).toBe("OK.");
    expect(acpSeenLine("  spaced  \n")).toBe("spaced");
    const long = "word ".repeat(60);
    const clipped = acpSeenLine(long);
    expect(clipped.length).toBeLessThanOrEqual(ACP_SEEN_LINE_MAX);
    expect(clipped.endsWith("…")).toBe(true);
    const sentence = acpStatusSentence(acpRowStatus(true, true, {
      date: "2026-11-19",
      line: long,
    }));
    expect(sentence).toContain(clipped);
    expect(rowSeenOf("OK.\nsecond", new Date("2026-11-19T12:00:00Z"))).toEqual({
      date: "2026-11-19",
      line: "OK.",
    });
  });

  test("no sentence says verified or working", () => {
    const statuses = [
      acpRowStatus(false, false, null),
      acpRowStatus(true, false, null),
      acpRowStatus(true, true, { date: "2026-11-19", line: "OK." }),
    ];
    for (const status of statuses) {
      const sentence = acpStatusSentence(status);
      expect(sentence.toLowerCase()).not.toContain("verified");
      expect(sentence.toLowerCase()).not.toContain("working");
    }
    // One sentence each: the state lines end once, and the tested line's only
    // extra stop is the quoted answer's own (inside the quotation marks).
    expect(acpStatusSentence(statuses[0]!)).toBe("this tool is not on this machine.");
    expect(acpStatusSentence(statuses[1]!)).toBe(
      "this row has never been tested here.",
    );
    expect(
      acpStatusSentence(statuses[2]!).trim().split(/[.!?]/).filter((part) => part !== ""),
    ).toHaveLength(2);
  });
});

/* ------------------------------------------------------------------ *
 * 3. The test verb at the wire, and then through the real sidecar.
 * ------------------------------------------------------------------ */

interface Scripted {
  transport: TurnTransport;
  sent: string[];
}

/** A transport that answers one run request with the lines a test hands it. */
function scriptedRun(
  lines: (id: number, run: number) => string[],
): Scripted {
  const sent: string[] = [];
  const handlers = new Map<number, (line: SidecarLine) => void>();
  const transport: TurnTransport = {
    async send(line) {
      sent.push(line);
      const parsed = JSON.parse(line) as { id: number; run: number; kind: string };
      if (parsed.kind !== "run") return;
      const handler = handlers.get(parsed.id);
      if (handler === undefined) return;
      await Promise.resolve();
      for (const raw of lines(parsed.id, parsed.run)) {
        const out = parseSidecarLine(raw);
        if (out !== null) handler(out);
      }
    },
    subscribe(id, handler) {
      handlers.set(id, handler);
      return () => handlers.delete(id);
    },
  };
  return { transport, sent };
}

function chunk(id: number, run: number, text: string): string {
  return runPartLine(id, run, {
    kind: "update",
    updateKind: "agent_message_chunk",
    text,
    update: {},
  });
}

function row(): AcpSpec {
  return {
    kind: "acp",
    id: "a-row",
    name: "A row",
    verified: false,
    command: BUN,
    args: [FAKE_SERVER, "tools"],
    cwdPolicy: "session",
    env: [],
    timeoutMinutes: 10,
    notes: "a row for the test",
  };
}

describe("the test verb is one tiny task through the existing run wire", () => {
  test("the request is the fixed prompt, one minute, no cwd and no trace fields", async () => {
    const { transport, sent } = scriptedRun((id, run) => [
      chunk(id, run, "OK."),
      runEndLine(id, run, "completed", null),
    ]);
    const outcome = await runRowTest(row(), {
      transport,
      start: async () => RUNNING,
    });
    expect(outcome.kind).toBe("tested");
    if (outcome.kind !== "tested") throw new Error("unreachable");
    expect(outcome.seen.line).toBe("OK.");
    expect(outcome.seen.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);

    const request = JSON.parse(sent[0] ?? "{}") as {
      kind: string;
      prompt: string;
      run: number;
      id: number;
      tool: { command: string; args: string[]; timeoutMinutes: number };
      env: Record<string, string>;
      cwd?: string;
      scope?: unknown;
      resume?: unknown;
    };
    expect(request.kind).toBe("run");
    expect(request.prompt).toBe(ROW_TEST_PROMPT);
    expect(request.tool.timeoutMinutes).toBe(ROW_TEST_TIMEOUT_MINUTES);
    expect(request.tool.timeoutMinutes).toBe(1);
    expect(request.tool.command).toBe(BUN);
    expect(request.env).toEqual({});
    // NO cwd, no declared scope and no continuation: a fresh session directory
    // is the lane's own, and a test is not the card's run.
    expect(request.cwd).toBeUndefined();
    expect(request.scope).toBeUndefined();
    expect(request.resume).toBeUndefined();
  });

  test("a completed turn with no words is not something seen", async () => {
    const { transport } = scriptedRun((id, run) => [
      runEndLine(id, run, "completed", null),
    ]);
    const outcome = await runRowTest(row(), {
      transport,
      start: async () => RUNNING,
    });
    expect(outcome).toEqual({
      kind: "untested",
      ending: "completed",
      sentence: ROW_TEST_SENTENCES.empty,
    });
  });

  test("a failure keeps the lane's own sentence and says nothing more", async () => {
    const sentence = runMissingCommandSentence("/not/here/tool");
    const { transport } = scriptedRun((id, run) => [
      runEndLine(id, run, "failed", sentence),
    ]);
    const outcome = await runRowTest(row(), {
      transport,
      start: async () => RUNNING,
    });
    expect(outcome).toEqual({
      kind: "untested",
      ending: "failed",
      sentence,
    });
    // THE CONFIG IS UNTOUCHED, and the face keeps the untested sentence: a
    // failed test records nothing, so the row is exactly as untested as before.
    const stored = fakeConfig();
    if (outcome.kind !== "tested") {
      // Nothing about a failure is a fact: a caller has nothing to patch.
      expect(stored.writes()).toBe(0);
      expect(await loadToolRowFacts(stored.io)).toEqual([]);
    }
    expect(acpStatusSentence(acpRowStatus(true, false, null))).toBe(
      "this row has never been tested here.",
    );
  });

  test("the spec a test runs has the row's argv and ONE minute", () => {
    const spec = rowTestSpec(row());
    expect(spec.timeoutMinutes).toBe(1);
    expect(spec.command).toBe(row().command);
    expect(spec.args).toEqual(row().args);
    expect(spec.env).toEqual([]);
    expect(spec.cwdPolicy).toBe("session");
  });

  test("completion through the REAL lane: the fact is written, the label flips", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const transport = await lane();
    // THE SHIPPED ROW, pointed at the fake child: the fact is its id's, so the
    // picker's label for that row is what flips — and only that row's.
    const runRow: AcpSpec = {
      ...ACP_SPECS[0]!,
      command: BUN,
      args: [FAKE_SERVER, "tools", "--report", reportPath],
    };
    const outcome = await runRowTest(runRow, {
      transport,
      start: async () => RUNNING,
    });
    expect(outcome.kind).toBe("tested");
    if (outcome.kind !== "tested") throw new Error("unreachable");
    // The fake's words: a tool call, then "one ", then "two".
    expect(outcome.seen.line).toBe("one two");

    const stored = fakeConfig();
    await patchToolRowFact(
      { id: runRow.id, verified: true, seen: outcome.seen },
      stored.io,
    );
    const facts = await loadToolRowFacts(stored.io);
    expect(rowFactOf(facts, runRow.id)).toEqual({
      id: runRow.id,
      verified: true,
      seen: outcome.seen,
    });
    // The picker's label is the merged row's, so it flipped for THIS row only.
    const merged = ACP_SPECS.map((shipped) => rowWithFacts(shipped, facts));
    expect(acpRowLabel(merged[0]!)).toBe(ACP_SPECS[0]!.name);
    expect(acpRowLabel(merged[1]!)).toBe(ACP_SPECS[1]!.name + " (unverified)");
    // The tested row's state sentence names the date and what it answered.
    expect(
      acpStatusSentence(acpRowStatus(true, merged[0]!.verified, outcome.seen)),
    ).toBe("tested here on " + outcome.seen.date + "; it answered: “one two”");

    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { pid: number };
    expect(await gone(report.pid)).toBe(true);
  });

  test("an asking tool's test run refuses at once and never waits on a person", async () => {
    // The fake's "normal" mode asks for permission on its first prompt and
    // waits for an answer. The test path answers REFUSE immediately, through
    // the existing refuse rule, so the turn finishes on its own — the words
    // below are the server's own after a refusal, and no timeout happened.
    const transport = await lane();
    const started = Date.now();
    const outcome = await runRowTest(
      { ...row(), args: [FAKE_SERVER, "normal"] },
      { transport, start: async () => RUNNING },
    );
    const elapsed = Date.now() - started;
    expect(outcome.kind).toBe("tested");
    if (outcome.kind !== "tested") throw new Error("unreachable");
    // "refused " is what crossed: the ask was answered without a person, and
    // the run continued to its own end_turn.
    expect(outcome.seen.line).toBe("one refused two");
    expect(outcome.seen.line).not.toContain("allow");
    // A WAIT WOULD SHOW UP AS THE BUDGET: no ask sat unanswered.
    expect(elapsed).toBeLessThan(4_000);
  });

  test("a missing command through the REAL lane answers in one sentence and spawns nothing", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const transport = await lane();
    const missing = "/definitely/not/here/attentioneer-row-test";
    const outcome = await runRowTest(
      {
        ...row(),
        command: missing,
        args: [FAKE_SERVER, "tools", "--report", reportPath],
      },
      { transport, start: async () => RUNNING },
    );
    expect(outcome.kind).toBe("untested");
    if (outcome.kind !== "untested") throw new Error("unreachable");
    expect(outcome.sentence).toBe(runMissingCommandSentence(missing));
    // NOTHING WAS SPAWNED: the fake child never wrote its report.
    expect(existsSync(reportPath)).toBe(false);
    // And nothing was recorded anywhere.
    const stored = fakeConfig();
    expect((await loadToolRowFacts(stored.io))).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The test run leaves NO trace on the map.
 * ------------------------------------------------------------------ */

describe("a test run writes one config fact and nothing on the map", () => {
  test("no transcript line, no history event, no mirror rewrite, no record", async () => {
    const base = workspace();
    const map = join(base, "map");
    mkdirSync(join(map, "sessions"), { recursive: true });
    writeFileSync(
      join(map, "sessions.txt"),
      "a-run|A run|100|100|a-row\n",
    );
    writeFileSync(join(map, "MAP.md"), "# MAP\n");
    writeFileSync(join(map, "history.jsonl"), '{"kind":"card.add"}\n');
    const before = treeOf(map);

    const reportPath = join(base, "report.json");
    const transport = await lane();
    const outcome = await runRowTest(
      {
        ...row(),
        args: [FAKE_SERVER, "tools", "--report", reportPath],
      },
      { transport, start: async () => RUNNING },
    );
    expect(outcome.kind).toBe("tested");

    const stored = fakeConfig();
    const facts = await patchToolRowFact(
      { id: "a-row", verified: true, seen: (outcome as { seen: { date: string; line: string } }).seen },
      stored.io,
    );
    expect(facts).toHaveLength(1);

    // THE MAP FOLDER IS BYTE-IDENTICAL: the test's only write was the config.
    expect(treeOf(map)).toEqual(before);
    expect(existsSync(join(map, "sessions", "a-run.jsonl"))).toBe(false);
    expect(readFileSync(join(map, "history.jsonl"), "utf8")).toBe('{"kind":"card.add"}\n');
    expect(statSync(join(map, "MAP.md")).size).toBe(before["/MAP.md"]!.length);
    expect(
      Object.keys(stored.config()),
    ).toEqual([TOOL_ROWS_CONFIG_KEY]);
  });
});

/* ------------------------------------------------------------------ *
 * 5. The card's shape and the busy interplay.
 * ------------------------------------------------------------------ */

function cardHtml(
  props: Record<string, unknown> = {},
): string {
  return renderToStaticMarkup(
    createElement(SessionCard, {
      session: { on: "a-run", name: "A run", x: 0, y: 0, tool: "a-row" },
      toolName: "A row",
      declaration: null,
      entries: [],
      running: false,
      open: true,
      previewLines: 6,
      onOpen: () => {},
      onClose: () => {},
      ...props,
    } as never),
  );
}

describe("the card says the row's state on its expanded face, and offers one verb", () => {
  test("an untested row says so, with the verb beside run", () => {
    const html = cardHtml({
      toolStatus: acpRowStatus(true, false, null),
      onTestRow: async () => ({ ok: true as const }),
    });
    expect(html).toContain("this row has never been tested here.");
    expect(html).toContain("test this row");
    expect(html).toContain(">run<");
  });

  test("a tested row names the date and the words", () => {
    const html = cardHtml({
      toolStatus: acpRowStatus(true, true, {
        date: "2026-11-19",
        line: "OK.",
      }),
      onTestRow: async () => ({ ok: true as const }),
    });
    expect(html).toContain(
      "tested here on 2026-11-19; it answered: “OK.”",
    );
    expect(html).not.toContain("never been tested here");
  });

  test("a missing command says the tool is not on this machine", () => {
    const html = cardHtml({
      toolStatus: acpRowStatus(false, false, null),
      onTestRow: async () => ({ ok: true as const }),
    });
    expect(html).toContain("this tool is not on this machine.");
  });

  test("NOTHING of it is on the closed face", () => {
    const html = cardHtml({
      open: false,
      toolStatus: acpRowStatus(true, false, null),
      onTestRow: async () => ({ ok: true as const }),
    });
    expect(html).not.toContain("this row has never been tested here.");
    expect(html).not.toContain("test this row");
  });

  test("a card whose row is gone has neither the line nor the verb", () => {
    const html = cardHtml({
      toolName: null,
      toolStatus: null,
      onTestRow: async () => ({ ok: true as const }),
    });
    expect(html).not.toContain("this row has never been tested here.");
    expect(html).not.toContain("test this row");
  });

  test("a press while the card's run is live answers the existing busy sentence", () => {
    // The card stays pressable while running (the press's answer is the gate's);
    // the gate itself is the layer's, and it is the existing sentence.
    const html = cardHtml({
      running: true,
      toolStatus: acpRowStatus(true, false, null),
      onTestRow: async () => ({ ok: true as const }),
    });
    expect(html).toContain("test this row");
    expect(rowTestGate({ liveRun: true, row: row() })).toEqual({
      kind: "refused",
      message: SESSION_BUSY_SENTENCE,
    });
    expect(rowTestGate({ liveRun: false, row: null })).toEqual({
      kind: "refused",
      message: SESSION_NO_TOOL_REFUSAL,
    });
    expect(rowTestGate({ liveRun: false, row: row() })).toEqual({
      kind: "ready",
    });
    // THE PRESS THE CARD FORWARDS IS THE HOOK'S ONE PATH: it checks the card's
    // live run before anything, runs the one tiny task, and patches ONE fact
    // only on a tested outcome. The transcript writers are not on this path.
    const hook = readFileSync(join(APP, "src/canvas/useGround.ts"), "utf8");
    expect(hook).toContain("sessionRunsRef.current[slug] !== undefined");
    expect(hook).toContain("runRowTest(");
    expect(hook).toContain("patchToolRowFact(");
    expect(hook).toContain("ROW_TEST_SENTENCES.notStored");
    // The card's verb lives inside the expanded face's actions, beside run.
    const card = readFileSync(join(APP, "src/canvas/SessionCard.tsx"), "utf8");
    expect(card).toContain("test this row");
    expect(card).toContain("session-card-tool-state");
  });
});

/* ------------------------------------------------------------------ *
 * 6. The naming rule: these modules know no product.
 * ------------------------------------------------------------------ */

describe("the row's modules know no product's name", () => {
  function mentions(text: string, token: string): boolean {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(
      "(^|[^A-Za-z0-9_])" + escaped + "($|[^A-Za-z0-9_])",
      "i",
    ).test(text);
  }

  test("the status sentence derives from data, not from a row's name", () => {
    // Every token comes from the shipped DATA, so this file hard-codes no name.
    const tokens = new Set<string>();
    for (const spec of ACP_SPECS) {
      tokens.add(spec.id);
      tokens.add(spec.name);
      tokens.add(spec.command);
      const base = spec.command.split(/[\\/]/).pop() ?? "";
      tokens.add(base);
      tokens.add(base.replace(/\.(cmd|exe|bat|sh)$/i, ""));
    }
    const modules = [
      "src/turn/acpRowStore.ts",
      "src/turn/acpRowTest.ts",
    ];
    const hits: string[] = [];
    for (const rel of modules) {
      const text = readFileSync(join(APP, rel), "utf8");
      for (const token of [...tokens].filter((entry) => entry.trim().length >= 3)) {
        if (mentions(text, token)) hits.push(rel + " -> " + token);
      }
    }
    expect(hits).toEqual([]);
  });
});
