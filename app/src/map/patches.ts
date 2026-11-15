import { pathExists, removeFile, writeTextFile } from "../lib/fs";
import { slugName } from "../lib/serialize";
import { referencePath, serializeReference, type Reference } from "./refs";
import { loadDistances, saveDistances, type Distance } from "./distances";
import {
  dedupeLinks,
  loadLinks,
  saveLinks,
  type Link,
} from "./links";
import {
  dedupe,
  loadModel,
  saveModel,
  type PlayingSet,
} from "./model";
import {
  dedupeMarks,
  loadMarks,
  markTargetKey,
  saveMarks,
  type Mark,
  type MarkTarget,
} from "./marks";
import {
  canonicalPath,
  loadLoops,
  loopSlug,
  saveLoops,
  type Loop,
} from "./loops";
import {
  assumptionKey,
  loadAssumptions,
  saveAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "./assumptions";

/**
 * Atomic patches (ADR-0005, ADR-0007, ADR-0009, ADR-0012, ADR-0013,
 * ADR-0014): rename and remove are single, all-or-nothing app operations — a
 * file plus `name` plus every `distances.jsonl` endpoint, every `links.jsonl`
 * pair, every touching mark, every `loops.jsonl` path slug, every
 * `assumptions.jsonl` target and the playing set's member slug (rename), or a
 * file plus every touching distance, link, mark, loop line, assumption line and
 * membership (remove). Prose memory is never rewritten (byte-faithful). No
 * other module hand-strings these edits; `distances.ts`/`links.ts`/
 * `marks.ts`/`loops.ts`/`assumptions.ts`/`model.ts`/`serialize.ts` own the
 * bytes.
 *
 * Write order (the crash rule): references -> distances -> links -> marks ->
 * loops -> assumptions -> membership -> the old file. Story 4 grows the
 * loop -> assumption steps between loops and membership (the marked seams
 * below say where): a reference rename rewrites word- and link-targeted
 * assumptions, a reference remove drops them (and a loop's own lines when the
 * same batch removes the loop), and a loop rename/remove rewrites or drops
 * `loop` targets.
 *
 * Crash rule: the durable thing is written first. The reference's file is
 * written before the records that name the slug, and those records are
 * rewritten before the old file is dropped / after the word is known to exist,
 * so a crash always leaves something visible (a word, or a stale member name
 * the selector can rewrite) rather than a dangling reference to nothing.
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
 * Re-write every link whose `from` or `to` is `oldSlug` (rename). A link's
 * pair is two endpoint slugs exactly as a distance's is; the sign is authored
 * structure and is never touched (ADR-0014).
 *
 * Collision rule, mirroring the marks: untouched links are emitted first,
 * rewritten ones last, so a hand-edited duplicate loses to the app's rename.
 */
export function rewriteLinkEndpoints(
  links: readonly Link[],
  oldSlug: string,
  newSlug: string,
): Link[] {
  if (oldSlug === newSlug) return [...links];
  const untouched: Link[] = [];
  const rewritten: Link[] = [];
  for (const link of links) {
    if (link.from !== oldSlug && link.to !== oldSlug) {
      untouched.push(link);
      continue;
    }
    rewritten.push({
      ...link,
      from: link.from === oldSlug ? newSlug : link.from,
      to: link.to === oldSlug ? newSlug : link.to,
    });
  }
  return dedupeLinks([...untouched, ...rewritten]);
}

/** Drop every link touching `slug` (remove): nothing dangles. */
export function dropTouchingLinks(
  links: readonly Link[],
  slug: string,
): Link[] {
  return links.filter((link) => link.from !== slug && link.to !== slug);
}

/**
 * Re-write the playing set's member slug (rename, ADR-0013): the set names
 * words by slug like every other record, so a rename follows here too and the
 * canonical sorted order is restored. Renaming a non-member is a no-op.
 */
export function rewriteMembership(
  model: PlayingSet,
  oldSlug: string,
  newSlug: string,
): PlayingSet {
  if (oldSlug === newSlug || !model.words.includes(oldSlug)) return model;
  return {
    ...model,
    words: dedupe(model.words.map((slug) => (slug === oldSlug ? newSlug : slug))),
  };
}

/**
 * Drop the word's membership (remove, ADR-0013): absence is exclusion, so the
 * settle is simply the slug leaving the set — no tombstone, and a malformed
 * `map/model.json` is never touched (the caller skips the write when the file
 * could not be read).
 */
export function dropMembership(model: PlayingSet, slug: string): PlayingSet {
  if (!model.words.includes(slug)) return model;
  return {
    ...model,
    words: dedupe(model.words.filter((word) => word !== slug)),
  };
}

/**
 * Re-write every mark target touching `oldSlug` to `newSlug` (rename): a word
 * mark's `on`, a wire mark's `from`/`to`, and a link mark's wordless pair
 * (ADR-0009, amended). The wire's coined word is left untouched — exactly as a
 * rename leaves a distance-word alone — and a link's sign is never a mark field.
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
    } else if (
      mark.target.type === "link" &&
      (mark.target.from === oldSlug || mark.target.to === oldSlug)
    ) {
      // The wordless pair follows the endpoints exactly as a wire triple does;
      // the link's mark has no sign in its key, so this is the whole rewrite.
      const from = mark.target.from === oldSlug ? newSlug : mark.target.from;
      const to = mark.target.to === oldSlug ? newSlug : mark.target.to;
      rewritten.push({ ...mark, target: { type: "link", from, to } });
    } else {
      untouched.push(mark);
    }
  }
  return dedupeMarks([...untouched, ...rewritten]);
}

/**
 * Drop every mark touching `slug` (remove): a word mark on it, and any wire or
 * link mark with it as an endpoint. Bare spots are untouched — a lack outlives
 * the words around it (ADR-0009).
 */
export function dropMarksTouching(marks: readonly Mark[], slug: string): Mark[] {
  return marks.filter((mark) => {
    if (mark.target.type === "word") return mark.target.slug !== slug;
    if (mark.target.type === "wire") {
      return mark.target.from !== slug && mark.target.to !== slug;
    }
    if (mark.target.type === "link") {
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

/** The natural target of one link, as marks name it (the wordless pair). */
function linkMarkTarget(from: string, to: string): MarkTarget {
  return { type: "link", from, to };
}

/**
 * Removing a link drops the marks on its pair — die-with-target (ADR-0009's
 * amendment). The reverse pair's marks are a different key and stay; a flip
 * needs no step at all, because the key carries no sign (ADR-0014).
 */
export function dropLinkMarks(
  marks: readonly Mark[],
  from: string,
  to: string,
): Mark[] {
  const key = markTargetKey(linkMarkTarget(from, to));
  return marks.filter(
    (mark) => !(mark.target.type === "link" && markTargetKey(mark.target) === key),
  );
}

/**
 * `nextSlug` now lives with the slug rules in `lib/serialize.ts` (the loop
 * record mints its natural key against the file's lines, and it must not import
 * this patch batch, which imports loops). Re-exported here for existing
 * callers; the rule is unchanged (ADR-0005 rule 4).
 */
export { nextSlug } from "../lib/serialize";

/**
 * Re-write every loop path that names `oldSlug` (rename, ADR-0012 decision 6):
 * the slug is replaced in place and the path is rotation-canonicalized again,
 * because the smallest slug may have changed — one canonical line, same index,
 * name and unknown keys untouched. `newSlug` is the caller's resolved slug, so
 * a rename whose name collides (a `-2` suffix, ADR-0005) flows straight into
 * the paths. A path that never mentions the old slug is returned as it was.
 */
export function rewriteLoopPaths(
  loops: readonly Loop[],
  oldSlug: string,
  newSlug: string,
): Loop[] {
  if (oldSlug === newSlug) return [...loops];
  return loops.map((loop) => {
    if (!loop.path.includes(oldSlug)) return loop;
    return {
      ...loop,
      path: canonicalPath(
        loop.path.map((slug) => (slug === oldSlug ? newSlug : slug)),
      ),
    };
  });
}

/**
 * Drop every loop whose path names `slug` (remove): die-with-target, ADR-0012
 * decision 6 — a loop is a path over the map, so a path naming a gone word goes
 * with it rather than dangling. Loops that never mention it are untouched, and
 * removing a LINK never reaches here (a loop survives its links, ADR-0012).
 */
export function dropLoopsTouching(
  loops: readonly Loop[],
  slug: string,
): Loop[] {
  return loops.filter((loop) => !loop.path.includes(slug));
}

/**
 * Re-write a target in one pass, resolving the collisions the rewrite creates.
 * The app's rewrite is the survivor: if a rewritten line lands on a key that an
 * untouched line already holds (a hand-edited orphan on the new target), the
 * untouched line is dropped and the rewritten one keeps its index; if two
 * rewritten lines land on one key, the later line in file order wins. Untouched
 * duplicate keys elsewhere are NEVER collapsed — the read preserves them
 * (ADR-0012 decision 4), and only the keys the app actually rewrote resolve.
 */
function rewriteAssumptionTargetsWhere(
  assumptions: readonly Assumption[],
  retarget: (target: AssumptionTarget) => AssumptionTarget | null,
): Assumption[] {
  const rewrittenKeys = new Map<string, number>();
  const next = assumptions.map((assumption, index) => {
    const target = retarget(assumption.target);
    if (target === null) return assumption;
    const record: Assumption = { ...assumption, target };
    rewrittenKeys.set(assumptionKey(record), index);
    return record;
  });
  if (rewrittenKeys.size === 0) return [...assumptions];
  const drop = new Set<number>();
  next.forEach((assumption, index) => {
    const survivor = rewrittenKeys.get(assumptionKey(assumption));
    if (survivor === undefined) return;
    if (index !== survivor) drop.add(index);
  });
  return next.filter((_, index) => !drop.has(index));
}

/**
 * Re-write every assumption target touching `oldSlug` (reference rename,
 * ADR-0012 decision 6): a word target's `on`, and a link target's wordless
 * pair endpoints. The text and unknown keys are untouched — a rename changes
 * the address, never the claim. `loop` targets name a loop, not a word, so
 * they are the loop's own batch; a bare spot has no endpoint and stays.
 */
export function rewriteAssumptionTargets(
  assumptions: readonly Assumption[],
  oldSlug: string,
  newSlug: string,
): Assumption[] {
  if (oldSlug === newSlug) return [...assumptions];
  return rewriteAssumptionTargetsWhere(assumptions, (target) => {
    if (target.type === "word" && target.slug === oldSlug) {
      return { type: "word", slug: newSlug };
    }
    if (
      target.type === "link" &&
      (target.from === oldSlug || target.to === oldSlug)
    ) {
      return {
        type: "link",
        from: target.from === oldSlug ? newSlug : target.from,
        to: target.to === oldSlug ? newSlug : target.to,
      };
    }
    return null;
  });
}

/**
 * Drop every assumption targeting the removed word or a link touching it
 * (reference remove, die-with-target): the word's lines and the lines on its
 * links go with the word. Bare-spot assumptions outlive the words around them
 * (a spot is its own target), and `loop` targets are the loop's own batch.
 * Line order and every surviving line's bytes are untouched.
 */
export function dropAssumptionsTouching(
  assumptions: readonly Assumption[],
  slug: string,
): Assumption[] {
  return assumptions.filter((assumption) => {
    if (assumption.target.type === "word") {
      return assumption.target.slug !== slug;
    }
    if (assumption.target.type === "link") {
      return assumption.target.from !== slug && assumption.target.to !== slug;
    }
    return true;
  });
}

/**
 * Removing a link drops the assumption lines on its ordered pair — die-with-
 * target. The reverse pair's lines are a different link and stay; a sign flip
 * needs no step at all, because a link's key carries no sign (ADR-0014).
 */
export function dropLinkAssumptions(
  assumptions: readonly Assumption[],
  from: string,
  to: string,
): Assumption[] {
  return assumptions.filter(
    (assumption) =>
      !(
        assumption.target.type === "link" &&
        assumption.target.from === from &&
        assumption.target.to === to
      ),
  );
}

/**
 * Re-write every assumption whose target is the renamed loop's slug (loop
 * rename, ADR-0012 decisions 3 and 6): one in-place rewrite of the claims'
 * address, text and unknown keys untouched, order kept. `newLoopSlug` is the
 * caller's RESOLVED slug, so the collision suffix a rename mints flows straight
 * into the targets. Word, link and spot targets are untouched.
 */
export function rewriteAssumptionLoopTargets(
  assumptions: readonly Assumption[],
  oldLoopSlug: string,
  newLoopSlug: string,
): Assumption[] {
  if (oldLoopSlug === newLoopSlug) return [...assumptions];
  return rewriteAssumptionTargetsWhere(assumptions, (target) =>
    target.type === "loop" && target.slug === oldLoopSlug
      ? { type: "loop", slug: newLoopSlug }
      : null,
  );
}

/**
 * Drop every assumption whose target is a removed loop's slug — die-with-
 * target, ADR-0012 decision 6: a claim about a loop goes with the loop. One
 * slug or a batch (a reference remove can take several loops with it); every
 * other target kind is untouched.
 */
export function dropLoopAssumptions(
  assumptions: readonly Assumption[],
  loopSlugs: string | readonly string[],
): Assumption[] {
  const dropped = new Set(
    typeof loopSlugs === "string" ? [loopSlugs] : loopSlugs,
  );
  if (dropped.size === 0) return [...assumptions];
  return assumptions.filter(
    (assumption) =>
      !(assumption.target.type === "loop" && dropped.has(assumption.target.slug)),
  );
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

  // 2a. Follow the rename in the signed links in the same batch
  //     (ADR-0012/0014). A link's pair is two endpoint slugs like a distance's;
  //     the sign is authored structure and is left exactly as drawn.
  const parsedLinks = await loadLinks(workspacePath);
  await saveLinks(
    workspacePath,
    rewriteLinkEndpoints(parsedLinks.links, oldSlug, newSlug),
    parsedLinks.malformed,
  );

  // 2b. Follow the rename in the marks in the same batch (ADR-0009). A link
  //     mark's wordless pair is rewritten here too, alongside its link line.
  const parsedMarks = await loadMarks(workspacePath);
  await saveMarks(
    workspacePath,
    rewriteMarkEndpoints(parsedMarks.marks, oldSlug, newSlug),
    parsedMarks.malformed,
  );

  // 2c. Follow the rename in the loops' paths in the same batch (ADR-0012
  //     decision 6). The line is re-canonicalized: the smallest slug may have
  //     changed, so the rotation is recomputed. Unknown keys and the name ride
  //     along; a hand-edited unclosed path is left unclosed (never repaired).
  const parsedLoops = await loadLoops(workspacePath);
  await saveLoops(
    workspacePath,
    rewriteLoopPaths(parsedLoops.loops, oldSlug, newSlug),
    parsedLoops.malformed,
  );

  // 2d. Follow the rename in the assumptions in this same batch (ADR-0012
  //     decision 6): a word-target's `on` and a link-target's wordless pair are
  //     rewritten, text and unknown keys untouched. `loop` targets are the
  //     loop's own rename step (the loop's slug did not change here), and a
  //     bare spot has no endpoint to follow.
  const parsedAssumptions = await loadAssumptions(workspacePath);
  await saveAssumptions(
    workspacePath,
    rewriteAssumptionTargets(parsedAssumptions.assumptions, oldSlug, newSlug),
    parsedAssumptions.malformed,
  );

  // 2e. Follow the rename in the playing set (ADR-0013). The renamed file —
  //     the durable thing — is already on disk, so a crash here leaves a stale
  //     member name in map/model.json (visible, fixable by re-running the
  //     selector), never a member that names no word. An unreadable model file
  //     is skipped and keeps its bytes exactly.
  const parsedModel = await loadModel(workspacePath);
  if (parsedModel.model) {
    await saveModel(
      workspacePath,
      rewriteMembership(parsedModel.model, oldSlug, newSlug),
    );
  }

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
  const slug = ref.slug;

  // 1. Drop every line and mark touching the slug (write first: a crash leaves
  //    the word, never a dangling line or mark).
  const { distances, malformed } = await loadDistances(workspacePath);
  await saveDistances(workspacePath, dropTouching(distances, slug), malformed);

  // 1a. Drop the signed links touching the word (ADR-0012/0014) — before the
  //     marks, so no mark is ever left naming a pair the same batch removed.
  const parsedLinks = await loadLinks(workspacePath);
  await saveLinks(
    workspacePath,
    dropTouchingLinks(parsedLinks.links, slug),
    parsedLinks.malformed,
  );

  const parsedMarks = await loadMarks(workspacePath);
  await saveMarks(
    workspacePath,
    dropMarksTouching(parsedMarks.marks, slug),
    parsedMarks.malformed,
  );

  // 1b. Drop the loop lines whose path names the word — die-with-target
  //     (ADR-0012 decision 6) — before the file goes, so no path is ever left
  //     naming a word the same batch removed. A loop is a path over the map, not
  //     an annotation on the word, so only the loops that name it go. Remember
  //     their slugs: their assumption lines die in the next step, so no claim is
  //     left about a loop this batch removed.
  const parsedLoops = await loadLoops(workspacePath);
  const deadLoopSlugs = parsedLoops.loops
    .filter((loop) => loop.path.includes(slug))
    .map((loop) => loopSlug(loop.name));
  await saveLoops(
    workspacePath,
    dropLoopsTouching(parsedLoops.loops, slug),
    parsedLoops.malformed,
  );

  // 1b2. Drop the assumption lines targeting the word, its links, or a loop
  //      that went with it — die-with-target (ADR-0012 decision 6). Bare-spot
  //      assumptions stay: a spot is its own target. Written before the file
  //      goes, so no line is ever left naming a word the same batch removed.
  const parsedAssumptions = await loadAssumptions(workspacePath);
  await saveAssumptions(
    workspacePath,
    dropLoopAssumptions(
      dropAssumptionsTouching(parsedAssumptions.assumptions, slug),
      deadLoopSlugs,
    ),
    parsedAssumptions.malformed,
  );

  // 1c. Drop the word's membership before the file goes (ADR-0013). Same
  //     crash rule: a crash after this write leaves the word on the map, not
  //     in play — visible, and one accept away from being put back.
  const parsedModel = await loadModel(workspacePath);
  if (parsedModel.model) {
    await saveModel(workspacePath, dropMembership(parsedModel.model, slug));
  }

  // 2. Delete the file.
  await removeFile(referencePath(workspacePath, slug));
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