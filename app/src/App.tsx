import { useEffect, useRef, useState } from "react";
import { CanvasPlane } from "./canvas/CanvasPlane";
import { DistanceWire } from "./canvas/DistanceWire";
import { ReferenceWord } from "./canvas/ReferenceWord";
import { useCamera } from "./canvas/useCamera";
import { useMap } from "./canvas/useMap";
import { WorkspaceGate } from "./workspace/WorkspaceGate";
import type { Workspace } from "./workspace/lifecycle";

type Point = { x: number; y: number };

/** A word's anchor point — its stored top-left corner. */
function wordPoint(word: { x: number; y: number }): Point {
  return { x: word.x, y: word.y };
}

/**
 * One workspace per window (ADR-0002): the gate or an open workspace's canvas,
 * carrying references as bare words and distances as plain wires (Epic 2).
 */
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const { camera, intents } = useCamera();
  const map = useMap(workspace?.path ?? "");
  const {
    refs,
    distances,
    connect,
    coinReference,
    updateReference,
    discardReference,
    rename,
    remove,
    beginConnect,
    moveConnect,
    dropConnect,
    coinConnect,
    cancelConnect,
    recoinDistance,
    removeDistance,
  } = map;

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

  return (
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
          onChange={updateReference}
          onDiscard={discardReference}
          onRename={rename}
          onRemove={remove}
          onConnectFrom={(slug, c) => beginConnect(slug, c.x, c.y)}
          connectTarget={connect !== null && connect.from !== word.slug}
          onDropConnect={dropConnect}
        />
      ))}

      {/* wires */}
      {distances.map((d) => {
        const f = refs.find((r) => r.slug === d.from);
        const t = refs.find((r) => r.slug === d.to);
        if (!f || !t) return null;
        return (
          <DistanceWire
            key={`${d.from}\u0000${d.to}\u0000${d.word}`}
            distance={d}
            fromPoint={wordPoint(f)}
            toPoint={wordPoint(t)}
            onChange={recoinDistance}
            onRemove={removeDistance}
          />
        );
      })}

      {/* dashed preview while drawing */}
      {connect && !connect.to && fromRef && (
        <ConnectPreview from={wordPoint(fromRef)} to={connect} />
      )}

      {/* coin-in-place field once the pair is fixed */}
      {connect && connect.to && fromRef && toRef && (
        <DistanceCoinField
          fromCenter={wordPoint(fromRef)}
          toCenter={wordPoint(toRef)}
          onCoin={coinConnect}
          onCancel={cancelConnect}
        />
      )}
    </CanvasPlane>
  );
}

function ConnectPreview({ from, to }: { from: Point; to: Point }) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  return (
    <div
      className="connect-preview-line"
      style={{
        left: from.x,
        top: from.y,
        width: Math.hypot(dx, dy),
        transform: `rotate(${(Math.atan2(dy, dx) * 180) / Math.PI}deg)`,
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