import { useEffect, useRef, useState } from "react";
import {
  forgetSecret,
  keyExists,
  readSecret,
  secretStatus,
  secretStatusWords,
  setSecret,
  type SecretStore,
  type SecretWrite,
} from "../lib/secret";
import {
  MODEL_LIST_SENTENCES,
  offerFetchedModels,
  modelsFetchProblem,
  newTickedModels,
  truncationSentence,
  withTickedModels,
  type FetchedModel,
} from "../turn/modelList";
import {
  askProviderModels,
  connectionSentence,
  createModelFetcher,
  type EndpointAnswer,
  type ModelFetcher,
} from "../turn/modelFetch";
import { loadTurnSettings, saveTurnSettings } from "../turn/provider";
import {
  cliSpecOf,
  formatProviderRef,
  modelsForMove,
  validateCliProviderRow,
  validateLocalProviderRow,
  validateProviderRow,
  withProvider,
  withSelection,
  withoutProvider,
  PROVIDER_SENTENCES,
  type CliProviderRow,
  type HttpProviderRow,
  type LocalProviderRow,
  type ModelRow,
  type ProviderDraft,
  type ProviderKind,
  type ProviderRow,
  type TurnSettings,
} from "../turn/providers";
import { CLI_SPECS, type CliSpec } from "../turn/cliSpecs";
import {
  CUSTOM_CATALOG_ID,
  CUSTOM_FILL,
  PROVIDER_CATALOG,
  catalogEntry,
  catalogEntryForBaseUrl,
  catalogFill,
  catalogLabel,
  catalogModelFill,
  type CatalogModel,
  type ProviderCatalogFill,
} from "../turn/providerCatalog";
import {
  DEFAULT_LOCAL_IDLE_MINUTES,
  LOCAL_SPECS,
  type LocalSpec,
} from "../turn/localSpecs";
import { localSentence, type LocalStatus } from "../turn/local";
import { localStatus, startLocal, stopLocal } from "../turn/localBridge";
import { resolutionSentence, type CliProbe } from "../turn/cli";
import { probeSpec } from "../turn/cliBridge";

/**
 * THE PROVIDERS PANEL (Epic 15 story 4) — the person's rows, where the key
 * lives, and which provider a turn carries.
 *
 * WHY ONE BLOCK AND NOT FIELDS ON EACH ASK: a base URL typed into an ask is a
 * fact re-typed at every door a turn can leave by, and it cannot say which
 * models an endpoint offers. Rows are the one place; an ask only selects
 * providerId:modelId. Since story 15.10 this is the Providers SECTION of the
 * settings modal, mounted there and nowhere else — the ask panels have no
 * provider form of their own (one implementation, so the surfaces cannot drift
 * into two ideas of a provider). Its own heading and close verb are gone: the
 * frame names the section and owns the close.
 *
 * WHY THE KEY IS WRITE-ONLY HERE: the person can SET a key and can see that one
 * is set ("a key is set"); no field is ever filled from the store, nothing
 * shows the value, and saving a row never carries one. Removing a row deletes
 * its key through the same bridge — a key must not outlive the row that named
 * it. If the deletion refuses, the row is KEPT and the refusal is said: losing
 * the key silently would be worse than a noisy provider.
 *
 * WHY THE STATUS LINE IS ALWAYS THERE: the keychain is the intent; a local file
 * is the stated fallback (one owner-only file, for machines with no working
 * Secret Service). Which one is in use is a fact about this machine, so it is
 * on screen the whole time the panel is open, not a note shown once.
 *
 * STORY 11 ADDS ONE VERB TO AN ENDPOINT ROW: fetch models. It asks once, shows
 * the provider's list with the row's own models already checked, and adds only
 * what the person ticks — a fetch never writes, never removes, never renames.
 * A command or a local model has exactly one model already, so its row says why
 * it has no list instead of offering a verb that could only fail.
 *
 * STORY 12 ADDS THE BASIC THINGS WHERE A PERSON LOOKS FOR THEM: the add form
 * carries the key (optional, write-only, typed once and kept), the key line on
 * a row is always on screen — never behind the edit toggle — and each endpoint
 * row gets a test verb beside fetch models. Add writes the ROW first and the
 * key second, so a store that refuses the key cannot lose a row that already
 * exists; the refusal is one sentence and the row stays. Test is the same ask
 * as fetch, said as one measured sentence, and it writes nothing.
 *
 * STORY 13 ADDS A PICKER, NOT A REQUEST: a known provider can be picked from a
 * short catalogue (providerCatalog.ts), which fills name, base URL and an
 * example model and puts the caret in the key field. A pick is DATA ONLY — no
 * request, no validation, no automatic add — and "a custom endpoint" is
 * today's empty form, first-class. DeepSeek Harness's catalogue is the shape;
 * Slashspace's "add your own OpenAI-compatible API providers"
 * paste-and-validate flow is the feel. Every entry is marked unverified until
 * a person's account answers.
 *
 * STORY 15 CHANGES THE SOURCE, NOT THE PICK: the catalogue is now a projection
 * of the vendored models.dev export (providerCatalog.ts), refreshed by an
 * explicit script and never fetched here. A pick still fills the form and
 * focuses the key field; it only also pre-ticks tools/vision from the example
 * model's own capabilities. The user's point — "this should be a library at
 * this point" — is why the facts moved into a committed export we import
 * instead of rows we assert.
 *
 * STORY 14 GIVES THE LIST THE SHAPE EVERYONE KNOWS (the user's screenshots of
 * the industry-standard provider UI): a row is a status dot, a name, a Custom
 * badge when the person typed the endpoint, and its verbs; a dashed
 * "+ Add provider" opens a two-tab dialog — "a known provider" (the picker and
 * a Models block fed by the vendored models.dev export, each model marked for
 * tools and images) and "a custom endpoint" (TODAY'S FORM, moved, not
 * changed) — with Cancel/Add at the footer of both. The reference app's other
 * habits are DELIBERATELY NOT COPIED: no retry policy on the verbs, and no
 * account or "signed in" row. A tick in the Models block only fills the four
 * model fields; it writes nothing, requests nothing, and goes through the same
 * validator and the same write queue as every other add.
 *
 * NO KEY ECHO, EVER: a masked prefix is NOT copied from the reference shape
 * (its rows show one). The store is write-only, so a row says "a key is set"
 * and NOTHING more — no prefix, no length, no last four, no masked value. Only
 * existence can be known.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the layout, the field order, the tab
 * wording, the dot and badge treatments, and the wording of the refusals.
 */

/**
 * THE TWO WRITES OF ONE ADD (story 12), in the only order that is honest.
 *
 * WHY THE ROW FIRST: a key without a row is a leftover nobody can name, so the
 * row is saved before anything is kept. WHY A REFUSED KEY DOES NOT ROLL IT BACK:
 * the row is the thing the person authored and can still use; silently deleting
 * it because a keychain said no would throw away their work. The sentence says
 * exactly that, and nothing from the store is echoed into it.
 */
export const ADD_KEY_SENTENCES = {
  kept: "the key is kept; it will not be shown again",
  notKept: "the provider is kept; the key was not kept",
} as const;

export type AddWithKeyOutcome =
  | { kind: "row-refused" }
  | { kind: "added"; key: null }
  | { kind: "added"; key: "kept" }
  | { kind: "added"; key: "refused"; sentence: string };

/**
 * Save the row, then (only if there IS a key to keep) keep the key. The two
 * writes are injected so a test can watch their ORDER without a window, a
 * store or a config file.
 */
export async function addRowThenKey(
  providerId: string,
  key: string,
  save: () => Promise<boolean>,
  keep: (providerId: string, secret: string) => Promise<SecretWrite>,
): Promise<AddWithKeyOutcome> {
  if (!(await save())) return { kind: "row-refused" };
  const secret = key.trim();
  if (secret === "") return { kind: "added", key: null };
  const kept = await keep(providerId, secret);
  if (kept.kind === "refused") {
    return {
      kind: "added",
      key: "refused",
      sentence: ADD_KEY_SENTENCES.notKept,
    };
  }
  return { kind: "added", key: "kept" };
}

/**
 * IS THIS ROW THE PERSON'S OWN? (story 15.14; PROVISIONAL). The row shape has no
 * "where it came from" field — this story adds no record field — so the Custom
 * badge is DERIVED, never stored: an endpoint whose base URL no catalogue entry
 * lists was typed (or edited) by the person, and a command or local runtime
 * whose id no shipped spec owns was typed too. A row picked from the catalogue,
 * or added from a shipped spec, is not Custom. The test of a URL is
 * catalogEntryForBaseUrl's; the test of a spec is its own data.
 */
export function customRow(provider: ProviderRow): boolean {
  if (provider.kind === "http") {
    return catalogEntryForBaseUrl(provider.baseUrl) === null;
  }
  const shipped =
    provider.kind === "cli"
      ? CLI_SPECS.map((spec) => spec.id)
      : LOCAL_SPECS.map((spec) => spec.id);
  return !shipped.includes(provider.id);
}

/**
 * The shipped llama.cpp preset the local form starts from (PROVISIONAL flags,
 * localSpecs.ts): command, argv, readiness line and idle window. The model
 * path is the person's, because this app downloads no model.
 */
const DEFAULT_LOCAL_SPEC: LocalSpec = LOCAL_SPECS[0];

/**
 * The app's fetcher, made ONCE: a fetch is a press, and every row's verb uses
 * the same sidecar pipe the turns use. A test may pass its own through the
 * prop; the render tests never press it.
 */
const appModelFetcher: ModelFetcher = createModelFetcher();

export function ProvidersPanel({
  onChanged,
  fetchModels = appModelFetcher,
}: {
  /** The rows or the selection changed (the frame re-reads its facts). */
  onChanged?: () => void;
  /** Ask a provider for its list (the sidecar's GET; a test passes a stand-in). */
  fetchModels?: ModelFetcher;
}) {
  const [settings, setSettings] = useState<TurnSettings | null>(null);
  const [store, setStore] = useState<SecretStore | null>(null);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [sentence, setSentence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // THE FETCHED CHECKLIST (story 11): one list per row at a time. A list is
  // what the provider OFFERED, marked where the row already has it; the ticks
  // are the ids the person chose, and nothing is written until confirm. A
  // failed fetch leaves both empty and only a sentence behind.
  const [fetching, setFetching] = useState<string | null>(null);
  const [lists, setLists] = useState<Record<string, FetchedModel[]>>({});
  const [ticks, setTicks] = useState<Record<string, string[]>>({});
  const [fetchNotes, setFetchNotes] = useState<Record<string, string>>({});
  const [fetchOffered, setFetchOffered] = useState<Record<string, number>>({});

  // The add form's fields. One model comes with a new provider: a row with no
  // model can never resolve a turn, so the form cannot make one.
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [modelId, setModelId] = useState("");
  const [modelName, setModelName] = useState("");
  const [tools, setTools] = useState(false);
  const [vision, setVision] = useState(false);

  // WHICH KIND IS BEING ADDED (story 5's CLI and story 6's local runtime
  // live beside the endpoint form).
  const [kind, setKind] = useState<ProviderKind>("http");

  // THE LOCAL FORM'S FIELDS. The shipped llama.cpp preset fills command, args,
  // readiness line and idle window; the person supplies the model path (this
  // app downloads no model).The args stay EDITOR TEXT split on spaces, exactly
  // like the CLI form: the arrays are what the row stores.
  const [localCommand, setLocalCommand] = useState(DEFAULT_LOCAL_SPEC.command);
  const [localModel, setLocalModel] = useState("");
  const [localArgs, setLocalArgs] = useState(DEFAULT_LOCAL_SPEC.args.join(" "));
  const [localReady, setLocalReady] = useState(
    DEFAULT_LOCAL_SPEC.readyPattern ?? "",
  );
  const [localIdle, setLocalIdle] = useState(
    String(DEFAULT_LOCAL_SPEC.idleMinutes),
  );

  // ONE RUNTIME, ONE CHILD: the panel shows what the host reports for the row
  // that started it, and the sentence beside the row says running/stopped.
  const [localStates, setLocalStates] = useState<
    Record<string, LocalStatus | null>
  >({});
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});

  // THE CLI FORM'S FIELDS. Every argv is EDITOR TEXT split on spaces — a
  // provisional convenience: the arrays are what the row stores, and a value
  // containing a space is typed as its own line later, not quoted here.
  const [command, setCommand] = useState("");
  const [versionArgs, setVersionArgs] = useState("--version");
  const [runArgs, setRunArgs] = useState("{prompt}");
  const [authArgs, setAuthArgs] = useState("");
  const [okPattern, setOkPattern] = useState("");

  // THE PROBE READOUT: the typed command's before it is saved, and one per
  // saved row after a check. A probe is facts the app shows, never a gate.
  const [probe, setProbe] = useState<CliProbe | null>(null);
  const [probing, setProbing] = useState(false);
  const [rowProbes, setRowProbes] = useState<Record<string, CliProbe>>({});

  // A CLI row being edited has its own argv fields; ONE editor at a time.
  const [editCommand, setEditCommand] = useState("");
  const [editVersionArgs, setEditVersionArgs] = useState("");
  const [editRunArgs, setEditRunArgs] = useState("");
  const [editAuthArgs, setEditAuthArgs] = useState("");
  const [editOkPattern, setEditOkPattern] = useState("");
  const [editModelPath, setEditModelPath] = useState("");
  const [editLocalArgs, setEditLocalArgs] = useState("");
  const [editReadyPattern, setEditReadyPattern] = useState("");
  const [editIdleMinutes, setEditIdleMinutes] = useState("");

  // Which row is being edited, and the key being set on which row. ONE at a
  // time: two open editors on one list would be two versions of the truth.
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editBaseUrl, setEditBaseUrl] = useState("");
  const [keyFor, setKeyFor] = useState<string | null>(null);
  const [keyDraft, setKeyDraft] = useState("");

  // THE ADD FORM'S OPTIONAL KEY (story 12): the same write-only rule as the
  // row's — typed here, written after the row exists, never filled from the
  // store and never shown again. It is cleared whatever happens, because a
  // draft that failed to be kept is not a thing to keep in memory either.
  const [addKey, setAddKey] = useState("");

  // WHICH CATALOGUE ENTRY THE ADD FORM CAME FROM (story 13). "custom" is
  // today's empty form; any other value names one of the data entries. It
  // drives only what the picker shows — the fields are the truth.
  const [catalogId, setCatalogId] = useState(CUSTOM_CATALOG_ID);

  // THE TWO TABS AND THE COLLAPSED BUTTON (story 14): the industry-standard
  // shape puts the form behind a dashed "+ Add provider" and splits it into
  // "a known provider" and "a custom endpoint". The known tab is the
  // catalogue pick plus its Models block; the custom tab is today's form,
  // moved and otherwise unchanged. `adding` is only whether the dialog is
  // open — it writes nothing.
  const [adding, setAdding] = useState(false);
  const [tab, setTab] = useState<"known" | "custom">("known");

  // WHICH CATALOGUE MODEL IS TICKED (story 14). It is a VIEW value: the tick
  // copies the model's four fields into the form, and the form is the truth.
  // The id is kept here only so the radio can show which one was ticked.
  const [catalogModelId, setCatalogModelId] = useState("");

  // THE KEY FIELD, so a pick can put the caret where the person pastes. Focus
  // is the whole bridge between the list and the key: no read, no request.
  const keyFieldRef = useRef<HTMLInputElement>(null);

  // THE TEST VERB'S STATE (story 12): which row is being asked, and the one
  // sentence it answered. Separate from the fetch's checklist because a test
  // never grows a list — it is a read that says how long the read took.
  const [testing, setTesting] = useState<string | null>(null);
  const [testNotes, setTestNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let alive = true;
    void (async () => {
      const loaded = await loadTurnSettings();
      const status = await secretStatus();
      const kept: Record<string, boolean> = {};
      for (const provider of loaded.providers) {
        kept[provider.id] = await keyExists(provider.id);
      }
      const running = await localStatus();
      if (!alive) return;
      setSettings(loaded);
      setStore(status);
      setKeys(kept);
      if (running !== null) {
        setLocalStates({ [running.tag]: running });
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  async function write(next: TurnSettings): Promise<boolean> {
    setBusy(true);
    try {
      await saveTurnSettings(next);
      setSettings(next);
      onChanged?.();
      return true;
    } catch (error) {
      const text = String(error).replace(/\s+/g, " ").trim();
      setSentence(
        text === "" ? "the settings could not be written" : text,
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  /**
   * Write one new row. A first row also becomes the selection: a person
   * adding one provider means the turn to be able to leave, and a selection
   * naming nothing would make the ask say "nothing is configured" right
   * after a save.
   */
  async function commit(row: ProviderRow): Promise<boolean> {
    if (settings === null) return false;
    const selected =
      settings.providers.length === 0
        ? withSelection(withProvider(settings, row), row.id, row.models[0].id)
        : withProvider(settings, row);
    return await write(selected);
  }

  /**
   * PICK A KNOWN PROVIDER (story 13). The catalogue is DATA and this function
   * is all a pick does: fill the four text fields with the entry's name, base
   * URL and example model, tick that example in the Models block (story 14),
   * then focus the key field so the next paste lands where it belongs. Choosing
   * the custom tab clears the fill (chooseTab). NO request, NO validation, NO
   * add — the person's press on add is still the only thing that writes a row.
   *
   * The key draft is cleared on a pick: a credential pasted for one endpoint is
   * not carried to another.
   */
  function pickCatalog(entryId: string): void {
    setCatalogId(entryId);
    setTab(entryId === CUSTOM_CATALOG_ID ? "custom" : "known");
    const entry = catalogEntry(entryId);
    applyCatalogFill(entry === null ? CUSTOM_FILL : catalogFill(entry));
    setCatalogModelId(entry?.modelExample?.id ?? "");
    setAddKey("");
    setSentence(null);
    if (entry !== null) keyFieldRef.current?.focus();
  }

  /**
   * TICK ONE MODEL IN THE MODELS BLOCK (story 14). Four setters, nothing else:
   * the model's id and name and the export's tools/vision flags. The person can
   * still type over them or change the boxes below; no row is written and no
   * request is made — the add button remains the only write.
   */
  function tickCatalogModel(model: CatalogModel): void {
    setCatalogModelId(model.id);
    const fill = catalogModelFill(model);
    setModelId(fill.modelId);
    setModelName(fill.modelName);
    setTools(fill.tools);
    setVision(fill.vision);
    setSentence(null);
  }

  /**
   * SWITCH TABS (story 14). The known tab offers no kind but an endpoint; the
   * custom tab is today's form, so its kind select still offers a command and a
   * local runtime. Choosing custom CLEARS a catalogue fill, exactly as story
   * 15.13 did when the old picker chose "a custom endpoint": a credential
   * pasted for one endpoint is not carried to another.
   */
  function chooseTab(next: "known" | "custom"): void {
    setTab(next);
    setSentence(null);
    if (next === "known") {
      setKind("http");
      return;
    }
    setCatalogId(CUSTOM_CATALOG_ID);
    setCatalogModelId("");
    applyCatalogFill(CUSTOM_FILL);
    setAddKey("");
  }

  /** Open the add dialog on the known tab, from today's clean form. */
  function openAddDialog(): void {
    resetAddForm();
    setKind("http");
    setTab("known");
    setAdding(true);
  }

  /** Close it without adding: the fields go back to empty. */
  function closeAddDialog(): void {
    resetAddForm();
    setAdding(false);
  }

  /**
   * TODAY'S EMPTY FORM, in one place: every field the add dialog owns, back to
   * its start. It is called after a successful add, on Cancel, and on opening;
   * it resets no row and writes nothing.
   */
  function resetAddForm(): void {
    setCatalogId(CUSTOM_CATALOG_ID);
    setCatalogModelId("");
    setName("");
    setBaseUrl("");
    setModelId("");
    setModelName("");
    setTools(false);
    setVision(false);
    setCommand("");
    setVersionArgs("--version");
    setRunArgs("{prompt}");
    setAuthArgs("");
    setOkPattern("");
    setLocalModel("");
    setProbe(null);
    setSentence(null);
    setAddKey("");
  }

  /**
   * Put a fill into the form's fields. Editable afterwards, like any input.
   * Since story 15 the fill also carries the example model's two capabilities,
   * so the tools/vision boxes start where models.dev says the model is — a
   * starting point the person can still change, never a verdict.
   */
  function applyCatalogFill(fill: ProviderCatalogFill): void {
    setName(fill.name);
    setBaseUrl(fill.baseUrl);
    setModelId(fill.modelId);
    setModelName(fill.modelName);
    setTools(fill.tools);
    setVision(fill.vision);
  }

  /** The row the add form describes, or the one sentence it is refused with. */
  function addDraft(): { kind: "refused"; sentence: string } | { kind: "row"; row: ProviderRow } {
    if (settings === null) {
      return { kind: "refused", sentence: PROVIDER_SENTENCES.noName };
    }
    const taken = settings.providers.map((provider) => provider.id);
    if (kind === "local") {
      return validateLocalProviderRow(
        {
          name,
          command: localCommand,
          model: localModel,
          args: splitArgs(localArgs),
          readyPattern: localReady,
          idleMinutes: idleDraft(),
        },
        taken,
      );
    }
    if (kind === "cli") {
      return validateCliProviderRow(
        {
          name,
          command,
          versionArgs: splitArgs(versionArgs),
          runArgs: splitArgs(runArgs),
          authArgs: splitArgs(authArgs),
          okPattern,
        },
        taken,
      );
    }
    const draft: ProviderDraft = {
      name,
      baseUrl,
      models: [{ id: modelId, name: modelName, tools, vision }],
    };
    return validateProviderRow(draft, taken);
  }

  async function addProvider(): Promise<void> {
    if (settings === null || busy) return;
    const read = addDraft();
    if (read.kind === "refused") {
      setSentence(read.sentence);
      return;
    }
    setSentence(null);
    // THE ROW FIRST, THE KEY SECOND (story 12). The key field is here because
    // at the moment a person composes a provider, the one credential it needs
    // should not be somewhere else. A refused key leaves the row standing.
    // Only an endpoint row has a key: a command's sign-in is its own argv,
    // so a value typed before switching kinds is not carried across.
    const outcome = await addRowThenKey(
      read.row.id,
      read.row.kind === "http" ? addKey : "",
      () => commit(read.row),
      setSecret,
    );
    setAddKey("");
    if (outcome.kind === "row-refused") return;
    // The dialog closes on a successful add and starts from the custom tab
    // next time: the row (and its key) are the result, not the form.
    setAdding(false);
    setCatalogId(CUSTOM_CATALOG_ID);
    setCatalogModelId("");
    setName("");
    setBaseUrl("");
    setModelId("");
    setModelName("");
    setTools(false);
    setVision(false);
    setCommand("");
    setVersionArgs("--version");
    setRunArgs("{prompt}");
    setAuthArgs("");
    setOkPattern("");
    setLocalModel("");
    setProbe(null);
    if (outcome.key === "refused") {
      setSentence(outcome.sentence);
      return;
    }
    if (outcome.key === "kept") {
      // The panel now knows a key is set, and the store may have changed (a
      // fallback file created on first use), so both are re-asked.
      setKeys((current) => ({ ...current, [read.row.id]: true }));
      setStore(await secretStatus());
      setSentence(ADD_KEY_SENTENCES.kept);
      // Validate where the person just typed: the same test verb, one
      // sentence, so a wrong key is learned now rather than at send time.
      if (read.row.kind === "http") await runTest(read.row);
    }
  }

  /** The local preset, back into the add form (the person then names a model). */
  function useLocalPreset(spec: LocalSpec): void {
    setKind("local");
    setLocalCommand(spec.command);
    setLocalArgs(spec.args.join(" "));
    setLocalReady(spec.readyPattern ?? "");
    setLocalIdle(String(spec.idleMinutes));
    setSentence(null);
  }

  /** The idle field's minutes, or the shipped default when left blank. */
  function idleDraft(): number {
    const text = localIdle.trim();
    return text === "" ? DEFAULT_LOCAL_IDLE_MINUTES : Number(text);
  }

  /** Check a local row: START its child and say the port it chose. */
  async function checkLocal(row: LocalProviderRow): Promise<void> {
    if (probing) return;
    setProbing(true);
    try {
      const started = await startLocal(
        row.id,
        row.command,
        row.args,
        row.model,
        row.readyPattern,
        row.idleMinutes,
      );
      if (started.kind === "refused") {
        setLocalStates((current) => ({ ...current, [row.id]: null }));
        setLocalNotes((current) => ({
          ...current,
          [row.id]: started.sentence,
        }));
      } else {
        setLocalStates((current) => ({
          ...current,
          [row.id]: started.status,
        }));
        setLocalNotes((current) => ({ ...current, [row.id]: "" }));
      }
    } finally {
      setProbing(false);
    }
  }

  /** Stop the one local child (the idle rule would do it later anyway). */
  async function stopLocalRow(row: LocalProviderRow): Promise<void> {
    await stopLocal();
    setLocalStates((current) => ({ ...current, [row.id]: null }));
    setLocalNotes((current) => ({
      ...current,
      [row.id]: "the local runtime was stopped",
    }));
  }

  /**
   * Add a SHIPPED spec as a row. The list is data (cliSpecs.ts), so the panel
   * offers it by name and the SAME validator makes the row a typed command
   * would make — there is no second path for a spec the app ships.
   */
  async function addShipped(spec: CliSpec): Promise<void> {
    if (settings === null || busy) return;
    const read = validateCliProviderRow(
      {
        id: spec.id,
        name: spec.name,
        command: spec.command,
        versionArgs: spec.versionArgs,
        runArgs: spec.run.args,
        authArgs: spec.auth?.args ?? [],
        okPattern: spec.auth?.okPattern ?? "",
        wellKnown: spec.wellKnown ?? [],
        notes: spec.notes,
      },
      settings.providers.map((provider) => provider.id),
    );
    if (read.kind === "refused") {
      setSentence(read.sentence);
      return;
    }
    setSentence(null);
    await commit(read.row);
  }

  /** The spec the add form describes right now (what "check" probes). */
  function typedSpec(): CliSpec {
    const spec: CliSpec = {
      id: "typed",
      name: name.trim() === "" ? command.trim() : name.trim(),
      command: command.trim(),
      versionArgs: splitArgs(versionArgs),
      run: { args: splitArgs(runArgs), read: "stdout" },
      notes: "",
    };
    const auth = splitArgs(authArgs);
    if (auth.length > 0) {
      spec.auth = { args: auth, okPattern: okPattern.trim() };
    }
    return spec;
  }

  /** Check the typed command: where it resolves, its version, its sign-in. */
  async function checkTyped(): Promise<void> {
    if (probing) return;
    setProbing(true);
    try {
      setProbe(await probeSpec(typedSpec()));
    } finally {
      setProbing(false);
    }
  }

  /** Check a saved row the same way, by the same code. */
  async function checkRow(row: CliProviderRow): Promise<void> {
    if (probing) return;
    setProbing(true);
    try {
      const probed = await probeSpec(cliSpecOf(row));
      setRowProbes((current) => ({ ...current, [row.id]: probed }));
    } finally {
      setProbing(false);
    }
  }

  async function saveEdit(row: ProviderRow): Promise<void> {
    if (settings === null || busy) return;
    const otherIds = settings.providers
      .map((provider) => provider.id)
      .filter((id) => id !== row.id);
    let read;
    if (row.kind === "local") {
      read = validateLocalProviderRow(
        {
          id: row.id,
          name: editName,
          command: editCommand,
          model: editModelPath,
          args: splitArgs(editLocalArgs),
          readyPattern: editReadyPattern,
          idleMinutes:
            editIdleMinutes.trim() === ""
              ? row.idleMinutes
              : Number(editIdleMinutes),
          notes: row.notes,
        },
        otherIds,
      );
    } else if (row.kind === "cli") {
      read = validateCliProviderRow(
        {
          id: row.id,
          name: editName,
          command: editCommand,
          versionArgs: splitArgs(editVersionArgs),
          runArgs: splitArgs(editRunArgs),
          authArgs: splitArgs(editAuthArgs),
          okPattern: editOkPattern,
          wellKnown: row.wellKnown ?? [],
          notes: row.notes,
        },
        otherIds,
      );
    } else {
      const draft: ProviderDraft = {
        id: row.id,
        name: editName,
        baseUrl: editBaseUrl,
        models: row.models.map((model) => ({
          id: model.id,
          name: model.name,
          tools: model.capabilities.tools,
          vision: model.capabilities.vision,
          contextWindow: model.capabilities.contextWindow,
        })),
      };
      read = validateProviderRow(draft, otherIds);
    }
    if (read.kind === "refused") {
      setSentence(read.sentence);
      return;
    }
    setSentence(null);
    if (await write(withProvider(settings, read.row))) {
      // A row whose URL just changed has no checklist and no test sentence
      // yet: both were about the OLD endpoint, so they are dropped rather
      // than shown against the new one. The test verb is still there to ask.
      clearFetched(row.id);
      setTestNotes((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setEditing(null);
    }
  }

  async function addModel(
    row: HttpProviderRow,
    model: ModelRow,
  ): Promise<void> {
    if (settings === null || busy) return;
    const draft: ProviderDraft = {
      id: row.id,
      name: row.name,
      baseUrl: row.baseUrl,
      models: [
        ...row.models.map((existing) => ({
          id: existing.id,
          name: existing.name,
          tools: existing.capabilities.tools,
          vision: existing.capabilities.vision,
          contextWindow: existing.capabilities.contextWindow,
        })),
        {
          id: model.id,
          name: model.name,
          tools: model.capabilities.tools,
          vision: model.capabilities.vision,
        },
      ],
    };
    const read = validateProviderRow(
      draft,
      settings.providers
        .map((provider) => provider.id)
        .filter((id) => id !== row.id),
    );
    if (read.kind === "refused") {
      setSentence(read.sentence);
      return;
    }
    setSentence(null);
    await write(withProvider(settings, read.row));
  }

  /**
   * Ask the provider for its list. WHY THE KEY IS READ HERE, AT THE PRESS: the
   * key is not panel state and is never filled into a field; it is read for
   * this one request line and forgotten. A CLI or local row (or a base URL
   * that fails the https rule) is refused BEFORE anything leaves, with the
   * sentence that says why it has no list. A failed fetch writes NOTHING: the
   * row's models are exactly as they were.
   */
  async function fetchModelsForRow(row: HttpProviderRow): Promise<void> {
    if (busy || fetching !== null) return;
    const problem = modelsFetchProblem(row);
    if (problem !== null) {
      setFetchNotes((current) => ({ ...current, [row.id]: problem }));
      return;
    }
    setFetching(row.id);
    setFetchNotes((current) => ({ ...current, [row.id]: "" }));
    try {
      const answer = (await askEndpoint(row)).result;
      if (answer.kind === "models") {
        const offered = offerFetchedModels(row, answer.ids);
        setLists((current) => ({ ...current, [row.id]: offered }));
        setFetchOffered((current) => ({
          ...current,
          [row.id]: answer.offered,
        }));
        // A fresh list starts with nothing new ticked: the person's press is
        // the only thing that ever adds a model.
        setTicks((current) => ({ ...current, [row.id]: [] }));
        if (offered.length === 0) {
          setFetchNotes((current) => ({
            ...current,
            [row.id]: MODEL_LIST_SENTENCES.noModels,
          }));
        }
        return;
      }
      // NO LIST: the row is untouched, and the sentence is the whole result.
      clearFetched(row.id);
      setFetchNotes((current) => ({
        ...current,
        [row.id]: answer.sentence,
      }));
    } finally {
      setFetching(null);
    }
  }

  /**
   * THE ONE ASK (story 12). Both verbs come through here: the key is read at
   * the press — never held, never shown — and handed to the same sidecar GET
   * the fetch has always used. One place means the test cannot drift into a
   * second idea of what "reach the endpoint" means.
   */
  async function askEndpoint(row: HttpProviderRow): Promise<EndpointAnswer> {
    const key = await readSecret(row.id);
    return await askProviderModels(fetchModels, {
      baseUrl: row.baseUrl,
      apiKey: key,
    });
  }

  /**
   * TEST THE CONNECTION (story 12): one press, one GET, ONE sentence. It adds
   * nothing, changes no row, and schedules nothing — a test is a read. The
   * same https/loopback rule that gates a fetch gates this, because a URL the
   * app would not ask is not one it should try.
   */
  async function runTest(row: HttpProviderRow): Promise<void> {
    if (testing !== null) return;
    const problem = modelsFetchProblem(row);
    if (problem !== null) {
      setTestNotes((current) => ({ ...current, [row.id]: problem }));
      return;
    }
    setTesting(row.id);
    setTestNotes((current) => ({ ...current, [row.id]: "" }));
    try {
      const sentence = connectionSentence(await askEndpoint(row));
      setTestNotes((current) => ({ ...current, [row.id]: sentence }));
    } finally {
      setTesting(null);
    }
  }

  /** Forget a row's fetched checklist (a new fetch, a write, or removal). */
  function clearFetched(providerId: string): void {
    setLists((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    setTicks((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
    setFetchOffered((current) => {
      const next = { ...current };
      delete next[providerId];
      return next;
    });
  }

  /** Tick or untick one offered model (existing ones are not tickable). */
  function toggleTick(providerId: string, modelId: string): void {
    setTicks((current) => {
      const chosen = current[providerId] ?? [];
      const next = chosen.includes(modelId)
        ? chosen.filter((id) => id !== modelId)
        : [...chosen, modelId];
      return { ...current, [providerId]: next };
    });
  }

  /**
   * Add the TICKED models to the row. The write is the ordinary config write
   * through validateProviderRow, so the row still has to be a row the app can
   * act on. Existing models are carried through by withTickedModels: a fetch
   * can add, never remove and never rename.
   */
  async function addTicked(row: HttpProviderRow): Promise<void> {
    if (settings === null || busy) return;
    const fresh = newTickedModels(row, ticks[row.id] ?? []);
    if (fresh.length === 0) {
      setFetchNotes((current) => ({
        ...current,
        [row.id]: MODEL_LIST_SENTENCES.nothingTicked,
      }));
      return;
    }
    const next = withTickedModels(row, fresh);
    const read = validateProviderRow(
      {
        id: row.id,
        name: row.name,
        baseUrl: row.baseUrl,
        models: next.models.map((model) => ({
          id: model.id,
          name: model.name,
          tools: model.capabilities.tools,
          vision: model.capabilities.vision,
          contextWindow: model.capabilities.contextWindow,
        })),
      },
      settings.providers
        .map((provider) => provider.id)
        .filter((id) => id !== row.id),
    );
    if (read.kind === "refused") {
      setSentence(read.sentence);
      return;
    }
    setSentence(null);
    // THE ROW IS WRITTEN ONLY NOW, on confirm, and only with the ticks: the
    // fetch itself had no write path at all.
    if (!(await write(withProvider(settings, read.row)))) return;
    clearFetched(row.id);
    setFetchNotes((current) => ({
      ...current,
      [row.id]: MODEL_LIST_SENTENCES.added,
    }));
  }

  async function removeProvider(row: ProviderRow): Promise<void> {
    if (settings === null || busy) return;
    // A running local child belongs to its row: stopping it here means a
    // removed row cannot leave a model server behind until the idle window.
    if (row.kind === "local") await stopLocal();
    // THE KEY GOES WITH THE ROW. If the store refuses, the row STAYS: a key
    // left behind with no row naming it is exactly the kind of quiet leftover
    // this story refuses to create.
    const deleted = await forgetSecret(row.id);
    if (deleted.kind === "refused") {
      setSentence(deleted.sentence);
      return;
    }
    setSentence(null);
    if (await write(withoutProvider(settings, row.id))) {
      setKeys((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      clearFetched(row.id);
      setFetchNotes((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      setTestNotes((current) => {
        const next = { ...current };
        delete next[row.id];
        return next;
      });
      if (editing === row.id) setEditing(null);
      if (keyFor === row.id) {
        setKeyFor(null);
        setKeyDraft("");
      }
    }
  }

  async function keepKey(row: ProviderRow): Promise<void> {
    if (busy) return;
    const kept = await setSecret(row.id, keyDraft);
    if (kept.kind === "refused") {
      setSentence(kept.sentence);
      return;
    }
    setSentence(ADD_KEY_SENTENCES.kept);
    setKeyDraft("");
    setKeyFor(null);
    setStore(await secretStatus());
    setKeys((current) => ({ ...current, [row.id]: true }));
    // A key that was just kept is worth one test: the person learns now
    // whether the endpoint accepts it, without hunting for the verb.
    if (row.kind === "http") await runTest(row);
  }

  async function choose(providerId: string, modelId: string): Promise<void> {
    if (settings === null || busy) return;
    await write(withSelection(settings, providerId, modelId));
  }

  const selected =
    settings === null
      ? null
      : settings.providers.find(
          (provider) => provider.id === settings.providerId,
        ) ?? null;
  const selectedModels =
    selected === null ? [] : modelsForMove(selected, {});

  // The catalogue entry the picker currently names, if any. Null means the
  // custom endpoint, which carries no note.
  const pickedCatalog = catalogEntry(catalogId);

  return (
    <div className="providers-panel" role="group" aria-label="providers">
      {/* ALWAYS VISIBLE: which store keeps keys on THIS machine. The fallback
          is a stated state, never a silent one. */}
      <div className="providers-status" role="status">
        {store === null ? "asking where keys live…" : secretStatusWords(store)}
      </div>

      {settings !== null && settings.providers.length > 0 && (
        <label className="providers-field">
          <span>a turn carries</span>
          <span className="providers-selects">
            <select
              value={settings.providerId}
              aria-label="the provider a turn carries"
              onChange={(e) => {
                const provider = settings.providers.find(
                  (row) => row.id === e.target.value,
                );
                const model = provider?.models[0]?.id ?? "";
                void choose(e.target.value, model);
              }}
            >
              <option value="">nothing selected</option>
              {settings.providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </select>
            <select
              value={settings.modelId}
              aria-label="the model a turn carries"
              onChange={(e) => void choose(settings.providerId, e.target.value)}
            >
              <option value="">no model</option>
              {selectedModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
            <span className="providers-ref">
              {formatProviderRef(settings.providerId, settings.modelId)}
            </span>
          </span>
        </label>
      )}

      {settings !== null &&
        settings.providers.map((provider) => (
          <div className="providers-row" key={provider.id}>
            <div className="providers-row-head">
              {/* THE ROW'S KEY STATE AS A DOT, beside the name (story 13's
                  reference shape): set or missing, nothing it cannot know. A
                  command or a local model has no key of this kind, so it gets
                  no dot rather than a green claim. */}
              {provider.kind === "http" && (
                <span
                  className={
                    "providers-state-dot " +
                    (keys[provider.id] === true ? "is-set" : "is-missing")
                  }
                  role="img"
                  aria-label={
                    keys[provider.id] === true
                      ? "a key is set"
                      : "no key is set"
                  }
                  title={
                    keys[provider.id] === true
                      ? "a key is set"
                      : "no key is set"
                  }
                />
              )}
              <span className="providers-name">{provider.name}</span>
              {/* CUSTOM (story 14): the reference list's badge for a row the
                  person typed. It is DERIVED from what the row already says
                  (base URL vs the catalogue; a shipped spec's id), so this
                  story stores no new record field. A row with no badge came
                  from data, not from a claim we made about it. */}
              {customRow(provider) && (
                <span className="providers-custom-badge">Custom</span>
              )}
              <span className="providers-id">{provider.id}</span>
            </div>
            {editing === provider.id ? (
              <div className="providers-edit">
                <label className="providers-field">
                  <span>name</span>
                  <input
                    type="text"
                    value={editName}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setEditName(e.target.value)}
                  />
                </label>
                {provider.kind === "http" ? (
                  <label className="providers-field">
                    <span>base URL</span>
                    <input
                      type="text"
                      value={editBaseUrl}
                      spellCheck={false}
                      autoComplete="off"
                      onChange={(e) => setEditBaseUrl(e.target.value)}
                    />
                  </label>
                ) : provider.kind === "cli" ? (
                  <>
                    <label className="providers-field">
                      <span>command</span>
                      <input
                        type="text"
                        value={editCommand}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditCommand(e.target.value)}
                      />
                    </label>
                    <label className="providers-field">
                      <span>version args</span>
                      <input
                        type="text"
                        value={editVersionArgs}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditVersionArgs(e.target.value)}
                      />
                    </label>
                    <label className="providers-field">
                      <span>run args</span>
                      <input
                        type="text"
                        value={editRunArgs}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditRunArgs(e.target.value)}
                      />
                    </label>
                    <label className="providers-field">
                      <span>sign-in args (empty: no probe)</span>
                      <input
                        type="text"
                        value={editAuthArgs}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditAuthArgs(e.target.value)}
                      />
                    </label>
                    <label className="providers-field">
                      <span>sign-in pattern</span>
                      <input
                        type="text"
                        value={editOkPattern}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditOkPattern(e.target.value)}
                      />
                    </label>
                  </>
                ) : (
                  <>
                    <label className="providers-field">
                      <span>server command</span>
                      <input
                        type="text"
                        value={editCommand}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditCommand(e.target.value)}
                      />
                    </label>
                    <label className="providers-field">
                      <span>model path</span>
                      <input
                        type="text"
                        value={editModelPath}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditModelPath(e.target.value)}
                      />
                    </label>
                    <label className="providers-field">
                      <span>server args (with the placeholders)</span>
                      <input
                        type="text"
                        value={editLocalArgs}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditLocalArgs(e.target.value)}
                      />
                    </label>
                    <label className="providers-field">
                      <span>ready line (empty: the port answering is enough)</span>
                      <input
                        type="text"
                        value={editReadyPattern}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditReadyPattern(e.target.value)}
                      />
                    </label>
                    <label className="providers-field">
                      <span>idle minutes</span>
                      <input
                        type="text"
                        value={editIdleMinutes}
                        spellCheck={false}
                        autoComplete="off"
                        onChange={(e) => setEditIdleMinutes(e.target.value)}
                      />
                    </label>
                  </>
                )}
                <div className="providers-actions">
                  <button
                    type="button"
                    className="providers-save"
                    disabled={busy}
                    onClick={() => void saveEdit(provider)}
                  >
                    save
                  </button>
                  <button
                    type="button"
                    className="providers-cancel"
                    onClick={() => {
                      setEditing(null);
                      setSentence(null);
                    }}
                  >
                    cancel
                  </button>
                </div>
              </div>
            ) : (
              <div className="providers-row-facts">
                {provider.kind === "http" ? (
                  <span className="providers-url">{provider.baseUrl}</span>
                ) : provider.kind === "cli" ? (
                  <span className="providers-url">
                    {provider.command}
                    {provider.notes === "" ? "" : " — " + provider.notes}
                  </span>
                ) : (
                  <span className="providers-url">
                    {provider.command} — {provider.model}
                  </span>
                )}
                {provider.kind === "local" && (
                  <span className="providers-model-id">
                    {provider.args.join(" ")}
                    {" · "}
                    {provider.readyPattern === undefined
                      ? "ready when the port answers"
                      : "ready on: " + provider.readyPattern}
                    {" · stops after "}
                    {provider.idleMinutes}
                    {" idle minutes"}
                  </span>
                )}
                <ul className="providers-models">
                  {provider.models.map((model) => (
                    <li className="providers-model" key={model.id}>
                      {model.name}
                      <span className="providers-model-id">{model.id}</span>
                      {model.capabilities.tools && (
                        <span className="providers-cap">tools</span>
                      )}
                      {model.capabilities.vision && (
                        <span className="providers-cap">vision</span>
                      )}
                      {model.capabilities.contextWindow !== undefined && (
                        <span className="providers-cap">
                          {model.capabilities.contextWindow} tokens
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {provider.kind === "cli" && rowProbes[provider.id] !== undefined && (
              <ProbeReadout probe={rowProbes[provider.id]} />
            )}

            {/* THE LOCAL RUNTIME'S OWN LINE: the port it chose, or stopped.
                A failed start keeps the child's last line under it. */}
            {provider.kind === "local" && (
              <div className="providers-probe" role="status">
                <div className="providers-probe-line">
                  {localSentence(localStates[provider.id] ?? null)}
                </div>
                {(localNotes[provider.id] ?? "") !== "" && (
                  <div className="providers-probe-line">
                    {localNotes[provider.id]}
                  </div>
                )}
              </div>
            )}

            <div className="providers-actions">
              {provider.kind === "http" && (
                <>
                  {/* THE KEY LINE IS ALWAYS ON THE ROW (story 12): no edit
                      toggle hides it. Its state is one of two sentences and
                      its verb names the one action — set, or replace. The
                      store sentence sits beside the field a person is pasting
                      into, because that is the moment they wonder where it
                      goes; it is the SAME sentence the panel shows above. */}
                  <span className="providers-key-state">
                    {keys[provider.id] === true ? "a key is set" : "no key is set"}
                  </span>
                  {keyFor === provider.id ? (
                    <>
                      <input
                        className="providers-key-input"
                        type="password"
                        value={keyDraft}
                        spellCheck={false}
                        autoComplete="off"
                        aria-label="the key to keep"
                        placeholder="the key (never shown again)"
                        onChange={(e) => setKeyDraft(e.target.value)}
                      />
                      {store !== null && (
                        <span className="providers-key-store">
                          {secretStatusWords(store)}
                        </span>
                      )}
                      <button
                        type="button"
                        className="providers-key-save"
                        disabled={busy}
                        onClick={() => void keepKey(provider)}
                      >
                        keep it
                      </button>
                      <button
                        type="button"
                        className="providers-key-cancel"
                        onClick={() => {
                          setKeyFor(null);
                          setKeyDraft("");
                        }}
                      >
                        cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="providers-key-set"
                      onClick={() => {
                        setKeyFor(provider.id);
                        setKeyDraft("");
                      }}
                    >
                      {keys[provider.id] === true ? "replace key" : "set a key"}
                    </button>
                  )}
                </>
              )}
              {/* FETCH IS FOR AN ENDPOINT ONLY: the provider publishes a list;
                  a command and a local model have exactly one model already,
                  and the span says so instead of offering a verb that could
                  only fail. */}
              {provider.kind === "http" ? (
                <button
                  type="button"
                  className="providers-fetch"
                  disabled={fetching !== null || busy}
                  onClick={() => void fetchModelsForRow(provider)}
                >
                  {fetching === provider.id ? "asking…" : "fetch models"}
                </button>
              ) : (
                <span className="providers-fetch-none">
                  {modelsFetchProblem(provider)}
                </span>
              )}
              {/* THE TEST VERB (story 12): the same GET as fetch models, said
                  as one measured sentence. It is the quick check, not a
                  picker: it grows no list and changes no row. */}
              {provider.kind === "http" && (
                <button
                  type="button"
                  className="providers-test"
                  disabled={testing !== null || fetching !== null || busy}
                  onClick={() => void runTest(provider)}
                >
                  {testing === provider.id ? "testing…" : "test"}
                </button>
              )}
              {provider.kind === "cli" && (
                <button
                  type="button"
                  className="providers-check"
                  disabled={probing}
                  onClick={() => void checkRow(provider)}
                >
                  check
                </button>
              )}
              {provider.kind === "local" && (
                <>
                  <button
                    type="button"
                    className="providers-check"
                    disabled={probing}
                    onClick={() => void checkLocal(provider)}
                  >
                    check (start it)
                  </button>
                  <button
                    type="button"
                    className="providers-stop"
                    onClick={() => void stopLocalRow(provider)}
                  >
                    stop
                  </button>
                </>
              )}
              <button
                type="button"
                className="providers-edit-open"
                onClick={() => {
                  setEditing(provider.id);
                  setEditName(provider.name);
                  setEditBaseUrl(
                    provider.kind === "http" ? provider.baseUrl : "",
                  );
                  if (provider.kind === "cli") {
                    setEditCommand(provider.command);
                    setEditVersionArgs(provider.versionArgs.join(" "));
                    setEditRunArgs(provider.run.args.join(" "));
                    setEditAuthArgs((provider.auth?.args ?? []).join(" "));
                    setEditOkPattern(provider.auth?.okPattern ?? "");
                  }
                  if (provider.kind === "local") {
                    setEditCommand(provider.command);
                    setEditModelPath(provider.model);
                    setEditLocalArgs(provider.args.join(" "));
                    setEditReadyPattern(provider.readyPattern ?? "");
                    setEditIdleMinutes(String(provider.idleMinutes));
                  }
                  setSentence(null);
                }}
              >
                edit
              </button>
              <button
                type="button"
                className="providers-remove"
                disabled={busy}
                onClick={() => void removeProvider(provider)}
              >
                remove
              </button>
            </div>

            {/* THE FETCHED CHECKLIST: every id the provider offered, the ones
                already on the row checked and locked, the rest waiting for a
                tick. The confirm is the only write in this block. */}
            {provider.kind === "http" &&
              lists[provider.id] !== undefined && (
                <div className="providers-fetch-list">
                  <span className="providers-add-title">
                    the provider's models
                  </span>
                  {fetchOffered[provider.id] !== undefined &&
                    fetchOffered[provider.id] > lists[provider.id].length && (
                      <span className="providers-note">
                        {truncationSentence(
                          fetchOffered[provider.id],
                          lists[provider.id].length,
                        )}
                      </span>
                    )}
                  {lists[provider.id].map((model) => (
                    <label
                      className="providers-fetch-option"
                      key={model.id}
                    >
                      <input
                        type="checkbox"
                        checked={
                          model.onRow ||
                          (ticks[provider.id] ?? []).includes(model.id)
                        }
                        disabled={model.onRow || busy}
                        onChange={() => toggleTick(provider.id, model.id)}
                      />
                      <span className="providers-fetch-id">{model.id}</span>
                      {model.onRow && (
                        <span className="providers-fetch-on-row">
                          already on the row
                        </span>
                      )}
                    </label>
                  ))}
                  <div className="providers-actions">
                    <button
                      type="button"
                      className="providers-fetch-add"
                      disabled={busy}
                      onClick={() => void addTicked(provider)}
                    >
                      add the ticked models
                    </button>
                  </div>
                </div>
              )}

            {provider.kind === "http" &&
              (fetchNotes[provider.id] ?? "") !== "" && (
                <div className="providers-note" role="status">
                  {fetchNotes[provider.id]}
                </div>
              )}

            {/* ONE SENTENCE FOR THE TEST (story 12): how long it took and what
                it offered, or the same scrubbed refusal a fetch would say. */}
            {provider.kind === "http" &&
              (testNotes[provider.id] ?? "") !== "" && (
                <div className="providers-test-note" role="status">
                  {testNotes[provider.id]}
                </div>
              )}

            {/* One more model on this row, refused if it shares an id with one
                already there (two rows with one id would resolve two ways). */}
            {provider.kind === "http" && (
              <AddModel onAdd={(model) => void addModel(provider, model)} />
            )}
          </div>
        ))}

      {settings !== null && (
        <>
        {/* THE INDUSTRY-STANDARD LIST (story 14): a dashed full-width button
            opens the two-tab dialog. While it is closed the rows are the whole
            panel; the add button is how the person starts one. */}
        {!adding && (
          <button
            type="button"
            className="providers-add-open"
            onClick={openAddDialog}
          >
            + Add provider
          </button>
        )}

        {adding && (
          <div className="providers-add">
            <span className="providers-add-title">add a provider</span>
            {/* TWO TABS (story 14): a known provider is the catalogue pick and
                its Models block; a custom endpoint is today's form, moved.
                Both tabs share the fields below and the same footer, so there
                is one add path, not two. */}
            <div
              className="providers-tabs"
              role="tablist"
              aria-label="how to add a provider"
            >
              <button
                type="button"
                role="tab"
                aria-selected={tab === "known"}
                className={
                  "providers-tab" + (tab === "known" ? " is-current" : "")
                }
                onClick={() => chooseTab("known")}
              >
                a known provider
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === "custom"}
                className={
                  "providers-tab" + (tab === "custom" ? " is-current" : "")
                }
                onClick={() => chooseTab("custom")}
              >
                a custom endpoint
              </button>
            </div>

            {tab === "known" ? (
              <>
                {/* THE PROVIDER PICKER (story 13; fed by 15's export): data
                    only. A pick fills the fields, ticks its example model and
                    focuses the key. Nothing is requested or added. */}
                <div
                  className="providers-known-list"
                  role="radiogroup"
                  aria-label="a known provider"
                >
                  {PROVIDER_CATALOG.map((entry) => (
                    <label className="providers-known-option" key={entry.id}>
                      <input
                        type="radio"
                        name="known-provider"
                        checked={catalogId === entry.id}
                        onChange={() => pickCatalog(entry.id)}
                      />
                      <span className="providers-known-name">
                        {catalogLabel(entry)}
                      </span>
                    </label>
                  ))}
                </div>
                {pickedCatalog !== null && (
                  <div className="providers-note">
                    {pickedCatalog.note} {pickedCatalog.source}.
                  </div>
                )}
              </>
            ) : (
              /* TODAY'S FORM, MOVED (story 14): the kind select is still how a
                 command or a local runtime is added, and choosing custom clears
                 a catalogue fill. Nothing else about it changes. */
              <label className="providers-field">
                <span>kind</span>
                <select
                  value={kind}
                  aria-label="the kind of provider"
                  onChange={(e) => {
                    const next =
                      e.target.value === "cli"
                        ? "cli"
                        : e.target.value === "local"
                          ? "local"
                          : "http";
                    setKind(next);
                    if (next === "local") useLocalPreset(DEFAULT_LOCAL_SPEC);
                    setProbe(null);
                    setSentence(null);
                  }}
                >
                  <option value="http">an HTTP endpoint</option>
                  <option value="cli">a command (CLI)</option>
                  <option value="local">a model on this machine</option>
                </select>
              </label>
            )}
            <label className="providers-field">
              <span>name</span>
              <input
                type="text"
                value={name}
                spellCheck={false}
                autoComplete="off"
                placeholder={
                  kind === "cli"
                    ? "My script"
                    : kind === "local"
                      ? "My local model"
                      : "A hosted endpoint"
                }
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            {kind === "http" ? (
              <>
                <label className="providers-field">
                  <span>base URL</span>
                  <input
                    type="text"
                    value={baseUrl}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="http://127.0.0.1:8080/v1"
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </label>
                {/* THE KEY, IN THE FORM ITSELF (story 12). Optional: a local
                    endpoint may need none. Write-only like the row's — the
                    field is never filled from the store, and what is typed is
                    written only AFTER the row exists. */}
                <label className="providers-field">
                  <span>the key (kept; never shown again)</span>
                  <input
                    type="password"
                    value={addKey}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="optional"
                    aria-label="the key to keep with the new provider"
                    ref={keyFieldRef}
                    onChange={(e) => setAddKey(e.target.value)}
                  />
                </label>
                {store !== null && (
                  <span className="providers-key-store">
                    {secretStatusWords(store)}
                  </span>
                )}
                {/* THE MODELS BLOCK (story 14): every model the vendored export
                    lists, with the catalogue's tools/vision marks. A tick copies
                    the model's four fields below; the person still edits them.
                    No request, no write — the export is local data. */}
                {tab === "known" && pickedCatalog !== null && (
                  <div className="providers-models-block">
                    <span className="providers-add-title">
                      models from models.dev
                    </span>
                    <span className="providers-model-hint">
                      a tick fills the model fields from the export; tools and
                      vision stay yours to change
                    </span>
                    <div
                      className="providers-catalog-models"
                      role="radiogroup"
                      aria-label="the provider's models"
                    >
                      {pickedCatalog.models.map((model) => (
                        <label
                          className="providers-catalog-model"
                          key={model.id}
                        >
                          <input
                            type="radio"
                            name="catalog-model"
                            checked={catalogModelId === model.id}
                            onChange={() => tickCatalogModel(model)}
                          />
                          <span className="providers-catalog-model-name">
                            {model.name}
                          </span>
                          <span className="providers-model-id">{model.id}</span>
                          {model.toolCall && (
                            <span className="providers-cap">tools</span>
                          )}
                          {model.attachment && (
                            <span className="providers-cap">vision</span>
                          )}
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="providers-add-model">
                  <label className="providers-field">
                    <span>model id</span>
                    <input
                      type="text"
                      value={modelId}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="qwen"
                      onChange={(e) => setModelId(e.target.value)}
                    />
                  </label>
                  <label className="providers-field">
                    <span>model name</span>
                    <input
                      type="text"
                      value={modelName}
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="Qwen"
                      onChange={(e) => setModelName(e.target.value)}
                    />
                  </label>
                  <label className="providers-cap-toggle">
                    <input
                      type="checkbox"
                      checked={tools}
                      onChange={(e) => setTools(e.target.checked)}
                    />
                    <span>tools</span>
                  </label>
                  <label className="providers-cap-toggle">
                    <input
                      type="checkbox"
                      checked={vision}
                      onChange={(e) => setVision(e.target.checked)}
                    />
                    <span>vision</span>
                  </label>
                </div>
              </>
            ) : kind === "cli" ? (
              <>
                <label className="providers-field">
                  <span>command</span>
                  <input
                    type="text"
                    value={command}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="a path, or a name on PATH"
                    onChange={(e) => setCommand(e.target.value)}
                  />
                </label>
                <label className="providers-field">
                  <span>version args</span>
                  <input
                    type="text"
                    value={versionArgs}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setVersionArgs(e.target.value)}
                  />
                </label>
                <label className="providers-field">
                  <span>run args</span>
                  <input
                    type="text"
                    value={runArgs}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="{prompt}"
                    onChange={(e) => setRunArgs(e.target.value)}
                  />
                </label>
                <label className="providers-field">
                  <span>sign-in args (empty: the probe does not apply)</span>
                  <input
                    type="text"
                    value={authArgs}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setAuthArgs(e.target.value)}
                  />
                </label>
                <label className="providers-field">
                  <span>sign-in pattern</span>
                  <input
                    type="text"
                    value={okPattern}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setOkPattern(e.target.value)}
                  />
                </label>
                <div className="providers-actions">
                  <button
                    type="button"
                    className="providers-check"
                    disabled={probing || command.trim() === ""}
                    onClick={() => void checkTyped()}
                  >
                    check
                  </button>
                </div>
                {probe !== null && <ProbeReadout probe={probe} />}
              </>
            ) : (
              <>
                <label className="providers-field">
                  <span>server command</span>
                  <input
                    type="text"
                    value={localCommand}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="llama-server"
                    onChange={(e) => setLocalCommand(e.target.value)}
                  />
                </label>
                <label className="providers-field">
                  <span>model path (the file this machine has)</span>
                  <input
                    type="text"
                    value={localModel}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="/home/me/models/qwen.gguf"
                    onChange={(e) => setLocalModel(e.target.value)}
                  />
                </label>
                <label className="providers-field">
                  <span>{"server args (with {port} and {key} as separate entries)"}</span>
                  <input
                    type="text"
                    value={localArgs}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="-m {model} --host 127.0.0.1 --port {port}"
                    onChange={(e) => setLocalArgs(e.target.value)}
                  />
                </label>
                <label className="providers-field">
                  <span>ready line (empty: the port answering is enough)</span>
                  <input
                    type="text"
                    value={localReady}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="server is listening"
                    onChange={(e) => setLocalReady(e.target.value)}
                  />
                </label>
                <label className="providers-field">
                  <span>idle minutes before it is stopped</span>
                  <input
                    type="text"
                    value={localIdle}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="10"
                    onChange={(e) => setLocalIdle(e.target.value)}
                  />
                </label>
              </>
            )}
            {/* THE FOOTER (story 14): Cancel and Add, bottom right, on BOTH
                tabs. Cancel closes without writing; Add is still the one verb
                that goes through the validator and the write queue. */}
            <div className="providers-add-footer">
              <button
                type="button"
                className="providers-cancel"
                onClick={closeAddDialog}
              >
                cancel
              </button>
              <button
                type="button"
                className="providers-add-save"
                disabled={busy}
                onClick={() => void addProvider()}
              >
                add
              </button>
            </div>
          </div>
        )}

        {/* THE SHIPPED SPECS: data, offered by name. Adding one is the SAME
            validator and the SAME row a typed command makes. */}
        <div className="providers-shipped">
          <span className="providers-add-title">
            commands the app ships as data
          </span>
          {CLI_SPECS.filter(
            (spec) =>
              !settings.providers.some((provider) => provider.id === spec.id),
          ).map((spec) => (
            <div className="providers-shipped-row" key={spec.id}>
              <span className="providers-shipped-name">{spec.name}</span>
              <code className="providers-shipped-command">{spec.command}</code>
              <span className="providers-shipped-notes">{spec.notes}</span>
              <button
                type="button"
                className="providers-shipped-add"
                disabled={busy}
                onClick={() => void addShipped(spec)}
              >
                add
              </button>
            </div>
          ))}
        </div>

        {/* THE SHIPPED LOCAL RUNTIMES: data too. A local row still needs the
            person's model path (the app downloads no model), so this only
            fills the form; adding it is the SAME validator a typed row uses. */}
        <div className="providers-shipped">
          <span className="providers-add-title">
            local runtimes the app ships as data
          </span>
          {LOCAL_SPECS.map((spec) => (
            <div className="providers-shipped-row" key={spec.id}>
              <span className="providers-shipped-name">{spec.name}</span>
              <code className="providers-shipped-command">{spec.command}</code>
              <span className="providers-shipped-notes">{spec.notes}</span>
              <button
                type="button"
                className="providers-shipped-add"
                disabled={busy}
                onClick={() => useLocalPreset(spec)}
              >
                use
              </button>
            </div>
          ))}
        </div>
        </>
      )}

      {settings !== null && settings.providers.length === 0 && (
        <div className="providers-empty">{PROVIDER_SENTENCES.nothing}</div>
      )}
      {sentence !== null && (
        <div className="providers-note" role="status">
          {sentence}
        </div>
      )}
    </div>
  );
}

/** One more model for an existing row: two fields and its capabilities. */
function AddModel({ onAdd }: { onAdd: (model: ModelRow) => void }) {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [tools, setTools] = useState(false);
  const [vision, setVision] = useState(false);
  return (
    <div className="providers-add-model">
      <label className="providers-field">
        <span>another model id</span>
        <input
          type="text"
          value={id}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setId(e.target.value)}
        />
      </label>
      <label className="providers-field">
        <span>its name</span>
        <input
          type="text"
          value={name}
          spellCheck={false}
          autoComplete="off"
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="providers-cap-toggle">
        <input
          type="checkbox"
          checked={tools}
          onChange={(e) => setTools(e.target.checked)}
        />
        <span>tools</span>
      </label>
      <label className="providers-cap-toggle">
        <input
          type="checkbox"
          checked={vision}
          onChange={(e) => setVision(e.target.checked)}
        />
        <span>vision</span>
      </label>
      <button
        type="button"
        className="providers-model-add"
        onClick={() => {
          if (id.trim() === "" || name.trim() === "") return;
          onAdd({
            id: id.trim(),
            name: name.trim(),
            capabilities: { tools, vision },
          });
          setId("");
          setName("");
          setTools(false);
          setVision(false);
        }}
      >
        add model
      </button>
    </div>
  );
}

/**
 * WHAT A PROBE SAID (Epic 15 story 5): where the command was FOUND (and which
 * step found it — the app never makes a person guess), the version line, and
 * the sign-in state or the plain words that this probe does not apply. Three
 * lines, no verdicts, no gate: a probe is a reading, not a permission.
 */
function ProbeReadout({ probe }: { probe: CliProbe }) {
  if (probe.kind === "refused") {
    return (
      <div className="providers-probe" role="status">
        <div className="providers-probe-line">{probe.sentence}</div>
      </div>
    );
  }
  return (
    <div className="providers-probe" role="status">
      <div className="providers-probe-line">
        {resolutionSentence(probe.where)}
      </div>
      <div className="providers-probe-line">{probe.version.sentence}</div>
      <div className="providers-probe-line">{probe.auth.sentence}</div>
    </div>
  );
}

/**
 * The editor's text into an argv array: runs of whitespace separate entries.
 * PROVISIONAL: an argument that must CONTAIN a space cannot be typed here yet
 * — the row stores arrays, so a later editor can quote without the row shape
 * changing, and the prompt itself never comes through this door.
 */
function splitArgs(text: string): string[] {
  return text.trim() === "" ? [] : text.trim().split(/\s+/);
}
