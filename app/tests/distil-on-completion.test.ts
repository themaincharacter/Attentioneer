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
  ASK_CALLS_MANAGER,
  ASK_CALLS_NO_MANAGER,
  ASK_CALLS_SAME,
  ASK_CALLS_TASK,
  SESSION_RESULT_KEEP_VERB,
  sessionDistilWords,
} from "../src/canvas/contactRules";
import {
  SESSION_CURATOR_COPY_KEPT_SENTENCE,
  SESSION_CURATOR_FAILED_SENTENCE,
  SESSION_CURATOR_KEPT_SENTENCE,
  SESSION_CURATOR_NO_MANAGER_SENTENCE,
  keepRunOutcome,
  sessionDistilBrief,
  writeCuratedRunCard,
  type DistilledCardWriter,
  type SessionCuratorInput,
} from "../src/canvas/sessionCurator";
import { SessionCard, type SessionCard as SessionCardRecord } from "../src/canvas/SessionCard";
import { readingProvenance } from "../src/canvas/GroundLayer";
import {
  writeDistilledCard,
  writeResultCard,
  type DistilledIo,
  type SelectionIo,
} from "../src/canvas/useGround";
import {
  SESSION_RESULT_UNFINISHED_SENTENCE,
  serializeSessionTranscript,
  sessionRunText,
  type SessionCard as SessionCardFamily,
  type SessionEntry,
} from "../src/map/sessions";
import {
  distilledSourceSlug,
  parseReadingLine,
  serializeReadingLine,
} from "../src/map/readings";
import type { GroundLink } from "../src/map/groundLinks";
import type { Reading } from "../src/map/readings";
import { assembleSessionPacket } from "../src/turn/packet";
import {
  CURATOR_FENCE,
  readCuratorAnswer,
  type CuratorCard,
} from "../src/turn/curator";
import { runRunContact } from "../src/contacts/run";
import { parsePrismLine, serializePrismLine } from "../src/map/prisms";

/**
 * STORY 22.4 — THE RESULT BECOMES A CARD BY ITSELF.
 *
 * The human's check: a run completes and the artifact card appears beside the
 * session card, wired and named (which model distilled which), with NO press.
 * A partial's words are distilled the same way and the card names the ending;
 * the rule's copy stays strict. When the curator declines, ONE quiet line says
 * so and offers ONE verb — keep this as a card — whose own press tries the
 * curator again and falls back to 18.4's copy, saying which card it got. The
 * raw result is never touched.
 *
 * This file pins the rules underneath: the brief has no press in it, the run's
 * settle path makes the call, the partial's card names the ending, the fallback
 * is one sentence with the copy underneath it, and the transcript's bytes never
 * move.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-distil-auto-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const TAKEN = "2026-11-19T12:00:00.000Z";
const TASK = "say what this folder is for, and what it is not for.";
const REPLY =
  "The folder holds the tide tables. The second gate may not open on a spring tide.";

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
  uncertainty: "the reply is not sure who reads the notices.",
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
  return (
    "here is the card.\n\n```" +
    CURATOR_FENCE +
    "\n" +
    JSON.stringify(body, null, 2) +
    "\n```\n"
  );
}

const PACKET = assembleSessionPacket(TASK, []);

const COMPLETED: SessionEntry[] = [
  { kind: "started", t: "1" },
  { kind: "sent", text: PACKET.text, t: "1" },
  { kind: "text", text: REPLY },
  { kind: "ended", ending: "completed", t: "2" },
];

const PARTIAL: SessionEntry[] = [
  { kind: "started", t: "1" },
  { kind: "sent", text: PACKET.text, t: "1" },
  { kind: "text", text: "the first half of the answer, then it stopped" },
  { kind: "ended", ending: "stopped", t: "2" },
];

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
  return (
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
    _io,
    options,
    authors,
  ) =>
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
  read: ReturnType<typeof readCuratorAnswer>,
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

/* ------------------------------------------------------------------ *
 * 1. The ending makes the call: no press anywhere in the path.
 * ------------------------------------------------------------------ */

describe("a run's ending calls the curator by itself", () => {
  test("the brief is ready from the ending alone, with no press in it", () => {
    // The only input is the transcript the run wrote: no card press state, no
    // handler argument. The same call the manual verb makes is already due.
    expect(sessionDistilBrief(COMPLETED)).toEqual({
      kind: "ready",
      task: TASK,
      reply: REPLY,
      ending: "completed",
    });
  });

  test("the run's settle path makes that call and reports its one sentence", () => {
    const hook = source("canvas/useGround.ts");
    const start = hook.indexOf("const beginCardSessionRun = useCallback");
    const end = hook.indexOf("const testSessionRow = useCallback", start);
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const settle = hook.slice(start, end);
    // The trigger is the transcript read BACK from the file, before the run's
    // own Move — the ending is the fact, not a press.
    const reload = settle.indexOf("await loadSessionTranscript(workspacePath, slug)");
    const trigger = settle.indexOf("sessionRunText(transcript.entries)");
    const auto = settle.indexOf("autoDistilRef.current?.(slug)");
    const runMove = settle.indexOf("await appendSessionRun({");
    expect(reload).toBeGreaterThan(-1);
    expect(trigger).toBeGreaterThan(reload);
    expect(auto).toBeGreaterThan(trigger);
    expect(runMove).toBeGreaterThan(auto);
    // The sentence lands on the face as view state, never as a failure of the
    // run itself: the settle path returns the run's own outcome regardless.
    expect(settle).toContain("[slug]: auto.message");
    // The refusal sentences are the flow's own: a transcript with no task still
    // answers one sentence rather than disappearing.
    expect(source("canvas/useGround.ts")).toContain(
      "const brief = sessionDistilBrief(entries);",
    );
    // And the one seam is the same distil implementation the manual verb uses.
    expect(hook).toContain("autoDistilRef.current = distilRunResult;");
  });

  test("the artifact lands beside the session card, wired and named", async () => {
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
    // The wire back to the session card, in the one direction.
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ from: SESSION.on, to: records.reading.on });
    expect(distilledSourceSlug(records.reading)).toBe(SESSION.on);
    // Beside it: right, level, never on top of the run card.
    const placed = records.references.find(
      (reference) => reference.on === records.reading.on,
    )!;
    expect(placed.x).toBeGreaterThan(SESSION.x);
    expect(placed.y).toBe(SESSION.y);
    // Named: which model distilled whose reply, and from which card.
    expect(
      readingProvenance(
        records.reading,
        new Map([[SESSION.on, SESSION.name]]),
      ),
    ).toBe(
      "distilled by manager-small from local agent's reply · from Rain gauge session",
    );
    expect(text).toBe(read.text);
    // A completed card's line is byte-for-byte the 19.4 line.
    expect(serializeReadingLine(records.reading)).not.toContain("ending:");
  });

  test("the curator's own Move still rides the same flow, before the card is written", async () => {
    const hook = source("canvas/useGround.ts");
    const start = hook.indexOf("const distilRunResult = useCallback");
    const move = hook.indexOf("await appendSessionCurator({", start);
    const written = hook.indexOf("const written = await writeCuratedRunCard(", start);
    expect(start).toBeGreaterThan(-1);
    expect(move).toBeGreaterThan(start);
    expect(written).toBeGreaterThan(move);
    // The PRISM's own shape: the run family, role curator, no words.
    let text: string | null = null;
    let minted = 0;
    const lines = async () => {
      const moved = await runRunContact(
        {
          workspacePath: "/w",
          on: SESSION.on,
          tool: SESSION.tool,
          outcome: "answered",
          resultSize: 12,
          role: "curator",
        },
        {
          readPrismsText: async () => text,
          writePrismsText: async (next) => {
            text = next;
          },
          mintId: () => "prism-" + (minted += 1),
        },
      );
      return moved.prism;
    };
    const prism = await lines();
    const line = parsePrismLine(serializePrismLine(prism));
    const change = line!.changes[0]!;
    if (change.kind !== "run") throw new Error("not a run change");
    expect(change.role).toBe("curator");
    expect(change.outcome).toBe("answered");
  });
});

/* ------------------------------------------------------------------ *
 * 2. A partial is distilled too, and its card names the ending.
 * ------------------------------------------------------------------ */

describe("a partial's words are distilled, and its card says so", () => {
  test("the brief admits a partial and carries its ending", () => {
    expect(sessionDistilBrief(PARTIAL)).toEqual({
      kind: "ready",
      task: TASK,
      reply: "the first half of the answer, then it stopped",
      ending: "stopped",
    });
    expect(sessionRunText(PARTIAL)).toEqual({
      ending: "stopped",
      text: "the first half of the answer, then it stopped",
    });
  });

  test("the artifact names the ending on its face, and the line round-trips", async () => {
    const base = workspace();
    const bridge = distilBridge(base);
    const read = readCuratorAnswer(
      cardBlock(),
      "the first half of the answer, then it stopped",
    );
    if (read.kind !== "card") throw new Error("not a card");
    const written = await writeCuratedRunCard(
      inputFor(read, { workspacePath: base, ending: "stopped" }),
      { writeCard: writerOver(bridge) },
    );
    if (written.kind !== "written") throw new Error("no card");
    const reading = written.card.records.reading;
    expect(reading.ending).toBe("stopped");
    expect(serializeReadingLine(reading)).toContain(" | ending: stopped");
    expect(parseReadingLine(serializeReadingLine(reading))).toEqual(reading);
    expect(
      readingProvenance(reading, new Map([[SESSION.on, SESSION.name]])),
    ).toBe(
      "distilled by manager-small from local agent's reply · from Rain gauge session · from a run that did not finish",
    );
  });

  test("the rule's copy stays strict: a partial is still no result", async () => {
    const bridge = distilBridge(workspace());
    const selection: SelectionIo = {
      ...bridge.io,
      storeSelectionText: async () => {},
      saveReadings: async () => {},
      saveGround: async () => {},
    } as SelectionIo;
    const refused = await writeResultCard(
      "",
      [],
      [],
      [],
      [],
      SESSION,
      PARTIAL,
      TAKEN,
      selection,
    );
    expect(refused).toEqual({
      kind: "refused",
      message: SESSION_RESULT_UNFINISHED_SENTENCE,
    });
    expect(bridge.texts.size).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Decline or failure: one sentence, one fallback verb, and it works.
 * ------------------------------------------------------------------ */

describe("a distil that made no card says so once and offers the copy", () => {
  const base = {
    session: SESSION as SessionCardRecord,
    toolName: "Local agent",
    declaration: null,
    tools: [],
    running: false,
    open: true,
    previewLines: 6,
    onOpen: () => {},
    onClose: () => {},
    onKeepResult: async () => ({ ok: true as const }),
  };

  test("the one sentence and the one verb render together", () => {
    const html = renderToStaticMarkup(
      createElement(SessionCard, {
        ...base,
        entries: COMPLETED,
        keepNotice: SESSION_CURATOR_FAILED_SENTENCE,
      }),
    );
    expect(html).toContain(SESSION_CURATOR_FAILED_SENTENCE);
    expect(html).toContain(SESSION_RESULT_KEEP_VERB);
    // Not as an equal choice: the old pair of words is not on the face.
    expect(html).not.toContain("make a card from this");
    expect(html).not.toContain("distil this into a card");
    const noManager = renderToStaticMarkup(
      createElement(SessionCard, {
        ...base,
        entries: COMPLETED,
        keepNotice: SESSION_CURATOR_NO_MANAGER_SENTENCE,
      }),
    );
    expect(noManager).toContain(SESSION_CURATOR_NO_MANAGER_SENTENCE);
    expect(noManager).toContain(SESSION_RESULT_KEEP_VERB);
  });

  test("the one verb presses the hook's curator-first chain", () => {
    const card = source("canvas/SessionCard.tsx");
    // STORY 25-15: the keep verb is its own key in the strip (session-card-make),
    // still gated on a completed run — one press, the hook's one chain.
    const start = card.indexOf("one verb, one press (a PARTIAL");
    const fallback = card.slice(start, card.indexOf("STORY 18.5", start));
    expect(fallback).toContain('className="session-card-make"');
    expect(fallback).toContain("SESSION_RESULT_KEEP_VERB");
    expect(fallback).toContain("onClick={() => void keepResult()}");
    expect(fallback).toContain('lastEnded.ending === "completed"');
    // The layer hands the card the notice from the run's view state.
    const layer = source("canvas/GroundLayer.tsx");
    expect(layer).toContain("keepNotice={sessionKeepNotice[session.on] ?? null}");
  });

  test("a press falls back to the copy and says which card it got", async () => {
    // ONE press, TWO attempts in order: the curator, then 18.4's copy.
    const calls: string[] = [];
    const said: string[] = [];
    const card = { ok: true as const };
    expect(
      await keepRunOutcome({
        distil: async () => {
          calls.push("curator");
          return card;
        },
        copy: async () => {
          calls.push("copy");
          return card;
        },
        say: (message) => said.push(message),
      }),
    ).toBe(card);
    expect(calls).toEqual(["curator"]);
    expect(said).toEqual([SESSION_CURATOR_KEPT_SENTENCE]);
    // An unusable answer and a decline take the SAME fallback road.
    for (const message of [
      "the curator's answer was not a card the app can use, so no card was made.",
      "nothing worth keeping.",
    ]) {
      calls.length = 0;
      said.length = 0;
      await keepRunOutcome({
        distil: async () => {
          calls.push("curator");
          return { ok: false as const, message };
        },
        copy: async () => {
          calls.push("copy");
          return card;
        },
        say: (saidMessage) => said.push(saidMessage),
      });
      expect(calls).toEqual(["curator", "copy"]);
      expect(said).toEqual([SESSION_CURATOR_COPY_KEPT_SENTENCE]);
    }
  });

  test("the copy it offers is the 18.4 idiom: the exact bytes, unchanged", async () => {
    const bridge = distilBridge(workspace());
    const selection: SelectionIo = {
      ...bridge.io,
      storeSelectionText: async (_workspace, on, text) => {
        bridge.texts.set(on, text);
      },
      saveReadings: async () => {},
      saveGround: async () => {},
    } as SelectionIo;
    const copied = await writeResultCard(
      "",
      [],
      [],
      [],
      [],
      SESSION,
      COMPLETED,
      TAKEN,
      selection,
    );
    expect(copied.kind).toBe("written");
    if (copied.kind !== "written") return;
    expect(copied.text).toBe(REPLY);
    expect([...bridge.texts.values()]).toEqual([REPLY]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The declaration names both calls before the run.
 * ------------------------------------------------------------------ */

describe("the run's declaration names both calls before the run", () => {
  const task = { row: "Local agent", model: "" };
  const manager = { row: "Small", model: "Tiny" };

  test("two models, one model, and no manager each say the truth", () => {
    expect(sessionDistilWords({ task, manager })).toEqual([
      ASK_CALLS_TASK + "Local agent",
      ASK_CALLS_MANAGER + "Small / Tiny",
    ]);
    // Same model both roles: one line, no invented distinction.
    expect(sessionDistilWords({ task, manager: task })).toEqual([
      ASK_CALLS_SAME + "Local agent",
    ]);
    // No manager: the card will be made by a rule, said before the run.
    expect(sessionDistilWords({ task, manager: null })).toEqual([
      ASK_CALLS_TASK + "Local agent",
      ASK_CALLS_NO_MANAGER,
    ]);
    expect(ASK_CALLS_NO_MANAGER).toContain("made by a rule");
  });

  test("the card shows them before the actions, so before the run", () => {
    const html = renderToStaticMarkup(
      createElement(SessionCard, {
        session: SESSION,
        toolName: "Local agent",
        declaration: null,
        tools: [],
        entries: [],
        running: false,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
        distilWords: [
          ASK_CALLS_TASK + "Local agent",
          ASK_CALLS_MANAGER + "Small / Tiny",
        ],
      }),
    );
    expect(html).toContain(ASK_CALLS_TASK + "Local agent");
    expect(html).toContain(ASK_CALLS_MANAGER + "Small / Tiny");
    expect(html.indexOf("session-distil-declaration")).toBeGreaterThan(-1);
    expect(html.indexOf("session-distil-declaration")).toBeLessThan(
      html.indexOf("session-card-actions"),
    );
  });
});

/* ------------------------------------------------------------------ *
 * 5. The raw result is never touched.
 * ------------------------------------------------------------------ */

describe("the raw result survives every auto-distil outcome", () => {
  test("the transcript's bytes are identical after a card, a decline and a failure", async () => {
    const base = workspace();
    mkdirSync(join(base, "map", "sessions"), { recursive: true });
    const file = join(base, "map", "sessions", SESSION.on + ".jsonl");
    writeFileSync(file, serializeSessionTranscript(COMPLETED));
    const before = readFileSync(file, "utf8");
    const bridge = distilBridge(base);
    const card = readCuratorAnswer(cardBlock(), REPLY);
    if (card.kind !== "card") throw new Error("not a card");
    // A card is made.
    await writeCuratedRunCard(
      inputFor(card, { workspacePath: base }),
      { writeCard: writerOver(bridge) },
    );
    expect(readFileSync(file, "utf8")).toBe(before);
    // A decline, an unusable block and a failed call write nothing.
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
      expect(readFileSync(file, "utf8")).toBe(before);
    }
    // The flow never appends a transcript entry at all.
    const hook = source("canvas/useGround.ts");
    const start = hook.indexOf("const distilRunResult = useCallback");
    const end = hook.indexOf("useEffect(() => {", hook.indexOf("autoDistilRef.current = distilRunResult"));
    const flow = hook.slice(start, end);
    expect(flow).not.toContain("appendSessionEntries");
  });
});
