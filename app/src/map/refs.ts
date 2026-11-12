import { listDir, pathExists, readTextFile, writeTextFile } from "../lib/fs";
import { canonicalYaml, parseYamlFields, slugName } from "../lib/serialize";

/**
 * References (ADR-0005): one Markdown file each at `map/references/<slug>.md`.
 * Identity is the name-derived slug — a reference *is* its file. The flat YAML
 * frontmatter carries `name`/`x`/`y`; the optional memory (prose) follows
 * byte-verbatim — never normalized on read or write.
 */

export interface Reference {
  /** UI key: the slug once written, otherwise a draft id. */
  id: string;
  /** File slug (`map/references/<slug>.md`); null until first coined. */
  slug: string | null;
  /** The user-coined name — the reference's identity. */
  name: string;
  /** Canvas position of the word's top-left corner. */
  x: number;
  y: number;
  /** The optional memory, byte-exact. */
  body: string;
  /** Frontmatter keys the app doesn't own — preserved on rewrite. */
  extra: Record<string, string | number>;
}

export function referencesDir(workspacePath: string): string {
  return `${workspacePath}/map/references`;
}

export function referencePath(workspacePath: string, slug: string): string {
  return `${referencesDir(workspacePath)}/${slug}.md`;
}

export function serializeReference(ref: Reference): string {
  // App-owned keys win; unknown keys ride along, so hand edits survive.
  const frontmatter = canonicalYaml({
    ...ref.extra,
    name: ref.name,
    x: ref.x,
    y: ref.y,
  });
  return `---\n${frontmatter}---\n${ref.body}`;
}

export function parseReference(id: string, slug: string | null, text: string): Reference {
  // Tolerant on read (BOM/CRLF from a hand edit), canonical on write; the
  // memory body is captured verbatim.
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) {
    return { id, slug, name: "", x: 0, y: 0, body: text, extra: {} };
  }
  const { name, x, y, ...extra } = parseYamlFields(match[1]);
  const num = (value: string | number | undefined): number => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    id,
    slug,
    name: name === undefined ? "" : String(name),
    x: num(x),
    y: num(y),
    body: match[2],
    extra,
  };
}

export async function loadReferences(workspacePath: string): Promise<Reference[]> {
  const names = await listDir(referencesDir(workspacePath));
  const refs: Reference[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const slug = name.slice(0, -3);
    const text = await readTextFile(referencePath(workspacePath, slug));
    if (text === null) continue;
    refs.push(parseReference(slug, slug, text));
  }
  return refs;
}

/** Mint the first free slug for a coined name (collisions get a suffix). */
async function uniqueSlug(workspacePath: string, name: string): Promise<string> {
  const base = slugName(name);
  let slug = base;
  for (let n = 2; await pathExists(referencePath(workspacePath, slug)); n += 1) {
    slug = `${base}-${n}`;
  }
  return slug;
}

/** Write the reference's file, assigning its slug on first coin. */
export async function saveReference(
  workspacePath: string,
  ref: Reference,
): Promise<Reference> {
  const slug = ref.slug ?? (await uniqueSlug(workspacePath, ref.name));
  await writeTextFile(referencePath(workspacePath, slug), serializeReference(ref));
  return { ...ref, id: slug, slug };
}