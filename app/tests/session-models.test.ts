import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SESSION_MODEL_REFUSAL,
  bindSessionBoundary,
  bindSessionModel,
  bindSessionProject,
  parseSessionLine,
  serializeSessionLine,
  type SessionCard as SessionCardRecord,
} from "../src/map/sessions";
import {
  SESSION_MODEL_DEFAULT,
  SESSION_MODEL_OWN_SETTING,
  SessionCard,
} from "../src/canvas/SessionCard";
import {
  ACP_SPECS,
  acpDeclaration,
  acpDeclarationWithModel,
  acpModelDeclaration,
  type AcpSpec,
} from "../src/turn/acpSpecs";
import {
  acpModelChoicesOfAnswer,
  acpModelNameOf,
  acpRunModelOf,
  readAcpModelChoices,
  type AcpModelChoice,
} from "../src/turn/acpModels";
import {
  TOOL_ROWS_CONFIG_KEY,
  loadToolRowFacts,
  patchToolRowModels,
  readToolRowFacts,
  recordSessionModels,
  storedToolRowFacts,
  type ToolRowStoreIo,
} from "../src/turn/acpRowStore";
import {
  parseRequestLine,
  parseSidecarLine,
  runEndLine,
  runPartLine,
  runRequestLine,
  type RunRequest,
  type SidecarLine,
} from "../src/turn/protocol";
import type { TurnTransport } from "../src/turn/turn";
import type { SidecarStart } from "../src/turn/sidecar";
import { beginSessionRun } from "../src/canvas/useGround";
import { runRowTest } from "../src/turn/acpRowTest";
import type { SessionIo } from "../src/map/sessions";
import { canonicalJson } from "../src/lib/serialize";
import {
  BUN,
  FAKE_SERVER,
  openSidecar,
  type SidecarPipe,
} from "./fixtures/sidecar-pipe";
import type { AppConfig } from "../src/lib/appConfig";

/**
 * STORY 22.5 — THE TOOL NAMES ITS MODELS; THE PERSON PICKS ONE.
 *
 * WHAT IS PINNED, in the story's own words:
 *
 *   1. THE IDENTITY RULE: category "model" wins, id "model" is the fallback,
 *      another category is not a model, and no match is the honest quiet line.
 *   2. THE RECORD: an optional model tail; absent is byte-identical, clearing
 *      returns the line to its old bytes, and the bindings never erase it.
 *   3. THE MACHINE LEARNS: the session answer's model choices are recorded as
 *      {id, name, value} on the row's fact, captured by a run and by the test
 *      probe, and cleared when the tool stops naming one.
 *   4. THE WIRE: a run may carry {optionId, value}; an unchosen run's line is
 *      the bytes it always was; both strings are read strictly and the value is
 *      never parsed. A run's ending may carry the session step's options.
 *   5. THE DICTATE: against the fake child, the set is spoken AFTER the session
 *      step and BEFORE the prompt (new and resumed), with the value bytes
 *      EXACTLY as the tool wrote them; a refused set ends the run with the
 *      tool's own sentence and sends no prompt.
 *   6. THE FACE: the picker offers the tool's display names only (never a
 *      value), the quiet line stands when the tool named none, and the
 *      declaration names the choice before the run.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-session-models-"));
const PIPES: SidecarPipe[] = [];

afterAll(() => {
  for (const pipe of PIPES) pipe.stop();
  rmSync(ROOT, { recursive: true, force: true });
});

/* The fixture's own choices are DATA here: the exact value bytes below are
   what the fake child wrote, and they are what must arrive back. */
const FAST = '["route-a","fast"]';
const SLOW = '["route-a","slow"]';
const PRO = '["route-b","pro"]';

/** The choices the fake child's model option offers, in its own order. */
const RECORDED: AcpModelChoice[] = [
  { id: "model", name: "Fast", value: FAST },
  { id: "model", name: "Slow", value: SLOW },
  { id: "model", name: "Pro", value: PRO },
];

const SESSION: SessionCardRecord = {
  on: "the-session",
  name: "A session",
  x: 0,
  y: 0,
  tool: "a-row",
};

const OLD_LINE =
  "on: the-session | name: A session | x: 0 | y: 0 | tool: a-row";

function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

function folder(): string {
  return mkdtempSync(join(ROOT, "run-"));
}

/** A config file held in memory, with the app's own merge rule. */
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

/* ------------------------------------------------------------------ *
 * 1. The identity rule: which option is the tool's model, and which
 *    choices it offers.
 * ------------------------------------------------------------------ */

describe("the tool's model option is found by its own words, and nowhere else", () => {
  const select = (extra: Record<string, unknown>) => ({
    type: "select",
    options: [{ value: "one", name: "One" }],
    ...extra,
  });

  test("category model wins over an id that also says model", () => {
    const read = readAcpModelChoices([
      select({ id: "model", name: "Id model" }),
      select({ id: "chosen", name: "Category model", category: "model" }),
    ]);
    expect(read.read).toBe("named");
    if (read.read !== "named") throw new Error("unreachable");
    // The category's option is the one; its id rides each choice so a set can
    // name both sides.
    expect(read.models).toEqual([
      { id: "chosen", name: "One", value: "one" },
    ]);
  });

  test("the bare id is the fallback when no category says model", () => {
    const read = readAcpModelChoices([
      select({ id: "model", category: "something_else" }),
    ]);
    expect(read.read).toBe("named");
    if (read.read !== "named") throw new Error("unreachable");
    expect(read.models).toEqual([{ id: "model", name: "One", value: "one" }]);
  });

  test("another category is not a model, and neither is a non-select", () => {
    expect(
      readAcpModelChoices([
        select({ id: "reasoning_effort", category: "thought_level" }),
      ]),
    ).toEqual({ read: "none" });
    expect(
      readAcpModelChoices([
        { id: "model", category: "model", type: "boolean", currentValue: true },
      ]),
    ).toEqual({ read: "none" });
    // A list that named no model option at all.
    expect(readAcpModelChoices([])).toEqual({ read: "none" });
    // An answer that carried no list claims nothing at all.
    expect(readAcpModelChoices(undefined)).toEqual({ read: "unknown" });
    expect(readAcpModelChoices(null)).toEqual({ read: "unknown" });
    expect(readAcpModelChoices({ not: "a list" })).toEqual({ read: "unknown" });
  });

  test("grouped choices flatten, names are kept, values stay OPAQUE", () => {
    const read = readAcpModelChoices([
      {
        id: "model",
        name: "Model",
        category: "model",
        type: "select",
        currentValue: FAST,
        options: [
          {
            group: "route-a",
            name: "Route A",
            options: [{ value: FAST, name: "Fast" }],
          },
          {
            group: "route-b",
            name: "Route B",
            options: [
              { value: SLOW, name: "Slow" },
              { value: PRO, name: "Pro" },
            ],
          },
        ],
      },
    ]);
    expect(read).toEqual({ read: "named", models: RECORDED });
    // The value that looks like JSON is still just bytes: nothing parsed it.
    expect(typeof RECORDED[0]!.value).toBe("string");
    expect(RECORDED[0]!.value).toBe(FAST);
    // A choice with no name (or no value) is not a choice a face may show.
    expect(
      readAcpModelChoices([
        {
          id: "model",
          category: "model",
          type: "select",
          options: [{ value: "only-a-value" }, { name: "no value" }],
        },
      ]),
    ).toEqual({ read: "none" });
  });

  test("an answer's list is classified once, so a run and a probe agree", () => {
    expect(acpModelChoicesOfAnswer(undefined)).toBeNull();
    expect(acpModelChoicesOfAnswer([])).toEqual([]);
    expect(
      acpModelChoicesOfAnswer([
        { id: "x", type: "select", category: "y", options: [] },
      ]),
    ).toEqual([]);
    expect(
      acpModelChoicesOfAnswer([
        {
          id: "model",
          category: "model",
          type: "select",
          options: [{ value: SLOW, name: "Slow" }],
        },
      ]),
    ).toEqual([{ id: "model", name: "Slow", value: SLOW }]);
  });

  test("the name and the run pair come from the recorded list alone", () => {
    expect(acpModelNameOf(RECORDED, SLOW)).toBe("Slow");
    expect(acpModelNameOf(RECORDED, "not recorded")).toBeNull();
    expect(acpRunModelOf(RECORDED, PRO)).toEqual({
      optionId: "model",
      value: PRO,
    });
    expect(acpRunModelOf(RECORDED, "not recorded")).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 2. The record: the optional model tail, beside the binding fields.
 * ------------------------------------------------------------------ */

describe("the session line carries the chosen model only when there is one", () => {
  test("an old line parses and writes the same bytes", () => {
    expect(parseSessionLine(OLD_LINE)).toEqual(SESSION);
    expect(serializeSessionLine(SESSION)).toBe(OLD_LINE);
  });

  test("a chosen model round-trips, value bytes and spaces included", () => {
    const chosen: SessionCardRecord = { ...SESSION, model: FAST };
    const line = serializeSessionLine(chosen);
    expect(line).toBe(OLD_LINE + " | model: " + FAST);
    expect(parseSessionLine(line)).toEqual(chosen);
    // The value is opaque: a space inside it is part of the value.
    const spaced: SessionCardRecord = { ...SESSION, model: '["route a","fast"]' };
    expect(parseSessionLine(serializeSessionLine(spaced))).toEqual(spaced);
  });

  test("clearing removes the field and returns the old bytes", () => {
    const chosen = bindSessionModel([SESSION], SESSION.on, SLOW);
    if (chosen === null) throw new Error("unreachable");
    expect(serializeSessionLine(chosen[0]!)).toBe(
      OLD_LINE + " | model: " + SLOW,
    );
    const cleared = bindSessionModel(chosen, SESSION.on, null);
    if (cleared === null) throw new Error("unreachable");
    expect(cleared[0]!.model).toBeUndefined();
    expect(serializeSessionLine(cleared[0]!)).toBe(OLD_LINE);
    // A slug this file does not carry answers null, never an appended card.
    expect(bindSessionModel([SESSION], "no-such-card", SLOW)).toBeNull();
  });

  test("the bindings do not erase each other", () => {
    const chosen = bindSessionModel([SESSION], SESSION.on, SLOW)!;
    const bound = bindSessionProject(chosen, SESSION.on, "rain")!;
    expect(bound[0]).toEqual({
      ...SESSION,
      project: "rain",
      model: SLOW,
    });
    const declared = bindSessionBoundary(bound, SESSION.on, "read")!;
    expect(declared[0]).toEqual({
      ...SESSION,
      project: "rain",
      boundary: "read",
      model: SLOW,
    });
    // Unbinding the project keeps the model (it is about the tool, not the
    // folder) and withdraws the boundary.
    const unbound = bindSessionProject(declared, SESSION.on, null)!;
    expect(unbound[0]).toEqual({ ...SESSION, model: SLOW });
    // A value is stored VERBATIM: the writer never parses one.
    expect(serializeSessionLine({ ...SESSION, model: PRO })).toContain(PRO);
  });

  test("the refusal is one sentence and claims only the absence", () => {
    expect(SESSION_MODEL_REFUSAL).toBe(
      "the model this card records is not one the tool has named here, so the run was not started",
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. The machine learns: the tool's choices are a fact on the row.
 * ------------------------------------------------------------------ */

describe("a session's answer records what the tool offers, on this machine", () => {
  test("the fact is exactly {id, verified, seen, models}, field by field", async () => {
    const stored = fakeConfig({ turn: { untouched: true } });
    const facts = await patchToolRowModels("a-row", RECORDED, stored.io);
    expect(facts).toEqual([
      { id: "a-row", verified: false, seen: null, models: RECORDED },
    ]);
    expect(Object.keys(stored.config()).sort()).toEqual(
      [TOOL_ROWS_CONFIG_KEY, "turn"].sort(),
    );
    // Nothing but the tool's own fields can ride into the file.
    const smuggled = readToolRowFacts([
      {
        id: "a-row",
        verified: "true",
        seen: null,
        models: [{ ...RECORDED[0], command: "/not/kept", extra: 1 }],
        name: "a name",
      },
    ]);
    expect(smuggled).toEqual([
      {
        id: "a-row",
        verified: false,
        seen: null,
        models: [{ id: "model", name: "Fast", value: FAST }],
      },
    ]);
    expect(JSON.stringify(storedToolRowFacts(smuggled))).not.toContain(
      "/not/kept",
    );
  });

  test("recording choices keeps the tested mark and what a test saw", async () => {
    const seen = { date: "2026-11-19", line: "OK." };
    const stored = fakeConfig({
      toolRows: [{ id: "a-row", verified: true, seen }],
    });
    const facts = await patchToolRowModels("a-row", RECORDED, stored.io);
    expect(facts).toEqual([
      { id: "a-row", verified: true, seen, models: RECORDED },
    ]);
  });

  test("a tool that names none clears the list: the picker goes away", async () => {
    const stored = fakeConfig();
    await patchToolRowModels("a-row", RECORDED, stored.io);
    const facts = await patchToolRowModels("a-row", [], stored.io);
    expect(facts).toEqual([{ id: "a-row", verified: false, seen: null }]);
    expect(await loadToolRowFacts(stored.io)).toEqual([
      { id: "a-row", verified: false, seen: null },
    ]);
  });

  test("a run's answer is what the fact layer keeps, and silence writes nothing", async () => {
    const stored = fakeConfig();
    const options = [
      {
        id: "model",
        category: "model",
        type: "select",
        currentValue: FAST,
        options: [
          {
            group: "route-a",
            name: "Route A",
            options: [{ value: FAST, name: "Fast" }],
          },
        ],
      },
      {
        id: "reasoning_effort",
        category: "thought_level",
        type: "select",
        options: [{ value: "high", name: "High" }],
      },
    ];
    const facts = await recordSessionModels("a-row", options, stored.io);
    expect(facts).toEqual([
      {
        id: "a-row",
        verified: false,
        seen: null,
        models: [{ id: "model", name: "Fast", value: FAST }],
      },
    ]);
    const before = stored.writes();
    // An answer with no list claims nothing: an earlier fact stands untouched.
    expect(await recordSessionModels("a-row", undefined, stored.io)).toBeNull();
    expect(stored.writes()).toBe(before);
    expect(await loadToolRowFacts(stored.io)).toEqual(facts ?? []);
  });

  test("an entry with no id or unreadable choices is dropped, not guessed", () => {
    expect(readToolRowFacts([{ id: "", verified: true }])).toEqual([]);
    const facts = readToolRowFacts([
      {
        id: "a-row",
        verified: true,
        seen: null,
        models: [
          { id: "", name: "Fast", value: FAST },
          { id: "model", name: "", value: FAST },
          { id: "model", name: "Fast", value: "" },
          "not a choice",
          { id: "model", name: "Slow", value: SLOW },
        ],
      },
    ]);
    expect(facts[0]!.models).toEqual([
      { id: "model", name: "Slow", value: SLOW },
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The wire: the model pair, its strict reading, and the options.
 * ------------------------------------------------------------------ */

describe("the run wire carries the model only when one was chosen", () => {
  const tool = { command: "/bin/tool", args: [], timeoutMinutes: 1 };

  test("a chosen model round-trips, both strings kept verbatim", () => {
    const line = runRequestLine(7, 7, tool, {}, "go", {
      model: { optionId: "model", value: FAST },
    });
    expect(parseRequestLine(line)).toEqual({
      id: 7,
      kind: "run",
      run: 7,
      tool,
      env: {},
      prompt: "go",
      model: { optionId: "model", value: FAST },
    });
    // The value genuinely is opaque: the wire did not parse the JSON-looking
    // string, it carried the string.
    expect((JSON.parse(line) as { model: { value: string } }).model.value).toBe(
      FAST,
    );
  });

  test("an unchosen line is exactly the line it always was", () => {
    const line = runRequestLine(7, 7, tool, {}, "go");
    expect(line).toBe(
      '{"id":7,"kind":"run","run":7,"tool":{"command":"/bin/tool","args":[],"timeoutMinutes":1},"env":{},"prompt":"go"}',
    );
    expect("model" in JSON.parse(line)).toBe(false);
  });

  test("a model choice out of shape is refused, never repaired", () => {
    const good = {
      id: 9,
      kind: "run",
      run: 9,
      tool,
      env: {},
      prompt: "go",
      model: { optionId: "model", value: SLOW },
    };
    expect(parseRequestLine(JSON.stringify(good))).not.toBeNull();
    for (const bad of [
      { ...good, model: { optionId: "", value: SLOW } },
      { ...good, model: { optionId: "model", value: "" } },
      { ...good, model: { optionId: "model" } },
      { ...good, model: { value: SLOW } },
      { ...good, model: "model" },
      { ...good, model: null },
    ]) {
      expect(parseRequestLine(JSON.stringify(bad))).toBeNull();
    }
  });

  test("an ending carries the session step's options when it has them", () => {
    const withOptions = runEndLine(7, 7, "completed", null, []);
    expect(parseSidecarLine(withOptions)).toEqual({
      id: 7,
      kind: "run-end",
      run: 7,
      ending: "completed",
      sentence: null,
      configOptions: [],
    });
    // Absent keeps the old bytes to the byte.
    const plain = runEndLine(7, 7, "completed", null);
    expect(plain).toBe(
      '{"id":7,"kind":"run-end","run":7,"ending":"completed","sentence":null}',
    );
    expect(parseSidecarLine(plain)).toEqual({
      id: 7,
      kind: "run-end",
      run: 7,
      ending: "completed",
      sentence: null,
    });
    expect(
      parseSidecarLine(
        JSON.stringify({
          id: 1,
          kind: "run-end",
          run: 1,
          ending: "completed",
          sentence: null,
          configOptions: "no",
        }),
      ),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * 5. The dictate, against the real sidecar and the fake child.
 * ------------------------------------------------------------------ */

async function lane(): Promise<SidecarPipe> {
  const pipe = openSidecar();
  PIPES.push(pipe);
  const hello = await pipe.hello();
  expect(hello.kind).toBe("hello");
  return pipe;
}

interface RunReport {
  entries: Extract<SidecarLine, { kind: "run-part" }>[];
  end: Extract<SidecarLine, { kind: "run-end" }>;
}

async function runOnce(
  pipe: SidecarPipe,
  request: RunRequest,
  budgetMs = 20_000,
): Promise<RunReport> {
  const entries: RunReport["entries"] = [];
  const end = await new Promise<RunReport["end"]>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("the run never ended")),
      budgetMs,
    );
    pipe.transport.subscribe(request.run, (line) => {
      if (line.kind === "run-part" && line.run === request.run) {
        entries.push(line);
        return;
      }
      if (line.kind === "run-end" && line.run === request.run) {
        clearTimeout(timer);
        resolve(line);
      }
    });
    // The subscription is in place BEFORE the request leaves, so a fast entry
    // cannot outrun this test.
    void pipe.transport.send(JSON.stringify(request)).catch((error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return { entries, end };
}

function requestOf(
  id: number,
  mode: string,
  reportPath: string,
  prompt: string,
  extra: {
    cwd?: string;
    resume?: { sessionId: string; cwd: string };
    model?: { optionId: string; value: string };
  } = {},
): RunRequest {
  return {
    id,
    kind: "run",
    run: id,
    tool: {
      command: BUN,
      args: [FAKE_SERVER, mode, "--report", reportPath],
      timeoutMinutes: 1,
    },
    env: {},
    prompt,
    ...extra,
  };
}

function sessionOf(report: RunReport) {
  for (const part of report.entries) {
    if (part.entry.kind === "session") return part.entry;
  }
  return null;
}

function textOf(report: RunReport): string {
  let text = "";
  for (const part of report.entries) {
    if (
      part.entry.kind === "update" &&
      part.entry.updateKind === "agent_message_chunk"
    ) {
      text += part.entry.text;
    }
  }
  return text;
}

/** The request methods the fake child heard, in arrival order. */
function callsOf(reportPath: string): { method: string; params: unknown }[] {
  try {
    return JSON.parse(readFileSync(reportPath + ".calls", "utf8")) as {
      method: string;
      params: unknown;
    }[];
  } catch {
    return [];
  }
}

describe("the run asks for the chosen model between the session and the prompt", () => {
  test("a first run records what the tool named, and asks for nothing", async () => {
    const pipe = await lane();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const first = requestOf(51, "models", reportPath, "say one sentence", {
      cwd: folder(),
    });
    const report = await runOnce(pipe, first);
    expect(report.end.ending).toBe("completed");
    // The session step's answer reached the wire with its options, verbatim.
    const options = report.end.configOptions;
    expect(Array.isArray(options)).toBe(true);
    const read = readAcpModelChoices(options);
    expect(read).toEqual({ read: "named", models: RECORDED });

    // The fact layer keeps exactly that, as a fact about this machine.
    const stored = fakeConfig();
    const facts = await recordSessionModels("a-row", options, stored.io);
    expect(facts?.[0]?.models).toEqual(RECORDED);
    expect(facts?.[0]?.verified).toBe(false);
    // NO model was chosen, so no selection call was spoken at all.
    const methods = callsOf(reportPath).map((call) => call.method);
    expect(methods).toEqual(["initialize", "session/new", "session/prompt"]);
  }, 30_000);

  test("a second run sets the exact value bytes BEFORE the prompt", async () => {
    const pipe = await lane();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const runFolder = folder();
    const first = await runOnce(
      pipe,
      requestOf(61, "models", reportPath, "run one", { cwd: runFolder }),
    );
    expect(first.end.ending).toBe("completed");
    const runPair = acpRunModelOf(RECORDED, SLOW);
    if (runPair === null) throw new Error("unreachable");
    const second = await runOnce(
      pipe,
      requestOf(62, "models", reportPath, "run two", {
        cwd: runFolder,
        model: runPair,
      }),
    );
    expect(second.end.ending).toBe("completed");

    const calls = callsOf(reportPath);
    const setAt = calls.findIndex(
      (call) => call.method === "session/set_config_option",
    );
    const promptAt = calls.findIndex((call) => call.method === "session/prompt");
    expect(setAt).toBeGreaterThan(-1);
    expect(promptAt).toBeGreaterThan(-1);
    // THE ORDER THE STORY NAMES: after the session step, before the prompt.
    expect(setAt).toBeGreaterThan(
      calls.findIndex((call) => call.method === "session/new"),
    );
    expect(setAt).toBeLessThan(promptAt);
    // THE EXACT BYTES the tool wrote, not a re-encoding of them.
    const params = calls[setAt]!.params as {
      sessionId?: string;
      configId?: string;
      value?: string;
    };
    expect(params.configId).toBe("model");
    expect(params.value).toBe(SLOW);
    expect(params.value).toBe('["route-a","slow"]');
    // The turn still ran.
    expect(textOf(second)).toContain("run two");
  }, 40_000);

  test("a continuation sets it too, in the folder it was recorded in", async () => {
    const pipe = await lane();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const runFolder = folder();
    const first = await runOnce(
      pipe,
      requestOf(71, "models", reportPath, "remember this", {
        cwd: runFolder,
      }),
    );
    const session = sessionOf(first);
    if (
      session === null ||
      session.kind !== "session" ||
      session.cwd === undefined
    ) {
      throw new Error("the first run recorded no pair");
    }
    const runPair = acpRunModelOf(RECORDED, PRO);
    if (runPair === null) throw new Error("unreachable");
    const second = await runOnce(
      pipe,
      requestOf(72, "models", reportPath, "and this", {
        cwd: runFolder,
        resume: { sessionId: session.sessionId, cwd: session.cwd },
        model: runPair,
      }),
    );
    expect(second.end.ending).toBe("completed");
    const resumed = sessionOf(second);
    if (resumed === null || resumed.kind !== "session") {
      throw new Error("the continuation recorded no session");
    }
    expect(resumed.sessionId).toBe(session.sessionId);
    // EACH RUN SPAWNS ITS OWN CHILD, so the log this run left is its own: the
    // resume, then the set, then the prompt — in that order.
    const calls = callsOf(reportPath);
    expect(calls.map((call) => call.method)).toEqual([
      "initialize",
      "session/resume",
      "session/set_config_option",
      "session/prompt",
    ]);
    expect((calls[2]!.params as { value?: string }).value).toBe(PRO);
    // The resumed turn remembered the earlier one, so it really continued.
    expect(textOf(second)).toContain("remembers 2 prompt(s)");
  }, 40_000);

  test("a refused set is the run's ending: the tool's sentence, no prompt", async () => {
    const pipe = await lane();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const runPair = acpRunModelOf(RECORDED, FAST);
    if (runPair === null) throw new Error("unreachable");
    const report = await runOnce(
      pipe,
      requestOf(81, "models-fail", reportPath, "say one sentence", {
        cwd: folder(),
        model: runPair,
      }),
    );
    expect(report.end.ending).toBe("failed");
    expect(report.end.sentence).toContain("the tool has no such model here");
    // Nothing pretends the model changed, so nothing was asked afterwards.
    const methods = callsOf(reportPath).map((call) => call.method);
    expect(methods).toContain("session/set_config_option");
    expect(methods).not.toContain("session/prompt");
    expect(textOf(report)).toBe("");
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * 6. The seam: a run's ending carries the options to the fact layer, and
 *    the test probe reports them the same way.
 * ------------------------------------------------------------------ */

interface Scripted {
  transport: TurnTransport;
  sent: string[];
}

function scriptedRun(
  lines: (id: number, run: number) => string[],
): Scripted {
  const sent: string[] = [];
  const handlers = new Map<number, (line: SidecarLine) => void>();
  const transport: TurnTransport = {
    async send(line) {
      sent.push(line);
      const parsed = JSON.parse(line) as {
        id: number;
        run: number;
        kind: string;
      };
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

const RUNNING: SidecarStart = {
  kind: "running",
  status: { running: true, entry: "", entryKind: "dev-entry", bun: "" },
};

/** The fake child's session answer, as the fixture's modes write it. */
const ANSWERED_OPTIONS = [
  {
    id: "model",
    name: "Model",
    category: "model",
    type: "select",
    currentValue: FAST,
    options: [
      { group: "route-a", name: "Route A", options: [{ value: FAST, name: "Fast" }] },
      { group: "route-b", name: "Route B", options: [{ value: SLOW, name: "Slow" }] },
    ],
  },
];

const MODEL_ROW: AcpSpec = {
  kind: "acp",
  id: "a-row",
  name: "A row",
  verified: false,
  command: BUN,
  args: [FAKE_SERVER, "models"],
  cwdPolicy: "session",
  env: [],
  timeoutMinutes: 1,
  notes: "a row for the test",
};

/** A transcript that keeps nothing on a disk: this story writes no transcript. */
const MEMORY_IO: SessionIo = {
  async readTextFile() {
    return null;
  },
  async writeTextFile() {},
  async createDirAll() {},
};

describe("a run's options reach the record path from its own ending", () => {
  test("the transcript seam carries them out of the run", async () => {
    const { transport } = scriptedRun((id, run) => [
      runPartLine(id, run, {
        kind: "session",
        sessionId: "a-session",
        cwd: "/tmp/a-session",
      }),
      runEndLine(id, run, "completed", null, ANSWERED_OPTIONS),
    ]);
    const started = beginSessionRun(
      mkdtempSync(join(ROOT, "ws-run-")),
      MODEL_ROW,
      "a-card",
      { task: "say one sentence", transport, start: async () => RUNNING, transcriptIo: MEMORY_IO },
    );
    const done = await started.done;
    expect(done.ending).toBe("completed");
    // The answer crossed the seam WHOLE; the caller decides what it means.
    expect(done.configOptions).toEqual(ANSWERED_OPTIONS);
    const stored = fakeConfig();
    const facts = await recordSessionModels("a-row", done.configOptions, stored.io);
    expect(facts?.[0]?.models).toEqual([
      { id: "model", name: "Fast", value: FAST },
      { id: "model", name: "Slow", value: SLOW },
    ]);
  });

  test("an ending with no list claims nothing at the seam", async () => {
    const { transport } = scriptedRun((id, run) => [
      runEndLine(id, run, "completed", null),
    ]);
    const started = beginSessionRun(
      mkdtempSync(join(ROOT, "ws-run-")),
      MODEL_ROW,
      "a-card",
      { task: "say one sentence", transport, start: async () => RUNNING, transcriptIo: MEMORY_IO },
    );
    const done = await started.done;
    expect("configOptions" in done).toBe(false);
  });

  test("the test probe reports the same choices, and no model is asked for", async () => {
    const { transport, sent } = scriptedRun((id, run) => [
      runPartLine(id, run, {
        kind: "update",
        updateKind: "agent_message_chunk",
        text: "OK.",
        update: {},
      }),
      runEndLine(id, run, "completed", null, ANSWERED_OPTIONS),
    ]);
    const outcome = await runRowTest(MODEL_ROW, {
      transport,
      start: async () => RUNNING,
    });
    expect(outcome.kind).toBe("tested");
    expect(outcome.models).toEqual([
      { id: "model", name: "Fast", value: FAST },
      { id: "model", name: "Slow", value: SLOW },
    ]);
    // A probe is a probe: it never asks for the card's chosen model.
    const request = JSON.parse(sent[0] ?? "{}") as { model?: unknown };
    expect(request.model).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * 7. The face: the picker, the quiet line, and the declaration.
 * ------------------------------------------------------------------ */

function cardHtml(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(SessionCard, {
      session: SESSION,
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

describe("the card offers the tool's own names, or says where its model lives", () => {
  const choose = async () => ({ ok: true as const });

  test("the picker is the tool's choices by name, and the default first", () => {
    const html = cardHtml({ models: RECORDED, onChooseModel: choose });
    // The markup escapes the apostrophe in the tool's default line, so the
    // assertion is on the words a reader sees rather than on raw bytes.
    expect(SESSION_MODEL_DEFAULT).toContain("own default");
    expect(html.replaceAll("&#x27;", "'")).toContain(SESSION_MODEL_DEFAULT);
    for (const choice of RECORDED) expect(html).toContain(choice.name);
    // THE VALUE IS NEVER RENDERED: not as an option's value, not as text.
    expect(html).not.toContain(FAST);
    expect(html).not.toContain(SLOW);
    expect(html).not.toContain("route-a");
    expect(html).not.toContain("route-b");
    // The select's own values are positions, so no opaque value rides markup.
    expect(html).not.toContain('value="[');
  });

  test("no model option here is ONE quiet line and no picker", () => {
    const html = cardHtml({ models: null, onChooseModel: choose }).replaceAll(
      "&#x27;",
      "'",
    );
    expect(html).toContain(SESSION_MODEL_OWN_SETTING);
    expect(html).not.toContain(SESSION_MODEL_DEFAULT);
    expect(html).not.toContain("session-card-pick");
  });

  test("the face is the expanded one: nothing of it on a closed card", () => {
    const html = cardHtml({
      open: false,
      models: RECORDED,
      onChooseModel: choose,
    });
    expect(html).not.toContain(SESSION_MODEL_DEFAULT);
    expect(html).not.toContain(SESSION_MODEL_OWN_SETTING);
    expect(html).not.toContain("Fast");
    expect(html).not.toContain("Slow");
  });

  test("a card whose row is gone shows neither the picker nor the line", () => {
    const html = cardHtml({
      toolName: null,
      models: RECORDED,
      onChooseModel: choose,
    });
    expect(html).not.toContain(SESSION_MODEL_DEFAULT);
    expect(html).not.toContain(SESSION_MODEL_OWN_SETTING);
  });

  test("the declaration names the choice before the run", () => {
    expect(acpModelDeclaration("Slow")).toBe("the tool answers on: Slow");
    const base =
      "this run will receive no key: no environment entry names a provider row";
    expect(acpDeclarationWithModel(base, null)).toBe(base);
    const withModel = acpDeclarationWithModel(base, "Slow");
    expect(withModel).toBe(base + ". the tool answers on: Slow");
    const html = cardHtml({ declaration: withModel });
    expect(html).toContain("the tool answers on: Slow");
    // The value bytes are not the declaration: names only.
    expect(html).not.toContain(SLOW);
  });

  test("the row's data supplies the sentence's name, never this module", () => {
    const row: AcpSpec = {
      kind: "acp",
      id: "a-row",
      name: "A row",
      verified: false,
      command: BUN,
      args: [FAKE_SERVER, "models"],
      cwdPolicy: "session",
      env: [],
      timeoutMinutes: 1,
      notes: "a row for the test",
    };
    expect(acpDeclaration(row)).toContain("no key");
    // A recorded value the tool no longer names has no display name, so the
    // declaration claims no model rather than a wrong one.
    expect(acpModelNameOf(RECORDED, "gone")).toBeNull();
    expect(acpDeclarationWithModel(acpDeclaration(row), null)).toBe(
      acpDeclaration(row),
    );
  });
});

/* ------------------------------------------------------------------ *
 * 8. The naming rule: this story knows no product.
 * ------------------------------------------------------------------ */

describe("the model story knows no product's name", () => {
  const SPECIAL = "^$.*+?()[]{}|\\";

  function mentions(text: string, token: string): boolean {
    let escaped = "";
    for (const character of token) {
      escaped += SPECIAL.includes(character) ? "\\" + character : character;
    }
    return new RegExp(
      "(^|[^A-Za-z0-9_])" + escaped + "($|[^A-Za-z0-9_])",
      "i",
    ).test(text);
  }

  test("the new and touched modules name a row only through data", () => {
    // acpSpecs.ts IS the shipped rows (data), so it is not swept here.
    const modules = [
      "src/turn/acpModels.ts",
      "src/turn/acpRowStore.ts",
      "src/turn/acpRowTest.ts",
      "src/turn/acpRun.ts",
      "src/turn/acpSession.ts",
      "src/turn/protocol.ts",
      "src/map/sessions.ts",
      "src/canvas/SessionCard.tsx",
      "src/canvas/GroundLayer.tsx",
      "src/canvas/useGround.ts",
      "src/App.tsx",
      "sidecar/runs.ts",
      "tests/session-models.test.ts",
    ];
    const tokens = new Set<string>();
    for (const spec of ACP_SPECS) {
      tokens.add(spec.id);
      tokens.add(spec.name);
      tokens.add(spec.command);
      const base = spec.command.split(/[\\/]/).pop() ?? "";
      tokens.add(base);
      tokens.add(base.replace(/\.(cmd|exe|bat|sh)$/i, ""));
    }
    const app = join(import.meta.dir, "..");
    const hits: string[] = [];
    for (const rel of modules) {
      const text = readFileSync(join(app, rel), "utf8");
      for (const token of [...tokens].filter(
        (entry) => entry.trim().length >= 3,
      )) {
        if (mentions(text, token)) hits.push(rel + " -> " + token);
      }
    }
    expect(hits).toEqual([]);
  });
});
