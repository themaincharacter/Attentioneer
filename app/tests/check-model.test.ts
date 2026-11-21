import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replyCarriedCaveat } from "../src/turn/curator";
import {
  BATTERY_CALLS,
  BATTERY_CARDS,
  CURATOR_BATTERY,
  INTERPRETER_BATTERY,
} from "../scripts/check-model-battery";
import {
  CHECK_DEFAULT_MAX_CALLS,
  buildFixtureDigests,
  countsOf,
  isAuthRefusal,
  parseCheckArgs,
  providerFactsOf,
  reportStamp,
  runModelCheck,
  type ModelCheckDeps,
} from "../scripts/check-model";
import type { TurnMessage } from "../src/turn/protocol";
import type { TurnResult } from "../src/turn/turn";

/**
 * STORY 23.1 — the bounded real-model battery, WITHOUT the network.
 *
 * What this file proves, in the story's own words:
 *   - the battery is FIXED and well-formed (its size, its kinds, its texts);
 *   - the runner, with a SCRIPTED sender, produces a report whose counts are
 *     the ones the scripted answers make;
 *   - --max-calls refuses a battery that would run past it;
 *   - without --yes ZERO calls happen;
 *   - the key never appears in a report (both files, and every printed line);
 *   - an auth refusal stops the run instead of grinding through the rows;
 *   - the digest comes from a temporary workspace, through the app's parsers.
 */

const FENCE = String.fromCharCode(96).repeat(3);
const KEY = "sk-test-KEY-9f3a-never-in-a-report";

const ROOT = mkdtempSync(join(tmpdir(), "attentioneer-check-model-test-"));
afterAll(() => {
  rmSync(ROOT, { recursive: true, force: true });
});

/** A config with one endpoint row, a task model and a different manager model. */
function configText(): string {
  return JSON.stringify({
    turn: {
      providerId: "fake-row",
      modelId: "task-model",
      managerProviderId: "fake-row",
      managerModelId: "manager-model",
      providers: [
        {
          id: "fake-row",
          name: "Fake Row",
          baseUrl: "https://example.invalid/v1",
          models: [
            { id: "task-model", name: "Task" },
            { id: "manager-model", name: "Manager" },
          ],
        },
      ],
    },
  });
}

/** The curator's own prompt title, so the scripted sender knows which battery. */
function isCuratorPrompt(messages: readonly TurnMessage[]): boolean {
  return messages.some((message) =>
    message.content.startsWith("# distilling one answer into a card"),
  );
}

/** A card the cue list cannot fault: its uncertainty slot says something. */
function cardAnswer(title: string): string {
  const body = JSON.stringify({
    title,
    claim: "each press is one model round trip.",
    "rests on": "the send path",
    "does not cover": "other providers",
    uncertainty: "one run, one provider",
  });
  return FENCE + "attentioneer-card\n" + body + "\n" + FENCE;
}

/** The ACTS block the scripted interpreter answers with. */
function actsAnswer(): string {
  const body = JSON.stringify([
    { act: "map_overview", map: "ground", payload: {} },
  ]);
  return FENCE + "attentioneer-acts\n" + body + "\n" + FENCE;
}

/** Deps whose sender is scripted: no process, no network, no provider. */
function scriptedDeps(
  send: (messages: readonly TurnMessage[]) => Promise<TurnResult>,
): ModelCheckDeps {
  let clock = 0;
  return {
    readConfig: () => configText(),
    readSecrets: () => JSON.stringify({ "fake-row": KEY }),
    makeSend: () => ({ send, close: async () => {} }),
    now: () => {
      clock += 100;
      return clock;
    },
    newWorkspace: () => mkdtempSync(join(ROOT, "workspace-")),
  };
}

/**
 * The scripted answers, by call order inside each battery:
 *   0 -> acts / a card
 *   1 -> one question / a decline
 *   2 -> prose / a block that is not a card
 * With 20 interpreter rows and 10 curator rows that is 7/7/6 and 4/3/3.
 */
function cyclingSender(calls: { interpreter: number; curator: number }) {
  return async (messages: readonly TurnMessage[]): Promise<TurnResult> => {
    if (isCuratorPrompt(messages)) {
      const at = calls.curator % 3;
      calls.curator += 1;
      if (at === 0) return { kind: "answer", text: cardAnswer("the slow card") };
      if (at === 1) {
        return {
          kind: "answer",
          text: "nothing here the map can use: it repeats the card the map already holds.",
        };
      }
      return {
        kind: "answer",
        text: FENCE + "json\n{}\n" + FENCE,
      };
    }
    const at = calls.interpreter % 3;
    calls.interpreter += 1;
    if (at === 0) return { kind: "answer", text: actsAnswer() };
    if (at === 1) return { kind: "answer", text: "which card did you mean?" };
    return { kind: "answer", text: "I cannot do that." };
  };
}

describe("the fixed battery", () => {
  test("is 20 phrasings and 10 replies, each run once", () => {
    expect(INTERPRETER_BATTERY.length).toBe(20);
    expect(CURATOR_BATTERY.length).toBe(10);
    expect(BATTERY_CALLS).toBe(30);
    expect(CHECK_DEFAULT_MAX_CALLS).toBe(BATTERY_CALLS);
  });

  test("every interpreter row is well formed and names a card or an absence", () => {
    const kinds = new Set<string>();
    const seen = new Set<string>();
    const perKind: Record<string, number> = {};
    for (const row of INTERPRETER_BATTERY) {
      expect(row.instruction.trim()).not.toBe("");
      expect(seen.has(row.instruction)).toBe(false);
      seen.add(row.instruction);
      kinds.add(row.kind);
      perKind[row.kind] = (perKind[row.kind] ?? 0) + 1;
    }
    // The four families the story names are all represented, and each one more
    // than once: a battery with one vague row would not say anything about them.
    expect([...kinds].sort()).toEqual([
      "ambiguous",
      "clear",
      "impossible",
      "vague",
    ]);
    for (const kind of kinds) expect(perKind[kind]).toBeGreaterThan(1);
    // At least one phrasing names each fixture card, so the digest matters.
    const text = INTERPRETER_BATTERY.map((row) => row.instruction).join(" ");
    expect(text).toContain(BATTERY_CARDS.commandCard.name);
    expect(text).toContain(BATTERY_CARDS.providerPanel.name);
    expect(text).toContain(BATTERY_CARDS.sendPath.name);
  });

  test("every curator row is well formed, and its caveat cue is what it claims", () => {
    const seen = new Set<string>();
    for (const row of CURATOR_BATTERY) {
      expect(row.reply.trim()).not.toBe("");
      expect(seen.has(row.reply)).toBe(false);
      seen.add(row.reply);
    }
    const byKind = new Map<string, (typeof CURATOR_BATTERY)[number]>();
    for (const row of CURATOR_BATTERY) byKind.set(row.kind, row);
    for (const kind of [
      "with a caveat",
      "with no caveat",
      "trivial",
      "repeats a card",
      "mostly hedging",
      "very long",
    ]) {
      expect(byKind.has(kind as never)).toBe(true);
    }
    // The app's OWN cue list decides this, never the label: these two rows are
    // the pair that makes the whole caveat column meaningful.
    expect(replyCarriedCaveat(byKind.get("with a caveat")!.reply)).toBe(true);
    expect(replyCarriedCaveat(byKind.get("with no caveat")!.reply)).toBe(false);
    expect(replyCarriedCaveat(byKind.get("mostly hedging")!.reply)).toBe(true);
    expect(replyCarriedCaveat(byKind.get("very long")!.reply)).toBe(true);
  });
});

describe("the flags", () => {
  test("--max-calls, --only and --out are read, and an unknown flag is refused", () => {
    expect(parseCheckArgs(["--yes"])).toEqual({
      yes: true,
      maxCalls: 30,
      only: null,
      out: null,
    });
    expect(parseCheckArgs(["--max-calls", "12", "--only", "curator"])).toEqual({
      yes: false,
      maxCalls: 12,
      only: "curator",
      out: null,
    });
    expect(parseCheckArgs(["--max-calls", "lots"])).toEqual({
      refused: "--max-calls needs a whole number of calls.",
    });
    expect(parseCheckArgs(["--only", "everything"])).toEqual({
      refused: "--only names interpreter or curator.",
    });
    expect(parseCheckArgs(["--spend"])).toEqual({
      refused: "there is no --spend flag here.",
    });
  });

  test("a report's file stamp is an ISO instant without colons", () => {
    expect(reportStamp(Date.UTC(2026, 10, 21, 16, 20, 12))).toBe(
      "2026-11-21T16-20-12Z",
    );
  });

  test("the provider row is read the way the app reads it", () => {
    const facts = providerFactsOf(
      configText(),
      JSON.stringify({ "fake-row": KEY }),
    );
    if ("refused" in facts) throw new Error(facts.refused);
    expect(facts.rowName).toBe("Fake Row");
    expect(facts.managerModelId).toBe("manager-model");
    expect(facts.taskModelId).toBe("task-model");
    expect(facts.route.kind).toBe("http");
  });

  test("a config with no row, no manager or no key is ONE sentence and no call", async () => {
    let calls = 0;
    const deps: ModelCheckDeps = {
      ...scriptedDeps(async () => {
        calls += 1;
        return { kind: "answer", text: actsAnswer() };
      }),
      readConfig: () => null,
    };
    const result = await runModelCheck(["--yes"], deps);
    expect(result.code).toBe(1);
    expect(calls).toBe(0);
    expect(result.report).toBeNull();
    expect(result.lines.join("\n")).toContain("no provider row is configured");
  });

  test("a missing key is ONE sentence and no call", async () => {
    let calls = 0;
    const deps: ModelCheckDeps = {
      ...scriptedDeps(async () => {
        calls += 1;
        return { kind: "answer", text: actsAnswer() };
      }),
      readSecrets: () => "{}",
    };
    const result = await runModelCheck(["--yes"], deps);
    expect(result.code).toBe(1);
    expect(calls).toBe(0);
    expect(result.lines.join("\n")).toContain("no key is kept");
  });
});

describe("the run", () => {
  test("without --yes the plan is printed, zero calls happen and nothing is written", async () => {
    const calls = { interpreter: 0, curator: 0 };
    const out = join(ROOT, "plan-only.md");
    const result = await runModelCheck(
      ["--out", out],
      scriptedDeps(cyclingSender(calls)),
    );
    expect(result.code).toBe(0);
    expect(calls.interpreter + calls.curator).toBe(0);
    expect(result.report).toBeNull();
    const printed = result.lines.join("\n");
    expect(printed).toContain("the battery: 20 interpreter phrasings + 10 curator replies");
    expect(printed).toContain("nothing was called");
    expect(() => readFileSync(out, "utf8")).toThrow();
  });

  test("--max-calls refuses before the first call", async () => {
    const calls = { interpreter: 0, curator: 0 };
    const result = await runModelCheck(
      ["--yes", "--max-calls", "5"],
      scriptedDeps(cyclingSender(calls)),
    );
    expect(result.code).toBe(1);
    expect(calls.interpreter + calls.curator).toBe(0);
    expect(result.report).toBeNull();
    expect(result.lines.join("\n")).toContain("past the cap of 5");
  });

  test("a scripted sender produces a report with the right counts", async () => {
    const calls = { interpreter: 0, curator: 0 };
    const out = join(ROOT, "full-check", "model-check.md");
    const result = await runModelCheck(
      ["--yes", "--out", out],
      scriptedDeps(cyclingSender(calls)),
    );
    expect(result.code).toBe(0);
    expect(calls.interpreter + calls.curator).toBe(30);
    const report = result.report;
    if (report === null) throw new Error("no report was written");

    // The plan was stated BEFORE the first call: the call line comes after the
    // battery and the cap, and the rows follow it.
    const printed = result.lines;
    const plannedAt = printed.findIndex((line) =>
      line.startsWith("about to make 30 call(s)"),
    );
    expect(plannedAt).toBeGreaterThan(0);
    expect(
      printed.findIndex((line) => line.startsWith("interpreter 1/20")),
    ).toBeGreaterThan(plannedAt);

    const markdown = readFileSync(out, "utf8");
    const json = JSON.parse(readFileSync(report.outJson, "utf8")) as {
      counts: {
        calls: number;
        interpreter: Record<string, number>;
        curator: Record<string, number>;
      };
      interpreter: unknown[];
      curator: unknown[];
    };
    expect(markdown).toContain("- calls made: 30");
    expect(json.counts.calls).toBe(30);
    expect(json.interpreter.length).toBe(20);
    expect(json.curator.length).toBe(10);
    expect(json.counts.interpreter).toEqual({
      acts: 7,
      question: 7,
      refusal: 6,
      error: 0,
    });
    expect(json.counts.curator).toEqual({
      card: 4,
      declined: 3,
      unusable: 3,
      error: 0,
    });
    // The counts the report prints are the counts the rows make.
    expect(markdown).toContain(
      "interpreter: acts 7 · question 7 · refusal 6 · provider error 0",
    );
    expect(markdown).toContain(
      "curator: card 4 · decline 3 · unusable 3 · provider error 0",
    );
    expect(markdown).toContain("### 1 · clear · 100 ms · acts (1)");
    expect(markdown).toContain("acts: map_overview");
    expect(markdown).toContain("question: which card did you mean?");
    // The card's LENGTH is reported in characters, never a grade.
    expect(markdown).toContain("characters, ");
    expect(markdown).toContain("card fields: title ");
    expect(markdown).toContain("longest card: ");
    // The two digests the prompts carried are in the report, from the temp
    // workspace, and they name the fixture cards.
    expect(markdown).toContain(BATTERY_CARDS.commandCard.name);
    expect(markdown).toContain(BATTERY_CARDS.ask.name);
  });

  test("--only runs one battery and reports only its rows", async () => {
    const calls = { interpreter: 0, curator: 0 };
    const out = join(ROOT, "only-interpreter", "model-check.md");
    const result = await runModelCheck(
      ["--yes", "--only", "interpreter", "--out", out],
      scriptedDeps(cyclingSender(calls)),
    );
    expect(result.code).toBe(0);
    expect(calls.interpreter + calls.curator).toBe(20);
    const json = JSON.parse(readFileSync(result.report!.outJson, "utf8")) as {
      counts: { calls: number };
      curator: unknown[];
    };
    expect(json.counts.calls).toBe(20);
    expect(json.curator.length).toBe(0);
  });

  test("the key never appears in a report or in a printed line", async () => {
    const calls = { interpreter: 0, curator: 0 };
    const out = join(ROOT, "key-check", "model-check.md");
    const result = await runModelCheck(
      ["--yes", "--out", out],
      scriptedDeps(cyclingSender(calls)),
    );
    const report = result.report;
    if (report === null) throw new Error("no report was written");
    for (const text of [
      report.markdown,
      report.json,
      readFileSync(out, "utf8"),
      readFileSync(report.outJson, "utf8"),
      result.lines.join("\n"),
    ]) {
      expect(text.includes(KEY)).toBe(false);
    }
  });

  test("a provider error is a row, not an abort", async () => {
    let seen = 0;
    const send = async (messages: readonly TurnMessage[]): Promise<TurnResult> => {
      seen += 1;
      if (isCuratorPrompt(messages)) {
        return { kind: "error", sentence: "the provider answered 500: it broke" };
      }
      return { kind: "answer", text: actsAnswer() };
    };
    const calls = { interpreter: 0, curator: 0 };
    const result = await runModelCheck(
      ["--yes", "--out", join(ROOT, "errors", "model-check.md")],
      scriptedDeps(send),
    );
    // 20 interpreter rows plus 10 curator rows all ran: none aborted the run.
    expect(seen).toBe(30);
    expect(result.code).toBe(0);
    expect(result.report).not.toBeNull();
    expect(result.report!.markdown).toContain("provider error 10");
    expect(result.report!.markdown).toContain("it broke");
  });

  test("an auth refusal stops the run with ONE sentence", async () => {
    let seen = 0;
    const send = async (): Promise<TurnResult> => {
      seen += 1;
      return {
        kind: "error",
        sentence: "the provider answered 401: the key was refused",
      };
    };
    const result = await runModelCheck(
      ["--yes", "--out", join(ROOT, "auth", "model-check.md")],
      scriptedDeps(send),
    );
    expect(seen).toBe(1);
    expect(result.code).toBe(1);
    expect(result.report).not.toBeNull();
    expect(result.report!.markdown).toContain("## the run stopped");
    const stopping = result.lines.filter((line) => line.startsWith("the run stopped:"));
    expect(stopping.length).toBe(1);
    expect(isAuthRefusal("the provider answered 401: the key was refused")).toBe(true);
    expect(isAuthRefusal("the provider answered 500: it broke")).toBe(false);
  });
});

describe("the fixtures", () => {
  test("the digest comes from a temporary workspace, through the app's parsers", () => {
    const workspace = mkdtempSync(join(ROOT, "workspace-"));
    const digests = buildFixtureDigests(workspace);
    expect(digests.interpreter).toContain(BATTERY_CARDS.commandCard.name);
    expect(digests.interpreter).toContain("wires: ");
    expect(digests.curator).toContain(BATTERY_CARDS.ask.name);
    expect(digests.curator).toContain("the ask being distilled now");
    expect(digests.curator).not.toBe("");
  });
});
