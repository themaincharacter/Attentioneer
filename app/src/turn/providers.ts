import type { TurnProvider } from "./protocol";

/**
 * PROVIDER ROWS, MODEL ROWS AND THE ONE STRING A TURN CARRIES (Epic 15 story
 * 4; the config shape is PROVISIONAL).
 *
 * WHY ROWS AND NOT FIELDS: a base URL typed into the ask panel is a fact the
 * person must re-type wherever a turn can leave, and it cannot say which models
 * an endpoint actually offers. A ROW names one place a turn can run (a stable
 * id, a display name, a base URL) and the model rows beneath it carry what each
 * model can do. The turn then carries only providerId:modelId — the string
 * contract Slashspace settled on — and every other fact (base URL, model id,
 * the key) is re-derived from the row at send time. The sidecar's wire does not
 * change: this module still hands it exactly {baseUrl, model, apiKey}.
 *
 * WHY CAPABILITIES ON THE MODEL: an ask is text-only today, so every model row
 * qualifies; the field exists so a later move can pick a model that can do the
 * job (tools, vision) instead of discovering at send time that it cannot. A
 * capability that is absent is FALSE — never a hopeful default: a model the row
 * does not claim to be able to read images must not be offered for a move that
 * sends one.
 *
 * WHY THIS FILE IS PURE: the config file is read and written next door
 * (provider.ts, the one queued read-modify-write in lib/appConfig.ts); here
 * there is no I/O at all, so the rules that decide what may be stored — refuse
 * a row that cannot be acted on, derive and dedupe ids, lay defaults UNDER
 * the person's edits, resolve a selection, filter by capability — are testable
 * as values. Nothing in this file knows about keys: a key is not a row field,
 * ever.
 *
 * PROVISIONAL: the field names, the capability set (tools, vision, an optional
 * contextWindow) and the refusal sentences. The row shape is this file's own.
 */

/** What one model can do. An absent flag means "not claimed", i.e. false. */
export interface ModelCapabilities {
  /** Can the model be asked to use tools? (No move uses one yet.) */
  tools: boolean;
  /** Can the model read an image? (No move sends one yet.) */
  vision: boolean;
  /** The model's stated context window in tokens, when the row knows it. */
  contextWindow?: number;
}

/** One model a provider row offers. */
export interface ModelRow {
  /** The model's id, passed to the provider verbatim. */
  id: string;
  /** The display name the picker shows. */
  name: string;
  /** What this model can do; the move filters on this, never on a vendor. */
  capabilities: ModelCapabilities;
}

/** One place a turn can run. There is deliberately NO key field. */
export interface ProviderRow {
  /** Stable id, derived from the name when the row was made and deduped. */
  id: string;
  /** The display name; the person may edit it afterwards. */
  name: string;
  /** The endpoint's base URL (/chat/completions is the sidecar's business). */
  baseUrl: string;
  /** The models this provider offers; a row with none cannot run a turn. */
  models: ModelRow[];
}

/**
 * The turn object the app config holds: the rows, and which one a turn
 * carries by default. The key is absent by construction — the type has no
 * field for it.
 */
export interface TurnSettings {
  /** The selected provider row's id ("" when nothing is selected). */
  providerId: string;
  /** The selected model row's id ("" when nothing is selected). */
  modelId: string;
  /** Every provider row, in the order the person made them. */
  providers: ProviderRow[];
}

/** The honest nothing: no rows, no selection. */
export const EMPTY_SETTINGS: TurnSettings = {
  providerId: "",
  modelId: "",
  providers: [],
};

/**
 * Rows the app ships (none today). WHY THE LIST EXISTS AT ALL: on an upgrade a
 * built-in row must appear UNDER the person's edits — appended when they do not
 * have it, and never overwriting a row they changed — so the laying rule lives
 * here before there is anything to merge. This app ships NO provider row today:
 * a shipped row would name an endpoint and a model the person did not choose,
 * and a build-time default endpoint is a vendor decision this story has no
 * business making.
 */
export const BUILTIN_PROVIDERS: readonly ProviderRow[] = [];

/** A refusal is a sentence, never an exception: the UI says it where typed. */
export interface Refusal {
  kind: "refused";
  sentence: string;
}

/** A row read from the config, or the one reason it is not a row. */
export type RowRead<T> = { kind: "row"; row: T } | Refusal;

/** The sentences the panel and the turn share (PROVISIONAL wording). */
export const PROVIDER_SENTENCES = {
  /** Nothing resolves: the turn must not leave, and says exactly this. */
  nothing:
    "nothing is configured: add a provider row with a base URL and a model first",
  /** The row has no id, name or base URL (refused at the write). */
  noName: "a provider needs a name",
  noId: "a provider needs a name with a letter or a digit in it",
  noBaseUrl: "a provider needs a base URL",
  badBaseUrl: "a provider's base URL must be http or https",
  noModels: "a provider needs at least one model",
  modelNoId: "a model needs an id",
  modelNoName: "a model needs a name",
  duplicateModel: "two models on one provider share an id",
  duplicateId: "a provider with that id already exists",
} as const;

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/* ------------------------------------------------------------------ *
 * What a model can do.
 * ------------------------------------------------------------------ */

/** Read a stored capability set. Missing or malformed flags read as false. */
export function parseCapabilities(value: unknown): ModelCapabilities {
  const record = isRecord(value) ? value : {};
  const window = record.contextWindow;
  const capabilities: ModelCapabilities = {
    tools: record.tools === true,
    vision: record.vision === true,
  };
  if (typeof window === "number" && Number.isFinite(window) && window > 0) {
    capabilities.contextWindow = window;
  }
  return capabilities;
}

/** What a move needs a model to be able to do (an ask needs no flag today). */
export interface MoveNeed {
  tools?: boolean;
  vision?: boolean;
}

/**
 * Does this model satisfy the move? A requirement the row does not claim is a
 * refusal: filtered by capability, never by a guess about the vendor.
 */
export function capabilitiesMeet(
  capabilities: ModelCapabilities,
  need: MoveNeed,
): boolean {
  if (need.tools === true && capabilities.tools !== true) return false;
  if (need.vision === true && capabilities.vision !== true) return false;
  return true;
}

/** The models of one row that can do the move, in the row's order. */
export function modelsForMove(
  provider: ProviderRow,
  need: MoveNeed,
): ModelRow[] {
  return provider.models.filter((model) =>
    capabilitiesMeet(model.capabilities, need),
  );
}

/* ------------------------------------------------------------------ *
 * Rows: reading, deriving ids, validating a write.
 * ------------------------------------------------------------------ */

/**
 * A stable id made from a display name: lower-case ASCII letters and digits,
 * runs of anything else turned into one dash. "Local llama" reads
 * "local-llama" — the id is not a name (the name may change); it is the string
 * a turn and a key can hold on to.
 */
export function providerSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The first free id for a new row: the slug, then -2, -3… so two rows named
 * the same way never collide (a key hangs off the id, and a collision would
 * make two rows share one key).
 */
export function uniqueProviderId(
  name: string,
  taken: readonly string[],
): string {
  const base = providerSlug(name);
  if (base === "") return "";
  if (!taken.includes(base)) return base;
  let n = 2;
  while (taken.includes(base + "-" + n)) n += 1;
  return base + "-" + n;
}

/** Read one stored model row; null when it is not a row this app can act on. */
export function parseModelRow(value: unknown): ModelRow | null {
  if (!isRecord(value)) return null;
  const id = textOf(value.id).trim();
  const name = textOf(value.name).trim();
  if (id === "" || name === "") return null;
  return { id, name, capabilities: parseCapabilities(value.capabilities) };
}

/** Read one stored provider row; null when it is not a row this app can act on. */
export function parseProviderRow(value: unknown): ProviderRow | null {
  if (!isRecord(value)) return null;
  const id = textOf(value.id).trim();
  const name = textOf(value.name).trim();
  const baseUrl = textOf(value.baseUrl).trim();
  if (id === "" || name === "" || baseUrl === "") return null;
  const models: ModelRow[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.models)) {
    for (const candidate of value.models) {
      const model = parseModelRow(candidate);
      // A duplicate id would resolve two ways; the first row stands.
      if (model === null || seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
  }
  return { id, name, baseUrl, models };
}

/**
 * Read the turn object from the config. Tolerant by design: a config written
 * by an older story (or edited by hand) must not stop the app opening, so a
 * malformed row is DROPPED, not guessed at, and the selection is kept only as
 * strings here — resolveSelection is what decides whether it names a row.
 */
export function readTurnSettings(value: unknown): TurnSettings {
  if (!isRecord(value)) return { ...EMPTY_SETTINGS, providers: [] };
  const providers: ProviderRow[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value.providers)) {
    for (const candidate of value.providers) {
      const row = parseProviderRow(candidate);
      if (row === null || seen.has(row.id)) continue;
      seen.add(row.id);
      providers.push(row);
    }
  }
  return {
    providerId: textOf(value.providerId),
    modelId: textOf(value.modelId),
    providers,
  };
}

/** The shape the config file gets: rows and the selection, and nothing else. */
export function storedTurnSettings(settings: TurnSettings): TurnSettings {
  return {
    providerId: settings.providerId,
    modelId: settings.modelId,
    providers: settings.providers.map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: provider.baseUrl,
      models: provider.models.map((model) => ({
        id: model.id,
        name: model.name,
        capabilities: storedCapabilities(model.capabilities),
      })),
    })),
  };
}

function storedCapabilities(
  capabilities: ModelCapabilities,
): ModelCapabilities {
  const stored: ModelCapabilities = {
    tools: capabilities.tools === true,
    vision: capabilities.vision === true,
  };
  if (capabilities.contextWindow !== undefined) {
    stored.contextWindow = capabilities.contextWindow;
  }
  return stored;
}

/** One provider being added or edited, as the form holds it (not yet a row). */
export interface ProviderDraft {
  /** Absent while adding: the id is derived from the name and deduped. */
  id?: string;
  name: string;
  baseUrl: string;
  models: readonly ModelDraft[];
}

/** One model as the form holds it. */
export interface ModelDraft {
  id: string;
  name: string;
  tools?: boolean;
  vision?: boolean;
  contextWindow?: number;
}

/**
 * Turn a draft into a row, or refuse with the one sentence the form shows.
 * WHY REFUSE AT THE WRITE: the config must never hold a row the app cannot act
 * on — a nameless row has no id to hang a key on, a base URL that is not
 * http(s) cannot be fetched, and a provider with no model can never resolve a
 * turn. taken is every id already used, so a new row cannot shadow one.
 */
export function validateProviderRow(
  draft: ProviderDraft,
  taken: readonly string[] = [],
): RowRead<ProviderRow> {
  const name = draft.name.trim();
  if (name === "") return refused(PROVIDER_SENTENCES.noName);

  const id =
    draft.id === undefined || draft.id.trim() === ""
      ? uniqueProviderId(name, taken)
      : draft.id.trim();
  if (id === "") return refused(PROVIDER_SENTENCES.noId);
  if (draft.id !== undefined && taken.includes(id)) {
    return refused(PROVIDER_SENTENCES.duplicateId);
  }

  const baseUrl = draft.baseUrl.trim();
  if (baseUrl === "") return refused(PROVIDER_SENTENCES.noBaseUrl);
  if (!isHttpUrl(baseUrl)) return refused(PROVIDER_SENTENCES.badBaseUrl);

  if (draft.models.length === 0) return refused(PROVIDER_SENTENCES.noModels);
  const models: ModelRow[] = [];
  const seen = new Set<string>();
  for (const candidate of draft.models) {
    const modelId = candidate.id.trim();
    const modelName = candidate.name.trim();
    if (modelId === "") return refused(PROVIDER_SENTENCES.modelNoId);
    if (modelName === "") return refused(PROVIDER_SENTENCES.modelNoName);
    if (seen.has(modelId)) return refused(PROVIDER_SENTENCES.duplicateModel);
    seen.add(modelId);
    models.push({
      id: modelId,
      name: modelName,
      capabilities: capabilitiesOf(candidate),
    });
  }
  return { kind: "row", row: { id, name, baseUrl, models } };
}

function capabilitiesOf(draft: ModelDraft): ModelCapabilities {
  const capabilities: ModelCapabilities = {
    tools: draft.tools === true,
    vision: draft.vision === true,
  };
  if (
    draft.contextWindow !== undefined &&
    Number.isFinite(draft.contextWindow) &&
    draft.contextWindow > 0
  ) {
    capabilities.contextWindow = draft.contextWindow;
  }
  return capabilities;
}

function isHttpUrl(text: string): boolean {
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function refused(sentence: string): Refusal {
  return { kind: "refused", sentence };
}

/* ------------------------------------------------------------------ *
 * Merging defaults UNDER the person's edits, and the row operations.
 * ------------------------------------------------------------------ */

/**
 * Built-in rows laid UNDER the person's: a row whose id the person already
 * has is THEIRS — their name, base URL and models win — and only a built-in
 * the person does not have is appended. An upgrade therefore adds rows and
 * never clobbers one. (No built-in rows ship today; the rule is here first.)
 */
export function builtinsUnderPerson(
  settings: TurnSettings,
  builtins: readonly ProviderRow[],
): TurnSettings {
  const taken = new Set(settings.providers.map((provider) => provider.id));
  const laid = [...settings.providers];
  for (const builtin of builtins) {
    if (taken.has(builtin.id)) continue;
    taken.add(builtin.id);
    laid.push({
      ...builtin,
      models: builtin.models.map((model) => ({
        ...model,
        capabilities: { ...model.capabilities },
      })),
    });
  }
  return { ...settings, providers: laid };
}

/** Add or replace a row by id (a replacement keeps its place in the list). */
export function withProvider(
  settings: TurnSettings,
  row: ProviderRow,
): TurnSettings {
  const index = settings.providers.findIndex(
    (provider) => provider.id === row.id,
  );
  const providers =
    index === -1
      ? [...settings.providers, row]
      : settings.providers.map((provider, at) =>
          at === index ? row : provider,
        );
  return { ...settings, providers };
}

/**
 * Remove a row. A selection that named it is CLEARED, so nothing goes on
 * pointing at a provider (and a key) that is no longer there: a turn then says
 * nothing is configured instead of using a half-remembered base URL.
 */
export function withoutProvider(
  settings: TurnSettings,
  providerId: string,
): TurnSettings {
  const providers = settings.providers.filter(
    (provider) => provider.id !== providerId,
  );
  const clearing = settings.providerId === providerId;
  return {
    providers,
    providerId: clearing ? "" : settings.providerId,
    modelId: clearing ? "" : settings.modelId,
  };
}

/** Select a row and one of its models (the person's default for a turn). */
export function withSelection(
  settings: TurnSettings,
  providerId: string,
  modelId: string,
): TurnSettings {
  return { ...settings, providerId, modelId };
}

/* ------------------------------------------------------------------ *
 * The one string a turn carries, and its resolution.
 * ------------------------------------------------------------------ */

/** providerId:modelId — the only provider fact a turn carries. */
export function formatProviderRef(providerId: string, modelId: string): string {
  if (providerId === "" || modelId === "") return "";
  return providerId + ":" + modelId;
}

/**
 * Split the contract string. The FIRST colon separates the two ids, so a model
 * id containing a colon (some local runtimes brand them that way) still
 * resolves; provider ids are slugs and never contain one.
 */
export function parseProviderRef(
  ref: string,
): { providerId: string; modelId: string } | null {
  const at = ref.indexOf(":");
  if (at <= 0) return null;
  const providerId = ref.slice(0, at).trim();
  const modelId = ref.slice(at + 1).trim();
  if (providerId === "" || modelId === "") return null;
  return { providerId, modelId };
}

/** The row and model the settings' selection names. */
export interface ResolvedProvider {
  provider: ProviderRow;
  model: ModelRow;
}

/** A resolution: a row and its model, or the one sentence why not. */
export type Resolution =
  | { kind: "resolved"; provider: ProviderRow; model: ModelRow }
  | Refusal;

/** Resolve an explicit providerId/modelId pair against the rows. */
export function resolveProvider(
  settings: TurnSettings,
  providerId: string,
  modelId: string,
): Resolution {
  const provider = settings.providers.find((row) => row.id === providerId);
  if (provider === undefined) {
    return refused(PROVIDER_SENTENCES.nothing);
  }
  const model = provider.models.find((row) => row.id === modelId);
  if (model === undefined) {
    return refused(PROVIDER_SENTENCES.nothing);
  }
  return { kind: "resolved", provider, model };
}

/** Resolve the settings' own selection (what an ask sends by default). */
export function resolveSelection(settings: TurnSettings): Resolution {
  return resolveProvider(settings, settings.providerId, settings.modelId);
}

/**
 * Build the sidecar's provider from a resolved row: EXACTLY the three fields
 * 15.1's wire has always carried. The row contributes the base URL and the
 * model id; the key came from the store at send time. Nothing else rides — in
 * particular the provider's NAME never does (the model does not need to know
 * what the person calls the endpoint).
 */
export function providerFrom(
  provider: ProviderRow,
  model: ModelRow,
  apiKey: string,
): TurnProvider {
  return {
    baseUrl: provider.baseUrl.trim(),
    model: model.id.trim(),
    apiKey,
  };
}
