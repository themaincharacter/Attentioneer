import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HEAD_MAX_BYTES,
  HEAD_MAX_LINES,
} from "../src/lib/headBounds";
import type { HeadRefusal, TextHead } from "../src/lib/fs";
import {
  parsePrismChange,
  parsePrismLine,
  parsePrisms,
  prismsPath,
  serializePrismLine,
  type Prism,
} from "../src/map/prisms";
import { pointerKey } from "../src/map/pointers";
import {
  NO_HEAD_READ,
  READ_CONTACT_KINDS,
  readBoundsOf,
  refusalOutcome,
  runReadContact,
  type ReadContactDeps,
  type ReadContactRequest,
} from "../src/contacts/read";

/**
 * Epic 12 story 2 — the read path (Look and Measure), automated.
 *
 * Look and Measure are the SAME closed Change (read-head); the verb is on the
 * PRISM header. One Move = one appended PRISM. This file asserts, through
 * injected bridges and no Tauri runtime:
 * - the bounds are said exactly (the window's caps, whatever the outcome);
 * - the decode is said (clean / with-replacement) and a refusal decodes
 *   nothing;
 * - the typed refusals: not-text (binary), escaped (the boundary layer, before
 *   the bridge is called), cannot-reach (dangling / unanswerable), with the
 *   bridge's io collapsed into cannot-reach (the union is closed);
 * - MEASURE's declared facts (size, mtime) are PASTED from the head read into
 *   the bounds — never computed, counted, summed or rounded;
 * - a table refusal is not a Move (no read, no PRISM), and a url Look is the
 *   egress story's open-os, not a head read;
 * - no content byte ever reaches the log.
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

/** A head as the bridge declares it (size/mtime are the DECLARED facts). */
function head(overrides: Partial<TextHead> = {}): TextHead {
  return {
    head: "the world's own bytes",
    truncated: false,
    exists: true,
    size: 1234,
    mtime: 1763000000123,
    decode: "clean",
    ...overrides,
  };
}

function refusal(code: HeadRefusal["code"]): HeadRefusal {
  return { code, detail: null };
}

interface Harness {
  deps: ReadContactDeps;
  /** Every head read the bridge answered, in order. */
  calls: { path: string; maxLines: number; maxBytes: number }[];
  /** The PRISM file's bytes as they stand now. */
  text: () => string | null;
  /** How many writes the flow made (one per Move, never more). */
  writes: () => number;
}

function harness(
  script:
    | { result: TextHead; refusal?: undefined }
    | { result?: undefined; refusal: unknown },
  before: string | null = null,
): Harness {
  const calls: Harness["calls"] = [];
  let written = before;
  let writes = 0;
  let minted = 0;
  const deps: ReadContactDeps = {
    // The tests' realpath is lexical in the boundary's own tests; here the
    // resolver's escape rule only needs a path carrying two dots to stay one.
    canonicalize: async (path) => path,
    readHead: async (path, maxLines, maxBytes) => {
      calls.push({ path, maxLines, maxBytes });
      if (script.refusal !== undefined) throw script.refusal;
      return script.result as TextHead;
    },
    readPrismsText: async () => written,
    writePrismsText: async (text) => {
      written = text;
      writes += 1;
    },
    mintId: () => {
      minted += 1;
      return "prism-" + minted;
    },
  };
  return {
    deps,
    calls,
    text: () => written,
    writes: () => writes,
  };
}

function request(
  overrides: Partial<ReadContactRequest> = {},
): ReadContactRequest {
  return {
    on: "rain",
    contact: "look",
    form: "path",
    value: "notes/x.md",
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

const X = pointerKey("rain", "path", "notes/x.md");

describe("Look: one bounded head read, and everything said exactly", () => {
  test("a clean read appends ONE PRISM: exact bounds, decode, citation", async () => {
    const h = harness({ result: head() });
    const result = await runReadContact(request(), h.deps);

    expect(result.kind).toBe("moved");
    if (result.kind !== "moved") throw new Error("unreachable");
    const prism = result.prism;

    // The bridge was asked exactly the window's caps, on the resolved path.
    expect(h.calls).toEqual([
      { path: "/ws/notes/x.md", maxLines: HEAD_MAX_LINES, maxBytes: HEAD_MAX_BYTES },
    ]);
    expect(h.writes()).toBe(1);

    expect(prism.id).toBe("prism-1");
    expect(prism.on).toBe("rain");
    expect(prism.contact).toBe("look");
    expect(prism.pointer).toEqual({ form: "path", value: "notes/x.md" });
    expect(prism.explanation).toBe("");
    expect(prism.changes).toEqual([
      {
        kind: "read-head",
        pointer: X,
        outcome: "read",
        bounds: { maxLines: HEAD_MAX_LINES, maxBytes: HEAD_MAX_BYTES },
        decode: "clean",
      },
    ]);
    // A Look's bounds carry the caps ONLY: no declared facts.
    const bounds = prism.changes[0].kind === "read-head" ? prism.changes[0].bounds : null;
    expect(bounds).not.toBeNull();
    expect(Object.keys(bounds as object).sort()).toEqual(["maxBytes", "maxLines"]);

    // The file holds that one canonical line and nothing else.
    expect(h.text()).toBe(serializePrismLine(prism) + "\n");
    expect(parsePrismLine(serializePrismLine(prism))).toEqual(prism);
  });

  test("a lossy decode is SAID, never hidden", async () => {
    const h = harness({ result: head({ decode: "with-replacement" }) });
    const result = await runReadContact(request(), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    const change = result.prism.changes[0];
    expect(change.kind === "read-head" && change.decode).toBe("with-replacement");
    expect(only(h.text()).changes[0]).toEqual(change);
  });

  test("a binary refuses not-text: a typed outcome, nothing decoded", async () => {
    const h = harness({ refusal: refusal("not-text") });
    const result = await runReadContact(request(), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.prism.changes).toEqual([
      {
        kind: "read-head",
        pointer: X,
        outcome: "not-text",
        bounds: { maxLines: HEAD_MAX_LINES, maxBytes: HEAD_MAX_BYTES },
        decode: null,
      },
    ]);
    // The typed code is the log; the bridge's OS words never enter it.
    expect(h.text()).not.toContain("not a text file");
    expect(h.text()).not.toContain("detail");
  });

  test("an escape refuses ESCAPED before the bridge is called", async () => {
    const h = harness({ result: head() });
    const result = await runReadContact(
      request({ value: "../outside/x.md" }),
      h.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(h.calls).toEqual([]);
    expect(result.prism.changes[0]).toMatchObject({
      kind: "read-head",
      outcome: "escaped",
      decode: null,
    });
    expect(only(h.text()).changes[0]).toMatchObject({ outcome: "escaped" });
  });

  test("an unanswerable canonicalization is cannot-reach", async () => {
    const h = harness({ result: head() });
    const deps: ReadContactDeps = {
      ...h.deps,
      canonicalize: async () => null,
    };
    const result = await runReadContact(request(), deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(h.calls).toEqual([]);
    expect(result.prism.changes[0]).toMatchObject({
      outcome: "cannot-reach",
      decode: null,
    });
  });

  test("a dangling at target is cannot-reach and the path is passed verbatim", async () => {
    const h = harness({
      result: head({ exists: false, head: "", size: null, mtime: null }),
    });
    // The at form is the authored machine-local exception: the resolver is
    // never called (a canonicalizer that throws would fail this test).
    const deps: ReadContactDeps = {
      ...h.deps,
      canonicalize: async () => {
        throw new Error("the at form must not enter the boundary resolver");
      },
    };
    const result = await runReadContact(
      request({ form: "at", value: "/home/kick/notes/y.md" }),
      deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(h.calls).toEqual([
      {
        path: "/home/kick/notes/y.md",
        maxLines: HEAD_MAX_LINES,
        maxBytes: HEAD_MAX_BYTES,
      },
    ]);
    expect(result.prism.changes[0]).toMatchObject({
      outcome: "cannot-reach",
      decode: null,
    });
  });

  test("the bridge's io is said as cannot-reach (the union is closed)", async () => {
    const h = harness({ refusal: refusal("io") });
    const result = await runReadContact(request(), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.prism.changes[0]).toMatchObject({
      outcome: "cannot-reach",
      decode: null,
    });
    expect(refusalOutcome(refusal("io"))).toBe("cannot-reach");
    expect(refusalOutcome(refusal("not-text"))).toBe("not-text");
    expect(refusalOutcome(refusal("escaped"))).toBe("escaped");
    expect(refusalOutcome(new Error("boom"))).toBe("cannot-reach");
  });

  test("an untyped rejection is fail-closed cannot-reach", async () => {
    const h = harness({ refusal: new Error("boom") });
    const result = await runReadContact(request(), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.prism.changes[0]).toMatchObject({ outcome: "cannot-reach" });
  });

  test("the read contacts and the default bounds are the window's caps", () => {
    expect([...READ_CONTACT_KINDS]).toEqual(["look", "measure"]);
    expect(readBoundsOf()).toEqual({
      maxLines: HEAD_MAX_LINES,
      maxBytes: HEAD_MAX_BYTES,
    });
    // Declared facts are never accepted from the caller: the caps are copied.
    expect(
      readBoundsOf({ maxLines: 1, maxBytes: 2, size: 9, mtime: 9 }),
    ).toEqual({ maxLines: 1, maxBytes: 2 });
  });
});

describe("Measure: the head's DECLARED facts, pasted (never computed)", () => {
  test("a measure logs the same read-head Change with size/mtime in bounds", async () => {
    const declared = head({ size: 7, mtime: 1763000000123, decode: "clean" });
    const h = harness({ result: declared });
    const result = await runReadContact(
      request({ contact: "measure" }),
      h.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");

    // The contact kind is on the PRISM header; the Change kind is the same one.
    expect(result.prism.contact).toBe("measure");
    expect(result.prism.changes).toHaveLength(1);
    expect(result.prism.changes[0]).toEqual({
      kind: "read-head",
      pointer: pointerKey("rain", "path", "notes/x.md"),
      outcome: "read",
      bounds: {
        maxLines: HEAD_MAX_LINES,
        maxBytes: HEAD_MAX_BYTES,
        size: 7,
        mtime: 1763000000123,
      },
      decode: "clean",
    });
    // The facts are the head's, pasted exactly — not a rounded or derived form.
    const change = result.prism.changes[0];
    if (change.kind !== "read-head") throw new Error("unreachable");
    expect(change.bounds.size).toBe(declared.size);
    expect(change.bounds.mtime).toBe(declared.mtime);
    // Same read: the caps are the Look's caps.
    expect(h.calls).toEqual([
      { path: "/ws/notes/x.md", maxLines: HEAD_MAX_LINES, maxBytes: HEAD_MAX_BYTES },
    ]);
    expect(only(h.text()).changes[0]).toEqual(change);
  });

  test("a measure on a refusal carries NO declared facts (bounds stay caps)", async () => {
    const h = harness({ refusal: refusal("not-text") });
    const result = await runReadContact(
      request({ contact: "measure" }),
      h.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    const change = result.prism.changes[0];
    if (change.kind !== "read-head") throw new Error("unreachable");
    expect(Object.keys(change.bounds).sort()).toEqual(["maxBytes", "maxLines"]);
    expect(change.outcome).toBe("not-text");
    expect(change.decode).toBeNull();
  });

  test("a measure of an absent file is cannot-reach, no facts", async () => {
    const h = harness({
      result: head({ exists: false, head: "", size: null, mtime: null }),
    });
    const result = await runReadContact(
      request({ contact: "measure" }),
      h.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    const change = result.prism.changes[0];
    if (change.kind !== "read-head") throw new Error("unreachable");
    expect(change.outcome).toBe("cannot-reach");
    expect(Object.keys(change.bounds).sort()).toEqual(["maxBytes", "maxLines"]);
  });

  test("the declared facts are a PAIR in the bounds; a lone one is malformed", () => {
    const change = {
      kind: "read-head" as const,
      pointer: X,
      outcome: "read" as const,
      bounds: {
        maxLines: HEAD_MAX_LINES,
        maxBytes: HEAD_MAX_BYTES,
        size: 7 as number | null,
        mtime: null as number | null,
      },
      decode: "clean" as const,
    };
    // Both facts together parse exactly; nulls are honest "unknown" values.
    expect(parsePrismChange(change)).toEqual(change);
    expect(
      parsePrismChange({
        ...change,
        bounds: { ...change.bounds, size: null, mtime: null },
      }),
    ).not.toBeNull();
    // A lone size (or a lone mtime) is malformed, never guessed at.
    expect(
      parsePrismChange({
        ...change,
        bounds: {
          maxLines: HEAD_MAX_LINES,
          maxBytes: HEAD_MAX_BYTES,
          size: 7,
        },
      }),
    ).toBeNull();
    expect(
      parsePrismChange({
        ...change,
        bounds: {
          maxLines: HEAD_MAX_LINES,
          maxBytes: HEAD_MAX_BYTES,
          mtime: null,
        },
      }),
    ).toBeNull();
    // The bounds' key set stays closed: an unknown key refuses.
    expect(
      parsePrismChange({
        ...change,
        bounds: { ...change.bounds, content: "the bytes" },
      }),
    ).toBeNull();
  });

  test("the flow PASTES head.size/head.mtime and computes nothing", () => {
    const flow = codeOnly(source("contacts/read.ts"));
    expect(flow).toContain("size: head.size");
    expect(flow).toContain("mtime: head.mtime");
    // No derived number, no summary, no count, no formatting of the facts.
    expect(flow).not.toMatch(/\b(sum|total|average|count|counts|reduce)\b/i);
    expect(flow).not.toContain(".reduce(");
    expect(flow).not.toContain("Math.");
    expect(flow).not.toContain("toISOString");
    expect(flow).not.toContain("formatSize");
    // The contact kind is the PRISM header, never a Change kind.
    expect(flow).toContain("contact: request.contact");
  });
});

describe("the contact table answers first: a refusal is not a Move", () => {
  test("a measure on a url is refused by the table: no read, no PRISM", async () => {
    const h = harness({ result: head() });
    const result = await runReadContact(
      request({ contact: "measure", form: "url", value: "https://example.org" }),
      h.deps,
    );
    expect(result.kind).toBe("refused");
    if (result.kind !== "refused") throw new Error("unreachable");
    expect(result.reason).toContain("URL");
    expect(h.calls).toEqual([]);
    expect(h.writes()).toBe(0);
    expect(h.text()).toBeNull();
  });

  test("a look on a url is not a head read (the egress story's open-os)", async () => {
    const h = harness({ result: head() });
    const result = await runReadContact(
      request({ form: "url", value: "https://example.org" }),
      h.deps,
    );
    expect(result).toEqual({ kind: "refused", reason: NO_HEAD_READ });
    expect(h.calls).toEqual([]);
    expect(h.writes()).toBe(0);
  });
});

describe("one Move, one appended PRISM — and never a content byte", () => {
  test("the head's bytes never reach the log", async () => {
    const h = harness({
      result: head({ head: "SECRET WORLD BYTES", decode: "with-replacement" }),
    });
    const result = await runReadContact(request(), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(h.text()).not.toContain("SECRET");
    for (const key of ["content", "text", "head", "body", "bytes"]) {
      expect(h.text()).not.toContain('"' + key + '"');
    }
    // The pointer's authored value IS the citation (inherits its sensitivity).
    expect(h.text()).toContain("notes/x.md");
    expect(result.prism.changes[0].kind).toBe("read-head");
  });

  test("two Moves append twice: file order and multiplicity, never merged", async () => {
    const h = harness({ result: head() });
    const first = await runReadContact(request(), h.deps);
    const second = await runReadContact(request(), h.deps);
    if (first.kind !== "moved" || second.kind !== "moved") {
      throw new Error("unreachable");
    }
    const parsed = parsePrisms(h.text() as string);
    expect(parsed.malformed).toEqual([]);
    expect(parsed.prisms).toHaveLength(2);
    expect(parsed.prisms.map((prism) => prism.id)).toEqual([
      "prism-1",
      "prism-2",
    ]);
    // The key repeats (same anchor/contact/pointer); the lines do not merge.
    expect(parsed.prisms[0].on).toBe(parsed.prisms[1].on);
  });

  test("the append preserves a hand file's exact bytes", async () => {
    const before = '{"a hand":"line"}\r\n';
    const h = harness({ result: head() }, before);
    await runReadContact(request(), h.deps);
    const parsed = parsePrisms(h.text() as string);
    expect(parsed.prisms).toHaveLength(1);
    expect(parsed.malformed).toEqual(['{"a hand":"line"}']);
    expect(h.text()).toBe(
      before + serializePrismLine(parsed.prisms[0]) + "\n",
    );
  });

  test("the flow is pure by injection: no Tauri runtime, no filesystem I/O", () => {
    const flow = source("contacts/read.ts");
    expect(flow).not.toContain("@tauri-apps");
    expect(flow).not.toContain("invoke(");
    expect(flow).not.toMatch(/import\s*\{[^}]*\}\s*from\s*"\.\.\/lib\/fs"/);
    expect(flow).toContain('import type { HeadRefusal, TextHead } from "../lib/fs"');
    expect(flow).not.toContain("readTextFile(");
    expect(flow).not.toContain("writeTextFile(");
    expect(flow).not.toContain("readTextHead(");
    // The boundary resolver is the one layer, and it is called.
    expect(flow).toContain("resolveWithin(");
    expect(flow).toContain("appendPrismLine(");
    expect(prismsPath("/w")).toBe("/w/map/prisms.jsonl");
  });
});
