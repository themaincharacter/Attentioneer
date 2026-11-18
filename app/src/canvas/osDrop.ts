import { PICK_UNKNOWN, pickKindFor } from "../map/extract";
import {
  BESIDE_OFFSET_X,
  clientToWorld,
  type Point,
} from "./geometry";
import type { GestureNarration } from "./gestureWord";

/**
 * STORY 16.20 — A FILE DROPPED FROM THE OS LANDS WHERE THE PERSON IS POINTING.
 *
 * The ground map has always accepted a file through the bubble: a double-click,
 * a name, a pick. The user asked for the direct gesture too — drag a file from
 * the desktop and drop it on the paper — so this module holds the pure rules of
 * that drop and nothing else. The raw OS event is heard in `osDropWindow.ts`
 * (a window seam, never a record writer) and the app hands the paths here.
 *
 * THE RULES, in one place:
 *   - the point is the POINTER, converted by the canvas's OWN helper
 *     (`geometry.ts`'s `clientToWorld`) — never a re-derived transform;
 *   - several files cascade on x by the existing beside-the-card offset, in the
 *     OS's order, so a drop of three never stacks three cards on one point;
 *   - the SAME intent rules decide what each file is (`extract.ts`'s
 *     `pickKindFor`), the same refusals answer, and the same creation path
 *     writes the card — this module owns no writer and no record shape;
 *   - ONE sentence per drop: a mixed drop creates the files it can and says how
 *     many were skipped, and a refused drop writes NOTHING.
 *
 * The card's name is the file's own stem (the map is the person's; a drop names
 * the reference the way the file names itself). PROVISIONAL: that naming rule,
 * the cascade offset's reuse, and the sentences below.
 */

/**
 * The cards a drop must not create over. A drop ONTO a card is a card-on-card
 * act this story does not have (out of scope), so it creates nothing — the
 * same element-under-pointer rule the wiring drag uses.
 */
export const DROP_CARD_SELECTOR =
  ".ground-reference, .ask-card, .session-card";

/** The window point a drop reported, in CSS pixels (Tauri's physical / dpr). */
export interface DropClientPoint {
  readonly x: number;
  readonly y: number;
}

/** The plane element's measured box, as the conversion needs it. */
export interface DropRect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** The camera's transform, as the conversion needs it. */
export interface DropCamera {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/**
 * The world point under a drop, or null when the plane cannot be measured or
 * the camera is not a usable transform. A failed conversion writes NOTHING: a
 * drop that cannot say where it landed has no place to put a card.
 */
export function dropWorldPoint(
  client: DropClientPoint,
  rect: DropRect,
  camera: DropCamera,
): Point | null {
  if (!Number.isFinite(rect.width) || rect.width <= 0) return null;
  if (!Number.isFinite(rect.height) || rect.height <= 0) return null;
  if (!Number.isFinite(camera.x) || !Number.isFinite(camera.y)) return null;
  if (!Number.isFinite(camera.zoom) || camera.zoom <= 0) return null;
  if (!Number.isFinite(client.x) || !Number.isFinite(client.y)) return null;
  return clientToWorld(client.x, client.y, rect, camera);
}

/**
 * Does the drop land ON a card? A drop onto a card creates nothing (a card's
 * own presses remain its own); the app answers this from the element under the
 * pointer, exactly as the wiring drag names its target. Structural so the pure
 * rule is testable without a DOM.
 */
export function dropLandsOnCard(
  target: { closest(selector: string): unknown } | null,
): boolean {
  return target !== null && target.closest(DROP_CARD_SELECTOR) !== null;
}

/**
 * Is the drop refused before it starts? A drop during a card drag or a wire
 * drag is IGNORED (the hand is mid-gesture; a card appearing under it would be
 * an interruption), and so is one while a tool is armed — the armed surface
 * owns the pointer, exactly as it does for the plane's own creation. A refused
 * drop says nothing and writes nothing.
 */
export function dropBlocked(
  gesture: GestureNarration,
  armed: boolean,
): boolean {
  if (armed) return true;
  return gesture.kind === "moving" || gesture.kind === "wiring";
}

/**
 * The card's name from the file's own name: its stem — the last path part
 * without its extension — exactly as `extract.ts` reads an extension, so a
 * hidden file (".gitignore") keeps its whole name and a file with no suffix
 * keeps its own. Never empty: a path with nothing to name falls back to the
 * file itself.
 */
export function dropCardName(path: string): string {
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  const file = parts.length > 0 ? parts[parts.length - 1] : path;
  if (file === "") return "untitled";
  const dot = file.lastIndexOf(".");
  // A leading dot is a hidden file's name, not an extension (extract.ts's rule).
  const stem = dot > 0 ? file.slice(0, dot) : file;
  return stem.trim() === "" ? file : stem;
}

/**
 * Where the nth card of a drop goes: the pointer for the first, then the
 * existing beside-the-card offset repeated per item, in the OS's order. Cards
 * cascade to the right and never stack on one point.
 */
export function dropPoint(origin: Point, index: number): Point {
  return { x: origin.x + BESIDE_OFFSET_X * index, y: origin.y };
}

/** One file the drop will try to create, at its cascaded point. */
export interface DropItem {
  readonly path: string;
  readonly name: string;
  readonly at: Point;
}

/** What a drop planned: the files whose TYPE is known, and how many were not. */
export interface DropPlan {
  readonly items: readonly DropItem[];
  /** Paths whose name names no kind this app reads (refused before any read). */
  readonly unknown: number;
}

/**
 * Read the drop's paths through the SAME intent rules the bubble uses. A path
 * whose name names no kind is never opened: it is counted here and refused with
 * `PICK_UNKNOWN`. Everything else is planned at its cascaded point, in the OS's
 * order. PURE — nothing is read or written.
 */
export function planDrop(
  paths: readonly string[],
  origin: Point,
): DropPlan {
  const items: DropItem[] = [];
  let unknown = 0;
  for (const path of paths) {
    if (path === "") continue;
    if (pickKindFor(path) === null) {
      unknown += 1;
      continue;
    }
    items.push({
      path,
      name: dropCardName(path),
      at: dropPoint(origin, items.length),
    });
  }
  return { items, unknown };
}

/**
 * The ONE sentence a drop says, or null when everything landed. A single
 * refusal keeps its own reason ("that file is not text, a PDF or an image." /
 * "cannot read that file."), because one sentence about one file is more useful
 * than a count. Several collapse into one sentence naming how many were
 * skipped — never a per-file storm.
 */
export function dropSentence(
  added: number,
  skipped: number,
  firstReason: string | null,
): string | null {
  if (skipped === 0) return null;
  if (added === 0 && skipped === 1 && firstReason !== null) return firstReason;
  if (added === 0) {
    return `nothing was added: ${skipped} files could not be added.`;
  }
  const references = added === 1 ? "reference" : "references";
  const files = skipped === 1 ? "file" : "files";
  return `added ${added} ${references}; skipped ${skipped} ${files}.`;
}

/** What one creation path answers; the hook's own result satisfies this. */
export type DropWriteResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/** The same creation path the bubble uses: name, point, file. No new writer. */
export interface DropWriter {
  (
    name: string,
    x: number,
    y: number,
    from: string,
  ): Promise<DropWriteResult>;
}

/** What a drop did: how many cards were made, how many files were skipped, and
 * the ONE sentence (or null). */
export interface DropOutcome {
  readonly added: number;
  readonly skipped: number;
  readonly notice: string | null;
}

/**
 * RUN a drop through the existing creation path, one file at a time, in the
 * OS's order. Each creation either lands a card or answers its own sentence and
 * writes nothing (the creation path guarantees that: the reading is taken
 * before any record). The OUTCOME is one count pair and one sentence — the app
 * never sees how many refusals there were and never shows them one by one.
 */
export async function runOsDrop(
  paths: readonly string[],
  origin: Point,
  create: DropWriter,
): Promise<DropOutcome> {
  const plan = planDrop(paths, origin);
  let added = 0;
  let skipped = plan.unknown;
  let firstReason: string | null = plan.unknown > 0 ? PICK_UNKNOWN : null;
  for (const item of plan.items) {
    const result = await create(item.name, item.at.x, item.at.y, item.path);
    if (result.ok) {
      added += 1;
      continue;
    }
    skipped += 1;
    if (firstReason === null) firstReason = result.message;
  }
  return { added, skipped, notice: dropSentence(added, skipped, firstReason) };
}
