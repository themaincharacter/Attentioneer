/**
 * THE CLI SPECS THE APP SHIPS (Epic 15 story 5; the spec shape is PROVISIONAL).
 *
 * WHY A SPEC AND NOT A BRANCH: a CLI backend is a fact about a program — where
 * to find it, how to ask its version, how it says whether it is signed in, and
 * how to hand it one prompt. The app never asks "is this the Claude one?", so
 * a backend the app has never heard of is a row a person types, and a backend
 * that ships is an entry in THIS list. Adding one is editing data.
 *
 * WHY THESE TWO ARE HERE: they are the two the person asked for, and they ship
 * as DATA so the panel can offer them by name without any code knowing them.
 * Nothing in this file compares, branches on, or special-cases a name: the
 * strings below are the only place a product is mentioned at all.
 *
 * THE ARGV SHAPES ARE THIS FILE'S CLAIM, NOT A GUARANTEE (PROVISIONAL). Each
 * entry's `notes` says what was and was not verified against a live install:
 * the version flag and the run shape are the documented ones, and a sign-in
 * probe's exact output is the least certain part. If a flag changes, the fix
 * is editing this list — never a condition somewhere else.
 *
 * WHAT A TURN SENDS: the prompt goes into EXACTLY ONE argument, wherever
 * `{prompt}` stands. The spec is data, so the placeholder is data too, and
 * `cli.ts` is the one place that substitutes it.
 */

/** The placeholder a run (or READ) argument may carry for the prompt. */
export const PROMPT_PLACEHOLDER = "{prompt}";

/** How one CLI says its version and runs one prompt. All argv arrays. */
export interface CliSpec {
  /** Stable id; a row derived from this spec shares it. */
  id: string;
  /** The display name the panel shows. */
  name: string;
  /** The binary: a bare name (PATH, then well-known) or a path as typed. */
  command: string;
  /** The argv that prints the version. The first output line is shown. */
  versionArgs: string[];
  /**
   * The OPTIONAL sign-in probe. No block means "this probe does not apply",
   * which is a state of its own and never a claim that anyone is signed out.
   */
  auth?: {
    /** The argv that prints the sign-in state. */
    args: string[];
    /** A regular expression over stdout+stderr; matching means signed in. */
    okPattern: string;
  };
  /** How one prompt runs, and which stream carries the answer. */
  run: { args: string[]; read: "stdout" };
  /** Extra places to look, after PATH (a small, honest list). */
  wellKnown?: string[];
  /** What this entry claims, and how sure it is. */
  notes: string;
}

/**
 * The shipped list. Data, in the person's order, and the only place these
 * names are written down. Marked PROVISIONAL: the argv shapes are the
 * documented ones, the sign-in patterns are the least verified.
 */
export const CLI_SPECS: readonly CliSpec[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    versionArgs: ["--version"],
    auth: {
      args: ["auth", "status", "--json"],
      // The JSON status prints a boolean; the key is what was observed.
      okPattern: '"loggedIn"\\s*:\\s*true',
    },
    run: { args: ["-p", PROMPT_PLACEHOLDER], read: "stdout" },
    wellKnown: ["~/.claude/local/claude"],
    notes:
      "version and print mode (-p) are the documented flags; the auth JSON shape is unverified against a live install",
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    versionArgs: ["--version"],
    auth: {
      args: ["login", "status"],
      // Matched case-insensitively, anywhere in the output; "not logged in"
      // therefore does not count as signed in.
      okPattern: "(^|\\n)\\s*logged in",
    },
    run: { args: ["exec", PROMPT_PLACEHOLDER], read: "stdout" },
    notes:
      "exec <prompt> is the documented run shape; the version flag and the login-status text are unverified against a live install",
  },
];

/** One shipped spec by id, or null (the panel offers only what ships). */
export function shippedSpec(id: string): CliSpec | null {
  return CLI_SPECS.find((spec) => spec.id === id) ?? null;
}
