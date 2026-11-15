import type { Assumption, AssumptionTarget } from "../map/assumptions";
import {
  drawLink,
  findLink,
  flipLink,
  hasLink,
  removeLink,
  type Link,
  type LinkSign,
} from "../map/links";
import { joinWord, withoutWord, type PlayingSet } from "../map/model";
import {
  findQuantity,
  isValidAmount,
  quantityKey,
  removeQuantity,
  setQuantity,
  type Quantity,
  type QuantityTarget,
} from "../map/quantities";

/**
 * The bridge (ADR-0021 §7, amended by issue 04; Epic 8 story 4): the RETURN
 * MOVE, as the family's ORDINARY deliberate edits — one at a time, never an
 * "apply the branch" verb.
 *
 * A consequence noticed in the comparison becomes a revision of the committed
 * model: create a line, replace one, remove one, flip a sign, join a word to
 * play or take it out. Each move is the record layer's own function, on the
 * records every other door writes (`map/` — the caller's folder, see
 * `compareRead.ts`): nothing here copies a branch value over the model, and
 * nothing here reads a branch at all. Substituting a branch's whole model would
 * be exactly the apply verb the ruling forbids, so the type has no such move.
 *
 * ONE MOVE, ONE RECORD. A move edits exactly one of the three records and
 * returns it with `changed` naming which — or `changed: null` when the
 * move was a quiet no-op (a flip of a link that is not drawn, a word already
 * in play), so the caller can skip the write. `flip` rewrites the line AT
 * ITS INDEX (`flipLink`), exactly as the person's own flip does; a removed
 * line is gone with no tombstone.
 *
 * The doors the comparison's view can ask for are `BridgeActions`: the
 * moves, plus the two CLAIM doors (a claim is not one of the three
 * records — it lives in the map's assumptions file, and the ordinary revise is
 * the existing `reviseAssumption` / `addAssumption`).
 *
 * Pure: no fs, no React, no branch access. The committed writer is
 * `compareRead.ts`'s, and the run is untouched by construction — the
 * records here are not the ACTIVE model's while a branch runs, which is why a
 * committed edit never resets the run (ADR-0022's reset amendment).
 *
 * Provisional (ADR-0003/ADR-0021): the move names and the row shape.
 */

/** The committed model's three variant-owned records (the bridge's subject). */
export interface BridgeRecords {
  /** The playing set, or null when none was accepted. */
  model: PlayingSet | null;
  /** The signed link lines, in file order. */
  links: Link[];
  /** The quantity lines, in file order. */
  quantities: Quantity[];
}

/** Which record a move edits. */
export type BridgeRecord = "model" | "links" | "quantities";

/**
 * One deliberate edit. Every move is one of the family's ordinary moves; the
 * union has no "copy the branch" member and never will.
 */
export type BridgeMove =
  /** Author or replace a quantity line's amount (absent amount = unknown). */
  | { move: "set-amount"; target: QuantityTarget; amount: number | null }
  /** Remove a quantity line (ammo, no tombstone). */
  | { move: "remove-line"; target: QuantityTarget }
  /** Draw a link line — the sign is the caller's explicit pick. */
  | { move: "draw-link"; from: string; to: string; sign: LinkSign }
  /** Flip a drawn link's sign in place at its index. */
  | { move: "flip-link"; from: string; to: string }
  /** Remove a link line. */
  | { move: "remove-link"; from: string; to: string }
  /** Join a word to the committed playing set. */
  | { move: "join-word"; word: string }
  /** Take a word out of the committed playing set. */
  | { move: "prune-word"; word: string };

/** A move's outcome: the records it leaves, and which record changed. */
export interface BridgeEdit {
  records: BridgeRecords;
  /** The record the move wrote, or null when the move changed nothing. */
  changed: BridgeRecord | null;
}

/** A move that changes nothing: the caller writes no file. */
function unchanged(records: BridgeRecords): BridgeEdit {
  return { records, changed: null };
}

/** Is another line already on this quantity's natural key (convergence)? */
function duplicateOnKey(quantities: readonly Quantity[], index: number): boolean {
  const key = quantityKey(quantities[index]);
  return quantities.some(
    (quantity, i) => i !== index && quantityKey(quantity) === key,
  );
}

/**
 * Take ONE deliberate edit of the committed records. Pure: the records come
 * back untouched when the move changes nothing (`changed: null`).
 */
export function deliberateEdit(
  records: BridgeRecords,
  move: BridgeMove,
): BridgeEdit {
  switch (move.move) {
    case "set-amount": {
      if (move.amount !== null && !isValidAmount(move.amount)) {
        return unchanged(records);
      }
      const found = findQuantity(records.quantities, move.target);
      if (
        found !== null &&
        found.quantity.amount === move.amount &&
        !duplicateOnKey(records.quantities, found.index)
      ) {
        return unchanged(records);
      }
      return {
        records: {
          ...records,
          quantities: setQuantity(records.quantities, move.target, move.amount),
        },
        changed: "quantities",
      };
    }
    case "remove-line": {
      if (findQuantity(records.quantities, move.target) === null) {
        return unchanged(records);
      }
      return {
        records: {
          ...records,
          quantities: removeQuantity(records.quantities, move.target),
        },
        changed: "quantities",
      };
    }
    case "draw-link": {
      const drawn = findLink(records.links, move.from, move.to);
      if (drawn !== null && drawn.sign === move.sign) return unchanged(records);
      return {
        records: {
          ...records,
          links: drawLink(records.links, move.from, move.to, move.sign),
        },
        changed: "links",
      };
    }
    case "flip-link": {
      if (findLink(records.links, move.from, move.to) === null) {
        return unchanged(records);
      }
      return {
        records: {
          ...records,
          links: flipLink(records.links, move.from, move.to),
        },
        changed: "links",
      };
    }
    case "remove-link": {
      if (!hasLink(records.links, move.from, move.to)) return unchanged(records);
      return {
        records: {
          ...records,
          links: removeLink(records.links, move.from, move.to),
        },
        changed: "links",
      };
    }
    case "join-word": {
      const joined = joinWord(records.model, move.word);
      if (joined === null || joined === records.model) return unchanged(records);
      return { records: { ...records, model: joined }, changed: "model" };
    }
    case "prune-word": {
      if (records.model === null || !records.model.words.includes(move.word)) {
        return unchanged(records);
      }
      return {
        records: { ...records, model: withoutWord(records.model, move.word) },
        changed: "model",
      };
    }
  }
}

/**
 * What the comparison's rows and premises can ask the bridge for. Each door is
 * ONE deliberate edit — the panel has no second verb, and no door takes a
 * branch: the branch's values are what the row SHOWS, never what a door
 * copies.
 */
export interface BridgeActions {
  /** Author or replace a quantity line's amount (a blank amount = unknown). */
  setAmount: (target: QuantityTarget, amount: number | null) => void;
  /** Remove a quantity line. */
  removeLine: (target: QuantityTarget) => void;
  /** Draw a link line with the sign the person picked. */
  drawLink: (from: string, to: string, sign: LinkSign) => void;
  /** Flip a drawn link's sign. */
  flipLink: (from: string, to: string) => void;
  /** Remove a link line. */
  removeLink: (from: string, to: string) => void;
  /** Join a word to the committed playing set. */
  joinWord: (word: string) => void;
  /** Take a word out of the committed playing set. */
  pruneWord: (word: string) => void;
  /**
   * Revise one committed claim's text in place. The line is addressed by its
   * OBJECT (the app's ordinary revise's addressing), so an edit can never act
   * on a line a converging edit shifted.
   */
  reviseClaim: (assumption: Assumption, text: string) => void;
  /** State a new claim on a target (when the pinned one no longer stands). */
  stateClaim: (target: AssumptionTarget, text: string) => void;
}
