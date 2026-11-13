/**
 * The shelf (ADR-0010): a world-space margin past a quiet fold. A reference's
 * position is the only record — there is no shelf flag, field, or folder — so
 * "set aside" is derived from where the word sits, and deferred vs rejected is
 * derived from its mark (open = deferred, no mark = rejected, ADR-0009).
 *
 * The fold's geometry is provisional and workspace-level: `shelf_x` in
 * `workspace.yml`, read tolerantly, defaulting for workspaces that predate it.
 * The scaffolded `AGENTS.md` states the same convention for delegates, so the
 * app and an agent read one rule.
 *
 * Provisional: the fold's default x and the set-aside column's offset are not
 * settled by any ADR; ADR-0010 fixes only that the fold is a workspace-level
 * convention rendered in world space.
 */

/**
 * Where the shelf's fold sits when `workspace.yml` does not say (provisional).
 * 1280 is the default 1200-px window plus a word's width: the whole initial
 * plane is live (a coin anywhere in view lands left of the fold), and the
 * shelf is a short pan to the right — panning is how the shelf is found
 * (ADR-0010).
 */
export const DEFAULT_SHELF_X = 1280;

/** World units between the fold and the column a rejected word lands in. */
export const SHELF_MARGIN = 28;

/**
 * The fold's world x from `workspace.yml`'s parsed fields. A missing, empty,
 * or unreadable value falls back to DEFAULT_SHELF_X, so a workspace created
 * before the shelf existed still opens with one (ADR-0010).
 */
export function shelfXOf(fields: Readonly<Record<string, string | number>>): number {
  const value = fields.shelf_x;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : DEFAULT_SHELF_X;
  }
  if (typeof value !== "string" || value.trim() === "") return DEFAULT_SHELF_X;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SHELF_X;
}

/** The word's centre x, from its top-left position and rendered width. */
export function wordCentreX(x: number, width: number): number {
  return x + width / 2;
}

/**
 * Is this word set aside? The fold tests the word's centre — the natural
 * "past the line" reading while a drag crosses it — not its left edge.
 * Reading a reference file alone, `x` at or past `shelf_x` is always set
 * aside (the centre is further right still); `x` just short of the fold
 * depends on the word's rendered width.
 */
export function isShelved(x: number, width: number, shelfX: number): boolean {
  return wordCentreX(x, width) >= shelfX;
}

/**
 * Where a rejected word lands: `null` when it is already set aside (the
 * settle alone completes the move), else a column just past the fold at its
 * current height — keeping the user's sense of place ("where did I put it?")
 * and storing nothing about having been rejected. One composed move: settle +
 * set aside (ADR-0010).
 */
export function rejectSpot(
  word: { x: number; y: number; width: number },
  shelfX: number,
): { x: number; y: number } | null {
  if (isShelved(word.x, word.width, shelfX)) return null;
  return { x: shelfX + SHELF_MARGIN, y: word.y };
}
