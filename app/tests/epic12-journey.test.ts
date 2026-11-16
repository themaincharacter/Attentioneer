import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { HEAD_MAX_BYTES, HEAD_MAX_LINES } from "../src/lib/headBounds";
import type { HeadRefusal, TextHead } from "../src/lib/fs";
import { utf8ByteLength } from "../src/lib/textBytes";
import {
  parsePointers,
  pointerKey,
  serializePointerLine,
  type PointerForm,
} from "../src/map/pointers";
import {
  BOUNDS_KEYS,
  CHANGE_KEYS,
  CHANGE_KINDS,
  OPEN_OS_OUTCOMES,
  PRISM_KEYS,
  latestPrismIn,
  parsePrismLine,
  parsePrisms,
  rewritePrismExplanation,
  serializePrismLine,
  type Prism,
  type PrismPointer,
} from "../src/map/prisms";
import { serializeReference } from "../src/map/refs";
import {
  OUTCOME_WORDS,
  boundsWords,
  changeDetail,
  changeOutcome,
  changeWord,
  contactWord,
  decodeWords,
  factsWords,
  inclusionWords,
  prismLabel,
} from "../src/canvas/prismRules";
import {
  runReadContact,
  type ReadContactDeps,
  type ReadContactRequest,
} from "../src/contacts/read";
import {
  MAKE_FORM,
  runMakeContact,
  type MakeContactDeps,
  type MakeContactRequest,
} from "../src/contacts/make";
import {
  runEgressContact,
  type EgressContactDeps,
  type EgressContactRequest,
} from "../src/contacts/egress";
import {
  askPacket,
  intakeAskResponse,
  sendAsk,
  type AskContactDeps,
  type AskRequest,
} from "../src/contacts/ask";

/**
 * Epic 12's plain-language check, automated at the RECORD layer (story 4).
 *
 * The locked check (Epic 12 check and slice, its Answer) has three homes, kept
 * apart on purpose:
 *   - THIS FILE walks the PORT-ASSERTED half, through the shipped contact flows
 *     over injected bridges (no Tauri runtime, no window): Look's bounds /
 *     decode / refusals; Measure's declared facts; Make's mint+write and its
 *     partial log; the OS handoff's three outcomes; Ask's inclusion logging and
 *     the paste intake; the person's explanation; the negative space. The
 *     record's bytes are asserted exactly: one appended line per Move, in file
 *     order, never merged.
 *   - The HUMAN-ONLY legs stay QUEUED and are deliberately NOT asserted: the
 *     real OS handoff (what the desktop did with the address), the clipboard
 *     paste round-trip (a person pasting what came back), the reopen FEEL (the
 *     pointer row's quiet log button in the real window) and the say-it
 *     ("nothing was summarized, inferred, or counted..."). A test cannot run a
 *     human's glance or judgment; the record half above it is what can be
 *     pinned.
 *   - The journey's live words live in the JOURNAL (the story's build entry):
 *     the say-it is the person's, and no metric answers it.
 *
 * The check's own words: "Point a reference at a file. LOOK: the head reads -
 * its PRISM says exactly what happened (the bound values; decoded clean; the
 * pointer cited by its natural key - inheriting the pointer's own sensitivity,
 * never a byte dump). Look at a file with invalid UTF-8: the PRISM says
 * 'decoded with replacement'. Look at a binary: it refuses 'not text'. Point at
 * '../outside': it refuses 'escaped'. Look at a URL: the OS is handed the
 * address and the PRISM says 'handed' (refusals and launch failures log too).
 * MEASURE: the head's declared facts read (size, mtime) - nothing computed; a
 * declared number from inside is yours to KEEP (a Finding) - the PRISM never
 * carries it. MAKE: name an artifact - the Move mints its pointer and writes
 * raw UTF-8 text (if the write fails, the PRISM logs the mint AND the failure -
 * the partial log is the truth). ASK: write your question; choose what rides
 * (the inclusion set is logged - the pointers' keys, never bytes); carry the
 * question out ... and paste the response back - it is content, ephemeral until
 * you keep it (a Finding -> memory). Type an explanation on any PRISM - it is
 * yours (empty when you don't). At every Move's completion the PRISM reads AT
 * the window; reopen it from the pointer's log affordance. Say it: nothing was
 * summarized, inferred, or counted; the log shows what left the machine and
 * what never did. No assistant unless you asked one."
 *
 * The fixture is the project's own rain / soil world: one anchor word (rain),
 * one clean reach, one lossy reach, one binary, one escape, one URL page, one
 * artifact. The flows are the shipped ones; the bridges are fakes, exactly as
 * the read/write/egress/ask suites do it.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));
const SRC = join(APP, "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

/** The source with its comments removed: the scans are about what code DOES. */
function codeOnly(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/** The body without its import statements (import paths are not data). */
function bodyOnly(text: string): string {
  return codeOnly(text).replace(/import[\s\S]*?from\s+"[^"]+";/g, "");
}

/* ========================================================================= *
 * The world and the bridge fakes.
 * ========================================================================= */

const ON = "rain";
const CLEAN = "notes/clean.md";
const LOSSY = "notes/lossy.md";
const BINARY = "notes/binary.bin";
const FACTS = "notes/facts.md";
const ARTIFACT = "notes/the-artifact.md";
const PARTIAL = "notes/partial.md";
const PAGE = "https://example.org/a-page";
const SECOND_PAGE = "https://example.org/second";
const CHAT = "https://example.org/chat";
const QUESTION = "what does this reach say about rain?";
const RESPONSE = "an answer\nwith two lines";
const ARTIFACT_TEXT = "raw bytes: \r\n  trailing spaces  \nno canonical newline \u{1F600}";

const PATH_POINTER: PrismPointer = { form: "path", value: CLEAN };
const CHAT_POINTER: PrismPointer = { form: "url", value: CHAT };

function keyOf(form: PointerForm, value: string): string {
  return pointerKey(ON, form, value);
}

/** A lexical POSIX realpath (the tests' realpath; the app injects Rust's). */
function normalizePath(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      out.pop();
      continue;
    }
    out.push(part);
  }
  return "/" + out.join("/");
}

/** A clean head as the bridge declares it; the tests override fields. */
const CLEAN_HEAD: TextHead = {
  head: "THE HEAD'S OWN BYTES - a byte dump would leak the world",
  truncated: false,
  exists: true,
  size: 1234,
  mtime: 1763000000123,
  decode: "clean",
};

interface HeadScript {
  head?: Partial<TextHead>;
  refusal?: HeadRefusal;
}

interface JourneyState {
  files: Map<string, string>;
  prismsWrites: number;
  minted: number;
  heads: Map<string, HeadScript>;
  headed: { path: string; maxLines: number; maxBytes: number }[];
  canonical: string[];
  handed: string[];
  copied: string[];
  artifacts: { path: string; text: string }[];
  failArtifact: boolean;
  rejectHandoff: boolean;
  copyFails: boolean;
}

type Deps = ReadContactDeps &
  MakeContactDeps &
  EgressContactDeps &
  AskContactDeps;

interface Journey {
  deps: Deps;
  state: JourneyState;
  /** The PRISM file's bytes as they stand now (null when there is none). */
  text(): string | null;
  /** The pointers file's bytes as they stand now. */
  pointers(): string | null;
  /** Write a workspace file the contacts do not own (a Finding's reference). */
  write(rel: string, text: string): void;
  setHead(rel: string, head: Partial<TextHead>): void;
  refuseHead(rel: string, code: HeadRefusal["code"], detail?: string): void;
}

function relativeToWorkspace(path: string): string {
  if (path === "/ws") return "";
  return path.startsWith("/ws/") ? path.slice(4) : path;
}

/** One in-memory workspace plus the four contact flows' injected bridges. */
function journey(options: { before?: string | null } = {}): Journey {
  const files = new Map<string, string>();
  if (options.before !== undefined && options.before !== null) {
    files.set("map/prisms.jsonl", options.before);
  }
  const state: JourneyState = {
    files,
    prismsWrites: 0,
    minted: 0,
    heads: new Map(),
    headed: [],
    canonical: [],
    handed: [],
    copied: [],
    artifacts: [],
    failArtifact: false,
    rejectHandoff: false,
    copyFails: false,
  };
  const deps: Deps = {
    canonicalize: async (path) => {
      state.canonical.push(path);
      return normalizePath(path);
    },
    readHead: async (path, maxLines, maxBytes) => {
      state.headed.push({ path, maxLines, maxBytes });
      const script = state.heads.get(relativeToWorkspace(path));
      if (script?.refusal !== undefined) throw script.refusal;
      return { ...CLEAN_HEAD, ...(script?.head ?? {}) };
    },
    readPrismsText: async () => files.get("map/prisms.jsonl") ?? null,
    writePrismsText: async (text) => {
      files.set("map/prisms.jsonl", text);
      state.prismsWrites += 1;
    },
    mintId: () => "prism-" + (state.minted += 1),
    readPointersText: async () => files.get("map/pointers.jsonl") ?? null,
    writePointersText: async (text) => {
      files.set("map/pointers.jsonl", text);
    },
    writeArtifact: async (path, text) => {
      if (state.failArtifact) throw new Error("cannot write the artifact");
      files.set(relativeToWorkspace(path), text);
      state.artifacts.push({ path, text });
    },
    handOff: async (url) => {
      if (state.rejectHandoff) throw new Error("no handler");
      state.handed.push(url);
    },
    copy: async (text) => {
      if (state.copyFails) return false;
      state.copied.push(text);
      return true;
    },
  };
  return {
    deps,
    state,
    text: () => files.get("map/prisms.jsonl") ?? null,
    pointers: () => files.get("map/pointers.jsonl") ?? null,
    write: (rel, text) => {
      files.set(rel, text);
    },
    setHead: (rel, head) => {
      state.heads.set(rel, { head });
    },
    refuseHead: (rel, code, detail = null) => {
      state.heads.set(rel, { refusal: { code, detail } });
    },
  };
}

function readRequest(
  overrides: Partial<ReadContactRequest> = {},
): ReadContactRequest {
  return {
    on: ON,
    contact: "look",
    form: "path",
    value: CLEAN,
    workspacePath: "/ws",
    ...overrides,
  };
}

function makeRequest(
  overrides: Partial<MakeContactRequest> = {},
): MakeContactRequest {
  return {
    on: ON,
    form: MAKE_FORM,
    value: ARTIFACT,
    text: ARTIFACT_TEXT,
    workspacePath: "/ws",
    ...overrides,
  };
}

function egressRequest(
  overrides: Partial<EgressContactRequest> = {},
): EgressContactRequest {
  return {
    on: ON,
    contact: "look",
    form: "url",
    value: PAGE,
    workspacePath: "/ws",
    ...overrides,
  };
}

function askRequest(overrides: Partial<AskRequest> = {}): AskRequest {
  return {
    on: ON,
    contact: "ask",
    pointer: CHAT_POINTER,
    included: [PATH_POINTER, CHAT_POINTER],
    question: QUESTION,
    transport: "copy",
    workspacePath: "/ws",
    ...overrides,
  };
}

/** The one appended line, parsed (a Move appends exactly one PRISM). */
function only(text: string | null): Prism {
  expect(text).not.toBeNull();
  const parsed = parsePrisms(text as string);
  expect(parsed.malformed).toEqual([]);
  expect(parsed.prisms).toHaveLength(1);
  return parsed.prisms[0];
}

/** The log's non-empty lines. */
function linesOf(text: string): string[] {
  return text.split("\n").filter((line) => line !== "");
}

/* ========================================================================= *
 * (a) LOOK: the bounded head, said exactly - with the refusals typed.
 * ========================================================================= */

describe("Look: the head read, said exactly (bounds, decode, citation)", () => {
  test("a clean look appends ONE PRISM: the exact bounds, the clean decode, the natural key", async () => {
    const j = journey();
    const result = await runReadContact(readRequest(), j.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    const prism = result.prism;

    expect(prism.on).toBe(ON);
    expect(prism.contact).toBe("look");
    expect(prism.pointer).toEqual(PATH_POINTER);
    expect(prism.explanation).toBe("");
    expect(prism.changes).toEqual([
      {
        kind: "read-head",
        pointer: keyOf("path", CLEAN),
        outcome: "read",
        bounds: { maxLines: HEAD_MAX_LINES, maxBytes: HEAD_MAX_BYTES },
        decode: "clean",
      },
    ]);
    // The bridge was asked exactly the window's caps, on the resolved path.
    expect(j.state.headed).toEqual([
      {
        path: "/ws/" + CLEAN,
        maxLines: HEAD_MAX_LINES,
        maxBytes: HEAD_MAX_BYTES,
      },
    ]);
    expect(j.state.prismsWrites).toBe(1);
    expect(j.text()).toBe(serializePrismLine(prism) + "\n");

    // The window's words at the Move's completion read the same facts.
    const change = prism.changes[0];
    expect(contactWord(prism.contact)).toBe("look");
    expect(changeWord(change)).toBe("head read");
    expect(changeOutcome(change)).toBe("read");
    expect(changeDetail(change)).toBe(
      boundsWords({ maxLines: HEAD_MAX_LINES, maxBytes: HEAD_MAX_BYTES }) +
        " \u00b7 " +
        decodeWords("clean"),
    );
    expect(prismLabel("rain", prism)).toContain("the PRISM of a look");

    // The citation is the pointer's NATURAL KEY; no head byte is a field, and
    // the authored value (the pointer's own sensitivity) is the only world text.
    const log = j.text() as string;
    expect(log).toContain(CLEAN);
    expect(log).not.toContain(CLEAN_HEAD.head);
    expect(log).not.toContain('"head"');
    // The reopen's read is one Prism by citation (the FEEL stays queued).
    expect(latestPrismIn(log, ON, PATH_POINTER)).toEqual(prism);
  });

  test("a lossy decode is SAID: decoded with replacement, never hidden", async () => {
    const j = journey();
    j.setHead(LOSSY, { decode: "with-replacement", head: "abc\uFFFDdef" });
    const result = await runReadContact(
      readRequest({ value: LOSSY }),
      j.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    const change = result.prism.changes[0];
    expect(change).toMatchObject({ outcome: "read", decode: "with-replacement" });
    expect(decodeWords("with-replacement")).toBe("decoded with replacement");
    expect(changeDetail(change)).toContain("decoded with replacement");
    expect(j.text()).not.toContain("abc");
  });

  test("a binary REFUSES not-text: a typed outcome, nothing decoded", async () => {
    const j = journey();
    // The bridge's OS words ride the refusal's detail; they never enter the log.
    j.refuseHead(BINARY, "not-text", "not a text file");
    const result = await runReadContact(
      readRequest({ value: BINARY }),
      j.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.prism.changes).toEqual([
      {
        kind: "read-head",
        pointer: keyOf("path", BINARY),
        outcome: "not-text",
        bounds: { maxLines: HEAD_MAX_LINES, maxBytes: HEAD_MAX_BYTES },
        decode: null,
      },
    ]);
    expect(j.text()).toContain('"outcome":"not-text"');
    expect(j.text()).not.toContain("not a text file");
    expect(j.text()).not.toContain('"detail"');
  });

  test("an escape REFUSES escaped before the bridge is called; the boundary is real", async () => {
    const j = journey();
    const result = await runReadContact(
      readRequest({ value: "../outside/x.md" }),
      j.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    // The resolver saw the joined, authored path; the head reader never ran.
    expect(j.state.canonical).toContain("/ws/../outside/x.md");
    expect(j.state.headed).toEqual([]);
    expect(result.prism.changes[0]).toMatchObject({
      outcome: "escaped",
      decode: null,
    });
    expect(j.text()).toContain('"outcome":"escaped"');
  });
});

/* ========================================================================= *
 * (b) MEASURE: the head's DECLARED facts, pasted - nothing computed.
 * ========================================================================= */

describe("Measure: the declared facts, pasted and never computed", () => {
  test("the size and mtime ride the bounds VERBATIM; the kind is on the header", async () => {
    const j = journey();
    j.setHead(FACTS, { size: 7, mtime: 1763000000123, decode: "clean" });
    const result = await runReadContact(
      readRequest({ contact: "measure", value: FACTS }),
      j.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    const prism = result.prism;

    // The contact kind is the PRISM header; the Change is the same read-head.
    expect(prism.contact).toBe("measure");
    expect(contactWord(prism.contact)).toBe("measure");
    expect(prism.changes).toHaveLength(1);
    const change = prism.changes[0];
    expect(change.kind).toBe("read-head");
    if (change.kind !== "read-head") throw new Error("unreachable");
    expect(change.bounds).toEqual({
      maxLines: HEAD_MAX_LINES,
      maxBytes: HEAD_MAX_BYTES,
      size: 7,
      mtime: 1763000000123,
    });
    expect(Object.keys(change.bounds).sort()).toEqual([
      "maxBytes",
      "maxLines",
      "mtime",
      "size",
    ]);
    // The declared facts are said exactly - no rounded unit, no derived number.
    expect(factsWords(change.bounds)).toBe(
      "size 7 bytes \u00b7 modified " + new Date(1763000000123).toISOString(),
    );
    expect(changeDetail(change)).not.toContain("kB");
    expect(changeDetail(change)).toContain("size 7 bytes");
    expect(changeDetail(change)).toContain(
      new Date(1763000000123).toISOString(),
    );
    // The file holds the declared numbers verbatim (nothing summed).
    expect(j.text()).toContain('"size":7');
    expect(j.text()).toContain('"mtime":1763000000123');
  });

  test("a refusal carries no declared facts (the bounds stay caps) and decodes nothing", async () => {
    const j = journey();
    j.refuseHead(BINARY, "not-text");
    const result = await runReadContact(
      readRequest({ contact: "measure", value: BINARY }),
      j.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    const change = result.prism.changes[0];
    if (change.kind !== "read-head") throw new Error("unreachable");
    expect(change.outcome).toBe("not-text");
    expect(change.decode).toBeNull();
    expect(Object.keys(change.bounds).sort()).toEqual(["maxBytes", "maxLines"]);
  });

  test("the flow pastes head.size/head.mtime and derives nothing (source scan)", () => {
    const flow = codeOnly(source("contacts/read.ts"));
    expect(flow).toContain("size: head.size");
    expect(flow).toContain("mtime: head.mtime");
    for (const dead of ["Math.", "toISOString", ".reduce(", "formatSize"]) {
      expect({ dead, found: flow.includes(dead) }).toEqual({
        dead,
        found: false,
      });
    }
    // No count/sum/summary/average reading of the facts in the code path.
    expect(flow).not.toMatch(/\b(sum|total|average|counts?|summar\w*)\b/i);
  });

  test("a declared number kept as a FINDING never extends the PRISM", async () => {
    const j = journey();
    j.setHead(FACTS, { size: 7, mtime: 1763000000123 });
    const result = await runReadContact(
      readRequest({ contact: "measure", value: FACTS }),
      j.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    const before = j.text();
    // The keep is the ordinary Finding: the person writes the number into the
    // word's memory. No PRISM writer is involved.
    j.write(
      "map/references/" + ON + ".md",
      serializeReference({
        id: ON,
        slug: ON,
        name: ON,
        x: 0,
        y: 0,
        body: "the head declared 7 bytes\n",
        extra: {},
      }),
    );
    expect(j.text()).toBe(before);
    expect(j.state.files.get("map/references/" + ON + ".md")).toContain(
      "7 bytes",
    );
    expect(j.text()).not.toContain("the head declared");
  });
});

/* ========================================================================= *
 * (c) MAKE: one Move, mint then write - the partial log is the truth.
 * ========================================================================= */

describe("Make: mint + write in ONE Move, raw bytes, no accept gate", () => {
  test("a clean make appends ONE PRISM with both Changes, in order", async () => {
    const j = journey();
    const result = await runMakeContact(makeRequest(), j.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    const prism = result.prism;

    expect(prism.contact).toBe("make");
    expect(prism.pointer).toEqual({ form: "path", value: ARTIFACT });
    expect(prism.changes).toEqual([
      { kind: "mint-pointer", target: keyOf("path", ARTIFACT), outcome: "minted" },
      {
        kind: "write-text",
        pointer: keyOf("path", ARTIFACT),
        outcome: "written",
        size: utf8ByteLength(ARTIFACT_TEXT),
      },
    ]);
    // The artifact got ONE reach: the canonical pointer line, keyed naturally.
    expect(parsePointers(j.pointers() as string).pointers).toEqual([
      { on: ON, form: "path", value: ARTIFACT, extra: {} },
    ]);
    expect(j.pointers()).toBe(
      serializePointerLine({
        on: ON,
        form: "path",
        value: ARTIFACT,
        extra: {},
      }) + "\n",
    );
    // The text was written RAW, at the resolved path, verbatim.
    expect(j.state.artifacts).toEqual([
      { path: "/ws/" + ARTIFACT, text: ARTIFACT_TEXT },
    ]);
    expect(j.state.artifacts[0].text.endsWith("\n")).toBe(false);
    expect(j.state.artifacts[0].text).toContain("\r\n");
    // ONE Move = ONE appended line.
    expect(j.state.prismsWrites).toBe(1);
    expect(j.text()).toBe(serializePrismLine(prism) + "\n");
    // The window's words: the minted reach's citation, the authored text's size.
    expect(changeDetail(prism.changes[0])).toBe("path " + ARTIFACT);
    expect(changeDetail(prism.changes[1])).toBe(
      "size " + utf8ByteLength(ARTIFACT_TEXT) + " bytes",
    );
  });

  test("a write failure logs BOTH Changes (minted, then failed) - the partial log is the truth", async () => {
    const j = journey();
    j.state.failArtifact = true;
    const result = await runMakeContact(
      makeRequest({ value: PARTIAL }),
      j.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.prism.changes).toEqual([
      {
        kind: "mint-pointer",
        target: keyOf("path", PARTIAL),
        outcome: "minted",
      },
      {
        kind: "write-text",
        pointer: keyOf("path", PARTIAL),
        outcome: "failed",
        size: utf8ByteLength(ARTIFACT_TEXT),
      },
    ]);
    // The pointer line IS there (the mint landed); the artifact is not.
    expect(parsePointers(j.pointers() as string).pointers).toHaveLength(1);
    expect(j.state.artifacts).toEqual([]);
    expect(j.state.files.has(PARTIAL)).toBe(false);
    // Still exactly one appended PRISM, and it says the failure.
    expect(j.state.prismsWrites).toBe(1);
    expect(only(j.text()).changes).toEqual(result.prism.changes);
  });

  test("no accept gate between the gesture and the record (source scan)", () => {
    const GATE =
      /\b(accept|accepted|accepts|accepting|approve|approved|approval|proposal|propose|pending|confirm)\b/;
    for (const file of [
      "contacts/make.ts",
      "contacts/prismLog.ts",
      "canvas/MakePanel.tsx",
    ]) {
      expect({ file, gated: GATE.test(codeOnly(source(file))) }).toEqual({
        file,
        gated: false,
      });
    }
    // The person's press calls the Move directly; an agent's Make is a ghost.
    const wiring = bodyOnly(source("contacts/prismLog.ts"));
    expect(wiring).toContain("runMakeContact(request,");
    expect(wiring).not.toContain("ghost/");
    expect(codeOnly(source("contacts/make.ts"))).not.toContain("ghost/");
  });
});

/* ========================================================================= *
 * (d) OPEN-OS: handed / handoff-failed / refused - never "opened".
 * ========================================================================= */

describe("open-os: the handoff's three outcomes, and never the word opened", () => {
  test("a successful handoff says HANDED and hands the url over verbatim", async () => {
    const j = journey();
    const result = await runEgressContact(egressRequest(), j.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(j.state.handed).toEqual([PAGE]);
    expect(result.prism.contact).toBe("look");
    expect(result.prism.pointer).toEqual({ form: "url", value: PAGE });
    expect(result.prism.changes).toEqual([
      { kind: "open-os", pointer: keyOf("url", PAGE), outcome: "handed" },
    ]);
    expect(changeOutcome(result.prism.changes[0])).toBe("handed");
    // The log says what the app knows: the address left; nothing about the OS.
    expect((j.text() as string).toLowerCase()).toContain("handed");
    expect((j.text() as string).toLowerCase()).not.toContain("opened");
    expect(result.prism.changes[0]).toMatchObject({ kind: "open-os" });
    expect(changeDetail(result.prism.changes[0])).toBe("");
  });

  test("a rejected handoff logs handoff-failed (a launch failure logs too)", async () => {
    const j = journey();
    j.state.rejectHandoff = true;
    const result = await runEgressContact(
      egressRequest({ value: SECOND_PAGE }),
      j.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(j.state.handed).toEqual([]);
    expect(result.prism.changes).toEqual([
      {
        kind: "open-os",
        pointer: keyOf("url", SECOND_PAGE),
        outcome: "handoff-failed",
      },
    ]);
    expect(j.text()).toContain('"outcome":"handoff-failed"');
  });

  test("an unsupported scheme is REFUSED before the OS is called - still a Move", async () => {
    const value = "obsidian://open?vault=notes";
    const j = journey();
    const result = await runEgressContact(
      egressRequest({ value }),
      j.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(j.state.handed).toEqual([]);
    expect(result.prism.changes).toEqual([
      { kind: "open-os", pointer: keyOf("url", value), outcome: "refused" },
    ]);
    // It is a Move: the person pressed the gesture; the log says refused.
    expect(j.state.prismsWrites).toBe(1);
  });

  test("the outcome vocabulary is the closed three, and no outcome claims opened", () => {
    expect([...OPEN_OS_OUTCOMES]).toEqual([
      "handed",
      "handoff-failed",
      "refused",
    ]);
    for (const word of Object.values(OUTCOME_WORDS)) {
      expect(word.toLowerCase()).not.toContain("opened");
    }
  });
});

/* ========================================================================= *
 * (e) ASK: the inclusion set as citations, the paste intake, the separate keep.
 * ========================================================================= */

describe("Ask: the question out, the response in, the keep separate", () => {
  test("the send copies the packet and appends NOTHING (a question in flight is not a Move)", async () => {
    const j = journey();
    const sent = await sendAsk(askRequest(), j.deps);
    if (sent.kind !== "sent") throw new Error("unreachable");
    expect(sent.ask.packet).toBe(
      askPacket(QUESTION, [PATH_POINTER, CHAT_POINTER]),
    );
    expect(j.state.copied).toEqual([sent.ask.packet]);
    expect(j.text()).toBeNull();
    expect(j.state.prismsWrites).toBe(0);
    // The packet carries CITATIONS; the app pre-reads nothing to compose it.
    expect(sent.ask.packet).toContain("- path " + CLEAN);
    expect(sent.ask.packet).toContain("- url " + CHAT);
    expect(sent.ask.packet).not.toContain(CLEAN_HEAD.head);
    expect(sent.ask.included).toEqual([
      keyOf("path", CLEAN),
      keyOf("url", CHAT),
    ]);
  });

  test("the intake logs the inclusion SET as citations and the response's size+decode - never bytes", async () => {
    const j = journey();
    const sent = await sendAsk(askRequest(), j.deps);
    if (sent.kind !== "sent") throw new Error("unreachable");
    const result = await intakeAskResponse(sent.ask, RESPONSE, null, j.deps);
    if (result.kind !== "moved") throw new Error("unreachable");

    // The response is CONTENT: wrapped verbatim with its own declared facts.
    expect(result.response).toEqual({
      text: RESPONSE,
      size: utf8ByteLength(RESPONSE),
      decode: "clean",
    });
    expect(result.prism.changes).toEqual([
      {
        kind: "ask",
        pointer: keyOf("url", CHAT),
        outcome: "answered",
        included: [keyOf("path", CLEAN), keyOf("url", CHAT)],
        responseSize: utf8ByteLength(RESPONSE),
        decode: "clean",
      },
    ]);
    expect(j.state.prismsWrites).toBe(1);
    expect(j.text()).toBe(serializePrismLine(result.prism) + "\n");
    // Neither the question nor the response ever enters the log; the citations do.
    expect(j.text()).not.toContain(QUESTION);
    expect(j.text()).not.toContain("an answer");
    expect(j.text()).toContain(CLEAN);
    expect(j.text()).toContain(CHAT);
    // The window reads the inclusion set as citations and the exact facts.
    expect(changeDetail(result.prism.changes[0])).toBe(
      inclusionWords([keyOf("path", CLEAN), keyOf("url", CHAT)]) +
        " \u00b7 response: size " +
        utf8ByteLength(RESPONSE) +
        " bytes \u00b7 decoded clean",
    );
    // The response is ephemeral: the intake wrote the log and nothing else.
    expect(j.state.artifacts).toEqual([]);
    expect(j.state.files.has("map/references/" + ON + ".md")).toBe(false);
  });

  test("a lossy paste is SAID at intake: decoded with replacement", async () => {
    const j = journey();
    const sent = await sendAsk(askRequest(), j.deps);
    if (sent.kind !== "sent") throw new Error("unreachable");
    const raw = "abc\uFFFDdef";
    const result = await intakeAskResponse(sent.ask, raw, null, j.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.response.decode).toBe("with-replacement");
    expect(result.prism.changes[0]).toMatchObject({
      outcome: "answered",
      decode: "with-replacement",
    });
  });

  test("the KEEP is the Finding, a SEPARATE act: the PRISM stays byte-exact", async () => {
    const j = journey();
    const sent = await sendAsk(askRequest(), j.deps);
    if (sent.kind !== "sent") throw new Error("unreachable");
    const intake = await intakeAskResponse(sent.ask, RESPONSE, null, j.deps);
    if (intake.kind !== "moved") throw new Error("unreachable");
    const beforeKeep = j.text() as string;

    // The keep: the response becomes this word's MEMORY through the ordinary
    // reference writer (the Finding), never a PRISM write.
    const written: { path: string; text: string }[] = [];
    const write = (path: string, text: string) => {
      written.push({ path, text });
    };
    write(
      "/ws/map/references/" + ON + ".md",
      serializeReference({
        id: ON,
        slug: ON,
        name: ON,
        x: 0,
        y: 0,
        body: intake.response.text,
        extra: {},
      }),
    );
    expect(written).toHaveLength(1);
    expect(written[0].path).toContain("map/references/");
    expect(written[0].text).toContain("an answer");
    expect(written.some((entry) => entry.path.includes("prisms.jsonl"))).toBe(
      false,
    );
    // The PRISM is unchanged, byte for byte: the record closed at intake.
    expect(j.text()).toBe(beforeKeep);
    expect(j.state.prismsWrites).toBe(1);

    // The app's keep callback calls the ordinary word write, no PRISM writer.
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
      "appendPrismLine",
      "mintPrismId",
      "rewritePrismExplanation",
      "intakeAsk",
      "closeAsk",
      "runReadMove",
    ]) {
      expect({ writer, found: body.includes(writer) }).toEqual({
        writer,
        found: false,
      });
    }
  });
});

/* ========================================================================= *
 * (f) THE PERSON'S EXPLANATION: ID-addressed, every other byte preserved.
 * ========================================================================= */

describe("the explanation: the person's own words on their own Move", () => {
  test("the edit changes ONE line's explanation and keeps every other byte", async () => {
    const j = journey();
    await runReadContact(readRequest(), j.deps);
    await runReadContact(readRequest({ value: LOSSY }), j.deps);
    const log = j.text() as string;
    const before = parsePrisms(log);
    // Empty when the person wrote none.
    expect(before.prisms.every((prism) => prism.explanation === "")).toBe(true);

    const prose = "  I looked because the plan said so.\n\t\u2014 me  ";
    const next = rewritePrismExplanation(log, "prism-1", prose);
    expect(next).not.toBeNull();
    const beforeLines = log.match(/[^\n]*\n|[^\n]+$/g) as string[];
    const afterLines = (next as string).match(/[^\n]*\n|[^\n]+$/g) as string[];
    expect(afterLines).toHaveLength(beforeLines.length);
    // Every line but the addressed one is byte-identical.
    for (let index = 0; index < beforeLines.length; index += 1) {
      if (index === 0) continue;
      expect(afterLines[index]).toBe(beforeLines[index]);
    }
    // The addressed line kept everything but its explanation field.
    const edited = parsePrismLine(afterLines[0].replace(/\n$/, "")) as Prism;
    const original = parsePrismLine(beforeLines[0].replace(/\n$/, "")) as Prism;
    expect(edited.explanation).toBe(prose);
    expect({ ...edited, explanation: "" }).toEqual({
      ...original,
      explanation: "",
    });
    // Never an append and never a merge: the ids, order and count hold.
    expect(before.prisms.map((prism) => prism.id)).toEqual([
      "prism-1",
      "prism-2",
    ]);
    expect(
      parsePrisms(next as string).prisms.map((prism) => prism.id),
    ).toEqual(before.prisms.map((prism) => prism.id));
    // An unknown id is not saved: nothing is written.
    expect(rewritePrismExplanation(log, "prism-nope", "why")).toBeNull();
  });

  test("a hand log's malformed line and CRLF survive the save", async () => {
    const hand = '{"a hand":"line"}\r\n';
    const j = journey({ before: hand });
    await runReadContact(readRequest(), j.deps);
    const log = j.text() as string;
    const next = rewritePrismExplanation(log, "prism-1", "why") as string;
    expect(next.startsWith(hand)).toBe(true);
    const parsed = parsePrisms(next);
    expect(parsed.malformed).toEqual(['{"a hand":"line"}']);
    expect(parsed.prisms).toHaveLength(1);
    expect(parsed.prisms[0].explanation).toBe("why");
  });
});

/* ========================================================================= *
 * (g) THE NEGATIVE SPACE: no counts, no summaries, no inference, no transients.
 * ========================================================================= */

/** Every PRISM surface the tally scan covers (the story-2/3 list). */
const PRISM_SURFACES = [
  "contacts/read.ts",
  "contacts/make.ts",
  "contacts/egress.ts",
  "contacts/ask.ts",
  "contacts/prismLog.ts",
  "canvas/prismRules.ts",
  "canvas/PrismWindow.tsx",
  "canvas/contactRules.ts",
  "canvas/AskPanel.tsx",
  "canvas/MakePanel.tsx",
];

describe("the negative space: no counts, no summaries, no inference", () => {
  test("the PRISM surfaces hold no list, count or sum affordance", () => {
    const FORBIDDEN =
      /\b(listPrisms|countPrisms|allPrisms|sumPrisms|totalPrisms|prismCount|prismSummary|prismsBy|summar\w*)\b/;
    for (const file of PRISM_SURFACES) {
      const code = bodyOnly(source(file));
      expect({ file, list: FORBIDDEN.test(code) }).toEqual({
        file,
        list: false,
      });
      expect({ file, reduce: code.includes(".reduce(") }).toEqual({
        file,
        reduce: false,
      });
      expect({ file, length: code.includes("prisms.length") }).toEqual({
        file,
        length: false,
      });
    }
    // The window's words never see an array of PRISMs at all.
    for (const file of ["canvas/prismRules.ts", "canvas/PrismWindow.tsx"]) {
      expect({ file, series: bodyOnly(source(file)).includes("prisms") }).toEqual(
        { file, series: false },
      );
    }
    // The app holds ONE Prism, never the series.
    const app = bodyOnly(source("App.tsx"));
    expect(app).not.toContain("prisms");
    expect(app).not.toMatch(/Prism\[\]/);
  });

  test("transients mint no PRISM (the peek and the look-under are read-only)", () => {
    const MACHINERY = [
      "appendPrismLine",
      "mintPrismId",
      "savePrismExplanation",
      "rewritePrismExplanation",
      "runReadMove",
      "readLatestPrism",
      "loadLatestPrism",
      "map/prisms",
    ];
    for (const file of [
      "canvas/OutwardWindow.tsx",
      "canvas/VeilLookUnder.tsx",
      "canvas/outward.ts",
      "canvas/outwardRules.ts",
      "canvas/veilRules.ts",
      "canvas/prismRules.ts",
      "canvas/PrismWindow.tsx",
    ]) {
      const code = bodyOnly(source(file));
      for (const writer of MACHINERY) {
        expect({ file, writer, found: code.includes(writer) }).toEqual({
          file,
          writer,
          found: false,
        });
      }
    }
  });

  test("the Ask composes citations and never pre-reads a target (no inference)", () => {
    const ask = bodyOnly(source("contacts/ask.ts"));
    for (const reader of [
      "readHead",
      "readTextHead",
      "readTextFile",
      "readPointersText",
    ]) {
      expect({ reader, found: ask.includes(reader) }).toEqual({
        reader,
        found: false,
      });
    }
    // No assistant is consulted: the contact flows talk to no agent/LLM.
    for (const file of [
      "contacts/read.ts",
      "contacts/make.ts",
      "contacts/egress.ts",
      "contacts/ask.ts",
    ]) {
      const code = bodyOnly(source(file));
      for (const forbidden of [
        "ghost/",
        "@tauri-apps",
        "invoke(",
        "fetch(",
        "assistant",
        "openai",
        "(llm",
      ]) {
        expect({ file, forbidden, found: code.includes(forbidden) }).toEqual({
          file,
          forbidden,
          found: false,
        });
      }
      expect({ file, infer: /\binfer/i.test(code) }).toEqual({
        file,
        infer: false,
      });
    }
  });

  test("the record module exposes no listing or summarizing accessor", () => {
    const prisms = bodyOnly(source("map/prisms.ts"));
    for (const dead of [
      "listPrisms",
      "countPrisms",
      "allPrisms",
      "prismSummary",
      "summarize",
      "score",
      "tally",
    ]) {
      expect({ dead, found: prisms.includes(dead) }).toEqual({
        dead,
        found: false,
      });
    }
    // The one reopen read answers ONE Prism (or null), by citation.
    const start = prisms.indexOf("export function latestPrismIn(");
    expect(start).toBeGreaterThan(-1);
    const signature = prisms.slice(start, prisms.indexOf(") {", start));
    expect(signature).toContain("): Prism | null");
  });
});

/* ========================================================================= *
 * The retired phrases stay retired: "opened" absent; no content slot.
 * ========================================================================= */

describe("the retired phrases stay retired", () => {
  test("the word opened is absent from the contact surfaces (the log says handed)", () => {
    // The story-3 surfaces, code only: the docs may SAY the word is forbidden.
    for (const file of [
      "contacts/read.ts",
      "contacts/make.ts",
      "contacts/egress.ts",
      "contacts/ask.ts",
      "contacts/prismLog.ts",
      "canvas/contactRules.ts",
      "canvas/prismRules.ts",
      "canvas/PrismWindow.tsx",
      "canvas/AskPanel.tsx",
      "canvas/MakePanel.tsx",
      "canvas/PointerChooser.tsx",
    ]) {
      expect({
        file,
        opened: codeOnly(source(file)).toLowerCase().includes("opened"),
      }).toEqual({ file, opened: false });
    }
  });

  test("there is no content slot in any declared key set", () => {
    const FORBIDDEN = [
      "content",
      "text",
      "head",
      "question",
      "answer",
      "response",
      "body",
      "bytes",
      "prose",
      "prompt",
    ];
    for (const key of PRISM_KEYS) expect(FORBIDDEN).not.toContain(key);
    for (const key of BOUNDS_KEYS) expect(FORBIDDEN).not.toContain(key);
    for (const kind of CHANGE_KINDS) {
      for (const key of CHANGE_KEYS[kind]) expect(FORBIDDEN).not.toContain(key);
    }
    // The tables are the record module's ONE declaration, not a second shape.
    const prisms = source("map/prisms.ts");
    expect(prisms).toContain("export const PRISM_KEYS");
    expect(prisms).toContain("export const CHANGE_KEYS");
    expect(prisms).toContain("There is no content slot here, by design.");
  });

  test("no contact flow carries an accept gate on the person's own write", () => {
    const GATE =
      /\b(accept|accepted|accepts|accepting|approve|approved|approval|proposal|propose|pending|confirm)\b/;
    for (const file of [
      "contacts/make.ts",
      "contacts/egress.ts",
      "contacts/ask.ts",
    ]) {
      expect({ file, gated: GATE.test(codeOnly(source(file))) }).toEqual({
        file,
        gated: false,
      });
    }
  });
});

/* ========================================================================= *
 * The whole check, in the check's order - the port-asserted half, end to end.
 * ========================================================================= */

describe("the whole check, in the check's order (the port-asserted half)", () => {
  test("every Move appends one line; the keep and the explanation never do; nothing content-shaped is logged", async () => {
    const j = journey();
    const snapshots: string[] = [];
    const windows: {
      prism: Prism;
      pointer: PrismPointer | null;
      contact: Prism["contact"];
    }[] = [];
    const record = (prism: Prism, pointer: PrismPointer | null): void => {
      windows.push({ prism, pointer, contact: prism.contact });
      snapshots.push(j.text() as string);
    };

    // (1) LOOK a clean file: the head reads; the PRISM says exactly what happened.
    const clean = await runReadContact(readRequest(), j.deps);
    if (clean.kind !== "moved") throw new Error("unreachable");
    record(clean.prism, PATH_POINTER);

    // (2) LOOK a lossy file: decoded with replacement.
    j.setHead(LOSSY, { decode: "with-replacement", head: "abc\uFFFDdef" });
    const lossy = await runReadContact(
      readRequest({ value: LOSSY }),
      j.deps,
    );
    if (lossy.kind !== "moved") throw new Error("unreachable");
    record(lossy.prism, { form: "path", value: LOSSY });

    // (3) LOOK a binary: it refuses not-text.
    j.refuseHead(BINARY, "not-text", "not a text file");
    const binary = await runReadContact(
      readRequest({ value: BINARY }),
      j.deps,
    );
    if (binary.kind !== "moved") throw new Error("unreachable");
    record(binary.prism, { form: "path", value: BINARY });

    // (4) LOOK ../outside: it refuses escaped.
    const escaped = await runReadContact(
      readRequest({ value: "../outside/x.md" }),
      j.deps,
    );
    if (escaped.kind !== "moved") throw new Error("unreachable");
    record(escaped.prism, { form: "path", value: "../outside/x.md" });

    // (5) LOOK a URL: the OS is handed the address; the PRISM says handed.
    const handed = await runEgressContact(egressRequest(), j.deps);
    if (handed.kind !== "moved") throw new Error("unreachable");
    record(handed.prism, { form: "url", value: PAGE });

    // (6) A launch failure logs too: handoff-failed.
    j.state.rejectHandoff = true;
    const failed = await runEgressContact(
      egressRequest({ value: SECOND_PAGE }),
      j.deps,
    );
    if (failed.kind !== "moved") throw new Error("unreachable");
    record(failed.prism, { form: "url", value: SECOND_PAGE });
    j.state.rejectHandoff = false;

    // (7) A refusal logs too: refused (the unsupported scheme never leaves).
    const refused = await runEgressContact(
      egressRequest({ value: "obsidian://open?vault=notes" }),
      j.deps,
    );
    if (refused.kind !== "moved") throw new Error("unreachable");
    record(refused.prism, {
      form: "url",
      value: "obsidian://open?vault=notes",
    });

    // (8) MEASURE: the head's declared facts, pasted.
    j.setHead(FACTS, { size: 7, mtime: 1763000000123 });
    const measured = await runReadContact(
      readRequest({ contact: "measure", value: FACTS }),
      j.deps,
    );
    if (measured.kind !== "moved") throw new Error("unreachable");
    record(measured.prism, { form: "path", value: FACTS });

    // (9) MAKE: name an artifact; the Move mints + writes raw text.
    const made = await runMakeContact(makeRequest(), j.deps);
    if (made.kind !== "moved") throw new Error("unreachable");
    record(made.prism, { form: "path", value: ARTIFACT });

    // (10) MAKE with a failed write: the partial log is the truth.
    j.state.failArtifact = true;
    const partial = await runMakeContact(
      makeRequest({ value: PARTIAL }),
      j.deps,
    );
    if (partial.kind !== "moved") throw new Error("unreachable");
    record(partial.prism, { form: "path", value: PARTIAL });
    j.state.failArtifact = false;

    // (11) ASK: the question out by copy (no record yet), the response back by paste.
    const sent = await sendAsk(askRequest(), j.deps);
    if (sent.kind !== "sent") throw new Error("unreachable");
    expect(j.text()).toBe(snapshots[snapshots.length - 1]);
    const intake = await intakeAskResponse(sent.ask, RESPONSE, null, j.deps);
    if (intake.kind !== "moved") throw new Error("unreachable");
    record(intake.prism, CHAT_POINTER);

    const log = j.text() as string;
    const parsed = parsePrisms(log);

    // ONE appended line per Move, in FILE order, ids minted by the record.
    expect(snapshots).toHaveLength(11);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.prisms.map((prism) => prism.id)).toEqual([
      "prism-1",
      "prism-2",
      "prism-3",
      "prism-4",
      "prism-5",
      "prism-6",
      "prism-7",
      "prism-8",
      "prism-9",
      "prism-10",
      "prism-11",
    ]);
    for (let index = 1; index < snapshots.length; index += 1) {
      // APPEND-ONLY: the earlier bytes are a prefix; one line was added.
      expect(snapshots[index].startsWith(snapshots[index - 1])).toBe(true);
      expect(linesOf(snapshots[index])).toHaveLength(index + 1);
    }

    // Every Move's window reads its ONE PRISM (the reopen's FEEL stays queued).
    windows.forEach((entry, index) => {
      expect(parsed.prisms[index]).toEqual(entry.prism);
      expect(entry.prism.on).toBe(ON);
      if (entry.pointer !== null) {
        expect(entry.prism.pointer).toEqual(entry.pointer);
      }
      expect(
        latestPrismIn(log, ON, entry.pointer, entry.contact),
      ).toEqual(entry.prism);
    });

    // The citation is always the pointer's NATURAL KEY, never a byte dump.
    for (const prism of parsed.prisms) {
      if (prism.pointer === null) continue;
      const citation = pointerKey(
        ON,
        prism.pointer.form,
        prism.pointer.value,
      );
      for (const change of prism.changes) {
        if (
          change.kind === "read-head" ||
          change.kind === "write-text" ||
          change.kind === "open-os"
        ) {
          expect(change.pointer).toBe(citation);
        }
        if (change.kind === "mint-pointer") {
          expect(change.target).toBe(
            pointerKey(ON, "path", prism.pointer.value),
          );
        }
        if (change.kind === "ask") {
          expect(change.pointer).toBe(citation);
          expect(change.included).toEqual([
            keyOf("path", CLEAN),
            keyOf("url", CHAT),
          ]);
          expect(change.responseSize).toBe(utf8ByteLength(RESPONSE));
        }
      }
    }

    // The log shows what LEFT the machine (the two pages and the ask) and what
    // never did (the head's bytes, the question, the response, the artifact).
    expect(log).toContain(PAGE);
    expect(log).toContain(SECOND_PAGE);
    expect(log).toContain(CHAT);
    for (const secret of [
      CLEAN_HEAD.head,
      "abc\uFFFDdef",
      QUESTION,
      RESPONSE,
      "an answer",
      ARTIFACT_TEXT,
      "the head declared",
    ]) {
      expect({ secret, found: log.includes(secret) }).toEqual({
        secret,
        found: false,
      });
    }
    // Nothing counted, summed, averaged or summarized in the record.
    expect(log.toLowerCase()).not.toMatch(
      /\b(count|counts|total|sum|average|summary|score|tally)\b/,
    );

    // No content slot at ANY depth of ANY line (the union is closed).
    const FORBIDDEN_KEYS = [
      "content",
      "text",
      "head",
      "question",
      "answer",
      "response",
      "body",
      "bytes",
      "prose",
      "prompt",
      "summary",
      "count",
      "total",
      "average",
      "score",
    ];
    const keysOf = (node: unknown, into: Set<string> = new Set()): Set<string> => {
      if (Array.isArray(node)) {
        node.forEach((child) => keysOf(child, into));
        return into;
      }
      if (node !== null && typeof node === "object") {
        for (const [key, child] of Object.entries(node)) {
          into.add(key);
          keysOf(child, into);
        }
      }
      return into;
    };
    for (const prism of parsed.prisms) {
      const keys = keysOf(JSON.parse(serializePrismLine(prism)));
      for (const forbidden of FORBIDDEN_KEYS) {
        expect({ forbidden, found: keys.has(forbidden) }).toEqual({
          forbidden,
          found: false,
        });
      }
    }

    // The person's explanation is theirs (empty when they wrote none).
    expect(parsed.prisms.every((prism) => prism.explanation === "")).toBe(true);
    const explained = rewritePrismExplanation(
      log,
      parsed.prisms[0].id,
      "I looked because the plan said so.",
    ) as string;
    const beforeLines = linesOf(log);
    const afterLines = linesOf(explained);
    expect(afterLines).toHaveLength(beforeLines.length);
    expect(afterLines.slice(1)).toEqual(beforeLines.slice(1));
    expect(parsePrisms(explained).prisms[0].explanation).toBe(
      "I looked because the plan said so.",
    );

    // THE KEEP is the Finding, a separate act: the PRISM stays byte-exact.
    const beforeKeep = j.text();
    j.write(
      "map/references/" + ON + ".md",
      serializeReference({
        id: ON,
        slug: ON,
        name: ON,
        x: 0,
        y: 0,
        body: intake.response.text,
        extra: {},
      }),
    );
    expect(j.text()).toBe(beforeKeep);
    expect(j.state.prismsWrites).toBe(11);
    expect(j.state.files.get("map/references/" + ON + ".md")).toContain(
      "an answer",
    );
  });
});
