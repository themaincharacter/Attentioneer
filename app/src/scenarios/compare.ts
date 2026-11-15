import { assumptionKey, type Assumption } from "../map/assumptions";
import { findLink, linkKey, type Link, type LinkSign } from "../map/links";
import {
  findQuantity,
  quantityTargetKey,
  quantityKey,
  type Quantity,
  type QuantityTarget,
} from "../map/quantities";
import { danglingPins } from "./pins";

/**
 * The comparison (ADR-0021 §7 amended, ADR-0022's reset amendment, Epic 8
 * story 4): a FROZEN TWO-VALUE READING of one branch against the committed
 * model.
 *
 * It is not a diff and never a verdict. Each row names ONE piece — a playing
 * set member, a signed link line, a quantity line — and states BOTH readings
 * as values: the branch's AUTHORED one and the committed model's reading NOW.
 * There is no delta, no change set, no score, no better-or-worse and no
 * equality claim: the software shows the two values, and the person is the one
 * who notices. That is why the row carries no classification field at all —
 * `CompareRow` is the key, the piece, and the two readings, and nothing else
 * (the Funes brake, ADR-0020 decision 5, taken to the comparison).
 *
 * THE UNION OF KEYS. The reading covers all three variant-owned key spaces —
 * the set's members, the link lines, the quantity lines (ADR-0021 decision 1:
 * the records a branch copies). A key present in only one model still gets its
 * row: a word the branch PRUNED reads "no line" on the branch side, a line the
 * branch authored reads "no line" on the committed side. Absence is never a
 * zero: a quantity line's absent amount reads as the unknown, and a piece with
 * no line reads as "no line" (`compareNotes.ts`).
 *
 * SEATING (provisional): the spaces in a fixed order — set, links, quantities —
 * and, within each space, the committed model's own file order first (the
 * canonical member order; the lines' order in `links.jsonl` /
 * `quantities.jsonl`), with the branch-only lines of that space APPENDED in
 * the branch's order. A hand-duplicated key is read once, at its first line —
 * the first-occurrence reading the map's own `findLink` / `findQuantity` use;
 * the duplicate itself is the notices strip's to surface, never repaired here.
 *
 * COMMITTED-ONLY CLAIMS. Assumptions are not one of the three key spaces —
 * the branch copies them as PINS, not as rows — but a claim the branch's pins
 * do not cover is still a committed-only piece, so it gets its seat: the
 * `unpinned` list below, in committed file order, said once with the branch's
 * dangling premises (never per row; a premise is a claim about the branch, not
 * a value of a piece).
 *
 * THE FRAME IS BRANCH ↔ COMMITTED (issue 04's ruling). A branch is a copy with
 * no base marker (ADR-0021 decision 6), so two branches have nothing shared to
 * read against; `comparisonFrame` refuses that frame. The branch side is an
 * EXPLICIT pick of the session, never the resume hint, and it is the branch's
 * AUTHORED values only: the ephemeral run's current amounts live in the step's
 * own display (ADR-0022) and are never substituted here.
 *
 * A reading never resets the run. The frozen value this module returns is app
 * state the panel holds; reading it again is another reading (no reset), and
 * nothing here is an input of `activeModelKey`.
 *
 * Provisional (ADR-0003/ADR-0021): the space order, the first-occurrence
 * reading of a hand-duplicated key, and the row shape. The wording is
 * `compareNotes.ts`'s.
 */

/** The three variant-owned key spaces, in seating order (provisional). */
export const COMPARE_SPACES = ["set", "links", "quantities"] as const;

export type CompareSpace = (typeof COMPARE_SPACES)[number];

/** One piece the union names: a set member, a link line, or a quantity line. */
export type ComparePiece =
  | { space: "set"; word: string }
  | { space: "links"; from: string; to: string }
  | { space: "quantities"; target: QuantityTarget };

/**
 * One side's reading. The OUTER `null` on a row's side is "no line" — the
 * piece is not in that model at all. A present line always states a value:
 *
 *   - a set member is in the set (`member`);
 *   - a link line carries its authored sign;
 *   - a quantity line carries its amount — and an absent amount is the
 *     UNKNOWN reading (`amount: null`), never 0. A stated 0 is a real amount
 *     and reads as 0.
 */
export type CompareValue =
  | { kind: "member" }
  | { kind: "sign"; sign: LinkSign }
  | { kind: "amount"; amount: number | null };

/** One row of the frozen reading. */
export interface CompareRow {
  /** The union key: the space tag plus the piece's natural key. */
  key: string;
  /** What the row is about. */
  piece: ComparePiece;
  /** The committed model's reading now (null = no line). */
  committed: CompareValue | null;
  /** The branch's AUTHORED reading (null = no line). Never the run's amounts. */
  branch: CompareValue | null;
}

/** The two models the reading is seated over. */
export interface CompareModel {
  /** The playing set's words, or null when none was accepted. */
  words: readonly string[] | null;
  links: readonly Link[];
  quantities: readonly Quantity[];
}

/** The frozen reading of one branch against the committed model. */
export interface Comparison {
  /** The branch the reading was taken of (the frame's one explicit pick). */
  branch: string;
  /** The union rows, seated: committed order first, branch-only lines appended. */
  rows: CompareRow[];
  /**
   * The branch's pins that no longer stand on the committed file (the
   * predicate is `pins.ts`'s), in pin order. The PRESENTATION is once, not
   * per row (`compareNotes.ts` / the panel): a premise is a claim about the
   * branch, not a value of a piece.
   */
  dangles: readonly Assumption[];
  /**
   * Committed claims the branch's pins do not cover, in committed file order.
   * With all-or-none pinning these are claims that arrived after the branch
   * (or were hand-edited in): they are a committed-only piece and get their
   * seat here, once, beside the dangling premises.
   */
  unpinned: readonly Assumption[];
}

/** Everything a comparison is read from. */
export interface ComparisonSource {
  /** The committed model's three records (`map/`). */
  committed: CompareModel;
  /** The branch's three records (`scenarios/<slug>/`). */
  branch: CompareModel;
  /** The branch's pins, in file order. */
  pins: readonly Assumption[];
  /** The committed claims the pins stand on — the dangle predicate's ground. */
  committedAssumptions: readonly Assumption[];
}

/** The union key of one piece (space-tagged: the spaces never collide). */
export function compareKey(piece: ComparePiece): string {
  switch (piece.space) {
    case "set":
      return `set\u0000${piece.word}`;
    case "links":
      return `links\u0000${linkKey(piece.from, piece.to)}`;
    case "quantities":
      return `quantities\u0000${quantityTargetKey(piece.target)}`;
  }
}

/** The first line per natural key, in file order (the map's own reading). */
function seatOnce<T>(items: readonly T[], keyOf: (item: T) => string): T[] {
  const seen = new Set<string>();
  const seated: T[] = [];
  for (const item of items) {
    const key = keyOf(item);
    if (seen.has(key)) continue;
    seen.add(key);
    seated.push(item);
  }
  return seated;
}

/** One set member's reading in a set (null = no line: it is not a member). */
function memberReading(words: ReadonlySet<string>, word: string): CompareValue | null {
  return words.has(word) ? { kind: "member" } : null;
}

/** One link line's reading (null = no line). */
function linkReading(
  links: readonly Link[],
  from: string,
  to: string,
): CompareValue | null {
  const link = findLink(links, from, to);
  return link === null ? null : { kind: "sign", sign: link.sign };
}

/** One quantity line's reading (null = no line; an absent amount is unknown). */
function quantityReading(
  quantities: readonly Quantity[],
  target: QuantityTarget,
): CompareValue | null {
  const found = findQuantity(quantities, target);
  return found === null ? null : { kind: "amount", amount: found.quantity.amount };
}

/**
 * The union reading: every key of all three spaces, seated. Pure and
 * deterministic — the frozen value is a function of the two models alone.
 */
export function compareModels(
  committed: CompareModel,
  branch: CompareModel,
): CompareRow[] {
  const rows: CompareRow[] = [];

  // THE SET: members in canonical order, then the branch's own.
  const committedWords = seatOnce(committed.words ?? [], (word) => word);
  const branchWords = seatOnce(branch.words ?? [], (word) => word);
  const committedSet = new Set(committedWords);
  const branchSet = new Set(branchWords);
  for (const word of committedWords) {
    const piece: ComparePiece = { space: "set", word };
    rows.push({
      key: compareKey(piece),
      piece,
      committed: { kind: "member" },
      branch: memberReading(branchSet, word),
    });
  }
  for (const word of branchWords) {
    if (committedSet.has(word)) continue;
    const piece: ComparePiece = { space: "set", word };
    rows.push({
      key: compareKey(piece),
      piece,
      committed: null,
      branch: { kind: "member" },
    });
  }

  // THE LINKS: the committed file's order, then the branch's own.
  const committedLinks = seatOnce(committed.links, (link) =>
    linkKey(link.from, link.to),
  );
  const branchLinks = seatOnce(branch.links, (link) =>
    linkKey(link.from, link.to),
  );
  const committedLinkKeys = new Set(
    committedLinks.map((link) => linkKey(link.from, link.to)),
  );
  for (const link of committedLinks) {
    const piece: ComparePiece = { space: "links", from: link.from, to: link.to };
    rows.push({
      key: compareKey(piece),
      piece,
      committed: { kind: "sign", sign: link.sign },
      branch: linkReading(branchLinks, link.from, link.to),
    });
  }
  for (const link of branchLinks) {
    if (committedLinkKeys.has(linkKey(link.from, link.to))) continue;
    const piece: ComparePiece = { space: "links", from: link.from, to: link.to };
    rows.push({
      key: compareKey(piece),
      piece,
      committed: null,
      branch: { kind: "sign", sign: link.sign },
    });
  }

  // THE QUANTITIES: the committed file's order, then the branch's own.
  const committedQuantities = seatOnce(committed.quantities, quantityKey);
  const branchQuantities = seatOnce(branch.quantities, quantityKey);
  const committedQuantityKeys = new Set(committedQuantities.map(quantityKey));
  for (const quantity of committedQuantities) {
    const target: QuantityTarget =
      quantity.type === "stock"
        ? { type: "stock", on: quantity.on }
        : { type: "flow", from: quantity.from, to: quantity.to };
    const piece: ComparePiece = { space: "quantities", target };
    rows.push({
      key: compareKey(piece),
      piece,
      committed: { kind: "amount", amount: quantity.amount },
      branch: quantityReading(branchQuantities, target),
    });
  }
  for (const quantity of branchQuantities) {
    if (committedQuantityKeys.has(quantityKey(quantity))) continue;
    const target: QuantityTarget =
      quantity.type === "stock"
        ? { type: "stock", on: quantity.on }
        : { type: "flow", from: quantity.from, to: quantity.to };
    const piece: ComparePiece = { space: "quantities", target };
    rows.push({
      key: compareKey(piece),
      piece,
      committed: null,
      branch: { kind: "amount", amount: quantity.amount },
    });
  }

  return rows;
}

/**
 * Freeze the reading of one branch against the committed model: the union rows
 * plus the branch's dangling premises. Pure — the callers are the panel's open
 * and its re-read, and both hold the returned value (no live recompute).
 */
export function comparisonOf(
  branch: string,
  source: ComparisonSource,
): Comparison {
  return {
    branch,
    rows: compareModels(source.committed, source.branch),
    dangles: danglingPins(source.pins, source.committedAssumptions),
    unpinned: unpinnedClaims(source.pins, source.committedAssumptions),
  };
}

/**
 * The committed claims the branch's pins do not cover, in committed file
 * order. A pin is an exact (target, text) pair, so a claim that stands now and
 * was never pinned (it arrived after the branch, or a rival was stated) is
 * committed-only and gets its seat in the premises block. Pure.
 */
export function unpinnedClaims(
  pins: readonly Assumption[],
  committed: readonly Assumption[],
): Assumption[] {
  const pinned = new Set(pins.map(assumptionKey));
  return committed.filter((claim) => !pinned.has(assumptionKey(claim)));
}

/** One side of the frame: the committed model, or one named branch. */
export type CompareSide = { kind: "committed" } | { kind: "branch"; slug: string };

/** Why a frame was refused. The wording lives in `compareNotes.ts`. */
export type CompareRefusal = "no-branch" | "two-branches";

/** The frame's answer: the one branch to read, or the refusal. */
export type CompareFrame =
  | { ok: true; branch: string }
  | { ok: false; refusal: CompareRefusal };

/**
 * The frame: branch ↔ committed ONLY. Two branches share no base (a branch
 * carries no marker of what it was copied from — ADR-0021 decision 6), so a
 * branch-against-branch frame is refused rather than guessed at; a frame with
 * no branch at all has nothing to read. Exactly one branch side is the legal
 * frame, and it is the branch the reading is taken of.
 */
export function comparisonFrame(
  left: CompareSide,
  right: CompareSide,
): CompareFrame {
  const leftBranch = left.kind === "branch" ? left.slug : null;
  const rightBranch = right.kind === "branch" ? right.slug : null;
  if (leftBranch !== null && rightBranch !== null) {
    return { ok: false, refusal: "two-branches" };
  }
  if (leftBranch === null && rightBranch === null) {
    return { ok: false, refusal: "no-branch" };
  }
  return { ok: true, branch: leftBranch ?? (rightBranch as string) };
}
