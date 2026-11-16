import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GhostMove, GhostTarget } from "../src/ghost/envelope";
import { issue, type GhostIssueCode } from "../src/ghost/issues";
import {
  assemblePacket,
  boundedRunSentences,
  PACKET_RUN_HEADING,
  runBlockOf,
  type PacketInput,
  type PacketView,
  type PacketWord,
} from "../src/ghost/packet";
import { ADD_ASSUMPTION, ASSUMPTIONS_FILE } from "../src/ghost/registry";
import { askForPacket, PACKET_REQUEST_KEYS } from "../src/ghost/request";
import {
  createRunState,
  N_RUN_LIMIT,
  runKeyOf,
  runPartsOf,
  type RunRefusedAttempt,
} from "../src/ghost/runState";
import {
  createGhostSession,
  type GhostContext,
} from "../src/ghost/session";
import type { GhostSnapshot } from "../src/ghost/snapshot";
import { agentReply, withWorkspace } from "./ghost-harness";

/**
 * Epic 14 story 1 — THE RUN STATE AND THE PACKET BOUND (ADR-0031's final
 * amendments; ADR-0026 amended).
 *
 * The trace is the ghost session's open moment: refused intakes and the words
 * they said, keyed on (move, target, issue code), counted against N = 3, and
 * discarded at close. The packet carries at most N of those SENTENCES — never a
 * count, never a trail — and nothing observes the region through the run. The
 * no-persistence and never-rendered claims are source-scanned; the discard is
 * asserted against a byte-identical fixture tree.
 */

const MOVE: GhostMove = { family: "assumption", verb: "add" };
const RAIN_TARGET: GhostTarget = { kind: "word", slug: "rain" };
const SOIL_TARGET: GhostTarget = { kind: "word", slug: "soil" };

const RAIN: PacketWord = {
  slug: "rain",
  name: "rain",
  x: 0,
  y: 0,
  box: { w: 80, h: 30 },
};
const SOIL: PacketWord = {
  slug: "soil",
  name: "soil",
  x: 120,
  y: 0,
  box: { w: 80, h: 30 },
};
const BASE = '{"on":"soil","text":"the soil holds water"}\n';

function snapshot(): GhostSnapshot {
  return {
    level: "dynamics",
    scenario: null,
    dir: "map",
    playing: ["rain", "soil"],
    words: new Set(["rain", "soil"]),
    loops: new Set(),
    files: { [ASSUMPTIONS_FILE]: BASE },
  };
}

function view(): PacketView {
  return {
    words: [RAIN, SOIL],
    playing: ["rain", "soil"],
    marks: [],
    claims: [],
    loops: [],
    veils: [],
  };
}

function input(overrides: Partial<PacketInput> = {}): PacketInput {
  return {
    entry: ADD_ASSUMPTION,
    target: RAIN_TARGET,
    person: { selection: null },
    view: view(),
    snapshot: snapshot(),
    ...overrides,
  };
}

function refused(
  code: GhostIssueCode,
  message: string,
  target: GhostTarget = RAIN_TARGET,
): RunRefusedAttempt {
  return { move: MOVE, target, issues: [issue(code, message)] };
}

/** The block's section, as the packet's bytes carry it (heading to next "## "). */
function sectionOf(bytes: string): string {
  const start = bytes.indexOf(PACKET_RUN_HEADING);
  if (start === -1) return "";
  const end = bytes.indexOf("\n## ", start);
  return bytes.slice(start, end === -1 ? undefined : end);
}

/** Every file under a folder, relative to it, with its bytes (the on-disk trace). */
function treeOf(root: string, base = root): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(root, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(root, entry.name);
    const relative = full.slice(base.length + 1);
    if (entry.isDirectory()) Object.assign(files, treeOf(full, base));
    else files[relative] = readFileSync(full, "utf8");
  }
  return files;
}

const SRC = fileURLToPath(new URL("../src", import.meta.url));

/** Every shipped source file under src/, relative to it. */
function sourceFiles(dir = SRC, base = SRC): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(full, base));
    else out.push(full.slice(base.length + 1));
  }
  return out;
}

function sourceOf(relative: string): string {
  return readFileSync(join(SRC, relative), "utf8");
}

/** A source file with its comments stripped, so a scan reads CODE only. */
function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/**
 * The text between a call's own parentheses (balanced), so a scan can speak
 * about ONE call site instead of a whole file. Null when the call is absent.
 */
function callText(code: string, name: string): string | null {
  const start = code.indexOf(name + "(");
  if (start === -1) return null;
  let depth = 0;
  for (let at = start + name.length; at < code.length; at += 1) {
    if (code[at] === "(") depth += 1;
    else if (code[at] === ")") {
      depth -= 1;
      if (depth === 0) return code.slice(start + name.length + 1, at);
    }
  }
  return null;
}

const FILES = sourceFiles();

describe("the run key: (move, target, issue code), and nothing else", () => {
  test("the same refusal is the same key", () => {
    const first = runKeyOf(MOVE, RAIN_TARGET, "dangling-target");
    const second = runKeyOf(
      { family: "assumption", verb: "add" },
      { kind: "word", slug: "rain" },
      "dangling-target",
    );
    expect(second).toBe(first);
    expect(first.length).toBeGreaterThan(0);
  });

  test("another move, target or issue code is another key (the code is granular)", () => {
    const keys = new Set([
      runKeyOf(MOVE, RAIN_TARGET, "dangling-target"),
      runKeyOf({ family: "assumption", verb: "remove" }, RAIN_TARGET, "dangling-target"),
      runKeyOf(MOVE, SOIL_TARGET, "dangling-target"),
      runKeyOf(MOVE, RAIN_TARGET, "pin"),
    ]);
    expect(keys.size).toBe(4);
  });

  test("a target's identity is its own kind, direction and coordinates", () => {
    const word = runKeyOf(MOVE, { kind: "word", slug: "rain" }, "pin");
    const loop = runKeyOf(MOVE, { kind: "loop", slug: "rain" }, "pin");
    const spotA = runKeyOf(MOVE, { kind: "spot", x: 1, y: 2 }, "pin");
    const spotB = runKeyOf(MOVE, { kind: "spot", x: 2, y: 1 }, "pin");
    const forward = runKeyOf(MOVE, { kind: "link", from: "rain", to: "soil" }, "pin");
    const backward = runKeyOf(MOVE, { kind: "link", from: "soil", to: "rain" }, "pin");
    expect(new Set([word, loop, spotA, spotB, forward, backward]).size).toBe(6);
  });

  test("a reply's readable parts make a key; extras and unreadable parts do not", () => {
    expect(
      runPartsOf({
        move: { family: "assumption", verb: "add", extra: true },
        target: { kind: "word", slug: "rain", x: 400 },
        rationale: "not part of a key",
      }),
    ).toEqual({
      move: { family: "assumption", verb: "add" },
      target: { kind: "word", slug: "rain" },
    });
    for (const body of [
      null,
      "a prose reply",
      {},
      { move: { family: "assumption" }, target: { kind: "word", slug: "rain" } },
      { move: { family: "assumption", verb: "add" } },
      { move: { family: "assumption", verb: "add" }, target: { kind: "spot", x: "1", y: 2 } },
      { move: { family: "assumption", verb: "add" }, target: { kind: "link", from: "rain" } },
      { move: { family: "assumption", verb: "add" }, target: { kind: "veil" } },
    ]) {
      expect(runPartsOf(body)).toBeNull();
    }
  });

  test("the key's parts are length-prefixed, so two moves cannot forge one key", () => {
    // Plain concatenation would collide these two ("ab"+"c" and "a"+"bc").
    const one = runKeyOf({ family: "ab", verb: "c" }, RAIN_TARGET, "pin");
    const two = runKeyOf({ family: "a", verb: "bc" }, RAIN_TARGET, "pin");
    expect(one).not.toBe(two);
    // The same triple still comes back the same.
    expect(runKeyOf(MOVE, { kind: "word", slug: "ab" }, "pin")).toBe(
      runKeyOf(MOVE, { kind: "word", slug: "ab" }, "pin"),
    );
  });
});

describe("the counter: N = 3, in run state only", () => {
  test("three strikes at one key reach the bound; a fourth still says reached", () => {
    expect(N_RUN_LIMIT).toBe(3);
    const run = createRunState();
    const key = runKeyOf(MOVE, RAIN_TARGET, "dangling-target");
    const first = run.recordRefusedAttempt(
      refused("dangling-target", "the target is not on the map"),
    );
    expect(first.strikes).toEqual([{ key, attempts: 1, limitReached: false }]);
    expect(first.limitReached).toBe(false);
    const second = run.recordRefusedAttempt(
      refused("dangling-target", "the target is not on the map"),
    );
    expect(second.strikes[0]?.attempts).toBe(2);
    expect(second.limitReached).toBe(false);
    const third = run.recordRefusedAttempt(
      refused("dangling-target", "the target is not on the map"),
    );
    expect(third.strikes[0]?.attempts).toBe(N_RUN_LIMIT);
    expect(third.limitReached).toBe(true);
    expect(run.attemptsFor(key)).toBe(N_RUN_LIMIT);
    const fourth = run.recordRefusedAttempt(
      refused("dangling-target", "the target is not on the map"),
    );
    expect(fourth.strikes[0]?.attempts).toBe(N_RUN_LIMIT + 1);
    expect(fourth.limitReached).toBe(true);
  });

  test("another key's attempts never add up", () => {
    const run = createRunState();
    const pin = runKeyOf(MOVE, RAIN_TARGET, "pin");
    const dangling = runKeyOf(MOVE, RAIN_TARGET, "dangling-target");
    run.recordRefusedAttempt(refused("pin", "the base pin no longer matches"));
    run.recordRefusedAttempt(refused("pin", "the base pin no longer matches"));
    run.recordRefusedAttempt(refused("dangling-target", "the target is not on the map"));
    run.recordRefusedAttempt(refused("dangling-target", "the target is not on the map"));
    expect(run.attemptsFor(pin)).toBe(2);
    expect(run.attemptsFor(dangling)).toBe(2);
    const third = run.recordRefusedAttempt(
      refused("pin", "the base pin no longer matches"),
    );
    expect(third.limitReached).toBe(true);
    expect(run.attemptsFor(dangling)).toBe(2);
  });

  test("one reply naming one code twice is ONE attempt at it", () => {
    const run = createRunState();
    const record = run.recordRefusedAttempt({
      move: MOVE,
      target: RAIN_TARGET,
      issues: [
        issue("unknown-key", "the envelope does not keep that key"),
        issue("unknown-key", "the envelope does not keep that key"),
      ],
    });
    expect(record.strikes).toHaveLength(1);
    expect(record.strikes[0]?.attempts).toBe(1);
    expect(record.limitReached).toBe(false);
  });

  test("the counter's home is run state, and it points at ADR-0031", () => {
    const source = sourceOf("ghost/runState.ts");
    expect(source).toContain("export const N_RUN_LIMIT = 3;");
    expect(source).toContain("ADR-0031");
    expect(source).toContain("changed only by ADR amendment");
  });

  test("discard empties the attempts and the sentences (the session's close)", () => {
    const run = createRunState();
    const key = runKeyOf(MOVE, RAIN_TARGET, "pin");
    run.recordRefusedAttempt(refused("pin", "the base pin no longer matches"));
    expect(run.attemptsFor(key)).toBe(1);
    expect(run.sentencesForTarget(MOVE, RAIN_TARGET)).toHaveLength(1);
    run.discard();
    expect(run.attemptsFor(key)).toBe(0);
    expect(run.sentencesForTarget(MOVE, RAIN_TARGET)).toEqual([]);
    run.discard();
    expect(run.attemptsFor(key)).toBe(0);
  });
});

describe("the packet's run block: the sentences, bounded by N, never counts", () => {
  test("the block carries the prior sentences in arrival order, under one heading", () => {
    const first = "the target came back with no place on the map";
    const second = "the base pin no longer matches what stands";
    const packet = assemblePacket(input({ run: { sentences: [first, second] } }));
    const bytes = packet.freeze.bytes;
    expect(bytes).toContain(PACKET_RUN_HEADING);
    expect(sectionOf(bytes)).toContain(first);
    expect(sectionOf(bytes)).toContain(second);
    expect(sectionOf(bytes).indexOf(first)).toBeLessThan(
      sectionOf(bytes).indexOf(second),
    );
  });

  test("the block is bounded by N: five prior refusals ride as three", () => {
    const sentences = [
      "the first refusal came back",
      "the second refusal came back",
      "the third refusal came back",
      "the fourth refusal came back",
      "the fifth refusal came back",
    ];
    const block = runBlockOf({ sentences });
    expect(block?.sentences).toEqual(sentences.slice(0, N_RUN_LIMIT));
    const bytes = assemblePacket(input({ run: { sentences } })).freeze.bytes;
    for (const carried of sentences.slice(0, N_RUN_LIMIT)) {
      expect(bytes).toContain(carried);
    }
    for (const dropped of sentences.slice(N_RUN_LIMIT)) {
      expect(bytes).not.toContain(dropped);
    }
    expect(boundedRunSentences(sentences)).toHaveLength(N_RUN_LIMIT);
  });

  test("no prior refusal means no block at all (no 'none' line)", () => {
    expect(runBlockOf(undefined)).toBeNull();
    expect(runBlockOf({ sentences: [] })).toBeNull();
    expect(runBlockOf({ sentences: ["", "   "] })).toBeNull();
    const bytes = assemblePacket(input()).freeze.bytes;
    expect(bytes).not.toContain(PACKET_RUN_HEADING);
    expect(bytes).toBe(assemblePacket(input({ run: { sentences: [] } })).freeze.bytes);
  });

  test("the block's data has no numeric field (no count can ride it)", () => {
    const sentences = [
      "the target came back with no place on the map",
      "the base pin no longer matches what stands",
    ];
    const block = runBlockOf({ sentences });
    expect(block).not.toBeNull();
    if (block === null) throw new Error("expected a block");
    expect(Object.keys(block).sort()).toEqual(["heading", "sentences"]);
    for (const value of Object.values(block)) {
      expect(typeof value).not.toBe("number");
    }
    expect(block.sentences.every((sentence) => typeof sentence === "string")).toBe(
      true,
    );
    expect(JSON.stringify(block)).not.toMatch(/\d/);
    const section = sectionOf(
      assemblePacket(input({ run: { sentences } })).freeze.bytes,
    );
    expect(section).not.toMatch(/\d/);
    expect(section).not.toMatch(
      /\b(attempt|attempts|strike|strikes|count|counts|counter|trail|times|tries)\b/i,
    );
  });

  test("a repeated sentence is one line: the block is never a trail", () => {
    const sentence = "the target came back with no place on the map";
    const block = runBlockOf({ sentences: [sentence, sentence, sentence] });
    expect(block?.sentences).toEqual([sentence]);
    const bytes = assemblePacket(
      input({ run: { sentences: [sentence, sentence, sentence] } }),
    ).freeze.bytes;
    expect(bytes.split(PACKET_RUN_HEADING)).toHaveLength(2);
    expect(bytes.split(sentence)).toHaveLength(2);
  });

  test("the block changes no region, no slug and no source (the forbidden observation)", () => {
    const sentence = "the target came back with no place on the map";
    const plain = assemblePacket(input());
    const ran = assemblePacket(input({ run: { sentences: [sentence] } }));
    expect(ran.region).toEqual(plain.region);
    expect(ran.region.source).toBe(plain.region.source);
    expect(ran.region.slugs).toEqual(plain.region.slugs);
    const recordLines = (bytes: string) =>
      bytes
        .split("\n")
        .filter((line) => /^### |^slug: |^name: |^in play: |^marks: |^claims on it: /.test(line));
    expect(recordLines(ran.freeze.bytes)).toEqual(recordLines(plain.freeze.bytes));
    // The ONLY byte difference is the block: strip it and the packet is the
    // plain packet exactly.
    const start = ran.freeze.bytes.indexOf(PACKET_RUN_HEADING);
    const next = ran.freeze.bytes.indexOf("\n## ", start);
    const stripped =
      ran.freeze.bytes.slice(0, start) + ran.freeze.bytes.slice(next + 1);
    expect(stripped).toBe(plain.freeze.bytes);
    // The hash names the bytes, so the freeze moves — the records did not.
    expect(ran.freeze.hash).not.toBe(plain.freeze.hash);
  });

  test("extra keys on the run object cannot observe the map", () => {
    const sentence = "the target came back with no place on the map";
    const clean = assemblePacket(input({ run: { sentences: [sentence] } }));
    const sneaky = assemblePacket(
      input({
        run: {
          sentences: [sentence],
          region: { selection: ["soil"] },
          words: [{ slug: "soil" }],
          attempts: 99,
          key: "another-key",
          source: "the run",
        } as never,
      }),
    );
    expect(sneaky.freeze.bytes).toBe(clean.freeze.bytes);
    expect(sneaky.region).toEqual(clean.region);
  });

  test("the run state's sentences are the block's, and only for its move and target", () => {
    const run = createRunState();
    const first = "the base pin no longer matches what stands";
    const second = "the target came back with no place on the map";
    const outside = "a refusal about another target";
    run.recordRefusedAttempt(refused("pin", first));
    run.recordRefusedAttempt(refused("dangling-target", second));
    run.recordRefusedAttempt(refused("pin", outside, SOIL_TARGET));
    expect(run.sentencesForTarget(MOVE, RAIN_TARGET)).toEqual([first, second]);
    expect(run.sentencesForTarget(MOVE, SOIL_TARGET)).toEqual([outside]);
    const bytes = assemblePacket(
      input({ run: { sentences: run.sentencesForTarget(MOVE, RAIN_TARGET) } }),
    ).freeze.bytes;
    expect(bytes).toContain(first);
    expect(bytes).toContain(second);
    expect(bytes).not.toContain(outside);
  });
});

describe("the discard: the run is the session's open moment", () => {
  const CONTEXT: GhostContext = { level: "dynamics", scenario: null };
  const GONE_TARGET: GhostTarget = { kind: "word", slug: "gone" };

  test("two same-key intakes: the packet carries the prior sentence; close drops it, nothing on disk", async () => {
    await withWorkspace(async (scratch) => {
      const before = treeOf(scratch.path);
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const body = agentReply({ target: { kind: "word", slug: "gone" } });
      const first = await session.intake(body, CONTEXT);
      const second = await session.intake(body, CONTEXT);
      expect(first.ok).toBe(false);
      expect(second.ok).toBe(false);
      expect(first.issues[0]?.code).toBe("dangling-target");
      const sentences = session.priorRefusals(MOVE, GONE_TARGET);
      expect(sentences).toEqual([first.issues[0]?.message ?? ""]);
      const carried = assemblePacket(input({ run: { sentences } }));
      expect(carried.freeze.bytes).toContain(PACKET_RUN_HEADING);
      expect(carried.freeze.bytes).toContain(sentences[0] ?? "");
      // No trail: two refusals at the same key, ONE sentence.
      expect(carried.freeze.bytes.split(sentences[0] ?? "\u0000")).toHaveLength(2);

      // A third same-key failure reaches N — in run state only.
      const third = await session.intake(body, CONTEXT);
      expect(third.ok).toBe(false);
      expect(session.runAttempts(MOVE, GONE_TARGET, "dangling-target")).toBe(
        N_RUN_LIMIT,
      );
      expect(session.priorRefusals(MOVE, GONE_TARGET)).toHaveLength(1);

      // Nothing was written at any point: no inbox folder, the tree is identical.
      expect(treeOf(scratch.path)).toEqual(before);

      // Close: the run is gone, so the block is gone.
      await session.open();
      expect(session.priorRefusals(MOVE, GONE_TARGET)).toEqual([]);
      expect(session.runAttempts(MOVE, GONE_TARGET, "dangling-target")).toBe(0);
      const after = assemblePacket(
        input({ run: { sentences: session.priorRefusals(MOVE, GONE_TARGET) } }),
      );
      expect(after.freeze.bytes).not.toContain(PACKET_RUN_HEADING);
      expect(after.freeze.bytes).toBe(assemblePacket(input()).freeze.bytes);
      expect(treeOf(scratch.path)).toEqual(before);
    });
  });

  test("the ask surface carries the session's sentences into the packet", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const refusedIntake = await session.intake(
        agentReply({
          target: { kind: "word", slug: "soil" },
          params: { text: "the soil holds water" },
        }),
        CONTEXT,
      );
      expect(refusedIntake.ok).toBe(false);
      expect(refusedIntake.issues[0]?.code).toBe("append-only");
      const baseAsk = {
        workspacePath: scratch.path,
        fs: scratch.fs,
        context: CONTEXT,
        request: { move: MOVE, target: SOIL_TARGET },
        person: { selection: null },
        view: view(),
      };
      const carried = await askForPacket({
        ...baseAsk,
        priorRefusals: session.priorRefusals(MOVE, SOIL_TARGET),
      });
      expect(carried.ok).toBe(true);
      if (!carried.ok) throw new Error("expected a packet");
      expect(carried.packet.freeze.bytes).toContain(PACKET_RUN_HEADING);
      // The sentence rides verbatim; the packet wraps prose, so read it with
      // its line wraps unfolded.
      expect(sectionOf(carried.packet.freeze.bytes).replace(/\n/g, " ")).toContain(
        refusedIntake.issues[0]?.message ?? "",
      );
      const plain = await askForPacket(baseAsk);
      expect(plain.ok).toBe(true);
      if (!plain.ok) throw new Error("expected a packet");
      expect(plain.packet.freeze.bytes).not.toContain(PACKET_RUN_HEADING);
      // The REQUEST cannot carry the run's state: a smuggled key is ignored.
      const smuggled = await askForPacket({
        ...baseAsk,
        request: {
          ...baseAsk.request,
          priorRefusals: ["a smuggled refusal"],
        } as never,
      });
      expect(smuggled.ok).toBe(true);
      if (!smuggled.ok) throw new Error("expected a packet");
      expect(smuggled.packet.freeze.bytes).toBe(plain.packet.freeze.bytes);
      expect(PACKET_REQUEST_KEYS).toEqual(["move", "target"]);
    });
  });

  test("a refusal with no readable move or target records no attempt", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const result = await session.intake("I would add a claim about rain.", CONTEXT);
      expect(result.ok).toBe(false);
      expect(session.priorRefusals(MOVE, RAIN_TARGET)).toEqual([]);
      expect(session.runAttempts(MOVE, RAIN_TARGET, "intake")).toBe(0);
    });
  });

  test("an intake that lands records no attempt; closing forgets it", async () => {
    await withWorkspace(async (scratch) => {
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: scratch.fs,
      });
      const landed = await session.intake(agentReply(), CONTEXT);
      expect(landed.ok).toBe(true);
      expect(session.priorRefusals(MOVE, RAIN_TARGET)).toEqual([]);
      expect(session.runAttempts(MOVE, RAIN_TARGET, "append-only")).toBe(0);
      expect(session.registered()).toHaveLength(1);
      await session.open();
      expect(session.registered()).toEqual([]);
    });
  });
});

describe("the source: no writer, no persistence, no voice", () => {
  test("the run state imports no fs, bridge, storage or session module", () => {
    const source = sourceOf("ghost/runState.ts");
    const imports = source.match(/from\s+"[^"]+"/g) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec).toMatch(/from\s+"\.\/(envelope|issues)"/);
    }
    expect(source).not.toMatch(
      /node:fs|@tauri|localStorage|sessionStorage|indexedDB|fetch\(|XMLHttpRequest/,
    );
    expect(source).not.toMatch(/from\s+"\.\/(port|inbox|session|apply)"/);
    expect(source).not.toMatch(/writeText|writeFile|serialize|JSON\.stringify|createMarker/);
  });

  test("the run state has no clock and no randomness (arrival order only)", () => {
    const source = sourceOf("ghost/runState.ts");
    expect(source).not.toMatch(/Date\.now|new Date\(|Math\.random|crypto\./);
  });

  test("the counter is named only in the run state and the packet's bound", () => {
    const named = FILES.filter((file) => sourceOf(file).includes("N_RUN_LIMIT"));
    expect(named.sort()).toEqual(["ghost/packet.ts", "ghost/runState.ts"]);
  });

  /**
   * THE BAN IS ON RENDERING, NOT ON THREADING (Epic 14 story 1's named
   * follow-up; the story-2 scan in ghost-refusal.test.ts is reconciled the
   * same way). The app threads the session's `priorRefusals(move, target)`
   * read into `useGhostRequest`, which hands the sentences to the packet: a
   * prop thread into the ask, never a surface showing the run. So
   * `priorRefusals` may appear inside that one call's options; the counter,
   * the sentences' source and the rest of the run stay out of every .tsx.
   */
  test("no surface RENDERS the counter or the run's sentences; its read rides the ask", () => {
    const surfaces = FILES.filter((file) => file.endsWith(".tsx"));
    expect(surfaces.length).toBeGreaterThan(0);
    const MACHINERY =
      /N_RUN_LIMIT|runAttempts|attemptsFor|sentencesForTarget|RunStrike|limitReached/;
    for (const file of surfaces) {
      const code = codeOf(sourceOf(file));
      const askOptions = callText(code, "useGhostRequest");
      // Outside the ask hook's own options, no surface may name the run.
      const rest = askOptions === null ? code : code.replace(askOptions, " ");
      expect({ file, machinery: MACHINERY.test(rest) }).toEqual({
        file,
        machinery: false,
      });
      expect({ file, read: rest.includes("priorRefusals") }).toEqual({
        file,
        read: false,
      });
      if (askOptions !== null) {
        expect({
          file,
          thread: askOptions.includes("priorRefusals: ghosts.priorRefusals"),
        }).toEqual({ file, thread: true });
      }
    }
  });

  test("the packet's run block is sentences and a heading, never a count (source)", () => {
    const source = sourceOf("ghost/packet.ts");
    expect(source).toContain("N_RUN_LIMIT");
    expect(source).toContain("PACKET_RUN_HEADING");
    // The block's type has two fields, both textual; no count key exists.
    const blockStart = source.indexOf("export interface PacketRunBlock");
    const blockEnd = source.indexOf("\n}", blockStart);
    const block = source.slice(blockStart, blockEnd);
    expect(block).toContain("heading");
    expect(block).toContain("sentences");
    expect(block).not.toMatch(/attempt|count|strike|number/);
  });

  test("no module persists the run (no serialization under the ghost run sources)", () => {
    for (const file of ["ghost/runState.ts", "ghost/session.ts"]) {
      const source = sourceOf(file);
      expect(source).not.toMatch(/localStorage|indexedDB|sessionStorage/);
    }
  });
});
