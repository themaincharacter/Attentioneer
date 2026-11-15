import { useEffect, useRef, useState } from "react";
import { loopNameFromCoin, type PathSession } from "./loopAuthoring";
import type { SelectorWord } from "./PlayingSetSelector";

interface PathWordsProps {
  words: readonly SelectorWord[];
  session: PathSession;
  onPick: (slug: string) => void;
}

/**
 * The path-collection layer (story 3, ADR-0016 decision 4): while the gate's
 * `path` mode is armed, one quiet transparent button sits over each word so a
 * press can only mean "add this word to the path in order" — the word's own
 * press behaviors (drag, center, rename, remove) are suspended. The collected
 * words wear a soft outline; the FIRST word wears the closing marker, because
 * pressing it again closes the cycle (a 2-cycle is A, B, A; a self-loop is A,
 * A). No numerals, no progress: the outline is the whole record of order.
 *
 * The layer is content (gates.ts), so it can never pan the plane or open the
 * creation ring menu; the wheel still zooms (the lasso's precedent).
 *
 * Provisional: the outline and the closing marker (ADR-0003/0016).
 */
export function PathWords({ words, session, onPick }: PathWordsProps) {
  const first = session.path[0];
  const collecting = session.kind === "collecting";
  return (
    <div className="path-collect" role="group" aria-label="the loop's path">
      {words.map((word) => {
        const collected = session.path.includes(word.slug);
        const closing = collecting && first === word.slug;
        return (
          <button
            key={word.slug}
            type="button"
            className={`path-word${collected ? " collected" : ""}${closing ? " first" : ""}`}
            style={{
              transform: `translate3d(${word.pos.x}px, ${word.pos.y}px, 0)`,
              width: word.box.w,
              height: word.box.h,
            }}
            aria-pressed={collected}
            aria-label={
              closing
                ? `close the loop at “${word.name}”`
                : collected
                  ? `“${word.name}” is on the path`
                  : `add “${word.name}” to the path`
            }
            title={
              closing
                ? "click to close the loop"
                : collected
                  ? "on the path"
                  : "click the words in order"
            }
            onClick={() => onPick(word.slug)}
          />
        );
      })}
    </div>
  );
}

interface PathBarProps {
  /** True while the path is still being collected (the coin field is next). */
  collecting: boolean;
}

/**
 * A quiet hint line while a loop is being authored: what the gesture is, and
 * how it ends. It is fixed in screen space, writes nothing, and disappears with
 * the session. Provisional: the wording.
 */
export function PathBar({ collecting }: PathBarProps) {
  return (
    <div className="path-bar" role="status">
      <span className="path-bar-title">coin a loop</span>
      <span className="path-bar-hint">
        {collecting
          ? "click the words in order · click the first one again to close · esc cancels"
          : "name it · enter commits · esc discards"}
      </span>
    </div>
  );
}

interface LoopCoinFieldProps {
  /** World point the field is anchored to (the route's middle). */
  x: number;
  y: number;
  /** Enter with a name commits the record. */
  onCoin: (name: string) => void;
  /** Esc, or a blank name, discards — nothing is written. */
  onCancel: () => void;
}

/**
 * The coin field after a path closes (story 3): the person names the cycle they
 * just walked. Enter commits the record (`nameLoop`), Esc discards it, and a
 * blank name writes nothing — only the person coins a loop. It sits at the
 * route's middle in the GrowField / distance-coin-field idiom; the `path` gate
 * is still armed while the field asks, so a press can neither pan the plane nor
 * open the creation menu, and the field is content (gates.ts).
 *
 * Provisional: the placement and the look (ADR-0003/0016).
 */
export function LoopCoinField({ x, y, onCoin, onCancel }: LoopCoinFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState("");
  const doneRef = useRef(false);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function commit() {
    if (doneRef.current) return;
    doneRef.current = true;
    const name = loopNameFromCoin(draft);
    if (name) onCoin(name);
    else onCancel();
  }

  function cancel() {
    if (doneRef.current) return;
    doneRef.current = true;
    onCancel();
  }

  return (
    <div className="loop-coinfield" style={{ left: x, top: y }}>
      <input
        ref={inputRef}
        value={draft}
        placeholder="name the loop…"
        aria-label="name the loop"
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
        onDoubleClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}
