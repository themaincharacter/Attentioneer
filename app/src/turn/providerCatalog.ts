/**
 * THE PROVIDER CATALOGUE THE APP KNOWS AS DATA (Epic 15 story 13; PROVISIONAL).
 *
 * WHY A LIST AND NOT A DETECTION: a person adding a provider should not have to
 * remember a base URL — the field most likely to be wrong, and the one that
 * makes "add a provider" feel like configuration. DSH ships a catalogue with a
 * base URL and protocol per entry; Slashspace frames the same move as "add your
 * own OpenAI-compatible API providers" and lets the key be validated on paste.
 * This file is that list, as data: pick an entry, the form fills itself, paste
 * the key, and the row's own test says whether the endpoint answered.
 *
 * DATA ONLY. A pick fills four fields and puts the caret in the key field.
 * Nothing here makes a request, validates a key, or adds a row — the person's
 * press still does that, and a custom endpoint stays today's empty form. If an
 * entry is wrong, the fix is editing this list; no lane branches on a product.
 *
 * EVERY ENTRY IS UNVERIFIED (PROVISIONAL): `verified: false` until a person's
 * own account answers. `catalogLabel` shows the mark, reusing the ACP rows'
 * label idiom; the app never claims an endpoint works because it is on a list.
 * A base URL lives ONLY in this file — a test greps every other module for
 * these strings, so the turn path can never grow a hard-coded endpoint.
 *
 * WHY ONLY OPENAI-COMPATIBLE ENDPOINTS: our HTTP tier speaks the OpenAI chat
 * shape and nothing else. An Anthropic- or Google-style native endpoint is not
 * on this list, because an entry must not pretend a protocol the app cannot
 * speak.
 *
 * THE TABLE IS STORY 15.13'S, VERBATIM (PROVISIONAL). The OpenCode rows come
 * from OpenCode's own docs: Go and pay-as-you-go are served from DIFFERENT
 * base URLs, and the OpenAI-compatible path is /openai/v1. The model examples
 * are examples, not a claim about what a plan serves — fetch models is how a
 * person learns the real list.
 */

/** One model id and the name to show, used only to fill the form's two fields. */
export interface CatalogModelExample {
  id: string;
  name: string;
}

/** One provider the app can offer as a starting point. Data, never a promise. */
export interface ProviderCatalogEntry {
  /** Stable id for the picker; not the id the person's row will get. */
  id: string;
  /** The display name, shown with its unverified mark. */
  name: string;
  /** The provider's OpenAI-compatible base URL — the ONLY place it is written. */
  baseUrl: string;
  /**
   * A model id and name to fill the form with (PROVISIONAL, an EXAMPLE). A
   * person replaces it with what fetch models offers.
   */
  modelExample?: CatalogModelExample;
  /** The one fact a person needs about the key or the plan. */
  note: string;
  /** Where the entry came from, in words. */
  source: string;
  /**
   * Whether a person's own account confirmed this entry (PROVISIONAL). All
   * entries are false until someone tests one; a true entry renders unmarked.
   */
  verified: boolean;
}

/** The picker's value for today's empty form: no catalogue entry is chosen. */
export const CUSTOM_CATALOG_ID = "custom";

/**
 * The shipped list. Data, PROVISIONAL, and every entry UNVERIFIED — the mark
 * is the honesty rule, not a decoration. The order is the spec's table.
 */
export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com/v1",
    modelExample: { id: "deepseek-chat", name: "DeepSeek Chat" },
    note:
      "a DeepSeek platform API key; usage is billed by DeepSeek. The model id is an example — fetch models to choose the one your account has.",
    source:
      "DeepSeek's API docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    modelExample: { id: "gpt-4o-mini", name: "GPT-4o mini" },
    note:
      "an OpenAI API key from a project with billing enabled; usage is billed by OpenAI.",
    source:
      "OpenAI's API docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "opencode-go",
    name: "OpenCode Go",
    baseUrl: "https://opencode.ai/inference/go/openai/v1",
    modelExample: { id: "qwen3-coder", name: "Qwen3 Coder" },
    note:
      "an OpenCode Go key; usage counts toward the workspace budget. The model id is an example — fetch models to choose yours.",
    source:
      "OpenCode's inference docs (Go is served from its own base URL), via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "opencode-payg",
    name: "OpenCode (pay-as-you-go)",
    baseUrl: "https://opencode.ai/inference/openai/v1",
    modelExample: { id: "qwen3-coder", name: "Qwen3 Coder" },
    note:
      "an OpenCode pay-as-you-go key; Go and pay-as-you-go are served from different base URLs, so this row is not interchangeable with Go.",
    source:
      "OpenCode's inference docs (the pay-as-you-go base URL), via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "opencode-zen",
    name: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    modelExample: { id: "qwen3-coder", name: "Qwen3 Coder" },
    note:
      "an OpenCode Zen key; Zen is its own gateway with its own model list. The model id is an example — fetch models to choose yours.",
    source:
      "OpenCode Zen's docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "groq",
    name: "Groq",
    baseUrl: "https://api.groq.com/openai/v1",
    modelExample: { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B" },
    note:
      "a Groq API key; the free tier is rate-limited and the model catalogue changes often.",
    source:
      "Groq's API docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    modelExample: { id: "openai/gpt-4o-mini", name: "OpenAI GPT-4o mini" },
    note:
      "an OpenRouter API key; model ids are namespaced by vendor, such as the example's openai/gpt-4o-mini.",
    source:
      "OpenRouter's API docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "mistral",
    name: "Mistral",
    baseUrl: "https://api.mistral.ai/v1",
    modelExample: { id: "mistral-small-latest", name: "Mistral Small" },
    note:
      "a Mistral API key; the '-latest' model aliases move as Mistral ships new versions.",
    source:
      "Mistral's API docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "together",
    name: "Together",
    baseUrl: "https://api.together.xyz/v1",
    modelExample: {
      id: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      name: "Llama 3.3 70B Instruct Turbo",
    },
    note:
      "a Together API key; open-weight model ids carry their organisation prefix.",
    source:
      "Together's API docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "cerebras",
    name: "Cerebras",
    baseUrl: "https://api.cerebras.ai/v1",
    modelExample: { id: "llama-3.3-70b", name: "Llama 3.3 70B" },
    note:
      "a Cerebras API key; its catalogue is smaller and changes more often than the big vendors'.",
    source:
      "Cerebras' API docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "moonshot",
    name: "Moonshot (Kimi)",
    baseUrl: "https://api.moonshot.ai/v1",
    modelExample: { id: "moonshot-v1-8k", name: "Moonshot v1 8K" },
    note:
      "a Moonshot (Kimi) API key; model ids are versioned, such as the example's moonshot-v1-8k.",
    source:
      "Moonshot's API docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
  {
    id: "xai",
    name: "xAI",
    baseUrl: "https://api.x.ai/v1",
    modelExample: { id: "grok-4", name: "Grok 4" },
    note:
      "an xAI API key; model aliases move as xAI ships new versions.",
    source:
      "xAI's API docs, via story 15.13's catalogue table; this app has not contacted it",
    verified: false,
  },
];

/** One entry by id, or null when the id is not in the catalogue. */
export function catalogEntry(id: string): ProviderCatalogEntry | null {
  return PROVIDER_CATALOG.find((entry) => entry.id === id) ?? null;
}

/**
 * THE PICKER'S LABEL (PURE, PROVISIONAL): the entry's name, and the one word
 * that says no person's account has confirmed it. The mark comes from the
 * DATA, never from recognising a product — a new entry marks itself.
 */
export function catalogLabel(entry: ProviderCatalogEntry): string {
  return entry.verified ? entry.name : entry.name + " (unverified)";
}

/** The four add-form fields a catalogue pick (or the custom choice) fills. */
export interface ProviderCatalogFill {
  name: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
}

/** Today's empty form: choosing a custom endpoint clears the fill to this. */
export const CUSTOM_FILL: ProviderCatalogFill = {
  name: "",
  baseUrl: "",
  modelId: "",
  modelName: "",
};

/**
 * The fill for one entry. A pure function so a test can pin exactly what a
 * pick does without a window, a store or a network: four strings, nothing
 * else. The key is deliberately absent — the person pastes it after the fill.
 */
export function catalogFill(entry: ProviderCatalogEntry): ProviderCatalogFill {
  return {
    name: entry.name,
    baseUrl: entry.baseUrl,
    modelId: entry.modelExample?.id ?? "",
    modelName: entry.modelExample?.name ?? "",
  };
}
