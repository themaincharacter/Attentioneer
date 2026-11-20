import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACT_NAMES,
  ACT_SPECS,
  actsFromScript,
  CHANGE_MAP,
  COMMAND_MAPS,
  validateAct,
} from "../src/commands/acts";
import { executeScript, type CommandHost, type CommandOutcome } from "../src/commands/execute";

/**
 * STORY 21.1 — the act vocabulary and the executor, asserted WITHOUT an app.
 *
 * The story's point is that these two halves are PORTABLE (ADR-0038 §3): the
 * same vocabulary and the same executor run against a different app's adapter.
 * The first test below is that claim's proof; the rest pin the schema's
 * refusals and the executor's one rule — a script that is bad anywhere applies
 * NOTHING, and a host refusal stops the run where it happened.
 */

const APP_DIR = join(import.meta.dir, "..");

function source(rel: string): string {
  return readFileSync(join(APP_DIR, rel), "utf8");
}

/** Every module specifier a file imports, both `from "x"` and bare `"x"`. */
function importSpecifiers(text: string): string[] {
  const specifiers = new Set<string>();
  const from = /from\s+["']([^"']+)["']/g;
  for (let match = from.exec(text); match !== null; match = from.exec(text)) {
    specifiers.add(match[1]);
  }
  const bare = /^\s*import\s+["']([^"']+)["']/gm;
  for (let match = bare.exec(text); match !== null; match = bare.exec(text)) {
    specifiers.add(match[1]);
  }
  return [...specifiers];
}

describe("the portable half imports nothing app specific (ADR-0038 §3)", () => {
  const acts = source("src/commands/acts.ts");
  const execute = source("src/commands/execute.ts");

  test("acts.ts imports nothing at all", () => {
    expect(importSpecifiers(acts)).toEqual([]);
  });

  test("execute.ts imports only the vocabulary beside it", () => {
    expect(importSpecifiers(execute)).toEqual(["./acts"]);
  });

  test("neither file reaches into the map, the canvas, the turn, Tauri or React", () => {
    for (const text of [acts, execute]) {
      for (const forbidden of [
        "../map/",
        "../canvas/",
        "../turn/",
        "../ghost/",
        "@tauri-apps",
        "react",
      ]) {
        expect(text).not.toContain(forbidden);
      }
      expect(text).not.toContain("invoke(");
    }
  });
});

describe("the vocabulary is declared data (ADR-0038 §3)", () => {
  test("seventeen acts: five reads and twelve proposals (STORY 21.11 adds the session card's three)", () => {
    expect(ACT_NAMES).toEqual([
      "map_overview",
      "read_card",
      "read_wires",
      "read_words",
      "read_map",
      "propose_card",
      "propose_wire",
      "propose_note",
      "propose_ask",
      "propose_unwire",
      "propose_remove_note",
      "propose_remove_card",
      "propose_move",
      "propose_rename",
      "propose_session",
      "propose_bind_session",
      "propose_remove_session",
    ]);
    expect(ACT_SPECS.filter((spec) => spec.family === "read")).toHaveLength(5);
    expect(ACT_SPECS.filter((spec) => spec.family === "propose")).toHaveLength(12);
  });

  test("a READ may name any map; a CHANGE names the ground map alone (STORY 21.9)", () => {
    // Every map is readable...
    for (const map of COMMAND_MAPS) {
      const read = validateAct({ act: "read_map", map, payload: {} });
      expect(read.ok).toBe(true);
      if (read.ok) expect(read.act.map).toBe(map);
    }
    // ...and no map but the ground one may be changed: not even a proposal.
    for (const map of COMMAND_MAPS) {
      for (const spec of ACT_SPECS.filter((one) => one.family === "propose")) {
        const change = validateAct({
          act: spec.name,
          map,
          payload: {},
        });
        if (map === "ground") continue;
        expect(change.ok).toBe(false);
        if (change.ok) continue;
        // ONE sentence, and it says what the limitation is.
        expect(change.sentence).toContain("ground");
        expect(change.sentence.slice(0, -1)).not.toContain(".");
      }
    }
    expect(COMMAND_MAPS).toEqual(["ground", "concept", "dynamics"]);
    expect(COMMAND_MAPS).toContain(CHANGE_MAP);
  });

  test("every act declares whether it writes, and NONE does: a proposal is a ghost", () => {
    for (const spec of ACT_SPECS) {
      expect(spec.writes).toBe(false);
      expect(spec.description.length).toBeGreaterThan(20);
      expect(spec.description.endsWith(".")).toBe(true);
      for (const field of [...spec.required, ...spec.optional]) {
        expect(field.key).not.toBe("");
        // STORY 21.7 adds "texts": a list of named cards, for the ask's context.
        expect(["text", "number", "texts"]).toContain(field.type);
      }
    }
  });

  test("the never-list: no act names a key, a provider, a run or a send", () => {
    // STORY 21.6: REMOVAL is NOT on the never-list — a person can take a wire,
    // a note or a card back by hand, so the acts may propose it too. STORY 21.8:
    // a NAME is not on the never-list either, because the act PROPOSES it for
    // the person to accept (AGENTS.md's guardrail is the description's own
    // sentence, not an absent act). The safety list itself is unchanged.
    for (const name of ACT_NAMES) {
      expect(name).not.toMatch(/delete|key|provider|run|send|outside|settings/i);
    }
    // The one name-shaped act says it is a proposal, never an instruction.
    const rename = ACT_SPECS.find((spec) => spec.name === "propose_rename");
    expect(rename).toBeDefined();
    expect(rename!.description.toLowerCase()).toContain(
      "propose a name for the person to accept",
    );
    expect(rename!.description.toLowerCase()).not.toContain("rename");
    expect(ACT_NAMES.filter((name) => /^propose_(remove|unwire)/.test(name))).toEqual([
      "propose_unwire",
      "propose_remove_note",
      "propose_remove_card",
      // STORY 21.11 — the session card's own removal, one family over.
      "propose_remove_session",
    ]);
    // The absence is stated in the code, not left to a reader's guess.
    expect(source("src/commands/acts.ts")).toContain(
      "THE NEVER-LIST IS ABSENT BY CONSTRUCTION",
    );
  });
});

describe("validateAct: one sentence per bad act", () => {
  const good = (overrides: Record<string, unknown> = {}) => ({
    act: "propose_card",
    map: "ground",
    payload: { name: "rain gauge", x: 40, y: 60 },
    ...overrides,
  });

  test("a well-formed act is copied with only its declared keys", () => {
    const read = validateAct(good());
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.act.payload).toEqual({ name: "rain gauge", x: 40, y: 60 });
    expect(read.act.map).toBe("ground");
  });

  test("every refusal is ONE sentence", () => {
    const bad = [
      null,
      {},
      { act: "propose_card" },
      { act: "nope", map: "ground", payload: {} },
      good({ map: "concept" }),
      good({ payload: null }),
      good({ payload: { name: "rain gauge", x: 40 } }),
      good({ payload: { name: "rain gauge", x: 40, y: 60, extra: true } }),
      good({ payload: { name: "rain gauge", x: "40", y: 60 } }),
      good({ payload: { name: "  rain gauge ", x: 40, y: 60 } }),
      good({ payload: { name: "", x: 40, y: 60 } }),
      good({ payload: { name: "rain gauge", x: Number.POSITIVE_INFINITY, y: 60 } }),
    ];
    for (const raw of bad) {
      const read = validateAct(raw);
      expect(read.ok).toBe(false);
      if (read.ok) continue;
      expect(read.sentence.length).toBeGreaterThan(0);
      expect(read.sentence.endsWith(".")).toBe(true);
      // ONE sentence: no second terminator anywhere in the answer.
      expect(read.sentence.slice(0, -1)).not.toContain(".");
    }
  });

  test("an unknown act is refused BY NAME", () => {
    const read = validateAct({ act: "delete_card", map: "ground", payload: {} });
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.sentence).toContain("delete_card");
  });

  test("a note keeps its newlines, and a name may not carry edges", () => {
    const note = validateAct({
      act: "propose_note",
      map: "ground",
      payload: { card: "rain", note: "  line one\nline two\n" },
    });
    expect(note.ok).toBe(true);
    if (!note.ok) return;
    expect(note.act.payload.note).toBe("  line one\nline two\n");
  });
});

describe("actsFromScript: a list, a wrapper, or one act per line", () => {
  test("all three shapes read the same acts", () => {
    const one = { act: "read_wires", map: "ground", payload: {} };
    const two = { act: "map_overview", map: "ground", payload: {} };
    expect(actsFromScript(JSON.stringify([one, two]))).toEqual([one, two]);
    expect(actsFromScript(JSON.stringify({ acts: [one] }))).toEqual([one]);
    expect(actsFromScript(`${JSON.stringify(one)}\n# a note\n${JSON.stringify(two)}`)).toEqual([
      one,
      two,
    ]);
    expect(actsFromScript("")).toBeNull();
    expect(actsFromScript("not json")).toBeNull();
  });
});

describe("executeScript: whole-script validation, then order", () => {
  interface FakeHost {
    host: CommandHost;
    calls: string[];
    refuseWire: boolean;
  }

  function fakeHost(): FakeHost {
    const state = { calls: [] as string[], refuseWire: false };
    const answer = (line: string, id?: string): CommandOutcome => ({ ok: true, line, id });
    const host: CommandHost = {
      async readOverview() {
        state.calls.push("readOverview");
        return answer("overview");
      },
      async readCard(card) {
        state.calls.push(`readCard:${card}`);
        return answer(`card:${card}`);
      },
      async readWires() {
        state.calls.push("readWires");
        return answer("wires");
      },
      async readWords() {
        state.calls.push("readWords");
        return answer("words");
      },
      async readMap(map) {
        state.calls.push(`readMap:${map}`);
        return answer(`map:${map}`);
      },
      async proposeCard(payload) {
        state.calls.push(`proposeCard:${String(payload.name)}`);
        return answer(`card proposal ${String(payload.name)}`, "ghost-1");
      },
      async proposeWire() {
        state.calls.push("proposeWire");
        if (state.refuseWire) {
          return { ok: false, sentence: "the wire is refused." };
        }
        return answer("wire proposal", "ghost-2");
      },
      async proposeNote() {
        state.calls.push("proposeNote");
        return answer("note proposal", "ghost-3");
      },
      async proposeAsk() {
        state.calls.push("proposeAsk");
        return answer("ask proposal", "ghost-4");
      },
      async proposeUnwire() {
        state.calls.push("proposeUnwire");
        return answer("unwire proposal", "ghost-5");
      },
      async proposeRemoveNote() {
        state.calls.push("proposeRemoveNote");
        return answer("note removal", "ghost-6");
      },
      async proposeRemoveCard() {
        state.calls.push("proposeRemoveCard");
        return answer("card removal", "ghost-7");
      },
      async proposeMove() {
        state.calls.push("proposeMove");
        return answer("move proposal", "ghost-8");
      },
      async proposeRename() {
        state.calls.push("proposeRename");
        return answer("name proposal", "ghost-9");
      },
      // STORY 21.11 — the session card's three acts. The fake answers, and
      // nothing here starts a run: the host interface has no method for one.
      async proposeSession() {
        state.calls.push("proposeSession");
        return answer("session proposal", "ghost-10");
      },
      async proposeBindSession() {
        state.calls.push("proposeBindSession");
        return answer("session rebind proposal", "ghost-11");
      },
      async proposeRemoveSession() {
        state.calls.push("proposeRemoveSession");
        return answer("session removal", "ghost-12");
      },
    };
    return {
      host,
      get calls() {
        return state.calls;
      },
      get refuseWire() {
        return state.refuseWire;
      },
      set refuseWire(value: boolean) {
        state.refuseWire = value;
      },
    };
  }

  const script = [
    { act: "map_overview", map: "ground", payload: {} },
    { act: "propose_card", map: "ground", payload: { name: "one", x: 0, y: 0 } },
    { act: "propose_note", map: "ground", payload: { card: "rain", note: "words" } },
  ];

  test("a good script runs in order and reports its ghosts", async () => {
    const fake = fakeHost();
    const run = await executeScript(script, fake.host);
    expect(run.ok).toBe(true);
    expect(run.lines).toEqual([
      "overview",
      "card proposal one",
      "note proposal",
    ]);
    expect(run.ids).toEqual(["ghost-1", "ghost-3"]);
    expect(fake.calls).toEqual([
      "readOverview",
      "proposeCard:one",
      "proposeNote",
    ]);
  });

  test("a bad act ANYWHERE applies nothing at all", async () => {
    const fake = fakeHost();
    const broken = [...script, { act: "nope", map: "ground", payload: {} }];
    const run = await executeScript(broken, fake.host);
    expect(run.ok).toBe(false);
    expect(run.applied).toBe(0);
    expect(run.lines).toEqual([]);
    expect(run.sentence).toContain("nope");
    // The point: validation came first, so the host was never called.
    expect(fake.calls).toEqual([]);
  });

  test("a host refusal stops the run and applies nothing after it", async () => {
    const fake = fakeHost();
    fake.refuseWire = true;
    const withWire = [
      script[0],
      script[1],
      { act: "propose_wire", map: "ground", payload: { from: "a", to: "b" } },
      script[2],
    ];
    const run = await executeScript(withWire, fake.host);
    expect(run.ok).toBe(false);
    expect(run.applied).toBe(2);
    expect(run.lines).toEqual(["overview", "card proposal one"]);
    expect(run.sentence).toBe("the wire is refused.");
    expect(fake.calls).toEqual(["readOverview", "proposeCard:one", "proposeWire"]);
  });

  test("the two map reads dispatch with the map they name (STORY 21.9)", async () => {
    const fake = fakeHost();
    const run = await executeScript(
      [
        { act: "read_words", map: "concept", payload: {} },
        { act: "read_map", map: "dynamics", payload: {} },
        { act: "read_map", map: "ground", payload: {} },
      ],
      fake.host,
    );
    expect(run.ok).toBe(true);
    expect(run.lines).toEqual(["words", "map:dynamics", "map:ground"]);
    expect(fake.calls).toEqual(["readWords", "readMap:dynamics", "readMap:ground"]);
  });

  test("a script that is not a list is one sentence", async () => {
    const fake = fakeHost();
    const run = await executeScript({ act: "map_overview" }, fake.host);
    expect(run.ok).toBe(false);
    expect(run.sentence).toBe("a script is a list of acts.");
  });
});
