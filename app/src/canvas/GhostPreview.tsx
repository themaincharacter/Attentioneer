import { useEffect, useRef } from "react";
import type { GhostEnvelope } from "../ghost/envelope";
import { textOf, type ReshapeDraft } from "../ghost/reshape";
import { ghostSummary } from "../ghost/list";
import { stepViews } from "../ghost/preview";

interface GhostPreviewProps {
  /** The opened ghost (the current envelope, after any reshaping). */
  envelope: GhostEnvelope;
  /** The envelope the ghost was opened with (the reshape's original), or null. */
  original: GhostEnvelope | null;
  /** The person's name for a target's slug (names, not slugs). */
  nameOf: (slug: string) => string;
  /** The reshape in flight (its five fields), or null. */
  draft: ReshapeDraft | null;
  /** The sentences of the last refusal (empty when there was none). */
  issues: readonly string[];
  /** An act is running. */
  busy: boolean;
  /** Begin a reshape (the five fields open over the opened ghost). */
  onBeginReshape: () => void;
  /** Edit the claim's text. */
  onText: (text: string) => void;
  /** Edit the person's reason. */
  onReason: (reason: string) => void;
  /** Commit the reshape (re-validate, re-derive, re-file). */
  onCommit: () => void;
  /** Let the draft go, keeping the opened ghost. */
  onCancel: () => void;
  /** ACCEPT — the only apply. */
  onAccept: () => void;
  /** REJECT — delete the proposal. */
  onReject: () => void;
  /** Esc, the ×, a press away, a level switch. */
  onClose: () => void;
}

/**
 * THE GHOST'S PREVIEW (Epic 10 story 3) — what the person's OPENING shows.
 *
 * The card is the whole reading of one held Patch, opened on purpose from its
 * row and closed by the window's own rules (Esc, the ×, a press away, a level
 * switch): what the move does and about what, the proposal's why verbatim, the
 * READ-ONLY derived steps (their claim text legible; a step a reshape changed
 * says so), and the two verbs that end the proposal — accept (the only apply)
 * and reject (the delete). The faint diamond at the target is the same opening
 * (`GhostDiamond`, mounted from the same state), never an ambient cue.
 *
 * RESHAPE edits the move's authored content and a reason of the person's own;
 * the steps are never edited, and committing re-validates the new params
 * through the grammar, re-derives the steps and re-shows them here. The five
 * fields — the envelope as proposed, the new params, the reason, the base pin
 * and the packet hash — are on the card while the reshaping is open and go with
 * it: nothing of the reshape is written, and no label of how right the claim is
 * appears anywhere (the judging is the person's; the journal holds the rest).
 *
 * Accept is offered only while no reshaping is open: the unsaved text is never
 * silently applied by closing the reshape.
 *
 * Provisional: the card's layout, its placement (a fixed panel beside the other
 * quiet surfaces, not anchored to the target) and the wording.
 */
export function GhostPreview({
  envelope,
  original,
  nameOf,
  draft,
  issues,
  busy,
  onBeginReshape,
  onText,
  onReason,
  onCommit,
  onCancel,
  onAccept,
  onReject,
  onClose,
}: GhostPreviewProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const summary = ghostSummary(envelope, nameOf);
  const steps = stepViews(envelope, original, nameOf);
  const pinFiles = Object.keys(draft?.expect.files ?? {}).join(", ");

  // Esc closes the card (the window's rule). The reshape fields' own Esc is the
  // same close: nothing typed is written, so there is nothing to keep.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A press away closes it (the window's rule). A press inside the card is the
  // person's work, never "away".
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      const root = rootRef.current;
      if (root && e.target instanceof Node && root.contains(e.target)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDown, true);
    return () => document.removeEventListener("mousedown", onDown, true);
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="ghost-preview"
      role="group"
      aria-label={"proposal: " + summary}
    >
      <div className="ghost-head">
        <span className="ghost-title">{summary}</span>
        <button
          type="button"
          className="ghost-close"
          aria-label="close the proposal"
          title="close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>

      {/* the proposal's why, verbatim */}
      <div className="ghost-why">{envelope.rationale}</div>

      {/* the derived steps: READ-ONLY, the deriver's list, rendered as text */}
      <div className="ghost-steps">
        {steps.length === 0 ? (
          <div className="ghost-step">no step is derived</div>
        ) : (
          steps.map((step, index) => (
            <div
              key={step.file + "\u0000" + String(index)}
              className={"ghost-step" + (step.changed ? " changed" : "")}
            >
              <div className="ghost-step-does">
                {step.does} {step.file}
              </div>
              <div className="ghost-step-claim">
                {step.about !== "" && (
                  <span className="ghost-step-about">about {step.about}: </span>
                )}
                {step.text}
              </div>
              {step.changed && (
                <div className="ghost-step-changed">changed</div>
              )}
            </div>
          ))
        )}
      </div>

      {draft === null ? (
        <div className="ghost-actions">
          <button
            type="button"
            className="ghost-reshape"
            title="change what this proposal says, and say why"
            onClick={(e) => {
              e.stopPropagation();
              onBeginReshape();
            }}
          >
            reshape
          </button>
          <button
            type="button"
            className="ghost-accept"
            title="accept this proposal: it is written to the map"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onAccept();
            }}
          >
            accept
          </button>
          <button
            type="button"
            className="ghost-reject"
            title="reject this proposal: it is deleted"
            disabled={busy}
            onClick={(e) => {
              e.stopPropagation();
              onReject();
            }}
          >
            reject
          </button>
        </div>
      ) : (
        <div className="ghost-reshape-open">
          {/* the five fields, in flight only: the envelope as proposed ... */}
          <div className="ghost-inflight-line">
            <span className="ghost-inflight-label">as proposed: </span>
            <span className="ghost-original">
              {String(draft.original.params.text ?? "")}
            </span>
          </div>
          {/* ... the new params ... */}
          <input
            className="ghost-input"
            value={textOf(draft)}
            aria-label="the claim's text"
            placeholder="the claim's text"
            onChange={(e) => onText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
          />
          {/* ... and the person's reason */}
          <input
            className="ghost-reason"
            value={draft.reason}
            aria-label="why this proposal should change"
            placeholder="why it changes…"
            onChange={(e) => onReason(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onCommit();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                onClose();
              }
            }}
          />
          {/* ... against the base pin, under the ask's packet hash. */}
          <div className="ghost-inflight-line">
            <span className="ghost-inflight-label">the base: </span>
            <span className="ghost-inflight-base">{pinFiles}</span>
          </div>
          <div className="ghost-inflight-line">
            <span className="ghost-inflight-label">the ask: </span>
            <span className="ghost-inflight-packet">
              {draft.packet === null ? "no ask" : draft.packet.slice(0, 12)}
            </span>
          </div>
          <div className="ghost-actions">
            <button
              type="button"
              className="ghost-commit"
              title="re-derive the steps from this text"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                onCommit();
              }}
            >
              reshape it
            </button>
            <button
              type="button"
              className="ghost-drop"
              title="leave the proposal as it was"
              onClick={(e) => {
                e.stopPropagation();
                onCancel();
              }}
            >
              let it go
            </button>
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <div className="ghost-issue">{issues.join("; ")}</div>
      )}
    </div>
  );
}
