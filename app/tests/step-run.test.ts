import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { Link } from "../src/map/links";
import type { PlayingSet } from "../src/map/model";
import type { Quantity } from "../src/map/quantities";
import { activeModelKey, stepRun, type StepModel } from "../src/map/step";

/**
 * The step's RUN (ADR-0022, Epic 8 story 3): per-word running amounts plus
 * the last delta — NEVER a cross-word sum, total, column, table, meter or step
 * counter (the Funes brake, scoped to this seam) — and its LIFECYCLE: the run
 * is ephemeral, resets on active-model edits and scenario switches, survives
 * committed-only edits, zoom and level switches, and stepping writes NOTHING.
 *
 * The lifecycle's rule is pure: `activeModelKey` is the ACTIVE model's
 * identity (the records folder + the playing set + the links + the quantities,
 * in file order), and the hook resets on a different key. The source scans
 * below hold the wiring to that rule: the key is built from those four inputs
 * only, so a committed edit cannot reset a run, and the hook is called with the
 * key and the model and nothing else.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Source with its comments removed — the Funes scan reads CODE only. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const stepSource = read("../src/map/step.ts");
const stepNotesSource = read("../src/canvas/stepNotes.ts");
const crankSource = read("../src/canvas/StepCrank.tsx");
const runnerSource = read("../src/canvas/useStepRun.ts");
const appSource = read("../src/App.tsx");
const wordSource = read("../src/canvas/ReferenceWord.tsx");

function stock(on: string, amount: number | null = null): Quantity {
  return { type: "stock", on, amount, extra: {} };
}

function flow(from: string, to: string, amount: number | null = null): Quantity {
  return { type: "flow", from, to, amount, extra: {} };
}

function link(from: string, to: string, sign: "+" | "-" = "+"): Link {
  return { from, to, sign, extra: {} };
}

function set(words: readonly string[]): PlayingSet {
  return { words: [...words], extra: {} };
}

function run(quantities: Quantity[], words: string[] | null) {
  const model: StepModel = { words, quantities, links: [] };
  return stepRun(model, null);
}

describe("per-word running amounts and the last delta", () => {
  test("each stock reads its own amount; a word nothing moved has no delta", () => {
    const result = run(
      [
        stock("soil", 10),
        stock("plant", 2),
        stock("air", 5),
        flow("soil", "plant", 4),
        flow("plant", "soil", 1),
      ],
      ["soil", "plant", "air"],
    );
    expect(result.amounts.get("soil")).toBe(7);
    expect(result.amounts.get("plant")).toBe(5);
    expect(result.amounts.get("air")).toBe(5);
    expect(result.lastDelta.get("soil")).toBe(-3);
    expect(result.lastDelta.get("plant")).toBe(3);
    // A word this crank did not move has no delta at all — not a 0.
    expect(result.lastDelta.has("air")).toBe(false);
  });

  test("the run carries exactly the amounts, the last delta and the notes", () => {
    const result = run([stock("soil", 4)], ["soil"]);
    expect(Object.keys(result).sort()).toEqual(["amounts", "lastDelta", "notes"]);
    // Three fields; no step number, no history, no timestamp, no totals.
    const fields = [...stepSource.matchAll(/^  (\w+):/gm)].map((match) => match[1]);
    expect(fields).toContain("amounts");
    expect(fields).toContain("lastDelta");
    expect(fields).toContain("notes");
  });

  test("unknown stays unknown across cranks (never becomes 0)", () => {
    const model: StepModel = {
      words: ["soil", "plant"],
      quantities: [stock("soil"), stock("plant", 0), flow("soil", "plant", 3)],
      links: [],
    };
    const first = stepRun(model, null);
    const second = stepRun(model, first);
    expect(first.amounts.get("soil")).toBeNull();
    expect(second.amounts.get("soil")).toBeNull();
    expect(second.lastDelta.size).toBe(0);
  });
});

describe("the run's lifecycle key: the ACTIVE model, and nothing else", () => {
  const quantities = [stock("soil", 4), flow("soil", "plant", 3)] as Quantity[];
  const links = [link("soil", "plant", "+")];
  const words = set(["soil", "plant"]);

  test("the same active model reads the same key", () => {
    expect(activeModelKey("map", words, links, quantities)).toBe(
      activeModelKey("map", { words: ["soil", "plant"], extra: {} }, links, quantities),
    );
  });

  test("an ACTIVE-model edit changes the key (so the run resets)", () => {
    const before = activeModelKey("map", words, links, quantities);
    // a changed amount
    expect(
      activeModelKey("map", words, links, [stock("soil", 5), quantities[1]]),
    ).not.toBe(before);
    // a new line
    expect(
      activeModelKey("map", words, links, [...quantities, stock("plant", 0)]),
    ).not.toBe(before);
    // a stock's amount turning absent (unknown is a different model state)
    expect(
      activeModelKey("map", words, links, [stock("soil"), quantities[1]]),
    ).not.toBe(before);
  });

  test("a link edit changes the key; the sign is the active model's", () => {
    const before = activeModelKey("map", words, links, quantities);
    expect(activeModelKey("map", words, [link("soil", "plant", "-")], quantities)).not.toBe(before);
    expect(activeModelKey("map", words, [...links, link("plant", "soil", "+")], quantities)).not.toBe(before);
  });

  test("a set edit changes the key", () => {
    const before = activeModelKey("map", words, links, quantities);
    expect(activeModelKey("map", set(["soil"]), links, quantities)).not.toBe(before);
    expect(activeModelKey("map", null, links, quantities)).not.toBe(before);
  });

  test("a scenario switch changes the key even between identical copies", () => {
    expect(activeModelKey("scenarios/evening", words, links, quantities)).not.toBe(
      activeModelKey("map", words, links, quantities),
    );
    expect(
      activeModelKey("scenarios/evening", words, links, quantities),
    ).not.toBe(activeModelKey("scenarios/morning", words, links, quantities));
  });

  test("the key takes the four active inputs and no committed record", () => {
    const start = stepSource.indexOf("export function activeModelKey(");
    const end = stepSource.indexOf("\n}", start);
    const signature = stepSource.slice(start, end);
    expect(signature).toContain("recordsDir: string");
    expect(signature).toContain("model: PlayingSet | null");
    expect(signature).toContain("links: readonly Link[]");
    expect(signature).toContain("quantities: readonly Quantity[]");
    // Committed-only records are not parameters: a mark, an assumption, a loop,
    // a pointer or a word's position cannot reset a run.
    for (const name of ["assumption", "mark", "loop", "pointer", "distance"]) {
      expect(signature.toLowerCase()).not.toContain(name);
    }
  });
});

describe("the reset wiring: keyed on the active model, never on the view", () => {
  /** The stepKey useMemo block in App.tsx. */
  function stepKeyBlock(): string {
    const start = appSource.indexOf("const stepKey = useMemo(");
    expect(start).toBeGreaterThan(-1);
    const end = appSource.indexOf("\n  );", start);
    expect(end).toBeGreaterThan(start);
    return appSource.slice(start, end + 4);
  }

  test("the run is keyed by activeModelKey over the records folder and the three records", () => {
    const block = stepKeyBlock();
    expect(block).toContain(
      "activeModelKey(stepRecordsDir, model, links, quantities)",
    );
    expect(block).toContain("[stepRecordsDir, model, links, quantities]");
    expect(appSource).toContain('recordsDirOf(workspace?.path ?? "", scenario)');
  });

  test("a committed-only edit or a view change is NOT an input (no reset)", () => {
    const block = stepKeyBlock();
    for (const name of [
      "level",
      "zoom",
      "camera",
      "assumption",
      "marks",
      "pointers",
      "loops",
      "distances",
    ]) {
      expect(block).not.toContain(name);
    }
  });

  test("the hook is called with the model and the key, nothing else", () => {
    expect(appSource).toContain("useStepRun(stepModel, stepKey)");
    const start = appSource.indexOf("const step = useStepRun(");
    const line = appSource.slice(start, appSource.indexOf(";", start));
    expect(line).toContain("stepModel, stepKey");
    expect(line).not.toContain("level");
    expect(line).not.toContain("zoom");
  });

  test("a different key RESETS the run; an equal key keeps it", () => {
    expect(runnerSource).toContain("if (keyRef.current === key) return;");
    expect(runnerSource).toContain("keyRef.current = key;");
    expect(runnerSource).toContain("setRun(null);");
    const reset = runnerSource.indexOf("setRun(null);");
    expect(reset).toBeGreaterThan(runnerSource.indexOf("useEffect("));
    // The stale run is invisible before the effect runs, too.
    expect(runnerSource).toContain("keyRef.current === key ? run : null");
  });

  test("stepping writes NOTHING: the step, the hook and the crank have no writer", () => {
    for (const [name, source] of [
      ["map/step.ts", stepSource],
      ["canvas/useStepRun.ts", runnerSource],
      ["canvas/StepCrank.tsx", crankSource],
    ] as const) {
      const code = codeOnly(source);
      for (const forbidden of [
        "../lib/fs",
        "writeTextFile",
        "writeMachineFile",
        "readTextFile",
        "save",
        "persist",
      ]) {
        expect({ name, forbidden, found: code.includes(forbidden) }).toEqual({
          name,
          forbidden,
          found: false,
        });
      }
    }
    // The step takes a model and the previous run: no path, no disk.
    expect(stepSource).toContain("model: StepModel,");
    expect(stepSource).toContain("previous: StepRun | null,");
  });
});

describe("the Funes brake, scoped to the step (ADR-0022 decision 4)", () => {
  const AGGREGATE =
    /\b(sum|sums|summing|total|totals|meter|meters|table|tables|aggregate|aggregates|average|mean|score|scores)\b/i;

  test("no summing/totals/meters/tables exist in the step's code", () => {
    for (const [name, source] of [
      ["map/step.ts", stepSource],
      ["canvas/stepNotes.ts", stepNotesSource],
      ["canvas/StepCrank.tsx", crankSource],
      ["canvas/useStepRun.ts", runnerSource],
    ] as const) {
      const code = codeOnly(source);
      expect({ name, found: code.match(AGGREGATE)?.[0] ?? null }).toEqual({
        name,
        found: null,
      });
      expect({ name, reduce: code.includes(".reduce(") }).toEqual({
        name,
        reduce: false,
      });
    }
  });

  test("no aggregate helper is exported from the step module", () => {
    const exports = [
      ...stepSource.matchAll(/export (?:async )?function (\w+)/g),
      ...stepSource.matchAll(/export const (\w+)/g),
    ].map((match) => match[1]);
    expect(exports).toContain("stepRun");
    expect(exports).toContain("activeModelKey");
    for (const name of exports) {
      expect(name).not.toMatch(
        /sum|total|meter|table|aggregate|average|mean|score|count/i,
      );
    }
  });

  test("no step counter exists: the run is state, not a tally", () => {
    // StepRun's three fields and StepRunner's two; nothing counts cranks.
    const runner = stepSource.slice(stepSource.indexOf("export interface StepRun"));
    const interfaceText = runner.slice(0, runner.indexOf("\n}"));
    const fields = [...interfaceText.matchAll(/^  (\w+):/gm)].map((m) => m[1]);
    expect(fields).toEqual(["amounts", "lastDelta", "notes"]);
    expect(runnerSource).toContain("run: StepRun | null");
    expect(runnerSource).toContain("crank: () => void");
    expect(runnerSource).not.toMatch(/useState<number>/);
    // The display's per-word read is ONE amount and ONE delta (ReferenceWord).
    expect(wordSource).toContain(
      "run?: { amount: number | null; delta: number | null };",
    );
  });
});
