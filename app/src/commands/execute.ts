import { validateAct, validateAppAct, type CommandAct } from "./acts";

/**
 * STORY 21.1 — THE EXECUTOR, THE PORTABLE HALF (ADR-0038 §3, §5, §6).
 *
 * Runs a script of acts, in order, against a host. The host is the ONLY thing
 * this module knows about an app: one method per act, each answering one line or
 * ONE refusal sentence. That is the seam a second app implements; nothing here
 * names a record, a file, a bridge, a component or a model.
 *
 * THE SCOPE'S ONE RULE: a script is validated WHOLE before its first act runs.
 * An unknown act, a bad payload or a missing key answers ONE sentence and
 * applies NOTHING — never a prefix of the script (ADR-0038 §5's discipline,
 * applied to the driver as much as to a model's reply). A host refusal mid-run
 * stops the run at that act and applies nothing after it; the ghosts filed
 * before it stay filed, because a proposal is not a write and the person can
 * still refuse them.
 *
 * NO MODEL CALL, NO CLOCK, NO RANDOMNESS: the executor is the same code a chat
 * will drive in story 21.2, which is why testability lives here first.
 */

/** One outcome: a line to print, or ONE sentence why the act was refused. */
export type CommandOutcome =
  | {
      ok: true;
      line: string;
      /** The ONE ghost a proposal filed (the shape every story before 21.7 used). */
      id?: string;
      /**
       * STORY 21.7 — THE GHOSTS ONE ACT MAY FILE, when one act is the app's own
       * multi-step shape: an ask card is its line, its wires are the SAME link
       * ghost a wire proposal files, and its removal is the app's delete shape
       * (the record line, then the conversation that goes with it). A proposal
       * still changes no record; the person accepts this documented set.
       */
      ids?: readonly string[];
    }
  | { ok: false; sentence: string };

/**
 * What the executor needs from an app. The app's half reads through its own
 * loaded view and proposes through its own intake; this interface carries only
 * what a portable act can ask for.
 */
export interface CommandHost {
  /** A short summary of the map. */
  readOverview(): Promise<CommandOutcome>;
  /** One card, by name or slug, bounded. */
  readCard(card: string): Promise<CommandOutcome>;
  /** The wire list. */
  readWires(): Promise<CommandOutcome>;
  /** Propose a card; the answer names the ghost it filed. */
  proposeCard(payload: Readonly<Record<string, unknown>>): Promise<CommandOutcome>;
  /** Propose a wire. */
  proposeWire(payload: Readonly<Record<string, unknown>>): Promise<CommandOutcome>;
  /** Propose a note. */
  proposeNote(payload: Readonly<Record<string, unknown>>): Promise<CommandOutcome>;
  /** Propose an ask card. */
  proposeAsk(payload: Readonly<Record<string, unknown>>): Promise<CommandOutcome>;
  /**
   * STORY 21.6 — the removals. Each proposes ONE removal as a ghost; none
   * deletes anything itself (the person accepts, and the app's own Restore
   * stays the undo of the undo).
   */
  proposeUnwire(payload: Readonly<Record<string, unknown>>): Promise<CommandOutcome>;
  proposeRemoveNote(payload: Readonly<Record<string, unknown>>): Promise<CommandOutcome>;
  proposeRemoveCard(payload: Readonly<Record<string, unknown>>): Promise<CommandOutcome>;
  /**
   * STORY 21.8 — the place and the name. A move names a card, optionally the
   * card to measure from, and a direction; the host computes the point (a
   * prepared take-back may carry the app's own previous point instead). A name
   * is PROPOSED for the person to accept, never applied as an instruction.
   */
  proposeMove(payload: Readonly<Record<string, unknown>>): Promise<CommandOutcome>;
  proposeRename(payload: Readonly<Record<string, unknown>>): Promise<CommandOutcome>;
}

/** What running a script left behind. */
export interface CommandRun {
  /** Every act ran and none refused. */
  ok: boolean;
  /** One line per act that ran, in order. */
  lines: readonly string[];
  /** The ids of the ghosts the run filed, in order (a proposal, not a write). */
  ids: readonly string[];
  /**
   * STORY 21.8 — THE GHOSTS EACH ACT FILED, one entry per act in act order (a
   * read files none; one ask act may file its card and its wires). The adapter
   * uses this to attach the previous value an undo needs to the ACT it came
   * from, never to guess which ghost belongs to which act.
   */
  actIds: readonly (readonly string[])[];
  /** ONE sentence when the run stopped; null when it finished. */
  sentence: string | null;
  /** How many acts ran (never a person-facing counter: the driver's summary). */
  applied: number;
}

/** The refusal when a host's method answers without a sentence (never silent). */
const HOST_REFUSAL = "the app refused that act.";

function refused(
  sentence: string,
  lines: readonly string[],
  ids: readonly string[],
  actIds: readonly (readonly string[])[],
  applied: number,
): CommandRun {
  return { ok: false, lines, ids, actIds, sentence, applied };
}

/** Run one validated act against the host. */
async function runOne(act: CommandAct, host: CommandHost): Promise<CommandOutcome> {
  const payload = act.payload;
  switch (act.act) {
    case "map_overview":
      return host.readOverview();
    case "read_card":
      return host.readCard(String(payload.card));
    case "read_wires":
      return host.readWires();
    case "propose_card":
      return host.proposeCard(payload);
    case "propose_wire":
      return host.proposeWire(payload);
    case "propose_note":
      return host.proposeNote(payload);
    case "propose_ask":
      return host.proposeAsk(payload);
    case "propose_unwire":
      return host.proposeUnwire(payload);
    case "propose_remove_note":
      return host.proposeRemoveNote(payload);
    case "propose_remove_card":
      return host.proposeRemoveCard(payload);
    case "propose_move":
      return host.proposeMove(payload);
    case "propose_rename":
      return host.proposeRename(payload);
    default:
      // Unreachable: validateAct registered the name. Kept explicit so a new
      // act added to the vocabulary without a dispatch fails loudly in a test.
      return { ok: false, sentence: `the act "${act.act}" has no executor.` };
  }
}

/**
 * Validate a whole script, then run it in order. The executor applies nothing
 * when any act is out of shape; a host refusal stops the run where it happens.
 */
export async function executeScript(
  raw: unknown,
  host: CommandHost,
): Promise<CommandRun> {
  if (!Array.isArray(raw)) {
    return refused("a script is a list of acts.", [], [], [], 0);
  }
  const acts: CommandAct[] = [];
  for (const entry of raw) {
    // STORY 21.8 — an act the APP minted for an undo is read through its own
    // door (it may carry the previous point the model may never name). The
    // model's reply reaches validateAct, which drops the flag, so a reply can
    // never take this branch.
    const prepared =
      typeof entry === "object" && entry !== null && !Array.isArray(entry) &&
      (entry as { prepared?: unknown }).prepared === true;
    const read = prepared ? validateAppAct(entry) : validateAct(entry);
    if (!read.ok) return refused(read.sentence, [], [], [], 0);
    acts.push(read.act);
  }

  const lines: string[] = [];
  const ids: string[] = [];
  const actIds: string[][] = [];
  for (const act of acts) {
    const outcome = await runOne(act, host);
    if (!outcome.ok) {
      return refused(
        outcome.sentence || HOST_REFUSAL,
        lines,
        ids,
        actIds,
        lines.length,
      );
    }
    lines.push(outcome.line);
    const filed =
      outcome.ids !== undefined
        ? [...outcome.ids]
        : outcome.id !== undefined
          ? [outcome.id]
          : [];
    actIds.push(filed);
    ids.push(...filed);
  }
  return { ok: true, lines, ids, actIds, sentence: null, applied: lines.length };
}
