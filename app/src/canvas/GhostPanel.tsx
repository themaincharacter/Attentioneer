import { useEffect, useRef, useState } from "react";
import type { GhostTarget } from "../ghost/envelope";
import type { Packet } from "../ghost/packet";

/** One target the ask may name (words first, then loops, in map order). */
export interface GhostTargetChoice {
  /** A stable key for the picker. */
  key: string;
  /** The target's kind (the envelope's own vocabulary). */
  kind: "word" | "loop";
  /** The record's slug (the ask's target). */
  slug: string;
  /** The person's name for it (the label the picker shows). */
  label: string;
}

interface GhostPanelProps {
  /** Every target the running map offers the move. */
  targets: readonly GhostTargetChoice[];
  /** The frozen packet, once asked (null = not asked). */
  packet: Packet | null;
  /** Why the last ask produced no packet (sentences; empty when it did). */
  askIssues: readonly string[];
  /** Why the last paste was refused (sentences; empty when it was not). */
  intakeIssues: readonly string[];
  /** Does this game's card ride the packet? (The person's choice; OFF by default.) */
  includeCard: boolean;
  /** Set the inclusion choice (never the request's; the trial's shape). */
  onIncludeCard: (include: boolean) => void;
  /** Ask for a packet about one target (the person's region is the fallback). */
  onAsk: (target: GhostTarget) => void;
  /** File a pasted/imported model reply (the intake). */
  onPropose: (raw: string) => void;
  /**
   * THE TURN (Epic 15 story 8): the app carries this frozen packet to the
   * provider the rows name, and the answer's ONE proposal block is filed
   * through the SAME intake the paste uses. PROVISIONAL: the panel offers one
   * send verb and shows the answer as it came back; the provider rows and
   * their keys live in the shared providers panel.
   */
  onSend?: () => void;
  /** The provider:model a send would carry, or null when nothing resolves. */
  providerRef?: string | null;
  /** A send is running (the verb waits). */
  sending?: boolean;
  /** The answer as it came back, when one did (text only, never written). */
  answer?: string | null;
  /** The turn's one sentence: no provider, the parse's refusal, a stop. */
  turnNote?: string | null;
  /** Esc, the ×, a level switch. */
  onClose: () => void;
}

/**
 * THE ASK SURFACE (Epic 10 story 3, PROVISIONAL and deliberately plain) — the
 * one place the person asks for the packet and hands back what a model said.
 *
 * It is the minimal wiring of `useGhostRequest` and the intake, not a polished
 * surface: pick one target (a word or a loop the running map holds), ask — the
 * frozen packet's bytes appear, to be carried out by hand (there is no
 * transport in this story) — then paste the reply back and file it. The ask
 * writes nothing; the paste files one proposal, which then reads as a row in
 * the quiet list.
 *
 * The person's REGION is not wired here: the ask's selection stays empty, so
 * the ADR's fallback applies (the named target and the playing set). Wiring the
 * region's own picker is provisional and is not this story's.
 *
 * THE CARD'S INCLUSION CHOICE is wired here (Epic 11 story 3, ADR-0027): one
 * quiet checkbox, OFF by default — the card rides only when the person chooses
 * it, and the default conventions stand otherwise (including when no card is
 * written for the game). The choice is PERSON state, handed to the ask as its
 * own argument; a pasted reply can never set it.
 *
 * Esc, the ×, or a level switch close it. A press away does NOT: the panel can
 * hold typed prose, and a stray press must never discard it (the blur rule
 * belongs to the cards whose fields commit on Enter).
 */
export function GhostPanel({
  targets,
  packet,
  askIssues,
  intakeIssues,
  includeCard,
  onIncludeCard,
  onAsk,
  onPropose,
  onSend,
  providerRef = null,
  sending = false,
  answer = null,
  turnNote = null,
  onClose,
}: GhostPanelProps) {
  const [pick, setPick] = useState("");
  const [raw, setRaw] = useState("");
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

  const chosen = targets.find((target) => target.key === pick) ?? null;

  return (
    <div
      ref={rootRef}
      className="ghost-panel"
      role="group"
      aria-label="ask for a packet, or file a proposal"
    >
      <div className="ghost-head">
        <span className="ghost-title">ask, or hand one back</span>
        <button
          type="button"
          className="ghost-close"
          aria-label="close the ask"
          title="close"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          ×
        </button>
      </div>

      <div className="ghost-ask">
        <select
          className="ghost-pick"
          aria-label="the target to ask about"
          value={pick}
          onChange={(e) => setPick(e.target.value)}
        >
          <option value="">pick a word or a loop</option>
          {targets.map((target) => (
            <option key={target.key} value={target.key}>
              {target.kind === "loop" ? "loop: " : "word: "}
              {target.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ghost-ask-go"
          disabled={chosen === null}
          title="ask for the packet about this target"
          onClick={(e) => {
            e.stopPropagation();
            if (chosen === null) return;
            onAsk({ kind: chosen.kind, slug: chosen.slug });
          }}
        >
          ask
        </button>
      </div>

      <div className="ghost-choice">
        <label
          className="ghost-card-choice"
          title="carry this game's card in the packet; the default conventions stand when this is off or no card is written"
        >
          <input
            type="checkbox"
            checked={includeCard}
            onChange={(e) => onIncludeCard(e.target.checked)}
          />
          include this game's card
        </label>
      </div>

      {askIssues.length > 0 && (
        <div className="ghost-issue">{askIssues.join("; ")}</div>
      )}

      {packet !== null && (
        <>
          <pre className="ghost-packet">{packet.freeze.bytes}</pre>
          <div className="ghost-inflight-line">
            <span className="ghost-inflight-label">frozen: </span>
            <span className="ghost-inflight-packet">
              {packet.freeze.hash.slice(0, 12)}
            </span>
          </div>
          {/* THE TURN (Epic 15 story 8): the app carries the frozen packet and
              files the answer's one proposal block through the SAME intake the
              paste below uses. The answer is shown here as text; a usable
              proposal arrives as a ghost row, and nothing is written until the
              person accepts it. */}
          <div className="ghost-turn">
            <span className="ghost-turn-ref">
              {providerRef === null ? "no provider selected" : providerRef}
            </span>
            {onSend !== undefined && (
              <button
                type="button"
                className="ghost-send"
                disabled={sending}
                title="send this packet to the model the app carries"
                onClick={(e) => {
                  e.stopPropagation();
                  onSend();
                }}
              >
                send
              </button>
            )}
          </div>
          {answer !== null && <pre className="ghost-answer">{answer}</pre>}
          {turnNote !== null && (
            <div className="ghost-issue" role="status">
              {turnNote}
            </div>
          )}
        </>
      )}

      <textarea
        className="ghost-intake"
        value={raw}
        aria-label="paste a model's reply"
        placeholder="paste a model's reply…"
        onChange={(e) => setRaw(e.target.value)}
      />
      <div className="ghost-actions">
        <button
          type="button"
          className="ghost-propose"
          disabled={raw.trim() === ""}
          title="file this reply as a proposal"
          onClick={(e) => {
            e.stopPropagation();
            if (raw.trim() === "") return;
            onPropose(raw);
            setRaw("");
          }}
        >
          propose
        </button>
      </div>

      {intakeIssues.length > 0 && (
        <div className="ghost-issue">{intakeIssues.join("; ")}</div>
      )}
    </div>
  );
}
