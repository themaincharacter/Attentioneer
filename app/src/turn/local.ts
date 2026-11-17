import {
  DEFAULT_LOCAL_IDLE_MINUTES,
  LOCAL_KEY_PLACEHOLDER,
  LOCAL_MODEL_PLACEHOLDER,
  LOCAL_PORT_PLACEHOLDER,
} from "./localSpecs";

/**
 * THE LOCAL TIER'S PURE RULES (Epic 15 story 6; PROVISIONAL).
 *
 * Everything decidable without a process lives here, so the rules can be read
 * and tested as values: which placeholders an argv may carry, how one launch's
 * port, key and model go into SEPARATE entries, where a model path's display
 * name comes from, and the sentence the panel shows for the runtime's state.
 * The process is Rust's (src-tauri/src/local_runtime.rs); this file never
 * spawns, listens or connects.
 *
 * WHY SUBSTITUTION IS ENTRY BY ENTRY: an argv entry is a value, not a piece of
 * a command line. Each placeholder replaces text INSIDE its own entry and
 * stays one entry however many spaces the model path holds; a shell never sees
 * it. The Rust side performs the same substitution on the same array, and both
 * halves are tested.
 *
 * PROVISIONAL: the placeholder names, the idle default, the status fields and
 * the sentence wording.
 */

/** One launch's substituted values, as the host reports them back. */
export interface LocalValues {
  port: number;
  key: string;
  model: string;
}

/** The issue that would make an argv unable to start, or null when it can. */
export function localArgsProblem(args: readonly string[]): string | null {
  const entries = args.map((arg) => arg.trim()).filter((arg) => arg !== "");
  if (entries.length === 0) {
    return "the arguments need " + LOCAL_PORT_PLACEHOLDER + " — the app chooses the port";
  }
  const known = new Set(["port", "key", "model"]);
  for (const entry of entries) {
    for (const match of entry.matchAll(/\{([A-Za-z][A-Za-z0-9_-]*)\}/g)) {
      if (!known.has(match[1])) {
        return (
          "the arguments carry {" +
          match[1] +
          "}, which the app does not substitute (it knows {port}, {key} and {model})"
        );
      }
    }
  }
  const counting = (placeholder: string): number =>
    entries.filter((entry) => entry.includes(placeholder)).length;
  const ports = counting(LOCAL_PORT_PLACEHOLDER);
  if (ports === 0) {
    return "the arguments need " + LOCAL_PORT_PLACEHOLDER + " — the app chooses the port";
  }
  if (ports > 1) {
    return "only one argument may carry " + LOCAL_PORT_PLACEHOLDER + " — the app chooses one port";
  }
  const keys = counting(LOCAL_KEY_PLACEHOLDER);
  if (keys > 1) {
    return "only one argument may carry " + LOCAL_KEY_PLACEHOLDER + " — the key is minted once per launch";
  }
  const models = counting(LOCAL_MODEL_PLACEHOLDER);
  if (models > 1) {
    return "only one argument may carry " + LOCAL_MODEL_PLACEHOLDER + " — the row names one model";
  }
  return null;
}

/**
 * Substitute one launch's values into the argv. Every entry stays one entry:
 * the port, key and model are values inside an argument, never a command line.
 */
export function substituteLocalArgs(
  args: readonly string[],
  values: LocalValues,
): string[] {
  return args.map((arg) =>
    arg
      .split(LOCAL_PORT_PLACEHOLDER)
      .join(String(values.port))
      .split(LOCAL_KEY_PLACEHOLDER)
      .join(values.key)
      .split(LOCAL_MODEL_PLACEHOLDER)
      .join(values.model),
  );
}

/** The last path segment without its extension: a model path's display name. */
export function modelStem(path: string): string {
  const trimmed = path.trim().replace(/[\\/]+$/, "");
  const segment = trimmed.split(/[\\/]/).pop() ?? "";
  const dot = segment.lastIndexOf(".");
  return dot > 0 ? segment.slice(0, dot) : segment;
}

/** The base URL of a running local server: loopback only, the /v1 path. */
export function localBaseUrl(port: number): string {
  return "http://127.0.0.1:" + String(port) + "/v1";
}

/** What the host reports about one launch; mirrors local_runtime.rs. */
export interface LocalStatus {
  running: boolean;
  port: number | null;
  key: string | null;
  idleMinutes: number;
  tag: string;
  lastLine: string;
}

function idleWords(minutes: number): string {
  const amount = minutes < 1 ? DEFAULT_LOCAL_IDLE_MINUTES : minutes;
  return amount === 1 ? "one minute" : String(amount) + " minutes";
}

/**
 * The one sentence the panel shows for a runtime. Running says WHERE (the port
 * it chose) and the idle rule it is under; stopped says so plainly rather than
 * leaving an old port on screen.
 */
export function localSentence(status: LocalStatus | null): string {
  if (status === null || !status.running || status.port === null) {
    return "the local runtime is stopped";
  }
  return (
    "the local runtime is running on 127.0.0.1:" +
    String(status.port) +
    " (it stops after " +
    idleWords(status.idleMinutes) +
    " with no turn)"
  );
}

/** What one start attempt produced: a launch, or the ONE sentence why not. */
export type LocalLaunch =
  | { kind: "running"; status: LocalStatus }
  | { kind: "refused"; sentence: string };
