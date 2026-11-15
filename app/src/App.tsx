import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CanvasPlane } from "./canvas/CanvasPlane";
import { DistanceWire } from "./canvas/DistanceWire";
import {
  centerOf,
  DEFAULT_BOX,
  directedWireEndpoints,
  edgePoint,
  LOOP_ROUTE_STAGGER,
  loopRoutePoints,
  routeCenter,
  wordsInPolygon,
  type Box,
  type Point,
} from "./canvas/geometry";
import { AssumptionDiamond } from "./canvas/AssumptionDiamond";
import { AssumptionOverlay } from "./canvas/AssumptionOverlay";
import { creationKinds, type GestureMode } from "./canvas/gates";
import { LevelControl } from "./canvas/LevelControl";
import { LackMark } from "./canvas/LackMark";
import { LinkWire } from "./canvas/LinkWire";
import {
  beginPathSession,
  clickPathWord,
  endPathSession,
  type PathSession,
} from "./canvas/loopAuthoring";
import { LoopCoinField, PathBar, PathWords } from "./canvas/LoopFields";
import { LoopRoute } from "./canvas/LoopRoute";
import { LoopWalk } from "./canvas/LoopWalk";
import { resolveElementPick, type PickedElement } from "./canvas/markTargets";
import { countsAsOneFlip } from "./canvas/planePress";
import {
  focusAfterPeekClose,
  peekFocusSelector,
  type PeekCloseReason,
} from "./canvas/outwardRules";
import { OutwardWindow } from "./canvas/OutwardWindow";
import { PlaneMenu } from "./canvas/PlaneMenu";
import {
  chooserFocusSelector,
  focusAfterChooserClose,
  isPointerMarked,
  markedPointerKeys,
  type ChooserCloseReason,
} from "./canvas/pointerRules";
import { PointerChooser } from "./canvas/PointerChooser";
import { PlayingSetBar, PlayingSetWords } from "./canvas/PlayingSetSelector";
import { useRingDrag } from "./canvas/ringDrag";
import { ReferenceWord } from "./canvas/ReferenceWord";
import { ShelfFold } from "./canvas/ShelfFold";
import { SignChoice } from "./canvas/SignChoice";
import { useCamera } from "./canvas/useCamera";
import { useMap } from "./canvas/useMap";
import {
  assumptionTargetKey,
  findAssumptions,
  targetsWithAssumptions,
  type Assumption,
  type AssumptionTarget,
} from "./map/assumptions";
import { linkKey, type LinkSign } from "./map/links";
import { readLoop } from "./map/loopRead";
import { findLoop, isClosedPath, loopSlug, type Loop } from "./map/loops";
import { markTargetKey, type Mark, type MarkTarget } from "./map/marks";
import { hasWord, prefilledSelection } from "./map/model";
import { findPointers, type Pointer } from "./map/pointers";
import type { Reference } from "./map/refs";
import { DEFAULT_SHELF_X, isShelved, rejectSpot } from "./map/shelf";
import { saveWorkspaceLevel, DEFAULT_LEVEL, type Level } from "./workspace/level";
import {
  createLevelHandoff,
  type HandoffCause,
  type LevelHandoff,
  type LevelHandoffDeps,
} from "./workspace/levelHandoff";
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
 * Epic 4 story 1 adds the second game (ADR-0016): a quiet level control,
 * the playing-set selector writing map/model.json (ADR-0013), and the
 * interaction-mode gate suspending the plane's own gestures while the selector
 * is open.
 *
 * Epic 6 story 1 binds zoom to the game (ADR-0018): the ZOOM BAND is the game at
 * runtime, and `workspace.yml`'s `level` key is the resume hint in a strict
 * handoff. A settled zoom crossing (d3's `end`) and a deliberate jump both
 * write the key through ONE queued trigger (`workspace/levelHandoff.ts`); on
 * open the key sets the camera into its band and nothing is written. The level
 * control is the indicator of the derived game and the jumper between bands;
 * every camera intent stays inside the band it began in.
 */
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const { camera, intents } = useCamera();
  // The running game (ADR-0018): the zoom band is the level at runtime. This
  // state follows the band as the handoff samples it — a settled crossing or a
  // deliberate jump. The workspace's `level` key is only the resume hint, read
  // on open; it never sets this state by itself.
  const [level, setLevel] = useState<Level>(DEFAULT_LEVEL);
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
    loops,
    malformedLoops,
    orphanLoops,
    assumptions,
    malformedAssumptions,
    duplicateAssumptions,
    orphanAssumptions,
    pointers,
    malformedPointers,
    duplicatePointers,
    orphanPointers,
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
    createLoop,
    renameLoop,
    removeLoop,
    addAssumption,
    reviseAssumption,
    removeAssumption,
    addPointer,
    editPointer,
    removePointer,
    togglePointerMark,
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
  // Loop authoring (story 3): the path gesture's session (null = not arming),
  // and the loop whose walk is open (null = no walk).
  const [pathSession, setPathSession] = useState<PathSession | null>(null);
  const [walkSlug, setWalkSlug] = useState<string | null>(null);
  // The open assumption overlay (story 4): the target it speaks about and the
  // world point it hangs off, or null. One overlay at a time, rendered here at
  // App level so it never grows a word's box or shifts a wire's anchors.
  const [assumptionAt, setAssumptionAt] = useState<{
    target: AssumptionTarget;
    anchor: Point;
  } | null>(null);
  // The open pointer chooser (Epic 5 story 1, ground only): the word it speaks
  // about and the world point it hangs off, or null. One chooser at a time,
  // rendered here at App level so it never grows a word's box.
  const [pointerAt, setPointerAt] = useState<{
    on: string;
    anchor: Point;
  } | null>(null);
  // The word the chooser belongs to, kept for the focus return after it closes
  // (the chooser's own state goes with it).
  const pointerSlugRef = useRef<string | null>(null);
  // The open window (Epic 5 story 2, code name peek): the authored pointer it
  // speaks about, its word and the world point it hangs off, or null. ONE at a
  // time; opening it closes the chooser (one live surface). It is a SNAPSHOT of
  // the open moment — reopening is how it refreshes — and it is rendered here
  // so it never grows a word's box or shifts a wire's anchor.
  const [peekAt, setPeekAt] = useState<{
    on: string;
    pointer: Pointer;
    anchor: Point;
  } | null>(null);
  // The word the window belongs to, kept for the focus return after it closes.
  const peekSlugRef = useRef<string | null>(null);
  // A workspace that resumed in dynamics with no set prompts the selector once.
  const autoPromptedRef = useRef<string | null>(null);

  /** Open the quiet assumption overlay for one target at a world anchor. */
  const openAssumptions = useCallback(
    (target: AssumptionTarget, anchor: Point) => {
      setAssumptionAt({ target, anchor });
    },
    [],
  );

  const closeAssumptions = useCallback(() => setAssumptionAt(null), []);

  /**
   * Close the window WITHOUT moving focus: a rename, a removal, a level switch
   * or an atomic patch's reload may take its word (or its line) away, and
   * focusing a handle that is gone would be a lie. The dismissal paths use
   * `closePeek`, which returns focus to the word's reach handle.
   */
  const closePeekQuietly = useCallback(() => {
    peekSlugRef.current = null;
    setPeekAt(null);
  }, []);

  /**
   * Open the quiet pointer chooser for one word (ground, story 1). Opening it
   * arms the interaction-mode gate (the `pointer` mode), so word presses, pan
   * and creation stand still while it is the only live surface.
   */
  const openPointers = useCallback(
    (on: string, anchor: Point) => {
      // The chooser is the only live surface while it is open (the gate arms):
      // a creation menu or a grow field left open behind it would stand still
      // and be unreachable, so both close here. A window open on another line
      // closes too: one transient at a time.
      setMenuAt(null);
      setGrowAt(null);
      closePeekQuietly();
      pointerSlugRef.current = on;
      setPointerAt({ on, anchor });
    },
    [closePeekQuietly],
  );

  /**
   * Close the chooser, then put focus back on the word that opened it (its
   * reach handle is the word's focusable slot). A level SWITCH closes without
   * that focus: the word may carry no handle in the next game, so the switch
   * puts focus on the level control instead (ADR-0016's amendment).
   */
  const closePointers = useCallback((reason: ChooserCloseReason = "dismiss") => {
    const slug = pointerSlugRef.current;
    pointerSlugRef.current = null;
    setPointerAt(null);
    const target = focusAfterChooserClose(reason);
    if (target === "word" && slug === null) return;
    const selector = chooserFocusSelector(target, slug);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(selector)?.focus();
    });
  }, []);

  /**
   * Close the chooser WITHOUT moving focus — used when the word it speaks
   * about is renamed or removed in the same move (its handle may be gone), and
   * by a level switch, which focuses the level control itself.
   */
  const closePointersQuietly = useCallback(() => {
    pointerSlugRef.current = null;
    setPointerAt(null);
  }, []);

  /**
   * Close the overlay if it speaks about this target — called when a rename or
   * a removal invalidates the target's address, so an open overlay can never
   * write a claim about something the same move removed.
   */
  const closeAssumptionsFor = useCallback((target: AssumptionTarget) => {
    setAssumptionAt((current) =>
      current && assumptionTargetKey(current.target) === assumptionTargetKey(target)
        ? null
        : current,
    );
  }, []);

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

  // Which targets carry at least one assumption (story 4) — one hollow diamond
  // each, however many claims sit on it; the diamond's presence, never a count.
  const assumptionTargets = useMemo(
    () =>
      new Set(
        targetsWithAssumptions(assumptions).map(assumptionTargetKey),
      ),
    [assumptions],
  );

  // Bare spots carrying assumptions: each needs its own quiet diamond on the
  // plane (a word's, a link's and a loop's ride in their own rows).
  const spotAssumptionTargets = useMemo(
    () =>
      targetsWithAssumptions(assumptions).filter(
        (
          target,
        ): target is Extract<AssumptionTarget, { type: "spot" }> =>
          target.type === "spot",
      ),
    [assumptions],
  );

  // The open overlay's lines, in FILE ORDER, recomputed from the records so a
  // revise/removal (and an edit-convergence drop) shows in the same breath.
  const assumptionPanel = useMemo(() => {
    if (!assumptionAt) return null;
    return {
      ...assumptionAt,
      lines: findAssumptions(assumptions, assumptionAt.target),
    };
  }, [assumptionAt, assumptions]);

  // The open pointer chooser's rows, in FILE ORDER, recomputed from the
  // records so an add/edit/remove shows in the same breath.
  const pointerPanel = useMemo(() => {
    if (!pointerAt) return null;
    return { ...pointerAt, rows: findPointers(pointers, pointerAt.on) };
  }, [pointerAt, pointers]);

  /**
   * Open one pointer's window (Epic 5 story 2): a read-only glimpse of the open
   * moment, anchored at the reach handle's world point (beside its word). ONE
   * at a time — opening replaces any window — and the chooser closes, so the
   * window is the live surface. The pointer line keeps its authored form and
   * verbatim value; nothing here interprets the target (World B).
   */
  const openPeek = useCallback(
    (pointer: Pointer) => {
      const anchor = pointerAt?.anchor ?? { x: 0, y: 0 };
      setMenuAt(null);
      setGrowAt(null);
      setAssumptionAt(null);
      peekSlugRef.current = pointer.on;
      setPeekAt({ on: pointer.on, pointer, anchor });
      closePointersQuietly();
    },
    [pointerAt, closePointersQuietly],
  );

  /**
   * Close the window and return focus to its word's reach handle (the window is
   * its word's). A level SWITCH never focuses a word: the switch puts focus on
   * the level control itself, exactly as the chooser's close does.
   */
  const closePeek = useCallback((reason: PeekCloseReason = "dismiss") => {
    const slug = peekSlugRef.current;
    peekSlugRef.current = null;
    setPeekAt(null);
    const selector = peekFocusSelector(focusAfterPeekClose(reason), slug);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(selector)?.focus();
    });
  }, []);

  /**
   * Close the window if it speaks about this word — the `closeAssumptionsFor`
   * mirror. A renamed word's slug changes and a removed word is gone, so the
   * window can never outlive the address it was opened on.
   */
  const closePeekFor = useCallback((on: string) => {
    if (peekSlugRef.current !== on) return;
    peekSlugRef.current = null;
    setPeekAt(null);
  }, []);

  // A window is a snapshot of ONE authored line: if that line is removed (or
  // rewritten by an atomic patch's reload), there is nothing left to speak
  // about, so the window closes quietly rather than showing a stale reach.
  useEffect(() => {
    if (peekAt === null) return;
    if (pointers.some((pointer) => pointer === peekAt.pointer)) return;
    closePeekQuietly();
  }, [peekAt, pointers, closePeekQuietly]);

  // The open pointer marks' keys: byte-identical hand duplicates share a key,
  // so every row on that reach reads marked (a presence, never a count).
  const pointerMarkedKeys = useMemo(() => markedPointerKeys(marks), [marks]);

  // Which words carry at least one marked pointer line — the reach handle's
  // small ring cue, one cue per word, never a tally.
  const wordsWithMarkedPointer = useMemo(() => {
    const owners = new Set<string>();
    for (const pointer of pointers) {
      if (isPointerMarked(pointer, pointerMarkedKeys)) owners.add(pointer.on);
    }
    return owners;
  }, [pointers, pointerMarkedKeys]);

  // Every coined word's slug: the read's "is this path word on the map?".
  const wordSlugs = useMemo(
    () =>
      new Set(
        refs
          .map((ref) => ref.slug)
          .filter((slug): slug is string => slug !== null),
      ),
    [refs],
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

  // The interaction-mode gate (ADR-0016): the selector, the pending sign choice
  // and story 3's path collection are the armed gestures. While the path arm is
  // live the words' own presses stand still, the plane does not pan and the
  // creation menu cannot open — the path layer is the only live surface.
  const signPending = level === "dynamics" && connect !== null && connect.to !== undefined;
  const gestureMode: GestureMode =
    pointerAt !== null
      ? "pointer"
      : selectorOpen
        ? "selector"
        : signPending
          ? "sign-choice"
          : pathSession !== null
            ? "path"
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

  /**
   * The stored loops' quiet routes (Level 2 only, story 3): one closed polyline
   * per loop through its words in path order, staggered by the loop's rank in
   * the file so overlapping cycles stay distinct. A route needs every path word
   * on the map (a missing one has no place on the plane — the notice strip names
   * it, and the walk names it per step); an unclosed hand-edited path draws no
   * route either, for the same reason a rotation would change its walks.
   */
  const loopRoutes = useMemo(() => {
    if (level !== "dynamics") return [];
    const bySlug = new Map(selectorWords.map((word) => [word.slug, word]));
    const routes: Array<{ loop: Loop; points: Point[]; nameAt: Point }> = [];
    loops.forEach((loop, rank) => {
      if (!isClosedPath(loop.path)) return;
      const visits: Array<{ center: Point; box: Box }> = [];
      for (const slug of loop.path.slice(0, -1)) {
        const word = bySlug.get(slug);
        if (!word) return;
        visits.push({ center: centerOf(word.pos, word.box), box: word.box });
      }
      if (visits.length === 0) return;
      const points = loopRoutePoints(visits, rank * LOOP_ROUTE_STAGGER);
      if (points.length < 3) return;
      routes.push({ loop, points, nameAt: routeCenter(points) });
    });
    return routes;
  }, [level, loops, selectorWords]);

  /**
   * The open loop's walk — DERIVED on every render from the records, never
   * stored: a flipped sign or a cast mark changes the read in the same breath
   * (ADR-0015). Null when no walk is open or the loop is gone.
   */
  const walkRead = useMemo(() => {
    if (level !== "dynamics" || walkSlug === null) return null;
    const loop = findLoop(loops, walkSlug);
    if (!loop) return null;
    return readLoop(loop, { links, marks, model, words: wordSlugs });
  }, [level, walkSlug, loops, links, marks, model, wordSlugs]);

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
    setPathSession(endPathSession());
    setAssumptionAt(null);
    closePointersQuietly();
    closePeekQuietly();
    cancelConnect();
  }, [cancelConnect, closePointersQuietly, closePeekQuietly]);

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
   * The switch path (ADR-0016's amendment, ADR-0018 decision 1): a settled band
   * crossing or a deliberate jump closes every transient, ends the walk and
   * settles focus. A crossing caused by the WHEEL never yanks focus to the
   * control (ADR-0018 decision 5 — the person is scrolling, not reaching for
   * it); a deliberate jump is the control's own act, so focus returns there. An
   * open-restore runs no switch path: on open there is no transient to close.
   *
   * Only a deliberate entry asks for a playing set. A wheel crossing into
   * dynamics with no set does not prompt (story 2 names the cost: the set stays
   * required at authoring, and the control's "edit the playing set" is there).
   */
  const switchLevel = useCallback(
    (next: Level, cause: HandoffCause) => {
      setLevel(next);
      if (cause === "restore") return;
      cancelPendingGestures();
      setWalkSlug(null);
      if (cause === "jump") closePointers("switch-level");
      else closePointersQuietly();
      if (cause === "jump" && next === "dynamics" && model === null) {
        openSelector();
      }
    },
    [
      cancelPendingGestures,
      closePointers,
      closePointersQuietly,
      model,
      openSelector,
    ],
  );

  /**
   * Move the camera INTO a band, keeping the view's centre in place: the jump
   * intent the level control and the open-restore share. No recentre (no world
   * point is brought to the centre) and no position yank (position is never
   * persisted); the landing zoom is the band's own.
   */
  const moveCameraToBand = useCallback(
    (next: Level) => {
      const el = document.querySelector<HTMLDivElement>(".plane");
      intents.setZoomBand(
        next,
        el ? el.clientWidth / 2 : undefined,
        el ? el.clientHeight / 2 : undefined,
      );
    },
    [intents],
  );

  // The strict handoff (ADR-0018 decision 2) owns the running level and the
  // key's ONE write queue, so it is created once. Its three callbacks read the
  // app's latest values through this ref, so no stale closure can ever write an
  // old workspace path or skip a transient close; the queue itself survives
  // every render.
  const handoffDeps = useRef<LevelHandoffDeps>({
    onSwitch: () => undefined,
    moveCamera: () => undefined,
    save: async () => undefined,
  });
  handoffDeps.current = {
    onSwitch: switchLevel,
    moveCamera: moveCameraToBand,
    save: async (next) => {
      if (workspace) await saveWorkspaceLevel(workspace.path, next);
    },
  };
  const handoffRef = useRef<LevelHandoff | null>(null);
  if (handoffRef.current === null) {
    handoffRef.current = createLevelHandoff(DEFAULT_LEVEL, {
      onSwitch: (next, cause) => handoffDeps.current.onSwitch(next, cause),
      moveCamera: (next) => handoffDeps.current.moveCamera(next),
      save: (next) => handoffDeps.current.save(next),
    });
  }
  const handoff = handoffRef.current;

  /**
   * Open-restore (ADR-0018 decision 2): the resume hint sets the camera into its
   * band on open. It NEVER writes — a hand-edited key is honored here and
   * rewritten only on the first settled crossing. A layout effect, so the first
   * painted frame is already the resumed band (no concept flash before ground).
   */
  const restoredRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!workspace || restoredRef.current === workspace.path) return;
    restoredRef.current = workspace.path;
    handoff.restore(workspace.resumeLevel);
  }, [workspace, handoff]);

  /** A zoom gesture settled: derive the band; a crossing switches and writes. */
  const handleZoomSettle = useCallback(
    (zoom: number) => handoff.settle(zoom),
    [handoff],
  );

  /**
   * Arm the path gesture: the level control's "coin a loop" (story 3). Opening
   * it cancels any other pending gesture, and the gate's `path` mode suspends
   * word presses, pan and creation while the words are clicked in order.
   */
  const beginLoop = useCallback(() => {
    cancelPendingGestures();
    setPathSession(beginPathSession());
  }, [cancelPendingGestures]);

  /** One word click in the path layer: collect it, or close at the first. */
  const pickPathWord = useCallback((slug: string) => {
    setPathSession((session) => (session ? clickPathWord(session, slug) : session));
  }, []);

  /** Esc (or leaving the gesture): the whole session goes, nothing is written. */
  const cancelPath = useCallback(() => {
    setPathSession(endPathSession());
  }, []);

  /**
   * The coin field's Enter: one line in `map/loops.jsonl`, path rotated
   * canonically (ADR-0015 decision 5). The loop is a claim about the path, not
   * a change to the playing set — a path word outside play stays a gap the walk
   * names (ADR-0013 decision 4).
   */
  const commitLoop = useCallback(
    (name: string) => {
      if (!pathSession || pathSession.kind !== "naming") return;
      createLoop(name, pathSession.path);
      setPathSession(null);
    },
    [pathSession, createLoop],
  );

  /** Open a loop's walk — the route or the coined name is the only trigger. */
  const openWalk = useCallback((slug: string) => setWalkSlug(slug), []);
  const closeWalk = useCallback(() => setWalkSlug(null), []);

  // Esc cancels loop authoring entirely: the collected path and the coin field
  // go and nothing is written (ADR-0016's gate spells the gesture's ends).
  useEffect(() => {
    if (pathSession === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setPathSession(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pathSession]);

  /**
   * Where the coin field asks for the loop's name: the middle of the path just
   * walked (the route's own middle, so the field sits where the loop will).
   */
  const pathCoinAt = useMemo<Point | null>(() => {
    if (pathSession === null || pathSession.kind !== "naming") return null;
    const bySlug = new Map(selectorWords.map((word) => [word.slug, word]));
    const visits: Array<{ center: Point; box: Box }> = [];
    for (const slug of pathSession.path.slice(0, -1)) {
      const word = bySlug.get(slug);
      if (!word) return null;
      visits.push({ center: centerOf(word.pos, word.box), box: word.box });
    }
    if (visits.length === 0) return null;
    return routeCenter(loopRoutePoints(visits));
  }, [pathSession, selectorWords]);

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

  /**
   * The menu's Level 2 THIRD kind (story 4, ADR-0011's open decision): state an
   * assumption about this bare spot. The quiet overlay opens right here with
   * its field ready; nothing is written until Enter.
   */
  const chooseAssumption = useCallback(() => {
    const spot = menuAt;
    if (!spot) return;
    setMenuAt(null);
    openAssumptions(
      { type: "spot", x: spot.x, y: spot.y },
      { x: spot.x + 22, y: spot.y },
    );
  }, [menuAt, openAssumptions]);

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
    if (workspace.resumeLevel !== "dynamics" || model !== null) return;
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
        creationHint={
          level === "dynamics"
            ? "double-click: word, lack or assumption"
            : undefined
        }
        lassoArmed={selectorOpen && lassoArmed}
        picking={markDrag.ghost !== null}
        onLasso={handleLasso}
        onZoomSettle={handleZoomSettle}
      >
        {/* the shelf's fold and margin: a place in world space (story 3) */}
        <ShelfFold shelfX={shelfX} />

        {/* stored loops render at Level 2 only (story 3): a quiet closed route
            through each loop's words in path order, beneath the words so it
            hugs them, with the coined name near it. The route or the name opens
            the walk; the name renames on double-click and removes on its ×. */}
        {loopRoutes.map(({ loop, points, nameAt }) => (
          <LoopRoute
            key={`loop-${loopSlug(loop.name)}`}
            loop={loop}
            points={points}
            nameAt={nameAt}
            onOpen={() => openWalk(loopSlug(loop.name))}
            onRename={(name) => {
              closeAssumptionsFor({ type: "loop", slug: loopSlug(loop.name) });
              renameLoop(loop, name);
            }}
            onRemove={() => {
              closeAssumptionsFor({ type: "loop", slug: loopSlug(loop.name) });
              if (walkSlug === loopSlug(loop.name)) closeWalk();
              removeLoop(loop);
            }}
            hasAssumptions={assumptionTargets.has(
              assumptionTargetKey({ type: "loop", slug: loopSlug(loop.name) }),
            )}
            onOpenAssumptions={(anchor) =>
              openAssumptions(
                { type: "loop", slug: loopSlug(loop.name) },
                anchor,
              )
            }
          />
        ))}

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

        {/* bare-spot assumptions (story 4): one quiet diamond per spot that
            carries a claim; pressing it opens the quiet overlay. Level 2 only. */}
        {level === "dynamics" &&
          spotAssumptionTargets.map((spot) => (
            <AssumptionDiamond
              key={`assumption-spot-${spot.x}-${spot.y}`}
              has
              className="assumption-spot"
              style={{ left: spot.x, top: spot.y }}
              onPress={() =>
                openAssumptions(
                  { type: "spot", x: spot.x, y: spot.y },
                  { x: spot.x + 22, y: spot.y },
                )
              }
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
            onRename={(candidate, newName) => {
              // A reference rename rewrites assumption targets for the word
              // and its links in one batch: any open overlay may speak about
              // an address that batch just changed, so it closes here. The
              // pointer chooser speaks about the word by slug, which the same
              // batch rewrites, so it closes too (quietly: focus would land on
              // a handle whose word is moving).
              closeAssumptions();
              closePointersQuietly();
              if (candidate.slug !== null) closePeekFor(candidate.slug);
              rename(candidate, newName);
            }}
            onRemove={(candidate) => {
              // Removing a word can drop its links and loops, and with them
              // their assumption lines: the open overlay may be about any of
              // them, so it closes before the batch runs. The pointer chooser
              // goes with the word's pointer lines (die-with-target).
              closeAssumptions();
              closePointersQuietly();
              if (candidate.slug !== null) closePeekFor(candidate.slug);
              remove(candidate);
            }}
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
            showAssumptions={level === "dynamics"}
            hasAssumptions={
              word.slug !== null &&
              assumptionTargets.has(
                assumptionTargetKey({ type: "word", slug: word.slug }),
              )
            }
            onOpenAssumptions={(anchor) => {
              if (word.slug === null) return;
              openAssumptions({ type: "word", slug: word.slug }, anchor);
            }}
            showReach={level === "ground"}
            reachMarked={
              word.slug !== null && wordsWithMarkedPointer.has(word.slug)
            }
            onOpenPointers={(anchor) => {
              if (word.slug === null) return;
              openPointers(word.slug, anchor);
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
                onRemove={() => {
                  closeAssumptionsFor({
                    type: "link",
                    from: link.from,
                    to: link.to,
                  });
                  removeLink(link.from, link.to);
                }}
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
                hasAssumptions={assumptionTargets.has(
                  assumptionTargetKey({
                    type: "link",
                    from: link.from,
                    to: link.to,
                  }),
                )}
                onOpenAssumptions={(anchor) =>
                  openAssumptions(
                    { type: "link", from: link.from, to: link.to },
                    anchor,
                  )
                }
              />
            );
          })}

        {/* loop authoring (story 3): while the path gate is armed, one quiet
            button over each word collects its slug IN ORDER; pressing the
            first word again closes the cycle (a self-loop is A, A). */}
        {pathSession && (
          <PathWords
            words={selectorWords}
            session={pathSession}
            onPick={pickPathWord}
          />
        )}

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

        {/* the loop's coin field after the path closes (story 3): name it or
            esc; nothing is written until Enter */}
        {pathCoinAt && (
          <LoopCoinField
            x={pathCoinAt.x}
            y={pathCoinAt.y}
            onCoin={commitLoop}
            onCancel={cancelPath}
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

        {/* the double-click creation menu: word or lack at Level 1; Level 2
            grows the third kind, assumption, about the bare spot (story 4) */}
        {menuAt && (
          <PlaneMenu
            x={menuAt.x}
            y={menuAt.y}
            kinds={creationKinds(level)}
            onWord={chooseWord}
            onLack={chooseLack}
            onAssumption={chooseAssumption}
            onClose={closePlaneMenu}
          />
        )}

        {/* the assumptions' quiet overlay (story 4), in world space beside its
            target and counter-scaled: the claims in file order, each revisable
            in place and removable, plus the field for a new or rival line. It
            never grows a target's box or shifts a wire's anchor. */}
        {level === "dynamics" && assumptionPanel && (
          <AssumptionOverlay
            anchor={assumptionPanel.anchor}
            lines={assumptionPanel.lines}
            targetLabel={describeAssumptionTarget(assumptionPanel.target)}
            onAdd={(text) => addAssumption(assumptionPanel.target, text)}
            onRevise={(assumption, text) =>
              reviseAssumption(assumption, text)
            }
            onRemove={(assumption) => removeAssumption(assumption)}
            onClose={closeAssumptions}
          />
        )}

        {/* the ground game's quiet pointer chooser (Epic 5 story 1), in world
            space beside its word and counter-scaled: the reaches in FILE ORDER,
            each with its ring, its in-place edit, its open ↗ (story 2: the
            pointer's window) and its ×, plus the add entry whose form pick
            starts UNPICKED (no pick, no write). It never grows a word's box or
            shifts a wire's anchor; opening it arms the `pointer` gate. */}
        {level === "ground" && pointerPanel && (
          <PointerChooser
            anchor={pointerPanel.anchor}
            rows={pointerPanel.rows}
            slug={pointerPanel.on}
            markedKeys={pointerMarkedKeys}
            onAdd={(form, value) => addPointer(pointerPanel.on, form, value)}
            onEdit={(pointer, form, value) =>
              editPointer(pointer, form, value)
            }
            onRemove={(pointer) => removePointer(pointer)}
            onToggleMark={(pointer) => togglePointerMark(pointer)}
            onOpen={(pointer) => openPeek(pointer)}
            onClose={() => closePointers("dismiss")}
          />
        )}

        {/* the ground game's window (Epic 5 story 2, code name peek): ONE at a
            time, world-anchored beside its word and counter-scaled. Identity
            first: the handle verbatim and selectable, then a bounded head with
            "truncated" said plainly — or a quiet "cannot read" + reveal; a url
            shows its handle and the explicit open action. No scroll, no
            drag-select on the head, write-free. Opening it closed the chooser
            (one live surface); Esc / × / click-away / a level switch close it. */}
        {level === "ground" && peekAt && (
          <OutwardWindow
            anchor={peekAt.anchor}
            pointer={peekAt.pointer}
            workspacePath={workspace.path}
            onClose={() => closePeek("dismiss")}
          />
        )}
      </CanvasPlane>

      {/* the quiet level control (ADR-0018): an indicator of the band's game
          and a jumper between bands — the wheel is the other way */}
      <LevelControl
        level={level}
        onJump={(next) => handoff.jump(next)}
        onEditPlayingSet={openSelector}
        onCoinLoop={beginLoop}
      />

      {/* the path gesture's quiet hint (story 3): what the click does and how
          it ends; fixed in screen space, and gone with the session */}
      {pathSession && (
        <PathBar collecting={pathSession.kind === "collecting"} />
      )}

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
        malformedLoops={malformedLoops}
        orphanLoops={orphanLoops}
        malformedAssumptions={malformedAssumptions}
        duplicateAssumptions={duplicateAssumptions}
        orphanAssumptions={orphanAssumptions}
        malformedPointers={malformedPointers}
        duplicatePointers={duplicatePointers}
        orphanPointers={orphanPointers}
      />

      {/* the walk (story 3): the selected loop's derived read — steps, signs,
          named gaps and the verdict only when complete (ADR-0015) */}
      {walkRead && <LoopWalk read={walkRead} onClose={closeWalk} />}

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
  malformedLoops,
  orphanLoops,
  malformedAssumptions,
  duplicateAssumptions,
  orphanAssumptions,
  malformedPointers,
  duplicatePointers,
  orphanPointers,
}: {
  malformed: readonly string[];
  orphans: readonly Mark[];
  malformedLinks: readonly string[];
  orphanLinks: readonly { from: string; to: string }[];
  malformedModel: string | null;
  orphanMembers: readonly string[];
  malformedLoops: readonly string[];
  orphanLoops: readonly string[];
  malformedAssumptions: readonly string[];
  /** Hand-edited duplicate keys: preserved, never deduped (story 4). */
  duplicateAssumptions: readonly Assumption[];
  orphanAssumptions: readonly Assumption[];
  /** Pointers (Epic 5 story 1): unreadable lines, duplicate keys, lost owners. */
  malformedPointers: readonly string[];
  duplicatePointers: readonly Pointer[];
  orphanPointers: readonly Pointer[];
}) {
  if (
    malformed.length === 0 &&
    orphans.length === 0 &&
    malformedLinks.length === 0 &&
    orphanLinks.length === 0 &&
    malformedModel === null &&
    orphanMembers.length === 0 &&
    malformedLoops.length === 0 &&
    orphanLoops.length === 0 &&
    malformedAssumptions.length === 0 &&
    duplicateAssumptions.length === 0 &&
    orphanAssumptions.length === 0 &&
    malformedPointers.length === 0 &&
    duplicatePointers.length === 0 &&
    orphanPointers.length === 0
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
      {orphanLoops.map((slug) => (
        <div className="mark-notice" key={`loop-word-${slug}`}>
          a loop's path names “{slug}” — not on the map, kept in map/loops.jsonl
        </div>
      ))}
      {malformedLoops.map((line, index) => (
        <div className="mark-notice" key={`malformed-loop-${index}`}>
          unreadable line in map/loops.jsonl: {line}
        </div>
      ))}
      {orphanAssumptions.map((assumption, index) => (
        <div className="mark-notice" key={`orphan-assumption-${index}`}>
          an assumption on {describeAssumptionTarget(assumption.target)} — not on
          the map, kept in map/assumptions.jsonl
        </div>
      ))}
      {malformedAssumptions.map((line, index) => (
        <div className="mark-notice" key={`malformed-assumption-${index}`}>
          unreadable line in map/assumptions.jsonl: {line}
        </div>
      ))}
      {duplicateAssumptions.map((assumption, index) => (
        <div className="mark-notice" key={`duplicate-assumption-${index}`}>
          a duplicate assumption line says “{assumption.text}” on{" "}
          {describeAssumptionTarget(assumption.target)} — kept in
          map/assumptions.jsonl
        </div>
      ))}
      {orphanPointers.map((pointer, index) => (
        <div className="mark-notice" key={`orphan-pointer-${index}`}>
          a pointer on “{pointer.on}” — not on the map, kept in
          map/pointers.jsonl
        </div>
      ))}
      {malformedPointers.map((line, index) => (
        <div className="mark-notice" key={`malformed-pointer-${index}`}>
          unreadable line in map/pointers.jsonl: {line}
        </div>
      ))}
      {duplicatePointers.map((pointer, index) => (
        <div className="mark-notice" key={`duplicate-pointer-${index}`}>
          a duplicate pointer line on “{pointer.on}” ({pointer.form}) — kept in
          map/pointers.jsonl
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
    case "link":
      return `the link ${target.from} → ${target.to}`;
    case "spot":
      return "a bare spot";
    case "pointer":
      return `the reach ${target.on} · ${target.form} “${target.value}”`;
  }
}

/** A quiet name for what an assumption is about (notices and the overlay's aria). */
function describeAssumptionTarget(target: AssumptionTarget): string {
  switch (target.type) {
    case "word":
      return `“${target.slug}”`;
    case "link":
      return `the link ${target.from} → ${target.to}`;
    case "loop":
      return `the loop “${target.slug}”`;
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
