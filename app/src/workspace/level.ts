import { readTextFile } from "../lib/fs";
import { parseYamlFields, workspaceYml, writeMachineFile } from "../lib/serialize";

/**
 * The level (ADR-0016): Level 2 is a quiet mode over the same plane, and the
 * workspace's `level` key in `workspace.yml` is its one source — `"concept"`
 * or `"dynamics"`; absent (or unreadable, or garbage) means concept, so an
 * older workspace opens exactly as before. Zoom never changes it.
 *
 * The key is written canonically on change, and only the level line is
 * touched: comments, unknown keys and the shelf's fold stay exactly as they
 * were. Provisional: the key's name and the two values are ADR-0016's rule,
 * not a settled format (ADR-0003's rendering seam covers the control's look).
 */

export type Level = "concept" | "dynamics";

/** The provisional workspace key naming the game. */
export const LEVEL_KEY = "level";

export const DEFAULT_LEVEL: Level = "concept";

/** A line that assigns the level key (never a comment). */
const LEVEL_LINE = /^\s*level\s*:/;

/**
 * The level from `workspace.yml`'s parsed fields. Tolerant on read: only a
 * `dynamics` value turns the mode on; a missing, empty, numeric or unknown
 * value is concept, and the app never asks twice (ADR-0016).
 */
export function levelOf(fields: Readonly<Record<string, string | number>>): Level {
  const value = fields[LEVEL_KEY];
  return typeof value === "string" && value.trim().toLowerCase() === "dynamics"
    ? "dynamics"
    : DEFAULT_LEVEL;
}

/** The level from raw `workspace.yml` text (missing text = concept). */
export function levelOfText(text: string | null): Level {
  return text === null ? DEFAULT_LEVEL : levelOf(parseYamlFields(text));
}

/**
 * The workspace.yml bytes with the level set canonically. The line is
 * rewritten in place when it exists (duplicates collapse to one) and appended
 * otherwise; every other byte — comments included — is kept, with LF
 * newlines and exactly one trailing newline. Pure, so persistence is testable
 * without the fs bridge.
 */
export function withLevel(text: string, level: Level): string {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n*$/, "");
  const lines = normalized === "" ? [] : normalized.split("\n");
  const entry = `${LEVEL_KEY}: ${JSON.stringify(level)}`;

  const out: string[] = [];
  let written = false;
  for (const line of lines) {
    if (!LEVEL_LINE.test(line)) {
      out.push(line);
      continue;
    }
    if (written) continue; // a hand-duplicated key collapses to one line
    out.push(entry);
    written = true;
  }
  if (!written) out.push(entry);
  return `${out.join("\n")}\n`;
}

/**
 * Persist the level in the workspace's own file. The workspace must already
 * exist; if the file somehow reads empty the canonical scaffold stands in, so
 * the format key is never dropped.
 */
export async function saveWorkspaceLevel(
  workspacePath: string,
  level: Level,
): Promise<void> {
  const path = `${workspacePath}/workspace.yml`;
  const text = await readTextFile(path);
  const base = text !== null && text.trim() !== "" ? text : workspaceYml();
  await writeMachineFile(path, withLevel(base, level));
}
