import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { SIGNS, type LinkSign } from "../map/links";
import { usePlane } from "./CanvasPlane";
import type { Point } from "./geometry";
import { signChoiceOutcome } from "./signChoiceRules";

interface SignChoiceProps {
  /** World centre of the origin word (the choice sits at the pair's midpoint). */
  fromCenter: Point;
  /** World centre of the target word. */
  toCenter: Point;
  /** An explicit pick: author the link with this sign. */
  onPick: (sign: LinkSign) => void;
  /** Discard the pending link — nothing is written (Esc, Enter with no pick). */
  onDiscard: () => void;
}

/**
 * The Level 2 sign choice (story 2, ADR-0016 decision 3): the connect-handle
 * drag has fixed a pair, and this quiet cluster asks for the one thing the
 * software must never guess — the sign. It opens in place of the distance coin
 * field, at the pair's midpoint, with NO default selection: pressing Enter with
 * nothing chosen discards, Esc discards, and only a press on + or - authors the
 * link. A mouse press on a sign is the pick; the keyboard reaches the same
 * buttons (Tab then Enter/Space) because they are real buttons.
 *
 * The pending choice arms the interaction-mode gate's `sign-choice` mode
 * (gates.ts), so a word press, the plane's pan and creation all stand still and
 * the double-click creation menu cannot open behind it.
 *
 * Provisional: the look, the placement and the glyphs (ADR-0003/0016).
 */
export function SignChoice({
  fromCenter,
  toCenter,
  onPick,
  onDiscard,
}: SignChoiceProps) {
  const { camera } = usePlane();
  const rootRef = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<LinkSign | null>(null);
  const doneRef = useRef(false);

  // Focus the cluster (not a sign): Enter with nothing chosen must discard.
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  // The press must not pan the plane (d3-zoom) or count as a plane press.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const stop = (e: MouseEvent) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    el.addEventListener("dblclick", stop);
    return () => {
      el.removeEventListener("mousedown", stop);
      el.removeEventListener("dblclick", stop);
    };
  }, []);

  function finish(outcome: LinkSign | null) {
    if (doneRef.current) return;
    doneRef.current = true;
    if (outcome) onPick(outcome);
    else onDiscard();
  }

  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key !== "Enter" && e.key !== "Escape") return;
    e.preventDefault();
    finish(signChoiceOutcome(chosen, e.key));
  }

  const mx = (fromCenter.x + toCenter.x) / 2;
  const my = (fromCenter.y + toCenter.y) / 2;

  return (
    <div
      ref={rootRef}
      className="sign-choice"
      style={{
        left: mx,
        top: my,
        // Counter-scale against the camera so the choice stays readable at
        // every zoom (the plane menu's idiom).
        transform: `translate(-50%, -50%) scale(${1 / camera.zoom})`,
      }}
      role="group"
      aria-label="choose the link's sign"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        finish(null);
      }}
    >
      <span className="sign-choice-hint" aria-hidden="true">
        sign
      </span>
      {SIGNS.map((sign) => (
        <button
          key={sign}
          type="button"
          className="sign-choice-option"
          data-sign={sign}
          aria-label={sign === "+" ? "same direction" : "opposite direction"}
          title={sign === "+" ? "+ — the pair moves together" : "- — the pair moves opposite"}
          onFocus={() => setChosen(sign)}
          onMouseEnter={() => setChosen(sign)}
          onClick={(e) => {
            e.stopPropagation();
            finish(sign);
          }}
        >
          {sign}
        </button>
      ))}
    </div>
  );
}
