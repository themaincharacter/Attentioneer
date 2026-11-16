import { useCallback, useState } from "react";
import type { GhostMove, GhostTarget } from "./envelope";
import type { GhostIssue } from "./issues";
import type { Packet, PacketView } from "./packet";
import type { GhostFs } from "./port";
import { MOVES, moveOf } from "./registry";
import { askForPacket, type AskResult, type PacketRequest } from "./request";
import type { GhostContext } from "./session";

/**
 * THE QUIET REQUEST HOOK (Epic 10 story 2, PROVISIONAL) — the person's region
 * as app state, and the one ask.
 *
 * This is the smallest surface a UI needs and nothing more: the person's
 * selection (their own words, never the request's), a way to let go of it, and
 * one async ask that freezes a packet at the moment it is asked. No list, no
 * preview, no verbs, no chrome — story 3 owns the ghost UI. Nothing here writes
 * and nothing mounts itself: story 3 wires the hook.
 *
 * The selection lives HERE because the region is the person's: the ask hands
 * the selection to the surface as a separate argument, so a request can never
 * carry one (ADR-0026). A selection that does not carry the target word is
 * refused by the surface (the move is about one of the selected words — the
 * epic's check), and clearing it (null) lets the ADR's fallback apply. The
 * hook never widens or repairs the person's pick.
 *
 * Provisional: the hook's shape (selection + ask only), the fact that it holds
 * no queue/one-open state (story 3's pacing), and the default move (the
 * registry's first row, which is the only one until the expansion protocol's
 * verdict is journaled).
 */
export interface GhostRequestOptions {
  /** The workspace root (absolute, as the app holds it). */
  workspacePath: string;
  /** The fs port; defaults to the Tauri bridge. */
  fs?: GhostFs;
  /** The app's running context, read at ask time. */
  context: () => GhostContext;
  /** The map's records, read at ask time (the app's loaded map). */
  view: () => PacketView;
  /** The move the person may ask for; defaults to the registry's only row. */
  move?: GhostMove;
}

/** What the hook hands the UI: the region and the one ask. */
export interface GhostRequestHandle {
  /** The person's selection of words; null means "no region chosen". */
  selection: readonly string[] | null;
  /** Choose the region: the person's own words (deduped, sorted). */
  select(slugs: readonly string[]): void;
  /** Let go of the region: the named target and the playing set apply. */
  clear(): void;
  /** The last frozen packet, or null. */
  packet: Packet | null;
  /** Why the last ask produced no packet (empty when it did). */
  issues: readonly GhostIssue[];
  /** An ask is in flight. */
  asking: boolean;
  /** Ask for one packet: the move is the hook's, the target the person's. */
  ask(target: GhostTarget): Promise<AskResult>;
}

export function useGhostRequest(
  options: GhostRequestOptions,
): GhostRequestHandle {
  const [selection, setSelection] = useState<readonly string[] | null>(null);
  const [packet, setPacket] = useState<Packet | null>(null);
  const [issues, setIssues] = useState<readonly GhostIssue[]>([]);
  const [asking, setAsking] = useState(false);

  const select = useCallback((slugs: readonly string[]) => {
    setSelection([...new Set(slugs)].sort());
  }, []);

  const clear = useCallback(() => {
    setSelection(null);
  }, []);

  const ask = useCallback(
    async (target: GhostTarget): Promise<AskResult> => {
      const request: PacketRequest = {
        move: options.move ?? moveOf(MOVES[0]),
        target,
      };
      setAsking(true);
      const result = await askForPacket({
        workspacePath: options.workspacePath,
        fs: options.fs,
        context: options.context(),
        request,
        person: { selection },
        view: options.view(),
      });
      setAsking(false);
      if (result.ok) {
        setPacket(result.packet);
        setIssues([]);
      } else {
        setPacket(null);
        setIssues(result.issues);
      }
      return result;
    },
    [options, selection],
  );

  return { selection, select, clear, packet, issues, asking, ask };
}
