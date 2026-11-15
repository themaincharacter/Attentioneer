import type { Link } from "./links";
import type { PlayingSet } from "./model";
import { quantityKey, type Quantity } from "./quantities";

/**
 * The step (ADR-0022, Epic 8 story 3): one hand-cranked, per-piece gated move
 * of the ACTIVE model's quantities.
 *
 * THE STEP IS A READING, NOT A RECORD. Nothing here writes, saves or persists:
 * the run is ephemeral app state (the hook in `canvas/useStepRun.ts`), it is
 * reset when the active model's records change or the branch switches, and
 * stepping writes nothing to disk. This module has no path parameter and no
 * loader — it is pure arithmetic over the model the person is looking at.
 *
 * ONE SIMULTANEOUS STEP FROM THE START STATE (ADR-0022 decision 2). Every
 * transfer is computed from the OPENING amounts: an inflow never funds an
 * outflow in the same crank (no receipt-before-send games). When a stock's
 * outflows ask for more than it holds, FILE ORDER SERVES — the flows are
 * served in the order their lines appear in `quantities.jsonl` — and the
 * clamp is LOUD: the step carries a note naming the stock, the flow, what it
 * gave and what it asked ("soil gave 2 of 3"). The clamp is the consequence
 * worth noticing (the faulty-assumption moment); refusing would hide it. Each
 * crank states only its OWN notes — the note list is step-scoped, replaced by
 * the next crank.
 *
 * UNKNOWN NEVER BECOMES 0 (ADR-0022 decision 1). The gate matrix, enumerated:
 *
 *   - a flow with NO amount is skipped and said;
 *   - a stock with NO amount (or two hand-duplicated stock lines: its amount is
 *     not guessed) gates its outflows — each gated flow is said, and the
 *     stock's running amount stays UNKNOWN (an arrival cannot be added to an
 *     unknown amount: it is said and the amount stays unknown);
 *   - DUPLICATE pair lines gate that flow — the step will not double-move the
 *     same ordered pair;
 *   - OUT-OF-PLAY pieces (a stock on, or a flow touching, a word outside the
 *     active playing set) are skipped and said;
 *   - a SELF-FLOW is a legal shape that moves nothing — said, not refused.
 *
 * Malformed quantity lines never reach the step: the record layer surfaces
 * them (ADR-0005's posture) and a step only ever runs over readable pieces.
 *
 * THE OUTSIDE IS NAMED (ADR-0022 decision 3). An endpoint WITHOUT a stock line
 * is the world: unbounded, so a flow out of it always gives its authored
 * amount and a flow into it always receives its amount. It is said at step
 * time — infinity is a seen consequence, never a hidden default. A flow with
 * no stock line at either end is the world to the world: said, and nothing
 * observable moves.
 *
 * THE DISPLAY IS PER-WORD (ADR-0022 decision 4): each in-play stock's running
 * amount plus what the last crank moved for it (the signed delta; a word
 * nothing moved has no delta). NEVER a cross-word sum, total, column, table,
 * meter or step counter — the Funes brake. This module exposes no summing and
 * no counting helper, and `StepRun` carries exactly three fields: the
 * amounts, the last delta and the notes.
 *
 * LINKS ARE READ BUT NEVER GATE (ADR-0022 decision 5): the step is of the
 * ACTIVE model, whose records include its signed links, so they travel with
 * the model and the run's lifecycle key (`activeModelKey`) — but the
 * arithmetic never reads a sign. Flows do not test the loop read; a sign and a
 * flow in tension is the person's to notice, and the two layers never
 * cross-validate.
 *
 * Provisional (ADR-0003/ADR-0022): the note kinds and their display wording
 * (`canvas/stepNotes.ts`), the duplicate-STOCK gate (the ADR names duplicate
 * pair lines; a duplicated stock is the same ignorance — its authored amount
 * cannot be trusted — so it is never guessed), and the skip of an outside note
 * when a crank moves 0 (nothing observable happened).
 */

/** The parts of the ACTIVE model the step runs over. */
export interface StepModel {
  /**
   * The active playing set's member slugs, or null when none was accepted.
   * With no set nothing is in play: the crank moves nothing and says so.
   * (Stepping is a reading, not an authoring move, so it is not gated by
   * `authoringLive`; the person can always press it and hear the gate.)
   */
  words: readonly string[] | null;
  /** The active model's quantities, in FILE ORDER, duplicates included. */
  quantities: readonly Quantity[];
  /**
   * The active model's signed links. Carried so the run is a run of THIS
   * model (the lifecycle key covers them); the step's arithmetic never reads
   * a sign (ADR-0022 decision 5 — the layers never cross-validate).
   */
  links: readonly Link[];
}

/** One piece the step skipped, a consequence it produced, or the world it named. */
export type StepNote =
  /** No accepted playing set: nothing is in play, so nothing moves. */
  | { kind: "no-set" }
  /** A stock line on a word outside the playing set: not a piece of the game. */
  | { kind: "out-of-play-stock"; on: string }
  /** A flow line touching a word outside the playing set: not a piece of the game. */
  | { kind: "out-of-play-flow"; from: string; to: string }
  /**
   * Two stock lines on one word: its amount is not guessed and its outflows do
   * not move.
   */
  | { kind: "duplicate-stock"; on: string }
  /** Two flow lines on one ordered pair: the step will not double-move it. */
  | { kind: "duplicate-flow"; from: string; to: string }
  /** The flow's own amount is unknown: skipped, never read as 0. */
  | { kind: "unknown-flow"; from: string; to: string }
  /** An outflow from a stock whose amount is unknown: gated, said. */
  | { kind: "unknown-stock-outflow"; on: string; to: string }
  /** A self-flow: a legal shape that moves nothing — said, not refused. */
  | { kind: "self-flow"; on: string }
  /** The source has no stock line: the flow comes from the world, unbounded. */
  | { kind: "outside-source"; from: string; to: string; amount: number }
  /** The target has no stock line: the flow drains to the world, unbounded. */
  | { kind: "outside-sink"; from: string; to: string; amount: number }
  /** Neither end has a stock line: the world to the world — nothing observable. */
  | { kind: "world-to-world"; from: string; to: string; amount: number }
  /** An arrival into a stock whose amount is unknown: the amount stays unknown. */
  | { kind: "unknown-arrival"; on: string; amount: number }
  /**
   * The stock could not serve the whole flow: file order served, and this is
   * the shortfall against the flow's authored amount. Loud, and step-scoped.
   */
  | {
      kind: "clamp";
      on: string;
      from: string;
      to: string;
      gave: number;
      asked: number;
    };

/**
 * One crank's outcome: the run itself. Ephemeral, in memory, never written.
 */
export interface StepRun {
  /**
   * Each in-play stock's running amount after the crank. A null amount is the
   * UNKNOWN stock (a line with no amount, or two lines): it stays unknown and
   * its outflows were gated. A word with no stock line is not here — it is
   * the world.
   */
  amounts: ReadonlyMap<string, number | null>;
  /** What the LAST crank moved for each word (the net, signed); absent = nothing. */
  lastDelta: ReadonlyMap<string, number>;
  /** This crank's notes, in file order (step-scoped: the next crank replaces them). */
  notes: readonly StepNote[];
}

/** One quantity line's position in the file (the tiebreak the step serves by). */
interface IndexedNote {
  index: number;
  note: StepNote;
}

/** A stock's authored reading, before the step runs. */
type StockRead =
  /** A single line; `amount` is null when the line carries none (unknown). */
  | { opening: number | null }
  /** Two or more lines on one word: the amount is never guessed. */
  | "duplicate";

/** The world's sentinel read for the source of a flow with no stock line. */
const WORLD = "world";

/**
 * Run one crank. `previous` is the last crank's run, or null for the run's
 * start; the opening amounts are the previous crank's running amounts (the
 * stock's authored amount on the first crank). Nothing here reads or writes
 * disk.
 */
export function stepRun(
  model: StepModel,
  previous: StepRun | null,
): StepRun {
  if (model.words === null) {
    return { amounts: new Map(), lastDelta: new Map(), notes: [{ kind: "no-set" }] };
  }
  const inPlay = new Set(model.words);
  // How many lines carry each natural key (duplicate lines are content, and
  // the step never guesses which of them is meant).
  const keyLines = new Map<string, number>();
  const firstIndex = new Map<string, number>();
  model.quantities.forEach((quantity, index) => {
    const key = quantityKey(quantity);
    keyLines.set(key, (keyLines.get(key) ?? 0) + 1);
    if (!firstIndex.has(key)) firstIndex.set(key, index);
  });

  const notes: IndexedNote[] = [];

  // The stocks first: a flow's gate depends on its source stock's reading,
  // whatever the line order.
  const stocks = new Map<string, StockRead>();
  const duplicateStocks = new Set<string>();
  model.quantities.forEach((quantity, index) => {
    if (quantity.type !== "stock") return;
    if (!inPlay.has(quantity.on)) {
      if (firstIndex.get(quantityKey(quantity)) === index) {
        notes.push({ index, note: { kind: "out-of-play-stock", on: quantity.on } });
      }
      return;
    }
    if ((keyLines.get(quantityKey(quantity)) ?? 0) > 1) {
      duplicateStocks.add(quantity.on);
      stocks.set(quantity.on, "duplicate");
      if (firstIndex.get(quantityKey(quantity)) === index) {
        notes.push({ index, note: { kind: "duplicate-stock", on: quantity.on } });
      }
      return;
    }
    stocks.set(quantity.on, { opening: quantity.amount });
  });

  // The flows, in FILE ORDER: the gates first, then the eligible transfers.
  interface Flow {
    index: number;
    from: string;
    to: string;
    amount: number;
  }
  const flows: Flow[] = [];
  model.quantities.forEach((quantity, index) => {
    if (quantity.type !== "flow") return;
    const first = firstIndex.get(quantityKey(quantity)) === index;
    if (!inPlay.has(quantity.from) || !inPlay.has(quantity.to)) {
      if (first) {
        notes.push({
          index,
          note: { kind: "out-of-play-flow", from: quantity.from, to: quantity.to },
        });
      }
      return;
    }
    if ((keyLines.get(quantityKey(quantity)) ?? 0) > 1) {
      if (first) {
        notes.push({
          index,
          note: { kind: "duplicate-flow", from: quantity.from, to: quantity.to },
        });
      }
      return;
    }
    if (quantity.from === quantity.to) {
      notes.push({ index, note: { kind: "self-flow", on: quantity.from } });
      return;
    }
    if (quantity.amount === null) {
      notes.push({
        index,
        note: { kind: "unknown-flow", from: quantity.from, to: quantity.to },
      });
      return;
    }
    const source = stocks.get(quantity.from);
    if (source === "duplicate") return; // its duplicate note already said it
    if (source !== undefined && source.opening === null) {
      notes.push({
        index,
        note: {
          kind: "unknown-stock-outflow",
          on: quantity.from,
          to: quantity.to,
        },
      });
      return;
    }
    flows.push({ index, from: quantity.from, to: quantity.to, amount: quantity.amount });
  });

  // The opening amounts: the previous crank's running amounts, else the
  // authored stock (null = the unknown stock).
  const opening = new Map<string, number | null>();
  for (const [slug, read] of stocks) {
    if (read === "duplicate") {
      opening.set(slug, null);
      continue;
    }
    const carried = previous?.amounts.get(slug);
    opening.set(slug, carried === undefined ? read.opening : carried);
  }

  // ONE simultaneous step: every transfer is served from the OPENING amount
  // and file order is the tiebreak. Inflows are collected, never spent.
  const remaining = new Map<string, number>();
  for (const [slug, amount] of opening) {
    if (typeof amount === "number") remaining.set(slug, amount);
  }
  const inflow = new Map<string, number>();
  const outflow = new Map<string, number>();
  for (const flow of flows) {
    // The source: a known stock (clamped by file order), an unknown stock
    // (gated above) or no stock line at all — the world, unbounded.
    const source = stocks.has(flow.from) ? opening.get(flow.from) : WORLD;
    let given: number;
    if (source === WORLD) {
      given = flow.amount;
    } else if (typeof source !== "number") {
      // Defensive: an unknown/duplicated stock never reaches the eligible list.
      continue;
    } else {
      const left = remaining.get(flow.from) ?? 0;
      given = Math.min(flow.amount, left);
      remaining.set(flow.from, left - given);
      if (given < flow.amount) {
        notes.push({
          index: flow.index,
          note: {
            kind: "clamp",
            on: flow.from,
            from: flow.from,
            to: flow.to,
            gave: given,
            asked: flow.amount,
          },
        });
      }
    }

    // The target: a known stock receives, an unknown stock stays unknown (said
    // when something actually arrives), and no stock line is the world.
    const target = stocks.has(flow.to) ? opening.get(flow.to) : WORLD;
    if (target === WORLD) {
      // No sink line: the world takes it. Only named when something moved.
    } else if (typeof target === "number") {
      inflow.set(flow.to, (inflow.get(flow.to) ?? 0) + given);
    } else if (!duplicateStocks.has(flow.to) && given > 0) {
      notes.push({
        index: flow.index,
        note: { kind: "unknown-arrival", on: flow.to, amount: given },
      });
    }

    if (typeof source === "number") {
      outflow.set(flow.from, (outflow.get(flow.from) ?? 0) + given);
    }

    // The outside is named at step time (only when the step actually moves).
    const sourceWorld = !stocks.has(flow.from);
    const targetWorld = !stocks.has(flow.to);
    if (given > 0) {
      if (sourceWorld && targetWorld) {
        notes.push({
          index: flow.index,
          note: {
            kind: "world-to-world",
            from: flow.from,
            to: flow.to,
            amount: given,
          },
        });
      } else if (sourceWorld) {
        notes.push({
          index: flow.index,
          note: {
            kind: "outside-source",
            from: flow.from,
            to: flow.to,
            amount: given,
          },
        });
      } else if (targetWorld) {
        notes.push({
          index: flow.index,
          note: {
            kind: "outside-sink",
            from: flow.from,
            to: flow.to,
            amount: given,
          },
        });
      }
    }
  }

  // The running amounts: opening + arrivals - served outflows (all from the
  // opening — a simultaneous step). Unknown stocks stay unknown.
  const amounts = new Map<string, number | null>();
  const lastDelta = new Map<string, number>();
  for (const [slug, openingAmount] of opening) {
    if (typeof openingAmount !== "number") {
      amounts.set(slug, null);
      continue;
    }
    const next =
      openingAmount + (inflow.get(slug) ?? 0) - (outflow.get(slug) ?? 0);
    amounts.set(slug, next);
    const delta = next - openingAmount;
    if (delta !== 0) lastDelta.set(slug, delta);
  }

  notes.sort((a, b) => a.index - b.index);
  return { amounts, lastDelta, notes: notes.map((entry) => entry.note) };
}

/**
 * The run's lifecycle key (ADR-0022 decision 4, amended): the ACTIVE model's
 * identity — the records folder (so a scenario switch is a new model, even
 * between identical copies), the playing set's words, the links and the
 * quantities, in FILE ORDER. A different key is a different model, and the
 * run resets; an equal key means nothing the step reads has changed, so a
 * committed-only edit (an assumption, a mark, a pointer, a loop, a word's
 * position) never resets it, and neither does a zoom or level switch (they are
 * not inputs).
 *
 * Provisional: the key's spelling only. The reading is the ADR's; a fresh
 * launch computes the same key for the same model.
 */
export function activeModelKey(
  recordsDir: string,
  model: PlayingSet | null,
  links: readonly Link[],
  quantities: readonly Quantity[],
): string {
  const parts: string[] = [
    recordsDir,
    model === null ? "model:-" : `model:${model.words.join("\u0001")}`,
  ];
  for (const link of links) {
    parts.push(`link:${link.from}\u0001${link.to}\u0001${link.sign}`);
  }
  for (const quantity of quantities) {
    if (quantity.type === "stock") {
      parts.push(
        `stock:${quantity.on}\u0001${quantity.amount === null ? "?" : quantity.amount}`,
      );
    } else {
      parts.push(
        `flow:${quantity.from}\u0001${quantity.to}\u0001${quantity.amount === null ? "?" : quantity.amount}`,
      );
    }
  }
  return parts.join("\n");
}
