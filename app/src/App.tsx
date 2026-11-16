import {
  Fragment,
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
  VeilBar,
  VeilCoinField,
  VeilDraftBox,
  VeilSheet,
} from "./canvas/VeilSheet";
import { VeilLookUnder } from "./canvas/VeilLookUnder";
import {
  focusAfterLookUnderClose,
  lookUnderFocusSelector,
  lookUnderLive,
  veilLive,
  type LookUnderCloseReason,
} from "./canvas/veilRules";
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
import {
  authoringDoorLive,
  authoringLive,
  creationKinds,
  createLevelPin,
  didReleaseFocusPin,
  focusStateOf,
  isGestureArmed,
  NO_FOCUS,
  shouldPinLevel,
  shouldPromptForSet,
  type FocusState,
  type GestureMode,
  type LevelPin,
} from "./canvas/gates";
import { GhostDiamond } from "./canvas/GhostDiamond";
import { GhostList } from "./canvas/GhostList";
import { GhostPanel } from "./canvas/GhostPanel";
import { GhostPreview } from "./canvas/GhostPreview";
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
import { ComparePanel } from "./canvas/ComparePanel";
import { QuantityOverlay } from "./canvas/QuantityOverlay";
import { StepCrank } from "./canvas/StepCrank";
import { useRingDrag } from "./canvas/ringDrag";
import { ReferenceWord } from "./canvas/ReferenceWord";
import { ShelfFold } from "./canvas/ShelfFold";
import { SignChoice } from "./canvas/SignChoice";
import { useCamera } from "./canvas/useCamera";
import { useMap } from "./canvas/useMap";
import { useStepRun } from "./canvas/useStepRun";
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
import {
  describeAssumptionTarget,
  describeMarkTarget,
  describeQuantityTarget,
  noticeGroups,
  type NameOf,
  type NoticeFamily,
} from "./canvas/notices";
import { outOfPlay, prefilledSelection } from "./map/model";
import { findPointers, type Pointer } from "./map/pointers";
import {
  findQuantity,
  quantityTargetKey,
  type Quantity,
  type QuantityTarget,
} from "./map/quantities";
import { recordsDirOf } from "./map/records";
import type { Reference } from "./map/refs";
import {
  coveredWordSlugs,
  findVeil,
  veilKey,
  type Veil,
  type VeilBox,
} from "./map/veils";
import { activeModelKey, type StepModel } from "./map/step";
import {
  packetWordOf,
  type PacketView,
  type PacketWord,
} from "./ghost/packet";
import type { GhostTarget } from "./ghost/envelope";
import { previewPoint } from "./ghost/preview";
import { useGhostRequest } from "./ghost/useRequest";
import { useGhosts } from "./ghost/useGhosts";
import {
  DEFAULT_SHELF_X,
  foldExtent,
  isShelved,
  rejectSpot,
} from "./map/shelf";
import { cueShownIn } from "./canvas/presenceRules";
import { linkWiresVisible } from "./canvas/zoomBands";
import { createWriteQueue, type WriteQueue } from "./lib/writeQueue";
import {
  createScenario,
  listScenarios,
  retireScenario,
  type Scenario,
} from "./scenarios/branch";
import {
  resolveActiveScenario,
  saveWorkspaceScenario,
} from "./scenarios/active";
import {
  createScenarioHandoff,
  type ScenarioCause,
  type ScenarioHandoff,
  type ScenarioHandoffDeps,
} from "./scenarios/handoff";
import {
  comparisonFrame,
  comparisonOf,
  type CompareRefusal,
  type Comparison,
} from "./scenarios/compare";
import {
  loadCommittedRecords,
  readComparisonSource,
  saveCommittedRecord,
  type CommittedRecords,
} from "./scenarios/compareRead";
import {
  deliberateEdit,
  type BridgeActions,
  type BridgeMove,
} from "./scenarios/bridge";
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
 *
 * Epic 6 story 2 pins the level (ADR-0018 decision 3): while a gesture is ARMED
 * or a TEXT FIELD has focus, a wheel crossing moves the camera and nothing
 * else — no armed surface closes and typed text survives (the gate's pure
 * `shouldPinLevel` / `createLevelPin`). The pin's release (blur, commit,
 * cancel, the gesture's end) re-derives the band from the zoom the camera ended
 * on, and a real crossing then runs the full switch path. The selector's prompt
 * is the pure `shouldPromptForSet`: a DELIBERATE entry asks for a missing
 * playing set, a wheel crossing never does.
 *
 * Epic 8 story 2 adds THE BRANCH (ADR-0021): a scenario is a NAMED BRANCH of
 * the dynamics model — `scenarios/<slug>/` at the workspace root with
 * byte-copies of the model's three variant-owned records and every committed
 * assumption pinned. The level control's dynamics section grows the quiet
 * chooser; while a branch runs the map's three variant records read and write
 * in its folder and everything else stays the committed model's. The switch
 * runs the FULL switch path (transients close, gestures cancel, the walk
 * closes, the level pin is released), and `workspace.yml`'s `scenario` key is
 * only the resume hint that switch writes — opening never writes it.
 *
 * Epic 8 story 3 adds THE STEP (ADR-0022): a hand-cranked, per-piece gated
 * reading of the ACTIVE model's quantities — one simultaneous move from the
 * opening amounts, file order clamping loudly, the world named where a stock
 * line is absent, and per-word running amounts plus the last delta. The run is
 * EPHEMERAL (the `useStepRun` hook): an active-model edit or a branch switch
 * resets it, a committed-only edit and a zoom/level switch do not, and
 * stepping writes nothing. The crank sits outside `.plane` beside the level
 * control; its notes are step-scoped.
 *
 * Epic 8 story 4 adds THE COMPARISON and the return move (ADR-0021 §7 amended):
 * one EXPLICITLY picked branch is read against the committed model in a frozen
 * two-value reading — the union of the set members, the link lines and the
 * quantity lines, each row one provenance sentence ("branch (authored): … /
 * committed (now): …"), absence as "no line", never a delta and never an
 * equality claim, with the standing drift line and the branch's dangling
 * premises said once, in the present tense. The reading is frozen at the pick
 * and refreshed only by a quiet re-read — a reading resets nothing, so the
 * branch's run survives it. Beside each row stand the bridge's doors: the
 * family's ORDINARY deliberate edits of the COMMITTED model (author or replace
 * an amount, remove a line, draw/flip/remove a sign, join/prune a word, revise
 * a claim) — never an "apply the branch" verb, and never a write to the branch:
 * that is why a committed edit never resets the run (ADR-0022's amendment). A
 * frame of two branches is refused with a word (no shared base), and a dangling
 * premise clears only by branching again.
 *
 * Epic 9 story 1 adds THE VEIL (ADR-0023): a named cover over a rectangle of
 * Levels 1–2. The level control's "veil" door arms the gate's own `veil` mode —
 * a SEPARATE arm from the selector's lasso, level-uniform, so the box drag works
 * at concept and dynamics alike — and the plane reports the captured BOX (never
 * the stroke). The box then waits for the person's name and reason; Enter writes
 * one line in `map/veils.jsonl`. The cover is a RENDER-TIME region test and
 * nothing else: a word is covered iff its CENTRE is inside a box, it is set
 * aside by its own class (visibility only — its mark and its standing are
 * exactly what they were), the sheet owns its presses, sheets stack in file
 * order, wires cross through, and at ground no sheet renders at all. Retiring a
 * veil deletes its line; a word's rename or removal never touches it.
 *
 * Epic 9 story 2 adds THE LOOK-UNDER and the ground gate (ADR-0023 decisions
 * 2–3). A quiet press on a sheet (or Enter/Space while it has focus) opens a
 * READ-ONLY transient beside the veil's right edge, counter-scaled by the
 * camera (the window idiom): the veil's coined name and its reason VERBATIM
 * (World B — prose, never parsed). While it is open that one veil's cover is
 * LIFTED — the sheet goes transparent and the words IT covers read normally,
 * each keeping its own quiet (a marked word stays ghosted and dashed; a marked
 * wire stays dashed) and the covered prop underneath is unchanged — and those
 * revealed words take NO press, because covered content is edited by retiring
 * the veil to work there. Esc, the quiet ×, a press away or a level switch close
 * it (the window's idioms); the switch closes it through the one switch path.
 * The GROUND GATE is one reading: `veilLive` gates the sheet, the covered set
 * and the look-under alike, so at ground nothing is covered and no look-under
 * opens through the veil — there the game switch IS the look-under, the
 * person's own move.
 *
 * Epic 10 story 3 adds the GHOST's verbs and surface (ADR-0024/0026): the
 * quiet list of held proposals (TEXT only, in arrival order — a held ghost
 * draws NOTHING on the map), the preview the person OPENS (the read-only
 * derived steps, the why, the faint diamond at the target, and the two verbs),
 * reshape (the params and a reason of the person's own; the deriver re-derives
 * the steps; the five fields stay in flight only), ACCEPT (the only apply:
 * marker, apply, release, delete — the crash story is the session's) and
 * REJECT (delete). The ask surface is the minimal wiring of the quiet request
 * and the intake; ONE ghost is open at a time. Provisional: the looks.
 *
 * Epic 7 story 1 makes the playing set structurally required at AUTHORING: the
 * gate's `authoringLive` guards the three dynamics writers (a link, a loop, an
 * assumption) and echoes at the three affordances that would arm them, so with no
 * accepted set those doors are dead and accepting a set re-opens them. An open
 * selector owns the interaction, so all three doors die there too: the plane's
 * armed gate covers the two inside it, and `authoringDoorLive` covers the
 * control's "coin a loop", which sits outside `.plane`. While the selector is
 * open the plane renders the DRAFT (`outOfPlay` in model.ts), so a word clicked
 * back in is readable before close.
 */
function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const { camera, intents } = useCamera();
  // The running game (ADR-0018): the zoom band is the level at runtime. This
  // state follows the band as the handoff samples it — a settled crossing or a
  // deliberate jump. The workspace's `level` key is only the resume hint, read
  // on open; it never sets this state by itself.
  const [level, setLevel] = useState<Level>(DEFAULT_LEVEL);
  // Story 2's pin, focus half (ADR-0018 decision 3): a TEXT FIELD holding focus
  // pins the level exactly like an armed gesture, so a wheel crossing can never
  // close the field or discard what is being typed. The reading is the
  // document's own (below), so no field has to know about levels; it is a ref
  // because focus is a fact about the document, not a rendering input.
  const focusStateRef = useRef<FocusState>(NO_FOCUS);
  // The camera's latest zoom, for the settle path and the pin's release (no
  // listener is re-attached on every wheel tick).
  const cameraZoomRef = useRef(camera.zoom);
  cameraZoomRef.current = camera.zoom;
  // The running BRANCH (ADR-0021, Epic 8 story 2): null is the committed model.
  // The map's three variant records read and write in that branch's folder; the
  // app's one restore reads `workspace.yml`'s `scenario` hint once on open.
  const [scenario, setScenario] = useState<string | null>(null);
  // The branch folders on disk, read on open and after the chooser's moves.
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const map = useMap(workspace?.path ?? "", { level, scenario });
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
    ghostMembers,
    loops,
    malformedLoops,
    orphanLoops,
    veils,
    malformedVeils,
    assumptions,
    malformedAssumptions,
    duplicateAssumptions,
    orphanAssumptions,
    pointers,
    malformedPointers,
    duplicatePointers,
    orphanPointers,
    quantities,
    malformedQuantities,
    duplicateQuantities,
    orphanQuantities,
    outOfPlayQuantities,
    loaded,
    reload,
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
    createVeil,
    renameVeil,
    removeVeil,
    addAssumption,
    reviseAssumption,
    removeAssumption,
    setQuantity,
    removeQuantity,
    addPointer,
    editPointer,
    removePointer,
    togglePointerMark,
  } = map;

  // The step's run (Epic 8 story 3, ADR-0022): an EPHEMERAL read of the ACTIVE
  // model, held in memory and never written. The key is the model's identity —
  // the records folder (a branch switch is a new model, even between identical
  // copies) plus the playing set, the links and the quantities. A different key
  // resets the run, so an active-model edit or a scenario switch resets it
  // while a committed-only edit, a zoom and a level switch leave it standing.
  const stepRecordsDir = recordsDirOf(workspace?.path ?? "", scenario);
  const stepModel = useMemo<StepModel>(
    () => ({ words: model?.words ?? null, quantities, links }),
    [model, quantities, links],
  );
  const stepKey = useMemo(
    () => activeModelKey(stepRecordsDir, model, links, quantities),
    [stepRecordsDir, model, links, quantities],
  );
  const step = useStepRun(stepModel, stepKey);

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
  // The veil's draw-box (Epic 9 story 1, ADR-0023): its own arm — never the
  // selector's lasso — plus the box it captured, which waits for the name and
  // reason. The gate's `veil` mode is armed while either is live.
  const [veilArmed, setVeilArmed] = useState(false);
  const [veilBox, setVeilBox] = useState<VeilBox | null>(null);
  // The look-under (Epic 9 story 2, ADR-0023 decision 3): the veil whose cover
  // is LIFTED for a read-only reading of its name and reason, addressed by its
  // natural key (or null). The record itself is derived from `veils` on every
  // render, so a rename reads at once and a retired line closes the transient
  // quietly — the card can never outlive the veil it speaks about.
  const [lookUnderKey, setLookUnderKey] = useState<string | null>(null);
  // Loop authoring (story 3): the path gesture's session (null = not arming),
  // and the loop whose walk is open (null = no walk).
  const [pathSession, setPathSession] = useState<PathSession | null>(null);
  const [walkSlug, setWalkSlug] = useState<string | null>(null);
  // The comparison (Epic 8 story 4): the branch picked THIS session (an
  // explicit pick — never the resume hint), the FROZEN reading taken when it
  // was picked, and the frame's refusal. A reading holds no run state: opening,
  // closing and re-reading reset nothing (ADR-0022's reset amendment).
  const [compareOpen, setCompareOpen] = useState(false);
  const [comparePick, setComparePick] = useState<string | null>(null);
  const [comparison, setComparison] = useState<Comparison | null>(null);
  const [compareRefusal, setCompareRefusal] = useState<CompareRefusal | null>(
    null,
  );
  // The committed model's three variant records as the bridge reads and writes
  // them (the panel's open and re-read refresh this); and the in-order chain
  // of its one-record writes, so two presses can never interleave.
  const committedRecordsRef = useRef<CommittedRecords | null>(null);
  const committedWriteRef = useRef<Promise<void>>(Promise.resolve());
  // The open assumption overlay (story 4): the target it speaks about and the
  // world point it hangs off, or null. One overlay at a time, rendered here at
  // App level so it never grows a word's box or shifts a wire's anchors.
  const [assumptionAt, setAssumptionAt] = useState<{
    target: AssumptionTarget;
    anchor: Point;
  } | null>(null);
  // The open amount card (Epic 8 story 1, ADR-0020): the stock/flow target it
  // speaks about and the world point it hangs off, or null. One card at a time,
  // rendered here at App level so it never grows a word's box or a link head.
  const [quantityAt, setQuantityAt] = useState<{
    target: QuantityTarget;
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
  // The ghost's ask surface (Epic 10 story 3): the one panel where the person
  // asks for a packet or hands a model's reply back. It sits outside `.plane`
  // like the control's other actions; closed by Esc, its ×, or a level switch
  // (never by a press away: it can hold typed prose).
  const [ghostPanelOpen, setGhostPanelOpen] = useState(false);
  // A workspace that resumed in dynamics with no set prompts the selector once.
  const autoPromptedRef = useRef<string | null>(null);

  /**
   * Open the quiet assumption overlay for one target at a world anchor. Dead
   * while authoring is inert (Epic 7 story 1): at dynamics with no accepted set
   * no claim can be authored, so the diamond never opens a field whose Enter
   * would write nothing. This is the seam's arming-time ECHO; `addAssumption`
   * enforces the same rule before its write.
   */
  const openAssumptions = useCallback(
    (target: AssumptionTarget, anchor: Point) => {
      if (!authoringLive(level, model)) return;
      // One quiet card at a time in dynamics: the amount card yields.
      setQuantityAt(null);
      setAssumptionAt({ target, anchor });
    },
    [level, model],
  );

  const closeAssumptions = useCallback(() => setAssumptionAt(null), []);

  /**
   * Open the quiet amount card for one quantity target (Epic 8 story 1). Dead
   * while authoring is inert (Epic 7 story 1's seam): at dynamics with no
   * accepted set no amount can be authored, so the glyph never opens a field
   * whose Enter would write nothing. This is the seam's arming-time ECHO;
   * `setQuantity` enforces the same rule before its write. Opening it closes
   * the assumption overlay — one quiet card at a time.
   */
  const openQuantity = useCallback(
    (target: QuantityTarget, anchor: Point) => {
      if (!authoringLive(level, model)) return;
      setAssumptionAt(null);
      setQuantityAt({ target, anchor });
    },
    [level, model],
  );

  const closeQuantity = useCallback(() => setQuantityAt(null), []);

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

  // Which quantity targets carry a line (Epic 8 story 1) — the word's stock
  // glyph and the pair's flow glyph read presence, never a number. One Set,
  // never a tally, and the lines themselves stay in the file.
  const quantityTargets = useMemo(
    () => new Set(quantities.map((quantity) => quantityTargetKey(quantity))),
    [quantities],
  );

  /**
   * A word's quiet STOCK quantity view at Level 2, or undefined elsewhere (the
   * honest partition: Level 1 renders no glyph and no card). Built here so the
   * word component receives one presence boolean and one opener — never the
   * amount, and never a face that could leak across bands.
   */
  const quantityViewOf = useCallback(
    (word: Reference) => {
      if (level !== "dynamics" || word.slug === null) return undefined;
      const slug = word.slug;
      return {
        has: quantityTargets.has(quantityTargetKey({ type: "stock", on: slug })),
        onOpen: (anchor: Point) =>
          openQuantity({ type: "stock", on: slug }, anchor),
      };
    },
    [level, quantityTargets, openQuantity],
  );

  /**
   * A word's RUN read at Level 2 (Epic 8 story 3, ADR-0022), or undefined
   * elsewhere and before the first crank: the stock's running amount after the
   * last crank and what that crank moved for it. Per word BY CONSTRUCTION —
   * there is no panel, column or total to collect the words into — and it
   * never renders at Level 1 (a run is the dynamics game's own reading).
   */
  const runViewOf = useCallback(
    (word: Reference) => {
      if (level !== "dynamics" || word.slug === null || step.run === null) {
        return undefined;
      }
      const slug = word.slug;
      if (!step.run.amounts.has(slug)) return undefined;
      return {
        amount: step.run.amounts.get(slug) ?? null,
        delta: step.run.lastDelta.get(slug) ?? null,
      };
    },
    [level, step.run],
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

  // The open amount card's line, recomputed from the records so a commit or a
  // removal shows in the same breath. Null means "no line yet" — the card still
  // opens so a number (or a deliberate unknown) can be authored.
  const quantityPanel = useMemo(() => {
    if (!quantityAt) return null;
    return {
      ...quantityAt,
      line: findQuantity(quantities, quantityAt.target)?.quantity ?? null,
    };
  }, [quantityAt, quantities]);

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

  // Which words carry at least one authored pointer line — the reach handle's
  // in-band SOLID read (story 3: solid when present, faint-but-addable when
  // not). A Set, never a count: presence, inside ground only (ADR-0019).
  const wordsWithPointers = useMemo(() => {
    const owners = new Set<string>();
    for (const pointer of pointers) owners.add(pointer.on);
    return owners;
  }, [pointers]);

  /**
   * The person's name for a slug (story 3): notices, the walk and the overlay's
   * aria all speak NAMES; the slug stays in the record. A word wins over a loop
   * of the same slug (a word's face is the word), and a slug whose owner is
   * gone falls back to itself — the record is the only name left.
   */
  const nameOf = useMemo(() => {
    const names = new Map<string, string>();
    for (const loop of loops) names.set(loopSlug(loop.name), loop.name);
    for (const word of refs) {
      if (word.slug !== null) names.set(word.slug, word.name);
    }
    return (slug: string): string => names.get(slug) ?? slug;
  }, [refs, loops]);

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

  // The fold's drawn extent (story 3): the shelf is a place in world space, so
  // the line must REACH it. The words' own vertical span (live during a drag)
  // grows the fold past its minimum reach, so a word set aside far below still
  // sits beside its line and its repeated end caption. Provisional geometry.
  const fold = useMemo(
    () =>
      foldExtent(
        refs.map((word) => ({ y: posOf(word).y, h: boxOf(word).h })),
      ),
    [refs, posOf, boxOf],
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
            : // The veil's box arm is LEVEL-UNIFORM: the same mode at concept
              // and dynamics (its own arm, never the selector's lasso), and it
              // stays armed while the coin field asks — so pan, creation and
              // every word press stand still throughout the gesture.
              veilArmed || veilBox !== null
              ? "veil"
              : "idle";
  // The gate's mode, readable from the focus and release paths, which run
  // outside render (a focusout microtask, a post-render focus refresh).
  const gestureModeRef = useRef<GestureMode>(gestureMode);
  gestureModeRef.current = gestureMode;

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
   * The veil whose cover is LIFTED right now (Epic 9 story 2): the look-under's
   * record, derived by its natural key so a rename shows at once and a retired
   * line resolves to null. Null is no look-under — and the ground gate reads
   * `lookUnderLive` at the render, so a stale key can never surface a card in a
   * game that shows no sheet.
   */
  const lookUnderVeil = useMemo(
    () => (lookUnderKey === null ? null : findVeil(veils, lookUnderKey)),
    [lookUnderKey, veils],
  );

  /**
   * The veil's covered set (Epic 9 story 1, ADR-0023): a word is covered iff
   * the CENTRE of its measured box is inside a veil's box — the same "in a
   * region" rule the playing-set selector's lasso uses. It is a RENDER-TIME
   * reading only: it never enters a record, never changes a mark and never
   * washes a word. The class it hands the word carries visibility alone, so a
   * covered word's own quiet is exactly what it was, and retire shows it as
   * before. Sheets render in FILE ORDER (later on top).
   *
   * THE GROUND GATE (Epic 9 story 2): the reading is LEVEL-GATED by the SAME
   * `veilLive` as the sheet. At ground no sheet renders, so nothing is covered:
   * the words read normally, because there the game switch IS the look-under —
   * the person's own move, never a cover that hides what it cannot show. (The
   * record is untouched either way: no veil line is rewritten or hidden.)
   */
  const coveredSlugs = useMemo(
    () =>
      veilLive(level)
        ? coveredWordSlugs(veils, selectorWords)
        : new Set<string>(),
    [veils, selectorWords, level],
  );

  /**
   * The words the OPENED veil covers — the ones the look-under LIFTS (Epic 9
   * story 2). A separate reading from `coveredSlugs` on purpose: the covered
   * prop never changes under the transient (the lift is visibility at the
   * render, never a settled state) and only the words THIS veil covers are
   * revealed. PROVISIONAL: where two sheets overlap, the opened one's words show
   * even though the other sheet still lies over them — sheet stacking versus the
   * lift is ADR-0023's open geometry question, not a rule this story settles.
   * The lift hands the word no press (the CSS), so the reading can never become
   * an edit.
   */
  const liftedSlugs = useMemo(
    () =>
      lookUnderVeil === null
        ? new Set<string>()
        : coveredWordSlugs([lookUnderVeil], selectorWords),
    [lookUnderVeil, selectorWords],
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

  // Out of play at Level 2: quiet but fully live (ADR-0013, story 1). The ONE
  // reading is `outOfPlay` (model.ts, Epic 7 story 1): while the selector is
  // open the DRAFT is what the plane shows, so a word clicked back in undims
  // before close and one clicked out quiets at once; when it is closed the
  // ACCEPTED set decides, so no set at all means nothing is out. In concept mode
  // — and in ground, and for a word still being coined — every word renders
  // unchanged.
  const isOutOfSet = useCallback(
    (word: Reference): boolean =>
      level === "dynamics" &&
      word.slug !== null &&
      outOfPlay(model, selectorOpen ? selectorDraft : null, word.slug),
    [level, model, selectorOpen, selectorDraft],
  );

  /* --------------------------------------------------------------------- *
   * Epic 10 story 3: the ghosts (ADR-0024 decisions 1 and 5, ADR-0026
   * decision 4). A ghost is TEXT in a quiet list until the person opens one;
   * the opening shows the read-only derived steps and the why, and offers the
   * only apply (accept) and the delete (reject). Reshape edits the params and
   * the person's reason; the deriver re-derives the steps. Nothing of a ghost
   * is ambient: no glyph on the plane while one is held, no counts, no age.
   * --------------------------------------------------------------------- */

  // The packet's view of the running map (Epic 10 story 2): the records as the
  // app holds them, VERBATIM — the words with their measured boxes, the playing
  // set, the marks, the claims, the loops and the whole veils. Nothing here is
  // a request's: the ask's region is the person's own (ADR-0026).
  const packetView = useMemo<PacketView>(
    () => ({
      words: refs
        .map((word) =>
          packetWordOf(
            word,
            word.slug === null ? DEFAULT_BOX : boxes[word.slug] ?? DEFAULT_BOX,
          ),
        )
        .filter((word): word is PacketWord => word !== null),
      playing: model?.words ?? [],
      marks,
      claims: assumptions,
      loops,
      veils,
    }),
    [refs, boxes, model, marks, assumptions, loops, veils],
  );

  // The ghosts' app state (the rows, the ONE opening, the reshape in flight)
  // and the quiet ask's own. One session per workspace path: the session's
  // open moment discards the inbox, so a proposal from an earlier session is
  // refused by replay and an id the app did not mint cannot be accepted.
  const ghosts = useGhosts({
    workspacePath: workspace?.path ?? null,
    context: () => ({ level, scenario }),
    nameOf,
  });
  const ghostRequest = useGhostRequest({
    workspacePath: workspace?.path ?? "",
    context: () => ({ level, scenario }),
    view: () => packetView,
  });
  const { close: closeGhosts } = ghosts;

  // The loops' name marks, for the opened ghost's diamond when its target is a
  // loop (the route's coined name is where the claim would read).
  const ghostLoops = useMemo(
    () =>
      loopRoutes.map(({ loop, nameAt }) => ({
        slug: loopSlug(loop.name),
        nameAt,
      })),
    [loopRoutes],
  );

  /**
   * THE ONE PLANE READING (the preview-only-when-open rule, structural): the
   * opened ghost's target point, or null. Null for every HELD proposal — the
   * diamond cannot be drawn until the person opens one — and null when the
   * target is gone from the map (a removed word has no place to mark).
   */
  const ghostPoint = useMemo(
    () => previewPoint(ghosts.ghosts, ghosts.openId, selectorWords, ghostLoops),
    [ghosts.ghosts, ghosts.openId, selectorWords, ghostLoops],
  );

  // The sentences the surfaces read (the app never renders a code, only the
  // session's own words).
  const ghostIssues = useMemo(
    () => ghosts.issues.map((entry) => entry.message),
    [ghosts.issues],
  );
  const ghostAskIssues = useMemo(
    () => ghostRequest.issues.map((entry) => entry.message),
    [ghostRequest.issues],
  );
  const ghostIntakeIssues = useMemo(
    () => ghosts.intakeIssues.map((entry) => entry.message),
    [ghosts.intakeIssues],
  );

  // The ask's targets: the running map's words, then its loops, in map order.
  // The ask is about ONE of them (the move's target count).
  const ghostTargets = useMemo(
    () => [
      ...selectorWords.map((word) => ({
        key: "word\u0000" + word.slug,
        kind: "word" as const,
        slug: word.slug,
        label: word.name,
      })),
      ...loops.map((loop) => ({
        key: "loop\u0000" + loopSlug(loop.name),
        kind: "loop" as const,
        slug: loopSlug(loop.name),
        label: loop.name,
      })),
    ],
    [selectorWords, loops],
  );

  /** Switching games cancels any pending gesture (ADR-0016). */
  const cancelPendingGestures = useCallback(() => {
    setMenuAt(null);
    setGrowAt(null);
    setSelectorOpen(false);
    setLassoArmed(false);
    setVeilArmed(false);
    setVeilBox(null);
    // The look-under is a transient: the switch path closes it with every
    // other one (a level switch, a branch switch and any deliberate entry that
    // runs this path). It closes QUIETLY — the wheel never yanks focus.
    setLookUnderKey(null);
    setPathSession(endPathSession());
    setAssumptionAt(null);
    setQuantityAt(null);
    closePointersQuietly();
    closePeekQuietly();
    // The ghosts are transients too (Epic 10 story 3): the opened preview and
    // the ask surface close with the switch, quietly — a held proposal is app
    // state and stays in its rows (it is the dynamics game's own move).
    closeGhosts();
    setGhostPanelOpen(false);
    cancelConnect();
  }, [cancelConnect, closePointersQuietly, closePeekQuietly, closeGhosts]);

  /**
   * Open one held ghost — the person's opening, and the ONLY door to the
   * preview. ONE ghost is open at a time (the hook's one-open rule): opening a
   * second opens it and closes the first quietly. The app's cancel-pending path
   * runs first, so a menu or a card behind the row closes instead of standing
   * under the reading; that path also closes the preview quietly, and the row's
   * own opening is the call that follows it.
   */
  const openGhostPreview = useCallback(
    (id: string) => {
      cancelPendingGestures();
      ghosts.open(id);
    },
    [cancelPendingGestures, ghosts],
  );

  /** Open the ask surface (the level control's door), closing the behind. */
  const openGhostPanel = useCallback(() => {
    cancelPendingGestures();
    setGhostPanelOpen(true);
  }, [cancelPendingGestures]);

  /** Close the ask surface quietly (Esc, its ×, a level switch). */
  const closeGhostPanel = useCallback(() => setGhostPanelOpen(false), []);

  /**
   * ACCEPT — the only apply (ADR-0024 decision 5). The session writes the line
   * in its own order (marker, apply, release, delete); the app then re-reads the
   * map, so the accepted claim appears at once and nothing else of the ghost
   * remains — no trace of the reshaping, no record of the proposal.
   */
  const acceptGhostPreview = useCallback(() => {
    void ghosts.accept().then((outcome) => {
      if (outcome === null) return;
      if (
        outcome.outcome === "applied" ||
        outcome.outcome === "already-applied"
      ) {
        void reload();
      }
    });
  }, [ghosts, reload]);

  /** REJECT: the session deletes the proposal, and the row goes with it. */
  const rejectGhostPreview = useCallback(() => {
    void ghosts.reject();
  }, [ghosts]);

  /** The ask: freeze a packet for one target. It writes nothing. */
  const askForGhost = useCallback(
    (target: GhostTarget) => {
      void ghostRequest.ask(target);
    },
    [ghostRequest],
  );

  /** The paste: wrap, validate and file a model's reply as a proposal. */
  const proposeGhost = useCallback(
    (raw: string) => {
      void ghosts.intake(raw);
    },
    [ghosts],
  );

  /**
   * Begin the reshape over the opened ghost: the five fields open with the
   * envelope as proposed, the new params, the person's reason, the base pin and
   * the packet hash the ask froze (null when no packet is in flight).
   */
  const beginGhostReshape = useCallback(() => {
    ghosts.beginReshape(ghostRequest.packet?.freeze.hash ?? null);
  }, [ghosts, ghostRequest.packet]);

  /**
   * Close the comparison (Epic 8 story 4). It is a transient of the dynamics
   * game like the walk: a level switch or a branch switch closes it, and so do
   * Esc and the ×. Closing writes nothing and resets nothing.
   */
  const closeComparison = useCallback(() => {
    setCompareOpen(false);
    setComparePick(null);
    setComparison(null);
    setCompareRefusal(null);
  }, []);

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
   * The playing set is asked for through the PURE prompt rule
   * (`shouldPromptForSet`, gates.ts): only a DELIBERATE entry asks, and a WHEEL
   * crossing into dynamics with no set never does — the named cost is that the
   * set stays required at authoring, and the control's "edit the playing set"
   * is the door. The open that resumes the game asks through the same rule.
   */
  const switchLevel = useCallback(
    (next: Level, cause: HandoffCause) => {
      setLevel(next);
      if (cause === "restore") return;
      cancelPendingGestures();
      setWalkSlug(null);
      // The comparison is the dynamics game's own reading: a switch closes it
      // (nothing is written; the next open reads anew).
      closeComparison();
      if (cause === "jump") closePointers("switch-level");
      else closePointersQuietly();
      if (shouldPromptForSet(cause, next, model !== null)) openSelector();
    },
    [
      cancelPendingGestures,
      closeComparison,
      closePointers,
      closePointersQuietly,
      model,
      openSelector,
    ],
  );

  /**
   * Move the camera INTO a band, keeping the view's centre in place: the jump
   * intent the level control, a word's follow and the open-restore share. No
   * recentre (no world point is brought to the centre by default) and no
   * position yank (position is never persisted); the landing zoom is the
   * band's own. A FOLLOW passes its screen anchor (story 3): the shared intent
   * then keeps THAT point fixed, so the word stays under the eye across the
   * jump (ADR-0019's movement vocabulary).
   */
  const moveCameraToBand = useCallback(
    (next: Level, screen?: Point) => {
      const el = document.querySelector<HTMLDivElement>(".plane");
      intents.setZoomBand(
        next,
        screen?.x ?? (el ? el.clientWidth / 2 : undefined),
        screen?.y ?? (el ? el.clientHeight / 2 : undefined),
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
  // ONE queue for `workspace.yml` (lib/writeQueue.ts: one queue per file). The
  // level handoff and the scenario handoff both rewrite their own line of that
  // one file with a read-modify-write, so they MUST share the queue — two
  // queues over one file could interleave and resurrect an older value under a
  // newer one.
  const workspaceQueueRef = useRef<WriteQueue | null>(null);
  if (workspaceQueueRef.current === null) {
    workspaceQueueRef.current = createWriteQueue();
  }
  const workspaceQueue = workspaceQueueRef.current;

  const handoffRef = useRef<LevelHandoff | null>(null);
  if (handoffRef.current === null) {
    handoffRef.current = createLevelHandoff(
      DEFAULT_LEVEL,
      {
        onSwitch: (next, cause) => handoffDeps.current.onSwitch(next, cause),
        moveCamera: (next) => handoffDeps.current.moveCamera(next),
        save: (next) => handoffDeps.current.save(next),
      },
      workspaceQueue,
    );
  }
  const handoff = handoffRef.current;

  // The level pin's memory (gates.ts, pure): a settled crossing waits while the
  // pin holds, and the CAMERA — not a queue — is what it remembers. ONE
  // instance, like the handoff, so no render can forget a held crossing.
  const levelPinRef = useRef<LevelPin | null>(null);
  if (levelPinRef.current === null) levelPinRef.current = createLevelPin();
  const levelPin = levelPinRef.current;

  /**
   * The pin's release (story 2): when the level stops being pinned — a blur, a
   * commit, a cancel or the armed gesture's end — the band re-derives from the
   * zoom the camera ended on. A crossing made under the pin runs the full
   * switch path now, with the WHEEL's cause (so focus is never yanked); a wheel
   * across and back settles the band it never left and writes nothing.
   *
   * With nothing held there is nothing to re-derive: while the level is NOT
   * pinned, every settled crossing applies at once and every camera intent is
   * band-preserving, so the band and the camera cannot disagree.
   */
  const releasePin = useCallback(() => {
    if (!levelPin.held()) return;
    handoff.settle(levelPin.release(cameraZoomRef.current));
  }, [handoff, levelPin]);

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

  /**
   * The focus reading (story 2): whichever TEXT entry holds focus — a word's
   * coin field or note, an assumption line, a pointer's value, a loop's name, a
   * distance's word — pins the level, so a wheel crossing can never close it or
   * discard what is being typed. Read from the document, so no field needs to
   * learn about levels.
   */
  const readFocus = useCallback(() => {
    const active = typeof document === "undefined" ? null : document.activeElement;
    const next = focusStateOf(active instanceof HTMLElement ? active : null);
    if (next === focusStateRef.current) return;
    const before = focusStateRef.current;
    focusStateRef.current = next;
    // The field's life ended (blur, commit, cancel) and nothing else pins the
    // level: the band re-derives NOW, so a crossing made while typing applies
    // the moment the person leaves the field. An armed gesture keeps the pin —
    // the gesture's own end releases it (the effect below).
    if (didReleaseFocusPin(before, next, gestureModeRef.current)) releasePin();
  }, [releasePin]);

  // Focus moves: read on a microtask, so a hop between two fields is never seen
  // as "nothing focused" in between (which would lift the pin mid-hop).
  useEffect(() => {
    const schedule = () => queueMicrotask(readFocus);
    document.addEventListener("focusin", schedule);
    document.addEventListener("focusout", schedule);
    return () => {
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("focusout", schedule);
    };
  }, [readFocus]);

  // A field REMOVED while focused (Esc, a click-away, a commit that closes its
  // card) loses focus without `focusout` in Chromium, so the reading is
  // refreshed after every render too: focus is a fact about the document, not
  // an event the app is always told about.
  useLayoutEffect(() => {
    readFocus();
  });

  /**
   * The armed gesture's end releases the pin (story 2, ADR-0018 decision 3):
   * on completion or cancel the band re-derives from the zoom the wheel left,
   * and a real crossing runs the full switch path. A focused field keeps the
   * pin alive — its text is still being typed.
   */
  const wasArmedRef = useRef(isGestureArmed(gestureMode));
  useEffect(() => {
    const armed = isGestureArmed(gestureMode);
    if (
      wasArmedRef.current &&
      !armed &&
      !shouldPinLevel(gestureMode, focusStateRef.current)
    ) {
      releasePin();
    }
    wasArmedRef.current = armed;
  }, [gestureMode, releasePin]);

  /* ----------------------------------------------------------------------- *
   * Epic 8 story 2: the branch (ADR-0021).
   * ----------------------------------------------------------------------- */

  /**
   * The scenario switch's path (ADR-0021 decision 5). It runs the FULL switch
   * path — the same one a level jump runs: every transient closes, the armed
   * gestures cancel, the walk closes — and then, because the branch's records
   * are a different FOLDER, the app's branch state changes and `useMap`
   * re-reads the three variant records from it.
   *
   * The LEVEL PIN is honored explicitly. Closing the transients removes
   * whatever field was holding focus without a `focusout` in Chromium (the
   * app's own long-standing note), so a held level crossing would otherwise
   * stay stuck behind a surface that no longer exists: `releasePin()` applies
   * it here, in the same move, with the wheel's cause.
   *
   * A restore (open) runs no switch path: there is no transient to close, and
   * it never writes (a hand-edited hint is honored on open).
   */
  const switchScenario = useCallback(
    (next: string | null, cause: ScenarioCause) => {
      setScenario(next);
      if (cause === "restore") return;
      cancelPendingGestures();
      setWalkSlug(null);
      // A branch switch closes the comparison too: the compared branch may be
      // the one that just stopped running, and a reading is re-taken, never
      // carried across.
      closeComparison();
      releasePin();
    },
    [cancelPendingGestures, closeComparison, releasePin],
  );

  const scenarioDeps = useRef<ScenarioHandoffDeps>({
    onSwitch: () => undefined,
    save: async () => undefined,
  });
  scenarioDeps.current = {
    onSwitch: switchScenario,
    save: async (next) => {
      if (workspace) await saveWorkspaceScenario(workspace.path, next);
    },
  };
  const scenarioHandoffRef = useRef<ScenarioHandoff | null>(null);
  if (scenarioHandoffRef.current === null) {
    scenarioHandoffRef.current = createScenarioHandoff(
      null,
      {
        onSwitch: (next, cause) => scenarioDeps.current.onSwitch(next, cause),
        save: (next) => scenarioDeps.current.save(next),
      },
      workspaceQueue,
    );
  }
  const scenarioHandoff = scenarioHandoffRef.current;

  /**
   * Open-restore (ADR-0021 decision 5): read the branch folders, resolve
   * `workspace.yml`'s `scenario` hint against them and set the running
   * branch. It NEVER writes — a hand-edited hint is honored here and rewritten
   * only on the first deliberate switch — and a hint naming no folder resolves
   * to the committed model, quietly. Once per workspace.
   */
  const scenarioRestoredRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (!workspace) return;
    let cancelled = false;
    void listScenarios(workspace.path).then((folders) => {
      if (cancelled) return;
      setScenarios(folders);
      if (scenarioRestoredRef.current === workspace.path) return;
      scenarioRestoredRef.current = workspace.path;
      scenarioHandoff.restore(
        resolveActiveScenario(
          workspace.resumeScenario,
          folders.map((folder) => folder.slug),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [workspace, scenarioHandoff]);

  /**
   * Branch the COMMITTED model under a coined name (the chooser's "branch…").
   * The copy is always `map/`'s — a scenario is a model variant, not a second
   * model (ADR-0021 decision 6) — and the new branch becomes the running one,
   * which is the move the person just made. The write order is the branch
   * module's: copies, the pins, then the header last (the folder only becomes a
   * scenario once it is whole).
   */
  const branchModel = useCallback(
    (name: string) => {
      if (!workspace) return;
      void (async () => {
        // The branch copies the COMMITTED model (ADR-0021 decision 6) and the
        // folder becomes a scenario only once it is whole.
        const created = await createScenario(workspace.path, name);
        setScenarios(await listScenarios(workspace.path));
        scenarioHandoff.choose(created.slug);
      })();
    },
    [workspace, scenarioHandoff],
  );

  /**
   * Retire a branch: DELETE its folder (ADR-0021 decisions 1 and 6 — ammo, no
   * archive, no history). Retiring the running branch first switches back to
   * the committed model through the handoff (the switch path runs and the hint
   * write is queued, so `workspace.yml` stops naming the branch), and the
   * folder is deleted only after that write has settled: the hint never names a
   * folder that is gone by the app's own act. A crash between the two leaves a
   * harmless orphan folder the chooser still lists.
   */
  const retireBranch = useCallback(
    (slug: string) => {
      if (!workspace) return;
      void (async () => {
        scenarioHandoff.retire(slug);
        await scenarioHandoff.idle();
        await retireScenario(workspace.path, slug);
        setScenarios(await listScenarios(workspace.path));
      })();
    },
    [workspace, scenarioHandoff],
  );

  /** The chooser's pick: a branch, or the committed model (null). */
  const chooseScenario = useCallback(
    (slug: string | null) => {
      scenarioHandoff.choose(slug);
    },
    [scenarioHandoff],
  );

  /* --------------------------------------------------------------------- *
   * Epic 8 story 4: the comparison and the return move (ADR-0021 §7 amended,
   * ADR-0022's reset amendment).
   * --------------------------------------------------------------------- */

  /**
   * Read one branch against the committed model — the panel's ONE read, used
   * by the explicit pick and by the re-read. It refreezes the reading: the
   * committed records (re-read from `map/`) and the branch's records + pins
   * are loaded, and the panel keeps the value. A re-read is a READING: it
   * writes nothing, switches nothing and resets nothing, so the branch's run
   * (which tracks the ACTIVE model, not this one) is untouched.
   */
  const readComparison = useCallback(
    async (slug: string) => {
      if (!workspace) return;
      const path = workspace.path;
      // Wait for any queued committed write first: a reading must never freeze
      // a record the person just revised and whose write has not landed.
      await committedWriteRef.current.catch(() => undefined);
      const records = await loadCommittedRecords(path);
      committedRecordsRef.current = records;
      const source = await readComparisonSource(
        path,
        slug,
        records,
        assumptions,
      );
      // A folder whose header does not read as a scenario is not a branch: the
      // panel shows no reading rather than inventing one.
      setComparison(source === null ? null : comparisonOf(slug, source));
    },
    [workspace, assumptions],
  );

  /** The level control's "compare…": open the panel (nothing read yet). */
  const openComparison = useCallback(() => {
    setCompareOpen(true);
    setCompareRefusal(null);
  }, []);

  /**
   * Pick the branch to read. The frame is branch↔committed ONLY: the committed
   * side is fixed, so a two-branch frame is refused before any read (the
   * predicate is `compare.ts`'s; the sentence is the panel's).
   */
  const pickComparison = useCallback(
    (slug: string) => {
      const frame = comparisonFrame(
        { kind: "branch", slug },
        { kind: "committed" },
      );
      if (!frame.ok) {
        setCompareRefusal(frame.refusal);
        setComparePick(null);
        setComparison(null);
        return;
      }
      setCompareRefusal(null);
      setComparePick(frame.branch);
      // Frozen until the re-read: the old reading is never shown under a new
      // pick's name.
      setComparison(null);
      void readComparison(frame.branch);
    },
    [readComparison],
  );

  /** Re-read the picked branch: another reading, never a live recompute. */
  const rereadComparison = useCallback(() => {
    if (comparePick === null) return;
    void readComparison(comparePick);
  }, [comparePick, readComparison]);

  // A new workspace (or none) ends the reading: a frozen value belongs to the
  // workspace it was read from, and carrying it over would show one map's rows
  // under another map's name. Closing writes nothing.
  useEffect(() => {
    closeComparison();
  }, [workspace?.path, closeComparison]);

  /**
   * The bridge's one write: take ONE deliberate edit of the committed records
   * and save the record it changed. The pure move is `bridge.ts`'s; the write
   * is `compareRead.ts`'s (always `map/`), queued in press order so two
   * presses can never interleave. A move that changes nothing writes nothing.
   *
   * This never touches the ACTIVE model's records: while a branch runs they
   * live in its folder, so a committed edit cannot reset the branch's run
   * (ADR-0022's reset amendment — the evidence survives the act of revising).
   */
  const commitBridgeMove = useCallback(
    (move: BridgeMove) => {
      const records = committedRecordsRef.current;
      if (records === null) return;
      const edit = deliberateEdit(records, move);
      if (edit.changed === null) return;
      // The pure move names the three records; the malformed bytes the read
      // preserved ride along so the write never repairs a hand-written line.
      const next: CommittedRecords = { ...records, ...edit.records };
      committedRecordsRef.current = next;
      const record = edit.changed;
      if (!workspace) return;
      const path = workspace.path;
      committedWriteRef.current = committedWriteRef.current
        .catch(() => undefined)
        .then(() => saveCommittedRecord(path, next, record));
    },
    [workspace],
  );

  /**
   * The comparison's doors. Each is ONE ordinary deliberate edit of the
   * committed model — never an "apply the branch": the branch's values are what
   * the rows SHOW, and no door here takes a branch. The authoring moves ask
   * `authoringLive` exactly as the plane's own writers do; a revision (a flip,
   * a removal, a claim's revise) is ungated like every revision.
   */
  const bridge = useMemo<BridgeActions>(
    () => ({
      setAmount(target, amount) {
        if (!authoringLive(level, model)) return;
        commitBridgeMove({ move: "set-amount", target, amount });
      },
      removeLine(target) {
        commitBridgeMove({ move: "remove-line", target });
      },
      drawLink(from, to, sign) {
        if (!authoringLive(level, model)) return;
        commitBridgeMove({ move: "draw-link", from, to, sign });
      },
      flipLink(from, to) {
        commitBridgeMove({ move: "flip-link", from, to });
      },
      removeLink(from, to) {
        commitBridgeMove({ move: "remove-link", from, to });
      },
      joinWord(word) {
        if (!authoringLive(level, model)) return;
        commitBridgeMove({ move: "join-word", word });
      },
      pruneWord(word) {
        if (!authoringLive(level, model)) return;
        commitBridgeMove({ move: "prune-word", word });
      },
      reviseClaim(assumption, text) {
        reviseAssumption(assumption, text);
      },
      stateClaim(target, text) {
        addAssumption(target, text);
      },
    }),
    [
      addAssumption,
      commitBridgeMove,
      level,
      model,
      reviseAssumption,
    ],
  );

  /**
   * A zoom gesture settled (ADR-0018 decisions 3 and 5, story 2): while the
   * level is PINNED — an armed gesture or a focused text field — the wheel
   * moves the camera and nothing else. The crossing is HELD; the pin's release
   * re-derives the band from the zoom the camera ended on.
   */
  const handleZoomSettle = useCallback(
    (zoom: number) => {
      const next = levelPin.settle(
        zoom,
        shouldPinLevel(gestureMode, focusStateRef.current),
      );
      if (next !== null) handoff.settle(next);
    },
    [levelPin, gestureMode, handoff],
  );

  /**
   * Arm the path gesture: the level control's "coin a loop" (story 3). Opening
   * it cancels any other pending gesture, and the gate's `path` mode suspends
   * word presses, pan and creation while the words are clicked in order.
   *
   * Dead while authoring is inert (Epic 7 story 1) AND while the selector is
   * open (that story's ruling: all three authoring doors die there). The control
   * sits OUTSIDE `.plane`, so the armed gate cannot cover this one, and the
   * guard must run BEFORE `cancelPendingGestures` — clicking a dead door must
   * never close the selector it is dead behind. `authoringDoorLive` (gates.ts)
   * is the reading; `createLoop` still enforces the write-time rule.
   * Provisional: the door rule's shape.
   */
  const beginLoop = useCallback(() => {
    if (!authoringDoorLive(level, model, selectorOpen)) return;
    cancelPendingGestures();
    setPathSession(beginPathSession());
  }, [cancelPendingGestures, level, model, selectorOpen]);

  /** One word click in the path layer: collect it, or close at the first. */
  const pickPathWord = useCallback((slug: string) => {
    setPathSession((session) => (session ? clickPathWord(session, slug) : session));
  }, []);

  /** Esc (or leaving the gesture): the whole session goes, nothing is written. */
  const cancelPath = useCallback(() => {
    setPathSession(endPathSession());
  }, []);

  /**
   * Arm the veil's draw-box (Epic 9 story 1, ADR-0023): the level control's
   * `veil` door, the ONE level-uniform veil action. It runs the app's
   * cancel-pending path first — one armed gesture at a time — and then the
   * gate's `veil` mode owns the pointer: pan, double-click creation and every
   * word press stand still, so a box drag can never move a word or open the
   * ring menu. LEVELS 1–2 only (`veilLive`): at ground no sheet renders, so no
   * veil is coined. Provisional: the door and the look.
   */
  const beginVeil = useCallback(() => {
    if (!veilLive(level)) return;
    cancelPendingGestures();
    setVeilArmed(true);
  }, [cancelPendingGestures, level]);

  /** Esc or a level switch: the arm (or the captured box) goes, nothing written. */
  const cancelVeil = useCallback(() => {
    setVeilArmed(false);
    setVeilBox(null);
  }, []);

  /**
   * The plane reported the captured BOX: hold it while the coin field asks. The
   * gate stays in the `veil` mode (the box is not null), so the plane's own
   * gestures stay suspended while the person types — exactly as the loop's coin
   * field keeps the path gate armed while it asks.
   */
  const captureVeilBox = useCallback((box: VeilBox) => {
    setVeilArmed(false);
    setVeilBox(box);
  }, []);

  /**
   * The coin field's Enter: ONE line in `map/veils.jsonl` — the name exactly
   * as coined (a key collision mints a suffix in the name), the captured box,
   * and the reason exactly as typed (prose, never read by the app). Only the
   * person coins a veil; nothing is written for a blank name (the field itself
   * refuses, and `nameVeil` would write nothing anyway).
   */
  const coinVeil = useCallback(
    (name: string, reason: string) => {
      const box = veilBox;
      setVeilBox(null);
      if (!box) return;
      createVeil(name, reason, box);
    },
    [veilBox, createVeil],
  );

  /**
   * Open the look-under for one veil (Epic 9 story 2, ADR-0023 decision 3): the
   * quiet press on the sheet (or Enter/Space). It is the PERSON'S opening —
   * nothing opens it on its own — and it runs the app's one cancel-pending path
   * first, so a menu, a grow field or a card left open behind the reading closes
   * instead of standing still under it. An ARMED gesture returns before that
   * path: its own surface owns the pointer, so a press on the sheet is inert
   * (the coin field's half-typed name is never discarded). The ground gate is
   * the same reading as the sheet's (`veilLive`): where no sheet renders there
   * is no door and the game switch is the look-under.
   */
  const openLookUnder = useCallback(
    (veil: Veil) => {
      if (!veilLive(level) || isGestureArmed(gestureMode)) return;
      cancelPendingGestures();
      setLookUnderKey(veilKey(veil));
    },
    [level, gestureMode, cancelPendingGestures],
  );

  /**
   * Close the look-under and return focus where the window's rule returns it
   * (the same reading): the veil's own sheet on a dismissal, the level control
   * on a switch. A switch also clears the key through `cancelPendingGestures`;
   * that quiet path never yanks focus, which is right for a wheel crossing.
   */
  const closeLookUnder = useCallback(
    (reason: LookUnderCloseReason = "dismiss") => {
      const key = lookUnderKey;
      setLookUnderKey(null);
      const selector = lookUnderFocusSelector(
        focusAfterLookUnderClose(reason),
        key,
      );
      requestAnimationFrame(() => {
        document.querySelector<HTMLElement>(selector)?.focus();
      });
    },
    [lookUnderKey],
  );

  /**
   * Rename the opened veil in place (PROVISIONAL, Epic 9 story 2): the loops'
   * idiom — the name only, one line rewritten, its box and its reason exactly
   * as they were. The card cannot fall out from under the person mid-rename:
   * the record module returns the rewritten line, so the look-under's key moves
   * to the minted name in the same move (a collision's suffix included). A
   * quiet no-op (a blank or unchanged name) returns null and nothing moves.
   */
  const renameLookUnder = useCallback(
    (name: string) => {
      const veil = lookUnderVeil;
      if (veil === null) return;
      const renamed = renameVeil(veil, name);
      if (renamed !== null) setLookUnderKey(veilKey(renamed));
    },
    [lookUnderVeil, renameVeil],
  );

  // A veil retired while its look-under is open (the sheet's × rides under the
  // card) takes the transient with it: a card about a line that is gone would
  // be a lie. The derived key resolves to null, and the state follows quietly.
  useEffect(() => {
    if (lookUnderKey === null || lookUnderVeil !== null) return;
    setLookUnderKey(null);
  }, [lookUnderKey, lookUnderVeil]);

  // Esc abandons the whole veil gesture — the arm before a box is captured, or
  // the captured box while the coin field asks (nothing is written). The field's
  // own Esc handler settles the same cancel; both are idempotent.
  useEffect(() => {
    if (!veilArmed && veilBox === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setVeilArmed(false);
      setVeilBox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [veilArmed, veilBox]);

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

  /**
   * Begin a draw from a word's connect handle. Dead while authoring is inert
   * (Epic 7 story 1): at dynamics with no accepted set the draw could only reach
   * a sign choice whose pick writes nothing, so the gesture is never spent. The
   * seam's arming-time ECHO — `drawLink` enforces the rule before the write —
   * and Level 1's distance draw (the same handle) is untouched, because
   * `authoringLive` is true in every other game.
   */
  const beginConnectLive = useCallback(
    (slug: string, at: Point) => {
      if (!authoringLive(level, model)) return;
      beginConnect(slug, at.x, at.y);
    },
    [beginConnect, level, model],
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

  // A workspace that RESUMES in dynamics without an accepted set asks for one
  // on open, through the SAME pure prompt rule (`shouldPromptForSet` with the
  // restore cause — the resume hint is what the person left behind, so it is a
  // deliberate entry). Once per workspace: closing the selector is a choice,
  // not a prompt to repeat.
  useEffect(() => {
    if (!workspace || !loaded) return;
    if (!shouldPromptForSet("restore", workspace.resumeLevel, model !== null)) {
      return;
    }
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
        boxArmed={veilArmed}
        picking={markDrag.ghost !== null}
        onLasso={handleLasso}
        onDrawBox={captureVeilBox}
        onZoomSettle={handleZoomSettle}
      >
        {/* the shelf's fold and margin: a place in world space (story 3). Its
            drawn extent covers the world's words (story 3 of Epic 6), so a word
            set aside far below still reads as set aside. */}
        <ShelfFold shelfX={shelfX} extent={fold} />

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
              closeQuantity();
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
              closeQuantity();
              closePointersQuietly();
              if (candidate.slug !== null) closePeekFor(candidate.slug);
              remove(candidate);
            }}
            onConnectFrom={beginConnectLive}
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
            covered={word.slug !== null && coveredSlugs.has(word.slug)}
            lifted={word.slug !== null && liftedSlugs.has(word.slug)}
            interactionMode={gestureMode}
            onReject={() => rejectWord(word)}
            showAssumptions={cueShownIn("assumptions", level)}
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
            quantity={quantityViewOf(word)}
            run={runViewOf(word)}
            showReach={cueShownIn("reach", level)}
            reachMarked={
              word.slug !== null && wordsWithMarkedPointer.has(word.slug)
            }
            hasPointers={
              word.slug !== null && wordsWithPointers.has(word.slug)
            }
            onOpenPointers={(anchor) => {
              if (word.slug === null) return;
              openPointers(word.slug, anchor);
            }}
            game={level}
            onFollow={(next, screen) => handoff.jump(next, screen)}
          />
        ))}

        {/* the veils' covers (Epic 9 story 1, ADR-0023): one sheet per line, in
            FILE ORDER so later sheets sit on top. The sheet is the area's fill
            (z-index 1, level with the wires that cross it and below the words),
            and it owns its presses; the covered words are set aside by the
            region test above, never by a field on a record. LEVELS 1–2 ONLY:
            at ground no sheet renders (the game switch is the look-under). */}
        {veilLive(level) &&
          veils.map((veil) => (
            <VeilSheet
              key={veilKey(veil)}
              veil={veil}
              lifted={
                lookUnderVeil !== null &&
                veilKey(lookUnderVeil) === veilKey(veil)
              }
              onOpen={() => openLookUnder(veil)}
              onRetire={() => removeVeil(veil)}
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
        {linkWiresVisible(level) &&
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
                  closeQuantity();
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
                hasQuantity={quantityTargets.has(
                  quantityTargetKey({
                    type: "flow",
                    from: link.from,
                    to: link.to,
                  }),
                )}
                onOpenQuantity={(anchor) =>
                  openQuantity(
                    { type: "flow", from: link.from, to: link.to },
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

        {/* the veil's captured box and its coin field (Epic 9 story 1): the
            rectangle the arc caught, drawn while the person names the cover and
            says why. Enter commits one line; Esc discards it. The gate is still
            armed while the field asks, so a press can neither pan the plane nor
            start a word gesture. */}
        {veilBox && <VeilDraftBox box={veilBox} />}
        {veilBox && (
          <VeilCoinField
            box={veilBox}
            onCoin={coinVeil}
            onCancel={cancelVeil}
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
            targetLabel={describeAssumptionTarget(
              assumptionPanel.target,
              nameOf,
            )}
            onAdd={(text) => addAssumption(assumptionPanel.target, text)}
            onRevise={(assumption, text) =>
              reviseAssumption(assumption, text)
            }
            onRemove={(assumption) => removeAssumption(assumption)}
            onClose={closeAssumptions}
          />
        )}

        {/* the quantities' quiet amount card (Epic 8 story 1, ADR-0020), in
            world space beside its target and counter-scaled: one field — a
            number commits the stated amount, a blank field commits the line
            with NO amount (the visible unknown, never 0), Esc discards. It
            never grows a target's box or shifts a wire's anchor. Level 2
            only — a quantity is the dynamics game's own record. */}
        {level === "dynamics" && quantityPanel && (
          <QuantityOverlay
            anchor={quantityPanel.anchor}
            targetLabel={describeQuantityTarget(quantityPanel.target, nameOf)}
            line={quantityPanel.line}
            onCommit={(amount) => {
              setQuantity(quantityPanel.target, amount);
              closeQuantity();
            }}
            onRemove={() => {
              removeQuantity(quantityPanel.target);
              closeQuantity();
            }}
            onClose={closeQuantity}
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
            name={nameOf(pointerPanel.on)}
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
            name={nameOf(peekAt.on)}
            pointer={peekAt.pointer}
            workspacePath={workspace.path}
            onClose={() => closePeek("dismiss")}
          />
        )}

        {/* the veil's look-under (Epic 9 story 2, ADR-0023 decision 3): the
            READ-ONLY transient a quiet press on a sheet opens. ONE at a time,
            world-anchored beside the opened veil's right edge and
            counter-scaled (the window idiom): the veil's coined name, its
            reason VERBATIM (World B), and the quiet ×. Esc / × / click-away / a
            level switch close it. Its cover is lifted on the plane meanwhile
            (the sheet's `lifted` prop and the words' `lifted` prop), and the
            covered prop itself is untouched — covered is not settled. LEVELS
            1–2 only (`lookUnderLive`): at ground no sheet renders, so the veil
            offers no look-under; the game switch IS the look-under there. */}
        {lookUnderLive(level) && lookUnderVeil !== null && (
          <VeilLookUnder
            veil={lookUnderVeil}
            onRename={renameLookUnder}
            onClose={() => closeLookUnder("dismiss")}
          />
        )}

        {/* THE GHOST'S DIAMOND (Epic 10 story 3): the opened preview's target,
            as the ghost's own faint hollow diamond. It is mounted from
            `previewPoint`, which answers null for every HELD proposal — so the
            map is exactly as it was while a ghost is merely held, and this is
            the ONLY ghost thing the plane ever draws. Read-only (no press). */}
        {level === "dynamics" && ghostPoint !== null && (
          <GhostDiamond at={ghostPoint} />
        )}
      </CanvasPlane>

      {/* the quiet level control (ADR-0018): an indicator of the band's game
          and a jumper between bands — the wheel is the other way */}
      <LevelControl
        level={level}
        onJump={(next) => handoff.jump(next)}
        onEditPlayingSet={openSelector}
        onCoinLoop={beginLoop}
        onDrawVeil={beginVeil}
        scenarios={scenarios}
        activeScenario={scenario}
        onChooseScenario={chooseScenario}
        onBranchScenario={branchModel}
        onRetireScenario={retireBranch}
        onCompare={openComparison}
        onAsk={openGhostPanel}
      />

      {/* the ghosts (Epic 10 story 3): the held proposals as TEXT, in arrival
          order, and — only when the person opens one — the preview with the
          read-only derived steps, the why, the reshape and the two verbs. The
          stack sits outside `.plane` beside the app's other quiet surfaces, so
          a held proposal draws nothing on the map; the dynamics game only, as
          the move belongs to it. */}
      {level === "dynamics" && (ghosts.rows.length > 0 || ghosts.opened !== null) && (
        <div className="ghost-stack">
          {ghosts.opened !== null && (
            <GhostPreview
              envelope={ghosts.opened}
              original={ghosts.draft?.original ?? null}
              nameOf={nameOf}
              draft={ghosts.draft}
              issues={ghostIssues}
              busy={ghosts.busy}
              onBeginReshape={beginGhostReshape}
              onText={ghosts.setText}
              onReason={ghosts.setReason}
              onCommit={() => void ghosts.commitReshape()}
              onCancel={ghosts.cancelReshape}
              onAccept={acceptGhostPreview}
              onReject={rejectGhostPreview}
              onClose={ghosts.close}
            />
          )}
          {ghosts.rows.length > 0 && (
            <GhostList rows={ghosts.rows} onOpen={openGhostPreview} />
          )}
        </div>
      )}

      {/* the ask surface (Epic 10 story 3): the minimal wiring of the quiet
          request and the intake. Pick one target, ask — the frozen packet's
          bytes appear — then paste a model's reply back and file it. The
          person's region is not wired here (the ADR's fallback applies), and
          the panel is deliberately plain (story 3's "no polish"). */}
      {level === "dynamics" && ghostPanelOpen && (
        <GhostPanel
          targets={ghostTargets}
          packet={ghostRequest.packet}
          askIssues={ghostAskIssues}
          intakeIssues={ghostIntakeIssues}
          onAsk={askForGhost}
          onPropose={proposeGhost}
          onClose={closeGhostPanel}
        />
      )}

      {/* the crank (Epic 8 story 3, ADR-0022): ONE hand-cranked step and,
          beneath it, that crank's OWN notes. Level 2 only — a step is the
          dynamics game's own reading. It lives outside `.plane` beside the
          level control, so the plane's armed gate never reaches it; one notch
          per press, no timer, no autoplay, nothing written. */}
      {level === "dynamics" && (
        <StepCrank
          notes={step.run?.notes ?? []}
          nameOf={nameOf}
          onCrank={step.crank}
        />
      )}

      {/* the comparison (Epic 8 story 4, ADR-0021 §7 amended): the FROZEN
          two-value reading of ONE explicitly picked branch against the
          committed model, its standing drift line, the branch's dangling
          premises said once (present tense), and the bridge's ordinary
          deliberate edits. Level 2 only — it is the dynamics game's own
          reading — and outside `.plane` like the crank, so the plane's armed
          gate never reaches its doors. */}
      {level === "dynamics" && compareOpen && (
        <ComparePanel
          branches={scenarios}
          picked={comparePick}
          comparison={comparison}
          refusal={compareRefusal}
          assumptions={assumptions}
          nameOf={nameOf}
          bridge={bridge}
          onPick={pickComparison}
          onReRead={rereadComparison}
          onClose={closeComparison}
        />
      )}

      {/* the path gesture's quiet hint (story 3): what the click does and how
          it ends; fixed in screen space, and gone with the session */}
      {pathSession && (
        <PathBar collecting={pathSession.kind === "collecting"} />
      )}

      {/* the veil's draw-box hint (Epic 9 story 1): what the drag does and how
          it ends. Fixed in screen space, gone with the arm; the coin field
          carries its own guidance. */}
      {veilArmed && <VeilBar />}

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
        level={level}
        nameOf={nameOf}
        malformed={malformedMarks}
        orphans={orphanMarks}
        malformedLinks={malformedLinks}
        orphanLinks={orphanLinks}
        malformedModel={malformedModel}
        orphanMembers={orphanMembers}
        ghostMembers={ghostMembers}
        scenario={scenario}
        malformedLoops={malformedLoops}
        orphanLoops={orphanLoops}
        malformedVeils={malformedVeils}
        malformedAssumptions={malformedAssumptions}
        duplicateAssumptions={duplicateAssumptions}
        orphanAssumptions={orphanAssumptions}
        malformedPointers={malformedPointers}
        duplicatePointers={duplicatePointers}
        orphanPointers={orphanPointers}
        malformedQuantities={malformedQuantities}
        duplicateQuantities={duplicateQuantities}
        orphanQuantities={orphanQuantities}
        outOfPlayQuantities={outOfPlayQuantities}
      />

      {/* the walk (story 3): the selected loop's derived read — steps, signs,
          named gaps and the verdict only when complete (ADR-0015) */}
      {walkRead && (
        <LoopWalk read={walkRead} nameOf={nameOf} onClose={closeWalk} />
      )}

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
 * The notices strip (ADR-0009's "surfaced, not silently hidden"; Epic 6 story
 * 3's band scoping). A quiet line of small text for record lines the app keeps
 * but cannot place (orphans, a playing set naming words that are gone) or
 * cannot read (malformed lines, a malformed model.json). No counts or badges —
 * the line is the whole surface.
 *
 * THE STRIP IS BAND-SCOPED now: it used to be the one unbanded aggregator,
 * naming every family's orphans whatever game the plane showed. It renders only
 * the groups `noticeGroups(level)` hands it — the shared "every game" group
 * (marks, which every game draws) plus the RUNNING game's own records. A
 * dynamics record's notice never appears in concept or ground, a pointer's
 * never in dynamics (ADR-0016's honest partition, ADR-0019's no-aggregation).
 * Each group carries its game's name as a quiet heading.
 *
 * NAMES, NOT SLUGS: every target is described through `nameOf`, so a person
 * reads the coined word (or loop) and the record's slug stays in the file.
 * Provisional: grouping per game rather than prefixing each line (both satisfy
 * the rule; the grouping is the quieter look), and the heading's wording/look.
 */
function MarkNotices({
  level,
  nameOf,
  malformed,
  orphans,
  malformedLinks,
  orphanLinks,
  malformedModel,
  orphanMembers,
  ghostMembers,
  scenario,
  malformedLoops,
  orphanLoops,
  malformedVeils,
  malformedAssumptions,
  duplicateAssumptions,
  orphanAssumptions,
  malformedPointers,
  duplicatePointers,
  orphanPointers,
  malformedQuantities,
  duplicateQuantities,
  orphanQuantities,
  outOfPlayQuantities,
}: {
  /** The game running now: the strip speaks only this game's records. */
  level: Level;
  /** The person's name for a slug (names-not-slugs, story 3). */
  nameOf: NameOf;
  malformed: readonly string[];
  orphans: readonly Mark[];
  malformedLinks: readonly string[];
  orphanLinks: readonly { from: string; to: string }[];
  malformedModel: string | null;
  orphanMembers: readonly string[];
  /**
   * A BRANCH's set naming slugs the map does not carry (Epic 8 story 2): our
   * nameless ghosts, surfaced here and never drawn as words.
   */
  ghostMembers: readonly string[];
  /** The branch running now (null = the committed model), for the file's path. */
  scenario: string | null;
  malformedLoops: readonly string[];
  orphanLoops: readonly string[];
  /**
   * Unreadable `map/veils.jsonl` lines (Epic 9 story 1): a veil has no
   * dependents, so it has no orphans — only lines the app keeps and cannot
   * read. Surfaced wherever the person is (the record's hygiene is not the
   * cover; the family table says so).
   */
  malformedVeils: readonly string[];
  malformedAssumptions: readonly string[];
  /** Hand-edited duplicate keys: preserved, never deduped (story 4). */
  duplicateAssumptions: readonly Assumption[];
  orphanAssumptions: readonly Assumption[];
  /** Pointers (Epic 5 story 1): unreadable lines, duplicate keys, lost owners. */
  malformedPointers: readonly string[];
  duplicatePointers: readonly Pointer[];
  orphanPointers: readonly Pointer[];
  /** Quantities (Epic 8 story 1): unreadable lines, duplicates, lost/out-of-play words. */
  malformedQuantities: readonly string[];
  duplicateQuantities: readonly Quantity[];
  orphanQuantities: readonly Quantity[];
  outOfPlayQuantities: readonly Quantity[];
}) {
  /**
   * The file a variant-owned record's line is kept in (ADR-0021): `map/` for
   * the committed model, the branch's folder while one runs. The strip names
   * the file the line is ACTUALLY in — a ghost is kept in the branch's
   * `model.json`, never in `map/`'s.
   */
  const recordFile = (name: string): string =>
    scenario === null ? "map/" + name : "scenarios/" + scenario + "/" + name;

  // Which families actually have something to say right now.
  const has: Record<NoticeFamily, boolean> = {
    marks: malformed.length > 0 || orphans.length > 0,
    links: malformedLinks.length > 0 || orphanLinks.length > 0,
    model:
      malformedModel !== null ||
      orphanMembers.length > 0 ||
      ghostMembers.length > 0,
    loops: malformedLoops.length > 0 || orphanLoops.length > 0,
    veils: malformedVeils.length > 0,
    assumptions:
      malformedAssumptions.length > 0 ||
      duplicateAssumptions.length > 0 ||
      orphanAssumptions.length > 0,
    pointers:
      malformedPointers.length > 0 ||
      duplicatePointers.length > 0 ||
      orphanPointers.length > 0,
  };
  // Quantities are dynamics' own record (Epic 8 story 1), and their lines are
  // surfaced under dynamics' heading. They ride the group directly rather than
  // joining `NoticeFamily`: that table names map FAMILIES (things drawn on the
  // plane), and a quantity is a VALUE property of a word or a pair — it has no
  // standalone surface of its own (a distance's word has none either). The
  // notices still say where each kept line lives.
  const hasQuantities =
    level === "dynamics" &&
    (malformedQuantities.length > 0 ||
      duplicateQuantities.length > 0 ||
      orphanQuantities.length > 0 ||
      outOfPlayQuantities.length > 0);
  // The running game's groups, with the empty families dropped; a group with
  // nothing left is dropped too, so no bare heading ever renders (the dynamics
  // group survives when it is only carrying quantity lines).
  const groups = noticeGroups(level)
    .map((group) => ({
      ...group,
      families: group.families.filter((family) => has[family]),
    }))
    .filter(
      (group) =>
        group.families.length > 0 ||
        (group.game === "dynamics" && hasQuantities),
    );
  if (groups.length === 0) return null;

  function familyLines(family: NoticeFamily) {
    switch (family) {
      case "marks":
        return (
          <>
            {orphans.map((mark, index) => (
              <div className="mark-notice" key={`orphan-${index}`}>
                unattached mark on {describeMarkTarget(mark.target, nameOf)} —
                kept in map/marks.jsonl
              </div>
            ))}
            {malformed.map((line, index) => (
              <div className="mark-notice" key={`malformed-${index}`}>
                unreadable line in map/marks.jsonl: {line}
              </div>
            ))}
          </>
        );
      case "links":
        return (
          <>
            {orphanLinks.map((link, index) => (
              <div className="mark-notice" key={`link-${index}`}>
                a link names “{nameOf(link.from)} → {nameOf(link.to)}” — not on
                the map, kept in {recordFile("links.jsonl")}
              </div>
            ))}
            {malformedLinks.map((line, index) => (
              <div className="mark-notice" key={`malformed-link-${index}`}>
                unreadable line in {recordFile("links.jsonl")}: {line}
              </div>
            ))}
          </>
        );
      case "model":
        return (
          <>
            {orphanMembers.map((slug) => (
              <div className="mark-notice" key={`member-${slug}`}>
                playing set names “{nameOf(slug)}” — not on the map, kept in{" "}
                {recordFile("model.json")}
              </div>
            ))}
            {/* A branch's unmatched slugs (Epic 8 story 2, ADR-0021 decision
                4): a NAMELESS GHOST — surfaced here, never drawn as a word. */}
            {ghostMembers.map((slug) => (
              <div className="mark-notice" key={`ghost-${slug}`}>
                the branch names “{nameOf(slug)}” — no such word on the map: a
                nameless ghost, kept in {recordFile("model.json")}
              </div>
            ))}
            {malformedModel !== null && (
              <div className="mark-notice">
                unreadable {recordFile("model.json")} — kept as is until a
                playing set is accepted
              </div>
            )}
          </>
        );
      case "loops":
        return (
          <>
            {orphanLoops.map((slug) => (
              <div className="mark-notice" key={`loop-word-${slug}`}>
                a loop's path names “{nameOf(slug)}” — not on the map, kept in
                map/loops.jsonl
              </div>
            ))}
            {malformedLoops.map((line, index) => (
              <div className="mark-notice" key={`malformed-loop-${index}`}>
                unreadable line in map/loops.jsonl: {line}
              </div>
            ))}
          </>
        );
      case "veils":
        return (
          <>
            {malformedVeils.map((line, index) => (
              <div className="mark-notice" key={`malformed-veil-${index}`}>
                unreadable line in map/veils.jsonl: {line}
              </div>
            ))}
          </>
        );
      case "assumptions":
        return (
          <>
            {orphanAssumptions.map((assumption, index) => (
              <div className="mark-notice" key={`orphan-assumption-${index}`}>
                an assumption on{" "}
                {describeAssumptionTarget(assumption.target, nameOf)} — not on
                the map, kept in map/assumptions.jsonl
              </div>
            ))}
            {malformedAssumptions.map((line, index) => (
              <div className="mark-notice" key={`malformed-assumption-${index}`}>
                unreadable line in map/assumptions.jsonl: {line}
              </div>
            ))}
            {duplicateAssumptions.map((assumption, index) => (
              <div
                className="mark-notice"
                key={`duplicate-assumption-${index}`}
              >
                a duplicate assumption line says “{assumption.text}” on{" "}
                {describeAssumptionTarget(assumption.target, nameOf)} — kept in
                map/assumptions.jsonl
              </div>
            ))}
          </>
        );
      case "pointers":
        return (
          <>
            {orphanPointers.map((pointer, index) => (
              <div className="mark-notice" key={`orphan-pointer-${index}`}>
                a pointer on “{nameOf(pointer.on)}” — not on the map, kept in
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
                a duplicate pointer line on “{nameOf(pointer.on)}” (
                {pointer.form}) — kept in map/pointers.jsonl
              </div>
            ))}
          </>
        );
    }
  }

  return (
    <div className="mark-notices">
      {groups.map((group) => (
        <div
          className="mark-notice-group"
          key={group.game}
          data-game={group.game}
        >
          <div className="mark-notice-game">{group.label}</div>
          {group.families.map((family) => (
            <Fragment key={family}>{familyLines(family)}</Fragment>
          ))}
          {group.game === "dynamics" && hasQuantities && (
            <>
              {orphanQuantities.map((quantity, index) => (
                <div className="mark-notice" key={`orphan-quantity-${index}`}>
                  a quantity on {describeQuantityTarget(quantity, nameOf)} — not on the map,
                  kept in {recordFile("quantities.jsonl")}
                </div>
              ))}
              {outOfPlayQuantities.map((quantity, index) => (
                <div className="mark-notice" key={`out-quantity-${index}`}>
                  a quantity on {describeQuantityTarget(quantity, nameOf)} — outside the
                  playing set, kept in {recordFile("quantities.jsonl")}
                </div>
              ))}
              {malformedQuantities.map((line, index) => (
                <div className="mark-notice" key={`malformed-quantity-${index}`}>
                  unreadable line in {recordFile("quantities.jsonl")}: {line}
                </div>
              ))}
              {duplicateQuantities.map((quantity, index) => (
                <div className="mark-notice" key={`duplicate-quantity-${index}`}>
                  a duplicate quantity line on {describeQuantityTarget(quantity, nameOf)} —
                  kept in {recordFile("quantities.jsonl")}
                </div>
              ))}
            </>
          )}
        </div>
      ))}
    </div>
  );
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
