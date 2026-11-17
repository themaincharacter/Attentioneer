import { useEffect, useState } from "react";
import {
  forgetSecret,
  keyExists,
  secretStatus,
  secretStatusWords,
  setSecret,
  type SecretStore,
} from "../lib/secret";
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
 * WHY A PANEL AND NOT FIELDS ON EACH ASK: a base URL typed into a panel is a
 * fact re-typed at every door a turn can leave by, and it cannot say which
 * models an endpoint offers. Rows are the one place; an ask only selects
 * providerId:modelId. The card's ask and the Ask Move use this same panel (one
 * piece, so the two surfaces cannot drift into two ideas of a provider).
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
 * PROVISIONAL (ADR-0003's rendering seam): the layout, the field order and the
 * wording of the refusals.
 */
/**
 * The shipped llama.cpp preset the local form starts from (PROVISIONAL flags,
 * localSpecs.ts): command, argv, readiness line and idle window. The model
 * path is the person's, because this app downloads no model.
 */
const DEFAULT_LOCAL_SPEC: LocalSpec = LOCAL_SPECS[0];

export function ProvidersPanel({
  onClose,
  onChanged,
}: {
  /** Close the panel (nothing is written by closing). */
  onClose: () => void;
  /** The rows or the selection changed (the ask re-reads its facts). */
  onChanged?: () => void;
}) {
  const [settings, setSettings] = useState<TurnSettings | null>(null);
  const [store, setStore] = useState<SecretStore | null>(null);
  const [keys, setKeys] = useState<Record<string, boolean>>({});
  const [sentence, setSentence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
    if (!(await commit(read.row))) return;
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
    setSentence("the key is kept; it will not be shown again");
    setKeyDraft("");
    setKeyFor(null);
    setStore(await secretStatus());
    setKeys((current) => ({ ...current, [row.id]: true }));
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

  return (
    <div className="providers-panel" role="group" aria-label="providers">
      <div className="providers-head">
        <span className="providers-title">providers</span>
        <button
          type="button"
          className="providers-close"
          aria-label="close the providers panel"
          title="close"
          onClick={onClose}
        >
          ×
        </button>
      </div>

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
              <span className="providers-name">{provider.name}</span>
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
                    set a key
                  </button>
                )}
                </>
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

            {/* One more model on this row, refused if it shares an id with one
                already there (two rows with one id would resolve two ways). */}
            {provider.kind === "http" && (
              <AddModel onAdd={(model) => void addModel(provider, model)} />
            )}
          </div>
        ))}

      {settings !== null && (
        <>
        <div className="providers-add">
          <span className="providers-add-title">add a provider</span>
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
          <button
            type="button"
            className="providers-add-save"
            disabled={busy}
            onClick={() => void addProvider()}
          >
            add
          </button>
        </div>

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
