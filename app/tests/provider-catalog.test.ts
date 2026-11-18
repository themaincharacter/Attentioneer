import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CUSTOM_CATALOG_ID,
  CUSTOM_FILL,
  PROVIDER_CATALOG,
  catalogEntry,
  catalogFill,
  catalogLabel,
} from "../src/turn/providerCatalog";

/**
 * STORY 15.13 — A PROVIDER IS PICKED, NOT TYPED.
 *
 * Four things are pinned:
 *
 *   1. The catalogue is DATA: a name, an https base URL, a note, a source and
 *      the unverified flag on every entry; the base URLs are exactly the
 *      spec's table (the only place they may be written).
 *   2. The label marks what the data says is unverified — never a product.
 *   3. A pick FILLS the form and focuses the key field; "a custom endpoint"
 *      clears the fill back to today's empty form; a pick makes no request,
 *      validates nothing and adds nothing.
 *   4. A GREP over every window and sidecar module finds no catalogue base URL
 *      outside this module, so the turn path cannot grow a hard-coded endpoint.
 *
 * The panel is not mounted (no window, no Tauri): what is behavioural is
 * pinned through the exported pure fill, and what is wiring is pinned by
 * reading the panel's source. Naming a base URL is allowed HERE, in the
 * catalogue's own test — the constraint is about the modules that do the work.
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

/* ------------------------------------------------------------------ *
 * 1. The catalogue is data, and the table is the spec's.
 * ------------------------------------------------------------------ */

describe("the catalogue is honest data", () => {
  test("every entry is the spec's row: a name, an https base URL, a note, a source", () => {
    expect(PROVIDER_CATALOG.map((entry) => entry.id)).toEqual([
      "deepseek",
      "openai",
      "opencode-go",
      "opencode-payg",
      "opencode-zen",
      "groq",
      "openrouter",
      "mistral",
      "together",
      "cerebras",
      "moonshot",
      "xai",
    ]);
    for (const entry of PROVIDER_CATALOG) {
      expect(entry.name.trim()).not.toBe("");
      expect(entry.baseUrl.trim()).toBe(entry.baseUrl);
      expect(new URL(entry.baseUrl).protocol).toBe("https:");
      expect(entry.note.trim().length).toBeGreaterThan(20);
      expect(entry.source.trim().length).toBeGreaterThan(10);
      expect(entry.id).toBe(entry.id.trim());
    }
  });

  test("the base URLs are exactly the story's table, one per entry", () => {
    const table: Record<string, string> = {
      deepseek: "https://api.deepseek.com/v1",
      openai: "https://api.openai.com/v1",
      "opencode-go": "https://opencode.ai/inference/go/openai/v1",
      "opencode-payg": "https://opencode.ai/inference/openai/v1",
      "opencode-zen": "https://opencode.ai/zen/v1",
      groq: "https://api.groq.com/openai/v1",
      openrouter: "https://openrouter.ai/api/v1",
      mistral: "https://api.mistral.ai/v1",
      together: "https://api.together.xyz/v1",
      cerebras: "https://api.cerebras.ai/v1",
      moonshot: "https://api.moonshot.ai/v1",
      xai: "https://api.x.ai/v1",
    };
    expect(PROVIDER_CATALOG.map((entry) => [entry.id, entry.baseUrl])).toEqual(
      Object.entries(table),
    );
    // The OpenCode split the docs insist on: Go and pay-as-you-go are not the
    // same endpoint.
    expect(catalogEntry("opencode-go")?.baseUrl).not.toBe(
      catalogEntry("opencode-payg")?.baseUrl,
    );
  });

  test("every entry is unverified until a person's account answers", () => {
    expect(PROVIDER_CATALOG.every((entry) => entry.verified === false)).toBe(true);
    for (const entry of PROVIDER_CATALOG) {
      expect(entry).not.toHaveProperty("apiKey");
      expect(JSON.stringify(entry)).not.toContain("sk-");
    }
  });

  test("a model example, when present, names both fields and never a key", () => {
    for (const entry of PROVIDER_CATALOG) {
      if (entry.modelExample === undefined) continue;
      expect(entry.modelExample.id.trim()).not.toBe("");
      expect(entry.modelExample.name.trim()).not.toBe("");
    }
  });
});

/* ------------------------------------------------------------------ *
 * 2. The unverified mark comes from the data.
 * ------------------------------------------------------------------ */

describe("the label marks what the data says is unverified", () => {
  test("every entry renders its mark, and only a verified copy loses it", () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(catalogLabel(entry)).toBe(entry.name + " (unverified)");
      expect(catalogLabel({ ...entry, verified: true })).toBe(entry.name);
    }
  });

  test("the picker builds its labels from the rows, never a name", () => {
    expect(panel).toContain("PROVIDER_CATALOG.map(");
    expect(panel).toContain("catalogLabel(entry)");
    // Both choices the story names are offered.
    expect(panel).toContain("a custom endpoint");
    expect(panel).toContain("a known provider");
    expect(panel).toContain("CUSTOM_CATALOG_ID");
  });
});

/* ------------------------------------------------------------------ *
 * 3. A pick fills; the custom choice clears; nothing is requested or added.
 * ------------------------------------------------------------------ */

describe("a pick fills the form and focuses the key field", () => {
  test("each entry's fill is its name, base URL and example model", () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(catalogFill(entry)).toEqual({
        name: entry.name,
        baseUrl: entry.baseUrl,
        modelId: entry.modelExample?.id ?? "",
        modelName: entry.modelExample?.name ?? "",
      });
    }
  });

  test("a custom endpoint is today's empty form", () => {
    expect(catalogEntry(CUSTOM_CATALOG_ID)).toBeNull();
    expect(catalogEntry("not-a-provider")).toBeNull();
    expect(CUSTOM_FILL).toEqual({
      name: "",
      baseUrl: "",
      modelId: "",
      modelName: "",
    });
  });

  test("the pick handler applies the fill, clears a pasted key and focuses", () => {
    const pick = panelCode.slice(
      panelCode.indexOf("function pickCatalog"),
      panelCode.indexOf("function addDraft"),
    );
    expect(pick).toContain("catalogEntry(entryId)");
    expect(pick).toContain("catalogFill(entry)");
    expect(pick).toContain("CUSTOM_FILL");
    expect(pick).toContain("applyCatalogFill(");
    expect(pick).toContain("setAddKey(\"\")");
    expect(pick).toContain("keyFieldRef.current?.focus()");
    const apply = panelCode.slice(
      panelCode.indexOf("function applyCatalogFill"),
      panelCode.indexOf("function addDraft"),
    );
    expect(apply).toContain("setName(fill.name)");
    expect(apply).toContain("setBaseUrl(fill.baseUrl)");
    expect(apply).toContain("setModelId(fill.modelId)");
    expect(apply).toContain("setModelName(fill.modelName)");
  });

  test("NO request, NO validation, NO automatic add on a pick", () => {
    const pick = panelCode.slice(
      panelCode.indexOf("function pickCatalog"),
      panelCode.indexOf("function addDraft"),
    );
    expect(pick).not.toMatch(
      /askEndpoint|fetchModels|setSecret|saveTurnSettings|addRowThenKey|commit\(|write\(|validateProviderRow/,
    );
    // The only things a pick does are field setters, the key reset and focus.
    expect(pick).toContain("setCatalogId(entryId)");
    expect(pick).toContain("setSentence(null)");
  });

  test("the key field the pick focuses is the add form's own", () => {
    const keyInput = panel.slice(
      panel.indexOf("value={addKey}"),
      panel.indexOf("value={addKey}") + 300,
    );
    expect(keyInput).toContain('aria-label="the key to keep with the new provider"');
    expect(keyInput).toContain("ref={keyFieldRef}");
    // The one key field in the add form, never filled from a store.
    expect(panelCode).not.toMatch(/setAddKey\((key|secret)/);
    expect(panelCode).not.toMatch(/setAddKey\((?!e\.target\.value|""\))/);
  });

  test("the fields stay editable after a pick", () => {
    for (const setter of [
      "setName(e.target.value)",
      "setBaseUrl(e.target.value)",
      "setModelId(e.target.value)",
      "setModelName(e.target.value)",
    ]) {
      expect(panelCode).toContain(setter);
    }
    // A pick resets the picker after the form is cleared, so the next add
    // starts from the custom endpoint again.
    const add = panelCode.slice(
      panelCode.indexOf("async function addProvider"),
      panelCode.indexOf("function useLocalPreset"),
    );
    expect(add).toContain("setCatalogId(CUSTOM_CATALOG_ID)");
  });
});

/* ------------------------------------------------------------------ *
 * 4. The row's key state is a dot, and the add path stays the only write.
 * ------------------------------------------------------------------ */

describe("a row says its key state with a dot, and edits inline", () => {
  test("the dot is set or missing, and only endpoint rows get one", () => {
    expect(panel).toContain('"providers-state-dot " +');
    expect(panelCode).toContain(
      'keys[provider.id] === true ? "is-set" : "is-missing"',
    );
    // A green dot would be a claim this app cannot make for a command.
    const dotAt = panel.indexOf('"providers-state-dot " +');
    expect(panel.slice(dotAt - 120, dotAt)).toContain(
      'provider.kind === "http"',
    );
    expect(cssBlock(css, ".providers-state-dot")).toContain("border-radius: 50%");
    expect(cssBlock(css, ".providers-state-dot.is-set")).toContain("background:");
    expect(cssBlock(css, ".providers-state-dot.is-missing")).toContain("background:");
  });

  test("the row's editor expands in place with save and cancel", () => {
    expect(panel).toContain("editing === provider.id ? (");
    expect(panel).toContain('className="providers-edit"');
    expect(panel).toContain('className="providers-save"');
    expect(panel).toContain('className="providers-cancel"');
  });
});

/* ------------------------------------------------------------------ *
 * 5. The one grep: no base URL outside the catalogue data.
 * ------------------------------------------------------------------ */

describe("no catalogue base URL appears outside providerCatalog.ts", () => {
  const DATA = join(APP, "src", "turn", "providerCatalog.ts");
  // The catalogue's own test may name the URLs; no other file may.
  const SELF = fileURLToPath(import.meta.url);
  const SKIP = new Set(["node_modules", "dist", ".git"]);

  function sources(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        sources(full, out);
        continue;
      }
      if (!/\.(ts|tsx)$/.test(entry.name)) continue;
      out.push(full);
    }
    return out;
  }

  test("the scan covers the panel, the turn path and the sidecar", () => {
    const files = sources(APP);
    for (const rel of [
      "src/turn/providerCatalog.ts",
      "src/canvas/ProvidersPanel.tsx",
      "src/turn/providers.ts",
      "src/turn/modelFetch.ts",
      "src/turn/egress.ts",
      "sidecar/runs.ts",
    ]) {
      expect(files.map((file) => file.slice(APP.length + 1))).toContain(rel);
    }
    expect(files).toContain(DATA);
  });

  test("no module but the data file writes a catalogue endpoint", () => {
    const files = sources(APP);
    const urls = PROVIDER_CATALOG.map((entry) => entry.baseUrl);
    const hits: string[] = [];
    for (const file of files) {
      if (file === DATA || file === SELF) continue;
      const text = readFileSync(file, "utf8");
      for (const url of urls) {
        if (text.includes(url)) {
          hits.push(file.slice(APP.length + 1) + " -> " + url);
        }
      }
    }
    expect(hits).toEqual([]);
    // POSITIVE CONTROL: the data file is where they belong, and it has them.
    const data = readFileSync(DATA, "utf8");
    for (const url of urls) expect(data).toContain(url);
  });
});
