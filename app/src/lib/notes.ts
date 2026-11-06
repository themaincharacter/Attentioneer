import { listDir, pathExists, readTextFile, writeTextFile } from "./fs";
import { canonicalYaml, parseYamlFields } from "./serialize";

/**
 * Working notes (ADR-0004): one Markdown file each at `notes/<slug>.md` —
 * app-written minimal frontmatter (title, x, y) plus prose preserved
 * verbatim. Prose is never normalized: the body round-trips byte-for-byte
 * (story 4 hardens this). The frontmatter is machine-written and canonical
 * via serialize.ts.
 *
 * Provisional: the frontmatter schema and slug rules are not settled by any ADR.
 */

export interface Note {
  /** UI key: the slug once written, otherwise a draft id. */
  id: string;
  /** File slug (`notes/<slug>.md`); null until first persisted. */
  slug: string | null;
  title: string;
  /** Canvas position of the card's top-left corner. */
  x: number;
  y: number;
  /** Prose, byte-exact: never normalized on read or write. */
  body: string;
  /** Frontmatter keys the app doesn't own — preserved on rewrite. */
  extra: Record<string, string | number>;
}

export function notesDir(workspacePath: string): string {
  return `${workspacePath}/notes`;
}

export function notePath(workspacePath: string, slug: string): string {
  return `${notesDir(workspacePath)}/${slug}.md`;
}

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

export function serializeNote(note: Note): string {
  // App-owned keys win; unknown keys ride along, so hand edits survive.
  const frontmatter = canonicalYaml({
    ...note.extra,
    title: note.title,
    x: note.x,
    y: note.y,
  });
  return `---\n${frontmatter}---\n${note.body}`;
}

export function parseNote(id: string, slug: string | null, text: string): Note {
  // Tolerant on read (a BOM or CRLF arrives from hand edits), canonical on
  // write. The body is captured verbatim: prose is never normalized.
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text);
  if (!match) {
    return { id, slug, title: "", x: 0, y: 0, body: text, extra: {} };
  }
  const { title, x, y, ...extra } = parseYamlFields(match[1]);
  const num = (value: string | number | undefined): number => {
    const n = typeof value === "number" ? value : Number(value);
    return Number.isFinite(n) ? n : 0;
  };
  return {
    id,
    slug,
    title: title === undefined ? "" : String(title),
    x: num(x),
    y: num(y),
    body: match[2],
    extra,
  };
}

export async function loadNotes(workspacePath: string): Promise<Note[]> {
  const names = await listDir(notesDir(workspacePath));
  const notes: Note[] = [];
  for (const name of names) {
    if (!name.endsWith(".md")) continue;
    const slug = name.slice(0, -3);
    const text = await readTextFile(notePath(workspacePath, slug));
    if (text === null) continue;
    notes.push(parseNote(slug, slug, text));
  }
  return notes;
}

async function uniqueSlug(workspacePath: string, title: string): Promise<string> {
  const base = slugify(title);
  let slug = base;
  for (let n = 2; await pathExists(notePath(workspacePath, slug)); n += 1) {
    slug = `${base}-${n}`;
  }
  return slug;
}

/** Write the note's file, assigning its slug on first write. */
export async function saveNote(workspacePath: string, note: Note): Promise<Note> {
  const slug = note.slug ?? (await uniqueSlug(workspacePath, note.title));
  await writeTextFile(notePath(workspacePath, slug), serializeNote(note));
  return { ...note, id: slug, slug };
}
