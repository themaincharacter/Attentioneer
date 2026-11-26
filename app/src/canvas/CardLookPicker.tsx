import { useState } from "react";
import {
  isLookTint,
  LOOK_FRAMES,
  LOOK_TINTS,
  type CardLook,
  type LookFrame,
} from "../map/looks";

/**
 * STORY 25-17 (ADR-0047's deferred want) — THE CARD'S LOOK PICKER: the gear
 * key opens it and the person's choice is written to the card's own look line.
 * The frame overrides the state's edge; the tint is the card's quiet colour.
 * The honest sentences beside any frame are untouched: a look is a look.
 * PROVISIONAL: the swatches' order and the wording.
 */
export function CardLookPicker({
  look,
  onSet,
  onClose,
}: {
  look: CardLook;
  onSet: (look: CardLook) => void;
  onClose: () => void;
}) {
  const [free, setFree] = useState(look.tint ?? "#b8933f");

  const frame = (choice: LookFrame) => (
    <button
      key={choice}
      type="button"
      className={
        (look.frame ?? "default") === choice
          ? "look-choice look-choice-on"
          : "look-choice"
      }
      onClick={() => onSet({ ...look, frame: choice })}
    >
      {choice}
    </button>
  );

  return (
    <div className="look-picker" role="group" aria-label="this card's look">
      <div className="look-row">
        <span className="look-label">frame</span>
        {LOOK_FRAMES.map(frame)}
      </div>
      <div className="look-row">
        <span className="look-label">colour</span>
        {LOOK_TINTS.map((tint) => (
          <button
            key={tint === "" ? "none" : tint}
            type="button"
            className={
              (look.tint ?? "") === tint
                ? "look-swatch look-swatch-on"
                : "look-swatch"
            }
            aria-label={tint === "" ? "no tint" : tint}
            style={tint === "" ? undefined : { background: tint }}
            onClick={() => onSet({ ...look, tint })}
          />
        ))}
        <input
          type="color"
          className="look-free"
          aria-label="a colour of your own"
          value={isLookTint(free) ? free : "#b8933f"}
          onChange={(event) => {
            setFree(event.target.value);
            onSet({ ...look, tint: event.target.value });
          }}
        />
      </div>
      <button type="button" className="look-done" onClick={onClose}>
        done
      </button>
    </div>
  );
}
