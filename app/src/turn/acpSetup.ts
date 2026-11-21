/**
 * THE TOOL ROW'S OWN SIGN-IN, FROM THE CARD'S SIDE (story 22.1b; PROVISIONAL).
 *
 * WHAT THIS FILE IS: the pure half of a SETUP CHILD — the row's argv turned into
 * a tool, the verbs the card offers, the sentence each state says, and the two
 * small readings of what the child printed (the URL a link line holds, and the
 * one quiet cropped line the card can show). Everything here is window-safe:
 * the card imports it, and so does the lane's own seam, so the words cannot
 * drift into two dialects.
 *
 * WHAT A SETUP CHILD IS NOT: a run. It sends no prompt, writes no transcript,
 * touches no map and gets no PERMISSION surface — it is the tool's own sign-in,
 * and the person does the interactive part in their own browser. So this module
 * never says "run", never states an ending as a result, and never claims the
 * sign-in SUCCEEDED: only the tool can know that, and the app's proof stays the
 * person's own press of "test".
 *
 * THE CODE IS EPHEMERAL. Nothing in this module accepts, keeps or returns the
 * person's code: it lives in the card's field for as long as it takes to cross
 * the pipe, and the card clears it the moment it is sent. The only readings
 * here are of the CHILD's output, never of the person's input.
 *
 * PROVISIONAL: the verbs, every sentence, the crop length and the rule that
 * reads a URL out of a line.
 */

import type { AcpSpec } from "./acpSpecs";
import type { SetupEnding, SetupTool } from "./protocol";

/** How much of the child's newest line the card shows, in characters. */
export const SETUP_LINE_MAX = 160;

/** The verbs a card offers for a sign-in (PROVISIONAL wording). */
export const SETUP_VERBS = {
  signIn: "sign in",
  openPage: "open the page",
  sendCode: "send the code",
  stop: "stop",
} as const;

/** The one quiet field's label and placeholder (PROVISIONAL wording). */
export const SETUP_CODE_LABEL = "the code the page shows";
export const SETUP_CODE_PLACEHOLDER = "paste the code the page shows";

/**
 * The sentences a sign-in says (PROVISIONAL wording). Each one names what the
 * APP knows and nothing more: the child is alive, it has exited (the person's
 * own press of "test" is still what proves the row), the person
 * stopped it, or the field has no code in it yet. No sentence claims a sign-in
 * worked, and none says "verified".
 */
export const SETUP_SENTENCES = {
  /** Only while the child is alive. */
  running: "the sign-in is running; paste the code the page shows.",
  /** The child exited by itself with code zero — no claim beyond that. */
  done: "the sign-in is done; press test to see.",
  /** The person stopped it. */
  stopped: "the sign-in was stopped.",
  /** A send with a blank field starts nothing and says why. */
  emptyCode: "write the code first.",
  /** A failed child that printed nothing has only its silence to report. */
  nothingSaid: "the sign-in ended with nothing said.",
  /** A press on a row that declares no sign-in: there is nothing to open. */
  noSignIn: "this row declares no sign-in this app can run.",
} as const;

/**
 * THE TOOL A SETUP CHILD STARTS (PURE): the row's command and its sign-in argv,
 * or null when this row declares none. Only the argv comes from `signIn`; the
 * command is the row's own, so a sign-in can never be a second program.
 */
export function signInToolOf(row: AcpSpec): SetupTool | null {
  if (row.signIn === undefined) return null;
  const args = row.signIn.args
    .map((arg) => arg.trim())
    .filter((arg) => arg !== "");
  if (args.length === 0) return null;
  return { command: row.command, args };
}

/**
 * THE FIRST http(s) URL IN ONE LINE, or null (PURE). A tool's sign-in prints
 * the page it wants the person to open, so the card surfaces that address as
 * the "open the page" verb. Only http and https count — anything else is not a
 * page this app can hand to the OS opener. A trailing punctuation mark that
 * ends the sentence around the address is dropped, never a real part of it.
 */
export function setupUrlIn(line: string): string | null {
  const match = /https?:\/\/[^\s<>"'`]+/i.exec(line);
  if (match === null) return null;
  let url = match[0];
  while (url !== "" && /[.,;:!?)\]]$/.test(url)) {
    url = url.slice(0, -1);
  }
  return url === "" ? null : url;
}

/**
 * ONE LINE, CROPPED FOR THE CARD (PURE): trimmed, one line, and cut at `max`
 * characters with an ellipsis when it is longer. An empty line is the empty
 * string, and the card shows nothing for it.
 */
export function setupLineCrop(
  line: string,
  max: number = SETUP_LINE_MAX,
): string {
  const trimmed = line.replace(/\s+/g, " ").trim();
  const room = Math.max(1, Math.floor(max));
  if (trimmed.length <= room) return trimmed;
  return trimmed.slice(0, Math.max(1, room - 1)).trimEnd() + "…";
}

/**
 * THE ONE SENTENCE AN ENDED SIGN-IN SAYS (PURE). A stopped child says the
 * stopped line whatever exit code a kill happened to produce; a child that
 * exited by itself says the done line; a failure says the child's own last
 * line (cropped) when it printed one, and the lane's one sentence otherwise.
 * Nothing here claims the sign-in worked.
 */
export function setupEndSentence(
  ending: SetupEnding,
  line: string | null,
  sentence: string | null,
): string {
  if (ending === "stopped") return SETUP_SENTENCES.stopped;
  if (ending === "completed") return SETUP_SENTENCES.done;
  const last = line === null ? "" : setupLineCrop(line);
  if (last !== "") return last;
  const lane = sentence === null ? "" : setupLineCrop(sentence);
  return lane === "" ? SETUP_SENTENCES.nothingSaid : lane;
}

/**
 * WHAT THE CARD NEEDS TO DRAW ONE CARD'S SIGN-IN (PROVISIONAL). It is VIEW
 * STATE and nothing else: the child's newest line, how it ended, and the
 * person's three verbs. The code field is the card's own local state and is
 * never part of this shape — a pasted code is not a fact this app keeps.
 */
export interface SessionSignIn {
  /** The child is alive right now. */
  running: boolean;
  /** The child's newest line, or null before it has printed one. */
  line: string | null;
  /** How the child ended, once it has; null while it never ran or is running. */
  ended: {
    ending: SetupEnding;
    line: string | null;
    sentence: string | null;
  } | null;
  /** The press that starts one. Absent in a render test. */
  start?: () => void;
  /** Hand the person's code to the child's stdin. Absent in a render test. */
  sendCode?: (code: string) => void;
  /** Stop the live child. Absent in a render test. */
  stop?: () => void;
  /** Hand one page address to the OS opener. Absent in a render test. */
  openPage?: (url: string) => void;
}
