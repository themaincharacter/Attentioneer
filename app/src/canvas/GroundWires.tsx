import { useEffect, useRef, useState } from "react";
import type { GroundReference } from "../map/ground";
import { linkKey, type GroundLink } from "../map/groundLinks";
import {
  wireEndsUnderDrag,
  type GroundDragChannel,
} from "./groundDragRef";
import { GROUND_CARD_BOX } from "./geometry";
import type { WorkingChannel } from "./workingRef";
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
 * STORY 16.25 — A WIRE FOLLOWS THE CARD THE HAND IS CARRYING. The cards used
 * to drag on React state, and the wires read RECORDS, so a wire stood still
 * until the drop and then jumped: "the wire doesn't really follow very well."
 * The drag now publishes ONE in-flight point on a shared channel
 * (`groundDragRef.ts`), and each wire subscribes to it: a wire whose two ends
 * do not name the dragged card does NOTHING for that frame, and the wires that
 * do touch it recompute the same pure `wireGeometry` from the live point and
 * repaint their own elements. No wire re-renders, no wire is recomputed that the
 * drag does not touch, and the geometry rule is the one this module already had.
 *
 * PROVISIONAL: the card box used for the edge anchors (300 x 220, mirrored
 * from canvas.css's `.ground-reference`), the hit band's width, the mark's
 * look and the two-step wording.
 */

/**
 * The small card's world box, mirrored from canvas.css (PROVISIONAL). STORY
 * 17.15 moved the numbers into `geometry` so placement and the wire cannot
 * disagree about where a card's right or left edge is; these two names stay the
 * wire's own reading of them.
 */
export const GROUND_CARD_W = GROUND_CARD_BOX.w;
export const GROUND_CARD_H = GROUND_CARD_BOX.h;

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

/**
 * STORY 24-2 (ADR-0043) — THE CONDUIT'S LEGS. A cable runs in two straight
 * legs with ONE quarter-turn (the pipes of the mock): horizontal-first when the
 * run is wider than it is tall, vertical-first otherwise, so the leg leaving a
 * card's facing edge does the most running. A run that is already straight has
 * one full leg and one zero-length leg, so every wire paints the same parts.
 * PURE and additive: `wireGeometry` (the mark's truth) is untouched.
 */
export interface ConduitLeg {
  x: number;
  y: number;
  length: number;
  angle: number;
}

export function conduitLegs(
  from: { x: number; y: number },
  to: { x: number; y: number },
): { first: ConduitLeg; second: ConduitLeg } {
  const horizontalFirst =
    Math.abs(to.x - from.x) >= Math.abs(to.y - from.y);
  const bend = horizontalFirst
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };
  const leg = (
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): ConduitLeg => {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    return {
      x: a.x,
      y: a.y,
      length: Math.hypot(dx, dy),
      angle: (Math.atan2(dy, dx) * 180) / Math.PI,
    };
  };
  return { first: leg(from, bend), second: leg(bend, to) };
}

/**
 * STORY 24-15 — WHERE THE CURRENT'S SPARK SITS, PURE. The route is the
 * conduit's legs (from -> bend -> to); t runs 0..1 along its total length.
 */
export function pointAlongRoute(
  legs: readonly ConduitLeg[],
  t: number,
): { x: number; y: number } {
  const first = legs[0];
  if (first === undefined) return { x: 0, y: 0 };
  const total = legs.reduce((sum, leg) => sum + leg.length, 0);
  if (total === 0) return { x: first.x, y: first.y };
  let want = Math.min(Math.max(t, 0), 1) * total;
  for (const leg of legs) {
    if (want <= leg.length) {
      const ratio = leg.length === 0 ? 0 : want / leg.length;
      return {
        x: leg.x + Math.cos((leg.angle * Math.PI) / 180) * leg.length * ratio,
        y: leg.y + Math.sin((leg.angle * Math.PI) / 180) * leg.length * ratio,
      };
    }
    want -= leg.length;
  }
  const last = legs[legs.length - 1]!;
  return {
    x: last.x + Math.cos((last.angle * Math.PI) / 180) * last.length,
    y: last.y + Math.sin((last.angle * Math.PI) / 180) * last.length,
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
  /**
   * STORY 16.25 — THE LIVE DRAG: the dragged card's slug and point while the
   * hand is down. Optional so a render test needs no channel; a wire with no
   * channel simply paints where the records say, exactly as before.
   */
  drag?: GroundDragChannel;
  /** STORY 24-15: the map's working channel (absent in a render test). */
  working?: WorkingChannel;
}

export function GroundWires({
  links,
  references,
  asks = [],
  sessions = [],
  onRemoveLink,
  drag,
  working,
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
            from={from}
            to={to}
            geometry={geometry}
            onRemoveLink={onRemoveLink}
            drag={drag}
            working={working}
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
  from,
  to,
  geometry,
  onRemoveLink,
  drag,
  working,
}: {
  link: GroundLink;
  /** The two cards this wire runs between, so the live drag can move one end. */
  from: WireCard;
  to: WireCard;
  geometry: WireGeometry;
  onRemoveLink: (from: string, to: string) => Promise<GroundAddResult>;
  /** STORY 16.25: the map's one in-flight drag (absent in a render test). */
  drag?: GroundDragChannel;
  /** STORY 24-15: the map's working channel (absent in a render test). */
  working?: WorkingChannel;
}) {
  const wireRef = useRef<HTMLDivElement>(null);
  // STORY 24-2: the conduit paints TWO legs, TWO hit bands and TWO terminal
  // clamps per wire, all written imperatively by `paintWire` (never state).
  const lineRefs = useRef<(HTMLDivElement | null)[]>([]);
  const hitRefs = useRef<(HTMLDivElement | null)[]>([]);
  const clampRefs = useRef<(HTMLDivElement | null)[]>([]);
  const markRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const problemRef = useRef<HTMLDivElement>(null);
  // STORY 24-15: the current's spark (moved imperatively along the route).
  const sparkRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<GroundLinkStep>("idle");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // STORY 24-15 — THE CURRENT (the person: a loading signal may be FLASHY —
  // "this is not distraction this is an important signal"). While either end
  // works, the wire says so: the attribute dresses the cable (the stylesheet
  // lights its core), and a spark runs the route TOWARD the working card — a
  // wire is context, so the current is what the work is being fed. The loop is
  // rAF and IMPERATIVE (the drag's idiom): no render per frame, and it stops
  // the moment the work does. Reduced motion never starts it — the lit core
  // is then the whole signal.
  useEffect(() => {
    const channel = working;
    if (channel === undefined) return;
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let travel = 0;
    const step = () => {
      const spark = sparkRef.current;
      const live = wireGeometry(from, to);
      if (spark !== null && live !== null) {
        const legs = conduitLegs(live.from, live.to);
        const at = pointAlongRoute(
          [legs.first, legs.second],
          channel.is(to.on) ? travel : 1 - travel,
        );
        spark.style.left = `${at.x}px`;
        spark.style.top = `${at.y}px`;
      }
      travel = (travel + 0.012) % 1;
      raf = requestAnimationFrame(step);
    };
    const paint = () => {
      const el = wireRef.current;
      if (el === null) return;
      const on = channel.is(from.on) || channel.is(to.on);
      if (on) el.setAttribute("data-working", "");
      else el.removeAttribute("data-working");
      if (on && !reduced && raf === 0) raf = requestAnimationFrame(step);
      if (!on && raf !== 0) {
        cancelAnimationFrame(raf);
        raf = 0;
        travel = 0;
      }
    };
    paint();
    const unsubscribe = channel.subscribe(paint);
    return () => {
      unsubscribe();
      if (raf !== 0) cancelAnimationFrame(raf);
    };
  }, [working, from, to]);

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

  /**
   * STORY 16.25 — PAINT ONE LIVE FRAME where the drag put this wire's ends.
   * Only the two transformed bands and the three midpoint marks are written;
   * this wire is not re-rendered and no other wire is touched. A frame that
   * puts the cards exactly on top of each other answers `null` from the same
   * `wireGeometry` rule that declines to draw the line at all, so the wire is
   * hidden for those frames instead of inventing a direction.
   */
  function paintWire(live: WireGeometry | null): void {
    if (live === null) {
      for (const el of lineRefs.current) {
        if (el !== null) el.style.opacity = "0";
      }
      for (const el of hitRefs.current) {
        if (el !== null) el.style.opacity = "0";
      }
      for (const el of clampRefs.current) {
        if (el !== null) el.style.opacity = "0";
      }
      return;
    }
    // STORY 24-2 — the same live frame, now as a conduit: the two legs carry
    // the transform, the two clamps grip the run's ends. Still only style
    // writes: no wire re-renders, nothing but the touched wires repaint.
    const legs = conduitLegs(live.from, live.to);
    const parts: ConduitLeg[] = [legs.first, legs.second];
    parts.forEach((leg, index) => {
      const transform = `translate3d(${leg.x}px, ${leg.y}px, 0) rotate(${leg.angle}deg) scaleX(${leg.length})`;
      const line = lineRefs.current[index];
      if (line !== null && line !== undefined) {
        line.style.opacity = "";
        line.style.transform = transform;
      }
      const hit = hitRefs.current[index];
      if (hit !== null && hit !== undefined) {
        hit.style.opacity = "";
        hit.style.transform = transform;
      }
    });
    const straight = legs.second.length === 0;
    const ends = [
      { at: live.from, angle: legs.first.angle },
      { at: live.to, angle: straight ? legs.first.angle : legs.second.angle },
    ];
    ends.forEach((end, index) => {
      const clamp = clampRefs.current[index];
      if (clamp === null || clamp === undefined) return;
      clamp.style.opacity = "";
      clamp.style.left = `${end.at.x}px`;
      clamp.style.top = `${end.at.y}px`;
      clamp.style.transform = `rotate(${end.angle}deg)`;
    });
    for (const el of [markRef.current, confirmRef.current, problemRef.current]) {
      if (el === null) continue;
      el.style.left = `${live.mid.x}px`;
      el.style.top = `${live.mid.y}px`;
    }
  }

  // STORY 16.25 — THE WIRE READS THE LIVE DRAG, and only when the drag names
  // one of its own ends: a wire anywhere else on the map does nothing at all
  // for that frame. The listener leaves with the component, like every raw
  // listener here.
  useEffect(() => {
    if (drag === undefined) return;
    return drag.subscribe((at) => {
      if (at === null) {
        // The hand is up: the records are the truth again.
        paintWire(wireGeometry(from, to));
        return;
      }
      if (at.slug !== from.on && at.slug !== to.on) return;
      const ends = wireEndsUnderDrag(from, to, at);
      paintWire(wireGeometry(ends.from, ends.to));
    });
  }, [drag, from, to]);

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

  const legs = conduitLegs(geometry.from, geometry.to);
  const legParts: ConduitLeg[] = [legs.first, legs.second];
  const clampEnds = [
    { at: geometry.from, angle: legs.first.angle },
    {
      at: geometry.to,
      angle: legs.second.length === 0 ? legs.first.angle : legs.second.angle,
    },
  ];
  return (
    <div
      ref={wireRef}
      className="ground-wire"
      data-from={link.from}
      data-to={link.to}
    >
      {legParts.map((leg, index) => (
        <div
          key={`leg-${index}`}
          ref={(el) => {
            lineRefs.current[index] = el;
          }}
          className="ground-wire-line"
          style={{
            transform: `translate3d(${leg.x}px, ${leg.y}px, 0) rotate(${leg.angle}deg) scaleX(${leg.length})`,
          }}
        />
      ))}
      {/* The hover band: a press on it is a press on the plane (the wire has
          no press of its own), but hovering it reveals the remove mark. One
          band per leg, so the hover hugs the cable. */}
      {legParts.map((leg, index) => (
        <div
          key={`hit-${index}`}
          ref={(el) => {
            hitRefs.current[index] = el;
          }}
          className="ground-wire-hit"
          style={{
            transform: `translate3d(${leg.x}px, ${leg.y}px, 0) rotate(${leg.angle}deg) scaleX(${leg.length})`,
          }}
        />
      ))}
      {/* STORY 24-2 — THE TERMINAL CLAMPS: one at each end, gripping the run
          at the angle it leaves. Purely painted (no press, no state). */}
      {clampEnds.map((end, index) => (
        <div
          key={`clamp-${index}`}
          ref={(el) => {
            clampRefs.current[index] = el;
          }}
          className="ground-wire-clamp"
          aria-hidden="true"
          style={{
            left: end.at.x,
            top: end.at.y,
            transform: `rotate(${end.angle}deg)`,
          }}
        />
      ))}
      {/* STORY 24-15 — THE CURRENT'S SPARK: hidden unless this wire feeds a
          working card (the stylesheet lights it); moved along the route by the
          effect above. */}
      <div ref={sparkRef} className="ground-wire-current" aria-hidden="true" />
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
          ref={problemRef}
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
