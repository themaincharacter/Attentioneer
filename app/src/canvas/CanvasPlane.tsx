import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { select } from "d3-selection";
import {
  zoom as d3zoom,
  zoomIdentity,
  type D3ZoomEvent,
  type ZoomBehavior,
  type ZoomTransform,
} from "d3-zoom";
import { MAX_ZOOM, MIN_ZOOM, type Camera, type CameraIntents } from "./useCamera";
import {
  castIsConsumed,
  CAST_DELAY_MS,
  closesPair,
  DOUBLE_CLICK_MS,
  isPlainClick,
  isSecondOfPair,
  type PlanePress,
} from "./clickSequence";
import "./canvas.css";

/**
 * The infinite plane (ADR-0003): d3-zoom normalizes wheel/pinch/drag input
 * into camera intents; the camera transform is applied to `.plane-inner`.
 * The dot grid tracks the camera so even an empty plane shows motion.
 *
 * The plane holds two gestures that must not collide (Epic 3 story 2): a
 * double-click on empty plane coins a word (ADR-0007), and a plain click casts
 * a bare lack (map ticket 03). The cast is deferred by `CAST_DELAY_MS` (see
 * clickSequence.ts): a close second press cancels it, so coining never leaves
 * a stray mark; a slower double-click consumes the spot cast by its first
 * click. A pan (pointer drift on the press) never casts.
 *
 * Provisional: grid size and zoom-band behavior are not settled by any ADR yet.
 */

/** Space between grid dots at 100% zoom. */
const GRID = 28;

/** Ring/word/field targets whose clicks never reach the plane's gestures. */
const CONTENT_SELECTOR =
  ".word, .lack-mark, .distance-label, .distance-ring, .distance-coinfield, .grow-field";

interface PendingCast {
  timer: number;
  press: PlanePress;
}

/** What content components can see and do through the plane (ADR-0003). */
export interface PlaneApi {
  camera: Camera;
  /** Center the plane point (px, py) in the viewport at `zoom` (default: keep). */
  centerOn: (px: number, py: number, zoom?: number) => void;
}

const PlaneContext = createContext<PlaneApi | null>(null);

export function usePlane(): PlaneApi {
  const api = useContext(PlaneContext);
  if (!api) {
    throw new Error("usePlane must be used inside a CanvasPlane");
  }
  return api;
}

interface CanvasPlaneProps {
  camera: Camera;
  intents: CameraIntents;
  /** Called (deferred) with the plane-space point under a plain click. */
  onPlaneClick?: (point: { x: number; y: number }) => void;
  /**
   * Called with the plane-space point under a double-click on empty plane.
   * `consumedSpot` is set when the first click's deferred cast already fired —
   * the coin consumes that exact spot line (no stray mark).
   */
  onPlaneDoubleClick?: (
    point: { x: number; y: number },
    consumedSpot?: { x: number; y: number },
  ) => void;
  children?: ReactNode;
}

export function CanvasPlane({
  camera,
  intents,
  onPlaneClick,
  onPlaneDoubleClick,
  children,
}: CanvasPlaneProps) {
  const planeRef = useRef<HTMLDivElement>(null);
  const behaviorRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const pressesRef = useRef<PlanePress[]>([]);
  const pendingCastsRef = useRef<PendingCast[]>([]);
  const lastCastRef = useRef<{ press: PlanePress; point: { x: number; y: number } } | null>(
    null,
  );

  const planeApi = useMemo<PlaneApi>(
    () => ({
      camera,
      centerOn: (px, py, zoom) => {
        const el = planeRef.current;
        if (!el) return;
        intents.centerOn(px, py, el.clientWidth / 2, el.clientHeight / 2, zoom);
      },
    }),
    [camera, intents],
  );

  function pointFromClient(
    clientX: number,
    clientY: number,
  ): { x: number; y: number } | null {
    const el = planeRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: (clientX - rect.left - camera.x) / camera.zoom,
      y: (clientY - rect.top - camera.y) / camera.zoom,
    };
  }

  function isContentTarget(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(CONTENT_SELECTOR) !== null;
  }

  function cancelPendingCast(pressT: number) {
    const keep: PendingCast[] = [];
    for (const pending of pendingCastsRef.current) {
      if (pending.press.t === pressT) window.clearTimeout(pending.timer);
      else keep.push(pending);
    }
    pendingCastsRef.current = keep;
  }

  function handleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (isContentTarget(e.target)) return;
    const presses = pressesRef.current;
    const press = presses[presses.length - 1];
    if (!press) return;
    const click = { t: Date.now(), x: e.clientX, y: e.clientY };
    // A pan is not a click; a close second press belongs to a double-click.
    if (!isPlainClick(press, click)) return;
    if (isSecondOfPair(presses)) return;
    if (pendingCastsRef.current.some((pending) => pending.press.t === press.t)) return;
    const point = pointFromClient(e.clientX, e.clientY);
    if (!point || !onPlaneClick) return;
    const timer = window.setTimeout(() => {
      pendingCastsRef.current = pendingCastsRef.current.filter(
        (pending) => pending.timer !== timer,
      );
      lastCastRef.current = { press, point };
      onPlaneClick(point);
    }, CAST_DELAY_MS);
    pendingCastsRef.current.push({ timer, press });
  }

  function handleDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (isContentTarget(e.target)) return;
    const now = Date.now();
    const recent = pressesRef.current.filter((press) => now - press.t <= DOUBLE_CLICK_MS);
    if (recent.length < 2) {
      pressesRef.current = recent;
      return;
    }
    // Only a close pair counts: a press from an earlier gesture must never
    // turn a single plane click into a coin (or consume an older lack). Both
    // of this double-click's clicks must have landed on empty plane.
    const first = recent[recent.length - 2];
    const second = recent[recent.length - 1];
    if (!closesPair(first, second)) {
      pressesRef.current = recent;
      return;
    }
    cancelPendingCast(first.t);
    pressesRef.current = [];
    const lastCast = lastCastRef.current;
    lastCastRef.current = null;
    const consumed =
      lastCast && castIsConsumed(first, lastCast) ? lastCast.point : undefined;
    const point = pointFromClient(e.clientX, e.clientY);
    if (!point || !onPlaneDoubleClick) return;
    onPlaneDoubleClick(point, consumed);
  }

  // Cancel any cast still waiting on a timer when the plane goes away.
  useEffect(() => {
    return () => {
      for (const pending of pendingCastsRef.current) window.clearTimeout(pending.timer);
      pendingCastsRef.current = [];
    };
  }, []);

  // Attach d3-zoom once: wheel / pinch / drag → camera intents.
  // Double-click zoom is filtered out so the plane stays quiet.
  useEffect(() => {
    const el = planeRef.current;
    if (!el) return;

    const behavior: ZoomBehavior<HTMLDivElement, unknown> = d3zoom<
      HTMLDivElement,
      unknown
    >()
      .scaleExtent([MIN_ZOOM, MAX_ZOOM])
      .filter((event: any) => event.type !== "dblclick" && !event.button)
      .on("zoom.camera", (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        const t: ZoomTransform = event.transform;
        intents.setTransform({ x: t.x, y: t.y, zoom: t.k });
      })
      .on("start.cursor", (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        if (event.sourceEvent?.type === "mousedown") el.classList.add("dragging");
      })
      .on("end.cursor", () => {
        el.classList.remove("dragging");
      });

    // Record plane presses before attaching d3 (d3 stops immediate propagation
    // on mousedown, so later same-element listeners never run). Word and ring
    // presses stop propagation first and never reach this counter. A close
    // second press cancels the first click's pending cast (the double-click
    // rule) — the coin gesture must never leave a stray lack behind.
    const countPlanePress = (event: MouseEvent) => {
      const now = Date.now();
      const recent = pressesRef.current.filter((press) => now - press.t <= DOUBLE_CLICK_MS);
      const press: PlanePress = { t: now, x: event.clientX, y: event.clientY };
      const previous = recent[recent.length - 1];
      if (previous && closesPair(previous, press)) cancelPendingCast(previous.t);
      recent.push(press);
      pressesRef.current = recent;
    };
    el.addEventListener("mousedown", countPlanePress);

    const sel = select(el);
    sel.call(behavior);
    behaviorRef.current = behavior;

    return () => {
      el.removeEventListener("mousedown", countPlanePress);
      sel.on(".zoom", null);
      behaviorRef.current = null;
    };
  }, [intents]);

  // Keep d3's internal transform in sync with programmatic camera moves.
  useEffect(() => {
    const el = planeRef.current;
    const behavior = behaviorRef.current;
    if (!el || !behavior) return;

    const current = select(el).property("__zoom") as ZoomTransform | undefined;
    if (
      !current ||
      current.x !== camera.x ||
      current.y !== camera.y ||
      current.k !== camera.zoom
    ) {
      select(el).call(
        behavior.transform,
        zoomIdentity.translate(camera.x, camera.y).scale(camera.zoom),
      );
    }
  }, [camera]);

  const gridStyle: CSSProperties = {
    backgroundPosition: `${camera.x}px ${camera.y}px`,
    backgroundSize: `${GRID * camera.zoom}px ${GRID * camera.zoom}px`,
  };

  return (
    <PlaneContext.Provider value={planeApi}>
      <div
        ref={planeRef}
        className="plane"
        style={gridStyle}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        <div
          className="plane-inner"
          style={{
            transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})`,
          }}
        >
          {children}
        </div>
        <div className="zoom-chip">{Math.round(camera.zoom * 100)}%</div>
        <div className="plane-hint">
          drag to pan · scroll to zoom · click to leave a lack · double-click to coin a word
        </div>
      </div>
    </PlaneContext.Provider>
  );
}
