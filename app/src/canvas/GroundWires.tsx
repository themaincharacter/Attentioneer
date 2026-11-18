import { useEffect, useRef, useState } from "react";
import type { GroundReference } from "../map/ground";
import { linkKey, type GroundLink } from "../map/groundLinks";
import type { GroundAddResult } from "./useGround";

/**
 * THE GROUND MAP'S WIRES (story 16.5): wordless links drawn between cards.
 *
 * A link is not a Distance (the epic's REFRAME, 2026-11-17): it carries no
 * coined word, no sign and no meaning, and the direction recorded in the file
 * is READ BY NOTHING here. The wire is therefore the ONLY ink this story adds:
 * one quiet line in the plane's world space, behind the cards, drawn with the
 * same camera transform they use — a line on the paper, not a screen overlay.
 * No label, no arrowhead, no count, no badge.
 *
 * Simple, not routed (provisional, ADR-0003's rendering seam): a straight line
 * between the two cards' facing edges, one stroke weight. The geometry is a
 * PURE helper (`wireGeometry`) so a test can assert where the line runs and
 * where its remove mark sits without a DOM; the layer only paints it.
 *
 * The wire takes no press of its own — a press on the thin hit band is a press
 * on the plane (pan), exactly as a distance wire's is. Hovering the band
 * reveals a small remove mark near the MIDPOINT; pressing it asks the card
 * delete's question ("remove this link?"), and only its own remove removes.
 * Any other press or Esc backs out. The two cards stay: unlinking is not
 * deleting.
 *
 * PROVISIONAL: the card box used for the edge anchors (300 x 220, mirrored
 * from canvas.css's `.ground-reference`), the hit band's width, the mark's
 * look and the two-step wording.
 */

/** The small card's world box, mirrored from canvas.css (PROVISIONAL). */
export const GROUND_CARD_W = 300;
export const GROUND_CARD_H = 220;

/** One wire's world geometry: where the line runs and where its mark sits. */
export interface WireGeometry {
  from: { x: number; y: number };
  to: { x: number; y: number };
  mid: { x: number; y: number };
  /** The line's world length, for the scaleX stretch. */
  length: number;
  /** The line's angle in degrees, for the rotate. */
  angle: number;
}

/** Any ground card a wire may run to: its slug and its point (PROVISIONAL box). */
export interface WireCard {
  on: string;
  x: number;
  y: number;
}

/** A card's world center (the card's left/top is its top-left corner). */
export function cardCenter(reference: WireCard): { x: number; y: number } {
  return {
    x: reference.x + GROUND_CARD_W / 2,
    y: reference.y + GROUND_CARD_H / 2,
  };
}

/**
 * Where a ray from the card's center toward `target` leaves the card's box.
 * The box is the provisional small CARDS's 300 x 220; a zero direction answers
 * the center itself (the caller skips a degenerate wire).
 */
function edgePoint(
  center: { x: number; y: number },
  target: { x: number; y: number },
): { x: number; y: number } {
  const dx = target.x - center.x;
  const dy = target.y - center.y;
  if (dx === 0 && dy === 0) return center;
  const halfW = GROUND_CARD_W / 2;
  const halfH = GROUND_CARD_H / 2;
  // Scale the direction until the FIRST box side is reached.
  const scale = Math.min(
    dx === 0 ? Infinity : halfW / Math.abs(dx),
    dy === 0 ? Infinity : halfH / Math.abs(dy),
  );
  return { x: center.x + dx * scale, y: center.y + dy * scale };
}

/**
 * One link's world geometry, PURE (story 16.5): the two cards' facing edges,
 * the line between them, and the midpoint that carries the remove mark. Null
 * when the two cards sit on the SAME point — a zero-length wire would be
 * invisible and its midpoint ambiguous, so nothing is drawn (the link record
 * still exists; this is a rendering decision, not a write).
 */
export function wireGeometry(
  from: WireCard,
  to: WireCard,
): WireGeometry | null {
  const fc = cardCenter(from);
  const tc = cardCenter(to);
  if (fc.x === tc.x && fc.y === tc.y) return null;
  const fromPoint = edgePoint(fc, tc);
  const toPoint = edgePoint(tc, fc);
  const dx = toPoint.x - fromPoint.x;
  const dy = toPoint.y - fromPoint.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return null;
  return {
    from: fromPoint,
    to: toPoint,
    mid: { x: (fromPoint.x + toPoint.x) / 2, y: (fromPoint.y + toPoint.y) / 2 },
    length,
    angle: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

interface GroundWiresProps {
  /** Every readable ground link, in FILE ORDER (later wires on top). */
  links: readonly GroundLink[];
  /** The cards the wires run between (orphans are reported, never drawn). */
  references: readonly GroundReference[];
  /**
   * STORY 17.9 — a wire may now run to or from an ASK or SESSION card too: the
   * user's correction makes anything a wire touches context for an ask card, so
   * those endpoints are drawn exactly like a reference's (same line, no label).
   */
  asks?: readonly WireCard[];
  sessions?: readonly WireCard[];
  /** Remove one exact ordered pair; the cards stay (the person's press). */
  onRemoveLink: (from: string, to: string) => Promise<GroundAddResult>;
}

export function GroundWires({
  links,
  references,
  asks = [],
  sessions = [],
  onRemoveLink,
}: GroundWiresProps) {
  const bySlug = new Map<string, WireCard>(
    [
      ...references.map((reference) => [reference.on, reference] as const),
      ...asks.map((ask) => [ask.on, ask] as const),
      ...sessions.map((session) => [session.on, session] as const),
    ],
  );
  return (
    <div className="ground-wires">
      {links.map((link, index) => {
        const from = bySlug.get(link.from);
        const to = bySlug.get(link.to);
        // An ORPHAN is never drawn: it has no card to attach to. The notices
        // group names it and the file keeps it (ADR-0009).
        if (from === undefined || to === undefined) return null;
        const geometry = wireGeometry(from, to);
        if (geometry === null) return null;
        return (
          <GroundWire
            key={`${linkKey(link.from, link.to)}-${index}`}
            link={link}
            geometry={geometry}
            onRemoveLink={onRemoveLink}
          />
        );
      })}
    </div>
  );
}

/** The two-step's steps: view state, never a record. */
export type GroundLinkStep = "idle" | "asking";

/**
 * One press on a wire's remove mark (story 16.5): pressing the mark only ASKS,
 * and any other press backs out — the card delete's rule, verbatim. PURE so the
 * two-step is not the DOM's only truth.
 */
export function linkStepAfter(action: "ask" | "elsewhere"): GroundLinkStep {
  return action === "ask" ? "asking" : "idle";
}

/** Does this step actually remove? Only the ask's own remove does. */
export function linkConfirmed(step: GroundLinkStep): boolean {
  return step === "asking";
}

/** ONE link's wire: the line, its midpoint mark and the two-step confirm. */
function GroundWire({
  link,
  geometry,
  onRemoveLink,
}: {
  link: GroundLink;
  geometry: WireGeometry;
  onRemoveLink: (from: string, to: string) => Promise<GroundAddResult>;
}) {
  const wireRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<GroundLinkStep>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // d3-zoom stops mousedown at the plane, so the wire's OWN affordances (the
  // mark and the confirm's two verbs) must stop their press first — a press on
  // either must never pan the plane behind it (the card's raw-listener idiom).
  // The wire's thin hit band deliberately does NOT stop a press: it is as much
  // paper as the plane around it.
  useEffect(() => {
    const elements = [markRef.current, confirmRef.current];
    const stop = (event: Event) => event.stopPropagation();
    for (const el of elements) el?.addEventListener("mousedown", stop);
    return () => {
      for (const el of elements) el?.removeEventListener("mousedown", stop);
    };
  });

  // Click away / Esc backs the ask out, exactly like the card's delete.
  useEffect(() => {
    if (step === "idle") return;
    function onPressAway(event: MouseEvent) {
      // A press inside this wire (the confirm's own verbs) is not a press
      // away: the two-step would otherwise back itself out before the remove.
      const el = wireRef.current;
      if (el !== null && event.target instanceof Node && el.contains(event.target)) {
        return;
      }
      setStep(linkStepAfter("elsewhere"));
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setStep(linkStepAfter("elsewhere"));
    }
    document.addEventListener("mousedown", onPressAway, true);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPressAway, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [step]);

  async function remove() {
    if (busy || !linkConfirmed(step)) return;
    setBusy(true);
    setProblem(null);
    const result = await onRemoveLink(link.from, link.to);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      setStep(linkStepAfter("elsewhere"));
    }
  }

  const lineTransform = `translate3d(${geometry.from.x}px, ${geometry.from.y}px, 0) rotate(${geometry.angle}deg)`;
  return (
    <div
      ref={wireRef}
      className="ground-wire"
      data-from={link.from}
      data-to={link.to}
    >
      <div
        className="ground-wire-line"
        style={{ transform: `${lineTransform} scaleX(${geometry.length})` }}
      />
      {/* The hover band: a press on it is a press on the plane (the wire has
          no press of its own), but hovering it reveals the remove mark. */}
      <div
        className="ground-wire-hit"
        style={{ transform: `${lineTransform} scaleX(${geometry.length})` }}
      />
      {step === "asking" ? (
        <div
          ref={confirmRef}
          className="ground-wire-confirm"
          style={{ left: geometry.mid.x, top: geometry.mid.y }}
        >
          <div className="ground-wire-confirm-question">
            remove this link?
          </div>
          <div className="ground-wire-confirm-actions">
            <button
              type="button"
              className="ground-wire-confirm-remove"
              disabled={busy}
              onClick={() => void remove()}
            >
              remove
            </button>
            <button
              type="button"
              className="ground-wire-confirm-cancel"
              disabled={busy}
              onClick={() => setStep(linkStepAfter("elsewhere"))}
            >
              cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          ref={markRef}
          type="button"
          className="ground-wire-mark"
          style={{ left: geometry.mid.x, top: geometry.mid.y }}
          aria-label="remove link"
          title="remove link"
          onClick={() => {
            setProblem(null);
            setStep(linkStepAfter("ask"));
          }}
        >
          ×
        </button>
      )}
      {problem !== null && (
        <div
          className="ground-wire-problem"
          style={{ left: geometry.mid.x, top: geometry.mid.y }}
          role="status"
          onClick={() => setProblem(null)}
        >
          {problem}
        </div>
      )}
    </div>
  );
}
