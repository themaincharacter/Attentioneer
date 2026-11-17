import { loadAppConfig, saveAppConfig } from "../lib/appConfig";
import {
  BUILTIN_PROVIDERS,
  EMPTY_SETTINGS,
  builtinsUnderPerson,
  readTurnSettings,
  storedTurnSettings,
  type TurnSettings,
} from "./providers";

/**
 * THE TURN'S SETTINGS AT REST (Epic 15 story 4) — the one place the app config
 * and the turn's provider rows meet.
 *
 * WHY HERE AND NOT IN providers.ts: the rules that decide what a row IS are
 * pure (providers.ts); this file owns the only I/O — reading the config's
 * turn key and writing it back through lib/appConfig.ts's ONE queued
 * read-modify-write, so a provider edit never drops the recent workspaces and
 * two edits never interleave.
 *
 * WHY THERE IS NO KEY HERE: a key is not a setting. The config holds rows and
 * a selection; the key lives in the OS keychain (or the stated local fallback)
 * and is read at SEND time only — see lib/secret.ts. Nothing in this file can
 * write a secret, and the stored shape is built field by field so a stray
 * property can never ride into the file.
 *
 * WHAT STORY 1'S ROW BECOMES: the old turn object (baseUrl + model) is not a
 * row and is not guessed at — it reads as nothing configured, and the panel
 * asks for a provider once. An upgrade must not pretend a URL nobody named is
 * a provider row.
 *
 * PROVISIONAL: the turn key's name and the stored field names.
 */

/** The config key the turn settings live under. */
export const TURN_CONFIG_KEY = "turn";

/**
 * The turn settings from the config file. An unreadable or malformed file is
 * the same honest nothing the app shows everywhere else — never an exception
 * the window has to catch.
 */
export async function loadTurnSettings(): Promise<TurnSettings> {
  try {
    const config = await loadAppConfig();
    const read = readTurnSettings(config[TURN_CONFIG_KEY]);
    return builtinsUnderPerson(read, BUILTIN_PROVIDERS);
  } catch {
    return { ...EMPTY_SETTINGS, providers: [] };
  }
}

/**
 * Persist the rows and the selection — and nothing else. The layering under the
 * top-level turn key keeps every other feature's config untouched.
 */
export async function saveTurnSettings(settings: TurnSettings): Promise<void> {
  await saveAppConfig({
    [TURN_CONFIG_KEY]: storedTurnSettings(settings),
  });
}
