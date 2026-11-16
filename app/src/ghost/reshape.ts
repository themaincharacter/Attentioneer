import type { GhostEnvelope, GhostExpect } from "./envelope";
import { issue, type GhostIssue } from "./issues";

/**
 * RESHAPE (Epic 10 story 3) — the person changes the proposal WITHOUT touching
 * the steps.
 *
 * What the person edits is the move's authored content (v1: the claim's one
 * prose field) and one reason of their own. The steps are never edited: the
 * deriver owns them, the app re-validates the new params through the same
 * grammar (a dry run against the bytes on disk) and re-shows the re-derived
 * list. A stored step list is therefore never a source — the envelope's steps
 * in the inbox are whatever the deriver last said.
 *
 * THE FIVE FIELDS LIVE IN FLIGHT ONLY (ADR-0024 decision 5): the envelope the
 * ghost was opened with, the new params, the person's reason, the base pin, and
 * the packet hash the proposal was asked under. They are this record and
 * nothing else — no file, no record field, no trace after the accept (the crash
 * story: a reshape that does not reach the accept is a rejected proposal, and a
 * landed accept leaves only the accepted line). The reason is the person's own
 * why; it is never written, never weighed and never carries a label of how
 * right the claim is (the judging is the person's, in the journal).
 *
 * Provisional: the five fields' names and the fact that a reason is required
 * before the reshape commits.
 */

/** The five fields a reshape holds, in reading order (this draft and nothing else). */
export const RESHAPE_FIELDS = [
  "original",
  "params",
  "reason",
  "expect",
  "packet",
] as const;

/** One of the five fields' names. */
export type ReshapeField = (typeof RESHAPE_FIELDS)[number];

/** The in-flight reshape record: five fields, no more. */
export interface ReshapeDraft {
  /** The envelope the ghost was opened with (what the person is changing). */
  readonly original: GhostEnvelope;
  /** The move's authored content as edited (v1: `{ text }`). */
  readonly params: Record<string, unknown>;
  /** The person's own why (in flight only; never written). */
  readonly reason: string;
  /** The base pin the proposal was made against (the original's `expect`). */
  readonly expect: GhostExpect;
  /** The frozen packet's hash the proposal was asked under, or null. */
  readonly packet: string | null;
}

/** Begin a reshape over the envelope the person opened. */
export function beginReshape(
  original: GhostEnvelope,
  packet: string | null,
): ReshapeDraft {
  return {
    original,
    params: { ...original.params },
    reason: "",
    expect: original.expect,
    packet,
  };
}

/** The v1 params field the person edits (the registry's one prose field). */
export function textOf(draft: ReshapeDraft): string {
  const text = draft.params.text;
  return typeof text === "string" ? text : "";
}

/** Edit one params field (the authored content — never a step). */
export function withParam(
  draft: ReshapeDraft,
  key: string,
  value: unknown,
): ReshapeDraft {
  return { ...draft, params: { ...draft.params, [key]: value } };
}

/** Edit the claim's text (the v1 field). */
export function withText(draft: ReshapeDraft, text: string): ReshapeDraft {
  return withParam(draft, "text", text);
}

/** Edit the person's reason. */
export function withReason(draft: ReshapeDraft, reason: string): ReshapeDraft {
  return { ...draft, reason };
}

/** The five fields, read back as one object (the draft IS this object). */
export function reshapeFields(draft: ReshapeDraft): Record<ReshapeField, unknown> {
  return {
    original: draft.original,
    params: draft.params,
    reason: draft.reason,
    expect: draft.expect,
    packet: draft.packet,
  };
}

/**
 * The envelope to re-validate: the original with the edited params. The step
 * list is dropped to the empty list the deriver overwrites — passing the
 * original's stored steps forward would read as if a stored list mattered.
 */
export function reshapeCandidate(draft: ReshapeDraft): Record<string, unknown> {
  return {
    ...draft.original,
    params: draft.params,
    steps: [],
    proposals: [],
  };
}

/**
 * What must hold before the reshape commits: a claim with text, and a reason
 * the person actually wrote. Both are the person's (the text is the move's
 * content, the reason is why they are changing the proposal), and neither
 * carries a label of how right the claim is.
 */
export function reshapeRefusal(draft: ReshapeDraft): GhostIssue | null {
  if (textOf(draft).trim() === "") {
    return issue("params", "a claim needs its text before it can stand");
  }
  if (draft.reason.trim() === "") {
    return issue(
      "reshape",
      "say why the proposal should change; the reason is read while the reshaping is open and is never written",
    );
  }
  return null;
}
