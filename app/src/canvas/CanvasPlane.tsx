import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
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
import {
  CONTENT_SELECTOR,
  isGestureArmed,
  shouldCreate,
  type GestureMode,
} from "./gates";
import type { SketchPoint } from "../map/sketches";
import {
  DEFAULT_DRAW_TOOL,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_SIZE,
  isDrawableStroke,
  penInk,
  SKETCH_STEP_PX,
  strokePath,
  type DrawTool,
} from "./sketchRules";
import type { Point } from "./geometry";
import { boxIsDrawable, capturedBox } from "./veilRules";
import type { VeilBox } from "../map/veils";
import { MAX_ZOOM, MIN_ZOOM, type Camera, type CameraIntents } from "./useCamera";
import { closesPair, DOUBLE_CLICK_MS, type PlanePress } from "./planePress";
import { centeringZoom, zoomChipPercent } from "../workspace/level";
import "./canvas.css";

/**
 * The infinite plane (ADR-0003): d3-zoom normalizes wheel/pinch/drag input
 * into camera intents; the camera transform is applied to `.plane-inner`.
 * The dot grid tracks the camera so even an empty plane shows motion.
 *
 * Creation lives on the double-click (Epic 3 feedback): a double-click on
 * empty plane reports its point, and the app opens the word/lack menu
 * there. A single click does nothing at all; a pan is inert. The press
 * counter guards the gesture — both of the double-click's presses must have
 * landed on empty plane, so a hurried double-click on a word (which centers
 * it) can never create. `planePress.ts` holds the pure pair rule.
 *
 * A zoom gesture's settle is REPORTED (onZoomSettle): the zoom band is the
 * level at runtime (ADR-0018), so the input layer is where a band change is
 * observed — the app's handoff derives the game and decides whether to write.
 * The plane itself writes nothing.
 *
 * The zoom chip's number is a BAND-AWARE read (story 2): it goes through the
 * same `atOrAbove` readings the renderer uses (`zoomChipPercent`), so it can
 * never show a rounded percent that names a game or a label state the plane is
 * not in — "55%" while the distance words are still folded, or "85%" while the
 * game is still concept.
 *
 * Provisional: grid size and zoom-band behavior are not settled by any ADR yet.
 */

/** Space between grid dots at 100% zoom. */
const GRID = 28;

/** Screen pixels between lasso samples (keeps the path small and smooth). */
const LASSO_STEP_PX = 3;

/** Is this event target one of the content elements (gates.ts's list)? */
function isContentTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(CONTENT_SELECTOR) !== null;
}

/** What content components can see and do through the plane (ADR-0003). */
export interface PlaneApi {
  camera: Camera;
  /**
   * Center the plane point (px, py) in the viewport. Without `zoom` it lands
   * at the current BAND's landing zoom, so a click-to-center can never flip
   * the game as a side effect (ADR-0018 decision 4); pass `zoom` to land
   * exactly somewhere.
   */
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
  /**
   * How a gesture is armed right now (ADR-0016). While armed, pan and creation
   * suspend (the interaction-mode gate); idle is the plain canvas.
   */
  gestureMode?: GestureMode;
  /**
   * The plane's quiet hint, in the running game's own words (story 4, and the
   * separate-maps review). The ONE rule that words it is
   * `canvas/mapContentRules.ts`'s `planeHint`: at concept the sentence is
   * byte-identically the one the plane always showed (it names the word and
   * the shelf's fold), while at dynamics and ground the map is blank paper —
   * the creation clause names the pen and the shelf clause GOES, because a
   * fold that is not there cannot be dragged past.
   *
   * DEPRECATED (hidden 2026-11-16 per user review): the hint used to take a
   * creation clause naming the ring menu's hidden kinds; those are hidden and
   * the rule owns the whole sentence now — delete the old clauses in the
   * deprecated sweep.
   */
  hint?: string;
  /** True while the playing-set selector's draw tool is armed (story 1). */
  lassoArmed?: boolean;
  /**
   * True while the VEIL's draw-box is armed (Epic 9 story 1, ADR-0023). It is
   * a SEPARATE arm from the lasso: the lasso lives inside the playing-set
   * selector (a dynamics-only surface) and takes a polygon, while the veil must
   * work at concept AND dynamics and takes a rectangle. The gate is armed too,
   * so pan, creation and every word press already stand still.
   */
  boxArmed?: boolean;
  /**
   * True while a mark ring is in flight (story 2): the wires' invisible hit
   * bands turn clickable, so the drop can bind the element under the pointer
   * without the wire ever intercepting an ordinary press (ADR-0016).
   */
  picking?: boolean;
  /**
   * True while the map's PEN is armed (added 2026-11-16 per user review). It is
   * its own gate mode (`"draw"`): while armed every plane gesture stands still
   * exactly as the veil's draw box made them — pan, double-click creation and
   * every word press — and the pen's capture surface (rendered only while
   * armed) owns the pointer, so a stroke can never move a word or open a
   * creation menu.
   */
  drawArmed?: boolean;
  /**
   * The pen's current ink and thickness, so the in-flight stroke previews in
   * the colour it will be written with. Defaulted to the palette's opening
   * reading, so the plane is usable without the app passing anything.
   */
  drawPen?: { color: string; size: number };
  /**
   * Which meaning a pen drag carries right now (added 2026-11-16 per user
   * review). The eraser does NOT arm its own gate: the pen's `draw` mode is
   * reused and this state chooses what the drag does, so the arming discipline
   * (pan, creation and every word press stand still; the capture surface owns
   * the pointer) is exactly the pen's. Defaulted to the pen.
   */
  drawTool?: DrawTool;
  /** Called with the stroke's world path when a pen drag is released. */
  onSketch?: (points: readonly SketchPoint[]) => void;
  /**
   * Called with the drag's world PATH when an eraser drag is released, so the
   * reach rule (sketchRules' whole-stroke hit test) can see every segment the
   * hand passed over. A tap that never moved reports its one point — it still
   * reaches the ink it landed on (the eraser's atom is the stroke, not a
   * two-point drawing).
   */
  onErase?: (path: readonly SketchPoint[]) => void;
  /** Called with the lasso's world path when the draw tool is released. */
  onLasso?: (path: readonly Point[]) => void;
  /**
   * Called with the captured BOX when the veil's draw-box is released: its
   * bounds in world space (the rectangle, never the stroke). A drag that never
   * encloses an area reports nothing.
   */
  onDrawBox?: (box: VeilBox) => void;
  /**
   * Called when a zoom gesture SETTLES (d3's `end`) with the zoom it settled
   * on. The zoom is the level at runtime (ADR-0018): the app's handoff derives
   * the band from it and, on a crossing, writes the level key. A pan settles
   * too, with the same zoom — the derived band is unchanged, so nothing is
   * written.
   */
  onZoomSettle?: (zoom: number) => void;
  children?: ReactNode;
}

export function CanvasPlane({
  camera,
  intents,
  onPlaneDoubleClick,
  gestureMode = "idle",
  // DEPRECATED (hidden 2026-11-16 per user review): the hint named the ring
  // menu's word AND lack choices; the rule (mapContentRules.ts's `planeHint`)
  // owns the whole sentence now — delete the old clause in the deprecated
  // sweep.
  hint = "drag to pan · scroll to zoom · double-click: word · drag past the fold to set aside",
  lassoArmed = false,
  boxArmed = false,
  drawArmed = false,
  drawPen = { color: DEFAULT_PEN_COLOR, size: DEFAULT_PEN_SIZE },
  drawTool = DEFAULT_DRAW_TOOL,
  picking = false,
  onLasso,
  onDrawBox,
  onSketch,
  onErase,
  onZoomSettle,
  children,
}: CanvasPlaneProps) {
  const planeRef = useRef<HTMLDivElement>(null);
  const behaviorRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const pressesRef = useRef<PlanePress[]>([]);
  const [lassoPath, setLassoPath] = useState<Point[] | null>(null);
  const [boxDraft, setBoxDraft] = useState<VeilBox | null>(null);
  // The pen's in-flight stroke, in world space: the person sees the line they
  // are drawing before the release writes it (the lasso/sketch-draft idiom).
  const [strokeDraft, setStrokeDraft] = useState<SketchPoint[] | null>(null);
  const drawSurfaceRef = useRef<HTMLDivElement>(null);

  // Latest-value refs for the raw listeners and d3's filter, which are
  // attached once and must always see the current mode, camera and callback.
  const modeRef = useRef<GestureMode>(gestureMode);
  modeRef.current = gestureMode;
  const lassoArmedRef = useRef(lassoArmed);
  lassoArmedRef.current = lassoArmed;
  const boxArmedRef = useRef(boxArmed);
  boxArmedRef.current = boxArmed;
  const onLassoRef = useRef(onLasso);
  onLassoRef.current = onLasso;
  const onDrawBoxRef = useRef(onDrawBox);
  onDrawBoxRef.current = onDrawBox;
  const onZoomSettleRef = useRef(onZoomSettle);
  onZoomSettleRef.current = onZoomSettle;
  const drawArmedRef = useRef(drawArmed);
  drawArmedRef.current = drawArmed;
  const onSketchRef = useRef(onSketch);
  onSketchRef.current = onSketch;
  const onEraseRef = useRef(onErase);
  onEraseRef.current = onErase;
  const drawToolRef = useRef(drawTool);
  drawToolRef.current = drawTool;
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  const planeApi = useMemo<PlaneApi>(
    () => ({
      camera,
      centerOn: (px, py, zoom) => {
        const el = planeRef.current;
        if (!el) return;
        // No explicit zoom: land at the current band's landing zoom, so the
        // click stays in the game it began in (ADR-0018 decision 4).
        intents.centerOn(
          px,
          py,
          el.clientWidth / 2,
          el.clientHeight / 2,
          zoom ?? centeringZoom(camera.zoom),
        );
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
    // Creation suspends while any gesture is armed (ADR-0016's gate).
    if (!shouldCreate(gestureMode)) return;
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
      .filter((event: any) => {
        if (event.type === "dblclick") return false;
        // While a gesture is armed the left drag belongs to that gesture, never
        // to the pan (ADR-0016); the wheel still zooms, so a selector can reach
        // words out of view.
        if (
          isGestureArmed(modeRef.current) &&
          (event.type === "mousedown" || event.type === "touchstart")
        ) {
          return false;
        }
        return !event.button;
      })
      .on("zoom.camera", (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        const t: ZoomTransform = event.transform;
        intents.setTransform({ x: t.x, y: t.y, zoom: t.k });
      })
      .on("start.cursor", (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        if (event.sourceEvent?.type === "mousedown") el.classList.add("dragging");
      })
      .on("end.camera", (event: D3ZoomEvent<HTMLDivElement, unknown>) => {
        el.classList.remove("dragging");
        // A REAL gesture settled (wheel, pinch or pan). Programmatic camera
        // moves — the jump, the open-restore, a centering — also emit an end
        // (d3-zoom dispatches it for zoom.transform too), but they carry no
        // sourceEvent and must never be read as a band change: the handoff
        // itself moved them.
        if (!event.sourceEvent) return;
        // The wheel's crossing is the band change (ADR-0018); a pan reports
        // the same zoom and derives the same band, so it writes nothing.
        onZoomSettleRef.current?.(event.transform.k);
      });

    // Record plane presses before attaching d3 (d3 stops immediate propagation
    // on mousedown, so later same-element listeners never run). Content presses
    // are filtered by target as well as by their own stopPropagation, so the
    // pair below is always two presses on empty plane. Creation suspends while
    // a gesture is armed (ADR-0016's gate).
    const countPlanePress = (event: MouseEvent) => {
      if (!shouldCreate(modeRef.current)) return;
      if (event.button !== 0 || isContentTarget(event.target)) return;
      const now = Date.now();
      const recent = pressesRef.current.filter((press) => now - press.t <= DOUBLE_CLICK_MS);
      recent.push({ t: now, x: event.clientX, y: event.clientY });
      pressesRef.current = recent;
    };
    el.addEventListener("mousedown", countPlanePress);

    // The TWO draw gestures — the selector's lasso (Epic 4 story 1) and the
    // veil's box (Epic 9 story 1, ADR-0023): a left drag on empty plane draws
    // in world space. They are separate ARMS (the lasso only inside the
    // selector, the box at concept and dynamics) sharing ONE pointer capture.
    // With the gate armed either way d3's filter refuses the pan, so the press
    // is the draw's; the release reports the lasso's sampled path or the box's
    // captured bounds. A press on content is never a draw, and a click with no
    // drag encloses nothing.
    let path: Point[] | null = null;
    let boxStart: Point | null = null;
    const drawDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      const lasso = lassoArmedRef.current;
      if (!lasso && !boxArmedRef.current) return;
      if (isContentTarget(event.target)) return;
      const el2 = planeRef.current;
      if (!el2) return;
      event.preventDefault();
      const rect = el2.getBoundingClientRect();
      // The camera can still change by wheel zoom mid-draw, so read it per
      // sample rather than capturing it at the press.
      const toWorld = (clientX: number, clientY: number): Point => {
        const cam = cameraRef.current;
        return {
          x: (clientX - rect.left - cam.x) / cam.zoom,
          y: (clientY - rect.top - cam.y) / cam.zoom,
        };
      };
      const start = toWorld(event.clientX, event.clientY);
      path = [start];
      boxStart = lasso ? null : start;
      if (boxStart) setBoxDraft(capturedBox(start, start));
      else setLassoPath([...path]);
      let lastX = event.clientX;
      let lastY = event.clientY;

      const onMove = (ev: MouseEvent) => {
        if (!path) return;
        if (Math.hypot(ev.clientX - lastX, ev.clientY - lastY) < LASSO_STEP_PX) return;
        lastX = ev.clientX;
        lastY = ev.clientY;
        path.push(toWorld(ev.clientX, ev.clientY));
        if (boxStart) setBoxDraft(capturedBox(boxStart, path[path.length - 1]));
        else setLassoPath([...path]);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        const drawn = path ?? [];
        const from = boxStart;
        path = null;
        boxStart = null;
        if (from) {
          setBoxDraft(null);
          const box = capturedBox(from, drawn[drawn.length - 1] ?? from);
          if (boxIsDrawable(box)) onDrawBoxRef.current?.(box);
          return;
        }
        setLassoPath(null);
        if (drawn.length >= 3) onLassoRef.current?.(drawn);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    el.addEventListener("mousedown", drawDown);

    const sel = select(el);
    sel.call(behavior);
    behaviorRef.current = behavior;

    return () => {
      el.removeEventListener("mousedown", countPlanePress);
      el.removeEventListener("mousedown", drawDown);
      sel.on(".zoom", null);
      behaviorRef.current = null;
    };
  }, [intents]);

  // The map's pen (added 2026-11-16 per user review): while the mode is armed
  // a full-plane capture surface owns the pointer, so a stroke can never reach
  // d3-zoom (no pan), the plane's press count (no creation) or a word's own
  // raw handler (no drag, no click-to-center). The stroke is sampled in SCREEN
  // space (SKETCH_STEP_PX) and stored in WORLD coordinates, read through the
  // live camera ref so a wheel zoom mid-stroke still lands the samples under
  // the pointer. The release reports the stroke only when the drag actually
  // moved (a press with no movement draws nothing — the veil box's rule).
  //
  // The ERASER (added 2026-11-16 per user review) keeps this surface and this
  // arming; only the gesture's MEANING changes, chosen by `drawTool` at the
  // press. It samples the same way and reports the drag's world path, because
  // its reach rule is segment-to-polyline (sketchRules' `strokeDistance`): the
  // ink a fast hand passed over between two samples must still be reached. It
  // paints no draft — the eraser is quiet, and what it does is on release.
  // A tap that never moved reaches what it landed on (the eraser's atom is the
  // stroke, not a two-point path); the drawing tool keeps the two-point rule.
  useEffect(() => {
    if (!drawArmed) return;
    const surface = drawSurfaceRef.current;
    const plane = planeRef.current;
    if (!surface || !plane) return;

    const onDown = (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      // The gesture's meaning is fixed at the PRESS: toggling the tool with the
      // button held must not turn a stroke into an erase halfway through.
      const tool = drawToolRef.current;
      const rect = plane.getBoundingClientRect();
      const toWorld = (clientX: number, clientY: number): SketchPoint => {
        const cam = cameraRef.current;
        return {
          x: (clientX - rect.left - cam.x) / cam.zoom,
          y: (clientY - rect.top - cam.y) / cam.zoom,
        };
      };
      let points: SketchPoint[] = [toWorld(event.clientX, event.clientY)];
      if (tool === "pen") setStrokeDraft([...points]);
      let lastX = event.clientX;
      let lastY = event.clientY;

      const onMove = (ev: MouseEvent) => {
        if (Math.hypot(ev.clientX - lastX, ev.clientY - lastY) < SKETCH_STEP_PX) {
          return;
        }
        lastX = ev.clientX;
        lastY = ev.clientY;
        points = [...points, toWorld(ev.clientX, ev.clientY)];
        if (tool === "pen") setStrokeDraft([...points]);
      };
      const onUp = () => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        setStrokeDraft(null);
        // Esc (or a game switch) ended the arm mid-stroke: nothing is written.
        if (!drawArmedRef.current) return;
        if (tool === "eraser") {
          onEraseRef.current?.(points);
          return;
        }
        if (!isDrawableStroke(points)) return;
        onSketchRef.current?.(points);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    };
    surface.addEventListener("mousedown", onDown);
    return () => surface.removeEventListener("mousedown", onDown);
  }, [drawArmed]);

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
        className={`plane${gestureMode !== "idle" ? " gesture-armed" : ""}${lassoArmed ? " lasso-armed" : ""}${boxArmed ? " veil-armed" : ""}${drawArmed ? " draw-armed" : ""}${picking ? " ring-picking" : ""}`}
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
          {lassoPath && lassoPath.length > 1 && (
            <svg className="lasso" aria-hidden="true">
              <polygon
                points={lassoPath.map((point) => `${point.x},${point.y}`).join(" ")}
              />
            </svg>
          )}
          {/* The pen's in-flight stroke (added 2026-11-16 per user review): the
              line being drawn, in world space and in the pen's own ink and
              width, so the person sees exactly what the release will write. It
              is content (gates.ts) and reports nothing. */}
          {strokeDraft && isDrawableStroke(strokeDraft) && (
            <svg className="sketch-layer sketch-draft" aria-hidden="true">
              <path
                className="sketch-draft-path"
                d={strokePath(strokeDraft)}
                stroke={penInk(drawPen.color)}
                strokeWidth={drawPen.size}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
          {/* The veil's in-flight box (Epic 9 story 1): the rectangle being
              dragged, in world space, so the person sees what the arc will
              capture. It is content (gates.ts) and reports nothing. */}
          {boxDraft && boxDraft.w > 0 && boxDraft.h > 0 && (
            <div
              className="veil-draft"
              aria-hidden="true"
              style={{
                left: boxDraft.x,
                top: boxDraft.y,
                width: boxDraft.w,
                height: boxDraft.h,
              }}
            />
          )}
        </div>
        {/* The pen's capture surface (added 2026-11-16 per user review): it is
            rendered ONLY while the pen is armed, and it covers the plane so
            every press is the stroke's — the gate mode suspends pan, creation
            and word presses anyway, and this surface makes that physical. The
            in-flight stroke is previewed above, in world space. */}
        {drawArmed && (
          <div ref={drawSurfaceRef} className="draw-surface" aria-hidden="true" />
        )}
        {/* The chip reads through the band helpers (story 2): never a rounded
            percent that contradicts the level or the labels. */}
        <div className="zoom-chip">{zoomChipPercent(camera.zoom)}%</div>
        {/* The hint is ONE rule's sentence (mapContentRules.ts's `planeHint`):
            the shelf's fold is named only where a shelf renders. */}
        <div className="plane-hint">{hint}</div>
      </div>
    </PlaneContext.Provider>
  );
}
