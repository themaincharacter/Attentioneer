import { afterAll, describe, expect, test } from "bun:test";
import {
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
import { fileURLToPath } from "node:url";
import {
  SESSION_CURATOR_FAILED_SENTENCE,
  SESSION_DISTIL_NO_TASK_SENTENCE,
  sessionDistilBrief,
  writeCuratedRunCard,
  type DistilledCardWriter,
  type SessionCuratorInput,
} from "../src/canvas/sessionCurator";
import {
  SessionCard,
  type SessionCard as SessionCardRecord,
} from "../src/canvas/SessionCard";
import { readingProvenance } from "../src/canvas/GroundLayer";
import {
  ASK_CALLS_MANAGER,
  ASK_CALLS_NO_MANAGER,
  ASK_CALLS_SAME,
  ASK_CALLS_TASK,
  SESSION_RESULT_KEEP_VERB,
  sessionDistilWords,
} from "../src/canvas/contactRules";
import {
  writeDistilledCard,
  type DistilledIo,
} from "../src/canvas/useGround";
import {
  SESSION_RESULT_EMPTY_SENTENCE,
  sessionResultName,
  type SessionCard as SessionCardFamily,
  type SessionEntry,
} from "../src/map/sessions";
import {
  distilledSourceSlug,
  parseReadingLine,
  serializeReadingLine,
  type Reading,
} from "../src/map/readings";
import type { GroundLink } from "../src/map/groundLinks";
import type { GroundReference } from "../src/map/ground";
import {
  CURATOR_FENCE,
  CURATOR_MALFORMED_SENTENCE,
  CURATOR_OVERLONG_SENTENCE,
  buildCuratorMessages,
  readCuratorAnswer,
  type CuratorCard,
  type CuratorRead,
} from "../src/turn/curator";
import {
  DIGEST_MAX_BYTES,
  DIGEST_MAX_CARDS,
  DIGEST_OMITTED_SENTENCE,
  mapDigest,
  type MapDigestInput,
} from "../src/turn/curatorDigest";
import { assembleSessionPacket, taskOfSent } from "../src/turn/packet";
import { CHANGE_OPTIONAL_KEYS, parsePrismLine, serializePrismLine } from "../src/map/prisms";
import { runRunContact, type RunContactDeps } from "../src/contacts/run";

/**
 * STORY 19.4 — THE CURATOR DISTILS A RUN'S RESULT (ADR-0037 §10's reuse).
 *
 * The human's check: a run finishes, the person presses "distil this into a
 * card", the model works for a moment, and a small card appears beside the
 * session card with the claim and its caveats, wired back and naming which
 * model distilled which model's reply. The raw result is still in the card's
 * transcript one press away, and a decline or a failure says so in one
 * sentence with the result untouched.
 *
 * This file pins the rules underneath:
 *
 *   - the brief is the run's TASK, recovered from its own `sent` packet; no
 *     task means one sentence and NO call;
 *   - the prompt carries the task, the reply and the digest — never a wired
 *     card's reading, note or another transcript entry (a construction fact);
 *   - the digest is anchored on the session card and says "run", not "ask";
 *   - the curator's egress is its own Move in the RUN family, with role
 *     "curator", written only when the request actually left;
 *   - the artifact is the SAME distilled form an ask card's artifact is, with
 *     the session slug as its provenance and the wire back to the card;
 *   - a decline, an unusable block, an over-long card or a failed call writes
 *     NO card and leaves the transcript's entries untouched;
 *   - the rule's copy path is untouched underneath its fallback verb.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-session-curator-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const TAKEN = "2026-11-19T12:00:00.000Z";
const TASK = "say what this folder is for, and what it is not for.";
const REPLY =
  "The folder holds the tide tables. The second gate may not open on a spring tide, and I am not sure who reads the notices.";

/** Bodies that must never reach the curator's prompt. */
const SENTINEL_READING = "SENTINEL-WIRED-READING: high water at 05:52";
const SENTINEL_NOTE = "SENTINEL-WIRED-NOTE: ask the harbor master";
const SENTINEL_OTHER = "SENTINEL-OTHER-ENTRY: an older run's words";

/** The cards wired into the session card, as the run's packet rendered them. */
const WIRED = [
  {
    name: "tide table",
    state: null,
    reading: SENTINEL_READING,
    note: SENTINEL_NOTE,
  },
  { name: "harbor notice", state: null, reading: null, note: null },
];

const SESSION: SessionCardFamily = {
  on: "rain-gauge-session",
  name: "Rain gauge session",
  x: 400,
  y: 200,
  tool: "local-agent",
};

const CARD: CuratorCard = {
  title: "The tide turns at six",
  claim: "The tide turns around six, and the second gate may stay shut.",
  restsOn: "the harbor master's account in the reply.",
  doesNotCover: "the second gate, and spring tides in general.",
  uncertainty:
    "the reply says the gate may not open on a spring tide and is not sure who reads the notices.",
};

function cardBlock(card: Partial<CuratorCard> = {}): string {
  const merged = { ...CARD, ...card };
  const body = {
    title: merged.title,
    claim: merged.claim,
    "rests on": merged.restsOn,
    "does not cover": merged.doesNotCover,
    uncertainty: merged.uncertainty,
  };
  return "here is the card.\n\n```" +
    CURATOR_FENCE +
    "\n" +
    JSON.stringify(body, null, 2) +
    "\n```\n";
}

/** The run as the transcript records it: the task's packet, then the reply. */
const PACKET = assembleSessionPacket(TASK, WIRED);

const ENTRIES: SessionEntry[] = [
  { kind: "started", t: "1" },
  { kind: "sent", text: PACKET.text, t: "1" },
  { kind: "text", text: SENTINEL_OTHER },
  { kind: "text", text: REPLY },
  { kind: "ended", ending: "completed", t: "2" },
];

/* ------------------------------------------------------------------ *
 * 1. The material sentinel: the task and the reply ride, nothing else.
 * ------------------------------------------------------------------ */

function sessionDigest(): string {
  const references: GroundReference[] = [
    { on: "tide-table", name: "tide table", x: 0, y: 0 },
    { on: "artifacts-of-run", name: "an earlier artifact", x: 0, y: 0 },
  ];
  const readings: Reading[] = [
    {
      on: "tide-table",
      form: "path",
      from: "/workspace/map/sources/tide.md",
      taken: TAKEN,
    },
    {
      on: "artifacts-of-run",
      form: "distilled",
      from: "card://" + SESSION.on,
      taken: TAKEN,
    },
  ];
  const input: MapDigestInput = {
    anchorSlug: SESSION.on,
    anchorKind: "session",
    wired: ["tide-table"],
    references,
    asks: [],
    askTurns: {},
    sessions: [SESSION],
    readings,
  };
  return mapDigest(input);
}

describe("the curator's prompt carries the task and the reply, never the material", () => {
  test("the task and the reply ride; the wired cards' text does not", () => {
    // The RUN's packet carries the wired cards: the negative test is not empty.
    expect(PACKET.text).toContain(SENTINEL_READING);
    expect(PACKET.text).toContain(SENTINEL_NOTE);
    const task = taskOfSent(PACKET.text);
    expect(task).toBe(TASK);
    const digest = sessionDigest();
    const messages = buildCuratorMessages({
      question: task!,
      reply: REPLY,
      digest,
    });
    expect(messages).toHaveLength(1);
    const prompt = messages[0]!.content;
    expect(prompt).toContain(TASK);
    expect(prompt).toContain(REPLY);
    expect(prompt).toContain(digest);
    // NOT a wired card's reading, note, or another transcript entry.
    expect(prompt).not.toContain(SENTINEL_READING);
    expect(prompt).not.toContain(SENTINEL_NOTE);
    expect(prompt).not.toContain(SENTINEL_OTHER);
    expect(digest).not.toContain(SENTINEL_READING);
    expect(digest).not.toContain(SENTINEL_OTHER);
    // And no packet headings: this is one distil call, not a second run.
    expect(prompt).not.toContain("## the bound");
    expect(prompt).not.toContain("READ: ");
  });

  test("the digest builder has no reading-text input to leak", () => {
    const builder = source("turn/curatorDigest.ts");
    expect(builder).not.toContain("texts");
    expect(builder).not.toContain("notes");
    expect(builder).not.toContain("readingText");
    // The one input type names records and reading LINES, never a body.
    const at = builder.indexOf("export interface MapDigestInput");
    const input = builder.slice(at, builder.indexOf("}", at));
    expect(input).not.toContain("result");
    expect(input).not.toContain("answer");
    expect(input).not.toContain("note");
    // The hook composes the session digest from records and reading lines.
    const hook = source("canvas/useGround.ts");
    const sessionAt = hook.indexOf('anchorKind: "session"');
    expect(sessionAt).toBeGreaterThan(-1);
    const digestAt = hook.lastIndexOf("const digest = mapDigest({", sessionAt);
    expect(digestAt).toBeGreaterThan(-1);
    const call = hook.slice(digestAt, hook.indexOf("});", sessionAt));
    expect(call).toContain("anchorSlug: slug");
    expect(call).not.toContain("textsRef");
    expect(call).not.toContain("notesRef");
  });

  test("the curator module is reused exactly: three inputs, unchanged", () => {
    const cur = source("turn/curator.ts");
    const input = cur.slice(
      cur.indexOf("export interface CuratorInput"),
      cur.indexOf("}", cur.indexOf("export interface CuratorInput")),
    );
    expect(input.match(/question:|reply:|digest:/g)).toHaveLength(3);
    const hook = source("canvas/useGround.ts");
    // The session path sends the same three things through the same port.
    expect(hook).toContain("turn.sendMessages(managerRoute, messages)");
    expect(hook).toContain("question: brief.task");
    expect(hook).toContain("reply: brief.reply");
  });
});

/* ------------------------------------------------------------------ *
 * 2. taskOfSent: the task block, round-tripped.
 * ------------------------------------------------------------------ */

describe("the brief is the task, recovered from the run's own packet", () => {
  test("a whole assembled packet round-trips its task block", () => {
    expect(taskOfSent(PACKET.text)).toBe(TASK);
    const bare = assembleSessionPacket("just one line", []);
    expect(taskOfSent(bare.text)).toBe("just one line");
    // The last block (the bound) is not part of the task.
    expect(taskOfSent(PACKET.text)).not.toContain("the bound");
  });

  test("a string with no task block refuses: null, never a guess", () => {
    expect(taskOfSent("")).toBeNull();
    expect(taskOfSent("a reply with no packet around it")).toBeNull();
    expect(taskOfSent("## the question\n\n\n")).toBeNull();
    // A heading that is not a BLOCK heading is not the task block.
    expect(taskOfSent("words ## the question\n\ntask-ish")).toBeNull();
  });

  test("the press refuses with one sentence when the task cannot be recovered", () => {
    const noSent: SessionEntry[] = [
      { kind: "started", t: "1" },
      { kind: "text", text: REPLY },
      { kind: "ended", ending: "completed", t: "2" },
    ];
    expect(sessionDistilBrief(noSent)).toEqual({
      kind: "refused",
      message: SESSION_DISTIL_NO_TASK_SENTENCE,
    });
    expect(SESSION_DISTIL_NO_TASK_SENTENCE).toContain("no card");
  });

  test("a run with words has a brief, completed or not; no words has none", () => {
    expect(sessionDistilBrief([])).toEqual({
      kind: "refused",
      message: SESSION_RESULT_EMPTY_SENTENCE,
    });
    // STORY 22.4 — A PARTIAL'S WORDS ARE READ TOO, and the ending rides back so
    // the artifact can name it. The rule's COPY still refuses the same run.
    expect(
      sessionDistilBrief([
        { kind: "started", t: "1" },
        { kind: "sent", text: PACKET.text, t: "1" },
        { kind: "text", text: "half" },
        { kind: "ended", ending: "stopped", t: "2" },
      ]),
    ).toEqual({
      kind: "ready",
      task: TASK,
      reply: "half",
      ending: "stopped",
    });
    expect(
      sessionDistilBrief([
        { kind: "started", t: "1" },
        { kind: "sent", text: PACKET.text, t: "1" },
        { kind: "ended", ending: "completed", t: "2" },
      ]),
    ).toEqual({ kind: "refused", message: SESSION_RESULT_EMPTY_SENTENCE });
    // The ready case is the run's own task and its own joined text.
    expect(sessionDistilBrief(ENTRIES)).toEqual({
      kind: "ready",
      task: TASK,
      reply: SENTINEL_OTHER + REPLY,
      ending: "completed",
    });
  });

  test("the task is the LAST run's sent entry, never an earlier run's", () => {
    const twoRuns: SessionEntry[] = [
      { kind: "started", t: "1" },
      {
        kind: "sent",
        text: assembleSessionPacket("the first task", []).text,
        t: "1",
      },
      { kind: "text", text: "first reply" },
      { kind: "ended", ending: "completed", t: "2" },
      { kind: "started", t: "3" },
      { kind: "text", text: "second reply, no sent line" },
      { kind: "ended", ending: "completed", t: "4" },
    ];
    expect(sessionDistilBrief(twoRuns)).toEqual({
      kind: "refused",
      message: SESSION_DISTIL_NO_TASK_SENTENCE,
    });
  });
});

/* ------------------------------------------------------------------ *
 * 3. The digest: a session anchor says "run".
 * ------------------------------------------------------------------ */

describe("the digest is anchored on the card being distilled", () => {
  test("a session anchor's own entry reads as a run, and its relations say run", () => {
    const digest = sessionDigest();
    const lines = digest.split("\n");
    expect(lines[0]).toBe(
      '- "Rain gauge session" — session — a run with local-agent',
    );
    expect(digest).toContain(
      '"tide table" — reference — a file, tide.md (wired into this run)',
    );
    expect(digest).toContain("(made from this run)");
    expect(digest).not.toContain("this ask");
  });

  test("an ask anchor keeps its own wording: no behaviour change for asks", () => {
    const digest = mapDigest({
      anchorSlug: "tide-question",
      anchorKind: "ask",
      wired: [],
      references: [],
      asks: [{ on: "tide-question", name: "Tide question", x: 0, y: 0 }],
      askTurns: {},
      sessions: [SESSION],
      readings: [],
    });
    expect(digest).toContain('"Tide question" — ask — the ask being distilled now');
  });

  test("the bounds, the whole-entry rule and the omitted sentence are unchanged", () => {
    const many: GroundReference[] = Array.from(
      { length: DIGEST_MAX_CARDS + 6 },
      (_, index) => ({ on: "card-" + index, name: "card number " + index, x: 0, y: 0 }),
    );
    const digest = mapDigest({
      anchorSlug: SESSION.on,
      anchorKind: "session",
      wired: [],
      references: many,
      asks: [],
      askTurns: {},
      sessions: [SESSION],
      readings: [],
    });
    const lines = digest.split("\n");
    expect(lines.length).toBeLessThanOrEqual(DIGEST_MAX_CARDS + 1);
    expect(lines[lines.length - 1]).toBe(DIGEST_OMITTED_SENTENCE);
    expect(DIGEST_MAX_BYTES).toBe(2048);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The curator's own Move: role "curator", in the run family.
 * ------------------------------------------------------------------ */

function memoryLog(): {
  deps: RunContactDeps;
  lines: () => ReturnType<typeof parsePrismLine>[];
} {
  let text: string | null = null;
  let minted = 0;
  return {
    deps: {
      readPrismsText: async () => text,
      writePrismsText: async (next) => {
        text = next;
      },
      mintId: () => "prism-" + (minted += 1),
    },
    lines: () =>
      text === null
        ? []
        : text
            .split("\n")
            .filter((line) => line !== "")
            .map((line) => parsePrismLine(line)),
  };
}

describe("the curator call is its own Move, written only when it left", () => {
  test("role curator, the run family, no pointer and no included set", async () => {
    const log = memoryLog();
    const raw = cardBlock();
    const moved = await runRunContact(
      {
        workspacePath: "/w",
        on: SESSION.on,
        tool: SESSION.tool,
        outcome: "answered",
        resultSize: raw.length,
        role: "curator",
      },
      log.deps,
    );
    const lines = log.lines();
    expect(lines).toHaveLength(1);
    expect(lines[0]!.contact).toBe("run");
    expect(lines[0]!.on).toBe(SESSION.on);
    expect(lines[0]!.pointer).toBeNull();
    const change = lines[0]!.changes[0]!;
    if (change.kind !== "run") throw new Error("not a run change");
    expect(change.role).toBe("curator");
    expect(change.outcome).toBe("answered");
    expect(change.resultSize).toBe(raw.length);
    expect(change.tool).toBe(SESSION.tool);
    // The run family has no inclusion set at all: nothing rode.
    expect("included" in change).toBe(false);
    expect(moved.prism.changes).toEqual([change]);
    expect(serializePrismLine(lines[0]!)).toContain('"role":"curator"');
  });

  test("a declined curator call is a Move too: its egress is never invisible", async () => {
    const log = memoryLog();
    await runRunContact(
      {
        workspacePath: "/w",
        on: SESSION.on,
        tool: SESSION.tool,
        outcome: "answered",
        resultSize: 4,
        role: "curator",
      },
      log.deps,
    );
    const change = log.lines()[0]!.changes[0]!;
    if (change.kind !== "run") throw new Error("not a run change");
    expect(change.role).toBe("curator");
  });

  test("a run's own line keeps its bytes: no role and no fifth key", async () => {
    const log = memoryLog();
    await runRunContact(
      {
        workspacePath: "/w",
        on: SESSION.on,
        tool: SESSION.tool,
        outcome: "answered",
        resultSize: 3,
      },
      log.deps,
    );
    const line = serializePrismLine(log.lines()[0]!);
    expect(line).not.toContain("role");
    expect(Object.keys(JSON.parse(line).changes[0]).sort()).toEqual([
      "kind",
      "outcome",
      "resultSize",
      "tool",
    ]);
    expect(CHANGE_OPTIONAL_KEYS.run).toEqual(["role"]);
  });

  test("the hook writes the Move ONLY after the request left", () => {
    const hook = source("canvas/useGround.ts");
    const start = hook.indexOf("const distilRunResult = useCallback");
    expect(start).toBeGreaterThan(-1);
    const send = hook.indexOf("turn.sendMessages(managerRoute, messages)", start);
    const move = hook.indexOf("appendSessionCurator({", start);
    expect(send).toBeGreaterThan(start);
    expect(move).toBeGreaterThan(send);
    // The no-call branch returns BEFORE the send and before the Move.
    const noManager = hook.indexOf('manager.kind !== "resolved"', start);
    expect(noManager).toBeGreaterThan(start);
    expect(noManager).toBeLessThan(send);
    const segment = hook.slice(
      send,
      hook.indexOf("const written = await writeCuratedRunCard(", send),
    );
    expect(segment).toContain("// STORY 19.4 — THE CURATOR IS ITS OWN MOVE");
    expect(segment).toContain("left ? readCuratorAnswer(raw, brief.reply) : null");
    expect(segment).toContain("outcome: askOutcomeOf(askEndingOf(curated))");
    expect(segment).toContain("resultSize: raw === null ? null : utf8ByteLength(raw)");
  });
});

/* ------------------------------------------------------------------ *
 * 5. The artifact: the same distilled form, anchored on the session.
 * ------------------------------------------------------------------ */

interface DistilBridge {
  io: DistilledIo;
  texts: Map<string, string>;
  links: () => readonly GroundLink[];
}

function distilBridge(root: string): DistilBridge {
  const texts = new Map<string, string>();
  let saved: readonly GroundLink[] = [];
  return {
    texts,
    links: () => saved,
    io: {
      async storeDistilledText(_workspace, on, text) {
        mkdirSync(join(root, "map", "readings"), { recursive: true });
        writeFileSync(join(root, "map", "readings", on + ".md"), text);
        texts.set(on, text);
      },
      async storeSelectionText() {},
      async saveReadings() {},
      async saveGround() {},
      async saveGroundLinks(_workspace, links) {
        saved = links;
      },
    } as DistilledIo,
  };
}

function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

/** The SHIPPED writer, with the test's bridges standing behind it. */
function writerOver(bridge: DistilBridge): DistilledCardWriter {
  return (workspacePath, references, readings, links, malformedGround, malformedReadings, malformedLinks, anchorSlug, name, x, y, text, taken, _io, options, authors) =>
    writeDistilledCard(
      workspacePath,
      references,
      readings,
      links,
      malformedGround,
      malformedReadings,
      malformedLinks,
      anchorSlug,
      name,
      x,
      y,
      text,
      taken,
      bridge.io,
      options,
      authors,
    );
}

function inputFor(
  read: CuratorRead | null,
  over: Partial<SessionCuratorInput> = {},
): SessionCuratorInput {
  return {
    workspacePath: "",
    references: [],
    readings: [],
    links: [],
    malformedGround: [],
    malformedReadings: [],
    malformedLinks: [],
    session: SESSION,
    taken: TAKEN,
    slugs: new Set([SESSION.on]),
    read,
    sentence: null,
    authors: { manager: "manager-small", task: "local agent" },
    ...over,
  };
}

describe("the artifact is the distilled form, wired back to the session card", () => {
  test("the card, the reading line, the wire and the bytes are the ask card's form", async () => {
    const base = workspace();
    const bridge = distilBridge(base);
    const read = readCuratorAnswer(cardBlock(), REPLY);
    expect(read.kind).toBe("card");
    if (read.kind !== "card") return;
    const written = await writeCuratedRunCard(
      inputFor(read, { workspacePath: base }),
      { writeCard: writerOver(bridge) },
    );
    expect(written.kind).toBe("written");
    if (written.kind !== "written") return;
    const { records, links, text } = written.card;
    // THE SAME DISTILLED FORM an ask card's artifact is.
    expect(records.reading).toMatchObject({
      form: "distilled",
      from: "card://" + SESSION.on,
      taken: TAKEN,
      manager: "manager-small",
      task: "local agent",
    });
    expect(text).toBe(read.text);
    expect(bridge.texts.get(records.reading.on)).toBe(read.text);
    expect(
      readFileSync(
        join(base, "map", "readings", records.reading.on + ".md"),
        "utf8",
      ),
    ).toBe(read.text);
    expect(serializeReadingLine(records.reading)).toContain(
      " | manager: manager-small | task: local agent",
    );
    expect(parseReadingLine(serializeReadingLine(records.reading))).toEqual(
      records.reading,
    );
    expect(distilledSourceSlug(records.reading)).toBe(SESSION.on);
    // THE WIRE: the session card → the artifact, in the one direction.
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ from: SESSION.on, to: records.reading.on });
    // THE TITLE is the curated card's own name; PLACEMENT is right and level.
    const placed = records.references.find(
      (reference) => reference.on === records.reading.on,
    )!;
    expect(placed.name).toBe(CARD.title);
    expect(placed.x).toBeGreaterThan(SESSION.x);
    expect(placed.y).toBe(SESSION.y);
    // THE FOOTER says which model distilled whose reply, and from which card.
    expect(
      readingProvenance(
        records.reading,
        new Map([[SESSION.on, SESSION.name]]),
      ),
    ).toBe(
      "distilled by manager-small from local agent's reply · from Rain gauge session",
    );
  });

  test("a second artifact cascades down, never onto the first", async () => {
    const base = workspace();
    const bridge = distilBridge(base);
    const read = readCuratorAnswer(cardBlock(), REPLY);
    if (read.kind !== "card") throw new Error("not a card");
    const first = await writeCuratedRunCard(
      inputFor(read, { workspacePath: base }),
      { writeCard: writerOver(bridge) },
    );
    if (first.kind !== "written") throw new Error("no first card");
    const firstPlaced = first.card.reference;
    // The column is read from the records: the first card's own provenance
    // names this session, so the second one cascades below it.
    const second = await writeCuratedRunCard(
      inputFor(read, {
        workspacePath: base,
        references: first.card.records.references,
        readings: first.card.records.readings,
      }),
      { writeCard: writerOver(bridge) },
    );
    if (second.kind !== "written") throw new Error("no second card");
    expect(second.card.reference.x).toBe(firstPlaced.x);
    expect(second.card.reference.y).toBeGreaterThan(firstPlaced.y);
  });

  test("a curated title that says nothing falls back to the session's name + result", async () => {
    const base = workspace();
    const bridge = distilBridge(base);
    // A parse cannot produce a blank title; the fallback is the writer's own
    // rule for a caller that hands one, and it names the copy's origin.
    const read: CuratorRead = {
      kind: "card",
      card: { ...CARD, title: "   " },
      text: "x",
    };
    const written = await writeCuratedRunCard(
      inputFor(read, { workspacePath: base }),
      { writeCard: writerOver(bridge) },
    );
    if (written.kind !== "written") throw new Error("no card");
    expect(written.card.reference.name).toBe(sessionResultName(SESSION.name));
    expect(written.card.reference.name).toBe("Rain gauge session result");
  });

  test("the writer's refusal is the one sentence, never a half-written card", async () => {
    const written = await writeCuratedRunCard(
      inputFor({ kind: "card", card: CARD, text: "x" }),
      {
        writeCard: async () => ({
          kind: "refused",
          message: "no card was made",
        }),
      },
    );
    expect(written).toEqual({ kind: "none", sentence: "no card was made" });
  });
});

/* ------------------------------------------------------------------ *
 * 6. Decline, invalid, over-long and a failed call: no card, no edits.
 * ------------------------------------------------------------------ */

describe("a decline, a bad block or a failed call writes nothing and leaves the result", () => {
  test("the decline keeps the curator's own first sentence", async () => {
    const sentence =
      "nothing here the map can use: it repeats what the folder already says.";
    const read = readCuratorAnswer(sentence + "\n\nand a second paragraph.", REPLY);
    expect(read.kind).toBe("declined");
    let wrote = false;
    const written = await writeCuratedRunCard(inputFor(read), {
      writeCard: async () => {
        wrote = true;
        throw new Error("must not write");
      },
    });
    expect(written).toEqual({ kind: "none", sentence });
    expect(wrote).toBe(false);
  });

  test("an unusable block and an over-long card keep their stated sentences", async () => {
    const broken = readCuratorAnswer("prose\n\n```json\n{}\n```\n", REPLY);
    expect(broken.kind).toBe("invalid");
    const overlong = readCuratorAnswer(
      cardBlock({ claim: "z".repeat(400) }),
      REPLY,
    );
    expect(overlong.kind).toBe("invalid");
    if (overlong.kind === "invalid") {
      expect(overlong.sentence).toBe(CURATOR_OVERLONG_SENTENCE);
    }
    if (broken.kind === "invalid") {
      expect(broken.sentence).toBe(CURATOR_MALFORMED_SENTENCE);
    }
    let wrote = false;
    const writer = async () => {
      wrote = true;
      throw new Error("must not write");
    };
    expect(await writeCuratedRunCard(inputFor(broken), { writeCard: writer })).toEqual({
      kind: "none",
      sentence: CURATOR_MALFORMED_SENTENCE,
    });
    expect(await writeCuratedRunCard(inputFor(overlong), { writeCard: writer })).toEqual({
      kind: "none",
      sentence: CURATOR_OVERLONG_SENTENCE,
    });
    expect(wrote).toBe(false);
  });

  test("a failed call says the asymmetry's sentence and writes nothing", async () => {
    let wrote = false;
    const written = await writeCuratedRunCard(
      inputFor(null, { sentence: SESSION_CURATOR_FAILED_SENTENCE }),
      {
        writeCard: async () => {
          wrote = true;
          throw new Error("must not write");
        },
      },
    );
    expect(written).toEqual({
      kind: "none",
      sentence: SESSION_CURATOR_FAILED_SENTENCE,
    });
    expect(SESSION_CURATOR_FAILED_SENTENCE).toContain("stands");
    expect(wrote).toBe(false);
    // With no sentence handed in, the same asymmetry's sentence stands in.
    expect(
      await writeCuratedRunCard(inputFor(null), {
        writeCard: async () => {
          wrote = true;
          throw new Error("must not write");
        },
      }),
    ).toEqual({ kind: "none", sentence: SESSION_CURATOR_FAILED_SENTENCE });
  });

  test("the transcript's entries are untouched by every refusal", async () => {
    const base = workspace();
    mkdirSync(join(base, "map", "sessions"), { recursive: true });
    const file = join(base, "map", "sessions", SESSION.on + ".jsonl");
    const before = ENTRIES.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
    writeFileSync(file, before, "utf8");
    const bridge = distilBridge(base);
    for (const read of [
      readCuratorAnswer("nothing worth keeping.", REPLY),
      readCuratorAnswer("```json\n{}\n```", REPLY),
      null,
    ]) {
      const written = await writeCuratedRunCard(
        inputFor(read, { workspacePath: base }),
        { writeCard: writerOver(bridge) },
      );
      expect(written.kind).toBe("none");
    }
    expect(readFileSync(file, "utf8")).toBe(before);
    expect(bridge.links()).toEqual([]);
    expect(bridge.texts.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 7. The verb, its declaration, and the rule's copy untouched.
 * ------------------------------------------------------------------ */

describe("the card's two card verbs", () => {
  const props = {
    session: SESSION as SessionCardRecord,
    toolName: "Local agent",
    declaration: null,
    tools: [],
    entries: [] as SessionEntry[],
    running: false,
    open: true,
    previewLines: 6,
    onOpen: () => {},
    onClose: () => {},
    onMakeResult: async () => ({ ok: true as const }),
    onDistilResult: async () => ({ ok: true as const }),
  };

  test("the distil verb is one primary verb; the copy is a fallback, never a peer", () => {
    const closed = renderToStaticMarkup(createElement(SessionCard, props));
    expect(closed).not.toContain("distil this into a card");
    const open = renderToStaticMarkup(
      createElement(SessionCard, { ...props, entries: ENTRIES }),
    );
    // STORY 22.4 — after the automatic distil succeeded the face says nothing
    // about a copy: there is ONE card verb, the manual re-press.
    expect(open).toContain("distil this into a card");
    expect(open).not.toContain(SESSION_RESULT_KEEP_VERB);
    // The calls are declared BEFORE the run, in the card's own quiet lines.
    const words = [
      "the task model answers: Local agent",
      "then the manager model distils the reply into a card: Small / Tiny",
    ];
    const declared = renderToStaticMarkup(
      createElement(SessionCard, {
        ...props,
        entries: [],
        distilWords: words,
      }),
    );
    expect(declared).toContain(words[0]!);
    expect(declared).toContain(words[1]!);
  });

  test("the rule's copy is untouched underneath its fallback wording", () => {
    const card = source("canvas/SessionCard.tsx");
    // The verb the person reads now belongs to the notice, and the old equal
    // choice is gone from the face.
    expect(card).toContain("SESSION_RESULT_KEEP_VERB");
    expect(card).not.toContain("make a card from this");
    // It still calls the untouched writer through its own prop, inside the
    // distil notice's block only.
    expect(card).toContain("onMakeResult()");
    expect(card).toContain("distilNotice !== null");
    // And the hook's copy path is unchanged: writeResultCard on a selection.
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("await writeResultCard(");
  });

  test("the declaration reuses the ask's wording constants", () => {
    const task = { row: "Local agent", model: "" };
    const manager = { row: "Small", model: "Tiny" };
    expect(sessionDistilWords({ task, manager })).toEqual([
      ASK_CALLS_TASK + "Local agent",
      "then the manager model distils the reply into a card: Small / Tiny",
    ]);
    expect(sessionDistilWords({ task, manager }).join(" ")).toContain(
      ASK_CALLS_MANAGER,
    );
    expect(sessionDistilWords({ task, manager }).join(" ")).toContain(
      ASK_CALLS_TASK,
    );
    // One model both: the ask's single line, because there is no difference
    // to name.
    const same = { row: "Local agent", model: "" };
    expect(sessionDistilWords({ task, manager: same })).toEqual([
      ASK_CALLS_SAME + "Local agent",
    ]);
    // No manager configured at all: the card will be made by a rule, and the
    // declaration says so instead of promising a second call.
    expect(sessionDistilWords({ task, manager: null })).toEqual([
      ASK_CALLS_TASK + "Local agent",
      ASK_CALLS_NO_MANAGER,
    ]);
  });

  test("the layer hands the card the same manager facts the ask's section reads", () => {
    const layer = source("canvas/GroundLayer.tsx");
    expect(layer).toContain("sessionDistilWords({");
    expect(layer).toContain("manager: calls.manager");
    expect(layer).toContain("onDistilResult={");
    // The App wires the hook's own verb, beside the copy's.
    const app = source("App.tsx");
    expect(app).toContain("onDistilSessionResult={ground.distilRunResult}");
    expect(app).toContain("onMakeSessionResult={ground.makeCardFromRun}");
  });
});
