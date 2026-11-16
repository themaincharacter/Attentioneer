import { readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";

/**
 * Sketches (added 2026-11-16 per user review): one `map/sketches.jsonl` line
 * per freehand stroke of the map's pen — a quiet drawing layer over the plane,
 * like a map tool's ink on the paper. PROVISIONAL in every part: the review
 * asked for "a simple draw layer ... pen size, color, undo", and this is the
 * smallest shape that carries those three.
 *
 * THE LINE is exactly
 *
 *   {"color":"#3b3a35","points":[[120,240],[123,242]],"size":2}
 *
 *   - `color` is the stroke's ink as an authored string (`#rrggbb` from the
 *     quiet palette or the picker). Stored VERBATIM: a hand-edited colour name
 *     is kept as written by the record, and the render falls back to the
 *     palette's ink when CSS cannot paint it — the record is never rewritten
 *     into a "valid" colour.
 *   - `size` is the pen's thickness in WORLD units (a stroke drawn at a size
 *     keeps that thickness as the camera moves, exactly like ink on paper, so
 *     zooming in makes it read thicker).
 *   - `points` is the stroke's path as `[x, y]` WORLD pairs, in draw order.
 *     A stroke needs at least TWO points to be a stroke: a press with no
 *     movement draws nothing and nothing is written.
 *
 * A STROKE HAS NO NAME, SLUG OR ID. It is addressed by its POSITION in the
 * file, which is also its draw order (later on top) — the family's natural
 * keys do not exist here because there is nothing to identify a line by. So
 * there is no dedupe and no rewrite-in-place: appending a stroke appends a
 * line, and UNDO drops the LAST stroke's line (the drawing's own order is the
 * undo order). A hand-edited duplicate line is two strokes, both drawn — never
 * collapsed.
 *
 * The family posture holds (ADR-0004's canonical bytes, ADR-0006's
 * preservation): unknown keys on a line survive every rewrite; malformed lines
 * are preserved verbatim AND surfaced by the read (the notices strip names
 * them — never silently hidden); a BOM and CRLF from a hand edit are tolerated;
 * a missing file means no strokes. Canonical serialization is serialize.ts's
 * job; this module only turns the file's bytes into records and back.
 *
 * The records are COMMITTED-MODEL records: strokes live in `map/` and are
 * never copied into a `scenarios/<slug>/` branch — the drawing is the map's,
 * not a model variant's (the veils' rule, ADR-0021's seam).
 *
 * Provisional (the review's list): the `sketches.jsonl` name, this line's
 * shape, the `[x, y]` pair form, world-unit thickness, and undo-by-position
 * (no redo, no selection, no layers, no text).
 */

/** One point of a stroke, in world space. */
export interface SketchPoint {
  x: number;
  y: number;
}

/** One freehand stroke as the file holds it. */
export interface Sketch {
  /** The stroke's ink, an authored CSS colour string, stored verbatim. */
  color: string;
  /** The pen's thickness in WORLD units. */
  size: number;
  /** The stroke's path in draw order; at least two points. */
  points: readonly SketchPoint[];
  /** Unknown JSON keys preserved across rewrites (the family's posture). */
  extra: Record<string, unknown>;
}

/** One stroke fresh from the pen, before it meets the file. */
export interface NewSketch {
  color: string;
  size: number;
  points: readonly SketchPoint[];
}

export interface ParsedSketches {
  sketches: Sketch[];
  /** Raw non-empty lines that did not parse — visible unknowns, never dropped. */
  malformed: string[];
}

export function sketchesPath(workspacePath: string): string {
  return `${workspacePath}/map/sketches.jsonl`;
}

/** A finite JS number (JSON cannot carry NaN/Infinity; a hand edit can). */
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** One `[x, y]` pair, or null. */
function parsePair(value: unknown): SketchPoint | null {
  if (!Array.isArray(value) || value.length !== 2) return null;
  const [x, y] = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null;
  return { x, y };
}

/**
 * Parse one JSONL line into a Sketch; malformed or out-of-shape lines become
 * `null`. A stroke is out of shape when its colour is not a non-empty string,
 * its size is not a positive finite number, or its points are not a list of at
 * least TWO finite `[x, y]` pairs. The size is never repaired: a hand edit
 * that says 0, a negative number or a string is preserved and surfaced, not
 * guessed into a pen width.
 */
export function parseSketchLine(line: string): Sketch | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const obj = value as Record<string, unknown>;
  const { color, size, points, ...extra } = obj;
  if (typeof color !== "string" || color.trim() === "") return null;
  if (!isFiniteNumber(size) || size <= 0) return null;
  if (!Array.isArray(points) || points.length < 2) return null;
  const parsed: SketchPoint[] = [];
  for (const pair of points) {
    const point = parsePair(pair);
    if (point === null) return null;
    parsed.push(point);
  }
  return { color, size, points: parsed, extra };
}

/** Serialize one Sketch to its canonical JSONL line (compact, sorted keys). */
export function serializeSketchLine(sketch: Sketch): string {
  return canonicalJsonlLine({
    ...sketch.extra,
    color: sketch.color,
    size: sketch.size,
    points: sketch.points.map((point) => [point.x, point.y]),
  });
}

/**
 * Read `map/sketches.jsonl`. Terminating newlines are ignored; malformed or
 * out-of-shape lines are preserved as unknowns (the family posture) so the app
 * never silently drops what it cannot read. Tolerates a BOM and CRLF.
 */
export function parseSketches(text: string): ParsedSketches {
  const sketches: Sketch[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseSketchLine(line);
    if (parsed) {
      sketches.push(parsed);
    } else {
      malformed.push(line);
    }
  }
  return { sketches, malformed };
}

/** Read the file from a workspace; a missing file means no strokes. */
export async function loadSketches(
  workspacePath: string,
): Promise<ParsedSketches> {
  const text = await readTextFile(sketchesPath(workspacePath));
  return text === null ? { sketches: [], malformed: [] } : parseSketches(text);
}

/**
 * The file's exact bytes. Known strokes serialize canonically (sorted keys) in
 * ARRAY ORDER — draw order, which is also undo order and stacking order — and
 * malformed lines are re-emitted verbatim after them. An empty document is the
 * canonical empty JSONL (one newline).
 */
export function serializeSketches(
  sketches: readonly Sketch[],
  malformed: readonly string[] = [],
): string {
  const known = sketches.map(serializeSketchLine);
  return canonicalJsonlLines([...known, ...malformed]);
}

export async function saveSketches(
  workspacePath: string,
  sketches: readonly Sketch[],
  malformed: readonly string[] = [],
): Promise<void> {
  await writeTextFile(
    sketchesPath(workspacePath),
    serializeSketches(sketches, malformed),
  );
}

/**
 * Append one stroke from the pen: the new line goes last, so it draws on top
 * and is the first thing undo takes. A stroke with fewer than two points
 * writes nothing (a press with no movement is not a stroke).
 */
export function appendSketch(
  sketches: readonly Sketch[],
  stroke: NewSketch,
): Sketch[] {
  if (stroke.points.length < 2) return [...sketches];
  return [
    ...sketches,
    {
      color: stroke.color,
      size: stroke.size,
      points: stroke.points.map((point) => ({ x: point.x, y: point.y })),
      extra: {},
    },
  ];
}

/** Undo: drop the LAST stroke (its line goes). No redo, no tombstone. */
export function undoLastSketch(sketches: readonly Sketch[]): Sketch[] {
  return sketches.slice(0, -1);
}

/** Clear the drawing: every stroke line goes (the quiet ×, no undo). */
export function clearSketches(_sketches: readonly Sketch[]): Sketch[] {
  return [];
}
