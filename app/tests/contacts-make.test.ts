import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { utf8ByteLength } from "../src/lib/textBytes";
import {
  parsePointers,
  pointerKey,
  serializePointerLine,
} from "../src/map/pointers";
import {
  parsePrisms,
  serializePrismLine,
  type Prism,
} from "../src/map/prisms";
import {
  MAKE_FORM,
  REFUSED_NAME,
  REFUSED_REACH,
  runMakeContact,
  type MakeContactDeps,
  type MakeContactRequest,
} from "../src/contacts/make";
import { findContact } from "../src/contacts/table";

/**
 * Epic 12 story 3 — MAKE, the person's own contact write, automated.
 *
 * One Move, two Changes in the order the Move made them: the artifact's pointer
 * is MINTED (the person names it; the mint's target is the pointer's natural
 * key), then the text is WRITTEN raw. This file asserts, through injected
 * bridges and no Tauri runtime:
 * - the mint appends the canonical pointer line, and the log's two Changes
 *   cite the same natural key;
 * - the artifact's bytes are VERBATIM — never trimmed, normalized or run
 *   through the canonicalising machine door (structurally: this flow imports
 *   no serializer; the wiring uses the raw bridge);
 * - THE PARTIAL LOG IS THE TRUTH: a write failure logs BOTH Changes (minted,
 *   then failed); a mint failure logs the mint alone and writes no artifact;
 * - a boundary escape is not a Move (nothing minted, written or appended);
 * - the table's refusals (at/url/none) are not this Move;
 * - there is NO ACCEPT GATE: the person's press is the whole of it, and an
 *   agent's Make is a ghost (the source scan holds the note in code).
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
const ARTIFACT = "notes/the-artifact.md";
const KEY = pointerKey(ON, MAKE_FORM, ARTIFACT);
const TEXT = "raw bytes: \r\n  trailing spaces  \nno canonical newline";

interface Harness {
  deps: MakeContactDeps;
  /** The artifact writes the bridge answered, in order. */
  artifacts: { path: string; text: string }[];
  /** The pointers file's bytes as they stand now. */
  pointers: () => string | null;
  /** The PRISM file's bytes as they stand now. */
  prisms: () => string | null;
  writes: () => number;
}

function harness(
  options: {
    pointers?: string | null;
    failPointers?: boolean;
    failArtifact?: boolean;
    canonical?: (path: string) => Promise<string | null>;
    before?: string | null;
  } = {},
): Harness {
  let pointers = options.pointers ?? null;
  let prisms = options.before ?? null;
  let writes = 0;
  let minted = 0;
  const artifacts: Harness["artifacts"] = [];
  const deps: MakeContactDeps = {
    canonicalize:
      options.canonical ?? (async (path: string) => path),
    readPointersText: async () => pointers,
    writePointersText: async (text) => {
      if (options.failPointers === true) throw new Error("cannot mint");
      pointers = text;
    },
    writeArtifact: async (path, text) => {
      if (options.failArtifact === true) throw new Error("cannot write");
      artifacts.push({ path, text });
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
    artifacts,
    pointers: () => pointers,
    prisms: () => prisms,
    writes: () => writes,
  };
}

function request(overrides: Partial<MakeContactRequest> = {}): MakeContactRequest {
  return {
    on: ON,
    form: MAKE_FORM,
    value: ARTIFACT,
    text: TEXT,
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

describe("Make: ONE Move, the mint then the write", () => {
  test("a clean make appends ONE PRISM with both Changes, in order", async () => {
    const h = harness();
    const result = await runMakeContact(request(), h.deps);
    expect(result.kind).toBe("moved");
    if (result.kind !== "moved") throw new Error("unreachable");

    expect(result.prism.contact).toBe("make");
    expect(result.prism.on).toBe(ON);
    expect(result.prism.pointer).toEqual({ form: "path", value: ARTIFACT });
    expect(result.prism.explanation).toBe("");
    expect(result.prism.changes).toEqual([
      { kind: "mint-pointer", target: KEY, outcome: "minted" },
      {
        kind: "write-text",
        pointer: KEY,
        outcome: "written",
        size: utf8ByteLength(TEXT),
      },
    ]);
    // The mint's target IS the pointer's natural key, and the write cites it.
    expect(result.prism.changes[0]).toMatchObject({ target: KEY });
    expect(result.prism.changes[1]).toMatchObject({ pointer: KEY });

    // The canonical pointer line landed, one line for the new reach.
    const pointers = parsePointers(h.pointers() as string);
    expect(pointers.malformed).toEqual([]);
    expect(pointers.pointers).toEqual([
      { on: ON, form: "path", value: ARTIFACT, extra: {} },
    ]);
    expect(h.pointers()).toBe(
      serializePointerLine({ on: ON, form: "path", value: ARTIFACT, extra: {} }) +
        "\n",
    );

    // The artifact was written once, at the resolved path.
    expect(h.artifacts).toEqual([{ path: "/ws/" + ARTIFACT, text: TEXT }]);

    // ONE append, canonical bytes, the move's own id.
    expect(h.writes()).toBe(1);
    expect(h.prisms()).toBe(serializePrismLine(result.prism) + "\n");
    expect(only(h.prisms()).id).toBe("prism-1");
  });

  test("the artifact's bytes are RAW — verbatim, never canonicalized", async () => {
    const odd =
      "\uFEFFa BOM, CRLF\r\ntrailing   \n\nno final newline, emoji \u{1F600}";
    const h = harness();
    const result = await runMakeContact(request({ text: odd }), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    // Exactly the authored string, byte for byte — no trim, no newline, no
    // canonical key order (it is not JSON at all).
    expect(h.artifacts[0].text).toBe(odd);
    expect(h.artifacts[0].text.endsWith("\n")).toBe(false);
    const write = result.prism.changes[1];
    expect(write.kind === "write-text" && write.size).toBe(
      utf8ByteLength(odd),
    );
    // The size is the declared fact of the authored text, not of the log line.
    expect(utf8ByteLength(odd)).toBeGreaterThan(odd.length - 3);
  });

  test("a write failure logs BOTH Changes: minted, then failed", async () => {
    const h = harness({ failArtifact: true });
    const result = await runMakeContact(request(), h.deps);
    expect(result.kind).toBe("moved");
    if (result.kind !== "moved") throw new Error("unreachable");

    expect(result.prism.changes).toEqual([
      { kind: "mint-pointer", target: KEY, outcome: "minted" },
      {
        kind: "write-text",
        pointer: KEY,
        outcome: "failed",
        size: utf8ByteLength(TEXT),
      },
    ]);
    // The partial log is the truth: the pointer line IS there (minted) ...
    expect(parsePointers(h.pointers() as string).pointers).toHaveLength(1);
    // ... the artifact is not, and the ONE appended line says so.
    expect(h.artifacts).toEqual([]);
    expect(h.writes()).toBe(1);
    const logged = only(h.prisms());
    expect(logged.changes[1]).toMatchObject({
      kind: "write-text",
      outcome: "failed",
    });
  });

  test("a mint failure logs the mint alone and writes NO artifact", async () => {
    const h = harness({ failPointers: true });
    const result = await runMakeContact(request(), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");

    expect(result.prism.changes).toEqual([
      { kind: "mint-pointer", target: KEY, outcome: "failed" },
    ]);
    // A file with no reach is not this Move: the write was never attempted.
    expect(h.artifacts).toEqual([]);
    expect(h.writes()).toBe(1);
    expect(only(h.prisms()).changes).toEqual(result.prism.changes);
  });

  test("a byte-exact re-statement mints nothing new and still logs minted", async () => {
    const before =
      serializePointerLine({ on: ON, form: "path", value: ARTIFACT, extra: {} }) +
      "\n";
    const h = harness({ pointers: before });
    const result = await runMakeContact(request(), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    // The reach already exists: the pointer file keeps its exact bytes.
    expect(h.pointers()).toBe(before);
    expect(result.prism.changes[0]).toMatchObject({ outcome: "minted" });
  });

  test("the pointers file's malformed lines survive the mint verbatim", async () => {
    const before = '{"a hand":"line"}\n';
    const h = harness({ pointers: before });
    await runMakeContact(request(), h.deps);
    const pointers = parsePointers(h.pointers() as string);
    expect(pointers.malformed).toEqual(['{"a hand":"line"}']);
    expect(pointers.pointers).toHaveLength(1);
  });
});

describe("Make: the boundary, the table, and one line per Move", () => {
  test("a path that realpaths outside the workspace is not a Move", async () => {
    const h = harness({
      canonical: async (path: string) =>
        path.includes("outside") ? "/elsewhere/outside.md" : path,
    });
    const result = await runMakeContact(
      request({ value: "../outside/x.md" }),
      h.deps,
    );
    expect(result).toEqual({ kind: "refused", reason: REFUSED_REACH });
    // Nothing was minted, nothing was written, nothing was appended.
    expect(h.pointers()).toBeNull();
    expect(h.artifacts).toEqual([]);
    expect(h.writes()).toBe(0);
    expect(h.prisms()).toBeNull();
  });

  test("a blank name is not an artifact: no mint, no write, no PRISM", async () => {
    const h = harness();
    const result = await runMakeContact(request({ value: "   " }), h.deps);
    expect(result).toEqual({ kind: "refused", reason: REFUSED_NAME });
    expect(h.pointers()).toBeNull();
    expect(h.artifacts).toEqual([]);
    expect(h.writes()).toBe(0);
  });

  test("an unanswerable canonicalization is refused the same way", async () => {
    const h = harness({ canonical: async () => null });
    const result = await runMakeContact(request(), h.deps);
    expect(result).toEqual({ kind: "refused", reason: REFUSED_REACH });
    expect(h.writes()).toBe(0);
  });

  test("the table refuses a url/at/none before anything happens", async () => {
    for (const form of ["url", "at"] as const) {
      const h = harness();
      const result = await runMakeContact(
        request({ form, value: form === "url" ? "https://example.org" : "/x" }),
        h.deps,
      );
      expect(result.kind).toBe("refused");
      if (result.kind !== "refused") throw new Error("unreachable");
      // The table's own sentence, never a bare refusal.
      expect(result.reason.length).toBeGreaterThan(0);
      expect(h.artifacts).toEqual([]);
      expect(h.writes()).toBe(0);
    }
  });

  test("two Makes append twice: file order, multiplicity, one append each", async () => {
    const h = harness();
    const first = await runMakeContact(request(), h.deps);
    const second = await runMakeContact(
      request({ value: "notes/second.md" }),
      h.deps,
    );
    if (first.kind !== "moved" || second.kind !== "moved") {
      throw new Error("unreachable");
    }
    const parsed = parsePrisms(h.prisms() as string);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.prisms).toHaveLength(2);
    expect(parsed.prisms.map((prism) => prism.id)).toEqual([
      "prism-1",
      "prism-2",
    ]);
    expect(h.writes()).toBe(2);
  });

  test("a hand log's exact bytes survive the append", async () => {
    const before = '{"a hand":"line"}\r\n';
    const h = harness({ before });
    await runMakeContact(request(), h.deps);
    const parsed = parsePrisms(h.prisms() as string);
    expect(parsed.prisms).toHaveLength(1);
    expect(parsed.malformed).toEqual(['{"a hand":"line"}']);
    expect(h.prisms()).toBe(
      before + serializePrismLine(parsed.prisms[0]) + "\n",
    );
  });
});

describe("Make: no accept gate, and an agent's Make is a ghost", () => {
  test("the flow has no proposal, pending state or approval step", () => {
    const flow = codeOnly(source("contacts/make.ts"));
    // The Move is the write: no gate vocabulary in the code path.
    expect(flow).not.toMatch(/\b(accept|accepted|accepting|approve|approval|proposal|propose|pending)\b/);
    // The person's press calls runMakeContact directly — no second step.
    expect(flow).toContain("export async function runMakeContact(");
    // No ghost machinery: an agent's Make would be a ghost; this is not it.
    expect(flow).not.toContain("ghost/");
    expect(flow).not.toContain("intake");
    // The table's actor is the person, by data.
    expect(findContact("make")?.actor).toBe("person");
  });

  test("the module doc says it in code: an agent's Make is a ghost", () => {
    const doc = source("contacts/make.ts");
    expect(doc).toMatch(/agent's Make is a\s+\*\s*a GHOST|An AGENT'S Make is a/i);
    // The person is the acceptor (the person-initiated Move).
    expect(doc).toMatch(/PERSON is the acceptor/i);
  });

  test("the flow writes no file itself: every byte goes through an injected dep", () => {
    const flow = source("contacts/make.ts");
    expect(flow).not.toContain("@tauri-apps");
    expect(flow).not.toContain("invoke(");
    expect(flow).not.toContain("readTextFile(");
    expect(flow).not.toContain("writeTextFile(");
    expect(flow).not.toContain("../lib/fs");
    // The boundary resolver and the record door are the only record layer.
    expect(flow).toContain("resolveWithin(");
    expect(flow).toContain("appendPrismLine(");
  });

  test("the artifact's write never passes through the canonicalising door", () => {
    const flow = codeOnly(source("contacts/make.ts"));
    // No serializer of any kind touches the artifact's text.
    for (const forbidden of [
      "serialize.ts",
      "canonicalJsonl",
      "canonicalYaml",
      "serializeReference",
      "serializeNote",
    ]) {
      expect({ forbidden, found: flow.includes(forbidden) }).toEqual({
        forbidden,
        found: false,
      });
    }
    // The MINT is the map's own canonical pointer record (its own door)...
    expect(flow).toContain("serializePointers(next, parsed.malformed)");
    // ...while the ARTIFACT's text goes straight to the raw bridge: no
    // serializer ever sees it.
    expect(flow).toContain("writeArtifact(resolved.path, request.text)");
    expect(flow).not.toContain("serializePointers(request.text");
    expect(flow).not.toContain("serializePointers(resolved.path");
    // ... and the app wires it to the RAW bridge itself, the Rust command
    // that writes the bytes as given.
    const wiring = source("contacts/prismLog.ts");
    expect(wiring).toContain(
      "writeArtifact: (path, text) => writeTextFile(path, text)",
    );
    expect(source("lib/fs.ts")).toContain('invoke("write_text_file"');
  });
});
