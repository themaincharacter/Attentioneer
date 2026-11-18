import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { fileURLToPath } from "node:url";
import {
  CHANGE_KEYS,
  parsePrisms,
  type Prism,
} from "../src/map/prisms";
import { pointerKey } from "../src/map/pointers";
import { serializeReference } from "../src/map/refs";
import { utf8ByteLength } from "../src/lib/textBytes";
import {
  NO_APP_ROUTE,
  abandonAsk,
  askPacket,
  declareAsk,
  intakeAskResponse,
  sendAsk,
  type AskAppSend,
  type AskContactDeps,
  type AskRequest,
} from "../src/contacts/ask";
import { AskPanel } from "../src/canvas/AskPanel";
import type { AskContext } from "../src/turn/context";
import {
  assembleAskPacket,
  type AskPacket,
} from "../src/turn/packet";
import { declarationWords } from "../src/canvas/contactRules";
import {
  NO_PROVIDER_SENTENCE,
  SIDECAR_UNAVAILABLE_SENTENCE,
  sendPacketApp,
  type PacketSendDeps,
} from "../src/turn/egress";
import {
  EMPTY_SETTINGS,
  resolveSelection,
  withProvider,
  withSelection,
  type ProviderRow,
  type TurnSettings,
} from "../src/turn/providers";
import { askTurnMessages, askTurnPacket } from "../src/turn/turn";
import type { PacketTurnAnswer, TurnPort } from "../src/turn/turn";
import {
  parseRequestLine,
  type SidecarLine,
} from "../src/turn/protocol";

/**
 * Story 15.2 — THE ASK BECOMES APP-SENT.
 *
 * One protocol, one record, one inclusion set: the transport changes, nothing
 * else does. These tests pin the story's hard constraints:
 *   - the app-sent Ask carries the CLIPBOARD packet's bytes, unchanged;
 *   - both routes append the SAME ONE PRISM (inclusion set, sizes, outcome)
 *     and never the person's question or the answer's words;
 *   - no provider (or no sidecar) is the STATED fallback: one sentence, no
 *     record, and the clipboard path still works;
 *   - a failed turn writes nothing, and a later paste logs exactly one PRISM;
 *   - the declaration names the inclusion set and its sizes, from the same
 *     bytes the send carries, before the send verb;
 *   - an Ask writes no map content (the folder snapshot: only the PRISM log).
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const ON = "rain";
const QUESTION = "what does this reach say about rain?";
const ANSWER = "an answer\nwith two lines";
const URL_POINTER = { form: "url" as const, value: "https://example.org/chat" };
const PATH_POINTER = { form: "path" as const, value: "notes/x.md" };

/** One provider row, and the selection a turn carries (story 4's shape). */
function providerRow(): ProviderRow {
  return {
    id: "local",
    name: "Local",
    baseUrl: "http://x",
    models: [{ id: "m", name: "M", capabilities: { tools: false, vision: false } }],
  };
}

function turnSettings(): TurnSettings {
  return withSelection(withProvider(EMPTY_SETTINGS, providerRow()), "local", "m");
}

function request(overrides: Partial<AskRequest> = {}): AskRequest {
  return {
    on: ON,
    contact: "ask",
    pointer: URL_POINTER,
    included: [PATH_POINTER, URL_POINTER],
    question: QUESTION,
    transport: "app",
    workspacePath: "/ws",
    ...overrides,
  };
}

interface Harness {
  deps: AskContactDeps;
  copied: string[];
  packets: AskPacket[];
  writes: () => number;
  log: () => string | null;
}

function harness(options: {
  sendApp?: (packet: AskPacket) => Promise<AskAppSend>;
  before?: string | null;
} = {}): Harness {
  let log = options.before ?? null;
  let writes = 0;
  let minted = 0;
  const copied: string[] = [];
  const packets: AskPacket[] = [];
  const deps: AskContactDeps = {
    copy: async (text) => {
      copied.push(text);
      return true;
    },
    sendApp:
      options.sendApp === undefined
        ? undefined
        : async (packet) => {
            packets.push(packet);
            return await options.sendApp!(packet);
          },
    handOff: async () => {},
    canonicalize: async (path) => path,
    readPrismsText: async () => log,
    writePrismsText: async (text) => {
      log = text;
      writes += 1;
    },
    mintId: () => "prism-" + ++minted,
  };
  return {
    deps,
    copied,
    packets,
    writes: () => writes,
    log: () => log,
  };
}

/** A scripted transport: the n-th turn is answered with the n-th string. */
function transporting(answers: readonly string[]) {
  const waiting = new Map<number, (line: SidecarLine) => void>();
  let index = 0;
  return {
    async send(line: string): Promise<void> {
      const request = parseRequestLine(line);
      if (request === null || request.kind !== "turn") return;
      const text = answers[index] ?? "";
      index += 1;
      setTimeout(() => {
        waiting.get(request.id)?.({
          id: request.id,
          kind: "part",
          part: "text",
          text,
        });
        waiting.get(request.id)?.({ id: request.id, kind: "done" });
      }, 0);
    },
    subscribe(id: number, handler: (line: SidecarLine) => void) {
      waiting.set(id, handler);
      return () => waiting.delete(id);
    },
  };
}

function only(text: string | null): Prism {
  expect(text).not.toBeNull();
  const parsed = parsePrisms(text as string);
  expect(parsed.malformed).toEqual([]);
  expect(parsed.prisms).toHaveLength(1);
  return parsed.prisms[0];
}

function turnPort(overrides: Partial<TurnPort> = {}): TurnPort {
  return {
    ask: async () => ({ kind: "answer", text: "x" }),
    sendPacket: async (): Promise<PacketTurnAnswer> => ({
      result: { kind: "answer", text: "x" },
      messages: [],
      read: null,
      missed: null,
    }),
    start: async () => ({ kind: "running" }),
    stop: async () => {},
    ...overrides,
  };
}

/* ------------------------------------------------------------------ *
 * ONE PACKET, ONE SET OF BYTES
 * ------------------------------------------------------------------ */

describe("the app-sent Ask carries the clipboard packet, byte for byte", () => {
  test("both routes compose the same packet and the wire does not trim it", async () => {
    const h = harness({
      sendApp: async () => ({ kind: "answered", text: ANSWER }),
    });
    const copied = await sendAsk(request({ transport: "copy" }), h.deps);
    const appSent = await sendAsk(request({ transport: "app" }), h.deps);
    if (copied.kind !== "sent" || appSent.kind !== "sent") {
      throw new Error("unreachable");
    }

    // THE CLIPBOARD'S COMPOSITION IS UNTOUCHED: citations only, exactly the
    // old packet, never a preview.
    expect(copied.ask.packet).toBe(askPacket(QUESTION, [PATH_POINTER, URL_POINTER]));
    expect(h.copied).toEqual([copied.ask.packet]);

    // THE APP-SENT PACKET IS THE NEW ONE (story 3): the anchored card, the
    // included reaches' citations, the instruction, the bound. With no previews
    // handed in, the card is named by its slug and nothing is read.
    const empty = assembleAskPacket({
      question: QUESTION,
      card: { name: ON, state: null, reading: null, note: null },
      reaches: [
        { form: PATH_POINTER.form, value: PATH_POINTER.value, preview: null },
        { form: URL_POINTER.form, value: URL_POINTER.value, preview: null },
      ],
      retrievable: [],
    });
    expect(appSent.ask.packet).toBe(empty.text);
    expect(appSent.ask.packet).not.toBe(copied.ask.packet);
    expect(h.packets).toEqual([empty]);
    expect(h.packets[0].messages[0]).toEqual({
      role: "user",
      content: appSent.ask.packet,
    });
    // The packet's own bytes are what left; the clipboard's is not.
    expect(appSent.ask.packet).toContain("## path notes/x.md");
    expect(appSent.ask.packet).toContain("## the bound");
  });

  test("the packet crosses the wire as ONE user message, byte for byte", async () => {
    // The assembled packet's message is what the wire carries VERBATIM — no
    // trim, no re-composition by the turn.
    const packet = assembleAskPacket({
      question: "  what does this reach say?\n",
      card: { name: "rain", state: null, reading: "first line", note: null },
      reaches: [],
      retrievable: ["rain"],
    });
    const sent: string[] = [];
    const waiting = new Map<number, (line: SidecarLine) => void>();
    const transport = {
      async send(line: string): Promise<void> {
        sent.push(line);
        const request = parseRequestLine(line);
        if (request === null || request.kind !== "turn") return;
        setTimeout(() => {
          waiting.get(request.id)?.({
            id: request.id,
            kind: "part",
            part: "text",
            text: "the answer",
          });
          waiting.get(request.id)?.({ id: request.id, kind: "done" });
        }, 0);
      },
      subscribe(id: number, handler: (line: SidecarLine) => void) {
        waiting.set(id, handler);
        return () => waiting.delete(id);
      },
    };

    const answered = await askTurnPacket(
      transport,
      { baseUrl: "http://x", model: "m", apiKey: "sk-never-logged" },
      packet,
      async () => null,
    );
    expect(answered.result).toEqual({ kind: "answer", text: "the answer" });
    const wire = parseRequestLine(sent[0] as string);
    if (wire === null || wire.kind !== "turn") throw new Error("unreachable");
    expect(wire.messages).toEqual([packet.messages[0]]);
    expect(wire.messages[0].content).toContain("what does this reach say?\n");
  });

  test("the packet still carries citations only — the app reads no target", () => {
    const flow = codeOnly(source("contacts/ask.ts"));
    for (const reader of [
      "readHead",
      "readTextHead",
      "readTextFile",
      "readPointersText",
    ]) {
      expect({ reader, found: flow.includes(reader) }).toEqual({
        reader,
        found: false,
      });
    }
    const packet = askPacket(QUESTION, [PATH_POINTER]);
    expect(packet).toContain("- path notes/x.md");
    expect(packet).not.toContain("x.md's bytes");
  });
});

/* ------------------------------------------------------------------ *
 * ONE RECORD
 * ------------------------------------------------------------------ */

describe("the app-sent intake appends the SAME one PRISM, never the words", () => {
  test("the answered Change is identical to the clipboard route's", async () => {
    const question = "SECRET QUESTION PROSE";
    const answer = "SECRET ANSWER PROSE";
    const h = harness({ sendApp: async () => ({ kind: "answered", text: answer }) });
    const result = await sendAsk(
      request({ question, transport: "app" }),
      h.deps,
    );
    if (result.kind !== "sent") throw new Error("unreachable");

    // The send itself writes NOTHING: the answer is content handed back, and
    // the app's queued intake is the same function a paste uses.
    expect(result.answer).toBe(answer);
    expect(result.response).toBeUndefined();
    expect(result.prism).toBeUndefined();
    expect(h.writes()).toBe(0);

    const appIntake = await intakeAskResponse(
      result.ask,
      result.answer as string,
      null,
      h.deps,
    );
    if (appIntake.kind !== "moved") throw new Error("unreachable");
    expect(appIntake.response).toEqual({
      text: answer,
      size: utf8ByteLength(answer),
      decode: "clean",
    });
    expect(h.writes()).toBe(1);

    const log = h.log() as string;
    expect(log).not.toContain("SECRET");
    for (const key of ['"text"', '"question"', '"response"', '"content"']) {
      expect(log).not.toContain(key);
    }

    const change = only(log).changes[0];
    expect(change).toEqual({
      kind: "ask",
      pointer: pointerKey(ON, "url", URL_POINTER.value),
      outcome: "answered",
      included: [
        pointerKey(ON, "path", PATH_POINTER.value),
        pointerKey(ON, "url", URL_POINTER.value),
      ],
      responseSize: utf8ByteLength(answer),
      decode: "clean",
    });
    expect(Object.keys(change as unknown as Record<string, unknown>).sort()).toEqual([
      ...CHANGE_KEYS.ask,
    ]);

    // The clipboard route over the same bytes logs the SAME Change.
    const c = harness();
    const copied = await sendAsk(
      request({ question, transport: "copy" }),
      c.deps,
    );
    if (copied.kind !== "sent") throw new Error("unreachable");
    const intake = await intakeAskResponse(copied.ask, answer, null, c.deps);
    if (intake.kind !== "moved") throw new Error("unreachable");
    expect(intake.prism.changes[0]).toEqual(change);
  });

  test("the transport is named on the in-flight Ask (the panel never hides it)", async () => {
    const h = harness({ sendApp: async () => ({ kind: "answered", text: ANSWER }) });
    const result = await sendAsk(request(), h.deps);
    if (result.kind !== "sent") throw new Error("unreachable");
    expect(result.ask.transport).toBe("app");
    expect(result.note).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * THE STATED FALLBACK
 * ------------------------------------------------------------------ */

describe("the fallback is stated, not silent, and is not an Ask failure", () => {
  test("no provider: one sentence, nothing logged, the clipboard path works", async () => {
    const h = harness({
      sendApp: async () => ({
        kind: "unavailable",
        sentence: NO_PROVIDER_SENTENCE,
      }),
    });
    const fallback = await sendAsk(request(), h.deps);
    expect(fallback).toEqual({ kind: "fallback", reason: NO_PROVIDER_SENTENCE });
    expect(h.writes()).toBe(0);
    expect(h.log()).toBeNull();

    // The same Ask by clipboard: still the old, complete Move.
    const copied = await sendAsk(request({ transport: "copy" }), h.deps);
    if (copied.kind !== "sent") throw new Error("unreachable");
    expect(h.copied).toEqual([copied.ask.packet]);
    const intake = await intakeAskResponse(copied.ask, ANSWER, null, h.deps);
    expect(intake.kind).toBe("moved");
    expect(h.writes()).toBe(1);
  });

  test("an unwired app route is the same sentence, and nothing leaves", async () => {
    const h = harness();
    const result = await sendAsk(request(), h.deps);
    expect(result).toEqual({ kind: "fallback", reason: NO_APP_ROUTE });
    expect(h.packets).toEqual([]);
    expect(h.writes()).toBe(0);
  });

  test("a turn leaves only when providerId:modelId names a row", () => {
    expect(resolveSelection(EMPTY_SETTINGS).kind).toBe("refused");
    // A selection that names a provider row with no such model resolves to
    // nothing: the turn must not fall back to the row's first model.
    const row = providerRow();
    expect(
      resolveSelection(withSelection(withProvider(EMPTY_SETTINGS, row), "local",
        "missing-model")).kind,
    ).toBe("refused");
    // A removed provider leaves the selection naming nothing.
    expect(
      resolveSelection(withSelection(withProvider(EMPTY_SETTINGS, row), "gone",
        "m")).kind,
    ).toBe("refused");
    expect(
      resolveSelection(withSelection(withProvider(EMPTY_SETTINGS, row), "local",
        "m")).kind,
    ).toBe("resolved");
  });

  test("the egress decides start-before-send, and says the two fallbacks", async () => {
    let starts = 0;
    let sends = 0;
    const deps = (settings: TurnSettings): PacketSendDeps => ({
      loadSettings: async () => settings,
      apiKey: async () => "",
      turn: turnPort({
        start: async () => {
          starts += 1;
          return { kind: "refused", sentence: "missing bun" };
        },
        sendPacket: async () => {
          sends += 1;
          return { kind: "answer", text: "x" };
        },
      }),
    });

    const none = await sendPacketApp("packet", deps(EMPTY_SETTINGS));
    expect(none).toEqual({
      kind: "unavailable",
      sentence: NO_PROVIDER_SENTENCE,
    });
    expect(starts).toBe(0);
    expect(sends).toBe(0);

    const refused = await sendPacketApp("packet", deps(turnSettings()));
    expect(refused).toEqual({
      kind: "unavailable",
      sentence: SIDECAR_UNAVAILABLE_SENTENCE,
    });
    expect(starts).toBe(1);
    expect(sends).toBe(0);
  });

  test("an answered turn hands the text back; a failed one is one sentence", async () => {
    const packet = assembleAskPacket({
      question: "why",
      card: { name: "rain", state: null, reading: null, note: null },
      reaches: [],
      retrievable: [],
    });
    const answered = await sendPacketApp(packet, {
      loadSettings: async () => turnSettings(),
      apiKey: async (providerId) => {
        expect(providerId).toBe("local");
        return "sk-not-logged";
      },
      fetchBlock: async () => null,
      turn: turnPort({
        sendPacket: async (_provider, handed) => {
          expect(handed).toBe(packet);
          return {
            result: { kind: "answer", text: "the answer" },
            messages: [...packet.messages],
            read: null,
            missed: null,
          };
        },
      }),
    });
    expect(answered).toEqual({
      kind: "answered",
      text: "the answer",
      messages: [...packet.messages],
      read: null,
      missed: null,
      ghost: { kind: "none" },
    });

    const failed = await sendPacketApp(packet, {
      loadSettings: async () => turnSettings(),
      apiKey: async () => "",
      fetchBlock: async () => null,
      turn: turnPort({
        sendPacket: async (): Promise<PacketTurnAnswer> => ({
          result: { kind: "error", sentence: "the provider said no" },
          messages: [...packet.messages],
          read: null,
          missed: null,
        }),
      }),
    });
    expect(failed).toEqual({
      kind: "failed",
      sentence: "the provider said no",
      messages: [...packet.messages],
    });
  });
});

/* ------------------------------------------------------------------ *
 * THE PACKET'S BYTES AND THE PRISM'S SILENCE
 * ------------------------------------------------------------------ */

describe("the packet the panel declares is the packet the send carries", () => {
  test("the same pure assembly, block sizes included, byte for byte", async () => {
    const context: AskContext = {
      card: {
        name: "rain",
        state: "the file is gone; this is the copy kept when it was added",
        reading: "the card's head",
        note: "my note",
      },
      reaches: [
        { form: "path", value: "notes/x.md", preview: "x head" },
        { form: "url", value: "https://example.org/chat", preview: null },
      ],
      retrievable: ["rain", "path notes/x.md"],
      sources: [],
    };
    const h = harness({
      sendApp: async (packet) => ({
        kind: "answered",
        text: ANSWER,
        messages: packet.messages,
        read: null,
        missed: null,
      }),
    });
    const result = await sendAsk(
      request({
        transport: "app",
        included: [PATH_POINTER, URL_POINTER],
        previews: {
          card: context.card,
          reaches: context.reaches,
          retrievable: context.retrievable,
        },
      }),
      h.deps,
    );
    if (result.kind !== "sent") throw new Error("unreachable");

    const shown = assembleAskPacket({
      question: QUESTION,
      card: context.card,
      reaches: context.reaches,
      retrievable: context.retrievable,
    });
    // What the panel would declare is exactly what left.
    expect(h.packets).toHaveLength(1);
    expect(h.packets[0].text).toBe(shown.text);
    expect(result.ask.packet).toBe(shown.text);
    expect(result.sentMessages).toEqual(shown.messages);
    // And the declaration's sizes are those bytes' own.
    expect(shown.declaration.total).toBe(utf8ByteLength(result.ask.packet));
    for (const [index, line] of shown.declaration.blocks.entries()) {
      expect(line.size).toBe(utf8ByteLength(shown.blocks[index].text));
    }
    // The previews and the card's state rode; the unincluded reach did not.
    expect(result.ask.packet).toContain("the card's head");
    expect(result.ask.packet).toContain("x head");
    expect(result.ask.packet).toContain(
      "the file is gone; this is the copy kept when it was added",
    );
    expect(result.ask.packet).not.toContain("never included");
  });

  test("the ONE follow-up's read is the app's fetch, and its bytes are the readback", async () => {
    let fetched = 0;
    const h = harness({
      sendApp: async (packet) => {
        const answer = await askTurnPacket(
          transporting(["READ: rain", "the follow-up answer"]),
          { baseUrl: "http://x", model: "m", apiKey: "" },
          packet,
          async (name) => {
            fetched += 1;
            expect(name).toBe("rain");
            return "the card in full";
          },
        );
        return {
          kind: "answered",
          text: answer.result.kind === "answer" ? answer.result.text : "",
          messages: answer.messages,
          read: answer.read,
          missed: answer.missed,
        };
      },
    });
    const result = await sendAsk(
      request({
        transport: "app",
        previews: {
          card: { name: "rain", state: null, reading: "head", note: null },
          reaches: [],
          retrievable: ["rain"],
        },
      }),
      h.deps,
    );
    if (result.kind !== "sent") throw new Error("unreachable");
    expect(fetched).toBe(1);
    expect(result.read).toBe("rain");
    expect(result.sentMessages).toHaveLength(2);
    expect(result.sentMessages?.[1].content).toContain("the card in full");
  });
});

describe("the PRISM keeps no words and no preview content", () => {
  test("the record holds the inclusion set, sizes and outcome — nothing else", async () => {
    const h = harness({
      sendApp: async (packet) => ({
        kind: "answered",
        text: "SECRET ANSWER PROSE",
        messages: packet.messages,
        read: "rain",
        missed: null,
      }),
    });
    const result = await sendAsk(
      request({
        transport: "app",
        question: "SECRET QUESTION PROSE",
        included: [PATH_POINTER],
        previews: {
          card: {
            name: "rain",
            state: null,
            reading: "SECRET READING PREVIEW",
            note: "SECRET NOTE PREVIEW",
          },
          reaches: [
            { form: "path", value: "notes/x.md", preview: "SECRET REACH PREVIEW" },
          ],
          retrievable: ["rain", "path notes/x.md"],
        },
      }),
      h.deps,
    );
    if (result.kind !== "sent") throw new Error("unreachable");
    // The packet itself DID carry the previews (that is the amendment).
    expect(result.ask.packet).toContain("SECRET READING PREVIEW");
    const intake = await intakeAskResponse(
      result.ask,
      result.answer as string,
      null,
      h.deps,
    );
    expect(intake.kind).toBe("moved");
    const log = h.log() as string;
    expect(log).not.toContain("SECRET");
    for (const key of ['"text"', '"question"', '"response"', '"content"', '"preview"']) {
      expect({ key, found: log.includes(key) }).toEqual({ key, found: false });
    }
    expect(only(log).changes[0]).toMatchObject({
      kind: "ask",
      outcome: "answered",
      included: [pointerKey(ON, "path", PATH_POINTER.value)],
    });
  });
});

/* ------------------------------------------------------------------ *
 * A FAILED TURN IS NOT A SECOND RECORD
 * ------------------------------------------------------------------ */

describe("a sidecar failure mid-ask writes nothing, and a paste logs ONE", () => {
  test("the failed turn is one sentence; the paste is the one PRISM", async () => {
    const h = harness({
      sendApp: async () => ({
        kind: "failed",
        sentence: "the sidecar stopped before answering",
      }),
    });
    const result = await sendAsk(request(), h.deps);
    if (result.kind !== "sent") throw new Error("unreachable");
    expect(result.note).toBe("the sidecar stopped before answering");
    expect(result.response).toBeUndefined();
    expect(result.prism).toBeUndefined();
    expect(h.writes()).toBe(0);

    // The person pastes the clipboard answer: exactly ONE PRISM, answered.
    const intake = await intakeAskResponse(result.ask, ANSWER, null, h.deps);
    if (intake.kind !== "moved") throw new Error("unreachable");
    expect(h.writes()).toBe(1);
    expect(only(h.log()).changes[0]).toMatchObject({
      outcome: "answered",
      responseSize: utf8ByteLength(ANSWER),
    });
  });

  test("ending a failed turn is the no-response PRISM, still exactly one", async () => {
    const h = harness({
      sendApp: async () => ({ kind: "failed", sentence: "the turn was stopped" }),
    });
    const result = await sendAsk(request(), h.deps);
    if (result.kind !== "sent") throw new Error("unreachable");
    const ended = await abandonAsk(result.ask, h.deps);
    expect(ended.kind).toBe("moved");
    expect(h.writes()).toBe(1);
    expect(only(h.log()).changes[0]).toMatchObject({
      outcome: "no-response",
      responseSize: null,
      decode: null,
    });
  });
});

/* ------------------------------------------------------------------ *
 * THE DECLARATION BEFORE EGRESS
 * ------------------------------------------------------------------ */

describe("the declaration names what will go, before anything leaves", () => {
  test("its sizes are the packet's own bytes, citation by citation", () => {
    const declaration = declareAsk(QUESTION, [PATH_POINTER, URL_POINTER]);
    expect(declaration.questionSize).toBe(utf8ByteLength(QUESTION));
    expect(declaration.packetSize).toBe(
      utf8ByteLength(askPacket(QUESTION, [PATH_POINTER, URL_POINTER])),
    );
    expect(declaration.citations).toEqual([
      {
        form: "path",
        value: "notes/x.md",
        size: utf8ByteLength("- path notes/x.md"),
      },
      {
        form: "url",
        value: "https://example.org/chat",
        size: utf8ByteLength("- url https://example.org/chat"),
      },
    ]);

    const words = declarationWords(declaration);
    expect(words).toContain("will go:");
    expect(words).toContain("your question (" + utf8ByteLength(QUESTION) + " bytes)");
    expect(words).toContain("path notes/x.md");
    expect(words).toContain("url https://example.org/chat");
    expect(words).toContain(declaration.packetSize + " bytes in all");
    // With no inclusion the line still says what goes.
    expect(declarationWords(declareAsk("why", []))).toContain("no citation");
  });

  test("the panel renders the declaration BEFORE the only send verb", () => {
    const panel = codeOnly(source("canvas/AskPanel.tsx"));
    const declaration = panel.indexOf("declarationWords(");
    const declared = panel.indexOf("ask-declaration");
    const send = panel.indexOf('send("app")');
    expect(declared).toBeGreaterThan(-1);
    expect(declaration).toBeGreaterThan(-1);
    expect(send).toBeGreaterThan(declaration);
    // The send verb lives in the composing branch, not beside an in-flight Ask.
    expect(panel).toContain("session === null");
    // And the declared line is the flow's own helper, not a second composition.
    expect(panel).toContain("declareAsk(question, included())");
  });

  test("the composing panel shows the line, then send; no clipboard until fallback", () => {
    // The previews the app read: the card and one included reach, with a
    // stored reading so the packet's declaration names every block.
    const context: AskContext = {
      card: {
        name: "rain",
        state: null,
        reading: "the first line of the reading",
        note: null,
      },
      reaches: [],
      retrievable: ["rain"],
      sources: [],
    };
    const props = {
      name: "rain",
      rows: [],
      ride: null,
      session: null,
      kept: false,
      busy: false,
      note: null,
      fallback: null,
      running: false,
      context,
      sent: null,
      onIncludedChange: () => {},
      onSend: () => {},
      onStop: () => {},
      onIntake: () => {},
      onAbandon: () => {},
      onKeep: () => {},
      onLog: () => {},
      onClose: () => {},
    };
    const html = renderToStaticMarkup(
      createElement(AskPanel, { ...props, rows: [] as never[] }),
    );
    const declarationAt = html.indexOf("will go:");
    const sendAt = html.indexOf("ask-send");
    expect(declarationAt).toBeGreaterThan(-1);
    expect(sendAt).toBeGreaterThan(declarationAt);
    expect(html).not.toContain("ask-copy");
    // The declaration names the card block and its size.
    expect(html).toContain("the card");
    expect(html).toContain("bytes in all");
    // And the readback's one verb stands before the send.
    expect(html).toContain("the exact bytes");
    expect(html.indexOf("the exact bytes")).toBeLessThan(sendAt);

    const fallbackHtml = renderToStaticMarkup(
      createElement(AskPanel, {
        ...props,
        rows: [] as never[],
        fallback: NO_PROVIDER_SENTENCE,
      }),
    );
    expect(fallbackHtml).toContain(NO_PROVIDER_SENTENCE);
    expect(fallbackHtml).toContain("ask-copy");
    expect(fallbackHtml).toContain("ask-handoff");
    expect(fallbackHtml).not.toContain("ask-send");
    // The fallback's declaration is the clipboard packet's own, unchanged.
    expect(fallbackHtml).toContain("will go:");
    expect(fallbackHtml).toContain("no citation");

    // While the previews are still being read, nothing can leave: no send verb.
    const readingHtml = renderToStaticMarkup(
      createElement(AskPanel, { ...props, rows: [] as never[] , context: null }),
    );
    // The verb is there but DEAD, and no declaration is shown: nothing can
    // leave before the bytes are known and named.
    expect(readingHtml).toContain("ask-send");
    expect(readingHtml).toContain("disabled");
    expect(readingHtml).not.toContain("will go:");
    expect(readingHtml).toContain("reading the included previews");
  });
});

/* ------------------------------------------------------------------ *
 * AN ASK IS NOT A MAP MOVE
 * ------------------------------------------------------------------ */

function snapshot(
  dir: string,
  base = dir,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = full.slice(base.length + 1);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out[rel + "/"] = "";
      snapshot(full, base, out);
    } else {
      out[rel] = stats.size + ":" + readFileSync(full).toString("base64");
    }
  }
  return out;
}

const workspace = mkdtempSync(join(tmpdir(), "attentioneer-ask-app-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("an Ask writes no map content (the folder snapshot)", () => {
  test("only the PRISM log changes: no history, no mirror, no reading", async () => {
    mkdirSync(join(workspace, "map", "references"), { recursive: true });
    writeFileSync(
      join(workspace, "map", "history.jsonl"),
      '{"move":"authored"}\n',
    );
    writeFileSync(join(workspace, "map", "mirror.md"), "the mirror before\n");
    writeFileSync(join(workspace, "map", "readings.txt"), "a reading before\n");
    writeFileSync(join(workspace, "map", "prisms.jsonl"), "");
    writeFileSync(
      join(workspace, "map", "references", ON + ".md"),
      serializeReference({
        id: ON,
        slug: ON,
        name: ON,
        x: 0,
        y: 0,
        body: "the word's memory, untouched",
        extra: {},
      }),
    );
    const before = snapshot(workspace);
    const hadPrisms = before["map/prisms.jsonl"];

    const logPath = join(workspace, "map", "prisms.jsonl");
    const deps: AskContactDeps = {
      copy: async () => true,
      sendApp: async () => ({ kind: "answered", text: ANSWER }),
      handOff: async () => {},
      canonicalize: async (path) => path,
      readPrismsText: async () =>
        existsSync(logPath) ? readFileSync(logPath, "utf8") : null,
      writePrismsText: async (text) => writeFileSync(logPath, text),
      mintId: () => "prism-app-sent",
    };
    const result = await sendAsk(
      request({ transport: "app", workspacePath: workspace }),
      deps,
    );
    expect(result.kind).toBe("sent");
    if (result.kind !== "sent") throw new Error("unreachable");
    // The send itself leaves the folder byte-identical.
    expect(snapshot(workspace)).toEqual(before);

    // The app's queued intake is the one write: the ONE PRISM.
    const intake = await intakeAskResponse(
      result.ask,
      result.answer as string,
      null,
      deps,
    );
    expect(intake.kind).toBe("moved");

    const after = snapshot(workspace);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const prismsNow = readFileSync(logPath, "utf8");
    expect(prismsNow).not.toBe(hadPrisms);
    expect(prismsNow.split("\n").filter((line) => line !== "")).toHaveLength(1);
    // Every other byte of the folder is exactly what it was.
    for (const [path, bytes] of Object.entries(before)) {
      if (path === "map/prisms.jsonl") continue;
      expect({ path, bytes: after[path] }).toEqual({ path, bytes });
    }
    const prism = only(prismsNow);
    expect(prism.contact).toBe("ask");
    expect(prism.changes[0]).toMatchObject({ outcome: "answered" });
  });
});
