import { createDirAll, pathExists, writeTextFile } from "./fs";
import { DEFAULT_SHELF_X } from "../map/shelf";

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

/**
 * A reference's file slug (ADR-0005, rule 4): unicode letters and digits
 * kept and case-folded, every other character becomes `-`, runs trimmed.
 * Non-Latin coined names survive — the old a-z0-9 rule collapsed them to
 * `untitled`, which would have broken name-identity.
 */
export function slugName(name: string): string {
  const slug = name
    .normalize("NFKC")
    .toLowerCase()
    .split("")
    .map((char) => (/[\p{L}\p{Nd}]/u.test(char) ? char : "-"))
    .join("")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

/**
 * Mint the first free slug, adding a numeric suffix on collision (ADR-0005
 * rule 4). Pure, and it lives beside `slugName` because it is the second half
 * of the slug rules: a reference's file slug, a loop's name-derived key and a
 * membership slug all mint the same way. The caller supplies what is taken.
 */
export function nextSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

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
 * A JSONL document from lines that are already bytes-to-be: known records
 * through `canonicalJsonlLine`, malformed/unknown lines verbatim. This is the
 * only way a writer may mix canonical records with preserved raw lines —
 * `canonicalJsonl` would JSON-encode the strings a second time.
 */
export function canonicalJsonlLines(lines: readonly string[]): string {
  return canonicalText(lines.join("\n"));
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
    "# The shelf is a world-space margin past this x, per ADR-0010.",
    "# A reference whose word centre is at or past it is set aside.",
    `shelf_x: ${DEFAULT_SHELF_X}`,
    "",
  ].join("\n");
}

/**
 * The scaffolded `AGENTS.md` — the workspace's orientation for delegates.
 *
 * Level 1's text (the map, the shelf, the ground rules) stays exactly as it was;
 * Level 2's orientation is ADDED to it (Epic 4 story 5): the four records, the
 * `level` key, the reading rule (polarity, completeness, mark precedence,
 * rotation-canonical paths, exact-direction matching, named gaps) and the
 * no-label rule; Level 3's orientation (Epic 5 story 3) adds the reach: the
 * render map, the three level values with garbage tolerance, the pointer forms
 * and their resolution, and the window's snapshot wording. The scaffold is
 * WRITE-ONCE (ADR-0004): `scaffoldWorkspace`
 * writes only files that are missing, so an existing workspace keeps its own
 * text and only a NEW workspace gets this one — a story never rewrites the
 * orientation a workspace already holds.
 */
export function agentsMd(workspaceName: string): string {
  return [
    `# ${workspaceName} — agent orientation`,
    "",
    "This folder is an Attentioneer workspace: a user-authored map of references and",
    "distances, plus working notes. Delegates (like you) work here on the user's behalf.",
    "",
    "## What is here",
    "",
    "- `workspace.yml` — workspace marker, format key, and the shelf's fold",
    "  (`shelf_x`); keep it.",
    "- `map/references/` — one Markdown file per reference: its coined name, its",
    "  place on the plane, and its optional memory (prose).",
    "- `map/distances.jsonl` — one line per distance: its two endpoints and the",
    "  coined word (from, to, word).",
    "- `map/marks.jsonl` — one line per open mark: an anonymous annotation on a",
    "  word, on a distance, on a signed link, or on a bare spot of the plane.",
    "- `map/model.json` — the playing set: the sorted word slugs the dynamics game",
    "  plays with, as `{\"words\": [...]}`. Absence is exclusion: a word not named",
    "  here is out of play, and nothing else records the choice.",
    "- `map/links.jsonl` — one line per signed causal link: `from`, `to` and a",
    "  `sign` of `+` or `-`. The ordered pair is the key, so `A` → `B` and",
    "  `B` → `A` are two different links.",
    "- `map/loops.jsonl` — one line per named loop: the person's coined `name` and",
    "  the closed `path` of word slugs it walks (the first slug repeated at the",
    "  end, so every member pair reads explicitly).",
    "- `map/assumptions.jsonl` — one line per stated assumption: its `text` and",
    "  one target — `on` a word, a `from`/`to` link pair, `loop` a loop, or",
    "  `x`/`y` a bare spot of the plane.",
    "- `map/pointers.jsonl` — one line per reach beyond the map: the word it hangs",
    "  on (`on`) plus exactly one authored target form — `path`",
    "  (workspace-relative), `at` (absolute, machine-local) or `url` (any scheme).",
    "- `notes/` — working notes from before the map; kept untouched, no longer shown.",
    "- `ontology/` arrives in later efforts.",
    "",
    "## The shelf",
    "",
    `The map has a quiet fold at \`shelf_x\` (in \`workspace.yml\`; ${DEFAULT_SHELF_X} when the`,
    "key is absent). A reference whose word's centre is at or past that x is set",
    "aside on the world-space margin beyond the fold. Position is the only",
    "record — there is no shelf flag, folder, or field. A set-aside reference",
    "carrying an open mark is deferred; one without a mark is rejected.",
    "",
    "In a reference file `x` is the word's left edge, so `x` at or past `shelf_x`",
    "always means \"on the shelf\"; move it clearly below to bring it back. Change",
    "`shelf_x` only when the user asks to move the fold.",
    "",
    "## Level 2 — the dynamics model",
    "",
    "`workspace.yml`'s `level` key is the only source of the active game:",
    "`\"concept\"` (Level 1 — absent means this), `\"dynamics\"` (Level 2) or",
    "`\"ground\"` (Level 3 — the reach, below). Zoom never changes it. Level 2 is",
    "a quiet mode over the same plane, and its records",
    "are the playing set (`map/model.json`, required before the model is read)",
    "plus `map/links.jsonl`, `map/loops.jsonl` and `map/assumptions.jsonl`.",
    "",
    "Reading a loop. Walk its `path` in order, one step per consecutive pair, and",
    "read each step's sign from `map/links.jsonl` by EXACT direction: the step",
    "`A` → `B` needs the link with `from: \"A\", to: \"B\"`. `+` means the pair moves",
    "in the same direction; `-` means opposite. Never read a reverse-only link —",
    "say it runs the other way instead. A path is rotation-canonical: the smallest",
    "slug is first, direction and closure preserved, so lines are comparable.",
    "",
    "The verdict. Say \"reinforcing\" (an even number of `-` steps) or",
    "\"balancing\" (odd) ONLY when every step's sign is known and every path word",
    "is on the map and in the playing set. A mark on a link overrides its stored",
    "sign while the mark stands: the file keeps the sign, the read shows unknown,",
    "and withdrawing the mark restores it — a mark may doubt existence or",
    "direction, not only the sign. When a step does not resolve, name the gap and",
    "withhold the verdict: never guess a sign, never accept a reverse-only link,",
    "never repair a path, never invent a link.",
    "",
    "A loop's behavior is READ from its links, never stored. No record carries a",
    "verdict, a label, a count or a score: recompute the read from the files on",
    "every change, and keep it out of the files. An assumption is a claim kept",
    "open to revision; a mark says something is not settled. Neither is a label.",
    "",
    "## Level 3 — the reach beyond the map",
    "",
    "`workspace.yml`'s `level` has a third value, `\"ground\"` (Level 3). The three",
    "games are `\"concept\"` (Level 1), `\"dynamics\"` (Level 2) and `\"ground\"`",
    "(Level 3); absent, empty, unreadable or any other value means concept. The",
    "app never fails to open over a garbage value and never asks twice — an old",
    "workspace opens exactly as before.",
    "",
    "The render map is additive, never exclusive. Every game draws the words,",
    "distances, marks and the shelf; the dynamics game adds the links, loops,",
    "assumptions and the playing set; the ground game adds the pointers. Nothing",
    "is taken away and no game hides another game's records.",
    "",
    "`map/pointers.jsonl` holds the reaches beyond the map. A line is the owner",
    "word (`on`) plus exactly one AUTHORED target form — the JSON key the person",
    "picked at write time, never sniffed from the value:",
    "",
    "- `path` — a path INSIDE this workspace, resolved against the workspace root",
    "  exactly as written. An absolute-looking value is still a `path`.",
    "- `at` — an absolute path on THIS machine (machine-local), stored verbatim.",
    "  It may dangle on another machine; when it does not resolve the window",
    "  answers \"cannot read\". It is never repaired, re-rooted or rewritten.",
    "- `url` — any scheme, stored verbatim. A scheme the system opener cannot",
    "  handle says \"cannot open this scheme\" plainly, never a quiet no-op.",
    "",
    "The form is authored structure: never classify a value into a different",
    "form, never trim, normalize or repair a target string, and never stat it at",
    "the record layer. Several reaches per word are legal; one natural key",
    "(owner + form + value) has one line, and a replace-in-place edit rewrites",
    "that line at its index.",
    "",
    "A mark may also sit on a pointer LINE: `{\"kind\":\"open\",\"on\":\"<word>\",",
    "\"path\": ...}` (or `at`/`url`). Its key is the pointer's own key, so it is",
    "distinct from a mark on the word; it follows an in-place edit to the new key",
    "and dies with its line.",
    "",
    "The window is an open-moment glimpse — reopen to refresh. It is a transient",
    "of the open moment, not a record: nothing about it is written, so reopening",
    "a pointer shows the file as it is now, never a cached earlier read.",
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
    "Machine-written files (`workspace.yml`, `map/model.json`,",
    "`map/distances.jsonl`, `map/marks.jsonl`, `map/links.jsonl`,",
    "`map/loops.jsonl`, `map/assumptions.jsonl`, `map/pointers.jsonl`, and later",
    "the ontology) use one",
    "canonical style: LF newlines, 2-space indent, sorted keys, trailing newline;",
    "JSONL records are one compact JSON object per line. Hand edits are welcome; the",
    "app returns them in that style.",
    "",
  ].join("\n");
}

/** One file a scaffold can write: its absolute path and its canonical bytes. */
export interface ScaffoldFile {
  path: string;
  content: string;
}

/**
 * The files a scaffold offers a folder (ADR-0004): `workspace.yml` and
 * `AGENTS.md`. Pure, so the scaffold's content is asserted without the fs
 * bridge and the write-once rule can be tested directly.
 */
export function workspaceScaffold(
  path: string,
  name: string,
): ScaffoldFile[] {
  return [
    { path: `${path}/workspace.yml`, content: workspaceYml() },
    { path: `${path}/AGENTS.md`, content: agentsMd(name) },
  ];
}

/**
 * The scaffold is WRITE-ONCE (ADR-0004): only files that are not already on
 * disk are written, so an existing workspace keeps its own `workspace.yml`,
 * its own `AGENTS.md` bytes and every later story's orientation text. Pure:
 * the caller supplies the paths that already exist.
 */
export function scaffoldWrites(
  files: readonly ScaffoldFile[],
  existing: ReadonlySet<string>,
): ScaffoldFile[] {
  return files.filter((file) => !existing.has(file.path));
}

/**
 * Scaffold a workspace folder (ADR-0004): `workspace.yml`, `AGENTS.md`,
 * `notes/` (earlier scaffolding, kept) and `map/references/` (Epic 2).
 * Files that already exist are left exactly as they are — the scaffold never
 * rewrites an older workspace's orientation.
 */
export async function scaffoldWorkspace(path: string, name: string): Promise<void> {
  const files = workspaceScaffold(path, name);
  const existing = new Set<string>();
  for (const file of files) {
    if (await pathExists(file.path)) existing.add(file.path);
  }
  for (const file of scaffoldWrites(files, existing)) {
    await writeMachineFile(file.path, file.content);
  }
  await createDirAll(`${path}/notes`);
  await createDirAll(`${path}/map/references`);
}