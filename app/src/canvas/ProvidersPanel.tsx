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
  formatProviderRef,
  modelsForMove,
  validateProviderRow,
  withProvider,
  withSelection,
  withoutProvider,
  PROVIDER_SENTENCES,
  type ModelRow,
  type ProviderDraft,
  type ProviderRow,
  type TurnSettings,
} from "../turn/providers";

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
      if (!alive) return;
      setSettings(loaded);
      setStore(status);
      setKeys(kept);
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

  async function addProvider(): Promise<void> {
    if (settings === null || busy) return;
    const draft: ProviderDraft = {
      name,
      baseUrl,
      models: [{ id: modelId, name: modelName, tools, vision }],
    };
    const read = validateProviderRow(
      draft,
      settings.providers.map((provider) => provider.id),
    );
    if (read.kind === "refused") {
      setSentence(read.sentence);
      return;
    }
    setSentence(null);
    // A first row also becomes the selection: a person adding one provider
    // means the turn to be able to leave, and a selection naming nothing
    // would make the ask say "nothing is configured" right after a save.
    const selected =
      settings.providers.length === 0
        ? withSelection(
            withProvider(settings, read.row),
            read.row.id,
            read.row.models[0].id,
          )
        : withProvider(settings, read.row);
    if (!(await write(selected))) return;
    setName("");
    setBaseUrl("");
    setModelId("");
    setModelName("");
    setTools(false);
    setVision(false);
  }

  async function saveEdit(row: ProviderRow): Promise<void> {
    if (settings === null || busy) return;
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
    if (await write(withProvider(settings, read.row))) {
      setEditing(null);
    }
  }

  async function addModel(row: ProviderRow, model: ModelRow): Promise<void> {
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
                <span className="providers-url">{provider.baseUrl}</span>
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

            <div className="providers-actions">
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
              <button
                type="button"
                className="providers-edit-open"
                onClick={() => {
                  setEditing(provider.id);
                  setEditName(provider.name);
                  setEditBaseUrl(provider.baseUrl);
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
            <AddModel onAdd={(model) => void addModel(provider, model)} />
          </div>
        ))}

      {settings !== null && (
        <div className="providers-add">
          <span className="providers-add-title">add a provider</span>
          <label className="providers-field">
            <span>name</span>
            <input
              type="text"
              value={name}
              spellCheck={false}
              autoComplete="off"
              placeholder="Local llama"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
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
          <button
            type="button"
            className="providers-add-save"
            disabled={busy}
            onClick={() => void addProvider()}
          >
            add
          </button>
        </div>
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
