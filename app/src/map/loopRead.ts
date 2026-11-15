import { findLink, linkKey, type Link, type LinkSign } from "./links";
import { isClosedPath, type Loop } from "./loops";
import type { Mark } from "./marks";
import { hasWord, type PlayingSet } from "./model";

/**
 * A loop's walk (ADR-0015, the ruling in full): the read is DERIVED from the
 * authored records on every change — never stored, never cached in a file.
 *
 * - Only a stored (named) loop is read. The walk is exact-direction over the
 *   closed path: each consecutive pair must match a link's (from, to) key.
 *   A reverse-only link is a gap named "runs the other way", never quietly
 *   accepted; a 2-cycle needs BOTH directed links; a repeated pair is read per
 *   step (the path is the person's claim, never second-guessed).
 * - Mark precedence: a mark on a link overrides its stored sign while it
 *   stands. The file keeps the sign; the read and the pixels show unknown;
 *   withdrawing the mark restores both. A mark may doubt existence or
 *   direction, not only sign.
 * - The verdict word — reinforcing or balancing, the glossary's parity rule —
 *   appears IFF every step resolves to a known sign AND every path word is on
 *   the map and in the playing set. Otherwise the read shows the signs it
 *   resolved and names the gaps; `verdict` is null and no verdict word exists
 *   anywhere in the result.
 * - A self-link is a legal one-step loop (`[A,A]`): `+` reads reinforcing,
 *   `-` balancing, no special case.
 * - No numerals, ratios or strength meters: parity only (ADR-0012 decision 7).
 *
 * Pure and DOM-free so the matrix is asserted without a window (World B: the
 * software reads authored structure and never interprets a word).
 */

/** The glossary's two words; the only verdict vocabulary there is. */
export type LoopVerdict = "reinforcing" | "balancing";

/** Why one step did not resolve to a sign. */
export type StepGap =
  | {
      /** No exact-direction link line exists for this pair. */
      kind: "missing-link";
      /** The reverse line exists: "runs the other way: B->A exists". */
      reverse: boolean;
    }
  | {
      /** The link exists but carries an open mark: its sign is unknown. */
      kind: "marked-link";
    };

/** One step of the walk: a resolved sign, or the gap that withheld it. */
export type WalkStep =
  | { kind: "sign"; from: string; to: string; sign: LinkSign }
  | { kind: "gap"; from: string; to: string; gap: StepGap };

/** Why the path itself cannot complete a walk. */
export type PathGap =
  | { kind: "unclosed" }
  | { kind: "no-steps" };

/** Why one path word cannot carry a complete read. */
export type WordGap =
  | { kind: "dangling"; slug: string }
  | { kind: "out-of-play"; slug: string };

/** The read, ready to render: steps, named gaps, and the verdict if complete. */
export interface LoopRead {
  /** The loop's coined name (the walk's heading). */
  name: string;
  /** The closed path as stored, in walk order. */
  path: string[];
  steps: WalkStep[];
  wordGaps: WordGap[];
  pathGaps: PathGap[];
  /** True only when every step has a known sign and every word qualifies. */
  complete: boolean;
  /** The parity word, or null while any gap stands. */
  verdict: LoopVerdict | null;
}

/** What the read reads: the authored records, as the canvas holds them. */
export interface LoopReadContext {
  links: readonly Link[];
  marks: readonly Mark[];
  /** The playing set; null means no accepted set, so nothing is in play. */
  model: PlayingSet | null;
  /** Every reference slug currently on the map. */
  words: ReadonlySet<string>;
}

/** Is the pair's wordless link carrying an open mark right now? */
function isLinkMarked(
  marks: readonly Mark[],
  from: string,
  to: string,
): boolean {
  const key = linkKey(from, to);
  return marks.some(
    (mark) =>
      mark.kind === "open" &&
      mark.target.type === "link" &&
      linkKey(mark.target.from, mark.target.to) === key,
  );
}

/** The parity word: reinforcing on an even number of "−", balancing on odd. */
function parityWord(negatives: number): LoopVerdict {
  return negatives % 2 === 0 ? "reinforcing" : "balancing";
}

/**
 * Read one stored loop's walk. Every call recomputes from the records passed
 * in — a flipped sign or a cast mark changes the answer in the same breath,
 * and nothing about the answer is ever written back.
 */
export function readLoop(loop: Loop, context: LoopReadContext): LoopRead {
  const { links, marks, model, words } = context;
  const path = [...loop.path];

  const steps: WalkStep[] = [];
  for (let i = 0; i + 1 < path.length; i += 1) {
    const from = path[i];
    const to = path[i + 1];
    const link = findLink(links, from, to);
    if (link === null) {
      steps.push({
        kind: "gap",
        from,
        to,
        gap: { kind: "missing-link", reverse: findLink(links, to, from) !== null },
      });
      continue;
    }
    if (isLinkMarked(marks, from, to)) {
      // Mark precedence: the stored sign stays in the file and is NOT shown.
      steps.push({ kind: "gap", from, to, gap: { kind: "marked-link" } });
      continue;
    }
    steps.push({ kind: "sign", from, to, sign: link.sign });
  }

  const wordGaps: WordGap[] = [];
  const seen = new Set<string>();
  for (const slug of path) {
    if (seen.has(slug)) continue;
    seen.add(slug);
    if (!words.has(slug)) {
      wordGaps.push({ kind: "dangling", slug });
    } else if (!hasWord(model, slug)) {
      wordGaps.push({ kind: "out-of-play", slug });
    }
  }

  const pathGaps: PathGap[] = [];
  if (path.length < 2) {
    pathGaps.push({ kind: "no-steps" });
  } else if (!isClosedPath(path)) {
    pathGaps.push({ kind: "unclosed" });
  }

  const complete =
    pathGaps.length === 0 &&
    wordGaps.length === 0 &&
    steps.length > 0 &&
    steps.every((step) => step.kind === "sign");

  let negatives = 0;
  for (const step of steps) {
    if (step.kind === "sign" && step.sign === "-") negatives += 1;
  }

  return {
    name: loop.name,
    path,
    steps,
    wordGaps,
    pathGaps,
    complete,
    verdict: complete ? parityWord(negatives) : null,
  };
}
