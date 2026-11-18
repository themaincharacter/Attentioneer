/**
 * REFRESH THE VENDORED models.dev EXPORT (Epic 15 story 15; PROVISIONAL).
 *
 * THE USER'S POINT: "this should be a library at this point." Twelve provider
 * rows hand-written in providerCatalog.ts were twelve facts we asserted — a
 * base URL, a key variable, a docs link, an example model — and every one of
 * them is already kept by models.dev, the open catalogue OpenCode and others
 * consume. So the list stops being an assertion and becomes an IMPORT: this
 * script fetches models.dev once, filters it to the stated ALLOWLIST below,
 * trims it to the fields the app actually uses, and writes the committed file
 * src/turn/modelsDevCatalog.json.
 *
 * THIS SCRIPT IS THE ONLY THING THAT TOUCHES THE NETWORK. The app, its tests
 * and its start never do: the JSON is committed, so the app opens and works
 * offline. A test greps src/ and sidecar/ to prove no runtime module even
 * knows the name models.dev.
 *
 * WHY AN ALLOWLIST AND NOT THE WHOLE CATALOGUE: models.dev names 300+
 * providers. This export is a CURATED WINDOW (PROVISIONAL) — the eleven
 * OpenAI-compatible providers 15.13 offered (minus OpenCode Zen, which
 * models.dev does not list at all) plus four obvious neighbours. Every entry
 * here must speak the OpenAI chat shape our HTTP tier speaks; a native
 * Anthropic/Google endpoint is not on the list, because an entry must not
 * pretend a protocol the app cannot speak.
 *
 * WHY SOME BASE URLS ARE FALLBACKS (PROVISIONAL): models.dev omits `api` for
 * providers whose own SDK supplies the default endpoint (OpenAI, Groq,
 * Mistral, Together, Cerebras, xAI). The export is still the source of
 * everything else about them, but an entry with no base URL fills a form the
 * person cannot use, so API_FALLBACK keeps 15.13's URL for exactly those and
 * records their ids in the JSON's `apiFallbacks`. The summary prints them, so
 * a stale URL is visible on refresh instead of silent. When models.dev starts
 * stating one, that entry drops out of the fallback list by itself.
 *
 * WHY IT REFUSES TO WRITE: an empty or malformed fetch would replace a good
 * committed file with a broken one. If the payload is not JSON, if none of the
 * allowlist came back, or if an allowlisted provider lost its name, its key
 * variable or its chat models, this script says why and writes NOTHING.
 *
 * RUN IT WITH: bun run catalog:refresh  (it is never run by a test or by the app)
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The one URL this project fetches, and only from here. */
export const MODELS_DEV_URL = "https://models.dev/api.json";

/** The committed file this script is allowed to rewrite. */
export const OUT_PATH = fileURLToPath(
  new URL("../src/turn/modelsDevCatalog.json", import.meta.url),
);

/** One model, trimmed to what the add form can use. */
export interface CatalogExportModel {
  id: string;
  name: string;
  tool_call: boolean;
  attachment: boolean;
  reasoning: boolean;
}

/** One provider, trimmed to the fields the picker and the form use. */
export interface CatalogExportProvider {
  /** The app's stable picker id (see ALLOWLIST). */
  id: string;
  name: string;
  /** The OpenAI-compatible base URL; models.dev's `api`, or API_FALLBACK. */
  api: string;
  /** The key's environment-variable name (models.dev's `env[0]`), in words. */
  env: string;
  doc: string;
  /**
   * Request headers this endpoint documents (story 15.17), shipped as DATA.
   * `{session-id}` is generic lane vocabulary: the sidecar fills it with the
   * same stable id its generic session header carries. A provider whose
   * gateway asks for its own name never needs code to know that name.
   */
  headers?: Record<string, string>;
  /** Only models that can output text — a chat catalogue, not an image one. */
  models: CatalogExportModel[];
}

/** The vendored export as JSON. */
export interface CatalogExport {
  source: "models.dev";
  fetchedFrom: string;
  /** Provider ids whose base URL models.dev did not state (15.13's URL kept). */
  apiFallbacks: string[];
  providers: CatalogExportProvider[];
}

/**
 * THE STATED ALLOWLIST (PROVISIONAL). `modelsDevId` is the name the public
 * catalogue uses; `id` is the picker id the app has used since 15.13, kept so
 * a person's habits (and every test) survive the change of source. A `name`
 * override is used only where models.dev's name would make two rows look the
 * same (OpenCode vs OpenCode Go).
 */
export interface AllowEntry {
  modelsDevId: string;
  id: string;
  /** Display name override; models.dev's name is used otherwise. */
  name?: string;
  /** Documented request headers this entry ships (story 15.17). */
  headers?: Record<string, string>;
}

export const ALLOWLIST: readonly AllowEntry[] = [
  { modelsDevId: "deepseek", id: "deepseek" },
  { modelsDevId: "openai", id: "openai" },
  // This gateway documents the header its session needs. Shipping it as DATA
  // is the durable answer: the generic header we already send is a lucky
  // compatibility, and the documented one belongs to the catalogue.
  {
    modelsDevId: "opencode-go",
    id: "opencode-go",
    headers: { "x-opencode-session": "{session-id}" },
  },
  // models.dev calls the pay-as-you-go gateway simply "OpenCode"; the picker
  // keeps 15.13's name so it is not mistaken for the Go plan.
  // The same gateway family documents the same session header; the pay-as-you-go
  // endpoint receives it too, where it is ignored if it is not needed.
  {
    modelsDevId: "opencode",
    id: "opencode-payg",
    name: "OpenCode (pay-as-you-go)",
    headers: { "x-opencode-session": "{session-id}" },
  },
  { modelsDevId: "groq", id: "groq" },
  { modelsDevId: "openrouter", id: "openrouter" },
  { modelsDevId: "mistral", id: "mistral" },
  { modelsDevId: "togetherai", id: "together" },
  { modelsDevId: "cerebras", id: "cerebras" },
  { modelsDevId: "moonshotai", id: "moonshot" },
  { modelsDevId: "xai", id: "xai" },
  // Four neighbours with the same OpenAI-compatible shape, small enough to keep
  // the export a window and not a dump.
  { modelsDevId: "zai", id: "zai" },
  { modelsDevId: "fireworks-ai", id: "fireworks" },
  { modelsDevId: "hyper", id: "hyper" },
  { modelsDevId: "synthetic", id: "synthetic" },
];

/** Stated by models.dev, not stated by models.dev: 15.13's URL, in one place. */
export const API_FALLBACK: Readonly<Record<string, string>> = {
  openai: "https://api.openai.com/v1",
  groq: "https://api.groq.com/openai/v1",
  mistral: "https://api.mistral.ai/v1",
  together: "https://api.together.xyz/v1",
  cerebras: "https://api.cerebras.ai/v1",
  xai: "https://api.x.ai/v1",
};

/**
 * The export stays a WINDOW, not a dump. A refresh that would cross this line
 * refuses instead of committing a file nobody can read in a diff.
 */
export const EXPORT_LIMIT_BYTES = 200_000;

/** A refusal is a sentence, never a half-written file. */
export class CatalogRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CatalogRefused";
  }
}

/** Parse the payload; a parse failure is the same refusal as a bad shape. */
export function parseExport(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new CatalogRefused("the fetch was not JSON");
  }
}

/** A chat model is one that can answer in text; an image or speech one cannot. */
function chatModel(model: unknown): boolean {
  if (model === null || typeof model !== "object") return false;
  const modalities = (model as { modalities?: { output?: unknown } }).modalities;
  const output = modalities?.output;
  return Array.isArray(output) && output.includes("text");
}

function textField(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * THE PROJECTION: models.dev's payload in, the app's trimmed export out. Pure
 * (no network, no disk) so a test can hand it an empty or broken payload and
 * watch it refuse without touching the committed file.
 */
export function projectCatalog(raw: unknown): CatalogExport {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new CatalogRefused("the payload is not an object of providers");
  }
  const providersById = raw as Record<string, unknown>;
  const providers: CatalogExportProvider[] = [];
  const apiFallbacks: string[] = [];
  const missing: string[] = [];

  for (const allow of ALLOWLIST) {
    const source = providersById[allow.modelsDevId];
    if (source === null || typeof source !== "object") {
      missing.push(allow.modelsDevId);
      continue;
    }
    const provider = source as Record<string, unknown>;
    const name = textField(provider.name);
    if (name === "") {
      throw new CatalogRefused("no name for " + allow.modelsDevId);
    }
    const envs = provider.env;
    const env = Array.isArray(envs) ? textField(envs[0]) : "";
    if (env === "") {
      throw new CatalogRefused("no key variable for " + allow.modelsDevId);
    }
    const stated = textField(provider.api);
    const api = stated === "" ? (API_FALLBACK[allow.id] ?? "") : stated;
    if (api === "") {
      throw new CatalogRefused("no base URL for " + allow.modelsDevId);
    }
    if (stated === "") apiFallbacks.push(allow.id);

    const modelsRaw = provider.models;
    if (modelsRaw === null || typeof modelsRaw !== "object") {
      throw new CatalogRefused("no model list for " + allow.modelsDevId);
    }
    const models: CatalogExportModel[] = Object.values(
      modelsRaw as Record<string, unknown>,
    )
      .filter(chatModel)
      .map((model) => {
        const one = model as Record<string, unknown>;
        const id = textField(one.id);
        const modelName = textField(one.name);
        return {
          id,
          name: modelName === "" ? id : modelName,
          tool_call: one.tool_call === true,
          attachment: one.attachment === true,
          reasoning: one.reasoning === true,
        };
      })
      .filter((model) => model.id !== "");
    if (models.length === 0) {
      throw new CatalogRefused("no chat models for " + allow.modelsDevId);
    }

    const projected: CatalogExportProvider = {
      id: allow.id,
      name: allow.name ?? name,
      api,
      env,
      doc: textField(provider.doc),
      models,
    };
    // Headers come from the ALLOWLIST, not from models.dev: an upstream
    // refresh cannot silently drop a header the row needs to work.
    if (allow.headers !== undefined) {
      projected.headers = { ...allow.headers };
    }
    providers.push(projected);
  }

  if (providers.length === 0) {
    throw new CatalogRefused(
      "the payload named none of the allowlisted providers (" +
        missing.join(", ") +
        ")",
    );
  }
  return {
    source: "models.dev",
    fetchedFrom: MODELS_DEV_URL,
    apiFallbacks,
    providers,
  };
}

function providerLine(provider: CatalogExportProvider): string {
  return provider.id + " (" + provider.models.length + " models) " + provider.api;
}

/**
 * WHAT CHANGED, in words, before anything is written. Compared by the whole
 * provider record (name, base URL, key variable, docs, every model), so a
 * changed model capability is a changed provider.
 */
export function summaryOf(
  previous: CatalogExport | null,
  next: CatalogExport,
): string {
  const before = new Map(
    (previous?.providers ?? []).map((provider) => [provider.id, provider]),
  );
  const after = new Map(next.providers.map((provider) => [provider.id, provider]));
  const added = [...after.keys()].filter((id) => !before.has(id));
  const removed = [...before.keys()].filter((id) => !after.has(id));
  const changed = [...after.keys()].filter((id) => {
    const old = before.get(id);
    return old !== undefined && JSON.stringify(old) !== JSON.stringify(after.get(id));
  });
  const models = next.providers.reduce(
    (total, provider) => total + provider.models.length,
    0,
  );
  const oldModels = (previous?.providers ?? []).reduce(
    (total, provider) => total + provider.models.length,
    0,
  );
  const lines = [
    "models.dev -> " + OUT_PATH,
    "providers: " +
      next.providers.length +
      " (added " +
      added.length +
      ", removed " +
      removed.length +
      ", changed " +
      changed.length +
      ")",
    "models: " + models + " (" + (models - oldModels >= 0 ? "+" : "") + (models - oldModels) + " vs the committed file)",
  ];
  for (const provider of next.providers) {
    lines.push("  " + providerLine(provider));
  }
  if (added.length > 0) lines.push("added: " + added.join(", "));
  if (removed.length > 0) lines.push("removed: " + removed.join(", "));
  if (changed.length > 0) lines.push("changed: " + changed.join(", "));
  if (next.apiFallbacks.length > 0) {
    lines.push(
      "base URLs models.dev does not state (15.13's kept): " +
        next.apiFallbacks.join(", "),
    );
  }
  return lines.join("\n");
}

/**
 * THE REFRESH ITSELF, with fetch and write injected: a test hands it a broken
 * payload and asserts the writer was never called. The write happens last,
 * after the projection and the summary, so a refusal leaves the committed file
 * exactly as it was.
 */
export async function refreshCatalog(deps: {
  fetchText: () => Promise<string>;
  previous: CatalogExport | null;
  write: (text: string) => Promise<void>;
}): Promise<{ next: CatalogExport; summary: string }> {
  const next = projectCatalog(parseExport(await deps.fetchText()));
  const summary = summaryOf(deps.previous, next);
  const text = JSON.stringify(next, null, 2) + "\n";
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes > EXPORT_LIMIT_BYTES) {
    throw new CatalogRefused(
      "the trimmed export would be " +
        bytes +
        " bytes, over the " +
        EXPORT_LIMIT_BYTES +
        "-byte window; trim ALLOWLIST",
    );
  }
  await deps.write(text);
  return { next, summary };
}

/** The committed file as the last run left it, or null when there is none. */
function committed(): CatalogExport | null {
  try {
    return JSON.parse(readFileSync(OUT_PATH, "utf8")) as CatalogExport;
  } catch {
    return null;
  }
}

if (import.meta.main) {
  try {
    const result = await refreshCatalog({
      fetchText: async () => {
        const response = await fetch(MODELS_DEV_URL, {
          signal: AbortSignal.timeout(60_000),
        });
        if (!response.ok) {
          throw new CatalogRefused(
            "models.dev answered " + response.status + " " + response.statusText,
          );
        }
        return await response.text();
      },
      previous: committed(),
      write: async (text) => {
        await Bun.write(OUT_PATH, text);
      },
    });
    console.log(result.summary);
  } catch (error) {
    const sentence =
      error instanceof Error ? error.message : String(error);
    console.error("catalog:refresh refused, nothing was written: " + sentence);
    process.exit(1);
  }
}
