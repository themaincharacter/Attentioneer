import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasPlane } from "./canvas/CanvasPlane";
import { DistanceWire } from "./canvas/DistanceWire";
import {
  centerOf,
  DEFAULT_BOX,
  directedWireEndpoints,
  edgePoint,
  wordsInPolygon,
  type Box,
  type Point,
} from "./canvas/geometry";
import type { GestureMode } from "./canvas/gates";
import { LevelControl } from "./canvas/LevelControl";
import { LackMark } from "./canvas/LackMark";
import { LinkWire } from "./canvas/LinkWire";
import { resolveElementPick, type PickedElement } from "./canvas/markTargets";
import { countsAsOneFlip } from "./canvas/planePress";
import { PlaneMenu } from "./canvas/PlaneMenu";
import { PlayingSetBar, PlayingSetWords } from "./canvas/PlayingSetSelector";
import { useRingDrag } from "./canvas/ringDrag";
import { ReferenceWord } from "./canvas/ReferenceWord";
import { ShelfFold } from "./canvas/ShelfFold";
import { SignChoice } from "./canvas/SignChoice";
import { useCamera } from "./canvas/useCamera";
import { useMap } from "./canvas/useMap";
import { linkKey, type LinkSign } from "./map/links";
import { markTargetKey, type Mark, type MarkTarget } from "./map/marks";
import { hasWord, prefilledSelection } from "./map/model";
import type { Reference } from "./map/refs";
import { DEFAULT_SHELF_X, isShelved, rejectSpot } from "./map/shelf";
import { saveWorkspaceLevel, DEFAULT_LEVEL, type Level } from "./workspace/level";
import { WorkspaceGate } from "./workspace/WorkspaceGate";
import type { Workspace } from "./workspace/lifecycle";

/**
 * One workspace per window (ADR-0002): the gate or an open workspace's canvas,
 * carrying references as bare words and distances as plain wires (Epic 2),
 * quietened by open marks (Epic 3, ADR-0009).
 *
 * Creation lives on the double-click (Epic 3 feedback): a double-click on
 * empty plane opens a small word/lack menu there; choosing word coins in
 * place, choosing lack casts a bare open mark. A single click creates nothing.
 * The mark's own gestures are story 2's: the ring drags to bind/unbind, a
 * double-click on a bare ring grows it into a named question-word, and its ×
 * withdraws it. Wire geometry is derived from *live* word positions, so a
 * dragged word's wires follow the pointer instead of snapping into place on
 * drop.
 *
 * Epic 4 story 1 adds the second game (ADR-0016): a quiet level control
 * switches concept / dynamics, the playing-set selector writes map/model.json
 * (ADR-0013), and the interaction-mode gate suspends the plane's own gestures
 * while the selector is open. The dynamics moves themselves arrive in stories
 * 2–4; here the mode and the set persist and the out-of-set words merely dim.
 */
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const { camera, intents } = useCamera();
  // The active game (ADR-0016): workspace.yml's level key is the sole source.
  const level: Level = workspace?.level ?? DEFAULT_LEVEL;
  const map = useMap(workspace?.path ?? "", { playing: level === "dynamics" });
  const {
    refs,
    distances,
    links,
    marks,
    malformedMarks,
    malformedLinks,
    orphanMarks,
    orphanLinks,
    model,
    malformedModel,
    orphanMembers,
    loaded,
    acceptPlayingSet,
    connect,
    coinReference,
    updateReference,
    discardReference,
    rename,
    remove,
    reject,
    toggleWordMark,
    toggleWireMark,
    toggleLinkMark,
    drawLink,
    flipLink,
    removeLink,
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
  // The plane point where the double-click creation menu is open, if any.
  const [menuAt, setMenuAt] = useState<Point | null>(null);
  // The playing-set selector (Epic 4 story 1, ADR-0013): its draft selection
  // and the draw tool's armed state. The gate arms while it is open.
  const [selectorOpen, setSelectorOpen] = useState(false);
  const [selectorDraft, setSelectorDraft] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [lassoArmed, setLassoArmed] = useState(false);
  // A workspace that resumed in dynamics with no set prompts the selector once.
  const autoPromptedRef = useRef<string | null>(null);

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

  // The interaction-mode gate (ADR-0016): the selector and the pending sign
  // choice are the armed gestures; story 3's path collection joins here.
  const signPending = level === "dynamics" && connect !== null && connect.to !== undefined;
  const gestureMode: GestureMode = selectorOpen
    ? "selector"
    : signPending
      ? "sign-choice"
      : "idle";

  // Every coined word, as the selector's world-space layer needs it.
  const selectorWords = useMemo(
    () =>
      refs
        .filter(
          (word): word is Reference & { slug: string } => word.slug !== null,
        )
        .map((word) => ({
          slug: word.slug,
          name: word.name,
          pos: posOf(word),
          box: boxOf(word),
        })),
    [refs, posOf, boxOf],
  );

  // Out of play at Level 2: dimmed but fully live (ADR-0013, story 1). In
  // concept mode — or before a set exists — every word renders unchanged.
  // A word coined while playing joins the set in story 2's composed move; until
  // then a fresh word reads out of play until the selector is re-run.
  const isOutOfSet = useCallback(
    (word: Reference): boolean =>
      level === "dynamics" &&
      model !== null &&
      word.slug !== null &&
      !hasWord(model, word.slug),
    [level, model],
  );

  /** Switching games cancels any pending gesture (ADR-0016). */
  const cancelPendingGestures = useCallback(() => {
    setMenuAt(null);
    setGrowAt(null);
    setSelectorOpen(false);
    setLassoArmed(false);
    cancelConnect();
  }, [cancelConnect]);

  /**
   * Open the selector, pre-filled (ADR-0013): every current word on first
   * entry, the accepted set on a re-run. It is also the level control's
   * "edit the playing set".
   */
  const openSelector = useCallback(() => {
    cancelPendingGestures();
    setSelectorDraft(
      new Set(
        prefilledSelection(
          model,
          selectorWords.map((word) => word.slug),
        ),
      ),
    );
    setSelectorOpen(true);
  }, [cancelPendingGestures, model, selectorWords]);

  /** Click a word: leave it out, or bring it back. */
  const toggleSelectorWord = useCallback((slug: string) => {
    setSelectorDraft((current) => {
      const next = new Set(current);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }, []);

  /** Select-all keeps everything — shelved words included (the shelf is a place). */
  const selectAllSelectorWords = useCallback(() => {
    setSelectorDraft(new Set(selectorWords.map((word) => word.slug)));
  }, [selectorWords]);

  /** Accept: write map/model.json, rewriting any previous set (no history). */
  const acceptSelector = useCallback(() => {
    acceptPlayingSet([...selectorDraft]);
    setSelectorOpen(false);
    setLassoArmed(false);
  }, [acceptPlayingSet, selectorDraft]);

  const closeSelector = useCallback(() => {
    setSelectorOpen(false);
    setLassoArmed(false);
  }, []);

  /** The lasso's release: its enclosed words become the draft set (narrowing). */
  const handleLasso = useCallback(
    (path: readonly Point[]) => {
      const inside = wordsInPolygon(path, selectorWords);
      setSelectorDraft(new Set(inside.map((word) => word.slug)));
      setLassoArmed(false);
    },
    [selectorWords],
  );

  const toggleLasso = useCallback(() => setLassoArmed((armed) => !armed), []);

  /**
   * Change the game (ADR-0016): cancel pending gestures, write the level key
   * canonically, and ask for a playing set when dynamics is entered without
   * one. Reopening the workspace resumes the saved level.
   */
  const changeLevel = useCallback(
    (next: Level) => {
      if (!workspace || workspace.level === next) return;
      cancelPendingGestures();
      setWorkspace({ ...workspace, level: next });
      void saveWorkspaceLevel(workspace.path, next);
      if (next === "dynamics" && model === null) {
        openSelector();
      }
    },
    [workspace, model, cancelPendingGestures, openSelector],
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
   * The elements under a client point, nearest first: the DOM's own answer to
   * "what is here?" — the hit element and its ancestors up to the plane. This
   * is the element-under-pointer half of ADR-0016 decision 5; the pure rule
   * that reads it lives in markTargets.ts.
   */
  const pickChainAt = useCallback(
    (clientX: number, clientY: number): PickedElement[] => {
      const chain: PickedElement[] = [];
      if (typeof document === "undefined") return chain;
      let node: HTMLElement | null = document.elementFromPoint(
        clientX,
        clientY,
      ) as HTMLElement | null;
      while (node && node !== document.body) {
        chain.push({ classes: [...node.classList], data: { ...node.dataset } });
        node = node.parentElement;
      }
      return chain;
    },
    [],
  );

  /**
   * Resolve a dropped ring: bind the mark to the ELEMENT under the pointer — a
   * word, a link wire, a distance wire — else leave it bare at the drop point
   * (ADR-0016 decision 5; no nearest-element math). Dropping on the mark's own
   * target is a quiet no-op; anything else moves the one mark in one write.
   */
  const handleRingDrop = useCallback(
    (source: MarkTarget, point: Point, client: Point) => {
      const target = resolveElementPick(pickChainAt(client.x, client.y), point);
      if (markTargetKey(target) === markTargetKey(source)) return;
      moveMark(source, target);
    },
    [pickChainAt, moveMark],
  );

  const markDrag = useRingDrag(handleRingDrop, toWorld);

  // One flip per press-pair: a double-click on a sign fires two clicks, which
  // without this would flip and unflip — a quiet no-op that reads as broken.
  const lastSignFlipRef = useRef(new Map<string, number>());
  const flipSign = useCallback(
    (from: string, to: string) => {
      const key = linkKey(from, to);
      const now = Date.now();
      if (!countsAsOneFlip(lastSignFlipRef.current.get(key) ?? null, now)) return;
      lastSignFlipRef.current.set(key, now);
      flipLink(from, to);
    },
    [flipLink],
  );

  /**
   * The pending link's explicit sign pick (ADR-0016 decision 3, World B): only
   * a press on + or - authors it. Nothing chosen means nothing written.
   */
  const pickSign = useCallback(
    (sign: LinkSign) => {
      if (!connect || !connect.to) return;
      drawLink(connect.from, connect.to, sign);
      cancelConnect();
    },
    [connect, drawLink, cancelConnect],
  );

  /** A double-click on empty plane opens the word/lack menu at that point. */
  const handlePlaneDoubleClick = useCallback((point: Point) => {
    setMenuAt(point);
  }, []);

  const closePlaneMenu = useCallback(() => setMenuAt(null), []);

  /** The menu's word choice: close it and open the in-place coin field. */
  const chooseWord = useCallback(() => {
    const spot = menuAt;
    if (!spot) return;
    setMenuAt(null);
    coinReference(spot.x, spot.y);
  }, [menuAt, coinReference]);

  /** The menu's lack choice: close it and cast the bare open mark. */
  const chooseLack = useCallback(() => {
    const spot = menuAt;
    if (!spot) return;
    setMenuAt(null);
    castMark(spot.x, spot.y);
  }, [menuAt, castMark]);

  // Track the pointer live during a connect draw so the dashed preview follows,
  // and end the draw when the pointer is released off a target word.
  //
  // Once the pair is fixed (`connect.to`), the gesture is over: the next
  // surface is the coin field (Level 1) or the sign choice (Level 2), and a
  // mouseup on that surface must never be read as "released off a word".
  useEffect(() => {
    if (!connect || connect.to) return;
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

  // A workspace that resumes in dynamics without an accepted set asks for one
  // on open (ADR-0013: the playing set is required before play). Once per
  // workspace — closing the selector is a choice, not a prompt to repeat.
  useEffect(() => {
    if (!workspace || !loaded) return;
    if (workspace.level !== "dynamics" || model !== null) return;
    if (autoPromptedRef.current === workspace.path) return;
    autoPromptedRef.current = workspace.path;
    openSelector();
  }, [workspace, loaded, model, openSelector]);

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
        onPlaneDoubleClick={handlePlaneDoubleClick}
        gestureMode={gestureMode}
        lassoArmed={selectorOpen && lassoArmed}
        picking={markDrag.ghost !== null}
        onLasso={handleLasso}
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
            outOfSet={isOutOfSet(word)}
            interactionMode={gestureMode}
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

        {/* signed links (story 2, ADR-0012/0014): Level 2 only — Level 1
            renders exactly as before. Each directed link is its own wire, on
            its direction's side of the pair's canonical chord, with the sign
            glyph at the target head. */}
        {level === "dynamics" &&
          links.map((link) => {
            const f = refs.find((r) => r.slug === link.from);
            const t = refs.find((r) => r.slug === link.to);
            if (!f || !t) return null;
            const fCenter = centerOfWord(f);
            const tCenter = centerOfWord(t);
            // A self-link is legal and unremarkable: it renders as a short
            // stub off the word's right edge (provisional, like the rest of
            // the wire geometry).
            const points =
              link.from === link.to
                ? {
                    from: { x: fCenter.x + boxOf(f).w / 2, y: fCenter.y },
                    to: { x: fCenter.x + boxOf(f).w / 2 + 26, y: fCenter.y },
                  }
                : directedWireEndpoints(
                    {
                      slug: link.from,
                      point: edgePoint(fCenter, boxOf(f), tCenter),
                    },
                    {
                      slug: link.to,
                      point: edgePoint(tCenter, boxOf(t), fCenter),
                    },
                    camera.zoom,
                  );
            return (
              <LinkWire
                key={`link-${linkKey(link.from, link.to)}`}
                link={link}
                fromPoint={points.from}
                toPoint={points.to}
                marked={openTargets.has(
                  markTargetKey({ type: "link", from: link.from, to: link.to }),
                )}
                shelved={shelvedOf(f) || shelvedOf(t)}
                onFlip={() => flipSign(link.from, link.to)}
                onRemove={() => removeLink(link.from, link.to)}
                onToggleMark={() => {
                  if (markDrag.isClickSuppressed()) return;
                  toggleLinkMark(link.from, link.to);
                }}
                onMarkRingDrag={(e) =>
                  markDrag.begin(
                    { type: "link", from: link.from, to: link.to },
                    e,
                  )
                }
              />
            );
          })}

        {/* the playing-set selector's world layer (story 1): one quiet button
            over each word; excluded words wear a dashed hollow ring, never
            the remove × */}
        {selectorOpen && (
          <PlayingSetWords
            words={selectorWords}
            selected={selectorDraft}
            onToggle={toggleSelectorWord}
          />
        )}

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

        {/* once the pair is fixed the gesture is LEVEL-SCOPED (ADR-0016):
            at Level 2 the sign choice opens in place of the coin field — no
            default, an explicit pick or nothing — while Level 1 still coins a
            distance word exactly as before. */}
        {connect && connect.to && fromRef && toRef && (
          level === "dynamics" ? (
            <SignChoice
              fromCenter={centerOfWord(fromRef)}
              toCenter={centerOfWord(toRef)}
              onPick={pickSign}
              onDiscard={cancelConnect}
            />
          ) : (
            <DistanceCoinField
              fromCenter={centerOfWord(fromRef)}
              toCenter={centerOfWord(toRef)}
              onCoin={coinConnect}
              onCancel={cancelConnect}
            />
          )
        )}

        {/* the double-click creation menu: word or lack, at the point */}
        {menuAt && (
          <PlaneMenu
            x={menuAt.x}
            y={menuAt.y}
            onWord={chooseWord}
            onLack={chooseLack}
            onClose={closePlaneMenu}
          />
        )}
      </CanvasPlane>

      {/* the quiet level control (ADR-0016): concept / dynamics, one switch */}
      <LevelControl
        level={level}
        onChange={changeLevel}
        onEditPlayingSet={openSelector}
      />

      {/* the selector's controls, in screen space while it is open (story 1) */}
      {selectorOpen && (
        <PlayingSetBar
          lassoArmed={lassoArmed}
          onToggleLasso={toggleLasso}
          onSelectAll={selectAllSelectorWords}
          onAccept={acceptSelector}
          onClose={closeSelector}
        />
      )}

      {/* Orphan and unreadable records: preserved, surfaced quietly (ADR-0009/0013). */}
      <MarkNotices
        malformed={malformedMarks}
        orphans={orphanMarks}
        malformedLinks={malformedLinks}
        orphanLinks={orphanLinks}
        malformedModel={malformedModel}
        orphanMembers={orphanMembers}
      />

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
 * A quiet line of small text for record lines the app keeps but cannot place
 * (mark orphans, a playing set naming words that are gone) or cannot read
 * (malformed marks, a malformed model.json). No counts, badges, or panels —
 * the line is the whole surface (ADR-0009's "surfaced, not silently hidden").
 */
function MarkNotices({
  malformed,
  orphans,
  malformedLinks,
  orphanLinks,
  malformedModel,
  orphanMembers,
}: {
  malformed: readonly string[];
  orphans: readonly Mark[];
  malformedLinks: readonly string[];
  orphanLinks: readonly { from: string; to: string }[];
  malformedModel: string | null;
  orphanMembers: readonly string[];
}) {
  if (
    malformed.length === 0 &&
    orphans.length === 0 &&
    malformedLinks.length === 0 &&
    orphanLinks.length === 0 &&
    malformedModel === null &&
    orphanMembers.length === 0
  ) {
    return null;
  }
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
      {orphanLinks.map((link, index) => (
        <div className="mark-notice" key={`link-${index}`}>
          a link names “{link.from} → {link.to}” — not on the map, kept in
          map/links.jsonl
        </div>
      ))}
      {malformedLinks.map((line, index) => (
        <div className="mark-notice" key={`malformed-link-${index}`}>
          unreadable line in map/links.jsonl: {line}
        </div>
      ))}
      {orphanMembers.map((slug) => (
        <div className="mark-notice" key={`member-${slug}`}>
          playing set names “{slug}” — not on the map, kept in map/model.json
        </div>
      ))}
      {malformedModel !== null && (
        <div className="mark-notice">
          unreadable map/model.json — kept as is until a playing set is accepted
        </div>
      )}
    </div>
  );
}

function describeMarkTarget(target: MarkTarget): string {
  switch (target.type) {
    case "word":
      return `“${target.slug}”`;
    case "wire":
      return `the wire ${target.from} → ${target.to} · “${target.word}”`;
    case "link":
      return `the link ${target.from} → ${target.to}`;
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
