import { useEffect, useRef, useState } from "react";
import {
  MAKE_BUTTON,
  MAKE_NEEDS_NAME,
  MAKE_PATH_LABEL,
  MAKE_PATH_PLACEHOLDER,
  MAKE_TEXT_LABEL,
  MAKE_TEXT_PLACEHOLDER,
  MAKE_TITLE,
} from "./contactRules";

interface MakePanelProps {
  /** The word's coined NAME (aria and header; the slug stays in the record). */
  name: string;
  /** A quiet sentence for a refusal or a failure (null otherwise). */
  note: string | null;
  /** The Move is writing; the button waits. */
  busy: boolean;
  /** Make the artifact: the path the person named and the text they wrote. */
  onMake: (path: string, text: string) => void;
  /** Esc or the ×: nothing is written (typed prose is not thrown away). */
  onClose: () => void;
}

/**
 * THE MAKE PANEL (Epic 12 story 3, PROVISIONAL and deliberately plain) — the
 * person's own contact write, in one Move: name the artifact (a workspace
 * path), write the text, press make.
 *
 * There is NO accept gate here, and that is the design: the person IS the
 * acceptor of their own Make (ADR-0028 decision 1). The panel is not a
 * proposal, a draft to approve or a pending write — pressing make calls the
 * Move, which mints the pointer, writes the raw text and logs the PRISM. An
 * AGENT's Make is a ghost (a proposal in the ghost channel), never this.
 *
 * The text field is the person's prose, VERBATIM: the panel does not trim,
 * normalize or preview a canonical form, because the raw writer will not
 * either. The path field is the artifact's name as the person writes it (the
 * record stores it verbatim, workspace-relative).
 *
 * It sits OUTSIDE `.plane` (the ghost panel's neighbour), so the plane's
 * armed gate never reaches it: no world-space anchoring, no camera scaling.
 * Esc or the × closes it; a press away does NOT, because the panel can hold
 * typed prose (the ghost panel's rule).
 *
 * Provisional: the look, the anchoring (a fixed panel, not a world card) and
 * the single-step flow (no preview of the artifact before it is written).
 */
export function MakePanel({ name, note, busy, onMake, onClose }: MakePanelProps) {
  const [path, setPath] = useState("");
  const [text, setText] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  function submit() {
    if (busy) return;
    if (path.trim() === "") return;
    onMake(path, text);
  }

  return (
    <div
      ref={rootRef}
      className="make-panel"
      role="group"
      aria-label={"make an artifact on “" + name + "”"}
    >
      <div className="make-head">
        <span className="make-title">{MAKE_TITLE}</span>
        <button
          type="button"
          className="make-close"
          aria-label="close the make panel"
          title="close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>

      <div className="make-word">{name}</div>

      <input
        className="make-path"
        value={path}
        aria-label={MAKE_PATH_LABEL}
        placeholder={MAKE_PATH_PLACEHOLDER}
        onChange={(e) => setPath(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          submit();
        }}
      />

      <textarea
        className="make-text"
        value={text}
        rows={6}
        aria-label={MAKE_TEXT_LABEL}
        placeholder={MAKE_TEXT_PLACEHOLDER}
        onChange={(e) => setText(e.target.value)}
      />

      <div className="make-actions">
        <button
          type="button"
          className="make-go"
          disabled={busy || path.trim() === ""}
          title={path.trim() === "" ? MAKE_NEEDS_NAME : MAKE_BUTTON}
          onClick={(e) => {
            e.stopPropagation();
            submit();
          }}
        >
          {MAKE_BUTTON}
        </button>
      </div>

      {note !== null && <div className="make-note">{note}</div>}
    </div>
  );
}
