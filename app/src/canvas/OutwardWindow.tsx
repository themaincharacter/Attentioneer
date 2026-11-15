import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { readTextHead, type TextHead } from "../lib/fs";
import { HEAD_MAX_BYTES, HEAD_MAX_LINES, clipHead } from "../lib/headBounds";
import { openOutward, revealOutward } from "./outward";
import type { Pointer } from "../map/pointers";
import { usePlane } from "./CanvasPlane";
import type { Point } from "./geometry";
import {
  CANNOT_READ,
  PEEK_TOOLTIP,
  clampPeekAnchor,
  formatStats,
  peekLabel,
  resolveTarget,
} from "./outwardRules";

interface OutwardWindowProps {
  /** The world point the window hangs off (beside its word, never in it). */
  anchor: Point;
  /**
   * The word's coined NAME (aria; the slug stays in the pointer record —
   * Epic 6 story 3's names-not-slugs rule).
   */
  name: string;
  /** The authored pointer this window speaks about (form + verbatim value). */
  pointer: Pointer;
  /** The workspace root a `path` resolves against, exactly as written. */
  workspacePath: string;
  /** Esc, the window's ×, a press outside or a level switch. */
  onClose: () => void;
}

/** What the glimpse currently is: still reading, refused, or a bounded head. */
type ReadState =
  | { kind: "pending" }
  | { kind: "cannot-read" }
  | {
      kind: "text";
      head: string;
      truncated: boolean;
      size: number | null;
      mtime: number | null;
    };

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
 * The window (code name peek) — Epic 5 story 2, ADR-0017's amendment.
 *
 * A pointer's glimpse, opened on purpose from its chooser row: IDENTITY FIRST
 * (the authored handle verbatim, selectable so it can be copied), then for a
 * `path`/`at` its exists/size/mtime and a bounded head — "truncated" said
 * plainly, no counts, no badges — or a quiet "cannot read" with reveal. A
 * `url` shows the handle and the explicit open action (never a preview).
 *
 * It is a SNAPSHOT of the open moment, not a reading surface: no scroll, no
 * drag-select on the head, no editor, write-free by construction. Reopening is
 * how it refreshes. The window is world-anchored near its word and
 * counter-scaled against the camera (the assumption overlay's idiom), never
 * draggable or resizable, and viewport-clamped so a word past the edge still
 * opens a readable glimpse. It joins the gate's content lists; its own mousedown
 * listener keeps d3-zoom from seeing a press, while the wheel passes through to
 * the plane (the lasso precedent).
 *
 * Neither button promises a launch: this box has no xdg-open, so a failure
 * surfaces "cannot open" / "cannot open this scheme" / "cannot reveal" and
 * nothing more is claimed.
 *
 * Provisional: the card's size, spacing and typography (ADR-0003's seam).
 */
export function OutwardWindow({
  anchor,
  name,
  pointer,
  workspacePath,
  onClose,
}: OutwardWindowProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const headRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<ReadState>({ kind: "pending" });
  const [notice, setNotice] = useState<string | null>(null);
  /** The card cut the head visually (wrapping) even within the bounds. */
  const [clipped, setClipped] = useState(false);
  const [viewport, setViewport] = useState<Viewport>(viewportOf);
  const [size, setSize] = useState<Box>({ width: 300, height: 180 });

  const isUrl = pointer.form === "url";

  // The glimpse: one read at open (and one per distinct pointer). A url is
  // never read here — opening it outward is its whole action. The head is
  // re-bounded defensively: the bridge already enforces the same limits, and
  // the display never trusts an unbounded string across the IPC bridge.
  useEffect(() => {
    if (pointer.form === "url") return;
    const target = resolveTarget(pointer.form, pointer.value, workspacePath);
    if (target.kind !== "file") return;
    let live = true;
    setState({ kind: "pending" });
    readTextHead(target.path, HEAD_MAX_LINES, HEAD_MAX_BYTES)
      .then((result: TextHead) => {
        if (!live) return;
        if (!result.exists) {
          setState({ kind: "cannot-read" });
          return;
        }
        const bounded = clipHead(result.head);
        setState({
          kind: "text",
          head: bounded.head,
          truncated: result.truncated || bounded.truncated,
          size: result.size,
          mtime: result.mtime,
        });
      })
      .catch(() => {
        if (live) setState({ kind: "cannot-read" });
      });
    return () => {
      live = false;
    };
  }, [pointer, workspacePath]);

  // Opening moves focus into the window (the row that opened it is gone); the
  // close rules return focus to the word's reach handle from App.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // Esc closes the window. (The chooser closed when this window opened, so
  // there is no second transient to layer under this key.)
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

  // Click-away in the capture phase (d3-zoom stops the press at the plane, so a
  // bubble-phase listener would never hear it). A press inside is not away.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  // A press inside the window is content, never a plane pan or a plane press
  // (the same raw listener as the chooser and the PlaneMenu lesson).
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
  }, []);

  // The head is bounded in lines and bytes, but wrapping can still hide a tail
  // inside the card (a long single line, 80-column code). `scrollHeight` knows:
  // when the rendered head overflows its box, the window says "truncated"
  // exactly as it does for the bridge's own cut. No silent clipping.
  useEffect(() => {
    const el = headRef.current;
    if (!el) {
      setClipped(false);
      return;
    }
    setClipped(el.scrollHeight > el.clientHeight + 1);
  });

  // Measure the rendered window, so the clamp keeps the whole box in view even
  // though the head changes the height after the read lands.
  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    setSize((prev) =>
      prev.width === width && prev.height === height ? prev : { width, height },
    );
  });

  async function openIt() {
    const result = await openOutward(pointer.form, pointer.value, workspacePath);
    setNotice(result.ok ? null : result.message);
  }

  async function revealIt() {
    const result = await revealOutward(pointer.form, pointer.value, workspacePath);
    setNotice(result.ok ? null : result.message);
  }

  const placed = clampPeekAnchor(anchor, camera, viewport, size);
  const stats =
    state.kind === "text" ? formatStats(state.size, state.mtime) : "";
  const truncated =
    state.kind === "text" && (state.truncated || clipped);

  return (
    <div
      ref={rootRef}
      className="outward-window"
      style={{
        left: placed.x,
        top: placed.y,
        transform:
          "translate(0, -50%) scale(" + 1 / camera.zoom + ")",
        transformOrigin: "left center",
      }}
      role="group"
      tabIndex={-1}
      aria-label={peekLabel(name, pointer.form)}
      title={PEEK_TOOLTIP}
    >
      {/* identity first: the handle exactly as authored, selectable to copy */}
      <div className="outward-handle">{pointer.value}</div>

      {isUrl ? (
        <div className="outward-actions">
          <button
            type="button"
            className="outward-open"
            aria-label="open this page"
            title="open"
            onClick={(e) => {
              e.stopPropagation();
              void openIt();
            }}
          >
            open
          </button>
        </div>
      ) : state.kind === "text" ? (
        <>
          {stats !== "" && <div className="outward-stats">{stats}</div>}
          {state.head !== "" && (
            <div ref={headRef} className="outward-head">
              {state.head}
            </div>
          )}
          {truncated && <div className="outward-note">truncated</div>}
          <div className="outward-actions">
            <button
              type="button"
              className="outward-open"
              aria-label="open with the app that owns it"
              title="open"
              onClick={(e) => {
                e.stopPropagation();
                void openIt();
              }}
            >
              open
            </button>
          </div>
        </>
      ) : state.kind === "cannot-read" ? (
        <>
          <div className="outward-note">{CANNOT_READ}</div>
          <div className="outward-actions">
            <button
              type="button"
              className="outward-reveal"
              aria-label="reveal in the file manager"
              title="reveal"
              onClick={(e) => {
                e.stopPropagation();
                void revealIt();
              }}
            >
              reveal
            </button>
          </div>
        </>
      ) : null}

      {notice !== null && <div className="outward-note">{notice}</div>}

      <button
        type="button"
        className="outward-close"
        aria-label="close the window"
        title="close"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
      >
        ×
      </button>
    </div>
  );
}
