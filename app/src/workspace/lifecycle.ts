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
   * The level's RESUME HINT (ADR-0016, amended by ADR-0018): `workspace.yml`'s
   * provisional `level` key, read once on open — absent, garbage or unreadable
   * means concept, so an older workspace opens exactly as before. The zoom band
   * is the game at runtime (`levelHandoff.ts`): opening sets the camera into
   * this band and writes nothing, and the band writes the key back on the first
   * settled crossing.
   */
  resumeLevel: Level;
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
    resumeLevel: fields.level === undefined ? DEFAULT_LEVEL : levelOf(fields),
  };
}

/**
 * Create: scaffold the folder into a workspace and remember it. The scaffold's
 * orientation text — Level 1's map/shelf sections, Level 2's four records and
 * the loop-reading rule, Level 3's reach (the render map, the three level
 * values, the pointer forms and the window's snapshot wording), and the
 * zoom/level contract (the band is the game; the key is the resume hint) — is
 * `agentsMd` in `lib/serialize.ts`. The scaffold is WRITE-ONCE
 * (`scaffoldWorkspace` writes only missing files), so only a NEW workspace gets
 * the current text; an existing workspace's `AGENTS.md` is never rewritten.
 */
export async function createWorkspace(path: string): Promise<Workspace> {
  await scaffoldWorkspace(path, workspaceName(path));
  // Read back rather than assume the defaults: an existing workspace.yml in the
  // chosen folder is left as it is (ADR-0004), fold and level included.
  const workspace = await readWorkspace(path);
  await pushRecent(path);
  return workspace;
}

/**
 * Open: an existing workspace (one that has `workspace.yml`). Opening reads
 * only — it never scaffolds, never rewrites `workspace.yml` or `AGENTS.md`, and
 * never writes the `level` key — so an older workspace keeps its own
 * orientation text and a hand-edited level is honored (ADR-0018 decision 2).
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
