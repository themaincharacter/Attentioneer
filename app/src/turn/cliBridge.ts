import { invoke } from "@tauri-apps/api/core";
import {
  probeCli,
  type CliFacts,
  type CliHow,
  type CliProbe,
  type CliProcess,
  type CliRefusal,
  type CliWhere,
} from "./cli";
import type { CliSpec } from "./cliSpecs";
import { errorSentence } from "./turn";

/**
 * THE WINDOW'S SIDE OF THE CLI TIER (Epic 15 story 5).
 *
 * The RULES are pure (`cli.ts`): the order to look in, the one-argument
 * prompt, the version line, the sign-in verdict. The PROCESS is Rust's
 * (`src-tauri/src/cli.rs`): resolve, spawn with an argv array, capture capped
 * output, kill on the stated timeout. This file is the narrow seam between
 * them, and it is deliberately dumb — it hands Rust an argv and returns the
 * facts, refusing in one sentence rather than throwing.
 *
 * WHY THE ARGV IS BUILT ABOVE THIS LINE: the prompt becomes one argument in
 * `cli.ts`'s `buildCliArgs`, before anything crosses the bridge. Rust never
 * sees a command line, only a program and an array.
 *
 * PROVISIONAL: the command names and their camelCase arguments; the probe
 * timeout (20 s) is the pure module's number, passed across rather than
 * guessed at twice.
 */

/** The facts the host reports about one run; mirrors `cli.rs`. */
interface HostCliFacts {
  path: string;
  how: string;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

/** What the host reports about a resolution; mirrors `cli.rs`. */
interface HostCliWhere {
  path: string;
  how: string;
}

function asFacts(facts: HostCliFacts): CliFacts {
  return {
    path: facts.path,
    how: facts.how,
    code: facts.code,
    stdout: facts.stdout,
    stderr: facts.stderr,
    timedOut: facts.timedOut === true,
  };
}

/**
 * Run one argv through the host. A refusal is one sentence: a command that did
 * not resolve, or a process the host could not start.
 */
export async function cliRunArgs(
  command: string,
  wellKnown: readonly string[],
  args: readonly string[],
  timeoutMs: number,
): Promise<CliFacts | CliRefusal> {
  try {
    const facts = await invoke<HostCliFacts>("cli_run", {
      command,
      wellKnown: [...wellKnown],
      args: [...args],
      timeoutMs,
    });
    return asFacts(facts);
  } catch (error) {
    return { kind: "refused", sentence: errorSentence(String(error)) };
  }
}

/** Resolve one command WITHOUT running it (the turn's "can anything leave?"). */
export async function cliWhereArgs(
  command: string,
  wellKnown: readonly string[],
): Promise<{ kind: "resolved"; where: CliWhere } | CliRefusal> {
  try {
    const where = await invoke<HostCliWhere>("cli_where", {
      command,
      wellKnown: [...wellKnown],
    });
    return {
      kind: "resolved",
      where: { path: where.path, how: where.how as CliHow },
    };
  } catch (error) {
    return { kind: "refused", sentence: errorSentence(String(error)) };
  }
}

/**
 * Run one probe argv through the host. The probe has its OWN command and its
 * own budget on the Rust side, because a probe must be short and a turn may
 * legitimately take minutes — one timeout for both would be one of the two
 * being wrong.
 */
export async function cliProbeArgs(
  command: string,
  wellKnown: readonly string[],
  args: readonly string[],
): Promise<CliFacts | CliRefusal> {
  try {
    const facts = await invoke<HostCliFacts>("cli_probe", {
      command,
      wellKnown: [...wellKnown],
      args: [...args],
    });
    return asFacts(facts);
  } catch (error) {
    return { kind: "refused", sentence: errorSentence(String(error)) };
  }
}

/** The probe's process layer: the probe command and the probe's own budget. */
export function cliProbeProcess(run = cliProbeArgs): CliProcess {
  return (spec: CliSpec, args: readonly string[]) =>
    run(spec.command, spec.wellKnown ?? [], args);
}

/** Probe one spec end to end: where it is, its version, its sign-in state. */
export async function probeSpec(spec: CliSpec): Promise<CliProbe> {
  return await probeCli(spec, cliProbeProcess());
}
