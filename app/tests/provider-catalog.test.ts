import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CATALOG_SOURCE,
  CUSTOM_CATALOG_ID,
  CUSTOM_FILL,
  PROVIDER_CATALOG,
  catalogEntry,
  catalogFill,
  catalogLabel,
} from "../src/turn/providerCatalog";
import {
  ALLOWLIST,
  API_FALLBACK,
  CatalogRefused,
  MODELS_DEV_URL,
  parseExport,
  projectCatalog,
  refreshCatalog,
  summaryOf,
  type CatalogExport,
} from "../scripts/models-dev-catalog";

/**
 * STORY 15.15 — THE CATALOGUE COMES FROM models.dev.
 *
 * Five things are pinned:
 *
 *   1. The shipped list is a PROJECTION of the committed export — same ids,
 *      names, base URLs, key variables, docs and example models — and the
 *      export is a small, curated file, not a 300-provider dump.
 *   2. The example model follows the stated rule (first with tool-use, else
 *      the first) and its capabilities ride into the form's fill.
 *   3. The label still marks every entry unverified; a pick still fills and
 *      focuses, and still makes no request.
 *   4. NO runtime module fetches models.dev (or even names its endpoint); the
 *      refresh script is the only network in the project.
 *   5. The script REFUSES an empty or malformed payload and writes nothing;
 *      its summary says what changed.
 *
 * The panel is not mounted (no window, no Tauri): behaviour is pinned through
 * exported pure functions, wiring by reading the panel's source. Puppeteer is
 * not needed and no test touches the network.
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

/** The committed export, read as the app's data. */
const EXPORT_TEXT = readFileSync(
  join(APP, "src", "turn", "modelsDevCatalog.json"),
  "utf8",
);
const EXPORT = JSON.parse(EXPORT_TEXT) as CatalogExport;
const SCRIPT = readFileSync(join(APP, "scripts", "models-dev-catalog.ts"), "utf8");

/** The export inverted back into models.dev's payload shape, for the script. */
function rawFromExport(): Record<string, unknown> {
  const raw: Record<string, unknown> = {};
  for (const allow of ALLOWLIST) {
    const provider = EXPORT.providers.find((one) => one.id === allow.id);
    if (provider === undefined) throw new Error("not in the export: " + allow.id);
    raw[allow.modelsDevId] = {
      id: allow.modelsDevId,
      name: provider.name,
      api: provider.api,
      env: [provider.env],
      doc: provider.doc,
      models: Object.fromEntries(
        provider.models.map((model) => [
          model.id,
          {
            id: model.id,
            name: model.name,
            tool_call: model.tool_call,
            attachment: model.attachment,
            reasoning: model.reasoning,
            modalities: { output: ["text"] },
          },
        ]),
      ),
    };
  }
  return raw;
}

const panel = source("canvas/ProvidersPanel.tsx");
const panelCode = codeOf(panel);
const css = source("canvas/canvas.css");

/* ------------------------------------------------------------------ *
 * 1. The catalogue is the vendored export, projected.
 * ------------------------------------------------------------------ */

describe("the catalogue is a projection of the vendored export", () => {
  test("the export names its source and stays a small curated window", () => {
    expect(EXPORT.source).toBe("models.dev");
    expect(EXPORT.fetchedFrom).toBe(MODELS_DEV_URL);
    expect(Buffer.byteLength(EXPORT_TEXT, "utf8")).toBeLessThan(200_000);
    expect(EXPORT.providers.length).toBe(ALLOWLIST.length);
    expect(EXPORT.providers.length).toBeLessThanOrEqual(20);
    const models = EXPORT.providers.reduce(
      (total, provider) => total + provider.models.length,
      0,
    );
    expect(models).toBeGreaterThan(0);
  });

  test("every entry is the export's row: name, https base URL, key variable, docs", () => {
    expect(PROVIDER_CATALOG.map((entry) => entry.id)).toEqual([
      "deepseek",
      "openai",
      "opencode-go",
      "opencode-payg",
      "groq",
      "openrouter",
      "mistral",
      "together",
      "cerebras",
      "moonshot",
      "xai",
      "zai",
      "fireworks",
      "hyper",
      "synthetic",
    ]);
    expect(PROVIDER_CATALOG.map((entry) => entry.id)).toEqual(
      EXPORT.providers.map((provider) => provider.id),
    );
    for (const entry of PROVIDER_CATALOG) {
      const provider = EXPORT.providers.find((one) => one.id === entry.id);
      expect(provider).toBeDefined();
      expect(entry.name).toBe(provider?.name.trim());
      expect(entry.baseUrl).toBe(provider?.api.trim());
      expect(entry.envName).toBe(provider?.env.trim());
      expect(entry.doc).toBe(provider?.doc.trim());
      expect(entry.name.trim()).not.toBe("");
      expect(entry.envName.trim()).not.toBe("");
      expect(entry.baseUrl.trim()).toBe(entry.baseUrl);
      expect(new URL(entry.baseUrl).protocol).toBe("https:");
      expect(entry.note.trim().length).toBeGreaterThan(20);
      expect(entry.note).toContain(entry.envName);
    }
  });

  test("every entry is unverified, names its source, and carries no key", () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(entry.verified).toBe(false);
      expect(entry.source).toBe(CATALOG_SOURCE);
      expect(entry.source).toBe("models.dev");
      expect(entry).not.toHaveProperty("apiKey");
    }
    expect(EXPORT_TEXT).not.toContain("sk-");
    expect(EXPORT_TEXT).not.toContain("apiKey");
  });

  test("a fallback base URL is stated, and only for a provider the export lacks", () => {
    for (const id of Object.keys(API_FALLBACK)) {
      expect(EXPORT.apiFallbacks).toContain(id);
      expect(catalogEntry(id)?.baseUrl).toBe(API_FALLBACK[id]);
    }
    for (const id of EXPORT.apiFallbacks) {
      expect(API_FALLBACK[id]).toBeDefined();
    }
    // The OpenCode split the docs insist on survives the change of source.
    expect(catalogEntry("opencode-go")?.baseUrl).not.toBe(
      catalogEntry("opencode-payg")?.baseUrl,
    );
  });

  test("the allowlist is stated in the script, one source id per entry", () => {
    for (const allow of ALLOWLIST) {
      expect(SCRIPT).toContain('modelsDevId: "' + allow.modelsDevId + '"');
      expect(SCRIPT).toContain('id: "' + allow.id + '"');
    }
    // models.dev has no OpenCode Zen; the app does not invent one.
    expect(ALLOWLIST.map((allow) => allow.id)).not.toContain("opencode-zen");
  });
});

/* ------------------------------------------------------------------ *
 * 2. The example model is the stated rule, capabilities included.
 * ------------------------------------------------------------------ */

describe("the example model is the first with tool-use, else the first", () => {
  test("every entry's example follows the rule and names both fields", () => {
    for (const entry of PROVIDER_CATALOG) {
      const provider = EXPORT.providers.find((one) => one.id === entry.id);
      const models = provider?.models ?? [];
      const expected = models.find((model) => model.tool_call) ?? models[0];
      expect(entry.modelExample?.id).toBe(expected?.id);
      expect(entry.modelExample?.name).toBe(expected?.name);
      expect(entry.modelExample?.toolCall).toBe(expected?.tool_call === true);
      expect(entry.modelExample?.attachment).toBe(
        expected?.attachment === true,
      );
    }
  });

  test("every exported model is trimmed to five facts, with unique ids", () => {
    for (const provider of EXPORT.providers) {
      const ids = provider.models.map((model) => model.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const model of provider.models) {
        expect(Object.keys(model).sort()).toEqual([
          "attachment",
          "id",
          "name",
          "reasoning",
          "tool_call",
        ]);
        expect(model.id.trim()).not.toBe("");
        expect(model.name.trim()).not.toBe("");
        expect(typeof model.tool_call).toBe("boolean");
        expect(typeof model.attachment).toBe("boolean");
        expect(typeof model.reasoning).toBe("boolean");
      }
    }
  });
});

/* ------------------------------------------------------------------ *
 * 3. The unverified mark comes from the data.
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
 * 4. A pick fills; the custom choice clears; nothing is requested or added.
 * ------------------------------------------------------------------ */

describe("a pick fills the form and focuses the key field", () => {
  test("each entry's fill is its name, base URL, example model and caps", () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(catalogFill(entry)).toEqual({
        name: entry.name,
        baseUrl: entry.baseUrl,
        modelId: entry.modelExample?.id ?? "",
        modelName: entry.modelExample?.name ?? "",
        tools: entry.modelExample?.toolCall === true,
        vision: entry.modelExample?.attachment === true,
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
      tools: false,
      vision: false,
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
    expect(pick).toContain('setAddKey("")');
    expect(pick).toContain("keyFieldRef.current?.focus()");
    const apply = panelCode.slice(
      panelCode.indexOf("function applyCatalogFill"),
      panelCode.indexOf("function addDraft"),
    );
    expect(apply).toContain("setName(fill.name)");
    expect(apply).toContain("setBaseUrl(fill.baseUrl)");
    expect(apply).toContain("setModelId(fill.modelId)");
    expect(apply).toContain("setModelName(fill.modelName)");
    // The export's capabilities are a starting tick, still changeable below.
    expect(apply).toContain("setTools(fill.tools)");
    expect(apply).toContain("setVision(fill.vision)");
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
      "setTools(e.target.checked)",
      "setVision(e.target.checked)",
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
 * 5. The row's key state is a dot, and the add path stays the only write.
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
 * 6. The two greps: endpoints live in the data; nothing fetches at runtime.
 * ------------------------------------------------------------------ */

describe("no catalogue base URL appears outside the vendored data", () => {
  // TWO files may name an endpoint: the committed export (the data) and the
  // refresh script (the only thing that writes it, and the fallback list).
  const DATA = join(APP, "src", "turn", "modelsDevCatalog.json");
  const REFRESH = join(APP, "scripts", "models-dev-catalog.ts");
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
      if (!/\.(ts|tsx|json)$/.test(entry.name)) continue;
      out.push(full);
    }
    return out;
  }

  test("the scan covers the panel, the turn path, the sidecar and the JSON", () => {
    const files = sources(APP);
    for (const rel of [
      "src/turn/providerCatalog.ts",
      "src/canvas/ProvidersPanel.tsx",
      "src/turn/providers.ts",
      "src/turn/modelFetch.ts",
      "src/turn/egress.ts",
      "sidecar/runs.ts",
      "src/turn/modelsDevCatalog.json",
    ]) {
      expect(files.map((file) => file.slice(APP.length + 1))).toContain(rel);
    }
    expect(files).toContain(DATA);
  });

  test("no module but the data and its script writes a catalogue endpoint", () => {
    const files = sources(APP);
    const urls = PROVIDER_CATALOG.map((entry) => entry.baseUrl);
    const hits: string[] = [];
    for (const file of files) {
      if (file === DATA || file === REFRESH || file === SELF) continue;
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
    // The script's fallbacks are the only URLs it states of its own.
    for (const url of Object.values(API_FALLBACK)) {
      expect(SCRIPT).toContain(url);
    }
  });

  test("no runtime module fetches models.dev; the script is the only network", () => {
    const runtime = [...sources(join(APP, "src")), ...sources(join(APP, "sidecar"))];
    const hits: string[] = [];
    for (const file of runtime) {
      if (!/\.(ts|tsx)$/.test(file)) continue;
      const text = codeOf(readFileSync(file, "utf8"));
      const rel = file.slice(APP.length + 1);
      if (/models\.dev\/api\.json/.test(text)) hits.push(rel + " -> the URL");
      if (
        /(fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(text) &&
        /models\.dev/.test(text)
      ) {
        hits.push(rel + " -> a request beside the name");
      }
    }
    expect(hits).toEqual([]);
    // The catalogue module is data: it cannot fetch even if someone tries.
    const projection = codeOf(source("turn/providerCatalog.ts"));
    expect(projection).not.toMatch(/\bfetch\s*\(/);
    expect(projection).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
    // POSITIVE CONTROL: the URL is stated exactly once, in the refresh script.
    expect(SCRIPT).toContain(MODELS_DEV_URL);
    expect(SCRIPT).toContain("import.meta.main");
  });
});

/* ------------------------------------------------------------------ *
 * 7. The refresh script refuses a broken payload and writes nothing.
 * ------------------------------------------------------------------ */

describe("the refresh refuses to write an empty or malformed payload", () => {
  test("a payload that is not an object of providers is refused", () => {
    for (const raw of [null, "", [], 3, true]) {
      expect(() => projectCatalog(raw)).toThrow(CatalogRefused);
    }
  });

  test("nothing parseable is refused before it can reach a provider", async () => {
    expect(() => parseExport("not json")).toThrow(CatalogRefused);
    let writes = 0;
    const write = async () => {
      writes += 1;
    };
    for (const text of ["", "<html>", "null", "[]", "{}"]) {
      await expect(
        refreshCatalog({ fetchText: async () => text, previous: null, write }),
      ).rejects.toThrow(CatalogRefused);
    }
    expect(writes).toBe(0);
  });

  test("a provider that lost its key variable or its chat models is refused", async () => {
    const raw = rawFromExport();
    const deepseek = raw.deepseek as Record<string, unknown>;
    expect(() =>
      projectCatalog({ ...raw, deepseek: { ...deepseek, env: [] } }),
    ).toThrow(CatalogRefused);
    expect(() =>
      projectCatalog({
        ...raw,
        deepseek: {
          ...deepseek,
          models: { "an-image-model": { id: "an-image", modalities: { output: ["image"] } } },
        },
      }),
    ).toThrow(CatalogRefused);
    let writes = 0;
    await expect(
      refreshCatalog({
        fetchText: async () =>
          JSON.stringify({ deepseek: { ...deepseek, env: [] } }),
        previous: null,
        write: async () => {
          writes += 1;
        },
      }),
    ).rejects.toThrow(CatalogRefused);
    expect(writes).toBe(0);
  });

  test("a payload that would grow past the window is refused, not committed", async () => {
    const raw = rawFromExport();
    const deepseek = raw.deepseek as Record<string, unknown>;
    const models = deepseek.models as Record<string, Record<string, unknown>>;
    const first = Object.keys(models)[0];
    let writes = 0;
    await expect(
      refreshCatalog({
        fetchText: async () =>
          JSON.stringify({
            ...raw,
            deepseek: {
              ...deepseek,
              models: {
                [first]: { ...models[first], name: "x".repeat(210_000) },
              },
            },
          }),
        previous: null,
        write: async () => {
          writes += 1;
        },
      }),
    ).rejects.toThrow(CatalogRefused);
    expect(writes).toBe(0);
  });

  test("a good payload is projected, written once and summarised", async () => {
    let written = "";
    const result = await refreshCatalog({
      fetchText: async () => JSON.stringify(rawFromExport()),
      previous: null,
      write: async (text) => {
        written = text;
      },
    });
    const back = JSON.parse(written) as CatalogExport;
    expect(back.providers.map((provider) => provider.id)).toEqual(
      ALLOWLIST.map((allow) => allow.id),
    );
    expect(result.next.providers.length).toBe(ALLOWLIST.length);
    expect(result.summary).toContain("providers: " + ALLOWLIST.length);
    expect(result.summary).toContain("models: ");
    expect(result.summary).toContain("added:");
  });

  test("the summary names what was added, removed and changed", () => {
    const withAChange: CatalogExport = {
      ...EXPORT,
      providers: EXPORT.providers.map((provider) =>
        provider.id === "deepseek" ? { ...provider, name: "DeepSeek (moved)" } : provider,
      ),
    };
    const summary = summaryOf(EXPORT, withAChange);
    expect(summary).toContain("providers: " + EXPORT.providers.length);
    expect(summary).toContain("changed 1");
    expect(summary).toContain("changed: deepseek");
    const fewer: CatalogExport = {
      ...EXPORT,
      providers: EXPORT.providers.filter((provider) => provider.id !== "groq"),
    };
    expect(summaryOf(EXPORT, fewer)).toContain("removed: groq");
    expect(summaryOf(null, EXPORT)).toContain(
      "added: " + EXPORT.providers.map((provider) => provider.id).join(", "),
    );
  });

  test("the committed export is what the script would write today", () => {
    // The file pinned in git is reproducible from the allowlist and the export
    // shape: a refresh with unchanged data changes nothing.
    const projected = projectCatalog(rawFromExport());
    expect(projected.providers.length).toBe(EXPORT.providers.length);
    expect(summaryOf(EXPORT, projected)).toContain("added 0, removed 0");
  });
});
