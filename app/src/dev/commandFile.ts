import {
  actSpecOf,
  actsFromScript,
  validateAct,
  type CommandAct,
} from "../commands/acts";
import type { CommandApply } from "../commands/attentioneerHost";

/**
 * STORY 21.4 — THE DEV COMMAND FILE (ADR-0038 decision 6, second half).
 *
 * In a DEVELOPER build, and only when a person named an absolute path through
 * `ATTENTIONEER_DEV_COMMANDS`, the app polls that ONE file. A script written
 * there is read as the act script the driver already knows (`actsFromScript`),
 * run through the SAME path the command card uses (propose, then accept in one
 * call — `applyCommandScript`), and answered with one JSON line per act in
 * `<path>.results`, then a summary line. Nothing listens: no socket, no port,
 * no discovery, one file, and only with the gate's two conditions met.
 *
 * APPEND ONLY: the results file is opened read-then-written with the earlier
 * bytes untouched and the new lines after them; the app never truncates it and
 * never rewrites an earlier line. The app also never deletes the script.
 *
 * THE FIRST READ IS THE BASELINE: a script already sitting in the file when the
 * watcher starts is NOT run — a restart must not replay yesterday's commands.
 * The watcher runs what is WRITTEN while it watches; a new write (different
 * bytes) is one run. `poll()` is exposed so a test drives the same tick the
 * interval drives.
 *
 * IN A SESSION (three steps, the whole of it): 1) set an ABSOLUTE scratch path
 * in `ATTENTIONEER_DEV_COMMANDS` (a file outside the workspace is tidiest, so
 * the results never look like map content) and start `bun run tauri dev`;
 * 2) open a workspace and write an act script into that file; 3) wait half a
 * second and read `<path>.results` — one line per act, the summary last. A
 * later script is a later write; the app never edits or deletes either file.
 *
 * A BAD ACT STOPS THE SCRIPT AND IS NAMED: the whole script is validated first
 * by the vocabulary's own validator, so the failure can say WHICH act and the
 * results carry a line for that act with `ok:false`. An unparsable script
 * writes exactly ONE line and applies nothing. A host refusal mid-run (a card
 * that is not on the map, say) writes the lines for the acts that ran, a line
 * naming the act that refused, and the summary.
 *
 * PROVISIONAL (ADR-0038's consequences): the results line's keys and `kind`
 * markers, the summary's fields, the poll interval, and the baseline rule.
 */

/** How often the watcher looks. PROVISIONAL: a person reads within a second. */
export const DEV_COMMANDS_POLL_MS = 500;

/** The results file's name: the script's own path, plus one suffix. */
export function resultsPathOf(path: string): string {
  return `${path}.results`;
}

/** The sentence an unparsable script answers, in ONE line. */
export const UNREADABLE_SCRIPT =
  "the script is not a list of acts; nothing was applied.";

/** The sentence when the run threw instead of answering (almost never). */
export const BROKEN_RUN =
  "the script stopped without an answer; nothing after it was written.";

/** One line of `<path>.results`. PROVISIONAL keys, as the story allows. */
export type DevResultLine =
  | { kind: "act"; act: string; ok: true; sentence: string; ghostId?: string }
  | { kind: "act"; act: string; ok: false; sentence: string }
  | { kind: "script"; ok: false; sentence: string }
  | {
      kind: "summary";
      ok: boolean;
      acts: number;
      applied: number;
      ghosts: number;
      sentence?: string;
    };

/** What the watcher needs from the window: two reads/writes and the one seam. */
export interface DevCommandFileDeps {
  /** The script's bytes, or null when the file is not there yet. */
  readText(path: string): Promise<string | null>;
  /** APPEND the text; the app never rewrites or truncates earlier bytes. */
  appendText(path: string, text: string): Promise<void>;
  /**
   * The app's ONE apply path (propose, then accept in the same call): the same
   * `applyCommandScript` the command card runs. Never a second write path.
   */
  applyScript(acts: readonly CommandAct[]): Promise<CommandApply>;
}

/** The act's name for a line, even when the act was too broken to validate. */
function nameOfAct(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && "act" in raw) {
    const name = (raw as { act?: unknown }).act;
    if (typeof name === "string" && name !== "") return name;
  }
  return "(unnamed)";
}

/** The ghost ids filed by the acts that ran, in act order (a proposal only). */
function ghostIdsByAct(
  acts: readonly CommandAct[],
  ids: readonly string[],
  ran: number,
): (string | undefined)[] {
  const answer: (string | undefined)[] = [];
  let next = 0;
  for (let index = 0; index < ran; index += 1) {
    if (actSpecOf(acts[index].act)?.family === "propose" && next < ids.length) {
      answer[index] = ids[next];
      next += 1;
    }
  }
  return answer;
}

/**
 * Turn one script's text into the lines it leaves behind, with NO clock and no
 * filesystem of its own: the deps carry the one apply seam. Exported so a test
 * can hold the line shape without a watcher.
 */
export async function devResultsOf(
  text: string,
  deps: Pick<DevCommandFileDeps, "applyScript">,
): Promise<DevResultLine[]> {
  const raw = actsFromScript(text);
  if (raw === null) {
    return [{ kind: "script", ok: false, sentence: UNREADABLE_SCRIPT }];
  }

  // WHOLE-SCRIPT VALIDATION, AS THE EXECUTOR DOES IT — here only so the lines
  // can say which act was out of shape. The executor still owns the refusal;
  // nothing runs when any act is refused.
  const acts: CommandAct[] = [];
  for (const entry of raw) {
    const read = validateAct(entry);
    if (!read.ok) {
      return [
        { kind: "act", act: nameOfAct(entry), ok: false, sentence: read.sentence },
        {
          kind: "summary",
          ok: false,
          acts: raw.length,
          applied: 0,
          ghosts: 0,
          sentence: read.sentence,
        },
      ];
    }
    acts.push(read.act);
  }

  let apply: CommandApply;
  try {
    apply = await deps.applyScript(acts);
  } catch {
    return [{ kind: "script", ok: false, sentence: BROKEN_RUN }];
  }

  const run = apply.run;
  if (run === null) {
    // The app had no workspace to run against: nothing ran, and the app's own
    // sentence is the line.
    const sentence = apply.ok ? BROKEN_RUN : apply.sentence;
    return [
      { kind: "script", ok: false, sentence },
      {
        kind: "summary",
        ok: false,
        acts: acts.length,
        applied: 0,
        ghosts: 0,
        sentence,
      },
    ];
  }

  if (apply.ok) {
    const ghosts = ghostIdsByAct(acts, run.ids, acts.length);
    return [
      ...acts.map((act, index): DevResultLine => {
        const ghostId = ghosts[index];
        return ghostId === undefined
          ? { kind: "act", act: act.act, ok: true, sentence: run.lines[index] }
          : {
              kind: "act",
              act: act.act,
              ok: true,
              sentence: run.lines[index],
              ghostId,
            };
      }),
      {
        kind: "summary",
        ok: true,
        acts: acts.length,
        applied: acts.length,
        ghosts: run.ids.length,
      },
    ];
  }

  if (apply.phase === "accept") {
    // Every act ran and filed its ghost; the accept itself was refused. The
    // lines say what ran, and the summary says the accept did not settle.
    const ghosts = ghostIdsByAct(acts, run.ids, acts.length);
    return [
      ...acts.map((act, index): DevResultLine => {
        const ghostId = ghosts[index];
        return ghostId === undefined
          ? { kind: "act", act: act.act, ok: true, sentence: run.lines[index] }
          : {
              kind: "act",
              act: act.act,
              ok: true,
              sentence: run.lines[index],
              ghostId,
            };
      }),
      {
        kind: "summary",
        ok: false,
        acts: acts.length,
        applied: acts.length,
        ghosts: run.ids.length,
        sentence: apply.sentence,
      },
    ];
  }

  // EXECUTION STOPPED AT AN ACT: the lines for the acts before it, one line
  // naming the act that refused, and the summary. Nothing after it ran.
  const failedAt = run.applied;
  const ghosts = ghostIdsByAct(acts, run.ids, failedAt);
  const lines: DevResultLine[] = [];
  for (let index = 0; index < failedAt; index += 1) {
    const ghostId = ghosts[index];
    lines.push(
      ghostId === undefined
        ? { kind: "act", act: acts[index].act, ok: true, sentence: run.lines[index] }
        : {
            kind: "act",
            act: acts[index].act,
            ok: true,
            sentence: run.lines[index],
            ghostId,
          },
    );
  }
  if (failedAt < acts.length) {
    lines.push({
      kind: "act",
      act: acts[failedAt].act,
      ok: false,
      sentence: run.sentence ?? apply.sentence,
    });
  }
  lines.push({
    kind: "summary",
    ok: false,
    acts: acts.length,
    applied: failedAt,
    ghosts: run.ids.length,
    sentence: run.sentence ?? apply.sentence,
  });
  return lines;
}

/** One watcher: poll it, or let `startDevCommandFile` poll on a timer. */
export interface DevCommandFileWatcher {
  /** Look at the file once; resolves after any run it triggered was written. */
  poll(): Promise<void>;
  /** Stop for good: a later poll answers nothing. */
  stop(): void;
}

/** What a watcher is built from. */
export interface DevCommandFileOptions {
  /** The absolute path a person named (already through the gate). */
  path: string;
  /** The bridges and the one apply seam. */
  deps: DevCommandFileDeps;
  /** A quiet error report; the watcher never throws into the app. */
  onError?(error: unknown): void;
}

/**
 * The watcher's state machine, without a timer: read, compare, run, append.
 * The first successful read is the baseline (see the module's note).
 */
export function createDevCommandFile(
  options: DevCommandFileOptions,
): DevCommandFileWatcher {
  const { path, deps } = options;
  let baselined = false;
  let lastText: string | null = null;
  let stopped = false;
  let busy = false;

  async function poll(): Promise<void> {
    if (stopped || busy) return;
    busy = true;
    try {
      const text = await deps.readText(path);
      if (text === null) {
        // Not there yet. A file that appears later is a WRITE, so it runs.
        baselined = true;
        lastText = null;
        return;
      }
      if (!baselined || text === lastText) {
        baselined = true;
        lastText = text;
        return;
      }
      // Remember the bytes BEFORE running: a file that keeps changing while a
      // run is in flight is read once on the next tick, never twice for one run.
      lastText = text;
      const lines = await devResultsOf(text, deps);
      const body = lines.map((line) => JSON.stringify(line) + "\n").join("");
      await deps.appendText(resultsPathOf(path), body);
    } catch (error) {
      options.onError?.(error);
    } finally {
      busy = false;
    }
  }

  return {
    poll,
    stop() {
      stopped = true;
    },
  };
}

/**
 * Start the watcher and return the stop function. The timer belongs to the
 * watcher and exists only in a developer build: there is no app-wide tick to
 * hang a dev poll on (the canvas' frame loops are per-gesture and end with the
 * gesture), and coupling a dev file to a map's render loop would be worse than
 * one quiet interval.
 */
export function startDevCommandFile(options: DevCommandFileOptions): () => void {
  const watcher = createDevCommandFile(options);
  const timer = setInterval(() => {
    void watcher.poll();
  }, DEV_COMMANDS_POLL_MS);
  return () => {
    watcher.stop();
    clearInterval(timer);
  };
}
