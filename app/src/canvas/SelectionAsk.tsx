import { useEffect, useRef, useState } from "react";
import {
  askQuestionRefusal,
  selectionWordsRefusal,
} from "../map/asks";
import {
  nativeSelectionPresent,
  type PaintedRect,
} from "./selectionHighlight";
import type { GroundAddResult } from "./useGround";

/**
 * STORY 16.19 — THE QUESTION WIDGET A SELECTION OPENS.
 *
 * The user's correction, twice: selecting text in a card's reading should open a
 * small question field, and asking in it should make a LINKED CARD — not a copy
 * of the selected text. Story 16.12 built the copy card and 16.18 deleted it;
 * this is the affordance the person meant.
 *
 * WHAT IT IS, exactly and nothing more: one question field, one ask verb and a
 * dismiss, floating at the words the person chose. It holds NO record and reads
 * nothing: the words and the source come from the layer (the selection is the
 * card's, captured on mouse-up), and pressing ask hands them to the one write
 * path. Esc dismisses it, the card's close dismisses it, a press outside
 * dismisses it, and asking dismisses it — and every one of those paths CLEARS
 * the browser's own selection, so no highlight is ever left behind on the
 * reading. It is never mounted for an empty selection (the layer's rule; the
 * refusal below is the same rule kept at this seam).
 *
 * IT DOES NOT FIGHT THE CARD'S GESTURES. The press on the reading stays the
 * reading's own (the card's raw mousedown already returns early there, so a
 * selection never starts a card drag); this widget stops its own presses before
 * the plane's d3 handlers hear them, and it stops the wheel so scrolling inside
 * it never zooms the map. No second model call happens here: asking is the
 * ordinary ask path, and this widget is gone by the time the card sends.
 *
 * STORY 16.31 — THE HIGHLIGHT STAYS WHILE THE WIDGET IS OPEN. The user: "It
 * does lose the highlight though whenever the widget pops up, which also means
 * you lose the ability to right click and copy text." So the widget now does
 * TWO things it did not do before. It opens WITHOUT taking focus and without
 * clearing anything: the browser's own selection — and with it the OS's
 * right-click copy — is left exactly as the person made it until they click
 * into the field or type. And because a browser may still drop that selection
 * (the field takes focus, the card re-renders), it paints the CAPTURED rects
 * over the same words the moment the native highlight is gone, so what was
 * asked about stays visible. Right-click copy works until the person types;
 * after that the highlight is ours, and that is the accepted trade.
 *
 * THE PAINT IS NOT STATE ANYTHING ELSE OWNS. It is rendered from this widget and
 * only from this widget, so ask, dismiss, the card's close and unmount each take
 * it with them — there is no second thing to forget, and a highlight can never
 * linger over words nobody asked about.
 *
 * PROVISIONAL (ADR-0003's rendering seam): the widget's size, wording and the
 * way it hangs below the selection at screen size at every zoom, and the
 * painted highlight's wash.
 */

/** The one ask verb, and the dismiss's accessible name (PROVISIONAL wording). */
export const SELECTION_ASK_VERB = "ask";
export const SELECTION_ASK_DISMISS = "dismiss";

/**
 * CLEAR THE BROWSER'S SELECTION — the rule behind "no highlighting is left
 * behind" (story 16.19, rule 6). Called on EVERY way out: after asking, on Esc,
 * on the card's close, on a press away. Guarded so a test render without a DOM
 * (and a window-less import) is not a crash: nothing here exists to clear.
 */
export function clearTextSelection(): void {
  if (typeof window === "undefined") return;
  window.getSelection()?.removeAllRanges();
}

interface SelectionAskProps {
  /** The selection's point, in plane coordinates (the widget hangs under it). */
  x: number;
  y: number;
  /** The camera's zoom, so the widget stays screen-size at every zoom. */
  zoom: number;
  /**
   * STORY 16.31 — the chosen words' rectangles, captured ONCE at mouse-up and
   * already in plane space. The widget never re-measures them: a rect measured
   * later could describe different words, and a highlight over the wrong text is
   * worse than none.
   */
  rects: readonly PaintedRect[];
  /**
   * The words the person chose, already collapsed to one line. Handed back to
   * the writer with the question; the widget never edits them.
   */
  words: string;
  /** ASK: the one write path. A refusal keeps the widget open and says it. */
  onAskQuestion: (question: string) => Promise<GroundAddResult>;
  /** Dismiss: Esc, the ×, a press outside, or the card closing. */
  onDismiss: () => void;
}

export function SelectionAsk({
  x,
  y,
  zoom,
  rects,
  words,
  onAskQuestion,
  onDismiss,
}: SelectionAskProps) {
  const [question, setQuestion] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // STORY 16.31 — THE FIELD DOES NOT TAKE FOCUS ON OPEN. Story 16.19 focused it
  // on mount, and that is exactly what ate the native selection (and the
  // right-click copy with it). An explicit click into the field is what moves
  // focus now, and the mount only ever looks.

  // STORY 16.31 — WHEN THE BROWSER'S HIGHLIGHT GOES, OURS APPEARS. One-way on
  // purpose: the person's own selection is the first highlight and is left
  // alone; if the browser drops it anyway, the captured words are painted over
  // and stay painted until the widget closes. The mount check is not a detail —
  // a browser can drop the selection as the widget appears, and then nothing
  // must wait for an event to paint.
  const [painted, setPainted] = useState(false);
  useEffect(() => {
    if (painted) return;
    function sync() {
      if (!nativeSelectionPresent(window.getSelection())) setPainted(true);
    }
    sync();
    document.addEventListener("selectionchange", sync);
    document.addEventListener("focusin", sync);
    return () => {
      document.removeEventListener("selectionchange", sync);
      document.removeEventListener("focusin", sync);
    };
  }, [painted]);

  // Esc dismisses without writing. Capture phase, so the card's own Esc (which
  // would close the reading under the widget) never sees the key first.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      onDismiss();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onDismiss]);

  // A press outside is a dismiss; a press inside is the widget's own. Capture,
  // because the plane's d3 handlers stop propagation on the way up.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      // STORY 16.31 — A RIGHT-CLICK IS NOT A PRESS AWAY. The OS's context menu
      // is the whole point of "you lose the ability to right click and copy":
      // dismissing on it (and clearing the selection under it) would take Copy
      // away exactly when the person asked for it. Only a primary press
      // dismisses; the right button keeps the words and the menu.
      if (e.button !== 0) return;
      const root = rootRef.current;
      if (root !== null && e.target instanceof Node && root.contains(e.target)) {
        return;
      }
      onDismiss();
    }
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onDismiss]);

  // The widget's own presses never pan the plane, count as empty paper, or
  // start a card gesture; its wheel never zooms the map.
  useEffect(() => {
    const el = rootRef.current;
    if (el === null) return;
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener("mousedown", stop);
    el.addEventListener("wheel", stop, { passive: true });
    return () => {
      el.removeEventListener("mousedown", stop);
      el.removeEventListener("wheel", stop);
    };
  }, []);

  async function ask(): Promise<void> {
    if (busy) return;
    // THE SAME ONE REFUSAL RULES the writer runs, said here first so a press
    // with no words (the selection was cleared under the widget) answers one
    // sentence and writes nothing.
    const noWords = selectionWordsRefusal(words);
    if (noWords !== null) {
      setProblem(noWords);
      return;
    }
    const noQuestion = askQuestionRefusal(question);
    if (noQuestion !== null) {
      setProblem(noQuestion);
      return;
    }
    setBusy(true);
    setProblem(null);
    const result = await onAskQuestion(question);
    setBusy(false);
    if (!result.ok) {
      // The refusal keeps the widget (and its field) where it was; nothing was
      // written and nothing is dismissed.
      setProblem(result.message);
      return;
    }
    // ASKED: the widget's work is done. The layer's dismiss clears the
    // selection with it, so the reading is left exactly as it was found.
    onDismiss();
  }

  return (
    <>
      {/* STORY 16.31 — THE PAINTED HIGHLIGHT, in plane coordinates, over the
          captured words only. It takes no presses (pointer-events: none), so a
          press still lands on the reading under it. It exists only while this
          widget is mounted, which is why no exit path needs a second clear. */}
      {painted &&
        rects.map((rect, index) => (
          <div
            key={"selection-highlight-" + index}
            className="selection-highlight"
            aria-hidden="true"
            style={{
              left: rect.x,
              top: rect.y,
              width: rect.width,
              height: rect.height,
            }}
          />
        ))}
      <div
        ref={rootRef}
        className="selection-ask"
        style={{
          left: x,
          top: y,
          // The plane-inner is scaled by the camera; undo that so the field
          // stays readable at every zoom, hanging from the selection's lower
          // corner.
          transform: `scale(${1 / zoom})`,
          transformOrigin: "top left",
        }}
        role="group"
        aria-label="ask about the chosen words"
      >
        <input
          className="selection-ask-question"
          value={question}
          placeholder="your question"
          aria-label="your question about the chosen words"
          disabled={busy}
          onChange={(e) => {
            setQuestion(e.target.value);
            if (problem !== null) setProblem(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            void ask();
          }}
        />
        <button
          type="button"
          className="selection-ask-ask"
          disabled={busy}
          onClick={() => void ask()}
        >
          {SELECTION_ASK_VERB}
        </button>
        <button
          type="button"
          className="selection-ask-dismiss"
          aria-label={SELECTION_ASK_DISMISS}
          title={SELECTION_ASK_DISMISS}
          disabled={busy}
          onClick={onDismiss}
        >
          ×
        </button>
        {problem !== null && (
          <div className="selection-ask-problem" role="status">
            {problem}
          </div>
        )}
      </div>
    </>
  );
}
