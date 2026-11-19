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
import { dirname, join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import {
  SESSION_ENTRY_KINDS,
  loadSessionTranscript,
  parseSessionEntryLine,
  parseSessionTranscript,
  serializeSessionEntryLine,
  serializeSessionTranscript,
  sessionEntryLine,
  sessionTranscriptPath,
  type SessionCard as SessionCardRecord,
  type SessionEntry,
  type SessionIo,
} from "../src/map/sessions";
import {
  SESSION_TASK_REFUSAL,
  beginSessionRun,
  sessionContextFactsOf,
  sessionContextSources,
  startGatedSessionRun,
} from "../src/canvas/useGround";
import {
  SessionCard as SessionCardView,
  sessionDisclosureVerb,
} from "../src/canvas/SessionCard";
import {
  ASK_DECLARATION_VERB,
  ASK_DECLARATION_VERB_SENT,
} from "../src/canvas/contactRules";
import { askCardOf } from "../src/turn/context";
import {
  ASK_CONTEXT_BOUND,
  ASK_PACKET_BOUND,
  SESSION_PACKET_TITLE,
  assembleSessionPacket,
  selectAskContextCards,
  type AskPacketCard,
} from "../src/turn/packet";
import type { GroundReference } from "../src/map/ground";
import type { GroundLink } from "../src/map/groundLinks";
import type { Reading } from "../src/map/readings";
import type { AcpSpec } from "../src/turn/acpSpecs";
import { acpDeclaration } from "../src/turn/acpSpecs";
import type { SidecarStart } from "../src/turn/sidecar";
import type { TurnTransport } from "../src/turn/turn";
import { parseRequestLine } from "../src/turn/protocol";
import { BUN, FAKE_SERVER, openSidecar, type SidecarPipe } from "./fixtures/sidecar-pipe";

/**
 * STORY 19.3 — THE TASK RIDES THE PACKET.
 *
 * WHAT IS PINNED, in the story's own words:
 *
 *   1. THE SEND IS THE RECORD. A seventh transcript kind (`sent`) carries the
 *      exact prompt string and its time; the six older kinds still parse, a
 *      malformed line is preserved, and the entry round-trips byte for byte.
 *   2. THE PACKET is the task verbatim, then each wired card WHOLE under the
 *      ask context's stated bound, then the one bound sentence. No retrieval
 *      instruction rides: a run's delegate has its own files.
 *   3. THE CONTEXT is the wires that TARGET the session card, in file order,
 *      deduped; a dangling wire is reported and never repaired.
 *   4. AN EMPTY TASK refuses with one sentence and starts nothing.
 *   5. ONE STRING: the pre-send readback, the wire's prompt and the recorded
 *      `sent` entry's text are the SAME bytes.
 */

const THAT = fileURLToPath(new URL(".", import.meta.url));
const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-session-packet-"));
const PIPES: SidecarPipe[] = [];

afterAll(() => {
  for (const pipe of PIPES) pipe.stop();
  rmSync(ROOT, { recursive: true, force: true });
});

function workspace(): string {
  const made = mkdtempSync(join(ROOT, "ws-"));
  mkdirSync(join(made, "map"), { recursive: true });
  return made;
}

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

const NOW = "2026-11-19T00:00:00.000Z";

const SESSION: SessionCardRecord = {
  on: "the-session",
  name: "A session",
  x: 0,
  y: 0,
  tool: "a-row",
};

const GAUGE: GroundReference = { on: "rain-gauge", name: "Rain gauge", x: 0, y: 0 };
const WELL: GroundReference = { on: "old-well", name: "Old well", x: 0, y: 0 };

const GAUGE_READING: Reading = {
  on: GAUGE.on,
  form: "path",
  from: "notes/gauge.md",
  taken: NOW,
};
const WELL_READING: Reading = {
  on: WELL.on,
  form: "path",
  from: "notes/well.md",
  taken: NOW,
};

function link(from: string, to: string): GroundLink {
  return { from, to };
}

function card(on: string, name: string, reading: Reading, text: string): AskPacketCard {
  return askCardOf({
    on,
    name,
    state: null,
    reading,
    readingText: text,
    note: null,
  });
}

const ONE = card(GAUGE.on, GAUGE.name, GAUGE_READING, "the gauge reads twelve");
const TWO = card(WELL.on, WELL.name, WELL_READING, "the well is deep");

/* ------------------------------------------------------------------ *
 * 1. The seventh transcript kind: the send is the record.
 * ------------------------------------------------------------------ */

describe("the send is the record", () => {
  const TEXT = 'fix the failing test\nand say what you changed — "quietly".';

  test("a sent entry round-trips through serialize/parse, verbatim", () => {
    const entry: SessionEntry = { kind: "sent", text: TEXT, t: NOW };
    const line = serializeSessionEntryLine(entry);
    // The house JSONL seam sorts its keys; nothing else touches the text.
    expect(line).toBe(
      JSON.stringify({ kind: "sent", t: NOW, text: TEXT }),
    );
    expect(parseSessionEntryLine(line)).toEqual(entry);
    expect(SESSION_ENTRY_KINDS).toContain("sent");
    expect(sessionEntryLine(entry)).toBe("the prompt was sent");
  });

  test("the six older kinds still parse, and an unreadable line is preserved", () => {
    const older: SessionEntry[] = [
      { kind: "started", t: NOW },
      { kind: "session", id: "s-1" },
      { kind: "text", text: "words" },
      { kind: "tool", name: "Read", status: "completed" },
      { kind: "permission", name: "Read", reply: "refused" },
      { kind: "ended", ending: "completed", t: NOW },
    ];
    const bytes = serializeSessionTranscript(older);
    const parsed = parseSessionTranscript(bytes);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.entries).toEqual(older);
    // A line that is not one of the seven survives a rewrite, bytes and all.
    const sent: SessionEntry = { kind: "sent", text: "x", t: NOW };
    const withJunk =
      bytes + serializeSessionEntryLine(sent) + "\n{not a line}\n";
    const kept = parseSessionTranscript(withJunk);
    expect(kept.malformed).toEqual(["{not a line}"]);
    expect(kept.entries).toEqual([...older, sent]);
    expect(serializeSessionTranscript(kept.entries, kept.malformed)).toBe(
      serializeSessionTranscript([...older, sent], ["{not a line}"]),
    );
  });
});

/* ------------------------------------------------------------------ *
 * 2. The packet: the task, whole cards, one bound sentence.
 * ------------------------------------------------------------------ */

describe("the run's packet", () => {
  const TASK = "look at these two cards and say what this folder is for.";

  test("the task is the first block, VERBATIM, under the packet's title", () => {
    const packet = assembleSessionPacket(TASK, [ONE, TWO]);
    expect(packet.blocks[0]!.text).toBe("## the question\n\n" + TASK);
    expect(packet.text.startsWith(SESSION_PACKET_TITLE)).toBe(true);
    expect(packet.blocks.map((block) => block.kind)).toEqual([
      "question",
      "card",
      "card",
      "bound",
    ]);
    expect(packet.text).toContain("## Rain gauge");
    expect(packet.text).toContain("## Old well");
    expect(packet.text).toContain(ASK_PACKET_BOUND);
    // NO RETRIEVAL INSTRUCTION: a run's delegate has its own file access.
    expect(packet.text).not.toContain("READ:");
    expect(packet.retrievable).toEqual([]);
  });

  test("the task's bytes are not trimmed, re-wrapped or normalized", () => {
    const exact = "  keep my  spaces\nand my trailing newline\n";
    const packet = assembleSessionPacket(exact, []);
    expect(packet.text).toContain(exact);
    expect(packet.blocks[0]!.text).toBe("## the question\n\n" + exact);
  });

  test("whole cards only: a card that does not fit is dropped, and no later one rides", () => {
    const big = {
      name: "Big",
      state: null,
      reading: null,
      note: "x".repeat(200),
    } as AskPacketCard;
    const small = {
      name: "Small",
      state: null,
      reading: null,
      note: "ok",
    } as AskPacketCard;
    const selected = selectAskContextCards([big, small], { cards: 4, bytes: 240 });
    expect(selected.cards).toEqual([]);
    expect(selected.omitted).toBe(true);
    const packet = assembleSessionPacket("task", [big, small], {
      cards: 4,
      bytes: 240,
    });
    expect(packet.text).not.toContain("## Big");
    expect(packet.text).not.toContain("## Small");
    expect(packet.declaration.blocks.map((block) => block.kind)).toEqual([
      "question",
      "bound",
    ]);
  });

  test("the card bound drops the rest, and the declaration names only what rode", () => {
    const cards = ["A", "B", "C", "D", "E"].map(
      (name) =>
        ({
          name,
          state: null,
          reading: null,
          note: "note " + name,
        }) as AskPacketCard,
    );
    const packet = assembleSessionPacket("five of you?", cards);
    expect(
      packet.declaration.blocks
        .filter((block) => block.kind === "card")
        .map((block) => block.name),
    ).toEqual(["A", "B", "C", "D"]);
    expect(packet.text).not.toContain("## E");
    // The bound's numbers never ride: the person's declaration is the only
    // place a size is said.
    expect(packet.text).not.toContain("8");
    expect(ASK_CONTEXT_BOUND).toEqual({ cards: 4, bytes: 8 * 1024 });
  });

  test("the declaration's sizes are the bytes actually sent", () => {
    const packet = assembleSessionPacket(TASK, [ONE, TWO]);
    packet.declaration.blocks.forEach((line, index) => {
      expect(line.size).toBe(
        new TextEncoder().encode(packet.blocks[index]!.text).length,
      );
    });
    expect(packet.declaration.total).toBe(
      new TextEncoder().encode(packet.text).length,
    );
    // The task block's declared size is the task's own bytes plus its heading.
    expect(packet.declaration.blocks[0]!.size).toBe(
      new TextEncoder().encode("## the question\n\n" + TASK).length,
    );
  });
});

/* ------------------------------------------------------------------ *
 * 3. The context: the wires that target the session card.
 * ------------------------------------------------------------------ */

describe("the run's context is the wires", () => {
  test("only links whose TARGET is the session card count, in file order, deduped", () => {
    const wires = sessionContextSources(
      SESSION.on,
      [
        link(GAUGE.on, SESSION.on),
        link(WELL.on, "another-card"),
        link(GAUGE.on, SESSION.on),
        link(WELL.on, SESSION.on),
      ],
      [GAUGE.on, WELL.on],
    );
    expect(wires.sources).toEqual([GAUGE.on, WELL.on]);
    expect(wires.dangling).toEqual([]);
  });

  test("a wire whose source is gone is DANGLING, said and never repaired", () => {
    const wires = sessionContextSources(
      SESSION.on,
      [link("gone-card", SESSION.on), link(GAUGE.on, SESSION.on)],
      [GAUGE.on],
    );
    expect(wires.sources).toEqual([GAUGE.on]);
    expect(wires.dangling).toEqual(["gone-card"]);
  });

  test("the facts are what each wired card HAS, and only the wired ones", () => {
    const other: SessionCardRecord = {
      on: "older-session",
      name: "The older run",
      x: 10,
      y: 10,
      tool: "a-row",
    };
    const facts = sessionContextFactsOf({
      session: SESSION.on,
      links: [
        link(GAUGE.on, SESSION.on),
        link(WELL.on, "not-this-session"),
        link(other.on, SESSION.on),
        link("gone-card", SESSION.on),
      ],
      references: [GAUGE, WELL],
      asks: [],
      askTurns: {},
      sessions: [SESSION, other],
      sessionEntries: {
        [other.on]: [
          { kind: "started", t: NOW },
          { kind: "text", text: "the older run said this" },
          { kind: "ended", ending: "completed", t: NOW },
        ],
      },
      readings: [GAUGE_READING, WELL_READING],
      texts: {
        [GAUGE.on]: "the gauge reads twelve",
        [WELL.on]: "the well is deep",
      },
      notes: {},
      states: {},
    });
    expect(facts.facts.map((fact) => fact.name)).toEqual([
      "Rain gauge",
      "The older run",
    ]);
    expect(askCardOf(facts.facts[0]!).reading).toBe("the gauge reads twelve");
    // A wired session card lends its last COMPLETED run, whole.
    expect(askCardOf(facts.facts[1]!).result).toBe("the older run said this");
    // The dangling wire is reported; the card is not invented.
    expect(facts.dangling).toEqual(["gone-card"]);
  });
});

/* ------------------------------------------------------------------ *
 * 4. The gate: an empty task starts nothing.
 * ------------------------------------------------------------------ */

function fakeTransport(sent: string[]): TurnTransport {
  return {
    async send(line) {
      sent.push(line);
    },
    subscribe() {
      return () => {};
    },
  };
}

const STARTED: SidecarStart = {
  kind: "running",
  status: { running: true, entry: "", entryKind: "dev-entry", bun: "" },
};

function fakeRow(reportPath: string): AcpSpec {
  return {
    kind: "acp",
    id: "a-row",
    name: "A row",
    verified: false,
    command: BUN,
    args: [FAKE_SERVER, "tools", "--report", reportPath],
    cwdPolicy: "session",
    env: [],
    timeoutMinutes: 1,
    notes: "a test row",
  };
}

describe("an empty task starts nothing", () => {
  test("one sentence, no request, no transcript line", async () => {
    const base = workspace();
    const sent: string[] = [];
    const result = startGatedSessionRun(
      base,
      {
        session: SESSION,
        task: "   \n",
        context: [],
        row: fakeRow(join(base, "report.json")),
        readings: [],
      },
      {
        transport: fakeTransport(sent),
        start: async () => STARTED,
        transcriptIo: nodeIo(),
      },
    );
    expect(result).toEqual({ kind: "refused", message: SESSION_TASK_REFUSAL });
    expect(SESSION_TASK_REFUSAL).toBe("write the task first.");
    // NOTHING LEFT AND NOTHING WAS WRITTEN: the fixture's own transport saw no
    // line, and the card has no transcript to reopen.
    expect(sent).toEqual([]);
    expect(existsSync(sessionTranscriptPath(base, SESSION.on))).toBe(false);
  });

  test("a card with no row refuses with its own sentence", () => {
    const result = startGatedSessionRun(workspace(), {
      session: SESSION,
      task: "do it",
      context: [],
      row: null,
      readings: [],
    });
    expect(result.kind).toBe("refused");
  });

  test("a refused press never reaches the run seam at all", () => {
    const hook = readFileSync(
      join(THAT, "..", "src", "canvas", "useGround.ts"),
      "utf8",
    );
    // The run seam has no module prompt any more, and the press goes through
    // the ONE gate before the run starts.
    expect(hook).not.toContain("SESSION_PROMPT");
    expect(hook).toContain("startGatedSessionRun(");
    expect(hook).toContain("SESSION_TASK_REFUSAL");
  });
});

/* ------------------------------------------------------------------ *
 * 5. ONE STRING: the readback, the wire and the record.
 * ------------------------------------------------------------------ */

describe("the readback, the wire and the record are one string", () => {
  test("a run through the fixture sends exactly what it declared and recorded", async () => {
    const base = workspace();
    const pipe = openSidecar();
    PIPES.push(pipe);
    await pipe.hello();
    const sent: string[] = [];
    const inner = pipe.transport;
    const transport: TurnTransport = {
      async send(line) {
        sent.push(line);
        await inner.send(line);
      },
      subscribe: (id, handler) => inner.subscribe(id, handler),
      ...(inner.onClosed === undefined ? {} : { onClosed: inner.onClosed }),
    };
    const task = "read this folder and say, in one sentence, what it is for.";
    // The PRE-SEND readback: the card assembles exactly this packet from the
    // typed task and the wired cards, and its declaration is the one below.
    const preSend = assembleSessionPacket(task, [ONE, TWO]);
    const started = beginSessionRun(base, fakeRow(join(base, "report.json")), "one", {
      task,
      context: [ONE, TWO],
      transport,
      start: async () => STARTED,
      transcriptIo: nodeIo(),
      now: () => NOW,
    });
    const done = await started.done;
    expect(done.ending).toBe("completed");

    const runLine = sent
      .map((line) => parseRequestLine(line))
      .find((line) => line !== null && line.kind === "run");
    if (runLine === null || runLine === undefined || runLine.kind !== "run") {
      throw new Error("the run request never left");
    }
    // 1) the wire's prompt, 2) the pre-send readback's bytes, 3) the record.
    const recorded = done.entries.find((entry) => entry.kind === "sent");
    if (recorded === undefined || recorded.kind !== "sent") {
      throw new Error("the send was not recorded");
    }
    expect(runLine.prompt).toBe(preSend.text);
    expect(recorded.text).toBe(preSend.text);
    expect(recorded.t).toBe(NOW);
    // The send leads the transcript: the record is written before anything the
    // run reports about itself.
    expect(done.entries[0]).toEqual({ kind: "sent", text: preSend.text, t: NOW });
    expect(readFileSync(sessionTranscriptPath(base, "one"), "utf8").split("\n")[0]).toBe(
      serializeSessionEntryLine(recorded),
    );

    // AFTER THE RUN, a reopen reads the same bytes back from the file.
    const reopened = await loadSessionTranscript(base, "one", nodeIo());
    const again = reopened.entries.find((entry) => entry.kind === "sent");
    if (again === undefined || again.kind !== "sent") {
      throw new Error("the send is not in the file");
    }
    expect(again.text).toBe(preSend.text);
    // And the declaration describes those very bytes.
    expect(preSend.declaration.total).toBe(
      new TextEncoder().encode(runLine.prompt).length,
    );
  }, 20_000);
});

/* ------------------------------------------------------------------ *
 * 6. The card's face: the task field, and the one quiet disclosure.
 * ------------------------------------------------------------------ */

describe("the card's face", () => {
  test("the expanded card offers the task field, and its disclosure opens what was sent", () => {
    const text = "the exact bytes the run sent";
    const markup = renderToStaticMarkup(
      createElement(SessionCardView, {
        session: SESSION,
        toolName: "A row",
        declaration: acpDeclaration(fakeRow(join(ROOT, "unused.json"))),
        entries: [{ kind: "sent", text, t: NOW }] as SessionEntry[],
        running: false,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(markup).toContain('class="session-card-task"');
    expect(markup).toContain("write the task");
    // After a run, the SAME disclosure says what WAS sent (never "will be").
    expect(markup).toContain(ASK_DECLARATION_VERB_SENT);
    expect(markup).not.toContain(ASK_DECLARATION_VERB);
  });

  test("the verb flips only when a send is recorded and nothing is being written", () => {
    expect(sessionDisclosureVerb(false, false)).toBe(ASK_DECLARATION_VERB);
    expect(sessionDisclosureVerb(true, true)).toBe(ASK_DECLARATION_VERB);
    expect(sessionDisclosureVerb(true, false)).toBe(ASK_DECLARATION_VERB_SENT);
  });

  test("a dangling wire is said on the card, never repaired", () => {
    const markup = renderToStaticMarkup(
      createElement(SessionCardView, {
        session: SESSION,
        toolName: "A row",
        declaration: null,
        entries: [],
        contextMissing: true,
        running: false,
        open: true,
        previewLines: 6,
        onOpen: () => {},
        onClose: () => {},
      }),
    );
    expect(markup).toContain("a card wired into this run is gone");
  });
});
