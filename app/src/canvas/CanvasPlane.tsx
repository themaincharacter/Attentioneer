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
import "./canvas.css";

/**
 * The infinite plane (ADR-0003): d3-zoom normalizes wheel/pinch/drag input
 * into camera intents; the camera transform is applied to `.plane-inner`.
 * The dot grid tracks the camera so even an empty plane shows motion.
 *
 * Provisional: grid size and zoom-band behavior are not settled by any ADR yet.
 */

/** Space between grid dots at 100% zoom. */
const GRID = 28;

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
  /** Called with the plane-space point under a double-click on empty plane. */
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
  const planeDownsRef = useRef<number[]>([]);

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

  function handleDoubleClick(e: ReactMouseEvent<HTMLDivElement>) {
    const el = planeRef.current;
    if (!el || !onPlaneDoubleClick) return;
    // Only a double-click whose both clicks landed on empty plane creates a
    // note: a click on a card centers it (moving it), so the follow-up click
    // of a hurried double-click can hit the plane — that must stay quiet.
    const recent = planeDownsRef.current.filter((t) => Date.now() - t < 800);
    if (recent.length < 2) {
      planeDownsRef.current = recent;
      return;
    }
    planeDownsRef.current = [];
    const rect = el.getBoundingClientRect();
    onPlaneDoubleClick({
      x: (e.clientX - rect.left - camera.x) / camera.zoom,
      y: (e.clientY - rect.top - camera.y) / camera.zoom,
    });
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

    // Count plane mousedowns before attaching d3 (d3 stops immediate
    // propagation on mousedown, so later same-element listeners never run).
    // Card clicks stop propagation first and never reach this counter.
    const countPlaneDown = () => {
      planeDownsRef.current.push(Date.now());
    };
    el.addEventListener("mousedown", countPlaneDown);

    const sel = select(el);
    sel.call(behavior);
    behaviorRef.current = behavior;

    return () => {
      el.removeEventListener("mousedown", countPlaneDown);
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
          drag to pan · scroll to zoom · double-click to add a note
        </div>
      </div>
    </PlaneContext.Provider>
  );
}
