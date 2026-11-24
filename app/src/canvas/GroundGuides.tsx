import { useEffect, useRef } from "react";
import { GROUND_CARD_BOX } from "./geometry";
import type { GroundDragChannel } from "./groundDragRef";

/** A card's point as the guides see it (the wire's own reading of a card). */
export interface GuideBox {
  x: number;
  y: number;
}

/** A named card on the map: the layer's own rows, slug and point. */
export interface GuideCard extends GuideBox {
  on: string;
}

/** One line to draw: vertical lines sit at an x, horizontal at a y. */
export interface GuideLine {
  vertical: boolean;
  at: number;
  start: number;
  end: number;
}

/** How near is "near" (world units, PROVISIONAL). */
export const GUIDE_SNAP_PX = 6;

/** How far a guide runs past the two boxes it joins (PROVISIONAL). */
export const GUIDE_SPAN_PAD = 24;

/** Never more than four lines at once (PROVISIONAL). */
export const GUIDE_MAX_LINES = 4;

const EDGE_FRACTIONS = [0, 0.5, 1];

/**
 * STORY 24-3 (ADR-0043) — WHICH GUIDES TO DRAW, PURE. A line appears where an
 * edge of the dragged box lines up (within `snap`) with an edge of a
 * neighbour: one line at the pair's MIDPOINT, spanning both boxes. Three edges
 * a side (left/centre/right, top/middle/bottom); one line per position even
 * when several pairs agree; at most `GUIDE_MAX_LINES`. VISUAL ONLY — this
 * function never moves a card, and nothing here is a snap.
 */
export function guideMatches(
  dragged: GuideBox,
  others: readonly GuideBox[],
  snap: number,
): GuideLine[] {
  const w = GROUND_CARD_BOX.w;
  const h = GROUND_CARD_BOX.h;
  const draggedX = EDGE_FRACTIONS.map((f) => dragged.x + f * w);
  const draggedY = EDGE_FRACTIONS.map((f) => dragged.y + f * h);
  const out: GuideLine[] = [];
  const seen = new Set<string>();
  const add = (line: GuideLine) => {
    const key = (line.vertical ? "v" : "h") + ":" + Math.round(line.at);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(line);
  };
  for (const other of others) {
    for (const mine of draggedX) {
      for (const theirs of [other.x, other.x + w / 2, other.x + w]) {
        if (Math.abs(mine - theirs) > snap) continue;
        add({
          vertical: true,
          at: (mine + theirs) / 2,
          start: Math.min(dragged.y, other.y) - GUIDE_SPAN_PAD,
          end: Math.max(dragged.y + h, other.y + h) + GUIDE_SPAN_PAD,
        });
      }
    }
    for (const mine of draggedY) {
      for (const theirs of [other.y, other.y + h / 2, other.y + h]) {
        if (Math.abs(mine - theirs) > snap) continue;
        add({
          vertical: false,
          at: (mine + theirs) / 2,
          start: Math.min(dragged.x, other.x) - GUIDE_SPAN_PAD,
          end: Math.max(dragged.x + w, other.x + w) + GUIDE_SPAN_PAD,
        });
      }
    }
  }
  return out.slice(0, GUIDE_MAX_LINES);
}

/**
 * THE GUIDES' LAYER (story 24-3): mounted beside the wires, riding the SAME
 * drag channel. Like the wires, it paints its own elements per frame and never
 * re-renders — a drag still renders nothing. The lines are screen-space
 * hairlines on the world layer (the lasso's non-scaling idiom) and take no
 * press: pointer-events none by the stylesheet.
 */
export function GroundGuides({
  cards,
  drag,
}: {
  cards: readonly GuideCard[];
  drag?: GroundDragChannel;
}) {
  const linesRef = useRef<(SVGLineElement | null)[]>([]);
  useEffect(() => {
    if (drag === undefined) return;
    return drag.subscribe((at) => {
      const lines = linesRef.current;
      if (at === null) {
        for (const line of lines) {
          if (line !== null && line !== undefined) line.style.display = "none";
        }
        return;
      }
      const matches = guideMatches(
        { x: at.x, y: at.y },
        cards.filter((card) => card.on !== at.slug),
        GUIDE_SNAP_PX,
      );
      lines.forEach((line, index) => {
        if (line === null || line === undefined) return;
        const match = matches[index];
        if (match === undefined) {
          line.style.display = "none";
          return;
        }
        line.style.display = "";
        if (match.vertical) {
          line.setAttribute("x1", String(match.at));
          line.setAttribute("x2", String(match.at));
          line.setAttribute("y1", String(match.start));
          line.setAttribute("y2", String(match.end));
        } else {
          line.setAttribute("y1", String(match.at));
          line.setAttribute("y2", String(match.at));
          line.setAttribute("x1", String(match.start));
          line.setAttribute("x2", String(match.end));
        }
      });
    });
  }, [cards, drag]);
  return (
    <svg className="ground-guides" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <line
          key={index}
          ref={(el) => {
            linesRef.current[index] = el;
          }}
          className="ground-guide-line"
          style={{ display: "none" }}
        />
      ))}
    </svg>
  );
}
