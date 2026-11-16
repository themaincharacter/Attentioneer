import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  appendPrismLine,
  BOUNDS_KEYS,
  CHANGE_KEYS,
  CHANGE_KINDS,
  CHANGE_OUTCOMES,
  CONTACT_KINDS,
  PRISM_KEYS,
  isChangeKind,
  isContactKind,
  mintPrismId,
  parsePrismChange,
  parsePrismLine,
  parsePrisms,
  prismKey,
  prismKeyOf,
  prismsPath,
  serializePrismLine,
  serializePrisms,
  type Change,
  type Prism,
} from "../src/map/prisms";
import { pointerKey } from "../src/map/pointers";

/**
 * Epic 12 story 1 — the PRISM record (ADR-0028 as amended; ADR-0029),
 * automated. `map/prisms.jsonl` is one APPENDED line per contact Move: the key
 * is anchor + contact + the pointer's natural key, never a dedupe; the Change
 * union is CLOSED with an outcome on every kind; the person's explanation is
 * verbatim and empty when absent; the family posture holds (unknown keys
 * preserved, malformed preserved AND surfaced, CRLF/BOM tolerated); and the key
 * set has no content slot anywhere.
 */

const X = pointerKey("rain", "path", "notes/x.md");
const Y = pointerKey("rain", "at", "/home/kick/notes/y.md");
const U = pointerKey("rain", "url", "https://example.org/a?b=c");

function look(overrides: Partial<Prism> = {}): Prism {
  return {
    id: "prism-1",
    on: "rain",
    contact: "look",
    pointer: { form: "path", value: "notes/x.md" },
    changes: [
      {
        kind: "read-head",
        pointer: X,
        outcome: "read",
        bounds: { maxLines: 20, maxBytes: 1600 },
        decode: "clean",
      },
    ],
    explanation: "",
    extra: {},
    ...overrides,
  };
}

/** One sample per Change shape, including every outcome. */
const CHANGES: Change[] = [
  {
    kind: "read-head",
    pointer: X,
    outcome: "read",
    bounds: { maxLines: 20, maxBytes: 1600 },
    decode: "clean",
  },
  {
    kind: "read-head",
    pointer: X,
    outcome: "read",
    bounds: { maxLines: 20, maxBytes: 1600 },
    decode: "with-replacement",
  },
  {
    kind: "read-head",
    pointer: X,
    outcome: "not-text",
    bounds: { maxLines: 20, maxBytes: 1600 },
    decode: null,
  },
  {
    kind: "read-head",
    pointer: Y,
    outcome: "cannot-reach",
    bounds: { maxLines: 20, maxBytes: 1600 },
    decode: null,
  },
  {
    kind: "read-head",
    pointer: X,
    outcome: "escaped",
    bounds: { maxLines: 20, maxBytes: 1600 },
    decode: null,
  },
  { kind: "mint-pointer", target: X, outcome: "minted" },
  { kind: "mint-pointer", target: X, outcome: "failed" },
  { kind: "write-text", pointer: X, outcome: "written", size: 42 },
  { kind: "write-text", pointer: X, outcome: "failed", size: 42 },
  { kind: "open-os", pointer: U, outcome: "handed" },
  { kind: "open-os", pointer: U, outcome: "handoff-failed" },
  { kind: "open-os", pointer: U, outcome: "refused" },
  {
    kind: "ask",
    pointer: X,
    outcome: "answered",
    included: [X, Y],
    responseSize: 120,
    decode: "clean",
  },
  {
    kind: "ask",
    pointer: null,
    outcome: "no-response",
    included: null,
    responseSize: null,
    decode: null,
  },
];

describe("one canonical line per Move, mark-shaped", () => {
  test("the look line is compact, sorted and carries the pointer's own fields", () => {
    const line = serializePrismLine(look());
    expect(line).toBe(
      '{"changes":[{"bounds":{"maxBytes":1600,"maxLines":20},"decode":"clean","kind":"read-head","outcome":"read","pointer":' +
        JSON.stringify(X) +
        '}],"contact":"look","explanation":"","id":"prism-1","on":"rain","path":"notes/x.md"}',
    );
    expect(line).not.toContain("\n");
  });

  test("a whole PRISM round-trips byte-for-byte", () => {
    const line = serializePrismLine(look());
    const parsed = parsePrismLine(line);
    expect(parsed).not.toBeNull();
    expect(parsed!.id).toBe("prism-1");
    expect(parsed!.on).toBe("rain");
    expect(parsed!.contact).toBe("look");
    expect(parsed!.pointer).toEqual({ form: "path", value: "notes/x.md" });
    expect(parsed!.changes).toEqual(look().changes);
    expect(parsed!.explanation).toBe("");
    expect(serializePrismLine(parsed!)).toBe(line);
  });

  test("the three pointer forms are the mark-shaped target fields", () => {
    for (const [form, value] of [
      ["path", "notes/x.md"],
      ["at", "/home/kick/notes/y.md"],
      ["url", "https://example.org/a?b=c"],
    ] as const) {
      const prism = look({ pointer: { form, value } });
      const parsed = parsePrismLine(serializePrismLine(prism))!;
      expect(parsed.pointer).toEqual({ form, value });
      expect(JSON.parse(serializePrismLine(prism))[form]).toBe(value);
    }
  });
});

describe("the closed Change-union, every kind with an outcome", () => {
  test("all five kinds are the closed vocabulary", () => {
    expect([...CHANGE_KINDS]).toEqual([
      "read-head",
      "mint-pointer",
      "write-text",
      "open-os",
      "ask",
    ]);
    for (const kind of CHANGE_KINDS) expect(isChangeKind(kind)).toBe(true);
    expect(isChangeKind("open-url")).toBe(false);
    expect(isChangeKind("")).toBe(false);
  });

  test("every sample Change parses and round-trips through a whole line", () => {
    for (const change of CHANGES) {
      const parsedChange = parsePrismChange(change);
      expect(parsedChange).toEqual(change);
      const prism = look({ id: "prism-x", changes: [change] });
      const line = serializePrismLine(prism);
      const parsed = parsePrismLine(line)!;
      expect(parsed.changes).toEqual([change]);
      expect(serializePrismLine(parsed)).toBe(line);
    }
  });

  test("the outcome lists are the closed lists, as data", () => {
    expect([...CHANGE_OUTCOMES["read-head"]]).toEqual([
      "read",
      "not-text",
      "cannot-reach",
      "escaped",
    ]);
    expect([...CHANGE_OUTCOMES["mint-pointer"]]).toEqual(["minted", "failed"]);
    expect([...CHANGE_OUTCOMES["write-text"]]).toEqual(["written", "failed"]);
    expect([...CHANGE_OUTCOMES["open-os"]]).toEqual([
      "handed",
      "handoff-failed",
      "refused",
    ]);
    expect([...CHANGE_OUTCOMES.ask]).toEqual(["answered", "no-response"]);
  });

  test("an outcome outside its kind's list refuses", () => {
    expect(
      parsePrismChange({ ...CHANGES[0], outcome: "opened" }),
    ).toBeNull();
    expect(
      parsePrismChange({ kind: "write-text", pointer: X, outcome: "wrote", size: 1 }),
    ).toBeNull();
    expect(
      parsePrismChange({ kind: "open-os", pointer: U, outcome: "opened" }),
    ).toBeNull();
    expect(
      parsePrismChange({
        kind: "ask",
        pointer: null,
        outcome: "asked",
        included: null,
        responseSize: null,
        decode: null,
      }),
    ).toBeNull();
  });

  test("the union is CLOSED: an unknown Change key makes the line malformed", () => {
    const withContent = { ...CHANGES[0], content: "the bytes" };
    expect(parsePrismChange(withContent)).toBeNull();
    const line = serializePrismLine(look()).replace(
      '"decode":"clean"',
      '"content":"the bytes","decode":"clean"',
    );
    expect(parsePrismLine(line)).toBeNull();
  });

  test("decode is said exactly when a read decoded text", () => {
    const refusalWithDecode = { ...CHANGES[2], decode: "clean" };
    expect(parsePrismChange(refusalWithDecode)).toBeNull();
    const readWithoutDecode = { ...CHANGES[0], decode: null };
    expect(parsePrismChange(readWithoutDecode)).toBeNull();
    const badDecode = { ...CHANGES[0], decode: "lossy" };
    expect(parsePrismChange(badDecode)).toBeNull();
  });

  test("an answered Ask carries its response facts; an unanswered one carries none", () => {
    expect(
      parsePrismChange({
        kind: "ask",
        pointer: null,
        outcome: "answered",
        included: null,
        responseSize: null,
        decode: null,
      }),
    ).toBeNull();
    expect(
      parsePrismChange({
        kind: "ask",
        pointer: null,
        outcome: "no-response",
        included: null,
        responseSize: 3,
        decode: "clean",
      }),
    ).toBeNull();
    // An empty inclusion list is a list (the empty fact is logged as null).
    const emptyIncluded = parsePrismChange({
      kind: "ask",
      pointer: null,
      outcome: "answered",
      included: [],
      responseSize: 0,
      decode: "clean",
    });
    expect(emptyIncluded).not.toBeNull();
  });

  test("the inclusion set is pointer KEYS, never bytes", () => {
    const ask = CHANGES[CHANGES.length - 2];
    expect(ask.kind).toBe("ask");
    if (ask.kind !== "ask") throw new Error("unreachable");
    expect(ask.included).toEqual([X, Y]);
    // The keys are the pointers' natural keys (on + form + value), not
    // content-derived sizes: nothing in the Change can hold a head.
    const line = serializePrismLine(look({ changes: [ask] }));
    expect(JSON.parse(line).changes[0].included).toEqual([X, Y]);
  });
});

describe("the key: anchor + contact + the pointer's natural key", () => {
  test("the key reads the pointer's natural key", () => {
    expect(prismKey(look())).toBe(prismKeyOf("rain", "look", look().pointer));
    expect(prismKey(look())).toContain(X);
  });

  test("a different anchor, contact, form or value is a different key", () => {
    const base = prismKey(look());
    expect(prismKey(look({ on: "sea" }))).not.toBe(base);
    expect(prismKey(look({ contact: "measure" }))).not.toBe(base);
    expect(
      prismKey(look({ pointer: { form: "at", value: "notes/x.md" } })),
    ).not.toBe(base);
    expect(
      prismKey(look({ pointer: { form: "path", value: "notes/z.md" } })),
    ).not.toBe(base);
  });

  test("a pointer-less Ask is keyed by its anchor and contact, with none", () => {
    const askPrism = look({
      contact: "ask",
      pointer: null,
      changes: [CHANGES[13]],
    });
    const key = prismKey(askPrism);
    expect(key).toContain("ask");
    expect(key).toContain("rain");
    expect(key).toContain("none");
    expect(prismKeyOf("rain", "ask", null)).toBe(key);
    expect(prismKeyOf("sea", "ask", null)).not.toBe(key);
  });

  test("the key NEVER dedupes: repeats append, nothing is merged", () => {
    const first = look({ id: "prism-1", explanation: "" });
    const second = look({ id: "prism-2", explanation: "looked again" });
    expect(prismKey(first)).toBe(prismKey(second));
    const bytes = serializePrisms([first, second]);
    expect(bytes.split("\n").filter((line) => line !== "")).toHaveLength(2);
    const parsed = parsePrisms(bytes);
    expect(parsed.prisms).toHaveLength(2);
    expect(parsed.prisms.map((prism) => prism.id)).toEqual([
      "prism-1",
      "prism-2",
    ]);
    expect(serializePrisms(parsed.prisms, parsed.malformed)).toBe(bytes);
  });
});

describe("the person's explanation is verbatim, empty when absent", () => {
  test("absent on a hand line reads empty and serializes empty", () => {
    const line = serializePrismLine(look()).replace('"explanation":"",', "");
    const parsed = parsePrismLine(line)!;
    expect(parsed.explanation).toBe("");
    expect(JSON.parse(serializePrismLine(parsed)).explanation).toBe("");
  });

  test("present prose is stored exactly — never trimmed or interpreted", () => {
    const prose = "  I looked because the plan said so.\n\t— me  ";
    const prism = look({ explanation: prose });
    const parsed = parsePrismLine(serializePrismLine(prism))!;
    expect(parsed.explanation).toBe(prose);
    expect(serializePrismLine(parsed)).toBe(serializePrismLine(prism));
  });

  test("a non-string explanation makes the line malformed", () => {
    const line = serializePrismLine(look()).replace(
      '"explanation":""',
      '"explanation":7',
    );
    expect(parsePrismLine(line)).toBeNull();
  });
});

describe("the family posture: unknown keys, malformed lines, CRLF/BOM", () => {
  test("unknown keys on a known line survive", () => {
    const prism = look({ extra: { note: "why", rank: 3 } });
    const line = serializePrismLine(prism);
    const parsed = parsePrismLine(line)!;
    expect(parsed.extra).toEqual({ note: "why", rank: 3 });
    expect(serializePrismLine(parsed)).toBe(line);
  });

  test("malformed and out-of-shape lines are preserved verbatim and surfaced", () => {
    const good = serializePrismLine(look());
    const bad = [
      "{bad json}",
      "[1,2]",
      '"a string"',
      '{"on":"rain","contact":"look"}',
      good.replace('"id":"prism-1"', '"id":""'),
      good.replace('"on":"rain"', '"on":""'),
      good.replace('"contact":"look"', '"contact":"peek"'),
      good.replace('"path":"notes/x.md"', '"path":"notes/x.md","url":"u"'),
      good.replace('"changes":[', '"changes":[],"junk":['),
      good.replace('"explanation":""', '"explanation":null'),
    ];
    const text = [bad[0], good, ...bad.slice(1)].join("\n");
    const parsed = parsePrisms(text);
    expect(parsed.prisms).toHaveLength(1);
    expect(parsed.malformed).toEqual(bad);
    // Known lines first (canonical), the preserved unknowns after them, in
    // their own order — the family's write posture.
    expect(serializePrisms(parsed.prisms, parsed.malformed)).toBe(
      [good, ...bad, ""].join("\n"),
    );
  });

  test("a line with no Changes is malformed (a Move is made of Changes)", () => {
    const line = serializePrismLine(look()).replace(
      /"changes":\[[^\]]*\]/,
      '"changes":[]',
    );
    expect(parsePrismLine(line)).toBeNull();
  });

  test("CRLF and a BOM are tolerated on read", () => {
    const line = serializePrismLine(look());
    const parsed = parsePrisms("\uFEFF" + line + "\r\n" + line + "\r\n");
    expect(parsed.malformed).toEqual([]);
    expect(parsed.prisms).toHaveLength(2);
  });

  test("a missing or empty file is no PRISMs, and serializes as empty JSONL", () => {
    expect(parsePrisms("")).toEqual({ prisms: [], malformed: [] });
    expect(parsePrisms("\n\n")).toEqual({ prisms: [], malformed: [] });
    expect(serializePrisms([])).toBe("\n");
    expect(prismsPath("/w")).toBe("/w/map/prisms.jsonl");
  });
});

describe("append-only, never merged", () => {
  test("appending to an empty file writes one canonical line", () => {
    expect(appendPrismLine(null, look())).toBe(serializePrismLine(look()) + "\n");
    expect(appendPrismLine("", look())).toBe(serializePrismLine(look()) + "\n");
  });

  test("a hand file without a trailing newline keeps every byte", () => {
    const before = '{"a hand":"line"}';
    expect(appendPrismLine(before, look())).toBe(
      before + "\n" + serializePrismLine(look()) + "\n",
    );
  });

  test("existing CRLF bytes survive an append (only the new line is canonical)", () => {
    const before = '{"a hand":"line"}\r\n';
    expect(appendPrismLine(before, look())).toBe(
      before + serializePrismLine(look()) + "\n",
    );
    expect(appendPrismLine(before, look()).startsWith(before)).toBe(true);
  });

  test("no merging rewrite exists: serialize keeps file order and multiplicity", () => {
    const first = look({ id: "prism-1" });
    const second = look({ id: "prism-2" });
    const bytes = serializePrisms([first, second, first]);
    expect(bytes.split("\n").filter((line) => line !== "")).toHaveLength(3);
    expect(parsePrisms(bytes).prisms.map((prism) => prism.id)).toEqual([
      "prism-1",
      "prism-2",
      "prism-1",
    ]);
  });
});

describe("no content slot, structurally", () => {
  const FORBIDDEN = [
    "content",
    "text",
    "head",
    "question",
    "answer",
    "body",
    "bytes",
  ];

  test("the declared key sets carry no content slot", () => {
    for (const key of PRISM_KEYS) expect(FORBIDDEN).not.toContain(key);
    for (const key of BOUNDS_KEYS) expect(FORBIDDEN).not.toContain(key);
    for (const kind of CHANGE_KINDS) {
      for (const key of CHANGE_KEYS[kind]) expect(FORBIDDEN).not.toContain(key);
    }
  });

  test("a record carrying every Change kind serializes no content key anywhere", () => {
    const prism = look({
      contact: "ask",
      changes: CHANGES,
      explanation: "mine",
    });
    const value = JSON.parse(serializePrismLine(prism));
    const keys = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node !== null && typeof node === "object") {
        for (const [key, child] of Object.entries(node)) {
          keys.add(key);
          walk(child);
        }
      }
    };
    walk(value);
    for (const forbidden of FORBIDDEN) expect([...keys]).not.toContain(forbidden);
    // The pointer's own value IS there — the citation inherits its sensitivity.
    expect(value.path).toBe("notes/x.md");
  });
});

const SRC = join(fileURLToPath(new URL("..", import.meta.url)), "src");

function source(rel: string): string {
  return readFileSync(join(SRC, rel), "utf8");
}

describe("transients mint no PRISM (the peek and the look-under are not Moves)", () => {
  // ADR-0028's transients amendment: a read-only transient (the peek; the
  // veil's look-under) is NOT a contact Move, so it imports no prism writer.
  const PRISM_WRITERS = [
    "appendPrismLine",
    "savePrisms",
    "serializePrismLine",
    "mintPrismId",
    "prismKey",
    "map/prisms",
  ];

  test("the peek and the look-under import no prism writer", () => {
    for (const file of [
      "canvas/OutwardWindow.tsx",
      "canvas/VeilLookUnder.tsx",
    ]) {
      const text = source(file);
      for (const writer of PRISM_WRITERS) expect(text).not.toContain(writer);
    }
  });

  test("the peek's and look-under's one-shot rules mint nothing either", () => {
    for (const file of [
      "canvas/outward.ts",
      "canvas/outwardRules.ts",
      "canvas/veilRules.ts",
    ]) {
      const text = source(file);
      for (const writer of PRISM_WRITERS) expect(text).not.toContain(writer);
    }
  });

  test("the peek is still the transient head read (nothing is written)", () => {
    const peek = source("canvas/OutwardWindow.tsx");
    expect(peek).toContain("readTextHead(");
    expect(peek).not.toContain("writeTextFile(");
    expect(peek).not.toContain("appendPrismLine(");
  });
});

describe("small vocabulary helpers", () => {
  test("the contact kinds are the four verbs", () => {
    expect([...CONTACT_KINDS]).toEqual(["look", "make", "measure", "ask"]);
    for (const kind of CONTACT_KINDS) expect(isContactKind(kind)).toBe(true);
    expect(isContactKind("peek")).toBe(false);
  });

  test("the app mints an id with the provisional prefix", () => {
    const first = mintPrismId();
    const second = mintPrismId();
    expect(first.startsWith("prism-")).toBe(true);
    expect(first).not.toBe(second);
    // An id is required on every line.
    const line = serializePrismLine(look()).replace('"id":"prism-1"', '"id":""');
    expect(parsePrismLine(line)).toBeNull();
  });
});
