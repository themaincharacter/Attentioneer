import type { GhostMove, GhostTarget } from "./envelope";
import { issue, type GhostIssue } from "./issues";
import {
  assemblePacket,
  type Packet,
  type PacketCard,
  type PacketView,
  type PersonRegion,
} from "./packet";
import { tauriGhostFs, type GhostFs } from "./port";
import { findMove } from "./registry";
import type { GhostContext } from "./session";
import { readGhostSnapshot } from "./snapshot";

/**
 * THE QUIET REQUEST (Epic 10 story 2) — the minimal surface the person asks a
 * packet through, PROVISIONAL and deliberately plain (no UI polish; story 3
 * owns the verbs and the ghost UI).
 *
 * An ask is THREE things, kept apart on purpose:
 *   - the REQUEST (move + named target) — what the person asks the move about;
 *   - the PERSON'S REGION (their word selection, or none) — what the person
 *     chooses to show;
 *   - the PERSON'S INCLUSION CHOICE (Epic 11 story 3) — whether this game's
 *     card rides the packet.
 * The request can never choose the region, and it can never choose the card:
 * the type carries no region-shaped and no card-shaped key (PACKET_REQUEST_KEYS
 * is exactly move/target), and a hand-built object with an extra key is simply
 * ignored by the assembler (the negative test smuggles one and gets the same
 * bytes). Authorship by selection has no door here (ADR-0026); the card is the
 * person's to include or leave (ADR-0027).
 *
 * THE RUN'S PRIOR REFUSAL SENTENCES (Epic 14 story 1, ADR-0031's packet bound)
 * are the SESSION's ephemeral state, handed to the ask as its own option and
 * forwarded to the packet (which dedupes and bounds them by N). The request
 * type has no key for them, so a request can never invent a refusal, a count or
 * a trail; the ask freezes them into bytes only when the run already said them.
 *
 * The surface is where the packet's refusals live, before anything is frozen:
 * an unregistered move, another band than the move's game, an active branch
 * (ghosts are refused there), a target kind the move refuses in v1 (a spot is
 * uncheckable, a link crosses the branch seam), and a target that is not on
 * the map. The sentences reuse the grammar's own words; the grammar still
 * holds the door at intake/accept — this is the early, honest "not this ask".
 *
 * The base pin is read HERE, through the ghost's fs port at the ask moment
 * (`readGhostSnapshot`), so the frozen packet names the bytes the proposal
 * would be built against — not a value remembered from an earlier moment. The
 * ask writes nothing: no record, no inbox file, no marker.
 *
 * Provisional: the surface's shape (one async function over the port), the
 * absence of any pacing/queue machinery (Epic 9's pacing debt is story 3's
 * chrome, not the ask), and the inclusion choice's flag name and its OFF
 * default (Epic 11 story 3: the trial shape, the card rides only when chosen).
 */

/** The ask's keys, exactly — a region has no key a request could use. */
export const PACKET_REQUEST_KEYS: readonly string[] = ["move", "target"];

/** What the person asks for: the registered move and the one named target. */
export interface PacketRequest {
  /** The move (v1: assumption/add — the registry is the door). */
  move: GhostMove;
  /** The one target the move is about (v1: a word or a loop). */
  target: GhostTarget;
}

/** What an ask is handed: the running context, the ask, the person's region. */
export interface AskOptions {
  /** The workspace root (absolute, as the app holds it). */
  workspacePath: string;
  /** The fs port; defaults to the Tauri bridge. */
  fs?: GhostFs;
  /** The app's running context (the band and the branch). */
  context: GhostContext;
  /** The ask: the move and the named target. */
  request: PacketRequest;
  /** The person's own region (their selection, or none). */
  person: PersonRegion;
  /**
   * The person's inclusion choice for the game's card (Epic 11 story 3).
   * OFF (or absent) leaves the default conventions standing; the request has
   * no key that could set it.
   */
  includeCard?: boolean;
  /** The map's game notes, as data (read by the app; only the move's rides). */
  cards?: readonly PacketCard[];
  /** The canvas ring's authored kinds for the game (data; the moves line). */
  creationKinds?: readonly string[];
  /**
   * THE RUN'S PRIOR REFUSAL SENTENCES for this move and target (Epic 14 story
   * 1, ADR-0031): read from the session's run state by the app, never from the
   * request. Absent or empty leaves the packet's run block out entirely.
   */
  priorRefusals?: readonly string[];
  /** The map's records, as the app loaded them. */
  view: PacketView;
}

/** What an ask produced. */
export type AskResult =
  | { ok: true; packet: Packet }
  | { ok: false; issues: readonly GhostIssue[] };

/** A refusal that names the target, as the grammar does. */
function targetLabelOf(target: GhostTarget): string {
  if (target.kind === "word" || target.kind === "loop") return target.slug;
  return target.kind;
}

/**
 * Ask for one packet: refuse what cannot be asked, read the base at this
 * moment, assemble and freeze. Pure apart from the one snapshot read.
 */
export async function askForPacket(options: AskOptions): Promise<AskResult> {
  const { context, request } = options;
  const refused = (issues: readonly GhostIssue[]): AskResult => ({
    ok: false,
    issues,
  });

  const entry = findMove(request.move);
  if (entry === null) {
    return refused([
      issue(
        "unregistered-move",
        request.move.family + "/" + request.move.verb + " is not a registered move",
      ),
    ]);
  }
  if (context.level !== entry.game) {
    return refused([
      issue(
        "game",
        entry.move.family +
          "/" +
          entry.move.verb +
          " belongs to the " +
          entry.game +
          " game; the app is at " +
          context.level,
      ),
    ]);
  }
  if (context.scenario !== null) {
    return refused([
      issue(
        "branch",
        "a branch is active: a ghost is refused rather than write a committed orphan unseen",
      ),
    ]);
  }

  const rule = entry.targets.find(
    (candidate) => candidate.kind === request.target.kind,
  );
  if (rule === undefined) {
    return refused([
      issue(
        "target-shape",
        'the record grammar has no "' + request.target.kind + '" target',
      ),
    ]);
  }
  if (!rule.allowed) {
    return refused([
      issue(
        "refused-target",
        rule.refusal ?? 'the move refuses a "' + request.target.kind + '" target in v1',
      ),
    ]);
  }

  const fs = options.fs ?? tauriGhostFs;
  const snapshot = await readGhostSnapshot(fs, options.workspacePath, {
    level: context.level,
    scenario: context.scenario,
    files: entry.files,
  });

  const onMap =
    request.target.kind === "word"
      ? snapshot.words.has(request.target.slug)
      : request.target.kind === "loop"
        ? snapshot.loops.has(request.target.slug)
        : false;
  if (!onMap) {
    return refused([
      issue(
        "dangling-target",
        'the target "' + targetLabelOf(request.target) + '" is not on the map',
      ),
    ]);
  }

  // The move is about ONE of the words in the region (the epic's check: "an
  // assumption beside one of those words"). The person's selection wins, so
  // the surface says so rather than widening it for them: a target outside the
  // chosen region is not an ask this packet can answer. Clearing the region is
  // the person's own way back to the ADR's fallback.
  if (
    options.person.selection !== null &&
    request.target.kind === "word" &&
    !options.person.selection.includes(request.target.slug)
  ) {
    return refused([
      issue(
        "region",
        "the target is not one of the words in the region you chose; the move is about one of those words",
      ),
    ]);
  }

  return {
    ok: true,
    packet: assemblePacket({
      entry,
      target: request.target,
      person: options.person,
      includeCard: options.includeCard === true,
      cards: options.cards,
      creationKinds: options.creationKinds,
      run: { sentences: options.priorRefusals ?? [] },
      view: options.view,
      snapshot,
    }),
  };
}
