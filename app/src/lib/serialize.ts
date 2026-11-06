import { createDirAll, pathExists, writeTextFile } from "./fs";

/**
 * Canonical serialization (ADR-0004, rule 4): this module owns all
 * machine-file writing — UTF-8, LF, 2-space indent, keys sorted
 * lexicographically, trailing newline; JSONL lines compact with sorted keys.
 * Writers never hand-stringify.
 *
 * Provisional: the workspace.yml format key's value is not settled by any ADR.
 */

/** The workspace format key (provisional). */
export const FORMAT_KEY = "attentioneer-workspace/1";

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      out[key] = sortKeys(source[key]);
    }
    return out;
  }
  return value;
}

/** LF newlines and exactly one trailing newline. */
export function canonicalText(text: string): string {
  return text.replace(/\r\n?/g, "\n").replace(/\n*$/, "\n");
}

/** JSON with keys sorted recursively, 2-space indent, trailing newline. */
export function canonicalJson(value: unknown): string {
  return canonicalText(JSON.stringify(sortKeys(value), null, 2));
}

/** One JSONL line: compact JSON with keys sorted recursively, no newline. */
export function canonicalJsonlLine(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

/** A JSONL document: one compact line per entry, trailing newline. */
export function canonicalJsonl(entries: readonly unknown[]): string {
  return canonicalText(entries.map(canonicalJsonlLine).join("\n"));
}

/**
 * YAML for flat frontmatter maps: keys sorted, one `key: value` per line,
 * string values JSON-quoted (valid YAML), trailing newline.
 */
export function canonicalYaml(map: Readonly<Record<string, string | number>>): string {
  const lines = Object.keys(map)
    .sort()
    .map((key) => {
      const value = map[key];
      return `${key}: ${typeof value === "string" ? JSON.stringify(value) : value}`;
    });
  return canonicalText(lines.join("\n"));
}

/**
 * Read side of `canonicalYaml`: one `key: value` per line. Values keep their
 * type — JSON-quoted strings parse as strings, numerics as numbers, anything
 * else stays a raw string. Malformed lines are kept raw, never guessed at.
 */
export function parseYamlFields(text: string): Record<string, string | number> {
  const fields: Record<string, string | number> = {};
  for (const line of text.split(/\r?\n/)) {
    const colon = line.indexOf(":");
    if (colon <= 0) continue;
    const key = line.slice(0, colon).trim();
    const raw = line.slice(colon + 1).trim();
    if (!key) continue;
    if (raw.startsWith('"')) {
      try {
        fields[key] = JSON.parse(raw) as string;
        continue;
      } catch {
        // dangling quote etc. — keep the raw text
      }
    }
    const num = Number(raw);
    fields[key] = raw !== "" && Number.isFinite(num) ? num : raw;
  }
  return fields;
}

/** The only door machine-file bytes go through. */
export async function writeMachineFile(path: string, content: string): Promise<void> {
  await writeTextFile(path, canonicalText(content));
}

export function workspaceYml(): string {
  return [
    "# Attentioneer workspace — the format key below marks the on-disk schema.",
    `format: ${FORMAT_KEY}`,
    "",
  ].join("\n");
}

export function agentsMd(workspaceName: string): string {
  return [
    `# ${workspaceName} — agent orientation`,
    "",
    "This folder is an Attentioneer workspace: a user-authored map of references and",
    "distances, plus working notes. Delegates (like you) work here on the user's behalf.",
    "",
    "## What is here",
    "",
    "- `workspace.yml` — workspace marker and format key; keep it.",
    "- `notes/` — working notes: one Markdown file per thought, named after it.",
    "- `map/` and `ontology/` arrive later; until then the notes are the content.",
    "",
    "## Ground rules",
    "",
    "- The user authors the map. Your edits arrive as ghosts: small reversible patches",
    "  shown faintly until the user accepts, reshapes, or rejects them.",
    "- Only the user coins a name. Propose freely, marked as a proposal.",
    "- Ignorance is content: unknown, bracketed, and delegated material stays visible.",
    "- Work inside this folder; read outside it only when the task needs it.",
    "",
    "## Machine files",
    "",
    "Machine-written files (`workspace.yml`, later `distances.jsonl` and the ontology)",
    "use one canonical style: LF newlines, 2-space indent, sorted keys, trailing",
    "newline. Hand edits are welcome; the app returns them in that style.",
    "",
  ].join("\n");
}

/**
 * Scaffold a workspace folder (ADR-0004's Epic 1 slice): `workspace.yml`,
 * `AGENTS.md`, `notes/`. Files that already exist are left as they are.
 */
export async function scaffoldWorkspace(path: string, name: string): Promise<void> {
  const files: ReadonlyArray<readonly [string, string]> = [
    [`${path}/workspace.yml`, workspaceYml()],
    [`${path}/AGENTS.md`, agentsMd(name)],
  ];
  for (const [file, content] of files) {
    if (!(await pathExists(file))) {
      await writeMachineFile(file, content);
    }
  }
  await createDirAll(`${path}/notes`);
}
