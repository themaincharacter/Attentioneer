import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import {
  GAME_CANCEL_LABEL,
  GAME_NAME_LABEL,
  GAME_NAME_PLACEHOLDER,
  GAME_POPUP_TITLE,
  GAME_PROBLEM_TEXT,
  GAME_SUBMIT_LABEL,
  submitProblem,
  type SubmitProblem,
} from "./languageGameRules";
import { usePlane } from "./CanvasPlane";
import { counterScale } from "./veilRules";

/**
 * The naming popup a completed selection opens (PROVISIONAL, added 2026-11-16
 * per the lead's brief): the small card titled "language game" with one name
 * field and submit / cancel.
 *
 * It hangs in WORLD space at the drawn shape's top-left corner and
 * counter-scales against the camera (the veil coin field's idiom), so it stays
 * readable at every zoom and never grows anything on the plane. The fill is
 * already painted behind it: that tint IS the selection being named. CANCEL
 * drops the draft entirely — the fill goes, nothing is written. SUBMIT is the
 * only write, and the app asks this card's pure rules first (an invalid name
 * or an empty region writes nothing at all).
 *
 * The refusal is ONE quiet sentence in the card (never a tally): the pure rule
 * names the problem, the card says it plainly. It clears as soon as the person
 * types again. Esc cancels, Enter submits. The press must not pan the plane or
 * start a word gesture — the classes are on the gate's content lists and the
 * raw mousedown stop is the veil coin field's lesson.
 */
interface LanguageGamePopupProps {
  /** The drawn shape's top-left corner, in world space. */
  anchor: { x: number; y: number };
  /** Names already coined (the uniqueness rule's reading). */
  existingNames: readonly string[];
  /** Does the drawn region hold at least one word of the map? */
  hasWords: boolean;
  /** Save the game under this name (the one write). */
  onSubmit: (name: string) => void;
  /** Drop the selection: the draft fill goes, nothing is written. */
  onCancel: () => void;
}

export function LanguageGamePopup({
  anchor,
  existingNames,
  hasWords,
  onSubmit,
  onCancel,
}: LanguageGamePopupProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<Exclude<SubmitProblem, null> | null>(
    null,
  );
  const doneRef = useRef(false);

  // Opening moves focus into the field (the coin field's idiom).
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

  function commit() {
    if (doneRef.current) return;
    const next = submitProblem(name, existingNames, hasWords);
    if (next !== null) {
      setProblem(next);
      nameRef.current?.focus();
      return;
    }
    doneRef.current = true;
    onSubmit(name.trim());
  }

  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      cancel();
    }
  }

  return (
    <div
      ref={rootRef}
      className="language-game-popup"
      role="group"
      aria-label={GAME_POPUP_TITLE}
      style={{
        left: anchor.x,
        top: anchor.y,
        transform: `scale(${counterScale(camera.zoom)})`,
        transformOrigin: "left top",
      }}
      onKeyDown={handleKeyDown}
      onDoubleClick={(e) => e.stopPropagation()}
    >
      <div className="language-game-popup-title">{GAME_POPUP_TITLE}</div>
      <input
        ref={nameRef}
        className="language-game-name"
        value={name}
        placeholder={GAME_NAME_PLACEHOLDER}
        aria-label={GAME_NAME_LABEL}
        onChange={(e) => {
          setName(e.target.value);
          if (problem !== null) setProblem(null);
        }}
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          e.preventDefault();
          commit();
        }}
      />
      {problem !== null && (
        <div className="language-game-problem" role="status">
          {GAME_PROBLEM_TEXT[problem]}
        </div>
      )}
      <div className="language-game-actions">
        <button
          type="button"
          className="language-game-submit"
          onClick={commit}
        >
          {GAME_SUBMIT_LABEL}
        </button>
        <button
          type="button"
          className="language-game-cancel"
          onClick={cancel}
        >
          {GAME_CANCEL_LABEL}
        </button>
      </div>
    </div>
  );
}
