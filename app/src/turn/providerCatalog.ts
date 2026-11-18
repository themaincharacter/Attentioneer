/**
 * THE PROVIDER CATALOGUE — A PROJECTION OF THE VENDORED models.dev EXPORT
 * (Epic 15 story 15; PROVISIONAL).
 *
 * THE USER'S POINT: "this should be a library at this point." Story 15.13
 * hand-wrote twelve provider rows — a base URL, a key variable, a docs link,
 * an example model — and every one of those facts is already maintained by
 * models.dev, the open catalogue OpenCode and others consume. So this module
 * stopped asserting them. It reads modelsDevCatalog.json (committed beside it
 * in this folder) and projects that small export into the picker's entries.
 *
 * DATA ONLY, AND OFFLINE: this file imports a JSON file that ships with the
 * app. Nothing here fetches, validates a key or adds a row; the ONLY thing
 * that talks to models.dev is scripts/models-dev-catalog.ts, run by a person
 * with `bun run catalog:refresh`. A test greps src/ and sidecar/ to prove no
 * runtime module even names models.dev.
 *
 * THE PROJECTION IS THIN ON PURPOSE (PROVISIONAL): `baseUrl` is the export's
 * `api`, `envName` its `env`, `doc` its `doc`, and the example model is the
 * first model with `tool_call: true` (else the first). The example's
 * `tool_call`/`attachment` pre-tick the add form's tools/vision boxes, which
 * the person can still change — the export offers a starting point, not a
 * verdict about their account. An entry with no models (the export refuses to
 * write one) simply gets no example.
 *
 * EVERY ENTRY IS STILL UNVERIFIED: `verified: false` and `source: "models.dev"`
 * until a person's own account answers. `catalogLabel` shows the mark; the app
 * never claims an endpoint works because it is on a list. And a base URL lives
 * ONLY in the vendored JSON — a test greps every module for these strings, so
 * the turn path can never grow a hard-coded endpoint.
 *
 * WHY ONLY OPENAI-COMPATIBLE ENDPOINTS: our HTTP tier speaks the OpenAI chat
 * shape and nothing else. The export's allowlist (scripts/models-dev-catalog.ts)
 * names only providers of that shape; an Anthropic- or Google-style native
 * endpoint is not here, because an entry must not pretend a protocol the app
 * cannot speak.
 *
 * The field names, the example rule and the wording of `note` stay PROVISIONAL
 * with the export itself: change them together, on a refresh.
 */

import catalogJson from "./modelsDevCatalog.json";

/** The shape of one model in the committed export. */
interface ExportedModel {
  id: string;
  name: string;
  tool_call: boolean;
  attachment: boolean;
  reasoning: boolean;
}

/** The shape of one provider in the committed export. */
interface ExportedProvider {
  id: string;
  name: string;
  api: string;
  env: string;
  doc: string;
  /**
   * Documented request headers, when the endpoint needs one (story 15.17).
   * Data from the export's ALLOWLIST, never a name a lane module knows.
   */
  headers?: Record<string, string>;
  models: ExportedModel[];
}

/** The shape of the committed export as a whole. */
interface ExportedCatalog {
  source: string;
  fetchedFrom: string;
  apiFallbacks: string[];
  providers: ExportedProvider[];
}

const EXPORT = catalogJson as unknown as ExportedCatalog;

/** Where every entry came from. The one word the honesty rule asks for. */
export const CATALOG_SOURCE = "models.dev";

/** One model id, name and two capabilities, used only to fill the form. */
export interface CatalogModelExample {
  id: string;
  name: string;
  /** The export's `tool_call`; pre-ticks the form's tools checkbox. */
  toolCall: boolean;
  /** The export's `attachment`; pre-ticks the form's vision checkbox. */
  attachment: boolean;
}

/**
 * ONE MODEL AS THE EXPORT LISTS IT (story 15.14). The add dialog's Models block
 * shows exactly these facts and nothing it would have to guess: the id to send,
 * the name to read, whether the catalogue says it takes tools, whether it takes
 * images, and whether it reasons. The reasoning flag is CARRIED but not shown
 * today — the form has no checkbox for it, and this story does not invent one.
 */
export interface CatalogModel {
  id: string;
  name: string;
  /** The export's `tool_call`: pre-ticks the form's tools box. */
  toolCall: boolean;
  /** The export's `attachment`: pre-ticks the form's vision box. */
  attachment: boolean;
  /** The export's `reasoning`; carried, not surfaced by this story. */
  reasoning: boolean;
}

/** One provider the app can offer as a starting point. Data, never a promise. */
export interface ProviderCatalogEntry {
  /** Stable id for the picker; not the id the person's row will get. */
  id: string;
  /** The display name, shown with its unverified mark. */
  name: string;
  /** The provider's OpenAI-compatible base URL — the JSON is its only home. */
  baseUrl: string;
  /** The key's environment-variable name, as models.dev lists it (in words). */
  envName: string;
  /** The provider's docs link, as models.dev lists it. */
  doc: string;
  /**
   * A model to fill the form with (PROVISIONAL, an EXAMPLE): the first the
   * export lists with tool-use, else its first. A person replaces it with what
   * fetch models offers.
   */
  modelExample?: CatalogModelExample;
  /**
   * EVERY model the export lists for this provider, in its order (story
   * 15.14). The add dialog's Models block reads this list; a tick copies the
   * chosen model's id, name and capabilities into the form, which stays
   * editable. Data only — the list is a catalogue, not a promise about the
   * person's account, and it is never fetched here.
   */
  models: readonly CatalogModel[];
  /**
   * The request headers a row picked from this entry ships (story 15.17).
   * Absent for nearly every entry; present where the endpoint documents one.
   * `{session-id}` is the generic placeholder the sidecar fills.
   */
  headers?: Record<string, string>;
  /** The one fact a person needs about the key or the docs. */
  note: string;
  /** Where the entry came from, in one word. */
  source: typeof CATALOG_SOURCE;
  /**
   * Whether a person's own account confirmed this entry (PROVISIONAL). All
   * entries are false until someone tests one; a true entry renders unmarked.
   */
  verified: boolean;
}

/** The picker's value for today's empty form: no catalogue entry is chosen. */
export const CUSTOM_CATALOG_ID = "custom";

/**
 * The first model with tool-use, else the first one. Pure, and read straight
 * from the export's own order: the catalogue curates; we do not re-rank.
 */
function exampleOf(
  models: readonly ExportedModel[],
): CatalogModelExample | undefined {
  const chosen = models.find((model) => model.tool_call === true) ?? models[0];
  if (chosen === undefined) return undefined;
  return {
    id: chosen.id,
    name: chosen.name,
    toolCall: chosen.tool_call === true,
    attachment: chosen.attachment === true,
  };
}

/** The one sentence a pick shows: the key variable and the docs, from data. */
function noteOf(
  envName: string,
  doc: string,
  headers: Readonly<Record<string, string>> | undefined,
): string {
  const key =
    envName === ""
      ? "models.dev lists no key variable for this provider"
      : "models.dev lists " + envName + " as this provider's key variable";
  const docs = doc === "" ? "" : "; its docs are at " + doc;
  // WHY THE HEADER IS SHIPPED, in one sentence: this endpoint documents a
  // header its gateway needs, so a generic one is not enough. The sentence
  // names no header and no vendor — the map above is where that fact lives.
  const session =
    headers === undefined
      ? ""
      : " This endpoint documents a request header for its session; a row picked here carries it, stored as plain text.";
  return (
    key +
    docs +
    "." +
    session +
    " The key you paste is kept by this machine's keychain — this file is data only."
  );
}

/**
 * The shipped list: the export, projected. Data, PROVISIONAL, and every entry
 * UNVERIFIED — the mark is the honesty rule, not a decoration. The order is
 * the allowlist's order (scripts/models-dev-catalog.ts).
 */
export const PROVIDER_CATALOG: readonly ProviderCatalogEntry[] =
  EXPORT.providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    baseUrl: provider.api,
    envName: provider.env,
    doc: provider.doc,
    modelExample: exampleOf(provider.models),
    models: provider.models.map((model) => ({
      id: model.id,
      name: model.name,
      toolCall: model.tool_call === true,
      attachment: model.attachment === true,
      reasoning: model.reasoning === true,
    })),
    ...(provider.headers === undefined
      ? {}
      : { headers: { ...provider.headers } }),
    note: noteOf(provider.env, provider.doc, provider.headers),
    source: CATALOG_SOURCE,
    verified: false,
  }));

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

/** The add-form fields a catalogue pick (or the custom choice) fills. */
export interface ProviderCatalogFill {
  name: string;
  baseUrl: string;
  modelId: string;
  modelName: string;
  /** The example model's tool-use: a starting tick, changeable. */
  tools: boolean;
  /** The example model's attachment: a starting tick, changeable. */
  vision: boolean;
  /**
   * The entry's request headers (story 15.17): the add form's header lines,
   * pre-filled so a documented header arrives without the person copying it.
   */
  headers: Record<string, string>;
}

/** Today's empty form: choosing a custom endpoint clears the fill to this. */
export const CUSTOM_FILL: ProviderCatalogFill = {
  name: "",
  baseUrl: "",
  modelId: "",
  modelName: "",
  tools: false,
  vision: false,
  headers: {},
};

/**
 * The fill for one entry. A pure function so a test can pin exactly what a
 * pick does without a window, a store or a network: six values, nothing else.
 * The key is deliberately absent — the person pastes it after the fill.
 */
export function catalogFill(entry: ProviderCatalogEntry): ProviderCatalogFill {
  return {
    name: entry.name,
    baseUrl: entry.baseUrl,
    modelId: entry.modelExample?.id ?? "",
    modelName: entry.modelExample?.name ?? "",
    tools: entry.modelExample?.toolCall === true,
    vision: entry.modelExample?.attachment === true,
    headers: { ...(entry.headers ?? {}) },
  };
}

/** The four fields a tick in the Models block writes. Pure, like the fill. */
export interface CatalogModelFill {
  modelId: string;
  modelName: string;
  /** The export's tool-use: a starting tick, changeable below. */
  tools: boolean;
  /** The export's attachment: a starting tick, changeable below. */
  vision: boolean;
}

/**
 * WHAT A TICK IN THE MODELS BLOCK DOES (story 15.14): the model's id, its name
 * and the export's two capabilities — four setters, nothing else. The person
 * can still edit the id, the name and both boxes afterwards; the catalogue is a
 * starting point, never a verdict. It writes no row and asks no request: the
 * add button is still the only write.
 */
export function catalogModelFill(model: CatalogModel): CatalogModelFill {
  return {
    modelId: model.id,
    modelName: model.name,
    tools: model.toolCall === true,
    vision: model.attachment === true,
  };
}

/**
 * THE ENTRY A ROW CAME FROM, BY BASE URL (story 15.14; PROVISIONAL). The row
 * shape has no "came from the catalogue" field — this story adds no record
 * field — so the badge reads the one fact a pick does write: the base URL.
 * A row whose URL the catalogue lists was picked from it; any other endpoint
 * is the person's own and carries Custom. Matching is exact and trimmed: a
 * person who edits the URL has made it their own, and the badge follows.
 */
export function catalogEntryForBaseUrl(
  baseUrl: string,
): ProviderCatalogEntry | null {
  const trimmed = baseUrl.trim();
  return (
    PROVIDER_CATALOG.find((entry) => entry.baseUrl === trimmed) ?? null
  );
}
