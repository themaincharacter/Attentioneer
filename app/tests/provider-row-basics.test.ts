import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ADD_KEY_SENTENCES,
  ProvidersPanel,
  addRowThenKey,
} from "../src/canvas/ProvidersPanel";
import {
  askProviderModels,
  connectionSentence,
  type ModelFetchResult,
} from "../src/turn/modelFetch";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SecretWrite } from "../src/lib/secret";

/**
 * Story 15.12 — the provider row does the basics.
 *
 * The user's report, at the layer a test can hold:
 *   - "I don't see where I enter the key": the ADD form carries an optional,
 *     write-only key field, and the row's key line is always on screen with a
 *     verb that names the action (set / replace), not hidden behind edit;
 *   - a REFUSED key write leaves the row standing and says one sentence;
 *   - "I don't see a quick test connection button": ONE test verb beside fetch
 *     models, the SAME ask and the same key, measuring the answer and saying
 *     one sentence — a read that writes nothing;
 *   - the screenshot's mashed text: the shipped rows are flex containers with
 *     a visible gap, and the command stays monospaced.
 *
 * The panel is not mounted here (no window, no Tauri): what is behavioural is
 * pinned through the exported pure seams, and what is layout is pinned by
 * reading the sheet. The real sidecar's three outcomes are proven in
 * fetch-models.test.ts, against the same local stub.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

/** One rule's body from the sheet, by its exact selector line. */
function cssBlock(css: string, selector: string): string {
  const start = css.indexOf("\n" + selector + " {");
  if (start < 0) throw new Error("no rule for " + selector);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  return css.slice(open + 1, close);
}

const panel = source("canvas/ProvidersPanel.tsx");
const panelCode = codeOf(panel);
const css = source("canvas/canvas.css");
const KEY = "sk-story-12-never-said";

/* ------------------------------------------------------------------ *
 * The one ask: measured, and the same ask for both verbs.
 * ------------------------------------------------------------------ */

describe("the test verb asks once, measures, and says one sentence", () => {
  test("a success is one sentence with the elapsed time and the count", async () => {
    let asked = 0;
    const times = [1_000, 1_037];
    const answer = await askProviderModels(
      async () => {
        asked += 1;
        return { kind: "models", ids: ["a", "b"], offered: 2 };
      },
      { baseUrl: "https://host/v1", apiKey: KEY },
      () => times.shift() as number,
    );
    expect(asked).toBe(1);
    expect(answer.elapsedMs).toBe(37);
    expect(connectionSentence(answer)).toBe(
      "the endpoint answered in 37 ms and offered 2 models",
    );
    expect(connectionSentence(answer)).not.toContain(KEY);
  });

  test("a failure is the EXISTING scrubbed sentence, not a second wording", async () => {
    const refused = "the provider answered 401 (the key was refused)";
    expect(
      connectionSentence({
        result: { kind: "error", sentence: refused },
        elapsedMs: 9,
      }),
    ).toBe(refused);
    expect(
      connectionSentence({
        result: { kind: "timeout", sentence: "the provider did not answer in time" },
        elapsedMs: 20_000,
      }),
    ).toBe("the provider did not answer in time");
  });

  test("a clock that goes backwards cannot claim a negative wait", async () => {
    const times = [500, 400];
    const answer = await askProviderModels(
      async (): Promise<ModelFetchResult> => ({
        kind: "models",
        ids: ["a"],
        offered: 1,
      }),
      { baseUrl: "https://host/v1", apiKey: "" },
      () => times.shift() as number,
    );
    expect(answer.elapsedMs).toBe(0);
    expect(connectionSentence(answer)).toBe(
      "the endpoint answered in 0 ms and offered 1 models",
    );
  });
});

/* ------------------------------------------------------------------ *
 * The add-with-key path: row first, then the key; a refusal keeps the row.
 * ------------------------------------------------------------------ */

describe("add writes the row first and the key second", () => {
  function recorder(answer: SecretWrite, saved = true) {
    const calls: string[] = [];
    return {
      calls,
      save: async (): Promise<boolean> => {
        calls.push("save");
        return saved;
      },
      keep: async (providerId: string, secret: string): Promise<SecretWrite> => {
        calls.push(`keep:${providerId}:${secret}`);
        return answer;
      },
    };
  }

  test("the row is saved before the key is even offered to the store", async () => {
    const lines = recorder({ kind: "kept" });
    const outcome = await addRowThenKey(
      "hosted",
      KEY,
      lines.save,
      lines.keep,
    );
    expect(outcome).toEqual({ kind: "added", key: "kept" });
    expect(lines.calls).toEqual(["save", `keep:hosted:${KEY}`]);
  });

  test("a refused key does NOT roll the row back: one sentence, row kept", async () => {
    const lines = recorder({ kind: "refused", sentence: "the keychain said no" });
    const outcome = await addRowThenKey("hosted", KEY, lines.save, lines.keep);
    expect(outcome).toEqual({
      kind: "added",
      key: "refused",
      sentence: ADD_KEY_SENTENCES.notKept,
    });
    if (outcome.kind !== "added" || outcome.key !== "refused") {
      throw new Error("unreachable");
    }
    expect(outcome.sentence).toBe(
      "the provider is kept; the key was not kept",
    );
    // One sentence: no store text, no key, no second clause.
    expect(outcome.sentence).not.toContain(".");
    expect(outcome.sentence).not.toContain(KEY);
    expect(outcome.sentence).not.toContain("keychain said no");
    // The row write was made and nothing undid it.
    expect(lines.calls).toEqual(["save", `keep:hosted:${KEY}`]);
  });

  test("a row the store refuses saves no key at all", async () => {
    const lines = recorder({ kind: "kept" }, false);
    const outcome = await addRowThenKey("hosted", KEY, lines.save, lines.keep);
    expect(outcome).toEqual({ kind: "row-refused" });
    expect(lines.calls).toEqual(["save"]);
  });

  test("an empty key field is nothing to keep, and the row still goes in", async () => {
    for (const typed of ["", "   "]) {
      const lines = recorder({ kind: "kept" });
      const outcome = await addRowThenKey("hosted", typed, lines.save, lines.keep);
      expect(outcome).toEqual({ kind: "added", key: null });
      expect(lines.calls).toEqual(["save"]);
    }
  });
});

/* ------------------------------------------------------------------ *
 * The form and the row, as source facts.
 * ------------------------------------------------------------------ */

describe("the add form has the key, and nothing is ever filled from the store", () => {
  test("the key field is optional and write-only", () => {
    expect(panel).toContain("the key (kept; never shown again)");
    expect(panel).toContain('aria-label="the key to keep with the new provider"');
    expect(panel).toContain("value={addKey}");
    expect(panel).toContain("setAddKey(e.target.value)");
    // Never filled from the store: the only writers are the typing handler and
    // the reset to "", exactly like the row's key field.
    expect(panelCode).not.toMatch(/setAddKey\((?!e\.target\.value|""\))/);
    expect(panelCode).not.toMatch(/setAddKey\((key|secret)/);
    expect(panelCode).not.toMatch(/setKeyDraft\((key|secret)/);
  });

  test("the row's key line is always on screen, with the verb that names the action", () => {
    const block = panel.slice(
      panel.indexOf('className="providers-key-state"'),
      panel.indexOf('className="providers-fetch"'),
    );
    // Not behind edit: the block's only gate is the row KIND.
    expect(block).not.toContain("editing");
    expect(panel).toContain('"replace key"');
    expect(panel).toContain('"set a key"');
    expect(panel).toContain('"a key is set"');
    expect(panel).toContain('"no key is set"');
  });

  test("the store sentence sits beside both key fields, in the same words", () => {
    // The top line, the row's key editor, and the add form's key field.
    expect(panel.split("secretStatusWords(store)").length - 1).toBeGreaterThanOrEqual(3);
    expect(panel.split('className="providers-key-store"').length - 1).toBe(2);
    expect(cssBlock(css, ".providers-key-store")).toContain("color:");
  });

  test("the add path goes row-then-key through the one helper", () => {
    const add = panelCode.slice(
      panelCode.indexOf("async function addProvider"),
      panelCode.indexOf("function useLocalPreset"),
    );
    expect(add).toContain("addRowThenKey(");
    expect(add).toContain("() => commit(read.row)");
    expect(add).toContain("setSecret,");
    // A refused key is a sentence; the row is never removed to hide it.
    expect(add).not.toContain("withoutProvider(");
    expect(add).toContain("outcome.sentence");
    // The one sentence is the helper's, so both add paths cannot drift.
    const helper = panelCode.slice(
      panelCode.indexOf("export async function addRowThenKey"),
      panelCode.indexOf("const DEFAULT_LOCAL_SPEC"),
    );
    expect(helper).toContain("ADD_KEY_SENTENCES.notKept");
  });
});

describe("the test verb is the fetch's own path, and writes nothing", () => {
  test("there is exactly one key read in the panel: both verbs go through it", () => {
    const reads = panelCode.split("readSecret(").length - 1;
    expect(reads).toBe(1);
    const fetch = panelCode.slice(
      panelCode.indexOf("async function fetchModelsForRow"),
      panelCode.indexOf("async function askEndpoint"),
    );
    const test = panelCode.slice(
      panelCode.indexOf("async function runTest"),
      panelCode.indexOf("function clearFetched"),
    );
    expect(fetch).toContain("askEndpoint(row)");
    expect(test).toContain("askEndpoint(row)");
  });

  test("a test adds nothing and changes no row", () => {
    const test = panelCode.slice(
      panelCode.indexOf("async function runTest"),
      panelCode.indexOf("function clearFetched"),
    );
    expect(test).not.toContain("write(");
    expect(test).not.toContain("setLists(");
    expect(test).not.toContain("setTicks(");
    expect(test).not.toContain("setSettings(");
    expect(test).toContain("modelsFetchProblem(row)");
    expect(panel).toContain("connectionSentence(");
    // The button exists and is disabled while another ask is in flight.
    expect(panel).toContain('className="providers-test"');
    expect(panel).toContain('"testing…" : "test"');
  });

  test("a key just kept is tested, and the button stays for a re-test", () => {
    const keep = panelCode.slice(
      panelCode.indexOf("async function keepKey"),
      panelCode.indexOf("async function choose"),
    );
    expect(keep).toContain("runTest(row)");
    const add = panelCode.slice(
      panelCode.indexOf("async function addProvider"),
      panelCode.indexOf("function useLocalPreset"),
    );
    expect(add).toContain("runTest(read.row)");
    expect(panel.split("void runTest(").length - 1).toBeGreaterThanOrEqual(1);
    // An edited URL forgets the old sentence rather than showing it against
    // the new endpoint.
    const edit = panelCode.slice(
      panelCode.indexOf("async function saveEdit"),
      panelCode.indexOf("async function addModel"),
    );
    expect(edit).toContain("setTestNotes(");
  });
});

/* ------------------------------------------------------------------ *
 * The layout fix: the shipped rows breathe, the command stays typed.
 * ------------------------------------------------------------------ */

describe("the shipped rows are a flex row with a visible gap", () => {
  test("name, command and note each have their own place", () => {
    const row = cssBlock(css, ".providers-shipped-row");
    expect(row).toContain("display: flex");
    expect(row).toMatch(/gap:\s*[1-9]/);
    // The container stacks the rows rather than running them together.
    expect(cssBlock(css, ".providers-shipped")).toContain("flex-direction: column");
    // The command is typed, so it reads as code.
    expect(cssBlock(css, ".providers-shipped-command")).toContain(
      "font-family: ui-monospace",
    );
    expect(cssBlock(css, ".providers-shipped-notes")).toContain("flex: 1 1");
  });

  test("the row header and the model list already had their gaps: kept", () => {
    expect(cssBlock(css, ".providers-row-head")).toContain("display: flex");
    expect(cssBlock(css, ".providers-row-head")).toMatch(/gap:\s*[1-9]/);
    expect(cssBlock(css, ".providers-model")).toContain("display: flex");
    expect(cssBlock(css, ".providers-model")).toMatch(/gap:\s*[1-9]/);
    // And the markup keeps the classes the sheet now styles.
    expect(panel).toContain('className="providers-shipped-row"');
    expect(panel).toContain('className="providers-shipped-name"');
    expect(panel).toContain('className="providers-shipped-command"');
    expect(panel).toContain('className="providers-shipped-notes"');
  });

  test("the add form's key field sits between the base URL and the model", () => {
    const form = panel.slice(
      panel.indexOf("add a provider"),
      panel.indexOf("commands the app ships as data"),
    );
    const baseAt = form.indexOf('placeholder="http://127.0.0.1:8080/v1"');
    const keyAt = form.indexOf("the key (kept; never shown again)");
    const modelAt = form.indexOf('className="providers-add-model"');
    expect(baseAt).toBeGreaterThan(-1);
    expect(keyAt).toBeGreaterThan(baseAt);
    expect(modelAt).toBeGreaterThan(keyAt);
  });
});

/* ------------------------------------------------------------------ *
 * The panel still renders without a store (nothing is asked on the server).
 * ------------------------------------------------------------------ */

describe("the panel still renders before the store answers", () => {
  test("the status line is there and no key value is in the markup", () => {
    const html = renderToStaticMarkup(createElement(ProvidersPanel, {}));
    expect(html).toContain("providers-status");
    expect(html).toContain("asking where keys live");
    expect(html).not.toContain(KEY);
  });
});
