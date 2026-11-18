import type { Level } from "../workspace/level";
import type { Point } from "./geometry";
import { creationNoun } from "./mapContentRules";
import type { DrawTool } from "./sketchRules";

/**
 * STORY 16.16 (shortlist items 4 and 5) — THE GESTURE'S WORDS, in one table.
 *
 * The map is all gestures, and until now the app narrated none of them: a hand
 * dragging a card, panning, zooming or drawing got no sentence (shortlist item
 * 4: "cursor chip narrates the verb"), and the armed tools spoke only in the
 * pen's strip or the idle hint at the bottom of the plane (item 5: "a
 * bottom-centre bar whose sentence IS the armed tool").
 *
 * This module is the PURE half: a small gesture state becomes ONE sentence and
 * nothing else. The chip (`GestureChip.tsx`) and the bar (`ArmedBar.tsx`)
 * only render what is decided here, so the rule is testable without a DOM and
 * no component can quietly grow a second vocabulary.
 *
 * THE RULE FOR EVERY SENTENCE HERE: it NAMES the gesture in the map's own nouns
 * — it never suggests a next one, never counts completed work, never reports
 * progress and never persists. "release on a card to link" is the wiring
 * gesture's own end (the drag's meaning), not advice; everything else is a
 * present participle and nothing more. Words come from the existing rules
 * (`creationNoun`), never from a parallel word list.
 *
 * WHAT IS NOT NARRATED, deliberately: the selector's lasso, the veil's box and
 * the selection tool's shapes. Those drags DO exist, but narrating them as a
 * selection would imply a marquee we do not have (the story forbids exactly
 * that), and the selection tool is PROVISIONAL. They keep their own bars.
 */

/**
 * The one gesture in flight. `idle` is the absence of a gesture — the chip is
 * not rendered for it, and the bar asks its own question (an armed TOOL is not
 * a gesture: a pen can be down with no hand on it).
 */
export type GestureNarration =
  | { readonly kind: "idle" }
  | { readonly kind: "moving"; readonly name: string }
  | { readonly kind: "panning" }
  | { readonly kind: "zooming" }
  | { readonly kind: "drawing" }
  | { readonly kind: "erasing" }
  | { readonly kind: "wiring" };

/** Nothing is in flight (the shape App's state opens on). */
export const GESTURE_IDLE: GestureNarration = { kind: "idle" };

/**
 * The chip's ONE sentence, or null when no gesture is active (nothing to say,
 * so nothing renders — the chip never lingers as an empty pill).
 *
 * "lifting the pen" is the ERASER: the tool pair is pen/eraser, and lifting the
 * ink a pen laid down is exactly what that gesture is, said in the pen's own
 * words. PROVISIONAL: "moving <name>" uses the person's own noun for the card
 * (never a slug).
 */
export function gestureSentence(gesture: GestureNarration): string | null {
  switch (gesture.kind) {
    case "idle":
      return null;
    case "moving":
      return "moving " + gesture.name;
    case "panning":
      return "panning";
    case "zooming":
      return "zooming";
    case "drawing":
      return "drawing";
    case "erasing":
      return "lifting the pen";
    case "wiring":
      return "release on a card to link";
  }
}

/**
 * Which gesture d3-zoom's event is — read from the SOURCE event's own name and
 * touch count, never inferred from the transform (a programmatic camera move
 * carries no source event and must narrate nothing). A wheel or a multi-finger
 * touch is a ZOOM; a press-and-drag is a PAN. `touches` is the source event's
 * live touch count (0 when it has none).
 */
export function planeGestureWord(
  sourceType: string | undefined,
  touches: number = 0,
): GestureNarration | null {
  if (sourceType === "wheel") return { kind: "zooming" };
  if (
    sourceType === "touchstart" ||
    sourceType === "touchmove" ||
    sourceType === "touchend"
  ) {
    return touches > 1 ? { kind: "zooming" } : { kind: "panning" };
  }
  if (
    sourceType === "mousedown" ||
    sourceType === "mousemove" ||
    sourceType === "mouseup"
  ) {
    return { kind: "panning" };
  }
  return null;
}

/**
 * Where the chip sits next to the pointer: a little below and to the right, so
 * it never sits under the hand or over the point being pressed. Clamped into
 * the viewport so a gesture near an edge keeps the sentence readable.
 * PROVISIONAL: the offset and the box estimate (the chip's own max width is the
 * stylesheet's; this is the same reading, kept square with it).
 */
export const CHIP_OFFSET: Point = { x: 18, y: 20 };
export const CHIP_ESTIMATE_W = 220;
export const CHIP_ESTIMATE_H = 28;
export const CHIP_MARGIN = 8;

export function chipPoint(
  pointer: Point,
  viewport: { width: number; height: number },
): Point {
  const left = Math.min(
    pointer.x + CHIP_OFFSET.x,
    Math.max(CHIP_MARGIN, viewport.width - CHIP_ESTIMATE_W - CHIP_MARGIN),
  );
  const top = Math.min(
    pointer.y + CHIP_OFFSET.y,
    Math.max(CHIP_MARGIN, viewport.height - CHIP_ESTIMATE_H - CHIP_MARGIN),
  );
  return { x: Math.max(CHIP_MARGIN, left), y: Math.max(CHIP_MARGIN, top) };
}

/* ----------------------------------------------------------------------- *
 * THE ARMED BAR (shortlist item 5).
 * ----------------------------------------------------------------------- */

/**
 * The tool that is armed right now — the bar's whole subject. A gesture in
 * flight can arm one too (the link drag), and so can a creation surface (the
 * ground bubble asking for a reference): each is a tool the next press will
 * use, whether or not a hand is on it yet.
 */
export type ArmedKind = "pen" | "eraser" | "linking" | "reference";

/** The bar's sentence, split so the noun can be emphasised and nothing else. */
export interface ArmedSentence {
  readonly before: string;
  readonly noun: string;
  readonly after: string;
}

/**
 * Which tool is armed, or null when none is (then the bar does not render and
 * the plane's idle hint has the floor). The pen family wins: while the drawing
 * mode is armed nothing else can be pressed at all.
 */
export function armedKind(
  drawArmed: boolean,
  drawTool: DrawTool,
  gesture: GestureNarration,
  referenceBubbleOpen: boolean,
): ArmedKind | null {
  if (drawArmed) return drawTool === "eraser" ? "eraser" : "pen";
  if (gesture.kind === "wiring") return "linking";
  if (referenceBubbleOpen) return "reference";
  return null;
}

/**
 * The bar's ONE sentence, in the map's own words: the tool as a state, with its
 * noun emphasised. "adding a reference" reuses `creationNoun` — the same noun
 * the idle hint offers — so the two channels cannot describe one tool two ways.
 * No verb of advice, no count, no dismiss: when the tool is put down the bar
 * simply goes. PROVISIONAL: the wording.
 */
export function armedSentence(kind: ArmedKind, level: Level): ArmedSentence {
  switch (kind) {
    case "pen":
      // The bar says what the tool MEANS, not just that it is selected: the
      // story's check is "arm the pen: a bar says you are drawing".
      return { before: "drawing with the ", noun: "pen", after: "" };
    case "eraser":
      return { before: "lifting ink with the ", noun: "eraser", after: "" };
    case "linking":
      return { before: "linking ", noun: "two cards", after: "" };
    case "reference":
      return { before: "adding a ", noun: creationNoun(level), after: "" };
  }
}
