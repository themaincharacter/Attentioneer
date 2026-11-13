import { pathExists, removeFile, writeTextFile } from "../lib/fs";
import { slugName } from "../lib/serialize";
import { referencePath, serializeReference, type Reference } from "./refs";
import { loadDistances, saveDistances, type Distance } from "./distances";
import {
  dedupeMarks,
  loadMarks,
  markTargetKey,
  saveMarks,
  type Mark,
  type MarkTarget,
} from "./marks";

/**
 * Atomic patches (ADR-0005, ADR-0007, ADR-0009): rename and remove are single,
 * all-or-nothing app operations — a file plus `name` plus every
 * `distances.jsonl` endpoint and every touching mark (rename), or a file plus
 * every touching line and mark (remove). Prose memory is never rewritten
 * (byte-faithful). No other module hand-strings these edits;
 * `distances.ts`/`marks.ts`/`serialize.ts` own the bytes.
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

/**
 * Re-write every mark target touching `oldSlug` to `newSlug` (rename): a word
 * mark's `on`, and a wire mark's `from`/`to` (ADR-0009). The wire's coined word
 * is left untouched — exactly as a rename leaves a distance-word alone.
 *
 * Collision rule: if an orphan mark already sits on the new slug, the app's
 * renamed mark wins and the stale one is dropped in the same patch (untouched
 * marks are emitted first, rewritten marks last, and dedupe keeps the last).
 */
export function rewriteMarkEndpoints(
  marks: readonly Mark[],
  oldSlug: string,
  newSlug: string,
): Mark[] {
  if (oldSlug === newSlug) return [...marks];
  const untouched: Mark[] = [];
  const rewritten: Mark[] = [];
  for (const mark of marks) {
    if (mark.target.type === "word" && mark.target.slug === oldSlug) {
      rewritten.push({ ...mark, target: { type: "word", slug: newSlug } });
    } else if (
      mark.target.type === "wire" &&
      (mark.target.from === oldSlug || mark.target.to === oldSlug)
    ) {
      const from = mark.target.from === oldSlug ? newSlug : mark.target.from;
      const to = mark.target.to === oldSlug ? newSlug : mark.target.to;
      rewritten.push({ ...mark, target: { type: "wire", from, to, word: mark.target.word } });
    } else {
      untouched.push(mark);
    }
  }
  return dedupeMarks([...untouched, ...rewritten]);
}

/**
 * Drop every mark touching `slug` (remove): a word mark on it, and any wire
 * mark with it as an endpoint. Bare spots are untouched — a lack outlives the
 * words around it (ADR-0009).
 */
export function dropMarksTouching(marks: readonly Mark[], slug: string): Mark[] {
  return marks.filter((mark) => {
    if (mark.target.type === "word") return mark.target.slug !== slug;
    if (mark.target.type === "wire") {
      return mark.target.from !== slug && mark.target.to !== slug;
    }
    return true;
  });
}

/** The natural target of one wire, as marks name it. */
function wireTarget(from: string, to: string, word: string): MarkTarget {
  return { type: "wire", from, to, word };
}

/**
 * Re-coin moves a wire mark to the relation's new word (ADR-0009). When the
 * new key already existed, its distance line dies in the same patch, so the
 * colliding line's mark is dropped too; the re-coined line's mark is the
 * pinned survivor. With a free new key, an existing mark that merely names it
 * (an orphan) is outranked by the app's move and dropped by dedupe.
 */
export function recoinWireMarks(
  marks: readonly Mark[],
  from: string,
  to: string,
  oldWord: string,
  newWord: string,
  collided: boolean,
): Mark[] {
  if (oldWord === newWord) return [...marks];
  const oldKey = markTargetKey(wireTarget(from, to, oldWord));
  const newKey = markTargetKey(wireTarget(from, to, newWord));
  const moved = marks
    .filter((mark) => mark.target.type === "wire" && markTargetKey(mark.target) === oldKey)
    .map((mark) => ({ ...mark, target: wireTarget(from, to, newWord) }));
  const remaining = marks.filter((mark) => {
    if (mark.target.type !== "wire") return true;
    const key = markTargetKey(mark.target);
    if (key === oldKey) return false;
    if (collided && key === newKey) return false;
    return true;
  });
  return dedupeMarks([...remaining, ...moved]);
}

/** Removing a distance drops the marks targeting that line (ADR-0009). */
export function dropWireMarks(
  marks: readonly Mark[],
  from: string,
  to: string,
  word: string,
): Mark[] {
  const key = markTargetKey(wireTarget(from, to, word));
  return marks.filter(
    (mark) => !(mark.target.type === "wire" && markTargetKey(mark.target) === key),
  );
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

  // 2b. Follow the rename in the marks in the same batch (ADR-0009).
  const parsedMarks = await loadMarks(workspacePath);
  await saveMarks(
    workspacePath,
    rewriteMarkEndpoints(parsedMarks.marks, oldSlug, newSlug),
    parsedMarks.malformed,
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

  // 1. Drop every line and mark touching the slug (write first: a crash leaves
  //    the word, never a dangling line or mark).
  const { distances, malformed } = await loadDistances(workspacePath);
  await saveDistances(workspacePath, dropTouching(distances, ref.slug), malformed);

  const parsedMarks = await loadMarks(workspacePath);
  await saveMarks(
    workspacePath,
    dropMarksTouching(parsedMarks.marks, ref.slug),
    parsedMarks.malformed,
  );

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