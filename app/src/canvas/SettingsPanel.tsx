import { useEffect, useState } from "react";
import appPackage from "../../package.json";
import { ProvidersPanel } from "./ProvidersPanel";
import { loadTurnSettings, saveTurnSettings } from "../turn/provider";
import {
  modelsForMove,
  providerOptions,
  PROVIDER_SENTENCES,
  withLocalIdle,
  withSelection,
  type TurnSettings,
} from "../turn/providers";

/**
 * THE SETTINGS SURFACE (Epic 15 story 10) — the app's ONE place to configure
 * anything, reachable from every map.
 *
 * WHY A MODAL AND NOT A PANEL IN THE PLANE: settings are about the app, not
 * about the map on screen. A map surface would be found only on that map, and
 * a panel inside `.plane` would inherit the plane's armed gates; the frame
 * here sits outside all of it, names its sections, and closes when the person
 * is done. Esc, a press outside the block, and the close verb all close it,
 * and closing writes NOTHING (every write in here is a control's own press).
 *
 * WHAT WRITES: only the app config, through the ONE queued read-modify-write
 * in lib/appConfig.ts (turn/provider.ts's saveTurnSettings), and a key only
 * through lib/secret.ts's existing secret commands. This frame knows no
 * workspace path and has no file writer: Settings can never change the map.
 *
 * THE SECTIONS ARE THE FRAME (PROVISIONAL, deliberate room to grow):
 *   - Providers      — the existing ProvidersPanel, moved in whole: rows,
 *                      add/edit/remove, set a key, models with capabilities,
 *                      and the always-on key-store sentence.
 *   - Turn defaults  — the provider:model a new ask starts from (the same
 *                      selection the ask panels carry).
 *   - Local model    — the idle minutes on a row that runs on this machine
 *                      (the row's own field; the shipped default is 10).
 *   - About          — the version and the one-line what-this-is.
 * A later story adds a section by adding one entry and one block; the frame
 * takes no position on how many there may be.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the modal's look, the section
 * order, and the wording. The frame's extensibility is a deliberate seam, not
 * a promise of more settings.
 */

/** The sections the frame knows. Ordered as they render. */
export const SETTINGS_SECTIONS = [
  { id: "providers", label: "Providers" },
  { id: "defaults", label: "Turn defaults" },
  { id: "local", label: "Local model" },
  { id: "about", label: "About" },
] as const;

export type SettingsSection = (typeof SETTINGS_SECTIONS)[number]["id"];

export function SettingsPanel({
  section,
  onSection,
  onClose,
  onChanged,
}: {
  /** The section on screen (the ask's shortcut opens Providers). */
  section: SettingsSection;
  /** Switch the section (frame navigation only; nothing is written). */
  onSection: (section: SettingsSection) => void;
  /** Close the modal. Closing writes nothing. */
  onClose: () => void;
  /** A provider row or the selection changed (the app re-reads its facts). */
  onChanged?: () => void;
}) {
  // Esc closes the whole modal. One listener, on the window, because the
  // modal's own controls are many and focus may be anywhere inside it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="settings-backdrop"
      // A press that lands on the backdrop itself (never inside the block)
      // closes; presses inside bubble to children, whose target is not this.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="settings-panel"
        role="dialog"
        aria-modal="true"
        aria-label="settings"
      >
        <div className="settings-head">
          <span className="settings-title">settings</span>
          <button
            type="button"
            className="settings-close"
            aria-label="close settings"
            title="close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <div className="settings-body">
          <nav className="settings-nav" aria-label="settings sections">
            {SETTINGS_SECTIONS.map((entry) => (
              <button
                key={entry.id}
                type="button"
                className={
                  "settings-nav-item" +
                  (entry.id === section ? " active" : "")
                }
                aria-pressed={entry.id === section}
                onClick={() => onSection(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </nav>
          <div className="settings-section" data-section={section}>
            {section === "providers" && <ProvidersPanel onChanged={onChanged} />}
            {section === "defaults" && (
              <TurnDefaults onSection={onSection} onChanged={onChanged} />
            )}
            {section === "local" && (
              <LocalModel onSection={onSection} onChanged={onChanged} />
            )}
            {section === "about" && <About />}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * TURN DEFAULTS — the provider:model a new ask starts from. It is the SAME
 * selection an ask's own selector writes (the config has one selection, not a
 * per-surface copy), so changing it here changes what the next ask offers; a
 * row added or removed in Providers is reflected here without a second list.
 */
function TurnDefaults({
  onSection,
  onChanged,
}: {
  onSection: (section: SettingsSection) => void;
  onChanged?: () => void;
}) {
  const [settings, setSettings] = useState<TurnSettings | null>(null);
  const [sentence, setSentence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadTurnSettings().then((loaded) => {
      if (alive) setSettings(loaded);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function choose(providerId: string, modelId: string): Promise<void> {
    if (settings === null || busy) return;
    const next = withSelection(settings, providerId, modelId);
    setSettings(next);
    setSentence(null);
    setBusy(true);
    try {
      await saveTurnSettings(next);
      onChanged?.();
    } catch (error) {
      const text = String(error).replace(/\s+/g, " ").trim();
      setSentence(text === "" ? "the default could not be saved" : text);
    } finally {
      setBusy(false);
    }
  }

  if (settings === null) {
    return <div className="settings-note">reading the turn settings…</div>;
  }

  const options = providerOptions(settings);
  const selected =
    settings.providers.find((row) => row.id === settings.providerId) ?? null;
  const models = selected === null ? [] : modelsForMove(selected, {});

  return (
    <div className="settings-block">
      <p className="settings-prose">
        The provider and model a new ask starts from.
      </p>
      {options.length === 0 ? (
        <>
          <div className="settings-note">{PROVIDER_SENTENCES.nothing}</div>
          <button
            type="button"
            className="settings-link"
            onClick={() => onSection("providers")}
          >
            open providers
          </button>
        </>
      ) : (
        <>
          <label className="settings-field">
            <span>provider</span>
            <select
              value={settings.providerId}
              disabled={busy}
              aria-label="the default provider"
              onChange={(e) => {
                const row = settings.providers.find(
                  (provider) => provider.id === e.target.value,
                );
                void choose(e.target.value, row?.models[0]?.id ?? "");
              }}
            >
              <option value="">nothing selected</option>
              {options.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="settings-field">
            <span>model</span>
            <select
              value={settings.modelId}
              disabled={busy}
              aria-label="the default model"
              onChange={(e) =>
                void choose(settings.providerId, e.target.value)
              }
            >
              <option value="">no model</option>
              {models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {sentence !== null && (
        <div className="settings-note settings-note-problem" role="status">
          {sentence}
        </div>
      )}
    </div>
  );
}

/**
 * LOCAL MODEL — the idle window on a row that runs on this machine. It edits
 * the ROW'S field (the host kills that child after this many quiet minutes),
 * never a global setting: two local rows may run with different windows. The
 * shipped default is 10 minutes; a value below one is refused in words.
 */
function LocalModel({
  onSection,
  onChanged,
}: {
  onSection: (section: SettingsSection) => void;
  onChanged?: () => void;
}) {
  const [settings, setSettings] = useState<TurnSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [sentence, setSentence] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void loadTurnSettings().then((loaded) => {
      if (!alive) return;
      setSettings(loaded);
      const minutes: Record<string, string> = {};
      for (const row of loaded.providers) {
        if (row.kind === "local") minutes[row.id] = String(row.idleMinutes);
      }
      setDrafts(minutes);
    });
    return () => {
      alive = false;
    };
  }, []);

  async function save(providerId: string, minutes: number): Promise<void> {
    if (settings === null || busy) return;
    const next = withLocalIdle(settings, providerId, minutes);
    if ("kind" in next) {
      setSentence(next.sentence);
      return;
    }
    setSentence(null);
    setBusy(true);
    try {
      await saveTurnSettings(next);
      setSettings(next);
      onChanged?.();
    } catch (error) {
      const text = String(error).replace(/\s+/g, " ").trim();
      setSentence(text === "" ? "the idle window could not be saved" : text);
    } finally {
      setBusy(false);
    }
  }

  if (settings === null) {
    return <div className="settings-note">reading the local rows…</div>;
  }

  const locals = settings.providers.filter((row) => row.kind === "local");

  return (
    <div className="settings-block">
      <p className="settings-prose">
        A model on this machine is stopped after this many minutes with no turn.
      </p>
      {locals.length === 0 ? (
        <>
          <div className="settings-note">
            no model on this machine is configured yet.
          </div>
          <button
            type="button"
            className="settings-link"
            onClick={() => onSection("providers")}
          >
            open providers
          </button>
        </>
      ) : (
        locals.map((row) => (
          <div className="settings-local-row" key={row.id}>
            <span className="settings-local-name">{row.name}</span>
            <label className="settings-field settings-field-inline">
              <span>idle minutes</span>
              <input
                type="text"
                inputMode="numeric"
                value={drafts[row.id] ?? String(row.idleMinutes)}
                disabled={busy}
                aria-label={"idle minutes for " + row.name}
                onChange={(e) =>
                  setDrafts((current) => ({
                    ...current,
                    [row.id]: e.target.value,
                  }))
                }
              />
            </label>
            <button
              type="button"
              className="settings-save"
              disabled={busy}
              onClick={() =>
                void save(row.id, Number(drafts[row.id] ?? row.idleMinutes))
              }
            >
              keep
            </button>
          </div>
        ))
      )}
      {sentence !== null && (
        <div className="settings-note settings-note-problem" role="status">
          {sentence}
        </div>
      )}
    </div>
  );
}

/** ABOUT — the version and one line. Nothing else, no links to maintain. */
function About() {
  return (
    <div className="settings-block">
      <p className="settings-version">Attentioneer {appPackage.version}</p>
      <p className="settings-prose">
        A map you author of references and distances, where cheap models act as
        bounded delegates.
      </p>
    </div>
  );
}
