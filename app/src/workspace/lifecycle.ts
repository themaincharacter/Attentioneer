import { pathExists } from "../lib/fs";
import { scaffoldWorkspace } from "../lib/serialize";
import { pushRecent } from "./recents";

/** An open workspace: a user-owned folder (ADR-0002, ADR-0004). */
export interface Workspace {
  /** Absolute path of the workspace folder. */
  path: string;
  /** The folder's name — the workspace's identity for now. */
  name: string;
}

export function workspaceName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/** Create: scaffold the folder into a workspace and remember it. */
export async function createWorkspace(path: string): Promise<Workspace> {
  const name = workspaceName(path);
  await scaffoldWorkspace(path, name);
  await pushRecent(path);
  return { path, name };
}

/**
 * Open: an existing workspace (one that has `workspace.yml`).
 * Returns null — writing nothing — when the folder is not a workspace.
 */
export async function openWorkspace(path: string): Promise<Workspace | null> {
  if (!(await pathExists(`${path}/workspace.yml`))) {
    return null;
  }
  await pushRecent(path);
  return { path, name: workspaceName(path) };
}
