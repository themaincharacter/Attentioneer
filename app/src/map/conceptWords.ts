import { listDir, readTextFile } from "../lib/fs";
import { isMentionSlug } from "./mentions";
import { parseReference, referencePath, referencesDir } from "./refs";

/**
 * Story 16.7 — THE ONE CROSS-MAP READ in the app: a ground note's word mention
 * shows a CONCEPT map reference's name and memory, read-only.
 *
 * WHY HERE AND ONLY HERE (the amended ADR-0032: "content may render on two maps
 * at once"): a word mention is how a language game's vocabulary reaches the
 * ground map without copying its content. That is a READ across the maps, and
 * the app deliberately has no shared rendering pass — so the read is confined
 * to this module and named where a person can find it. Review boundary: nothing
 * else in the app may read `map/references/` for the ground layer.
 *
 *   map/references/<slug>.md   the concept reference: flat YAML frontmatter
 *                              (`name`/`x`/`y`) and the memory as prose after it
 *
 * READ-ONLY BY CONSTRUCTION: this module imports the reference FILE's grammar
 * (`parseReference`) and two read bridges, and no writer at all. It never
 * creates, renames, merges, moves or rewrites a concept reference, and it never
 * writes anything into a note or a reading. A missing file is `null` — the
 * mention then dangles, muted, in the person's own text (mentions.ts's rule),
 * and nothing is reported, repaired or deleted.
 *
 * The reference's NAME comes from its frontmatter; a file with no name (a hand
 * written one) is displayed by its SLUG rather than as a blank chip. A name is
 * display text here: the slug stays the identity, so editing a label in a note
 * renames nothing in either map.
 *
 * PROVISIONAL: the slug-or-name fallback, and the picker's alphabetical order.
 * The concept reference's own shape is ADR-0005's (not this story's).
 */

/** One concept word as the ground map may show it: name and memory, no more. */
export interface ConceptWord {
  /** The reference's slug — the identity a `word://` mention names. */
  slug: string;
  /** The person's coined name, or the slug when the file carries none. */
  name: string;
  /** The memory (the file's prose), byte-exact. */
  memory: string;
}

/** The two READ bridges this helper needs; a test passes node's fs, a fake. */
export interface ConceptWordIo {
  readTextFile(path: string): Promise<string | null>;
  listDir(path: string): Promise<string[]>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const CONCEPT_WORD_IO: ConceptWordIo = { readTextFile, listDir };

/** One concept reference file, or null when it is not there / not admissible. */
function toConceptWord(slug: string, text: string | null): ConceptWord | null {
  if (text === null) return null;
  const reference = parseReference(slug, slug, text);
  const name = reference.name.trim() === "" ? slug : reference.name;
  return { slug, name, memory: reference.body };
}

/** The rule a mention follows to name a concept file: no path separator. */
function admissible(name: string): boolean {
  return name.endsWith(".md") && name.length > ".md".length;
}

/**
 * Read ONE concept word by slug, or null. A slug a mention could not name (a
 * separator, an empty tail) answers null without touching the disk, so a
 * hand-written mention can never be steered at another file.
 */
export async function loadConceptWord(
  workspacePath: string,
  slug: string,
  io: ConceptWordIo = CONCEPT_WORD_IO,
): Promise<ConceptWord | null> {
  if (!isMentionSlug(slug)) return null;
  return toConceptWord(
    slug,
    await io.readTextFile(referencePath(workspacePath, slug)),
  );
}

/**
 * Read the concept map's whole word index (the picker's list and the dangling
 * check). ONE listing, then one read per `.md` file — the reference format's
 * own budget, since a name lives in each file's frontmatter. A missing folder
 * is an empty list, never an error; unreadable files are simply absent.
 *
 * PROVISIONAL: the sort (name, then slug) is the picker's order, not a rule.
 */
export async function listConceptWords(
  workspacePath: string,
  io: ConceptWordIo = CONCEPT_WORD_IO,
): Promise<ConceptWord[]> {
  const names = await io.listDir(referencesDir(workspacePath));
  const slugs = names
    .filter(admissible)
    .map((name) => name.slice(0, -".md".length))
    .filter(isMentionSlug);
  const words = await Promise.all(
    slugs.map(async (slug) =>
      toConceptWord(slug, await io.readTextFile(referencePath(workspacePath, slug))),
    ),
  );
  return words
    .filter((word): word is ConceptWord => word !== null)
    .sort((a, b) =>
      a.name === b.name ? (a.slug < b.slug ? -1 : 1) : a.name < b.name ? -1 : 1,
    );
}
