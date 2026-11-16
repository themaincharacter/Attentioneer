import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { GhostMove, GhostTarget } from "../src/ghost/envelope";
import { GHOST_ISSUE_CODES } from "../src/ghost/issues";
import {
  boundedRunSentences,
  PACKET_RUN_HEADING,
  runBlockOf,
  type Packet,
  type PacketView,
  type PacketWord,
} from "../src/ghost/packet";
import type { GhostFs } from "../src/ghost/port";
import {
  REFUSAL_AGENT,
  REFUSAL_CORE,
  REFUSAL_PASTE,
  type GhostFlow,
} from "../src/ghost/refusal";
import { askForPacket, PACKET_REQUEST_KEYS } from "../src/ghost/request";
import { N_RUN_LIMIT } from "../src/ghost/runState";
import {
  createGhostSession,
  type GhostContext,
  type GhostSession,
} from "../src/ghost/session";
import { marksPath, type Mark } from "../src/map/marks";
import { loopSlug } from "../src/map/loops";
import {
  agentReply,
  tracedFs,
  withWorkspace,
  type Workspace,
} from "./ghost-harness";

/**
 * Epic 14 story 3 — THE EPIC CHECK at the RECORD layer.
 *
 * The locked check (Epic 14 check and slice, its Answer) has THREE HALVES, kept
 * apart on purpose:
 *
 *   - THIS FILE walks the RECORD half, in the check's own order: two same-key
 *     refused intakes -> the next packet carries the prior refusal SENTENCE in
 *     its bounded run block (N = 3; one line per refusal key, never a trail);
 *     the third same-key failure refuses LOUDLY with the scoped sentence (agent
 *     vs paste; no "you", no verdict, no count), and nothing was written; a mark
 *     on the target at RUN START stands the refusal down (the read is fixed at
 *     open, a withdrawn mark never resets the counter, loops are exempt, a
 *     failed marks read is fail-closed); a valid reply after two failures still
 *     lands (the run is not a lock); closing the session loses the trace (the
 *     fixture tree is byte-identical; no attempt, no counter, no clamp on disk);
 *     the run state can never change the packet's region, slugs or source; and
 *     the negative space holds (no counter/heat/trail on a surface; the killed
 *     words "activation" and "reversible clamp" stay absent; the packet's run
 *     block has no numeric leaf).
 *
 *   - The APPARATUS half (the person marks the target and closes by hand, and
 *     says it aloud) stays QUEUED. It is deliberately NOT asserted here: a test
 *     cannot run a human's hand or its say-it.
 *
 *   - The JUDGE half (an external, arm-blind judge reads the transcript and
 *     answers the theme's falsifier — "did the packet lack context the run
 *     needed?") is a LEAD, never pass/fail, and stays QUEUED too. The
 *     non-repetition itself is transcript-only: the judge's reading, not this
 *     check's.
 *
 * NO CROSS-RECORD GROWTH: the run adds no record family (it is ephemeral, and
 * the record modules are untouched), so the scans live HERE rather than in a
 * cross-record suite. A retired phrase is retired everywhere in app/ source and
 * docs: "activation" (killed-unshipped, its word struck) and "reversible clamp"
 * (the name collapsed to the refusal + the person's mark). The bare word
 * "clamp" survives only as the hand-crank's step-note kind — a different thing.
 *
 * The check's own words: "in one ghost session, an intake fails with its
 * refusal sentence; a second intake with the same (move, target, issue code)
 * sees the prior sentence in the packet's bounded run block (N = 3 — never
 * counts, never a trail) and the harness carries the same refusal; at the
 * third, service refuses loudly — 'this move came back refused again. Nothing
 * was written.' ... A mark on the target at RUN START stands the refusal down
 * (checked at start, not live; withdrawing it does not reset the counter).
 * Close the session: the trace is gone (quit, reopen — no attempt, no counter,
 * no clamp on disk; run state can never change region, slugs or source)."
 *
 * The fixture is the ghost harness's own seed (rain / soil, the water cycle,
 * one standing claim), on a REAL temp workspace: every fs claim below is made
 * against bytes on disk, and the marks read is exercised through the session's
 * own port.
 *
 * NAMED FOLLOW-UP (outside this record-layer story): the app's React ask hook
 * (ghost/useRequest.ts) does not yet forward the session's prior refusals to
 * askForPacket; the record-layer ask asserted here does. Wiring the hook is the
 * apparatus/human pass's, and it must keep the surfaces' silence (the story-2
 * scan forbids the run's names in a .tsx file).
 */

const APP = fileURLToPath(new URL("..", import.meta.url)).replace(
  /\/+$/,
  "",
);
const SRC = join(APP, "src");
const NL = "\n";
const MARKS = "map/marks.jsonl";
const MARK_RAIN = '{"kind":"open","on":"rain"}' + NL;

const MOVE: GhostMove = { family: "assumption", verb: "add" };
const RAIN_TARGET: GhostTarget = { kind: "word", slug: "rain" };
const SOIL_TARGET: GhostTarget = { kind: "word", slug: "soil" };
const LOOP_TARGET: GhostTarget = {
  kind: "loop",
  slug: loopSlug("the water cycle"),
};
const CONTEXT: GhostContext = { level: "dynamics", scenario: null };

/** The locked check's own sentence, verbatim (the paste flow's words). */
const CHECK_SENTENCE =
  "this move came back refused again. Nothing was written.";

/** The words no refusal may speak: a person, a verdict, a reproach. */
const YOU_VERDICT =
  /\b(you|your|yours|yourself|person|people|blame|fault|guilt|wrong|mistake|should|verdict|unfit|failure|failed|fail)\b/i;

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

/** The map's records as the app hands them to the packet (the region's view). */
function view(marks: readonly Mark[] = []): PacketView {
  return {
    words: [RAIN, SOIL],
    playing: ["rain", "soil"],
    marks,
    claims: [],
    loops: [],
    veils: [],
  };
}

/* ------------------------------------------------------------------------- *
 * The fixture's files and the source/doc scans (the story-1/2 idiom).
 * ------------------------------------------------------------------------- */

/** Every file under a folder, relative to it, with its exact bytes. */
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

/** Everything the fixture's disk says, names and bytes (the on-disk trace). */
function diskTextOf(root: string): string {
  return Object.entries(treeOf(root))
    .flatMap(([path, text]) => [path, text])
    .join(NL);
}

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

const FILES = sourceFiles();
const SURFACES = FILES.filter((file) => file.endsWith(".tsx"));

/** The app's docs (only app/ is tracked; nothing outside it is read). */
const DOC_SKIP = new Set(["node_modules", "dist", "public", "src-tauri"]);
function docFiles(dir = APP, base = APP): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    if (entry.isDirectory()) {
      if (!DOC_SKIP.has(entry.name)) out.push(...docFiles(join(dir, entry.name), base));
    } else if (entry.name.endsWith(".md")) {
      out.push(join(dir, entry.name).slice(base.length + 1));
    }
  }
  return out;
}

const DOCS = docFiles();

function docOf(relative: string): string {
  return readFileSync(join(APP, relative), "utf8");
}

/* ------------------------------------------------------------------------- *
 * The session and the packet, as the app walks them.
 * ------------------------------------------------------------------------- */

/** A session that has OPENED — the run start is when marks are read. */
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

/**
 * A reply that names a readable move and target but carries a body key the app
 * does not keep: the same (move, target, issue code) fails every time.
 */
function badReply(target: GhostTarget = RAIN_TARGET): string {
  return agentReply({ target, extraKey: "the app keeps no such key" });
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

/** The ask the app makes: the session's prior sentences are handed over. */
async function askPacket(
  scratch: Workspace,
  priorRefusals: readonly string[] = [],
  target: GhostTarget = RAIN_TARGET,
  packetView: PacketView = view(),
): Promise<Packet> {
  const result = await askForPacket({
    workspacePath: scratch.path,
    fs: scratch.fs,
    context: CONTEXT,
    request: { move: MOVE, target },
    person: { selection: null },
    priorRefusals,
    view: packetView,
  });
  if (!result.ok) {
    throw new Error(result.issues.map((entry) => entry.message).join("; "));
  }
  return result.packet;
}

/** The block's section, as the packet's bytes carry it (heading to next "## "). */
function sectionOf(bytes: string): string {
  const start = bytes.indexOf(PACKET_RUN_HEADING);
  if (start === -1) return "";
  const end = bytes.indexOf("\n## ", start);
  return bytes.slice(start, end === -1 ? undefined : end);
}

/** A text block with its line wraps unfolded, so a sentence can be counted. */
function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function countIn(text: string, part: string): number {
  return text.split(part).length - 1;
}

function messageOf(issues: readonly { message: string }[]): string {
  return issues[0]?.message ?? "";
}

/* ========================================================================= *
 * (a) Two same-key refusals, and the packet's bounded run block.
 * ========================================================================= */

describe("(a) the same key fails twice: the packet carries the prior sentence, once", () => {
  test("the first refusal's sentence rides the very next packet under its heading", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const first = await session.intake(badReply(), CONTEXT);
      expect(first.ok).toBe(false);
      expect(first.issues).toHaveLength(1);
      expect(first.issues[0]?.code).toBe("unknown-key");
      const sentence = messageOf(first.issues);
      expect(sentence).toBe('unknown key "extraKey"');
      expect(session.priorRefusals(MOVE, RAIN_TARGET)).toEqual([sentence]);

      // A run with nothing to say shows no block at all (no "none" line).
      const plain = await askPacket(scratch);
      expect(plain.freeze.bytes).not.toContain(PACKET_RUN_HEADING);

      const carried = await askPacket(
        scratch,
        session.priorRefusals(MOVE, RAIN_TARGET),
      );
      expect(carried.freeze.bytes).toContain(PACKET_RUN_HEADING);
      const section = sectionOf(carried.freeze.bytes);
      // ONE sentence: not one per attempt, not a trail.
      expect(countIn(flat(section), sentence)).toBe(1);
      expect(carried.freeze.bytes.split(PACKET_RUN_HEADING)).toHaveLength(2);
    });
  });

  test("a second same-key failure carries the same refusal, and the block stays ONE line", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const reply = badReply();
      const first = await session.intake(reply, CONTEXT);
      const second = await session.intake(reply, CONTEXT);
      const sentence = messageOf(first.issues);
      expect(second.ok).toBe(false);
      expect(second.issues).toHaveLength(1);
      expect(second.issues[0]?.code).toBe("unknown-key");
      expect(second.issues[0]?.message).toBe(sentence);
      // The key is the same one; the run has one sentence for it.
      expect(session.priorRefusals(MOVE, RAIN_TARGET)).toEqual([sentence]);
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(2);

      const carried = await askPacket(
        scratch,
        session.priorRefusals(MOVE, RAIN_TARGET),
      );
      const section = sectionOf(carried.freeze.bytes);
      expect(countIn(flat(section), sentence)).toBe(1);
      expect(carried.freeze.bytes.split(PACKET_RUN_HEADING)).toHaveLength(2);

      // The bound is N = 3 and the block dedupes: a repeated sentence is one line.
      expect(N_RUN_LIMIT).toBe(3);
      expect(boundedRunSentences([sentence, sentence, sentence])).toEqual([
        sentence,
      ]);
      expect(
        runBlockOf({ sentences: [sentence, sentence, sentence] })?.sentences,
      ).toEqual([sentence]);
    });
  });

  test("the block is bounded by N: five prior refusals ride as three, never as a trail", () => {
    const sentences = [
      "the first refusal came back",
      "the second refusal came back",
      "the third refusal came back",
      "the fourth refusal came back",
      "the fifth refusal came back",
    ];
    expect(N_RUN_LIMIT).toBe(3);
    expect(boundedRunSentences(sentences)).toEqual(
      sentences.slice(0, N_RUN_LIMIT),
    );
    const block = runBlockOf({ sentences });
    expect(block?.heading).toBe(PACKET_RUN_HEADING);
    expect(block?.sentences).toEqual(sentences.slice(0, N_RUN_LIMIT));
    // No numeric leaf stands in for the count.
    expect(JSON.stringify(block)).not.toMatch(/\d/);
  });

  test("another target's refusal never rides this move's block", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const soil = await session.intake(badReply(SOIL_TARGET), CONTEXT);
      expect(soil.issues[0]?.code).toBe("unknown-key");
      expect(messageOf(soil.issues)).toBe('unknown key "extraKey"');
      expect(session.priorRefusals(MOVE, RAIN_TARGET)).toEqual([]);
      const plain = await askPacket(scratch);
      const carried = await askPacket(
        scratch,
        session.priorRefusals(MOVE, RAIN_TARGET),
      );
      expect(carried.freeze.bytes).toBe(plain.freeze.bytes);
    });
  });
});

/* ========================================================================= *
 * (b) The third same-key failure: the loud, scoped refusal.
 * ========================================================================= */

describe("(b) the third same-key failure refuses loudly, scoped, and writes nothing", () => {
  test("the paste flow says the check's sentence and nothing else", async () => {
    await withWorkspace(async (scratch) => {
      const before = treeOf(scratch.path);
      const traced = tracedFs(scratch.fs);
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: traced.fs,
      });
      await session.open();
      const reply = badReply();
      await session.intake(reply, CONTEXT);
      await session.intake(reply, CONTEXT);
      const third = await session.intake(reply, CONTEXT);

      expect(third.ok).toBe(false);
      expect(third.issues).toHaveLength(1);
      expect(third.issues[0]?.code).toBe("stop");
      expect(third.issues[0]?.message).toBe(REFUSAL_PASTE);
      expect(third.envelope).toBeNull();
      expect(third.path).toBeNull();
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(
        N_RUN_LIMIT,
      );
      // Nothing was written: no fs write, no remove, no marker.
      expect(traced.trace.calls).toEqual([]);
      expect(treeOf(scratch.path)).toEqual(before);
    });
  });

  test("the agent flow says the assistant stops here, and only it", async () => {
    await withWorkspace(async (scratch) => {
      const before = treeOf(scratch.path);
      const session = await opened(scratch, "agent");
      const third = await threeTimes(session, badReply());
      expect(third).toHaveLength(1);
      expect(third[0]?.code).toBe("stop");
      expect(third[0]?.message).toBe(REFUSAL_AGENT);
      // The present assistant is named; the person is not.
      expect(REFUSAL_AGENT.startsWith("the assistant stops here: ")).toBe(true);
      expect(REFUSAL_AGENT.endsWith(REFUSAL_PASTE)).toBe(true);
      expect(third[0]?.message).not.toMatch(YOU_VERDICT);
      expect(treeOf(scratch.path)).toEqual(before);
    });
  });

  test("the two sentences differ by the assistant's presence only", () => {
    expect(REFUSAL_PASTE).toBe(CHECK_SENTENCE);
    expect(REFUSAL_CORE).toBe(CHECK_SENTENCE);
    expect(REFUSAL_PASTE).not.toMatch(/\b(assistant|agent|model|llm)\b/i);
    expect(REFUSAL_AGENT).toContain("the assistant stops here");
    expect(REFUSAL_AGENT).not.toMatch(YOU_VERDICT);
    for (const sentence of [REFUSAL_CORE, REFUSAL_PASTE, REFUSAL_AGENT]) {
      expect(sentence).not.toMatch(/\d/);
      expect(sentence).not.toMatch(
        /\b(counter|heat|trail|streak|score|attempt|attempts|count|counts|strike|strikes|times|tries|third|three)\b/i,
      );
      expect(sentence).not.toMatch(/clamp|activation/i);
      expect(sentence).toContain("Nothing was written");
    }
  });

  test("the refusal replaces the grammar's sentence for that attempt, never beside it", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const third = await threeTimes(session, badReply());
      expect(third).toHaveLength(1);
      expect(third[0]?.code).toBe("stop");
      // The run kept the grammar's words, so the packet carries THOSE.
      const packet = await askPacket(
        scratch,
        session.priorRefusals(MOVE, RAIN_TARGET),
      );
      expect(flat(packet.freeze.bytes)).toContain('unknown key "extraKey"');
      expect(packet.freeze.bytes).not.toContain(REFUSAL_PASTE);
      expect(packet.freeze.bytes).not.toContain(REFUSAL_AGENT);
    });
  });

  test("the refusal's code is the app's vocabulary; the person sees the sentence", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const third = await threeTimes(session, badReply());
      expect(GHOST_ISSUE_CODES).toContain(third[0]?.code ?? "");
      expect(GHOST_ISSUE_CODES).toContain("stop");
      expect(third[0]?.message).not.toContain("stop");
    });
  });
});

/* ========================================================================= *
 * (c) The mark at run start stands the refusal down.
 * ========================================================================= */

describe("(c) a mark at RUN START stands the refusal down", () => {
  test("a marked target never fires, and the attempts never reset", async () => {
    await withWorkspace(async (scratch) => {
      scratch.write(MARKS, MARK_RAIN);
      const before = treeOf(scratch.path);
      const session = await opened(scratch);
      const reply = badReply();
      for (let index = 0; index < 5; index += 1) {
        const result = await session.intake(reply, CONTEXT);
        expect(result.issues[0]?.code).toBe("unknown-key");
        expect(result.issues[0]?.message).not.toBe(REFUSAL_PASTE);
      }
      // The stand-down never resets the count; it is at five.
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(5);
      // The mark is READ, never written: the tree is byte-identical.
      expect(treeOf(scratch.path)).toEqual(before);
      expect(scratch.read(MARKS)).toBe(MARK_RAIN);
    });
  });

  test("the read is fixed at open: a mark cast mid-run is not seen", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      scratch.write(MARKS, MARK_RAIN);
      const third = await threeTimes(session, badReply());
      expect(third).toHaveLength(1);
      expect(third[0]?.code).toBe("stop");
      expect(third[0]?.message).toBe(REFUSAL_PASTE);
    });
  });

  test("a withdrawn mark still stands; the counter survives, and a LATER task fires", async () => {
    await withWorkspace(async (scratch) => {
      scratch.write(MARKS, MARK_RAIN);
      const session = await opened(scratch);
      scratch.remove(MARKS);
      const reply = badReply();
      const firstTask = await threeTimes(session, reply);
      expect(firstTask[0]?.code).toBe("unknown-key");
      // The withdrawal did not reset the count: three attempts stand.
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(
        N_RUN_LIMIT,
      );

      // A new task (the open moment) reads marks again: no mark now, fresh run.
      await session.open();
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(0);
      const later = await threeTimes(session, reply);
      expect(later[0]?.code).toBe("stop");
      expect(later[0]?.message).toBe(REFUSAL_PASTE);
    });
  });

  test("loops are exempt: a word mark whose slug spells the loop's name stands the word down, never the loop", async () => {
    await withWorkspace(async (scratch) => {
      // A real word whose slug equals the loop's name-derived key, marked open.
      scratch.write(
        "map/references/the-water-cycle.md",
        '---\nname: "the water cycle"\nx: 240\ny: 0\n---\n',
      );
      scratch.write(MARKS, '{"kind":"open","on":"the-water-cycle"}' + NL);
      const session = await opened(scratch);
      // The loop target is the SAME slug, but its identity is a loop: no mark.
      const loopThird = await threeTimes(session, badReply(LOOP_TARGET));
      expect(loopThird[0]?.code).toBe("stop");
      // The word target (same slug) IS marked: it stands down.
      const wordThird = await threeTimes(
        session,
        badReply({ kind: "word", slug: "the-water-cycle" }),
      );
      expect(wordThird[0]?.code).toBe("unknown-key");
      expect(wordThird[0]?.message).not.toBe(REFUSAL_PASTE);
    });
  });

  test("fail-closed: a malformed or unreadable marks file means no stand-down", async () => {
    await withWorkspace(async (scratch) => {
      scratch.write(MARKS, "not a mark line at all\n");
      const malformed = await opened(scratch);
      const malformedThird = await threeTimes(malformed, badReply());
      expect(malformedThird[0]?.code).toBe("stop");

      // A read failure is no marks too: a stand-down is the person's act, never a guess.
      const throwing: GhostFs = {
        ...scratch.fs,
        async readText(path: string): Promise<string | null> {
          if (path === marksPath(scratch.path)) throw new Error("unreadable");
          return scratch.fs.readText(path);
        },
      };
      const failed = createGhostSession({
        workspacePath: scratch.path,
        fs: throwing,
      });
      await failed.open();
      const failedThird = await threeTimes(failed, badReply());
      expect(failedThird[0]?.code).toBe("stop");
      expect(failedThird[0]?.message).toBe(REFUSAL_PASTE);
    });
  });

  test("the mark is read, never rendered, and never rewritten", async () => {
    await withWorkspace(async (scratch) => {
      scratch.write(MARKS, MARK_RAIN);
      const session = await opened(scratch);
      const marks: Mark[] = [
        { kind: "open", target: { type: "word", slug: "rain" }, extra: {} },
      ];
      const packet = await askPacket(
        scratch,
        session.priorRefusals(MOVE, RAIN_TARGET),
        RAIN_TARGET,
        view(marks),
      );
      // The mark line rides the packet as its own record (ADR-0009's meaning),
      // and the run's READ of it is never rendered as words.
      expect(packet.freeze.bytes).toContain('{"kind":"open","on":"rain"}');
      expect(packet.freeze.bytes).not.toContain("the person has spoken here");
      expect(REFUSAL_PASTE).not.toContain("has spoken");
      // The file itself is untouched and still says exactly what the person wrote.
      expect(scratch.read(MARKS)).toBe(MARK_RAIN);
    });
  });
});

/* ========================================================================= *
 * (d) The run is not a lock.
 * ========================================================================= */

describe("(d) a valid reply after two failures still lands (the run is not a lock)", () => {
  test("the landing files its proposal; the failures stay failures, not a lock", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      const reply = badReply();
      await session.intake(reply, CONTEXT);
      await session.intake(reply, CONTEXT);

      const landed = await session.intake(agentReply(), CONTEXT);
      expect(landed.ok).toBe(true);
      expect(landed.envelope).not.toBeNull();
      expect(landed.issues).toEqual([]);
      expect(landed.path).toContain(".attentioneer/inbox/");
      expect(session.registered()).toEqual([landed.envelope?.id ?? ""]);
      // The landing is not an attempt at the failing key, and it does not
      // rewrite the run's record.
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(2);
      expect(session.priorRefusals(MOVE, RAIN_TARGET)).toHaveLength(1);
    });
  });

  test("even after the loud refusal, a valid reply still lands", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      await threeTimes(session, badReply());
      const landed = await session.intake(agentReply(), CONTEXT);
      expect(landed.ok).toBe(true);
      expect(landed.envelope).not.toBeNull();
      expect(session.registered()).toHaveLength(1);
    });
  });
});

/* ========================================================================= *
 * (e) Close: the trace is gone, and nothing reached the disk.
 * ========================================================================= */

describe("(e) close the session: the trace is gone, nothing on disk", () => {
  const SEED = [
    "map/assumptions.jsonl",
    "map/loops.jsonl",
    "map/model.json",
    "map/references/rain.md",
    "map/references/soil.md",
  ];

  test("three failures and a landing leave; the close returns the tree byte-identical", async () => {
    await withWorkspace(async (scratch) => {
      const before = treeOf(scratch.path);
      const session = await opened(scratch);
      const reply = badReply();
      await session.intake(reply, CONTEXT);
      await session.intake(reply, CONTEXT);
      await session.intake(reply, CONTEXT);
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(
        N_RUN_LIMIT,
      );
      // The refusals wrote nothing at all.
      expect(treeOf(scratch.path)).toEqual(before);

      // A valid reply lands (an inbox proposal, never a record).
      expect((await session.intake(agentReply(), CONTEXT)).ok).toBe(true);

      // Close: the run and the inbox are discarded; the tree is the seed's.
      await session.open();
      expect(session.priorRefusals(MOVE, RAIN_TARGET)).toEqual([]);
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(0);
      expect(treeOf(scratch.path)).toEqual(before);

      // The block is gone with the run.
      const packet = await askPacket(
        scratch,
        session.priorRefusals(MOVE, RAIN_TARGET),
      );
      expect(packet.freeze.bytes).not.toContain(PACKET_RUN_HEADING);

      // No attempt, no counter, no clamp anywhere on the disk.
      const disk = diskTextOf(scratch.path);
      expect(disk).not.toMatch(
        /\b(attempt|attempts|counter|counts?|clamp|heat|trail|streak)\b/i,
      );
      expect(disk).not.toContain(REFUSAL_PASTE);
      expect(disk).not.toContain(REFUSAL_AGENT);
    });
  });

  test("quit, reopen: a fresh session starts with no attempts and no block", async () => {
    await withWorkspace(async (scratch) => {
      const before = treeOf(scratch.path);
      const first = await opened(scratch);
      await threeTimes(first, badReply());
      await first.open();
      expect(treeOf(scratch.path)).toEqual(before);

      const reopened = await opened(scratch);
      expect(reopened.priorRefusals(MOVE, RAIN_TARGET)).toEqual([]);
      expect(reopened.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(0);
      const packet = await askPacket(scratch);
      expect(packet.freeze.bytes).not.toContain(PACKET_RUN_HEADING);

      // The first fresh failure is attempt ONE, not a resumed count.
      const fresh = await reopened.intake(badReply(), CONTEXT);
      expect(fresh.issues[0]?.code).toBe("unknown-key");
      expect(
        reopened.runAttempts(MOVE, RAIN_TARGET, "unknown-key"),
      ).toBe(1);
      expect(treeOf(scratch.path)).toEqual(before);
    });
  });

  test("the fixture's files ARE the seed: the run added no record file", async () => {
    await withWorkspace(async (scratch) => {
      const before = treeOf(scratch.path);
      const session = await opened(scratch);
      await threeTimes(session, badReply());
      expect(Object.keys(treeOf(scratch.path)).sort()).toEqual(SEED);
      expect(Object.keys(before).sort()).toEqual(SEED);
    });
  });
});

/* ========================================================================= *
 * (f) The forbidden observation: run state can never move the region.
 * ========================================================================= */

describe("(f) run state can never change the packet's region, slugs or source", () => {
  test("strip the block and the packet is the plain one; the records did not move", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      await session.intake(badReply(), CONTEXT);
      const sentences = session.priorRefusals(MOVE, RAIN_TARGET);
      expect(sentences).toHaveLength(1);

      const plain = await askPacket(scratch);
      const ran = await askPacket(scratch, sentences);
      expect(ran.region).toEqual(plain.region);
      expect(ran.region.source).toBe("the named target and the playing set");
      expect(ran.region.slugs).toEqual(plain.region.slugs);
      expect(ran.freeze.pin).toEqual(plain.freeze.pin);
      expect(ran.freeze.registry).toBe(plain.freeze.registry);

      // The ONE difference is the run block: strip it and the bytes are plain.
      const start = ran.freeze.bytes.indexOf(PACKET_RUN_HEADING);
      expect(start).toBeGreaterThan(-1);
      const next = ran.freeze.bytes.indexOf("\n## ", start);
      expect(next).toBeGreaterThan(start);
      const stripped =
        ran.freeze.bytes.slice(0, start) + ran.freeze.bytes.slice(next + 1);
      expect(stripped).toBe(plain.freeze.bytes);
      // The hash names the bytes, so the freeze moves — the records did not.
      expect(ran.freeze.hash).not.toBe(plain.freeze.hash);
    });
  });

  test("the region rule reads the target, the person and the map — never the run", () => {
    const code = codeOf(sourceOf("ghost/packet.ts"));
    const start = code.indexOf("export function regionOf(");
    const end = code.indexOf("\n}", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const rule = code.slice(start, end);
    expect(rule).toContain("person.selection");
    expect(rule).toContain("view.words");
    expect(rule).toContain("view.playing");
    for (const word of [
      "run",
      "mark",
      "claim",
      "loop",
      "veil",
      "heat",
      "trail",
      "prior",
      "attempt",
      "pin",
    ]) {
      expect({ word, found: new RegExp("\\b" + word, "i").test(rule) }).toEqual({
        word,
        found: false,
      });
    }
    // The ONE call site never hands the run over.
    expect(code).toContain(
      "const region = regionOf(input.target, input.person, input.view);",
    );
    expect(code).not.toMatch(/regionOf\([^)]*input\.run/);

    // The run's type is sentences only: no region, slug or source key exists.
    const typeStart = code.indexOf("export interface PacketRun ");
    const typeEnd = code.indexOf("\n}", typeStart);
    const runType = code.slice(typeStart, typeEnd);
    expect(runType).toContain("sentences");
    expect(runType).not.toMatch(/region|slug|source|selection|words/i);

    // The ask forwards the sentences as the run block, never as a region.
    expect(codeOf(sourceOf("ghost/request.ts"))).toContain(
      "run: { sentences: options.priorRefusals ?? [] },",
    );
    expect(PACKET_REQUEST_KEYS).toEqual(["move", "target"]);
  });

  test("the run state imports no packet, session or record module", () => {
    const source = sourceOf("ghost/runState.ts");
    const imports = source.match(/from\s+"[^"]+"/g) ?? [];
    expect(imports.length).toBeGreaterThan(0);
    for (const spec of imports) {
      expect(spec).toMatch(/from\s+"\.\/(envelope|issues)"/);
    }
    const code = codeOf(source);
    expect(code).not.toMatch(/\b(packet|session|region|marks?)\b/i);
  });
});

/* ========================================================================= *
 * (g) The negative space.
 * ========================================================================= */

describe("(g) the negative space: no counter, no heat, no trail, no killed word", () => {
  test("no surface names the run's machinery or its counting words", () => {
    expect(SURFACES.length).toBeGreaterThan(0);
    for (const file of SURFACES) {
      const source = sourceOf(file);
      expect({
        file,
        machinery: /N_RUN_LIMIT|runAttempts|priorRefusals|attemptsFor|sentencesForTarget|RunStrike|limitReached|refusalFor|refusalSentence|markedAtStart|REFUSAL_(CORE|AGENT|PASTE)|GhostFlow/.test(
          source,
        ),
      }).toEqual({ file, machinery: false });
      expect({ file, heat: /\b(heat|trail|streak)\b/i.test(source) }).toEqual({
        file,
        heat: false,
      });
      // Comments may say "counter-scaled"; CODE may not name a counter.
      expect({
        file,
        counter: /\b(counter|attempt|attempts|strike|strikes|count|counts)\b/i.test(
          codeOf(source),
        ),
      }).toEqual({ file, counter: false });
    }
    // The legitimate rendering words exist, so the scan has something to scope:
    // "COUNTER-SCALED" is a camera idiom, not the run's counter.
    expect(sourceOf("canvas/VeilLookUnder.tsx")).toContain("COUNTER-SCALED");
    expect(codeOf(sourceOf("canvas/VeilLookUnder.tsx"))).not.toMatch(
      /\bcounter\b/i,
    );
  });

  test("the counter is run state only: runState.ts and the packet's bound", () => {
    const named = FILES.filter((file) =>
      sourceOf(file).includes("N_RUN_LIMIT"),
    ).sort();
    expect(named).toEqual(["ghost/packet.ts", "ghost/runState.ts"]);
  });

  test("the killed words are absent from every source file and doc", () => {
    for (const file of FILES) {
      const source = sourceOf(file);
      expect({ file, activation: /\bactivation\b/i.test(source) }).toEqual({
        file,
        activation: false,
      });
      expect({
        file,
        clamp: /reversible\s+clamps?/i.test(source),
      }).toEqual({ file, clamp: false });
    }
    expect(DOCS.length).toBeGreaterThan(0);
    for (const doc of DOCS) {
      const text = docOf(doc);
      expect({ doc, activation: /\bactivation\b/i.test(text) }).toEqual({
        doc,
        activation: false,
      });
      expect({ doc, clamp: /reversible\s+clamps?/i.test(text) }).toEqual({
        doc,
        clamp: false,
      });
    }
  });

  test("the packet's run block has no numeric leaf and no counting word", async () => {
    await withWorkspace(async (scratch) => {
      const session = await opened(scratch);
      await session.intake(badReply(), CONTEXT);
      const packet = await askPacket(
        scratch,
        session.priorRefusals(MOVE, RAIN_TARGET),
      );
      const section = sectionOf(packet.freeze.bytes);
      expect(section).not.toMatch(/\d/);
      expect(section).not.toMatch(
        /\b(attempt|attempts|strike|strikes|count|counts|counter|trail|heat|streak|times|tries)\b/i,
      );
      expect(section.split(PACKET_RUN_HEADING)).toHaveLength(2);
    });
  });

  test("the block's own data is two fields, both textual", () => {
    const block = runBlockOf({
      sentences: ['unknown key "extraKey"'],
    });
    expect(block).not.toBeNull();
    if (block === null) throw new Error("expected a block");
    expect(Object.keys(block).sort()).toEqual(["heading", "sentences"]);
    for (const value of Object.values(block)) {
      expect(typeof value).not.toBe("number");
    }
    expect(block.sentences.every((entry) => typeof entry === "string")).toBe(
      true,
    );
    expect(JSON.stringify(block)).not.toMatch(/\d/);
  });
});

/* ========================================================================= *
 * NO cross-record growth: the run adds no record family.
 * ========================================================================= */

describe("no cross-record growth: the run adds no record", () => {
  test("the run modules import no record and hold no writer", () => {
    for (const file of ["ghost/runState.ts", "ghost/refusal.ts"]) {
      const source = sourceOf(file);
      const code = codeOf(source);
      expect({ file, fs: /node:fs|@tauri/.test(code) }).toEqual({
        file,
        fs: false,
      });
      expect({
        file,
        record: /map\/|saveMarks|serializeMarks|writeInbox|recordPath|marksPath/.test(
          code,
        ),
      }).toEqual({ file, record: false });
      expect({
        file,
        writer: /\b(writeText|writeFile|serialize|JSON\.stringify|localStorage|indexedDB|createMarker)\b/.test(
          code,
        ),
      }).toEqual({ file, writer: false });
    }
  });

  test("no module under map/ is a run record, and no path names one", () => {
    const mapFiles = FILES.filter((file) => file.startsWith("map/"));
    expect(mapFiles.length).toBeGreaterThan(0);
    for (const file of mapFiles) {
      expect({
        file,
        runRecord: /run|refus|attempt|clamp|heat|trail/i.test(file),
      }).toEqual({ file, runRecord: false });
    }
    // No serialization of the run/counter/clamp exists anywhere in src.
    const PERSIST =
      /\b(save|write|persist|append|serialize)(Run|Attempt|Refusal|Clamp|Counter)\w*|\b(runPath|runFile|attemptsPath|attemptsFile|clampPath|counterPath)\b/;
    for (const file of FILES) {
      expect({
        file,
        persist: PERSIST.test(codeOf(sourceOf(file))),
      }).toEqual({ file, persist: false });
    }
  });

  test("the refusing path makes no fs write at all (the traced port)", async () => {
    await withWorkspace(async (scratch) => {
      const traced = tracedFs(scratch.fs);
      const session = createGhostSession({
        workspacePath: scratch.path,
        fs: traced.fs,
      });
      await session.open();
      const reply = badReply();
      await session.intake(reply, CONTEXT);
      await session.intake(reply, CONTEXT);
      await session.intake(reply, CONTEXT);
      expect(traced.trace.calls).toEqual([]);
    });
  });

  test("the run's sentence never becomes a record line", async () => {
    await withWorkspace(async (scratch) => {
      const before = treeOf(scratch.path);
      const session = await opened(scratch);
      const reply = badReply();
      await session.intake(reply, CONTEXT);
      await session.intake(reply, CONTEXT);
      await session.intake(reply, CONTEXT);
      // Same paths, same bytes: no file, no log, no trace.
      expect(treeOf(scratch.path)).toEqual(before);
      expect(diskTextOf(scratch.path)).not.toContain('unknown key "extraKey"');
      expect(diskTextOf(scratch.path)).not.toContain(REFUSAL_PASTE);
    });
  });
});

/* ========================================================================= *
 * The retired phrases stay retired — in source AND in the app's docs.
 * ========================================================================= */

describe("source-scan/docs: the retired phrases stay retired", () => {
  test("the killed word and the clamp's retired name appear nowhere in app/", () => {
    for (const file of FILES) {
      expect({
        file,
        activation: /\bactivation\b/i.test(sourceOf(file)),
      }).toEqual({ file, activation: false });
      expect({
        file,
        clamp: /reversible\s+clamps?/i.test(sourceOf(file)),
      }).toEqual({ file, clamp: false });
    }
    for (const doc of DOCS) {
      expect({
        doc,
        activation: /\bactivation\b/i.test(docOf(doc)),
      }).toEqual({ doc, activation: false });
      expect({
        doc,
        clamp: /reversible\s+clamps?/i.test(docOf(doc)),
      }).toEqual({ doc, clamp: false });
    }
  });

  test("the bare word clamp is the hand-crank's step note, never the retired mechanism", () => {
    // A legitimate survivor: the crank's own note kind. It is not the mechanism
    // the epic retired; the retired NAME is the two-word phrase, never the verb.
    expect(sourceOf("canvas/StepCrank.tsx")).toContain('"clamp"');
    expect(codeOf(sourceOf("canvas/StepCrank.tsx"))).toContain("note.kind");
    for (const file of FILES) {
      expect({
        file,
        retired: /reversible\s+clamps?/i.test(sourceOf(file)),
      }).toEqual({ file, retired: false });
    }
  });
});

/* ========================================================================= *
 * The whole check, in the check's order — the record half, one session.
 * ========================================================================= */

describe("the whole check, in the check's order (the record half)", () => {
  test("fail twice; carry the sentence; refuse at the third; land a valid reply; close", async () => {
    await withWorkspace(async (scratch) => {
      const before = treeOf(scratch.path);
      // The run start: no mark, so the refusal will fire. The read is fixed
      // here; nothing later re-reads it.
      const session = await opened(scratch);
      const reply = badReply();

      // 1. An intake fails with its refusal sentence.
      const first = await session.intake(reply, CONTEXT);
      expect(first.ok).toBe(false);
      expect(first.issues[0]?.code).toBe("unknown-key");
      const sentence = messageOf(first.issues);

      // 2. The next packet carries the prior sentence in the bounded block
      //    (one line), and the same refusal comes back on the second intake.
      const asked = await askPacket(scratch, session.priorRefusals(MOVE, RAIN_TARGET));
      expect(countIn(flat(sectionOf(asked.freeze.bytes)), sentence)).toBe(1);
      const second = await session.intake(reply, CONTEXT);
      expect(second.issues[0]?.code).toBe("unknown-key");
      expect(second.issues[0]?.message).toBe(sentence);

      // 3. The third same-key failure refuses loudly with the scoped paste
      //    sentence, and nothing was written.
      const third = await session.intake(reply, CONTEXT);
      expect(third.issues.map((entry) => entry.code)).toEqual(["stop"]);
      expect(third.issues[0]?.message).toBe(REFUSAL_PASTE);
      expect(treeOf(scratch.path)).toEqual(before);

      // 4. A valid reply after the failures still lands (the run is not a lock).
      const landed = await session.intake(agentReply(), CONTEXT);
      expect(landed.ok).toBe(true);
      expect(landed.envelope).not.toBeNull();

      // 5. Close: the trace is gone, the tree is the seed's, and no fresh
      //    packet carries the old block.
      await session.open();
      expect(session.priorRefusals(MOVE, RAIN_TARGET)).toEqual([]);
      expect(session.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(0);
      expect(treeOf(scratch.path)).toEqual(before);
      expect(
        (await askPacket(scratch, session.priorRefusals(MOVE, RAIN_TARGET)))
          .freeze.bytes,
      ).not.toContain(PACKET_RUN_HEADING);

      // 6. Quit, reopen: nothing of the run survives.
      const reopened = await opened(scratch);
      expect(reopened.priorRefusals(MOVE, RAIN_TARGET)).toEqual([]);
      expect(reopened.runAttempts(MOVE, RAIN_TARGET, "unknown-key")).toBe(0);
      expect(treeOf(scratch.path)).toEqual(before);
    });
  });
});
