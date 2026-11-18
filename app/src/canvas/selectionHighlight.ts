/**
 * STORY 16.31 — THE HIGHLIGHT THAT OUTLIVES THE BROWSER'S OWN.
 *
 * The user: "The selection highlight ask is great. It does lose the highlight
 * though whenever the widget pops up, which also means you lose the ability to
 * right click and copy text." Losing the highlight is not cosmetic: it removes
 * the evidence of what was asked about.
 *
 * THE RULE THIS FILE KEEPS: the native selection is the first highlight, and it
 * is never touched as the widget opens (no focus steal, no clear on mount). But
 * a browser may drop it anyway — the field takes focus, the card re-renders —
 * and then the captured words must stay visible. So the capture takes the
 * range's client rects ONCE, at mouse-up, and this file turns them into plane
 * rectangles: the words keep their highlight while the widget is open, and the
 * overlay rides the camera instead of hanging over whatever later sits under a
 * fixed screen point. "Never linger over the wrong text" is the hard rule, so
 * the conversion is made once and the rectangles are never re-measured.
 *
 * Pure on purpose: no DOM here, so the arithmetic and the one "is the browser
 * still selecting?" question are provable without a window. PROVISIONAL
 * (ADR-0003's rendering seam): the conversion's inputs and the painted look.
 */

/** The part of a DOM rectangle this file needs; a DOMRect satisfies it. */
export interface ClientRectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One painted rectangle, already in PLANE coordinates (what .plane-inner holds). */
export interface PaintedRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The plane point the card's own top-left sits at. */
export interface PlaneOrigin {
  x: number;
  y: number;
}

/**
 * THE CAPTURED RECTS, ONCE, IN PLANE SPACE. A client rect becomes a plane rect
 * by subtracting the card's own client origin and dividing by the camera's zoom
 * — exactly the road the widget's own point already travels — so the highlight
 * stays glued to the words through a pan or a zoom.
 *
 * An empty or a negative client rect is dropped (a collapsed line box paints
 * nothing), and with no card rect or a zero zoom there is nothing honest to
 * paint: the answer is no rectangles, never a guessed one.
 */
export function paintedHighlightRects(
  rects: readonly ClientRectLike[],
  card: ClientRectLike | null,
  origin: PlaneOrigin,
  zoom: number,
): PaintedRect[] {
  if (card === null || !(zoom > 0)) return [];
  const painted: PaintedRect[] = [];
  for (const rect of rects) {
    const width = rect.right - rect.left;
    const height = rect.bottom - rect.top;
    if (!(width > 0) || !(height > 0)) continue;
    painted.push({
      x: origin.x + (rect.left - card.left) / zoom,
      y: origin.y + (rect.top - card.top) / zoom,
      width: width / zoom,
      height: height / zoom,
    });
  }
  return painted;
}

/** The part of a Selection this file needs to answer "is it still showing?". */
export interface SelectionLike {
  isCollapsed: boolean;
  rangeCount: number;
}

/**
 * IS THE BROWSER'S SELECTION STILL VISIBLE? The widget asks this at mount and on
 * every selection change; a "no" is the moment it paints over the captured
 * words. A collapsed or empty selection shows nothing, so it does not count —
 * and there is no un-painting: once the highlight is ours, it stays ours until
 * the widget closes. That is the user's rule, said in code: right-click copy
 * works until the person types; after that the highlight is ours.
 */
export function nativeSelectionPresent(
  selection: SelectionLike | null | undefined,
): boolean {
  if (selection === null || selection === undefined) return false;
  return selection.rangeCount > 0 && !selection.isCollapsed;
}
