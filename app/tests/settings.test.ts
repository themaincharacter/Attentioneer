import { afterAll, describe, expect, test } from "bun:test";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  SETTINGS_SECTIONS,
  SettingsPanel,
} from "../src/canvas/SettingsPanel";
import { ProvidersPanel } from "../src/canvas/ProvidersPanel";
import { AskPanel } from "../src/canvas/AskPanel";
import {
  EMPTY_SETTINGS,
  PROVIDER_SENTENCES,
  formatProviderRef,
  providerOptions,
  resolveSelection,
  validateProviderRow,
  withLocalIdle,
  withProvider,
  withSelection,
  type ProviderRow,
  type TurnSettings,
} from "../src/turn/providers";

/**
 * Story 15.10 — the settings menu, and the provider setup moves in.
 *
 * The story's one check, at the layer a test can hold:
 *   - one modal, four sections, opened by chrome on any map and closed by Esc /
 *     a press outside / its verb WITHOUT writing anything;
 *   - the Providers section is the SAME ProvidersPanel (one implementation),
 *     and the always-on key-store sentence lives there;
 *   - a row added in Settings is the row the ask's selector offers, and the
 *     default selection is what a new ask resolves to;
 *   - with nothing configured, an ask is one sentence and the settings
 *     shortcut, with no inline provider form anywhere;
 *   - Settings writes only the app config and keys: a folder snapshot is
 *     byte-identical, and the settings modules know no workspace writer.
 */

const APP = fileURLToPath(new URL("..", import.meta.url));

function source(rel: string): string {
  return readFileSync(join(APP, "src", rel), "utf8");
}

function codeOf(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\/\/.*$/gm, "");
}

function renderSettings(section: (typeof SETTINGS_SECTIONS)[number]["id"]): string {
  return renderToStaticMarkup(
    createElement(SettingsPanel, {
      section,
      onSection: () => {},
      onClose: () => {},
      onChanged: () => {},
    }),
  );
}

function renderAsk(hasProvider: boolean): string {
  return renderToStaticMarkup(
    createElement(AskPanel, {
      name: "rain",
      rows: [],
      ride: null,
      session: null,
      kept: false,
      busy: false,
      note: null,
      fallback: null,
      running: false,
      context: null,
      sent: null,
      providerRef: hasProvider ? "local:qwen" : null,
      hasProvider,
      onProviders: () => {},
      onIncludedChange: () => {},
      onSend: () => {},
      onStop: () => {},
      onIntake: () => {},
      onAbandon: () => {},
      onKeep: () => {},
      onLog: () => {},
      onClose: () => {},
    }),
  );
}

function oneRow(): ProviderRow {
  const read = validateProviderRow({
    name: "Local llama",
    baseUrl: "http://127.0.0.1:8080/v1",
    models: [{ id: "qwen", name: "Qwen" }],
  });
  if (read.kind !== "row") throw new Error("unreachable");
  return read.row;
}

/* ------------------------------------------------------------------ *
 * The frame: one modal, five sections (story 17 added Reading), closed
 * without a write.
 * ------------------------------------------------------------------ */

describe("the frame is one modal with the five sections", () => {
  test("the section list is Providers, Turn defaults, Reading, Local model, About", () => {
    expect(SETTINGS_SECTIONS.map((section) => section.label)).toEqual([
      "Providers",
      "Turn defaults",
      "Reading",
      "Local model",
      "About",
    ]);
  });

  test("the Providers section is the shared panel, in place", () => {
    const html = renderSettings("providers");
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="settings"');
    expect(html).toContain("settings-close");
    expect(html).toContain('class="providers-panel"');
    // The panel's own heading and close are gone: the frame owns them.
    expect(html).not.toContain("providers-head");
    expect(html).not.toContain("providers-close");
    for (const section of SETTINGS_SECTIONS) {
      expect(html).toContain(">" + section.label + "</button>");
    }
  });

  test("About is the version and one line, with no links or meters", () => {
    const version = (
      JSON.parse(readFileSync(join(APP, "package.json"), "utf8")) as {
        version: string;
      }
    ).version;
    const html = renderSettings("about");
    expect(html).toContain("Attentioneer " + version);
    expect(html).toContain("bounded delegates");
    expect(html).not.toMatch(/href=|counter|usage|streak/);
  });

  test("the chrome opens it on every map; Esc, outside and the verb close it", () => {
    const control = source("canvas/LevelControl.tsx");
    const app = source("App.tsx");
    const frame = source("canvas/SettingsPanel.tsx");
    expect(control).toContain('className="level-settings"');
    expect(control).toContain("onSettings");
    expect(app).toContain("<SettingsPanel");
    expect(app).toContain("{settingsOpen && (");
    // Esc.
    expect(frame).toContain('e.key !== "Escape"');
    // A press on the backdrop itself, never inside the block.
    expect(frame).toContain("if (e.target === e.currentTarget) onClose();");
    // The close verb.
    expect(frame).toContain('className="settings-close"');
    expect(frame).toContain("onClick={onClose}");
  });

  test("closing writes nothing: the close path is state and a read", () => {
    const app = source("App.tsx");
    const start = app.indexOf("const closeSettings");
    // STORY 17: closing re-reads the fold threshold as well as the rows.
    const end = app.indexOf(
      "}, [refreshProviderFacts, refreshReadingPreference]);",
      start,
    );
    const close = app.slice(start, end);
    expect(close).toContain("setSettingsOpen(false)");
    expect(close).toContain("refreshProviderFacts()");
    expect(close).not.toContain("save");
    expect(close).not.toContain("write");
  });
});

/* ------------------------------------------------------------------ *
 * Providers: one implementation, the store sentence always there.
 * ------------------------------------------------------------------ */

describe("the Providers section keeps the one implementation", () => {
  test("the store sentence is always in the section, before any row", () => {
    const panel = source("canvas/ProvidersPanel.tsx");
    const statusAt = panel.indexOf('className="providers-status"');
    const statusEnd = panel.indexOf("</div>", statusAt);
    const status = panel.slice(statusAt, statusEnd);
    expect(statusAt).toBeGreaterThan(-1);
    expect(status).toContain("secretStatusWords(store)");
    // The sentence is not behind the rows' or the selection's conditional.
    expect(panel.indexOf("settings !== null && settings.providers.length > 0")).toBeGreaterThan(
      statusAt,
    );
    // Rendered as well: the section answers before the store does.
    const html = renderToStaticMarkup(
      createElement(ProvidersPanel, { onChanged: () => {} }),
    );
    expect(html).toContain("providers-status");
    expect(html).toContain("asking where keys live");
  });

  test("the ask surfaces have no provider form: Settings is the only editor", () => {
    const card = codeOf(source("canvas/AskCard.tsx"));
    const ask = codeOf(source("canvas/AskPanel.tsx"));
    const app = codeOf(source("App.tsx"));
    for (const panel of [card, ask]) {
      expect(panel).not.toContain("ProvidersPanel");
      expect(panel).not.toContain("providers-add");
      expect(panel).not.toContain("providers-edit-open");
      expect(panel).not.toContain("set a key");
    }
    expect(app).not.toContain("canvas/ProvidersPanel");
    // Exactly one file mounts the panel: the settings frame.
    expect(source("canvas/SettingsPanel.tsx")).toContain(
      "import { ProvidersPanel } from \"./ProvidersPanel\"",
    );
    expect(source("canvas/SettingsPanel.tsx")).toContain("<ProvidersPanel");
  });
});

/* ------------------------------------------------------------------ *
 * Rows and the default: one list, one selection.
 * ------------------------------------------------------------------ */

describe("a row added in Settings is the row an ask offers", () => {
  test("the selector's options come from the shared provider rows", () => {
    const settings: TurnSettings = withProvider(EMPTY_SETTINGS, oneRow());
    expect(providerOptions(settings)).toEqual([
      { id: "local-llama", label: "Local llama" },
    ]);
    // Settings' Turn defaults is now the only selector: the embedded panel's
    // per-ask selector retired with it (17.7), so an ask card sends with the
    // one default selection.
    expect(source("canvas/SettingsPanel.tsx")).toContain(
      "providerOptions(settings)",
    );
    expect(source("canvas/SettingsPanel.tsx")).toContain(
      "value={settings.providerId}",
    );
    const card = codeOf(source("canvas/AskCard.tsx"));
    expect(card).not.toContain("providerOptions");
    expect(card).not.toContain("settings.providerId");
  });

  test("the default selection is what a new ask resolves", () => {
    const chosen = withSelection(
      withProvider(EMPTY_SETTINGS, oneRow()),
      "local-llama",
      "qwen",
    );
    const resolved = resolveSelection(chosen);
    expect(resolved.kind).toBe("resolved");
    if (resolved.kind !== "resolved") return;
    expect(resolved.provider.id).toBe("local-llama");
    expect(resolved.model.id).toBe("qwen");
    expect(
      formatProviderRef(chosen.providerId, chosen.modelId),
    ).toBe("local-llama:qwen");
    // Turn defaults writes through the same path.
    expect(source("canvas/SettingsPanel.tsx")).toContain(
      "withSelection(settings, providerId, modelId)",
    );
  });

  test("Local model edits the row's idle field, and refuses a sub-minute", () => {
    const row: ProviderRow = {
      kind: "local",
      id: "local-llama",
      name: "Local llama",
      command: "llama-server",
      model: "/models/q.gguf",
      args: ["-m", "{model}", "--port", "{port}"],
      idleMinutes: 10,
      notes: "",
      models: [{ id: "q", name: "Q", capabilities: { tools: false, vision: false } }],
    };
    const settings = withProvider(EMPTY_SETTINGS, row);
    const edited = withLocalIdle(settings, "local-llama", 25);
    expect("kind" in edited).toBe(false);
    if ("kind" in edited) return;
    const found = edited.providers[0];
    expect(found.kind === "local" ? found.idleMinutes : null).toBe(25);
    // Nothing else moved.
    expect(edited.providerId).toBe(settings.providerId);
    expect(edited.modelId).toBe(settings.modelId);
    expect(withLocalIdle(settings, "local-llama", 0)).toEqual({
      kind: "refused",
      sentence: PROVIDER_SENTENCES.localIdle,
    });
    expect(withLocalIdle(settings, "gone", 5)).toEqual({
      kind: "refused",
      sentence: PROVIDER_SENTENCES.localMissing,
    });
  });
});

/* ------------------------------------------------------------------ *
 * Nothing configured: one sentence and the settings shortcut.
 * ------------------------------------------------------------------ */

describe("with nothing configured an ask is a sentence and a shortcut", () => {
  test("the Ask Move renders no question box and no clipboard door", () => {
    const html = renderAsk(false);
    expect(html).toContain("nothing is configured");
    expect(html).toContain("open settings");
    expect(html).not.toContain("ask-question");
    expect(html).not.toContain("ask-copy");
    expect(html).not.toContain("ask-handoff");
    expect(html).not.toContain("ask-send");
  });

  test("a configured ask keeps its composing surface", () => {
    const html = renderAsk(true);
    expect(html).not.toContain("open settings");
    expect(html).toContain("ask-question");
    expect(html).toContain("configure");
  });

  test("the ask card has no provider branch: the hook refuses with one sentence", () => {
    // STORY 17.7 finding: the panel's dedicated "nothing configured — open
    // settings" branch retired with it. The ask card still sends; the hook
    // refuses the turn with PROVIDER_SENTENCES.nothing and the card shows it.
    const card = codeOf(source("canvas/AskCard.tsx"));
    expect(card).not.toContain("resolveSelection");
    expect(card).not.toContain("onConfigure");
    expect(card).not.toContain("open settings");
    expect(card).toContain("ask-card-problem");
    const hook = codeOf(source("canvas/useGround.ts"));
    expect(hook).toContain("PROVIDER_SENTENCES.nothing");
  });
});

/* ------------------------------------------------------------------ *
 * Settings writes only the config: the folder snapshot.
 * ------------------------------------------------------------------ */

function snapshot(
  dir: string,
  base = dir,
  out: Record<string, string> = {},
): Record<string, string> {
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    const rel = full.slice(base.length + 1);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      out[rel + "/"] = "";
      snapshot(full, base, out);
    } else {
      out[rel] = stats.size + ":" + readFileSync(full).toString("base64");
    }
  }
  return out;
}

const workspace = mkdtempSync(join(tmpdir(), "attentioneer-settings-"));
afterAll(() => rmSync(workspace, { recursive: true, force: true }));

describe("Settings writes no workspace file", () => {
  test("the whole folder is byte-identical after the modal renders", () => {
    mkdirSync(join(workspace, "map"), { recursive: true });
    mkdirSync(join(workspace, "notes"), { recursive: true });
    writeFileSync(join(workspace, "map", "ground.txt"), "on: rain | name: rain | x: 0 | y: 0\n");
    writeFileSync(join(workspace, "map", "prisms.jsonl"), "");
    writeFileSync(join(workspace, "notes", "x.md"), "the file's first line\n");
    const before = snapshot(workspace);

    // Every section, the shared panel, and both asks: no render writes.
    for (const section of SETTINGS_SECTIONS) renderSettings(section.id);
    renderToStaticMarkup(createElement(ProvidersPanel, {}));
    renderAsk(false);
    renderAsk(true);

    expect(snapshot(workspace)).toEqual(before);
  });

  test("the settings modules know no workspace writer", () => {
    for (const path of ["canvas/SettingsPanel.tsx", "canvas/ProvidersPanel.tsx"]) {
      const code = codeOf(source(path));
      expect({ path, writer: /writeTextFile|writeMachineFile|writeFile|map\/|workspace\//.test(code) }).toEqual({
        path,
        writer: false,
      });
    }
    // The one write path is the config's queued read-modify-write.
    const provider = codeOf(source("turn/provider.ts"));
    expect(provider).toContain("saveAppConfig");
    expect(provider).not.toMatch(/writeTextFile|writeMachineFile/);
    // The frame's own state writes are the read-modify-write and the secret
    // bridge; there is no settings file of its own.
    const frame = codeOf(source("canvas/SettingsPanel.tsx"));
    expect(frame).toContain("saveTurnSettings");
    expect(frame).not.toContain("writeTextFile");
  });
});
