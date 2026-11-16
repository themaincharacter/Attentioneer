import type { GhostEnvelope } from "./envelope";
import { issue, type GhostIssue } from "./issues";
import { appendGhost, dropGhost, replaceGhost, withOpen } from "./list";
import { previewOf } from "./preview";
import {
  beginReshape,
  reshapeCandidate,
  reshapeRefusal,
  type ReshapeDraft,
} from "./reshape";
import type {
  GhostAcceptResult,
  GhostContext,
  GhostSession,
  IntakeResult,
} from "./session";

/**
 * THE VERBS (Epic 10 story 3) — the app's in-flight ghost state and the five
 * acts the person can take on one: file a proposal, open one, reshape it,
 * accept it, reject it.
 *
 * This module is the ONLY door between the surface and the session: the
 * session owns the inbox, the marker and the one apply; the verbs own what the
 * app holds between moments (the rows, the one opened ghost, the reshape draft)
 * and what an act leaves behind. Every act that the session refuses leaves the
 * proposal exactly where it was, with the session's own sentences for the
 * person — a refusal is never a silent close.
 *
 * ACCEPT is the only apply (ADR-0024 decision 5). The order is the session's
 * (marker, apply, release, delete) and the crash story is the session's too: an
 * act that returns `applied` or `already-applied` drops the row, and an act
 * whose proposal the session no longer holds drops it as well (it cannot be
 * applied from here). A minted-but-unwritten proposal is never invented.
 *
 * THE FIVE FIELDS of a reshape never pass through this module's writes: the
 * draft travels with the state and the session is handed the new PARAMS only.
 * The person's reason is read by the surface and is never written anywhere.
 *
 * Provisional: the report shapes and the decision to drop a row the session no
 * longer holds.
 */

/** What the app holds between moments: the in-flight half of the ghost flow. */
export interface GhostState {
  /** The held proposals, in arrival order. */
  readonly ghosts: readonly GhostEnvelope[];
  /** The one ghost the person opened, or null. */
  readonly openId: string | null;
  /** The reshape in flight (its five fields), or null. */
  readonly draft: ReshapeDraft | null;
}

/** The empty state: a session that holds nothing. */
export const NO_GHOSTS: GhostState = { ghosts: [], openId: null, draft: null };

/** What a verb needs: the open moment's session and the running context. */
export interface GhostVerbDeps {
  /** The session (the inbox, the marker and the one apply are its own). */
  readonly session: GhostSession;
  /** The app's running context, read WHEN the act runs (a switch is seen). */
  readonly context: () => GhostContext;
}

/** What an accept left behind. */
export interface AcceptReport {
  state: GhostState;
  /** The session's own answer; null when nothing was opened. */
  outcome: GhostAcceptResult | null;
  /** The sentences to show (a refusal), empty when the act went through. */
  issues: readonly GhostIssue[];
}

/** What a reject left behind. */
export interface RejectReport {
  state: GhostState;
  /** Did the session drop the proposal? */
  rejected: boolean;
}

/** What a reshape left behind. */
export interface ReshapeReport {
  state: GhostState;
  /** The sentences to show (a refusal), empty when the reshape landed. */
  issues: readonly GhostIssue[];
  /** The steps were re-derived and re-filed. */
  changed: boolean;
}

/** What an intake left behind. */
export interface IntakeReport {
  state: GhostState;
  /** The session's own intake result (the refusal's sentences are its own). */
  result: IntakeResult;
}

/** The opened ghost, when it is still held. */
function openedOf(state: GhostState): GhostEnvelope | null {
  return previewOf(state.ghosts, state.openId);
}

/** A row the session no longer holds is dropped: it cannot be applied from here. */
function droppedOpened(state: GhostState, id: string): GhostState {
  return {
    ghosts: dropGhost(state.ghosts, id),
    openId: null,
    draft: null,
  };
}

/**
 * File one pasted/imported reply: the session wraps, validates and files it, and
 * a landed ghost joins the rows at the END. Nothing is opened by the intake —
 * the person's opening is the person's.
 */
export async function intakeReply(
  deps: GhostVerbDeps,
  state: GhostState,
  raw: string,
): Promise<IntakeReport> {
  const result = await deps.session.intake(raw, deps.context());
  if (!result.ok || result.envelope === null) return { state, result };
  return {
    state: { ...state, ghosts: appendGhost(state.ghosts, result.envelope) },
    result,
  };
}

/** Open one ghost (the one-open rule), or none. A different opening drops a draft. */
export function openGhost(state: GhostState, id: string | null): GhostState {
  const next = withOpen(state.openId, id);
  if (next === state.openId) return state;
  return { ...state, openId: next, draft: null };
}

/** Close the open ghost quietly (Esc, the ×, a press away, a level switch). */
export function closeGhost(state: GhostState): GhostState {
  if (state.openId === null && state.draft === null) return state;
  return { ...state, openId: null, draft: null };
}

/** Begin a reshape over the opened ghost: the five fields, in flight only. */
export function beginReshapeDraft(state: GhostState, packet: string | null): GhostState {
  const opened = openedOf(state);
  if (opened === null) return state;
  return { ...state, draft: beginReshape(opened, packet) };
}

/** Let the draft go; the opened ghost stays open. */
export function cancelReshapeDraft(state: GhostState): GhostState {
  if (state.draft === null) return state;
  return { ...state, draft: null };
}

/**
 * Reshape the opened ghost: the draft's reason must be written and its text
 * must say something, then the session re-validates the NEW params against the
 * bytes on disk and re-files the re-derived envelope. The five fields stay in
 * the draft (in flight); nothing else is written.
 */
export async function commitReshape(
  deps: GhostVerbDeps,
  state: GhostState,
): Promise<ReshapeReport> {
  const id = state.openId;
  const draft = state.draft;
  if (id === null || draft === null || openedOf(state) === null) {
    return { state, issues: [], changed: false };
  }
  const refusal = reshapeRefusal(draft);
  if (refusal !== null) {
    return { state, issues: [refusal], changed: false };
  }
  const candidate = reshapeCandidate(draft);
  const params =
    typeof candidate.params === "object" && candidate.params !== null
      ? (candidate.params as Record<string, unknown>)
      : {};
  const result = await deps.session.reshape(id, params, deps.context());
  if (result.outcome === "reshaped") {
    const next: ReshapeDraft = {
      ...draft,
      params: result.envelope.params,
      expect: result.envelope.expect,
    };
    return {
      state: {
        ghosts: replaceGhost(state.ghosts, result.envelope),
        openId: id,
        draft: next,
      },
      issues: [],
      changed: true,
    };
  }
  if (result.outcome === "refused") {
    return { state, issues: result.issues, changed: false };
  }
  return {
    state: droppedOpened(state, id),
    issues: [
      issue(
        "id",
        "this proposal is no longer in the app's hands, so it could not be reshaped",
      ),
    ],
    changed: false,
  };
}

/**
 * THE ACCEPT — the only door that applies a proposal. The session does the
 * order and the crash story; this reports what the person sees afterwards.
 */
export async function acceptOpened(
  deps: GhostVerbDeps,
  state: GhostState,
): Promise<AcceptReport> {
  const id = state.openId;
  if (id === null || openedOf(state) === null) {
    return { state, outcome: null, issues: [] };
  }
  const result = await deps.session.accept(id, deps.context());
  if (result.outcome === "applied" || result.outcome === "already-applied") {
    return { state: droppedOpened(state, id), outcome: result, issues: [] };
  }
  if (result.outcome === "refused") {
    return { state, outcome: result, issues: result.issues };
  }
  return {
    state: droppedOpened(state, id),
    outcome: result,
    issues:
      result.outcome === "not-registered"
        ? [
            issue(
              "id",
              "this proposal is not one this session holds, so nothing was applied",
            ),
          ]
        : [
            issue(
              "id",
              "this proposal is no longer in the app's hands, so nothing was applied",
            ),
          ],
  };
}

/** Reject the opened ghost: the session deletes it, and the row goes with it. */
export async function rejectOpened(
  deps: GhostVerbDeps,
  state: GhostState,
): Promise<RejectReport> {
  const id = state.openId;
  if (id === null || openedOf(state) === null) {
    return { state, rejected: false };
  }
  const rejected = await deps.session.reject(id);
  return { state: droppedOpened(state, id), rejected };
}
