import { pathExists, readTextFile, removeFile, writeTextFile } from "../lib/fs";
import { slugName } from "../lib/serialize";
import { mapDir, scenarioDir } from "./records";
import {
  dropPinLinkTargets,
  dropPinLoopTargets,
  dropPinWordTargets,
  parsePins,
  pinIsOnLink,
  pinTargetsLoop,
  pinTouchesWord,
  pinsPath,
  rewritePinLoopTargets,
  rewritePinWordTargets,
  serializePins,
} from "../scenarios/pins";
import { listScenarios } from "../scenarios/branch";
import { referencePath, serializeReference, type Reference } from "./refs";
import { loadDistances, saveDistances, type Distance } from "./distances";
import {
  dedupeLinks,
  linksPath,
  loadLinks,
  parseLinks,
  saveLinks,
  serializeLinks,
  type Link,
} from "./links";
import {
  dedupe,
  loadModel,
  modelPath,
  parseModel,
  saveModel,
  serializeModel,
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
import {
  loadQuantities,
  parseQuantities,
  quantitiesPath,
  quantityKey,
  quantityWords,
  saveQuantities,
  serializeQuantities,
  type Quantity,
  type QuantityTarget,
} from "./quantities";
import {
  loadPointers,
  pointerKeyOf,
  savePointers,
  type Pointer,
} from "./pointers";

/**
 * Atomic patches (ADR-0005, ADR-0007, ADR-0009, ADR-0012, ADR-0013,
 * ADR-0014): rename and remove are single, all-or-nothing app operations — a
 * file plus `name` plus every `distances.jsonl` endpoint, every `links.jsonl`
 * pair, every touching mark, every `loops.jsonl` path slug, every
 * `assumptions.jsonl` target, every `quantities.jsonl` word end and the
 * playing set's member slug (rename), or a file plus every touching distance,
 * link, mark, loop line, assumption line, quantity line and membership
 * (remove). Prose memory is never rewritten (byte-faithful). No other module
 * hand-strings these edits; `distances.ts`/`links.ts`/`marks.ts`/`loops.ts`/
 * `assumptions.ts`/`quantities.ts`/`model.ts`/`serialize.ts` own the bytes.
 *
 * Write order (the crash rule): references -> distances -> links -> marks ->
 * loops -> assumptions -> quantities -> pointers -> pointer-marks -> membership
 * -> every scenario folder -> the old file.
 * Epic 4 story 4 grew the loop -> assumption steps between loops and
 * membership; Epic 5 story 1 grows the pointer -> pointer-marks steps between
 * assumptions and membership: the reach lines are written BEFORE their marks
 * (a crash must never leave an app-authored dangling mark), and the
 * pointer-key marks (ADR-0009's tightened second amendment) follow their
 * lines in the same batch. Epic 8 story 1 slots the quantities step AFTER
 * assumptions and BEFORE pointers (the family position): a quantity line's
 * `on`/`from`/`to` follows its word, and the number the person authored —
 * the amount and its unknown keys — is never rewritten. The run before this
 * story read loops -> assumptions -> pointers -> pointer-marks -> membership -> the old file.
 * Epic 8 story 2 slots the BRANCH step after membership and before the old
 * file (ADR-0021 decision 3): every branch folder's playing set, links,
 * quantities and pins follow a rename, and a remove's touching lines and pins
 * die there too. The fan-out is INSIDE the batch and before the word's own
 * file falls last, so a crash mid-fan-out can leave a branch at the previous
 * address (a word whose file still exists) but never one naming a word that is
 * gone.
 * A reference rename rewrites word- and link-targeted assumptions and the
 * pointers' `on`; a reference remove drops them (and a loop's own lines when
 * the same batch removes the loop), and a loop rename/remove rewrites or drops
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
    // Pointer-key marks are the POINTER batch's, written after the pointer
    // lines themselves (see `dropPointerMarksTouching`): the ordering rule
    // "pointer lines before their marks" is kept even on a remove.
    return true;
  });
}

/**
 * Re-write a pointer in one pass, resolving the collisions the rewrite
 * creates. The app's rewrite is the survivor: if a rewritten line lands on a
 * key that an untouched line already holds (a hand-edited duplicate on the new
 * owner), the untouched line is dropped and the rewritten one keeps its index;
 * if two rewritten lines land on one key, the later line in file order wins.
 * Untouched duplicate keys elsewhere are NEVER collapsed — the read preserves
 * them, and only the keys the app actually rewrote resolve.
 */
function rewritePointersWhere(
  pointers: readonly Pointer[],
  retarget: (pointer: Pointer) => Pointer | null,
): Pointer[] {
  const rewrittenKeys = new Map<string, number>();
  const next = pointers.map((pointer, index) => {
    const rewritten = retarget(pointer);
    if (rewritten === null) return pointer;
    rewrittenKeys.set(pointerKeyOf(rewritten), index);
    return rewritten;
  });
  if (rewrittenKeys.size === 0) return [...pointers];
  const drop = new Set<number>();
  next.forEach((pointer, index) => {
    const survivor = rewrittenKeys.get(pointerKeyOf(pointer));
    if (survivor === undefined) return;
    if (index !== survivor) drop.add(index);
  });
  return next.filter((_, index) => !drop.has(index));
}

/**
 * Re-write every pointer's `on` to `newSlug` (reference rename, ADR-0017):
 * the reach follows its word. The target strings are stored verbatim and are
 * NEVER rewritten — a path that spells the old slug in prose stays exactly as
 * written (the software never interprets a target). The form is untouched.
 */
export function rewritePointerOwners(
  pointers: readonly Pointer[],
  oldSlug: string,
  newSlug: string,
): Pointer[] {
  if (oldSlug === newSlug) return [...pointers];
  return rewritePointersWhere(pointers, (pointer) =>
    pointer.on === oldSlug ? { ...pointer, on: newSlug } : null,
  );
}

/**
 * Drop every pointer whose owner is `slug` (reference remove): die-with-
 * target (ADR-0017). The target strings and every other pointer line's bytes
 * are untouched.
 */
export function dropPointersTouching(
  pointers: readonly Pointer[],
  slug: string,
): Pointer[] {
  return pointers.filter((pointer) => pointer.on !== slug);
}

/**
 * Re-write the `on` of every POINTER-KEY mark touching `oldSlug` (rename,
 * ADR-0009's tightened second amendment). A mark's target copies the pointer's
 * key fields, so it must follow its line in the same batch — after the pointer
 * lines are written. Collision rule: untouched marks are emitted first,
 * rewritten ones last, so the app's rename beats a hand-edited duplicate.
 */
export function rewritePointerMarkOwners(
  marks: readonly Mark[],
  oldSlug: string,
  newSlug: string,
): Mark[] {
  if (oldSlug === newSlug) return [...marks];
  const untouched: Mark[] = [];
  const rewritten: Mark[] = [];
  for (const mark of marks) {
    if (mark.target.type === "pointer" && mark.target.on === oldSlug) {
      rewritten.push({ ...mark, target: { ...mark.target, on: newSlug } });
    } else {
      untouched.push(mark);
    }
  }
  return dedupeMarks([...untouched, ...rewritten]);
}

/**
 * Drop every pointer-key mark whose line is gone (reference remove): die-with-
 * target, ADR-0009's tightened amendment. Written AFTER the pointer lines in
 * the batch, so a pointer line is always written before its mark.
 */
export function dropPointerMarksTouching(
  marks: readonly Mark[],
  slug: string,
): Mark[] {
  return marks.filter(
    (mark) => !(mark.target.type === "pointer" && mark.target.on === slug),
  );
}

/** Drop the mark(s) on one pointer line, used when the line itself goes. */
export function dropPointerMarksAt(
  marks: readonly Mark[],
  pointer: Pointer,
): Mark[] {
  const key = pointerKeyOf(pointer);
  return marks.filter(
    (mark) => !(mark.target.type === "pointer" && pointerKeyOf(mark.target) === key),
  );
}

/**
 * Carry a pointer's mark(s) to the edited line's new key (the replace-in-
 * place edit, ADR-0009's tightened amendment): one quiet move in the same
 * batch, after the pointer line is written. The app's move is the survivor if
 * the new key already carried a mark (a hand-edited duplicate). With no mark
 * on the old key this is a no-op and returns the same list, so the caller can
 * skip the write.
 */
export function retargetPointerMarks(
  marks: readonly Mark[],
  source: Pointer,
  target: Pointer,
): readonly Mark[] {
  const sourceKey = pointerKeyOf(source);
  const targetKey = pointerKeyOf(target);
  if (sourceKey === targetKey) return marks;
  const moved = marks
    .filter(
      (mark) => mark.target.type === "pointer" && pointerKeyOf(mark.target) === sourceKey,
    )
    .map((mark) => ({
      ...mark,
      target: {
        type: "pointer" as const,
        on: target.on,
        form: target.form,
        value: target.value,
      },
    }));
  if (moved.length === 0) return marks;
  const remaining = marks.filter(
    (mark) =>
      mark.target.type !== "pointer" ||
      (pointerKeyOf(mark.target) !== sourceKey &&
        pointerKeyOf(mark.target) !== targetKey),
  );
  return dedupeMarks([...remaining, ...moved]);
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

/**
 * Re-write a quantity target in one pass, resolving the collisions the rewrite
 * creates. The app's rewrite is the survivor: if a rewritten line lands on a
 * key that an untouched line already holds (a hand-edited duplicate), the
 * untouched line is dropped and the rewritten one keeps its index; if two
 * rewritten lines land on one key, the later line in file order wins.
 * Untouched duplicate keys elsewhere are NEVER collapsed — the read preserves
 * them, and only the keys the app actually rewrote resolve. The amount and the
 * unknown keys ride along untouched: a rename changes the address, never the
 * number.
 */
function rewriteQuantitiesWhere(
  quantities: readonly Quantity[],
  retarget: (target: QuantityTarget) => QuantityTarget | null,
): Quantity[] {
  const rewrittenKeys = new Map<string, number>();
  const next = quantities.map((quantity, index) => {
    const target = retarget(quantity);
    if (target === null) return quantity;
    const record: Quantity =
      target.type === "stock"
        ? { ...quantity, type: "stock", on: target.on }
        : { ...quantity, type: "flow", from: target.from, to: target.to };
    rewrittenKeys.set(quantityKey(record), index);
    return record;
  });
  if (rewrittenKeys.size === 0) return [...quantities];
  const drop = new Set<number>();
  next.forEach((quantity, index) => {
    const survivor = rewrittenKeys.get(quantityKey(quantity));
    if (survivor === undefined) return;
    if (index !== survivor) drop.add(index);
  });
  return next.filter((_, index) => !drop.has(index));
}

/**
 * Re-write every quantity line touching `oldSlug` (reference rename,
 * ADR-0020 decision 3): a stock line's `on` and a flow line's `from`/`to`.
 * The amount and unknown keys are untouched; line order is kept, and a
 * collision on the new key resolves to the app's rewritten line (the
 * assumptions rule). Quantities never join or scope — this only follows the
 * address.
 */
export function rewriteQuantityEndpoints(
  quantities: readonly Quantity[],
  oldSlug: string,
  newSlug: string,
): Quantity[] {
  if (oldSlug === newSlug) return [...quantities];
  return rewriteQuantitiesWhere(quantities, (target) => {
    if (target.type === "stock" && target.on === oldSlug) {
      return { type: "stock", on: newSlug };
    }
    if (
      target.type === "flow" &&
      (target.from === oldSlug || target.to === oldSlug)
    ) {
      return {
        type: "flow",
        from: target.from === oldSlug ? newSlug : target.from,
        to: target.to === oldSlug ? newSlug : target.to,
      };
    }
    return null;
  });
}

/**
 * Drop every quantity line touching the removed word (reference remove,
 * ADR-0020 decision 3): a stock line on it, and any flow line with it as an
 * end — die-with-target, so nothing dangles. Line order and every surviving
 * line's bytes are untouched.
 */
export function dropQuantitiesTouching(
  quantities: readonly Quantity[],
  slug: string,
): Quantity[] {
  return quantities.filter((quantity) =>
    quantity.type === "stock"
      ? quantity.on !== slug
      : quantity.from !== slug && quantity.to !== slug,
  );
}

/* ------------------------------------------------------------------------- *
 * Epic 8 story 2: the branch step — every scenario folder (ADR-0021 decision 3).
 * ------------------------------------------------------------------------- */

/**
 * One branch folder's four files, as the bytes found on disk. A `null` is an
 * ABSENT file (a branch made from a model with no accepted set has no
 * `model.json`; a branch made before this story has no pins file), never an
 * empty one: the steps below keep "absent" absent and never invent a file.
 */
export interface ScenarioFolderBytes {
  /** `model.json`'s bytes, or null. */
  model: string | null;
  /** `links.jsonl`'s bytes, or null. */
  links: string | null;
  /** `quantities.jsonl`'s bytes, or null. */
  quantities: string | null;
  /** `assumption-pins.jsonl`'s bytes, or null. */
  pins: string | null;
}

/**
 * One record's step, uniformly: a missing file stays missing; a file nothing
 * touches is returned BYTE-FOR-BYTE (a branch's hand-written bytes are never
 * canonicalized by a rename that does not name it); a file the app cannot read
 * is preserved exactly (unreadable bytes are content, and the committed batch
 * has the same posture); and a touched file is re-serialized canonically with
 * its own malformed lines riding along, exactly as the committed model's
 * records are.
 */
function stepModelBytes(
  text: string | null,
  touches: (model: PlayingSet) => boolean,
  next: (model: PlayingSet) => PlayingSet,
): string | null {
  if (text === null) return text;
  const parsed = parseModel(text);
  if (parsed.model === null || !touches(parsed.model)) return text;
  const rewritten = next(parsed.model);
  if (rewritten === parsed.model) return text;
  return serializeModel(rewritten, null);
}

function stepLinkBytes(
  text: string | null,
  touches: (links: readonly Link[]) => boolean,
  next: (links: readonly Link[]) => Link[],
): string | null {
  if (text === null) return text;
  const parsed = parseLinks(text);
  if (!touches(parsed.links)) return text;
  return serializeLinks(next(parsed.links), parsed.malformed);
}

function stepQuantityBytes(
  text: string | null,
  touches: (quantities: readonly Quantity[]) => boolean,
  next: (quantities: readonly Quantity[]) => Quantity[],
): string | null {
  if (text === null) return text;
  const parsed = parseQuantities(text);
  if (!touches(parsed.quantities)) return text;
  return serializeQuantities(next(parsed.quantities), parsed.malformed);
}

function stepPinBytes(
  text: string | null,
  touches: (pins: readonly Assumption[]) => boolean,
  next: (pins: readonly Assumption[]) => Assumption[],
): string | null {
  if (text === null) return text;
  const parsed = parsePins(text);
  if (!touches(parsed.pins)) return text;
  return serializePins(next(parsed.pins), parsed.malformed);
}

/**
 * A step's result, with the folder's IDENTITY kept when no byte changed: the
 * applier's one skip test is `next === folder`, so "nothing to write" has to
 * be the same object, not an equal one.
 */
function compactFolder(
  before: ScenarioFolderBytes,
  after: ScenarioFolderBytes,
): ScenarioFolderBytes {
  const untouched =
    before.model === after.model &&
    before.links === after.links &&
    before.quantities === after.quantities &&
    before.pins === after.pins;
  return untouched ? before : after;
}

/**
 * THE reference-rename step, applied inside one branch folder: the variant's
 * playing set's member slugs, its links' endpoints, its quantities' word ends
 * and its PIN TARGETS all follow the rename — the same pure steps the
 * committed model's records use, in the same spirit (the sign, the amount, the
 * claim's text and every unknown key ride along untouched). The pin's TEXT is
 * never rewritten: a rename changes an address, never a claim.
 *
 * The whole folder comes back as the same object when nothing touched it, so
 * the applier writes nothing and a branch that never named the word keeps its
 * exact bytes.
 */
export function rewriteScenarioFolderForWord(
  folder: ScenarioFolderBytes,
  oldSlug: string,
  newSlug: string,
): ScenarioFolderBytes {
  if (oldSlug === newSlug) return folder;
  const touchesWord = (slug: string) => (link: Link) =>
    link.from === slug || link.to === slug;
  return compactFolder(folder, {
    model: stepModelBytes(
      folder.model,
      (model) => model.words.includes(oldSlug),
      (model) => rewriteMembership(model, oldSlug, newSlug),
    ),
    links: stepLinkBytes(
      folder.links,
      (links) => links.some(touchesWord(oldSlug)),
      (links) => rewriteLinkEndpoints(links, oldSlug, newSlug),
    ),
    quantities: stepQuantityBytes(
      folder.quantities,
      (quantities) =>
        quantities.some((quantity) => quantityWords(quantity).includes(oldSlug)),
      (quantities) => rewriteQuantityEndpoints(quantities, oldSlug, newSlug),
    ),
    pins: stepPinBytes(
      folder.pins,
      (pins) => pins.some((pin) => pinTouchesWord(pin, oldSlug)),
      (pins) => rewritePinWordTargets(pins, oldSlug, newSlug),
    ),
  });
}

/**
 * THE reference-remove step, applied inside one branch folder: die-with-target
 * EVERYWHERE (ADR-0021 decision 3). The variant's set drops the member, its
 * links drop every pair touching the word, its quantities drop every line
 * naming it, and the pins drop (a claim about a word that is gone is not
 * something a branch can keep standing on — the same rule the committed
 * `map/assumptions.jsonl` follows).
 */
export function dropScenarioFolderTouching(
  folder: ScenarioFolderBytes,
  slug: string,
): ScenarioFolderBytes {
  return compactFolder(folder, {
    model: stepModelBytes(
      folder.model,
      (model) => model.words.includes(slug),
      (model) => dropMembership(model, slug),
    ),
    links: stepLinkBytes(
      folder.links,
      (links) => links.some((link) => link.from === slug || link.to === slug),
      (links) => dropTouchingLinks(links, slug),
    ),
    quantities: stepQuantityBytes(
      folder.quantities,
      (quantities) =>
        quantities.some((quantity) => quantityWords(quantity).includes(slug)),
      (quantities) => dropQuantitiesTouching(quantities, slug),
    ),
    pins: stepPinBytes(
      folder.pins,
      (pins) => pins.some((pin) => pinTouchesWord(pin, slug)),
      (pins) => dropPinWordTargets(pins, slug),
    ),
  });
}

/**
 * The LOOP rename's branch step: a loop's slug is an assumption target's
 * address like a word's, so every folder's pins follow the resolved slug. The
 * loop's own line lives in the committed `map/loops.jsonl`; a branch carries
 * no loops, so nothing else in the folder can change.
 */
export function renameLoopInScenarioFolder(
  folder: ScenarioFolderBytes,
  oldLoopSlug: string,
  newLoopSlug: string,
): ScenarioFolderBytes {
  if (oldLoopSlug === newLoopSlug) return folder;
  return compactFolder(folder, {
    ...folder,
    pins: stepPinBytes(
      folder.pins,
      (pins) => pins.some((pin) => pinTargetsLoop(pin, oldLoopSlug)),
      (pins) => rewritePinLoopTargets(pins, oldLoopSlug, newLoopSlug),
    ),
  });
}

/** The loop remove's branch step: the pins targeting the removed loops die too. */
export function dropLoopPinsInScenarioFolder(
  folder: ScenarioFolderBytes,
  loopSlugs: readonly string[],
): ScenarioFolderBytes {
  const dropped = new Set(loopSlugs);
  if (dropped.size === 0) return folder;
  return compactFolder(folder, {
    ...folder,
    pins: stepPinBytes(
      folder.pins,
      (pins) =>
        pins.some(
          (pin) => pin.target.type === "loop" && dropped.has(pin.target.slug),
        ),
      (pins) => dropPinLoopTargets(pins, [...dropped]),
    ),
  });
}

/** The link remove's branch step: the pins on that ordered pair die with it. */
export function dropLinkPinsInScenarioFolder(
  folder: ScenarioFolderBytes,
  from: string,
  to: string,
): ScenarioFolderBytes {
  return compactFolder(folder, {
    ...folder,
    pins: stepPinBytes(
      folder.pins,
      (pins) => pins.some((pin) => pinIsOnLink(pin, from, to)),
      (pins) => dropPinLinkTargets(pins, from, to),
    ),
  });
}

/**
 * Apply one pure folder step to EVERY branch folder. The batch's scenario step
 * is this one function: it lists the branches (folders carrying a valid
 * header — a crash leftover is not one), reads each folder's four files, asks
 * the step, and writes back only what changed, in the folder's family order
 * (the set, then the links, then the quantities, then the pins).
 *
 * A folder the step leaves untouched is not written at all, so a branch's
 * bytes are its own: no canonicalization repair reaches a folder nothing named.
 * The committed model's own records are the caller's steps, not this one's.
 */
export async function applyScenarioStep(
  workspacePath: string,
  step: (folder: ScenarioFolderBytes) => ScenarioFolderBytes,
): Promise<void> {
  for (const scenario of await listScenarios(workspacePath)) {
    const dir = scenarioDir(workspacePath, scenario.slug);
    const [modelText, linksText, quantitiesText, pinsText] = await Promise.all([
      readTextFile(modelPath(dir)),
      readTextFile(linksPath(dir)),
      readTextFile(quantitiesPath(dir)),
      readTextFile(pinsPath(dir)),
    ]);
    const folder: ScenarioFolderBytes = {
      model: modelText,
      links: linksText,
      quantities: quantitiesText,
      pins: pinsText,
    };
    const next = step(folder);
    if (next === folder) continue;
    await writeChangedBytes(modelPath(dir), folder.model, next.model);
    await writeChangedBytes(linksPath(dir), folder.links, next.links);
    await writeChangedBytes(quantitiesPath(dir), folder.quantities, next.quantities);
    await writeChangedBytes(pinsPath(dir), folder.pins, next.pins);
  }
}

/** Write one folder file only when the step produced different bytes for it. */
async function writeChangedBytes(
  path: string,
  before: string | null,
  after: string | null,
): Promise<void> {
  if (after === null || after === before) return;
  await writeTextFile(path, after);
}

/**
 * The quiet moves' branch steps (a loop's rename or removal, a link's removal):
 * each reaches every folder for the pins it invalidates, exactly as the atomic
 * batches do. They are separate entries because those moves are single-line
 * writes in `useMap`, not batches in this module — the rule is one: a target's
 * address change rewrites its pins, a target's death drops them.
 */
export async function fanOutLoopRename(
  workspacePath: string,
  oldLoopSlug: string,
  newLoopSlug: string,
): Promise<void> {
  await applyScenarioStep(workspacePath, (folder) =>
    renameLoopInScenarioFolder(folder, oldLoopSlug, newLoopSlug),
  );
}

export async function fanOutLoopRemove(
  workspacePath: string,
  loopSlugs: readonly string[],
): Promise<void> {
  await applyScenarioStep(workspacePath, (folder) =>
    dropLoopPinsInScenarioFolder(folder, loopSlugs),
  );
}

export async function fanOutLinkRemove(
  workspacePath: string,
  from: string,
  to: string,
): Promise<void> {
  await applyScenarioStep(workspacePath, (folder) =>
    dropLinkPinsInScenarioFolder(folder, from, to),
  );
}

/**
 * Rename a reference: write the renamed file, rewrite endpoints, drop the old file.
 */
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
  const parsedLinks = await loadLinks(mapDir(workspacePath));
  await saveLinks(
    mapDir(workspacePath),
    rewriteLinkEndpoints(parsedLinks.links, oldSlug, newSlug),
    parsedLinks.malformed,
  );

  // 2b. Follow the rename in the marks in the same batch (ADR-0009). A link
  //     mark's wordless pair is rewritten here too, alongside its link line.
  //     Pointer-key marks are the pointer step's (2e2): they follow their own
  //     lines so a pointer line is always written before its mark.
  const parsedMarks = await loadMarks(workspacePath);
  const renamedMarks = rewriteMarkEndpoints(parsedMarks.marks, oldSlug, newSlug);
  await saveMarks(workspacePath, renamedMarks, parsedMarks.malformed);

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

  // 2d2. Follow the rename in the quantities in this same batch (ADR-0020,
  //      Epic 8 story 1): a stock line's `on` and a flow line's `from`/`to`
  //      are rewritten in place; the authored amount and every unknown key are
  //      untouched. The step sits AFTER assumptions and BEFORE pointers (the
  //      family position). Quantities never join or scope, so this is an
  //      address rewrite and nothing more.
  const parsedQuantities = await loadQuantities(mapDir(workspacePath));
  await saveQuantities(
    mapDir(workspacePath),
    rewriteQuantityEndpoints(parsedQuantities.quantities, oldSlug, newSlug),
    parsedQuantities.malformed,
  );

  // 2e. Follow the rename in the pointers in this same batch (ADR-0017): the
  //     reach's `on` follows the word; the target strings stay byte-verbatim
  //     (a path is not prose — the software never interprets it). The pointer
  //     LINES are written BEFORE their marks (the crash rule: an app move must
  //     never leave an app-authored dangling mark).
  const parsedPointers = await loadPointers(workspacePath);
  await savePointers(
    workspacePath,
    rewritePointerOwners(parsedPointers.pointers, oldSlug, newSlug),
    parsedPointers.malformed,
  );

  // 2e2. The pointer-key marks follow their lines in the same batch
  //      (ADR-0009's tightened second amendment): the mark's key copies the
  //      pointer's fields, so the rename rewrites `on` again here — after the
  //      pointer lines are on disk. A crash between 2e and 2e2 can only leave a
  //      pointer mark naming the old owner (an orphan the app surfaces), never a
  //      mark naming a line that was never written.
  await saveMarks(
    workspacePath,
    rewritePointerMarkOwners(renamedMarks, oldSlug, newSlug),
    parsedMarks.malformed,
  );

  // 2f. Follow the rename in the playing set (ADR-0013). The renamed file —
  //     the durable thing — is already on disk, so a crash here leaves a stale
  //     member name in map/model.json (visible, fixable by re-running the
  //     selector), never a member that names no word. An unreadable model file
  //     is skipped and keeps its bytes exactly.
  const parsedModel = await loadModel(mapDir(workspacePath));
  if (parsedModel.model) {
    await saveModel(
      mapDir(workspacePath),
      rewriteMembership(parsedModel.model, oldSlug, newSlug),
    );
  }

  // 2g. Fan the rename out to EVERY branch folder (ADR-0021 decision 3, Epic 8
  //     story 2): each variant's playing set, links, quantities and its pins
  //     name words by slug exactly as the committed records do, so the same
  //     pure steps are applied inside every scenario folder. The step sits
  //     AFTER the committed membership and BEFORE the old file goes, so a crash
  //     mid-fan-out leaves every branch consistent: the old reference file is
  //     still on disk, so a folder still naming the old slug names a word that
  //     exists. Nothing dangles, and nothing is repaired.
  await applyScenarioStep(workspacePath, (folder) =>
    rewriteScenarioFolderForWord(folder, oldSlug, newSlug),
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
  const slug = ref.slug;

  // 1. Drop every line and mark touching the slug (write first: a crash leaves
  //    the word, never a dangling line or mark).
  const { distances, malformed } = await loadDistances(workspacePath);
  await saveDistances(workspacePath, dropTouching(distances, slug), malformed);

  // 1a. Drop the signed links touching the word (ADR-0012/0014) — before the
  //     marks, so no mark is ever left naming a pair the same batch removed.
  const parsedLinks = await loadLinks(mapDir(workspacePath));
  await saveLinks(
    mapDir(workspacePath),
    dropTouchingLinks(parsedLinks.links, slug),
    parsedLinks.malformed,
  );

  const parsedMarks = await loadMarks(workspacePath);
  const remainingMarks = dropMarksTouching(parsedMarks.marks, slug);
  await saveMarks(workspacePath, remainingMarks, parsedMarks.malformed);

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

  // 1b2b. Drop the quantity lines touching the word — die-with-target
  //       (ADR-0020 decision 3, Epic 8 story 1): its stock line and every flow
  //       ending at it go before the file goes, so no line is ever left naming
  //       a word the same batch removed. The step sits AFTER assumptions and
  //       BEFORE pointers (the family position).
  const parsedQuantities = await loadQuantities(mapDir(workspacePath));
  await saveQuantities(
    mapDir(workspacePath),
    dropQuantitiesTouching(parsedQuantities.quantities, slug),
    parsedQuantities.malformed,
  );

  // 1b3. Drop the pointer lines whose owner is the removed word — die-with-
  //      target (ADR-0017) — BEFORE their marks, keeping the batch's order
  //      (a pointer line is written before its mark). The target strings are
  //      untouched: only the reach's owner dies.
  const parsedPointers = await loadPointers(workspacePath);
  await savePointers(
    workspacePath,
    dropPointersTouching(parsedPointers.pointers, slug),
    parsedPointers.malformed,
  );

  // 1b4. Drop the pointer-key marks on those lines — after the lines, the same
  //      order as a cast (ADR-0009's tightened second amendment). If the batch
  //      stops between 1b3 and 1b4, the leftover mark names a line that is
  //      gone: an orphan the app surfaces, never a silently repaired record.
  await saveMarks(
    workspacePath,
    dropPointerMarksTouching(remainingMarks, slug),
    parsedMarks.malformed,
  );

  // 1c. Drop the word's membership before the file goes (ADR-0013). Same
  //     crash rule: a crash after this write leaves the word on the map, not
  //     in play — visible, and one accept away from being put back.
  const parsedModel = await loadModel(mapDir(workspacePath));
  if (parsedModel.model) {
    await saveModel(mapDir(workspacePath), dropMembership(parsedModel.model, slug));
  }

  // 1d. Die-with-target EVERYWHERE (ADR-0021 decision 3, Epic 8 story 2): drop
  //     the touching lines in every branch folder — the variant's membership,
  //     its links, its quantities — and the pins that named the removed target.
  //     The step sits AFTER the committed membership and BEFORE the file goes:
  //     a crash mid-fan-out leaves a branch naming a word whose file still
  //     exists (visible, and one remove away from settled), never a branch
  //     naming nothing.
  await applyScenarioStep(workspacePath, (folder) =>
    dropScenarioFolderTouching(folder, slug),
  );

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