import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GhostEnvelope, GhostMove, GhostTarget } from "./envelope";
import type { GhostIssue } from "./issues";
import { ghostRows, type GhostRow } from "./list";
import type { GhostFs } from "./port";
import { previewOf } from "./preview";
import {
  cancelReshapeDraft,
  beginReshapeDraft,
  commitReshape,
  openGhost,
  closeGhost,
  acceptOpened,
  intakeReply,
  rejectOpened,
  NO_GHOSTS,
  type GhostState,
} from "./verbs";
import { withReason, withText, type ReshapeDraft } from "./reshape";
import {
  createGhostSession,
  type GhostAcceptResult,
  type GhostContext,
  type IntakeResult,
} from "./session";

/**
 * THE APP'S GHOSTS (Epic 10 story 3, PROVISIONAL) — the one hook the surfaces
 * read: the rows, the one opened ghost, the reshape in flight, and the verbs.
 *
 * It is deliberately thin: the rules live in `list.ts` (the rows and the
 * one-open reading), `preview.ts` (the opening and the diamond) and
 * `reshape.ts` (the five fields), and the acts live in `verbs.ts`. This hook
 * only owns React state and the session's open moment: creating the session for
 * the workspace and DISCARDING the inbox at that moment (replay is refused; an
 * id from an earlier session is not a ghost the app knows).
 *
 * Nothing here writes a reshape's reason or a packet hash: the draft rides in
 * app state (in flight only), the session is handed the new params, and the
 * accept deletes the proposal. A closed or discarded draft is gone with the
 * state — the crash story's "a reshape that does not land is rejected".
 *
 * Provisional: the hook's shape, and the fact that the session is created per
 * workspace path (one open moment per window).
 */
export interface GhostUiOptions {
  /** The workspace root, or null while the workspace gate is up. */
  workspacePath: string | null;
  /** The fs port; defaults to the Tauri bridge (tests pass a real one). */
  fs?: GhostFs;
  /** The running context at the moment of an act (the band and the branch). */
  context: () => GhostContext;
  /** The person's name for a target's slug (the rows speak names). */
  nameOf: (slug: string) => string;
}

/** What the surfaces get: the state and the acts, nothing else. */
export interface GhostUiHandle {
  /** The open moment is ready (the inbox was discarded). */
  ready: boolean;
  /** The held proposals, in arrival order. */
  ghosts: readonly GhostEnvelope[];
  /** The rows (text only), in arrival order. */
  rows: readonly GhostRow[];
  /** The one opened ghost's id, or null. */
  openId: string | null;
  /** The opened ghost itself, or null. */
  opened: GhostEnvelope | null;
  /** The reshape in flight (its five fields), or null. */
  draft: ReshapeDraft | null;
  /** Why the last act on an opened ghost was refused (empty when it was not). */
  issues: readonly GhostIssue[];
  /** Why the last paste was refused (the ask surface's own line). */
  intakeIssues: readonly GhostIssue[];
  /** An act is running. */
  busy: boolean;
  /**
   * THE RUN'S PRIOR REFUSAL SENTENCES for one move and target (Epic 14 story
   * 1, ADR-0031): the session's ephemeral reading, deduped by refusal key, in
   * arrival order, at most N. The ask hook threads this into the packet's
   * bounded run block; it is READ here, never rendered and never written. A
   * surface that RENDERS it is still the story-2 scan's target; threading the
   * sentences into the ask is the named follow-up (Epic 14's own). Empty
   * before the open moment and empty again after the next one.
   */
  priorRefusals(move: GhostMove, target: GhostTarget): readonly string[];
  /**
   * File a pasted/imported model reply (the intake), with the frozen packet's
   * hash when the reply answers an ask (provenance only; never written to a
   * record and never enforced). The result is handed back so a caller (the
   * turn's proposal path) can show the intake's own sentence or the second
   * block's; null when the session is not open or an act is already running.
   */
  intake(
    raw: string,
    packetHash?: string | null,
  ): Promise<IntakeResult | null>;
  /** Open one ghost (at most one is open), or none. */
  open(id: string | null): void;
  /** Close the opened ghost quietly. */
  close(): void;
  /** Begin a reshape over the opened ghost (the packet hash, or null). */
  beginReshape(packet: string | null): void;
  /** Edit the claim's text (the move's authored content). */
  setText(text: string): void;
  /** Edit the person's reason (in flight only). */
  setReason(reason: string): void;
  /** Commit the reshape: re-validate, re-derive and re-file. */
  commitReshape(): Promise<void>;
  /** Let the draft go (the opened ghost stays open). */
  cancelReshape(): void;
  /** ACCEPT the opened ghost — the only apply. */
  accept(): Promise<GhostAcceptResult | null>;
  /** Reject the opened ghost: it is deleted. */
  reject(): Promise<void>;
}

export function useGhosts(options: GhostUiOptions): GhostUiHandle {
  const { workspacePath, fs, nameOf } = options;
  // The context reading is a callback the app hands fresh each render; the ref
  // keeps the acts' identities stable without freezing the reading.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const session = useMemo(
    () =>
      workspacePath === null
        ? null
        : createGhostSession({ workspacePath, fs }),
    [workspacePath, fs],
  );

  const [state, setState] = useState<GhostState>(NO_GHOSTS);
  const [issues, setIssues] = useState<readonly GhostIssue[]>([]);
  const [intakeIssues, setIntakeIssues] = useState<readonly GhostIssue[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);

  // The workspace's open moment: discard the inbox, hold nothing, and only
  // then let the surfaces read. A replay from an earlier session is refused by
  // construction (the session forgot every id).
  useEffect(() => {
    if (session === null) {
      setState(NO_GHOSTS);
      setIssues([]);
      setIntakeIssues([]);
      setReady(false);
      return;
    }
    let live = true;
    setReady(false);
    setState(NO_GHOSTS);
    setIssues([]);
    setIntakeIssues([]);
    void session.open().then(
      () => {
        if (live) setReady(true);
      },
      () => {
        // The inbox could not be cleaned (a permissions failure, say). The app
        // still works and nothing becomes acceptable: the session's own ids are
        // in-session only, so an envelope it did not mint is refused whatever
        // is left on disk.
        if (live) setReady(true);
      },
    );
    return () => {
      live = false;
    };
  }, [session]);

  const deps = useMemo(
    () =>
      session === null
        ? null
        : {
            session,
            context: () => optionsRef.current.context(),
          },
    [session],
  );

  /**
   * THE RUN'S OWN WORDS, read on demand (Epic 14 story 1; the named follow-up):
   * the ask hook is wired separately from this one, so it cannot see the
   * session — this read is the seam. It is the session's reading at the moment
   * of the ask (the run changes only through an intake), returns a copy so no
   * caller can reach the run's own array, and answers empty before the open
   * moment (there is no run yet). Nothing renders it here.
   */
  const priorRefusals = useCallback(
    (move: GhostMove, target: GhostTarget): readonly string[] =>
      session === null ? [] : [...session.priorRefusals(move, target)],
    [session],
  );

  const rows = useMemo(() => ghostRows(state.ghosts, nameOf), [state.ghosts, nameOf]);
  const opened = useMemo(
    () => previewOf(state.ghosts, state.openId),
    [state.ghosts, state.openId],
  );

  const intake = useCallback(
    async (
      raw: string,
      packetHash?: string | null,
    ): Promise<IntakeResult | null> => {
      if (deps === null || busy) return null;
      setBusy(true);
      try {
        const report = await intakeReply(deps, state, raw, packetHash);
        setState(report.state);
        // A paste's refusal is the ask surface's line; the opened ghost's own
        // reading is untouched by it.
        setIntakeIssues(report.result.issues);
        return report.result;
      } finally {
        setBusy(false);
      }
    },
    [deps, busy, state],
  );

  const open = useCallback((id: string | null) => {
    setState((current) => openGhost(current, id));
    setIssues([]);
  }, []);

  const close = useCallback(() => {
    setState((current) => closeGhost(current));
    setIssues([]);
  }, []);

  const beginReshape = useCallback((packet: string | null) => {
    setState((current) => beginReshapeDraft(current, packet));
    setIssues([]);
  }, []);

  const setText = useCallback((text: string) => {
    setState((current) =>
      current.draft === null
        ? current
        : { ...current, draft: withText(current.draft, text) },
    );
  }, []);

  const setReason = useCallback((reason: string) => {
    setState((current) =>
      current.draft === null
        ? current
        : { ...current, draft: withReason(current.draft, reason) },
    );
  }, []);

  const cancelReshape = useCallback(() => {
    setState((current) => cancelReshapeDraft(current));
    setIssues([]);
  }, []);

  const commitReshapeNow = useCallback(async () => {
    if (deps === null || busy) return;
    setBusy(true);
    try {
      const report = await commitReshape(deps, state);
      setState(report.state);
      setIssues(report.issues);
    } finally {
      setBusy(false);
    }
  }, [deps, busy, state]);

  const accept = useCallback(async (): Promise<GhostAcceptResult | null> => {
    if (deps === null || busy) return null;
    setBusy(true);
    try {
      const report = await acceptOpened(deps, state);
      setState(report.state);
      setIssues(report.issues);
      return report.outcome;
    } finally {
      setBusy(false);
    }
  }, [deps, busy, state]);

  const reject = useCallback(async () => {
    if (deps === null || busy) return;
    setBusy(true);
    try {
      const report = await rejectOpened(deps, state);
      setState(report.state);
      setIssues([]);
    } finally {
      setBusy(false);
    }
  }, [deps, busy, state]);

  return {
    ready,
    ghosts: state.ghosts,
    rows,
    openId: state.openId,
    opened,
    draft: state.draft,
    issues,
    intakeIssues,
    busy,
    priorRefusals,
    intake,
    open,
    close,
    beginReshape,
    setText,
    setReason,
    commitReshape: commitReshapeNow,
    cancelReshape,
    accept,
    reject,
  };
}
