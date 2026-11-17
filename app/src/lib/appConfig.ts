import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "./fs";
import { canonicalJson, writeMachineFile } from "./serialize";
import { createWriteQueue } from "./writeQueue";

/**
 * The app's ONE config file, whose per-OS location the `config_path` command
 * owns (ADR-0002: the only app-side persistence) — Linux
 * `$XDG_CONFIG_HOME/attentioneer/config.json` (else `$HOME/.config`), macOS
 * `~/Library/Application Support/attentioneer/config.json`, Windows
 * `%APPDATA%\attentioneer\config.json`. Two things live here today: the
 * recent workspaces and the turn's provider ROWS (id, name, base URL,
 * models) plus the selected providerId:modelId.
 *
 * WHY A MERGE AND NOT A REWRITE: each feature owns a top-level key, so a
 * second writer must not delete the first. `saveAppConfig` reads the file,
 * lays the patch over it and writes the whole object back — which makes it a
 * read-modify-write, and therefore something that must be queued (ADR-0004/
 * ADR-0018's one-byte-door discipline): two of these interleaved would let an
 * older value reappear under a newer one. One queue belongs to one file, so
 * this module owns the config's queue.
 *
 * The API KEY NEVER COMES HERE. A key is a capability, not a setting: it is
 * kept in the OS keychain, or — where no keychain answers — in ONE stated
 * owner-only fallback file (see src-tauri/src/secrets.rs and lib/secret.ts).
 * This file has no key field and no writer that could add one.
 *
 * PROVISIONAL: the file's shape and the keys' names are not settled by any ADR.
 */

/** The file's top level: feature keys, unknown ones preserved verbatim. */
export type AppConfig = Record<string, unknown>;

const configQueue = createWriteQueue();

function isRecord(value: unknown): value is AppConfig {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Where the config file lives (the command owns the rule, not this module). */
export async function configPath(): Promise<string> {
  return await invoke<string>("config_path");
}

/**
 * The whole config. A missing file (the first launch), a malformed one, or a
 * file that is not an object all read as `{}` — an unreadable config is
 * honest ignorance, never an exception the window has to catch.
 */
export async function loadAppConfig(): Promise<AppConfig> {
  let text: string | null = null;
  try {
    text = await readTextFile(await configPath());
  } catch {
    return {};
  }
  if (text === null || text === "") return {};
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Read, lay a patch over the top level, write. Queued, so two merges never
 * interleave, and a patch of one feature key never drops another.
 */
export async function saveAppConfig(patch: AppConfig): Promise<void> {
  await configQueue.push(async () => {
    const current = await loadAppConfig();
    await writeMachineFile(await configPath(), canonicalJson({ ...current, ...patch }));
  });
}
