import type { TurnProvider } from "./protocol";
import { promptTemplateProblem } from "./cli";
import { PROMPT_PLACEHOLDER, type CliSpec } from "./cliSpecs";
import { localArgsProblem, modelStem } from "./local";
import { DEFAULT_LOCAL_IDLE_MINUTES } from "./localSpecs";

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
 * ONE ROW, TWO KINDS (Epic 15 story 5): an endpoint row keeps the shape story 4
 * gave it (and an older config reads as one, because its absence of a `kind`
 * is what an endpoint always meant); a CLI row carries a SPEC instead of a
 * base URL — command, version argv, an optional sign-in probe and the run
 * argv that carries one prompt. Both kinds still resolve through
 * providerId:modelId; a CLI row's one model is named after the command it
 * runs, so nothing above this file has to know which kind a turn runs in
 * until `turn.ts` dispatches once.
 *
 * PROVISIONAL: the field names, the capability set (tools, vision, an optional
 * contextWindow), the CLI spec's fields and the refusal sentences. The row
 * shape is this file's own.
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

/** Which tier a row runs in: an endpoint, a CLI, a model on this machine. */
export type ProviderKind = "http" | "cli" | "local";

/** What both kinds share: an identity and the models a move may pick. */
interface ProviderRowBase {
  /** Stable id, derived from the name when the row was made and deduped. */
  id: string;
  /** The display name; the person may edit it afterwards. */
  name: string;
  /** The models this provider offers; a row with none cannot run a turn. */
  models: ModelRow[];
}

/** One HTTP endpoint. There is deliberately NO key field. */
export interface HttpProviderRow extends ProviderRowBase {
  kind: "http";
  /** The endpoint's base URL (/chat/completions is the sidecar's business). */
  baseUrl: string;
}

/**
 * One external CLI, as the SPEC fields its spec carries (PROVISIONAL). A CLI
 * row owns the same shape a shipped spec does, because a typed command and a
 * shipped entry must take the same path through the app — the row is the
 * person's copy of the spec, and nothing knows one from the other.
 *
 * The models list is the string contract's second half: a cli row has ONE
 * model, named after the command it runs, so a turn still carries
 * providerId:modelId.
 */
export interface CliProviderRow extends ProviderRowBase {
  kind: "cli";
  /** The binary: a bare name (PATH, then well-known) or a path as typed. */
  command: string;
  /** The argv that prints the version. */
  versionArgs: string[];
  /** The OPTIONAL sign-in probe; absent means the probe does not apply. */
  auth?: { args: string[]; okPattern: string };
  /** How one prompt runs; `{prompt}` stands in exactly one argument. */
  run: { args: string[]; read: "stdout" };
  /** Extra places to look, after PATH. */
  wellKnown?: string[];
  /** What this row claims, in the person's words. */
  notes: string;
}

/**
 * One model that runs on THIS machine (Epic 15 story 6). The row is the
 * command, the model path, and the argv with its placeholders; the port and
 * the key are NOT fields, because the app chooses them per launch and holds
 * the key in memory only. The one model row beneath it is the id the turn
 * sends over HTTP — named after the model file, like a CLI row is named after
 * its command, so the string contract still resolves.
 */
export interface LocalProviderRow extends ProviderRowBase {
  kind: "local";
  /** The server binary: a bare name (PATH) or a path as typed. */
  command: string;
  /** The model path handed to {model}; it may contain spaces. */
  model: string;
  /** The argv, with {port}, {key} and {model} each in one entry. */
  args: string[];
  /** The OPTIONAL line that means the server is ready. */
  readyPattern?: string;
  /** Minutes with no turn before the child is killed. */
  idleMinutes: number;
  /** What this row claims, in the person's words. */
  notes: string;
}

/** One place a turn can run: an endpoint, a CLI spec, or a local server. */
export type ProviderRow = HttpProviderRow | CliProviderRow | LocalProviderRow;

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
    "nothing is configured: add a provider row — an endpoint, or a command — first",
  /** The row has no id, name or base URL (refused at the write). */
  noName: "a provider needs a name",
  noId: "a provider needs a name with a letter or a digit in it",
  noBaseUrl: "a provider needs a base URL",
  badBaseUrl: "a provider's base URL must be http or https",
  /**
   * Plain http is for a model on THIS machine; anywhere else the key and the
   * conversation would travel in clear text. PROVISIONAL wording.
   */
  insecureBaseUrl:
    "a remote provider needs https: plain http is only for a model on this machine",
  noModels: "a provider needs at least one model",
  modelNoId: "a model needs an id",
  modelNoName: "a model needs a name",
  duplicateModel: "two models on one provider share an id",
  duplicateId: "a provider with that id already exists",
  /** The CLI kind's own refusals. */
  cliNoCommand: "a CLI provider needs a command to run",
  cliNoVersion: "a CLI provider needs the arguments that print its version",
  cliNoPrompt:
    "the run arguments need {prompt} — it is where the question goes",
  cliManyPrompts: "only one run argument may carry {prompt}",
  cliNoPattern: "a sign-in check needs a pattern to look for",
  /** The local kind's own refusals (the argv's are local.ts's sentences). */
  localNoCommand: "a local provider needs a server command to run",
  localNoModel: "a local provider needs the model file to hand to its command",
  localNoArgs: "a local provider needs the arguments that start its server",
  localIdle: "a local provider's idle window must be at least one minute",
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

/** Read the models a stored row lists; drop what is broken or duplicated. */
function readModelRows(value: unknown): ModelRow[] {
  const models: ModelRow[] = [];
  const seen = new Set<string>();
  if (Array.isArray(value)) {
    for (const candidate of value) {
      const model = parseModelRow(candidate);
      // A duplicate id would resolve two ways; the first row stands.
      if (model === null || seen.has(model.id)) continue;
      seen.add(model.id);
      models.push(model);
    }
  }
  return models;
}

/** A list of argv entries, trimmed and without blanks. */
function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const entries: string[] = [];
  for (const candidate of value) {
    const text = textOf(candidate).trim();
    if (text !== "") entries.push(text);
  }
  return entries;
}

/** Read one stored auth block; a malformed one reads as NO block. */
function parseAuthBlock(
  value: unknown,
): { args: string[]; okPattern: string } | null {
  if (!isRecord(value)) return null;
  const args = stringList(value.args);
  const okPattern = textOf(value.okPattern);
  if (args.length === 0 || okPattern === "") return null;
  return { args, okPattern };
}

/** Read one stored CLI row; null when it is not a row this app can act on. */
function parseCliRow(value: Record<string, unknown>): CliProviderRow | null {
  const id = textOf(value.id).trim();
  const name = textOf(value.name).trim();
  const command = textOf(value.command).trim();
  if (id === "" || name === "" || command === "") return null;
  const versionArgs = stringList(value.versionArgs);
  const runArgs = isRecord(value.run) ? stringList(value.run.args) : [];
  // A run template without exactly one {prompt} cannot carry a question.
  if (runArgs.length === 0 || promptTemplateProblem(runArgs) !== null) {
    return null;
  }
  const row: CliProviderRow = {
    kind: "cli",
    id,
    name,
    command,
    versionArgs,
    run: { args: runArgs, read: "stdout" },
    notes: textOf(value.notes),
    models: readModelRows(value.models),
  };
  const auth = parseAuthBlock(value.auth);
  if (auth !== null) row.auth = auth;
  const wellKnown = stringList(value.wellKnown);
  if (wellKnown.length > 0) row.wellKnown = wellKnown;
  return row;
}

/** Read one stored local row; null when it is not a row this app can act on. */
function parseLocalRow(value: Record<string, unknown>): LocalProviderRow | null {
  const id = textOf(value.id).trim();
  const name = textOf(value.name).trim();
  const command = textOf(value.command).trim();
  const model = textOf(value.model).trim();
  if (id === "" || name === "" || command === "" || model === "") return null;
  const args = stringList(value.args);
  // An argv the app could not substitute would start a server on the wrong
  // port (or no port): dropped at the read, never guessed at.
  if (args.length === 0 || localArgsProblem(args) !== null) return null;
  const stated = value.idleMinutes;
  const idleMinutes =
    typeof stated === "number" && Number.isFinite(stated) && stated >= 1
      ? Math.floor(stated)
      : DEFAULT_LOCAL_IDLE_MINUTES;
  const row: LocalProviderRow = {
    kind: "local",
    id,
    name,
    command,
    model,
    args,
    idleMinutes,
    notes: textOf(value.notes),
    models: readModelRows(value.models),
  };
  const readyPattern = textOf(value.readyPattern);
  if (readyPattern !== "") row.readyPattern = readyPattern;
  return row;
}

/** Read one stored provider row; null when it is not a row this app can act on. */
export function parseProviderRow(value: unknown): ProviderRow | null {
  if (!isRecord(value)) return null;
  // Rows written before the CLI kind existed carry no `kind`; they are
  // endpoints, which is what they were.
  if (value.kind === "cli") return parseCliRow(value);
  if (value.kind === "local") return parseLocalRow(value);
  const id = textOf(value.id).trim();
  const name = textOf(value.name).trim();
  const baseUrl = textOf(value.baseUrl).trim();
  if (id === "" || name === "" || baseUrl === "") return null;
  return { kind: "http", id, name, baseUrl, models: readModelRows(value.models) };
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

/** What the config file holds: a selection and rows, field by field. */
export interface StoredTurnSettings {
  providerId: string;
  modelId: string;
  providers: Record<string, unknown>[];
}

/**
 * The shape the config file gets: rows and the selection, and nothing else.
 * Built field by field, so a stray property can never ride along. An HTTP row
 * keeps the shape it has always had (no `kind` — its absence is what an older
 * config reads, and an endpoint is the only kind that shape ever meant); a CLI
 * row carries its spec's fields and says which kind it is.
 */
export function storedTurnSettings(settings: TurnSettings): StoredTurnSettings {
  return {
    providerId: settings.providerId,
    modelId: settings.modelId,
    providers: settings.providers.map(storedProviderRow),
  };
}

function storedProviderRow(provider: ProviderRow): Record<string, unknown> {
  const models = provider.models.map((model) => ({
    id: model.id,
    name: model.name,
    capabilities: storedCapabilities(model.capabilities),
  }));
  if (provider.kind === "local") {
    const stored: Record<string, unknown> = {
      kind: "local",
      id: provider.id,
      name: provider.name,
      command: provider.command,
      model: provider.model,
      args: [...provider.args],
      idleMinutes: provider.idleMinutes,
      notes: provider.notes,
      models,
    };
    if (provider.readyPattern !== undefined) {
      stored.readyPattern = provider.readyPattern;
    }
    return stored;
  }
  if (provider.kind === "cli") {
    const stored: Record<string, unknown> = {
      kind: "cli",
      id: provider.id,
      name: provider.name,
      command: provider.command,
      versionArgs: [...provider.versionArgs],
      run: { args: [...provider.run.args], read: "stdout" },
      notes: provider.notes,
      models,
    };
    if (provider.auth !== undefined) {
      stored.auth = {
        args: [...provider.auth.args],
        okPattern: provider.auth.okPattern,
      };
    }
    if (provider.wellKnown !== undefined) {
      stored.wellKnown = [...provider.wellKnown];
    }
    return stored;
  }
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    models,
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
 * http(s) cannot be fetched, a plain-http remote URL would send the key in
 * clear text (see `baseUrlProblem`), and a provider with no model can never
 * resolve a turn. taken is every id already used, so a new row cannot shadow
 * one.
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
  const urlProblem = baseUrlProblem(baseUrl);
  if (urlProblem !== null) return refused(urlProblem);

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
  return { kind: "row", row: { kind: "http", id, name, baseUrl, models } };
}

/* ------------------------------------------------------------------ *
 * The CLI kind: a row is a spec, and the spec is data.
 * ------------------------------------------------------------------ */

/**
 * One CLI being added or edited, as the form holds it (not yet a row). The
 * args are argv arrays even here: the form splits text into entries, and the
 * prompt is never one of them (it replaces `{prompt}` at run time).
 */
export interface CliProviderDraft {
  /** Absent while adding: the id is derived from the name and deduped. */
  id?: string;
  name: string;
  command: string;
  versionArgs: readonly string[];
  runArgs: readonly string[];
  /** The sign-in probe's argv; empty means the probe does not apply. */
  authArgs?: readonly string[];
  okPattern?: string;
  wellKnown?: readonly string[];
  notes?: string;
}

/** The last segment of a command, without a Windows shim's extension. */
export function commandStem(command: string): string {
  const trimmed = command.trim().replace(/[\\/]+$/, "");
  const segment = trimmed.split(/[\\/]/).pop() ?? "";
  return segment.replace(/\.(exe|cmd|bat)$/i, "");
}

/**
 * Turn a CLI draft into a row, or refuse with the one sentence the form shows.
 * WHAT IS REQUIRED: a name (for the id), a command, the version argv (without
 * it a probe would run a CLI with no arguments and wait for a prompt that
 * never comes), and a run template carrying `{prompt}` exactly once. The
 * sign-in probe is optional; when its argv is given it also needs a pattern,
 * because a probe that cannot decide anything is worse than no probe.
 */
export function validateCliProviderRow(
  draft: CliProviderDraft,
  taken: readonly string[] = [],
): RowRead<CliProviderRow> {
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

  const command = draft.command.trim();
  if (command === "") return refused(PROVIDER_SENTENCES.cliNoCommand);

  const versionArgs = draft.versionArgs
    .map((arg) => arg.trim())
    .filter((arg) => arg !== "");
  if (versionArgs.length === 0) {
    return refused(PROVIDER_SENTENCES.cliNoVersion);
  }

  const runArgs = draft.runArgs
    .map((arg) => arg.trim())
    .filter((arg) => arg !== "");
  const carrying = runArgs.filter((arg) =>
    arg.includes(PROMPT_PLACEHOLDER),
  ).length;
  if (carrying === 0) return refused(PROVIDER_SENTENCES.cliNoPrompt);
  if (carrying > 1) return refused(PROVIDER_SENTENCES.cliManyPrompts);

  const authArgs = (draft.authArgs ?? [])
    .map((arg) => arg.trim())
    .filter((arg) => arg !== "");
  const okPattern = (draft.okPattern ?? "").trim();
  if (authArgs.length > 0 && okPattern === "") {
    return refused(PROVIDER_SENTENCES.cliNoPattern);
  }

  // THE SECOND HALF OF THE CONTRACT: a cli row has ONE model, named after the
  // command it runs. A turn still carries providerId:modelId, and the picker
  // shows the command rather than inventing a model that does not exist.
  const stem = commandStem(command);
  const modelId = providerSlug(stem) === "" ? "cli" : providerSlug(stem);
  const modelName = stem === "" ? name : stem;

  const row: CliProviderRow = {
    kind: "cli",
    id,
    name,
    command,
    versionArgs,
    run: { args: runArgs, read: "stdout" },
    notes: (draft.notes ?? "").trim(),
    models: [
      {
        id: modelId,
        name: modelName,
        capabilities: { tools: false, vision: false },
      },
    ],
  };
  if (authArgs.length > 0) row.auth = { args: authArgs, okPattern };
  const wellKnown = (draft.wellKnown ?? [])
    .map((place) => place.trim())
    .filter((place) => place !== "");
  if (wellKnown.length > 0) row.wellKnown = wellKnown;
  return { kind: "row", row };
}

/**
 * One local server being added or edited, as the form holds it (not yet a
 * row). The args are an argv array even here: the form splits its text into
 * entries, and the placeholders stay inside them.
 */
export interface LocalProviderDraft {
  /** Absent while adding: the id is derived from the name and deduped. */
  id?: string;
  name: string;
  command: string;
  model: string;
  args: readonly string[];
  readyPattern?: string;
  idleMinutes?: number;
  notes?: string;
}

/**
 * Turn a local draft into a row, or refuse with the one sentence the form
 * shows. WHAT IS REQUIRED: a name (for the id), a command, the model file's
 * path, and an argv the host can substitute — exactly one {port}, at most one
 * {key} and {model}, and no placeholder the app does not know. The idle
 * window defaults to the shipped default and never drops below one minute.
 */
export function validateLocalProviderRow(
  draft: LocalProviderDraft,
  taken: readonly string[] = [],
): RowRead<LocalProviderRow> {
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

  const command = draft.command.trim();
  if (command === "") return refused(PROVIDER_SENTENCES.localNoCommand);

  const model = draft.model.trim();
  if (model === "") return refused(PROVIDER_SENTENCES.localNoModel);

  const args = draft.args.map((arg) => arg.trim()).filter((arg) => arg !== "");
  if (args.length === 0) return refused(PROVIDER_SENTENCES.localNoArgs);
  const problem = localArgsProblem(args);
  if (problem !== null) return refused(problem);

  const stated = draft.idleMinutes ?? DEFAULT_LOCAL_IDLE_MINUTES;
  if (!Number.isFinite(stated) || stated < 1) {
    return refused(PROVIDER_SENTENCES.localIdle);
  }

  // THE SECOND HALF OF THE CONTRACT: a local row has ONE model row, named
  // after the model file, so a turn still carries providerId:modelId.
  const stem = modelStem(model);
  const modelId = providerSlug(stem) === "" ? "local" : providerSlug(stem);
  const modelName = stem === "" ? name : stem;

  const row: LocalProviderRow = {
    kind: "local",
    id,
    name,
    command,
    model,
    args,
    idleMinutes: Math.floor(stated),
    notes: (draft.notes ?? "").trim(),
    models: [
      {
        id: modelId,
        name: modelName,
        capabilities: { tools: false, vision: false },
      },
    ],
  };
  const readyPattern = (draft.readyPattern ?? "").trim();
  if (readyPattern !== "") row.readyPattern = readyPattern;
  return { kind: "row", row };
}

/**
 * The spec a stored CLI row stands for. The row IS the person's copy of a
 * shipped spec, so probing and running take the same value either way — there
 * is no second shape a typed command would have to be translated into.
 */
export function cliSpecOf(row: CliProviderRow): CliSpec {
  const spec: CliSpec = {
    id: row.id,
    name: row.name,
    command: row.command,
    versionArgs: [...row.versionArgs],
    run: { args: [...row.run.args], read: "stdout" },
    notes: row.notes,
  };
  if (row.auth !== undefined) {
    spec.auth = { args: [...row.auth.args], okPattern: row.auth.okPattern };
  }
  if (row.wellKnown !== undefined) spec.wellKnown = [...row.wellKnown];
  return spec;
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

/** The hosts a plain `http://` base URL may name: this machine's loopback. */
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set([
  "127.0.0.1",
  "[::1]",
  "localhost",
]);

/** Is this host this machine? (The URL parser already case-folds it.) */
export function isLoopbackHost(hostname: string): boolean {
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

/**
 * THE HTTPS RULE (story 15.9). A base URL is storable when it is `https://`
 * anywhere, or `http://` for LOOPBACK ONLY — `127.0.0.1`, `[::1]` or
 * `localhost`, any port and any path. Every other host must be https: a
 * plain-http remote endpoint would send the key and the whole conversation in
 * clear text. A failing URL gets the ONE sentence to refuse with; there is no
 * warning-only path and no silent upgrade — the row is not stored at all.
 */
export function baseUrlProblem(text: string): string | null {
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return PROVIDER_SENTENCES.badBaseUrl;
  }
  if (url.protocol === "https:") return null;
  if (url.protocol !== "http:") return PROVIDER_SENTENCES.badBaseUrl;
  return isLoopbackHost(url.hostname)
    ? null
    : PROVIDER_SENTENCES.insecureBaseUrl;
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
  provider: HttpProviderRow,
  model: ModelRow,
  apiKey: string,
): TurnProvider {
  return {
    baseUrl: provider.baseUrl.trim(),
    model: model.id.trim(),
    apiKey,
  };
}
