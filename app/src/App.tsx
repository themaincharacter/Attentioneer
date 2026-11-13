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
import { ReferenceWord } from "./canvas/ReferenceWord";
import { useCamera } from "./canvas/useCamera";
import { useMap } from "./canvas/useMap";
import { markTargetKey, type Mark, type MarkTarget } from "./map/marks";
import type { Reference } from "./map/refs";
import { WorkspaceGate } from "./workspace/WorkspaceGate";
import type { Workspace } from "./workspace/lifecycle";

/**
 * One workspace per window (ADR-0002): the gate or an open workspace's canvas,
 * carrying references as bare words and distances as plain wires (Epic 2),
 * quietened by open marks (Epic 3, ADR-0009).
 *
 * Wire geometry is derived from *live* word positions: a word being dragged
 * reports its position up here every frame, so its wires follow the pointer
 * instead of snapping into place on drop.
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
    toggleWordMark,
    toggleWireMark,
    beginConnect,
    moveConnect,
    dropConnect,
    coinConnect,
    cancelConnect,
    recoinDistance,
    removeDistance,
  } = map;

  // Live positions (slug → plane point) while a word is being dragged, and
  // measured word boxes, so wires can attach to the word's edges.
  const [livePos, setLivePos] = useState<Record<string, Point>>({});
  const [boxes, setBoxes] = useState<Record<string, Box>>({});

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

  const posOf = (word: Reference): Point => {
    const live = word.slug !== null ? livePos[word.slug] : undefined;
    return live ?? { x: word.x, y: word.y };
  };
  const boxOf = (word: Reference): Box =>
    (word.slug !== null ? boxes[word.slug] : undefined) ?? DEFAULT_BOX;
  const centerOfWord = (word: Reference): Point => centerOf(posOf(word), boxOf(word));

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
        onPlaneDoubleClick={(point) => coinReference(point.x, point.y)}
      >
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
              if (word.slug !== null) toggleWordMark(word.slug);
            }}
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
              onToggleMark={() => toggleWireMark(d)}
              labelOffset={siblingIndex * 24}
            />
          );
        })}

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