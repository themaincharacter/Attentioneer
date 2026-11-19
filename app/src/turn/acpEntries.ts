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

/**
 * The reply as it crossed the wire, recorded in the progress sequence.
 *
 * STORY 18.4 adds `unanswered`: a request that outlived the run's budget is
 * recorded as exactly that, never as a refusal the person did not make and
 * never as a silent yes. It is the one outcome that is not a decision.
 */
export type AcpPermissionOutcome =
  | { outcome: "selected"; optionId: string }
  | { outcome: "cancelled" }
  | { outcome: "unanswered" };

/**
 * ONE permission request, as the person's surface reads it (Epic 18 story 4).
 * The fields are the protocol's own: the tool call the server described and the
 * options it offered. `id` is the JSON-RPC request id the reply names.
 */
export interface AcpPermissionAsk {
  /** The JSON-RPC request id: the reply must name this exact ask. */
  id: number;
  method: string;
  /** The tool call verbatim, so the card can say what is being asked. */
  toolCall: unknown;
  /** What the server offered, in its order. Never filtered here. */
  options: AcpPermissionOption[];
}

/**
 * The person's TWO verbs (Epic 18 story 4). There is deliberately no third:
 * allow-always is not a choice this app can offer or carry.
 */
export type AcpPermissionChoice = "allow-once" | "refuse";

/**
 * THE ALLOW-ONCE OPTION, or null when the server offered none. It matches the
 * protocol's `allow_once` kind EXACTLY: an `allow_always` option is never
 * returned, so no path here can ever send one. This is the one rule the card
 * and the sidecar share, and it is why a server that offers "always" still gets
 * only a once-answer.
 */
export function allowOnceOption(
  options: readonly AcpPermissionOption[],
): AcpPermissionOption | null {
  return options.find((option) => option.kind === "allow_once") ?? null;
}

/**
 * THE REFUSAL OPTION, or null when the server offered none. `reject_once` is
 * preferred; any other `reject*` option is a refusal too (the protocol's kinds
 * are open-ended). No allow-* option is ever returned from here.
 */
export function refuseOption(
  options: readonly AcpPermissionOption[],
): AcpPermissionOption | null {
  return (
    options.find((option) => option.kind === "reject_once") ??
    options.find((option) => option.kind.startsWith("reject")) ??
    null
  );
}

/**
 * The option id a person's verb becomes, against what the server offered.
 * `null` means "no matching option": the transport sends a cancelled outcome,
 * so an offer with no once/reject pair can never become a yes.
 */
export function optionIdForChoice(
  choice: AcpPermissionChoice,
  options: readonly AcpPermissionOption[],
): string | null {
  return choice === "allow-once"
    ? allowOnceOption(options)?.optionId ?? null
    : refuseOption(options)?.optionId ?? null;
}

/**
 * STORY 19.2 — THE BOUNDARY A BOUND RUN WAS DECLARED UNDER (PROVISIONAL).
 *
 * A session card may be bound to a project card (a folder elsewhere on this
 * machine). When the person has ALSO said what the run may do there, that one
 * word rides the run request: "read" means the run only reads, "write" means it
 * may change files in that folder. Absent means nothing was declared, and then
 * nothing is narrowed and nothing is auto-answered.
 */
export interface RunScope {
  boundary: "read" | "write";
}

/** The boundary words a declaration may carry (PROVISIONAL, with the record). */
export const RUN_BOUNDARIES: readonly RunScope["boundary"][] = ["read", "write"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * IS THIS ASK INSIDE THE DECLARED BOUNDARY? (PURE, STORY 19.2, PROVISIONAL)
 *
 * A declared boundary is the person's consent for IN-SCOPE asks only, so this
 * decides exactly one question and answers it in the strict direction:
 *
 *   - "write" ⇒ in scope when the ask's tool call carries a `kind` string (any
 *     value: the call names what it is, and the declaration covers changes);
 *   - "read"  ⇒ in scope ONLY when that kind is exactly "read";
 *   - anything else — no scope, a missing or non-string kind — is NOT in scope.
 *
 * NOTHING DEFAULTS TO ALLOW and a scope never widens: an ask outside it flows
 * to the person exactly as every ask did before the binding existed.
 */
export function permissionInScope(
  scope: RunScope | null | undefined,
  ask: { toolCall: unknown },
): boolean {
  if (scope === null || scope === undefined) return false;
  const boundary = scope.boundary;
  if (boundary !== "read" && boundary !== "write") return false;
  const call = isRecord(ask.toolCall) ? ask.toolCall : null;
  if (call === null) return false;
  const kind = call.kind;
  if (typeof kind !== "string") return false;
  return boundary === "write" ? true : kind === "read";
}

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
