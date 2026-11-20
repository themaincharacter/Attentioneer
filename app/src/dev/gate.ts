/**
 * STORY 21.4 — THE DEV GATE, AND ONLY THE GATE (ADR-0038 decision 6, second
 * half).
 *
 * A developer build may watch ONE file and drive the app from it. The gate is
 * this paragraph of rules, kept apart from the watcher so a test can prove the
 * rules without a filesystem and a release bundle carries the rules in a few
 * bytes; the watcher itself lives in `commandFile.ts` and is loaded lazily, so
 * a release build never contains it (see `App.tsx`'s mount and the test that
 * holds the guard in place).
 *
 * TWO CONDITIONS, BOTH REQUIRED:
 *
 *   1. THE BUILD IS A DEVELOPER BUILD (`import.meta.env.DEV`, the build's own
 *      flag). A release build refuses before it reads any path at all.
 *   2. A PERSON NAMED THE PATH, explicitly, through `ATTENTIONEER_DEV_COMMANDS`.
 *      Unset, blank, or not an absolute path answers null: the watcher does not
 *      start. Nothing is discovered by convention — no `./commands.json`, no
 *      temp-folder guess, no "the workspace probably wants one".
 *
 * WHY AN ABSOLUTE PATH: a relative path resolves against whatever working
 * directory the shell that launched the window happened to have, which is not a
 * thing the person chose. A path the person typed in full is.
 *
 * PROVISIONAL (ADR-0038's consequences): the variable's name, the
 * absolute-path rule, and how the dev server injects the value.
 */

/** The environment variable a developer sets to name the watched file. */
export const DEV_COMMANDS_ENV = "ATTENTIONEER_DEV_COMMANDS";

/** Whether a path is absolute in the forms this app runs on. */
export function isAbsolutePath(path: string): boolean {
  // A POSIX root, a Windows drive root, or a Windows UNC share.
  return (
    path.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith("\\\\")
  );
}

/**
 * The path the watcher may use, or null. PURE and total: the gate is a decision
 * about two values, never a side effect. `isDevBuild` must be EXACTLY true, so
 * an undefined flag (a test, a tool that imports this module) refuses rather
 * than guesses.
 */
export function devCommandsPath(
  value: unknown,
  isDevBuild: boolean,
): string | null {
  if (isDevBuild !== true) return null;
  if (typeof value !== "string") return null;
  const path = value.trim();
  if (path === "") return null;
  return isAbsolutePath(path) ? path : null;
}
