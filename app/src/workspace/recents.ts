import { loadAppConfig, saveAppConfig } from "../lib/appConfig";

/**
 * Recent workspaces, newest first, in `~/.config/attentioneer/config.json`
 * (ADR-0002: the only app-side persistence).
 *
 * The file now has more than one key (the turn's provider row lives beside
 * these paths), so the read and the write go through `lib/appConfig.ts`: a
 * merge preserves whatever else is there instead of rewriting the file down
 * to the recents alone.
 *
 * Provisional: the config format is not settled by any ADR.
 */

const MAX_RECENTS = 10;

/** The stored list, filtered to the strings a path can be. */
export async function loadRecents(): Promise<string[]> {
  const config = await loadAppConfig();
  const stored = config.recentWorkspaces;
  if (!Array.isArray(stored)) {
    return [];
  }
  return stored.filter((path): path is string => typeof path === "string");
}

export async function pushRecent(path: string): Promise<void> {
  const recents = await loadRecents();
  const next = [path, ...recents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
  await saveAppConfig({ recentWorkspaces: next });
}
