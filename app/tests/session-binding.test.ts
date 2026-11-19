import { afterAll, describe, expect, test } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  parseSessionLine,
  parseSessions,
  serializeSessionLine,
  serializeSessions,
  bindSessionProject,
  bindSessionBoundary,
  sessionBindingLine,
  SESSION_BOUNDARY_LABELS,
  SESSION_BOUNDARY_UNDECLARED_SENTENCE,
  type SessionCard as SessionCardRecord,
} from "../src/map/sessions";
import { permissionInScope, type RunScope } from "../src/turn/acpEntries";
import { acpScopeDeclaration } from "../src/turn/acpSpecs";
import {
  SESSION_PROJECT_REFUSAL,
  sessionBoundScope,
} from "../src/canvas/useGround";
import { renderMirror, type MirrorView } from "../src/map/mirror";
import type { Reading } from "../src/map/readings";
import type { GroundReference } from "../src/map/ground";
import { SessionCard } from "../src/canvas/SessionCard";
import {
  BUN,
  FAKE_SERVER,
  openSidecar,
  type SidecarPipe,
} from "./fixtures/sidecar-pipe";
import {
  parseRequestLine,
  runRequestLine,
  type SidecarLine,
} from "../src/turn/protocol";

/**
 * STORY 19.2 — A SESSION CARD RUNS INSIDE ITS BOUND PROJECT FOLDER, AND THE
 * DELEGATION IS THE CONSENT.
 *
 * WHAT IS PINNED, in the story's own words:
 *
 *   1. THE RECORD gains two OPTIONAL tail fields — `project` and `boundary` —
 *      and an old line, an unbound line and a declared line are told apart; the
 *      writer emits them only when the record carries them.
 *   2. THE WIRE carries `cwd` and `scope` ONLY when the person bound a project
 *      and declared a boundary; a malformed one is refused, never repaired.
 *   3. THE MATCHER is strict and never widens: a declared "write" covers an ask
 *      whose tool call names its kind, a declared "read" covers only "read", and
 *      nothing defaults to allow.
 *   4. THE LANE auto-answers an IN-SCOPE ask with allow-once and sends NO
 *      run-permission line, while an OUT-OF-SCOPE ask (and every ask on an
 *      unbound run) reaches the person exactly as before. A bound run's folder
 *      is checked before any spawn.
 *   5. THE RUN starts in the folder (the `started` entry says the real cwd) and
 *      its declaration says the blast radius aloud; the card's face names the
 *      project CARD, never the path, and the mirror does the same.
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-session-binding-"));

const PIPES: SidecarPipe[] = [];

afterAll(() => {
  for (const pipe of PIPES) pipe.stop();
  rmSync(ROOT, { recursive: true, force: true });
});

/** One fresh workspace folder (a map folder, nothing more). */
function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

/** One real folder the run may be bound to. */
function projectFolder(): string {
  const made = mkdtempSync(join(ROOT, "project-"));
  return made;
}

const SESSION: SessionCardRecord = {
  on: "rain-gauge-session",
  name: "Rain gauge session",
  x: 650,
  y: 20,
  tool: "dsh-acp",
};

const RAIN: GroundReference = {
  on: "rain-gauge",
  name: "Rain gauge",
  x: 10,
  y: 20,
};

const FOLDER_READING: Reading = {
  on: "rain-gauge",
  form: "folder",
  from: "/home/ada/code/rain",
  taken: "2026-11-19T00:00:00.000Z",
};

/* ------------------------------------------------------------------ *
 * 1. The record: two optional tail fields, and old lines unchanged.
 * ------------------------------------------------------------------ */

describe("the session record's binding fields", () => {
  test("an unbound line is exactly the line it always was", () => {
    const line = serializeSessionLine(SESSION);
    expect(line).toBe(
      "on: rain-gauge-session | name: Rain gauge session | x: 650 | y: 20 | tool: dsh-acp",
    );
    expect(parseSessionLine(line)).toEqual(SESSION);
    expect(line).not.toContain("project:");
    expect(line).not.toContain("boundary:");
  });

  test("a bound line round-trips, and the fields are written only when present", () => {
    const bound: SessionCardRecord = { ...SESSION, project: "rain-gauge" };
    expect(serializeSessionLine(bound)).toBe(
      "on: rain-gauge-session | name: Rain gauge session | x: 650 | y: 20 | tool: dsh-acp | project: rain-gauge",
    );
    expect(parseSessionLine(serializeSessionLine(bound))).toEqual(bound);
    expect(serializeSessionLine(bound)).not.toContain("boundary:");

    const declared: SessionCardRecord = {
      ...SESSION,
      project: "rain-gauge",
      boundary: "write",
    };
    const declaredLine = serializeSessionLine(declared);
    expect(declaredLine).toBe(
      "on: rain-gauge-session | name: Rain gauge session | x: 650 | y: 20 | tool: dsh-acp | project: rain-gauge | boundary: write",
    );
    expect(parseSessionLine(declaredLine)).toEqual(declared);

    const readOnly: SessionCardRecord = {
      ...SESSION,
      project: "rain-gauge",
      boundary: "read",
    };
    expect(parseSessionLine(serializeSessionLine(readOnly))).toEqual(readOnly);
  });

  test("a malformed binding line is kept, never guessed into a card", () => {
    const good = serializeSessionLine({
      ...SESSION,
      project: "rain-gauge",
      boundary: "read",
    });
    const bad = [
      // A boundary the vocabulary does not have.
      good.replace("boundary: read", "boundary: always"),
      // A boundary with no project before it.
      serializeSessionLine(SESSION) + " | boundary: write",
      // An empty project slug.
      serializeSessionLine(SESSION) + " | project: ",
    ];
    const text = [good, ...bad].join("\n");
    const parsed = parseSessions(text);
    expect(parsed.sessions).toHaveLength(1);
    expect(parsed.malformed).toHaveLength(bad.length);
    // The writer hands the kept lines straight back: nothing is repaired.
    expect(serializeSessions(parsed.sessions, parsed.malformed)).toBe(
      text + "\n",
    );
  });

  test("binding one field leaves the others alone, and an absent card is null", () => {
    const sessions = [SESSION];
    expect(bindSessionProject(sessions, SESSION.on, "rain-gauge")).toEqual([
      { ...SESSION, project: "rain-gauge" },
    ]);
    expect(
      bindSessionBoundary(
        sessions.map((session) => ({ ...session, project: "rain-gauge" })),
        SESSION.on,
        "read",
      ),
    ).toEqual([{ ...SESSION, project: "rain-gauge", boundary: "read" }]);
    // Withdrawing a field REMOVES it, so the line goes back to its old bytes.
    const declared: SessionCardRecord = {
      ...SESSION,
      project: "rain-gauge",
      boundary: "write",
    };
    // Unbinding withdraws the declaration with the folder: a boundary has
    // nothing to be about without its binding, and the line shape agrees.
    expect(bindSessionProject([declared], SESSION.on, null)).toEqual([SESSION]);
    expect(bindSessionBoundary([declared], SESSION.on, null)).toEqual([
      { ...SESSION, project: "rain-gauge" },
    ]);
    expect(bindSessionProject([SESSION], "no-such-card", "x")).toBeNull();
    expect(bindSessionBoundary([SESSION], "no-such-card", null)).toBeNull();
  });

  test("a declaration with no binding is refused, and never written out of shape", () => {
    // A boundary alone would serialize a line the parser refuses on reload, so
    // the writer refuses it rather than writing a card that vanishes.
    expect(bindSessionBoundary([SESSION], SESSION.on, "write")).toBeNull();
    expect(parseSessionLine(serializeSessionLine(SESSION))).toEqual(SESSION);
  });

  test("the card says the bound project's name, and undeclared is not a no-op word", () => {
    expect(sessionBindingLine("Rain gauge")).toBe("bound to Rain gauge");
    expect(SESSION_BOUNDARY_UNDECLARED_SENTENCE).toBe("every ask will reach you");
    expect(SESSION_BOUNDARY_LABELS).toEqual({
      undeclared: "undeclared",
      read: "only reads",
      write: "may change files there",
    });
  });
});

/* ------------------------------------------------------------------ *
 * 2. The matcher: strict, and never a default allow.
 * ------------------------------------------------------------------ */

describe("permissionInScope", () => {
  const readAsk = { toolCall: { title: "Read", kind: "read" } };
  const editAsk = { toolCall: { title: "Edit", kind: "edit" } };
  const noKind = { toolCall: { title: "Something" } };
  const empty = { toolCall: {} };

  test("a declared write covers any ask whose tool call names its kind", () => {
    const write: RunScope = { boundary: "write" };
    expect(permissionInScope(write, readAsk)).toBe(true);
    expect(permissionInScope(write, editAsk)).toBe(true);
    // A missing or non-string kind is NOT covered: the declaration did not
    // describe an unnamed call.
    expect(permissionInScope(write, noKind)).toBe(false);
    expect(permissionInScope(write, empty)).toBe(false);
    expect(permissionInScope(write, { toolCall: null })).toBe(false);
  });

  test("a declared read covers only a read", () => {
    const read: RunScope = { boundary: "read" };
    expect(permissionInScope(read, readAsk)).toBe(true);
    expect(permissionInScope(read, editAsk)).toBe(false);
    expect(permissionInScope(read, noKind)).toBe(false);
  });

  test("no scope is never in scope, and nothing defaults to allow", () => {
    expect(permissionInScope(undefined, readAsk)).toBe(false);
    expect(permissionInScope(null, readAsk)).toBe(false);
    // A boundary outside the vocabulary cannot widen anything either.
    expect(
      permissionInScope(
        { boundary: "everything" } as unknown as RunScope,
        editAsk,
      ),
    ).toBe(false);
  });
});


/* ------------------------------------------------------------------ *
 * 2b. The wire: cwd and scope ride only together, and only when bound.
 * ------------------------------------------------------------------ */

describe("the run wire's optional binding fields", () => {
  const tool = { command: "/bin/tool", args: [], timeoutMinutes: 1 };

  test("an unbound request's line carries neither field", () => {
    const line = runRequestLine(7, 7, tool, {}, "go");
    const value = JSON.parse(line) as Record<string, unknown>;
    expect("cwd" in value).toBe(false);
    expect("scope" in value).toBe(false);
    expect(parseRequestLine(line)).toEqual({
      id: 7,
      kind: "run",
      run: 7,
      tool,
      env: {},
      prompt: "go",
    });
  });

  test("a bound request's line round-trips the folder and the boundary", () => {
    const line = runRequestLine(8, 8, tool, {}, "go", {
      cwd: "/home/ada/code/rain",
      scope: { boundary: "write" },
    });
    expect(parseRequestLine(line)).toEqual({
      id: 8,
      kind: "run",
      run: 8,
      tool,
      env: {},
      prompt: "go",
      cwd: "/home/ada/code/rain",
      scope: { boundary: "write" },
    });
  });

  test("a malformed binding is refused, never repaired", () => {
    const good = {
      id: 9,
      kind: "run",
      run: 9,
      tool,
      env: {},
      prompt: "go",
      cwd: "/home/ada/code/rain",
      scope: { boundary: "write" },
    };
    expect(parseRequestLine(JSON.stringify(good))).not.toBeNull();
    const bad = [
      { ...good, cwd: "rain" },
      { ...good, cwd: "" },
      { ...good, cwd: 4 },
      { ...good, scope: { boundary: "always" } },
      { ...good, scope: { boundary: 1 } },
      { ...good, scope: "write" },
      // A declaration with no folder to be about.
      { ...good, cwd: undefined },
    ];
    for (const line of bad) {
      expect(parseRequestLine(JSON.stringify(line))).toBeNull();
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3. The declaration: the folder's full path, said aloud.
 * ------------------------------------------------------------------ */

describe("acpScopeDeclaration", () => {
  const FOLDER = "/home/ada/code/rain";

  test("write names the folder and what it may do there", () => {
    expect(acpScopeDeclaration(FOLDER, "write")).toBe(
      "this run works in /home/ada/code/rain and may change files there",
    );
  });

  test("read names the same folder and no change", () => {
    expect(acpScopeDeclaration(FOLDER, "read")).toBe(
      "this run works in /home/ada/code/rain and only reads",
    );
  });

  test("the full path appears, and the sentence is the house voice", () => {
    for (const boundary of ["read", "write"] as const) {
      const line = acpScopeDeclaration(FOLDER, boundary);
      expect(line).toContain(FOLDER);
      expect(line).not.toContain("!");
      // lower-case, plain, no exclamation: the first word is the subject.
      expect(line.startsWith("this run works in ")).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ *
 * 4. Where a run starts: unbound, bound and refused.
 * ------------------------------------------------------------------ */

describe("sessionBoundScope", () => {
  test("an unbound card runs exactly as today", () => {
    expect(sessionBoundScope(SESSION, [FOLDER_READING])).toEqual({
      kind: "unbound",
    });
  });

  test("a binding with NO declared boundary is still exactly today", () => {
    // The binding alone is a pointer, not a consent: no cwd, no scope, and no
    // refusal even when the reading is gone.
    expect(
      sessionBoundScope({ ...SESSION, project: "rain-gauge" }, []),
    ).toEqual({ kind: "unbound" });
    expect(
      sessionBoundScope(
        { ...SESSION, project: "rain-gauge" },
        [FOLDER_READING],
      ),
    ).toEqual({ kind: "unbound" });
  });

  test("a declared binding resolves the folder from the loaded readings", () => {
    expect(
      sessionBoundScope(
        { ...SESSION, project: "rain-gauge", boundary: "write" },
        [FOLDER_READING],
      ),
    ).toEqual({
      kind: "bound",
      cwd: "/home/ada/code/rain",
      scope: { boundary: "write" },
    });
  });

  test("a declared binding that does not resolve refuses with one sentence", () => {
    const declared: SessionCardRecord = {
      ...SESSION,
      project: "rain-gauge",
      boundary: "read",
    };
    expect(sessionBoundScope(declared, [])).toEqual({
      kind: "refused",
      sentence: SESSION_PROJECT_REFUSAL,
    });
    // A reading on the same slug that is NOT a folder is refused too: the
    // binding names a folder card, and nothing else stands in for it.
    expect(
      sessionBoundScope(declared, [
        { ...FOLDER_READING, form: "path", from: "rain.txt" },
      ]),
    ).toEqual({ kind: "refused", sentence: SESSION_PROJECT_REFUSAL });
    expect(SESSION_PROJECT_REFUSAL).toContain("not a folder card");
  });
});

/* ------------------------------------------------------------------ *
 * 5. The lane, through the real sidecar and the fake ACP server.
 * ------------------------------------------------------------------ */

function toolOf(mode: string, reportPath: string) {
  return {
    command: BUN,
    args: [FAKE_SERVER, mode, "--report", reportPath],
    timeoutMinutes: 1,
  };
}

interface LaneRun {
  permissions: Array<Extract<SidecarLine, { kind: "run-permission" }>>;
  parts: Array<Extract<SidecarLine, { kind: "run-part" }>>;
  ended: Promise<Extract<SidecarLine, { kind: "run-end" }>>;
}

/** Subscribe to ONE run before its request leaves: asks, parts and the end. */
function watch(pipe: SidecarPipe, run: number): LaneRun {
  const permissions: LaneRun["permissions"] = [];
  const parts: LaneRun["parts"] = [];
  const ended = new Promise<Extract<SidecarLine, { kind: "run-end" }>>(
    (resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("the run never ended")),
        15_000,
      );
      pipe.transport.subscribe(run, (line) => {
        if (line.kind === "run-permission" && line.run === run) {
          permissions.push(line);
          return;
        }
        if (line.kind === "run-part" && line.run === run) {
          parts.push(line);
          return;
        }
        if (line.kind === "run-end" && line.run === run) {
          clearTimeout(timer);
          resolve(line);
        }
      });
    },
  );
  return { permissions, parts, ended };
}

async function sidecar(): Promise<SidecarPipe> {
  const pipe = openSidecar();
  PIPES.push(pipe);
  const hello = await pipe.hello();
  expect(hello.kind).toBe("hello");
  return pipe;
}

function startedEntry(parts: LaneRun["parts"]): Extract<
  Extract<SidecarLine, { kind: "run-part" }>["entry"],
  { kind: "started" }
> {
  const first = parts[0];
  if (first === undefined || first.entry.kind !== "started") {
    throw new Error("the run said no started entry");
  }
  return first.entry;
}

function permissionEntry(parts: LaneRun["parts"]) {
  return parts
    .map((line) => line.entry)
    .find((entry) => entry.kind === "permission");
}

describe("a bound run answers inside its declaration and nowhere else", () => {
  test("a write declaration auto-answers allow-once, with no run-permission line down", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const folder = projectFolder();
    const reportPath = join(base, "report.json");
    const request = {
      id: 41,
      kind: "run" as const,
      run: 41,
      tool: toolOf("normal", reportPath),
      env: {},
      prompt: "say one sentence",
      cwd: folder,
      scope: { boundary: "write" as const },
    };
    const run = watch(pipe, request.run);
    await pipe.transport.send(JSON.stringify(request));
    const end = await run.ended;

    expect(end.kind === "run-end" ? end.ending : null).toBe("completed");
    // NO ask reached the person: the declaration covered it.
    expect(run.permissions).toHaveLength(0);
    // The transcript still shows the ask and its allowed-once reply.
    expect(permissionEntry(run.parts)).toMatchObject({
      kind: "permission",
      reply: { outcome: "selected", optionId: "allow-once" },
    });
    // The run started in the person's folder, not a fresh temp directory.
    const started = startedEntry(run.parts);
    expect(started.cwd).toBe(folder);
    // And the declaration said the blast radius aloud.
    expect(started.declaration).toContain(
      acpScopeDeclaration(folder, "write"),
    );
  });

  test("a read declaration auto-answers a read, and the started cwd is the folder", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const folder = projectFolder();
    const reportPath = join(base, "report.json");
    const request = {
      id: 42,
      kind: "run" as const,
      run: 42,
      tool: toolOf("normal", reportPath),
      env: {},
      prompt: "say one sentence",
      cwd: folder,
      scope: { boundary: "read" as const },
    };
    const run = watch(pipe, request.run);
    await pipe.transport.send(JSON.stringify(request));
    const end = await run.ended;

    expect(end.kind === "run-end" ? end.ending : null).toBe("completed");
    expect(run.permissions).toHaveLength(0);
    expect(permissionEntry(run.parts)).toMatchObject({
      kind: "permission",
      reply: { outcome: "selected", optionId: "allow-once" },
    });
    expect(startedEntry(run.parts).cwd).toBe(folder);
    expect(startedEntry(run.parts).declaration).toContain(
      acpScopeDeclaration(folder, "read"),
    );
  });

  test("a read declaration does NOT cover a change: the ask reaches the person", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const folder = projectFolder();
    const reportPath = join(base, "report.json");
    const request = {
      id: 43,
      kind: "run" as const,
      run: 43,
      tool: toolOf("edit-ask", reportPath),
      env: {},
      prompt: "say one sentence",
      cwd: folder,
      scope: { boundary: "read" as const },
    };
    const run = watch(pipe, request.run);
    await pipe.transport.send(JSON.stringify(request));

    for (let at = 0; at < 500 && run.permissions.length === 0; at += 1) {
      await Bun.sleep(10);
    }
    expect(run.permissions).toHaveLength(1);
    const permission = run.permissions[0]!;
    expect(permission.toolCall).toMatchObject({ kind: "edit" });

    // The person's own verb still answers it, and the run goes on.
    await pipe.transport.send(
      JSON.stringify({
        id: 500,
        kind: "run-permission-reply",
        run: request.run,
        ask: permission.ask,
        choice: "allow-once",
      }),
    );
    const end = await run.ended;
    expect(end.kind === "run-end" ? end.ending : null).toBe("completed");
  });

  test("an unbound run's ask reaches the person, exactly as today", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const request = {
      id: 44,
      kind: "run" as const,
      run: 44,
      tool: toolOf("normal", reportPath),
      env: {},
      prompt: "say one sentence",
    };
    const run = watch(pipe, request.run);
    await pipe.transport.send(JSON.stringify(request));

    for (let at = 0; at < 500 && run.permissions.length === 0; at += 1) {
      await Bun.sleep(10);
    }
    expect(run.permissions).toHaveLength(1);
    // A fresh session directory, not a folder this test made.
    const started = startedEntry(run.parts);
    expect(existsSync(started.cwd)).toBe(true);
    rmSync(started.cwd, { recursive: true, force: true });

    await pipe.transport.send(
      JSON.stringify({
        id: 501,
        kind: "run-permission-reply",
        run: request.run,
        ask: run.permissions[0]!.ask,
        choice: "allow-once",
      }),
    );
    const end = await run.ended;
    expect(end.kind === "run-end" ? end.ending : null).toBe("completed");
  });

  test("a bound folder that is not there refuses before any spawn", async () => {
    const pipe = await sidecar();
    const base = workspace();
    const reportPath = join(base, "report.json");
    const missing = join(ROOT, "no-such-folder");
    const request = {
      id: 45,
      kind: "run" as const,
      run: 45,
      tool: toolOf("normal", reportPath),
      env: {},
      prompt: "say one sentence",
      cwd: missing,
      scope: { boundary: "write" as const },
    };
    const answer = new Promise<SidecarLine>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("no answer")), 8_000);
      pipe.transport.subscribe(45, (line) => {
        clearTimeout(timer);
        resolve(line);
      });
    });
    await pipe.transport.send(JSON.stringify(request));
    const line = await answer;

    expect(line.kind).toBe("error");
    const sentence = line.kind === "error" ? line.message : "";
    expect(sentence).toContain(missing);
    expect(sentence).toContain("is not there");
    expect(sentence).toContain("nothing was started");
    // No child was spawned for it: the fake never wrote its report.
    await Bun.sleep(300);
    expect(existsSync(reportPath)).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * 6. The face: the project CARD, never its path — and the mirror's rule.
 * ------------------------------------------------------------------ */

function mirrorView(projectNames: Record<string, string | null>): MirrorView {
  return {
    references: [RAIN],
    readings: [FOLDER_READING],
    texts: {},
    states: { [RAIN.on]: "current" as const },
    notes: {},
    orphanNotes: [],
    orphanMedia: [],
    links: [],
    orphanLinks: [],
    asks: [],
    sessions: [
      { ...SESSION, project: "rain-gauge", boundary: "write" },
    ],
    sessionToolNames: { [SESSION.on]: "a tool row" },
    sessionEndings: {},
    sessionProjectNames: projectNames,
    orphanSessionTranscripts: [],
    malformedAsks: [],
    orphanAskTurns: [],
    malformedGround: [],
    malformedReadings: [],
    malformedLinks: [],
  };
}

describe("the bound card's face and the mirror", () => {
  test("the mirror names the project CARD, and the folder path never appears", () => {
    const text = renderMirror(mirrorView({ [SESSION.on]: "Rain gauge" }));
    expect(text).toContain("bound to Rain gauge");
    expect(text).not.toContain(FOLDER_READING.from);
    // An unbound card's line is the line it always had.
    const unbound = renderMirror(mirrorView({ [SESSION.on]: null }));
    expect(unbound).not.toContain("bound to");
  });

  test("the face says the binding by name, and the declaration says the path", () => {
    const html = renderToStaticMarkup(
      createElement(SessionCard, {
        session: { ...SESSION, project: "rain-gauge", boundary: "write" },
        toolName: "a tool row",
        declaration: "this run will receive no key",
        projectName: "Rain gauge",
        projectFolder: "/home/ada/code/rain",
        projects: [{ id: "rain-gauge", name: "Rain gauge" }],
        entries: [],
        running: false,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onChooseProject: async () => ({ ok: true }),
        onChooseBoundary: async () => ({ ok: true }),
      }),
    );
    // The quiet line: the card's NAME, never its path.
    expect(html).toContain("bound to Rain gauge");
    // The declaration says the blast radius aloud, path included.
    expect(html).toContain(
      "this run works in /home/ada/code/rain and may change files there",
    );
    // The two other boundary states are offered, and the default is said.
    expect(html).toContain("may change files there");
    expect(html).toContain("only reads");
    expect(html).toContain("undeclared");
  });

  test("an undeclared card says every ask will reach the person", () => {
    const html = renderToStaticMarkup(
      createElement(SessionCard, {
        session: SESSION,
        toolName: "a tool row",
        declaration: null,
        entries: [],
        running: false,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        onChooseBoundary: async () => ({ ok: true }),
      }),
    );
    expect(html).toContain(SESSION_BOUNDARY_UNDECLARED_SENTENCE);
    expect(html).not.toContain("bound to");
    expect(html).not.toContain("this run works in");
  });
});
