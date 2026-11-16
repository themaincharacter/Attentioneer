import { centerOf, pointInPolygon } from "./geometry";
import { showsMapContent } from "./mapContentRules";
import type { Level } from "../workspace/level";
import type { GamePoint, GameShape } from "../map/languageGames";
import type { GestureMode } from "./gates";

/**
 * The selection tool's pure rules (PROVISIONAL, added 2026-11-16 per the
 * lead's brief): the shape a drag draws, what a shape holds, the pastel it
 * gets and whether it may be saved as a LANGUAGE GAME.
 *
 * THE TOOL is a quiet `select` toggle on the CONCEPT map, placed beside the
 * pen in the level control. It is its own GATE MODE (`"select"`, gates.ts),
 * exactly like the pen's draw arm: while it is armed pan, double-click
 * creation and every word press stand still, the wheel still zooms, and its
 * own capture surface (rendered only while armed, in CanvasPlane) owns the
 * pointer. A drag on the plane draws one of three shapes:
 *
 *   - FREEFORM (the default): the sampled drag path becomes a polygon, and
 *     the release CLOSES it with a straight segment back to the first point.
 *     Fewer than three samples enclose no area and draw nothing.
 *   - CIRCLE: the drag is the circle's DIAMETER — the two drag endpoints are
 *     the opposite ends of the diameter, so the drag's whole extent defines
 *     the circle (PROVISIONAL: the alternative reading, centre-to-edge, would
 *     make the press the centre; the diameter keeps the gesture's shape
 *     consistent with the rectangle's corner-to-corner drag).
 *   - RECTANGLE: corner to corner, in any direction (the veil's box rule).
 *
 * WHAT A SHAPE HOLDS is derived, never stored: the words whose ANCHOR POINT —
 * the centre of the word's measured box, the map's one "in a region" reading
 * (the lasso's and the veil's) — falls inside the shape, and the distance
 * WIRES whose BOTH endpoint words are held. A game stores only its drawn
 * shape (map/languageGames.ts), so moving a word changes what its regions
 * hold without a write. Empty-area selections are allowed to DRAW (the fill
 * and the popup appear), but they cannot be saved: the popup says so plainly.
 *
 * THE COLOUR is a random pastel, chosen when the shape completes. The rng is
 * INJECTED so a test can pin the colour byte-for-byte and prove the pastel
 * range; the app passes `Math.random`. The record stores the chosen string
 * verbatim and the render falls back to this module's quiet default when a
 * hand-edited value cannot be painted (the ink's rule).
 *
 * CONCEPT ONLY. The tool, the fills and the language games' door live on the
 * concept map; `languageGamesLive` is the ONE reading (it asks the
 * separate-maps rule, canvas/mapContentRules.ts), so the other maps stay
 * blank. It deliberately does NOT join `MAP_CONTENT_FAMILIES`: that class is
 * the deprecated copy-over's inventory (what the pre-review app copied into
 * every game), and this is a new feature reading the same rule.
 *
 * Provisional (the brief's list): the three shapes and the circle's
 * diameter reading, the anchor point, the "both ends in" wire rule, the
 * pastel range, case-sensitive name uniqueness, and the record's line shape.
 */

/** The selection tool's mode, named once so the app and its tests agree. */
export const SELECT_MODE: GestureMode = "select";

/** Screen pixels the pointer must travel before the drag takes a sample. */
export const SELECT_STEP_PX = 3;

/** The three shapes the armed strip offers. */
export type ShapeMode = "freeform" | "circle" | "rect";

/** In the strip's order: the freeform shape opens the tool (the default). */
export const SHAPE_MODES: readonly ShapeMode[] = ["freeform", "circle", "rect"];

export const DEFAULT_SHAPE_MODE: ShapeMode = "freeform";

/** The strip's word for each shape (the button's label and title). */
export const SHAPE_MODE_LABELS: Record<ShapeMode, string> = {
  freeform: "freeform",
  circle: "circle",
  rect: "rectangle",
};

/** Does this game show the concept map's language games right now? */
export function languageGamesLive(level: Level): boolean {
  return showsMapContent(level);
}

/* ------------------------------------------------------------------------- *
 * The drag: three shapes, and the auto-close.
 * ------------------------------------------------------------------------- */

/**
 * The freeform drag as a CLOSED polygon. The sampled path IS the ring; the
 * release closes it with an implicit straight segment back to the first point,
 * so the ring never repeats its first point (the record stays the hand's path,
 * and every hit test closes it). Fewer than three samples enclose no area —
 * a click, or a straight sliver, draws nothing (the lasso's rule).
 */
export function freeformShape(path: readonly GamePoint[]): GameShape | null {
  if (path.length < 3) return null;
  return {
    kind: "polygon",
    points: path.map((point) => ({ x: point.x, y: point.y })),
  };
}

/**
 * The circle a diameter drag defines: the two endpoints are opposite ends of
 * the diameter, so the centre is their midpoint and the radius half their
 * distance. A press that never moved makes no circle.
 */
export function circleFromDrag(
  start: GamePoint,
  end: GamePoint,
): GameShape | null {
  const radius = Math.hypot(end.x - start.x, end.y - start.y) / 2;
  if (!Number.isFinite(radius) || !(radius > 0)) return null;
  return {
    kind: "circle",
    cx: (start.x + end.x) / 2,
    cy: (start.y + end.y) / 2,
    r: radius,
  };
}

/**
 * The rectangle a corner-to-corner drag defines, in any direction (the veil's
 * `capturedBox` reading). A drag with no extent in either direction draws
 * nothing; a hand-edited non-positive rectangle is out of shape at the record.
 */
export function rectFromDrag(
  start: GamePoint,
  end: GamePoint,
): GameShape | null {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x);
  const h = Math.abs(end.y - start.y);
  if (!Number.isFinite(w) || !Number.isFinite(h) || !(w > 0) || !(h > 0)) {
    return null;
  }
  return { kind: "rect", x, y, w, h };
}

/**
 * What one released drag means in the armed shape mode. The mode is fixed at
 * the PRESS (the plane's rule, so toggling the strip mid-drag cannot turn a
 * shape into another); `path` is the sampled drag path (the first point
 * included), and `end` is the last sampled point. Null means nothing was
 * drawn: a click, or a degenerate circle/rectangle.
 */
export function shapeFromDrag(
  mode: ShapeMode,
  start: GamePoint,
  end: GamePoint,
  path: readonly GamePoint[],
): GameShape | null {
  if (mode === "freeform") return freeformShape(path);
  if (mode === "circle") return circleFromDrag(start, end);
  return rectFromDrag(start, end);
}

/* ------------------------------------------------------------------------- *
 * What a shape holds: the point tests, and the derived membership.
 * ------------------------------------------------------------------------- */

/** Is the point inside the circle? The border counts as inside; r <= 0 holds nothing. */
export function pointInCircle(
  point: GamePoint,
  cx: number,
  cy: number,
  r: number,
): boolean {
  if (!(r > 0)) return false;
  return Math.hypot(point.x - cx, point.y - cy) <= r;
}

/** Is the point inside the rectangle? Border inclusive; a non-positive size holds nothing. */
export function pointInRect(
  point: GamePoint,
  rect: { x: number; y: number; w: number; h: number },
): boolean {
  if (!(rect.w > 0) || !(rect.h > 0)) return false;
  return (
    point.x >= rect.x &&
    point.x <= rect.x + rect.w &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.h
  );
}

/**
 * Is the point inside the shape? Every shape's border counts as inside, so a
 * shape drawn along a word's centre line still holds it (the veil's rule).
 */
export function shapeContains(shape: GameShape, point: GamePoint): boolean {
  if (shape.kind === "polygon") return pointInPolygon(point, shape.points);
  if (shape.kind === "circle") {
    return pointInCircle(point, shape.cx, shape.cy, shape.r);
  }
  return pointInRect(point, shape);
}

/** A word as a shape sees it: its slug, top-left position and measured box. */
export interface ShapeWord {
  slug: string;
  pos: GamePoint;
  box: { w: number; h: number };
}

/** A distance wire as a shape sees it: the record's two endpoint slugs. */
export interface ShapeWire {
  from: string;
  to: string;
  word: string;
}

/**
 * The words a shape holds: each word by the CENTRE of its measured box — the
 * map's one "in a region" reading (the lasso and the veil use the same point),
 * which is the word's anchor on the plane. Map order is kept.
 */
export function wordsInShape<T extends ShapeWord>(
  shape: GameShape,
  words: readonly T[],
): T[] {
  return words.filter((word) =>
    shapeContains(shape, centerOf(word.pos, word.box)),
  );
}

/** What one shape holds, derived at read time. */
export interface GameMembership {
  /** The held words' slugs, in map order. */
  words: string[];
  /** The held wires, in file order: a wire needs BOTH endpoint words held. */
  wires: ShapeWire[];
}

/**
 * Derive a game's membership from its shape. The words are the shape's
 * region test; a distance wire is held iff BOTH of its endpoint words are
 * held (the lead's reading of "the words and the links if any" — on the
 * concept map the links between words are the distance WIRES). A one-ended
 * wire is not held, and a shape that holds no word holds no wire.
 */
export function gameMembership(
  shape: GameShape,
  words: readonly ShapeWord[],
  wires: readonly ShapeWire[],
): GameMembership {
  const held = wordsInShape(shape, words);
  const heldSlugs = new Set(held.map((word) => word.slug));
  return {
    words: held.map((word) => word.slug),
    wires: wires.filter(
      (wire) => heldSlugs.has(wire.from) && heldSlugs.has(wire.to),
    ),
  };
}

/* ------------------------------------------------------------------------- *
 * The shape's geometry: its bounds, centre and the popup's anchor.
 * ------------------------------------------------------------------------- */

/** A shape's world-space bounding box (top-left corner and size). */
export function shapeBounds(shape: GameShape): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  if (shape.kind === "rect") {
    return { x: shape.x, y: shape.y, w: shape.w, h: shape.h };
  }
  if (shape.kind === "circle") {
    return {
      x: shape.cx - shape.r,
      y: shape.cy - shape.r,
      w: shape.r * 2,
      h: shape.r * 2,
    };
  }
  if (shape.points.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
  let minX = shape.points[0].x;
  let maxX = shape.points[0].x;
  let minY = shape.points[0].y;
  let maxY = shape.points[0].y;
  for (const point of shape.points) {
    if (point.x < minX) minX = point.x;
    if (point.x > maxX) maxX = point.x;
    if (point.y < minY) minY = point.y;
    if (point.y > maxY) maxY = point.y;
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The point the map centres on when a listed game is brought forward: the
 * middle of the shape's bounding box (a polygon's own vertex mean would drift
 * on a lopsided shape; the box's middle is where the region sits on the
 * paper).
 */
export function shapeCenter(shape: GameShape): GamePoint {
  const bounds = shapeBounds(shape);
  return { x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 };
}

/**
 * Where the naming popup hangs: the shape's bounding box's TOP-LEFT, the
 * veil's coin-field placement, so the card sits at the drawn region's corner
 * rather than over what it holds (PROVISIONAL, the brief's placement).
 */
export function shapeAnchor(shape: GameShape): GamePoint {
  const bounds = shapeBounds(shape);
  return { x: bounds.x, y: bounds.y };
}

/* ------------------------------------------------------------------------- *
 * The pastel: a random colour from an injected rng, in a quiet range.
 * ------------------------------------------------------------------------- */

/** The pastel's saturation: soft, never a highlighter. */
export const PASTEL_SATURATION = 0.5;

/** The pastel's lightness band: light enough to read as a tint on the paper. */
export const PASTEL_LIGHTNESS_MIN = 0.78;
export const PASTEL_LIGHTNESS_MAX = 0.88;

/**
 * The ink the render falls back to when a hand-edited colour cannot be
 * painted (the pen's `penInk` rule, one family over). A quiet sage pastel.
 */
export const DEFAULT_GAME_COLOR = "#dce4d7";

/** Does this string name an ink CSS can paint? `#rgb` or `#rrggbb` only. */
export function isGameColor(value: unknown): value is string {
  return (
    typeof value === "string" && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)
  );
}

/** The ink a stored colour actually paints with (the pen's fallback rule). */
export function gameInk(color: string): string {
  return isGameColor(color) ? color : DEFAULT_GAME_COLOR;
}

/** One hue channel of the HSL -> RGB conversion (the standard formula). */
function hueToChannel(p: number, q: number, t: number): number {
  let shifted = t;
  if (shifted < 0) shifted += 1;
  if (shifted > 1) shifted -= 1;
  if (shifted < 1 / 6) return p + (q - p) * 6 * shifted;
  if (shifted < 1 / 2) return q;
  if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6;
  return p;
}

/** HSL (h in degrees, s and l in 0..1) as lowercase `#rrggbb`. */
export function hslToHex(h: number, s: number, l: number): string {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t: number): string => {
    const value = Math.round(hueToChannel(p, q, t) * 255);
    return Math.min(255, Math.max(0, value))
      .toString(16)
      .padStart(2, "0");
  };
  return "#" + channel(hue + 1 / 3) + channel(hue) + channel(hue - 1 / 3);
}

/** A drawn rng value as 0..0.999999 (a bad rng can never make a bad byte). */
function unit(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(Math.max(value, 0), 0.999999);
}

/**
 * A random pastel: the injected `rng` draws the hue and the lightness (the
 * saturation is fixed), so a test can pin the colour and prove the pastel
 * band. The app injects `Math.random`.
 */
export function pickPastel(rng: () => number): string {
  const hue = unit(rng()) * 360;
  const lightness =
    PASTEL_LIGHTNESS_MIN +
    unit(rng()) * (PASTEL_LIGHTNESS_MAX - PASTEL_LIGHTNESS_MIN);
  return hslToHex(hue, PASTEL_SATURATION, lightness);
}

/* ------------------------------------------------------------------------- *
 * Saving: the name, and the one selection rule the person must meet.
 * ------------------------------------------------------------------------- */

/**
 * What stops a game being saved, or null. The name must be non-empty and
 * unique among the existing games (CASE-SENSITIVE — PROVISIONAL: the name is
 * the person's spelling, so "Rain" and "rain" are two coins), and the
 * selection must hold at least one word of the map (an empty region may be
 * drawn, never kept).
 */
export type SubmitProblem = "empty" | "duplicate" | "no-words" | null;

export function submitProblem(
  name: string,
  existingNames: readonly string[],
  hasWords: boolean,
): SubmitProblem {
  const trimmed = name.trim();
  if (trimmed === "") return "empty";
  if (existingNames.includes(trimmed)) return "duplicate";
  if (!hasWords) return "no-words";
  return null;
}

/**
 * The name-and-shape a completed selection holds while the popup asks. The
 * fill is painted from this before anything is written; `hasWords` is the
 * read-time membership's one fact this surface needs (whether the region
 * holds a word at all — never which ones, and never a tally).
 */
export interface LanguageGameDraft {
  shape: GameShape;
  color: string;
  hasWords: boolean;
}

/* ------------------------------------------------------------------------- *
 * The fill's quiet numbers (world space, so the camera carries them).
 * ------------------------------------------------------------------------- */

/** A game's fill opacity at rest: a tint over the paper. */
export const GAME_FILL_OPACITY = 0.3;

/** The game brought forward from the list: more opaque than the rest. */
export const GAME_FOCUS_OPACITY = 0.62;

/** The in-flight draft's fill, before it is saved or cancelled. */
export const GAME_DRAFT_OPACITY = 0.42;

/* ------------------------------------------------------------------------- *
 * The person-facing strings (one place, so the quiet wording can be read and
 * scanned without a DOM).
 * ------------------------------------------------------------------------- */

export const GAME_POPUP_TITLE = "language game";
export const GAME_NAME_PLACEHOLDER = "name this game…";
export const GAME_NAME_LABEL = "the language game's name";
export const GAME_SUBMIT_LABEL = "submit";
export const GAME_CANCEL_LABEL = "cancel";
export const SELECT_BAR_HINT = "drag a shape on the plane · esc ends";
export const SELECT_BAR_LABEL = "select — the shape";
export const GAMES_PANEL_TITLE = "all language games";
export const GAMES_PANEL_LABEL = "all language games — the concept map's regions";
export const GAMES_EMPTY_LINE = "no language games yet.";
export const GAME_REMOVE_LABEL = "delete this language game";
export const GAMES_CLOSE_LABEL = "close the language games";

/** The popup's quiet sentence for each refusal (a sentence, never a tally). */
export const GAME_PROBLEM_TEXT: Record<
  Exclude<SubmitProblem, null>,
  string
> = {
  empty: "a language game needs a name.",
  duplicate: "there is already a language game by that name.",
  "no-words": "choose an area that holds at least one word.",
};
