import { readTextFile } from "../lib/fs";
import { parseYamlFields, workspaceYml, writeMachineFile } from "../lib/serialize";

/**
 * The active scenario is a RESUME HINT (ADR-0021 decision 5, Epic 8 story 2),
 * in `workspace.yml` beside the level's: the key `scenario` names the branch
 * whose variant is open, and ITS ABSENCE MEANS THE COMMITTED MODEL. So three
 * states read as "the map, as committed": no key at all, an empty or unreadable
 * value, and a slug that names no branch folder on disk (a folder deleted
 * outside the app, a half-written branch, a hand edit).
 *
 * The pattern is the level key's, exactly (ADR-0018 decision 2):
 *
 *   - the key is a HINT, not the source of behavior — the running branch is
 *     app state, and the key is what open-restore reads;
 *   - the SWITCH writes it, through the workspace's in-order write queue (the
 *     same one the level handoff uses — one queue per file), and only the
 *     `scenario` line is touched: comments, unknown keys and the fold survive
 *     byte-exactly;
 *   - RESTORE NEVER WRITES. Opening reads the key, resolves it against the
 *     folders on disk, and sets the branch; a hand-edited key is honored on
 *     open and rewritten only on the first deliberate switch.
 *
 * Switching back to the committed model REMOVES the key (the absence is the
 * record), so `workspace.yml` never carries a "none" spelling to keep in sync.
 *
 * Provisional (ADR-0021): the key's name and the absence rule; the chooser's
 * look is ADR-0003's rendering seam.
 */

/** The provisional workspace key naming the active branch. */
export const SCENARIO_KEY = "scenario";

/** A line that assigns the scenario key (never a comment). */
const SCENARIO_LINE = /^\s*scenario\s*:/;

/**
 * The branch from `workspace.yml`'s parsed fields, or null for the committed
 * model. Tolerant on read: a non-string, an empty value or a whitespace-only
 * one is the committed model — the app never asks twice and never fails to
 * open. A string is the hint as written (trimmed); whether a folder answers to
 * it is `resolveActiveScenario`'s reading.
 */
export function scenarioOf(
  fields: Readonly<Record<string, string | number>>,
): string | null {
  const value = fields[SCENARIO_KEY];
  if (typeof value !== "string") return null;
  const slug = value.trim();
  return slug === "" ? null : slug;
}

/** The branch from raw `workspace.yml` text (missing text = the committed model). */
export function scenarioOfText(text: string | null): string | null {
  return text === null ? null : scenarioOf(parseYamlFields(text));
}

/**
 * The hint resolved against the branch folders that exist: the slug when a
 * folder answers to it, else the committed model. This is the one place the
 * app decides that a stale hint is not an error — a deleted or renamed branch
 * opens as the committed model, quietly, and the next switch rewrites the key.
 */
export function resolveActiveScenario(
  hint: string | null,
  folders: readonly string[],
): string | null {
  if (hint === null) return null;
  return folders.includes(hint) ? hint : null;
}

/**
 * The `workspace.yml` bytes with the scenario hint set (or, for
 * `scenario === null`, with the key removed — the committed model).
 *
 * The line is rewritten in place when it exists (duplicates collapse to one)
 * and appended otherwise; every other byte — comments included — is kept, with
 * LF newlines and exactly one trailing newline. Pure, so the write rule is
 * testable without the fs bridge.
 */
export function withScenario(text: string, scenario: string | null): string {
  const normalized = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .replace(/\n*$/, "");
  const lines = normalized === "" ? [] : normalized.split("\n");
  const entry = `${SCENARIO_KEY}: ${JSON.stringify(scenario)}`;

  const out: string[] = [];
  let written = false;
  for (const line of lines) {
    if (!SCENARIO_LINE.test(line)) {
      out.push(line);
      continue;
    }
    // The committed model is the ABSENCE of the key: a switch back to it drops
    // every line the key occupied (a hand-duplicated key included).
    if (scenario === null) continue;
    if (written) continue; // a hand-duplicated key collapses to one line
    out.push(entry);
    written = true;
  }
  if (scenario !== null && !written) out.push(entry);
  return `${out.join("\n")}\n`;
}

/**
 * Persist the active branch in the workspace's own file. The workspace must
 * already exist; if the file somehow reads empty the canonical scaffold stands
 * in, so the format key is never dropped.
 *
 * This is a READ-MODIFY-WRITE (it keeps every other byte), so it is only ever
 * reached through the scenario handoff's write queue (`handoff.ts`) — the same
 * queue the level handoff uses, since both write this one file. Opening a
 * workspace never calls it.
 */
export async function saveWorkspaceScenario(
  workspacePath: string,
  scenario: string | null,
): Promise<void> {
  const path = `${workspacePath}/workspace.yml`;
  const text = await readTextFile(path);
  const base = text !== null && text.trim() !== "" ? text : workspaceYml();
  await writeMachineFile(path, withScenario(base, scenario));
}
