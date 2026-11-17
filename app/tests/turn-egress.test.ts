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
import { declarationWords } from "../src/canvas/contactRules";
import {
  NO_PROVIDER_SENTENCE,
  SIDECAR_UNAVAILABLE_SENTENCE,
  sendPacketApp,
  type PacketSendDeps,
} from "../src/turn/egress";
import { hasProvider, EMPTY_PROVIDER } from "../src/turn/provider";
import { askTurnMessages, buildPacketMessages } from "../src/turn/turn";
import type { TurnPort } from "../src/turn/turn";
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
  packets: string[];
  writes: () => number;
  log: () => string | null;
}

function harness(options: {
  sendApp?: (packet: string) => Promise<AskAppSend>;
  before?: string | null;
} = {}): Harness {
  let log = options.before ?? null;
  let writes = 0;
  let minted = 0;
  const copied: string[] = [];
  const packets: string[] = [];
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
    sendPacket: async () => ({ kind: "answer", text: "x" }),
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

    expect(copied.ask.packet).toBe(askPacket(QUESTION, [PATH_POINTER, URL_POINTER]));
    expect(appSent.ask.packet).toBe(copied.ask.packet);
    expect(h.packets).toEqual([copied.ask.packet]);
    expect(h.copied).toEqual([copied.ask.packet]);

    // The wire's ONE user message is the packet VERBATIM: the turn builder
    // must not trim it (the clipboard would not have).
    const messages = buildPacketMessages(appSent.ask.packet);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({ role: "system" });
    expect(messages[1]).toEqual({ role: "user", content: appSent.ask.packet });
    const edged = "  a question with edges\n";
    expect(buildPacketMessages(edged)[1]).toEqual({
      role: "user",
      content: edged,
    });
  });

  test("the packet crosses the wire as ONE user message, byte for byte", async () => {
    const packet = askPacket("  what does this reach say?\n", [
      PATH_POINTER,
      URL_POINTER,
    ]);
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

    const result = await askTurnMessages(
      transport,
      { baseUrl: "http://x", model: "m", apiKey: "sk-never-logged" },
      buildPacketMessages(packet),
    );
    expect(result).toEqual({ kind: "answer", text: "the answer" });
    const wire = parseRequestLine(sent[0] as string);
    if (wire === null || wire.kind !== "turn") throw new Error("unreachable");
    expect(wire.messages).toHaveLength(2);
    expect(wire.messages[1]).toEqual({ role: "user", content: packet });
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

  test("hasProvider needs a base URL and a model; the key is not the test", () => {
    expect(hasProvider(EMPTY_PROVIDER)).toBe(false);
    expect(hasProvider({ baseUrl: "  ", model: "m" })).toBe(false);
    expect(hasProvider({ baseUrl: "http://x", model: "" })).toBe(false);
    expect(hasProvider({ baseUrl: "http://x", model: "m" })).toBe(true);
    expect(
      hasProvider({ baseUrl: " http://x ", model: " m " }),
    ).toBe(true);
  });

  test("the egress decides start-before-send, and says the two fallbacks", async () => {
    let starts = 0;
    let sends = 0;
    const deps = (stored: { baseUrl: string; model: string }): PacketSendDeps => ({
      loadProvider: async () => stored,
      apiKey: () => "",
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

    const none = await sendPacketApp("packet", deps(EMPTY_PROVIDER));
    expect(none).toEqual({
      kind: "unavailable",
      sentence: NO_PROVIDER_SENTENCE,
    });
    expect(starts).toBe(0);
    expect(sends).toBe(0);

    const refused = await sendPacketApp(
      "packet",
      deps({ baseUrl: "http://x", model: "m" }),
    );
    expect(refused).toEqual({
      kind: "unavailable",
      sentence: SIDECAR_UNAVAILABLE_SENTENCE,
    });
    expect(starts).toBe(1);
    expect(sends).toBe(0);
  });

  test("an answered turn hands the text back; a failed one is one sentence", async () => {
    const answered = await sendPacketApp("packet", {
      loadProvider: async () => ({ baseUrl: "http://x", model: "m" }),
      apiKey: () => "sk-not-logged",
      turn: turnPort({
        sendPacket: async (_provider, packet) => {
          expect(packet).toBe("packet");
          return { kind: "answer", text: "the answer" };
        },
      }),
    });
    expect(answered).toEqual({ kind: "answered", text: "the answer" });

    const failed = await sendPacketApp("packet", {
      loadProvider: async () => ({ baseUrl: "http://x", model: "m" }),
      apiKey: () => "",
      turn: turnPort({
        sendPacket: async () => ({
          kind: "error",
          sentence: "the provider said no",
        }),
      }),
    });
    expect(failed).toEqual({ kind: "failed", sentence: "the provider said no" });
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
    // The declaration is still shown with the fallback: what would go is said.
    expect(fallbackHtml).toContain("will go:");
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
