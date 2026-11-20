import { isTextField, type TextFieldLike } from "./gates";
import type { Point } from "./geometry";
import {
  dropWorldPoint,
  type DropCamera,
  type DropClientPoint,
  type DropRect,
} from "./osDrop";
import { webLinkOf, webLinkName } from "./webLink";

/**
 * STORY 16.34 — PASTE A LINK, AND IT LANDS WHERE YOU LAST POINTED.
 *
 * The drop's sibling: the clipboard carries a web address, the person presses
 * paste with the canvas in front of them, and the SAME page card creator makes
 * the same card as a drop or the bubble. The rules are pure and live here; the
 * window seam (App.tsx, beside the drop listener) hands them the text, the
 * focused element and the plane's measured box.
 *
 * THE PASTE HAS NO CANVAS CURSOR. A drop reports the pointer; a paste reports
 * nothing but a keystroke. So the point is THE LAST PLACE THE POINTER RESTED
 * OVER THE PLANE — the point the person was pointing at when they reached for
 * the clipboard — converted by the canvas's own `clientToWorld` in
 * `pasteWorldPoint`. If the pointer has not been over the plane since the map
 * opened, the centre of the visible canvas is used: it is on screen at any
 * zoom, unlike the world origin. PROVISIONAL: that rule (the story names it).
 *
 * PASTE IS NOT A HIJACK. If the focused element is a text field, the paste
 * belongs to the field and nothing is created — the listener does not even read
 * the clipboard. The rule for "a text field" is the level pin's own
 * (`gates.ts`'s `isTextField`), reused rather than restated: a field that
 * holds uncommitted typing there is a field here too. Plain TEXT paste is OUT
 * of scope: there is no text-card family yet, so a pasted string that is not an
 * http(s) address is left alone and creates nothing. Nothing here writes a
 * record.
 */

// The level pin's own focus rule, re-exported so this module's callers and
// tests read the one definition (gates.ts).
export { isTextField };

/**
 * May this paste become a card? No when either the event's target or the
 * document's focused element is a text field: the keystroke belongs to the
 * field. Both are checked because a paste can be dispatched at a field the
 * document does not consider focused.
 */
export function pasteBelongsToField(
  target: TextFieldLike | null,
  active: TextFieldLike | null,
): boolean {
  return isTextField(target) || isTextField(active);
}

/** The web address a pasted string names, or null — the ONE validator. */
export function pasteUrl(text: string): string | null {
  return webLinkOf(text);
}

/** The card's name for a pasted link: the address's host. */
export function pasteName(url: string): string {
  return webLinkName(url);
}

/**
 * The viewport point a paste lands at: the last point the pointer rested over
 * the plane, or the measured plane's centre when it never did. This is the
 * paste's stand-in for the drop's pointer.
 */
export function pasteClientPoint(
  last: DropClientPoint | null,
  rect: DropRect,
): DropClientPoint {
  if (last !== null) return last;
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2,
  };
}

/**
 * The WORLD point a paste lands at, through the SAME conversion and guard a
 * drop uses (`osDrop.ts`'s `dropWorldPoint`, which is `clientToWorld` plus the
 * "nothing usable writes nothing" check — not a second transform). Null when
 * the plane or the camera cannot give a usable transform.
 */
export function pasteWorldPoint(
  last: DropClientPoint | null,
  rect: DropRect,
  camera: DropCamera,
): Point | null {
  return dropWorldPoint(pasteClientPoint(last, rect), rect, camera);
}
