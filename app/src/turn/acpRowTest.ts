/**
 * THE "TEST THIS ROW" VERB, AT THE RUN SEAM (story 22.1; PROVISIONAL).
 *
 * WHAT THIS FILE IS: one tiny task, through the SAME run wire and lane every
 * session card's run uses (turn/acpSession.ts asks, sidecar/runs.ts spawns).
 * It is deliberately NOT a card run: nothing here writes a transcript line, a
 * `sent` entry, a history event, a mirror line or a record. The run's ending
 * and the first line of its answer settle IN MEMORY, and the caller decides
 * what (if anything) to keep.
 *
 * THE TASK IS FIXED and tiny on purpose: "Reply with exactly one short
 * sentence: the word OK." The question is never what the tool can do — it is
 * only whether this machine can start it, finish one turn and hear words come
 * back. A test that answered proves exactly that much.
 *
 * NO CWD. The run carries no `cwd`, so the lane makes its ordinary fresh
 * session directory under the OS temp; the row's normal env resolution (its
 * env entries, read by the window's key store) and its normal argv are used
 * unchanged. The ONLY field this file replaces is the budget, because a small
 * task that needs ten minutes is not the test this verifies.
 *
 * STORY 22.3 — THE BUDGET IS THREE MINUTES (PROVISIONAL). One minute was the
 * first guess and it is wrong on this machine: a first turn through a
 * Windows-interop child was measured at 60–120 s cold, so a one-minute budget
 * fired before a healthy tool could answer and the row stayed untested for a
 * reason that was never the tool's. Three minutes covers a cold first turn and
 * still ends a probe that is really stuck; the value is provisional because it
 * is a guess about this machine, not a rule about the wire.
 *
 * A FAILED TEST WRITES NOTHING: this module returns the sentence to show and
 * never touches the config. The caller keeps the row untested and says the
 * ending's own words (the lane's sentence for a missing command included).
 *
 * A TEST NEVER GRANTS ANYTHING (PROVISIONAL). If the tool asks for permission
 * during the test, the ask is REFUSED at once — the existing refuse rule turns
 * it into the server's reject-once option, and no person is asked. A test that
 * needs permission is not a passing test, the person grants nothing to a probe,
 * and an unanswered ask must never sit until the budget: the run carries on (or
 * ends as the tool decides) and its ending is what the row records.
 *
 * PROVISIONAL: the prompt's wording, the three-minute budget and the three
 * sentences below.
 */

import {
  startSessionRun,
  type SessionRunHandle,
  type SessionRunWiring,
} from "./acpSession";
import type { AcpEnding } from "./acpEntries";
import type { AcpRowSeen, AcpSpec } from "./acpSpecs";
import { rowSeenOf } from "./acpRowStore";

/** The one tiny task a row test asks (PROVISIONAL). */
export const ROW_TEST_PROMPT =
  "Reply with exactly one short sentence: the word OK.";

/**
 * A row test gets three minutes, never the row's own budget (PROVISIONAL). A
 * cold first turn through a Windows-interop child runs 60–120 s; one minute
 * was a false negative, not a stuck tool.
 */
export const ROW_TEST_TIMEOUT_MINUTES = 3;

/** The sentences a test says when no answer is a result (PROVISIONAL). */
export const ROW_TEST_SENTENCES = {
  /** A completed turn with nothing said is not something seen. */
  empty: "the test answered nothing, so this row is still untested here.",
  /** A stopped test (the lane closed under it) leaves the row untested. */
  stopped: "the test did not finish, so this row is still untested here.",
  /** No sentence came with the ending, so the test claims only its absence. */
  noAnswer: "the test did not answer, so this row is still untested here.",
  /** The test answered, but this machine could not keep the fact. */
  notStored:
    "the test answered, but this machine could not keep the result, so the row is still untested here.",
} as const;

/** How one test settled: what it saw, or the sentence the face says instead. */
export type RowTestOutcome =
  | { kind: "tested"; seen: AcpRowSeen }
  | { kind: "untested"; ending: AcpEnding; sentence: string };

/**
 * THE ROW AS THE TEST RUN SEES IT (PURE): the shipped row with one field
 * replaced — the three-minute budget. The command, argv, env entries, cwd policy
 * and continuation mark are the row's own, untouched.
 */
export function rowTestSpec(row: AcpSpec): AcpSpec {
  return { ...row, timeoutMinutes: ROW_TEST_TIMEOUT_MINUTES };
}

/**
 * RUN ONE TEST. One spawn through the existing lane; the ending is the lane's
 * own and the words are the agent's own. Only a `completed` turn with words
 * on its first line is something this row can say it saw; every other ending
 * keeps its sentence and the row stays untested.
 */
export async function runRowTest(
  row: AcpSpec,
  wiring: SessionRunWiring = {},
): Promise<RowTestOutcome> {
  let answer = "";
  // The ask can only arrive after the run has asked for its key and started
  // the child — both awaited inside the seam — so this cell is filled before
  // the seam could ever call back into it.
  const probe: { handle: SessionRunHandle | null } = { handle: null };
  const handle = startSessionRun(rowTestSpec(row), ROW_TEST_PROMPT, {
    // A test carries NO cwd, scope or continuation, whatever the caller's
    // wiring type allows: it is a fresh session directory and one prompt.
    ...(wiring.readKey === undefined ? {} : { readKey: wiring.readKey }),
    ...(wiring.transport === undefined ? {} : { transport: wiring.transport }),
    ...(wiring.start === undefined ? {} : { start: wiring.start }),
    // A TEST NEVER GRANTS ANYTHING: any permission ask is answered the moment
    // it arrives, with the person's REFUSE verb, through the seam that already
    // maps it to the server's reject-once option. So a probe never waits on a
    // person and an unanswered ask never sits until the budget; the run
    // continues or ends as the tool chooses, and its ending is what this test
    // reports — never a timeout dressed up as a verdict.
    onPermission: (ask) => {
      probe.handle?.answerPermission(ask.id, "refuse");
    },
    // The words are collected here and NOWHERE else: a test has no transcript.
    onEntry: (entry) => {
      if (entry.kind === "update" && entry.updateKind === "agent_message_chunk") {
        answer += entry.text;
      }
    },
  });
  probe.handle = handle;
  const ended = await handle.ended;
  if (ended.ending === "completed") {
    const seen = rowSeenOf(answer);
    if (seen.line !== "") return { kind: "tested", seen };
    return {
      kind: "untested",
      ending: ended.ending,
      sentence: ROW_TEST_SENTENCES.empty,
    };
  }
  if (ended.ending === "stopped") {
    return {
      kind: "untested",
      ending: ended.ending,
      sentence: ROW_TEST_SENTENCES.stopped,
    };
  }
  return {
    kind: "untested",
    ending: ended.ending,
    sentence: ended.sentence ?? ROW_TEST_SENTENCES.noAnswer,
  };
}
