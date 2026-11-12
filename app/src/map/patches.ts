import { pathExists, removeFile, writeTextFile } from "../lib/fs";
import { slugName } from "../lib/serialize";
import { referencePath, serializeReference, type Reference } from "./refs";
import { loadDistances, saveDistances, type Distance } from "./distances";

/**
 * Atomic patches (ADR-0005, ADR-0007): rename and remove are single, all-or-
 * nothing app operations — a file plus `name` plus every `distances.jsonl`
 * endpoint (rename), or a file plus every touching line (remove). Prose memory
 * is never rewritten (byte-faithful). No other module hand-strings these edits;
 * `distances.ts`/`serialize.ts` own the bytes.
 */

/**
 * Re-write every distance line whose `from` or `to` is `oldSlug` to `newSlug`.
 * The word is left untouched (ADR-0005: a rename rewrites endpoint slugs in
 * place, never the word).
 */
export function rewriteEndpoints(
  distances: readonly Distance[],
  oldSlug: string,
  newSlug: string,
): Distance[] {
  return distances.map((d) => {
    if (d.from !== oldSlug && d.to !== oldSlug) return d;
    return {
      ...d,
      from: d.from === oldSlug ? newSlug : d.from,
      to: d.to === oldSlug ? newSlug : d.to,
    };
  });
}

/** Drop every distance line touching `slug`. */
export function dropTouching(
  distances: readonly Distance[],
  slug: string,
): Distance[] {
  return distances.filter((d) => d.from !== slug && d.to !== slug);
}

/** Pure: mint the first free slug, adding a numeric suffix on collision (ADR-0005 rule 4). */
export function nextSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/** Rename a reference: write the renamed file, rewrite endpoints, drop the old file. */
export async function renameReference(
  workspacePath: string,
  ref: Reference,
  newName: string,
): Promise<Reference> {
  if (ref.slug === null) {
    throw new Error("cannot rename an uncoined reference");
  }
  const oldSlug = ref.slug;
  const newSlug = await uniqueSlugForName(workspacePath, newName, oldSlug);

  // 1. Write the renamed file (prose copied byte-verbatim).
  const renamed: Reference = { ...ref, id: newSlug, slug: newSlug, name: newName };
  await writeTextFile(referencePath(workspacePath, newSlug), serializeReference(renamed));

  // 2. Rewrite every endpoint touching the old slug.
  const { distances, malformed } = await loadDistances(workspacePath);
  await saveDistances(
    workspacePath,
    rewriteEndpoints(distances, oldSlug, newSlug),
    malformed,
  );

  // 3. Drop the old file.
  if (oldSlug !== newSlug) {
    await removeFile(referencePath(workspacePath, oldSlug));
  }

  return renamed;
}

/** Remove a reference: drop every touching line first, then delete the file (no dangling lines). */
export async function removeReference(
  workspacePath: string,
  ref: Reference,
): Promise<void> {
  if (ref.slug === null) return;

  // 1. Drop every line touching the slug (write first: a crash leaves the word,
  //    never a dangling line).
  const { distances, malformed } = await loadDistances(workspacePath);
  await saveDistances(workspacePath, dropTouching(distances, ref.slug), malformed);

  // 2. Delete the file.
  await removeFile(referencePath(workspacePath, ref.slug));
}

/**
 * Mint the first free slug for a rename. The old file is still on disk, so a
 * new name whose slug equals the current slug (e.g. a case-only change) keeps
 * the slug; a true collision with another reference gets a numeric suffix.
 */
async function uniqueSlugForName(
  workspacePath: string,
  name: string,
  currentSlug: string,
): Promise<string> {
  const base = slugName(name);
  if (base === currentSlug) return base;
  let slug = base;
  for (let n = 2; await pathExists(referencePath(workspacePath, slug)); n += 1) {
    slug = `${base}-${n}`;
  }
  return slug;
}