import { loadAppConfig, saveAppConfig } from "../lib/appConfig";
import type { TurnProvider } from "./protocol";

/**
 * The ONE provider row story 1 knows (Epic 15 story 1; ADR-0034 mean the turn
 * crosses stdio, not that secrets are settled).
 *
 * TWO KINDS OF FACT, TWO HOMES:
 *   - the base URL and the model are ordinary settings; they persist in the
 *     app's config file beside the recent workspaces (the existing
 *     `config_path` command owns the location), so the person configures a
 *     provider once instead of once per turn;
 *   - the API KEY IS HELD IN MEMORY FOR THE SESSION ONLY. It is never written
 *     to the config file, to a workspace file, to a log or to an error
 *     sentence. It goes into a request line, crosses the pipe, and the
 *     sidecar uses it for one `fetch`. When the app quits, it is gone.
 *
 * WHY NOT DISK: a key on disk is a key any other process (or a synced folder,
 * or a backup) can read, and the app has no keychain story yet. The
 * OS-keychain ADR is STILL TO BE WRITTEN — story 4 brings the `keyring` crate
 * and a visible fallback; nothing here should be mistaken for that decision.
 *
 * PROVISIONAL: the stored key's name (`turn`), its field names, and the fact
 * that the row is a single provider rather than a list (story 4 makes it rows).
 */

/** The config key the provider row lives under. */
export const TURN_CONFIG_KEY = "turn";

/** What the config file holds. The key is deliberately absent. */
export interface StoredProvider {
  baseUrl: string;
  model: string;
}

/** One provider row: an empty string means "not configured yet". */
export const EMPTY_PROVIDER: StoredProvider = { baseUrl: "", model: "" };

/**
 * IS A PROVIDER CONFIGURED? (Epic 15 story 2.) The app-sent Ask leaves only
 * when a base URL and a model are both present; anything less is the stated
 * clipboard fallback, not an Ask failure. The KEY is not part of this test:
 * a local or keyless endpoint may legitimately have none, and a key that is
 * wrong fails one turn with one sentence — it does not change the transport.
 */
export function hasProvider(stored: StoredProvider): boolean {
  return stored.baseUrl.trim() !== "" && stored.model.trim() !== "";
}

/**
 * The session's key. Module memory — not React state, not storage — so it
 * survives closing and reopening the panel in the same session and vanishes
 * with the process. Nothing exports the value except `rememberedApiKey`, and
 * nothing writes it.
 */
let sessionKey = "";

/** Keep the key for this session only (never called with a persisted key). */
export function rememberApiKey(key: string): void {
  sessionKey = key;
}

/** The session's key, or an empty string when none was typed. */
export function rememberedApiKey(): string {
  return sessionKey;
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The stored base URL and model. A missing or malformed row reads as empty
 * strings (the panel then asks for them); a config file that cannot be read
 * is the same honest nothing.
 */
export async function loadProviderConfig(): Promise<StoredProvider> {
  try {
    const config = await loadAppConfig();
    const row = config[TURN_CONFIG_KEY];
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      return { ...EMPTY_PROVIDER };
    }
    const record = row as Record<string, unknown>;
    return {
      baseUrl: textOf(record.baseUrl),
      model: textOf(record.model),
    };
  } catch {
    return { ...EMPTY_PROVIDER };
  }
}

/**
 * Persist the two non-secret facts. The merge keeps the recents (and anything
 * else) in the file; the key never enters this patch.
 */
export async function saveProviderConfig(
  baseUrl: string,
  model: string,
): Promise<void> {
  await saveAppConfig({
    [TURN_CONFIG_KEY]: { baseUrl, model },
  });
}

/** One turn's provider, built at send time from the row plus the session key. */
export function providerFrom(
  stored: StoredProvider,
  apiKey: string,
): TurnProvider {
  return {
    baseUrl: stored.baseUrl.trim(),
    model: stored.model.trim(),
    apiKey,
  };
}
