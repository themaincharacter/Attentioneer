import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CHANGE_KEYS, parsePrisms, type Prism } from "../src/map/prisms";
import { pointerKey } from "../src/map/pointers";
import { serializeReference } from "../src/map/refs";
import { utf8ByteLength } from "../src/lib/textBytes";
import {
  abandonAsk,
  askOutcomeOf,
  intakeAskResponse,
  sendAsk,
  type AskContactDeps,
  type AskEnding,
  type AskRequest,
  type AskSendResult,
} from "../src/contacts/ask";
import { AskPanel, type AskSessionView } from "../src/canvas/AskPanel";
import { askPartialWords } from "../src/canvas/contactRules";
import { sendPacketApp, type PacketSendDeps } from "../src/turn/egress";
import { runRoutePacket, type TurnPort } from "../src/turn/turn";
import { assembleAskPacket, type AskPacket } from "../src/turn/packet";
import {
  EMPTY_SETTINGS,
  withProvider,
  withSelection,
  type ProviderRow,
  type TurnSettings,
} from "../src/turn/providers";
import {
  parseRequestLine,
  type SidecarLine,
  type TurnTransport,
} from "../src/turn/protocol";

/**
 * STORY 15.7b — THE ASK STREAMS, AND A PARTIAL IS NOT AN ANSWER.
 *
 * The record is formed from HOW THE TURN ENDED, never from what arrived:
 *   - a completed turn is the existing answered Change, with its size;
 *   - a stop, a failure or the turn's own budget is the existing no-response
 *     Change, even when the panel holds words — and never a size.
 *
 * The stream is a VIEW: the parts are the same accumulation the ending settles
 * with, and the panel keeps them after a non-answer ending, marked as a
 * partial. One Ask, one PRISM, whichever ending; the question's and the
 * answer's words never enter the record.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

const ON = "rain";
const QUESTION = "what does this reach say about rain?";
const ANSWER = "the answer";
const URL_POINTER = { form: "url" as const, value: "https://example.org/chat" };
const PATH_POINTER = { form: "path" as const, value: "notes/x.md" };

function providerRow(): ProviderRow {
  return {
    id: "local",
    name: "Local",
    baseUrl: "http://x",
    models: [
      { id: "m", name: "M", capabilities: { tools: false, vision: false } },
    ],
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
  writes: () => number;
  log: () => string | null;
}

function harness(options: { before?: string | null } = {}): Harness {
  let log = options.before ?? null;
  let writes = 0;
  let minted = 0;
  const deps: AskContactDeps = {
    copy: async () => true,
    handOff: async () => {},
    canonicalize: async (path) => path,
    readPrismsText: async () => log,
    writePrismsText: async (text) => {
      log = text;
      writes += 1;
    },
    mintId: () => "prism-" + ++minted,
  };
  return { deps, writes: () => writes, log: () => log };
}

/** A scripted sidecar: parts in order, then the ending the scenario names. */
function scripted(
  parts: readonly string[],
  ending: "done" | "cancelled" | "error",
  message = "the provider broke mid-answer",
): TurnTransport {
  const waiting = new Map<number, (line: SidecarLine) => void>();
  return {
    async send(line: string): Promise<void> {
      const parsed = parseRequestLine(line);
      if (parsed === null || parsed.kind !== "turn") return;
      setTimeout(() => {
        const emit = waiting.get(parsed.id);
        if (emit === undefined) return;
        for (const text of parts) {
          emit({ id: parsed.id, kind: "part", part: "text", text });
        }
        if (ending === "cancelled") {
          emit({ id: parsed.id, kind: "cancelled" });
        } else if (ending === "error") {
          emit({ id: parsed.id, kind: "error", message });
        } else {
          emit({ id: parsed.id, kind: "done" });
        }
      }, 0);
    },
    subscribe(id: number, handler: (line: SidecarLine) => void) {
      waiting.set(id, handler);
      return () => {
        if (waiting.get(id) === handler) waiting.delete(id);
      };
    },
  };
}

/** The real turn port, driven by the scripted transport. */
function portOf(transport: TurnTransport): TurnPort {
  return {
    ask: async () => ({ kind: "answer", text: "unused" }),
    sendPacket: (route, packet, fetchBlock, options) =>
      runRoutePacket(transport, route, packet, fetchBlock, options),
    start: async () => ({ kind: "running" }),
    stop: async () => {},
  };
}

function packetDeps(transport: TurnTransport): PacketSendDeps {
  return {
    loadSettings: async () => turnSettings(),
    apiKey: async () => "",
    turn: portOf(transport),
    fetchBlock: async () => null,
  };
}

/** The app's sender: the real egress, with the panel's part view. */
function sendAppVia(transport: TurnTransport) {
  return (packet: AskPacket, onPart?: (text: string) => void) =>
    sendPacketApp(packet, packetDeps(transport), onPart);
}

function only(text: string | null): Prism {
  expect(text).not.toBeNull();
  const parsed = parsePrisms(text as string);
  expect(parsed.malformed).toEqual([]);
  expect(parsed.prisms).toHaveLength(1);
  return parsed.prisms[0];
}

/**
 * Exactly the wiring's decision (contacts/prismLog.ts): the ending picks the
 * ONE record — the answered intake, or the existing no-response close.
 */
async function recordFor(
  sent: Extract<AskSendResult, { kind: "sent" }>,
  h: Harness,
): Promise<void> {
  if (sent.ending === undefined) return;
  if (askOutcomeOf(sent.ending) === "no-response") {
    await abandonAsk(sent.ask, h.deps);
    return;
  }
  if (sent.answer === undefined) return;
  await intakeAskResponse(sent.ask, sent.answer, null, h.deps);
}

/* ------------------------------------------------------------------ *
 * THE ENDING PICKS THE RECORD
 * ------------------------------------------------------------------ */

describe("the ending, not the bytes, is what the record is formed from", () => {
  test("only a completed turn answers; every other ending is no-response", () => {
    expect(askOutcomeOf("answered")).toBe("answered");
    for (const ending of ["stopped", "failed", "timed-out"] as AskEnding[]) {
      expect({ ending, outcome: askOutcomeOf(ending) }).toEqual({
        ending,
        outcome: "no-response",
      });
    }
  });

  test("the panel's one sentence is the same for every non-answer ending", () => {
    for (const ending of ["stopped", "failed", "timed-out"] as AskEnding[]) {
      const line = askPartialWords(ending);
      expect(line).toContain("not recorded as an answer");
      expect(line).not.toMatch(/[0-9]/);
    }
    expect(askPartialWords("stopped")).toContain("stopped");
    expect(askPartialWords("failed")).toContain("broke off");
    expect(askPartialWords("timed-out")).toContain("did not answer in time");
    expect(askPartialWords("answered")).toBe("");
  });
});

/* ------------------------------------------------------------------ *
 * THE STREAM, THROUGH THE REAL EGRESS
 * ------------------------------------------------------------------ */

describe("the Ask streams: parts arrive in order and the view sees them", () => {
  test("a completed turn answers, and each part is the accumulation so far", async () => {
    const order: string[] = [];
    const seen: string[] = [];
    const sent = await sendAsk(
      request(),
      {
        ...harness().deps,
        sendApp: sendAppVia(scripted(["the ", "answer"], "done")),
      },
      {
        onSent: () => order.push("sent"),
        onPart: (text) => {
          order.push("part");
          seen.push(text);
        },
      },
    );
    if (sent.kind !== "sent") throw new Error("unreachable");
    expect(order[0]).toBe("sent");
    expect(seen).toEqual(["the ", "the answer"]);
    expect(sent.ending).toBe("answered");
    expect(sent.answer).toBe(ANSWER);
    // The send itself writes nothing: the wiring forms the one record.
    expect(sent.prism).toBeUndefined();
  });

  test("a stop keeps the partial and ends as stopped, not an answer", async () => {
    const seen: string[] = [];
    const sent = await sendAsk(
      request(),
      {
        ...harness().deps,
        sendApp: sendAppVia(scripted(["the ", "answer"], "cancelled")),
      },
      { onPart: (text) => seen.push(text) },
    );
    if (sent.kind !== "sent") throw new Error("unreachable");
    expect(seen).toEqual(["the ", "the answer"]);
    expect(sent.ending).toBe("stopped");
    expect(sent.partial).toBe("the answer");
    expect(sent.answer).toBeUndefined();
    expect(sent.note).toBeNull();
  });

  test("a break after parts is a failure with the same partial", async () => {
    const sent = await sendAsk(request(), {
      ...harness().deps,
      sendApp: sendAppVia(scripted(["the "], "error")),
    });
    if (sent.kind !== "sent") throw new Error("unreachable");
    expect(sent.ending).toBe("failed");
    expect(sent.partial).toBe("the ");
    expect(sent.note).toBe("the provider broke mid-answer");
    expect(sent.answer).toBeUndefined();
  });

  test("the turn's own budget is its own ending, partial included", async () => {
    const packet = assembleAskPacket({
      question: "q",
      card: { name: "rain", state: null, reading: null, note: null },
      reaches: [],
      retrievable: [],
    });
    const timedOut = await sendPacketApp(packet, {
      ...packetDeps(scripted([], "done")),
      turn: {
        ...portOf(scripted([], "done")),
        sendPacket: async () => ({
          result: {
            kind: "timeout",
            sentence: "the provider did not answer in time",
            partial: "the words so far",
          },
          messages: [{ role: "user", content: "q" }],
          read: null,
          missed: null,
        }),
      },
    });
    expect(timedOut).toEqual({
      kind: "timed-out",
      sentence: "the provider did not answer in time",
      partial: "the words so far",
      messages: [{ role: "user", content: "q" }],
    });

    const sent = await sendAsk(request(), {
      ...harness().deps,
      sendApp: async () => ({
        kind: "timed-out",
        sentence: "the provider did not answer in time",
        partial: "the words so far",
      }),
    });
    if (sent.kind !== "sent") throw new Error("unreachable");
    expect(sent.ending).toBe("timed-out");
    expect(sent.partial).toBe("the words so far");
    expect(sent.answer).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ *
 * ONE ASK, ONE PRISM, WHICHEVER ENDING
 * ------------------------------------------------------------------ */

describe("one record per ending, and a partial never carries a size", () => {
  test("completion writes the answered Change with the exact byte size", async () => {
    const h = harness();
    const sent = await sendAsk(request(), {
      ...h.deps,
      sendApp: sendAppVia(scripted(["the ", "answer"], "done")),
    });
    if (sent.kind !== "sent") throw new Error("unreachable");
    await recordFor(sent, h);
    expect(h.writes()).toBe(1);
    const change = only(h.log()).changes[0];
    expect(change).toEqual({
      kind: "ask",
      pointer: pointerKey(ON, "url", URL_POINTER.value),
      outcome: "answered",
      included: [
        pointerKey(ON, "path", PATH_POINTER.value),
        pointerKey(ON, "url", URL_POINTER.value),
      ],
      responseSize: utf8ByteLength(ANSWER),
      decode: "clean",
    });
  });

  for (const ending of ["stopped", "failed", "timed-out"] as AskEnding[]) {
    test("a " + ending + " ending is ONE no-response PRISM, with no size", async () => {
      const h = harness();
      const sent = await sendAsk(request({ question: "SECRET QUESTION" }), {
        ...h.deps,
        sendApp: async () => ({
          kind: ending,
          ...(ending === "stopped"
            ? { partial: "SECRET PARTIAL" }
            : { sentence: "one sentence", partial: "SECRET PARTIAL" }),
        }),
      });
      if (sent.kind !== "sent") throw new Error("unreachable");
      await recordFor(sent, h);

      expect(h.writes()).toBe(1);
      const log = h.log() as string;
      const prism = only(log);
      expect(prism.changes).toHaveLength(1);
      const change = prism.changes[0] as unknown as Record<string, unknown>;
      expect(Object.keys(change).sort()).toEqual([...CHANGE_KEYS.ask]);
      expect(change).toMatchObject({
        kind: "ask",
        outcome: "no-response",
        responseSize: null,
        decode: null,
      });
      // No content: neither the question nor the partial's words ride.
      expect(log).not.toContain("SECRET");
      for (const key of ['"text"', '"question"', '"response"', '"partial"']) {
        expect({ key, found: log.includes(key) }).toEqual({ key, found: false });
      }
    });
  }

  test("the wiring branches on the ending, and appends exactly once", () => {
    const wiring = source("contacts/prismLog.ts");
    const start = wiring.indexOf("export async function sendAskOut(");
    expect(start).toBeGreaterThan(-1);
    // The next door begins the paste/close functions below it.
    const end = wiring.indexOf("export function intakeAsk(", start);
    expect(end).toBeGreaterThan(start);
    const body = wiring.slice(start, end);
    // The record is chosen by the ENDING'S outcome, never by the bytes.
    expect(body).toContain("askOutcomeOf(sent.ending)");
    expect(body).toContain("abandonAsk(");
    expect(body).toContain("intakeAskResponse(");
    // ONE append either way: one abandon call and one intake call, no retry.
    expect(body.match(/abandonAsk\(/g)).toHaveLength(1);
    expect(body.match(/intakeAskResponse\(/g)).toHaveLength(1);
    // The answered branch needs an ending; only answered reaches the intake.
    expect(body).toContain("sent.ending !== undefined");
  });
});

/* ------------------------------------------------------------------ *
 * THE PANEL KEEPS THE PARTIAL AND SAYS WHAT IT IS
 * ------------------------------------------------------------------ */

function baseProps(overrides: Record<string, unknown> = {}) {
  return {
    name: "rain",
    rows: [] as never[],
    ride: null,
    session: null,
    kept: false,
    busy: false,
    note: null,
    fallback: null,
    running: false,
    context: null,
    sent: null,
    onIncludedChange: () => {},
    onSend: () => {},
    onStop: () => {},
    onIntake: () => {},
    onAbandon: () => {},
    onKeep: () => {},
    onLog: () => {},
    onClose: () => {},
    ...overrides,
  };
}

function sessionView(overrides: Partial<AskSessionView> = {}): AskSessionView {
  return {
    ask: {
      on: ON,
      workspacePath: "/ws",
      pointer: URL_POINTER,
      included: null,
      question: QUESTION,
      packet: "the packet",
      transport: "app",
    },
    response: null,
    note: null,
    partial: null,
    ending: null,
    ...overrides,
  };
}

describe("the Ask panel shows arrival and keeps a marked partial", () => {
  test("while running: the words arrive, the stop verb stands beside them", () => {
    const html = renderToStaticMarkup(
      createElement(AskPanel, {
        ...baseProps({
          session: sessionView({ partial: "the " }),
          running: true,
        }),
      }),
    );
    expect(html).toContain("the ");
    expect(html).toContain('data-state="streaming"');
    expect(html).toContain("ask-stop");
    // No paste box while the app carries the turn.
    expect(html).not.toContain("ask-response");
  });

  for (const ending of ["stopped", "failed", "timed-out"] as AskEnding[]) {
    test("after a " + ending + " ending: the partial stays, marked, and the log is the only verb", () => {
      const html = renderToStaticMarkup(
        createElement(AskPanel, {
          ...baseProps({
            session: sessionView({ partial: "the answer", ending }),
          }),
        }),
      );
      expect(html).toContain("the answer");
      expect(html).toContain(askPartialWords(ending));
      expect(html).toContain('data-state="' + ending + '"');
      // The record is already the no-response close: no paste, no second one.
      expect(html).not.toContain("ask-response");
      expect(html).not.toContain("nothing came back");
      expect(html).not.toContain("log it");
      // The log still opens the ONE PRISM that was appended.
      expect(html).toContain("ask-show-log");
    });
  }

  test("a completed turn is the response view, never a partial sentence", () => {
    const html = renderToStaticMarkup(
      createElement(AskPanel, {
        ...baseProps({
          session: sessionView({
            ending: "answered",
            response: {
              text: ANSWER,
              size: utf8ByteLength(ANSWER),
              decode: "clean",
            },
          }),
        }),
      }),
    );
    expect(html).toContain(ANSWER);
    expect(html).toContain("size 10 bytes");
    expect(html).toContain("ask-keep");
    expect(html).not.toContain("not recorded as an answer");
  });

  test("the ask card keeps the panel's arrival without its record vocabulary", () => {
    // STORY 17.7: the embedded panel is gone; the ask card is the ground map's
    // one ask surface. Its pending line streams the SAME parts, while the
    // panel's partial sentence and ending vocabulary stay with the Ask Move.
    const card = source("canvas/AskCard.tsx");
    expect(card).toContain("askPartPending(current, text)");
    expect(card).not.toContain("askPartialWords");
    expect(card).not.toContain("askOutcomeOf");
  });
});

/* ------------------------------------------------------------------ *
 * NO MAP WRITE, EITHER ENDING
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

const workspace = mkdtempSync(join(tmpdir(), "attentioneer-ask-streams-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("a stopped Ask writes only its ONE no-response PRISM", () => {
  test("the folder's other bytes are untouched", async () => {
    mkdirSync(join(workspace, "map", "references"), { recursive: true });
    writeFileSync(join(workspace, "map", "history.jsonl"), '{"move":"authored"}\n');
    writeFileSync(join(workspace, "map", "mirror.md"), "the mirror before\n");
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

    const logPath = join(workspace, "map", "prisms.jsonl");
    const h = harness();
    const deps: AskContactDeps = {
      ...h.deps,
      readPrismsText: async () => readFileSync(logPath, "utf8"),
      writePrismsText: async (text) => writeFileSync(logPath, text),
    };
    const sent = await sendAsk(
      request({ workspacePath: workspace, question: "SECRET QUESTION" }),
      {
        ...deps,
        sendApp: async () => ({
          kind: "stopped",
          partial: "SECRET PARTIAL",
        }),
      },
    );
    if (sent.kind !== "sent") throw new Error("unreachable");
    // The send alone leaves the folder byte-identical.
    expect(snapshot(workspace)).toEqual(before);

    await abandonAsk(sent.ask, deps);
    const after = snapshot(workspace);
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    const prismsNow = readFileSync(logPath, "utf8");
    expect(prismsNow.split("\n").filter((line) => line !== "")).toHaveLength(1);
    for (const [path, bytes] of Object.entries(before)) {
      if (path === "map/prisms.jsonl") continue;
      expect({ path, bytes: after[path] }).toEqual({ path, bytes });
    }
    const prism = only(prismsNow);
    expect(prism.changes[0]).toMatchObject({
      outcome: "no-response",
      responseSize: null,
      decode: null,
    });
  });
});
