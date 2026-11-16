import { useEffect, useRef } from "react";
import type { PullReading } from "../pull/ask";
import {
  PULL_CLOSE_LABEL,
  PULL_PANEL_LABEL,
  PULL_TITLE,
  pullLines,
} from "./pullRules";

interface PullPanelProps {
  /**
   * The reading the ask just made. This value IS the surface: the app holds it
   * while the panel is open and drops it when the panel closes, so there is no
   * stored reading, no last-seen, and nothing that survives the close.
   */
  reading: PullReading;
  /**
   * Close it. Closing IS the dismissal (ADR-0030 decision 4): nothing is
   * written, nothing is suppressed, and the next ask reads the records again.
   */
  onClose: () => void;
}

/**
 * THE PULL ASK'S TRANSIENT READING (Epic 13 story 2; ADR-0030 decisions 4–6) —
 * the one surface the ask opens.
 *
 * It shows TWO things and nothing else: the selection sentence, SAID at the
 * top (the reading's own words, from the reader — "this speaks where records
 * exist; the rest is silence, not safety"), and then the sites as ONE block of
 * lines: each record's own line, the standing rule sentence a dangling pin
 * carries, and a veil's name and location. There is no per-family heading, no
 * numbers, no totals, no cursor and no order claim: the records are
 * co-present, and what speaks is each record at its own site. The surface adds
 * no sentence of its own — it cannot, and that is the point (the records ARE
 * the explanation).
 *
 * It is a READ-ONLY transient in the app's quiet idiom (the peek's precedent):
 * a fixed panel outside the plane, focus moved into it on open, closed by Esc,
 * its quiet × or a press away. It writes NOTHING — no file, no log, no PRISM,
 * no storage — and keeps no state of its own beyond the props. A level switch
 * leaves it standing (the reading belongs to no game); a branch switch or a
 * workspace change closes it, because the pins and the map it read are not the
 * ones now running.
 *
 * Provisional (ADR-0003/0030): the panel's look and the one-block rendering.
 */
export function PullPanel({ reading, onClose }: PullPanelProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Opening moves focus into the reading (the window idiom).
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Esc closes it: the dismissal is the close, and nothing else happens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A press away closes it (the capture phase: the plane's own listeners run
  // below). A press inside the reading is not away — it is the reading.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="pull-panel"
      role="group"
      tabIndex={-1}
      aria-label={PULL_PANEL_LABEL}
    >
      <div className="pull-head">
        <span className="pull-title">{PULL_TITLE}</span>
        <button
          type="button"
          className="pull-close"
          aria-label={PULL_CLOSE_LABEL}
          title="close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>
      <div className="pull-said">{reading.said}</div>
      <div className="pull-lines">{pullLines(reading)}</div>
    </div>
  );
}
