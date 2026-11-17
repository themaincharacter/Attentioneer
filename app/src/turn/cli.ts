import { PROMPT_PLACEHOLDER, type CliSpec } from "./cliSpecs";

/**
 * THE CLI TIER'S PURE RULES (Epic 15 story 5; PROVISIONAL).
 *
 * Everything decidable without a filesystem or a process lives here, so the
 * rules can be read and tested as values: where to look for a command and in
 * what order, how one prompt becomes exactly one argv entry, what the version
 * line is, and what the sign-in probe does and does not claim. The process is
 * Rust's (`src-tauri/src/cli.rs`); this file is handed its FACTS and words
 * the answer.
 *
 * WHY THE ORDER IS SPELLED OUT HERE AND IN RUST: only the host can see a
 * filesystem. So the host walks the same three steps — the path the person
 * typed, then PATH, then a small well-known list — and REPORTS which one it
 * used (`typed-path` | `path` | `well-known`); the sentence the person reads
 * is built from that report. The order is one rule written twice because one
 * side of the boundary has the files, and both halves are tested.
 *
 * WHY A PROMPT IS NEVER CONCATENATED: an argv entry is a value, not a piece of
 * a command line. The prompt replaces `{prompt}` inside ONE argument and stays
 * one entry however many spaces, quotes or newlines it holds — a shell never
 * sees it. The one exception is Windows' command interpreter, and even there
 * the argument array crosses as separate entries (Rust's business, not this
 * file's).
 *
 * PROVISIONAL: the well-known lists, the probe timeout and the sentence
 * wording. The resolution ORDER and the one-argument rule are the story's.
 */

/** The three places a command is looked for, in order. */
export type CliHow = "typed-path" | "path" | "well-known";

/** What the host found, and which step found it. */
export interface CliWhere {
  path: string;
  how: CliHow;
}

/** A refusal is a sentence, never an exception. */
export type CliRefusal = { kind: "refused"; sentence: string };

/** What running one CLI argv produced, as the host reports it. */
export interface CliFacts {
  /** The resolved program the host actually ran. */
  path: string;
  /** Which resolution step named it (also reported on its own). */
  how: string;
  /** The exit code; null when the host had to kill it. */
  code: number | null;
  stdout: string;
  stderr: string;
  /** The child was killed because the stated budget ran out. */
  timedOut: boolean;
}

/** How long one turn's CLI child may run before it is killed. */
export const CLI_TURN_TIMEOUT_MS = 120_000;

/**
 * What resolution is allowed to consult — injected so a test can stand a fake
 * filesystem in front of the same rule.
 */
export interface CliResolveFacts {
  platform: "windows" | "macos" | "linux";
  /** The directories PATH lists, in order. */
  pathDirs: readonly string[];
  /** The home directory, for a `~` and the well-known list. */
  home: string;
  /** Does this exact path name a file? (The host's one lexical privilege.) */
  exists: (path: string) => boolean;
}

/** Does the typed text name a path rather than a bare command? */
export function commandLooksLikePath(
  command: string,
  platform: CliResolveFacts["platform"],
): boolean {
  const text = command.trim();
  if (text === "" || text === "~" || text.startsWith("~/") || text.startsWith("~\\")) {
    return text !== "";
  }
  if (text.includes("/") || text.includes("\\")) return true;
  // A Windows drive letter ("C:\\tool\\cli.exe") is a path, not a command.
  return platform === "windows" && /^[A-Za-z]:/.test(text);
}

/** Expand a leading `~` against the home the facts name. */
export function expandHome(path: string, facts: CliResolveFacts): string {
  const text = path.trim();
  if (text === "~") return facts.home;
  if (text.startsWith("~/")) return joinPath(facts.home, text.slice(2), facts.platform);
  if (text.startsWith("~\\")) return joinPath(facts.home, text.slice(2), facts.platform);
  return text;
}

function joinPath(dir: string, name: string, platform: CliResolveFacts["platform"]): string {
  if (dir === "") return name;
  const separator = platform === "windows" ? "\\" : "/";
  return dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + separator + name;
}

/**
 * The executable names to try in one directory. Windows hides the extension
 * from the person, so a command typed without one is tried with the ones a
 * shim may carry; elsewhere the name stands alone.
 */
export function executableNames(
  command: string,
  platform: CliResolveFacts["platform"],
): string[] {
  const text = command.trim();
  if (platform !== "windows") return [text];
  if (/\.[A-Za-z0-9]+$/.test(text)) return [text];
  return [text, text + ".exe", text + ".cmd", text + ".bat"];
}

/**
 * The well-known places to look when PATH does not have it. A SMALL list, on
 * purpose: the places a person-installed CLI usually lands, never a scan of
 * the disk. A spec may add its own (a per-product install location).
 */
export function wellKnownPlaces(facts: CliResolveFacts): string[] {
  if (facts.platform === "windows") {
    return [
      joinPath(facts.home, "AppData/Roaming/npm", facts.platform),
      joinPath(facts.home, ".local/bin", facts.platform),
    ];
  }
  const places = [
    joinPath(facts.home, ".local/bin", facts.platform),
    "/usr/local/bin",
    "/opt/homebrew/bin",
  ];
  return places;
}

/**
 * Every candidate, in the order resolution may try it: the path as typed (and
 * then nothing else — a typed path is used as typed), PATH, then the spec's
 * own places, then the small default list.
 */
export function cliCandidates(
  command: string,
  spec: Pick<CliSpec, "wellKnown">,
  facts: CliResolveFacts,
): CliWhere[] {
  const text = command.trim();
  if (text === "") return [];
  if (commandLooksLikePath(text, facts.platform)) {
    return [{ path: expandHome(text, facts), how: "typed-path" }];
  }
  // The command a well-known entry is joined with is the BARE name: a place is
  // a directory, and the file in it is what the person asked us to run.
  const names = executableNames(text, facts.platform);
  const candidates: CliWhere[] = [];
  const push = (dir: string, how: CliHow): void => {
    const expanded = expandHome(dir, facts);
    for (const name of names) {
      candidates.push({ path: joinPath(expanded, name, facts.platform), how });
    }
  };
  for (const dir of facts.pathDirs) push(dir, "path");
  for (const place of spec.wellKnown ?? []) push(place, "well-known");
  for (const place of wellKnownPlaces(facts)) push(place, "well-known");
  return candidates;
}

/** The first candidate that names a file, or the one sentence why there is none. */
export function resolveCliCommand(
  command: string,
  spec: Pick<CliSpec, "wellKnown" | "name">,
  facts: CliResolveFacts,
): { kind: "resolved"; where: CliWhere } | CliRefusal {
  const text = command.trim();
  if (text === "") {
    return { kind: "refused", sentence: "a CLI provider needs a command to run" };
  }
  for (const candidate of cliCandidates(text, spec, facts)) {
    if (facts.exists(candidate.path)) return { kind: "resolved", where: candidate };
  }
  return {
    kind: "refused",
    sentence:
      text +
      " was not found: not at that path, not on PATH, and not in the usual places",
  };
}

/** The sentence that SAYS which step found the command (never a bare path). */
export function resolutionSentence(where: CliWhere): string {
  return where.how === "typed-path"
    ? "found at " + where.path + " — the path you typed"
    : where.how === "path"
      ? "found at " + where.path + " — on PATH"
      : "found at " + where.path + " — a well-known location";
}

/**
 * One prompt into the spec's argv: the prompt replaces `{prompt}` and stays
 * ONE argv entry. No trimming, no quoting, no shell string.
 */
export function buildCliArgs(
  args: readonly string[],
  prompt: string,
): string[] {
  return args.map((arg) => arg.split(PROMPT_PLACEHOLDER).join(prompt));
}

/**
 * The one thing a run template must get right: exactly one argument carries
 * `{prompt}`, so the prompt has one place to go and cannot ride twice.
 */
export function promptTemplateProblem(args: readonly string[]): string | null {
  const carrying = args.filter((arg) => arg.includes(PROMPT_PLACEHOLDER));
  if (carrying.length === 0) {
    return "the run arguments need {prompt} — it is where the question goes";
  }
  if (carrying.length > 1) {
    return "only one run argument may carry {prompt}";
  }
  return null;
}

/** The first non-empty line of a stream — everything the app shows of it. */
export function firstLine(text: string): string {
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line !== "") return line;
  }
  return "";
}

/** The version to show: the first line of stdout, else of stderr, else "". */
export function versionLine(facts: Pick<CliFacts, "stdout" | "stderr">): string {
  return firstLine(facts.stdout) === "" ? firstLine(facts.stderr) : firstLine(facts.stdout);
}

/** What the sign-in probe is allowed to claim. */
export type AuthVerdict =
  | { kind: "not-applicable"; sentence: string }
  | { kind: "signed-in"; sentence: string }
  | { kind: "signed-out"; sentence: string }
  | { kind: "undecided"; sentence: string };

/**
 * Read one probe's sign-in answer. NO `auth` BLOCK MEANS THE PROBE DOES NOT
 * APPLY — its own state, said plainly, never "signed out": the app must not
 * accuse a backend of being signed out when it never asked.
 */
export function authVerdict(
  spec: Pick<CliSpec, "name" | "auth">,
  facts: CliFacts | CliRefusal | null,
): AuthVerdict {
  if (spec.auth === undefined) {
    return {
      kind: "not-applicable",
      sentence: spec.name + ": this probe does not apply (the spec names no sign-in check)",
    };
  }
  if (facts === null || (facts as CliRefusal).kind === "refused") {
    return {
      kind: "undecided",
      sentence: spec.name + "'s sign-in state could not be read",
    };
  }
  const run = facts as CliFacts;
  if (run.timedOut) {
    return {
      kind: "undecided",
      sentence: spec.name + " did not answer the sign-in probe in time",
    };
  }
  let pattern: RegExp;
  try {
    pattern = new RegExp(spec.auth.okPattern, "i");
  } catch {
    return {
      kind: "undecided",
      sentence: spec.name + "'s sign-in check in the spec is not a valid pattern",
    };
  }
  const output = run.stdout + "\n" + run.stderr;
  return pattern.test(output)
    ? { kind: "signed-in", sentence: spec.name + " is signed in" }
    : { kind: "signed-out", sentence: spec.name + " is not signed in" };
}

/** What one probe found: where the command is, its version, its sign-in state. */
export interface CliProbeFacts {
  where: CliWhere;
  version: { line: string; sentence: string };
  auth: AuthVerdict;
}

/** A probe is facts, or the one sentence why the command could not be run. */
export type CliProbe = ({ kind: "probed" } & CliProbeFacts) | CliRefusal;

/** Runs one argv for a spec; the host's process layer, injected. */
export type CliProcess = (
  spec: CliSpec,
  args: readonly string[],
) => Promise<CliFacts | CliRefusal>;

/**
 * Probe one spec: version first (never a failure — show what came back), then
 * the sign-in check only when the spec names one. One probe cannot make the
 * provider unusable; it can only say what it saw.
 */
export async function probeCli(
  spec: CliSpec,
  run: CliProcess,
): Promise<CliProbe> {
  const versionFacts = await run(spec, spec.versionArgs);
  if ((versionFacts as CliRefusal).kind === "refused") {
    return versionFacts as CliRefusal;
  }
  const versionRun = versionFacts as CliFacts;
  const line = versionLine(versionRun);
  const version = {
    line,
    sentence:
      versionRun.timedOut
        ? spec.name + " did not answer the version probe in time"
        : line === ""
          ? spec.name + "'s version probe came back empty (exit " + String(versionRun.code) + ")"
          : spec.name + " says: " + line,
  };
  if (spec.auth === undefined) {
    return {
      kind: "probed",
      where: {
        path: versionRun.path,
        how: versionRun.how as CliHow,
      },
      version,
      auth: authVerdict(spec, null),
    };
  }
  const authFacts = await run(spec, spec.auth.args);
  return {
    kind: "probed",
    where: { path: versionRun.path, how: versionRun.how as CliHow },
    version,
    auth: authVerdict(spec, authFacts),
  };
}

/** What one run's facts mean for a turn. */
export type CliOutcome =
  | { kind: "answer"; text: string }
  | { kind: "error"; sentence: string }
  | { kind: "timeout"; sentence: string };

/**
 * The answer, or ONE sentence. A non-zero exit is the sentence plus the FIRST
 * line of stderr — never a trace; a timeout is its own state because the child
 * was killed rather than having answered.
 */
export function cliAnswer(
  spec: Pick<CliSpec, "name">,
  facts: CliFacts | CliRefusal,
): CliOutcome {
  if ((facts as CliRefusal).kind === "refused") {
    return { kind: "error", sentence: (facts as CliRefusal).sentence };
  }
  const run = facts as CliFacts;
  if (run.timedOut) {
    return {
      kind: "timeout",
      sentence: spec.name + " did not answer in time and was stopped",
    };
  }
  if (run.code !== null && run.code !== 0) {
    const said = firstLine(run.stderr);
    return {
      kind: "error",
      sentence:
        spec.name + " exited with " + String(run.code) + (said === "" ? " and said nothing more" : ": " + said),
    };
  }
  const text = run.stdout.replace(/[\r\n]+$/, "");
  if (text.trim() === "") {
    return {
      kind: "error",
      sentence: spec.name + " ended without saying anything",
    };
  }
  return { kind: "answer", text };
}
