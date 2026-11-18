import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  ASK_CURATOR_FAILED_SENTENCE,
  ASK_NO_CARD_SENTENCE,
  askTurnCardNote,
  writeAskTurn,
  writeDistilledCard,
  type AskCuratorSend,
  type AskTurnSend,
  type AskTurnWriteIo,
  type DistilledIo,
} from "../src/canvas/useGround";
import { readingKind, readingProvenance } from "../src/canvas/GroundLayer";
import {
  buildCuratorMessages,
  cardDroppedCaveat,
  curatorPrompt,
  readCuratorAnswer,
  replyCarriedCaveat,
  CAVEAT_CUES,
  CURATOR_FENCE,
  CURATOR_MALFORMED_SENTENCE,
  CURATOR_SCHEMA_KEYS,
  type CuratorCard,
} from "../src/turn/curator";
import {
  assembleAskCardPacket,
  type AskPacketCard,
} from "../src/turn/packet";
import { askSteps, curatorSteps, turnSteps } from "../src/turn/steps";
import {
  CHANGE_OPTIONAL_KEYS,
  askRoleOf,
  parsePrismChange,
  parsePrismLine,
  serializePrismLine,
  type AskRole,
  type Prism,
} from "../src/map/prisms";
import {
  askCardInFlight,
  recordAskCardTurn,
  type AskContactDeps,
} from "../src/contacts/ask";
import {
  appendExchange,
  type AskIo,
} from "../src/map/asks";
import {
  distilledAuthors,
  distilledReading,
  parseReadingLine,
  serializeReadingLine,
} from "../src/map/readings";
import { renderMirror, type MirrorView } from "../src/map/mirror";
import {
  EMPTY_SETTINGS,
  managerSelection,
  readTurnSettings,
  resolveManager,
  storedTurnSettings,
  withManagerSameAsTask,
  withManagerSelection,
  withProvider,
  withSelection,
  validateProviderRow,
  type ProviderRow,
} from "../src/turn/providers";
import {
  MANAGER_MODEL_TOOLTIP,
  TASK_MODEL_TOOLTIP,
} from "../src/canvas/SettingsPanel";

/**
 * STORY 17.12 — the curator call, and the two rows that choose it.
 *
 * The human's check is Settings -> Turn defaults -> two rows, different models,
 * ask: the answer is the task's, the card names the manager. This file pins
 * the rules underneath:
 *
 *   - the curator's prompt carries the QUESTION, the REPLY and the schema, and
 *     none of the wired cards' readings (a construction fact, asserted);
 *   - the parse is the ghost block's discipline: one fenced block, one card,
 *     malformed -> one sentence and no card;
 *   - a decline is legal: one sentence, no card, the reply kept;
 *   - the caveat rule is conservative and says how;
 *   - two PRISMs per curating ask, the second naming role "curator";
 *   - the ask-level budget counts both calls;
 *   - a curator card says which model distilled whose reply.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-curator-"));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const TAKEN = "2026-11-18T12:00:00.000Z";
const QUESTION = "When does the tide turn, and will it hold?";
const REPLY =
  "The tide turns about six. The harbor master says the gate may not open then, so the six o'clock answer might not apply on a spring tide.\n\nI am not sure about the second gate.";

const CARD: CuratorCard = {
  title: "The tide turns at six",
  claim: "The tide turns around six, and the gate may stay shut.",
  restsOn: "the harbor master's account in the reply.",
  doesNotCover: "the second gate, and spring tides in general.",
  uncertainty:
    "the reply says the gate may not open and the answer might not apply on a spring tide.",
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
  return "here is the card.\n\n\`\`\`" +
    CURATOR_FENCE +
    "\n" +
    JSON.stringify(body, null, 2) +
    "\n\`\`\`\n";
}

/* ------------------------------------------------------------------ *
 * 1. The prompt: reply yes, material no.
 * ------------------------------------------------------------------ */

describe("the curator's prompt carries the reply and none of the material", () => {
  test("the reply, the question and the schema ride; the reading does not", () => {
    // The wired cards a task turn WOULD send, with readings that must not leak.
    const wired: AskPacketCard[] = [
      {
        name: "tide table",
        state: null,
        reading: "SENTINEL-WIRED-READING-A: high water at 05:52, low at 12:08",
        note: "SENTINEL-WIRED-NOTE-A",
      },
      {
        name: "harbor notice",
        state: null,
        reading: "SENTINEL-WIRED-READING-B: the gate is closed on spring tides",
        note: null,
      },
    ];
    const askPacket = assembleAskCardPacket(wired, [], QUESTION);
    // The task's packet DOES carry them: the negative test is not vacuous.
    for (const card of wired) {
      expect(askPacket.text).toContain(card.reading!);
    }

    const curator = buildCuratorMessages({ question: QUESTION, reply: REPLY });
    expect(curator).toHaveLength(1);
    const text = curator[0].content;
    expect(text).toContain(REPLY);
    expect(text).toContain(QUESTION);
    for (const key of CURATOR_SCHEMA_KEYS) expect(text).toContain(key);
    expect(text).toContain(CURATOR_FENCE);
    // NOT the wired readings, notes or card names as material blocks.
    for (const card of wired) {
      expect(text).not.toContain(card.reading!);
      if (card.note !== null) expect(text).not.toContain(card.note);
      expect(text).not.toContain("## " + card.name);
    }
    // No packet headings at all: this is not a second full turn.
    expect(text).not.toContain("## the bound");
    expect(text).not.toContain("READ: ");
  });

  test("the module's inputs are only the question and the reply", () => {
    const cur = source("turn/curator.ts");
    // No packet, material or context import can reach this prompt.
    expect(cur).not.toContain('from "./packet"');
    expect(cur).not.toContain("AskPacketCard");
    expect(cur).not.toContain("AskPacketReach");
    expect(cur).not.toContain("context");
    // The one input type has exactly two fields.
    const input = cur.slice(
      cur.indexOf("export interface CuratorInput"),
      cur.indexOf("}", cur.indexOf("export interface CuratorInput")),
    );
    expect(input.match(/question:|reply:/g)).toHaveLength(2);
    // The hook builds it from exactly those two values.
    expect(source("canvas/useGround.ts")).toContain(
      "buildCuratorMessages({ question, reply })",
    );
  });
});

/* ------------------------------------------------------------------ *
 * 2. The parse: one card, or one sentence.
 * ------------------------------------------------------------------ */

describe("the curator's answer is parsed, never trusted", () => {
  test("one fenced block with the five keys is a card", () => {
    const read = readCuratorAnswer(cardBlock(), REPLY);
    expect(read.kind).toBe("card");
    if (read.kind !== "card") return;
    expect(read.card.title).toBe(CARD.title);
    expect(read.text).toContain(CARD.claim);
    expect(read.text).toContain("rests on: " + CARD.restsOn);
    expect(read.text).toContain("does not cover: " + CARD.doesNotCover);
    expect(read.text).toContain("uncertainty: " + CARD.uncertainty);
  });

  test("a malformed block is ONE sentence and NO card", () => {
    const brokenJSON = "text\n\n\`\`\`" + CURATOR_FENCE + "\n{ not json }\n\`\`\`\n";
    for (const answer of [
      brokenJSON,
      "prose only, with NO fence at all",
      "text\n\n\`\`\`json\n{\"title\":\"x\"}\n\`\`\`\n",
      cardBlock({ claim: "" }),
      "text\n\n\`\`\`" +
        CURATOR_FENCE +
        "\n{\"title\":\"a\",\"claim\":\"b\",\"rests on\":\"c\",\"does not cover\":\"d\",\"uncertainty\":\"e\",\"extra\":\"f\"}\n\`\`\`\n",
      cardBlock() + cardBlock({ title: "a second card" }),
    ]) {
      const read = readCuratorAnswer(answer, REPLY);
      // The no-fence case is the LEGAL decline, not a malformed block; every
      // other case here is malformed and says the one sentence.
      if (answer === "prose only, with NO fence at all") {
        expect(read.kind).toBe("declined");
      } else {
        expect(read.kind).toBe("invalid");
        if (read.kind === "invalid") {
          expect(read.sentence).toBe(CURATOR_MALFORMED_SENTENCE);
        }
      }
    }
    expect(CURATOR_MALFORMED_SENTENCE).toContain("no card");
  });

  test("a decline is a legal answer: one sentence, no card", () => {
    const read = readCuratorAnswer(
      "Nothing here is worth keeping as a card.\n\nSecond paragraph ignored.",
      REPLY,
    );
    expect(read.kind).toBe("declined");
    if (read.kind !== "declined") return;
    expect(read.sentence).toBe("Nothing here is worth keeping as a card.");
    expect(read.sentence.split("\n")).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * 3. Caveats preserved by rule, conservatively.
 * ------------------------------------------------------------------ */

describe("the caveat rule refuses a card that drops the reply's doubt", () => {
  test("the cue list is literal, word-bounded and short", () => {
    expect(CAVEAT_CUES).toContain("may not");
    expect(CAVEAT_CUES).toContain("not sure");
    expect(replyCarriedCaveat("the gate may not open")).toBe(true);
    expect(replyCarriedCaveat("I am not sure about the gate")).toBe(true);
    expect(replyCarriedCaveat("it can't say when")).toBe(true);
    // A word that merely CONTAINS a cue is not the cue.
    expect(replyCarriedCaveat("the tide turns at six")).toBe(false);
    expect(replyCarriedCaveat("dependent")).toBe(false);
  });

  test("a plain drop is malformed; a paraphrase is kept", () => {
    const doubt = "the gate may not open at six";
    // The reply carries doubt and the card says "none": refused.
    expect(
      cardDroppedCaveat({ ...CARD, uncertainty: "none stated" }, doubt),
    ).toBe(true);
    expect(cardDroppedCaveat({ ...CARD, uncertainty: "" }, doubt)).toBe(true);
    // The reply carries doubt and the card carries it in its own words: kept.
    expect(
      cardDroppedCaveat(
        { ...CARD, uncertainty: "whether the gate opens at six" },
        doubt,
      ),
    ).toBe(false);
    // No cue in the reply: the card's "none" is not second-guessed.
    expect(
      cardDroppedCaveat({ ...CARD, uncertainty: "none" }, "the tide turns at six"),
    ).toBe(false);
    // And the parse enforces it before a card can exist.
    const dropped = readCuratorAnswer(
      cardBlock({ uncertainty: "none stated" }),
      doubt,
    );
    expect(dropped.kind).toBe("invalid");
  });
});

/* ------------------------------------------------------------------ *
 * 4. Two PRISMs, their roles, and the budget.
 * ------------------------------------------------------------------ */

function providerRow(): ProviderRow {
  const read = validateProviderRow({
    name: "Local llama",
    baseUrl: "http://127.0.0.1:8080/v1",
    models: [{ id: "qwen", name: "Qwen" }],
  });
  if (read.kind !== "row") throw new Error("unreachable");
  return read.row;
}

const askIo: AskIo = {
  readTextFile: async (path) => {
    try {
      return readFileSync(path, "utf8");
    } catch {
      return null;
    }
  },
  writeTextFile: async (path, text) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text, "utf8");
  },
  createDirAll: async (path) => {
    mkdirSync(path, { recursive: true });
  },
};

function freshWorkspace(): string {
  return mkdtempSync(join(ROOT, "workspace-"));
}

interface Harness {
  io: AskTurnWriteIo;
  prisms: () => Prism[];
}

function harness(): Harness {
  let before: string | null = null;
  let minted = 0;
  const deps: AskContactDeps = {
    copy: async () => true,
    handOff: async () => {},
    canonicalize: async (path) => path,
    readPrismsText: async () => before,
    writePrismsText: async (text) => {
      before = text;
    },
    mintId: () => "prism-" + String(++minted),
  };
  const io: AskTurnWriteIo = {
    appendExchange: (workspace, slug, question, answer, _io, _now, move = null) =>
      appendExchange(workspace, slug, question, answer, askIo, () => TAKEN, move),
    appendMove: async (workspacePath, on, included, ending, answer, role) => {
      const moved = await recordAskCardTurn(
        askCardInFlight(workspacePath, { on, included, role }),
        ending,
        answer,
        deps,
      );
      return moved.prism;
    },
  };
  return {
    io,
    prisms: () => (before === null ? [] : before.split("\n").filter((l) => l !== "").map((l) => parsePrismLine(l)!)),
  };
}

function answered(text: string, curator?: AskCuratorSend): AskTurnSend {
  return {
    result: { kind: "answer", text },
    ending: "answered",
    left: true,
    reached: null,
    missed: null,
    ...(curator === undefined ? {} : { curator }),
  };
}

const CURATOR_SEND: AskCuratorSend = {
  left: true,
  ending: "answered",
  manager: "manager-small",
  task: "task-big",
  raw: cardBlock(),
  read: readCuratorAnswer(cardBlock(), REPLY),
};

describe("two PRISMs for one ask, and the second says its role", () => {
  test("the task line has no role; the curator line says curator and no material", async () => {
    const workspace = freshWorkspace();
    const h = harness();
    const written = await writeAskTurn(
      workspace,
      "tide-question",
      null,
      QUESTION,
      answered(REPLY, { ...CURATOR_SEND, read: { kind: "card", card: CARD, text: "x" } }),
      h.io,
    );
    expect(written.prism).not.toBeNull();
    expect(written.curatorPrism).not.toBeNull();
    const prisms = h.prisms();
    expect(prisms).toHaveLength(2);
    const taskChange = prisms[0]!.changes[0]!;
    const curatorChange = prisms[1]!.changes[0]!;
    expect(taskChange.kind).toBe("ask");
    expect(curatorChange.kind).toBe("ask");
    if (taskChange.kind !== "ask" || curatorChange.kind !== "ask") return;
    expect(taskChange.role).toBeUndefined();
    expect(curatorChange.role).toBe("curator");
    // The curator rode NO material and names no pointer.
    expect(curatorChange.included).toBeNull();
    expect(curatorChange.pointer).toBeNull();
    expect(curatorChange.outcome).toBe("answered");
    expect(curatorChange.responseSize).toBe(CURATOR_SEND.raw!.length);
    // Both name the same card: one ask, two egresses, joined by it.
    expect(prisms[0]!.on).toBe("tide-question");
    expect(prisms[1]!.on).toBe("tide-question");
  });

  test("a declined curator is a Move too: its egress is never invisible", async () => {
    const workspace = freshWorkspace();
    const h = harness();
    await writeAskTurn(
      workspace,
      "tide-question",
      null,
      QUESTION,
      answered(REPLY, {
        ...CURATOR_SEND,
        raw: "nothing worth keeping.",
        read: { kind: "declined", sentence: "nothing worth keeping." },
      }),
      h.io,
    );
    const prisms = h.prisms();
    expect(prisms).toHaveLength(2);
    expect((prisms[1]!.changes[0] as { role?: AskRole }).role).toBe("curator");
  });

  test("no curator call, no second PRISM", async () => {
    const workspace = freshWorkspace();
    const h = harness();
    await writeAskTurn(workspace, "tide-question", null, QUESTION, answered(REPLY), h.io);
    expect(h.prisms()).toHaveLength(1);
  });

  test("the whole ask's budget counts both calls; the task's own is unchanged", () => {
    expect(turnSteps({ kind: "http" })).toEqual({ steps: 1 });
    expect(turnSteps({ kind: "http" }, true).steps).toBe(2);
    expect(curatorSteps({ kind: "http" }).steps).toBe(1);
    expect(askSteps({ kind: "http" }, false, false).steps).toBe(1);
    expect(askSteps({ kind: "http" }, false, true).steps).toBe(2);
    expect(askSteps({ kind: "http" }, true, true).steps).toBe(3);
    expect(askSteps({ kind: "http" }, true, true).reason).toBe(
      "the task and the curator",
    );
    // The hook asks the whole ceiling with the curator counted, and never
    // spends the curator's exchange without declaring it.
    expect(source("canvas/useGround.ts")).toContain(
      "askSteps(route, packet.retrievable.length > 0, true)",
    );
  });
});

/* ------------------------------------------------------------------ *
 * 5. The no-card policy (failure asymmetry + decline).
 * ------------------------------------------------------------------ */

describe("the ask card's one sentence when no card was made", () => {
  test("a curator card is a card; a decline says its sentence", () => {
    expect(askTurnCardNote(answered(REPLY, CURATOR_SEND))).toBeNull();
    expect(
      askTurnCardNote(
        answered(REPLY, {
          ...CURATOR_SEND,
          read: { kind: "declined", sentence: "nothing worth keeping." },
        }),
      ),
    ).toBe("nothing worth keeping.");
    expect(
      askTurnCardNote(
        answered(REPLY, {
          ...CURATOR_SEND,
          raw: null,
          read: { kind: "invalid", sentence: CURATOR_MALFORMED_SENTENCE },
        }),
      ),
    ).toBe(CURATOR_MALFORMED_SENTENCE);
  });

  test("task answered + curator failed: the reply stands, one sentence says no card", () => {
    const sent = answered(REPLY, {
      ...CURATOR_SEND,
      raw: null,
      read: null,
      ending: "failed",
      sentence: ASK_CURATOR_FAILED_SENTENCE,
    });
    expect(sent.result).toEqual({ kind: "answer", text: REPLY });
    expect(askTurnCardNote(sent)).toBe(ASK_CURATOR_FAILED_SENTENCE);
    expect(ASK_CURATOR_FAILED_SENTENCE).toContain("reply stands");
  });

  test("a turn that did not answer keeps 17.11's sentence, curator or not", () => {
    const stopped: AskTurnSend = {
      result: { kind: "failed", sentence: "stopped" },
      ending: "stopped",
      left: true,
      reached: null,
      missed: null,
    };
    expect(askTurnCardNote(stopped)).toBe(ASK_NO_CARD_SENTENCE);
  });
});

/* ------------------------------------------------------------------ *
 * 6. The card says who distilled whose reply.
 * ------------------------------------------------------------------ */

function distilledIo(): DistilledIo {
  return {
    storeDistilledText: async (workspace, on, text) => {
      mkdirSync(join(workspace, "map", "readings"), { recursive: true });
      writeFileSync(join(workspace, "map", "readings", on + ".md"), text);
    },
    saveReadings: async () => {},
    saveGround: async () => {},
    saveGroundLinks: async () => {},
    storeSelectionText: async () => {},
  } as DistilledIo;
}

describe("a curator card names the manager model and the task model", () => {
  test("the reading line round-trips the two authors", () => {
    const reading = distilledReading("tide-card", "tide-question", TAKEN, {
      manager: "manager-small",
      task: "task-big",
    });
    const line = serializeReadingLine(reading);
    expect(line).toContain(" | manager: manager-small | task: task-big");
    expect(parseReadingLine(line)).toEqual(reading);
    expect(distilledAuthors(reading)).toEqual({
      manager: "manager-small",
      task: "task-big",
    });
    // A rule card keeps the old line and names no model.
    const rule = distilledReading("tide-card", "tide-question", TAKEN);
    expect(serializeReadingLine(rule)).not.toContain("manager:");
    expect(distilledAuthors(rule)).toBeNull();
  });

  test("the card's ONE footer line, the mirror and the writer all say the same sentence", async () => {
    const reading = distilledReading("tide-card", "tide-question", TAKEN, {
      manager: "manager-small",
      task: "task-big",
    });
    // STORY 17.15: the header line is gone (null); the footer carries the whole
    // sentence once, naming both models AND the source card.
    expect(readingKind(reading, new Map())).toBeNull();
    expect(
      readingProvenance(reading, new Map([["tide-question", "tide question"]])),
    ).toBe("distilled by manager-small from task-big's reply · from tide question");
    // A rule card keeps 17.11's wording — as its single footer line too.
    const rule = distilledReading("tide-card", "tide-question", TAKEN);
    expect(readingKind(rule, new Map([["tide-question", "tide question"]]))).toBeNull();
    expect(
      readingProvenance(rule, new Map([["tide-question", "tide question"]])),
    ).toBe("a rule's copy of tide question");

    const workspace = freshWorkspace();
    mkdirSync(join(workspace, "map", "readings"), { recursive: true });
    const written = await writeDistilledCard(
      workspace,
      [],
      [],
      [],
      [],
      [],
      [],
      "tide-question",
      "The tide turns at six",
      120,
      80,
      "x",
      TAKEN,
      distilledIo(),
      {},
      { manager: "manager-small", task: "task-big" },
    );
    if (written.kind !== "written") throw new Error("no card");
    expect(written.records.reading.manager).toBe("manager-small");
    expect(written.records.reading.task).toBe("task-big");

    const read = await import("../src/map/readings");
    const lines = read.serializeReadingLine(written.records.reading);
    expect(lines).toContain("manager: manager-small");

    const view: MirrorView = {
      references: written.records.references,
      readings: written.records.readings,
      texts: { [written.records.reading.on]: "x" },
      states: { [written.records.reading.on]: "current" },
      notes: {},
      orphanNotes: [],
      orphanMedia: [],
      links: written.links,
      orphanLinks: [],
      asks: [],
      sessions: [],
      sessionToolNames: {},
      sessionEndings: {},
      orphanSessionTranscripts: [],
      malformedAsks: [],
      orphanAskTurns: [],
      malformedGround: [],
      malformedReadings: [],
      malformedLinks: [],
    };
    expect(renderMirror(view)).toContain(
      "distilled by manager-small from task-big's reply",
    );
  });
});

/* ------------------------------------------------------------------ *
 * 7. The two rows and the role's record shape.
 * ------------------------------------------------------------------ */

describe("the two rows: a task pair and an explicit manager pair", () => {
  const chosen = (): import("../src/turn/providers").TurnSettings =>
    withSelection(withProvider(EMPTY_SETTINGS, providerRow()), "local-llama", "qwen");

  test("the manager defaults to the task, legibly", () => {
    const settings = chosen();
    expect(settings.managerProviderId).toBe("");
    expect(settings.managerModelId).toBe("");
    expect(managerSelection(settings)).toEqual({
      providerId: "local-llama",
      modelId: "qwen",
    });
    expect(resolveManager(settings).kind).toBe("resolved");
  });

  test("a manager of its own, and back to same-as-task explicitly", () => {
    const rows = withProvider(chosen(), {
      ...providerRow(),
      id: "small-row",
      name: "Small",
      models: [{ id: "tiny", name: "Tiny", capabilities: { tools: false, vision: false } }],
    });
    const explicit = withManagerSelection(rows, "small-row", "tiny");
    expect(managerSelection(explicit)).toEqual({
      providerId: "small-row",
      modelId: "tiny",
    });
    const same = withManagerSameAsTask(explicit);
    expect(same.managerProviderId).toBe("");
    expect(managerSelection(same)).toEqual({
      providerId: "local-llama",
      modelId: "qwen",
    });
  });

  test("the config round-trips both pairs, and an old config reads as same-as-task", () => {
    const settings = withManagerSelection(chosen(), "local-llama", "qwen");
    const stored = storedTurnSettings(settings);
    expect(readTurnSettings(stored)).toEqual(settings);
    const old = {
      providerId: "local-llama",
      modelId: "qwen",
      providers: stored.providers,
    };
    const read = readTurnSettings(old);
    expect(read.managerProviderId).toBe("");
    expect(read.managerModelId).toBe("");
  });

  test("the settings surface shows the two rows and the exact tooltips", () => {
    const panel = source("canvas/SettingsPanel.tsx");
    expect(panel).toContain("Task model");
    expect(panel).toContain("Manager model");
    expect(panel).toContain("same as the task model");
    expect(panel).toContain("TASK_MODEL_TOOLTIP");
    expect(panel).toContain("MANAGER_MODEL_TOOLTIP");
    expect(TASK_MODEL_TOOLTIP).toBe(
      "the model that does the work: answers the question, using the context you wired in.",
    );
    expect(MANAGER_MODEL_TOOLTIP).toBe(
      "the model that writes the brief and, after the answer, distils the reply into a card. It can be the same model — a smaller one is often enough for distillation.",
    );
    // The task record is unchanged: the same two selection fields the app has
    // always stored; the manager is one added stated pair.
    expect(panel).toContain("value={settings.providerId}");
    expect(panel).toContain("value={settings.modelId}");
    expect(panel).toContain("value={managerChosen.providerId}");
    expect(panel).toContain("value={managerChosen.modelId}");
  });

  test("role is optional, parses old lines, and serializes only when present", () => {
    expect(CHANGE_OPTIONAL_KEYS.ask).toEqual(["anchor", "role"]);
    const base = {
      kind: "ask",
      pointer: null,
      outcome: "no-response",
      included: null,
      responseSize: null,
      decode: null,
    };
    const old = parsePrismChange(base);
    expect(old).not.toBeNull();
    if (old !== null && old.kind === "ask") {
      // An old line reads as the task call, not as unclassified.
      expect(askRoleOf(old)).toBe("task");
    }
    const curator = parsePrismChange({ ...base, role: "curator" });
    expect(curator).not.toBeNull();
    if (curator !== null && curator.kind === "ask") {
      expect(curator.role).toBe("curator");
    }
    expect(parsePrismChange({ ...base, role: "judge" })).toBeNull();
    const prism: Prism = {
      id: "prism-1",
      on: "tide-question",
      contact: "ask",
      pointer: null,
      changes: [{ ...base, kind: "ask", outcome: "answered", responseSize: 3, decode: "clean", role: "curator" }],
      explanation: "",
      extra: {},
    };
    const line = serializePrismLine(prism);
    expect(line).toContain('"role":"curator"');
    expect(parsePrismLine(line)).toEqual(prism);
    const taskLine = serializePrismLine({
      ...prism,
      changes: [{ ...base, kind: "ask", outcome: "answered", responseSize: 3, decode: "clean" }],
    });
    expect(taskLine).not.toContain("role");
  });
});

/* ------------------------------------------------------------------ *
 * 8. The hook's one call site, and the wire it reuses.
 * ------------------------------------------------------------------ */

describe("the hook wires the second call without a new wire kind", () => {
  test("the curator runs after the task, on the same turn port", () => {
    const hook = source("canvas/useGround.ts");
    expect(hook).toContain("turn.sendMessages(managerRoute, messages)");
    expect(hook).toContain("resolveManager(current)");
    expect(hook).toContain("readCuratorAnswer(curated.text, reply)");
    // The reply is only distilling when the task ANSWERED; the guard returns
    // the sent facts untouched otherwise.
    const at = hook.indexOf("STORY 17.12 — THE SECOND CALL");
    expect(at).toBeGreaterThan(-1);
    expect(hook.slice(at)).toContain('sent.ending !== "answered"');
    // No new wire kind: the sidecar's port gained a door, not a line shape.
    expect(source("turn/sidecar.ts")).toContain("sendMessages: runMessages");
    expect(source("turn/sidecar.ts")).toContain(
      "runRoute(transport, route, messages,",
    );
    expect(source("turn/protocol.ts")).not.toContain("curator");
  });

  test("the writer is one call site, after the task's record", () => {
    const hook = source("canvas/useGround.ts");
    expect(hook.match(/await writeDistilledCard\(/g) ?? []).toHaveLength(1);
    expect(hook.indexOf("const recorded = await writeAskTurn")).toBeLessThan(
      hook.indexOf("await writeDistilledCard("),
    );
    // The curator's title and text are the card; the author pair is handed to
    // the writer, which puts it on the reading's line.
    expect(hook).toContain("curated?.card.title");
    expect(hook).toContain("curated?.text");
    expect(hook).toContain("curatedAuthors");
  });

  test("renderedMapContent stays empty", async () => {
    const map = await import("../src/canvas/mapContentRules");
    expect(map.renderedMapContent("ground")).toEqual([]);
  });
});
