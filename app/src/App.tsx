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
  offeredCreationKinds,
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
import { SketchLayer } from "./canvas/SketchLayer";
import { GroundEmpty, GroundLayer } from "./canvas/GroundLayer";
import {
  FIND_MARK_MS,
  FindPill,
  findLandingPoint,
  type FindMark,
  type FindableCard,
} from "./canvas/FindPill";
import {
  ASK_RESTORE_SENTENCE,
  SESSION_RESTORE_SENTENCE,
  GroundToast,
} from "./canvas/GroundToast";
import { GestureChip } from "./canvas/GestureChip";
import { ArmedBar } from "./canvas/ArmedBar";
import {
  armedKind,
  GESTURE_IDLE,
  type GestureNarration,
} from "./canvas/gestureWord";
import { createTurnPort } from "./turn/sidecar";
import { loadReadingPreference, loadCardPreference } from "./lib/appConfig";
import {
  DEFAULT_CARD_PREFERENCE,
  FRAME_WEIGHT_PX,
  SETTLE_MS,
  type CardPreference,
} from "./lib/cardPreference";
import {
  looksBySlug,
  parseLooks,
  saveLook,
  type CardLook,
} from "./map/looks";
import {
  DEFAULT_READING_PREFERENCE,
  type ReadingPreference,
} from "./lib/readingPreference";
import { loadTurnSettings } from "./turn/provider";
import {
  formatProviderRef,
  PROVIDER_SENTENCES,
  resolveManager,
  resolveSelection,
} from "./turn/providers";
import type { AskCallsFacts } from "./canvas/contactRules";
// STORY 16.29 — the effort options a task model's catalogue entry declares are
// read HERE, once, from the committed export; the card never guesses a level.
import { catalogEffortOptions } from "./turn/providerCatalog";
import { TURN_SENTENCES, routeOf } from "./turn/turn";
import { readProposal } from "./turn/proposal";
import { readSecret, secretStatus, secretStatusWords } from "./lib/secret";
import {
  SettingsPanel,
  type SettingsSection,
} from "./canvas/SettingsPanel";
import { NO_PROVIDER_SENTENCE, sendPacketApp } from "./turn/egress";
import {
  fetchAskBlock,
  readAskContext,
  type AskCardFacts,
  type AskContext,
} from "./turn/context";
import type { AskPacket } from "./turn/packet";
import { readingFor } from "./map/readings";
import type { Media } from "./map/media";
import { GroundGuides } from "./canvas/GroundGuides";
import { GroundWires } from "./canvas/GroundWires";
import { createGroundDragChannel } from "./canvas/groundDragRef";
import { createWorkingChannel } from "./canvas/workingRef";
import { GroundBubble, type GroundIntent } from "./canvas/GroundBubble";
import { GroundDropNotice } from "./canvas/GroundDropNotice";
import {
  dropBlocked,
  dropLandsOnCard,
  dropWorldPoint,
  runOsDrop,
  type DropClientPoint,
} from "./canvas/osDrop";
import { listenOsDrop, type OsDrop } from "./canvas/osDropWindow";
import { NOT_A_FILE_OR_LINK } from "./canvas/webLink";
import {
  pasteBelongsToField,
  pasteClientPoint,
  pasteName,
  pasteUrl,
  pasteWorldPoint,
} from "./canvas/linkPaste";
import { useGround, type GroundAddResult } from "./canvas/useGround";
import {
  COMMAND_FAILED_SENTENCE,
  COMMAND_GHOST_REFUSAL_PREFIX,
  CommandCard,
  EMPTY_COMMAND_THREAD,
  appendExchange,
  appliedExchange,
  clarifiedInstruction,
  commandAnchor,
  actLine,
  commandSendDisabled,
  commandTurnOf,
  failedExchange,
  failureReport,
  historyTurns,
  lastAppliedExchangeOf,
  nothingExchange,
  readInstructionInPhases,
  refusedExchange,
  undoExchangeOf,
  undoOfferOf,
  undoSecondSentence,
  type CommandBusy,
  type CommandExchange,
  type CommandQuestion,
  type CommandThread,
  type CommandView,
} from "./canvas/CommandCard";

import {
  applyCommandScript,
  createAttentioneerHost,
  type CommandApply,
  type CommandIo,
} from "./commands/attentioneerHost";
import { appendCommandMove, interpretInstruction } from "./commands/interpreterCall";
import { devCommandsPath } from "./dev/gate";
import { interpreterDigestOf } from "./commands/interpreterDigest";
import type { InterpreterRead } from "./commands/interpreter";
import type { CommandAct } from "./commands/acts";
import {
  createDirAll,
  createMarkerExclusive,
  listDir,
  readTextFile,
  removeFile,
  writeTextFile,
} from "./lib/fs";
import { newWireClaim } from "./canvas/hookedWire";
import { SketchToolbar } from "./canvas/SketchToolbar";
import { LanguageGameBar } from "./canvas/LanguageGameBar";
import { LanguageGameFill } from "./canvas/LanguageGameFill";
import { LanguageGamePopup } from "./canvas/LanguageGamePopup";
import { LanguageGamesPanel } from "./canvas/LanguageGamesPanel";
import {
  DEFAULT_SHAPE_MODE,
  GAME_DRAFT_OPACITY,
  GAME_FILL_OPACITY,
  GAME_FOCUS_OPACITY,
  gameInk,
  gameMembership,
  languageGamesLive,
  pickPastel,
  shapeAnchor,
  shapeCenter,
  submitProblem,
  type LanguageGameDraft,
  type ShapeMode,
  type SubmitProblem,
} from "./canvas/languageGameRules";
import type { GameShape, LanguageGame } from "./map/languageGames";
import { syncOntology, type OntologySnapshot } from "./ontology/sync";
import {
  DEFAULT_DRAW_TOOL,
  DEFAULT_PEN_COLOR,
  DEFAULT_PEN_SIZE,
  type DrawTool,
} from "./canvas/sketchRules";
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
import { PrismWindow } from "./canvas/PrismWindow";
import { CANNOT_READ_LOG, NOT_LOGGED } from "./canvas/prismRules";
import { PullPanel } from "./canvas/PullPanel";
import { askPull, type PullReading } from "./pull/ask";
import {
  AskPanel,
  type AskSentView,
  type AskSessionView,
} from "./canvas/AskPanel";
import { MakePanel } from "./canvas/MakePanel";
import {
  ASK_CONTEXT_READING,
  ASK_KEEP_FAILED,
  ASK_NEEDS_QUESTION,
  ASK_READ_MISSED,
  ASK_SEND_FAILED,
} from "./canvas/contactRules";
import {
  readLatestPrism,
  runEgressMove,
  runMakeMove,
  runReadMove,
  savePrismExplanation,
  sendAskOut,
  intakeAsk,
  closeAsk,
} from "./contacts/prismLog";
import type {
  AskEnding,
  AskPointer,
  AskResponse,
  AskTransport,
  InFlightAsk,
} from "./contacts/ask";
import type { ReadContactKind } from "./contacts/read";
import type { Prism } from "./map/prisms";
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
import { loadCards } from "./map/cards";
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
import { planeHint, showsMapContent } from "./canvas/mapContentRules";
import { STEP_CRANK_HIDDEN, offered } from "./canvas/deprecations";
import {
  heldLeftOfTheFold,
  recordSetAside,
  setAsideShown,
  shelfShown,
  zoomSwitchesMap,
} from "./canvas/shelfRules";
import { createWriteQueue, type WriteQueue } from "./lib/writeQueue";
import {
  createScenario,
  listScenarios,
  readScenarioPins,
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
 * empty plane opens a small menu there. DEPRECATED (hidden 2026-11-16 per user
 * review): the menu's lack kind is hidden (and, per the separate-maps review
 * further down, the WORD is concept-only), so at concept the bubble paints the
 * word above the anchor dot and the pen's draw below it — a single click
 * creates nothing. STORY 17.10: GROUND opens the SAME bubble component with the
 * ground's doors (ask first, then the reference doors, session last); the
 * reference form opens only after a door was chosen.
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
 * SUPERSEDED BY ADR-0032 (recorded, not rewritten — 2026-11-16): the two Epic 6
 * paragraphs below describe the ZOOM BAND AS THE GAME, which the fourth review
 * retired. The maps are separate mini-apps now; the TABS switch maps, the wheel
 * only zooms within the current map, and each map keeps its own camera. Every
 * piece named below stays written and type-checked behind `zoomSwitchesMap`
 * (`canvas/shelfRules.ts`) and simply stops driving the switch.
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
 *
 * THE SEPARATE-MAPS REVIEW (DEPRECATED, hidden 2026-11-16 per user review) is
 * the last word on WHAT RENDERS. The person's verdict: the three games' maps
 * will NOT be the same maps — dynamics will grow modeling surfaces and ground
 * file references, LATER. Until then the concept map's content renders at
 * CONCEPT ONLY (`canvas/mapContentRules.ts`, behind a deprecations.ts flag),
 * and the dynamics and ground maps are blank paper: no words, wires, marks,
 * shelf, veils, links, loops, assumptions, quantities, reach handles or
 * branch-derived readings. Everything stays WRITTEN (records, panels, handlers,
 * pure rules); each render reads the ONE rule, so flipping the flag back
 * restores the content with no edit here. The quiet chrome — paper, pan, zoom,
 * the zoom chip, the level tabs, the pen's strip — and the PEN'S INK
 * (`SketchLayer`, PROVISIONAL) keep rendering in every game, and the HONESTY
 * SURFACES (`MarkNotices` and every scan) are deliberately not gated: an
 * unreadable record is surfaced whatever the plane shows.
 */
/**
 * THE TURN PORT (Epic 15 story 1): one for the window. It holds no process —
 * `turn/sidecar.ts` asks Rust for a child on first use, and Rust owns that
 * child's life (ADR-0034) — so a module-level value is safe here and lets the
 * panel be a plain prop consumer. Nothing is spawned until the person presses
 * send on a card.
 */
const turnPort = createTurnPort();

/**
 * STORY 21.3 — THE COMMAND CARD'S BRIDGE (ADR-0038 decisions 3 and 6). The
 * app's adapter (commands/attentioneerHost.ts) takes the fs port as data, so
 * the window passes the SAME Tauri bridge every other write uses. No second
 * write path is created: the host's proposals go through the existing ghost
 * intake and its accepts are the app's own accept.
 */
const tauriCommandIo: CommandIo = {
  readTextFile: (path) => readTextFile(path),
  writeTextFile: (path, content) => writeTextFile(path, content),
  removeFile: (path) => removeFile(path),
  listDir: (path) => listDir(path),
  createDirAll: (path) => createDirAll(path),
  createMarkerExclusive: (path) => createMarkerExclusive(path),
};

/** The instruction's three wiring sentences (PROVISIONAL wording). */
const COMMAND_NO_WORKSPACE_SENTENCE = "there is no workspace open.";
const COMMAND_NO_MANAGER_SENTENCE =
  "no manager model is configured, so nothing was interpreted.";
const COMMAND_INTERPRET_FAILED_SENTENCE =
  "the instruction could not be read, so nothing was applied.";

function App() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  // The map on screen. DEPRECATED (hidden 2026-11-16 per user review — separate
  // mini-apps, ADR-0032): this state used to follow the ZOOM BAND as the handoff
  // sampled it, so a settled wheel crossing or a deliberate jump set it. Now the
  // TABS set it (and the workspace's open-restore reads the `level` key); the
  // wheel only zooms within the current map. The band machinery below stays
  // written behind `canvas/shelfRules.ts`'s `zoomSwitchesMap` — delete the
  // zoom-derived path in the deprecated sweep.
  const [level, setLevel] = useState<Level>(DEFAULT_LEVEL);
  // The camera, PER MAP: switching maps with the tabs restores that map's own
  // position and zoom, exactly like a little app (PROVISIONAL — the alternative
  // was one shared camera).
  const { camera, intents } = useCamera(level);
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
    // The map's ink (added 2026-11-16 per user review).
    sketches,
    malformedSketches,
    canUndoSketch,
    // The concept map's language games (PROVISIONAL, added 2026-11-16 per the
    // lead's brief).
    languageGames,
    malformedLanguageGames,
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
    addSketch,
    eraseSketch,
    undoSketch,
    clearSketch,
    createLanguageGame,
    removeLanguageGame,
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

  // The ground map's OWN records (story 16.1): loaded from `map/ground.txt`,
  // `map/readings.txt` and `map/readings/<slug>.md` whenever the workspace
  // opens, and written through its own per-file queue. The concept map's
  // reload never touches it (the maps are separate, ADR-0032).
  // STORY 17.1: the ground hook also owns the ask cards' records. Story 17.7
  // retired the card's embedded panel, so this is the ONE turn port every ask
  // card sends through — the existing card-ask path, not a second one.
  const ground = useGround(workspace?.path ?? "", turnPort);

  /**
   * STORY 16.25 — THE MAP'S ONE IN-FLIGHT DRAG. The layer's cards publish the
   * point the hand is carrying and the wires read it; both halves of the story
   * share this one channel, made once for the mounted map. It holds view state
   * only: nothing here is a record, and the release is still the one write.
   */
  const groundDrag = useRef(createGroundDragChannel()).current;
  // STORY 24-15 — THE WORKING SIGNAL's one channel: the cards publish their
  // work, the wires carry the current. Made once per mounted map (the drag
  // channel's own idiom), handed to both sides below.
  const groundWorking = useRef(createWorkingChannel()).current;

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
  // The ontology export's one surface (PROVISIONAL, added 2026-11-16 per
  // ADR-0033): the quiet clauses for files the app found in `ontology/` that it
  // did not write. It never says anything about the games themselves.
  const [ontologyNotices, setOntologyNotices] = useState<string[]>([]);
  // One ontology rebuild at a time, in the order the map changed (the family's
  // in-order queue idiom): a burst of writes must land newest-last, never as an
  // older snapshot's file reappearing under a newer one.
  const ontologyWriteRef = useRef<Promise<void>>(Promise.resolve());
  // The bare lack whose name field is open (double-clicked ring), if any.
  const [growAt, setGrowAt] = useState<Point | null>(null);
  // The plane point where the double-click creation menu is open, if any.
  const [menuAt, setMenuAt] = useState<Point | null>(null);
  // The ground map's creation bubble, at the double-clicked point (story
  // 16.1). STORY 17.10: the double-click now opens the CONCEPT MAP'S BUBBLE
  // (canvas/PlaneMenu.tsx) with the ground's doors, so this form opens only
  // after a reference door was chosen, already on that intent.
  //
  // STORY 20.3 — a wire drag released on empty paper opens this SAME bubble,
  // and the point carries the card the drag began from as its hookup. The
  // hookup lives and dies with the bubble: closing it IS the cancel, because
  // no card and no wire were written yet. PROVISIONAL: the hookup rides on the
  // point (one bubble, one promise).
  const [groundAt, setGroundAt] = useState<(Point & { hookup?: string }) | null>(
    null,
  );
  /**
   * STORY 20.3 — the ONE wire an opened bubble may owe: its first landed card
   * spends the claim, so a second creation from the same bubble cannot wire
   * twice.
   */
  const groundHookupClaimRef = useRef(newWireClaim());
  /** Which door the ground bubble opened from (story 17.10, ask added 21.13). */
  const [groundIntent, setGroundIntent] = useState<GroundIntent>("file");
  /**
   * STORY 17.10 — THE GROUND DOUBLE-CLICK'S BUBBLE, at the point. This is the
   * SAME component the concept map opens (canvas/PlaneMenu.tsx), handed the
   * ground's doors; there is no second bubble.
   */
  const [groundMenuAt, setGroundMenuAt] = useState<Point | null>(null);
  /**
   * STORY 16.20 — a refused OS drop's ONE sentence, at the point it landed.
   * VIEW STATE, never a record: it is written by the drop's own handler, shown
   * where the pointer was, and cleared by itself. The next drop replaces it.
   */
  const [dropNotice, setDropNotice] = useState<{
    at: Point;
    text: string;
    taken: number;
  } | null>(null);
  /**
   * STORY 17.10 — the ask card the ASK door just made, so the layer can open
   * it. A fresh token per creation keeps a later render from reopening a card
   * the person closed.
   */
  const [revealAsk, setRevealAsk] = useState<{ slug: string } | null>(null);
  /**
   * STORY 21.7 — THE QUESTIONS A COMMAND LEFT WAITING, one per ask card its
   * accept created. This is the draft mechanism's LAST leg: the accepted
   * proposal's question (view state, never a record) is handed to the layer,
   * which hands it to that card's composer. The token makes each hand-over
   * ONCE, so a re-render never refills a field the person is editing.
   */
  const [askDrafts, setAskDrafts] = useState<
    readonly { slug: string; question: string; token: number }[]
  >([]);
  const askDraftToken = useRef(0);
  // Another workspace starts with no ground draft (its map folder is another
  // map's truth; the bubbles must never write into a map not opened on).
  useEffect(() => {
    setGroundAt(null);
    setGroundMenuAt(null);
    setGroundIntent("file");
    setRevealAsk(null);
    setAskDrafts([]);
  }, [workspace?.path]);
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
  // The map's pen (added 2026-11-16 per user review): its own gate mode, its
  // ink and its thickness. The mode is an ARM like the veil's draw box — while
  // it is live pan, creation and every word press stand still — and the pen's
  // capture surface (CanvasPlane) owns the pointer. The strokes themselves are
  // committed-model records through useMap (`map/sketches.jsonl`).
  const [drawArmed, setDrawArmed] = useState(false);
  const [penColor, setPenColor] = useState<string>(DEFAULT_PEN_COLOR);
  const [penSize, setPenSize] = useState<number>(DEFAULT_PEN_SIZE);
  // The tool the armed drag carries (added 2026-11-16 per user review): the pen
  // draws, the eraser takes whole strokes away. PROVISIONAL — the eraser is NOT
  // a second arm; it reuses the pen's `draw` gate and this state chooses the
  // gesture's meaning, so the arming discipline is identical. The choice
  // outlives one arm: putting the pen down and picking it up keeps the tool.
  const [penTool, setPenTool] = useState<DrawTool>(DEFAULT_DRAW_TOOL);
  // STORY 16.16 (shortlist items 4 and 5) — THE GESTURE IN FLIGHT. ONE piece of
  // VIEW state says what the hand is doing right now; the card's drag, the link
  // drag, the plane's pan/zoom and the pen REPORT it (they own the raw
  // listeners and the single threshold), and the chip only renders its sentence
  // in screen space. `idle` is not a gesture: nothing is drawn for it, and the
  // state is forgotten on release and on window blur — it is never a record.
  const [gesture, setGesture] = useState<GestureNarration>(GESTURE_IDLE);
  // STORY 16.33 — FIND ON THE MAP. The pill is a screen-space surface with
  // three pieces of VIEW state: whether its field is open, and the card it
  // last landed on (the map's brief marker). Neither is ever a record; the
  // search reads names and notes the load already carries.
  const [findOpen, setFindOpen] = useState(false);

  const [findMark, setFindMark] = useState<FindMark | null>(null);
  const narrate = useCallback((next: GestureNarration) => {
    setGesture(next);
    // A REAL map move clears the landing's marker: the ring is tied to where
    // the eye was taken, and once the hand moves the map it is no longer
    // where anything is. A programmatic landing never narrates, so the mark
    // it just set is not cleared by its own pan.
    if (next.kind === "panning" || next.kind === "zooming") setFindMark(null);
  }, []);

  /**
   * STORY 16.33 — WHAT THE FINDER SEES: every card on the ground map, in the
   * map's OWN order (references, then ask cards, then session cards — the
   * order GroundLayer draws them in), carrying only what is searched (the
   * name, the note) and the point a landing centres. Ask and session cards
   * have no note file, so their second searched text is simply absent.
   */
  const findableCards = useMemo<FindableCard[]>(
    () => [
      ...ground.references.map((reference) => ({
        on: reference.on,
        name: reference.name,
        note: ground.notes[reference.on],
        x: reference.x,
        y: reference.y,
      })),
      ...ground.asks.map((ask) => ({
        on: ask.on,
        name: ask.name,
        x: ask.x,
        y: ask.y,
      })),
      ...ground.sessions.map((session) => ({
        on: session.on,
        name: session.name,
        x: session.x,
        y: session.y,
      })),
    ],
    [ground.references, ground.asks, ground.sessions, ground.notes],
  );

  /**
   * STORY 16.33 — LANDING IS A PAN, NOT A FIT. The pure helper finds the
   * centre of the card's resting box; the camera's existing centerOn intent
   * then puts that point at the middle of the viewport at the zoom the map is
   * ALREADY at (App's list-pick idiom, one seam over). Nothing here re-derives
   * a camera transform, nothing changes the scale, and the card is marked for
   * a brief moment so the eye can find it once the map has moved.
   */
  const landOnFoundCard = useCallback(
    (card: FindableCard) => {
      const target = findLandingPoint(card);
      const el = document.querySelector<HTMLDivElement>(".plane");
      if (!el) return;
      intents.centerOn(
        target.x,
        target.y,
        el.clientWidth / 2,
        el.clientHeight / 2,
        // A PAN: the camera's current zoom, never a landing zoom.
        camera.zoom,
      );
      setFindMark({ on: card.on, x: card.x, y: card.y });
    },
    [intents, camera.zoom],
  );

  /** Closing the pill closes the search AND its brief marker — nothing else. */
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setFindMark(null);
  }, []);

  // The marker is BRIEF: it clears itself after its stated moment unless a
  // newer landing replaced it. Closing and a real map move clear it sooner.
  useEffect(() => {
    if (findMark === null) return;
    const mark = findMark;
    const timer = setTimeout(() => {
      setFindMark((current) => (current === mark ? null : current));
    }, FIND_MARK_MS);
    return () => clearTimeout(timer);
  }, [findMark]);

  // THE SHORTCUT (Ctrl/Cmd+F) — the field's other door beside its own verb.
  // It declines while a text field holds focus, so it can NEVER steal a card's
  // typing (the card's rename field or note editor keeps the keystroke), and
  // it exists only on the ground map, where the finder's cards are.
  useEffect(() => {
    if (level !== "ground") return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() !== "f") return;
      const active = document.activeElement;
      const focused = focusStateOf(active instanceof HTMLElement ? active : null);
      // A field that is NOT the pill's own keeps the keystroke.
      if (focused === "text" && !findOpen) return;
      e.preventDefault();
      setFindOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [level, findOpen]);

  // Leaving the ground map leaves the search: the pill is that map's surface,
  // and the marker belongs to a card that is no longer drawn.
  useEffect(() => {
    if (level === "ground") return;
    setFindOpen(false);
    setFindMark(null);
  }, [level]);

  // THE SELECTION TOOL (PROVISIONAL, added 2026-11-16 per the lead's brief): a
  // concept-map arm that draws a shape and makes a LANGUAGE GAME of the words
  // inside it. Its own gate mode (`select`), its own shape mode (freeform is
  // the opening reading), and the draft a completed selection holds while the
  // naming popup asks: the shape, the pastel picked for it, and whether the
  // region holds a word (the one membership fact submit needs). The list and
  // the game brought forward from it are the panel's state.
  const [selectArmed, setSelectArmed] = useState(false);
  const [selectShape, setSelectShape] = useState<ShapeMode>(
    DEFAULT_SHAPE_MODE,
  );
  const [gameDraft, setGameDraft] = useState<LanguageGameDraft | null>(null);
  const [gamesOpen, setGamesOpen] = useState(false);
  const [focusedGame, setFocusedGame] = useState<string | null>(null);
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
  // THE PULL ASK (Epic 13 story 2, ADR-0030): the reading the one press made,
  // or null while the surface is closed. It is EPHEMERAL app state — a value
  // read on a press and dropped when the surface closes. There is no dismissal
  // state, no suppression list and no stored last reading: closing IS the
  // dismissal, and the next ask reads the records again.
  const [pullReading, setPullReading] = useState<PullReading | null>(null);
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
  // The open PRISM window (Epic 12 story 2, ADR-0029 rule 6): the ONE Move it
  // shows (or null for a reach with no Move yet), the word it hangs beside and
  // the world point. ONE at a time; a completed read Move opens it, and the
  // pointer's quiet log button reopens the reach's latest PRISM. It is
  // rendered here so it never grows a word's box or shifts a wire's anchor.
  const [prismAt, setPrismAt] = useState<{
    on: string;
    anchor: Point;
    prism: Prism | null;
    note: string | null;
  } | null>(null);
  // The word the PRISM window belongs to, kept for the focus return.
  const prismSlugRef = useRef<string | null>(null);
  // The quiet MAKE panel (Epic 12 story 3): the word whose artifact is being
  // written and the world point the panel hangs beside. One at a time; the
  // person's press IS the accept (no gate).
  const [makeAt, setMakeAt] = useState<{
    on: string;
    anchor: Point;
  } | null>(null);
  // The panel's quiet sentence and its in-flight write.
  const [makeNote, setMakeNote] = useState<string | null>(null);
  const [makeBusy, setMakeBusy] = useState(false);
  // The quiet ASK panel (Epic 12 story 3): the word it asks on, the world
  // point, and the reach the question rides (null = no reach at all).
  const [askAt, setAskAt] = useState<{
    on: string;
    anchor: Point;
    ride: AskPointer | null;
  } | null>(null);
  // The ask's in-flight Move and its CONTENT. Both are EPHEMERAL app state:
  // the question's packet and the response's text live here (and in the panel)
  // until the person keeps the response — the app writes neither.
  const [askSession, setAskSession] = useState<InFlightAsk | null>(null);
  const [askResponse, setAskResponse] = useState<AskResponse | null>(null);
  // THE WORDS AS THEY ARRIVE (story 7b) and how the app-sent turn ended. The
  // partial is KEPT after a stop/break/timeout, but the ending — not the words
  // — is what the one record was formed from. Both are ephemeral view state.
  const [askPartial, setAskPartial] = useState<string | null>(null);
  const [askEnding, setAskEnding] = useState<AskEnding | null>(null);
  // The ONE PRISM the completed Ask appended, held for its window (one Move).
  const [askPrism, setAskPrism] = useState<Prism | null>(null);
  const [askSentNote, setAskSentNote] = useState<string | null>(null);
  const [askNote, setAskNote] = useState<string | null>(null);
  const [askKept, setAskKept] = useState(false);
  const [askBusy, setAskBusy] = useState(false);
  // The app-sent route's own two reads (Epic 15 story 2): the stated fallback
  // sentence (no provider, or a sidecar that cannot start) and whether the turn
  // is running now (the panel's stop verb). A fallback is not an Ask failure.
  const [askFallback, setAskFallback] = useState<string | null>(null);
  const [askAppRunning, setAskAppRunning] = useState(false);
  // THE PACKET'S PREVIEWS AND READBACK (Epic 15 story 3): the bounded previews
  // read for the CURRENT inclusion, whether a provider is configured (null
  // until the config answers), the last inclusion the panel asked for, and
  // every message that left. All of it EPHEMERAL app state — none is a record,
  // and the app writes none of it.
  const [askContext, setAskContext] = useState<AskContext | null>(null);
  const [askProvider, setAskProvider] = useState<boolean | null>(null);
  /**
   * STORY 17.13 — THE TWO CALLS an ask card's send will make, read from the
   * SAME config read as askProvider (ADR-0037 decision 1: the declaration
   * names both). The task row/model are always there when anything resolves;
   * the manager is null when no manager model resolves at all, so the card can
   * say a rule will make the card instead of promising a second call.
   * EPHEMERAL app state — never a record.
   */
  const [askCalls, setAskCalls] = useState<AskCallsFacts | null>(null);
  /**
   * STORY 16.29 — THE EFFORT VALUES the resolved task model's catalogue entry
   * declares, or [] when it declares none (or the row is not an HTTP endpoint
   * the catalogue lists). The ask card offers a selector ONLY for a non-empty
   * list; a level the catalogue never stated is never offered.
   */
  const [askEfforts, setAskEfforts] = useState<readonly string[]>([]);
  const [askIncluded, setAskIncluded] = useState<AskPointer[]>([]);
  const [askSent, setAskSent] = useState<AskSentView | null>(null);
  // WHICH PROVIDER, AND WHERE THE KEY LIVES (Epic 15 story 4): the selection's
  // providerId:modelId for the Ask panel's one line, and the store sentence.
  // Neither is a key value — the key never enters a field.
  const [askProviderRef, setAskProviderRef] = useState<string | null>(null);
  const [askKeyStore, setAskKeyStore] = useState<string | null>(null);
  // THE SETTINGS MODAL (story 15.10): which section is on screen, and whether
  // it is open. It is app chrome, not a map surface — reachable from every map
  // and from the ask panels' configure shortcut (which opens Providers).
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] =
    useState<SettingsSection>("providers");
  // STORY 17 (shortlist items 7–9): the person's STATED fold threshold. The app
  // holds the current value so every ground card re-crops when Settings writes
  // a new one; the defaults stand until the config answers, and nothing here
  // counts or tracks what was read.
  // STORY 25-14 — the cards' stated knobs (Settings is the only writer).
  const [cardPreference, setCardPreference] = useState<CardPreference>(
    DEFAULT_CARD_PREFERENCE,
  );
  // STORY 25-17 — THE CARDS' OWN LOOKS. The RECORD is the map's own
  // looks.jsonl; this is the read side (view state), and the gear's picker is
  // the one writer. PROVISIONAL: the state's home beside the preference (the
  // look family may ride the ground hook with the media later).
  const [cardLooks, setCardLooks] = useState<Readonly<Record<string, CardLook>>>(
    {},
  );
  const [readingPreference, setReadingPreference] =
    useState<ReadingPreference>(DEFAULT_READING_PREFERENCE);
  // The ghost's ask surface (Epic 10 story 3): the one panel where the person
  // asks for a packet or hands a model's reply back. It sits outside `.plane`
  // like the control's other actions; closed by Esc, its ×, or a level switch
  // (never by a press away: it can hold typed prose).
  const [ghostPanelOpen, setGhostPanelOpen] = useState(false);
  // THE GHOST'S TURN (Epic 15 story 8): the answer as it came back, the one
  // sentence beside it, and whether the app is carrying the frozen packet.
  // All view state: the turn writes no record, and a usable proposal becomes a
  // ghost row through the EXISTING intake.
  const [ghostSending, setGhostSending] = useState(false);
  const [ghostAnswer, setGhostAnswer] = useState<string | null>(null);
  const [ghostTurnNote, setGhostTurnNote] = useState<string | null>(null);
  // A workspace that resumed in dynamics with no set prompts the selector once.
  const autoPromptedRef = useRef<string | null>(null);
  // STORY 21.3 — THE COMMAND CARD (ADR-0038 decisions 1 and 4). CLOSED by
  // default, on every map. There is no effect, timer or map read that opens it:
  // only the person's press sets `commandOpen` true. The view is what the
  // interpreter answered, or the last apply; none of it is a record, and a
  // refusal writes nothing but the interpreter's one Move.
  const [commandOpen, setCommandOpen] = useState(false);
  const [commandInstruction, setCommandInstruction] = useState("");
  const [commandAnswer, setCommandAnswer] = useState("");
  const [commandView, setCommandView] = useState<CommandView | null>(null);
  const [commandBusy, setCommandBusy] = useState<CommandBusy>(null);
  /**
   * STORY 21.5 — THE CARD'S CONVERSATION (ADR-0038's 2026-11-20 amendment: a
   * PRIMARY surface holds a conversation). The kept exchanges are VIEW STATE
   * beside the interpreter's Move — no record family, no counter — bounded by
   * CommandCard's own rule (whole exchanges, newest kept, the bound said in one
   * sentence). The card keeps them when it closes: this is its memory, and a
   * follow-up is exactly the turn that needs it.
   */
  const [commandThread, setCommandThread] =
    useState<CommandThread>(EMPTY_COMMAND_THREAD);
  /**
   * THE INTERPRETER'S DIGEST (story 21.2, ADR-0038 decision 6), ONE PER MAP
   * (STORY 21.9, ADR-0038's 2026-11-20 amendment: the command card is a PRIMARY
   * way to use the app and stands on every map, so the digest describes the map
   * the person is looking at instead of always the ground one).
   *
   * Composed from the LOADED view — names, kinds, one line about, states and
   * wires on the ground; names and kinds on the other two — and NEVER from a
   * body: the ground input has no text door, and the other maps' inputs are
   * narrowed to {slug, name} and to a claim's TARGET before they are handed in,
   * so a word's memory and a claim's words cannot ride. Recomputed when the
   * map's records change, so an accepted script's next instruction sees the map
   * it just changed.
   */
  const commandDigest = useMemo(() => {
    if (level === "concept") {
      return interpreterDigestOf({
        map: "concept",
        words: refs.map((reference) => ({
          slug: reference.slug ?? reference.id,
          name: reference.name,
        })),
      });
    }
    if (level === "dynamics") {
      // The words' names, never their memories: the view is already the lowered
      // pair, and the playing set is a list of slugs the person reads by name.
      const names: Record<string, string> = {};
      for (const reference of refs) {
        names[reference.slug ?? reference.id] = reference.name;
      }
      return interpreterDigestOf({
        map: "dynamics",
        names,
        playingSet: model !== null,
        words: (model?.words ?? []).map((slug) => ({
          slug,
          name: names[slug] ?? slug,
        })),
        links: links.map((link) => ({
          from: link.from,
          to: link.to,
          sign: link.sign,
        })),
        loops: loops.map((loop) => ({
          name: loop.name,
          slug: loopSlug(loop.name),
        })),
        // A claim's TEXT is a body: only what it is about rides here.
        assumptions: assumptions.map((assumption) => ({
          target: assumption.target,
        })),
        quantities: quantities.map((quantity) => ({
          target:
            quantity.type === "stock"
              ? { type: "word" as const, slug: quantity.on }
              : { type: "link" as const, from: quantity.from, to: quantity.to },
          stated: quantity.amount !== null,
        })),
      });
    }
    return interpreterDigestOf({
      map: "ground",
      references: ground.references,
      asks: ground.asks,
      sessions: ground.sessions,
      readings: ground.readings,
      links: ground.links,
      states: ground.states,
    });
  }, [
    level,
    refs,
    model,
    links,
    loops,
    assumptions,
    quantities,
    ground.references,
    ground.asks,
    ground.sessions,
    ground.readings,
    ground.links,
    ground.states,
  ]);

  /**
   * STORY 21.3 — ONE INTERPRETER CALL, ONE EGRESS (ADR-0038 decision 2; 21.2's
   * seam). The manager/curator row's existing send door, resolved here exactly
   * as the curator does, and the ONE PRISM written by appendCommandMove. The
   * Move is anchored on the MAP (commandAnchor); a command card is not a card
   * record, so when no card is open the map itself is the anchor. Nothing is
   * applied: this answers a script, a question, or one sentence.
   */
  const requestInterpretation = useCallback(
    async (
      instruction: string,
      promptInstruction: string | null,
      // STORY 21.12 — the card's second phase starts when the request LEAVES.
      // Everything before it (settings, the row, the route) is the first
      // phase's work; everything after it is the model's.
      announceSending: () => void,
    ): Promise<InterpreterRead> => {
      if (workspace === null) {
        return { kind: "problem", sentence: COMMAND_NO_WORKSPACE_SENTENCE };
      }
      try {
        const settings = await loadTurnSettings();
        const manager = resolveManager(settings);
        if (manager.kind !== "resolved") {
          return { kind: "problem", sentence: COMMAND_NO_MANAGER_SENTENCE };
        }
        const managerKey =
          manager.provider.kind === "http"
            ? await readSecret(manager.provider.id)
            : "";
        const route = routeOf(manager.provider, manager.model, managerKey);
        const turn = await interpretInstruction({
          input: {
            // The exchange records the person's words verbatim; an answered
            // question sends the same words WITH the question, so the model
            // reads a continuation rather than an unrelated new instruction.
            instruction: promptInstruction ?? instruction,
            digest: commandDigest,
            // STORY 21.9 — the prompt knows where the card stands, so a change
            // instruction on another map is answered with ONE sentence instead
            // of a script (and the app refuses a change script it is sent).
            map: level,
            // The here-and-now digest above is rebuilt for every call, so a
            // card created by an earlier turn is visible BY NAME; the turns
            // themselves say what "that one" referred to (STORY 21.5 §3).
            history: historyTurns(commandThread),
          },
          on: commandAnchor(level),
          sendMessages: (messages) => {
            // STORY 21.12 — the request is going out: the card moves from
            // reading the map to proposing the acts, before the model answers.
            announceSending();
            return turnPort.sendMessages(route, messages);
          },
          recordMove: (move) => appendCommandMove(workspace.path, move),
        });
        return turn.read;
      } catch {
        // A throw here is before or around the call seam; the sentence is the
        // app's, never the transport's prose. Nothing was applied either way.
        return { kind: "problem", sentence: COMMAND_INTERPRET_FAILED_SENTENCE };
      }
    },
    [workspace, level, commandDigest, commandThread],
  );

  /**
   * STORY 21.3 — ONE PRESS (ADR-0038 decision 4). Executes the whole script and
   * accepts the ghosts it filed through the app's OWN accept, then re-reads the
   * map folder so the cards show what landed. A mid-script failure accepts NO
   * ghost: the map holds what it held, and the card names the failing act.
   */
  const requestApply = useCallback(
    async (acts: readonly CommandAct[]): Promise<CommandApply> => {
      if (workspace === null) {
        return {
          ok: false,
          phase: "none",
          run: null,
          sentence: COMMAND_NO_WORKSPACE_SENTENCE,
        };
      }
      const host = createAttentioneerHost({
        workspacePath: workspace.path,
        io: tauriCommandIo,
      });
      const result = await applyCommandScript(acts, host);
      // Re-read whatever happened: a clean apply shows its cards, and a refused
      // ghost (a pathological accept) shows exactly what DID land instead of
      // leaving the map's view stale. This read writes nothing.
      await ground.reload();
      // STORY 21.7 — A QUESTION THE ACT LEFT WAITING REACHES ITS COMPOSER.
      // The draft is view state handed to the card, never a written turn; the
      // card opens so the person can read what is about to be asked and press
      // send themselves.
      if (result.ok && result.drafts.length > 0) {
        askDraftToken.current += 1;
        const token = askDraftToken.current;
        setAskDrafts(
          result.drafts.map((draft) => ({
            slug: draft.slug,
            question: draft.question,
            token,
          })),
        );
        setRevealAsk({ slug: result.drafts[0]!.slug });
      } else {
        // A press that left no draft forgets the last one: a later Restore of a
        // removed card must never be handed an old question as if it were new.
        setAskDrafts([]);
      }
      return result;
    },
    [workspace, ground.reload],
  );

  /**
   * ONE EXCHANGE JOINS THE CONVERSATION, and the live turn clears with it
   * (STORY 21.5). The append is the card's own bound: whole exchanges, newest
   * kept, and the dropped flag becomes the one qualitative sentence. Nothing is
   * written anywhere — this is view state beside the interpreter's Move.
   */
  const commitCommandExchange = useCallback((exchange: CommandExchange) => {
    setCommandThread((thread) => appendExchange(thread, exchange));
    setCommandView(null);
    setCommandAnswer("");
  }, []);

  /**
   * READ ONE INSTRUCTION and show what the app understood (STORY 21.5). The
   * UNDO GUARD runs first (STORY 21.6, WIDENED BY STORY 21.10): an instruction
   * that asks to take something back is resolved against the LAST APPLIED
   * exchange — now against EVERY act of its script, in reverse order, as ONE
   * pending script the person accepts once (ADR-0038 Amendment 2: undo is the
   * second net AFTER acceptance, and it takes back the script as a whole).
   * Acts the pairing cannot invert are named in the offer's note, never
   * dropped silently; only when no inverse exists at all does the card answer
   * with 21.5's ONE honest sentence. It never sends a take-back to the model to
   * guess at or to repeat the turn it was asked to take back.
   *
   * The prompt gets the here-and-now digest (rebuilt for every call), the
   * recent exchanges and the catalogue, so a follow-up resolves against what
   * just happened. It gets ONE instruction: a prior turn is context, never a
   * standing order (STORY 21.5 §6).
   */
  const runCommand = useCallback(
    async (
      instruction: string,
      promptInstruction: string | null,
      question: CommandQuestion | null,
    ): Promise<void> => {
      const lastApplied = lastAppliedExchangeOf(commandThread.exchanges);
      // STORY 21.10 — THE WHOLE-SCRIPT UNDO (ADR-0038 Amendment 2). Every act
      // of the last applied script is inverted, in reverse order, as ONE
      // pending script; the person's accept is still the only thing that
      // applies. `undo` rides along so the completed exchange can note what it
      // took back and what it could not.
      const offer = undoOfferOf(instruction, lastApplied);
      if (offer !== null && lastApplied !== null) {
        setCommandAnswer("");
        setCommandView({
          kind: "acts",
          instruction,
          acts: offer.acts,
          question,
          undo: {
            instruction: lastApplied.instruction,
            omitted: offer.omitted.map(actLine),
            bounded: offer.bounded,
          },
        });
        return;
      }
      const undo = undoExchangeOf(
        instruction,
        question,
        lastApplied?.acts ?? null,
      );
      if (undo !== null) {
        // ONE GENERATION: an undo of an undo that cannot be put back whole is
        // said in its own sentence, never offered as a partial restore that
        // would re-wire or re-name content the undo left undone.
        const second = undoSecondSentence(instruction, lastApplied);
        commitCommandExchange(
          second === null
            ? undo
            : nothingExchange(instruction, question, second),
        );
        return;
      }
      setCommandAnswer("");
      // STORY 21.12 — THE PRESS IS ACKNOWLEDGED IN THE PRESS'S OWN TICK. The
      // first phase is set before this function's first await, and the second
      // begins at the send seam; the sequence's finally clears the line on
      // acts, a question, a refusal and a failure alike.
      const read = await readInstructionInPhases(
        (announceSending) =>
          requestInterpretation(
            instruction,
            promptInstruction,
            announceSending,
          ),
        setCommandBusy,
      );
      const turn = commandTurnOf(instruction, read, question);
      if (turn.kind === "done") {
        commitCommandExchange(turn.exchange);
        return;
      }
      setCommandView(turn.view);
    },
    [commitCommandExchange, requestInterpretation, commandThread.exchanges],
  );

  /**
   * The person pressed read: one instruction, verbatim, then the field clears.
   * STORY 21.12 — ONE CALL PER PRESS: the press is refused by the very rule the
   * verb wears while a command is in flight, so a second press starts nothing.
   */
  const interpretCommand = useCallback(() => {
    const instruction = commandInstruction;
    if (commandSendDisabled(instruction, commandBusy)) return;
    setCommandInstruction("");
    void runCommand(instruction, null, null);
  }, [commandBusy, commandInstruction, runCommand]);

  /**
   * THE ONE CLARIFYING QUESTION, ANSWERED ONCE (STORY 21.5 §4). The answer
   * CONTINUES the exchange: the instruction stays the person's own words and
   * the question and its answer ride with it — the thread gains one exchange,
   * not two. A second question completes that exchange with one sentence
   * (CommandCard's commandTurnOf) rather than asking again.
   */
  const answerCommandQuestion = useCallback(() => {
    if (commandView?.kind !== "question") return;
    const answer = commandAnswer.trim();
    if (answer === "") return;
    const question = { question: commandView.question, answer };
    void runCommand(
      commandView.instruction,
      clarifiedInstruction(commandView.instruction, commandView.question, answer),
      question,
    );
  }, [commandView, commandAnswer, runCommand]);

  /**
   * THE PERSON'S ACCEPT ON THE SCRIPT IS THE ACCEPTANCE OF ITS GHOSTS. One call
   * to the app's one apply seam; there is no second question and no partial
   * apply. The exchange records what ran, or — exactly as the executor reports
   * it — which act failed and what did not apply (STORY 21.5's outcome line).
   */
  const acceptCommand = useCallback(() => {
    if (commandView?.kind !== "acts" || commandBusy !== null) return;
    const acts = commandView.acts;
    const instruction = commandView.instruction;
    const question = commandView.question;
    // STORY 21.10 — an undo's accept keeps the offer's note, so its own
    // exchange says which instruction it took back and what it could not.
    const undo = commandView.undo ?? null;
    setCommandBusy("applying");
    void requestApply(acts)
      .then((result) => {
        if (result.ok) {
          // STORY 21.8 — the exchange keeps the acts AS THEY APPLIED, so a move
          // or a name carries the previous point/words its inverse needs.
          // STORY 21.10 — the WHOLE applied script is kept (bounded), and an
          // undo's own note with it.
          commitCommandExchange(
            appliedExchange(instruction, result.applied, question, undo),
          );
          return;
        }
        const sentence =
          result.phase === "execution" && result.run !== null
            ? failureReport(acts, result.run)
            : result.phase === "accept"
              ? COMMAND_GHOST_REFUSAL_PREFIX + result.sentence
              : result.sentence;
        const failedAct =
          result.run === null
            ? null
            : (acts[result.run.applied]?.act ?? null);
        commitCommandExchange(
          failedExchange(instruction, acts, question, sentence, failedAct),
        );
      })
      .catch(() => {
        commitCommandExchange(
          failedExchange(
            instruction,
            acts,
            question,
            COMMAND_FAILED_SENTENCE,
            null,
          ),
        );
      })
      .finally(() => setCommandBusy(null));
  }, [commandView, commandBusy, requestApply, commitCommandExchange]);

  /**
   * A REFUSAL MOVES NOTHING (ADR-0038 decision 4). The interpreter's Move is
   * already written; this drops the script and records the exchange as
   * refused. It does not execute, accept, rerun or log anything.
   */
  const refuseCommand = useCallback(() => {
    if (commandView?.kind !== "acts") return;
    commitCommandExchange(
      refusedExchange(
        commandView.instruction,
        commandView.acts,
        commandView.question,
      ),
    );
    setCommandBusy(null);
  }, [commandView, commitCommandExchange]);

  /**
   * Closing hides the card and keeps its conversation: a primary surface's
   * memory does not vanish because the surface was put away. A pending turn is
   * dropped when the card next OPENS — an unanswered script was never applied,
   * and the next instruction starts a new one.
   */
  const closeCommandCard = useCallback(() => {
    setCommandOpen(false);
    setCommandBusy(null);
  }, []);

  /** Opening starts a fresh TURN; the conversation it joins is kept. */
  const openCommandCard = useCallback(() => {
    setCommandInstruction("");
    setCommandAnswer("");
    setCommandView(null);
    setCommandOpen(true);
  }, []);

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
   * Close the PRISM window WITHOUT moving focus — used by the game switch and
   * by a word rename/removal, where the window's anchor may be moving or gone
   * and focusing a dead handle would be a lie (the peek's quiet rule).
   */
  const closePrismQuietly = useCallback(() => {
    prismSlugRef.current = null;
    setPrismAt(null);
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
      closePrismQuietly();
      pointerSlugRef.current = on;
      setPointerAt({ on, anchor });
    },
    [closePeekQuietly, closePrismQuietly],
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
      closePrismQuietly();
      peekSlugRef.current = pointer.on;
      setPeekAt({ on: pointer.on, pointer, anchor });
      closePointersQuietly();
    },
    [pointerAt, closePointersQuietly, closePrismQuietly],
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

  /**
   * Close the PRISM window and return focus to its word's reach handle (the
   * window is its word's), reusing the peek's focus contract: a level SWITCH
   * never focuses a word — the switch puts focus on the level control.
   */
  const closePrism = useCallback((reason: PeekCloseReason = "dismiss") => {
    const slug = prismSlugRef.current;
    prismSlugRef.current = null;
    setPrismAt(null);
    const selector = peekFocusSelector(focusAfterPeekClose(reason), slug);
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(selector)?.focus();
    });
  }, []);

  /** Close the PRISM window if it speaks about this word (the peek's mirror). */
  const closePrismFor = useCallback((on: string) => {
    if (prismSlugRef.current !== on) return;
    prismSlugRef.current = null;
    setPrismAt(null);
  }, []);

  /**
   * Perform one Look/Measure Move from a pointer row (Epic 12 story 2): the
   * read path appends exactly ONE PRISM through the boundary layer, and the
   * Move's window opens AT ITS COMPLETION. The chooser and the glimpse close
   * (one live surface). A contact-table refusal is not a Move (nothing was
   * read or written) and shows its own quiet sentence; a failed append says so
   * rather than claiming a log that is not there.
   */
  const readFromPointer = useCallback(
    async (contact: ReadContactKind, pointer: Pointer) => {
      const at = pointerAt;
      if (at === null || workspace === null) return;
      closePointersQuietly();
      closePeekQuietly();
      setPrismAt(null);
      prismSlugRef.current = at.on;
      try {
        const result = await runReadMove({
          on: at.on,
          contact,
          form: pointer.form,
          value: pointer.value,
          workspacePath: workspace.path,
        });
        setPrismAt(
          result.kind === "moved"
            ? {
                on: at.on,
                anchor: at.anchor,
                prism: result.prism,
                note: null,
              }
            : {
                on: at.on,
                anchor: at.anchor,
                prism: null,
                note: result.reason,
              },
        );
      } catch {
        setPrismAt({
          on: at.on,
          anchor: at.anchor,
          prism: null,
          note: NOT_LOGGED,
        });
      }
    },
    [pointerAt, workspace, closePointersQuietly, closePeekQuietly],
  );

  /**
   * The reopen affordance (PROVISIONAL): the pointer row's quiet log button
   * reads the reach's LATEST PRISM fresh from disk and opens the ONE Move's
   * window on it. No gallery, no list, no counter: the record layer answers one
   * Prism or null (the window says "no move on this reach yet" for null).
   */
  const reopenPrism = useCallback(
    async (pointer: Pointer) => {
      const at = pointerAt;
      if (at === null || workspace === null) return;
      closePointersQuietly();
      closePeekQuietly();
      setPrismAt(null);
      prismSlugRef.current = at.on;
      try {
        const prism = await readLatestPrism(workspace.path, at.on, {
          form: pointer.form,
          value: pointer.value,
        });
        setPrismAt({
          on: at.on,
          anchor: at.anchor,
          prism,
          note: null,
        });
      } catch {
        setPrismAt({
          on: at.on,
          anchor: at.anchor,
          prism: null,
          note: CANNOT_READ_LOG,
        });
      }
    },
    [pointerAt, workspace, closePointersQuietly, closePeekQuietly],
  );

  /** Save one Move's explanation (the window's one editable field). */
  const saveMoveExplanation = useCallback(
    (id: string, explanation: string) => {
      if (workspace === null) return Promise.resolve(false);
      return savePrismExplanation(workspace.path, id, explanation);
    },
    [workspace],
  );

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
  //
  // DEPRECATED (hidden 2026-11-16 per user review): the shelf is gone, so the
  // QUIETING and every set-aside style are gone with it — while the flag stands
  // this reading always answers false, which also keeps a drag past the old fold
  // from looking like anything happens at all (the gesture sets nothing aside).
  // The derivation stays written (map/shelf.ts) for the flip-back — delete this
  // early return in the deprecated sweep.
  const shelvedOf = useCallback(
    (word: Reference): boolean => {
      if (!shelfShown()) return false;
      return word.slug !== null && isShelved(posOf(word).x, boxOf(word).w, shelfX);
    },
    [posOf, boxOf, shelfX],
  );

  /**
   * The words that are set aside in the RECORD right now — and so are not shown
   * while the shelf is hidden (canvas/shelfRules.ts's `setAsideShown`).
   *
   * DEPRECATED (hidden 2026-11-16 per user review): the review removed the shelf
   * and asked that a word already set aside "be simply not shown". The position
   * is the whole record (ADR-0010), so the reading is the word's STORED x — never
   * the live drag position, which would make a word vanish under the pointer
   * mid-drag — and it tests the LEFT EDGE (`recordSetAside`), so a re-measure can
   * never flip a visible word into the hidden set. Nothing is written and nothing
   * is deleted: flip `SHELF_HIDDEN` back and every one of these words is on the
   * shelf it never left — delete this memo and its readings in the deprecated
   * sweep.
   */
  const setAsideSlugs = useMemo(() => {
    const aside = new Set<string>();
    for (const word of refs) {
      if (word.slug === null) continue;
      if (!setAsideShown(recordSetAside(word.x, shelfX))) {
        aside.add(word.slug);
      }
    }
    return aside;
  }, [refs, shelfX]);

  /** The words the plane draws: every word but the ones set aside (see above). */
  const shownRefs = useMemo(
    () => refs.filter((word) => word.slug === null || !setAsideSlugs.has(word.slug)),
    [refs, setAsideSlugs],
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
              : // The map's pen (added 2026-11-16 per user review) is its own
                // arm, level-uniform: while it is live the plane's own gestures
                // all stand still (shouldPan/shouldCreate/shouldStartWordPress)
                // and the pen's capture surface owns the pointer.
                drawArmed
                ? "draw"
                : // THE SELECTION TOOL (PROVISIONAL, added 2026-11-16 per the
                  // lead's brief) is its own arm, concept only: while the tool
                  // is armed OR the naming popup is asking (the draft is not
                  // null — the veil's coin-field rule) the mode stands, so the
                  // plane cannot pan, create or press a word behind the card.
                  selectArmed || gameDraft !== null
                  ? "select"
                  : "idle";
  // The gate's mode, readable from the focus and release paths, which run
  // outside render (a focusout microtask, a post-render focus refresh).
  const gestureModeRef = useRef<GestureMode>(gestureMode);
  gestureModeRef.current = gestureMode;

  // STORY 16.16 (shortlist items 4 and 5) — WHAT IS ARMED, AS ONE READING. The
  // bar shows while a tool is down (the pen or the eraser), while a link drag
  // is in flight, or while the ground bubble is asking for a reference — the
  // pure rule in `canvas/gestureWord.ts` decides; this only feeds it the
  // running state, so the chip and the bar can never disagree about the tool.
  const armedTool = armedKind(
    drawArmed,
    penTool,
    gesture,
    level === "ground" && groundAt !== null,
  );

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
   * THE ONTOLOGY EXPORT's words (PROVISIONAL, added 2026-11-16 per ADR-0033
   * and the research note's story 1): the map's coined words as the derivation
   * needs them — the person's name, the RECORD's stored corner (never a live
   * drag) and the MEASURED box, so a word counts where the map draws it. The
   * stored x is also the shelf's hiding reading (canvas/shelfRules.ts), which
   * the derivation applies: the artifact lists no word the map does not show.
   */
  const ontologyWords = useMemo(
    () =>
      refs
        .filter(
          (word): word is Reference & { slug: string } => word.slug !== null,
        )
        .map((word) => ({
          slug: word.slug,
          name: word.name,
          pos: { x: word.x, y: word.y },
          box: boxes[word.slug] ?? DEFAULT_BOX,
        })),
    [refs, boxes],
  );

  /**
   * Rebuild every game's ontology file after any map write that can change a
   * game's content, and once on open (ADR-0033, the research note's §5.3): a
   * game created or deleted, a word added, moved, renamed or deleted, a wire
   * coined, re-coined or deleted — each of those changes one of `refs`,
   * `distances` or `languageGames` here. There is no watcher, no timer and no
   * cache: the records are the trigger, the snapshot is the input, and the sync
   * writes only when the bytes changed.
   *
   * The write is best-effort: a folder the filesystem refuses is not worth
   * interrupting the map for, and the next change tries again. What the sync
   * declined to sweep is handed to the notices strip, never dropped.
   */
  useEffect(() => {
    const path = workspace?.path;
    if (!loaded || !path) return;
    const snapshot: OntologySnapshot = {
      words: ontologyWords,
      wires: distances,
      games: languageGames,
      shelfX,
    };
    ontologyWriteRef.current = ontologyWriteRef.current
      .catch(() => undefined)
      .then(() => syncOntology(path, { snapshot }))
      .then((result) => {
        // Only the files the sync left alone are surfaced; the written ones
        // are the artifact working as designed, and a game's own export says
        // nothing about the map.
        setOntologyNotices((current) =>
          current.length === result.notices.length &&
          current.every((line, index) => line === result.notices[index])
            ? current
            : result.notices,
        );
      })
      .catch(() => undefined);
  }, [loaded, workspace?.path, ontologyWords, distances, languageGames, shelfX]);

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
  /**
   * The cards' read (Epic 11 story 3): the person's own game notes, read at
   * ASK time — so a hand edit to `map/cards.jsonl` is seen by the very next
   * ask, and the frozen packet's hash moves with the content. A card is not a
   * map record (no batch touches it), so no reload path owns it.
   */
  const readCards = useCallback(async () => {
    if (workspace === null) return [];
    return (await loadCards(workspace.path)).cards;
  }, [workspace]);
  const ghostRequest = useGhostRequest({
    workspacePath: workspace?.path ?? "",
    context: () => ({ level, scenario }),
    view: () => packetView,
    cards: readCards,
    creationKinds: (game) => creationKinds(game),
    // THE RUN'S SENTENCES (Epic 14 story 1's named follow-up): the session
    // lives in the ghosts hook and the ask lives here, so this read is the
    // seam — the packet asked after a refused intake carries the sentence.
    // It is THREADED into the ask, never rendered: no surface reads the run.
    priorRefusals: ghosts.priorRefusals,
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
    // The ground map's creation bubble is a transient like the concept menu:
    // a level switch, a branch switch or a deliberate arm elsewhere closes it.
    setGroundAt(null);
    setGrowAt(null);
    setSelectorOpen(false);
    setLassoArmed(false);
    setVeilArmed(false);
    setVeilBox(null);
    // The pen's arm closes with every other one (added 2026-11-16 per user
    // review): a level switch, a branch switch or a deliberate arm elsewhere
    // ends the drawing mode; the strokes are records and stay.
    setDrawArmed(false);
    // The selection tool's arm and the naming draft close with every other one
    // (PROVISIONAL, added 2026-11-16 per the lead's brief): a level switch, a
    // branch switch or a deliberate arm elsewhere ends the tool. An UNSAVED
    // draft is dropped with it — nothing was written, so there is nothing to
    // lose but the selection being drawn. The list closes too: its door lives
    // on the concept map, and a game's fill cannot render off it.
    setSelectArmed(false);
    setGameDraft(null);
    setGamesOpen(false);
    // The look-under is a transient: the switch path closes it with every
    // other one (a level switch, a branch switch and any deliberate entry that
    // runs this path). It closes QUIETLY — the wheel never yanks focus.
    setLookUnderKey(null);
    setPathSession(endPathSession());
    setAssumptionAt(null);
    setQuantityAt(null);
    closePointersQuietly();
    closePeekQuietly();
    // The PRISM window is the ground game's transient (Epic 12 story 2): the
    // switch closes it quietly with every other one, never yanking focus.
    closePrismQuietly();
    // The ghosts are transients too (Epic 10 story 3): the opened preview and
    // the ask surface close with the switch, quietly — a held proposal is app
    // state and stays in its rows (it is the dynamics game's own move).
    closeGhosts();
    setGhostPanelOpen(false);
    // The person's contact panels are the ground game's transients (Epic 12
    // story 3): a switch closes them quietly. An Ask still in flight appends
    // NOTHING when it closes — an unfinished Move has no record — and the
    // response it held was content, held in app state alone.
    setMakeAt(null);
    setMakeNote(null);
    setAskAt(null);
    setAskSession(null);
    setAskResponse(null);
    setAskPrism(null);
    setAskSentNote(null);
    setAskNote(null);
    setAskKept(false);
    cancelConnect();
  }, [
    cancelConnect,
    closePointersQuietly,
    closePeekQuietly,
    closePrismQuietly,
    closeGhosts,
  ]);

  /**
   * Open the quiet MAKE panel (Epic 12 story 3) on the word the chooser speaks
   * about. It closes the chooser and every other transient: the panel is the
   * one live surface while it holds the person's prose.
   */
  const openMake = useCallback(() => {
    const at = pointerAt;
    if (at === null) return;
    cancelPendingGestures();
    setMakeNote(null);
    setMakeAt({ on: at.on, anchor: at.anchor });
  }, [pointerAt, cancelPendingGestures]);

  /** Close the Make panel: nothing is written, and typed prose is dropped. */
  const closeMake = useCallback(() => {
    setMakeAt(null);
    setMakeNote(null);
  }, []);

  /**
   * MAKE — the person's whole accept (Epic 12 story 3, NO gate). One Move:
   * mint the artifact's pointer, write its raw text and append the ONE PRISM.
   * The map reloads so the minted pointer is on its word at once, and the
   * Move's window opens AT ITS COMPLETION (the Move's own log). A table or
   * boundary refusal wrote nothing and says so in the panel; a failed log says
   * the move's log could not be written rather than claiming one.
   */
  const submitMake = useCallback(
    (path: string, text: string) => {
      const at = makeAt;
      if (at === null || workspace === null) return;
      setMakeBusy(true);
      void runMakeMove({
        on: at.on,
        form: "path",
        value: path,
        text,
        workspacePath: workspace.path,
      })
        .then((result) => {
          setMakeBusy(false);
          if (result.kind === "refused") {
            setMakeNote(result.reason);
            return;
          }
          setMakeAt(null);
          setMakeNote(null);
          prismSlugRef.current = at.on;
          setPrismAt({
            on: at.on,
            anchor: at.anchor,
            prism: result.prism,
            note: null,
          });
          // The minted pointer appears on the map at once (the atomic-patch
          // reload idiom); the PRISM window stays open on the Move.
          void reload();
        })
        .catch(() => {
          setMakeBusy(false);
          setMakeNote(NOT_LOGGED);
        });
    },
    [makeAt, workspace, reload],
  );

  /**
   * HAND OFF one url to the OS (Epic 12 story 3's open-os egress). One Move:
   * the app hands the address over and the PRISM says handed / handoff-failed
   * / refused — NEVER "opened", because the app only knows the handoff. A
   * table refusal is not a Move (nothing leaves) and reads its own sentence in
   * the window.
   */
  const handOffFromPointer = useCallback(
    (pointer: Pointer) => {
      const at = pointerAt;
      if (at === null || workspace === null) return;
      closePointersQuietly();
      closePeekQuietly();
      setPrismAt(null);
      prismSlugRef.current = at.on;
      void runEgressMove({
        on: at.on,
        contact: "look",
        form: pointer.form,
        value: pointer.value,
        workspacePath: workspace.path,
      })
        .then((result) => {
          setPrismAt(
            result.kind === "moved"
              ? {
                  on: at.on,
                  anchor: at.anchor,
                  prism: result.prism,
                  note: null,
                }
              : {
                  on: at.on,
                  anchor: at.anchor,
                  prism: null,
                  note: result.reason,
                },
          );
        })
        .catch(() => {
          setPrismAt({
            on: at.on,
            anchor: at.anchor,
            prism: null,
            note: NOT_LOGGED,
          });
        });
    },
    [pointerAt, workspace, closePointersQuietly, closePeekQuietly],
  );

  /** Reset the ephemeral Ask state (a new question, or a closed panel). */
  const resetAsk = useCallback(() => {
    setAskSession(null);
    setAskResponse(null);
    setAskPartial(null);
    setAskEnding(null);
    setAskPrism(null);
    setAskSentNote(null);
    setAskNote(null);
    setAskKept(false);
    setAskFallback(null);
    setAskAppRunning(false);
    setAskContext(null);
    setAskProvider(null);
    setAskIncluded([]);
    setAskSent(null);
  }, []);

  /**
   * Re-read what a turn would carry, and where a key is kept (Epic 15 story 4).
   * The answer is a fact about the config rows and the store, never a key: the
   * selection resolves to providerId:modelId or the stated fallback, and the
   * store's sentence is the one line the Ask panel always shows.
   */
  const refreshProviderFacts = useCallback(() => {
    void loadTurnSettings()
      .then((settings) => {
        const resolved = resolveSelection(settings);
        const here = resolved.kind === "resolved";
        setAskProvider(here);
        setAskProviderRef(
          here
            ? formatProviderRef(settings.providerId, settings.modelId)
            : null,
        );
        setAskFallback(here ? null : NO_PROVIDER_SENTENCE);
        // STORY 17.13 — the calls the declaration names, from the same read:
        // the task row/model, and the manager row/model when one resolves (the
        // empty manager pair is the explicit "same as the task model", so it
        // resolves to the task's own name and the pure rules say it in ONE
        // line). A manager that does not resolve is null: no second call.
        if (resolved.kind === "resolved") {
          const manager = resolveManager(settings);
          setAskCalls({
            task: {
              row: resolved.provider.name,
              model: resolved.model.name,
            },
            manager:
              manager.kind === "resolved"
                ? { row: manager.provider.name, model: manager.model.name }
                : null,
          });
          // STORY 16.29 — THE CATALOGUE'S OWN VALUES for the task model. Only
          // an HTTP row has a base URL to match, and only an exact catalogue
          // match offers anything; everything else is the honest empty list.
          setAskEfforts(
            resolved.provider.kind === "http"
              ? catalogEffortOptions(
                  resolved.provider.baseUrl,
                  resolved.model.id,
                )
              : [],
          );
        } else {
          setAskCalls(null);
          setAskEfforts([]);
        }
      })
      .catch(() => {
        // An unreadable config is the same honest nothing: the fallback.
        setAskProvider(false);
        setAskProviderRef(null);
        setAskFallback(NO_PROVIDER_SENTENCE);
        setAskCalls(null);
        setAskEfforts([]);
      });
    void secretStatus().then((store) =>
      setAskKeyStore(secretStatusWords(store)),
    );
  }, []);

  /**
   * STORY 17 (shortlist items 7–9) — re-read the STATED fold threshold. Settings
   * is the only writer; this is the read side, so a changed count lands on every
   * ground card without a reload. An unreadable config keeps the default, the
   * same honest ignorance as everywhere else.
   */
  const refreshReadingPreference = useCallback(() => {
    void loadReadingPreference()
      .then(setReadingPreference)
      .catch(() => setReadingPreference(DEFAULT_READING_PREFERENCE));
  }, []);

  useEffect(() => {
    refreshReadingPreference();
  }, [refreshReadingPreference]);

  /**
   * STORY 25-14 — THE CARDS' LOOK IS A FEW CSS VARS. Settings writes the
   * config; this is the read side, and the sheet reads the vars: the three
   * voice stacks, the frames' weight and the ink settle's speed.
   */
  const refreshCardPreference = useCallback(() => {
    void loadCardPreference()
      .then(setCardPreference)
      .catch(() => setCardPreference(DEFAULT_CARD_PREFERENCE));
  }, []);

  useEffect(() => {
    refreshCardPreference();
  }, [refreshCardPreference]);

  // The looks load with the workspace; a missing file is the honest default
  // (every card wears its state's own frame).
  useEffect(() => {
    if (workspace === null) return;
    let alive = true;
    void readTextFile(`${workspace.path}/map/looks.jsonl`)
      .then((text) => {
        if (!alive) return;
        setCardLooks(looksBySlug(parseLooks(text ?? "").looks));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [workspace === null ? "" : workspace.path]);

  /** The gear's write: one card's look line, then the read side catches up. */
  const onSetLook = useCallback((look: CardLook) => {
    if (workspace === null) return;
    setCardLooks((by) => ({ ...by, [look.on]: look }));
    void saveLook(workspace.path, look).catch(() => {});
  }, [workspace === null ? "" : workspace.path]);

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--voice-hand", cardPreference.voiceHand);
    root.style.setProperty("--voice-press", cardPreference.voicePress);
    root.style.setProperty("--voice-draft", cardPreference.voiceDraft);
    root.style.setProperty("--frame-w", FRAME_WEIGHT_PX[cardPreference.frameWeight]);
    root.style.setProperty("--settle-ms", SETTLE_MS[cardPreference.settleSpeed]);
  }, [cardPreference]);

  /**
   * STORY 17.7b — READ THE ONE SELECTION AT START, so an ask card can say
   * "nothing configured" BEFORE the first send. The same reading the Ask Move
   * takes when it opens; opening it only then would leave the card guessing.
   */
  useEffect(() => {
    refreshProviderFacts();
  }, [refreshProviderFacts]);

  /**
   * Open Settings on a section (story 15.10). The chrome's control and the ask
   * panels' configure shortcut both land here; opening writes nothing.
   */
  const openSettings = useCallback((section: SettingsSection) => {
    setSettingsSection(section);
    setSettingsOpen(true);
  }, []);

  /**
   * Close Settings. Closing writes nothing at all — the frame's controls are
   * the only writers. The app re-reads the provider facts so an ask behind the
   * modal hears about a row that changed.
   */
  const closeSettings = useCallback(() => {
    setSettingsOpen(false);
    refreshProviderFacts();
    // STORY 17: the fold threshold is a config value like the rows, so closing
    // re-reads it too — the cards are already re-cropped on "keep".
    refreshReadingPreference();
  }, [refreshProviderFacts, refreshReadingPreference]);

  /**
   * Open the quiet ASK panel (Epic 12 story 3) on the chooser's word, riding
   * this reach (or none at all). Nothing is tracked yet: the panel holds the
   * question's prose until it is sent, and a question that never leaves is not
   * a Move.
   */
  const openAsk = useCallback(
    (ride: Pointer | null) => {
      const at = pointerAt;
      if (at === null) return;
      cancelPendingGestures();
      resetAsk();
      setAskAt({
        on: at.on,
        anchor: at.anchor,
        ride:
          ride === null ? null : { form: ride.form, value: ride.value },
      });
      // Is there a provider to carry the packet? The app-sent route is the
      // default; with none configured the panel says so in one sentence and
      // the clipboard is the visible fallback (never a silent one). The
      // previews are read only once a provider is known to be there: the
      // clipboard route reads no target (ADR-0029 rule 3 stands for it).
      setAskProvider(null);
      setAskProviderRef(null);
      setAskCalls(null);
      setAskContext(null);
      setAskIncluded([]);
      setAskSent(null);
      refreshProviderFacts();
    },
    [pointerAt, cancelPendingGestures, resetAsk, refreshProviderFacts],
  );

  /**
   * Close the Ask panel. An Ask still in flight appends NOTHING — an
   * unfinished Move has no record — and the response it held was CONTENT in
   * app state, never a file.
   */
  const closeAskPanel = useCallback(() => {
    setAskAt(null);
    resetAsk();
  }, [resetAsk]);

  /**
   * THE INCLUSION CHANGED (Epic 15 story 3): remember exactly the reaches the
   * person included and forget the previous previews at once, so no
   * declaration can name a block this send would not carry while the app reads
   * the new ones. Only the INCLUDED reaches are ever read.
   */
  const askChoose = useCallback((included: Pointer[]) => {
    setAskIncluded(
      included.map((pointer) => ({ form: pointer.form, value: pointer.value })),
    );
    setAskContext(null);
  }, []);

  /**
   * READ the packet's previews (Epic 15 story 3): the card's crops from the
   * loaded ground state, plus one bounded head per INCLUDED reach (the head
   * reader's cap; a url is never fetched). The app-sent route only — with no
   * provider there is no packet to declare, and the clipboard route reads no
   * target at all (ADR-0029 rule 3 stands for it). A vanished panel drops the
   * in-flight read's answer (one open Ask at a time).
   */
  useEffect(() => {
    if (askAt === null || workspace === null || askProvider !== true) return;
    const reference = ground.references.find((entry) => entry.on === askAt.on);
    const facts: AskCardFacts = {
      name: reference?.name ?? nameOf(askAt.on),
      state: ground.states[askAt.on] ?? null,
      reading: readingFor(ground.readings, askAt.on),
      readingText: ground.texts[askAt.on] ?? null,
      note: ground.notes[askAt.on] ?? null,
    };
    let live = true;
    void readAskContext({
      workspacePath: workspace.path,
      card: facts,
      included: askIncluded,
    }).then((context) => {
      if (live) setAskContext(context);
    });
    return () => {
      live = false;
    };
  }, [
    askAt,
    workspace,
    askProvider,
    askIncluded,
    ground.references,
    ground.readings,
    ground.states,
    ground.texts,
    ground.notes,
    nameOf,
  ]);

  /**
   * The app-sent sender the Ask flow uses (Epic 15 story 2): the provider row
   * and the session's key are read at send time, and the turn port carries the
   * packet. `turn/egress.ts` decides the three outcomes; this wiring owns only
   * where the provider facts come from.
   */
  const askSendApp = useCallback(
    (packet: AskPacket, onPart?: (text: string) => void) =>
      sendPacketApp(
        packet,
        {
          loadSettings: loadTurnSettings,
          // Read at send time, for the selected provider only; the key never
          // enters React state, a field, a log or an error sentence.
          apiKey: readSecret,
          turn: turnPort,
          // The ONE follow-up's read: a block the packet already carried, its
          // fuller text from the pull reader. Null (no read) for anything else,
          // so a name outside the packet never widens the view.
          fetchBlock: (name: string) =>
            workspace === null
              ? Promise.resolve(null)
              : fetchAskBlock(workspace.path, name, askContext),
        },
        // The stream is a VIEW: the same accumulation the ending settles with,
        // so the panel can show the words without a second copy of them.
        onPart,
      ),
    [workspace, askContext],
  );

  /**
   * SEND the question out (Epic 12 story 3; app-sent by default in Epic 15
   * story 2). The app carries the packet through the sidecar; with no provider
   * (or no sidecar) the flow answers the stated fallback and nothing is
   * appended. A failed turn keeps the question in flight with one sentence, so
   * a paste can still log exactly ONE PRISM. The inclusion set is the reaches
   * whose CITATIONS ride in the packet; their content never does.
   */
  const askSend = useCallback(
    (question: string, included: Pointer[], transport: AskTransport) => {
      const at = askAt;
      if (at === null || workspace === null) return;
      if (question.trim() === "") {
        setAskNote(ASK_NEEDS_QUESTION);
        return;
      }
      // Nothing leaves before the previews are here: the declaration must name
      // every block, and the send carries exactly the bytes it declared.
      if (transport === "app" && askContext === null) {
        setAskNote(ASK_CONTEXT_READING);
        return;
      }
      setAskBusy(true);
      setAskNote(null);
      if (transport === "app") setAskAppRunning(true);
      void sendAskOut(
        {
          on: at.on,
          contact: "ask",
          pointer: at.ride,
          included: included.map((pointer) => ({
            form: pointer.form,
            value: pointer.value,
          })),
          question,
          transport,
          workspacePath: workspace.path,
          // The bounded previews the app read, as plain data: the contact path
          // composes the packet from them and reads nothing itself.
          previews:
            askContext === null
              ? undefined
              : {
                  card: askContext.card,
                  reaches: askContext.reaches,
                  retrievable: askContext.retrievable,
                },
        },
        askSendApp,
        {
          // The Ask is in flight the moment the packet leaves: the panel shows
          // the words arriving instead of waiting for a block. The stream is a
          // VIEW of the bytes the ending settles with — never a record.
          onSent: (ask) => {
            setAskSession(ask);
            setAskPartial(null);
            setAskEnding(null);
          },
          onPart: (text) => setAskPartial(text),
        },
      )
        .then(async (result) => {
          setAskBusy(false);
          setAskAppRunning(false);
          if (result.kind === "refused") {
            // Nothing left, so nothing is in flight.
            setAskSession(null);
            setAskPartial(null);
            setAskEnding(null);
            setAskNote(result.reason);
            return;
          }
          if (result.kind === "fallback") {
            // Nothing left: say so, and let the panel show the clipboard path.
            // The in-flight view (if the route died on its way out) is cleared.
            setAskSession(null);
            setAskPartial(null);
            setAskEnding(null);
            setAskFallback(result.reason);
            return;
          }
          setAskFallback(null);
          setAskSession(result.ask);
          // THE ENDING SETTLES THE RECORD (story 7b): a partial is kept for the
          // panel, but only an answered turn produced an answered record. The
          // wiring appended the ONE no-response PRISM for every other ending.
          setAskEnding(result.ending ?? null);
          setAskPartial(result.partial ?? null);
          setAskSentNote(
            result.missed !== undefined && result.missed !== null
              ? ASK_READ_MISSED
              : result.note,
          );
          if (result.sentMessages !== undefined) {
            setAskSent({
              messages: result.sentMessages,
              read: result.read ?? null,
            });
          }
          if (result.response !== undefined) setAskResponse(result.response);
          if (result.prism !== undefined) setAskPrism(result.prism);
          // THE ANSWER MAY PROPOSE AN EDIT (Epic 15 story 8): the turn read the
          // ONE block after the answer completed. A usable body goes to the
          // SAME ghost intake a paste uses — nothing is applied, and the
          // grammar's own words stand for a wrong game, target or move. A block
          // that is not a proposal says its one sentence and the answer stands.
          if (result.ghost !== undefined) {
            const read = result.ghost;
            if (read.kind === "invalid") {
              setAskSentNote(read.sentence);
            } else if (read.kind === "proposal") {
              const intake = await ghosts.intake(read.body, null);
              if (intake !== null && !intake.ok) {
                const said = intake.issues
                  .map((entry) => entry.message)
                  .join("; ");
                setAskSentNote(said === "" ? null : said);
              } else if (read.sentence !== null) {
                setAskSentNote(read.sentence);
              }
            }
          }
        })
        .catch(() => {
          setAskBusy(false);
          setAskAppRunning(false);
          setAskNote(ASK_SEND_FAILED);
        });
    },
    [askAt, workspace, askSendApp, ghosts],
  );

  /** Stop the app-sent turn (the sidecar's cancel); its own line settles it. */
  const askStop = useCallback(() => {
    void turnPort.stop().catch(() => {
      // Best effort: the turn's line, or its budget, settles the panel.
    });
  }, []);

  /**
   * INTAKE the pasted response (Epic 12 story 3): the app WRAPS the text — its
   * exact byte size and decode status at intake — and appends the ONE PRISM
   * with the answered Change and the inclusion set (keys only, never bytes).
   * The response is handed back as CONTENT and held in app state: it is never
   * written by the intake.
   */
  const askIntake = useCallback(
    (raw: string, attachmentPath: string) => {
      const session = askSession;
      if (session === null) return;
      setAskBusy(true);
      setAskNote(null);
      void intakeAsk(
        session,
        raw,
        attachmentPath.trim() === ""
          ? null
          : { form: "path", value: attachmentPath },
      )
        .then((result) => {
          setAskBusy(false);
          if (result.kind === "refused") {
            setAskNote(result.reason);
            return;
          }
          setAskResponse(result.response);
          setAskPrism(result.prism);
        })
        .catch(() => {
          setAskBusy(false);
          setAskNote(NOT_LOGGED);
        });
    },
    [askSession],
  );

  /**
   * END the ask with nothing back (Epic 12 story 3): the SAME ONE PRISM,
   * no-response and no response facts. The honest close of a question that
   * left. The panel closes and the Move's window opens on the log.
   */
  const askAbandon = useCallback(() => {
    const session = askSession;
    const at = askAt;
    if (session === null || at === null) return;
    setAskBusy(true);
    setAskNote(null);
    void closeAsk(session)
      .then((result) => {
        setAskBusy(false);
        if (result.kind === "refused") {
          setAskNote(result.reason);
          return;
        }
        closeAskPanel();
        prismSlugRef.current = at.on;
        setPrismAt({
          on: at.on,
          anchor: at.anchor,
          prism: result.prism,
          note: null,
        });
      })
      .catch(() => {
        setAskBusy(false);
        setAskNote(NOT_LOGGED);
      });
  }, [askSession, askAt, closeAskPanel]);

  /**
   * THE KEEP (Epic 12 story 3) — the existing FINDING move, and a SEPARATE
   * act. The response goes into this word's memory (the same write the memory
   * field makes); the PRISM was closed at intake and is never extended. This
   * callback touches no prism writer by construction.
   */
  const askKeep = useCallback(() => {
    const at = askAt;
    const response = askResponse;
    if (at === null || response === null) return;
    const word = refs.find((reference) => reference.slug === at.on);
    if (word === undefined) {
      setAskNote(ASK_KEEP_FAILED);
      return;
    }
    updateReference({ ...word, body: response.text });
    setAskKept(true);
    setAskNote(null);
  }, [askAt, askResponse, refs, updateReference]);

  /**
   * Show the completed Ask's ONE PRISM (record != visible: one Move's log,
   * opened from the panel that made it). No gallery, no series.
   */
  const askLog = useCallback(() => {
    const at = askAt;
    const prism = askPrism;
    if (at === null || prism === null) return;
    prismSlugRef.current = at.on;
    setPrismAt({ on: at.on, anchor: at.anchor, prism, note: null });
  }, [askAt, askPrism]);

  /** What the Ask panel reads: the in-flight question and its content. */
  const askSessionView = useMemo<AskSessionView | null>(
    () =>
      askSession === null
        ? null
        : {
            ask: askSession,
            response: askResponse,
            note: askSentNote,
            partial: askPartial,
            ending: askEnding,
          },
    [askSession, askResponse, askSentNote, askPartial, askEnding],
  );

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
    // The panel's one provider line is the SAME reading the ground Ask uses;
    // a row edited elsewhere is seen here the moment the panel opens.
    refreshProviderFacts();
    setGhostAnswer(null);
    setGhostTurnNote(null);
    setGhostPanelOpen(true);
  }, [cancelPendingGestures, refreshProviderFacts]);

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
      // A new ask is a new question: the previous answer and its one sentence
      // belong to the old packet, so they go with it.
      setGhostAnswer(null);
      setGhostTurnNote(null);
      void ghostRequest.ask(target);
    },
    [ghostRequest],
  );

  /**
   * The paste: wrap, validate and file a model's reply as a proposal. The
   * frozen packet's hash rides along when one is in flight (Epic 11 story 3):
   * the envelope records the ASK the reply answers, as provenance only.
   */
  const proposeGhost = useCallback(
    (raw: string) => {
      void ghosts.intake(raw, ghostRequest.packet?.freeze.hash ?? null);
    },
    [ghosts, ghostRequest.packet],
  );

  /**
   * THE GHOST'S TURN (Epic 15 story 8): carry the frozen packet to the model
   * the rows name, read the ONE proposal block after the answer completes, and
   * hand its body to the EXISTING intake — the same door the paste uses, with
   * the same grammar, run state and refusal. The turn itself writes nothing;
   * an answer with no usable block stands as text and one sentence says why.
   *
   * Nothing is applied here. A filed proposal is a ghost row the person opens
   * and accepts through the existing accept; a rejected one is deleted and the
   * workspace returns to its bytes.
   */
  const sendGhostPacket = useCallback(async () => {
    const packet = ghostRequest.packet;
    if (packet === null || ghostSending) return;
    setGhostSending(true);
    setGhostAnswer(null);
    setGhostTurnNote(null);
    try {
      const settings = await loadTurnSettings();
      const resolved = resolveSelection(settings);
      if (resolved.kind !== "resolved") {
        setGhostTurnNote(PROVIDER_SENTENCES.nothing);
        return;
      }
      // The key is read for this provider only, at send time; a CLI or a local
      // runtime carries its own. It never enters state, a field or a sentence.
      const apiKey =
        resolved.provider.kind === "http"
          ? await readSecret(resolved.provider.id)
          : "";
      const route = routeOf(resolved.provider, resolved.model, apiKey);
      const started = await turnPort.start(route);
      if (started.kind === "refused") {
        setGhostTurnNote(started.sentence);
        return;
      }
      const result = await turnPort.ask(route, packet.freeze.bytes);
      if (result.kind !== "answer") {
        setGhostTurnNote(result.sentence);
        return;
      }
      setGhostAnswer(result.text);
      const read = readProposal(result.text);
      if (read.kind === "none") return;
      if (read.kind === "invalid") {
        setGhostTurnNote(read.sentence);
        return;
      }
      const intake = await ghosts.intake(read.body, packet.freeze.hash);
      if (intake === null) return;
      if (!intake.ok) {
        // The grammar's own words: an unregistered move, a refused target kind,
        // the wrong game, a moved pin — never reworded here.
        const said = intake.issues.map((entry) => entry.message).join("; ");
        setGhostTurnNote(said === "" ? null : said);
        return;
      }
      // The first block became a ghost; a second was ignored, said in one
      // sentence beside it.
      if (read.sentence !== null) setGhostTurnNote(read.sentence);
    } catch {
      // A pipe that broke before the answer, or a session that closed under
      // the intake: the turn's own sentence, never a new one.
      setGhostTurnNote(TURN_SENTENCES.unreachable);
    } finally {
      setGhostSending(false);
    }
  }, [ghostRequest.packet, ghostSending, ghosts]);

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
   * Close the pull ask's reading (Epic 13 story 2, ADR-0030 decision 4). The
   * close IS the dismissal — the same act — so it drops the value and does
   * nothing else: nothing is written, nothing is suppressed, and the reader
   * keeps no memory of what was shown. A branch switch and a workspace change
   * also close it: the pins and the map it read are not the ones now running.
   */
  const closePullAsk = useCallback(() => {
    setPullReading(null);
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
      // DEPRECATED (hidden 2026-11-16 per user review — separate maps): the
      // selector edits the PLAYING SET, a dynamics-map surface, and the map
      // content rule blanks it off concept — so a deliberate entry no longer
      // asks. The prompt rule itself (`shouldPromptForSet`) and the selector
      // stay written and tested — delete this guard in the deprecated sweep.
      if (
        showsMapContent(next) &&
        shouldPromptForSet(cause, next, model !== null)
      ) {
        openSelector();
      }
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
      // DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps,
      // ADR-0032): the camera used to be moved INTO the new map's band. Each map
      // keeps its OWN camera now, so a switch needs no camera move at all — the
      // map you land on brings back the view you left it at. The band intent
      // (`intents.setZoomBand`, useCamera.ts) stays written for the flip-back —
      // delete this branch and the intent in the deprecated sweep.
      if (!zoomSwitchesMap()) return;
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
   *
   * SUPERSEDED BY ADR-0032 (2026-11-16): the paragraph above is the pre-review
   * promise. The wheel no longer changes the map, so nothing is ever held; the
   * pin, this release and the focus reading stay written and idle behind
   * `zoomSwitchesMap` for the flip-back.
   */
  const releasePin = useCallback(() => {
    // DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps,
    // ADR-0032): the pin existed to HOLD a wheel crossing so a zoom could not
    // close an armed gesture or discard typed text. The wheel no longer changes
    // the map, so there is nothing to hold and nothing to re-derive; the pin,
    // `shouldPinLevel`, the focus reading and the handoff's settle all stay
    // written and type-checked for the flip-back — delete this early return in
    // the deprecated sweep.
    if (!zoomSwitchesMap()) return;
    if (!levelPin.held()) return;
    handoff.settle(levelPin.release(cameraZoomRef.current));
  }, [handoff, levelPin]);

  /**
   * Open-restore: the workspace's `level` hint sets the MAP on open, and it
   * NEVER writes — a hand-edited key is honored here and rewritten only by a tab
   * press. A layout effect, so the first painted frame is already the resumed
   * map (no concept flash before ground).
   *
   * DEPRECATED (hidden 2026-11-16 per user review — separate mini-apps,
   * ADR-0032): the restore used to move the camera INTO the resumed band as well
   * (ADR-0018 decision 2). Each map keeps its own camera now, so the resumed map
   * opens on its own opening camera; the hint still remembers the last map.
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
      // The pull's reading goes with it, for the same reason: the pins it read
      // belong to the branch that just stopped running.
      closePullAsk();
      releasePin();
    },
    [cancelPendingGestures, closeComparison, closePullAsk, releasePin],
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

  /* --------------------------------------------------------------------- *
   * Epic 13 story 2: the pull ask (ADR-0030).
   * --------------------------------------------------------------------- */

  /**
   * THE PULL ASK — the ONE press, and the pull's only trigger (ADR-0030
   * decision 6). It hands the records the app already holds, plus the running
   * branch's pins, to the one handler and keeps the reading it answers. The
   * reading writes NOTHING: the handler has no path, no bridge and no writer,
   * and nothing here does either.
   *
   * The committed model pins nothing, so with no branch there are no pins (the
   * record's own absence). A branch's pins are read from its folder — the
   * ordinary read, never a write — and a reading that cannot be made is not
   * shown rather than invented (the comparison's rule, applied to the ask).
   *
   * Asking again is the same act: the state is replaced with a fresh reading of
   * the records as they stand now, never merged with or compared to the last
   * one. The surface compares nothing; the record set is the answer.
   */
  const openPullAsk = useCallback(() => {
    const path = workspace?.path;
    if (path === undefined) return;
    // ONE handler call, whichever pins the press brings: the records the app
    // holds, plus this branch's pin lines. Nothing else is passed and nothing
    // is kept.
    const show = (pins: readonly Assumption[]) => {
      setPullReading(
        askPull({ marks, assumptions, quantities, pointers, veils, pins }),
      );
    };
    if (scenario === null) {
      show([]);
      return;
    }
    void readScenarioPins(path, scenario)
      .then((parsed) => show(parsed.pins))
      .catch(() => undefined);
  }, [
    workspace?.path,
    scenario,
    marks,
    assumptions,
    quantities,
    pointers,
    veils,
  ]);

  // A new workspace (or none) closes the reading: it was read from a map that
  // is no longer open, and showing it under another map's name would be a lie.
  // Closing writes nothing and remembers nothing.
  useEffect(() => {
    closePullAsk();
  }, [workspace?.path, closePullAsk]);

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
   * A zoom gesture settled. DEPRECATED (hidden 2026-11-16 per user review —
   * separate mini-apps, ADR-0032): this is where the WHEEL used to switch the
   * map — the settled zoom was derived into a band (ADR-0018 decision 1) and,
   * unless the level pin held it (decision 3), the handoff switched the map and
   * rewrote the resume hint (decision 2).
   *
   * The maps are separate mini-apps now: the TABS switch them and nothing else,
   * and the wheel only zooms within the current map — so this path answers
   * nothing at all while the flag stands. The pin, the derivation and the
   * handoff's settle stay written and type-checked for the flip-back — delete
   * this early return in the deprecated sweep.
   */
  const handleZoomSettle = useCallback(
    (zoom: number) => {
      if (!zoomSwitchesMap()) return;
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
   * The level control's `draw` toggle (added 2026-11-16 per user review): the
   * map's pen. Pressing it while the pen is armed ends the mode — the strokes
   * are already written, so putting the pen down writes nothing. Arming runs
   * the app's one cancel-pending path first (one armed gesture at a time) and
   * the gate's `draw` mode takes the pointer, exactly as the veil's box arm
   * does: pan, double-click creation and every word press stand still.
   */
  const toggleDraw = useCallback(() => {
    if (drawArmed) {
      setDrawArmed(false);
      return;
    }
    cancelPendingGestures();
    setDrawArmed(true);
  }, [drawArmed, cancelPendingGestures]);

  // Esc ends the drawing mode (the veil's arm idiom): the strokes stay, the
  // capture surface goes, and the plane's own gestures come back.
  useEffect(() => {
    if (!drawArmed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      setDrawArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [drawArmed]);

  /**
   * One stroke from the plane (added 2026-11-16 per user review): the pen's
   * ink and thickness as they stand, and the world-space path the drag
   * reported — one line appended to `map/sketches.jsonl` through useMap, in
   * the same in-order queue as every other record write.
   */
  const handleSketch = useCallback(
    (points: readonly { x: number; y: number }[]) => {
      addSketch(penColor, penSize, points);
    },
    [addSketch, penColor, penSize],
  );

  /**
   * One ERASE gesture from the plane (added 2026-11-16 per user review): the
   * drag's world path, and the reach the strip's selected size buys (useMap
   * computes it with `eraserRadius`: the size drives whichever tool is live).
   * Every stroke the path reaches goes WHOLE, and the rewrite is the drawing's
   * ordinary one — survivors keep their order and their exact record, the
   * malformed lines stay verbatim, one gesture is one undo. The gesture says
   * nothing about itself: no counter, no notice, no history.
   */
  const handleErase = useCallback(
    (path: readonly { x: number; y: number }[]) => {
      eraseSketch(penSize, path);
    },
    [eraseSketch, penSize],
  );

  /**
   * THE SELECTION TOOL's toggle (PROVISIONAL, added 2026-11-16 per the lead's
   * brief): the concept map's `select`, beside the pen in the level control.
   * Pressing it while the tool is armed puts it down — the games are already
   * written, so putting it down writes nothing. Arming runs the app's one
   * cancel-pending path first (one armed gesture at a time) and the gate's
   * `select` mode takes the pointer, exactly as the pen's `draw` does.
   */
  const toggleSelect = useCallback(() => {
    if (selectArmed) {
      setSelectArmed(false);
      return;
    }
    cancelPendingGestures();
    setSelectArmed(true);
  }, [selectArmed, cancelPendingGestures]);

  // Esc ends the selection tool (the pen's arm idiom): the saved games stay,
  // the capture surface goes and the plane's own gestures come back. While the
  // naming popup is open the CARD owns its escape (cancel the draft and keep
  // the tool armed), so this listener steps aside.
  useEffect(() => {
    if (!selectArmed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (gameDraft !== null) return;
      e.preventDefault();
      setSelectArmed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectArmed, gameDraft]);

  /**
   * One COMPLETED selection from the plane (PROVISIONAL, added 2026-11-16 per
   * the lead's brief): the shape the release drew. The membership is derived
   * right here — the words whose anchor (their measured box's centre) falls
   * inside the shape, and the distance wires whose BOTH ends do — because the
   * one fact the popup's rule needs is whether the region holds a word at all.
   * The pastel is picked in the same move (the rng is injected so the range is
   * testable), and the draft appears: the fill plus the card. NOTHING is
   * written yet.
   */
  const captureLanguageGame = useCallback(
    (shape: GameShape) => {
      const members = gameMembership(shape, selectorWords, distances);
      setGameDraft({
        shape,
        color: pickPastel(Math.random),
        hasWords: members.words.length > 0,
      });
    },
    [selectorWords, distances],
  );

  /**
   * The naming popup's submit: ONE line in `map/language-games.jsonl`, through
   * the same in-order record path as every other write. The card's rules are
   * asked again here (the write is where the rule is enforced): a blank name, a
   * name already taken, or a region holding no word writes nothing — the card
   * shows the quiet sentence and stays open. On success the draft becomes the
   * game's fill and the tool stays armed for the next selection.
   */
  const submitLanguageGame = useCallback(
    (name: string) => {
      const draft = gameDraft;
      if (draft === null) return;
      const problem: SubmitProblem = submitProblem(
        name,
        languageGames.map((game) => game.name),
        draft.hasWords,
      );
      if (problem !== null) return;
      createLanguageGame(name.trim(), draft.color, draft.shape);
      setGameDraft(null);
    },
    [gameDraft, languageGames, createLanguageGame],
  );

  /**
   * The popup's cancel — and the selection tool's whole undo: the draft fill
   * disappears and NOTHING is written (no line, no partial record). The tool
   * stays armed, so the person can draw the selection again.
   */
  const cancelLanguageGame = useCallback(() => {
    setGameDraft(null);
  }, []);

  /** The strip's shape choice: what the next drag draws (freeform opens). */
  const chooseGameShape = useCallback((shape: ShapeMode) => {
    setSelectShape(shape);
  }, []);

  /**
   * ALL LANGUAGE GAMES's door (PROVISIONAL, added 2026-11-16 per the lead's
   * brief): the concept map's quiet list of every saved game. Pressing it while
   * the list is open closes it; opening runs the app's one cancel-pending path
   * first, so one surface is live at a time. The list itself lives outside
   * `.plane`, so the plane's armed gate never reaches it.
   */
  const toggleGames = useCallback(() => {
    if (gamesOpen) {
      setGamesOpen(false);
      return;
    }
    cancelPendingGestures();
    setGamesOpen(true);
  }, [gamesOpen, cancelPendingGestures]);

  const closeGames = useCallback(() => {
    setGamesOpen(false);
  }, []);

  /**
   * Bring one game FORWARD from the list (PROVISIONAL, added 2026-11-16 per the
   * lead's brief): its fill paints more opaquely than the others (the render's
   * reading of `focusedGame`) and the map CENTRES on the game's shape, keeping
   * the zoom the map is already at (ordinary navigation — a list pick never
   * changes the zoom). The camera is the app's, so the intent is asked here;
   * the plane's viewport is read from the DOM, the connect draw's idiom.
   */
  const pickLanguageGame = useCallback(
    (game: LanguageGame) => {
      setFocusedGame(game.name);
      const centre = shapeCenter(game.shape);
      const el = document.querySelector<HTMLDivElement>(".plane");
      if (!el) return;
      intents.centerOn(
        centre.x,
        centre.y,
        el.clientWidth / 2,
        el.clientHeight / 2,
        camera.zoom,
      );
    },
    [intents, camera.zoom],
  );

  /**
   * Delete one game — its designed exit (PROVISIONAL, added 2026-11-16 per the
   * lead's brief): the trash-bin row goes straight to the record's own delete
   * (the line leaves, no tombstone, no confirmation dialog, no history). A game
   * that was brought forward stops being so; nothing else follows a game.
   */
  const deleteLanguageGame = useCallback(
    (name: string) => {
      removeLanguageGame(name);
      setFocusedGame((current) => (current === name ? null : current));
    },
    [removeLanguageGame],
  );

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

  /**
   * A word's own write (rename, memory, drag settle) — with the SHELF's hold.
   *
   * DEPRECATED (hidden 2026-11-16 per user review): while the shelf is hidden a
   * settled drag cannot park a word past the fold (`heldLeftOfTheFold` stops it
   * at the old fold line). Without the hold the drop would land the word in the
   * set-aside set the render no longer shows, and the person would watch their
   * word vanish with nothing to bring it back. PROVISIONAL: the invisible edge is
   * the review's named cost (deprecations.ts); it goes away with the flip-back —
   * delete this wrapper in the deprecated sweep.
   */
  const changeWord = useCallback(
    (word: Reference) => {
      const x = heldLeftOfTheFold(word.x, shelfX);
      updateReference(x === word.x ? word : { ...word, x });
    },
    [shelfX, updateReference],
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

  /**
   * A double-click on empty plane opens that map's creation affordance at the
   * point. Concept (and, while it waits for its own modelling surfaces,
   * dynamics) opens the ring menu.
   *
   * STORY 17.10 — THE USER'S CORRECTION: "a double click opens a bubble menu and
   * you can select reference or ask." GROUND now opens the SAME bubble the
   * concept map opens (canvas/PlaneMenu.tsx), with the ground's own doors: ask
   * first, then the reference doors, then session. Choosing a reference door
   * opens the existing ground form on that intent; choosing ASK makes a peer
   * card at the point. The bubble is not a second invention — it is the concept
   * map's component, its placement and its dismissal discipline, reused.
   */
  const handlePlaneDoubleClick = useCallback(
    (point: Point) => {
      if (level === "ground") {
        // STORY 25-19 (the person): the double-click and the wire open THE
        // SAME MENU — the two-step bubble — so the door list is not the
        // ground's front door any more (its site stays written for the
        // flip-back, the sheet's own idiom).
        setMenuAt(null);
        setGroundMenuAt(null);
        setGroundAt(point);
        return;
      }
      setGroundAt(null);
      setGroundMenuAt(null);
      setMenuAt(point);
    },
    [level],
  );

  const closePlaneMenu = useCallback(() => setMenuAt(null), []);
  const closeGroundBubble = useCallback(() => setGroundAt(null), []);

  /**
   * STORY 20.3 — A WIRE DRAG RELEASED ON EMPTY PLANE: open the ground bubble
   * there, already hooked to the card the drag began from. Nothing is written
   * here. The bubble's own create lands the card the person authors, and
   * wireHookedCreate gives it the one wire the gesture promised.
   */
  const openHookedCreate = useCallback((from: string, at: Point) => {
    groundHookupClaimRef.current = newWireClaim();
    setMenuAt(null);
    setGroundMenuAt(null);
    setGroundIntent("file");
    setGroundAt({ x: at.x, y: at.y, hookup: from });
  }, []);

  /**
   * STORY 20.3 — THE CREATED CARD'S ONE WIRE. Whatever door of the bubble made
   * it — a file, a folder, a page, a video, a session — a landed card takes
   * exactly ONE pair from the drag's source, through the layer's existing link
   * write (addGroundLink, its one history line, its mirror). No family is
   * named here and none is asked: this is generic by construction. A bubble
   * opened by a double-click carries no hookup and owes nothing.
   */
  const wireHookedCreate = useCallback(
    async (made: GroundAddResult): Promise<GroundAddResult> => {
      const wire = groundHookupClaimRef.current.take(
        groundAt?.hookup ?? null,
        made,
      );
      if (wire === null) return made;
      await ground.link(wire.from, wire.to);
      return made;
    },
    [ground, groundAt],
  );

  const dismissDropNotice = useCallback(() => setDropNotice(null), []);
  const closeGroundMenu = useCallback(() => setGroundMenuAt(null), []);

  /**
   * STORY 17.10 — any door of the double-click bubble: the existing form, on
   * that door. STORY 21.13 makes ASK one of them, so the name is asked FIRST
   * here too (the bubble's own rule refuses a blank one); the card is made by
   * the bubble's create, which is also where 20.3's wire finds it.
   */
  const chooseGroundDoor = useCallback(
    (intent: GroundIntent) => {
      const spot = groundMenuAt;
      if (spot === null) return;
      setGroundMenuAt(null);
      setGroundIntent(intent);
      setGroundAt(spot);
    },
    [groundMenuAt],
  );

  /** The ground bubble's one write: the app's loaded ground state owns it. */
  const addGroundAt = useCallback(
    async (name: string, from: string) => {
      if (groundAt === null) {
        return { ok: false, message: "nothing was written." };
      }
      return wireHookedCreate(
        await ground.create(name, groundAt.x, groundAt.y, from),
      );
    },
    [ground, groundAt, wireHookedCreate],
  );

  /**
   * STORY 21.13 — the ground bubble's ASK door: an EMPTY ask card at the point,
   * under the person's own name. The card's one creation road is the ask's own
   * (useGround.createEmptyAsk): one record line, no question, no turn, no
   * conversation file. When the bubble was opened by 20.3's wire release, the
   * same wrapper writes the gesture's one wire; a double-clicked bubble carries
   * no hookup, so it owes and writes none.
   */
  const addGroundAsk = useCallback(
    async (name: string) => {
      if (groundAt === null) {
        return { ok: false, message: "nothing was written." };
      }
      return wireHookedCreate(
        await ground.createEmptyAsk(name, groundAt.x, groundAt.y),
      );
    },
    [ground, groundAt, wireHookedCreate],
  );

  /**
   * PROVISIONAL — the ground bubble's FOLDER door: a PROJECT CARD at the
   * double-clicked point. The picked folder is stored as the pointer; nothing
   * is read or copied from it. A blank name or no folder refuses and writes
   * nothing.
   */
  const addGroundFolderAt = useCallback(
    async (name: string, folder: string) => {
      if (groundAt === null) {
        return { ok: false, message: "nothing was written." };
      }
      return wireHookedCreate(
        await ground.createFolder(name, groundAt.x, groundAt.y, folder),
      );
    },
    [ground, groundAt, wireHookedCreate],
  );

  /**
   * The ground bubble's OTHER source (story 16.14): a pasted web address. The
   * sidecar reads it once; the app keeps the text and a local image. A refused
   * page creates nothing.
   */
  const addGroundPageAt = useCallback(
    async (name: string, url: string) => {
      if (groundAt === null) {
        return { ok: false, message: "nothing was written." };
      }
      return wireHookedCreate(
        await ground.createPage(name, groundAt.x, groundAt.y, url),
      );
    },
    [ground, groundAt, wireHookedCreate],
  );

  /**
   * STORY 18.3 — the ground bubble's SESSION door: a name and ONE tool row, at
   * the point the person double-clicked. The card is a record; nothing runs
   * until its own run is pressed, and no transcript exists before that.
   */
  const addGroundSessionAt = useCallback(
    async (name: string, tool: string) => {
      if (groundAt === null) {
        return { ok: false, message: "nothing was written." };
      }
      return wireHookedCreate(
        await ground.createSession(name, tool, groundAt.x, groundAt.y),
      );
    },
    [ground, groundAt, wireHookedCreate],
  );

  /**
   * The ground bubble's THIRD source (story 16.15): a pasted video address. The
   * sidecar reads its oEmbed look once; the app keeps the title and a local
   * thumbnail. A refused read creates nothing.
   */
  const addGroundVideoAt = useCallback(
    async (name: string, url: string) => {
      if (groundAt === null) {
        return { ok: false, message: "nothing was written." };
      }
      return wireHookedCreate(
        await ground.createVideo(name, groundAt.x, groundAt.y, url),
      );
    },
    [ground, groundAt, wireHookedCreate],
  );

  /**
   * STORY 16.20 — A FILE DROPPED FROM THE OS. The window's own event (heard in
   * canvas/osDropWindow.ts) hands this the paths and the pointer; the pure
   * rules in canvas/osDrop.ts decide the point, the cascade, the intents and
   * the ONE sentence.
   *
   * NOTHING HERE WRITES: each file goes through `ground.create`, the same
   * creation path the bubble uses, so a record's shape cannot drift between a
   * picked file and a dropped one; a dropped or pasted LINK goes through
   * `ground.createPage`, the bubble's page card creator, so the fetch, the
   * guards, the local thumbnail and the refusals are the same one path (story
   * 16.34). A drop during a card drag or a wire drag is IGNORED, and a drop ONTO
   * a card creates nothing (a card is not a place to put a card); neither says
   * anything, because the gesture was never about a drop. A transform that
   * cannot say where the pointer is writes nothing.
   */
  const handleOsDrop = useCallback(
    async (drop: OsDrop) => {
      // The ground map is the only map whose cards point at files.
      if (level !== "ground") return;
      // The hand is mid-gesture: a card appearing under it is an interruption.
      if (dropBlocked(gesture, gestureMode !== "idle")) return;
      const plane = document.querySelector(".plane");
      if (!(plane instanceof HTMLElement)) return;
      // A drop onto a card is not a card-on-card act (out of scope).
      if (dropLandsOnCard(document.elementFromPoint(drop.client.x, drop.client.y))) {
        return;
      }
      // THE POINTER, through the plane's own conversion (geometry.ts). A
      // conversion that fails has no place to put a card, so nothing is made.
      const origin = dropWorldPoint(
        drop.client,
        plane.getBoundingClientRect(),
        camera,
      );
      if (origin === null) return;
      const items = [...drop.paths, ...drop.links];
      // A native drop that carried nothing usable is still a drop the person
      // made: one sentence, not silence. A browser link the platform would not
      // hand over lands here (osDropWindow.ts says why), so the person learns
      // the link did not arrive instead of watching nothing happen.
      if (items.length === 0) {
        setDropNotice({
          at: origin,
          text: NOT_A_FILE_OR_LINK,
          taken: Date.now(),
        });
        return;
      }
      const outcome = await runOsDrop(
        items,
        origin,
        ground.create,
        ground.createPage,
      );
      if (outcome.notice === null) return;
      setDropNotice({ at: origin, text: outcome.notice, taken: Date.now() });
    },
    [camera, gesture, gestureMode, ground.create, ground.createPage, level],
  );

  // The window's drop listener is attached ONCE; the ref lets it always read
  // the handler this render made, without re-subscribing on every camera move.
  const osDropHandlerRef = useRef<(drop: OsDrop) => void>(() => {});
  osDropHandlerRef.current = handleOsDrop;
  useEffect(() => {
    let stop: (() => void) | null = null;
    let gone = false;
    void listenOsDrop((drop) => {
      void osDropHandlerRef.current(drop);
    })
      .then((unlisten) => {
        if (gone) unlisten();
        else stop = unlisten;
      })
      // A window that cannot report drops (a plain browser tab) simply has
      // none: the bubble's own pick stays the way in.
      .catch(() => {});
    return () => {
      gone = true;
      stop?.();
    };
  }, []);

  // The last place the pointer rested over the plane, in viewport pixels. A
  // paste has no cursor of its own; this is its stand-in (PROVISIONAL).
  const lastPlanePointRef = useRef<DropClientPoint | null>(null);

  /**
   * STORY 16.34 — PASTE A LINK, AND IT LANDS WHERE YOU LAST POINTED.
   *
   * A paste has no canvas cursor, so the point is the last place the pointer
   * rested over the plane (linkPaste.ts's `pasteWorldPoint`), or the visible
   * centre when it never has. The event is heard here, beside the drop, and it
   * is NOT a hijack: `pasteBelongsToField` hands a paste inside a text field
   * back to the field before the clipboard is read. A pasted string that is not
   * an http(s) address creates NOTHING — plain text has no card family yet, so
   * the paste is left alone rather than refused loudly. A paste onto a card
   * creates nothing (16.20's rule, kept), and the card itself is made by
   * `ground.createPage` — the bubble's page card path, never a second one.
   */
  const handleLinkPaste = useCallback(
    (event: ClipboardEvent) => {
      if (level !== "ground") return;
      const target =
        event.target instanceof Element ? event.target : null;
      const active =
        document.activeElement instanceof Element
          ? document.activeElement
          : null;
      // The paste belongs to the field, not to the map.
      if (pasteBelongsToField(target, active)) return;
      const url = pasteUrl(event.clipboardData?.getData("text/plain") ?? "");
      // Plain text is out of scope: there is no text-card family yet, so a
      // non-address paste is not a refusal — it is simply not this gesture.
      if (url === null) return;
      if (dropBlocked(gesture, gestureMode !== "idle")) return;
      const plane = document.querySelector(".plane");
      if (!(plane instanceof HTMLElement)) return;
      const rect = plane.getBoundingClientRect();
      const last = lastPlanePointRef.current;
      // A pasted card is not a card-on-card act: the point under it decides.
      const client = pasteClientPoint(last, rect);
      if (dropLandsOnCard(document.elementFromPoint(client.x, client.y))) {
        return;
      }
      const origin = pasteWorldPoint(last, rect, camera);
      if (origin === null) return;
      void ground
        .createPage(pasteName(url), origin.x, origin.y, url)
        .then((result) => {
          if (result.ok) return;
          // The creator's own refusal, at the paste's point — one sentence.
          setDropNotice({ at: origin, text: result.message, taken: Date.now() });
        });
    },
    [camera, gesture, gestureMode, ground.createPage, level],
  );

  useEffect(() => {
    const note = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest(".plane") !== null) {
        lastPlanePointRef.current = { x: event.clientX, y: event.clientY };
      }
    };
    document.addEventListener("pointermove", note, true);
    document.addEventListener("pointerdown", note, true);
    return () => {
      document.removeEventListener("pointermove", note, true);
      document.removeEventListener("pointerdown", note, true);
    };
  }, []);

  // ONE paste listener, attached once, reading this render's handler by ref.
  const linkPasteHandlerRef = useRef<(event: ClipboardEvent) => void>(() => {});
  linkPasteHandlerRef.current = handleLinkPaste;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      linkPasteHandlerRef.current(event);
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, []);

  /** The menu's word choice: close it and open the in-place coin field. */
  const chooseWord = useCallback(() => {
    const spot = menuAt;
    if (!spot) return;
    setMenuAt(null);
    // DEPRECATED (hidden 2026-11-16 per user review): a word coined past the old
    // fold would land in the set-aside set the render no longer shows — it would
    // vanish on its own measurement — so the coin is held just short of the fold
    // while the shelf is hidden (PROVISIONAL: the review's named cost). Delete
    // the hold with the shelf in the deprecated sweep.
    coinReference(heldLeftOfTheFold(spot.x, shelfX), spot.y);
  }, [menuAt, coinReference, shelfX]);

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

  /**
   * The menu's DRAW choice (PROVISIONAL, added 2026-11-16 per user review): the
   * review asked for the map's pen on the bubble cluster, not only in the level
   * control. It is an ACTION, not a creation kind — no `CreationKind` grows, so
   * the creation grammar and the ghost's card derivation keep their shape. The
   * press selects the strip's PEN explicitly (the bubble says "draw"; the eraser
   * stays one press away once armed), then runs the app's ONE cancel-pending
   * path (one armed surface at a time — this is also what dismisses the cluster)
   * and arms the gate's `draw` mode, exactly as the level control's toggle does.
   * It always ARMS rather than toggles: the cluster only exists while the gate is
   * idle, and while the pen is armed a double-click opens nothing
   * (gates.ts's `shouldCreate`), so nothing here can double-arm the pen.
   */
  const chooseDraw = useCallback(() => {
    setPenTool("pen");
    cancelPendingGestures();
    setDrawArmed(true);
  }, [cancelPendingGestures]);

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
    // DEPRECATED (hidden 2026-11-16 per user review — separate maps): the same
    // guard for the open that RESUMES in dynamics — a blank map cannot show the
    // playing set the prompt would ask for — delete in the deprecated sweep.
    if (!showsMapContent(workspace.resumeLevel)) return;
    if (!shouldPromptForSet("restore", workspace.resumeLevel, model !== null)) {
      return;
    }
    if (autoPromptedRef.current === workspace.path) return;
    autoPromptedRef.current = workspace.path;
    openSelector();
  }, [workspace, loaded, model, openSelector]);

  // STORY 21.4 — THE DEV COMMAND FILE (ADR-0038 decision 6, second half): a
  // DEVELOPER build may watch ONE file a person named explicitly and run the
  // act script written there through the SAME apply path the command card uses
  // (propose, then accept in one call), appending one JSON line per act to
  // `<path>.results`. No socket, no port, no listening, no discovery: the gate
  // (`dev/gate.ts`) refuses without an absolute path, and this whole block is
  // written behind `import.meta.env.DEV`.
  //
  // RELEASE BUILD REFUSES: `import.meta.env.DEV` is replaced with `false` at
  // build time, so the block — and the dynamic import that is
  // `dev/commandFile.ts`'s ONLY reference — is dropped from a release bundle.
  // The watcher module is loaded lazily for exactly that reason; a static
  // import would ship it whatever the guard said. `dev-command-file.test.ts`
  // holds the shape in place: the guard is the build's own flag, the import is
  // dynamic and guarded, and no other module imports the watcher.
  useEffect(() => {
    let stop: (() => void) | null = null;
    let cancelled = false;
    if (import.meta.env.DEV) {
      const path = devCommandsPath(
        import.meta.env.ATTENTIONEER_DEV_COMMANDS,
        import.meta.env.DEV,
      );
      if (path !== null && workspace !== null) {
        const workspacePath = workspace.path;
        void import("./dev/commandFile").then(({ startDevCommandFile }) => {
          if (cancelled) return;
          stop = startDevCommandFile({
            path,
            deps: {
              readText: (file) => readTextFile(file),
              // APPEND, in the app's own vocabulary: read the earlier bytes and
              // write them back untouched with the new lines after them. The
              // watcher never writes the script and never deletes either file.
              appendText: async (file, text) => {
                const earlier = await readTextFile(file);
                await writeTextFile(file, (earlier ?? "") + text);
              },
              // THE COMMAND CARD'S PATH, NOT A SECOND ONE: a fresh host over
              // the window's bridge, the one-press apply (execute then accept),
              // then the map re-reads so the cards show what landed.
              applyScript: async (acts) => {
                const host = createAttentioneerHost({
                  workspacePath,
                  io: tauriCommandIo,
                });
                const result = await applyCommandScript(acts, host);
                await ground.reload();
                return result;
              },
            },
          });
        });
      }
    }
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [workspace, ground.reload]);

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

  // THE SEPARATE-MAPS RULE (added 2026-11-16 per user review): the concept
  // map's record content renders at concept only while deprecations.ts's flag
  // stands — the dynamics and ground maps are BLANK PAPER for now (their own
  // content — modeling surfaces, file references — is a LATER story, not this
  // one). ONE reading, `canvas/mapContentRules.ts`; every hiding point below
  // asks it, so flipping the flag back restores the content with no edit here.
  //
  // NOT content, and deliberately left rendering in every game: the grid/paper,
  // pan, zoom, the zoom chip, the three level tabs, the pen's strip while
  // armed — and THE PEN'S INK (`SketchLayer` below), PROVISIONAL while per-map
  // ink waits for the later "context" work. The HONESTY SURFACES
  // (`MarkNotices` and every scan) are not gated either: an unreadable or
  // orphaned record line is surfaced whatever the plane shows (ADR-0009); the
  // tension — a notice can name a record whose content this game hides — is
  // reported, never silenced.
  const mapContent = showsMapContent(level);

  return (
    <>
      {/* DEPRECATED (hidden 2026-11-16 per user review): this plane used to
          take a dynamics-only creation hint naming the ring menu's lack and
          assumption. That creation grammar is hidden, and the SEPARATE-MAPS
          rule owns the whole sentence now (`mapContentRules.ts`'s
          `planeHint`): at concept it is byte-identically the old sentence
          (word + the shelf's fold), off concept it names the pen and NOT the
          shelf, because a blank map has no fold to drag past — delete the old
          clause in the deprecated sweep. */}
      <CanvasPlane
        camera={camera}
        intents={intents}
        mapId={level}
        onPlaneDoubleClick={handlePlaneDoubleClick}
        gestureMode={gestureMode}
        onNarrate={narrate}
        hint={
          // STORY 16.16 (shortlist item 5): the bar is the ACTIVE channel, so
          // while a tool is armed the idle hint yields its place — one voice at
          // the bottom of the plane at a time.
          armedTool !== null
            ? ""
            : // STORY 16.13 (shortlist item 3): an empty ground map says ONE
              // muted sentence and nothing else, so the ordinary hint (which
              // offers a verb) is suppressed while there is nothing on it.
              level === "ground" && ground.loaded && ground.references.length === 0
              ? ""
              : planeHint(level)
        }
        lassoArmed={selectorOpen && lassoArmed}
        boxArmed={veilArmed}
        drawArmed={drawArmed}
        drawPen={{ color: penColor, size: penSize }}
        drawTool={penTool}
        onSketch={handleSketch}
        onErase={handleErase}
        selectArmed={selectArmed && gameDraft === null}
        selectShape={selectShape}
        onSelectShape={captureLanguageGame}
        picking={markDrag.ghost !== null}
        onLasso={handleLasso}
        onDrawBox={captureVeilBox}
        onZoomSettle={handleZoomSettle}
      >
        {/* the shelf's fold and margin: a place in world space (story 3). Its
            drawn extent covers the world's words (story 3 of Epic 6), so a word
            set aside far below still reads as set aside.

            DEPRECATED (hidden 2026-11-16 per user review — separate maps): the
            shelf is the concept map's content, so it renders at concept only;
            the fold, its extent and the shelf record all stay — delete in the
            deprecated sweep. */}
        {mapContent && <ShelfFold shelfX={shelfX} extent={fold} />}

        {/* stored loops render at Level 2 only (story 3): a quiet closed route
            through each loop's words in path order, beneath the words so it
            hugs them, with the coined name near it. The route or the name opens
            the walk; the name renames on double-click and removes on its ×.

            DEPRECATED (hidden 2026-11-16 per user review — separate maps): a
            loop route is dynamics-map content and the dynamics map is blank
            for now, so it renders at concept only (where none is ever drawn) —
            the loop records, the route and the walk all stay — delete in the
            deprecated sweep. */}
        {mapContent && loopRoutes.map(({ loop, points, nameAt }) => (
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

        {/* bare lacks: one quiet ring per open spot (story 2).

            DEPRECATED (hidden 2026-11-16 per user review — separate maps): a
            mark is concept-map content, so the rings render at concept only;
            the mark record and its gestures all stay — delete in the deprecated
            sweep. */}
        {mapContent && openSpots.map((spot) => (
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
            carries a claim; pressing it opens the quiet overlay. Level 2 only.

            DEPRECATED (hidden 2026-11-16 per user review — separate maps): the
            diamond is dynamics-map content and the dynamics map is blank for
            now, so the map-content rule closes it as well as the level — the
            assumption records and the overlay all stay — delete in the
            deprecated sweep. */}
        {level === "dynamics" &&
          mapContent &&
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

        {/* words

            DEPRECATED (hidden 2026-11-16 per user review — separate maps): the
            coined words are the concept map's content, so they render at
            concept only. Every read, every gesture and the whole word row stay
            written (the map content rule gates the RENDER, never the record) —
            delete in the deprecated sweep.

            DEPRECATED (hidden 2026-11-16 per user review): the render also asks
            the SHELF's reading — `shownRefs` is every word the record holds EXCEPT
            the ones set aside, which are not shown while the shelf is hidden
            (`setAsideSlugs` above). Delete that filter with the shelf in the
            deprecated sweep. */}
        {/* THE LANGUAGE GAMES' fills (PROVISIONAL, added 2026-11-16 per the
            lead's brief): one world-space wash per saved game, in FILE ORDER
            (later games paint over earlier ones), above the paper and BELOW the
            words and the pen's ink (canvas.css's layer rule), so a name always
            reads over a tint. Overlapping games are allowed by design. The game
            brought forward from the list paints more opaquely than the rest.
            CONCEPT ONLY (`languageGamesLive`, the separate-maps rule): the
            dynamics and ground maps stay blank paper. The DRAFT is the unsaved
            selection the naming popup asks about — cancel drops it, submit
            turns it into one line. */}
        {languageGamesLive(level) &&
          languageGames.map((game, index) => (
            <LanguageGameFill
              key={`language-game-${index}-${game.name}`}
              shape={game.shape}
              ink={gameInk(game.color)}
              opacity={
                focusedGame === game.name
                  ? GAME_FOCUS_OPACITY
                  : GAME_FILL_OPACITY
              }
            />
          ))}
        {languageGamesLive(level) && gameDraft !== null && (
          <LanguageGameFill
            shape={gameDraft.shape}
            ink={gameInk(gameDraft.color)}
            opacity={GAME_DRAFT_OPACITY}
          />
        )}

        {mapContent && shownRefs.map((word) => (
          <ReferenceWord
            key={word.id}
            word={word}
            position={posOf(word)}
            onChange={changeWord}
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
              if (candidate.slug !== null) closePrismFor(candidate.slug);
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
              if (candidate.slug !== null) closePrismFor(candidate.slug);
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
        {veilLive(level) && (
          <>
            {/* DEPRECATED (hidden 2026-11-16 per user review — separate maps):
                the level rule stays exactly as it was (veils cover Levels 1–2);
                the SEPARATE-MAPS rule additionally blanks the sheet off concept
                while the flag stands, because the dynamics map is blank paper
                for now. Both readings render here, so a flip-back restores the
                veil by its own flag alone — delete the second reading in the
                deprecated sweep. */}
            {mapContent &&
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
          </>
        )}

        {/* The map's ink (added 2026-11-16 per user review): every stroke of
            `map/sketches.jsonl` in world space, in FILE ORDER (later ink on
            top), drawn over the words and wires — the drawing is an annotation
            on the map, exactly as the pen's in-flight stroke previews it. The
            layer takes no press; the pen's own capture surface handles the
            stroke while its mode is armed.

            PROVISIONAL (kept in every game by the separate-maps review, hidden
            2026-11-16 per user review): the draw tool is the one level-uniform
            tool the previous review kept in the top menu, and per-map ink
            arrives with the later "context" work. The map-content rule
            deliberately does NOT gate this layer; the lead will confirm with
            the person. */}
        <SketchLayer strokes={sketches} />

        {/* STORY 16.5, the ground map's WIRES: one quiet, WORDLESS line per
            link, drawn in the plane's world space BEHIND the cards and with
            the same camera transform they use. A link is not a Distance (the
            epic's REFRAME, 2026-11-17): there is no label, no arrowhead and no
            count, and the recorded direction is read by nothing. An orphan
            link has no card to attach to, so it is not drawn; the ground
            notices group names it and the file keeps it. */}
        {level === "ground" && (
          <>
            <GroundWires
              links={ground.links}
              references={ground.references}
              asks={ground.asks}
              sessions={ground.sessions}
              onRemoveLink={ground.unlink}
              drag={groundDrag}
              working={groundWorking}
            />
            {/* STORY 24-3 (ADR-0043) — the alignment guides ride the same
                channel as the wires: faint lines where a dragged card's edges
                line up with a neighbour's. VISUAL ONLY — nothing snaps, and
                they vanish with the hand. */}
            <GroundGuides
              cards={[
                ...ground.references,
                ...ground.asks,
                ...ground.sessions,
              ]}
              drag={groundDrag}
            />
          </>
        )}

        {/* THE GROUND MAP's own layer (story 16.1): its references are drawn
            at their points, with the reading's opening lines and the file's
            name — never the concept map's words, distances, marks, veils,
            ghosts or quantities. The separate-maps rule stays exactly as it
            was; this is the ground map's own content, mounted only here. The
            layer is in FILE ORDER; its rows are content, so a press on one
            never creates over it. STORY 16.2 makes each card live without
            leaving this map: a drag moves it (one x|y write on release), the
            state word is COMPUTED at load from the file's metadata, and the
            two re-reads (refresh, point at another file) are the person's
            alone — the app never re-reads a file behind their back. STORY 16.3
            makes each reference a fixed CARD: a cropped preview that expands
            into the STORED reading (no re-read, no I/O), and a two-step
            inline remove that takes the line, the reading and the text file
            through the one write path. Open/closed is view state, never a
            record: a reopened workspace shows every card small. STORY 16.8
            adds the pull: the expanded card's one "read more" verb asks the
            hook for more of the source under the stated budget, the answer is
            drawn as a continuation of the reading, and it is VIEW STATE only —
            nothing is written, nothing is re-stamped, and closing the card
            forgets it. */}
        {level === "ground" && (
          <GroundLayer
            references={ground.references}
            drag={groundDrag}
            readings={ground.readings}
            media={ground.media}
            thumbs={ground.thumbs}
            texts={ground.texts}
            notes={ground.notes}
            pulled={ground.pulled}
            states={ground.states}
            asks={ground.asks}
            askTurns={ground.askTurns}
            onCreateAsk={ground.createAsk}
            /* STORY 16.19 — a selection opens a question widget; its ask makes
               an empty peer ask card beside the source, wired to it, with the
               chosen words as one more context kind. */
            onAskFromSelection={ground.askFromSelection}
            onForkAsk={ground.forkAskAt}
            onRenameAsk={ground.renameAskTo}
            /* STORY 16.23 — an ask card is movable by its name or its body,
               through the same one drag rule and the same queued line write
               every other card uses. */
            onMoveAsk={ground.moveAsk}
            revealAsk={revealAsk}
            /* STORY 21.7 — the questions a command's accept left waiting in
               ask composers: a draft, never a record and never a send. */
            askDrafts={askDrafts}
            working={groundWorking}
        onAskTurn={ground.askTurn}
            onStopAskTurn={ground.askStop}
            /* STORY 18.3 — the session cards: their records, their transcripts
               and the runs that are live right now. The verbs are the hook's,
               the record is the map folder's. */
            sessions={ground.sessions}
            sessionEntries={ground.sessionEntries}
            sessionRunning={ground.sessionRunning}
            sessionPermission={ground.sessionPermission}
            sessionKeepNotice={ground.sessionKeepNotice}
            onRunSession={ground.runSession}
            /* STORY 21.1 — a follow-up into the card's last delegate session:
               the same hook, a fresh spawn, killed on every exit path. */
            onFollowUpSession={ground.followUpSession}
            onStopSession={ground.stopSession}
            onAnswerSessionPermission={ground.answerSessionPermission}
            /* STORY 22.6 — the card's ONE result press: the hook's chain tries
               the curator and falls back to 18.4's copy, so no completed run
               dead-ends and the outcome line names which card was made. */
            onKeepSessionResult={ground.keepRunResult}
            /* STORY 22.1 — a tool row's per-machine fact and its one verb: a
               tiny task through the existing run lane, and (only when it
               answers) the fact the face and the picker's label both read. */
            toolRowFacts={ground.toolRowFacts}
            onTestSessionRow={ground.testSessionRow}
            /* STORY 22.1b — the tool's own sign-in: a setup child hosted by the
               sidecar's own lane, its newest line as view state, and the three
               presses. Nothing about the row's state changes here. */
            sessionSignIn={ground.sessionSignIn}
            onStartSessionSignIn={ground.startSessionSignIn}
            onSendSessionSignInCode={ground.sendSessionSignInCode}
            onStopSessionSignIn={ground.stopSessionSignIn}
            onChooseSessionTool={ground.bindSessionTool}
            /* STORY 19.2 — a session card may be bound to a project card (a
               folder on this machine) and told what a run may do there. The
               binding is a pointer; the declared boundary is the consent, and
               without one the card runs exactly as it always has. */
            onBindSessionProject={ground.bindSessionProject}
            onSetSessionBoundary={ground.setSessionBoundary}
            /* STORY 22.5 — the tool names its models and the person picks one:
               ONE record field, written the moment a choice is made. */
            onChooseSessionModel={ground.setSessionModel}
            /* STORY 18.5 — a session card is removable through the same one
               toast every other card uses (immediate delete + Restore). */
            onRemoveSession={ground.removeSession}
            /* STORY 16.22 — the session card's name pill renames through the
               hook's one session-name write path (one history line per real
               change, never a word of the transcript). */
            onRenameSession={ground.renameSessionTo}
            /* STORY 16.23 — a session card is movable too: one line's x|y,
               the transcript untouched (a point is not a run). */
            onMoveSession={ground.moveSession}
            /* STORY 17.8 — an ask card is removable through the same one toast
               every other card uses (16.13's immediate delete + Restore). */
            onRemoveAsk={ground.removeAsk}
            // STORY 17.7b — the card says "nothing configured" BEFORE a send.
            // The one selection still lives in Settings; no per-ask selector
            // comes back here by design (story 17.7).
            hasProvider={askProvider}
            calls={askCalls}
            efforts={askEfforts}
            onSetAskEffort={ground.setAskEffort}
            onOpenSettings={() => openSettings("providers")}
            onMove={ground.move}
            /* STORY 16.21 — the name pill is the card's rename field; the
               name is the record's field and the slug stays identity. */
            onRename={ground.rename}
            onRefresh={ground.refresh}
            onTakeListing={ground.takeListing}
            onRepoint={ground.repoint}
            onRemove={ground.remove}
            onSetNote={ground.setNote}
            onPull={ground.pull}
            onDismissPull={ground.dismissPull}
            onLink={ground.link}
            /* STORY 20.3 — A WIRE DRAG RELEASED ON EMPTY PAPER opens the
               create bubble there, already hooked to the drag's source: the
               plane's own conversion gives the point, and the bubble's create
               is what the one wire follows. */
            toWorld={toWorld}
            onCreateFromLink={openHookedCreate}
            links={ground.links}
            workspacePath={workspace.path}
            onNarrate={narrate}
            interactionMode={gestureMode}
            pageLines={cardPreference.pageLines}
            looks={cardLooks}
            onSetLook={onSetLook}
            previewLines={readingPreference.previewLines}
            noteLines={readingPreference.noteLines}
            zoom={camera.zoom}
            /* STORY 16.33 — the card the find pill landed on, marked briefly.
               View state only; App owns the marker's short life. */
            found={findMark}
            /* STORY 25-10 (the person's ruling): on expansion, pan the screen
               to the card — the eased camera seat at the viewport's middle. */
            onCenter={(at) =>
              intents.centerOn(
                at.x,
                at.y,
                window.innerWidth / 2,
                window.innerHeight / 2,
              )
            }
          />
        )}

        {/* wires

            DEPRECATED (hidden 2026-11-16 per user review — separate maps): the
            distance wires are the concept map's content, so they render at
            concept only; the distance records and the geometry stay — delete in
            the deprecated sweep. */}
        {mapContent && distances.map((d) => {
          const f = refs.find((r) => r.slug === d.from);
          const t = refs.find((r) => r.slug === d.to);
          if (!f || !t) return null;
          // DEPRECATED (hidden 2026-11-16 per user review): a wire to a word the
          // shelf hiding keeps off the plane would run to nothing, so it is not
          // drawn either — delete with the shelf in the deprecated sweep.
          if (setAsideSlugs.has(d.from) || setAsideSlugs.has(d.to)) return null;
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
            glyph at the target head.

            DEPRECATED (hidden 2026-11-16 per user review — separate maps): the
            link wires are dynamics-map content and the dynamics map is blank
            for now, so the map-content rule closes them as well as the band
            rule (which stays, unchanged, for the flip-back). The link records,
            their signs and the geometry all stay — delete in the deprecated
            sweep. */}
        {mapContent &&
          linkWiresVisible(level) &&
          links.map((link) => {
            const f = refs.find((r) => r.slug === link.from);
            const t = refs.find((r) => r.slug === link.to);
            if (!f || !t) return null;
            // DEPRECATED (hidden 2026-11-16 per user review): the shelf's hiding
            // keeps set-aside words off the plane, so a link to one is not drawn
            // either — delete with the shelf in the deprecated sweep.
            if (setAsideSlugs.has(link.from) || setAsideSlugs.has(link.to)) {
              return null;
            }
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

        {/* THE LANGUAGE GAME's naming popup (PROVISIONAL, added 2026-11-16 per
            the lead's brief): the small card the completed selection opens,
            hanging at the drawn shape's top-left corner and counter-scaled like
            the veil's coin field. The pastel fill is already behind it — that
            tint IS the selection being named. While it asks, the gate is still
            in its `select` mode (the draft is not null), so the plane cannot
            pan, create or press a word behind the card; the card owns the rest
            of the screen's quiet. Esc / cancel drops the draft (nothing is
            written); submit asks the card's rules and writes ONE line. */}
        {languageGamesLive(level) && gameDraft !== null && (
          <LanguageGamePopup
            anchor={shapeAnchor(gameDraft.shape)}
            existingNames={languageGames.map((game) => game.name)}
            hasWords={gameDraft.hasWords}
            onSubmit={submitLanguageGame}
            onCancel={cancelLanguageGame}
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
            grows the third kind, assumption, about the bare spot (story 4).
            DEPRECATED (hidden 2026-11-16 per user review): the ring menu
            offered lack (every game) and assumption (dynamics); through
            gates.ts's `offeredCreationKinds` it now offers the WORD at concept
            only and NOTHING off it (the separate-maps rule), while the bubble's
            draw action below keeps rendering in every game. `creationKinds`
            still names each game's full grammar for the record machinery —
            delete in the deprecated sweep.

            The pen's DRAW bubble sits beside the word at concept and ALONE off
            it (added 2026-11-16 per user review): it is an ACTION, never a
            creation kind, so the grammar above keeps its shape and `onDraw`
            arms the drawing mode instead of creating anything. */}
        {menuAt && (
          <PlaneMenu
            x={menuAt.x}
            y={menuAt.y}
            kinds={offeredCreationKinds(level)}
            onWord={chooseWord}
            onLack={chooseLack}
            onAssumption={chooseAssumption}
            onDraw={chooseDraw}
            onClose={closePlaneMenu}
          />
        )}

        {/* STORY 17.10 — THE GROUND DOUBLE-CLICK'S BUBBLE. It is the CONCEPT
            MAP'S component (canvas/PlaneMenu.tsx) — the same dot, stems,
            inverse-camera placement, Esc/away-press and raw-mousedown guard —
            handed the ground's doors: ask first (the new thing), then the
            existing reference doors, then session. Choosing ANY door opens the
            SAME form as before, already on that intent — the ask included,
            where STORY 21.13 has the name asked first and the form make the
            empty card. */}
        {level === "ground" && groundMenuAt !== null && (
          <PlaneMenu
            x={groundMenuAt.x}
            y={groundMenuAt.y}
            doors={[
              {
                id: "ask",
                label: "ask",
                title: "ask a question here",
                seat: "above",
                // STORY 21.13 — the ask is a DOOR INTO THE BUBBLE, exactly like
                // the reference doors: its name is asked first, and the form's
                // ask intent makes the empty card.
                onPress: () => chooseGroundDoor("ask"),
              },
              {
                id: "file",
                label: "a file",
                title: "add a reference from a file",
                onPress: () => chooseGroundDoor("file"),
              },
              {
                id: "folder",
                label: "a folder",
                title: "add a project card from a folder elsewhere",
                onPress: () => chooseGroundDoor("folder"),
              },
              {
                id: "page",
                label: "a page",
                title: "add a reference from a web page",
                onPress: () => chooseGroundDoor("page"),
              },
              {
                id: "video",
                label: "a video",
                title: "add a reference from a video",
                onPress: () => chooseGroundDoor("video"),
              },
              {
                id: "session",
                label: "a session",
                title: "start a session card here",
                onPress: () => chooseGroundDoor("session"),
              },
            ]}
            onClose={closeGroundMenu}
          />
        )}

        {/* THE GROUND MAP's reference form (story 16.1): after the bubble's
            reference door (STORY 17.10), type a name, pick the source. The
            NOUN is still the ground map's own and `wordCreationOffered` stays
            concept-only; what changed is that the SAME concept bubble opens
            first, with the ground's doors. A refused file shows one quiet
            sentence and creates nothing. */}
        {level === "ground" && groundAt !== null && (
          <GroundBubble
            x={groundAt.x}
            y={groundAt.y}
            initialIntent={groundIntent}
            onAdd={addGroundAt}
            /* STORY 21.13 — THE ASK DOOR: an empty ask card at the point, in
               the person's own name. 20.3's wire rides the same wrapper every
               other door uses. */
            onAddAsk={addGroundAsk}
            onAddFolder={addGroundFolderAt}
            onAddPage={addGroundPageAt}
            onAddVideo={addGroundVideoAt}
            /* STORY 18.3 — the fourth door: a SESSION CARD bound to one tool
               row. It is its own record family, not a reference's source. */
            onAddSession={addGroundSessionAt}
            /* STORY 22.1 — the creation picker marks a row from the same
               per-machine facts the session card's state line reads. */
            toolRowFacts={ground.toolRowFacts}
            onClose={closeGroundBubble}
          />
        )}

        {/* STORY 16.20 — a refused OS drop's ONE sentence, where the pointer
            released it. World space and counter-scaled like the bubble; view
            state only, cleared by itself. */}
        {level === "ground" && dropNotice !== null && (
          <GroundDropNotice
            x={dropNotice.at.x}
            y={dropNotice.at.y}
            text={dropNotice.text}
            taken={dropNotice.taken}
            onDismiss={dismissDropNotice}
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
            onLook={(pointer) => void readFromPointer("look", pointer)}
            onMeasure={(pointer) => void readFromPointer("measure", pointer)}
            onLog={(pointer) => void reopenPrism(pointer)}
            onAsk={(pointer) => openAsk(pointer)}
            onHandOff={(pointer) => handOffFromPointer(pointer)}
            onAskWord={() => openAsk(null)}
            onMake={openMake}
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

        {/* the ground game's PRISM window (Epic 12 story 2, ADR-0029 rule
            6: record != visible): ONE completed Move's window, opened when the
            Move completes and reopened from the pointer row's quiet log
            button. It shows the log (the contact kind, the pointer identity,
            the read-only Change rows with their exact bounds/decode/declared
            facts) and the person's explanation in the one quiet field; NO
            world bytes ever ride here (the glimpse is their own window). One
            Move only — the prop is one Prism or null, never a list. It is the
            outward window's sibling: world-anchored, counter-scaled,
            viewport-clamped; Esc / × / click-away / a level switch close it. */}
        {level === "ground" && prismAt && (
          <PrismWindow
            anchor={prismAt.anchor}
            name={nameOf(prismAt.on)}
            prism={prismAt.prism}
            note={prismAt.note}
            onSaveExplanation={(id, explanation) =>
              saveMoveExplanation(id, explanation)
            }
            onClose={() => closePrism("dismiss")}
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

      {/* STORY 16.33 — FIND ON THE MAP. The pill is mounted OUTSIDE .plane,
          with the app's other quiet surfaces, so no camera value can move it:
          it is SCREEN space and stays put while the map pans. Its cards are
          the ground map's own, in its own order; landing asks the camera's
          existing centerOn intent for a PAN at the current zoom, and the map
          marks the card briefly. Nothing here writes, counts or ranks. */}
      {level === "ground" && (
        <FindPill
          cards={findableCards}
          open={findOpen}
          onOpen={() => setFindOpen(true)}
          onClose={closeFind}
          onLand={landOnFoundCard}
        />
      )}

      {/* STORY 16.16 (shortlist item 4): the CURSOR CHIP. One translucent pill
          near the pointer while a gesture is in flight, saying what the hand is
          doing in the map's words; gone on release and on window blur. It is
          mounted OUTSIDE `.plane` (like the app's other quiet surfaces), so no
          camera value can move it, and the sentence is the pure table's
          (`canvas/gestureWord.ts`) — no advice, no count, no persistence. */}
      {gesture.kind !== "idle" && (
        <GestureChip gesture={gesture} onClear={() => narrate(GESTURE_IDLE)} />
      )}

      {/* STORY 16.16 (shortlist item 5): the ARMED BAR. One sentence at the
          bottom-centre, in screen space, whose subject is the armed tool — the
          pen or the eraser, a link drag, the ground bubble's reference. When
          nothing is armed it is simply absent (the plane's idle hint has the
          floor again). */}
      {armedTool !== null && <ArmedBar kind={armedTool} level={level} />}

      {/* STORY 16.13 (shortlist item 3): an empty ground map says so in one
          muted sentence, centred in screen space — no verb, no illustration.
          The sentence lives in GroundLayer (the empty state's seam) and App
          mounts it outside the plane so it does not pan or zoom. */}
      {level === "ground" &&
        ground.loaded &&
        ground.references.length === 0 && <GroundEmpty />}

      {/* STORY 16.13 (shortlist item 1): the ONE toast that makes a delete
          reversible. It sits bottom-centre in screen space, outside the plane;
          one toast, one pending restore, and a second delete commits the first
          (useGround's pendingRestoreAfter). */}
      {(ground.restorable !== null ||
        ground.restorableAsk !== null ||
        ground.restorableSession !== null ||
        ground.restoreNotice !== null) && (
        <GroundToast
          notice={ground.restoreNotice}
          sentence={
            ground.restorableSession !== null
              ? SESSION_RESTORE_SENTENCE
              : ground.restorableAsk !== null
                ? ASK_RESTORE_SENTENCE
                : undefined
          }
          onRestore={() => void ground.restore()}
          onDismiss={ground.dismissRestore}
        />
      )}

      {/* THE MAKE PANEL (Epic 12 story 3): the person's own contact write, in
          ONE Move — name the artifact, write the text, press make. The minted
          pointer and its raw bytes are written in the same Move and the ONE
          PRISM is appended; there is NO accept gate, because the person IS the
          acceptor (an agent's Make is a ghost, never this). It sits outside
          `.plane` like the app's other quiet surfaces; Esc / its × close it
          (a press away does not — it can hold typed prose). */}
      {level === "ground" && makeAt && (
        <MakePanel
          name={nameOf(makeAt.on)}
          note={makeNote}
          busy={makeBusy}
          onMake={submitMake}
          onClose={closeMake}
        />
      )}

      {/* THE ASK PANEL (Epic 12 story 3; app-sent in Epic 15 story 2): the
          declaration of what will go, the send the APP carries through the
          sidecar, the answer in place (with its stop verb), and — with no
          provider configured — one sentence and the clipboard fallback. The
          response is still wrapped by the SAME intake (size + decode) and the
          SAME ONE PRISM is appended, the inclusion set as the reaches' natural
          keys — never their bytes. The response is CONTENT, ephemeral here
          until the person KEEPS it (the existing Finding move, a separate act
          that never extends the PRISM). Outside `.plane`, held prose is never
          thrown away by a press; Esc / its × close it. */}
      {level === "ground" && askAt && (
        <AskPanel
          providerRef={askProviderRef}
          hasProvider={askProvider}
          keyStore={askKeyStore}
          onProviders={() => openSettings("providers")}
          name={
            ground.references.find((entry) => entry.on === askAt.on)?.name ??
            nameOf(askAt.on)
          }
          rows={findPointers(pointers, askAt.on).map((found) => found.pointer)}
          ride={
            askAt.ride === null
              ? null
              : { on: askAt.on, form: askAt.ride.form, value: askAt.ride.value, extra: {} }
          }
          session={askSessionView}
          kept={askKept}
          busy={askBusy}
          note={askNote}
          fallback={askFallback}
          running={askAppRunning}
          context={askContext}
          sent={askSent}
          onIncludedChange={askChoose}
          onSend={askSend}
          onStop={askStop}
          onIntake={askIntake}
          onAbandon={askAbandon}
          onKeep={askKeep}
          onLog={askLog}
          onClose={closeAskPanel}
        />
      )}

      {/* THE SETTINGS MODAL (story 15.10): providers, turn defaults, the local
          model and about, outside `.plane` like the app's other quiet
          surfaces. The chrome's control opens it on any map; an ask's
          configure shortcut opens it on Providers. Closing writes nothing. */}
      {settingsOpen && (
        <SettingsPanel
          section={settingsSection}
          onSection={setSettingsSection}
          onClose={closeSettings}
          onChanged={refreshProviderFacts}
          onReadingChanged={refreshReadingPreference}
           onCardsChanged={refreshCardPreference}
        />
      )}

      {/* The map tabs. DEPRECATED (hidden 2026-11-16 per user review — separate
          mini-apps, ADR-0032): the row was an indicator of the BAND's game and a
          jumper between bands, with the wheel as the other way between maps;
          now it is the ONLY way: the tabs switch maps and the wheel only zooms
          within the current one. Its new wording ("the concept map", "the
          dynamics map", "the ground map") is PROVISIONAL — delete the band note
          in the deprecated sweep. */}
      <LevelControl
        level={level}
        onJump={(next) => handoff.jump(next)}
        onEditPlayingSet={openSelector}
        onCoinLoop={beginLoop}
        onDrawVeil={beginVeil}
        onDraw={toggleDraw}
        drawArmed={drawArmed}
        onSelect={toggleSelect}
        selectArmed={selectArmed}
        onOpenGames={toggleGames}
        gamesOpen={gamesOpen}
        scenarios={scenarios}
        activeScenario={scenario}
        onChooseScenario={chooseScenario}
        onBranchScenario={branchModel}
        onRetireScenario={retireBranch}
        onCompare={openComparison}
        onAsk={openGhostPanel}
        onAskPull={openPullAsk}
        onSettings={() => openSettings("providers")}
      />

      {/* ALL LANGUAGE GAMES (PROVISIONAL, added 2026-11-16 per the lead's
          brief): the concept map's right-side list of every saved game — the
          person's layers-panel comparison, at its plainest. A row's press
          brings that game forward (its fill paints more opaquely) and centres
          the map on its shape; its trash-bin icon deletes the game (the line
          leaves, no confirmation, no tombstone); its quiet × closes the list.
          The panel sits outside `.plane` like the app's other quiet surfaces,
          so the plane's armed gate never reaches it. It renders on the concept
          map only — its door and its fills' rule are the same reading
          (`languageGamesLive`). */}
      {gamesOpen && languageGamesLive(level) && (
        <LanguageGamesPanel
          games={languageGames}
          focused={focusedGame}
          onPick={pickLanguageGame}
          onRemove={deleteLanguageGame}
          onClose={closeGames}
        />
      )}

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
          person's region is not wired here (the ADR's fallback applies); the
          card's inclusion choice IS (Epic 11 story 3, OFF by default), and the
          panel is deliberately plain (story 3's "no polish"). */}
      {level === "dynamics" && ghostPanelOpen && (
        <GhostPanel
          targets={ghostTargets}
          packet={ghostRequest.packet}
          askIssues={ghostAskIssues}
          intakeIssues={ghostIntakeIssues}
          includeCard={ghostRequest.includeCard}
          onIncludeCard={ghostRequest.setIncludeCard}
          onAsk={askForGhost}
          onPropose={proposeGhost}
          onSend={() => void sendGhostPacket()}
          providerRef={askProviderRef}
          sending={ghostSending}
          answer={ghostAnswer}
          turnNote={ghostTurnNote}
          onClose={closeGhostPanel}
        />
      )}

      {/* the crank (Epic 8 story 3, ADR-0022): ONE hand-cranked step and,
          beneath it, that crank's OWN notes. Level 2 only — a step is the
          dynamics game's own reading. It lives outside `.plane` beside the
          level control, so the plane's armed gate never reaches it; one notch
          per press, no timer, no autoplay, nothing written. */}
      {/* DEPRECATED (hidden 2026-11-16 per user review — separate maps): a
          cranked step reads the playing set's quantities ON the map, and the
          dynamics map is blank paper for now, so the crank is not offered. Its
          component, its hook (`useStepRun`), its notes and its model stay
          written — delete this hiding point in the deprecated sweep. */}
      {level === "dynamics" && offered(STEP_CRANK_HIDDEN) && (
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

      {/* THE PULL ASK's reading (Epic 13 story 2, ADR-0030): the transient the
          one press opens. It shows the selection sentence SAID and then the
          sites as ONE block of the records' own lines — a veil's name and
          location, a dangling pin's rule sentence — with no heading, no number,
          no cursor, no total and no order claim. It writes nothing and keeps
          nothing: closing it (Esc, its ×, a press away) drops the value, and
          the next ask reads the records again. It sits outside `.plane` beside
          the app's other quiet surfaces, so the plane's armed gate never
          reaches it; a level switch leaves it standing (the reading belongs to
          no game). */}
      {pullReading !== null && (
        <PullPanel reading={pullReading} onClose={closePullAsk} />
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

      {/* The pen's quiet controls (added 2026-11-16 per user review): pen size,
          a few inks plus a picker, undo, and the quiet × that clears the
          drawing. Screen space and OUTSIDE `.plane`, so the plane's armed gate
          never reaches it; Esc or the level control's toggle puts the pen
          down. */}
      {drawArmed && (
        <SketchToolbar
          color={penColor}
          size={penSize}
          tool={penTool}
          canUndo={canUndoSketch}
          onColor={setPenColor}
          onSize={setPenSize}
          onTool={setPenTool}
          onUndo={undoSketch}
          onClear={clearSketch}
        />
      )}

      {/* THE SELECTION TOOL's quiet strip (PROVISIONAL, added 2026-11-16 per
          the lead's brief): the three shapes an armed drag can draw — freeform,
          circle, rectangle — in screen space, outside `.plane`, so a press on
          the strip can never pan the map, create anything or start a word
          gesture. Shown while the tool is armed (including while its popup
          asks, so the shape can be changed for the next selection). Esc or the
          level control's toggle puts the tool down. */}
      {selectArmed && (
        <LanguageGameBar shape={selectShape} onShape={chooseGameShape} />
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
        malformedSketches={malformedSketches}
        malformedGames={malformedLanguageGames}
        ontologyNotices={ontologyNotices}
        malformedAssumptions={malformedAssumptions}
        duplicateAssumptions={duplicateAssumptions}
        orphanAssumptions={orphanAssumptions}
        malformedPointers={malformedPointers}
        duplicatePointers={duplicatePointers}
        orphanPointers={orphanPointers}
        malformedGround={ground.malformedGround}
        malformedReadings={ground.malformedReadings}
        malformedAsks={ground.malformedAsks}
        malformedSessions={ground.malformedSessions}
        malformedGroundLinks={ground.malformedLinks}
        orphanGroundLinks={ground.orphanLinks}
        orphanGroundNotes={ground.orphanNotes}
        orphanGroundMedia={ground.orphanMedia}
        orphanAskTurns={ground.orphanAskTurns}
        orphanSessionTranscripts={ground.orphanSessionTranscripts}
        mirrorNotice={ground.mirrorNotice}
        malformedHistory={ground.malformedHistory}
        historyNotice={ground.historyNotice}
        malformedQuantities={malformedQuantities}
        duplicateQuantities={duplicateQuantities}
        orphanQuantities={orphanQuantities}
        outOfPlayQuantities={outOfPlayQuantities}
      />

      {/* STORY 21.3 — THE COMMAND CARD (ADR-0038 decisions 1 and 4). It is
          mounted HERE, at APP level and outside `.plane`, so it is present on
          every map and its fixed position cannot pan or zoom. CLOSED by
          default: the flag starts false and only the person's press opens it.
          Its own body is the one scroll region; the map never scrolls under it,
          and the wheel over the card stays on the card. */}


        <CommandCard
        level={level}
        open={commandOpen}
        instruction={commandInstruction}
        answer={commandAnswer}
        exchanges={commandThread.exchanges}
        dropped={commandThread.dropped}
        view={commandView}
        busy={commandBusy}
        onOpen={openCommandCard}
        onClose={closeCommandCard}
        onInstruction={setCommandInstruction}
        onAnswer={setCommandAnswer}
        onInterpret={interpretCommand}
        onAnswerQuestion={answerCommandQuestion}
        onAccept={acceptCommand}
        onRefuse={refuseCommand}
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
 * (marks, veils and the ink: record hygiene, not a claim about the plane) plus
 * the RUNNING game's own records. DEPRECATED (hidden 2026-11-16 per user review
 * — separate maps): the map-content rule blanks marks off concept, and this
 * strip is deliberately NOT gated by it — an unreadable or orphaned line is
 * surfaced whatever the plane shows (ADR-0009), so it can name a record whose
 * content this game hides. That tension is REPORTED, not silenced: hiding an
 * honesty surface to make a blank map look tidier would be the lie. A
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
  malformedSketches,
  malformedGames,
  ontologyNotices,
  malformedAssumptions,
  duplicateAssumptions,
  orphanAssumptions,
  malformedPointers,
  duplicatePointers,
  orphanPointers,
  malformedGround,
  malformedReadings,
  malformedAsks,
  malformedSessions,
  malformedGroundLinks,
  orphanGroundLinks,
  orphanGroundNotes,
  orphanGroundMedia,
  orphanAskTurns,
  orphanSessionTranscripts,
  mirrorNotice,
  malformedHistory,
  historyNotice,
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
  /**
   * Unreadable `map/sketches.jsonl` lines (added 2026-11-16 per user review):
   * a stroke has no dependents, so it has no orphans — only lines the app keeps
   * and cannot read. Surfaced wherever the person is (the drawing is every
   * game's record, the veils' reading).
   */
  malformedSketches: readonly string[];
  /**
   * Unreadable `map/language-games.jsonl` lines (PROVISIONAL, added 2026-11-16
   * per the lead's brief): a language game has no dependents, so it has no
   * orphans — only lines the app keeps and cannot read. Surfaced wherever the
   * person is: the record's hygiene is not the fill, and this strip is
   * deliberately not gated by the separate-maps rule (ADR-0009's rule, the
   * veils' and the ink's reading).
   */
  malformedGames: readonly string[];
  /**
   * Files the ontology export found in `ontology/` that it did not write
   * (PROVISIONAL, added 2026-11-16 per ADR-0033): the sync leaves every one of
   * them where it is — the format marker decides what may be swept — and names
   * it here. They ride the language-games family because a game's export is the
   * game's own; no family table changed.
   */
  ontologyNotices: readonly string[];
  malformedAssumptions: readonly string[];
  /** Hand-edited duplicate keys: preserved, never deduped (story 4). */
  duplicateAssumptions: readonly Assumption[];
  orphanAssumptions: readonly Assumption[];
  /** Pointers (Epic 5 story 1): unreadable lines, duplicate keys, lost owners. */
  malformedPointers: readonly string[];
  duplicatePointers: readonly Pointer[];
  orphanPointers: readonly Pointer[];
  /**
   * The ground map's own records (story 16.1): unreadable lines in
   * `map/ground.txt` and `map/readings.txt`, preserved and surfaced here.
   * They ride the ground group directly rather than joining `NoticeFamily`
   * (the quantities' precedent): that table names map families, and ground is
   * a separate map whose notices belong only to its own group.
   */
  malformedGround: readonly string[];
  malformedReadings: readonly string[];
  /**
   * STORY 17.1: unreadable lines in `map/asks.txt`, preserved by every write
   * and surfaced here under the ground group only (the ask cards live on that
   * map). The ask cards' conversations are JSONL and keep their own malformed
   * lines in place; story 17.2 owns showing a conversation's damage.
   */
  malformedAsks: readonly string[];
  /**
   * STORY 18.3 — unreadable lines in `map/sessions.txt`, preserved by every
   * write and surfaced here under the ground group only (the session cards
   * live on that map). A transcript's own malformed lines are kept in the file
   * as well; the card renders what it can read and never repairs the rest.
   */
  malformedSessions: readonly string[];
  /**
   * The ground map's WORDLESS links (story 16.5): unreadable lines in
   * `map/ground-links.txt`, and links whose endpoint is not a reference the
   * map carries. Both are PRESERVED and surfaced here (ADR-0009) under the
   * ground group only — an orphan has no card to attach to, so it is never
   * drawn.
   */
  malformedGroundLinks: readonly string[];
  orphanGroundLinks: readonly { from: string; to: string }[];
  /**
   * Note files with no card (story 16.6), reported under the ground group only:
   * kept exactly where they are, never adopted into a card and never deleted.
   */
  orphanGroundNotes: readonly string[];
  /**
   * Media lines whose card is gone (story 16.14b), reported under the ground
   * group only: kept exactly where they are — never adopted into a card, never
   * deleted, and never drawn as a picture (an orphan has no card to sit on).
   */
  orphanGroundMedia: readonly Media[];
  /**
   * STORY 17.8 — conversation files whose ask card is gone: kept in
   * `map/asks/` and named here, never adopted and never deleted.
   */
  orphanAskTurns: readonly string[];
  /**
   * STORY 18.5 — transcript files whose session card is gone: kept in
   * `map/sessions/` and named here, never adopted and never deleted.
   */
  orphanSessionTranscripts: readonly string[];
  /**
   * The mirror's one failure sentence (story 16.9), or null. The mirror is
   * DERIVED, so its failure is a notice and never a failed move; it rides the
   * ground group only, because the mirror speaks for no other map.
   */
  mirrorNotice: string | null;
  /**
   * The ground map's HISTORY (story 16.10): unreadable lines in
   * `map/ground-history.jsonl`, preserved verbatim and named here, and the one
   * sentence a failed append answers. The history is a RECORD of authored
   * moves, so neither is a count, a meter or a nudge — the strip says only
   * that a line could not be read or that the log could not follow the move.
   */
  malformedHistory: readonly string[];
  historyNotice: string | null;
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
    sketches: malformedSketches.length > 0,
    games: malformedGames.length > 0 || ontologyNotices.length > 0,
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
  // The ground map's own unreadable lines (story 16.1), surfaced under its
  // group only: record hygiene, never a claim that the map draws them.
  const hasGroundLines =
    level === "ground" &&
    (malformedGround.length > 0 ||
      malformedReadings.length > 0 ||
      malformedAsks.length > 0 ||
      malformedSessions.length > 0 ||
      malformedGroundLinks.length > 0 ||
      orphanGroundLinks.length > 0 ||
      orphanGroundNotes.length > 0 ||
      orphanGroundMedia.length > 0 ||
      orphanAskTurns.length > 0 ||
      orphanSessionTranscripts.length > 0 ||
      mirrorNotice !== null ||
      malformedHistory.length > 0 ||
      historyNotice !== null);
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
        (group.game === "dynamics" && hasQuantities) ||
        (group.game === "ground" && hasGroundLines),
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
      case "sketches":
        return (
          <>
            {malformedSketches.map((line, index) => (
              <div className="mark-notice" key={`malformed-sketch-${index}`}>
                unreadable line in map/sketches.jsonl: {line}
              </div>
            ))}
          </>
        );
      case "games":
        return (
          <>
            {malformedGames.map((line, index) => (
              <div className="mark-notice" key={`malformed-game-${index}`}>
                unreadable line in map/language-games.jsonl: {line}
              </div>
            ))}
            {ontologyNotices.map((line, index) => (
              <div className="mark-notice" key={`ontology-${index}`}>
                {line}
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
          {group.game === "ground" && hasGroundLines && (
            <>
              {malformedGround.map((line, index) => (
                <div
                  className="mark-notice"
                  key={`malformed-ground-${index}`}
                >
                  unreadable line in map/ground.txt: {line}
                </div>
              ))}
              {malformedReadings.map((line, index) => (
                <div
                  className="mark-notice"
                  key={`malformed-readings-${index}`}
                >
                  unreadable line in map/readings.txt: {line}
                </div>
              ))}
              {/* STORY 17.1: an unreadable line in map/asks.txt is the ask
                  cards' honesty surface, kept by every write and named here. */}
              {malformedAsks.map((line, index) => (
                <div
                  className="mark-notice"
                  key={`malformed-asks-${index}`}
                >
                  unreadable line in map/asks.txt: {line}
                </div>
              ))}
              {/* STORY 18.3: an unreadable line in map/sessions.txt is the
                  session cards' honesty surface, kept by every write and named
                  here — never repaired into a card. */}
              {malformedSessions.map((line, index) => (
                <div
                  className="mark-notice"
                  key={`malformed-sessions-${index}`}
                >
                  unreadable line in map/sessions.txt: {line}
                </div>
              ))}
              {/* STORY 16.6, the note's honesty surface: a file whose slug has
                  no card is KEPT and named here — never adopted, never deleted,
                  and never drawn (an orphan has no card to sit on). */}
              {orphanGroundNotes.map((slug) => (
                <div
                  className="mark-notice"
                  key={`orphan-ground-note-${slug}`}
                >
                  a note for “{slug}” has no card — kept in map/notes/{slug}.md
                </div>
              ))}
              {/* STORY 16.14b, the media line's honesty surface: a line whose
                  slug has no card is KEPT and named here — never adopted into a
                  card, never deleted, and never drawn as a picture. */}
              {orphanGroundMedia.map((entry) => (
                <div
                  className="mark-notice"
                  key={`orphan-ground-media-${entry.on}`}
                >
                  a media line for “{entry.on}” has no card — kept in
                  map/media.jsonl
                </div>
              ))}
              {/* STORY 17.8, the conversation's honesty surface: a file whose
                  ask card is gone is KEPT and named here — never adopted into a
                  card, never deleted, and never read as a thread. */}
              {orphanAskTurns.map((slug) => (
                <div
                  className="mark-notice"
                  key={`orphan-ask-turn-${slug}`}
                >
                  a conversation for “{slug}” has no ask card — kept in
                  map/asks/{slug}.jsonl
                </div>
              ))}
              {/* STORY 18.5, the transcript's honesty surface: a file whose
                  session card is gone is KEPT and named here — never adopted
                  into a card, never deleted, and never read as a run. */}
              {orphanSessionTranscripts.map((slug) => (
                <div
                  className="mark-notice"
                  key={`orphan-session-transcript-${slug}`}
                >
                  a transcript for “{slug}” has no session card — kept in
                  map/sessions/{slug}.jsonl
                </div>
              ))}
              {/* STORY 16.5, the links' two honesty surfaces: a record line the
                  app cannot read, and a line naming a card the map does not
                  carry. Both are KEPT in the file; the strip is the only place
                  they are named (an orphan is never drawn as a wire). */}
              {orphanGroundLinks.map((link, index) => (
                <div
                  className="mark-notice"
                  key={`orphan-ground-link-${index}`}
                >
                  a link from {link.from} to {link.to} names a reference not on
                  the map — kept in map/ground-links.txt
                </div>
              ))}
              {malformedGroundLinks.map((line, index) => (
                <div
                  className="mark-notice"
                  key={`malformed-ground-link-${index}`}
                >
                  unreadable line in map/ground-links.txt: {line}
                </div>
              ))}
              {/* STORY 16.9, the mirror's one failure surface: the map itself
                  was written, so the move stands — this is the derived index
                  saying it could not follow. It clears when a mirror lands. */}
              {mirrorNotice !== null && (
                <div className="mark-notice">{mirrorNotice}</div>
              )}
              {/* STORY 16.10, the history's two honesty surfaces: a line the
                  app keeps but cannot read (never dropped, never repaired),
                  and the one sentence a failed append answers — the move
                  itself already landed, because the records are the truth. */}
              {malformedHistory.map((line, index) => (
                <div
                  className="mark-notice"
                  key={`malformed-ground-history-${index}`}
                >
                  unreadable line in map/ground-history.jsonl: {line}
                </div>
              ))}
              {historyNotice !== null && (
                <div className="mark-notice">{historyNotice}</div>
              )}
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
