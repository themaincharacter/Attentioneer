import { pathExists, readTextFile } from "../lib/fs";
import { parseYamlFields, scaffoldWorkspace } from "../lib/serialize";
import { DEFAULT_SHELF_X, shelfXOf } from "../map/shelf";
import { pushRecent } from "./recents";

/** An open workspace: a user-owned folder (ADR-0002, ADR-0004). */
export interface Workspace {
  /** Absolute path of the workspace folder. */
  path: string;
  /** The folder's name — the workspace's identity for now. */
  name: string;
  /**
   * World x of the shelf's fold (ADR-0010): a reference whose word centre is at
   * or past it is set aside. Provisional, read from `workspace.yml`'s
   * `shelf_x`; a workspace without the key gets the default.
   */
  shelfX: number;
}

export function workspaceName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/**
 * The workspace's fold, from `workspace.yml`. Tolerant on read: a missing key,
 * an unreadable value, or an unreadable file all fall back to the default, so
 * an older workspace opens cleanly with a shelf (ADR-0010).
 */
async function readShelfX(path: string): Promise<number> {
  try {
    const text = await readTextFile(`${path}/workspace.yml`);
    return text === null ? DEFAULT_SHELF_X : shelfXOf(parseYamlFields(text));
  } catch {
    // An unreadable (or non-UTF-8) workspace.yml never blocks opening — the
    // fold is a convention, not a gate; the default takes over.
    return DEFAULT_SHELF_X;
  }
}

/** Create: scaffold the folder into a workspace and remember it. */
export async function createWorkspace(path: string): Promise<Workspace> {
  const name = workspaceName(path);
  await scaffoldWorkspace(path, name);
  // Read back rather than assume the default: an existing workspace.yml in the
  // chosen folder is left as it is (ADR-0004), fold included.
  const shelfX = await readShelfX(path);
  await pushRecent(path);
  return { path, name, shelfX };
}

/**
 * Open: an existing workspace (one that has `workspace.yml`).
 * Returns null — writing nothing — when the folder is not a workspace.
 */
export async function openWorkspace(path: string): Promise<Workspace | null> {
  if (!(await pathExists(`${path}/workspace.yml`))) {
    return null;
  }
  const shelfX = await readShelfX(path);
  await pushRecent(path);
  return { path, name: workspaceName(path), shelfX };
}
