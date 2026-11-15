import { canonicalJsonlLines } from "../lib/serialize";
import {
  assumptionKey,
  parseAssumptionLine,
  serializeAssumptionLine,
  type Assumption,
} from "../map/assumptions";

/**
 * Assumption pins (ADR-0021 decision 2, Epic 8 story 2).
 *
 * Branching a model PINS every committed assumption line: the branch carries a
 * copy of the claims it was branched on, as `assumption-pins.jsonl` in its own
 * folder. The pin is the claim's ADDRESS and TEXT — `(target, text)` — exactly
 * as the committed file had them at branch time; the same line grammar as
 * `map/assumptions.jsonl` (a pin file is an assumptions file the branch owns).
 * ALL committed lines are pinned, in file order, multiplicity and unknown keys
 * included: the branch records what it stood on, not a deduplicated digest.
 *
 * Assumptions are PINNED, NEVER OVERRIDDEN. The branch cannot edit, add or
 * withdraw a committed claim through its pins; the reads of the branch's own
 * links and quantities are the branch's, the claims stay the map's.
 *
 * THE DANGLE PREDICATE lives here (the presentation is story 4's): a pin
 * DANGLES when no exact `(target, text)` match exists in the committed
 * assumptions file. Exact means exact — the target's natural key and the text
 * byte-for-byte, no trim, no case folding, no fuzzy match — so the predicate
 * covers all three ways a pin loses its ground:
 *
 *   - the claim's TEXT was edited (the pin keeps the old words);
 *   - the claim was REMOVED (nothing on that target says it any more);
 *   - the claim's TARGET died by a hand edit (the word or pair or loop it
 *     names is gone from the file).
 *
 * `target death` by the APP's own lifecycle is different: a rename REWRITES
 * the pin's target (an address change is not a dangle — the claim still stands,
 * under its new address) and a remove DROPS the touching pins (die-with-target,
 * the same rule every record follows). Those steps are pure here and are called
 * from the atomic batches (`map/patches.ts`), which reach EVERY scenario
 * folder.
 *
 * Provisional (ADR-0021): the `assumption-pins.jsonl` name, the pin's being a
 * copy of the committed line, and "all-or-none" (every line pinned at branch
 * time, never a chosen few). A file the app cannot read as pins is preserved
 * verbatim and surfaced like every other record's malformed lines.
 */

/** A branch's pins file inside the branch's folder (not `map/`). */
export const PINS_FILE = "assumption-pins.jsonl";

/** The pins file in a branch's folder. */
export function pinsPath(scenarioDir: string): string {
  return `${scenarioDir}/${PINS_FILE}`;
}

export interface ParsedPins {
  /** Every readable pin, in FILE ORDER, hand-duplicated keys included. */
  pins: Assumption[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

/**
 * Read a branch's pins. A missing file (`null`) means the branch pinned
 * nothing — a legitimate branch of a model with no assumptions. Malformed
 * lines are preserved verbatim (the no-validation posture), never repaired into
 * a plausible pin.
 */
export function parsePins(text: string | null): ParsedPins {
  if (text === null) return { pins: [], malformed: [] };
  const pins: Assumption[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseAssumptionLine(line);
    if (parsed) {
      pins.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return { pins, malformed };
}

/**
 * The pins file's exact bytes: every pin canonically (sorted keys) in FILE
 * ORDER with multiplicity kept, malformed lines re-emitted verbatim. An empty
 * document is the canonical empty JSONL (one newline).
 */
export function serializePins(
  pins: readonly Assumption[],
  malformed: readonly string[] = [],
): string {
  return canonicalJsonlLines([
    ...pins.map(serializeAssumptionLine),
    ...malformed,
  ]);
}

/**
 * The pins a branch takes: EVERY committed assumption line, in file order,
 * with its target, its text and its unknown keys. The committed file's
 * malformed bytes are not claims and have no `(target, text)` to pin — they
 * stay in `map/assumptions.jsonl` and are surfaced there, never invented into
 * a pin.
 */
export function pinsFromAssumptions(
  assumptions: readonly Assumption[],
): Assumption[] {
  return assumptions.map((assumption) => ({
    text: assumption.text,
    target: assumption.target,
    extra: { ...assumption.extra },
  }));
}

/** The committed file's natural keys — the ground a pin may stand on. */
export function committedAssumptionKeys(
  committed: readonly Assumption[],
): Set<string> {
  return new Set(committed.map(assumptionKey));
}

/**
 * THE dangle predicate, one pin at a time: a pin dangles iff its exact
 * `(target, text)` key is not in the committed file's keys. Pure; the caller
 * builds the key set once (`committedAssumptionKeys`).
 */
export function pinDangles(
  pin: Assumption,
  committedKeys: ReadonlySet<string>,
): boolean {
  return !committedKeys.has(assumptionKey(pin));
}

/** Every pin that no longer stands on the committed file, in pin order. */
export function danglingPins(
  pins: readonly Assumption[],
  committed: readonly Assumption[],
): Assumption[] {
  const keys = committedAssumptionKeys(committed);
  return pins.filter((pin) => pinDangles(pin, keys));
}

/** Does this pin name the word — on it, or on a link it is an endpoint of? */
export function pinTouchesWord(pin: Assumption, slug: string): boolean {
  if (pin.target.type === "word") return pin.target.slug === slug;
  if (pin.target.type === "link") {
    return pin.target.from === slug || pin.target.to === slug;
  }
  return false;
}

/** Is this pin on the given ordered link pair (the wordless pair)? */
export function pinIsOnLink(
  pin: Assumption,
  from: string,
  to: string,
): boolean {
  return (
    pin.target.type === "link" &&
    pin.target.from === from &&
    pin.target.to === to
  );
}

/** Does this pin target the loop's name-slug? */
export function pinTargetsLoop(pin: Assumption, slug: string): boolean {
  return pin.target.type === "loop" && pin.target.slug === slug;
}

/** A pin's target, rewritten in one pass, resolving the collisions it creates. */
function rewritePinTargetsWhere(
  pins: readonly Assumption[],
  retarget: (pin: Assumption) => Assumption["target"] | null,
): Assumption[] {
  const rewrittenKeys = new Map<string, number>();
  const next = pins.map((pin, index) => {
    const target = retarget(pin);
    if (target === null) return pin;
    const record: Assumption = { ...pin, target };
    rewrittenKeys.set(assumptionKey(record), index);
    return record;
  });
  if (rewrittenKeys.size === 0) return [...pins];
  const drop = new Set<number>();
  next.forEach((pin, index) => {
    const survivor = rewrittenKeys.get(assumptionKey(pin));
    if (survivor === undefined) return;
    if (index !== survivor) drop.add(index);
  });
  return next.filter((_, index) => !drop.has(index));
}

/**
 * Re-write every pin whose target names the renamed word (or a link touching
 * it): a word pin's `on` and a link pin's wordless pair follow the rename, so
 * an app rename is never read as a dangle. The pin's TEXT and unknown keys are
 * untouched — a rename changes the address, never the claim, exactly as the
 * committed batch rewrites `map/assumptions.jsonl`'s targets. `loop` targets
 * are the loop batch's; a bare spot has no endpoint and stays.
 *
 * Collision rule, mirroring the committed file's rewrite: untouched pins are
 * emitted first and rewritten ones last, so the app's rewrite is the survivor
 * if a hand-edited duplicate already sits on the new key.
 */
export function rewritePinWordTargets(
  pins: readonly Assumption[],
  oldSlug: string,
  newSlug: string,
): Assumption[] {
  if (oldSlug === newSlug) return [...pins];
  return rewritePinTargetsWhere(pins, (pin) => {
    if (pin.target.type === "word" && pin.target.slug === oldSlug) {
      return { type: "word", slug: newSlug };
    }
    if (
      pin.target.type === "link" &&
      (pin.target.from === oldSlug || pin.target.to === oldSlug)
    ) {
      return {
        type: "link",
        from: pin.target.from === oldSlug ? newSlug : pin.target.from,
        to: pin.target.to === oldSlug ? newSlug : pin.target.to,
      };
    }
    return null;
  });
}

/**
 * Re-write every pin targeting the renamed loop's slug (the loop batch's
 * address change). `newLoopSlug` is the caller's RESOLVED slug, so the
 * collision suffix a rename mints flows straight into the pins.
 */
export function rewritePinLoopTargets(
  pins: readonly Assumption[],
  oldLoopSlug: string,
  newLoopSlug: string,
): Assumption[] {
  if (oldLoopSlug === newLoopSlug) return [...pins];
  return rewritePinTargetsWhere(pins, (pin) =>
    pin.target.type === "loop" && pin.target.slug === oldLoopSlug
      ? { type: "loop", slug: newLoopSlug }
      : null,
  );
}

/**
 * Drop every pin touching the removed word — its own word pins and the pins on
 * its links — die-with-target everywhere, the same rule the committed file
 * follows. Bare-spot pins outlive the words around them; `loop` pins are the
 * loop batch's.
 */
export function dropPinWordTargets(
  pins: readonly Assumption[],
  slug: string,
): Assumption[] {
  return pins.filter((pin) => {
    if (pin.target.type === "word") return pin.target.slug !== slug;
    if (pin.target.type === "link") {
      return pin.target.from !== slug && pin.target.to !== slug;
    }
    return true;
  });
}

/** Drop the pins on a removed link's ordered pair (die-with-target). */
export function dropPinLinkTargets(
  pins: readonly Assumption[],
  from: string,
  to: string,
): Assumption[] {
  return pins.filter(
    (pin) =>
      !(
        pin.target.type === "link" &&
        pin.target.from === from &&
        pin.target.to === to
      ),
  );
}

/** Drop every pin targeting a removed loop's slug (one slug or a batch). */
export function dropPinLoopTargets(
  pins: readonly Assumption[],
  loopSlugs: string | readonly string[],
): Assumption[] {
  const dropped = new Set(
    typeof loopSlugs === "string" ? [loopSlugs] : loopSlugs,
  );
  if (dropped.size === 0) return [...pins];
  return pins.filter(
    (pin) => !(pin.target.type === "loop" && dropped.has(pin.target.slug)),
  );
}
