/**
 * STORY 16.13 (shortlist item 1) — THE TOAST that makes a delete reversible.
 *
 * One sentence, one Restore verb and one quiet x. It sits bottom-centre in
 * SCREEN space (outside the plane, like the app's other quiet surfaces), so it
 * never moves with the camera and the plane's armed gate never reaches it.
 *
 * NOTHING HERE COUNTS OR URGES: no countdown, no progress bar, no "undo (10)"
 * ticker, no shake. The window is lived with silently (RESTORE_WINDOW_MS in
 * useGround), and a second delete replaces the toast rather than stacking one.
 * When a restore comes back only partly, the SAME bar says which pieces came
 * back and which did not; that sentence is the only thing it can say then.
 *
 * PROVISIONAL: the wording, the 10 s window and the bar's look.
 */

/** The toast's one sentence for a deletion that can still be restored. */
export const RESTORE_SENTENCE = "this reference was removed";

export interface GroundToastProps {
  /**
   * A partial restore's one sentence. When set, the Restore verb is gone (the
   * pending restore is spent) and the bar only reports; the x dismisses it.
   */
  notice?: string | null;
  /** Put the pending deletion back. Omitted when only a notice is shown. */
  onRestore?: () => void;
  /** Close the bar: commits any pending deletion and forgets the notice. */
  onDismiss: () => void;
}

export function GroundToast({
  notice = null,
  onRestore,
  onDismiss,
}: GroundToastProps) {
  return (
    <div className={`ground-toast${notice === null ? "" : " notice"}`} role="status">
      <span className="ground-toast-sentence">
        {notice === null ? RESTORE_SENTENCE : notice}
      </span>
      {notice === null && onRestore !== undefined && (
        <button
          type="button"
          className="ground-toast-restore"
          onClick={onRestore}
        >
          restore
        </button>
      )}
      <button
        type="button"
        className="ground-toast-dismiss"
        aria-label="dismiss"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
}
