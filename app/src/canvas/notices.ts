import type { AssumptionTarget } from "../map/assumptions";
import type { QuantityTarget } from "../map/quantities";
import type { WordGap, WalkStep } from "../map/loopRead";
import type { MarkTarget } from "../map/marks";
import type { Level } from "../workspace/level";

/**
 * The notices strip and the person-facing sentences (Epic 6 story 3).
 *
 * THE STRIP IS BAND-SCOPED. It used to be the one unbanded aggregator: every
 * orphaned mark, link, loop, assumption and pointer was named at once, whatever
 * game the plane was showing. ADR-0019's no-aggregation rule and ADR-0016's
 * honest partition say otherwise — a dynamics-only record's notice belongs to
 * dynamics, a pointer's to ground. Each family is assigned to its game here,
 * and the strip renders ONLY the running game's groups plus the one group every
 * game shares (marks, distances and the shelf render in every game). Veils are
 * the exception the table states out loud (ADR-0023): they cover levels 1–2,
 * so they belong to no single game, and their notices are record hygiene —
 * unreadable `map/veils.jsonl` lines ride the shared group wherever the person
 * is (the strip is not the cover). Each group is headed by its game's name, so
 * a line always says which game it is about.
 * Provisional: grouping per game rather than prefixing every line (both satisfy
 * the rule; the grouping is the quieter look).
 *
 * NAMES, NOT SLUGS, in every person-facing string. A slug is record identity —
 * it stays in the files and in the pure reads (`readLoop`, mark targets); what
 * the person reads should be the word's coined name. The helpers take a
 * resolver so the strip, the walk and the overlays all use one mapping, and a
 * slug that is genuinely gone (an orphan, a dangling path word) falls back to
 * itself: the record is the only name left.
 */

/** The record families the strip can report. */
export type NoticeFamily =
  | "marks"
  | "links"
  | "model"
  | "loops"
  | "assumptions"
  | "pointers"
  | "veils";

/** A family's game, or "all" for the content every game renders. */
export type NoticeGame = Level | "all";

/**
 * Which game owns each family's notice (RENDER_MAP's readings, one table):
 * marks render in every game; links, the playing set, loops and assumptions
 * are dynamics' own records; pointers are ground's.
 *
 * VEILS are the one family that is not a game's OWN record (ADR-0023): a veil
 * covers levels 1–2 and its sheet is absent at ground, so the table cannot say
 * "one game". Its notices are also RECORD HYGIENE, not the cover — an
 * unreadable `map/veils.jsonl` line is surfaced wherever the person is, never
 * hidden because the sheet is. They ride the shared "every game" group with the
 * marks, and `veils.jsonl` is the only file they name.
 */
export const NOTICE_FAMILY_GAME: Record<NoticeFamily, NoticeGame> = {
  marks: "all",
  links: "dynamics",
  model: "dynamics",
  loops: "dynamics",
  assumptions: "dynamics",
  pointers: "ground",
  veils: "all",
};

/** The game a family's notices belong to. */
export function noticeGame(family: NoticeFamily): NoticeGame {
  return NOTICE_FAMILY_GAME[family];
}

/** Is this family's game the running one (or every game's)? */
export function noticeVisibleIn(family: NoticeFamily, level: Level): boolean {
  const game = noticeGame(family);
  return game === "all" || game === level;
}

/** One rendered group: a quiet heading naming the game, and its families. */
export interface NoticeGroup {
  game: NoticeGame;
  /** The heading's word — a game's name, or "every game". */
  label: string;
  families: NoticeFamily[];
}

/**
 * The groups the strip renders in this game: the shared group first (the
 * content every game renders), then the running game's own — and never a group
 * for a game that is not running. Concept owns no record family, so it shows
 * only the shared group.
 */
export function noticeGroups(level: Level): NoticeGroup[] {
  // The shared group is every family assigned to "all" — read from the table so
  // a new shared family (the veils, ADR-0023) can never be stranded.
  const shared = (Object.keys(NOTICE_FAMILY_GAME) as NoticeFamily[]).filter(
    (family) => noticeGame(family) === "all",
  );
  const groups: NoticeGroup[] = [
    { game: "all", label: "every game", families: shared },
  ];
  const own = (Object.keys(NOTICE_FAMILY_GAME) as NoticeFamily[]).filter(
    (family) => noticeGame(family) === level,
  );
  if (own.length > 0) groups.push({ game: level, label: level, families: own });
  return groups;
}

/** The person's name for a slug, or the slug itself when the word is gone. */
export type NameOf = (slug: string) => string;

/**
 * A quiet name for a mark's target (the strip). The slugs the records carry
 * become the person's names; a distance's coined word is already a word.
 */
export function describeMarkTarget(
  target: MarkTarget,
  nameOf: NameOf,
): string {
  switch (target.type) {
    case "word":
      return `“${nameOf(target.slug)}”`;
    case "wire":
      return `the wire ${nameOf(target.from)} → ${nameOf(target.to)} · “${target.word}”`;
    case "link":
      return `the link ${nameOf(target.from)} → ${nameOf(target.to)}`;
    case "spot":
      return "a bare spot";
    case "pointer":
      return `the reach ${nameOf(target.on)} · ${target.form} “${target.value}”`;
  }
}

/** A quiet name for what an assumption is about (the strip and the overlay). */
export function describeAssumptionTarget(
  target: AssumptionTarget,
  nameOf: NameOf,
): string {
  switch (target.type) {
    case "word":
      return `“${nameOf(target.slug)}”`;
    case "link":
      return `the link ${nameOf(target.from)} → ${nameOf(target.to)}`;
    case "loop":
      return `the loop “${nameOf(target.slug)}”`;
    case "spot":
      return "a bare spot";
  }
}

/**
 * A quiet name for what a quantity line is on (the amount card's aria and the
 * notices): a word's stock or a flow's ordered pair, in the person's names.
 */
export function describeQuantityTarget(
  target: QuantityTarget,
  nameOf: NameOf,
): string {
  return target.type === "stock"
    ? `“${nameOf(target.on)}”`
    : `${nameOf(target.from)} → ${nameOf(target.to)}`;
}

/**
 * A walk step's pair, in names: "rain → soil", never the record's slugs. The
 * pure read keeps slugs (world B: the record is the identity); only the
 * sentence a person reads goes through the resolver.
 */
export function walkStepPair(step: WalkStep, nameOf: NameOf): string {
  return `${nameOf(step.from)} → ${nameOf(step.to)}`;
}

/** A walk step's note: the gap that withheld a sign, or null for a sign. */
export function walkStepNote(step: WalkStep, nameOf: NameOf): string | null {
  if (step.kind === "sign") return null;
  if (step.gap.kind === "marked-link") return "sign unsettled";
  return step.gap.reverse
    ? `missing link — runs the other way: ${nameOf(step.to)} → ${nameOf(step.from)} exists`
    : "missing link";
}

/** A path word's gap, in names ("word “rain” is not on the map"). */
export function walkWordGapText(gap: WordGap, nameOf: NameOf): string {
  return gap.kind === "dangling"
    ? `word “${nameOf(gap.slug)}” is not on the map`
    : `“${nameOf(gap.slug)}” is outside the playing set`;
}
