import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONTENT_CLASSES, WORD_CONTROL_CLASSES } from "../src/canvas/gates";
import {
  stepAmountText,
  stepDeltaText,
  stepNoteText,
} from "../src/canvas/stepNotes";
import type { StepNote } from "../src/map/step";

/**
 * The step's DISPLAY (ADR-0022, Epic 8 story 3), asserted without a DOM: ONE
 * hand-cranked control (one notch per press, no timer, no autoplay, no
 * celebration), its STEP-SCOPED notes, and the per-word running amount plus
 * last delta riding each stock word — never a panel that could become a
 * column, a table or a total, and never a step counter.
 *
 * The crank and its notes live OUTSIDE `.plane` beside the level control
 * (the control's other dynamics actions live there too), so the plane's armed
 * gate never reaches them and they need no gate class; the run read is
 * non-interactive inside the word. Level 1 renders neither — a step is the
 * dynamics game's own reading.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

/** Source with its comments removed — the scans read CODE only. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

const appSource = read("../src/App.tsx");
const crankSource = read("../src/canvas/StepCrank.tsx");
const runnerSource = read("../src/canvas/useStepRun.ts");
const stepNotesSource = read("../src/canvas/stepNotes.ts");
const wordSource = read("../src/canvas/ReferenceWord.tsx");
const stepSource = read("../src/map/step.ts");
const cssSource = read("../src/canvas/canvas.css");

describe("the crank control", () => {
  // DEPRECATED (hidden 2026-11-16 per separate-maps review): the crank stood
  // at dynamics and the dynamics map is blank paper now, so it is not offered.
  // Converted from "it renders at Level 2 only"; the component, the hook and
  // the notes stay written behind the flag.
  test("it is hidden at dynamics with the blank map (flag + machinery alive)", () => {
    expect(appSource).toMatch(
      /level === "dynamics" && offered\(STEP_CRANK_HIDDEN\) && \(\s*<StepCrank/,
    );
    // The hook itself is unconditional: the run survives a level switch, and
    // only the render is band-scoped.
    expect(appSource).toContain("const step = useStepRun(stepModel, stepKey);");
  });

  test("ONE notch per press: a single click handler, and no timer anywhere", () => {
    const code = codeOnly(crankSource);
    expect(code.match(/onClick=\{onCrank\}/g)?.length).toBe(1);
    for (const [name, source] of [
      ["canvas/StepCrank.tsx", crankSource],
      ["canvas/useStepRun.ts", runnerSource],
      ["map/step.ts", stepSource],
    ] as const) {
      const body = codeOnly(source);
      for (const timer of [
        "setInterval",
        "setTimeout",
        "requestAnimationFrame",
        "autoplay",
      ]) {
        expect({ name, timer, found: body.includes(timer) }).toEqual({
          name,
          timer,
          found: false,
        });
      }
    }
    // The only step is the one the press calls.
    expect(runnerSource.match(/stepRun\(/g)?.length).toBe(1);
    expect(runnerSource.indexOf("stepRun(")).toBeGreaterThan(
      runnerSource.indexOf("const crank = useCallback("),
    );
  });

  test("no celebration, no score, no badge, no dopamine trap", () => {
    const TRAP = /\b(celebrat\w*|confetti|score|scores|streak|badge|pulse|glow|winner|points)\b/i;
    for (const [name, source] of [
      ["canvas/StepCrank.tsx", crankSource],
      ["canvas/stepNotes.ts", stepNotesSource],
      ["map/step.ts", stepSource],
    ] as const) {
      const code = codeOnly(source);
      expect({ name, found: code.match(TRAP)?.[0] ?? null }).toEqual({
        name,
        found: null,
      });
    }
  });

  test("it sits OUTSIDE .plane beside the level control (no gate class needed)", () => {
    expect(appSource.indexOf("</CanvasPlane>")).toBeLessThan(
      appSource.indexOf("<StepCrank"),
    );
    // The plane's armed gate and its two class lists never see it, exactly as
    // they never see the level control.
    expect(CONTENT_CLASSES).not.toContain("step-crank");
    expect(WORD_CONTROL_CLASSES).not.toContain("step-crank");
    expect(cssSource).toContain(".step-crank {");
  });

  test("the notes are STEP-SCOPED: the crank's own list, replaced each press", () => {
    expect(appSource).toContain("notes={step.run?.notes ?? []}");
    expect(crankSource).toContain("stepNoteText(note, nameOf)");
    // Stateless: the component holds no history and no previous notes.
    expect(codeOnly(crankSource)).not.toContain("useState");
    expect(codeOnly(crankSource)).not.toContain("useRef");
  });

  test("a clamp is inked louder than the quiet notes (the consequence noticed)", () => {
    expect(crankSource).toContain('note.kind === "clamp"');
    expect(crankSource).toContain("step-note-clamp");
    expect(cssSource).toContain(".step-note-clamp {");
    expect(cssSource).toContain(".step-notes {");
  });
});

describe("the delta/amount display is per word", () => {
  test("a word renders its own running amount and last delta", () => {
    expect(wordSource).toContain(
      "run?: { amount: number | null; delta: number | null };",
    );
    expect(wordSource).toContain('className="word-run"');
    expect(wordSource).toContain("stepAmountText(run.amount)");
    expect(wordSource).toContain("stepDeltaText(run.delta)");
    expect(appSource).toContain("run={runViewOf(word)}");
  });

  test("it reads the run at Level 2 only (Level 1's markup is untouched)", () => {
    expect(appSource).toContain(
      'if (level !== "dynamics" || word.slug === null || step.run === null)',
    );
    // The word receives the read only through the app's band-scoped view.
    expect(wordSource).toContain("{run && runAmount !== null && (");
  });

  test("the read hangs BELOW the word, so its box never grows", () => {
    const rule = cssSource.slice(cssSource.indexOf(".word-run {"));
    const block = rule.slice(0, rule.indexOf("}"));
    expect(block).toContain("position: absolute;");
    expect(block).toContain("top: calc(100% + 3px);");
    // A read is not a control: it never owns a press.
    expect(block).toContain("pointer-events: none;");
  });

  test("the display is ONE word's amount and delta — not a column or a total", () => {
    // The word's run read is one amount and one delta; there is no list, no
    // panel and no summing on the way to the screen.
    const start = appSource.indexOf("const runViewOf = useCallback(");
    const block = appSource.slice(start, appSource.indexOf("\n  );", start) + 4);
    expect(block).toContain('amount: step.run.amounts.get(slug) ?? null');
    expect(block).toContain('delta: step.run.lastDelta.get(slug) ?? null');
    for (const forbidden of [".reduce(", "total", "sum", "average"]) {
      expect(block).not.toContain(forbidden);
    }
    // No numbers are formatted into a table-like surface: the crank's notes
    // are sentences and the amounts ride the words.
    expect(codeOnly(crankSource)).not.toContain("<table");
  });

  test("an unknown amount reads 'unknown', never 0 (absent ≠ 0)", () => {
    expect(stepAmountText(null)).toBe("unknown");
    expect(stepAmountText(null)).not.toBe("0");
    // A STATED zero is a real amount: it reads as 0.
    expect(stepAmountText(0)).toBe("0");
  });

  test("the last delta is signed, and nothing moved reads nothing", () => {
    expect(stepDeltaText(2)).toBe("+2");
    expect(stepDeltaText(-1)).toBe("-1");
    expect(stepDeltaText(0)).toBeNull();
    expect(stepDeltaText(null)).toBeNull();
  });

  test("a clamp sentence names the stock, the flow and the shortfall", () => {
    const names: Record<string, string> = { soil: "soil", air: "air" };
    const note: StepNote = {
      kind: "clamp",
      on: "soil",
      from: "soil",
      to: "air",
      gave: 2,
      asked: 3,
    };
    const text = stepNoteText(note, (slug) => names[slug] ?? slug);
    // The structural rule: stock, flow and "gave X of Y" against the authored
    // amount. The exact wording is provisional (ADR-0003).
    expect(text).toContain("soil");
    expect(text).toContain("air");
    expect(text).toContain("2");
    expect(text).toContain("3");
  });

  test("an outside sentence says the world and that it is unbounded", () => {
    const note: StepNote = {
      kind: "outside-source",
      from: "rain",
      to: "soil",
      amount: 5,
    };
    const text = stepNoteText(note, (slug) => slug);
    expect(text).toContain("rain");
    expect(text).toContain("5");
    expect(text.toLowerCase()).toContain("world");
    expect(text.toLowerCase()).toContain("unbounded");
  });

  test("the step's own sentences name words, never slugs (the notices rule)", () => {
    expect(stepNotesSource).toContain("nameOf(note.on)");
    expect(stepNotesSource).toContain("nameOf(note.from)");
    expect(stepNotesSource).toContain('return amount === null ? "unknown" : formatAmount(amount);');
  });
});
