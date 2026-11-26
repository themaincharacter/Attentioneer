/**
 * STORY 25-17 — THE CARD'S OWN LOOK: the person's per-card frame and tint.
 *
 * The gear key on a card opens the picker; the choice lives in the map's own
 * sidecar (`map/looks.jsonl`, the media family's pattern): one JSON line per
 * card, the LAST line for a slug winning, and a line whose card is gone is an
 * ORPHAN — kept exactly where it is, never adopted and never deleted (the
 * media and notes' rule).
 *
 * The look is the person's aesthetic statement about ONE card: the frame
 * (which edge the card wears) and the tint (its own quiet colour). The
 * epistemic frames stay the state's own until the person says otherwise, and
 * the honest sentences beside any frame are untouched: a look is a look, not
 * a truth claim. PROVISIONAL (story 25-17): the shapes, the tints' bounds and
 * the line's fields.
 */

import {
  createDirAll,
  readTextFile,
  writeTextFile,
} from "../lib/fs";
import { mapDir } from "./records";

/** The look record file: `<workspace>/map/looks.jsonl`. */
export const LOOKS_FILE = "looks.jsonl";

/** The frames a card may wear. `default` keeps the state's own frame. */
export type LookFrame = "default" | "plain" | "bevel" | "dashed" | "muted";

/** What the person said about one card's look. */
export interface CardLook {
  /** The card's slug (identity; the name is never the key). */
  readonly on: string;
  /** The frame the card wears instead of its state's. */
  readonly frame?: LookFrame;
  /** A hex colour (`#rrggbb`) the card's edge and wash take. */
  readonly tint?: string;
}

export interface ParsedLooks {
  looks: CardLook[];
  malformed: string[];
}

/** The bridges this family needs; the app passes lib/fs, a test a fake. */
export interface LooksIo {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
  createDirAll(path: string): Promise<void>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const LOOKS_IO: LooksIo = {
  readTextFile,
  writeTextFile,
  createDirAll,
};

export function looksPath(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${LOOKS_FILE}`;
}

/** The frames the picker offers, in its own order. PURE. */
export const LOOK_FRAMES: readonly LookFrame[] = [
  "default",
  "plain",
  "bevel",
  "dashed",
  "muted",
];

/** The tints the picker offers (the sheet's own inks) plus free choice. PURE. */
export const LOOK_TINTS: readonly string[] = [
  "",
  "#b8933f",
  "#a0522d",
  "#4a6a94",
  "#5c7a6a",
  "#a0453b",
];

/** A tint is a hex colour the picker may write. PURE. */
export function isLookTint(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

/** One line parsed; anything out of shape is null (never guessed). PURE. */
export function parseLookLine(line: string): CardLook | null {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const source = value as Record<string, unknown>;
  if (typeof source.on !== "string" || source.on.trim() === "") return null;
  let frame: LookFrame | undefined;
  let tint: string | undefined;
  if (source.frame !== undefined) {
    if (
      typeof source.frame !== "string" ||
      !(LOOK_FRAMES as readonly string[]).includes(source.frame)
    ) {
      return null;
    }
    frame = source.frame as LookFrame;
  }
  if (source.tint !== undefined) {
    if (source.tint !== "" && !isLookTint(source.tint)) return null;
    tint = source.tint as string;
  }
  const look: CardLook =
    frame === undefined && tint === undefined
      ? { on: source.on }
      : frame === undefined
        ? { on: source.on, tint }
        : tint === undefined
          ? { on: source.on, frame }
          : { on: source.on, frame, tint };
  return look;
}

/** Read the file's bytes: LF/BOM/CRLF tolerated, unreadable lines kept. */
export function parseLooks(text: string): ParsedLooks {
  const looks: CardLook[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseLookLine(line);
    if (parsed === null) malformed.push(raw);
    else looks.push(parsed);
  }
  return { looks, malformed };
}

/** The exact line written for a look. PURE. */
export function serializeLookLine(look: CardLook): string {
  const value: Record<string, unknown> = { on: look.on };
  if (look.frame !== undefined && look.frame !== "default") {
    value.frame = look.frame;
  }
  if (look.tint !== undefined && look.tint !== "") {
    value.tint = look.tint;
  }
  return JSON.stringify(value);
}

/**
 * The looks by slug — the LAST line for a slug wins (an edit appends; the
 * file is the history of what the person chose). PURE.
 */
export function looksBySlug(
  looks: readonly CardLook[],
): Readonly<Record<string, CardLook>> {
  const by: Record<string, CardLook> = {};
  for (const look of looks) by[look.on] = look;
  return by;
}

/**
 * The looks in the FILE's own order: the last line per slug kept, an orphan
 * (a look whose card is gone) kept exactly where it is. PURE.
 */
export function keptLooks(looks: readonly CardLook[]): CardLook[] {
  const seen = new Set<string>();
  const kept: CardLook[] = [];
  for (let at = looks.length - 1; at >= 0; at -= 1) {
    const look = looks[at];
    if (seen.has(look.on)) continue;
    seen.add(look.on);
    kept.push(look);
  }
  return kept.reverse();
}

/**
 * Write one card's look: the file is rewritten with the last line per slug,
 * the new look LAST. The record is the file; nothing else is touched.
 */
export async function saveLook(
  workspacePath: string,
  look: CardLook,
  io: LooksIo = LOOKS_IO,
): Promise<void> {
  const path = looksPath(workspacePath);
  const existing = (await io.readTextFile(path)) ?? "";
  const prior = parseLooks(existing).looks.filter((one) => one.on !== look.on);
  const lines = [...prior, look].map((one) => serializeLookLine(one));
  await io.createDirAll(mapDir(workspacePath));
  await io.writeTextFile(path, lines.length === 0 ? "" : lines.join("\n") + "\n");
}
