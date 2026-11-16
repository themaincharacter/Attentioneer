import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GhostMove, GhostTarget } from "../src/ghost/envelope";
import { GHOST_ISSUE_CODES } from "../src/ghost/issues";
import {
  assemblePacket,
  regionOf,
  type PacketInput,
  type PacketView,
  type PacketWord,
} from "../src/ghost/packet";
import {
  REFUSAL_AGENT,
  REFUSAL_CORE,
  REFUSAL_PASTE,
  refusalFor,
  refusalSentence,
  type GhostFlow,
} from "../src/ghost/refusal";
import { ADD_ASSUMPTION, ASSUMPTIONS_FILE } from "../src/ghost/registry";
import { askForPacket } from "../src/ghost/request";
import { createRunState, N_RUN_LIMIT } from "../src/ghost/runState";
import {
  createGhostSession,
  type GhostContext,
  type GhostSession,
} from "../src/ghost/session";
import type { GhostSnapshot } from "../src/ghost/snapshot";
import { marksPath, serializeMarks, type Mark } from "../src/map/marks";
import { loopSlug } from "../src/map/loops";
import { agentReply, withWorkspace, type Workspace } from "./ghost-harness";

/**
 * Epic 14 story 2 — THE REFUSAL AND THE MARK (ADR-0031's final amendments).
 *
 * The refusal: at N = 3 attempts at one run key the harness refuses service,
 * with one sentence in the app's issue vocabulary. The sentence is SCOPED to
 * the flow — an agent flow may say the assistant stops; a paste (or scripted)
 * flow asserts only the refusal and "Nothing was written", never an absent
 * actor, never the person, never a count.
 *
 * The mark: read ONCE at RUN START (the session's open moment). A target that
 * carried an open mark then does not fire the refusal for the run — the mark is
 * READ as "the person has spoken here", never rendered, never a second meaning.
 * A mark cast mid-run is not seen; a mark withdrawn mid-run still stands (and
 * never resets the counter — the refusal may fire in a LATER task). Loops are
 * exempt: a mark has no loop target form.
 *
 * The scans: the region reads only ADR-0026's inputs; run state can never
 * change region, slugs or source; no counter/heat/trail string rides a surface;
 * the killed words are absent; the contact flows are untouched.
 */

const MOVE: GhostMove = { family: "assumption", verb: "add" };
const RAIN_TARGET: GhostTarget = { kind: "word", slug: "rain" };
const SOIL_TARGET: GhostTarget = { kind: "word", slug: "soil" };
const LOOP_TARGET: GhostTarget = { kind: "loop", slug: loopSlug("the water cycle") };
const CONTEXT: GhostContext = { level: "dynamics", scenario: null };
const MARKS = "map/marks.jsonl";
const MARK_RAIN = '{"kind":"open","on":"rain"}\n';

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

/**
 * A reply that names a readable move and target but carries a body key the app
 * does not keep: the same (move, target, issue code) fails every time.
 */
function badReply(target: GhostTarget): string {
  return agentReply({ target, extraKey: "the app keeps no such key" });
}

/** A session that has OPENED (the run start is when marks are read). */
async function opened(
  scratch: Workspace,
  flow?: GhostFlow,
): Promise<GhostSession> {
  const session = createGhostSession({
    workspacePath: scratch.path,
    fs: scratch.fs,
    ...(flow === undefined ? {} : { flow }),
  });
  await session.open();
  return session;
}

/** Refuse one reply three times (the same key) and hand the third result back. */
async function threeTimes(
  session: GhostSession,
  reply: string,
): Promise<readonly { code: string; message: string }[]> {
  await session.intake(reply, CONTEXT);
  await session.intake(reply, CONTEXT);
  const third = await session.intake(reply, CONTEXT);
  return third.issues;
}

function codesOf(issues: readonly { code: string }[]): string[] {
  return issues.map((entry) => entry.code);
}

/* ------------------------------------------------------------------------- *
 * The source, as the scans read it (the story-1 idiom).
 * ------------------------------------------------------------------------- */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

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

/** Every file under a folder, relative to it, with its bytes. */
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

const FILES = sourceFiles();
const SURFACES = FILES.filter((file) => file.endsWith(".tsx"));

/* ------------------------------------------------------------------------- *
 * 1. THE TRIGGER — N = 3 at one run key.
 * ------------------------------------------------------------------------- */

describe("the trigger: the third same-key failure refuses service", () => {
  test("the first two failures answer as before; the third speaks the refusal", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const reply = badReply(RAIN_TARGET);
      const first = await session.intake(reply, CONTEXT);
      const second = await session.intake(reply, CONTEXT);
      expect(codesOf(first.issues)).toEqual(["unknown-key"]);
      expect(codesOf(second.issues)).toEqual(["unknown-key"]);
      expect(second.issues[0]?.message).not.toBe(REFUSAL_PASTE);

      const third = await session.intake(reply, CONTEXT);
      expect(codesOf(third.issues)).toEqual(["stop"]);
      expect(third.issues).toHaveLength(1);
      expect(third.issues[0]?.message).toBe(REFUSAL_PASTE);
      expect(third.ok).toBe(false);
      expect(third.envelope).toBeNull();
      expect(third.path).toBeNull();

      // The counter is the run's, and it is at the bound (never rendered).
      expect(
        session.runAttempts(MOVE, RAIN_TARGET, "unknown-key"),
      ).toBe(N_RUN_LIMIT);
    });
  });

  test("a fourth and fifth same-key failure still refuse (the bound is not a one-shot)", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const reply = badReply(RAIN_TARGET);
      await threeTimes(session, reply);
      for (let index = 0; index < 2; index += 1) {
        const later = await session.intake(reply, CONTEXT);
        expect(codesOf(later.issues)).toEqual(["stop"]);
      }
      expect(
        session.runAttempts(MOVE, RAIN_TARGET, "unknown-key"),
      ).toBe(N_RUN_LIMIT + 2);
    });
  });

  test("different keys are independent: another target never adds up", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const rain = badReply(RAIN_TARGET);
      const soil = badReply(SOIL_TARGET);
      for (let index = 0; index < 2; index += 1) {
        await session.intake(rain, CONTEXT);
        await session.intake(soil, CONTEXT);
      }
      const thirdRain = await session.intake(rain, CONTEXT);
      expect(codesOf(thirdRain.issues)).toEqual(["stop"]);
      // Soil is still at two attempts, so it has not fired.
      expect(session.runAttempts(MOVE, SOIL_TARGET, "unknown-key")).toBe(2);
      const thirdSoil = await session.intake(soil, CONTEXT);
      expect(codesOf(thirdSoil.issues)).toEqual(["stop"]);
    });
  });

  test("the issue code is part of the key: another code at one target never adds up", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const unknown = badReply(SOIL_TARGET);
      // The same standing claim re-stated: append-only, one attempt at ITS key.
      const duplicate = agentReply({
        target: SOIL_TARGET,
        params: { text: "the soil holds water" },
      });
      await session.intake(unknown, CONTEXT);
      await session.intake(unknown, CONTEXT);
      const duplicateResult = await session.intake(duplicate, CONTEXT);
      expect(codesOf(duplicateResult.issues)).toEqual(["append-only"]);
      expect(session.runAttempts(MOVE, SOIL_TARGET, "append-only")).toBe(1);
      // The unknown-key key reaches three and fires; the other key did not.
      const third = await session.intake(unknown, CONTEXT);
      expect(codesOf(third.issues)).toEqual(["stop"]);
      expect(session.runAttempts(MOVE, SOIL_TARGET, "append-only")).toBe(1);
    });
  });

  test("the refusal is not a lock: a valid reply after two failures still lands", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const reply = badReply(RAIN_TARGET);
      await session.intake(reply, CONTEXT);
      await session.intake(reply, CONTEXT);
      const landed = await session.intake(agentReply(), CONTEXT);
      expect(landed.ok).toBe(true);
      expect(landed.envelope).not.toBeNull();
      // Two attempts at the failing key; the landing is not an attempt at any.
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(2);
    });
  });

  test("the refusal's code is the app's data vocabulary; the sentence is not a code", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const third = await threeTimes(session, badReply(RAIN_TARGET));
      expect(GHOST_ISSUE_CODES).toContain(third[0]?.code ?? "");
      expect(GHOST_ISSUE_CODES).toContain("stop");
      // The person sees the sentence, never the code.
      expect(third[0]?.message).not.toContain("stop");
    });
  });
});

/* ------------------------------------------------------------------------- *
 * 2. THE SENTENCE'S SCOPE — agent vs paste.
 * ------------------------------------------------------------------------- */

describe("the sentence is scoped to the flow (two flows, two sentences)", () => {
  test("the paste (scripted) flow names no absent actor", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch); // the default: paste
      const third = await threeTimes(session, badReply(RAIN_TARGET));
      expect(third).toHaveLength(1);
      expect(third[0]?.message).toBe(REFUSAL_PASTE);
      expect(REFUSAL_PASTE).toBe(REFUSAL_CORE);
      expect(REFUSAL_PASTE).not.toMatch(/\b(assistant|agent|model|llm)\b/i);
    });
  });

  test("the agent flow says the assistant stops here, and only it", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch, "agent");
      const third = await threeTimes(session, badReply(RAIN_TARGET));
      expect(third[0]?.message).toBe(REFUSAL_AGENT);
      expect(REFUSAL_AGENT).toBe("the assistant stops here: " + REFUSAL_CORE);
      // The agent's limit is named; the person is not.
      expect(REFUSAL_AGENT).not.toMatch(
        /\b(you|your|yours|person|people|blame|fault|wrong|mistake|should)\b/i,
      );
    });
  });

  test("two surfaces, two sentences: they differ by the assistant's presence only", () => {
    expect(refusalSentence("agent")).toBe(REFUSAL_AGENT);
    expect(refusalSentence("paste")).toBe(REFUSAL_PASTE);
    expect(REFUSAL_AGENT.endsWith(REFUSAL_PASTE)).toBe(true);
    expect(REFUSAL_AGENT).not.toBe(REFUSAL_PASTE);
    // No flow names an absent actor, and neither counts anything.
    for (const sentence of [REFUSAL_CORE, REFUSAL_AGENT, REFUSAL_PASTE]) {
      expect(sentence).toContain("refused again");
      expect(sentence).toContain("Nothing was written");
      expect(sentence).not.toMatch(/\d/);
      expect(sentence).not.toMatch(
        /\b(counter|heat|trail|streak|score|attempt|attempts|count|counts|strike|strikes|times|tries|third|three)\b/i,
      );
      expect(sentence).not.toMatch(
        /\b(you|your|yours|person|people|blame|fault|wrong|mistake|should)\b/i,
      );
      expect(sentence).not.toMatch(/clamp|activation/i);
    }
  });

  test("the refusal is spoken in place of the grammar's sentence, never beside it", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const third = await threeTimes(session, badReply(RAIN_TARGET));
      expect(third).toHaveLength(1);
      expect(third[0]?.code).toBe("stop");
    });
  });

  test("the run keeps the grammar's words: the packet carries them, not the refusal", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      await threeTimes(session, badReply(RAIN_TARGET));
      const sentences = session.priorRefusals(MOVE, RAIN_TARGET);
      expect(sentences).toHaveLength(1);
      expect(sentences[0]).toContain("unknown key");
      const bytes = assemblePacket(input({ run: { sentences } })).freeze.bytes;
      expect(bytes).toContain(sentences[0] ?? "");
      expect(bytes).not.toContain(REFUSAL_PASTE);
      expect(bytes).not.toContain(REFUSAL_AGENT);
    });
  });

  test("the refusal helper fires only at the bound and never over a standing mark", () => {
    const run = createRunState();
    const reply = { move: MOVE, target: RAIN_TARGET };
    const next = () =>
      run.recordRefusedAttempt({
        ...reply,
        issues: [{ code: "unknown-key", message: "unknown key extraKey" }],
      });
    expect(refusalFor(next(), "paste", false)).toBeNull();
    expect(refusalFor(next(), "paste", false)).toBeNull();
    const third = next();
    expect(third.limitReached).toBe(true);
    expect(refusalFor(third, "paste", false)?.code).toBe("stop");
    expect(refusalFor(third, "agent", false)?.message).toBe(REFUSAL_AGENT);
    expect(refusalFor(third, "paste", true)).toBeNull();
    // Another target is another run key, so its first attempt fires nothing.
    expect(
      refusalFor(
        run.recordRefusedAttempt({
          move: MOVE,
          target: SOIL_TARGET,
          issues: [{ code: "unknown-key", message: "unknown key extraKey" }],
        }),
        "paste",
        false,
      ),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------------- *
 * 3. THE MARK RULE — read at RUN START.
 * ------------------------------------------------------------------------- */

describe("the mark rule: read at run start, never live", () => {
  test("a mark on the target at run start stands the refusal down", async () => {
    await withWorkspace(async (scratch) => {
      scratch.write(MARKS, MARK_RAIN);
      const before = treeOf(scratch.path);
      const session = await opened(scratch);
      const reply = badReply(RAIN_TARGET);
      for (let index = 0; index < 5; index += 1) {
        const result = await session.intake(reply, CONTEXT);
        expect(codesOf(result.issues)).toEqual(["unknown-key"]);
      }
      // The read does not reset the counter: the attempts are all there.
      expect(
        session.runAttempts(MOVE, RAIN_TARGET, "unknown-key"),
      ).toBe(5);
      // The mark is READ, never written: the tree is byte-identical.
      expect(treeOf(scratch.path)).toEqual(before);
    });
  });

  test("a mark cast after the run starts is not seen (checked at start, not live)", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch); // no mark yet
      scratch.write(MARKS, MARK_RAIN);
      const third = await threeTimes(session, badReply(RAIN_TARGET));
      expect(codesOf(third)).toEqual(["stop"]);
    });
  });

  test("a mark withdrawn mid-run still stands (the read is fixed at the start)", async () => {
    await withWorkspace(async (scratch) => {
      scratch.write(MARKS, MARK_RAIN);
      const session = await opened(scratch);
      scratch.remove(MARKS);
      const third = await threeTimes(session, badReply(RAIN_TARGET));
      expect(codesOf(third)).toEqual(["unknown-key"]);
      expect(
        session.runAttempts(MOVE, RAIN_TARGET, "unknown-key"),
      ).toBe(N_RUN_LIMIT);
    });
  });

  test("withdrawal does not reset the counter: a LATER task may fire, never this one", async () => {
    await withWorkspace(async (scratch) => {
      scratch.write(MARKS, MARK_RAIN);
      const session = await opened(scratch);
      scratch.remove(MARKS);
      const reply = badReply(RAIN_TARGET);
      const standingDown = await threeTimes(session, reply);
      expect(codesOf(standingDown)).toEqual(["unknown-key"]);

      // A new task (the open moment) reads marks again: no mark now, fresh run.
      await session.open();
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(0);
      const later = await threeTimes(session, reply);
      expect(codesOf(later)).toEqual(["stop"]);
      expect(later[0]?.message).toBe(REFUSAL_PASTE);
    });
  });

  test("the stand-down is per target: a mark elsewhere does not silence this target", async () => {
    await withWorkspace(async (scratch) => {
      scratch.write(MARKS, '{"kind":"open","on":"soil"}\n');
      const session = await opened(scratch);
      const third = await threeTimes(session, badReply(RAIN_TARGET));
      expect(codesOf(third)).toEqual(["stop"]);
    });
  });

  test("loops are exempt: a mark cannot sit on a loop, and a word's slug spells nothing", async () => {
    await withWorkspace(async (scratch) => {
      // A real word whose slug equals the loop's name-derived key, marked open.
      scratch.write(
        "map/references/the-water-cycle.md",
        '---\nname: "the water cycle"\nx: 240\ny: 0\n---\n',
      );
      scratch.write(MARKS, '{"kind":"open","on":"the-water-cycle"}\n');
      const session = await opened(scratch);
      // The loop target is the SAME slug, but its identity is a loop: no mark.
      const third = await threeTimes(session, badReply(LOOP_TARGET));
      expect(codesOf(third)).toEqual(["stop"]);
    });
  });

  test("the run state's mark-read is a target match, never a slug match", () => {
    const run = createRunState();
    run.start([{ kind: "word", slug: "rain" }]);
    expect(run.markedAtStart({ kind: "word", slug: "rain" })).toBe(true);
    expect(run.markedAtStart({ kind: "loop", slug: "rain" })).toBe(false);
    expect(run.markedAtStart({ kind: "spot", x: 1, y: 2 })).toBe(false);
    // A later start replaces the reading; discard forgets it with the run.
    run.start([{ kind: "word", slug: "soil" }]);
    expect(run.markedAtStart({ kind: "word", slug: "rain" })).toBe(false);
    expect(run.markedAtStart({ kind: "word", slug: "soil" })).toBe(true);
    run.discard();
    expect(run.markedAtStart({ kind: "word", slug: "soil" })).toBe(false);
  });

  test("the marks file is never rewritten and a mark's own meaning is untouched", async () => {
    await withWorkspace(async (scratch) => {
      const marks: Mark[] = [
        { kind: "open", target: { type: "word", slug: "rain" }, extra: {} },
      ];
      const bytes = serializeMarks(marks);
      scratch.write(MARKS, bytes);
      const session = await opened(scratch);
      await threeTimes(session, badReply(RAIN_TARGET));
      expect(scratch.read(MARKS)).toBe(bytes);
      // The mark line rides the packet as its record (ADR-0009's own meaning),
      // and the reading is never rendered as words.
      const marked = assemblePacket(
        input({
          view: { ...view(), marks },
        }),
      ).freeze.bytes;
      expect(marked).toContain('{"kind":"open","on":"rain"}');
      expect(marked).not.toContain("the person has spoken here");
      expect(REFUSAL_PASTE).not.toContain("has spoken");
    });
  });

  test("a malformed or unreadable marks file means no marks: the refusal stands", async () => {
    await withWorkspace(async (scratch) => {
      scratch.write(MARKS, "not a mark line at all\n");
      const first = await opened(scratch);
      expect(codesOf(await threeTimes(first, badReply(RAIN_TARGET)))).toEqual([
        "stop",
      ]);
      // A read failure is no marks too: a stand-down is never a guess.
      const throwing = {
        ...scratch.fs,
        async readText(path: string): Promise<string | null> {
          if (path === marksPath(scratch.path)) throw new Error("unreadable");
          return scratch.fs.readText(path);
        },
      };
      const second = createGhostSession({
        workspacePath: scratch.path,
        fs: throwing,
      });
      await second.open();
      expect(codesOf(await threeTimes(second, badReply(RAIN_TARGET)))).toEqual([
        "stop",
      ]);
    });
  });

  test("an orphan mark still stands the target down (the mark line is the person's own)", async () => {
    await withWorkspace(async (scratch) => {
      // PROVISIONAL: the run trusts the mark line as it stands; it never reads
      // the map to grade whether the target still exists.
      scratch.write(MARKS, '{"kind":"open","on":"gone"}\n');
      const session = await opened(scratch);
      const reply = badReply({ kind: "word", slug: "gone" });
      const third = await threeTimes(session, reply);
      expect(codesOf(third)).toEqual(["unknown-key"]);
    });
  });
});

/* ------------------------------------------------------------------------- *
 * 4. THE SCANS — the forbidden observation, scoped.
 * ------------------------------------------------------------------------- */

describe("the scans: the region, the run, the surfaces, the killed words", () => {
  test("the region rule reads the target, the person and the map — nothing computed", () => {
    const code = codeOf(sourceOf("ghost/packet.ts"));
    const start = code.indexOf("export function regionOf(");
    const end = code.indexOf("\n}", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const rule = code.slice(start, end);
    expect(rule).toContain("person.selection");
    expect(rule).toContain("view.words");
    expect(rule).toContain("view.playing");
    // No computed signal may choose, pre-fill or rank the region (ADR-0026).
    for (const word of [
      "mark",
      "claim",
      "loop",
      "veil",
      "run",
      "heat",
      "trail",
      "prior",
      "attempt",
      "pin",
    ]) {
      expect(rule).not.toMatch(new RegExp("\\b" + word, "i"));
    }
    // The ONE call site is the assembler's, and it never hands the run over.
    expect((code.match(/regionOf\(/g) ?? []).length).toBe(2);
    expect(code).toContain(
      "const region = regionOf(input.target, input.person, input.view);",
    );
    expect(code).not.toMatch(/regionOf\([^)]*input\.run/);
    // Only the packet module may name a region at all.
    expect(
      FILES.filter((file) => sourceOf(file).includes("RegionSelection")).sort(),
    ).toEqual(["ghost/packet.ts"]);
    // The person's region starts at the ADR's fallback (no selection) and is
    // handed over as PERSON state, never derived from a record or the run.
    const requestHook = codeOf(sourceOf("ghost/useRequest.ts"));
    expect(requestHook).toContain("useState<readonly string[] | null>(null)");
    expect(requestHook).toContain("person: { selection }");
    expect(requestHook.match(/person\s*:/g) ?? []).toHaveLength(1);
  });

  test("a mark cannot move the region: the fallback is exactly the target and the playing set", () => {
    const marks: Mark[] = [
      { kind: "open", target: { type: "word", slug: "soil" }, extra: {} },
    ];
    const plain = regionOf(RAIN_TARGET, { selection: null }, view());
    const marked = regionOf(
      RAIN_TARGET,
      { selection: null },
      { ...view(), marks },
    );
    expect(marked).toEqual(plain);
    expect(plain).toEqual({
      slugs: ["rain", "soil"],
      source: "the named target and the playing set",
    });
  });

  test("the run state cannot change the packet's region, slugs or source", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      await session.intake(badReply(RAIN_TARGET), CONTEXT);
      await session.intake(badReply(RAIN_TARGET), CONTEXT);
      const sentences = session.priorRefusals(MOVE, RAIN_TARGET);
      expect(sentences).toHaveLength(1);
      const base = {
        workspacePath: scratch.path,
        fs: scratch.fs,
        context: CONTEXT,
        request: { move: MOVE, target: RAIN_TARGET },
        person: { selection: null },
        view: view(),
      };
      const plain = await askForPacket(base);
      const ran = await askForPacket({ ...base, priorRefusals: sentences });
      expect(plain.ok).toBe(true);
      expect(ran.ok).toBe(true);
      if (!plain.ok || !ran.ok) throw new Error("expected packets");
      expect(ran.packet.region).toEqual(plain.packet.region);
      expect(ran.packet.region.source).toBe("the named target and the playing set");
      expect(ran.packet.freeze.bytes).toContain(sentences[0] ?? "");
      // The ONLY difference is the run block; strip it and the packet is plain.
      const heading = "## What this move already came back with";
      const start = ran.packet.freeze.bytes.indexOf(heading);
      const next = ran.packet.freeze.bytes.indexOf("\n## ", start);
      const stripped =
        ran.packet.freeze.bytes.slice(0, start) +
        ran.packet.freeze.bytes.slice(next + 1);
      expect(stripped).toBe(plain.packet.freeze.bytes);
    });
  });

  test("no surface renders the refusal's machinery, the counter or the reading", () => {
    expect(SURFACES.length).toBeGreaterThan(0);
    for (const file of SURFACES) {
      const source = sourceOf(file);
      expect(source).not.toMatch(
        /N_RUN_LIMIT|runAttempts|priorRefusals|attemptsFor|sentencesForTarget|RunStrike|limitReached|refusalFor|refusalSentence|markedAtStart|REFUSAL_(CORE|AGENT|PASTE)|GhostFlow/,
      );
      expect(source).not.toContain("the person has spoken here");
      expect(source).not.toMatch(/\b(heat|trail|streak)\b/i);
    }
  });

  test("the person-facing sentences carry no counter, no heat, no trail, no number", () => {
    for (const sentence of [REFUSAL_CORE, REFUSAL_AGENT, REFUSAL_PASTE]) {
      expect(sentence).not.toMatch(/\d/);
      expect(sentence).not.toMatch(
        /\b(counter|heat|trail|streak|score|attempt|attempts|count|counts|strike|strikes|times|tries|third|three)\b/i,
      );
    }
    // The packet's run block is sentences only: no negative-space string rides.
    const sentences = ["the run already said this once", "and this once"];
    const bytes = assemblePacket(input({ run: { sentences } })).freeze.bytes;
    expect(bytes).not.toMatch(/\b(heat|trail|streak|score)\b/i);
    expect(bytes).not.toMatch(/\bcounter\b/i);
  });

  test("the refusal module is pure: no file, no bridge, no store, no write", () => {
    const source = sourceOf("ghost/refusal.ts");
    const imports = source.match(/from\s+"[^"]+"/g) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec).toMatch(/from\s+"\.\/(issues|runState)"/);
    }
    expect(source).not.toMatch(
      /node:fs|@tauri|localStorage|sessionStorage|indexedDB|fetch\(|writeText|saveMarks|marksPath/,
    );
  });

  test("the run never reads or writes a mark; the session reads marks ONCE, at open", () => {
    for (const file of ["ghost/runState.ts", "ghost/refusal.ts"]) {
      expect(sourceOf(file)).not.toMatch(/map\/marks|marksPath|parseMarks|markKey/);
    }
    const session = sourceOf("ghost/session.ts");
    expect(session).toContain("parseMarks");
    expect(session).toContain("run.start(await markedTargetsNow());");
    expect(session).not.toMatch(
      /saveMarks|withMark\(|withoutMark|serializeMarks|retargetMark|loadMarks|writeText\(marksPath/,
    );
    // The mark is read at the open moment only: never per intake.
    const open = session.slice(
      session.indexOf("async open("),
      session.indexOf("async intake("),
    );
    expect(open).toContain("markedTargetsNow");
    const intake = session.slice(
      session.indexOf("async intake("),
      session.indexOf("async accept("),
    );
    expect(intake).not.toContain("markedTargetsNow");
  });

  test("the killed words are absent from every shipped source file", () => {
    for (const file of FILES) {
      expect(sourceOf(file)).not.toMatch(/\bactivation\b/i);
      expect(sourceOf(file)).not.toMatch(/reversible\s+clamp/i);
    }
  });

  test("the contact flows are untouched: no run state, no refusal", () => {
    const contacts = FILES.filter((file) => file.startsWith("contacts/"));
    expect(contacts.length).toBeGreaterThan(0);
    for (const file of contacts) {
      expect(sourceOf(file)).not.toMatch(
        /runState|refusalFor|refusalSentence|markedAtStart|N_RUN_LIMIT|GhostFlow/,
      );
    }
  });
});
