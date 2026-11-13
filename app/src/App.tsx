import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasPlane } from "./canvas/CanvasPlane";
import { DistanceWire } from "./canvas/DistanceWire";
import {
  centerOf,
  DEFAULT_BOX,
  edgePoint,
  type Box,
  type Point,
} from "./canvas/geometry";
import { LackMark } from "./canvas/LackMark";
import { resolveMarkDrop, type WireHit, type WordHit } from "./canvas/markTargets";
import { useRingDrag } from "./canvas/ringDrag";
import { ReferenceWord } from "./canvas/ReferenceWord";
import { ShelfFold } from "./canvas/ShelfFold";
import { useCamera } from "./canvas/useCamera";
import { useMap } from "./canvas/useMap";
import { markTargetKey, type Mark, type MarkTarget } from "./map/marks";
import type { Reference } from "./map/refs";
import { DEFAULT_SHELF_X, isShelved, rejectSpot } from "./map/shelf";
import { WorkspaceGate } from "./workspace/WorkspaceGate";
import type { Workspace } from "./workspace/lifecycle";

/** World-unit reach around a wire at 100% zoom (kept screen-sized while zooming). */
const WIRE_DROP_PX = 12;

/**
 * One workspace per window (ADR-0002): the gate or an open workspace's canvas,
 * carrying references as bare words and distances as plain wires (Epic 2),
 * quietened by open marks (Epic 3, ADR-0009).
 *
 * Story 2 gives the mark its own gestures: a plain click casts a bare lack,
 * the ring drags to bind/unbind, a double-click on a bare ring grows it into a
 * named question-word, and its × withdraws it. Wire geometry is derived from
 * *live* word positions, so a dragged word's wires follow the pointer instead
 * of snapping into place on drop.
 */
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const { camera, intents } = useCamera();
  const map = useMap(workspace?.path ?? "");
  const {
    refs,
    distances,
    marks,
    malformedMarks,
    orphanMarks,
    connect,
    coinReference,
    updateReference,
    discardReference,
    rename,
    remove,
    reject,
    toggleWordMark,
    toggleWireMark,
    castMark,
    withdrawMark,
    moveMark,
    growMark,
    beginConnect,
    moveConnect,
    dropConnect,
    coinConnect,
    cancelConnect,
    recoinDistance,
    removeDistance,
  } = map;

  // The shelf's fold (ADR-0010): a workspace-level convention, provisional.
  const shelfX = workspace?.shelfX ?? DEFAULT_SHELF_X;

  // Live positions (slug → plane point) while a word is being dragged, and
  // measured word boxes, so wires can attach to the word's edges.
  const [livePos, setLivePos] = useState<Record<string, Point>>({});
  const [boxes, setBoxes] = useState<Record<string, Box>>({});
  // The bare lack whose name field is open (double-clicked ring), if any.
  const [growAt, setGrowAt] = useState<Point | null>(null);

  const handleDragMove = useCallback((slug: string, x: number, y: number) => {
    setLivePos((prev) => {
      const current = prev[slug];
      if (current && current.x === x && current.y === y) return prev;
      return { ...prev, [slug]: { x, y } };
    });
  }, []);

  const handleMeasure = useCallback((slug: string, w: number, h: number) => {
    setBoxes((prev) => {
      const current = prev[slug];
      if (current && Math.abs(current.w - w) < 0.5 && Math.abs(current.h - h) < 0.5) {
        return prev;
      }
      return { ...prev, [slug]: { w, h } };
    });
  }, []);

  // Which targets carry an open mark right now — one hollow ring each.
  const openTargets = useMemo(
    () =>
      new Set(
        marks
          .filter((mark) => mark.kind === "open")
          .map((mark) => markTargetKey(mark.target)),
      ),
    [marks],
  );

  // The bare lacks (spot targets), one ring each, deduped by natural key so a
  // hand-duplicated line never stacks two rings.
  const openSpots = useMemo(() => {
    const seen = new Set<string>();
    const spots: Array<{ x: number; y: number; key: string }> = [];
    for (const mark of marks) {
      if (mark.kind !== "open" || mark.target.type !== "spot") continue;
      const key = markTargetKey(mark.target);
      if (seen.has(key)) continue;
      seen.add(key);
      spots.push({ x: mark.target.x, y: mark.target.y, key });
    }
    return spots;
  }, [marks]);

  const posOf = useCallback(
    (word: Reference): Point => {
      const live = word.slug !== null ? livePos[word.slug] : undefined;
      return live ?? { x: word.x, y: word.y };
    },
    [livePos],
  );
  const boxOf = useCallback(
    (word: Reference): Box =>
      (word.slug !== null ? boxes[word.slug] : undefined) ?? DEFAULT_BOX,
    [boxes],
  );
  const centerOfWord = useCallback(
    (word: Reference): Point => centerOf(posOf(word), boxOf(word)),
    [posOf, boxOf],
  );

  // Is this word set aside? Derived from where its centre sits past the fold —
  // no shelf flag, no stored state (ADR-0010). It is live during a drag (the
  // live position updates every frame), so the word quiets as it crosses.
  const shelvedOf = useCallback(
    (word: Reference): boolean =>
      word.slug !== null && isShelved(posOf(word).x, boxOf(word).w, shelfX),
    [posOf, boxOf, shelfX],
  );

  /**
   * Reject = settle + set aside in one move (ADR-0010): the word lands in the
   * shelf column past the fold, or keeps its place when it is already set
   * aside (then the settle alone finishes the rejection). The composed write
   * and its crash posture live in `useMap.reject`.
   */
  const rejectWord = useCallback(
    (word: Reference) => {
      const spot = rejectSpot(
        { x: posOf(word).x, y: posOf(word).y, width: boxOf(word).w },
        shelfX,
      );
      reject(word, spot);
    },
    [posOf, boxOf, shelfX, reject],
  );

  // Client point → plane point, for drops and camera-relative gestures.
  const toWorld = useCallback(
    (clientX: number, clientY: number): Point | null => {
      const el = document.querySelector<HTMLDivElement>(".plane");
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: (clientX - rect.left - camera.x) / camera.zoom,
        y: (clientY - rect.top - camera.y) / camera.zoom,
      };
    },
    [camera],
  );

  /**
   * Resolve a dropped ring (story 2): a word wins, then a wire, else the mark
   * stays bare at the drop point. Dropping on the mark's own target is a quiet
   * no-op; anything else moves the one mark in one write.
   */
  const handleRingDrop = useCallback(
    (source: MarkTarget, point: Point) => {
      const words: WordHit[] = [];
      for (const word of refs) {
        if (word.slug === null) continue;
        words.push({ slug: word.slug, pos: posOf(word), box: boxOf(word) });
      }
      const wires: WireHit[] = [];
      for (const distance of distances) {
        const from = refs.find((r) => r.slug === distance.from);
        const to = refs.find((r) => r.slug === distance.to);
        if (!from || !to) continue;
        wires.push({
          from: distance.from,
          to: distance.to,
          word: distance.word,
          fromPoint: centerOfWord(from),
          toPoint: centerOfWord(to),
        });
      }
      const target = resolveMarkDrop(point, words, wires, WIRE_DROP_PX / camera.zoom);
      if (markTargetKey(target) === markTargetKey(source)) return;
      moveMark(source, target);
    },
    [refs, distances, posOf, boxOf, centerOfWord, camera.zoom, moveMark],
  );

  const markDrag = useRingDrag(handleRingDrop, toWorld);

  /** A plain click on empty plane casts a bare lack at that spot (deferred). */
  const handlePlaneClick = useCallback(
    (point: Point) => castMark(point.x, point.y),
    [castMark],
  );

  /**
   * Double-click on empty plane still coins a word (ADR-0007). If the coin's
   * first click had already cast its deferred lack (a slower double-click),
   * the coin consumes that exact spot line: coining leaves no stray mark.
   */
  const handlePlaneDoubleClick = useCallback(
    (point: Point, consumedSpot?: Point) => {
      if (consumedSpot) {
        withdrawMark({ type: "spot", x: consumedSpot.x, y: consumedSpot.y });
      }
      coinReference(point.x, point.y);
    },
    [withdrawMark, coinReference],
  );

  // Track the pointer live during a connect draw so the dashed preview follows,
  // and end the draw when the pointer is released off a target word.
  useEffect(() => {
    if (!connect) return;
    const onMove = (ev: MouseEvent) => {
      const el = document.querySelector<HTMLDivElement>(".plane");
      if (!el) return;
      const rect = el.getBoundingClientRect();
      moveConnect(
        (ev.clientX - rect.left - camera.x) / camera.zoom,
        (ev.clientY - rect.top - camera.y) / camera.zoom,
      );
    };
    const onUp = (ev: MouseEvent) => {
      // Released on a target word: dropConnect (word's own mouseup) sets `to`.
      const target = ev.target as HTMLElement;
      if (target.closest(".word.connect-target")) return;
      // Released anywhere else: abandon the draw.
      cancelConnect();
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [connect, camera, moveConnect, cancelConnect]);

  if (!workspace) {
    return <WorkspaceGate onOpen={setWorkspace} />;
  }

  const fromRef = connect?.from ? refs.find((r) => r.slug === connect.from) : undefined;
  const toRef = connect?.to ? refs.find((r) => r.slug === connect.to) : undefined;

  // The dashed preview starts at the origin word's edge, pointing at the pointer.
  const previewFrom =
    connect && !connect.to && fromRef
      ? edgePoint(centerOfWord(fromRef), boxOf(fromRef), connect)
      : null;

  // Several distances may share a pair (ADR-0006); stagger their labels so a
  // second one is visible rather than stacked exactly on the first.
  const pairCounts = new Map<string, number>();

  return (
    <>
      <CanvasPlane
        camera={camera}
        intents={intents}
        onPlaneClick={handlePlaneClick}
        onPlaneDoubleClick={handlePlaneDoubleClick}
      >
        {/* the shelf's fold and margin: a place in world space (story 3) */}
        <ShelfFold shelfX={shelfX} />

        {/* bare lacks: one quiet ring per open spot (story 2) */}
        {openSpots.map((spot) => (
          <LackMark
            key={spot.key}
            x={spot.x}
            y={spot.y}
            onWithdraw={() => {
              withdrawMark({ type: "spot", x: spot.x, y: spot.y });
            }}
            onGrow={() => {
              setGrowAt({ x: spot.x, y: spot.y });
            }}
            onDragStart={(e) => {
              setGrowAt(null);
              markDrag.begin({ type: "spot", x: spot.x, y: spot.y }, e);
            }}
          />
        ))}

        {/* words */}
        {refs.map((word) => (
          <ReferenceWord
            key={word.id}
            word={word}
            position={posOf(word)}
            onChange={updateReference}
            onDiscard={discardReference}
            onRename={rename}
            onRemove={remove}
            onConnectFrom={(slug, c) => beginConnect(slug, c.x, c.y)}
            onDragMove={handleDragMove}
            onMeasure={handleMeasure}
            connectTarget={connect !== null && connect.from !== word.slug}
            onDropConnect={dropConnect}
            marked={
              word.slug !== null &&
              openTargets.has(markTargetKey({ type: "word", slug: word.slug }))
            }
            onToggleMark={() => {
              if (markDrag.isClickSuppressed()) return;
              if (word.slug !== null) toggleWordMark(word.slug);
            }}
            onMarkRingDrag={(slug, e) =>
              markDrag.begin({ type: "word", slug }, e)
            }
            shelved={shelvedOf(word)}
            onReject={() => rejectWord(word)}
          />
        ))}

        {/* wires */}
        {distances.map((d) => {
          const f = refs.find((r) => r.slug === d.from);
          const t = refs.find((r) => r.slug === d.to);
          if (!f || !t) return null;
          const pairKey =
            d.from < d.to ? `${d.from}\u0000${d.to}` : `${d.to}\u0000${d.from}`;
          const siblingIndex = pairCounts.get(pairKey) ?? 0;
          pairCounts.set(pairKey, siblingIndex + 1);
          const fCenter = centerOfWord(f);
          const tCenter = centerOfWord(t);
          return (
            <DistanceWire
              key={`${d.from}\u0000${d.to}\u0000${d.word}`}
              distance={d}
              fromPoint={edgePoint(fCenter, boxOf(f), tCenter)}
              toPoint={edgePoint(tCenter, boxOf(t), fCenter)}
              onChange={recoinDistance}
              onRemove={removeDistance}
              marked={openTargets.has(
                markTargetKey({ type: "wire", from: d.from, to: d.to, word: d.word }),
              )}
              shelved={shelvedOf(f) || shelvedOf(t)}
              onToggleMark={() => {
                if (markDrag.isClickSuppressed()) return;
                toggleWireMark(d);
              }}
              onMarkRingDrag={(wire, e) =>
                markDrag.begin(
                  { type: "wire", from: wire.from, to: wire.to, word: wire.word },
                  e,
                )
              }
              labelOffset={siblingIndex * 24}
            />
          );
        })}

        {/* the in-place grow field: name the lack, or cancel and leave it bare */}
        {growAt && (
          <GrowField
            x={growAt.x}
            y={growAt.y}
            onGrow={(name) => {
              const spot = growAt;
              setGrowAt(null);
              if (spot) growMark(spot, name);
            }}
            onCancel={() => setGrowAt(null)}
          />
        )}

        {/* dashed preview while drawing */}
        {previewFrom && connect && !connect.to && (
          <ConnectPreview from={previewFrom} to={connect} />
        )}

        {/* coin-in-place field once the pair is fixed */}
        {connect && connect.to && fromRef && toRef && (
          <DistanceCoinField
            fromCenter={centerOfWord(fromRef)}
            toCenter={centerOfWord(toRef)}
            onCoin={coinConnect}
            onCancel={cancelConnect}
          />
        )}
      </CanvasPlane>

      {/* Orphan and unreadable marks: preserved, surfaced quietly (ADR-0009). */}
      <MarkNotices malformed={malformedMarks} orphans={orphanMarks} />

      {/* the ring in flight while its mark is being bound (story 2) */}
      {markDrag.ghost && (
        <div
          className="mark-ghost"
          style={{ left: markDrag.ghost.x, top: markDrag.ghost.y }}
        />
      )}
    </>
  );
}

/**
 * A quiet line of small text for mark lines the app keeps but cannot place
 * (orphans) or cannot read (malformed). No counts, badges, or panels — the
 * line is the whole surface (ADR-0009's "surfaced, not silently hidden").
 */
function MarkNotices({
  malformed,
  orphans,
}: {
  malformed: readonly string[];
  orphans: readonly Mark[];
}) {
  if (malformed.length === 0 && orphans.length === 0) return null;
  return (
    <div className="mark-notices">
      {orphans.map((mark, index) => (
        <div className="mark-notice" key={`orphan-${index}`}>
          unattached mark on {describeMarkTarget(mark.target)} — kept in map/marks.jsonl
        </div>
      ))}
      {malformed.map((line, index) => (
        <div className="mark-notice" key={`malformed-${index}`}>
          unreadable line in map/marks.jsonl: {line}
        </div>
      ))}
    </div>
  );
}

function describeMarkTarget(target: MarkTarget): string {
  switch (target.type) {
    case "word":
      return `“${target.slug}”`;
    case "wire":
      return `the wire ${target.from} → ${target.to} · “${target.word}”`;
    case "spot":
      return "a bare spot";
  }
}

/**
 * The grow field (map ticket 03): double-clicking a bare ring names it in
 * place. Enter coins the question-word at the spot and retargets the mark to
 * it; Escape (or leaving the field) changes nothing — the bare lack stays
 * exactly as it was. A `done` latch makes Escape + blur a single outcome (the
 * double-commit lesson from the note-card era).
 */
function GrowField({
  x,
  y,
  onGrow,
  onCancel,
}: {
  x: number;
  y: number;
  onGrow: (name: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const doneRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    const trimmed = draft.trim();
    if (trimmed) onGrow(trimmed);
    else onCancel();
  }

  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }

  return (
    <div className="grow-field" style={{ left: x, top: y }}>
      <input
        ref={inputRef}
        value={draft}
        placeholder="name the question…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={cancel}
      />
    </div>
  );
}

function ConnectPreview({ from, to }: { from: Point; to: Point }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(0, Math.hypot(dx, dy));
  const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
  return (
    <div
      className="connect-preview-line"
      style={{
        width: length,
        transform: `translate3d(${from.x}px, ${from.y}px, 0) rotate(${angle}deg)`,
      }}
    />
  );
}

interface DistanceCoinFieldProps {
  fromCenter: Point;
  toCenter: Point;
  onCoin: (word: string) => void;
  onCancel: () => void;
}

function DistanceCoinField({
  fromCenter,
  toCenter,
  onCoin,
  onCancel,
}: DistanceCoinFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const mx = (fromCenter.x + toCenter.x) / 2;
  const my = (fromCenter.y + toCenter.y) / 2;

  function commit() {
    const trimmed = draft.trim();
    if (trimmed) onCoin(trimmed);
    else onCancel();
  }

  return (
    <div className="distance-coinfield" style={{ left: mx, top: my }}>
      <input
        ref={inputRef}
        value={draft}
        placeholder="name the distance…"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
          }
        }}
        onBlur={commit}
      />
    </div>
  );
}

export default App;
