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
import { closesPair, DOUBLE_CLICK_MS, type PlanePress } from "./planePress";
import "./canvas.css";

/**
 * The infinite plane (ADR-0003): d3-zoom normalizes wheel/pinch/drag input
 * into camera intents; the camera transform is applied to `.plane-inner`.
 * The dot grid tracks the camera so even an empty plane shows motion.
 *
 * Creation lives on the double-click (Epic 3 feedback): a double-click on
 * empty plane reports its point, and the app opens the word/lack ring menu
 * there. A single click does nothing at all; a pan is inert. The press
 * counter guards the gesture — both of the double-click's presses must have
 * landed on empty plane, so a hurried double-click on a word (which centers
 * it) can never create. `planePress.ts` holds the pure pair rule.
 *
 * Provisional: grid size and zoom-band behavior are not settled by any ADR yet.
 */

/** Space between grid dots at 100% zoom. */
const GRID = 28;

/** Ring/word/field/menu targets whose clicks never reach the plane's gestures. */
const CONTENT_SELECTOR =
  ".word, .lack-mark, .distance-label, .distance-ring, .distance-coinfield, .grow-field, .plane-menu";

/** Is this event target one of the content elements above? */
function isContentTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTENT_SELECTOR) !== null;
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
  /**
   * Called with the plane-space point under a double-click on empty plane.
   * The app opens its word/lack creation menu at that point.
   */
  onPlaneDoubleClick?: (point: { x: number; y: number }) => void;
  children?: ReactNode;
}

export function CanvasPlane({
  camera,
  intents,
  onPlaneDoubleClick,
  children,
}: CanvasPlaneProps) {
  const planeRef = useRef<HTMLDivElement>(null);
  const behaviorRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const pressesRef = useRef<PlanePress[]>([]);

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

  function handleDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    if (isContentTarget(e.target)) return;
    const now = Date.now();
    const recent = pressesRef.current.filter((press) => now - press.t <= DOUBLE_CLICK_MS);
    if (recent.length < 2) {
      pressesRef.current = recent;
      return;
    }
    // Only a close pair counts: a press from an earlier gesture must never
    // turn a single plane click into creation. Both of this double-click's
    // presses must have landed on empty plane (content presses are filtered
    // out of the counter, and a content double-click target returns above).
    const first = recent[recent.length - 2];
    const second = recent[recent.length - 1];
    if (!closesPair(first, second)) {
      pressesRef.current = recent;
      return;
    }
    pressesRef.current = [];
    const point = pointFromClient(e.clientX, e.clientY);
    if (!point) return;
    onPlaneDoubleClick?.(point);
  }

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
    // on mousedown, so later same-element listeners never run). Content presses
    // are filtered by target as well as by their own stopPropagation, so the
    // pair below is always two presses on empty plane.
    const countPlanePress = (event: MouseEvent) => {
      if (event.button !== 0 || isContentTarget(event.target)) return;
      const now = Date.now();
      const recent = pressesRef.current.filter((press) => now - press.t <= DOUBLE_CLICK_MS);
      recent.push({ t: now, x: event.clientX, y: event.clientY });
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
          drag to pan · scroll to zoom · double-click: word or lack · drag past the fold
          to set aside
        </div>
      </div>
    </PlaneContext.Provider>
  );
}
