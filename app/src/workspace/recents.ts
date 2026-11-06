import { invoke } from "@tauri-apps/api/core";
import { readTextFile } from "../lib/fs";
import { canonicalJson, writeMachineFile } from "../lib/serialize";

/**
 * Recent workspaces, newest first, in `~/.config/attentioneer/config.json`
 * (ADR-0002: the only app-side persistence).
 *
 * Provisional: the config format is not settled by any ADR.
 */

const MAX_RECENTS = 10;

interface Config {
  recentWorkspaces?: unknown;
}

async function configPath(): Promise<string> {
  return await invoke<string>("config_path");
}

export async function loadRecents(): Promise<string[]> {
  const text = await readTextFile(await configPath());
  if (!text) {
    return [];
  }
  try {
    const config = JSON.parse(text) as Config;
    if (!Array.isArray(config.recentWorkspaces)) {
      return [];
    }
    return config.recentWorkspaces.filter((p): p is string => typeof p === "string");
  } catch {
    return [];
  }
}

export async function pushRecent(path: string): Promise<void> {
  const recents = await loadRecents();
  const next = [path, ...recents.filter((p) => p !== path)].slice(0, MAX_RECENTS);
  await writeMachineFile(await configPath(), canonicalJson({ recentWorkspaces: next }));
}
