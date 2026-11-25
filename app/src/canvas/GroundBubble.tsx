import { useEffect, useRef, useState } from "react";
import { readingFileName } from "../map/readings";
import {
  SESSION_TOOL_REFUSAL,
  proposeSessionName,
} from "../map/sessions";
import { askNameForCreate } from "../map/asks";
import { dropCardName } from "./osDrop";
import { webLinkName } from "./webLink";
import { ACP_SPECS, acpRowLabel } from "../turn/acpSpecs";
import { rowWithFacts, type AcpRowFact } from "../turn/acpRowStore";
import { pickFolder, pickReadingFile } from "../workspace/dialogs";
import { usePlane } from "./CanvasPlane";
import type { GroundAddResult } from "./useGround";
import { counterScale } from "./veilRules";

/**
 * The ground map's creation affordance (story 16.1): double-click empty paper,
 * type a name, choose a source — done. (Story 16.4: that source may be a PDF,
 * read on device. Story 16.15: it may also be an IMAGE, drawn in place, or a
 * VIDEO, whose title and thumbnail are copied beside the map.)
 *
 * THE INTENTS (story 16.15, then the provisional project card): a FILE (text,
 * PDF or image, by the pick's name), a FOLDER (a project card: a reference
 * whose pointer is a folder elsewhere on this machine, with nothing read or
 * copied from it), a PAGE (a pasted web address) or a VIDEO (a pasted address
 * on a host this app knows). The INTENT chooses the extractor — the file's own
 * bytes are never sniffed, and a file that is neither text, PDF nor a known
 * image type refuses with one sentence. The choice is the person's, not the
 * app's guess.
 *
 * This is NOT the concept map's word bubble and NOT a `CreationKind`
 * (`wordCreationOffered` stays concept-only): the noun is the ground map's
 * own, a REFERENCE, and its second half is a source. Keeping it a separate
 * component is what lets the ground map grow its own face without reviving the
 * concept bubble's grammar.
 *
 * The order is the story's order: a name is asked for FIRST, then the source.
 * Once both are there, the source IS the commit (the check's "type a name, pick
 * a file"); the add button stays for the other order. A refused file or address
 * shows ONE quiet sentence and writes nothing: the reference is not created
 * half-formed. Esc, cancel or a press outside drops the draft; nothing was
 * written.
 *
 * It hangs in WORLD space at the double-clicked point and counter-scales
 * against the camera (the naming popup's idiom), and its classes are on the
 * gate's content lists plus a raw mousedown stop, so its presses never pan the
 * plane, start a word gesture or count as another double-click.
 *
 * STORY 21.13 — THE ASK DOOR: this bubble can make the card the map is built
 * around. Choosing "an ask" names the card first (the row's one rule) and makes
 * an EMPTY ask card at the point: no question, no turn, no send, no conversation
 * file — an unasked question is not a record. When the bubble was opened by a
 * wire released on empty paper, the card also takes that gesture's one wire;
 * the bubble itself names no link, so the hookup stays the app's single path.
 *
 * STORY 17 (shortlist item 8): the bubble carries `ground-popover`, the
 * second, smaller prose scale, so the creation surface reads as its own small
 * popover instead of a shrunken card. Its title stays the quiet meta label.
 *
 * PROVISIONAL: the card's size, the intent row's look, the wording of the
 * sentences, the "name it first." rule and the `folder` intent with its
 * absolute pointer (ADR-0003's rendering seam and the story's record shapes).
 */

/**
 * What the person means to make at this point (story 16.15, then the session
 * card and the ask card).
 * PROVISIONAL: `folder` is the PROJECT CARD — a reference whose pointer is a
 * folder elsewhere on this machine, with no reading taken from it.
 */
export type GroundIntent =
  | "ask"
  | "file"
  | "folder"
  | "page"
  | "video"
  | "session";

/** The intent row's words, in order. PROVISIONAL. */
const INTENTS: readonly { intent: GroundIntent; label: string }[] = [
  // STORY 21.13 — THE ASK COMES FIRST: this map is built around the ask card,
  // and a wire released on empty paper is already asking "connect this to
  // something new". The label keeps the row's grammar ("a file", "a session").
  { intent: "ask", label: "an ask" },
  { intent: "file", label: "a file" },
  { intent: "folder", label: "a folder" },
  { intent: "page", label: "a page" },
  { intent: "video", label: "a video" },
  // STORY 18.3 — the SESSION CARD is created here too: the person is already
  // at a point on the paper, and a run needs a place. It is not a reference and
  // not an intent on a reference's source: the row it binds is the whole card.
  { intent: "session", label: "a session" },
];

interface GroundBubbleProps {
  /** The world point the person double-clicked. */
  x: number;
  y: number;
  /**
   * STORY 17.10 — WHICH DOOR THE BUBBLE OPENED FROM. The ground double-click
   * now opens the concept map's bubble (canvas/PlaneMenu.tsx) with a door list;
   * choosing a REFERENCE door opens THIS form already on that intent, so the
   * person does not pick the same thing twice. Absent (or "file") keeps the
   * old order: a name, then a file. STORY 21.13 makes the ASK door one of those
   * doors: choosing it opens THIS form on "ask", where the name comes first and
   * there is no second thing to pick. PROVISIONAL: the door order is the spec's.
   */
  initialIntent?: GroundIntent;
  /**
   * STORY 21.13 — MAKE AN EMPTY ASK CARD at this point under the person's own
   * name: no question, no turn, no conversation file (an unasked question is
   * not a record). The point is the bubble's own, so the app's wrapper supplies
   * it. Optional so a render test (and an older caller) needs no ground hook.
   */
  onAddAsk?: (name: string) => Promise<GroundAddResult>;
  /** Add the reference (the app's one write path); a refusal is a sentence. */
  onAdd: (name: string, from: string) => Promise<GroundAddResult>;
  /**
   * PROVISIONAL — add a PROJECT CARD from a picked FOLDER elsewhere: the ground
   * reference's pointer is the folder, and nothing is read from it. Optional so
   * a render test (and an older caller) needs no disk.
   */
  onAddFolder?: (name: string, folder: string) => Promise<GroundAddResult>;
  /**
   * Add a reference from a pasted web address (story 16.14): the sidecar
   * fetches it once and the card keeps the text and a local image. A refusal
   * is one sentence and nothing is created.
   */
  onAddPage?: (name: string, url: string) => Promise<GroundAddResult>;
  /**
   * Add a reference from a pasted video address (story 16.15): the sidecar
   * reads its oEmbed look once and the card keeps the title and a local
   * thumbnail. A refusal is one sentence and nothing is created.
   */
  onAddVideo?: (name: string, url: string) => Promise<GroundAddResult>;
  /**
   * STORY 18.3 — make a SESSION CARD at this point, bound to one tool row. The
   * row is named by id (`turn/acpSpecs.ts`), never by a key or a command, and a
   * card that has never run writes no transcript. Optional so a render test (and
   * an older caller) needs no run.
   */
  onAddSession?: (name: string, tool: string) => Promise<GroundAddResult>;
  /**
   * STORY 22.1 — each tool row's per-machine fact (PROVISIONAL), laid over the
   * shipped rows here so this picker's "unverified" mark matches the session
   * card's: it disappears only when a test on this machine passed. Absent (a
   * render test) means every row reads untested here.
   */
  toolRowFacts?: readonly AcpRowFact[];
  /** Drop the draft (Esc, cancel or a press outside). */
  onClose: () => void;
}

export function GroundBubble({
  x,
  y,
  initialIntent = "file",
  onAddAsk,
  onAdd,
  onAddFolder,
  onAddPage,
  onAddVideo,
  onAddSession,
  toolRowFacts = [],
  onClose,
}: GroundBubbleProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  // STORY 16.15: the INTENT is the person's choice and it chooses the
  // extractor. Nothing here looks at a file's bytes or guesses a host's kind.
  // STORY 17.10: the bubble can ARRIVE on a door the person already chose in
  // the double-click's bubble; its own intent row stays editable from there.
  const [intent, setIntent] = useState<GroundIntent>(initialIntent);
  const [from, setFrom] = useState<string | null>(null);
  // A pasted address is kept VERBATIM: it is handed to the app exactly as
  // given, and the sidecar's own guard decides whether it can be taken.
  const [url, setUrl] = useState("");
  // STORY 18.3 — the TOOL ROW a new session card binds, by id. PROVISIONAL:
  // the first shipped row is the preselection, and the row's own name is
  // proposed as the card's name (the person edits or accepts it).
  const [tool, setTool] = useState(ACP_SPECS[0]?.id ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const doneRef = useRef(false);
  // The dialog is native and modal: while it is open, no DOM press can reach
  // the click-away listener, so the bubble never closes under the dialog.
  const pickingRef = useRef(false);

  // Opening moves focus into the name field (the coin field's idiom).
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // STORY 17.10 — the SESSION door arrives from the bubble already chosen, so
  // the row's name is PROPOSED here exactly as choosing the door inside this
  // form did before. A reference door simply starts with its own intent.
  useEffect(() => {
    if (initialIntent !== "session") return;
    const row = ACP_SPECS.find((spec) => spec.id === tool);
    if (row !== undefined) setName(proposeSessionName(row.name));
    // Mount only: the person's own draft always wins after this.
  }, []);

  // The press must not pan the plane or start a word gesture.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    return () => el.removeEventListener("mousedown", stop);
  }, []);

  // A press outside drops the draft. It is captured early because d3-zoom
  // stops the plane's press at the plane, and a bubble-phase listener would
  // never hear an outside press.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (pickingRef.current) return;
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      close();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  });

  function close() {
    if (doneRef.current || pickingRef.current) return;
    doneRef.current = true;
    onClose();
  }

  async function commit(chosen: string) {
    if (doneRef.current || busy) return;
    // A PROJECT CARD goes through its own writer: the same flow, with a folder
    // pointer and no reading taken. A bubble without that door cannot commit it.
    const add = intent === "folder" ? onAddFolder : onAdd;
    if (add === undefined) return;
    // STORY 24-16 (the person, 2026-11-25): a name is OPTIONAL. A blank field
    // names the card from the world's own words — the file's (or folder's)
    // stem — exactly as dropping a file onto the map always has (dropCardName).
    const trimmed = name.trim();
    const named = trimmed === "" ? dropCardName(chosen) : trimmed;
    setBusy(true);
    setProblem(null);
    const result = await add(named, chosen);
    if (result.ok) {
      doneRef.current = true;
      onClose();
      return;
    }
    setBusy(false);
    setProblem(result.message);
    nameRef.current?.focus();
  }

  /** Commit a pasted address through the intent's own door. */
  async function commitAddress() {
    if (doneRef.current || busy) return;
    const add = intent === "video" ? onAddVideo : onAddPage;
    if (add === undefined) return;
    // STORY 24-16: a blank name is named from the address's own words
    // (webLinkName — the same rule a pasted link has always used).
    const trimmed = name.trim();
    const named = trimmed === "" ? webLinkName(url) : trimmed;
    if (url.trim() === "") {
      setProblem(
        intent === "video"
          ? "paste a video's address first."
          : "paste a web page's address first.",
      );
      return;
    }
    setBusy(true);
    setProblem(null);
    // STORED VERBATIM: the address is never trimmed, normalized or repaired.
    const result = await add(named, url);
    if (result.ok) {
      doneRef.current = true;
      onClose();
      return;
    }
    setBusy(false);
    setProblem(result.message);
  }

  /**
   * STORY 18.3 — commit a SESSION CARD: the name is the person's and the row is
   * the picker's. Nothing is run here and no transcript is made — a card that
   * has never run has nothing to say, and the run is the card's own press.
   */
  async function commitSession() {
    if (doneRef.current || busy || onAddSession === undefined) return;
    // STORY 24-16: a blank name takes the tool row's own proposed name — the
    // words the picker already put in the field (proposeSessionName).
    const trimmed = name.trim();
    const named = trimmed === "" ? proposeSessionName(tool) : trimmed;
    if (tool === "") {
      setProblem(SESSION_TOOL_REFUSAL);
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await onAddSession(named, tool);
    if (result.ok) {
      doneRef.current = true;
      onClose();
      return;
    }
    setBusy(false);
    setProblem(result.message);
    nameRef.current?.focus();
  }

  /**
   * STORY 21.13 — commit an ASK CARD: the person's name and nothing else. The
   * card is born EMPTY (the ask's own creation path writes one record line; a
   * conversation only exists once something was asked), so this press makes no
   * turn, starts no send and writes no conversation file. STORY 24-16 (the
   * person, 2026-11-25): a blank name is legal — it becomes the family's
   * "Untitled ask" sentinel, which the card's first question renames (17.10).
   */
  async function commitAsk() {
    if (doneRef.current || busy || onAddAsk === undefined) return;
    setBusy(true);
    setProblem(null);
    const result = await onAddAsk(askNameForCreate(name));
    if (result.ok) {
      doneRef.current = true;
      onClose();
      return;
    }
    setBusy(false);
    setProblem(result.message);
    nameRef.current?.focus();
  }

  async function chooseFile() {
    if (doneRef.current || busy || intent !== "file") return;
    // STORY 24-16: no name needed — the pick is the commit, and a blank field
    // is named from the file's own name (see commit).
    pickingRef.current = true;
    setProblem(null);
    let picked: string | null = null;
    try {
      picked = await pickReadingFile("pick a file");
    } finally {
      pickingRef.current = false;
    }
    if (picked === null) return;
    setFrom(picked);
    // The pick is the commit once the name is there (the story's order).
    await commit(picked);
  }

  /**
   * PROVISIONAL — the FOLDER pick for a project card. The OS dialog chooses a
   * directory; the handed path is stored exactly as given and nothing inside
   * it is opened. The picking flag keeps the native dialog from closing the
   * bubble under itself, exactly as the file door does.
   */
  async function chooseFolder() {
    if (doneRef.current || busy || intent !== "folder") return;
    if (onAddFolder === undefined) return;
    // STORY 24-16: no name needed — the pick is the commit, and a blank field
    // is named from the folder's own name (see commit).
    pickingRef.current = true;
    setProblem(null);
    let picked: string | null = null;
    try {
      picked = await pickFolder("pick a folder");
    } finally {
      pickingRef.current = false;
    }
    if (picked === null) return;
    setFrom(picked);
    // The pick is the commit once the name is there, as with a file.
    await commit(picked);
  }

  /** The intent row never loses a draft: it only changes which door is shown. */
  function chooseIntent(next: GroundIntent) {
    if (busy) return;
    // A picked source belongs to the door it was picked for: leaving the FILE
    // or FOLDER door drops it, so a file path can never be committed as a
    // project card (or the reverse) after a refused or reconsidered pick.
    if (next !== intent) setFrom(null);
    setIntent(next);
    setProblem(null);
    // STORY 18.3: choosing a session PROPOSES the row's name as the card's, so
    // the person edits or accepts rather than typing from nothing (the ask
    // card's idiom). A draft already typed is never overwritten.
    if (next === "session" && name.trim() === "" && tool !== "") {
      const row = ACP_SPECS.find((spec) => spec.id === tool);
      if (row !== undefined) setName(proposeSessionName(row.name));
    }
    nameRef.current?.focus();
  }

  // STORY 21.13: an ask needs no source beyond its name — the card is empty by
  // design, and the name is the whole of what the person has to supply.
  const hasSource =
    intent === "ask"
      ? true
      : intent === "session"
        ? tool !== ""
        : intent === "file" || intent === "folder"
          ? from !== null
          : url.trim() !== "";
  const canAdd = !busy && name.trim() !== "" && hasSource;
  const addressIntent = intent === "page" || intent === "video";
  // STORY 22.1 — THE ROWS THIS PICKER OFFERS ARE THE ROWS THIS MACHINE KNOWS:
  // the shipped data with the per-machine fact laid over it, so a row tested
  // here loses its "unverified" mark exactly as it does on a session card.
  const rowChoices = ACP_SPECS.map((spec) => rowWithFacts(spec, toolRowFacts));

  return (
    <div
      ref={rootRef}
      className="ground-bubble ground-popover"
      role="group"
      aria-label="add a ground reference"
      style={{
        left: x,
        top: y,
        transform: `scale(${counterScale(camera.zoom)})`,
        transformOrigin: "left top",
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        e.stopPropagation();
        close();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      {/* The title names what the person is about to make: a reference by
          default, a session when that door is open (story 18.3), an ask when
          story 21.13's door is the one chosen. */}
      <div className="ground-bubble-title">
        {intent === "ask"
          ? "ask"
          : intent === "session"
            ? "session"
            : "reference"}
      </div>
      <div className="ground-bubble-intents" role="group" aria-label="what to add">
        {INTENTS.map((option) => {
          // A door this app was not handed is not offered: the bubble is also
          // mounted by tests with fewer ways in.
          const offered =
            option.intent === "file"
              ? true
              : option.intent === "folder"
                ? onAddFolder !== undefined
                : option.intent === "page"
                  ? onAddPage !== undefined
                  : option.intent === "video"
                    ? onAddVideo !== undefined
                    : option.intent === "ask"
                      ? onAddAsk !== undefined
                      : onAddSession !== undefined;
          if (!offered) return null;
          return (
            <button
              key={option.intent}
              type="button"
              className={
                intent === option.intent
                  ? "ground-bubble-intent active"
                  : "ground-bubble-intent"
              }
              aria-pressed={intent === option.intent}
              disabled={busy}
              onClick={() => chooseIntent(option.intent)}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      <input
        ref={nameRef}
        className="ground-bubble-name"
        value={name}
        placeholder="name it…"
        aria-label={
          intent === "ask"
            ? "name the ask card"
            : intent === "session"
              ? "name the session card"
              : "name the reference"
        }
        disabled={busy}
        onChange={(e) => {
          setName(e.target.value);
          if (problem !== null) setProblem(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (intent === "ask") void commitAsk();
          else if (intent === "session") void commitSession();
          else if (addressIntent) void commitAddress();
          else if (from !== null) void commit(from);
          else if (intent === "folder") void chooseFolder();
          else void chooseFile();
        }}
      />
      {intent === "ask" ? null : intent === "session" ? (
        /* STORY 18.3 — THE TOOL ROW. Only the rows this build ships are
           offered; the record names the row's id, and its key (if it ever
           declares one) is read at run time and never kept here. STORY 18.6
           lists EVERY row and marks the unverified ones from the data: this
           file never learns a product's name. */
        <div className="ground-bubble-session">
          <select
            className="ground-bubble-tool"
            aria-label="the tool this session runs"
            value={tool}
            disabled={busy}
            onChange={(e) => {
              setTool(e.target.value);
              if (problem !== null) setProblem(null);
            }}
          >
            {rowChoices.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {acpRowLabel(spec)}
              </option>
            ))}
          </select>
        </div>
      ) : intent === "file" || intent === "folder" ? (
        <div className="ground-bubble-file">
          {from === null
            ? intent === "folder"
              ? "no folder yet"
              : "no file yet"
            : readingFileName(from)}
        </div>
      ) : (
        <input
          className="ground-bubble-url"
          value={url}
          placeholder={
            intent === "video"
              ? "paste a video's address…"
              : "paste a web address…"
          }
          aria-label={
            intent === "video"
              ? "paste a video's address"
              : "paste a web page's address"
          }
          disabled={busy}
          onChange={(e) => {
            setUrl(e.target.value);
            if (problem !== null) setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void commitAddress();
          }}
        />
      )}
      {problem !== null && (
        <div className="ground-bubble-problem" role="status">
          {problem}
        </div>
      )}
      <div className="ground-bubble-actions">
        {(intent === "file" || intent === "folder") && (
          <button
            type="button"
            className="ground-bubble-pick"
            disabled={busy}
            onClick={() =>
              void (intent === "folder" ? chooseFolder() : chooseFile())
            }
          >
            {from === null
              ? intent === "folder"
                ? "choose a folder…"
                : "choose a file…"
              : "choose another…"}
          </button>
        )}
        <button
          type="button"
          className="ground-bubble-add"
          disabled={!canAdd}
          onClick={() => {
            if (intent === "ask") {
              void commitAsk();
              return;
            }
            if (intent === "session") {
              void commitSession();
              return;
            }
            if (addressIntent) {
              void commitAddress();
              return;
            }
            if (from !== null) void commit(from);
          }}
        >
          add
        </button>
        <button
          type="button"
          className="ground-bubble-cancel"
          disabled={busy}
          onClick={close}
        >
          cancel
        </button>
      </div>
    </div>
  );
}
