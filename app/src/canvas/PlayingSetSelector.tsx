import { useEffect } from "react";
import type { Box, Point } from "./geometry";

/**
 * The playing-set selector (ADR-0013, story 1): the door to a dynamics model.
 * It opens pre-filled — every current word on first entry, the accepted set on
 * a re-run — and the person keeps or leaves out words:
 *
 * - "all" keeps every word (shelved words included; the shelf is a place, not
 *   an exclusion);
 * - the draw tool lassos words on the plane (words only, never wires — the
 *   magic circle arrives early, relationships stay Epic 7's);
 * - clicking a word excludes or includes it. The excluded marker is a dashed
 *   hollow ring at the word's corner — quiet, and never the remove × glyph;
 * - "accept" writes map/model.json and closes. Re-running rewrites it: no
 *   history, no confirmation (ADR-0007's door);
 * - "close" (or Esc) writes nothing.
 *
 * While the selector is open the interaction-mode gate arms: word presses,
 * pan and creation suspend, and the words layer below is the only live
 * content. Provisional: the look and the glyphs (ADR-0003/0016).
 */

/** A word as the selector sees it: its slug, name, top-left position and box. */
export interface SelectorWord {
  slug: string;
  name: string;
  pos: Point;
  box: Box;
}

interface PlayingSetWordsProps {
  words: readonly SelectorWord[];
  selected: ReadonlySet<string>;
  onToggle: (slug: string) => void;
}

/**
 * The selector's world-space layer, inside .plane-inner: one quiet button
 * over each word, matching its measured box. A press here is content, never a
 * plane gesture (gates.ts); the button is transparent so the word itself reads
 * through, and an excluded word sits behind a pale wash with its dashed ring.
 */
export function PlayingSetWords({
  words,
  selected,
  onToggle,
}: PlayingSetWordsProps) {
  return (
    <div className="playing-set" role="group" aria-label="the playing set">
      {words.map((word) => {
        const inPlay = selected.has(word.slug);
        return (
          <button
            key={word.slug}
            type="button"
            className={`playing-set-word${inPlay ? "" : " out"}`}
            style={{
              transform: `translate3d(${word.pos.x}px, ${word.pos.y}px, 0)`,
              width: word.box.w,
              height: word.box.h,
            }}
            aria-pressed={inPlay}
            aria-label={`${inPlay ? "leave out" : "include"} “${word.name}”`}
            title={inPlay ? "click to leave this word out" : "click to include this word"}
            onClick={() => onToggle(word.slug)}
          />
        );
      })}
    </div>
  );
}

interface PlayingSetBarProps {
  lassoArmed: boolean;
  onToggleLasso: () => void;
  onSelectAll: () => void;
  onAccept: () => void;
  onClose: () => void;
}

/**
 * The selector's controls, fixed in screen space so they stay readable at any
 * zoom. Quiet buttons on one frosted strip; Esc closes without writing.
 */
export function PlayingSetBar({
  lassoArmed,
  onToggleLasso,
  onSelectAll,
  onAccept,
  onClose,
}: PlayingSetBarProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="playing-set-bar" role="group" aria-label="playing set">
      <button type="button" title="keep every word in play" onClick={onSelectAll}>
        all
      </button>
      <button
        type="button"
        aria-pressed={lassoArmed}
        title="draw around the words to keep"
        onClick={onToggleLasso}
      >
        draw
      </button>
      <button
        type="button"
        className="playing-set-accept"
        title="write map/model.json"
        onClick={onAccept}
      >
        accept
      </button>
      <button type="button" title="leave the set as it was" onClick={onClose}>
        close
      </button>
    </div>
  );
}
