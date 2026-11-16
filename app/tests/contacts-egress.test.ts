import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { pointerKey } from "../src/map/pointers";
import {
  OPEN_OS_OUTCOMES,
  parsePrisms,
  serializePrismLine,
  type Prism,
} from "../src/map/prisms";
import {
  EGRESS_IS_URL_ONLY,
  runEgressContact,
  type EgressContactDeps,
  type EgressContactRequest,
} from "../src/contacts/egress";
import { OUTCOME_WORDS } from "../src/canvas/prismRules";
import { CONTACT_WORDS } from "../src/canvas/prismRules";

/**
 * Epic 12 story 3 — OPEN-OS, the OS handoff, automated.
 *
 * The app hands an address to the OS and knows only that much, so the closed
 * outcome vocabulary is handed / handoff-failed / refused and the log NEVER
 * says "opened". This file asserts, through an injected handoff and no Tauri
 * runtime:
 * - a successful handoff logs "handed" and hands the url over VERBATIM;
 * - a rejected handoff logs "handoff-failed";
 * - a scheme outside the capability's surfaces logs "refused" and never calls
 *   the OS at all;
 * - the word "opened" appears nowhere: not in the log, not in the vocabulary,
 *   not in the flow's code;
 * - a table refusal (a contact that does not egress, a local-file reach) is
 *   not a Move: nothing leaves, nothing is appended;
 * - one Move = one appended PRISM, append-only.
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
const URL_VALUE = "https://example.org/a-page";
const KEY = pointerKey(ON, "url", URL_VALUE);

interface Harness {
  deps: EgressContactDeps;
  /** Every url the handoff bridge was given, in order. */
  handed: string[];
  prisms: () => string | null;
  writes: () => number;
}

function harness(
  options: { reject?: boolean; before?: string | null } = {},
): Harness {
  let prisms = options.before ?? null;
  let writes = 0;
  let minted = 0;
  const handed: string[] = [];
  const deps: EgressContactDeps = {
    handOff: async (url) => {
      if (options.reject === true) throw new Error("no handler");
      handed.push(url);
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
  return { deps, handed, prisms: () => prisms, writes: () => writes };
}

function request(
  overrides: Partial<EgressContactRequest> = {},
): EgressContactRequest {
  return {
    on: ON,
    contact: "look",
    form: "url",
    value: URL_VALUE,
    workspacePath: "/ws",
    ...overrides,
  };
}

function only(text: string | null): Prism {
  expect(text).not.toBeNull();
  const parsed = parsePrisms(text as string);
  expect(parsed.malformed).toEqual([]);
  expect(parsed.prisms).toHaveLength(1);
  return parsed.prisms[0];
}

describe("open-os: the handoff, and the outcome the app can claim", () => {
  test("a successful handoff logs HANDED (and hands the url over verbatim)", async () => {
    const h = harness();
    const result = await runEgressContact(request(), h.deps);
    expect(result.kind).toBe("moved");
    if (result.kind !== "moved") throw new Error("unreachable");

    expect(h.handed).toEqual([URL_VALUE]);
    expect(result.prism.contact).toBe("look");
    expect(result.prism.pointer).toEqual({ form: "url", value: URL_VALUE });
    expect(result.prism.changes).toEqual([
      { kind: "open-os", pointer: KEY, outcome: "handed" },
    ]);
    expect(h.writes()).toBe(1);
    expect(h.prisms()).toBe(serializePrismLine(result.prism) + "\n");
    expect(only(h.prisms()).changes[0]).toMatchObject({ outcome: "handed" });
  });

  test("a rejected handoff logs handoff-failed", async () => {
    const h = harness({ reject: true });
    const result = await runEgressContact(request(), h.deps);
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(result.prism.changes).toEqual([
      { kind: "open-os", pointer: KEY, outcome: "handoff-failed" },
    ]);
    expect(h.writes()).toBe(1);
    expect(only(h.prisms()).changes[0]).toMatchObject({
      outcome: "handoff-failed",
    });
  });

  test("an unsupported scheme is REFUSED before the OS is called", async () => {
    const h = harness();
    const result = await runEgressContact(
      request({ value: "obsidian://open?vault=notes" }),
      h.deps,
    );
    if (result.kind !== "moved") throw new Error("unreachable");
    expect(h.handed).toEqual([]);
    expect(result.prism.changes).toEqual([
      {
        kind: "open-os",
        pointer: pointerKey(ON, "url", "obsidian://open?vault=notes"),
        outcome: "refused",
      },
    ]);
    // It is still a Move: the person pressed the gesture; the log says refused.
    expect(h.writes()).toBe(1);
  });

  test("the outcomes are the closed three, in table order", () => {
    expect([...OPEN_OS_OUTCOMES]).toEqual([
      "handed",
      "handoff-failed",
      "refused",
    ]);
  });
});

describe("the log says HANDED, never opened", () => {
  test("the appended line carries handed and no claim to have opened", async () => {
    const h = harness();
    await runEgressContact(request(), h.deps);
    const text = (h.prisms() as string).toLowerCase();
    expect(text).toContain("handed");
    expect(text).not.toContain("opened");
    expect(text).not.toContain("opening");
    expect(text).not.toContain("launched");
  });

  test("the window's outcome words never say opened either", () => {
    const words = [
      ...Object.keys(OUTCOME_WORDS),
      ...Object.values(OUTCOME_WORDS),
      ...Object.values(CONTACT_WORDS),
    ]
      .join(" ")
      .toLowerCase();
    expect(words).toContain("handed");
    expect(words).toContain("handoff failed");
    expect(words).not.toContain("opened");
  });

  test("the flow, its rules and the wiring never write the word", () => {
    const surfaces = [
      codeOnly(source("contacts/egress.ts")),
      codeOnly(source("contacts/prismLog.ts")),
      codeOnly(source("canvas/contactRules.ts")),
      codeOnly(source("canvas/AskPanel.tsx")),
      codeOnly(source("contacts/ask.ts")),
    ];
    for (const code of surfaces) {
      expect(code.toLowerCase()).not.toContain("opened");
    }
  });
});

describe("the table answers first: a refusal is not a Move", () => {
  test("a contact whose row emits no open-os cannot egress", async () => {
    const h = harness();
    const result = await runEgressContact(
      request({ contact: "make" }),
      h.deps,
    );
    expect(result.kind).toBe("refused");
    expect(h.handed).toEqual([]);
    expect(h.writes()).toBe(0);
    expect(h.prisms()).toBeNull();
  });

  test("a local-file reach is the window's open, not this egress", async () => {
    for (const form of ["path", "at"] as const) {
      const h = harness();
      const result = await runEgressContact(
        request({ form, value: "notes/x.md" }),
        h.deps,
      );
      expect(result).toEqual({ kind: "refused", reason: EGRESS_IS_URL_ONLY });
      expect(h.handed).toEqual([]);
      expect(h.writes()).toBe(0);
    }
  });

  test("an ask row cannot hand off (its own contact logs the question)", async () => {
    const h = harness();
    const result = await runEgressContact(
      request({ contact: "ask" }),
      h.deps,
    );
    expect(result.kind).toBe("refused");
    expect(h.writes()).toBe(0);
  });
});

describe("one Move, one appended PRISM — append-only", () => {
  test("two handoffs append twice, never merged", async () => {
    const h = harness();
    await runEgressContact(request(), h.deps);
    await runEgressContact(request(), h.deps);
    const parsed = parsePrisms(h.prisms() as string);
    expect(parsed.prisms).toHaveLength(2);
    expect(parsed.prisms.map((prism) => prism.id)).toEqual([
      "prism-1",
      "prism-2",
    ]);
    // The same reach twice: the key repeats, the lines do not merge.
    expect(h.handed).toEqual([URL_VALUE, URL_VALUE]);
  });

  test("a hand log's exact bytes survive the append", async () => {
    const before = '{"a hand":"line"}\r\n';
    const h = harness({ before });
    await runEgressContact(request(), h.deps);
    const parsed = parsePrisms(h.prisms() as string);
    expect(parsed.malformed).toEqual(['{"a hand":"line"}']);
    expect(h.prisms()).toBe(
      before + serializePrismLine(parsed.prisms[0]) + "\n",
    );
  });

  test("the flow imports no Tauri runtime and does no filesystem I/O", () => {
    const flow = source("contacts/egress.ts");
    expect(flow).not.toContain("@tauri-apps");
    expect(flow).not.toContain("invoke(");
    expect(flow).not.toContain("readTextFile(");
    expect(flow).not.toContain("writeTextFile(");
    // The OS handoff is an injected dep; the app wires it through the app's
    // ONE opener door (never a Rust-side bypass).
    const wiring = source("contacts/prismLog.ts");
    expect(wiring).toContain("openOutward(");
    expect(wiring).toContain("handOff: handOffUrl");
    expect(source("canvas/outward.ts")).toContain(
      'from "@tauri-apps/plugin-opener"',
    );
  });
});
