import { useEffect, useRef, useState } from "react";
import { readingFileName } from "../map/readings";
import {
  SESSION_NAME_REFUSAL,
  SESSION_TOOL_REFUSAL,
  proposeSessionName,
} from "../map/sessions";
import { ACP_SPECS, acpRowLabel } from "../turn/acpSpecs";
import { pickReadingFile } from "../workspace/dialogs";
import { usePlane } from "./CanvasPlane";
import type { GroundAddResult } from "./useGround";
import { counterScale } from "./veilRules";

/**
 * The ground map's creation affordance (story 16.1): double-click empty paper,
 * type a name, choose a source — done. (Story 16.4: that source may be a PDF,
 * read on device. Story 16.15: it may also be an IMAGE, drawn in place, or a
 * VIDEO, whose title and thumbnail are copied beside the map.)
 *
 * THE THREE INTENTS (story 16.15): a FILE (text, PDF or image, by the pick's
 * name), a PAGE (a pasted web address) or a VIDEO (a pasted address on a host
 * this app knows). The INTENT chooses the extractor — the file's own bytes are
 * never sniffed, and a file that is neither text, PDF nor a known image type
 * refuses with one sentence. The choice is the person's, not the app's guess.
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
 * STORY 17 (shortlist item 8): the bubble carries `ground-popover`, the
 * second, smaller prose scale, so the creation surface reads as its own small
 * popover instead of a shrunken card. Its title stays the quiet meta label.
 *
 * PROVISIONAL: the card's size, the intent row's look, the wording of the
 * sentences and the "name it first." rule (ADR-0003's rendering seam and the
 * story's record shapes).
 */

/** What the person means to point the reference at (story 16.15). */
export type GroundIntent = "file" | "page" | "video" | "session";

/** The intent row's words, in order. PROVISIONAL. */
const INTENTS: readonly { intent: GroundIntent; label: string }[] = [
  { intent: "file", label: "a file" },
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
  /** Add the reference (the app's one write path); a refusal is a sentence. */
  onAdd: (name: string, from: string) => Promise<GroundAddResult>;
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
  /** Drop the draft (Esc, cancel or a press outside). */
  onClose: () => void;
}

export function GroundBubble({
  x,
  y,
  onAdd,
  onAddPage,
  onAddVideo,
  onAddSession,
  onClose,
}: GroundBubbleProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  // STORY 16.15: the INTENT is the person's choice and it chooses the
  // extractor. Nothing here looks at a file's bytes or guesses a host's kind.
  const [intent, setIntent] = useState<GroundIntent>("file");
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
    const trimmed = name.trim();
    if (trimmed === "") {
      setProblem("name it first.");
      nameRef.current?.focus();
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await onAdd(trimmed, chosen);
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
    const trimmed = name.trim();
    if (trimmed === "") {
      setProblem("name it first.");
      nameRef.current?.focus();
      return;
    }
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
    const result = await add(trimmed, url);
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
    const trimmed = name.trim();
    if (trimmed === "") {
      setProblem(SESSION_NAME_REFUSAL);
      nameRef.current?.focus();
      return;
    }
    if (tool === "") {
      setProblem(SESSION_TOOL_REFUSAL);
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await onAddSession(trimmed, tool);
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
    if (name.trim() === "") {
      setProblem("name it first.");
      nameRef.current?.focus();
      return;
    }
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

  /** The intent row never loses a draft: it only changes which door is shown. */
  function chooseIntent(next: GroundIntent) {
    if (busy) return;
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

  const hasSource =
    intent === "session"
      ? tool !== ""
      : intent === "file"
        ? from !== null
        : url.trim() !== "";
  const canAdd = !busy && name.trim() !== "" && hasSource;
  const addressIntent = intent === "page" || intent === "video";

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
          default, a session when the third door is open (story 18.3). */}
      <div className="ground-bubble-title">
        {intent === "session" ? "session" : "reference"}
      </div>
      <div className="ground-bubble-intents" role="group" aria-label="what to add">
        {INTENTS.map((option) => {
          // A door this app was not handed is not offered: the bubble is also
          // mounted by tests with fewer ways in.
          const offered =
            option.intent === "file"
              ? true
              : option.intent === "page"
                ? onAddPage !== undefined
                : option.intent === "video"
                  ? onAddVideo !== undefined
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
          intent === "session" ? "name the session card" : "name the reference"
        }
        disabled={busy}
        onChange={(e) => {
          setName(e.target.value);
          if (problem !== null) setProblem(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (intent === "session") void commitSession();
          else if (addressIntent) void commitAddress();
          else if (from !== null) void commit(from);
          else void chooseFile();
        }}
      />
      {intent === "session" ? (
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
            {ACP_SPECS.map((spec) => (
              <option key={spec.id} value={spec.id}>
                {acpRowLabel(spec)}
              </option>
            ))}
          </select>
        </div>
      ) : intent === "file" ? (
        <div className="ground-bubble-file">
          {from === null ? "no file yet" : readingFileName(from)}
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
        {intent === "file" && (
          <button
            type="button"
            className="ground-bubble-pick"
            disabled={busy}
            onClick={() => void chooseFile()}
          >
            {from === null ? "choose a file…" : "choose another…"}
          </button>
        )}
        <button
          type="button"
          className="ground-bubble-add"
          disabled={!canAdd}
          onClick={() => {
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
