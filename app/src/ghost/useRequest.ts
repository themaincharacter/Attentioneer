import { useCallback, useState } from "react";
import type { GhostGame, GhostMove, GhostTarget } from "./envelope";
import type { GhostIssue } from "./issues";
import type { Packet, PacketCard, PacketView } from "./packet";
import type { GhostFs } from "./port";
import { findMove, MOVES, moveOf } from "./registry";
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
 * THE INCLUSION CHOICE is person state too (Epic 11 story 3, ADR-0027): a
 * boolean, OFF by default, handed to the ask as a separate argument — so the
 * request can never smuggle "include the card" (its keys are exactly
 * move/target). The card DATA is read at ask time through the app's own
 * provider, so a hand edit to `map/cards.jsonl` is seen by the very next ask
 * (the frozen packet's hash moves with it); with the choice off, no card read
 * happens at all. The ghost layer never imports the card record.
 *
 * THE RUN'S SENTENCES ride in as a READ (Epic 14 story 1's named follow-up):
 * the session (and its run state) lives in the ghosts hook, this hook is wired
 * separately, so the app hands over that handle's `priorRefusals(move,
 * target)`. The read happens at ASK time, for the very move and target this
 * ask names, so it cannot go stale between renders — and it is threaded into
 * the packet's bounded run block, never rendered: the surfaces' scan bans the
 * run state from RENDERING, not from riding the ask (ADR-0031).
 *
 * Provisional: the hook's shape (selection + inclusion + ask), the fact that it
 * holds no queue/one-open state (story 3's pacing), the inclusion flag's name
 * and its default, the default move (the registry's first row, which is the
 * only one until the expansion protocol's verdict is journaled), and the run
 * read's shape (a callback keyed by the move and target the ask itself names,
 * rather than a value captured at render).
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
  /**
   * The map's game notes, read at ask time (the app's own card read, as plain
   * data). Read only when the person included the card, so the default ask
   * never touches `map/cards.jsonl`.
   */
  cards?: () => Promise<readonly PacketCard[]>;
  /** The ring's authored kinds for a game, read at ask time (data, no import). */
  creationKinds?: (game: GhostGame) => readonly string[];
  /**
   * THE RUN'S PRIOR REFUSAL SENTENCES for one move and target, read at ASK
   * time (Epic 14 story 1; the named follow-up). The person's side of the
   * seam: the session lives in the ghosts hook, so the app hands over that
   * handle's read. Absent or empty leaves the packet's run block out entirely.
   */
  priorRefusals?: (move: GhostMove, target: GhostTarget) => readonly string[];
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
  /** Does this game's card ride the packet? Person state; default OFF. */
  includeCard: boolean;
  /** Set the inclusion choice for the next ask (never written, never enforced). */
  setIncludeCard(include: boolean): void;
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
  const [includeCard, setIncludeCard] = useState(false);
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
      const move = options.move ?? moveOf(MOVES[0]);
      const request: PacketRequest = { move, target };
      // THE RUN'S OWN WORDS (Epic 14): read from the session at ASK time, for
      // the move and target this very ask names — never from the request, and
      // never captured at render. The packet's bounded run block carries them.
      const priorRefusals = options.priorRefusals?.(move, target) ?? [];
      // THE CARD IS THE PERSON'S (default OFF): read only when chosen, and only
      // for the move's own game. A hand edit to the file is therefore seen by
      // the next ask — the frozen packet's hash moves with the content.
      const entry = findMove(move);
      const game = entry === null ? null : entry.game;
      const cards =
        includeCard && game !== null && options.cards !== undefined
          ? await options.cards()
          : [];
      const creationKinds =
        includeCard && game !== null && options.creationKinds !== undefined
          ? options.creationKinds(game)
          : [];
      setAsking(true);
      const result = await askForPacket({
        workspacePath: options.workspacePath,
        fs: options.fs,
        context: options.context(),
        request,
        person: { selection },
        includeCard,
        cards,
        creationKinds,
        priorRefusals,
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
    [options, selection, includeCard],
  );

  return {
    selection,
    select,
    clear,
    includeCard,
    setIncludeCard,
    packet,
    issues,
    asking,
    ask,
  };
}
