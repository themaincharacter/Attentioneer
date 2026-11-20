import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ACT_SPECS,
  CHANGE_MAP,
  COMMAND_MAPS,
  MAP_READ_ACTS,
  validateAct,
} from "../src/commands/acts";
import {
  buildInterpreterPrompt,
  INTERPRETER_FENCE,
  INTERPRETER_GROUND_ONLY_SENTENCE,
  INTERPRETER_NO_QUESTION_SENTENCE,
  parseInterpreterAnswer,
  readForMap,
} from "../src/commands/interpreter";
import { interpretInstruction, type InterpreterMove } from "../src/commands/interpreterCall";
import {
  conceptDigest,
  dynamicsDigest,
  INTERPRETER_DIGEST_ITEMS_OMITTED_SENTENCE,
  INTERPRETER_DIGEST_MAX_CARDS,
  INTERPRETER_DIGEST_NO_SET_SENTENCE,
  INTERPRETER_DIGEST_OMITTED_SENTENCE,
  INTERPRETER_DIGEST_WORDS_OMITTED_SENTENCE,
  interpreterDigest,
  interpreterDigestOf,
} from "../src/commands/interpreterDigest";
import {
  createAttentioneerHost,
} from "../src/commands/attentioneerHost";
import { executeScript } from "../src/commands/execute";
import type { AskCard } from "../src/map/asks";
import type { GroundReference } from "../src/map/ground";
import type { GroundLink } from "../src/map/groundLinks";
import type { Reading } from "../src/map/readings";
import type { SessionCard } from "../src/map/sessions";
import { nodeCommandIo } from "../scripts/commands";

/**
 * STORY 21.9 — THE COMMAND CARD CAN SEE EVERY MAP (ADR-0038's 2026-11-20
 * amendment: the card is a PRIMARY way to use the app and it stands on every
 * map). Asserted here without a window and without a network:
 *
 *   - a concept digest lists the words by NAME and carries no memory;
 *   - a dynamics digest lists that map's own records by kind, with no claim's
 *     words and no amount value;
 *   - the GROUND digest is byte-identical to the one this story started with
 *     (the golden line below was produced by the untouched composer);
 *   - a change instruction on another map proposes NOTHING and says why, while
 *     a read on that map still runs;
 *   - bounds drop WHOLE items behind ONE sentence on every map;
 *   - and NOT ONE write act exists for the other maps (not even a proposal).
 */

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-every-map-"));

afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

const FENCE_OPEN = "```";

function block(acts: unknown): string {
  return (
    "Here is the script." +
    "\n\n" +
    FENCE_OPEN +
    INTERPRETER_FENCE +
    "\n" +
    JSON.stringify(acts) +
    "\n" +
    FENCE_OPEN +
    "\n"
  );
}

/* ------------------------------------------------------------------ *
 * THE GROUND DIGEST IS UNCHANGED
 * ------------------------------------------------------------------ */

const GROUND_REFERENCES: GroundReference[] = [
  { on: "rain", name: "rain", x: 0, y: 0 },
  { on: "soil", name: "soil", x: 120, y: 60 },
];
const GROUND_ASKS: AskCard[] = [
  { on: "why-rain", name: "why rain", x: 200, y: 0 },
];
const GROUND_SESSIONS: SessionCard[] = [
  { on: "run-one", name: "run one", x: 200, y: 120, tool: "tool-one" },
];
const GROUND_READINGS: Reading[] = [
  {
    on: "rain",
    form: "url",
    from: "https://example.test/weather/the-gauge",
    taken: "2026-11-20T00:00:00Z",
    extract: "page",
  },
];
const GROUND_LINKS: GroundLink[] = [{ from: "rain", to: "soil" }];

function groundDigestInput() {
  return {
    references: GROUND_REFERENCES,
    asks: GROUND_ASKS,
    sessions: GROUND_SESSIONS,
    readings: GROUND_READINGS,
    links: GROUND_LINKS,
    states: { rain: "current", soil: "unread" } as Record<string, "current" | "unread">,
  };
}

/**
 * THE BYTES THE GROUND MAP PRODUCED BEFORE THIS STORY (produced by running the
 * untouched composer at `dedaeb4`). This literal is the proof that 21.9 changed
 * nothing a ground instruction is read against.
 */
const GROUND_GOLDEN = [
  '- "rain" — reference — a page at example.test — current — wires: "soil"',
  '- "soil" — reference — no reading yet — unread — wires: "rain"',
  '- "why rain" — ask — an ask card — no wires',
  '- "run one" — session — a run with tool-one — no wires',
].join("\n");

describe("the ground digest is byte-identical to the one before this story", () => {
  test("the same records compose the same bytes", () => {
    expect(interpreterDigest(groundDigestInput() as never)).toBe(GROUND_GOLDEN);
  });

  test("the map-aware door answers the ground map with the SAME function", () => {
    expect(
      interpreterDigestOf({ map: "ground", ...groundDigestInput() } as never),
    ).toBe(GROUND_GOLDEN);
  });

  test("the ground prompt keeps its map rule and gains none of the other half", () => {
    const onGround = buildInterpreterPrompt({
      instruction: "wire rain to soil",
      digest: GROUND_GOLDEN,
    });
    const named = buildInterpreterPrompt({
      instruction: "wire rain to soil",
      digest: GROUND_GOLDEN,
      map: "ground",
    });
    expect(named).toBe(onGround);
    expect(onGround).toContain('"map" is always "ground".');
    expect(onGround).toContain("Reference only cards named in the map digest.");
    expect(onGround).not.toContain(INTERPRETER_GROUND_ONLY_SENTENCE);
    expect(onGround).not.toContain("changes are ground-only for now");
  });

  test("readForMap is a passthrough on the map that can be changed", () => {
    const read = parseInterpreterAnswer(
      block([{ act: "propose_wire", map: "ground", payload: { from: "rain", to: "soil" } }]),
    );
    expect(readForMap(read, "ground")).toBe(read);
  });
});

/* ------------------------------------------------------------------ *
 * THE CONCEPT DIGEST: WORDS BY NAME, AND NO MEMORY
 * ------------------------------------------------------------------ */

describe("the concept digest lists the words, names only", () => {
  const MEMORY = "the gauge's memory, which is a body and must never ride";

  test("names and kinds ride; the memory does not", () => {
    // The input SHAPE has no memory field; passing one anyway proves the
    // composer reads nothing but the pair it declares.
    const digest = conceptDigest({
      words: [
        { slug: "rain", name: "rain", memory: MEMORY },
        { slug: "soil", name: "soil", memory: "" },
      ] as never,
    });
    expect(digest).toContain('"rain"');
    expect(digest).toContain('"soil"');
    expect(digest).toContain("word");
    expect(digest).not.toContain(MEMORY);
    expect(digest).not.toContain("memory");
  });

  test("an empty map composes nothing, so the caller omits the section", () => {
    expect(conceptDigest({ words: [] })).toBe("");
  });

  test("the concept digest is bounded the same way, whole words only", () => {
    const words = Array.from({ length: 40 }, (_, at) => ({
      slug: "word-" + String(at),
      name: "word " + String(at),
    }));
    const lines = conceptDigest({ words }).split("\n");
    expect(lines.length).toBe(INTERPRETER_DIGEST_MAX_CARDS + 1);
    expect(lines[lines.length - 1]).toBe(INTERPRETER_DIGEST_WORDS_OMITTED_SENTENCE);
    expect(new TextEncoder().encode(conceptDigest({ words })).length).toBeLessThanOrEqual(2048);
  });
});

/* ------------------------------------------------------------------ *
 * THE DYNAMICS DIGEST: THAT MAP'S OWN RECORDS, BY KIND
 * ------------------------------------------------------------------ */

describe("the dynamics digest lists that map's items", () => {
  const CLAIM = "a claim's words are prose and must never ride";
  const AMOUNT = 987654;

  const input = () => ({
    names: { rain: "rain", soil: "soil" },
    playingSet: true,
    words: [
      { slug: "rain", name: "rain" },
      { slug: "soil", name: "soil" },
    ],
    links: [{ from: "rain", to: "soil", sign: "+" as const }],
    loops: [{ name: "rain loop", slug: "rain-loop" }],
    assumptions: [
      { target: { type: "word" as const, slug: "rain" }, text: CLAIM },
      { target: { type: "loop" as const, slug: "rain-loop" }, text: CLAIM },
    ],
    quantities: [
      { target: { type: "word" as const, slug: "soil" }, stated: true, amount: AMOUNT },
      { target: { type: "link" as const, from: "rain", to: "soil" }, stated: false },
    ],
  });

  test("words, links, loops, claims and quantities all ride, named", () => {
    const digest = dynamicsDigest(input() as never);
    expect(digest).toContain("in the playing set");
    expect(digest).toContain("rain → soil");
    expect(digest).toContain("link");
    expect(digest).toContain("rain loop");
    expect(digest).toContain("loop");
    expect(digest).toContain("assumption");
    expect(digest).toContain("quantity");
    expect(digest).toContain("a stated number");
    expect(digest).toContain("a number not stated yet");
  });

  test("a claim's WORDS and a quantity's AMOUNT never ride", () => {
    const digest = dynamicsDigest(input() as never);
    expect(digest).not.toContain(CLAIM);
    expect(digest).not.toContain(String(AMOUNT));
  });

  test("no accepted playing set is said, because then nothing plays", () => {
    const digest = dynamicsDigest({ ...input(), playingSet: false, words: [] } as never);
    expect(digest).toContain(INTERPRETER_DIGEST_NO_SET_SENTENCE);
    expect(digest).toContain("rain loop");
  });

  test("the dynamics digest is bounded too, whole items only", () => {
    const links = Array.from({ length: 40 }, (_, at) => ({
      from: "rain",
      to: "soil-" + String(at),
      sign: "+" as const,
    }));
    const digest = dynamicsDigest({
      names: { rain: "rain" },
      playingSet: true,
      words: [],
      links,
      loops: [],
      assumptions: [],
      quantities: [],
    });
    const lines = digest.split("\n");
    expect(lines.length).toBe(INTERPRETER_DIGEST_MAX_CARDS + 1);
    expect(lines[lines.length - 1]).toBe(INTERPRETER_DIGEST_ITEMS_OMITTED_SENTENCE);
  });
});

/* ------------------------------------------------------------------ *
 * A CHANGE ON ANOTHER MAP PROPOSES NOTHING AND SAYS WHY
 * ------------------------------------------------------------------ */

/** A scripted model: the answer is EXACTLY these bytes, and no network. */
function scripted(answer: string) {
  const moves: InterpreterMove[] = [];
  let sends = 0;
  return {
    moves,
    sends: () => sends,
    async run(input: {
      instruction: string;
      digest: string;
      map: "ground" | "concept" | "dynamics";
    }) {
      return interpretInstruction({
        input,
        on: input.map,
        sendMessages: async () => {
          sends += 1;
          return { kind: "answer", text: answer };
        },
        recordMove: async (move) => {
          moves.push(move);
          return null;
        },
      });
    },
  };
}

const CHANGE_SCRIPT = block([
  { act: "propose_wire", map: "ground", payload: { from: "rain", to: "soil" } },
]);

const READ_SCRIPT = block([
  { act: "read_words", map: "concept", payload: {} },
]);

describe("a change instruction on another map proposes nothing and says why", () => {
  for (const map of ["concept", "dynamics"] as const) {
    test(`a script that proposes anything is refused WHOLE on ${map}`, async () => {
      const model = scripted(CHANGE_SCRIPT);
      const turn = await model.run({ instruction: "wire rain to soil", digest: '"rain" — word — a coined word', map });
      expect(turn.read).toEqual({
        kind: "problem",
        sentence: INTERPRETER_GROUND_ONLY_SENTENCE,
      });
      // ONE egress, as always: the refusal is the app's, not a silence.
      expect(model.moves).toHaveLength(1);
      expect(model.sends()).toBe(1);
    });

    test(`a prose answer (the model's own sentence) says the same thing on ${map}`, async () => {
      const model = scripted("changes are ground-only for now.");
      const turn = await model.run({ instruction: "add a card", digest: "", map });
      expect(turn.read).toEqual({
        kind: "problem",
        sentence: INTERPRETER_GROUND_ONLY_SENTENCE,
      });
    });

    test(`a READ script still runs on ${map}`, async () => {
      const model = scripted(READ_SCRIPT);
      const turn = await model.run({ instruction: "what words are here?", digest: "", map });
      expect(turn.read.kind).toBe("acts");
      if (turn.read.kind !== "acts") return;
      expect(turn.read.acts[0]!.act).toBe("read_words");
      expect(turn.read.acts[0]!.map).toBe("concept");
    });
  }

  test("a clarifying question still comes through: asking is not changing", () => {
    const read = readForMap(
      { kind: "question", question: "Which word do you mean?" },
      "concept",
    );
    expect(read).toEqual({ kind: "question", question: "Which word do you mean?" });
    // The prose sentence is the one that is answered by the app's own reason;
    // every other problem keeps its own.
    expect(
      readForMap({ kind: "problem", sentence: INTERPRETER_NO_QUESTION_SENTENCE }, "dynamics"),
    ).toEqual({ kind: "problem", sentence: INTERPRETER_GROUND_ONLY_SENTENCE });
  });

  test("the prompt tells the model the limitation, per map", () => {
    for (const map of ["concept", "dynamics"] as const) {
      const prompt = buildInterpreterPrompt({ instruction: "add a card", digest: "", map });
      expect(prompt).toContain("changes are ground-only for now");
      expect(prompt).toContain("the " + map + " map");
      expect(prompt).toContain("Never write a change act on this map.");
    }
  });
});

/* ------------------------------------------------------------------ *
 * NO WRITE ACT EXISTS FOR THE OTHER MAPS — NOT EVEN A PROPOSAL
 * ------------------------------------------------------------------ */

describe("the other maps have no change act at all (not even a proposal)", () => {
  test("every propose act refuses the concept and dynamics maps by name", () => {
    for (const map of COMMAND_MAPS) {
      for (const spec of ACT_SPECS.filter((one) => one.family === "propose")) {
        const read = validateAct({ act: spec.name, map, payload: {} });
        if (map === CHANGE_MAP) continue;
        expect(read.ok).toBe(false);
        if (read.ok) continue;
        expect(read.sentence).toContain(spec.name);
        expect(read.sentence).toContain("ground map");
      }
    }
  });

  test("the older reads keep their ground meaning; only the two new reads name a map", () => {
    const payloadFor = (name: string) =>
      name === "read_card" ? { card: "rain" } : {};
    for (const name of ["map_overview", "read_card", "read_wires"]) {
      // The ground map still answers them...
      expect(validateAct({ act: name, map: "ground", payload: payloadFor(name) }).ok).toBe(true);
      // ...and another map does not: its content is read_words' or read_map's.
      const wrong = validateAct({ act: name, map: "concept", payload: payloadFor(name) });
      expect(wrong.ok).toBe(false);
      if (wrong.ok) continue;
      expect(wrong.sentence).toContain("read_words and read_map");
    }
    for (const name of MAP_READ_ACTS) {
      const read = validateAct({ act: name, map: "dynamics", payload: {} });
      expect(read.ok).toBe(true);
    }
  });

  test("the vocabulary carries exactly nine proposals, all of them ground's", () => {
    expect(ACT_SPECS.filter((spec) => spec.family === "propose")).toHaveLength(9);
    expect(ACT_SPECS.filter((spec) => spec.family === "read")).toHaveLength(5);
    expect(CHANGE_MAP).toBe("ground");
  });
});

/* ------------------------------------------------------------------ *
 * THE HOST READS THE OTHER MAPS WITHOUT WRITING ANYTHING
 * ------------------------------------------------------------------ */

const MEMORY = "a memory body";

const REFERENCES: Record<string, string> = {
  rain: "---\nname: rain\nx: 0\ny: 0\n---\n" + MEMORY + "\n",
  soil: "---\nname: soil\nx: 40\ny: 0\n---\n",
};

function freshWorkspace(): string {
  const path = mkdtempSync(join(ROOT, "workspace-"));
  mkdirSync(join(path, "map/references"), { recursive: true });
  for (const [slug, text] of Object.entries(REFERENCES)) {
    writeFileSync(join(path, "map/references", slug + ".md"), text, "utf8");
  }
  writeFileSync(
    join(path, "map/links.jsonl"),
    JSON.stringify({ from: "rain", to: "soil", sign: "+" }) + "\n",
    "utf8",
  );
  writeFileSync(
    join(path, "map/loops.jsonl"),
    JSON.stringify({ name: "rain loop", path: ["rain", "soil", "rain"] }) + "\n",
    "utf8",
  );
  writeFileSync(
    join(path, "map/assumptions.jsonl"),
    JSON.stringify({ on: "rain", text: "the gauge is the source" }) + "\n",
    "utf8",
  );
  writeFileSync(
    join(path, "map/quantities.jsonl"),
    JSON.stringify({ on: "rain", amount: 12 }) + "\n",
    "utf8",
  );
  writeFileSync(
    join(path, "map/model.json"),
    JSON.stringify({ words: ["rain", "soil"] }),
    "utf8",
  );
  return path;
}

function snapshot(path: string): string {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir).sort()) {
      const full = join(dir, name);
      const stat = Bun.file(full);
      out.push(full + ":" + String(stat.size));
    }
  };
  walk(join(path, "map"));
  return out.join("|");
}

describe("the host reads the other maps, and a read is not a write", () => {
  test("read_words lists the words' NAMES and never a memory", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const outcome = await host.readWords();
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.line).toContain('"rain"');
    expect(outcome.line).toContain('"soil"');
    expect(outcome.line).not.toContain(MEMORY);
  });

  test("read_map names each map's shape by kind", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const concept = await host.readMap("concept");
    const dynamics = await host.readMap("dynamics");
    const ground = await host.readMap("ground");
    expect(concept.ok && concept.line).toContain("word");
    if (dynamics.ok) {
      expect(dynamics.line).toContain("signed link");
      expect(dynamics.line).toContain("named loop");
      expect(dynamics.line).toContain("claim");
      expect(dynamics.line).toContain("quantity");
      expect(dynamics.line).toContain("in play");
      expect(dynamics.line).not.toContain("the gauge is the source");
    }
    expect(ground.ok).toBe(true);
  });

  test("a read script runs and files NOTHING — the records are byte-identical", async () => {
    const path = freshWorkspace();
    const before = snapshot(path);
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const run = await executeScript(
      [
        { act: "read_words", map: "concept", payload: {} },
        { act: "read_map", map: "dynamics", payload: {} },
        { act: "read_map", map: "concept", payload: {} },
      ],
      host,
    );
    expect(run.ok).toBe(true);
    expect(run.ids).toEqual([]);
    expect(snapshot(path)).toBe(before);
    // No ghost was filed either: the inbox stays absent.
    expect(() => readdirSync(join(path, ".attentioneer/inbox"))).toThrow();
  });

  test("the concept card's read end to end: names out, no memory", async () => {
    const path = freshWorkspace();
    const host = createAttentioneerHost({ workspacePath: path, io: nodeCommandIo() });
    const words = [
      { slug: "rain", name: "rain" },
      { slug: "soil", name: "soil" },
    ];
    const digest = interpreterDigestOf({ map: "concept", words });
    const model = scripted(READ_SCRIPT);
    const turn = await model.run({
      instruction: "what words are here?",
      digest,
      map: "concept",
    });
    expect(turn.read.kind).toBe("acts");
    if (turn.read.kind !== "acts") return;
    const run = await executeScript(turn.read.acts, host);
    expect(run.ok).toBe(true);
    expect(run.lines[0]).toContain('"rain"');
    expect(run.lines[0]).not.toContain(MEMORY);
    // And the map's bytes never moved (a read is not a write).
    expect(readFileSync(join(path, "map/references/rain.md"), "utf8")).toBe(
      REFERENCES.rain,
    );
  });
});

/* ------------------------------------------------------------------ *
 * THE BOUNDS: WHOLE ITEMS, ONE SENTENCE, ON EVERY MAP
 * ------------------------------------------------------------------ */

describe("bounds drop whole items behind ONE sentence, with no count", () => {
  test("the ground sentence is the one 21.2 wrote (unchanged)", () => {
    expect(INTERPRETER_DIGEST_OMITTED_SENTENCE).toBe(
      "some cards on this map were left out, because this digest is bounded.",
    );
  });

  test("the other maps' sentences say items and words, and never a number", () => {
    for (const sentence of [
      INTERPRETER_DIGEST_WORDS_OMITTED_SENTENCE,
      INTERPRETER_DIGEST_ITEMS_OMITTED_SENTENCE,
    ]) {
      expect(sentence).not.toMatch(/[0-9]/);
      expect(sentence).toContain("because this digest is bounded.");
    }
  });
});
