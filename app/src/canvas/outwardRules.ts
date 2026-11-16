/**
 * The window's outward rules (Epic 5 story 2, ADR-0017's amendment): the pure
 * scheme guard, the authored target's resolution, the focus/close rules and the
 * quiet words. Kept apart from the component and from the impure bridge, so the
 * guard, the resolution, the close rules, the tooltip wording and the viewport
 * clamp are asserted without a DOM, a Tauri runtime or an xdg-open.
 *
 * World B, in one place: a pointer's form is the person's authored pick and its
 * value is stored verbatim. This module never sniffs a form from a value, never
 * repairs a target, and never treats the workspace as a sandbox: `path` joins
 * the workspace root exactly as written and `at` is passed verbatim (the
 * filesystem, not a policy, decides what resolves).
 *
 * Provisional: the wording, the four default URL schemes (the research's
 * opener:default surfaces) and the clamp margin.
 */

import type { PointerForm } from "../map/pointers";
import {
  DEFAULT_URL_SCHEMES,
  schemeAllowed,
  urlScheme,
} from "../lib/openerSchemes";
import { chooserFocusSelector } from "./pointerRules";
import type { Point } from "./geometry";

// The scheme vocabulary is the lib's now (Epic 12 story 3's open-os decides
// the same question before logging an outcome); this module keeps re-exporting
// it, so every outward caller reads exactly what it read before.
export { DEFAULT_URL_SCHEMES, schemeAllowed, urlScheme };

/**
 * The window's quiet tooltip/aria line: a snapshot of the open moment, not a
 * live view. The person reopens the pointer to refresh it.
 */
export const PEEK_TOOLTIP = "an open-moment glimpse — reopen to refresh";

/** The one honest failure sentence for a glimpse (missing, gone or refused). */
export const CANNOT_READ = "cannot read";

/** The outward open failed: nothing was launched (this box has no xdg-open). */
export const CANNOT_OPEN = "cannot open";

/** opener:default's URL scope does not include this scheme (never a quiet no-op). */
export const CANNOT_OPEN_SCHEME = "cannot open this scheme";

/** The reveal-in-dir failed (no file manager, or the item is gone). */
export const CANNOT_REVEAL = "cannot reveal";

/**
 * The pure guard's answer: null when the url may go to `openUrl`, otherwise the
 * sentence the window shows. No scheme at all is refused too: it is not a url
 * the system opener can be handed.
 */
export function schemeNotice(value: string): string | null {
  return schemeAllowed(value) ? null : CANNOT_OPEN_SCHEME;
}

/** Where a pointer's authored target actually points. */
export type OutwardTarget =
  | { kind: "url"; url: string }
  | { kind: "file"; path: string };

/**
 * Join an authored `path` onto the workspace root AS WRITTEN. The value is
 * never normalized, stripped or repaired (a leading slash, `.` and `..` keep
 * their meaning on the filesystem — the app is not a sandbox). The separator
 * follows the root, so a Windows workspace path joins with a backslash.
 */
export function joinWorkspacePath(root: string, value: string): string {
  if (root === "") return value;
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return root.replace(/[\\/]+$/, "") + separator + value;
}

/**
 * Resolve one authored pointer to what the window reads or opens. `url` is
 * passed through, `at` is verbatim absolute (machine-local: it dangles
 * honestly elsewhere), `path` is the workspace-relative join above.
 */
export function resolveTarget(
  form: PointerForm,
  value: string,
  workspacePath: string,
): OutwardTarget {
  switch (form) {
    case "url":
      return { kind: "url", url: value };
    case "at":
      return { kind: "file", path: value };
    case "path":
      return { kind: "file", path: joinWorkspacePath(workspacePath, value) };
  }
}

/** Why the window closed: a dismissal, or a level switch. */
export type PeekCloseReason = "dismiss" | "switch-level";

/**
 * Where focus returns when the window closes (the assumption overlay's and the
 * chooser's rule, mirrored): the word's reach handle on a dismissal — the
 * window is its word's — or the level button on a switch, because the word may
 * carry no handle in the next game (ADR-0016's amendment).
 */
export function focusAfterPeekClose(reason: PeekCloseReason): "word" | "level" {
  return reason === "switch-level" ? "level" : "word";
}

/**
 * The selector the focus step uses: the same canvas markup contract the
 * chooser's focus return already owns (one contract, one place).
 */
export function peekFocusSelector(
  target: "word" | "level",
  slug: string | null = null,
): string {
  return chooserFocusSelector(target, slug);
}

/** What a level switch closes (ADR-0016's amendment): the window. */
export const PEEK_TRANSIENTS = ["window"] as const;

export type PeekTransient = (typeof PEEK_TRANSIENTS)[number];

/** The transients a switch to another game closes — the window included. */
export function peekTransientsClosedByLevelSwitch(): readonly PeekTransient[] {
  return PEEK_TRANSIENTS;
}

/**
 * The window's aria label: what it is about, quietly. It takes the word's
 * coined NAME, never the record's slug — person-facing strings speak names
 * (Epic 6 story 3); the slug stays in the pointer record.
 */
export function peekLabel(name: string, form: PointerForm): string {
  return "the window on “" + name + "” · " + form;
}

/** A small, quiet size for the identity line (never a badge, just the fact). */
export function formatSize(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return "";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < units.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const shown = unit === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return shown + " " + units[unit];
}

/**
 * The mtime, said plainly and deterministically (UTC, minute precision):
 * a local-time guess would differ between machines looking at one `at` file.
 */
export function formatMtime(mtime: number | null): string | null {
  if (mtime === null || !Number.isFinite(mtime)) return null;
  const date = new Date(mtime);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

/** The identity line's second half: size and modified time, or nothing. */
export function formatStats(size: number | null, mtime: number | null): string {
  const parts: string[] = [];
  const bytes = formatSize(size);
  if (bytes !== "") parts.push(bytes);
  const when = formatMtime(mtime);
  if (when !== null) parts.push("modified " + when);
  return parts.join(" · ");
}

/** A camera as far as the clamp needs it (the app's Camera satisfies this). */
export interface PeekCamera {
  x: number;
  y: number;
  zoom: number;
}

/** A viewport in screen pixels (the plane fills it). */
export interface PeekViewport {
  width: number;
  height: number;
}

/** A measured window box in screen pixels (the component measures it). */
export interface PeekSize {
  width: number;
  height: number;
}

/**
 * Clamp a world anchor so the counter-scaled window stays inside the viewport.
 * The window pans and zooms with the plane but must never be lost off-screen: a
 * word past the viewport's edge still opens a readable glimpse. When the window
 * is wider than the viewport the left/top edge wins (there is nothing better to
 * do); the clamp never moves the window out of view.
 *
 * The anchor is the card's LEFT-CENTER (the overlay idiom: left at the word's
 * right edge, vertically centred by the inline translate(0, -50%)), so the
 * world box spans [x, x + width/zoom] horizontally and
 * [y - height/2/zoom, y + height/2/zoom] vertically.
 */
export function clampPeekAnchor(
  anchor: Point,
  camera: PeekCamera,
  viewport: PeekViewport,
  size: PeekSize,
  margin: number = 12,
): Point {
  const zoom = camera.zoom > 0 ? camera.zoom : 1;
  const worldWidth = size.width / zoom;
  const worldHeight = size.height / zoom;
  const halfHeight = worldHeight / 2;
  const left = -camera.x / zoom;
  const top = -camera.y / zoom;
  const right = (viewport.width - camera.x) / zoom;
  const bottom = (viewport.height - camera.y) / zoom;
  const gap = margin / zoom;

  let x = anchor.x;
  let y = anchor.y;
  if (x + worldWidth > right - gap) x = right - gap - worldWidth;
  if (x < left + gap) x = left + gap;
  if (y + halfHeight > bottom - gap) y = bottom - gap - halfHeight;
  if (y - halfHeight < top + gap) y = top + gap + halfHeight;
  return { x, y };
}
