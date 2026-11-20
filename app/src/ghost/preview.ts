import { parseAssumptions } from "../map/assumptions";
import type { GhostEnvelope, GhostStep, GhostTarget } from "./envelope";

/*
 * The ghost layer imports NO canvas module (Epic 11 story 1's source scan):
 * what the preview needs from the rendering seam is only a word box's centre,
 * which is two additions. The types and the tiny function are restated here on
 * purpose, so the seam is a one-way door: canvas code may read ghost rules,
 * never the reverse.
 */

/** A point on the plane. */
type Point = { x: number; y: number };

/** A word box's size. */
type Box = { w: number; h: number };

/** The box's centre, given its top-left position (the canvas's own reading). */
function centerOf(pos: Point, box: Box): Point {
  return { x: pos.x + box.w / 2, y: pos.y + box.h / 2 };
}

/**
 * THE PREVIEW'S RULES (Epic 10 story 3) — what the person's opening shows, and
 * the one thing the plane may draw while it is open.
 *
 * The rule is the person's opening: `previewOf` reads a ghost ONLY when the app
 * says that ghost is the one opened, so a held proposal contributes nothing to
 * the plane or to the screen. The faint diamond at the target is the opened
 * ghost's own vocabulary — the mark the move would leave is the assumption's
 * hollow diamond — and it exists only inside that opening: `previewPoint`
 * answers null whenever nothing is opened, which is what the app mounts the
 * diamond on. Never ambient, never a cue that something is waiting.
 *
 * The derived steps are READ-ONLY: they are the deriver's list, rendered as
 * text, and a reshape re-derives them (the app re-validates the new params and
 * shows the new list). Where a reshape changed a step, the step says so and its
 * claim text stays legible — the change is a reading, not an id.
 *
 * Provisional: the preview's look and the diamond's size.
 */

/** A word as the diamond's placement reads it (the app's loaded record). */
export interface PreviewWord {
  /** The word's file slug. */
  slug: string;
  /** The record's plane position (the box's top-left). */
  pos: Point;
  /** The measured box. */
  box: Box;
}

/** A loop as the diamond's placement reads it (the route's coined name). */
export interface PreviewLoop {
  /** The loop's name-derived slug. */
  slug: string;
  /** Where the route's coined name sits on the plane. */
  nameAt: Point;
}

/**
 * THE OPENING: the one ghost the person opened, or null. Nothing else is ever
 * previewed — a ghost merely held is the list's text and no more.
 */
export function previewOf(
  ghosts: readonly GhostEnvelope[],
  openId: string | null,
): GhostEnvelope | null {
  if (openId === null) return null;
  return ghosts.find((held) => held.id === openId) ?? null;
}

/** Where the ghost's mark would sit on the plane (null: the target is gone). */
export function ghostTargetPoint(
  target: GhostTarget,
  words: readonly PreviewWord[],
  loops: readonly PreviewLoop[],
): Point | null {
  if (target.kind === "word") {
    const word = words.find((candidate) => candidate.slug === target.slug);
    return word === undefined ? null : centerOf(word.pos, word.box);
  }
  if (target.kind === "loop") {
    const loop = loops.find((candidate) => candidate.slug === target.slug);
    return loop === undefined ? null : loop.nameAt;
  }
  return null;
}

/**
 * The ONE plane reading the ghost flow contributes: the opened ghost's target
 * point, or null. Null covers both "nothing is opened" and "the target is gone
 * from the map", so the diamond can never be drawn for a held proposal.
 */
export function previewPoint(
  ghosts: readonly GhostEnvelope[],
  openId: string | null,
  words: readonly PreviewWord[],
  loops: readonly PreviewLoop[],
): Point | null {
  const opened = previewOf(ghosts, openId);
  if (opened === null) return null;
  return ghostTargetPoint(opened.target, words, loops);
}

/** One derived step as the preview reads it: text only, never an instruction. */
export interface StepView {
  /** The workspace-relative file the step writes. */
  file: string;
  /** What the step does, in the person's words ("append one line to"). */
  does: string;
  /** What the claim is about, as the person's name for it ("" when unreadable). */
  about: string;
  /** The claim's text, verbatim ("" when the line cannot be read back). */
  text: string;
  /** The line differs from the list the ghost was opened with. */
  changed: boolean;
}

/**
 * What the step DOES, in the person's words. STORY 21.6 adds the removal's two
 * readings: one line leaves a record file, or one file goes (a note).
 */
function doesOf(step: GhostStep): string {
  if (step.op === "append") return "append one line to";
  return step.line === undefined ? "remove the file" : "remove one line from";
}

/** A step's claim as the record reads it (the deriver's own line). */
function claimOf(line: string): { text: string; about: string } | null {
  const parsed = parseAssumptions(line);
  const claim = parsed.assumptions[0];
  if (claim === undefined) return null;
  if (claim.target.type === "word" || claim.target.type === "loop") {
    return { text: claim.text, about: claim.target.slug };
  }
  return { text: claim.text, about: "" };
}

/**
 * The envelope's derived steps, read-only, in the deriver's order. `previous`
 * is what the ghost held when it was opened: a step whose line differs from
 * that reading is marked changed and its claim text stays visible (a reshape
 * must read, not merely record, that something moved).
 */
export function stepViews(
  envelope: GhostEnvelope,
  previous: GhostEnvelope | null,
  nameOf: (slug: string) => string,
): StepView[] {
  return envelope.steps.map((step, index) => {
    // A removal's line is the record it takes, not a claim to parse; a file
    // removal has no line at all, and both say so by carrying the line's bytes
    // plainly.
    const claim = step.op === "append" ? claimOf(step.line) : null;
    const line = step.line ?? "";
    const before = previous === null ? undefined : previous.steps[index];
    return {
      file: step.file,
      does: doesOf(step),
      about: claim === null ? "" : claim.about === "" ? "" : nameOf(claim.about),
      text: claim === null ? line : claim.text,
      changed:
        previous !== null &&
        (before === undefined ||
          before.op !== step.op ||
          (before.line ?? "") !== line),
    };
  });
}
