import { LEVELS, type Level } from "../workspace/level";
import type { Point } from "./geometry";
import { zoomAbout, type Camera } from "./useCamera";
import { BAND_ZOOM } from "./zoomBands";

/**
 * The per-word anchored follow (ADR-0019 decision 2; Epic 6 story 3): the
 * cross-band vocabulary is MOVEMENT, never pixels. One quiet control on a
 * word's row jumps the camera into another game's band while keeping the WORD
 * under the eye — an anchored jump, the same shared intent the level control
 * and the open-restore use (`setZoomBand(level, sx, sy)`), with the word's own
 * screen position as the anchor.
 *
 * THE NEUTRALITY RULE (ADR-0019; the red team's finding): the control is
 * rendered on EVERY word in EVERY game, and nothing about its render may read
 * a face. A word with pointers, assumptions or loop membership must look and
 * behave exactly like a bare word — a face is follow-reachable once the word
 * is found, NEVER announced across bands. `FollowControlView` therefore reads
 * exactly one input, the running game (which picks the two other games to
 * offer), and no presence-derived field exists to pass.
 *
 * The anchored math is `camera + world * zoom` for the screen point, then
 * `zoomAbout` at the band's landing zoom about that point — exactly what the
 * camera intent does, so the pure rule and the pixels cannot drift.
 *
 * Provisional: the control's glyph and the tiny menu's look (ADR-0003's
 * rendering seam); the two-other-games offer and the anchor at the word's
 * centre are story 3's look-level choices, not settled by an ADR.
 */

/** The two games the follow control offers: every game but the running one. */
export function followTargets(current: Level): Level[] {
  return LEVELS.filter((game) => game !== current);
}

/**
 * What the follow control renders from. ONE input — the running game — and
 * deliberately nothing else: no pointer, assumption, loop or mark fact may
 * enter this shape, or the control would announce a face (ADR-0019).
 */
export interface FollowControlView {
  /** The two other games, in the control's order (`LEVELS`' order). */
  targets: Level[];
}

/** The control's whole render input: the running game, and only that. */
export function followControlView(current: Level): FollowControlView {
  return { targets: followTargets(current) };
}

/**
 * The screen point a world point sits under for a camera — the plane's own
 * transform (`translate(x, y) scale(zoom)`), so it agrees with the pixels
 * without a DOM.
 */
export function screenPointOf(world: Point, camera: Camera): Point {
  return {
    x: camera.x + world.x * camera.zoom,
    y: camera.y + world.y * camera.zoom,
  };
}

/** The anchor the follow passes on: the word's centre, where it is now. */
export function followAnchor(wordCentre: Point, camera: Camera): Point {
  return screenPointOf(wordCentre, camera);
}

/**
 * The camera after an anchored follow into `target`: the band's landing zoom,
 * zoomed ABOUT the word's current screen position — so the word stays under
 * the eye across the jump. Pure, and identical to the camera intent's
 * `setZoomBand(target, anchor.x, anchor.y)`.
 *
 * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps, ADR-0032):
 * each map keeps its OWN camera now, so a switch to another map cannot keep a
 * world point under the eye — the map you land on brings back the view you left
 * it at. The follow's LEVEL FACES are already hidden (`CROSS_LEVEL_FACES_HIDDEN`),
 * so nothing calls this; the math stays written and tested for the flip-back —
 * delete it in the deprecated sweep.
 */
export function followCamera(
  camera: Camera,
  target: Level,
  wordCentre: Point,
): Camera {
  const anchor = followAnchor(wordCentre, camera);
  return zoomAbout(camera, BAND_ZOOM[target], anchor.x, anchor.y);
}
