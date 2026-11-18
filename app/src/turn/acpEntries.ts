/**
 * THE RUN'S PROGRESS VOCABULARY (Epic 18 story 2; carried on the wire by 18.3b).
 *
 * WHAT THIS FILE IS, AND WHY IT MOVED OUT OF THE RUN. Story 18.3 built the
 * session card around a run that happened in the same process, so the card and
 * the run could share one module. That is exactly what broke: pressing RUN in
 * the shipped window was refused, because the run's module reaches for
 * `node:fs` and a spawner and the window is a WebView with neither. 18.3b moves
 * the lane into the Bun sidecar, so the VOCABULARY has to be readable from both
 * ends without either end importing the other's process code. It lives here:
 * types only, no imports, nothing that can start anything.
 *
 * The entries below are what a run reports, in arrival order (18.2's progress
 * sequence). A transcript entry (`map/sessions.ts`) is the card's own, smaller
 * vocabulary; `useGround` maps one to the other.
 *
 * PROVISIONAL: the entry kinds and their fields are this epic's, and the strict
 * wire reader for them is `turn/protocol.ts`'s.
 */

/** How a run ended. Only "completed" is a result (18.2's rule). */
export type AcpEnding = "completed" | "stopped" | "failed" | "timed-out";

/** One permission option the server offered (the ids a caller may pick). */
export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind: string;
}

/** The reply as it crossed the wire, recorded in the progress sequence. */
export type AcpPermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" };

/**
 * One entry in the run's ordered progress sequence. The window watches this
 * and nothing else.
 */
export type AcpProgressEntry =
  | {
      kind: "started";
      command: string;
      args: string[];
      cwd: string;
      /** The one sentence, emitted BEFORE the spawn. Never contains a key. */
      declaration: string;
      /** Exactly the inherited names: PATH and HOME when they were set. */
      inherited: string[];
      /** The variable names the run filled, if any. Never their values. */
      envNames: string[];
    }
  | { kind: "session"; sessionId: string }
  | {
      kind: "update";
      /** `sessionUpdate`'s kind: agent_message_chunk, tool_call, plan, … */
      updateKind: string;
      /** The text this update carried ("" for kinds that carry none). */
      text: string;
      /** The update object verbatim, so a later surface can use all of it. */
      update: unknown;
    }
  | {
      kind: "permission";
      method: string;
      toolCall: unknown;
      options: AcpPermissionOption[];
      reply: AcpPermissionOutcome;
    }
  | { kind: "problem"; sentence: string }
  | {
      kind: "ended";
      ending: AcpEnding;
      stopReason: string | null;
      sentence: string | null;
      /** True when words arrived but the ending is not a result. */
      partial: boolean;
    };
