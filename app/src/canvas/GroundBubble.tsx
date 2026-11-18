import { useEffect, useRef, useState } from "react";
import { readingFileName } from "../map/readings";
import { pickReadingFile } from "../workspace/dialogs";
import { usePlane } from "./CanvasPlane";
import type { GroundAddResult } from "./useGround";
import { counterScale } from "./veilRules";

/**
 * The ground map's creation affordance (story 16.1): double-click empty paper,
 * type a name, pick a file — done. (Story 16.4: that file may be a PDF, read on
 * device; the pick's name decides which extractor runs.)
 *
 * This is NOT the concept map's word bubble and NOT a `CreationKind`
 * (`wordCreationOffered` stays concept-only): the noun is the ground map's
 * own, a REFERENCE, and its second half is a file the person picks in the OS
 * dialog, not a word coined on the concept map. Keeping it a separate
 * component is what lets the ground map grow its own face without reviving
 * the concept bubble's grammar.
 *
 * The order is the story's order: a name is asked for FIRST, then the picker.
 * Once both are there, the pick IS the commit (the check's "type a name, pick
 * a file, its lines appear"); the add button stays for the other order. A
 * refused file — absent, binary, unreadable, too large, or a PDF with no text
 * layer (story 16.4) — shows ONE quiet sentence and writes nothing: the
 * reference is not created half-formed. Esc, cancel or a press outside drops
 * the draft; nothing was written.
 *
 * It hangs in WORLD space at the double-clicked point and counter-scales
 * against the camera (the naming popup's idiom), and its classes are on the
 * gate's content lists plus a raw mousedown stop, so its presses never pan the
 * plane, start a word gesture or count as another double-click.
 *
 * PROVISIONAL: the card's size, wording and the "name it first." sentence
 * (ADR-0003's rendering seam and the story's record shapes).
 */
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
  /** Drop the draft (Esc, cancel or a press outside). */
  onClose: () => void;
}

export function GroundBubble({
  x,
  y,
  onAdd,
  onAddPage,
  onClose,
}: GroundBubbleProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [from, setFrom] = useState<string | null>(null);
  // STORY 16.14: a pasted address is the OTHER way to name a source. It is
  // kept verbatim in the draft and read by the app exactly as given.
  const [url, setUrl] = useState("");
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

  async function commitPage() {
    if (doneRef.current || busy || onAddPage === undefined) return;
    const trimmed = name.trim();
    if (trimmed === "") {
      setProblem("name it first.");
      nameRef.current?.focus();
      return;
    }
    // STORED VERBATIM: the address is never trimmed, normalized or repaired.
    // The emptiness check is the only place whitespace is looked at.
    const address = url;
    if (address.trim() === "") {
      setProblem("paste a web page's address first.");
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await onAddPage(trimmed, address);
    if (result.ok) {
      doneRef.current = true;
      onClose();
      return;
    }
    setBusy(false);
    setProblem(result.message);
  }

  async function chooseFile() {
    if (doneRef.current || busy) return;
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
    setUrl("");
    setFrom(picked);
    // The pick is the commit once the name is there (the story's order).
    await commit(picked);
  }

  const canAdd = !busy && name.trim() !== "" && from !== null;

  return (
    <div
      ref={rootRef}
      className="ground-bubble"
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
      <div className="ground-bubble-title">reference</div>
      <input
        ref={nameRef}
        className="ground-bubble-name"
        value={name}
        placeholder="name it…"
        aria-label="name the reference"
        disabled={busy}
        onChange={(e) => {
          setName(e.target.value);
          if (problem !== null) setProblem(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          if (url.trim() !== "" && onAddPage !== undefined) void commitPage();
          else if (from !== null) void commit(from);
          else void chooseFile();
        }}
      />
      <div className="ground-bubble-file">
        {from === null ? "no file yet" : readingFileName(from)}
      </div>
      {/* STORY 16.14: paste a web address instead of picking a file. The
          address is handed VERBATIM to the app; it is never normalized here. */}
      {onAddPage !== undefined && (
        <input
          className="ground-bubble-url"
          value={url}
          placeholder="or paste a web address…"
          aria-label="paste a web page's address"
          disabled={busy}
          onChange={(e) => {
            setUrl(e.target.value);
            if (problem !== null) setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void commitPage();
          }}
        />
      )}
      {problem !== null && (
        <div className="ground-bubble-problem" role="status">
          {problem}
        </div>
      )}
      <div className="ground-bubble-actions">
        <button
          type="button"
          className="ground-bubble-pick"
          disabled={busy}
          onClick={() => void chooseFile()}
        >
          {from === null ? "choose a file…" : "choose another…"}
        </button>
        <button
          type="button"
          className="ground-bubble-add"
          disabled={!canAdd && !(url.trim() !== "" && name.trim() !== "")}
          onClick={() => {
            if (url.trim() !== "" && onAddPage !== undefined) {
              void commitPage();
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
