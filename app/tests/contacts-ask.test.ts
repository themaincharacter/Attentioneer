import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pointerKey } from "../src/map/pointers";
import {
  CHANGE_KEYS,
  parsePrisms,
  serializePrismLine,
  type Prism,
} from "../src/map/prisms";
import { serializeReference } from "../src/map/refs";
import {
  ATTACHMENT_REFUSED,
  COPY_FAILED,
  EMPTY_RESPONSE,
  HANDOFF_FAILED_NOTE,
  HANDOFF_NEEDS_URL,
  NO_QUESTION,
  abandonAsk,
  askPacket,
  intakeAskResponse,
  sendAsk,
  wrapAskResponse,
  type AskContactDeps,
  type AskRequest,
  type InFlightAsk,
} from "../src/contacts/ask";
import { utf8ByteLength } from "../src/lib/textBytes";

/**
 * Epic 12 story 3 — ASK, automated.
 *
 * The question out by copy or OS handoff; the response back by paste intake
 * (the ghost intake's sibling); the inclusion set logged as the reaches'
 * natural keys, never their bytes; the response held as CONTENT, ephemeral
 * until the person KEEPS it — the existing Finding move, a separate act that
 * never extends the PRISM.
 *
 * Everything here runs through injected bridges and no Tauri runtime: the
 * clipboard, the handoff, the boundary's canonicalizer and the PRISM file.
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
const URL_POINTER = { form: "url" as const, value: "https://example.org/chat" };
const PATH_POINTER = { form: "path" as const, value: "notes/x.md" };
const SECOND = { form: "path" as const, value: "notes/y.md" };

function request(overrides: Partial<AskRequest> = {}): AskRequest {
  return {
    on: ON,
    contact: "ask",
    pointer: URL_POINTER,
    included: [URL_POINTER],
    question: QUESTION,
    transport: "copy",
    workspacePath: "/ws",
    ...overrides,
  };
}

function ask(overrides: Partial<InFlightAsk> = {}): InFlightAsk {
  return {
    on: ON,
    workspacePath: "/ws",
    pointer: URL_POINTER,
    included: [pointerKey(ON, "url", URL_POINTER.value)],
    question: QUESTION,
    packet: askPacket(QUESTION, [URL_POINTER]),
    transport: "copy",
    ...overrides,
  };
}

interface Harness {
  deps: AskContactDeps;
  copied: string[];
  handed: string[];
  /** Every canonicalization the resolver asked for. */
  resolved: string[];
  prisms: () => string | null;
  writes: () => number;
}

function harness(
  options: {
    copy?: boolean;
    rejectHandoff?: boolean;
    canonical?: (path: string) => Promise<string | null>;
    before?: string | null;
  } = {},
): Harness {
  let prisms = options.before ?? null;
  let writes = 0;
  let minted = 0;
  const copied: string[] = [];
  const handed: string[] = [];
  const resolved: string[] = [];
  const deps: AskContactDeps = {
    copy: async (text) => {
      if (options.copy === false) return false;
      copied.push(text);
      return true;
    },
    handOff: async (url) => {
      if (options.rejectHandoff === true) throw new Error("no handler");
      handed.push(url);
    },
    canonicalize: async (path) => {
      resolved.push(path);
      if (options.canonical) return await options.canonical(path);
      return path;
    },
    readPrismsText: async () => prisms,
    writePrismsText: async (text) => {
      prisms = text;
      writes += 1;
    },
    mintId: () => {
      minted += 1;
      return "prism-" + minted;
    },
  };
  return {
    deps,
    copied,
    handed,
    resolved,
    prisms: () => prisms,
    writes: () => writes,
  };
}

function only(text: string | null): Prism {
  expect(text).not.toBeNull();
  const parsed = parsePrisms(text as string);
  expect(parsed.malformed).toEqual([]);
  expect(parsed.prisms).toHaveLength(1);
  return parsed.prisms[0];
}

describe("the question out: copy or OS handoff, and nothing written yet", () => {
  test("copy puts the packet on the clipboard and appends NOTHING", async () => {
    const h = harness();
    const result = await sendAsk(request(), h.deps);
    expect(result.kind).toBe("sent");
    if (result.kind !== "sent") throw new Error("unreachable");

    expect(h.copied).toEqual([result.ask.packet]);
    expect(result.ask.packet).toBe(askPacket(QUESTION, [URL_POINTER]));
    expect(h.handed).toEqual([]);
    // The Move is not complete: no record.
    expect(h.writes()).toBe(0);
    expect(h.prisms()).toBeNull();
    // The inclusion set is the reaches' NATURAL KEYS.
    expect(result.ask.included).toEqual([
      pointerKey(ON, "url", URL_POINTER.value),
    ]);
    expect(result.note).toBeNull();
  });

  test("the packet carries citations only — the app pre-reads nothing", async () => {
    const h = harness();
    const result = await sendAsk(
      request({ included: [PATH_POINTER, URL_POINTER] }),
      h.deps,
    );
    if (result.kind !== "sent") throw new Error("unreachable");
    expect(result.ask.packet).toContain(QUESTION);
    expect(result.ask.packet).toContain("- path " + PATH_POINTER.value);
    expect(result.ask.packet).toContain("- url " + URL_POINTER.value);
    // No head read exists in the Ask's dep surface at all.
    const flow = source("contacts/ask.ts");
    expect(flow).not.toContain("readHead");
    expect(flow).not.toContain("readTextHead");
    expect(flow).not.toContain("readTextFile");
    expect(h.writes()).toBe(0);
  });

  test("a handoff copies the packet AND hands the ridden url to the OS", async () => {
    const h = harness();
    const result = await sendAsk(
      request({ transport: "handoff", included: [] }),
      h.deps,
    );
    if (result.kind !== "sent") throw new Error("unreachable");
    expect(h.copied).toHaveLength(1);
    expect(h.handed).toEqual([URL_POINTER.value]);
    expect(result.ask.transport).toBe("handoff");
    expect(result.ask.included).toBeNull();
    expect(result.note).toBeNull();
    expect(h.writes()).toBe(0);
  });

  test("a failed handoff leaves the question on the clipboard and says so", async () => {
    const h = harness({ rejectHandoff: true });
    const result = await sendAsk(
      request({ transport: "handoff", included: [] }),
      h.deps,
    );
    if (result.kind !== "sent") throw new Error("unreachable");
    expect(h.copied).toHaveLength(1);
    expect(result.note).toBe(HANDOFF_FAILED_NOTE);
  });

  test("a failed copy means the question never left: not a Move", async () => {
    const h = harness({ copy: false });
    const result = await sendAsk(request(), h.deps);
    expect(result).toEqual({ kind: "refused", reason: COPY_FAILED });
    expect(h.writes()).toBe(0);
  });

  test("an empty question is not a question", async () => {
    const h = harness();
    const result = await sendAsk(request({ question: "   " }), h.deps);
    expect(result).toEqual({ kind: "refused", reason: NO_QUESTION });
    expect(h.copied).toEqual([]);
  });

  test("a handoff needs a url reach, inside the opener's schemes", async () => {
    const h = harness();
    for (const pointer of [null, PATH_POINTER]) {
      const result = await sendAsk(
        request({ transport: "handoff", pointer, included: [] }),
        h.deps,
      );
      expect(result).toEqual({ kind: "refused", reason: HANDOFF_NEEDS_URL });
    }
    const scheme = await sendAsk(
      request({
        transport: "handoff",
        pointer: { form: "url", value: "obsidian://open" },
        included: [],
      }),
      h.deps,
    );
    expect(scheme.kind).toBe("refused");
    expect(h.copied).toEqual([]);
    expect(h.handed).toEqual([]);
  });
});

describe("the response in: the paste intake wraps it at intake", () => {
  test("an answered intake appends ONE PRISM with the inclusion and the facts", async () => {
    const h = harness();
    const sent = await sendAsk(
      request({ included: [PATH_POINTER, URL_POINTER] }),
      h.deps,
    );
    if (sent.kind !== "sent") throw new Error("unreachable");
    const raw = "an answer\nwith two lines";
    const result = await intakeAskResponse(sent.ask, raw, null, h.deps);
    expect(result.kind).toBe("moved");
    if (result.kind !== "moved") throw new Error("unreachable");

    // The response is CONTENT: returned verbatim, wrapped with its own facts.
    expect(result.response).toEqual({
      text: raw,
      size: utf8ByteLength(raw),
      decode: "clean",
    });

    expect(result.prism.contact).toBe("ask");
    expect(result.prism.pointer).toEqual(URL_POINTER);
    expect(result.prism.changes).toEqual([
      {
        kind: "ask",
        pointer: pointerKey(ON, "url", URL_POINTER.value),
        outcome: "answered",
        included: [
          pointerKey(ON, "path", PATH_POINTER.value),
          pointerKey(ON, "url", URL_POINTER.value),
        ],
        responseSize: utf8ByteLength(raw),
        decode: "clean",
      },
    ]);
    expect(h.writes()).toBe(1);
    expect(h.prisms()).toBe(serializePrismLine(result.prism) + "\n");
  });

  test("a lossy paste is SAID: decode with replacement", async () => {
    const h = harness();
    const raw = "abc\uFFFDdef";
    const result = await intakeAskResponse(ask(), raw, null, h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.response.decode).toBe("with-replacement");
    expect(result.response.size).toBe(utf8ByteLength(raw));
    expect(result.prism.changes[0]).toMatchObject({
      outcome: "answered",
      decode: "with-replacement",
    });
  });

  test("no inclusion is logged as null, never an empty list or a zero", async () => {
    const h = harness();
    const result = await intakeAskResponse(
      ask({ pointer: null, included: null }),
      "an answer",
      null,
      h.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    const change = result.prism.changes[0];
    expect(change).toEqual({
      kind: "ask",
      pointer: null,
      outcome: "answered",
      included: null,
      responseSize: utf8ByteLength("an answer"),
      decode: "clean",
    });
    expect(result.prism.pointer).toBeNull();
  });

  test("the inclusion keys are deduped, in the person's order", async () => {
    const h = harness();
    const sent = await sendAsk(
      request({ included: [SECOND, PATH_POINTER, SECOND] }),
      h.deps,
    );
    if (sent.kind !== "sent") throw new Error("unreachable");
    expect(sent.ask.included).toEqual([
      pointerKey(ON, "path", SECOND.value),
      pointerKey(ON, "path", PATH_POINTER.value),
    ]);
  });

  test("the log is CLOSED: the ask Change carries exactly its five keys", async () => {
    const h = harness();
    const result = await intakeAskResponse(ask(), "an answer", null, h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    const change = result.prism.changes[0] as unknown as Record<string, unknown>;
    expect(Object.keys(change).sort()).toEqual([...CHANGE_KEYS.ask]);
    expect(Object.keys(change).sort()).toEqual([
      "decode",
      "included",
      "kind",
      "outcome",
      "pointer",
      "responseSize",
    ]);
  });
});

describe("the log says the move, never the content", () => {
  test("neither the question nor the response appears in the PRISM", async () => {
    const h = harness();
    const question = "SECRET QUESTION PROSE";
    const raw = "SECRET RESPONSE PROSE";
    const sent = await sendAsk(
      request({ question, included: [PATH_POINTER] }),
      h.deps,
    );
    if (sent.kind !== "sent") throw new Error("unreachable");
    await intakeAskResponse(sent.ask, raw, null, h.deps);
    const text = h.prisms() as string;
    expect(text).not.toContain("SECRET");
    for (const key of ['"text"', '"question"', '"response"', '"bytes"', '"content"']) {
      expect(text).not.toContain(key);
    }
    // The CITATIONS are the inclusion set's natural keys (structure, not bytes).
    expect(text).toContain("notes/x.md");
  });

  test("the Ask is the ghost intake's SIBLING, not the ghost machinery", () => {
    const flow = source("contacts/ask.ts");
    expect(flow).not.toContain("ghost/");
    expect(flow).not.toContain("GhostEnvelope");
    expect(flow).not.toContain("intake(");
    // It wraps the text itself: text verbatim + size + decode.
    expect(flow).toContain("export function wrapAskResponse(");
    expect(wrapAskResponse("x")).toEqual({
      text: "x",
      size: 1,
      decode: "clean",
    });
    expect(wrapAskResponse("\u{1F600}").size).toBe(4);
    expect(wrapAskResponse("\uFFFD").decode).toBe("with-replacement");
  });
});

describe("the attached file: the workspace boundary applies at intake", () => {
  test("an attached path that escapes is refused and nothing is appended", async () => {
    const h = harness({
      canonical: async (path) =>
        path.includes("outside") ? "/elsewhere/outside.md" : path,
    });
    const result = await intakeAskResponse(
      ask(),
      "an answer",
      { form: "path", value: "../outside/x.md" },
      h.deps,
    );
    expect(result).toEqual({ kind: "refused", reason: ATTACHMENT_REFUSED });
    expect(h.resolved).toContain("/ws/../outside/x.md");
    expect(h.writes()).toBe(0);
    expect(h.prisms()).toBeNull();
  });

  test("an attached path inside the root resolves and the intake moves", async () => {
    const h = harness();
    const result = await intakeAskResponse(
      ask(),
      "an answer",
      { form: "path", value: "notes/attached.md" },
      h.deps,
    );
    expect(result.kind).toBe("moved");
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.attachment).toEqual({
      form: "path",
      value: "notes/attached.md",
    });
    // The attachment is CONTENT-adjacent: never a field in the log.
    expect(h.prisms()).not.toContain("attached");
  });

  test("an at attachment never enters the resolver (the machine-local exception)", async () => {
    const h = harness({
      canonical: async () => {
        throw new Error("the at form must not enter the boundary resolver");
      },
    });
    const result = await intakeAskResponse(
      ask(),
      "an answer",
      { form: "at", value: "/home/kick/notes/x.md" },
      h.deps,
    );
    expect(result.kind).toBe("moved");
    expect(h.writes()).toBe(1);
  });
});

describe("nothing came back: the honest close, and the ephemeral response", () => {
  test("an abandon appends ONE PRISM with no-response and no facts", async () => {
    const h = harness();
    const result = await abandonAsk(ask(), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.prism.changes).toEqual([
      {
        kind: "ask",
        pointer: pointerKey(ON, "url", URL_POINTER.value),
        outcome: "no-response",
        included: [pointerKey(ON, "url", URL_POINTER.value)],
        responseSize: null,
        decode: null,
      },
    ]);
    expect(h.writes()).toBe(1);
  });

  test("an empty paste is not a response", async () => {
    const h = harness();
    const result = await intakeAskResponse(ask(), "", null, h.deps);
    expect(result).toEqual({ kind: "refused", reason: EMPTY_RESPONSE });
    expect(h.writes()).toBe(0);
  });

  test("the intake holds no content: it writes the log and nothing else", () => {
    const flow = source("contacts/ask.ts");
    // The response is returned to the caller (the panel/app state), never
    // written: no reference writer, no artifact writer, no file bridge.
    expect(flow).not.toContain("writeTextFile");
    expect(flow).not.toContain("saveReference");
    expect(flow).not.toContain("writeArtifact");
    expect(flow).toContain("export interface AskResponse");
    // It says out loud that the response is content, ephemeral.
    expect(flow).toMatch(/ephemeral/i);
  });
});

describe("the keep is a SEPARATE act (the Finding) and never extends the PRISM", () => {
  test("the ask flow exports no keep: the record closes at intake", () => {
    const flow = source("contacts/ask.ts");
    expect(flow).not.toMatch(/export (async )?function \w*[Kk]eep/);
    expect(flow).not.toMatch(/export const \w*[Kk]eep/);
    expect(codeOnly(flow)).not.toContain("keep");
  });

  test("keeping the response writes the word's memory, not the log", () => {
    // The existing Finding move: a reference file rewritten with the response
    // as its memory prose. Nothing writes prisms.jsonl.
    const ref = {
      id: "rain",
      slug: "rain",
      name: "rain",
      x: 0,
      y: 0,
      body: "SECRET RESPONSE PROSE",
      extra: {},
    };
    const written: { path: string; text: string }[] = [];
    const prismsBefore = "the exact log bytes\n";
    const write = (path: string, text: string) => {
      written.push({ path, text });
    };
    write("/ws/map/references/rain.md", serializeReference(ref));
    expect(written).toHaveLength(1);
    expect(written[0].path).toContain("map/references/");
    expect(written[0].text).toContain("SECRET RESPONSE PROSE");
    expect(written.some((entry) => entry.path.includes("prisms.jsonl"))).toBe(
      false,
    );
    expect(prismsBefore).toBe("the exact log bytes\n");
  });

  test("the app's keep calls the ordinary word write, never a Prism writer", () => {
    const app = source("App.tsx");
    const start = app.indexOf("const askKeep = useCallback(");
    expect(start).toBeGreaterThan(-1);
    const tail = "}, [askAt, askResponse, refs, updateReference]);";
    const end = app.indexOf(tail, start);
    expect(end).toBeGreaterThan(start);
    const body = app.slice(start, end + tail.length);
    expect(body).toContain("updateReference({ ...word, body: response.text })");
    for (const writer of [
      "savePrismExplanation",
      "runMakeMove",
      "runEgressMove",
      "sendAskOut",
      "intakeAsk",
      "closeAsk",
      "askPrism",
      "setPrismAt",
    ]) {
      expect({ writer, found: body.includes(writer) }).toEqual({
        writer,
        found: false,
      });
    }
  });

  test("the ask panel imports no PRISM writer (the keep button is a callback)", () => {
    const panel = codeOnly(source("canvas/AskPanel.tsx"));
    for (const writer of [
      "appendPrismLine",
      "mintPrismId",
      "savePrismExplanation",
      "rewritePrismExplanation",
      "intakeAsk",
      "closeAsk",
      "sendAskOut",
      "runMakeMove",
      "runEgressMove",
      "runReadMove",
    ]) {
      expect({ writer, found: panel.includes(writer) }).toEqual({
        writer,
        found: false,
      });
    }
    expect(source("canvas/AskPanel.tsx")).toContain("onKeep");
  });
});

describe("no accept gate on any contact write (source scan)", () => {
  test("the three story-3 flows carry no gate vocabulary", () => {
    const GATE =
      /\b(accept|accepted|accepts|accepting|approve|approved|approval|proposal|propose|pending|confirm)\b/;
    for (const file of [
      "contacts/make.ts",
      "contacts/egress.ts",
      "contacts/ask.ts",
    ]) {
      const code = codeOnly(source(file));
      expect({ file, gated: GATE.test(code) }).toEqual({ file, gated: false });
    }
  });

  test("the panels are doors, not approvals: they call the Move directly", () => {
    const make = codeOnly(source("canvas/MakePanel.tsx"));
    expect(make).toContain("onMake(path, text)");
    expect(make).not.toMatch(/proposal|approve|confirm/i);
    const ask = codeOnly(source("canvas/AskPanel.tsx"));
    expect(ask).toContain("onSend(");
    expect(ask).toContain("onIntake(");
    expect(ask).not.toMatch(/proposal|approve|confirm/i);
  });
});
