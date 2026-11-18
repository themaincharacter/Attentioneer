import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PROVIDER_CATALOG,
  catalogEntryForBaseUrl,
  catalogModelFill,
} from "../src/turn/providerCatalog";
import { customRow } from "../src/canvas/ProvidersPanel";
import { CLI_SPECS } from "../src/turn/cliSpecs";
import { LOCAL_SPECS } from "../src/turn/localSpecs";
import type {
  CliProviderRow,
  HttpProviderRow,
  LocalProviderRow,
} from "../src/turn/providers";

/**
 * STORY 15.14 — THE PROVIDER LIST LOOKS LIKE THE ONE EVERYONE KNOWS.
 *
 * The user's screenshots settle the shape, so what is pinned here is that shape
 * and the rules behind it, at the layers a test can hold:
 *
 *   1. ROWS: a status dot (an endpoint's key existence) and a Custom badge
 *      DERIVED from what the row already says, never a new record field;
 *   2. TWO TABS: "a known provider" and "a custom endpoint", behind a dashed
 *      "+ Add provider", with Cancel/Add at the footer of both; the custom tab
 *      is today's form, moved;
 *   3. THE MODELS BLOCK: every model the vendored models.dev export lists, each
 *      marked for tools and images; a tick copies the model's four fields (and
 *      the person can still change them);
 *   4. ONE WRITE PATH: no pick, tab or tick writes, requests or validates;
 *   5. TWO REFUSALS: no key echo and no retry/account rows.
 *
 * There is no DOM harness in this repo: behaviour is pinned through the
 * exported pure seams and source facts, and the layout through the sheet. The
 * window itself is the human's check.
 */

const APP = fileURLToPath(new URL("..", import.meta.url)).replace(/[\\/]$/, "");

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

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

function httpRow(baseUrl: string, id = "a-row"): HttpProviderRow {
  return {
    kind: "http",
    id,
    name: "A row",
    baseUrl,
    models: [
      {
        id: "qwen",
        name: "Qwen",
        capabilities: { tools: false, vision: false },
      },
    ],
  };
}

/* ------------------------------------------------------------------ *
 * 1. Rows: the dot and the Custom badge.
 * ------------------------------------------------------------------ */

describe("a row says key existence with a dot and provenance with Custom", () => {
  test("a catalogue base URL is not Custom; an endpoint the person typed is", () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(catalogEntryForBaseUrl(entry.baseUrl)?.id).toBe(entry.id);
      // Whitespace around a pasted URL is not a different endpoint.
      expect(catalogEntryForBaseUrl("  " + entry.baseUrl + "  ")?.id).toBe(
        entry.id,
      );
      expect(customRow(httpRow(entry.baseUrl))).toBe(false);
    }
    // The catalogue's entries are the only URLs it knows.
    expect(catalogEntryForBaseUrl("http://127.0.0.1:8080/v1")).toBeNull();
    expect(customRow(httpRow("http://127.0.0.1:8080/v1"))).toBe(true);
    // Editing a URL makes the row the person's own: the badge follows.
    const entry = PROVIDER_CATALOG[0];
    expect(customRow(httpRow(entry.baseUrl + "/"))).toBe(true);
  });

  test("a shipped spec is not Custom; a typed command or local row is", () => {
    const spec = CLI_SPECS[0];
    const cli: CliProviderRow = {
      kind: "cli",
      id: spec.id,
      name: spec.name,
      command: spec.command,
      versionArgs: [...spec.versionArgs],
      run: { args: [...spec.run.args], read: "stdout" },
      notes: spec.notes ?? "",
      models: [
        {
          id: "cli",
          name: "cli",
          capabilities: { tools: false, vision: false },
        },
      ],
    };
    expect(customRow(cli)).toBe(false);
    expect(customRow({ ...cli, id: "my-own-script" })).toBe(true);

    const local: LocalProviderRow = {
      kind: "local",
      id: LOCAL_SPECS[0].id,
      name: "Llama",
      command: LOCAL_SPECS[0].command,
      model: "/models/q.gguf",
      args: [...LOCAL_SPECS[0].args],
      idleMinutes: 10,
      notes: "",
      models: [
        {
          id: "q",
          name: "q",
          capabilities: { tools: false, vision: false },
        },
      ],
    };
    expect(customRow(local)).toBe(false);
    expect(customRow({ ...local, id: "my-other-model" })).toBe(true);
  });

  test("the badge sits on the row head, derived, never stored", () => {
    const head = panel.slice(
      panel.indexOf('className="providers-row-head"'),
      panel.indexOf("{editing === provider.id ? ("),
    );
    expect(head).toContain("providers-state-dot");
    expect(head).toContain("customRow(provider)");
    expect(head).toContain('className="providers-custom-badge"');
    expect(head).toContain(">Custom</span>");
    // NO new record field: the row shape is unchanged by this story.
    expect(panel).not.toContain("custom: true");
    expect(codeOf(source("turn/providers.ts"))).not.toContain("custom");
    expect(cssBlock(css, ".providers-custom-badge")).toContain("border:");
  });

  test("only an endpoint gets a dot: a command has no key of this kind", () => {
    const dotAt = panel.indexOf('"providers-state-dot " +');
    expect(panel.slice(dotAt - 120, dotAt)).toContain('provider.kind === "http"');
    // Existence is the whole claim (the masked prefix is refused below).
    expect(panelCode).toContain(
      'keys[provider.id] === true ? "is-set" : "is-missing"',
    );
  });
});

/* ------------------------------------------------------------------ *
 * 2. Two tabs, dashed button, footer on both.
 * ------------------------------------------------------------------ */

describe("the add form is a dashed button and a two-tab dialog", () => {
  test("the dashed button opens it, and Cancel closes it without writing", () => {
    expect(panel).toContain('className="providers-add-open"');
    expect(panel).toContain("+ Add provider");
    expect(panel).toContain("{!adding && (");
    expect(panel).toContain("{adding && (");
    const button = cssBlock(css, ".providers-add-open");
    expect(button).toContain("width: 100%");
    expect(button).toContain("dashed");
    // Cancel is one function: fields reset, dialog closed, no row touched.
    const close = panelCode.slice(
      panelCode.indexOf("function closeAddDialog"),
      panelCode.indexOf("function resetAddForm"),
    );
    expect(close).toContain("resetAddForm()");
    expect(close).toContain("setAdding(false)");
    expect(close).not.toMatch(/write\(|saveTurnSettings|validateProviderRow/);
    // Opening on the known tab is an endpoint: a stale CLI kind cannot leak in.
    const open = panelCode.slice(
      panelCode.indexOf("function openAddDialog"),
      panelCode.indexOf("function closeAddDialog"),
    );
    expect(open).toContain('setKind("http")');
    expect(open).toContain("resetAddForm()");
  });

  test("two tabs, with the two labels and the current one marked", () => {
    expect(panel).toContain('role="tablist"');
    expect(panel).toContain("a known provider");
    expect(panel).toContain("a custom endpoint");
    expect(panel).toContain('role="tab"');
    expect(panel).toContain('aria-selected={tab === "known"}');
    expect(panel).toContain('aria-selected={tab === "custom"}');
    expect(cssBlock(css, ".providers-tab.is-current")).toContain(
      "border-color:",
    );
  });

  test("the custom tab is today's form, moved: kind and fields survive", () => {
    const custom = panel.slice(
      panel.indexOf("TODAY'S FORM, MOVED"),
      panel.indexOf(
        '<span>name</span>',
        panel.indexOf("TODAY'S FORM, MOVED"),
      ),
    );
    expect(custom).toContain('aria-label="the kind of provider"');
    for (const kind of ["an HTTP endpoint", "a command (CLI)", "a model on this machine"]) {
      expect(custom).toContain(kind);
    }
    // The four entry fields are shared by both tabs, unchanged.
    for (const field of [
      '<span>base URL</span>',
      "the key (kept; never shown again)",
      '<span>model id</span>',
      '<span>model name</span>',
    ]) {
      expect(panel).toContain(field);
    }
    // Choosing it clears a catalogue fill, exactly as the old picker did.
    expect(panel).toContain("applyCatalogFill(CUSTOM_FILL)");
  });

  test("Cancel and Add sit at the footer of BOTH tabs", () => {
    expect(panel).toContain('className="providers-add-footer"');
    expect(cssBlock(css, ".providers-add-footer")).toContain(
      "justify-content: flex-end",
    );
    // One footer after the shared branch, so it is not per-tab.
    const footerAt = panel.indexOf('className="providers-add-footer"');
    expect(panel.slice(footerAt)).toContain('className="providers-cancel"');
    expect(panel.slice(footerAt)).toContain('className="providers-add-save"');
    expect(panel.slice(footerAt)).toContain("void addProvider()");
  });
});

/* ------------------------------------------------------------------ *
 * 3. The Models block: the export's list, its marks, and the tick.
 * ------------------------------------------------------------------ */

describe("the Models block lists the picked provider's export", () => {
  test("every entry carries EVERY exported model with both capabilities", () => {
    const exportText = readFileSync(
      join(APP, "src", "turn", "modelsDevCatalog.json"),
      "utf8",
    );
    const exported = JSON.parse(exportText) as {
      providers: {
        id: string;
        models: {
          id: string;
          name: string;
          tool_call: boolean;
          attachment: boolean;
          reasoning: boolean;
        }[];
      }[];
    };
    for (const entry of PROVIDER_CATALOG) {
      const provider = exported.providers.find((one) => one.id === entry.id);
      if (provider === undefined) throw new Error("not in export: " + entry.id);
      expect(entry.models.map((model) => model.id)).toEqual(
        provider.models.map((model) => model.id),
      );
      expect(entry.models.map((model) => model.name)).toEqual(
        provider.models.map((model) => model.name),
      );
      for (const [at, model] of entry.models.entries()) {
        expect(model.toolCall).toBe(provider.models[at].tool_call === true);
        expect(model.attachment).toBe(
          provider.models[at].attachment === true,
        );
        expect(model.reasoning).toBe(provider.models[at].reasoning === true);
        expect(model.id.trim()).not.toBe("");
        expect(model.name.trim()).not.toBe("");
      }
    }
  });

  test("a tick presets the model id, name, tools and vision from the export", () => {
    for (const entry of PROVIDER_CATALOG) {
      const model = entry.models.find((one) => one.toolCall) ?? entry.models[0];
      expect(catalogModelFill(model)).toEqual({
        modelId: model.id,
        modelName: model.name,
        tools: model.toolCall === true,
        vision: model.attachment === true,
      });
    }
  });

  test("a tick only sets fields: it writes, requests and validates nothing", () => {
    const tick = panelCode.slice(
      panelCode.indexOf("function tickCatalogModel"),
      panelCode.indexOf("function chooseTab"),
    );
    for (const setter of [
      "setModelId(",
      "setModelName(",
      "setTools(",
      "setVision(",
    ]) {
      expect(tick).toContain(setter);
    }
    for (const forbidden of [
      "write(",
      "saveTurnSettings",
      "setSecret",
      "readSecret",
      "askEndpoint",
      "fetchModels",
      "validateProviderRow",
      "addRowThenKey",
    ]) {
      expect(tick).not.toContain(forbidden);
    }
  });

  test("the models block is data-fed, marked, and scrolls its bound", () => {
    const block = panel.slice(
      panel.indexOf('className="providers-models-block"'),
      panel.indexOf('className="providers-add-model"'),
    );
    expect(block).toContain("pickedCatalog.models.map(");
    expect(block).toContain("model.toolCall");
    expect(block).toContain("model.attachment");
    expect(block).toContain("tickCatalogModel(model)");
    const list = cssBlock(css, ".providers-catalog-models");
    expect(list).toContain("max-height:");
    expect(list).toContain("overflow-y: auto");
  });

  test("the person can still change what the tick filled", () => {
    // The same form fields the custom tab had are still editable below.
    expect(panelCode).toContain("setModelId(e.target.value)");
    expect(panelCode).toContain("setModelName(e.target.value)");
    expect(panelCode).toContain("setTools(e.target.checked)");
    expect(panelCode).toContain("setVision(e.target.checked)");
  });
});

/* ------------------------------------------------------------------ *
 * 4. One validator, one write queue.
 * ------------------------------------------------------------------ */

describe("the known-provider tab adds through the same path as before", () => {
  test("the add button is still the only write, through addRowThenKey", () => {
    const add = panelCode.slice(
      panelCode.indexOf("async function addProvider"),
      panelCode.indexOf("function useLocalPreset"),
    );
    expect(add).toContain("addDraft()");
    expect(add).toContain("addRowThenKey(");
    expect(add).toContain("() => commit(read.row)");
    expect(add).toContain("setSecret,");
    // ONE writer in the panel: write() -> saveTurnSettings.
    expect(panelCode.split("saveTurnSettings(").length - 1).toBe(1);
  });

  test("no pick, tab, model tick or dialog open writes or requests", () => {
    const slice = (from: string, to: string) =>
      panelCode.slice(panelCode.indexOf(from), panelCode.indexOf(to));
    const handlers = [
      slice("function pickCatalog", "function tickCatalogModel"),
      slice("function tickCatalogModel", "function chooseTab"),
      slice("function chooseTab", "function openAddDialog"),
      slice("function openAddDialog", "function closeAddDialog"),
    ].join("\n");
    expect(handlers).not.toMatch(
      /write\(|saveTurnSettings|validateProviderRow|addRowThenKey|setSecret|readSecret|fetch\(|askEndpoint/,
    );
  });

  test("the fetch verb stays on the row for what the export does not list", () => {
    expect(panel).toContain('className="providers-fetch"');
    expect(panel).toContain("fetch models");
    expect(panel).toContain("modelsFetchProblem(provider)");
    expect(panel).toContain("MODEL_LIST_SENTENCES.noModels");
  });
});

/* ------------------------------------------------------------------ *
 * 5. The two refusals: no key echo, no retry/account sprawl.
 * ------------------------------------------------------------------ */

describe("the reference app's key echo, retries and accounts are not copied", () => {
  test("no key echo: the row says a key is set and nothing more", () => {
    // The rules is stated where the next editor will read it.
    expect(panel).toContain("NO KEY ECHO");
    expect(panel).toContain("masked prefix is NOT copied");
    // No prefix, length, last-four or masked value is ever made.
    expect(panelCode).not.toMatch(/masked|last four|slice\(0, ?4\)/i);
    expect(panelCode).toContain('"a key is set"');
    expect(panelCode).toContain('"no key is set"');
    // The store is asked only whether a key exists.
    expect(panel).toContain("await keyExists(provider.id)");
  });

  test("no retry policy and no account or signed-in row", () => {
    expect(panelCode).not.toMatch(/\bretry\b/i);
    expect(panelCode).not.toMatch(/signed in|sign in to|account/i);
  });
});

/* ------------------------------------------------------------------ *
 * 6. No dead CSS from the old single-tab form.
 * ------------------------------------------------------------------ */

describe("the sheet has no leftovers from the old single-tab form", () => {
  test("the panel's retired heading and close rules are gone", () => {
    for (const selector of [
      ".providers-head",
      ".providers-title",
      ".providers-close",
    ]) {
      expect(css).not.toContain(selector + " {");
    }
  });

  test("every providers- rule still has a user in the panel", () => {
    const classes = new Set(
      [...css.matchAll(/\.(providers-[a-z0-9-]+)/g)].map((match) => match[1]),
    );
    for (const className of classes) {
      expect({ className, used: panel.includes(className) }).toEqual({
        className,
        used: true,
      });
    }
  });
});
