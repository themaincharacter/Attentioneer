/**
 * The double-click creation menu's geometry — pure rules (added 2026-11-16 per
 * user review).
 *
 * The review asked for a DRAW choice on the bubble cluster that opens at a
 * double-click. The bubble is an ACTION — it arms the same pen the level
 * control's `draw` toggle arms — and NOT a creation kind: gates.ts's
 * `CreationKind`, `creationKinds` and `offeredCreationKinds` keep their shape,
 * so the creation grammar (and the ghost's card derivation that reads it) never
 * grows a kind nobody can create.
 *
 * THE ANCHOR INVARIANT. The inked dot IS the anchor: its centre must stay
 * exactly on the plane point wherever the cluster's bubbles sit. The cluster is
 * a column — the bubbles above the dot, the dot, the bubbles below — and its box
 * is centred on the point (the app's `translate(-50%, -50%)`), so the dot's
 * centre sits `(above − below) / 2` bubbles below the box's centre, each bubble
 * `bubble height + gap` tall; the cluster is lifted by exactly that offset. A
 * SYMMETRIC cluster — the word above the dot and the pen below it, which is the
 * cluster now — needs NO lift at all. The review's earlier single "word" bubble
 * (one bubble, nothing below) needed half a bubble plus the gap.
 *
 * The lift rides INSIDE the inverse-camera scale (`menuTransform`), so it is a
 * screen-pixel lift at every zoom and the dot lands on the plane point at 40%
 * as exactly as at 100% — the bubble's own height is a screen height too, so
 * the offset and the lift are the same unit.
 *
 * PROVISIONAL: the bubble's height, the gap and the dot's size are read from
 * canvas.css (13px/18px text, 5px padding, 1px border = a 30px bubble; a 9px
 * flex gap; a 6px dot). Change the CSS and these numbers must move with it.
 */

/** The bubble's whole height, CSS px (canvas.css `.plane-menu-option`). */
export const MENU_BUBBLE_H = 30;

/** The column's gap, CSS px (canvas.css `.plane-menu { gap: 9px }`). */
export const MENU_GAP = 9;

/**
 * The anchor dot's diameter, CSS px (canvas.css `.plane-menu-dot`). It cancels
 * out of the offset — the dot is centred on itself — and is named only so the
 * invariant can be computed from the column's whole height.
 */
export const MENU_DOT = 6;

/**
 * Which choices the cluster paints right now. The word sits above the dot WHEN
 * OFFERED — the separate-maps review (hidden 2026-11-16 per user review) makes
 * it concept-map content, so at dynamics and ground the top seat is empty and
 * the pen's draw bubble (always below the dot, in the slot the hidden lack
 * bubble used to hold) is the cluster. The geometry below already handles every
 * membership; only the app's read of the offer changed. The deprecated lack and
 * assumption bubbles keep their own slots for the sweep.
 */
export interface MenuMembers {
  /** Coin a word: concept-map content, offered at concept only. */
  word: boolean;
  /** DEPRECATED: the bare lack (hidden per the first review). */
  lack: boolean;
  /** DEPRECATED: dynamics' assumption (hidden per the first review). */
  assumption: boolean;
  /** The review's DRAW choice: arm the pen and dismiss (always offered). */
  draw: boolean;
}

/** The cluster as a column: what sits above the dot, below it, and the lift. */
export interface MenuCluster {
  /** Bubbles above the anchor dot. */
  above: number;
  /** Bubbles below it. */
  below: number;
  /** Both sides together (the cluster's bubble count). */
  total: number;
  /** The lift, in CSS px, that keeps the DOT on the plane point. */
  lift: number;
}

/**
 * How far the dot's centre sits BELOW the cluster's centre, in CSS px, for
 * `above` bubbles then the dot then `below` bubbles. The dot's own diameter
 * cancels out (it is centred on itself), so this one line is the whole rule: a
 * symmetric cluster is zero, one bubble above is half a bubble plus the gap.
 */
export function dotOffset(above: number, below: number): number {
  return ((above - below) / 2) * (MENU_BUBBLE_H + MENU_GAP);
}

/** The column for the choices the menu offers right now. */
export function menuCluster(members: MenuMembers): MenuCluster {
  const above = members.word ? 1 : 0;
  const below =
    (members.lack ? 1 : 0) +
    (members.assumption ? 1 : 0) +
    (members.draw ? 1 : 0);
  return { above, below, total: above + below, lift: dotOffset(above, below) };
}

/**
 * The cluster's inline transform: centre the box on the plane point, undo the
 * camera (the cluster stays readable at every zoom), and then lift it so the
 * dot — not the box's centre — sits on the point. The lift sits INSIDE the
 * inverse scale on purpose: applied outside, it would be a WORLD length and
 * would miss the point at every zoom but 100%.
 */
export function menuTransform(lift: number, zoom: number): string {
  return `translate(-50%, -50%) scale(${1 / zoom}) translateY(${-lift}px)`;
}
