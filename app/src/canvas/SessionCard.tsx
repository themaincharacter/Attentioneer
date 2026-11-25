import { useEffect, useRef, useState, type CSSProperties } from "react";
import { previewOverflows, previewText } from "../map/readings";
import {
  SESSION_BOUNDARY_LABELS,
  SESSION_BOUNDARY_UNDECLARED_SENTENCE,
  SESSION_EMPTY_SENTENCE,
  SESSION_MISSING_TOOL_SENTENCE,
  SESSION_RUNNING_SENTENCE,
  sessionBindingLine,
  sessionDisplayName,
  sessionEndingLine,
  sessionEntryLine,
  sessionKindLine,
  sessionNameForWrite,
  sessionNewestEntry,
  sessionResumeOf,
  SESSION_RESUME_REFUSALS,
  type SessionCard as SessionCardRecord,
  type SessionEntry,
} from "../map/sessions";
import { CardNamePill, type PillNameRules } from "./CardNamePill";
import { IconMore, IconRun, IconStop, IconWire } from "./icons";
import { VerbBubble, verbCounterScale } from "./VerbBubble";
import type { WorkingChannel } from "./workingRef";
import { SESSION_TASK_REFUSAL, type GroundAddResult } from "./useGround";
import { PacketSurface } from "./PacketSurface";
import {
  ASK_DECLARATION_VERB,
  ASK_DECLARATION_VERB_SENT,
  SESSION_RESULT_KEEP_VERB,
} from "./contactRules";
import { assembleSessionPacket, type AskPacketCard } from "../turn/packet";
import type { TurnMessage } from "../turn/protocol";
import { isGestureArmed, type GestureMode } from "./gates";
import { startGroundLinkDrag } from "./linkDrag";
import { attachGroundCardDrag } from "./groundDrag";
import {
  frameGroundCard,
  settleGroundCard,
  type GroundDragChannel,
} from "./groundDragRef";
import type { Point } from "./geometry";
import { GESTURE_IDLE, type GestureNarration } from "./gestureWord";
import {
  allowOnceOption,
  refuseOption,
  type AcpPermissionAsk,
} from "../turn/acpEntries";
import {
  acpScopeDeclaration,
  acpStatusSentence,
  type AcpRowStatus,
} from "../turn/acpSpecs";
import type { AcpModelChoice } from "../turn/acpModels";
import {
  SETUP_CODE_LABEL,
  SETUP_CODE_PLACEHOLDER,
  SETUP_SENTENCES,
  SETUP_VERBS,
  setupEndSentence,
  setupLineCrop,
  setupUrlIn,
  type SessionSignIn,
} from "../turn/acpSetup";

/**
 * STORY 16.22 — THE SESSION CARD'S RULES FOR THE SHARED NAME PILL. A session
 * line cannot carry an empty name, so a blank field stores the untitled
 * sentence ("Untitled session", the reference card's rule one family over) —
 * NOT the ask card's refusal. The pill decides nothing about names; each
 * family's own rules do, and these are this family's.
 */
const SESSION_PILL_RULES: PillNameRules = {
  displayName: sessionDisplayName,
  nameForWrite: sessionNameForWrite,
};

/**
 * STORY 19.3 — THE TASK'S QUIET FIELD (PROVISIONAL wording). The task is
 * EPHEMERAL: it is not a record field, so a reopened card has an empty field
 * and only the send itself survives (the transcript's `sent` line). The
 * placeholder says what the field is for; the label names it for a reader.
 */
export const SESSION_TASK_LABEL = "the task";
export const SESSION_TASK_PLACEHOLDER = "write the task";

/**
 * STORY 22.5 — THE MODEL PICKER'S QUIET WORDS (PROVISIONAL). The picker offers
 * the TOOL's own display names (never a value string) with the tool's default
 * first; when the tool named no model choice here, the face says one line and
 * offers no picker at all.
 */
export const SESSION_MODEL_LABEL = "the model this run asks for";
export const SESSION_MODEL_DEFAULT = "the tool's own default";
export const SESSION_MODEL_OWN_SETTING =
  "this tool's model is its own setting.";

/**
 * STORY 21.1 — THE FOLLOW-UP'S QUIET FIELD (PROVISIONAL wording). The second
 * composer continues the card's last delegate session; like the task it is
 * EPHEMERAL (no record field), and only the send line it writes survives a
 * reopen. The placeholder says what the field is for.
 */
export const SESSION_FOLLOW_UP_LABEL = "continue this session";
export const SESSION_FOLLOW_UP_PLACEHOLDER = "write the follow-up";

/**
 * STORY 19.3 — THE ONE QUIET LINE A DANGLING WIRE SAYS (PROVISIONAL wording).
 * A wire whose source card is gone is SAID and never repaired: the wire stays
 * in the file, and the run simply has one fewer card wired into it.
 */
export const SESSION_CONTEXT_DANGLING =
  "a card wired into this run is gone; the wire is not repaired.";

/**
 * STORY 19.3 — WHICH DISCLOSURE THE CARD OFFERS (PURE). One verb, two
 * truths: with nothing sent yet, or with a task being written, these are the
 * bytes that WILL go; once a send is recorded and the field has not been
 * touched since, they are the bytes that DID. The words are the ask card's
 * own (contactRules.ts), never a second wording path.
 */
export function sessionDisclosureVerb(
  hasSent: boolean,
  typed: boolean,
): string {
  return hasSent && !typed ? ASK_DECLARATION_VERB_SENT : ASK_DECLARATION_VERB;
}

/**
 * THE SESSION CARD (Epic 18 story 3).
 *
 * It renders from the SAME grammar as a reference card and an ask card — name,
 * what this is, the crop — so the ground map stays one surface. The name is the
 * person's, the second line says "a run of <the tool row>", and the body is the
 * run's TRANSCRIPT: one progress entry per line, in ARRIVAL order, newest at
 * the bottom. THE TRANSCRIPT IS THE RECORD, NOT THIS COMPONENT: the entries
 * arrive as a prop, read at load from `map/sessions/<slug>.jsonl`.
 *
 * TWO FACES. Small: the newest entry's crop (or the ending, when the last run
 * ended — the ending IS an entry). Expanded: the whole transcript in order, the
 * DECLARATION for the next run (18.2's one sentence, which names a provider row
 * and never a key), the tool picker when the card's row is gone, and the run
 * and stop verbs.
 *
 * ENTRIES RENDER BY KIND: words as words, a tool call as its name plus the
 * status the server reported, a permission as what was asked plus the reply,
 * and the run's own beats (started, session) and ending as one quiet line each.
 * NEVER a percentage, never a step count, never a spinner: while a run is live
 * the card says so in one sentence and offers its stop; the moment the run
 * settles that sentence and that verb are gone, because they are read from the
 * live-run list and not from a timer of ours.
 *
 * ONE RUN PER CARD. The card's run verb is disabled while the list says this
 * card is running, and stop is the run's own cancel (18.2) — what arrived stays
 * and the ending says what happened. A PARTIAL NEVER COUNTS AS A RESULT: the
 * ending line is the only claim the card makes about how the run went, and it
 * says "stopped", "failed" or "timed-out" instead of dressing a partial up.
 *
 * A CARD WHOSE ROW IS GONE says so in one sentence and offers the rows this
 * build ships again (one field's change, written by the layer). A card whose
 * row is there declares the next run before it starts — the key sentence
 * included, with no key in it: the ROW is named, never the value.
 *
 * STORY 19.3 — THE TASK RIDES THE PACKET. The expanded card gains ONE field:
 * the task, which is EPHEMERAL view state (no record field, so it is not on
 * the line and does not survive a reopen). Beside the run verb sits ONE quiet
 * disclosure, the ask card's own: before the press it opens "what will be
 * sent" — the declaration (each wired card with its size and the total) and
 * the exact bytes; after the run it opens "what was sent", read from the
 * transcript's recorded `sent` entry, so the same card after a reopen shows
 * the same string. The run verb refuses an empty task with one sentence and
 * nothing starts: no fallback prompt exists any more.
 *
 * STORY 21.1 — A SECOND COMPOSER CONTINUES THE SESSION (PROVISIONAL). When the
 * transcript records a session AND the exact folder it was recorded in, the
 * expanded card shows "continue this session" below the task: the follow-up
 * task, the same one quiet disclosure ("what will be sent"), and one verb. The
 * follow-up's packet is the task and the bound ALONE — the session already owns
 * the wired context, and re-sending it is the token waste a follow-up exists to
 * avoid. A row that does not continue sessions says so in ONE quiet sentence
 * and offers no verb (nothing to press, and nothing refused after the fact);
 * the layer refuses the same way if such a press ever reaches it.
 *
 * STORY 22.1b — THE CARD HOSTS THE TOOL'S OWN SIGN-IN (PROVISIONAL). When the
 * bound row declares a sign-in argv, the expanded face offers ONE more verb
 * beside "test". While the setup child is alive the card says the
 * running line, shows the child's newest line cropped (and, when that line
 * holds an http(s) address, the "open the page" verb — the person finishes the
 * sign-in in their own browser), and offers one small field for the code the
 * page shows with "send the code" and "stop" beside it. The code is EPHEMERAL:
 * it goes to the child's stdin and nowhere else, and the field clears the
 * moment it is sent. On an exit the card says ONE sentence, and it never claims
 * the sign-in worked: the person's own press of "test" is still the
 * proof. A row that declares no sign-in shows no verb and no line.
 *
 * STORY 22.6 — ONE VERB KEEPS A RESULT. A completed run's face offers ONE
 * press, "keep this as a card": the layer tries the curator first and falls
 * back to 18.4's rule copy whenever the curator's answer cannot be used — a
 * decline, a malformed block, a failed or absent answer. The one outcome line
 * names which card was made, and the card never decides the chain itself. A
 * partial offers no verb: a partial is still no result. The tool row's press
 * says "test", and the sentence that explains a failed test still names the
 * row it tested.
 *
 * STORY 18.5 MAKES IT REMOVABLE: the expanded card offers remove, the same
 * immediate delete + Restore toast every other card uses. A live run is never
 * cut by it — the verb waits until the transcript has stopped being written.
 *
 * STORY 16.22 — THE NAME FLOATS ABOVE THIS CARD TOO, in the SHARED pill (one
 * component, one counter-scale, one rename field) the reference and ask cards
 * already wear: a session card is a peer on the same map, and its name was
 * cropped by its own transcript. The card's OWN name rules ride into the pill
 * (`SESSION_PILL_RULES`): a blank field stores "Untitled session" — this
 * family has no refusal for one, unlike an ask card. The rename reaches the
 * hook's one session-name path, which writes the record and ONE `card.rename`
 * history line (never a word of the transcript).
 *
 * ESC CLOSES THE CARD'S FACE (collapses), never the map. The wheel never zooms
 * the plane: the scrollbox stops the event where it starts.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the card's size, the crop, the
 * scrollbox's slack, the sentence placements, the picker's look, and — STORY
 * 19.3 — the task field's look, its placeholder, the dangling-wire sentence and
 * where the disclosure sits.
 */

/** How close to the bottom still counts as "at the bottom" (px, PROVISIONAL). */
export const SESSION_SCROLL_SLACK = 24;

/** Whether a scrollbox is close enough to its bottom to keep following (PURE). */
export function sessionAtBottom(
  scrollTop: number,
  clientHeight: number,
  scrollHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= SESSION_SCROLL_SLACK;
}

/**
 * ONE ENTRY, drawn by its kind. The words are VERBATIM; the card only decides
 * how they sit. A `crop` is the small face's stated count (the expanded face
 * omits it), and it only ever cuts TEXT — a tool's name or an ending is one
 * line already and is never cut.
 */
export function SessionEntryLine({
  entry,
  crop,
}: {
  entry: SessionEntry;
  crop?: number;
}) {
  if (entry.kind === "text") {
    const text = crop === undefined ? entry.text : previewText(entry.text, crop);
    return (
      <div className="session-entry text">
        <span className="session-entry-text">{text}</span>
      </div>
    );
  }
  if (entry.kind === "tool") {
    return (
      <div className="session-entry tool">
        <span className="session-entry-name">{entry.name}</span>
        {entry.status.trim() !== "" && (
          <span className="session-entry-status">{entry.status}</span>
        )}
      </div>
    );
  }
  if (entry.kind === "permission") {
    return (
      <div className="session-entry permission">
        <span className="session-entry-name">{entry.name}</span>
        <span className="session-entry-status">{entry.reply}</span>
      </div>
    );
  }
  // started, session and ended are one quiet line each; the ending is the only
  // thing the card ever claims about how the run went.
  return (
    <div
      className={
        "session-entry quiet " +
        entry.kind +
        (entry.kind === "ended" ? " ending-" + entry.ending : "")
      }
    >
      {sessionEntryLine(entry)}
    </div>
  );
}

/**
 * WHAT THE SERVER IS ASKING, in one line (PURE, PROVISIONAL): the tool call's
 * own title and kind, never the request's raw params. A call with no title
 * still says a permission is being asked, so the card is never blank.
 */
export function permissionAskLine(toolCall: unknown): string {
  const call =
    typeof toolCall === "object" && toolCall !== null && !Array.isArray(toolCall)
      ? (toolCall as Record<string, unknown>)
      : {};
  const title =
    typeof call.title === "string" && call.title.trim() !== ""
      ? call.title.trim()
      : "a tool call";
  const kind =
    typeof call.kind === "string" && call.kind.trim() !== ""
      ? call.kind.trim()
      : "";
  return kind === "" ? title : title + " (" + kind + ")";
}

/**
 * One tool row a picker may offer: its id and the LABEL the person reads. The
 * label is the layer's, built from the row (story 18.6 adds "(unverified)"), so
 * this card never learns a product's name or judges one.
 */
export interface SessionToolChoice {
  id: string;
  name: string;
}

/**
 * STORY 19.2 — one PROJECT CARD a binding picker may offer: its slug and the
 * card's NAME. No folder path here: a binding names a card, and the reading is
 * resolved by the layer when the run starts.
 */
export interface SessionProjectChoice {
  id: string;
  name: string;
}

export function SessionCard({
  session,
  toolName,
  declaration,
  toolStatus = null,
  models = null,
  onChooseModel,
  onTestRow,
  signIn = null,
  tools = [],
  entries,
  contextCards = [],
  contextMissing = false,
  running,
  zoom = 1,
  open,
  previewLines,
  onOpen,
  onClose,
  onRun,
  onFollowUp,
  canResume = false,
  onStop,
  onChooseTool,
  projectName = null,
  projectFolder = null,
  projects = [],
  onChooseProject,
  onChooseBoundary,
  permission = null,
  onAllowOnce,
  onRefuse,
  onKeepResult,
  distilWords = [],
  keepNotice = null,
  onRemove,
  onRename,
  onMove,
  onLink,
  toWorld,
  onCreateFromLink,
  interactionMode = "idle",
  onNarrate,
  drag,
  working,
}: {
  session: SessionCardRecord;
  /** The bound row's display name, or null when this build does not ship it. */
  toolName: string | null;
  /**
   * The declaration for the NEXT run (18.2's sentence computed from the row:
   * which key it will receive, by provider row, or that it receives none), or
   * null when there is no row to declare.
   */
  declaration: string | null;
  /**
   * STORY 22.1 — WHAT THIS CARD'S TOOL ROW KNOWS ABOUT THIS MACHINE
   * (PROVISIONAL), as one of three states: the command is not here, the row has
   * never been tested here, or a test passed and this is the date and the words
   * it answered. It is read from DATA (the row and the config's per-machine
   * fact), never from a product's name. Absent for a card whose row this build
   * does not ship, and rendered on the EXPANDED face only.
   */
  toolStatus?: AcpRowStatus | null;
  /**
   * STORY 22.5 — THE TOOL'S OWN MODEL CHOICES on this machine (PROVISIONAL),
   * as the fact layer recorded them: the tool's display names beside its opaque
   * values. Null/absent means the tool named no model choice here (or has not
   * been asked yet), and the face says one quiet line instead of offering a
   * picker. Only the expanded face ever shows this.
   */
  models?: readonly AcpModelChoice[] | null;
  /**
   * STORY 22.5 — RECORD the person's choice, or with null clear it and return
   * to the tool's own default. The value handed on is the TOOL's own string;
   * the card never shapes or parses one.
   */
  onChooseModel?: (model: string | null) => Promise<GroundAddResult>;
  /**
   * STORY 22.1 — TEST this card's row: ONE tiny task through the same run lane
   * an ordinary run uses, no transcript and no record. A completed turn with
   * words records the fact; every other ending answers its sentence and the
   * row stays untested. Absent in a render test.
   */
  onTestRow?: () => Promise<GroundAddResult>;
  /**
   * STORY 22.1b — THE TOOL'S OWN SIGN-IN, as view state (PROVISIONAL). It is
   * passed ONLY when the card's bound row declares a sign-in argv, so its
   * presence is the declaration: a row without one shows no verb and no line.
   * The child's newest line and its ending live here; the CODE never does — it
   * is this card's own local field and is cleared the moment it is sent.
   */
  signIn?: SessionSignIn | null;
  /** The rows a picker may offer (the build's shipped rows). */
  tools?: readonly SessionToolChoice[];
  /** The transcript, in file order (append-only: file order is arrival order). */
  entries: readonly SessionEntry[];
  /**
   * STORY 19.3 — THE CARDS WIRED INTO THIS SESSION CARD, as the packet reads
   * them (whole cards, wire order). The card assembles its pre-send readback
   * from these with the same pure assembler the send uses, so the declaration
   * and the bytes cannot drift. Empty in a render test.
   */
  contextCards?: readonly AskPacketCard[];
  /** STORY 19.3 — whether a wire whose source card is gone is on this card. */
  contextMissing?: boolean;
  /** View state: this card has a LIVE run right now. */
  running: boolean;
  /**
   * STORY 16.22 — the camera's own zoom, handed straight to the name pill (its
   * counter-scale is the card's legibility rule at any zoom). Optional: a
   * render test that only cares about the transcript is at 100%.
   */
  zoom?: number;
  /**
   * STORY 16.25 — the map's ONE in-flight drag, shared with the wires. A card
   * publishes its live point here while the hand is down instead of writing
   * React state, so only the wires that touch it follow. Optional so a render
   * test needs no channel; the card then moves its own element alone.
   */
  drag?: GroundDragChannel;
  /** STORY 24-15: the map's working channel (absent in a render test). */
  working?: WorkingChannel;
  open: boolean;
  /** How many lines the small face crops at (the stated preference). */
  previewLines: number;
  onOpen: () => void;
  onClose: () => void;
  /**
   * STORY 19.3 — start the run with the person's task, VERBATIM (the layer's
   * writer owns the packet, the gate and the record). Optional in a render test.
   */
  onRun?: (task: string) => Promise<GroundAddResult>;
  /**
   * STORY 21.1 — CONTINUE this card's last delegate session with a follow-up
   * task, VERBATIM (PROVISIONAL). The layer owns the gate, the packet and the
   * record; the card only forwards the press. Optional in a render test.
   */
  onFollowUp?: (task: string) => Promise<GroundAddResult>;
  /**
   * STORY 21.1 — WHETHER THE CARD'S ROW CONTINUES SESSIONS (PROVISIONAL). True
   * only when the row declares the protocol capability; a false row shows the
   * honest line instead of a verb, and the layer refuses the same way.
   */
  canResume?: boolean;
  /** Stop the live run (the run's own cancel). */
  onStop?: () => Promise<void>;
  /** Bind the card to another row (one field's change). */
  onChooseTool?: (tool: string) => Promise<GroundAddResult>;
  /**
   * STORY 19.2 — THE BOUND PROJECT CARD, by NAME only. The face never wears the
   * folder path; the declaration says it once, when a boundary is declared.
   */
  projectName?: string | null;
  /** The bound reading's folder, when it really is one (the declaration's path). */
  projectFolder?: string | null;
  /** The project cards a binding picker may offer (names only). */
  projects?: readonly SessionProjectChoice[];
  /** Bind this card to a project card, or unbind it with null (one field). */
  onChooseProject?: (project: string | null) => Promise<GroundAddResult>;
  /** Declare, or withdraw with null, what a run may do in that folder. */
  onChooseBoundary?: (
    boundary: "read" | "write" | null,
  ) => Promise<GroundAddResult>;
  /**
   * STORY 18.4 — THE SERVER'S PENDING ASK, as view state. While this is here
   * the run is WAITING; the card offers allow-once and refuse and nothing else.
   */
  permission?: AcpPermissionAsk | null;
  /** The person's two verbs. Allow-once is offered only when it exists. */
  onAllowOnce?: () => void;
  onRefuse?: () => void;
  /**
   * STORY 22.6 — KEEP THE LAST COMPLETED RUN AS A CARD, in ONE press. The layer
   * owns the chain: the curator is tried first and 18.4's rule copy catches
   * every answer that is not a card — a decline, an unusable block, a failed or
   * absent answer. The outcome line names which card was made. Absent in a
   * render test.
   */
  onKeepResult?: () => Promise<GroundAddResult>;
  /**
   * STORY 22.4 — THE RUN'S CALLS, DECLARED BEFORE THE RUN: the task model
   * answers, then the manager model distils the result (or the honest
   * no-manager line). One quiet line per fact, from the pure rules; [] says
   * nothing.
   */
  distilWords?: readonly string[];
  /**
   * STORY 22.6 — THE ONE PRESS'S HONEST OUTCOME LINE (PROVISIONAL view state
   * from the layer). It names which card was made — the curator's or the rule's
   * copy — and, when the copy caught a curator answer that could not be used,
   * says so in one sentence. Null is silence: the automatic distil made its
   * card and no press has spoken since.
   */
  keepNotice?: string | null;
  /**
   * STORY 16.22 — RENAME this card: the shared name pill IS the rename field.
   * The name is the person's and the slug is identity (the transcript's file
   * name and a wire's endpoint), so a rename moves neither. Optional so a
   * render test needs no writer.
   */
  onRename?: (name: string) => Promise<GroundAddResult>;
  /**
   * STORY 18.5 — remove this card, immediately and reversibly (the one toast).
   * A run in flight refuses: the transcript is still being written.
   */
  onRemove?: () => Promise<GroundAddResult>;
  /**
   * STORY 16.23 — MOVE this card to its dropped point: ONE record line's
   * `x|y`, through the hook's one write queue. The drag is the SHARED rule in
   * groundDrag.ts (one threshold, one write on release); this prop only carries
   * the drop to the writer. Optional so a render test needs no write path.
   */
  onMove?: (x: number, y: number) => Promise<GroundAddResult>;
  /**
   * STORY 17.9 — WIRE this session card to another card (the source side): a
   * session card's completed run is context for an ask card, so it needs the
   * same small edge handle the other cards have.
   */
  onLink?: (from: string, to: string) => Promise<GroundAddResult>;
  /** STORY 20.3: the plane conversion and the hooked-create opener (linkDrag.ts). */
  toWorld?: (clientX: number, clientY: number) => Point | null;
  onCreateFromLink?: (from: string, at: Point) => void;
  /** The gesture gate, so a wiring drag never starts under an armed tool. */
  interactionMode?: GestureMode;
  /** The one sentence a wiring drag speaks; absent in a render test. */
  onNarrate?: (gesture: GestureNarration) => void;
}) {
  // STORY 24-15 — THE WORKING SIGNAL: the card publishes its live run to the
  // map's working channel so the wires feeding it carry current.
  useEffect(() => {
    working?.set(session.on, running);
    return () => working?.set(session.on, false);
  }, [working, session.on, running]);

  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [picked, setPicked] = useState<string | null>(null);
  // STORY 19.3 — THE TASK IS EPHEMERAL VIEW STATE (never a record field), and
  // `typed` remembers whether the person has written in the field since the
  // last press: it is what decides whether the disclosure opens on "what will
  // be sent" or on the recorded "what was sent".
  const [task, setTask] = useState("");
  const [typed, setTyped] = useState(false);
  // STORY 21.1 — the follow-up composer's field, EPHEMERAL like the task. It
  // holds the words for the NEXT turn of the recorded session, and is cleared
  // once they are sent, so a second press cannot silently repeat them.
  const [followUp, setFollowUp] = useState("");
  // STORY 22.1b — THE CODE FIELD IS THE CARD'S OWN STATE AND NOTHING ELSE. It
  // is never a record field, never view state the layer holds, and it is
  // cleared the moment the press sends it: the lane writes it to the child's
  // stdin and keeps nothing.
  const [code, setCode] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  // STORY 16.23 — THE CARD IS MOVABLE BY THE SAME ONE RULE as a reference.
  // STORY 16.25 — and like the reference card, the live frame is NOT React
  // state: the element carries the hand (`frameGroundCard`) and the point goes
  // to the wires through the shared channel. These two refs are the release's:
  // where the hand let go, and the whole-unit point the record will hold.
  const liveRef = useRef<Point | null>(null);
  const droppedRef = useRef<Point | null>(null);
  // Whether the body still follows the newest entry; a person scrolling up
  // turns it off until they reach the bottom again.
  const pinnedRef = useRef(true);

  // ESC CLOSES THE CARD'S FACE — never the map. Capture phase, so the key is
  // consumed before the plane's handlers see it. A picker that is open is
  // forgotten first (one press, one thing).
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      // STORY 16.22 — THE NAME'S FIELD IS THE PILL'S, NOT THE CARD'S. Escape
      // while renaming forgets the draft (the pill's own handler) and must not
      // ALSO collapse the card. One press, one thing.
      if ((e.target as HTMLElement | null)?.closest?.(".ground-pill")) return;
      e.preventDefault();
      e.stopPropagation();
      if (picked !== null) {
        setPicked(null);
        return;
      }
      onClose();
    }
    // STORY 24-11 — A PRESS AWAY CLOSES THE CARD TOO, the reference card's
    // one rule (the person: "the ask card and session card don't contract on
    // map click like the other cards do"). Capture phase, so a plane press
    // that d3 handles still counts as a press away; a press INSIDE the card —
    // its keys, its fields, its overflow menu — is not one. The task's draft
    // lives in this mount and survives the close, like every other field.
    function onPressAway(e: MouseEvent) {
      const el = cardRef.current;
      if (el !== null && e.target instanceof Node && el.contains(e.target)) {
        return;
      }
      onClose();
    }
    document.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPressAway, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPressAway, true);
    };
  }, [open, onClose, picked]);

  // The card's wheel never zooms the plane.
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    function onWheel(e: WheelEvent) {
      e.stopPropagation();
    }
    el.addEventListener("wheel", onWheel, { passive: true });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // STORY 17.9 — THE WIRING HANDLE, the reference card's raw-listener idiom
  // (d3-zoom stops mousedown at the plane). A release on any ground card draws
  // the one ordered pair; the layer owns the write and its refusal.
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    function handleMouseDown(e: MouseEvent) {
      if (e.button !== 0) return;
      if (!(e.target as HTMLElement).closest(".ground-link-handle")) return;
      e.stopPropagation();
      startGroundLinkDrag(e, session.on, {
        interactionMode,
        onLink,
        onNarrate,
        toWorld,
        onCreateFromLink,
      });
    }
    el.addEventListener("mousedown", handleMouseDown);
    return () => el.removeEventListener("mousedown", handleMouseDown);
  }, [
    session.on,
    interactionMode,
    onLink,
    onNarrate,
    toWorld,
    onCreateFromLink,
  ]);

  /**
   * STORY 16.25 — PUT THE FRAME BACK ON THE RECORD'S OWN POINT and let the
   * wires go: for a drop that rounded onto the card's own point, a refused
   * write, or the write whose point has arrived. The map may never show a
   * position the file does not hold.
   */
  function settleFrame(): void {
    liveRef.current = null;
    droppedRef.current = null;
    settleGroundCard(cardRef.current, { x: session.x, y: session.y });
    drag?.publish(null);
  }

  // STORY 16.23 — THE SESSION CARD MOVES BY THE SAME ONE RULE. The press
  // reaches the shared wiring (groundDrag.ts), so the threshold, the live
  // frame and the one write on release are the reference card's — there is no
  // second drag here. The name pill is a child of this card, so a press on it
  // lands in the same listener: the pill is the handle, and a press that never
  // moves on it opens nothing. STORY 16.25 — the frame is the element's and
  // the shared channel's, so a move renders nothing; the drop is ONE write.
  useEffect(() => {
    const el = cardRef.current;
    if (el === null) return;
    return attachGroundCardDrag(el, {
      at: () => ({ x: session.x, y: session.y }),
      zoom: () => zoom,
      onPreview: (at) => {
        // Null is the release's own news; the release below decides what stays.
        if (at === null) return;
        liveRef.current = at;
        frameGroundCard(el, at);
        drag?.publish({ slug: session.on, x: at.x, y: at.y });
      },
      onMoved: () =>
        onNarrate?.({
          kind: "moving",
          name: sessionDisplayName(session.name),
        }),
      onDrop: (point) => {
        if (onMove === undefined) {
          settleFrame();
          return;
        }
        void onMove(point.x, point.y).then((result) => {
          // A refused write is one sentence on the card, never a point that
          // quietly snaps back for no stated reason — and the card goes back
          // to the point the record still holds.
          if (!result.ok) {
            settleFrame();
            setProblem(result.message);
          }
        });
      },
      onRelease: (moved) => {
        onNarrate?.(GESTURE_IDLE);
        if (!moved) return;
        const at = liveRef.current;
        if (at === null) return;
        // The record keeps whole units, so the frame commits to the point the
        // line will hold: the card and its wires land where they stay.
        const landed = { x: Math.round(at.x), y: Math.round(at.y) };
        if (landed.x === session.x && landed.y === session.y) {
          // A no-op drop writes nothing, so nothing else would release this.
          settleFrame();
          return;
        }
        droppedRef.current = landed;
        drag?.publish({ slug: session.on, x: landed.x, y: landed.y });
      },
      isArmed: () => isGestureArmed(interactionMode),
      // STORY 16.32 — the user's one rule: a COLLAPSED session card drags by
      // its body or its pill; an EXPANDED one drags only by its pill, so a
      // press on the transcript is text to select. The card's verbs, fields
      // and the link handle are already the helper's own exclusions.
      expanded: () => open,
      onClick: (onPill) => {
        // A press on the name pill is the handle and opens nothing; a press
        // that never moved on the body is the card's door.
        if (onPill) return;
        onOpen();
      },
    });
  }, [session.on, session.x, session.y, zoom, onMove, onOpen, onNarrate, interactionMode, drag]);

  /**
   * THE FRAME IS RELEASED WHEN THE RECORD CATCHES UP: the new point arrives as
   * a prop only after the queued write landed, so the card and its wires stay
   * on the dropped point instead of snapping back through the old one.
   */
  useEffect(() => {
    const dropped = droppedRef.current;
    if (dropped === null) return;
    if (session.x !== dropped.x || session.y !== dropped.y) return;
    settleFrame();
  }, [session.x, session.y]);

  // STORY 22.1b — THE CODE LIVES ONLY AS LONG AS THE CHILD. When a sign-in
  // starts or ends, the field is cleared: a code typed while the child was
  // exiting is never shown again, and a new child starts from an empty field.
  useEffect(() => {
    setCode("");
  }, [signIn?.running]);

  // Opening starts AT THE NEWEST ENTRY again.
  useEffect(() => {
    if (open) pinnedRef.current = true;
  }, [open]);

  // AUTO-SCROLL TO THE NEWEST ENTRY unless the person scrolled up.
  useEffect(() => {
    if (!open) return;
    const el = bodyRef.current;
    if (el === null || !pinnedRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [open, entries.length]);

  function trackScroll(): void {
    const el = bodyRef.current;
    if (el === null) return;
    pinnedRef.current = sessionAtBottom(
      el.scrollTop,
      el.clientHeight,
      el.scrollHeight,
    );
  }

  async function startRun(): Promise<void> {
    if (busy || running || onRun === undefined) return;
    // STORY 19.3 — AN EMPTY TASK IS ONE SENTENCE AND NOTHING ELSE. No request
    // is sent and no transcript line is written; the layer refuses the same
    // way, so no caller can start a run with a packet nobody wrote.
    if (task.trim() === "") {
      setProblem(SESSION_TASK_REFUSAL);
      return;
    }
    setBusy(true);
    setProblem(null);
    // The press makes the task the recorded send: the disclosure flips to
    // "what was sent" the moment the `sent` line arrives through the prop.
    setTyped(false);
    // The run's own promise settles when the run does; awaiting it only holds
    // THIS handler, never the card. The entries arrive through the prop.
    const result = await onRun(task);
    setBusy(false);
    // The ENDING is the transcript's line; only a record that could not keep
    // up answers a sentence here.
    if (!result.ok) setProblem(result.message);
  }

  /**
   * STORY 21.1 — CONTINUE THE SESSION. The press sends the follow-up task into
   * the card's last delegate session through the layer's one gated path; the
   * transcript records the send and every entry exactly as a run's. A refusal
   * (no recorded session, a row that cannot continue, a folder that is gone)
   * is one sentence in the problem line, and the layer has sent nothing.
   */
  async function continueSession(): Promise<void> {
    if (busy || running || onFollowUp === undefined) return;
    if (followUp.trim() === "") {
      setProblem(SESSION_TASK_REFUSAL);
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await onFollowUp(followUp);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setFollowUp("");
  }

  async function stopRun(): Promise<void> {
    if (onStop === undefined) return;
    setProblem(null);
    try {
      await onStop();
    } catch {
      // The run's own line settles it; a stop that cannot reach the server
      // leaves the run to its budget.
    }
  }

  /**
   * STORY 18.5 — the card's remove, beside close: immediate, reversible through
   * the one toast. A refused unlink has already taken the card, so its one
   * sentence is the layer's, not this card's.
   */
  async function removeCard(): Promise<void> {
    if (busy || running || onRemove === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onRemove();
    if (!result.ok && result.recordsRemoved !== true) {
      setBusy(false);
      setProblem(result.message);
    }
  }

  /**
   * STORY 22.6 — THE CARD'S ONE RESULT PRESS. It forwards to the layer's ONE
   * chain (curator, then 18.4's copy when the curator's answer cannot be used),
   * so the card never decides which path a press took. The outcome sentence is
   * the layer's view state; only a press that could not run at all shows here.
   */
  async function keepResult(): Promise<void> {
    if (busy || onKeepResult === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onKeepResult();
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  }

  /**
   * STORY 22.1 — THE ROW'S ONE PRESS. The layer runs ONE tiny task through the
   * existing lane and its gates decide what may happen: a live card run answers
   * the existing busy sentence, a row this build does not ship says so, and
   * only a completed answer records a fact. A failed test keeps its own
   * sentence and leaves the row's state exactly as it was.
   */
  async function testRow(): Promise<void> {
    if (busy || onTestRow === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onTestRow();
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  }

  /**
   * STORY 22.1b — SEND THE CODE. A blank field is ONE sentence and nothing
   * leaves: no line crosses the pipe and the child keeps waiting. Otherwise the
   * typed code goes to the child's stdin through the lane's one road, and the
   * field is CLEARED at once — the app keeps no copy of it anywhere.
   */
  function sendSignInCode(): void {
    if (signIn === null || !signIn.running) return;
    if (code.trim() === "") {
      setProblem(SETUP_SENTENCES.emptyCode);
      return;
    }
    signIn.sendCode?.(code);
    setProblem(null);
    setCode("");
  }

  /**
   * STORY 19.2 — THE BINDING'S ONE WRITE. The value "" is the picker's "no
   * project" / "undeclared" and becomes null, which REMOVES the field: an
   * unbound card and an undeclared one keep exactly the bytes (and the run)
   * they had before this story.
   */
  async function usePickedProject(value: string): Promise<void> {
    if (busy || onChooseProject === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onChooseProject(value === "" ? null : value);
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  }

  async function usePickedBoundary(value: string): Promise<void> {
    if (busy || onChooseBoundary === undefined) return;
    setBusy(true);
    setProblem(null);
    const boundary =
      value === "read" || value === "write" ? (value as "read" | "write") : null;
    const result = await onChooseBoundary(boundary);
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  }

  /**
   * STORY 22.5 — THE MODEL'S ONE WRITE. The option's DOM value is its INDEX in
   * the recorded list, never the tool's opaque value: the value bytes never
   * appear in this card's markup, and the choice is read back from the list
   * this card actually holds. "" is the tool's own default, and it REMOVES the
   * record's field.
   */
  async function usePickedModel(value: string): Promise<void> {
    if (busy || onChooseModel === undefined || models === null) return;
    const at = value === "" ? -1 : Number(value);
    const choice = Number.isInteger(at) && at >= 0 ? models[at] : undefined;
    if (value !== "" && choice === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onChooseModel(choice === undefined ? null : choice.value);
    setBusy(false);
    if (!result.ok) setProblem(result.message);
  }

  async function usePickedTool(): Promise<void> {
    if (picked === null || onChooseTool === undefined || busy) return;
    setBusy(true);
    setProblem(null);
    const result = await onChooseTool(picked);
    setBusy(false);
    if (!result.ok) {
      setProblem(result.message);
      return;
    }
    setPicked(null);
  }

  // STORY 19.2 — the declaration of the bound run, when the person has both
  // bound a folder card and declared a boundary. The folder's FULL PATH is said
  // here and only here: the blast radius is said aloud before the run starts.
  const scopeDeclaration =
    projectFolder !== null && session.boundary !== undefined
      ? acpScopeDeclaration(projectFolder, session.boundary)
      : null;

  /**
   * STORY 22.5 — WHICH RECORDED CHOICE THE PICKER SHOWS. The record holds the
   * tool's opaque value; the select's own values are indices, so the list is
   * searched for that value's place. A value the tool no longer names has no
   * place, and the picker shows the tool's default rather than a wrong name.
   */
  const selectedModel = (() => {
    if (session.model === undefined || models === null) return "";
    const at = models.findIndex((choice) => choice.value === session.model);
    return at < 0 ? "" : String(at);
  })();

  // STORY 22.1b — THE ADDRESS THE CHILD WANTS OPEN, if its newest line holds
  // one. Only a live child's line is read: an ended sign-in's line belongs to
  // its one sentence, never to a second verb. Only http(s) counts.
  const signInUrl =
    signIn !== null && signIn.running && signIn.line !== null
      ? setupUrlIn(signIn.line)
      : null;

  // STORY 21.1 — THE SESSION THIS CARD COULD CONTINUE. Only a recorded pair
  // (its id AND the exact folder it was recorded in) opens the second composer;
  // an id-only entry, or no session at all, leaves the card exactly as it was.
  const resume = sessionResumeOf(entries);
  // THE FOLLOW-UP'S PACKET IS THE TASK AND THE BOUND, AND NO CARD BLOCKS. The
  // session's own memory already holds the wired context; re-sending it would
  // be the token waste a follow-up exists to avoid. The same pure assembler the
  // send uses composes these bytes, so the readback cannot drift from them.
  const followUpPacket =
    open && followUp.trim() !== ""
      ? assembleSessionPacket(followUp, [])
      : null;

  // STORY 19.3 — WHAT THE CARD WOULD SEND, and WHAT IT DID SEND. The packet is
  // assembled from the typed task and the wired cards by the SAME pure seam the
  // run uses; the recorded `sent` entry is the transcript's own bytes. The
  // disclosure below renders one or the other — never a re-composition of them.
  const sentEntry = (() => {
    for (let at = entries.length - 1; at >= 0; at -= 1) {
      const entry = entries[at]!;
      if (entry.kind === "sent") return entry;
    }
    return null;
  })();
  const packet =
    open && task.trim() !== ""
      ? assembleSessionPacket(task, contextCards)
      : null;
  const showingSent = sentEntry !== null && !typed;
  const readbackMessages: readonly TurnMessage[] | null = showingSent
    ? [{ role: "user", content: sentEntry.text }]
    : packet === null
      ? null
      : packet.messages;
  // The declaration is the packet's own sizes. After the send it is shown only
  // when the packet still describes exactly those bytes; a changed task or a
  // changed wire set means the sizes no longer belong to what left, and the
  // recorded bytes stand alone rather than wear a wrong declaration.
  const readbackDeclaration = showingSent
    ? packet !== null && packet.text === sentEntry.text
      ? packet.declaration
      : null
    : (packet?.declaration ?? null);

  const newest = sessionNewestEntry(entries);
  // STORY 22.2 — THE LAST ENDING, so the run block can state why the last run
  // ended without the person pressing anything or scrolling the transcript. A
  // completed run's word is enough (it carries no sentence); a failed,
  // timed-out or stopped one shows its own sentence beside the word.
  const lastEnded = entries.reduce<
    Extract<SessionEntry, { kind: "ended" }> | null
  >((last, entry) => (entry.kind === "ended" ? entry : last), null);
  const smallFolded =
    !open &&
    newest !== null &&
    newest.kind === "text" &&
    previewOverflows(newest.text, previewLines);

  return (
    <div
      ref={cardRef}
      className={`session-card${open ? " expanded" : ""}`}
      style={
        {
          // STORY 16.25: the RECORD's point is what React renders; the hand's
          // own frame is written on the element, so a drag re-renders nothing.
          left: session.x,
          top: session.y,
          "--preview-lines": previewLines,
          // STORY 24-9 (ADR-0044): the verb strip counter-scales like the
          // name pill, so its bubbles stay finger-sized at every zoom.
          "--verb-scale": verbCounterScale(zoom),
        } as CSSProperties
      }
      data-slug={session.on}
      data-working={running ? "" : undefined}
    >
      {/* STORY 16.22 — THE NAME FLOATS ABOVE THE SESSION CARD, in the SAME pill
          the reference and ask cards wear: one component, one counter-scale,
          one rename field, and this family's OWN name rules (a blank field
          stores "Untitled session"). The name left the body because the body's
          transcript cropped it and the plane's scale shrank it away. */}
      <CardNamePill
        name={session.name}
        zoom={zoom}
        busy={busy}
        rules={SESSION_PILL_RULES}
        renameLabel="rename this session card"
        onRename={
          onRename === undefined
            ? undefined
            : async (name: string) => {
                const result = await onRename(name);
                if (!result.ok) setProblem(result.message);
                return result;
              }
        }
      />
      <div className="session-card-kind">{sessionKindLine(toolName)}</div>
      {/* STORY 24-5 — the row's state, the model and the sign-in MOVED behind
          the one disclosure below ("what will be sent"): the face is the
          transcript's. */}
  
      {/* STORY 19.2 — THE BINDING, QUIETLY: the bound project card's NAME and
          never its folder path. What the run may do there is declared in the
          expanded face, where the person can see and change it. */}
      {projectName !== null && (
        <div className="session-card-bound">{sessionBindingLine(projectName)}</div>
      )}
      {/* STORY 17.9 — a session card can be wired into an ask card; its last
          completed run is what it lends. */}
      {onLink !== undefined && (
        <button
          type="button"
          className="ground-link-handle"
          aria-label="wire this card to another"
        >
          <IconWire />
          <span className="verb-tip">wire this card to another</span>
        </button>
      )}
      <div className="session-card-body" ref={bodyRef} onScroll={trackScroll}>
        {open ? (
          entries.length === 0 ? (
            <div className="session-card-empty">{SESSION_EMPTY_SENTENCE}</div>
          ) : (
            <div
              className="session-card-transcript"
              aria-live={running ? "polite" : undefined}
            >
              {entries.map((entry, index) => (
                <SessionEntryLine key={index} entry={entry} />
              ))}
            </div>
          )
        ) : newest === null ? (
          <div className="session-card-empty">{SESSION_EMPTY_SENTENCE}</div>
        ) : (
          <div className="session-card-transcript">
            <SessionEntryLine entry={newest} crop={previewLines} />
          </div>
        )}
        {smallFolded && (
          <div className="ground-fold">
            <div className="ground-fade" aria-hidden="true" />
            <button
              type="button"
              className="ground-more"
              title="open the card"
              onClick={onOpen}
            >
              more
            </button>
          </div>
        )}
      </div>
      {problem !== null && (
        <div className="session-card-problem" role="status">
          {problem}
        </div>
      )}
      {open && (
        <div className="session-card-run">
          {/* STORY 22.2 — WHY THE LAST RUN ENDED, beside the verbs. The
              transcript lists the same ending as an entry, but a person who
              scrolled up (or who never opened the transcript) must not have to
              press anything to learn it: the word AND the run's own sentence
              sit here, quietly. A partial is still not a result — this line
              states the ending, it never dresses one up. */}
          {lastEnded !== null && (
            <div
              className={"session-card-ending ending-" + lastEnded.ending}
              role="status"
            >
              {sessionEndingLine(lastEnded.ending, lastEnded.sentence ?? null)}
            </div>
          )}
          {/* STORY 18.4 — THE PENDING PERMISSION, and the person's TWO verbs.
              The server's options are NEVER presented as choices: only
              allow-once and refuse exist here, so an "always" offer on the wire
              cannot become a press. When no allow-once option was offered, the
              allow verb is disabled and the card says why — it never falls back
              to an always option. */}
          {permission !== null && (
            <div className="session-permission" role="status">
              <div className="session-permission-ask">
                the run is asking: {permissionAskLine(permission.toolCall)}
              </div>
              {allowOnceOption(permission.options) === null && (
                <div className="session-permission-note">
                  the server offered no allow-once option, so only refuse is
                  available.
                </div>
              )}
              <div className="session-permission-actions">
                <button
                  type="button"
                  className="session-permission-allow"
                  disabled={
                    onAllowOnce === undefined ||
                    allowOnceOption(permission.options) === null
                  }
                  onClick={onAllowOnce}
                >
                  allow once
                </button>
                <button
                  type="button"
                  className="session-permission-refuse"
                  disabled={
                    onRefuse === undefined ||
                    refuseOption(permission.options) === null
                  }
                  onClick={onRefuse}
                >
                  refuse
                </button>
              </div>
            </div>
          )}
          {/* STORY 19.3 — THE TASK. The person writes what this run should do.
              It is EPHEMERAL (no record field): the only thing that survives a
              reopen is the send itself, recorded in the transcript. Empty means
              the run verb answers one sentence and nothing starts. */}
          <textarea
            className="session-card-task"
            aria-label={SESSION_TASK_LABEL}
            placeholder={SESSION_TASK_PLACEHOLDER}
            value={task}
            disabled={busy || running}
            onChange={(e) => {
              setTask(e.target.value);
              setTyped(true);
              if (problem !== null) setProblem(null);
            }}
          />
          {contextMissing && (
            <div className="session-card-wired-missing">
              {SESSION_CONTEXT_DANGLING}
            </div>
          )}
          {/* STORY 19.3 — ONE QUIET DISCLOSURE, the ask card's own shape: the
              declaration line (every block with its exact size and the total)
              and the exact bytes, one press away. Before the press it is "what
              will be sent"; after the run it is "what was sent", read from the
              transcript's recorded `sent` entry, so a reopen is the same
              bytes. The bytes are NEVER normalized: the pre-send packet's text,
              the wire's prompt and the recorded entry are one string. */}
          {/* STORY 24-5 — ONE DISCLOSURE, the ask card's own shape, now the
              run's ONLY door: what this run is and what will go. The row, the
              model, the sign-in, the bindings, the declarations and the
              continuation all live behind this one quiet verb, so the face
              above stays the transcript's. The bytes stay exactly what they
              were: the pre-send packet's text or the recorded `sent` entry. */}
          <details className="ask-card-declaration session-card-sent">
            <summary className="ask-card-declaration-verb">
              {sessionDisclosureVerb(sentEntry !== null, typed)}
            </summary>
            <div className="ask-card-declaration-body">
              {/* THE DECLARATION FOR THE NEXT RUN: 18.2's one sentence,
                  computed from the row alone. It names a provider ROW, never a
                  key. */}
              {declaration !== null && (
                <div className="session-card-declaration">{declaration}</div>
              )}
              {/* STORY 22.4 — THE CALLS, NAMED BEFORE THE RUN: the task model
                  answers, then the manager model distils the result into a
                  card (or, with no manager, the card will be made by a rule).
                  The distil is automatic, so no condition line claims a
                  press. */}
              {distilWords.length > 0 && (
                <div className="session-distil-declaration">
                  {distilWords.map((line, index) => (
                    <div className="session-distil-line" key={index}>
                      {line}
                    </div>
                  ))}
                </div>
              )}
              {/* STORY 19.2 — THE BOUND RUN'S BLAST RADIUS, in one sentence:
                  the folder's full path and what the person said the run may
                  do there. */}
              {scopeDeclaration !== null && (
                <div className="session-card-declaration session-card-scope">
                  {scopeDeclaration}
                </div>
              )}
              {/* STORY 22.1 — THE ROW'S STATE: the command's absence, the
                  honest never-tested line, or the date and the words a test
                  answered. */}
              {toolStatus !== null && (
                <div className="session-card-tool-state">
                  {acpStatusSentence(toolStatus)}
                </div>
              )}
              {/* STORY 22.5 — THE MODEL: the tool's own display names, or the
                  one quiet line saying the model is the tool's own setting. */}
              {toolName !== null &&
                (models !== null &&
                models.length > 0 &&
                onChooseModel !== undefined ? (
                  <div className="session-card-model-choice">
                    <select
                      className="session-card-pick"
                      aria-label={SESSION_MODEL_LABEL}
                      value={selectedModel}
                      disabled={busy || running}
                      onChange={(e) => void usePickedModel(e.target.value)}
                    >
                      <option value="">{SESSION_MODEL_DEFAULT}</option>
                      {models.map((choice, index) => (
                        <option key={index} value={String(index)}>
                          {choice.name}
                        </option>
                      ))}
                    </select>
                  </div>
                ) : models === null ? (
                  <div className="session-card-model-note">
                    {SESSION_MODEL_OWN_SETTING}
                  </div>
                ) : null)}
              {/* A CARD WHOSE ROW IS GONE says so and offers the rows this
                  build ships again. */}
              {toolName === null && (
                <div className="session-card-missing" role="status">
                  <div className="session-card-missing-sentence">
                    {SESSION_MISSING_TOOL_SENTENCE}
                  </div>
                  {tools.length > 0 && onChooseTool !== undefined && (
                    <div className="session-card-picker">
                      <select
                        className="session-card-pick"
                        aria-label="run this card with"
                        value={picked ?? tools[0]!.id}
                        disabled={busy || running}
                        onChange={(e) => setPicked(e.target.value)}
                      >
                        {tools.map((choice) => (
                          <option key={choice.id} value={choice.id}>
                            {choice.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="session-card-bind"
                        disabled={busy || running}
                        onClick={() => void usePickedTool()}
                      >
                        use this tool
                      </button>
                    </div>
                  )}
                </div>
              )}
              {/* STORY 19.2 — THE BINDING AND THE BOUNDARY. A project is a
                  card, so the picker offers NAMES only; the boundary is the
                  person's declaration, and its absence is the safe default. */}
              {(onChooseProject !== undefined ||
                onChooseBoundary !== undefined) && (
                <div className="session-card-binding-choice">
                  {onChooseProject !== undefined && (
                    <select
                      className="session-card-pick"
                      aria-label="run this card in a project"
                      value={session.project ?? ""}
                      disabled={busy || running}
                      onChange={(e) => void usePickedProject(e.target.value)}
                    >
                      <option value="">no project</option>
                      {projects.map((choice) => (
                        <option key={choice.id} value={choice.id}>
                          {choice.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {onChooseBoundary !== undefined && (
                    <select
                      className="session-card-pick"
                      aria-label="what this run may do there"
                      value={session.boundary ?? ""}
                      disabled={
                        busy || running || session.project === undefined
                      }
                      onChange={(e) => void usePickedBoundary(e.target.value)}
                    >
                      <option value="">
                        {SESSION_BOUNDARY_LABELS.undeclared}
                      </option>
                      <option value="read">
                        {SESSION_BOUNDARY_LABELS.read}
                      </option>
                      <option value="write">
                        {SESSION_BOUNDARY_LABELS.write}
                      </option>
                    </select>
                  )}
                  {session.boundary === undefined && (
                    <div className="session-card-bound-hint">
                      {SESSION_BOUNDARY_UNDECLARED_SENTENCE}
                    </div>
                  )}
                </div>
              )}
              {/* STORY 22.1b — THE TOOL'S OWN SIGN-IN. While the child is
                  alive: the running line, its newest line cropped, the "open
                  the page" verb, and the one small field for the code. Once it
                  ends: ONE sentence, never a claim that it worked. */}
              {signIn !== null && (
                <div className="session-card-sign-in">
                  {signIn.running ? (
                    <>
                      <div className="session-card-sign-in-line" role="status">
                        {SETUP_SENTENCES.running}
                      </div>
                      {signIn.line !== null &&
                        setupLineCrop(signIn.line) !== "" && (
                          <div className="session-card-sign-in-child">
                            {setupLineCrop(signIn.line)}
                          </div>
                        )}
                      {signInUrl !== null && (
                        <button
                          type="button"
                          className="session-card-sign-in-page"
                          disabled={signIn.openPage === undefined}
                          onClick={() => signIn.openPage?.(signInUrl)}
                        >
                          {SETUP_VERBS.openPage}
                        </button>
                      )}
                      <div className="session-card-sign-in-code">
                        <input
                          type="text"
                          className="session-card-sign-in-field"
                          aria-label={SETUP_CODE_LABEL}
                          placeholder={SETUP_CODE_PLACEHOLDER}
                          value={code}
                          onChange={(e) => {
                            setCode(e.target.value);
                            if (problem !== null) setProblem(null);
                          }}
                        />
                        <button
                          type="button"
                          className="session-card-sign-in-send"
                          disabled={signIn.sendCode === undefined}
                          onClick={() => sendSignInCode()}
                        >
                          {SETUP_VERBS.sendCode}
                        </button>
                        <button
                          type="button"
                          className="session-card-sign-in-stop"
                          disabled={signIn.stop === undefined}
                          onClick={() => signIn.stop?.()}
                        >
                          {SETUP_VERBS.stop}
                        </button>
                      </div>
                    </>
                  ) : signIn.ended !== null ? (
                    <div className="session-card-sign-in-line" role="status">
                      {setupEndSentence(
                        signIn.ended.ending,
                        signIn.ended.line,
                        signIn.ended.sentence,
                      )}
                    </div>
                  ) : null}
                </div>
              )}
              {/* STORY 21.1 — THE SECOND COMPOSER: continue the card's last
                  delegate session. The follow-up's packet is the task and the
                  bound alone. */}
              {resume !== null && (
                <div className="session-card-follow-up">
                  <div className="session-card-follow-up-label">
                    {SESSION_FOLLOW_UP_LABEL}
                  </div>
                  {canResume ? (
                    <>
                      <textarea
                        className="session-card-task session-card-follow-up-task"
                        aria-label={SESSION_FOLLOW_UP_LABEL}
                        placeholder={SESSION_FOLLOW_UP_PLACEHOLDER}
                        value={followUp}
                        disabled={busy || running}
                        onChange={(e) => {
                          setFollowUp(e.target.value);
                          if (problem !== null) setProblem(null);
                        }}
                      />
                      {followUpPacket !== null && (
                        <details className="ask-card-declaration session-card-sent session-card-follow-up-sent">
                          <summary className="ask-card-declaration-verb">
                            {ASK_DECLARATION_VERB}
                          </summary>
                          <div className="ask-card-declaration-body">
                            <PacketSurface
                              declaration={followUpPacket.declaration}
                              messages={followUpPacket.messages}
                            />
                          </div>
                        </details>
                      )}
                      <button
                        type="button"
                        className="session-card-follow-up-verb"
                        disabled={
                          busy ||
                          running ||
                          onFollowUp === undefined ||
                          followUp.trim() === ""
                        }
                        onClick={() => void continueSession()}
                      >
                        continue
                      </button>
                    </>
                  ) : (
                    <div className="session-card-follow-up-refusal">
                      {SESSION_RESUME_REFUSALS.rowCannot}
                    </div>
                  )}
                </div>
              )}
              {readbackMessages !== null && (
                <PacketSurface
                  declaration={readbackDeclaration}
                  messages={readbackMessages}
                />
              )}
            </div>
          </details>
          {/* The one sentence, and the one verb. No spinner: this line is
              read from the live-run list, so it cannot outlive the run. The
              sentence stays ON THE FACE (it is news); its verb is in the strip. */}
          {running && (
            <span className="session-running">{SESSION_RUNNING_SENTENCE}</span>
          )}
          {/* STORY 22.6 — the one press's honest outcome line stays ON THE
              FACE (it is news, not chrome); its verb sits in the overflow. */}
          {keepNotice !== null && (
            <div className="session-distil-fallback">
              <span className="session-distil-said">{keepNotice}</span>
            </div>
          )}
          {/* STORY 24-5 — TWO VERBS ON THE FACE: run (or stop), and ONE quiet
              overflow. Everything else — test, sign in, keep, remove, close —
              is one press in, exactly like the ask card's "more". Nothing is
              lost: every verb keeps its own rule and its keyboard path. */}
          <div className="session-card-actions">
            {running ? (
              <VerbBubble
                className="session-card-stop"
                label="stop"
                icon={<IconStop />}
                disabled={onStop === undefined}
                onClick={() => void stopRun()}
              />
            ) : (
              <VerbBubble
                className="session-card-run-verb"
                label="run"
                icon={<IconRun />}
                disabled={busy || toolName === null || onRun === undefined}
                onClick={() => void startRun()}
              />
            )}
            <details className="session-card-overflow">
              <summary className="session-card-overflow-verb verb-key">
                <IconMore />
                <span className="verb-tip">more</span>
              </summary>
              <div className="session-card-overflow-menu">
                {/* STORY 22.1 — the row's one verb. NOT gated on the card's
                    live run: a press then answers the existing busy sentence,
                    and the test's own ending never touches that run. */}
                {toolName !== null && onTestRow !== undefined && (
                  <button
                    type="button"
                    className="session-card-test"
                    disabled={busy}
                    onClick={() => void testRow()}
                  >
                    test
                  </button>
                )}
                {/* STORY 22.1b — the sign-in verb, disabled while the child is
                    alive, so one card never hosts two sign-ins. */}
                {signIn !== null && (
                  <button
                    type="button"
                    className="session-card-sign-in-verb"
                    disabled={busy || signIn.running}
                    onClick={() => signIn.start?.()}
                  >
                    {SETUP_VERBS.signIn}
                  </button>
                )}
                {/* STORY 22.6 — one verb, one press: the layer tries the
                    curator first and falls back to 18.4's rule copy. A PARTIAL
                    offers no verb: a partial is never a result. */}
                {lastEnded !== null && lastEnded.ending === "completed" && (
                  <button
                    type="button"
                    className="session-card-make"
                    disabled={busy || onKeepResult === undefined}
                    onClick={() => void keepResult()}
                  >
                    {SESSION_RESULT_KEEP_VERB}
                  </button>
                )}
                {/* STORY 18.5 — the card's remove: immediate, reversible
                    through the one toast. A live run is never cut by it. */}
                {onRemove !== undefined && (
                  <button
                    type="button"
                    className="session-card-remove"
                    disabled={busy || running}
                    onClick={() => void removeCard()}
                  >
                    remove
                  </button>
                )}
                <button
                  type="button"
                  className="session-card-close"
                  onClick={onClose}
                >
                  close
                </button>
              </div>
            </details>
          </div>
        </div>
      )}
      {!open && (
        <div className="session-card-footer">
          <button type="button" className="session-card-open" onClick={onOpen}>
            open
          </button>
        </div>
      )}
    </div>
  );
}
