import { pathExists, readTextFile } from "../lib/fs";
import { parseYamlFields, scaffoldWorkspace } from "../lib/serialize";
import { DEFAULT_SHELF_X, shelfXOf } from "../map/shelf";
import { DEFAULT_LEVEL, levelOf, type Level } from "./level";
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
  /**
   * The active game (ADR-0016): `workspace.yml`'s provisional `level` key is
   * the sole source — absent, garbage or unreadable means concept, so an older
   * workspace opens exactly as before. Reopening resumes the saved level.
   */
  level: Level;
}

export function workspaceName(path: string): string {
  const trimmed = path.replace(/\/+$/, "");
  return trimmed.slice(trimmed.lastIndexOf("/") + 1) || trimmed;
}

/**
 * `workspace.yml`'s parsed fields, tolerant: a missing or unreadable file (or
 * a non-UTF-8 hand edit) reads as no fields, so the app's defaults take over.
 * The fold and the level are conventions here, never gates on opening.
 */
async function readWorkspaceFields(
  path: string,
): Promise<Record<string, string | number>> {
  try {
    const text = await readTextFile(`${path}/workspace.yml`);
    return text === null ? {} : parseYamlFields(text);
  } catch {
    return {};
  }
}

async function readWorkspace(path: string): Promise<Workspace> {
  const fields = await readWorkspaceFields(path);
  return {
    path,
    name: workspaceName(path),
    shelfX: fields.shelf_x === undefined ? DEFAULT_SHELF_X : shelfXOf(fields),
    level: fields.level === undefined ? DEFAULT_LEVEL : levelOf(fields),
  };
}

/** Create: scaffold the folder into a workspace and remember it. */
export async function createWorkspace(path: string): Promise<Workspace> {
  await scaffoldWorkspace(path, workspaceName(path));
  // Read back rather than assume the defaults: an existing workspace.yml in the
  // chosen folder is left as it is (ADR-0004), fold and level included.
  const workspace = await readWorkspace(path);
  await pushRecent(path);
  return workspace;
}

/**
 * Open: an existing workspace (one that has `workspace.yml`).
 * Returns null — writing nothing — when the folder is not a workspace.
 */
export async function openWorkspace(path: string): Promise<Workspace | null> {
  if (!(await pathExists(`${path}/workspace.yml`))) {
    return null;
  }
  const workspace = await readWorkspace(path);
  await pushRecent(path);
  return workspace;
}
