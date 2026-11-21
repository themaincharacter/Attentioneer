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
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ACP_SENTENCES,
  type AcpSpec,
  validateAcpSpec,
} from "../src/turn/acpSpecs";
import {
  loadToolRowFacts,
  rowWithFacts,
  type ToolRowStoreIo,
} from "../src/turn/acpRowStore";
import {
  SETUP_CODE_LABEL,
  SETUP_SENTENCES,
  SETUP_VERBS,
  signInToolOf,
  setupEndSentence,
  setupLineCrop,
  setupUrlIn,
  type SessionSignIn,
} from "../src/turn/acpSetup";
import {
  SETUP_UNREACHABLE,
  startSetupChild,
  type SetupChildEnd,
} from "../src/turn/acpSetupChild";
import {
  SETUP_STDIN_MAX,
  parseRequestLine,
  parseSidecarLine,
  requestIdOf,
  setupCancelLine,
  setupEndLine,
  setupPartLine,
  setupRequestLine,
  setupStdinLine,
  type SidecarLine,
  type SetupTool,
} from "../src/turn/protocol";
import { openPageOutward } from "../src/canvas/outward";
import { SessionCard } from "../src/canvas/SessionCard";
import { canonicalJson } from "../src/lib/serialize";
import type { SidecarStart } from "../src/turn/sidecar";
import {
  BUN,
  FAKE_SERVER,
  openSidecar,
  type SidecarPipe,
} from "./fixtures/sidecar-pipe";

/**
 * STORY 22.1b — THE TOOL ROW CAN OPEN THE TOOL'S OWN SIGN-IN.
 *
 * A row may declare the argv that opens its tool's sign-in; the app runs it as
 * a SETUP CHILD (a process class of its own, never a run), relays what it
 * prints, hands the person's pasted code to the child's stdin, and states the
 * exit. The person does the interactive part; the app only hosts the child.
 *
 * WHAT IS PINNED HERE:
 *
 *   1. the lifecycle through the REAL sidecar with the fake child: a URL line,
 *      the code reaching the child (proven by a digest, never by echoing it),
 *      and one ending with the exit code and the last line;
 *   2. a cancel KILLS the child and the card says the stopped sentence;
 *   3. the sidecar's own shutdown sweep kills a live setup child;
 *   4. THE CODE SENTINEL: after a full run no file in the workspace, the
 *      config, a transcript or a PRISM holds the code, and no view state does;
 *   5. the URL reading and the outward wiring: the exact address reaches the
 *      opener, a refused scheme reaches nothing, and a non-URL line offers no
 *      page verb;
 *   6. NO TRACE: no map write, no transcript, no history and no PRISM from any
 *      setup outcome, and no row fact changes;
 *   7. the row shape (the signIn field round-trips and validates), the card's
 *      verbs, and the empty-code refusal.
 *
 * The fixture's sign-in mode is NOT an ACP server: it prints a page and waits
 * for one line of its own stdin, exactly as a tool's sign-in does.
 */

const APP = fileURLToPath(new URL("..", import.meta.url)).replace(/[\/]$/, "");
const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-setup-child-"));
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
      throw new Error("timed out waiting for the fake sign-in child");
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
    await Bun.sleep(5);
  }
  return false;
}

/** The tool a setup child starts, pointed at the fixture's sign-in mode. */
function signInTool(reportPath: string): SetupTool {
  return {
    command: BUN,
    args: [FAKE_SERVER, "sign-in", "--report", reportPath],
  };
}

/** A row that declares exactly that sign-in argv; its ACP argv is unused here. */
function signInRow(reportPath: string): AcpSpec {
  return {
    kind: "acp",
    id: "a-row",
    name: "A row",
    verified: false,
    command: BUN,
    args: [],
    cwdPolicy: "session",
    env: [],
    timeoutMinutes: 10,
    signIn: { args: signInTool(reportPath).args },
    notes: "a row for the test",
  };
}

/** The digest the fixture prints, for the same bytes. */
function digestOf(text: string): string {
  return new Bun.CryptoHasher("sha256").update(text).digest("hex");
}

/* ------------------------------------------------------------------ *
 * 1. The lifecycle through the REAL sidecar.
 * ------------------------------------------------------------------ */

describe("a sign-in is one setup child through the real sidecar", () => {
  test("a URL line, the code reaching the child, and one ending", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const transport = await lane();
    const parts: { stream: string; line: string }[] = [];
    const handle = startSetupChild(signInRow(reportPath), {
      transport,
      start: async () => RUNNING,
      onLine: (part) => parts.push(part),
    });
    expect(handle).not.toBeNull();
    if (handle === null) throw new Error("unreachable");

    // THE FIRST LINE IS THE PAGE the person must open, on stdout.
    await waitFor(() => parts.length >= 1);
    expect(parts[0]!.stream).toBe("stdout");
    expect(parts[0]!.line).toContain("https://example.test/sign-in");
    expect(setupUrlIn(parts[0]!.line)).toBe("https://example.test/sign-in");

    // THE CHILD IS LIVE and waiting on its stdin until the code arrives.
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { pid: number };

    const code = "CODE-4f1c-a7b2-the-person-pasted-this";
    handle.sendCode(code);
    const end = await handle.ended;

    // THE CODE ARRIVED INTACT: the child says so with a DIGEST, never by
    // printing the code back, so no line, view or file ever holds it.
    await waitFor(() => parts.length >= 2);
    expect(parts[1]!.line).toBe(
      "the code reached the child: sha256 " + digestOf(code),
    );
    expect(parts[1]!.line).not.toContain(code);

    expect(end.ending).toBe("completed");
    expect(end.exitCode).toBe(0);
    expect(end.line).toBe(parts[1]!.line);
    expect(end.sentence).toBeNull();
    // The last line rides the ending, so the card has one sentence to say.
    expect(setupEndSentence(end.ending, end.line, end.sentence)).toBe(
      SETUP_SENTENCES.done,
    );
    // The child is dead once its ending is stated.
    expect(await gone(report.pid)).toBe(true);
  });

  test("the row's key reaches the child beside PATH and HOME, and no argv", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const transport = await lane();
    const row: AcpSpec = {
      ...signInRow(reportPath),
      env: [{ name: "A_TOKEN", key: "a-provider-row" }],
    };
    const handle = startSetupChild(row, {
      transport,
      start: async () => RUNNING,
      readKey: async () => "the-value",
    });
    if (handle === null) throw new Error("unreachable");
    let up = false;
    while (!up) {
      await Bun.sleep(20);
      up = existsSync(reportPath);
    }
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as {
      env: Record<string, string>;
      argv: string[];
    };
    // EXACTLY PATH, HOME and the granted name — nothing else rides along.
    expect(Object.keys(report.env).sort()).toEqual(["A_TOKEN", "HOME", "PATH"]);
    expect(report.env.A_TOKEN).toBe("the-value");
    expect(report.argv.join("\u0000")).not.toContain("the-value");
    handle.cancel();
    await handle.ended;
  });

  test("the wire's five kinds have exactly their stated shapes", () => {
    // A REQUEST round trip: the setup line carries the tool and the resolved
    // env map, the stdin line one string, the cancel one number.
    const tool = signInTool("/tmp/report.json");
    const request = setupRequestLine(7, 8, tool, { A_KEY: "a-value" });
    expect(JSON.parse(request)).toEqual({
      id: 7,
      kind: "setup",
      setup: 8,
      tool: { command: tool.command, args: [...tool.args] },
      env: { A_KEY: "a-value" },
    });
    expect(parseRequestLine(request)).toEqual({
      id: 7,
      kind: "setup",
      setup: 8,
      tool: { command: tool.command, args: [...tool.args] },
      env: { A_KEY: "a-value" },
    });
    expect(JSON.parse(setupStdinLine(9, 8, "a code"))).toEqual({
      id: 9,
      kind: "setup-stdin",
      setup: 8,
      text: "a code",
    });
    expect(JSON.parse(setupCancelLine(10, 8))).toEqual({
      id: 10,
      kind: "setup-cancel",
      setup: 8,
    });

    // A LINE down: its stream is marked, and the ending states the exit code
    // and the last line. Both are read strictly and by exactly that shape.
    expect(parseSidecarLine(setupPartLine(7, 8, "stderr", "a line"))).toEqual({
      id: 7,
      kind: "setup-part",
      setup: 8,
      stream: "stderr",
      line: "a line",
    });
    expect(parseSidecarLine(setupEndLine(7, 8, "failed", 2, "a line"))).toEqual({
      id: 7,
      kind: "setup-end",
      setup: 8,
      ending: "failed",
      exitCode: 2,
      line: "a line",
    });

    // REFUSALS: an unknown stream, a non-integer exit code, an unknown ending,
    // a blank stdin line and a paste over the cap are all null, never guessed.
    const part = (stream: string) =>
      JSON.stringify({ id: 1, kind: "setup-part", setup: 8, stream, line: "x" });
    expect(parseSidecarLine(part("other"))).toBeNull();
    expect(
      parseSidecarLine(
        JSON.stringify({
          id: 1,
          kind: "setup-end",
          setup: 8,
          ending: "completed",
          exitCode: 1.5,
          line: null,
        }),
      ),
    ).toBeNull();
    expect(
      parseSidecarLine(
        JSON.stringify({
          id: 1,
          kind: "setup-end",
          setup: 8,
          ending: "done",
          exitCode: 0,
          line: null,
        }),
      ),
    ).toBeNull();
    expect(
      parseRequestLine(
        JSON.stringify({ id: 1, kind: "setup-stdin", setup: 8, text: "   " }),
      ),
    ).toBeNull();
    expect(
      parseRequestLine(
        JSON.stringify({
          id: 1,
          kind: "setup-stdin",
          setup: 8,
          text: "x".repeat(SETUP_STDIN_MAX + 1),
        }),
      ),
    ).toBeNull();
    // A request the reader cannot read still answers to its id.
    expect(requestIdOf('{"id": 12, "kind": "setup"}')).toBe(12);
  });

  test("a raw request through the sidecar states its ending once", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const pipe = openSidecar();
    PIPES.push(pipe);
    await pipe.hello();
    pipe.child.stdin.write(
      setupRequestLine(21, 21, signInTool(reportPath), {}) + "\n",
    );
    await pipe.child.stdin.flush();

    const seen: SidecarLine[] = [];
    for (;;) {
      const line = parseSidecarLine(await pipe.lines.next());
      if (line === null) continue;
      seen.push(line);
      if (line.kind === "setup-part") {
        expect(line.setup).toBe(21);
        expect(line.stream).toBe("stdout");
        pipe.child.stdin.write(setupStdinLine(22, 21, "a-code") + "\n");
        await pipe.child.stdin.flush();
        continue;
      }
      if (line.kind === "setup-end") {
        expect(line.ending).toBe("completed");
        expect(line.exitCode).toBe(0);
        // The last line is the child's own confirmation, not the code itself.
        expect(line.line ?? "").toContain("sha256");
        expect(line.line ?? "").not.toContain("a-code");
        break;
      }
    }
    // Exactly one ending: no second line states it.
    expect(seen.filter((line) => line.kind === "setup-end")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * 2. A cancel kills the child and says the stopped sentence.
 * ------------------------------------------------------------------ */

describe("a cancel kills the setup child and answers the stopped sentence", () => {
  test("the child is gone, and the card says it was stopped", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const transport = await lane();
    const parts: string[] = [];
    const handle = startSetupChild(signInRow(reportPath), {
      transport,
      start: async () => RUNNING,
      onLine: (part) => parts.push(part.line),
    });
    if (handle === null) throw new Error("unreachable");
    await waitFor(() => parts.length >= 1);
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { pid: number };

    // The person presses stop: the child is killed, and its OWN ending is the
    // answer. A stopped child never becomes a completion.
    handle.cancel();
    const end = await handle.ended;
    expect(end.ending).toBe("stopped");
    expect(setupEndSentence(end.ending, end.line, end.sentence)).toBe(
      SETUP_SENTENCES.stopped,
    );
    expect(await gone(report.pid)).toBe(true);
  });

  test("a cancel for a child that already ended changes nothing further", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const transport = await lane();
    const parts: string[] = [];
    const handle = startSetupChild(signInRow(reportPath), {
      transport,
      start: async () => RUNNING,
      onLine: (part) => parts.push(part.line),
    });
    if (handle === null) throw new Error("unreachable");
    // Wait for the child's own first line: it is up and waiting on its stdin.
    await waitFor(() => parts.length >= 1);
    handle.sendCode("a-code");
    const end = await handle.ended;
    expect(end.ending).toBe("completed");
    // A late cancel has no live child; the seam's one ending stands.
    handle.cancel();
    handle.sendCode("another-code");
    expect(end.ending).toBe("completed");
  });
});

/* ------------------------------------------------------------------ *
 * 3. The sidecar's own shutdown sweep kills a live setup child.
 * ------------------------------------------------------------------ */

describe("the sidecar's shutdown sweep kills a live setup child", () => {
  test("closing its stdin kills the child", async () => {
    const base = workspace();
    const reportPath = join(base, "report.json");
    const pipe = openSidecar();
    PIPES.push(pipe);
    await pipe.hello();
    pipe.child.stdin.write(
      setupRequestLine(31, 31, signInTool(reportPath), {}) + "\n",
    );
    await pipe.child.stdin.flush();
    // Wait until the child is really up (its URL line), then read its pid.
    let up = false;
    while (!up) {
      const line = await pipe.lines.next();
      up = line.includes("example.test/sign-in");
    }
    const report = JSON.parse(readFileSync(reportPath, "utf8")) as { pid: number };

    // The SAME sweep the run lane uses: stdin closed, every live child killed.
    pipe.child.stdin.end();
    expect(await gone(report.pid)).toBe(true);
    await pipe.child.exited;
  });
});

/* ------------------------------------------------------------------ *
 * 4. THE CODE SENTINEL.
 * ------------------------------------------------------------------ */

describe("the code is ephemeral: no file and no view state holds it", () => {
  test("after a full run, the pasted code is in no file and in no store", async () => {
    const base = workspace();
    const map = join(base, "map");
    mkdirSync(join(map, "sessions"), { recursive: true });
    writeFileSync(join(map, "sessions.txt"), "");
    writeFileSync(join(map, "MAP.md"), "# MAP\n");
    writeFileSync(join(map, "history.jsonl"), "");
    // A config file in the shape the app writes, and a PRISM log beside the
    // map — the two files a person's code could leak into.
    const configPath = join(base, "config.json");
    writeFileSync(configPath, canonicalJson({ providerRows: [], toolRows: [] }));
    const prismPath = join(base, "prism.jsonl");
    writeFileSync(prismPath, '{"kind":"open-os"}\n');
    const transcriptPath = join(map, "sessions", "a-run.jsonl");
    writeFileSync(transcriptPath, "");
    const before = treeOf(base);

    // A RECORDING store for the one config key the app keeps facts in: this is
    // what a real write would pass through, and it stays untouched.
    let writes = 0;
    let configBytes = canonicalJson({ toolRows: [] });
    const recording: ToolRowStoreIo = {
      async load() {
        return JSON.parse(configBytes) as never;
      },
      async save(patch) {
        writes += 1;
        configBytes = canonicalJson({
          ...(JSON.parse(configBytes) as object),
          ...patch,
        });
      },
    };

    const reportPath = join(base, "report.json");
    const transport = await lane();
    const view: SessionSignIn[] = [];
    const parts: string[] = [];
    const handle = startSetupChild(signInRow(reportPath), {
      transport,
      start: async () => RUNNING,
      onLine: (part) => parts.push(part.line),
    });
    if (handle === null) throw new Error("unreachable");
    await waitFor(() => parts.length >= 1);

    const SENTINEL = "PASTED-CODE-9c41f0-never-kept";
    handle.sendCode(SENTINEL);
    const end = await handle.ended;
    // What the card would draw: the child's lines and the ending, and no code.
    view.push({ running: true, line: parts[0] ?? null, ended: null });
    view.push({
      running: false,
      line: end.line,
      ended: { ending: end.ending, line: end.line, sentence: end.sentence },
    });
    expect(JSON.stringify(view)).not.toContain(SENTINEL);
    expect(parts.join("\n")).not.toContain(SENTINEL);

    // THE ARRIVAL IS PROVEN (the digest matches the same bytes), so the absence
    // below is not the absence of a code that never arrived.
    expect(end.line).toBe(
      "the code reached the child: sha256 " + digestOf(SENTINEL),
    );

    // NO FILE IN THE WORKSPACE HOLDS IT — not the config, not the transcript,
    // not the PRISM log, not the map. And nothing the app could write moved:
    // every file is byte-for-byte the one the test placed (the fixture's own
    // report is not app state, so it is excluded from the byte comparison).
    const after = treeOf(base);
    for (const [path, bytes] of Object.entries(after)) {
      expect(bytes).not.toContain(SENTINEL);
      if (!path.startsWith("/report")) {
        expect(before[path]).toBe(bytes);
      }
    }
    expect(after["/config.json"]).toBe(before["/config.json"]);
    expect(after["/prism.jsonl"]).toBe(before["/prism.jsonl"]);
    expect(after["/map/sessions/a-run.jsonl"]).toBe("");
    expect(readFileSync(configPath, "utf8")).not.toContain(SENTINEL);

    // NO STATE STORE HOLDS IT: the config's one fact store was never written,
    // and its bytes carry no trace of the code.
    expect(await loadToolRowFacts(recording)).toEqual([]);
    expect(writes).toBe(0);
    expect(configBytes).not.toContain(SENTINEL);
  });
});

/* ------------------------------------------------------------------ *
 * 5. The URL reading and the outward wiring.
 * ------------------------------------------------------------------ */

describe("a URL line surfaces the open-the-page verb", () => {
  test("the first http(s) URL is read out of the child's line", () => {
    expect(setupUrlIn("open this page to sign in: https://example.test/sign-in")).toBe(
      "https://example.test/sign-in",
    );
    expect(setupUrlIn("then return to http://127.0.0.1:1234/done.")).toBe(
      "http://127.0.0.1:1234/done",
    );
    expect(setupUrlIn("(see https://example.test/a?b=c&d=e)")).toBe(
      "https://example.test/a?b=c&d=e",
    );
    // NOT a page this app can hand over: no url, another scheme, or no line.
    expect(setupUrlIn("https://")).toBeNull();
    expect(setupUrlIn("mailto:someone@example.test")).toBeNull();
    expect(setupUrlIn("waiting for the person to finish")).toBeNull();
    expect(setupUrlIn("")).toBeNull();
  });

  test("the exact address reaches the opener, and a refused scheme reaches nothing", async () => {
    const opened: string[] = [];
    const url = "https://example.test/sign-in";
    const result = await openPageOutward(url, async (value) => {
      opened.push(value);
    });
    expect(result).toEqual({ ok: true, message: null });
    expect(opened).toEqual([url]);

    // A scheme the opener capability does not carry is refused BEFORE the
    // call, so a tool's line can never hand an arbitrary scheme to the OS.
    const refused = await openPageOutward(
      "file:///tmp/not-a-page.html",
      async (value) => {
        opened.push(value);
      },
    );
    expect(refused.ok).toBe(false);
    expect(refused.message).not.toBeNull();
    expect(opened).toEqual([url]);
  });

  test("the card offers the page verb for a URL line and not for another line", () => {
    const withUrl = cardHtml({
      signIn: runningSignIn("open this page: https://example.test/sign-in"),
    });
    expect(withUrl).toContain(SETUP_VERBS.openPage);
    const withoutUrl = cardHtml({
      signIn: runningSignIn("waiting for the person to finish"),
    });
    expect(withoutUrl).not.toContain(SETUP_VERBS.openPage);
    // The wiring is the card's: it hands the URL it read to the one prop.
    const card = readFileSync(join(APP, "src/canvas/SessionCard.tsx"), "utf8");
    expect(card).toContain("signIn.openPage?.(signInUrl)");
    expect(card).toContain("setupUrlIn(signIn.line)");
    // outward.ts stays the ONLY opener call site.
    const outward = readFileSync(join(APP, "src/canvas/outward.ts"), "utf8");
    expect(outward).toContain("openPageOutward");
    expect(outward).toContain("openUrl(target.url)");
    expect(outward).toContain("schemeNotice(url)");
  });
});

/* ------------------------------------------------------------------ *
 * 6. No map writes, no transcript, no history, no PRISM.
 * ------------------------------------------------------------------ */

describe("no setup outcome writes anything on the map", () => {
  test("a completed, a stopped and a failed sign-in leave the folder byte-identical", async () => {
    const base = workspace();
    const map = join(base, "map");
    mkdirSync(join(map, "sessions"), { recursive: true });
    writeFileSync(join(map, "sessions.txt"), "a-run|A run|100|100|a-row\n");
    writeFileSync(join(map, "MAP.md"), "# MAP\n");
    writeFileSync(join(map, "history.jsonl"), '{"kind":"card.add"}\n');
    const before = treeOf(map);
    const transport = await lane();

    // A completed sign-in.
    const doneParts: string[] = [];
    const done = startSetupChild(signInRow(join(base, "r1.json")), {
      transport,
      start: async () => RUNNING,
      onLine: (part) => doneParts.push(part.line),
    });
    if (done === null) throw new Error("unreachable");
    await waitFor(() => doneParts.length >= 1);
    done.sendCode("a-code");
    expect((await done.ended).ending).toBe("completed");

    // A stopped one.
    const stoppedParts: string[] = [];
    const stopped = startSetupChild(signInRow(join(base, "r2.json")), {
      transport,
      start: async () => RUNNING,
      onLine: (part) => stoppedParts.push(part.line),
    });
    if (stopped === null) throw new Error("unreachable");
    await waitFor(() => stoppedParts.length >= 1);
    stopped.cancel();
    expect((await stopped.ended).ending).toBe("stopped");

    // A failed one: the command is not there, said in one sentence.
    const missing: AcpSpec = {
      ...signInRow(join(base, "r3.json")),
      command: "/definitely/not/here/attentioneer-sign-in",
    };
    const failed = startSetupChild(missing, {
      transport,
      start: async () => RUNNING,
    });
    if (failed === null) throw new Error("unreachable");
    const failedEnd: SetupChildEnd = await failed.ended;
    expect(failedEnd.ending).toBe("failed");
    expect(failedEnd.sentence).toContain("was not found");

    // THE MAP IS BYTE-IDENTICAL: no transcript, no history, no mirror and no
    // PRISM line came from any of the three outcomes.
    expect(treeOf(map)).toEqual(before);
    expect(existsSync(join(map, "sessions", "a-run.jsonl"))).toBe(false);

    // NO ROW FACT CHANGES: the sign-in path never patches the config, so the
    // state line stays exactly as the last test left it.
    const hook = readFileSync(join(APP, "src/canvas/useGround.ts"), "utf8");
    const start = hook.slice(
      hook.indexOf("const startSessionSignIn"),
      hook.indexOf("const sendSessionSignInCode"),
    );
    expect(start).toContain("startSetupChild(");
    expect(start).not.toContain("patchToolRowFact(");
    expect(start).not.toContain("queueHistory(");
    expect(start).not.toContain("queueMirror(");
    expect(start).not.toContain("appendSessionRun(");
  });
});

/* ------------------------------------------------------------------ *
 * 7. The row shape, the card's verbs and the empty-code refusal.
 * ------------------------------------------------------------------ */

describe("the sign-in is a row field, and the card draws it only when it is there", () => {
  test("signIn round-trips through the draft and the validation", () => {
    const draft = {
      name: "A row",
      command: "/usr/bin/a-tool",
      args: ["acp"],
      signIn: { args: [" sign-in ", "", "  "] },
    };
    const read = validateAcpSpec(draft, [], []);
    expect(read.kind).toBe("row");
    if (read.kind !== "row") throw new Error("unreachable");
    expect(read.row.signIn).toEqual({ args: ["sign-in"] });
    // It survives the per-machine overlay untouched: a fact changes the
    // verified mark and nothing else.
    expect(rowWithFacts(read.row, []).signIn).toEqual({ args: ["sign-in"] });

    // ABSENT IS A COMPLETE ANSWER: no field, no verb.
    const absent = validateAcpSpec(
      { name: "A row", command: "/usr/bin/a-tool", args: [] },
      [],
      [],
    );
    if (absent.kind !== "row") throw new Error("unreachable");
    expect("signIn" in absent.row).toBe(false);
    expect(signInToolOf(absent.row)).toBeNull();

    // A declared sign-in with no argument starts the tool's own server, so it
    // is REFUSED rather than stored as a hope.
    const empty = validateAcpSpec(
      {
        name: "A row",
        command: "/usr/bin/a-tool",
        args: [],
        signIn: { args: [] },
      },
      [],
      [],
    );
    expect(empty).toEqual({ kind: "refused", sentence: ACP_SENTENCES.signInArgs });

    // The tool is the row's own command plus the sign-in argv, and nothing else.
    const row = signInRow("/tmp/report.json");
    const tool = signInToolOf(row);
    expect(tool).not.toBeNull();
    expect(tool!.command).toBe(row.command);
    expect(tool!.args).toEqual(row.signIn!.args);
  });

  test("a row without a declared sign-in shows no verb and no line", () => {
    const html = cardHtml({});
    expect(html).not.toContain(SETUP_VERBS.signIn);
    expect(html).not.toContain("session-card-sign-in");
    expect(html).not.toContain(SETUP_SENTENCES.running);
  });

  test("the running line, the child's newest line and the verbs are on the expanded face", () => {
    const html = cardHtml({
      signIn: runningSignIn("open this page: https://example.test/sign-in"),
    });
    expect(html).toContain(SETUP_SENTENCES.running);
    expect(html).toContain("open this page: https://example.test/sign-in");
    expect(html).toContain(SETUP_VERBS.signIn);
    expect(html).toContain(SETUP_VERBS.sendCode);
    expect(html).toContain(SETUP_CODE_LABEL);
    expect(html).toContain('aria-label="the code the page shows"');
    // The field is EMPTY on the face: the code is never view state.
    expect(html).toContain('value=""');
    // The running sentence is only for a live child.
    const ended = cardHtml({
      signIn: {
        running: false,
        line: null,
        ended: { ending: "completed", line: null, sentence: null },
      },
    });
    expect(ended).not.toContain(SETUP_SENTENCES.running);
    expect(ended).toContain(SETUP_SENTENCES.done);
    // Nothing of it is on the closed face.
    const closed = cardHtml({ open: false, signIn: runningSignIn("a line") });
    expect(closed).not.toContain(SETUP_VERBS.signIn);
    expect(closed).not.toContain(SETUP_SENTENCES.running);
  });

  test("the child's own last line is what a failure says, cropped", () => {
    expect(setupEndSentence("failed", "an error the tool printed", null)).toBe(
      "an error the tool printed",
    );
    expect(setupEndSentence("failed", null, "the lane's sentence")).toBe(
      "the lane's sentence",
    );
    expect(setupEndSentence("failed", null, null)).toBe(
      SETUP_SENTENCES.nothingSaid,
    );
    expect(setupEndSentence("stopped", "anything", null)).toBe(
      SETUP_SENTENCES.stopped,
    );
    expect(setupEndSentence("completed", "anything", null)).toBe(
      SETUP_SENTENCES.done,
    );
    const long = "x".repeat(400);
    expect(setupLineCrop(long).endsWith("…")).toBe(true);
    expect(setupLineCrop(long).length).toBeLessThanOrEqual(160);
  });

  test("an empty code refuses in one sentence and the send clears the field", () => {
    expect(SETUP_SENTENCES.emptyCode).toBe("write the code first.");
    // The card's own handler: a blank field sets that one sentence and sends
    // nothing; a real code goes through the lane's one road and is cleared.
    const card = readFileSync(join(APP, "src/canvas/SessionCard.tsx"), "utf8");
    expect(card).toContain("if (code.trim() === ");
    expect(card).toContain("setProblem(SETUP_SENTENCES.emptyCode)");
    expect(card).toContain("signIn.sendCode?.(code)");
    expect(card).toContain("setCode(");
    // The field clears when the child starts or ends, so a stale code is never
    // shown again.
    expect(card).toContain("[signIn?.running]");
    // The press is offered while the child is alive, beside test.
    const html = cardHtml({ signIn: runningSignIn("a line") });
    expect(html).toContain(SETUP_VERBS.sendCode);
  });

  test("the setup seam refuses a row with no sign-in and answers unreachable", async () => {
    expect(startSetupChild(rowWithoutSignIn())).toBeNull();
    const handle = startSetupChild(signInRow("/tmp/never.json"), {
      transport: {
        async send() {},
        subscribe() {
          return () => {};
        },
      },
      start: async () => {
        throw new Error("no sidecar here");
      },
    });
    if (handle === null) throw new Error("unreachable");
    expect(await handle.ended).toEqual({
      ending: "failed",
      exitCode: null,
      line: null,
      sentence: SETUP_UNREACHABLE,
    });
  });
});

/* ------------------------------------------------------------------ *
 * The helpers the card tests share.
 * ------------------------------------------------------------------ */

function rowWithoutSignIn(): AcpSpec {
  const row = signInRow("/tmp/report.json");
  const { signIn: _dropped, ...rest } = row;
  return rest;
}

function runningSignIn(line: string): SessionSignIn {
  return {
    running: true,
    line,
    ended: null,
    start: () => {},
    sendCode: () => {},
    stop: () => {},
    openPage: () => {},
  };
}

function cardHtml(props: Record<string, unknown> = {}): string {
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
