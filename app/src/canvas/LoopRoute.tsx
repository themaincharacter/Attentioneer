import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { loopSlug, type Loop } from "../map/loops";
import { AssumptionDiamond } from "./AssumptionDiamond";
import type { Point } from "./geometry";

/** World units the coined name sits above the route's middle (provisional). */
export const LOOP_NAME_LIFT = 14;

interface LoopRouteProps {
  loop: Loop;
  /** The closed route, in world coordinates (geometry.ts's route layout). */
  points: readonly Point[];
  /** World point the coined name is anchored to. */
  nameAt: Point;
  /** Open the walk: the route or the name is the whole trigger (ADR-0015). */
  onOpen: () => void;
  /** Coin a new name for this loop (one in-place rewrite of its line). */
  onRename: (name: string) => void;
  /** Remove the loop — ammo, one click, no ceremony (ADR-0012). */
  onRemove: () => void;
  /** True when this loop's slug carries at least one assumption (story 4). */
  hasAssumptions?: boolean;
  /**
   * Open the loop's quiet assumption overlay, anchored beside the name pill —
   * the loop's own presence, opened from the same place the walk and rename
   * live (story 4).
   */
  onOpenAssumptions?: (anchor: Point) => void;
}

/**
 * One stored loop at Level 2 (story 3, ADR-0012/0015/0016): a quiet closed
 * route through its words in path order — hugging the words, never through
 * their text — with the coined name near it. The route is hairlined and
 * pays out beneath the words; the name is an ordinary little pill (the
 * distance label's family) so it can carry a press.
 *
 * The route and the name are the loop's presence: selecting either opens the
 * walk (the read, derived on every change). Double-clicking the name renames in
 * place (one rewrite of the line: name + key + path bytes); the hover × removes
 * the loop — ammo, like every other removal on the plane. Story 4's hollow
 * assumption diamond rides in the name pill (the route keeps opening the walk,
 * so a press there is never ambiguous); its overlay is rendered at App level,
 * so the route and name never move. Both the route and
 * the name are content elements and the name's controls are word-handler
 * controls (gates.ts), so a press here can never pan the plane, create
 * anything or start a word gesture.
 *
 * Provisional: the route's geometry, the name's pill and its lift (ADR-0003's
 * rendering seam); Level 1 renders none of this.
 */
export function LoopRoute({
  loop,
  points,
  nameAt,
  onOpen,
  onRename,
  onRemove,
  hasAssumptions = false,
  onOpenAssumptions,
}: LoopRouteProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLDivElement>(null);
  const doneRef = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(loop.name);

  useEffect(() => {
    if (!renaming) return;
    setDraft(loop.name);
    doneRef.current = false;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [renaming, loop.name]);

  function commitRename() {
    if (doneRef.current) return;
    doneRef.current = true;
    setRenaming(false);
    const trimmed = draft.trim();
    if (trimmed && trimmed !== loop.name) onRename(trimmed);
  }

  function cancelRename() {
    if (doneRef.current) return;
    doneRef.current = true;
    setRenaming(false);
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      commitRename();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancelRename();
    }
  }

  // The SVG's viewport is the route's own bounding box (plus a hair), so the
  // hit band stays hittable everywhere along the route: a 1×1 svg with overflow
  // visible would paint outside its viewport but not reliably hit-test there.
  const pad = 3;
  const minX = Math.min(...points.map((point) => point.x)) - pad;
  const minY = Math.min(...points.map((point) => point.y)) - pad;
  const width = Math.max(...points.map((point) => point.x)) + pad - minX;
  const height = Math.max(...points.map((point) => point.y)) + pad - minY;
  const polygon = points
    .map((point) => `${point.x - minX},${point.y - minY}`)
    .join(" ");

  return (
    <div className="loop" data-loop={loopSlug(loop.name)}>
      <svg
        className="loop-route"
        aria-hidden="true"
        style={{ left: minX, top: minY, width, height }}
      >
        <polygon className="loop-route-line" points={polygon} />
        {/* A wider invisible band over the same route: the click target for
            the walk. Content, so it is never a plane press. */}
        <polygon className="loop-route-hit" points={polygon} onClick={onOpen} />
      </svg>
      <div
        ref={nameRef}
        className="loop-name"
        style={{
          left: nameAt.x,
          top: nameAt.y - LOOP_NAME_LIFT,
          transform: "translate(-50%, -50%)",
        }}
      >
        {renaming ? (
          <input
            ref={inputRef}
            className="loop-coinfield-input"
            value={draft}
            placeholder="name the loop…"
            aria-label="rename the loop"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={commitRename}
            onClick={(e) => e.stopPropagation()}
            onDoubleClick={(e) => e.stopPropagation()}
          />
        ) : (
          <button
            type="button"
            className="loop-name-text"
            aria-label={`read the loop “${loop.name}”`}
            title="read its walk"
            onClick={(e) => {
              e.stopPropagation();
              onOpen();
            }}
            onDoubleClick={(e) => {
              e.stopPropagation();
              setRenaming(true);
            }}
          >
            {loop.name}
          </button>
        )}
        {/* Story 4's presence: the hollow diamond in the name pill opens the
            loop's quiet overlay (its claims, revisable in place); the overlay
            is rendered at App level, so the route and name never move. */}
        {onOpenAssumptions && (
          <AssumptionDiamond
            has={hasAssumptions}
            onPress={() =>
              // Just past the pill's right edge, so the diamond stays
              // reachable while the overlay is open and the card never covers
              // the name the person is reading.
              onOpenAssumptions({
                x:
                  nameAt.x +
                  (nameRef.current?.offsetWidth ?? 0) / 2 +
                  12,
                y: nameAt.y - LOOP_NAME_LIFT,
              })
            }
          />
        )}
        <button
          type="button"
          className="loop-remove"
          aria-label="remove loop"
          title="remove (no undo)"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
        >
          ×
        </button>
      </div>
    </div>
  );
}
