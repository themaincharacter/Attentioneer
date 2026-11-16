import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Prism } from "../map/prisms";
import {
  EXPLANATION_LABEL,
  EXPLANATION_PLACEHOLDER,
  NO_MOVE_YET,
  NOT_SAVED,
  PRISM_TOOLTIP,
  changeDetail,
  changeOutcome,
  changeWord,
  contactWord,
  prismLabel,
} from "./prismRules";
import { clampPeekAnchor } from "./outwardRules";
import { usePlane } from "./CanvasPlane";
import type { Point } from "./geometry";

interface PrismWindowProps {
  /** The world point the window hangs off (beside its word, never in it). */
  anchor: Point;
  /** The word's coined NAME (aria and header; the slug stays in the record). */
  name: string;
  /** The ONE Move this window shows — or null when the reach has none yet. */
  prism: Prism | null;
  /** A quiet sentence for an empty window or a refused Move (null otherwise). */
  note: string | null;
  /** Save the person's explanation on this Move (true when the line exists). */
  onSaveExplanation: (id: string, explanation: string) => Promise<boolean>;
  /** Esc, the window's x, a press outside or a level switch. */
  onClose: () => void;
}

interface Viewport {
  width: number;
  height: number;
}

interface Box {
  width: number;
  height: number;
}

/** The plane fills the app viewport; the clamp works in those pixels. */
function viewportOf(): Viewport {
  if (typeof window === "undefined") return { width: 1200, height: 800 };
  return { width: window.innerWidth, height: window.innerHeight };
}

/**
 * THE PRISM WINDOW (Epic 12 story 2, ADR-0029 rule 6: record != visible) — the
 * ONE Move's window, opened when the Move completes and reopened from the
 * pointer's quiet log button.
 *
 * It shows the log and nothing else: the contact kind on the header, the
 * pointer's identity, the Move's Changes in the order they were made — each
 * kind and its recorded outcome, and for a head read the exact bounds, the
 * decode status and (on a Measure) the head's declared size and mtime. The
 * CHANGES ARE READ-ONLY: no field, no button, no remove, no edit on any line.
 * The window never shows world bytes: the head's content belongs to the
 * transient glimpse's own window, which is a different surface.
 *
 * THE PERSON'S EXPLANATION is the ONLY editable thing: one quiet textarea,
 * verbatim, saved when the field loses focus or the window closes. Empty is
 * the honest state (the app writes the empty string when the person wrote
 * none); a failed save says "not saved" quietly.
 *
 * ONE MOVE ONLY: the prop is ONE Prism (or null for a reach with no Move yet);
 * nothing here lists the series, paginates it, counts it or summarizes it.
 *
 * It is the outward window's idiom: world-anchored beside its word,
 * counter-scaled against the camera, viewport-clamped, never draggable or
 * resizable, focus-moving on open, closed by Esc / its x / a press away / a
 * level switch. The one removal: it has no press-in-the-plane gesture, like
 * every window.
 *
 * Provisional: the card's look, the explanation field's behaviour (save on
 * blur and on close, no save button) and the read-only log's scrolling.
 */
export function PrismWindow({
  anchor,
  name,
  prism,
  note,
  onSaveExplanation,
  onClose,
}: PrismWindowProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(prism?.explanation ?? "");
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [viewport, setViewport] = useState<Viewport>(viewportOf);
  const [size, setSize] = useState<Box>({ width: 300, height: 180 });
  const draftRef = useRef(draft);
  const savedRef = useRef<string | null>(null);
  const savingRef = useRef(false);

  // A reopened Move replaces the draft and the saved baseline.
  useEffect(() => {
    setDraft(prism?.explanation ?? "");
    setSaveNote(null);
    savedRef.current = null;
  }, [prism]);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  // Opening moves focus into the window (the chooser that opened it is gone).
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  /** Save the explanation if it changed; quiet about failure but honest. */
  async function saveExplanation(): Promise<void> {
    if (prism === null || savingRef.current) return;
    const next = draftRef.current;
    if (next === (savedRef.current ?? prism.explanation)) return;
    savingRef.current = true;
    const ok = await onSaveExplanation(prism.id, next);
    savingRef.current = false;
    if (ok) {
      savedRef.current = next;
      setSaveNote(null);
    } else {
      setSaveNote(NOT_SAVED);
    }
  }

  /** Close the window, saving the person's words first (never silently). */
  function close() {
    void saveExplanation();
    onClose();
  }

  // Esc closes the window (saving the field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Click-away in the capture phase (d3-zoom stops the press at the plane).
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  });

  // A press inside the window is content, never a plane pan or a plane press.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  // The viewport can change while the window is open; the clamp follows it.
  useEffect(() => {
    const onResize = () => setViewport(viewportOf());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  });

  // Measure the rendered window, so the clamp keeps the whole box in view even
  // though the log changes the height after the draft lands.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  });

  const placed = clampPeekAnchor(anchor, camera, viewport, size);
  const changes = prism?.changes ?? [];

  return (
    <div
      ref={rootRef}
      className="prism-window"
      style={{
        left: placed.x,
        top: placed.y,
        transform: "translate(0, -50%) scale(" + 1 / camera.zoom + ")",
        transformOrigin: "left center",
      }}
      role="group"
      tabIndex={-1}
      aria-label={prismLabel(name, prism)}
      title={PRISM_TOOLTIP}
    >
      <div className="prism-header">
        <span className="prism-contact">
          {prism === null ? "no move" : contactWord(prism.contact)}
        </span>
        <span className="prism-name">{name}</span>
      </div>

      {prism !== null && prism.pointer !== null && (
        <div className="prism-pointer">
          {prism.pointer.form} · {prism.pointer.value}
        </div>
      )}

      {prism !== null && (
        <div
          className="prism-changes"
          role="group"
          aria-label="the log — read-only"
        >
          {changes.map((change, index) => {
            const detail = changeDetail(change);
            return (
              <div className="prism-change" key={index}>
                <span className="prism-change-kind">
                  {changeWord(change)}
                </span>
                <span className="prism-change-outcome">
                  {changeOutcome(change)}
                </span>
                {detail !== "" && (
                  <span className="prism-detail">{detail}</span>
                )}
              </div>
            );
          })}
        </div>
      )}

      {prism !== null && (
        <textarea
          className="prism-explanation"
          value={draft}
          rows={2}
          aria-label={EXPLANATION_LABEL}
          placeholder={EXPLANATION_PLACEHOLDER}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void saveExplanation()}
        />
      )}

      {saveNote !== null && <div className="prism-note">{saveNote}</div>}
      {prism === null && (
        <div className="prism-note">{note ?? NO_MOVE_YET}</div>
      )}
      {prism !== null && note !== null && (
        <div className="prism-note">{note}</div>
      )}

      <button
        type="button"
        className="prism-close"
        aria-label="close the window"
        title="close"
        onClick={(e) => {
          e.stopPropagation();
          close();
        }}
      >
        ×
      </button>
    </div>
  );
}
