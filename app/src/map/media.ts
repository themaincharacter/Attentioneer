import { createDirAll, readTextFile, writeTextFile } from "../lib/fs";
import { canonicalJsonlLine, canonicalJsonlLines } from "../lib/serialize";
import { mapDir } from "./records";

/**
 * THE GROUND MAP'S MEDIA (story 16.14) — one `map/media.jsonl` line per card
 * that keeps a copy of a page's look, beside the reading it belongs to.
 *
 *   map/media.jsonl        {"on":"<slug>","kind":"page","title":"…",
 *                           "thumb":"media/<slug>.svg","fetched":"<ISO>"}
 *   map/media/<slug>.svg   the thumbnail, wrapped as an SVG image
 *
 * WHY A LOCAL THUMBNAIL: the card must render with the machine OFFLINE. A
 * remote image URL would make the card's face depend on the network, and a
 * page's look is part of what was read when the person added it. So the
 * sidecar downloads the image ONCE, the app writes the bytes beside the map,
 * and every later render reads only that file. The record's `thumb` is
 * therefore always a path INSIDE the workspace (`media/…`), never a URL.
 *
 * WHY AN SVG WRAPPER: the app has no binary file writer (ADR-0004's byte door
 * is the text writer), and story 16.14 forbids a new Rust command. The image
 * bytes arrive base64 from the sidecar and are embedded in a tiny SVG text
 * file; the app turns that file into a data URL at load, and the browser
 * renders it with no network and no Tauri asset-protocol grant. PROVISIONAL:
 * the wrapper and the .svg extension may give way to a real binary write in a
 * later story, and the 320x180 wrapper box is a look, not the image's size.
 *
 * The snapshot is the extracted TEXT and this one thumbnail — NOT a rendered
 * screenshot. A visual snapshot would need a headless browser and is
 * explicitly out of scope (story 16.14).
 *
 * A card with no image simply has NO line here (or a line without `thumb`):
 * a missing picture is not an error, is never reported and is never repaired.
 *
 * STORY 16.15 ADDS THE VIDEO: a pasted video address gets its TITLE and a
 * thumbnail through oEmbed, kept here exactly as a page's are (the same local
 * SVG wrapper, the same `thumb` wire). The kind says which flow produced it.
 * A remote image at render time would put the network inside the map's
 * rendering, which is the whole reason the bytes are copied.
 *
 * PROVISIONAL (with the rest of the story's record shapes): the file name, the
 * line shape, `media/`, the .svg wrapper and the kind names.
 */

/** The media record file: `<workspace>/map/media.jsonl`. */
export const MEDIA_FILE = "media.jsonl";

/** The media folder beside it: `<workspace>/map/media`. */
export const MEDIA_DIR = "media";

/**
 * What a media record may be for: a page's look (story 16.14) or a video's
 * title and thumbnail (story 16.15). PROVISIONAL: the names.
 */
export type MediaKind = "page" | "video";

/** One media-bearing card: the page's title and its local thumbnail path. */
export interface Media {
  /** The ground reference's slug — the key every ground family joins on. */
  on: string;
  kind: MediaKind;
  /** The page's or video's own title, copied; the card's "what this is" line. */
  title: string;
  /**
   * The thumbnail, WORKSPACE-RELATIVE under `map/` (`media/<slug>.svg`).
   * ABSENT when the image could not be taken: no picture is not an error.
   * Never a remote URL — see the module comment's local-first reason.
   */
  thumb?: string;
  /** When the page was fetched, ISO-8601 (the writer's clock). */
  fetched: string;
}

/** A read of `map/media.jsonl`: what parsed and what is kept but unreadable. */
export interface ParsedMedia {
  media: Media[];
  malformed: string[];
}

/** The bridges this family needs; the app passes lib/fs, a test a fake. */
export interface MediaIo {
  readTextFile(path: string): Promise<string | null>;
  writeTextFile(path: string, content: string): Promise<void>;
  createDirAll(path: string): Promise<void>;
}

/** The real bridges, bound once so the module stays importable in bun tests. */
export const MEDIA_IO: MediaIo = { readTextFile, writeTextFile, createDirAll };

/** The media record file: `<workspace>/map/media.jsonl`. */
export function mediaPath(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${MEDIA_FILE}`;
}

/** The media folder: `<workspace>/map/media`. */
export function mediaDir(workspacePath: string): string {
  return `${mapDir(workspacePath)}/${MEDIA_DIR}`;
}

/**
 * The thumbnail's path INSIDE the workspace, as the record stores it. The
 * wrapper is always an SVG (see the module comment), so the slug is the whole
 * of the variable part and a record can never name another file's bytes.
 */
export function thumbRelPath(slug: string): string {
  return `${MEDIA_DIR}/${slug}.svg`;
}

/**
 * The ABSOLUTE path a record's `thumb` names. The value is relative to
 * `map/`, exactly as the record stores it; a thumb that tries to leave the
 * media folder is not a path this app writes, and the parser refuses it. PURE.
 */
export function thumbAbsolutePath(
  workspacePath: string,
  thumb: string,
): string {
  return `${mapDir(workspacePath)}/${thumb}`;
}

/** Is this thumb value one this app itself writes (a relative media path)? */
export function isLocalThumb(value: string): boolean {
  return (
    value.startsWith(MEDIA_DIR + "/") &&
    !value.includes("://") &&
    !value.includes("..") &&
    !value.includes("\\")
  );
}

/** Parse one JSONL line; anything out of shape is `null` (kept, reported). */
export function parseMediaLine(line: string): Media | null {
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
  // STORY 16.15: a video's title and thumbnail live in the SAME record and the
  // same wrapper; only the kind says which flow wrote it.
  if (source.kind !== "page" && source.kind !== "video") return null;
  if (typeof source.title !== "string") return null;
  if (typeof source.fetched !== "string" || source.fetched === "") return null;
  const media: Media = {
    on: source.on,
    kind: source.kind,
    title: source.title,
    fetched: source.fetched,
  };
  if (source.thumb !== undefined) {
    if (typeof source.thumb !== "string" || !isLocalThumb(source.thumb)) {
      return null;
    }
    media.thumb = source.thumb;
  }
  return media;
}

/** Read the file's bytes: LF/BOM/CRLF tolerated, unreadable lines kept. */
export function parseMedia(text: string): ParsedMedia {
  const media: Media[] = [];
  const malformed: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, "");
    if (line === "") continue;
    const parsed = parseMediaLine(line);
    if (parsed === null) malformed.push(line);
    else media.push(parsed);
  }
  return { media, malformed };
}

/** One record as its canonical JSONL line (keys sorted by serialize.ts). */
export function serializeMediaLine(entry: Media): string {
  const fields: Record<string, unknown> = {
    on: entry.on,
    kind: entry.kind,
    title: entry.title,
    fetched: entry.fetched,
  };
  if (entry.thumb !== undefined) fields.thumb = entry.thumb;
  return canonicalJsonlLine(fields);
}

/** The file's canonical bytes: known lines in FILE ORDER, then preserved ones. */
export function serializeMedia(
  media: readonly Media[],
  malformed: readonly string[] = [],
): string {
  return canonicalJsonlLines([
    ...media.map(serializeMediaLine),
    ...malformed,
  ]);
}

export async function loadMedia(
  workspacePath: string,
  io: MediaIo = MEDIA_IO,
): Promise<ParsedMedia> {
  const text = await io.readTextFile(mediaPath(workspacePath));
  return text === null ? { media: [], malformed: [] } : parseMedia(text);
}

export async function saveMedia(
  workspacePath: string,
  media: readonly Media[],
  malformed: readonly string[] = [],
  io: MediaIo = MEDIA_IO,
): Promise<void> {
  await io.writeTextFile(mediaPath(workspacePath), serializeMedia(media, malformed));
}

/** The media for one slug, when the file has a line (the layer's join). */
export function mediaFor(
  media: readonly Media[],
  on: string,
): Media | null {
  return media.find((entry) => entry.on === on) ?? null;
}

/** Add or replace one slug's media line (a re-take replaces, never appends). */
export function withMedia(
  media: readonly Media[],
  entry: Media,
): Media[] {
  return [...media.filter((existing) => existing.on !== entry.on), entry];
}

/** Remove one slug's media line, in file order. PURE. */
export function withoutMedia(
  media: readonly Media[],
  on: string,
): Media[] {
  return media.filter((entry) => entry.on !== on);
}

/**
 * The SVG wrapper for one downloaded image. PURE. The image is a data URL, so
 * the file needs no network and no sidecar; the 320x180 box is only the
 * wrapper's aspect (the card crops with CSS). PROVISIONAL: the box.
 */
export function thumbSvg(mime: string, base64: string): string {
  const href = `data:${mime};base64,${base64}`;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" ' +
    'viewBox="0 0 320 180" preserveAspectRatio="xMidYMid slice">' +
    `<image width="320" height="180" preserveAspectRatio="xMidYMid slice" href="${href}"/>` +
    "</svg>"
  );
}

/**
 * Write one downloaded image as its local wrapper and answer the record's
 * thumb path. The image bytes never become a remote URL: they are embedded in
 * the SVG text, which is the one kind of file this app can write. The caller
 * writes the media LINE after this returns, so a crash can leave an orphan
 * picture but never a record pointing at one that is not there.
 */
export async function storeThumb(
  workspacePath: string,
  slug: string,
  mime: string,
  base64: string,
  io: MediaIo = MEDIA_IO,
): Promise<string> {
  await io.createDirAll(mediaDir(workspacePath));
  const thumb = thumbRelPath(slug);
  await io.writeTextFile(
    thumbAbsolutePath(workspacePath, thumb),
    thumbSvg(mime, base64),
  );
  return thumb;
}

/** The data URL the card renders, made from the SVG text READ or just written. */
export function thumbSrcOf(svgText: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
}

/**
 * The image source the CARD renders: the stored SVG read back as a data URL.
 * READ-ONLY and offline by construction — the file beside the map is the whole
 * truth. A missing or unreadable thumbnail is a quiet `null` (no image line),
 * never a sentence and never a repair. (A data URL keeps rendering out of the
 * Tauri asset protocol, which has no grant on an arbitrary workspace.)
 */
export async function loadThumbSrc(
  workspacePath: string,
  thumb: string | undefined,
  io: MediaIo = MEDIA_IO,
): Promise<string | null> {
  if (thumb === undefined) return null;
  const text = await io.readTextFile(thumbAbsolutePath(workspacePath, thumb));
  if (text === null || text.trim() === "") return null;
  return thumbSrcOf(text);
}

/** Every card's thumbnail source, keyed by slug. Absent means no image. */
export async function loadThumbSrcs(
  workspacePath: string,
  media: readonly Media[],
  io: MediaIo = MEDIA_IO,
): Promise<Record<string, string>> {
  const entries = await Promise.all(
    media.map(async (entry) => {
      const src = await loadThumbSrc(workspacePath, entry.thumb, io);
      return [entry.on, src] as const;
    }),
  );
  const thumbs: Record<string, string> = {};
  for (const [on, src] of entries) {
    if (src !== null) thumbs[on] = src;
  }
  return thumbs;
}
