import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "./fs";
import {
  DEFAULT_READING_PREFERENCE,
  readReadingPreference,
  storedReadingPreference,
  type ReadingPreference,
} from "./readingPreference";
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
 * STORY 17 (shortlist items 7-9) ADDS THE READING PREFERENCE: how many lines
 * a ground card's face shows before its fold. It is a PREFERENCE, not a
 * counter - two bounded numbers the person states in Settings, read back by
 * the crop and written through the SAME queued merge as everything else. Its
 * pure shape and bounds live in lib/readingPreference.ts; this file owns only
 * the key and the I/O.
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

/* ------------------------------------------------------------------------- *
 * STORY 17 (shortlist items 7-9) - THE STATED FOLD THRESHOLD.
 *
 * Two numbers the person can SEE and CHANGE, under the config's own "reading"
 * key. Nothing else is stored: no counter, no history, no last-used value. The
 * read falls back to the defaults on any ignorance (a missing file, a
 * malformed key), exactly like the rest of this module; the write goes through
 * the same queued merge, so it can never drop another feature's key.
 * ------------------------------------------------------------------------- */

/** The config key the stated fold threshold lives under. */
export const READING_CONFIG_KEY = "reading";

/**
 * The stated threshold from the config. An unreadable or malformed file is the
 * same honest default the card already renders with.
 */
export async function loadReadingPreference(): Promise<ReadingPreference> {
  try {
    const config = await loadAppConfig();
    return readReadingPreference(config[READING_CONFIG_KEY]);
  } catch {
    return DEFAULT_READING_PREFERENCE;
  }
}

/**
 * Persist the two stated counts (each bounded, field by field) and answer what
 * LANDED, so Settings can show the number that is actually used rather than the
 * number that was typed.
 */
export async function saveReadingPreference(
  preference: ReadingPreference,
): Promise<ReadingPreference> {
  const stored = storedReadingPreference(preference);
  await saveAppConfig({ [READING_CONFIG_KEY]: stored });
  return stored;
}
